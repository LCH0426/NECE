/**
 * Copyright (C) [2026] [LCH0426]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * NLCE 邮件系统
 * 管理员可群发/单发邮件（含货币和物品附件），玩家可查看和领取
 * 支持定时邮件（到时间自动激活并通知在线玩家），附件通过 SNBT 序列化物品数据
 */


const D = require('./debug');
let mailDM = null;
let mailData = null;
let _deps = {};

/**
 * 初始化邮件模块，加载邮件数据并确保数据结构完整
 * @param {DataManager} dm - 邮件数据的 DataManager 实例
 * @param {Object} deps - 外部依赖（money、U、getPlayerSetting 等）
 */
function init(dm, deps) {
	D.debugLogModule('mail')('init: 初始化完成');
    mailDM = dm;
    _deps = deps || {};
    mailData = mailDM.load();
    if (!mailData.mails) mailData.mails = [];
    if (!mailData.nextId) mailData.nextId = 1;
}

/** 获取邮件原始数据 */
function getData() {
    return mailData;
}

/** 防抖保存邮件数据到磁盘 */
function save() {
    if (mailDM) {
        mailDM.save();
    }
}

/**
 * 添加一封邮件并保存
 * @param {Object} mail - 邮件对象
 */
function addMail(mail) {
    mailData.mails.push(mail);
    save();
}

/**
 * 根据 ID 删除邮件
 * @param {number} mailId - 邮件 ID
 * @returns {boolean} 是否删除成功
 */
function deleteMail(mailId) {
    const index = mailData.mails.findIndex(function(m) { return m.id === mailId; });
    if (index === -1) return false;
    mailData.mails.splice(index, 1);
    save();
    return true;
}

/**
 * 根据 ID 查询邮件
 * @param {number} mailId
 * @returns {Object|null}
 */
function getMailById(mailId) {
    return mailData.mails.find(function(m) { return m.id === mailId; }) || null;
}

/** 获取下一个可用的邮件 ID */
function getNextId() {
    return mailData.nextId;
}

/** 递增邮件 ID 计数器并保存 */
function incrementNextId() {
    mailData.nextId++;
    save();
}

/**
 * 格式化当前时间为 "YYYY.MM.DD.HH.mm.ss" 格式
 * @returns {string}
 */
function formatMailTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return year + '.' + month + '.' + day + '.' + hour + '.' + minute + '.' + second;
}

/** 获取货币显示名称（默认"星茜"） */
function getCurrencyName() {
    return _deps.getCurrencyName ? _deps.getCurrencyName() : '星茜';
}

/**
 * 获取玩家未读邮件数量（不含定时邮件）
 * 群发邮件的 read 字段是对象，按 xuid 索引判断已读状态
 * @param {string} xuid
 * @returns {number}
 */
function getUnreadMailCount(xuid) {
    if (!mailData || !mailData.mails) return 0;
    return mailData.mails.filter(function(m) {
        if (m.scheduledTime) return false;  // 跳过尚未激活的定时邮件
        if (m.toXuid === xuid) {
            return !m.read;
        } else if (m.toXuid === "all") {
            return !m.read || !m.read[xuid];
        }
        return false;
    }).length;
}

/**
 * 获取玩家未读邮件的分类统计信息
 * @param {string} xuid
 * @returns {{count: number, attachmentCount: number, normalCount: number}}
 */
function getUnreadMailInfo(xuid) {
    if (!mailData || !mailData.mails) return { count: 0, attachmentCount: 0, normalCount: 0 };
    const myMails = mailData.mails.filter(function(m) {
        if (m.scheduledTime) return false;
        if (m.toXuid === xuid) {
            return !m.read;
        } else if (m.toXuid === "all") {
            return !m.read || !m.read[xuid];
        }
        return false;
    });
    // 区分含附件和普通邮件
    const attachmentMails = myMails.filter(function(m) { return (m.starQian && m.starQian > 0) || (m.items && m.items.length > 0); });
    const normalMails = myMails.filter(function(m) { return !((m.starQian && m.starQian > 0) || (m.items && m.items.length > 0)); });
    return {
        count: myMails.length,
        attachmentCount: attachmentMails.length,
        normalCount: normalMails.length
    };
}

/**
 * 检查并激活到期的定时邮件
 * 到期后移除 scheduledTime 字段，变为普通邮件，并通知所有在线玩家
 */
function checkScheduledMails() {
    const now = new Date();
    const currentTimeStr = _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime();

    const scheduledMails = mailData.mails.filter(function(mail) { return mail.scheduledTime; });
    let needSave = false;

    scheduledMails.forEach(function(mail) {
        // 解析 "YYYY.MM.DD.HH.mm" 格式的定时时间
        const parts = mail.scheduledTime.split('.').map(Number);
        const year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
        const scheduledDate = new Date(year, month - 1, day, hour, minute, 0);

        if (now >= scheduledDate) {
            // 激活定时邮件：设置实际发送时间，移除定时标记
            mail.time = currentTimeStr;
            delete mail.scheduledTime;
            needSave = true;

            const hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
            const onlinePlayers = mc.getOnlinePlayers();
            onlinePlayers.forEach(function(onlinePlayer) {
                const playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(onlinePlayer.xuid, "enableMailNotification") : true;
                if (hasAttachment && playerSetting) {
                    onlinePlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自 " + mail.fromName + " 的邮件，内含附件奖励");
                    onlinePlayer.tell("§e[邮件] §a您收到了一封来自 " + mail.fromName + " 的邮件，内含附件奖励，请在邮件系统中领取");
                } else if (playerSetting) {
                    onlinePlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自 " + mail.fromName + " 的全体邮件");
                    onlinePlayer.tell("§e[邮件] §a您收到了一封来自 " + mail.fromName + " 的全体邮件，请在邮件系统中查看");
                }
            });
        }
    });

    if (needSave) {
        save();
    }
}

/**
 * 显示定时邮件管理列表（管理员功能）
 * @param {Player} player
 */
function showScheduledMailManagerForm(player) {
    const scheduledMails = mailData.mails.filter(function(mail) { return mail.scheduledTime; });

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§6定时邮件管理");

    if (scheduledMails.length === 0) {
        gui.setContent("§c暂无定时邮件");
    } else {
        gui.setContent("-------------------------\n§a定时邮件数量：§f" + scheduledMails.length + "\n-------------------------\n");

        scheduledMails.forEach(function(mail, index) {
            const hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
            gui.addButton((index + 1) + ". " + mail.fromName + "\n§6定时时间：" + mail.scheduledTime + "\n" + (hasAttachment ? "§a[含附件]" : ""));
        });
    }

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id >= 0 && id < scheduledMails.length) {
            showScheduledMailDetailForm(p, scheduledMails[id]);
        } else {
            showMailSystemForm(p);
        }
    });
}

/**
 * 显示单个定时邮件详情，支持修改定时时间和删除
 * @param {Player} player
 * @param {Object} mail - 定时邮件对象
 */
function showScheduledMailDetailForm(player, mail) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§6定时邮件详情");

    const hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
    let content = "------------------------\n";
    content += "§a发送者：§f" + mail.fromName + "\n";
    content += "§a定时时间：§f" + mail.scheduledTime + "\n";
    content += "§a邮件内容：\n§f" + mail.content + "\n";
    content += "§a" + getCurrencyName() + "奖励：§f" + mail.starQian + " 点\n";
    content += "§a附件物品：§f" + (mail.items ? mail.items.length : 0) + " 个\n";
    content += "§a创建时间：§f" + mail.time + "\n";
    content += "------------------------\n";

    gui.setContent(content);
    gui.addButton("§b修改定时时间", "textures/ui/icon_recipe_equipment");
    gui.addButton("§c删除定时邮件", "textures/ui/icon_delete");
    gui.addButton("§a返回列表", "textures/ui/arrow_left");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showModifyScheduledTimeForm(p, mail);
        } else if (id === 1) {
            mailData.mails = mailData.mails.filter(function(m) { return m.id !== mail.id; });
            save();
            p.tell("§e[邮件] §a定时邮件删除成功！");
            showScheduledMailManagerForm(p);
        } else {
            showScheduledMailManagerForm(p);
        }
    });
}

/**
 * 修改定时邮件的定时时间表单
 * @param {Player} player
 * @param {Object} mail - 定时邮件对象
 */
function showModifyScheduledTimeForm(player, mail) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§6修改定时时间");
    gui.addLabel("§e请输入新的定时时间");
    gui.addInput("定时时间", "格式：2026.02.12.00.00（年月日时分）", mail.scheduledTime);

    player.sendForm(gui, function(p, data) {
        if (data === null) {
            if (mail) {
                showScheduledMailDetailForm(p, mail);
            } else {
                showScheduledMailManagerForm(p);
            }
            return;
        }

        const newScheduledTime = (data && data[1]) ? data[1].trim() : '';
        // 校验时间格式：YYYY.MM.DD.HH 或 YYYY.MM.DD.HH.mm
        if (!newScheduledTime || !/^\d{4}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(newScheduledTime)) {
            p.tell("§e[邮件] §c定时时间格式错误！");
            showModifyScheduledTimeForm(p, mail);
            return;
        }

        const parts = newScheduledTime.split(".").map(Number);
        const year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
        const scheduledDate = new Date(year, month - 1, day, hour, minute, 0);
        const now = new Date();

        if (scheduledDate <= now) {
            p.tell("§e[邮件] §c定时时间必须晚于当前时间！");
            showModifyScheduledTimeForm(p, mail);
            return;
        }

        mail.scheduledTime = newScheduledTime;
        save();
        p.tell("§e[邮件] §a定时时间修改成功！");
        showScheduledMailDetailForm(p, mail);
    });
}

/**
 * 邮件系统主入口，OP 看到管理员界面，普通玩家看到玩家界面
 * @param {Player} player
 */
function showMailSystemForm(player) {
    const isOp = player.isOP();

    if (!isOp) {
        showPlayerMailSystemForm(player);
        return;
    }

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§d邮件系统");

    let content = "-------------------------\n";
    content += "§e邮件系统功能：\n";
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton("§b查看邮件", "textures/ui/mail_icon");
    gui.addButton("§a发送全体邮件", "textures/ui/icon_book_writable");
    gui.addButton("§e发送单独邮件", "textures/ui/icon_book_writable");
    gui.addButton("§6管理定时邮件", "textures/ui/icon_setting");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showMailListForm(p);
        } else if (id === 1) {
            showSendGlobalMailForm(p);
        } else if (id === 2) {
            showSearchPlayerForMailForm(p);
        } else if (id === 3) {
            showScheduledMailManagerForm(p);
        } else {
            if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p);
        }
    });
}

/**
 * 显示邮件列表，含分页，按时间降序排列
 * 群发邮件(toXuid==="all")和私信混合展示
 * @param {Player} player
 * @param {number} page - 页码（从0开始）
 */
function showMailListForm(player, page) {
    page = page || 0;
    const xuid = player.xuid;
    // 筛选发给自己的邮件和全体邮件，排除定时邮件
    const myMails = mailData.mails.filter(function(m) { return (m.toXuid === xuid || m.toXuid === "all") && !m.scheduledTime; });

    myMails.sort(function(a, b) {
        function parseTimeStr(timeStr) {
            const parts = timeStr.split('.').map(Number);
            return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
        }
        return parseTimeStr(b.time) - parseTimeStr(a.time);
    });

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b我的邮件");

    const mailsPerPage = 5;
    const totalPages = Math.ceil(myMails.length / mailsPerPage) || 1;
    const currentPage = Math.min(page, totalPages - 1);
    const startIndex = currentPage * mailsPerPage;
    const endIndex = Math.min(startIndex + mailsPerPage, myMails.length);
    const pageMails = myMails.slice(startIndex, endIndex);

    if (myMails.length === 0) {
        gui.setContent("暂无邮件");
    } else {
        gui.setContent("§a您共有 " + myMails.length + " 封邮件：\n§e当前页：" + (currentPage + 1) + "/" + totalPages);
        pageMails.forEach(function(mail) {
            // isUnread 用 let 声明以便后续修改（原代码用 const 导致赋值无效，此处保留原逻辑）
            let isUnread = false;
            if (mail.toXuid === "all") {
                if (!mail.read || !mail.read[xuid]) {
                    isUnread = true;
                }
            } else {
                if (!mail.read) {
                    isUnread = true;
                }
            }
            const type = mail.toXuid === "all" ? "[全体] " : "";
            const icon = isUnread ? "textures/ui/invite_base" : "textures/ui/New_confirm_Hover";
            gui.addButton("§b" + type + mail.fromName + "\n" + mail.time, icon);
        });
    }

    if (currentPage < totalPages - 1) {
        gui.addButton("§e下一页", "textures/ui/arrow_down");
    }
    if (currentPage > 0) {
        gui.addButton("§e上一页", "textures/ui/arrow_up");
    }

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        let btnIndex = 0;
        if (id >= 0 && id < pageMails.length) {
            showMailDetailForm(p, pageMails[id]);
            return;
        }
        btnIndex = pageMails.length;

        if (currentPage < totalPages - 1) {
            if (id === btnIndex) {
                showMailListForm(p, currentPage + 1);
                return;
            }
            btnIndex++;
        }

        if (currentPage > 0) {
            if (id === btnIndex) {
                showMailListForm(p, currentPage - 1);
                return;
            }
            btnIndex++;
        }

        if (id === btnIndex) {
            showMailSystemForm(p);
        }
    });
}

/**
 * 显示邮件详情，查看时标记已读，支持领取附件和删除
 * @param {Player} player
 * @param {Object} mail - 邮件对象
 */
function showMailDetailForm(player, mail) {
    const xuid = player.xuid;

    // 标记已读：群发邮件用对象按 xuid 索引，私信直接布尔值
    if (mail.toXuid === "all") {
        if (!mail.read) mail.read = {};
        mail.read[xuid] = true;
    } else {
        mail.read = true;
    }
    save();

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b邮件详情");

    let content = "-------------------------\n";
    content += "§a发件人：§f" + mail.fromName + "\n";
    content += "§a时间：§f" + mail.time + "\n";
    content += "-------------------------\n";
    content += "§f" + mail.content + "\n";
    content += "-------------------------\n";

    const hasAttachment = (mail.starQian && mail.starQian > 0) || (mail.items && mail.items.length > 0);

    // 判断当前玩家是否已领取附件
    let isClaimed = false;
    if (mail.toXuid === "all") {
        isClaimed = mail.claimed && mail.claimed[xuid];
    } else {
        isClaimed = mail.claimed;
    }

    if (hasAttachment) {
        content += "§e附件内容：\n";
        if (mail.starQian && mail.starQian > 0) {
            content += "§a- " + getCurrencyName() + " x" + mail.starQian + "\n";
        }
        if (mail.items && mail.items.length > 0) {
            mail.items.forEach(function(item, index) {
                // SNBT 类型物品：从序列化字符串中提取物品名称
                if (typeof item === 'object' && item.type === 'snbt' && item.snbt) {
                    const nameMatch = item.snbt.match(/"Name"\s*:\s*"([^"]+)"/);
                    const displayName = nameMatch ? nameMatch[1].replace('minecraft:', '') : 'SNBT物品';
                    content += "§a- " + displayName + "\n";
                } else if (typeof item === 'object' && item.name) {
                    content += "§a- " + item.name + " x" + (item.count || 1) + "\n";
                } else {
                    content += "§a- 物品 " + (index + 1) + "\n";
                }
            });
        }
        if (isClaimed) {
            content += "-------------------------\n";
            content += "§a已领取\n";
        }
        content += "-------------------------\n";
    }

    gui.setContent(content);

    if (hasAttachment && !isClaimed) {
        gui.addButton("§a领取附件", "textures/ui/icon_map");
    }
    gui.addButton("§c删除", "textures/ui/trash_default");
    gui.addButton("§6返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        let btnIndex = 0;
        if (hasAttachment && !isClaimed) {
            if (id === 0) {
                claimMailAttachments(p, mail);
                return;
            }
            btnIndex = 1;
        }

        if (id === btnIndex) {
            mailData.mails = mailData.mails.filter(function(m) { return m !== mail; });
            save();
            p.tell("§e[邮件] §c邮件已删除");
            showMailListForm(p);
        } else if (id === btnIndex + 1) {
            showMailListForm(p);
        }
    });
}

/**
 * 领取邮件附件：发放货币和物品
 * 物品 SNBT 解析采用多策略降级：原始 -> 转义引号 -> 去引号键 -> 组合策略 -> 正则兜底
 * @param {Player} player
 * @param {Object} mail - 含附件的邮件对象
 */
function claimMailAttachments(player, mail) {
    const xuid = player.xuid;

    // 检查是否已领取
    let isClaimed = false;
    if (mail.toXuid === "all") {
        isClaimed = mail.claimed && mail.claimed[xuid];
    } else {
        isClaimed = mail.claimed;
    }

    if (isClaimed) {
        player.tell("§e[邮件] §c您已经领取过该邮件的附件了！");
        showMailDetailForm(player, mail);
        return;
    }

    // 发放货币奖励
    if (mail.starQian && mail.starQian > 0) {
        if (_deps.money) {
            _deps.money.add(xuid, mail.starQian);
            if (_deps.notifyEconomyChange) _deps.notifyEconomyChange(player, mail.starQian, "邮件领取");
            player.tell("§e[邮件] §a成功领取 " + mail.starQian + " " + getCurrencyName() + "！");
        } else {
            player.tell("§e[邮件] §c经济系统未启用，无法发放" + getCurrencyName() + "！");
        }
    }

    // 发放物品附件
    let allItemsSuccess = true;
    if (mail.items && mail.items.length > 0) {
        mail.items.forEach(function(itemData, index) {
            try {
                const rawSnbt = typeof itemData === 'object' ? itemData.snbt : itemData;
                if (!rawSnbt || typeof rawSnbt !== 'string' || !rawSnbt.trim()) {
                    _deps.logger.error("[邮件] 物品" + (index + 1) + "缺少有效的snbt数据，itemData类型: " + typeof itemData);
                    player.tell("§e[邮件] §c物品 " + (index + 1) + " 数据无效！");
                    allItemsSuccess = false;
                    return;
                }
                const trimmedSnbt = rawSnbt.trim();

                // 多策略尝试解析 SNBT：处理不同的转义和格式变体
                let nbt = null;
                const strategies = [
                    trimmedSnbt,                                              // 原始 SNBT
                    trimmedSnbt.replace(/\\"/g, '"'),                        // 转义引号 -> 普通引号
                    trimmedSnbt.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1:'),  // JSON键 -> 无引号键
                    trimmedSnbt.replace(/\\"/g, '"').replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1:')  // 组合
                ];
                for (let si = 0; si < strategies.length; si++) {
                    nbt = NBT.parseSNBT(strategies[si]);
                    if (nbt) {
                        break;
                    }
                }

                // 所有策略均失败时，用正则提取物品 ID 和数量作为兜底
                if (!nbt) {
                    const nameMatch = trimmedSnbt.match(/"?Name"?\s*:\s*"([^"]+)"/) || trimmedSnbt.match(/Name\s*:\s*([^,}\s]+)/);
                    const countMatch = trimmedSnbt.match(/"?Count"?\s*:\s*(\d+)/) || trimmedSnbt.match(/Count\s*:\s*(\d+)/);
                    if (nameMatch) {
                        const itemId = nameMatch[1];
                        const itemCount = countMatch ? parseInt(countMatch[1]) : 1;
                        const fallbackItem = mc.newItem(itemId, itemCount);
                        if (fallbackItem) {
                            if (player.getInventory().hasRoomFor(fallbackItem)) {
                                player.giveItem(fallbackItem);
                            } else {
                                mc.spawnItem(fallbackItem, player.pos);
                                player.tell("§e[邮件] §e背包已满，物品已掉落在脚下！");
                            }
                            player.tell("§e[邮件] §a成功领取 " + fallbackItem.name + "！");
                            return;
                        }
                    }
                    player.tell("§e[邮件] §c物品 " + (index + 1) + " SNBT解析失败！");
                    allItemsSuccess = false;
                    return;
                }
                const item = mc.newItem(nbt);
                if (item) {
                    if (player.getInventory().hasRoomFor(item)) {
                        player.giveItem(item);
                    } else {
                        mc.spawnItem(item, player.pos);
                        player.tell("§e[邮件] §e背包已满，物品已掉落在脚下！");
                    }
                    player.tell("§e[邮件] §a成功领取 " + item.name + "！");
                } else {
                    player.tell("§e[邮件] §c物品 " + (index + 1) + " 创建失败！");
                    allItemsSuccess = false;
                }
            } catch (error) {
                _deps.logger.error("发放邮件物品失败：" + error.message);
                player.tell("§e[邮件] §c物品 " + (index + 1) + " 发放失败！");
                allItemsSuccess = false;
            }
        });
    }

    // 部分物品发放失败时不标记已领取，允许稍后重试
    if (!allItemsSuccess) {
        player.tell("§e[邮件] §c部分物品发放失败，请稍后重试！");
        showMailDetailForm(player, mail);
        return;
    }

    // 标记已领取
    if (mail.toXuid === "all") {
        if (!mail.claimed) mail.claimed = {};
        mail.claimed[xuid] = true;
    } else {
        mail.claimed = true;
    }
    save();

    player.tell("§e[邮件] §a附件领取成功！");
    showMailDetailForm(player, mail);
}

/**
 * 管理员发送全体邮件表单，支持货币附件、物品附件和定时发送
 * @param {Player} player - 管理员玩家
 */
function showSendGlobalMailForm(player) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§a发送全体邮件");
    gui.addLabel("§e此邮件将发送给所有玩家");
    gui.addSwitch("使用自定义发件人", false);
    gui.addInput("自定义发件人", "不填则显示系统自动投递", "");
    gui.addInput("邮件内容", "请输入邮件内容", "");
    gui.addInput("发放" + getCurrencyName(), "填写数量，为空则不发放", "");
    gui.addInput("定时发送", "格式：2026.02.12.00（年月日时分），为空则立即发送", "");

    // 枚举背包物品供选择，跳过空槽位
    const allItems = player.getInventory().getAllItems();
    const items = [];

    for (let key = 0; key < allItems.length; key++) {
        if (allItems[key].type == '') {
            continue;
        }
        allItems[key].slot = key;
        items.push(allItems[key]);
    }

    const itemOptions = ["无"];
    items.forEach(function(item) {
        const Enchanted = '';
        if (item.isEnchanted) {
            Enchanted = '§d';
        }
        itemOptions.push(Enchanted + item.name + " §rx" + item.count);
    });

    gui.addLabel("§e选择附件物品（最多5个）");
    gui.addDropdown("物品1", itemOptions, 0);
    gui.addDropdown("物品2", itemOptions, 0);
    gui.addDropdown("物品3", itemOptions, 0);
    gui.addDropdown("物品4", itemOptions, 0);
    gui.addDropdown("物品5", itemOptions, 0);

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const useCustomSender = data[1] || false;
        const customSender = data[2] ? data[2].trim() : '';

        const content = data[3] ? data[3].trim() : '';
        if (!content) {
            p.tell("§e[邮件] §c邮件内容不能为空！");
            showSendGlobalMailForm(p);
            return;
        }

        const starQianAmount = data[4] ? data[4].trim() : '';
        const starQian = starQianAmount && /^\d+$/.test(starQianAmount) ? parseInt(starQianAmount) : 0;

        const scheduledTime = data[5] ? data[5].trim() : '';

        // 用 Set 去重，防止重复选择同一物品
        const selectedItems = [];
        const selectedIndexSet = new Set();

        for (let i = 6; i <= 10; i++) {
            const selectedIndex = data[i];
            if (selectedIndex > 0 && !selectedIndexSet.has(selectedIndex)) {
                selectedIndexSet.add(selectedIndex);
                const item = items[selectedIndex - 1];
                if (item) {
                    selectedItems.push({
                        name: item.name,
                        count: item.count,
                        snbt: item.getNbt().toSNBT()
                    });
                }
            }
        }

        if (selectedItems.length > 0) {
            p.tell("§e[邮件] §a已选择 " + selectedItems.length + " 个物品！");
        }

        sendGlobalMail(p, content, starQian, selectedItems, scheduledTime, useCustomSender, customSender);
    });
}

/**
 * 执行全体邮件发送逻辑，支持定时邮件和立即发送
 * @param {Player} player - 发送者
 * @param {string} content - 邮件内容
 * @param {number} starQian - 货币附件数量
 * @param {Array} selectedItems - 物品附件数组 [{snbt, name, count}]
 * @param {string} scheduledTime - 定时时间（空字符串表示立即发送）
 * @param {boolean} useCustomSender - 是否使用自定义发件人名
 * @param {string} customSender - 自定义发件人名称
 */
function sendGlobalMail(player, content, starQian, selectedItems, scheduledTime, useCustomSender, customSender) {
    useCustomSender = useCustomSender || false;
    customSender = customSender || '';

    const items = selectedItems.map(function(item) {
        return {
            snbt: item.snbt,
            name: item.name,
            count: item.count
        };
    });
    const hasAttachment = starQian > 0 || items.length > 0;

    // 确定发件人显示名称
    let fromName;
    if (useCustomSender) {
        if (customSender) {
            fromName = customSender;
        } else {
            fromName = "系统默认投递";
        }
    } else {
        fromName = "管理员" + player.name;
    }

    if (scheduledTime) {
        // 定时发送：校验格式和时间有效性
        if (/^\d{4}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(scheduledTime)) {
            const parts = scheduledTime.split(".").map(Number);
            const year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
            const scheduledDate = new Date(year, month - 1, day, hour, minute, 0);
            const now = new Date();

            if (scheduledDate > now) {
                mailData.mails.push({
                    id: mailData.nextId++,
                    fromXuid: player.xuid,
                    fromName: fromName,
                    toXuid: "all",
                    content: content,
                    time: _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime(),
                    scheduledTime: scheduledTime,
                    read: false,
                    starQian: starQian,
                    items: items,
                    claimed: {}
                });
                save();
                player.tell("§e[邮件] §a定时邮件设置成功！将在 " + scheduledTime + " 发送" + (hasAttachment ? "（含附件）" : ""));

                // 显示发送成功确认表单
                const successForm = mc.newSimpleForm();
                successForm.setTitle("§l§a邮件发送成功");
                successForm.setContent("-------------------------\n§a邮件发送成功！" + (hasAttachment ? "（含附件）" : "") + "\n-------------------------\n§e邮件内容：\n" + content + "\n-------------------------\n§a发件人：§e" + fromName + "\n§a" + getCurrencyName() + "奖励：§e" + starQian + " 点\n§a附件物品：§e" + items.length + " 个\n§a定时发送：§e" + scheduledTime + "\n-------------------------\n");
                successForm.addButton("§b返回邮件系统", "textures/ui/recap_glyph_desaturated");
                successForm.addButton("§c关闭", "textures/ui/crossout");

                player.sendForm(successForm, function(p, id) {
                    if (id === 0) {
                        showMailSystemForm(p);
                    }
                });
                return;
            } else {
                player.tell("§e[邮件] §c定时时间必须晚于当前时间！");
                showSendGlobalMailForm(player);
                return;
            }
        } else {
            player.tell("§e[邮件] §c定时时间格式不正确！正确格式：2026.02.12.00");
            showSendGlobalMailForm(player);
            return;
        }
    }

    // 立即发送全体邮件
    mailData.mails.push({
        id: mailData.nextId++,
        fromXuid: player.xuid,
        fromName: fromName,
        toXuid: "all",
        content: content,
        time: _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime(),
        read: false,
        starQian: starQian,
        items: items,
        claimed: {}
    });
    save();

    // 通知所有在线玩家（除发送者外）
    const onlinePlayers = mc.getOnlinePlayers();
    onlinePlayers.forEach(function(onlinePlayer) {
        if (onlinePlayer.xuid !== player.xuid) {
            const playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(onlinePlayer.xuid, "enableMailNotification") : true;
            if (hasAttachment && playerSetting) {
                onlinePlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自 " + fromName + " 的邮件，内含附件奖励");
                onlinePlayer.tell("§e[邮件] §a您收到了一封来自 " + fromName + " 的邮件，内含附件奖励，请在邮件系统中领取");
            } else if (playerSetting) {
                onlinePlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自 " + fromName + " 的全体邮件");
                onlinePlayer.tell("§e[邮件] §a您收到了一封来自 " + fromName + " 的全体邮件，请在邮件系统中查看");
            }
        }
    });

    if (!scheduledTime) {
        // 立即发送时显示成功确认表单
        const successForm = mc.newSimpleForm();
        successForm.setTitle("§l§a邮件发送成功");
        successForm.setContent("-------------------------\n§a邮件发送成功！" + (hasAttachment ? "（含附件）" : "") + "\n-------------------------\n§e邮件内容：\n" + content + "\n-------------------------\n§a发件人：§e" + fromName + "\n§a" + getCurrencyName() + "奖励：§e" + starQian + " 点\n§a附件物品：§e" + items.length + " 个\n§a发送时间：§e" + (_deps.U ? _deps.U.getCurrentTimeString() : formatMailTime()) + "\n-------------------------\n");
        successForm.addButton("§b返回邮件系统", "textures/ui/recap_glyph_desaturated");
        successForm.addButton("§c关闭", "textures/ui/crossout");

        player.sendForm(successForm, function(p, id) {
            if (id === 0) {
                showMailSystemForm(p);
            }
        });
    } else {
        showMailSystemForm(player);
    }
}

/**
 * 管理员选择收件人表单，支持按 UID 或名称搜索
 * @param {Player} player
 */
function showSearchPlayerForMailForm(player) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§e选择收件人");
    gui.addDropdown("搜索方式", ["UID", "玩家名称"], 0);
    gui.addInput("搜索关键词", "输入UID或玩家名称", "");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const searchType = data[0];
        const keyword = data[1] ? data[1].trim() : '';

        if (!keyword) {
            p.tell("§e[邮件] §c请输入搜索关键词！");
            showSearchPlayerForMailForm(p);
            return;
        }

        // 搜索类型与 searchPlayers 参数相反：0=UID -> searchType=1, 1=名称 -> searchType=0
        const results = _deps.searchPlayers ? _deps.searchPlayers(keyword, searchType === 1 ? 0 : 1) : [];
        if (results.length === 0) {
            p.tell("§e[邮件] §c未找到匹配的玩家！");
            showSearchPlayerForMailForm(p);
            return;
        }

        if (results.length === 1) {
            showSendSingleMailForm(p, results[0]);
        } else {
            showMailTargetSelectForm(p, results);
        }
    });
}

/**
 * 多结果时的选择收件人列表
 * @param {Player} player
 * @param {Array} results - 搜索结果数组
 */
function showMailTargetSelectForm(player, results) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b选择收件人");
    gui.setContent("§e找到多个匹配结果，请选择：");

    results.forEach(function(p) {
        const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(p.xuid) : "textures/ui/icon_steve";
        gui.addButton("§b" + p.name + "\n§6UID: " + p.uid, avatarUrl);
    });

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id >= 0 && id < results.length) {
            showSendSingleMailForm(p, results[id]);
        } else {
            showSearchPlayerForMailForm(p);
        }
    });
}

/**
 * 管理员发送单独邮件表单，含物品附件选择
 * @param {Player} player - 管理员
 * @param {Object} target - 收件人信息 {xuid, name}
 */
function showSendSingleMailForm(player, target) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§e发送邮件");
    gui.addLabel("§e收件人：§b" + target.name);
    gui.addInput("邮件内容", "请输入邮件内容", "");
    gui.addInput("发放" + getCurrencyName(), "填写数量，为空则不发放", "");

    // 遍历背包36个槽位，收集有效物品
    const inventory = player.getInventory();
    const items = [];
    const slotCount = 36;

    for (let slot = 0; slot < slotCount; slot++) {
        try {
            const item = inventory.getItem(slot);
            if (!item) continue;
            const type = item.type;
            if (!type || type === '' || type === 'minecraft:air') continue;

            items.push({
                item: item,
                slot: slot,
                name: item.name,
                count: item.count,
                type: type,
                isEnchanted: item.isEnchanted,
                getNbt: function() {
                    return this.item.getNbt();
                }
            });
        } catch (error) {
            _deps.logger.error("[邮件系统] 获取槽位 " + slot + " 物品失败: " + error.message);
        }
    }

    const itemOptions = ["无"];
    items.forEach(function(item) {
        const Enchanted = '';
        if (item.isEnchanted) {
            Enchanted = '§d';
        }
        itemOptions.push(Enchanted + item.name + " §rx" + item.count);
    });

    gui.addLabel("§e选择附件物品（最多5个）");
    gui.addDropdown("物品1", itemOptions, 0);
    gui.addDropdown("物品2", itemOptions, 0);
    gui.addDropdown("物品3", itemOptions, 0);
    gui.addDropdown("物品4", itemOptions, 0);
    gui.addDropdown("物品5", itemOptions, 0);

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const content = data[1] ? data[1].trim() : '';
        if (!content) {
            p.tell("§e[邮件] §c邮件内容不能为空！");
            showSendSingleMailForm(p, target);
            return;
        }

        const starQianAmount = data[2] ? data[2].trim() : '';
        const starQian = starQianAmount && /^\d+$/.test(starQianAmount) ? parseInt(starQianAmount) : 0;

        const selectedItems = [];
        const selectedIndexSet = new Set();

        for (let i = 4; i <= 8; i++) {
            const selectedIndex = data[i];
            if (selectedIndex > 0 && !selectedIndexSet.has(selectedIndex)) {
                selectedIndexSet.add(selectedIndex);
                const item = items[selectedIndex - 1];
                selectedItems.push({
                    name: item.name,
                    count: item.count,
                    snbt: item.getNbt().toSNBT()
                });
            }
        }

        if (selectedItems.length > 0) {
            p.tell("§e[邮件] §a已选择 " + selectedItems.length + " 个物品！");
        }

        sendSingleMail(p, target, content, starQian, selectedItems);
    });
}

/**
 * 执行单独邮件发送（管理员），含货币和物品附件
 * @param {Player} player
 * @param {Object} target - 收件人
 * @param {string} content - 邮件内容
 * @param {number} starQian - 货币数量
 * @param {Array} selectedItems - 物品附件
 */
function sendSingleMail(player, target, content, starQian, selectedItems) {
    const items = selectedItems.map(function(item) {
        return {
            snbt: item.snbt,
            name: item.name,
            count: item.count
        };
    });
    const hasAttachment = starQian > 0 || items.length > 0;

    mailData.mails.push({
        id: mailData.nextId++,
        fromXuid: player.xuid,
        fromName: "管理员" + player.name,
        toXuid: target.xuid,
        content: content,
        time: _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime(),
        read: false,
        starQian: starQian,
        items: items,
        claimed: false
    });
    save();

    // 收件人在线时推送通知
    const targetPlayer = mc.getPlayer(target.xuid);
    if (targetPlayer) {
        const playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(target.xuid, "enableMailNotification") : true;
        if (playerSetting) {
            if (hasAttachment) {
                targetPlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自管理员 §b" + player.name + " §a的邮件，内含附件奖励");
                targetPlayer.tell("§e[邮件] §a您收到了一封来自管理员 §b" + player.name + " §a的邮件，内含附件奖励，请在邮件系统中领取");
            } else {
                targetPlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自管理员 §b" + player.name + " §a的私信");
                targetPlayer.tell("§e[邮件] §a您收到了一封来自管理员 §b" + player.name + " §a的私信，请在邮件系统中查看");
            }
        }
    }

    player.tell("§e[邮件] §a邮件已发送给 " + target.name + "！" + (hasAttachment ? "（含附件）" : ""));
    showMailSystemForm(player);
}

/**
 * 玩家发送邮件表单，需消耗货币（基础100 + 每个附件200）
 * 发送后通过 replaceitem 命令从背包扣除对应物品
 * @param {Player} player - 发送者
 */
function showPlayerSendMailForm(player) {
    const onlinePlayers = mc.getOnlinePlayers();
    const playerOptions = [];
    const playerList = [];

    onlinePlayers.forEach(function(onlinePlayer) {
        if (onlinePlayer.xuid !== player.xuid) {
            playerOptions.push(onlinePlayer.name);
            playerList.push({
                xuid: onlinePlayer.xuid,
                name: onlinePlayer.name
            });
        }
    });

    if (playerList.length === 0) {
        player.tell("§e[邮件] §c当前没有其他在线玩家！");
        showMailSystemForm(player);
        return;
    }

    const gui = mc.newCustomForm();
    gui.setTitle("§l§a发送邮件");
    gui.addLabel("§e发送邮件收费标准：");
    gui.addLabel("§c基础费用：100" + getCurrencyName());
    gui.addLabel("§c每添加一个附件：+200" + getCurrencyName());
    gui.addLabel("§e选择收件人：");
    gui.addDropdown("收件人", playerOptions, 0);
    gui.addLabel("§e请输入邮件内容：");
    gui.addInput("邮件内容", "请输入邮件内容", "");

    // 枚举背包物品
    const inventory = player.getInventory();
    const items = [];
    const slotCount = 36;

    for (let slot = 0; slot < slotCount; slot++) {
        try {
            const item = inventory.getItem(slot);
            if (!item) continue;
            const type = item.type;
            if (!type || type === '' || type === 'minecraft:air') continue;

            items.push({
                item: item,
                slot: slot,
                name: item.name,
                count: item.count,
                type: type,
                isEnchanted: item.isEnchanted,
                getNbt: function() {
                    return this.item.getNbt();
                }
            });
        } catch (error) {
            _deps.logger.error("[邮件系统] 获取槽位 " + slot + " 物品失败: " + error.message);
        }
    }

    const itemOptions = ["无"];
    items.forEach(function(item) {
        const Enchanted = '';
        if (item.isEnchanted) {
            Enchanted = '§d';
        }
        itemOptions.push(Enchanted + item.name + " §rx" + item.count);
    });

    gui.addLabel("§e选择附件物品（最多3个，不能重复选择同一物品）");
    gui.addDropdown("物品1", itemOptions, 0);
    gui.addDropdown("物品2", itemOptions, 0);
    gui.addDropdown("物品3", itemOptions, 0);

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const targetIndex = data[4];
        const target = playerList[targetIndex];
        if (!target) {
            p.tell("§e[邮件] §c收件人选择错误！");
            showPlayerSendMailForm(p);
            return;
        }

        const content = data[6] ? data[6].trim() : '';
        if (!content) {
            p.tell("§e[邮件] §c邮件内容不能为空！");
            showPlayerSendMailForm(p);
            return;
        }

        // 收集选中物品，用 Set 去重
        const selectedItems = [];
        const selectedIndices = new Set();

        for (let i = 8; i <= 10; i++) {
            const selectedIndex = data[i];
            if (selectedIndex > 0) {
                if (selectedIndices.has(selectedIndex)) {
                    p.tell("§e[邮件] §c不能重复选择同一物品作为附件！");
                    showPlayerSendMailForm(p);
                    return;
                }
                selectedIndices.add(selectedIndex);

                const item = items[selectedIndex - 1];
                if (item) {
                    selectedItems.push({
                        name: item.name,
                        count: item.count,
                        snbt: item.getNbt().toSNBT(),
                        slot: item.slot
                    });
                }
            }
        }

        // 计算费用：基础100 + 每个附件200
        const baseCost = 100;
        const attachmentCost = selectedItems.length * 200;
        const totalCost = baseCost + attachmentCost;

        const currentStarQian = _deps.money ? _deps.money.get(p.xuid) || 0 : 0;
        if (currentStarQian < totalCost) {
            p.tell("§e[邮件] §c" + getCurrencyName() + "不足！发送邮件需要 " + totalCost + " " + getCurrencyName() + "，您当前只有 " + currentStarQian + " " + getCurrencyName());
            showPlayerSendMailForm(p);
            return;
        }

        // 扣除货币
        if (_deps.money) {
            if (!_deps.money.reduce(p.xuid, totalCost)) {
                p.tell("§e[邮件] §c扣除" + getCurrencyName() + "失败！");
                showPlayerSendMailForm(p);
                return;
            }
        }
        if (_deps.notifyEconomyChange) _deps.notifyEconomyChange(p, -totalCost, "发送邮件");

        const itemsFormatted = selectedItems.map(function(item) {
            return {
                snbt: item.snbt,
                name: item.name,
                count: item.count
            };
        });

        mailData.mails.push({
            id: mailData.nextId++,
            fromXuid: p.xuid,
            fromName: p.name,
            toXuid: target.xuid,
            content: content,
            time: _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime(),
            read: false,
            starQian: 0,
            items: itemsFormatted,
            claimed: false
        });
        save();

        // 收件人在线时推送通知
        const targetPlayer = mc.getPlayer(target.xuid);
        if (targetPlayer) {
            const playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(target.xuid, "enableMailNotification") : true;
            if (playerSetting) {
                if (selectedItems.length > 0) {
                    targetPlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自玩家 §b" + p.name + " §a的邮件，内含附件");
                    targetPlayer.tell("§e[邮件] §a您收到了一封来自玩家 §b" + p.name + " §a的邮件，内含附件，请在邮件系统中领取");
                } else {
                    targetPlayer.sendToast("§e新邮件提醒", "§a您收到了一封来自玩家 §b" + p.name + " §a的私信");
                    targetPlayer.tell("§e[邮件] §a您收到了一封来自玩家 §b" + p.name + " §a的私信，请在邮件系统中查看");
                }
            }
        }

        // 通过 replaceitem 命令从发送者背包扣除物品
        selectedItems.forEach(function(selectedItem, idx) {
            try {
                const slotIndex = parseInt(selectedItem.slot);
                const count = parseInt(selectedItem.count);

                let slotType, replaceSlot;
                if (slotIndex <= 8) {
                    slotType = "slot.hotbar";
                    replaceSlot = slotIndex;
                } else {
                    slotType = "slot.inventory";
                    replaceSlot = slotIndex - 9;
                }

                const playerInventory = p.getInventory();
                const currentItem = playerInventory.getItem(slotIndex);

                if (!currentItem || currentItem.type === '' || currentItem.type === 'minecraft:air') {
                    _deps.logger.warn("[邮件系统] 槽位 " + slotIndex + " 没有物品");
                    return;
                }

                const currentCount = currentItem.count;

                // 物品全部移除时替换为空气，否则减少数量
                if (currentCount <= count) {
                    const cmd = 'replaceitem entity "' + p.name + '" ' + slotType + ' ' + replaceSlot + ' minecraft:air';
                    mc.runcmd(cmd);
                } else {
                    const newCount = currentCount - count;
                    const itemType = currentItem.type;
                    const cmd = 'replaceitem entity "' + p.name + '" ' + slotType + ' ' + replaceSlot + ' ' + itemType + ' ' + newCount;
                    mc.runcmd(cmd);
                }
            } catch (error) {
                _deps.logger.error("[邮件系统] 扣除物品失败：" + error.message);
            }
        });

        const hasAttachment = selectedItems.length > 0;
        const successForm = mc.newSimpleForm();
        successForm.setTitle("§l§a邮件发送成功");
        successForm.setContent("-------------------------\n§a邮件发送成功！" + (hasAttachment ? "（含附件）" : "") + "\n-------------------------\n§e邮件内容：\n" + content + "\n-------------------------\n§a发件人：§e" + p.name + "\n§a收件人：§e" + target.name + "\n§a附件物品：§e" + selectedItems.length + " 个\n§a发送时间：§e" + (_deps.U ? _deps.U.getCurrentTimeString() : formatMailTime()) + "\n-------------------------\n§c扣除" + getCurrencyName() + "：§e" + totalCost + " 点\n-------------------------\n");
        successForm.addButton("§b返回邮件系统", "textures/ui/recap_glyph_desaturated");
        successForm.addButton("§c关闭", "textures/ui/crossout");

        player.sendForm(successForm, function(p, id) {
            if (id === null || id === undefined) {
                return;
            }
            if (id === 0) {
                showMailSystemForm(p);
            }
        });
    });
}

/**
 * 普通玩家的邮件系统入口（无管理员功能）
 * @param {Player} player
 */
function showPlayerMailSystemForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§d邮件系统");

    let content = "-------------------------\n";
    content += "§e邮件系统功能：\n";
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton("§b查看邮件", "textures/ui/mail_icon");
    gui.addButton("§a发送邮件", "textures/ui/icon_book_writable");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showMailListForm(p);
        } else if (id === 1) {
            showPlayerSendMailForm(p);
        } else if (id === 2) {
            if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p);
        }
    });
}

module.exports = {
    init: init,
    getData: getData,
    save: save,
    addMail: addMail,
    deleteMail: deleteMail,
    getMailById: getMailById,
    getNextId: getNextId,
    incrementNextId: incrementNextId,
    formatMailTime: formatMailTime,
    getUnreadMailCount: getUnreadMailCount,
    getUnreadMailInfo: getUnreadMailInfo,
    checkScheduledMails: checkScheduledMails,
    showMailSystemForm: showMailSystemForm,
    showMailListForm: showMailListForm,
    showPlayerMailSystemForm: showPlayerMailSystemForm
};
