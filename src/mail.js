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
 * NECE 邮件系统
 * 管理员可群发/单发邮件（含货币和物品附件），玩家可查看和领取
 * 支持定时邮件（到时间自动激活并通知在线玩家），附件通过 SNBT 序列化物品数据
 */


const D = require('./debug');
let mailDM = null;
let mailData = null;
let _deps = {};
let t = null;

/**
 * 初始化邮件模块，加载邮件数据并确保数据结构完整
 * @param {DataManager} dm - 邮件数据的 DataManager 实例
 * @param {Object} deps - 外部依赖（money、U、getPlayerSetting 等）
 */
function init(dm, deps) {
    mailDM = dm;
    _deps = deps || {};
    t = _deps.t;
    D.debugLogModule('mail')(t(getSystemLang(), 'mail.log_init_complete'));
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

/** 获取货币显示名称 */
function getCurrencyName() {
    return _deps.getCurrencyName ? _deps.getCurrencyName() : t(getSystemLang(), 'mail.default_currency');
}

/**
 * 获取玩家语言设置
 * @param {string} xuid
 * @returns {string}
 */
function getLocale(xuid) {
    if (_deps.getPlayerSetting) {
        var locale = _deps.getPlayerSetting(xuid, 'locale');
        if (locale) return locale;
    }
    return _deps.getSystemLanguage ? _deps.getSystemLanguage() : 'zh_CN';
}

/**
 * 获取系统默认语言
 * @returns {string}
 */
function getSystemLang() {
    return _deps.getSystemLanguage ? _deps.getSystemLanguage() : 'zh_CN';
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
                const lang = getLocale(onlinePlayer.xuid);
                if (hasAttachment && playerSetting) {
                    onlinePlayer.sendToast(t(lang, 'mail.notify_title'), t(lang, 'mail.notify_attach_from', mail.fromName));
                    onlinePlayer.tell(t(lang, 'mail.tell_attach_from', mail.fromName));
                } else if (playerSetting) {
                    onlinePlayer.sendToast(t(lang, 'mail.notify_title'), t(lang, 'mail.notify_global_from', mail.fromName));
                    onlinePlayer.tell(t(lang, 'mail.tell_global_from', mail.fromName));
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
    const lang = getLocale(player.xuid);

    const gui = mc.newSimpleForm();
    gui.setTitle(t(lang, 'mail.scheduled_mgr_title'));

    if (scheduledMails.length === 0) {
        gui.setContent(t(lang, 'mail.no_scheduled'));
    } else {
        gui.setContent("-------------------------\n" + t(lang, 'mail.scheduled_count', scheduledMails.length) + "\n-------------------------\n");

        scheduledMails.forEach(function(mail, index) {
            const hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
            gui.addButton(t(lang, 'mail.scheduled_item', index + 1, mail.fromName, mail.scheduledTime, hasAttachment ? t(lang, 'mail.has_attach') : ""));
        });
    }

    gui.addButton(t(lang, 'mail.btn_back'), "textures/ui/recap_glyph_desaturated");

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
    const lang = getLocale(player.xuid);
    const gui = mc.newSimpleForm();
    gui.setTitle(t(lang, 'mail.scheduled_detail_title'));

    const hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
    let content = "------------------------\n";
    content += t(lang, 'mail.detail_sender', mail.fromName);
    content += t(lang, 'mail.scheduled_time_label', mail.scheduledTime);
    content += t(lang, 'mail.detail_content_label', mail.content);
    content += t(lang, 'mail.detail_currency_reward', getCurrencyName(), mail.starQian);
    content += t(lang, 'mail.detail_attach_count', mail.items ? mail.items.length : 0);
    content += t(lang, 'mail.detail_create_time', mail.time);
    content += "------------------------\n";

    gui.setContent(content);
    gui.addButton(t(lang, 'mail.btn_modify_scheduled'), "textures/ui/icon_recipe_equipment");
    gui.addButton(t(lang, 'mail.btn_delete_scheduled'), "textures/ui/cancel");
    gui.addButton(t(lang, 'mail.btn_back_list'), "textures/ui/arrow_left");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showModifyScheduledTimeForm(p, mail);
        } else if (id === 1) {
            mailData.mails = mailData.mails.filter(function(m) { return m.id !== mail.id; });
            save();
            p.tell(t(lang, 'mail.scheduled_deleted'));
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
    const lang = getLocale(player.xuid);
    const gui = mc.newCustomForm();
    gui.setTitle(t(lang, 'mail.modify_scheduled_title'));
    gui.addLabel(t(lang, 'mail.modify_scheduled_hint'));
    gui.addInput(t(lang, 'mail.scheduled_time_input'), t(lang, 'mail.scheduled_time_format'), mail.scheduledTime);

    player.sendForm(gui, function(p, data) {
        if (data == null) {
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
            p.tell(t(lang, 'mail.err_scheduled_format'));
            showModifyScheduledTimeForm(p, mail);
            return;
        }

        const parts = newScheduledTime.split(".").map(Number);
        const year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
        const scheduledDate = new Date(year, month - 1, day, hour, minute, 0);
        const now = new Date();

        if (scheduledDate <= now) {
            p.tell(t(lang, 'mail.err_scheduled_past'));
            showModifyScheduledTimeForm(p, mail);
            return;
        }

        mail.scheduledTime = newScheduledTime;
        save();
        p.tell(t(lang, 'mail.scheduled_modified'));
        showScheduledMailDetailForm(p, mail);
    });
}

/**
 * 邮件系统主入口，OP 看到管理员界面，普通玩家看到玩家界面
 * @param {Player} player
 */
function showMailSystemForm(player) {
    const isOp = player.isOP();
    const lang = getLocale(player.xuid);

    if (!isOp) {
        showPlayerMailSystemForm(player);
        return;
    }

    const gui = mc.newSimpleForm();
    gui.setTitle(t(lang, 'mail.system_title'));

    let content = "-------------------------\n";
    content += t(lang, 'mail.system_features');
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton(t(lang, 'mail.btn_view_mail'), "textures/ui/mail_icon");
    gui.addButton(t(lang, 'mail.btn_send_global'), "textures/ui/icon_book_writable");
    gui.addButton(t(lang, 'mail.btn_send_single'), "textures/ui/icon_book_writable");
    gui.addButton(t(lang, 'mail.btn_manage_scheduled'), "textures/ui/icon_setting");
    gui.addButton(t(lang, 'mail.btn_close'), "textures/ui/recap_glyph_desaturated");

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
    const lang = getLocale(xuid);
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
    gui.setTitle(t(lang, 'mail.my_mail_title'));

    const mailsPerPage = 5;
    const totalPages = Math.ceil(myMails.length / mailsPerPage) || 1;
    const currentPage = Math.min(page, totalPages - 1);
    const startIndex = currentPage * mailsPerPage;
    const endIndex = Math.min(startIndex + mailsPerPage, myMails.length);
    const pageMails = myMails.slice(startIndex, endIndex);

    if (myMails.length === 0) {
        gui.setContent(t(lang, 'mail.no_mail'));
    } else {
        gui.setContent(t(lang, 'mail.mail_count', myMails.length) + "\n" + t(lang, 'mail.current_page', currentPage + 1, totalPages));
        pageMails.forEach(function(mail) {
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
            const type = mail.toXuid === "all" ? t(lang, 'mail.type_global') : "";
            const icon = isUnread ? "textures/ui/invite_base" : "textures/ui/New_confirm_Hover";
            gui.addButton(t(lang, 'mail.mail_item', type, mail.fromName, mail.time), icon);
        });
    }

    if (currentPage < totalPages - 1) {
        gui.addButton(t(lang, 'mail.btn_next_page'), "textures/ui/arrowRight");
    }
    if (currentPage > 0) {
        gui.addButton(t(lang, 'mail.btn_prev_page'), "textures/ui/arrowLeft");
    }

    gui.addButton(t(lang, 'mail.btn_back'), "textures/ui/recap_glyph_desaturated");

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
    const lang = getLocale(xuid);

    // 标记已读：群发邮件用对象按 xuid 索引，私信直接布尔值
    if (mail.toXuid === "all") {
        if (!mail.read) mail.read = {};
        mail.read[xuid] = true;
    } else {
        mail.read = true;
    }
    save();

    const gui = mc.newSimpleForm();
    gui.setTitle(t(lang, 'mail.detail_title'));

    let content = "-------------------------\n";
    content += t(lang, 'mail.detail_sender', mail.fromName);
    content += t(lang, 'mail.detail_time', mail.time);
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
        content += t(lang, 'mail.detail_attach_content');
        if (mail.starQian && mail.starQian > 0) {
            content += t(lang, 'mail.detail_attach_currency', getCurrencyName(), mail.starQian);
        }
        if (mail.items && mail.items.length > 0) {
            mail.items.forEach(function(item, index) {
                // SNBT 类型物品：从序列化字符串中提取物品名称
                if (typeof item === 'object' && item.type === 'snbt' && item.snbt) {
                    const nameMatch = item.snbt.match(/"Name"\s*:\s*"([^"]+)"/);
                    const displayName = nameMatch ? nameMatch[1].replace('minecraft:', '') : t(lang, 'mail.snbt_item');
                    content += t(lang, 'mail.detail_attach_item', displayName);
                } else if (typeof item === 'object' && item.name) {
                    content += t(lang, 'mail.detail_attach_item_count', item.name, item.count || 1);
                } else {
                    content += t(lang, 'mail.detail_attach_item_index', index + 1);
                }
            });
        }
        if (isClaimed) {
            content += "-------------------------\n";
            content += t(lang, 'mail.claimed');
        }
        content += "-------------------------\n";
    }

    gui.setContent(content);

    if (hasAttachment && !isClaimed) {
        gui.addButton(t(lang, 'mail.btn_claim_attach'), "textures/ui/icon_map");
    }
    gui.addButton(t(lang, 'mail.btn_delete'), "textures/ui/trash_default");
    gui.addButton(t(lang, 'mail.btn_back'), "textures/ui/recap_glyph_desaturated");

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
            p.tell(t(lang, 'mail.mail_deleted'));
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
    const lang = getLocale(xuid);

    // 检查是否已领取
    let isClaimed = false;
    if (mail.toXuid === "all") {
        isClaimed = mail.claimed && mail.claimed[xuid];
    } else {
        isClaimed = mail.claimed;
    }

    if (isClaimed) {
        player.tell(t(lang, 'mail.err_already_claimed'));
        showMailDetailForm(player, mail);
        return;
    }

    // 发放货币奖励
    if (mail.starQian && mail.starQian > 0) {
        if (_deps.addPlayerMoney) {
            _deps.addPlayerMoney(player, mail.starQian, t(lang, 'mail.reason_claim_attach'));
            player.tell(t(lang, 'mail.claim_currency_success', mail.starQian, getCurrencyName()));
        } else {
            player.tell(t(lang, 'mail.err_economy_disabled', getCurrencyName()));
        }
    }

    // 发放物品附件
    let allItemsSuccess = true;
    if (mail.items && mail.items.length > 0) {
        mail.items.forEach(function(itemData, index) {
            try {
                const rawSnbt = typeof itemData === 'object' ? itemData.snbt : itemData;
                if (!rawSnbt || typeof rawSnbt !== 'string' || !rawSnbt.trim()) {
                    _deps.logger.error(t(getSystemLang(), 'mail.log_item_no_snbt', index + 1, typeof itemData));
                    player.tell(t(lang, 'mail.err_item_invalid', index + 1));
                    allItemsSuccess = false;
                    return;
                }
                const trimmedSnbt = rawSnbt.trim();

                // 多策略尝试解析 SNBT：处理不同的转义和格式变体
                let nbt = null;
                const strategies = [
                    trimmedSnbt,
                    trimmedSnbt.replace(/\\"/g, '"'),
                    trimmedSnbt.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1:'),
                    trimmedSnbt.replace(/\\"/g, '"').replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1:')
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
                                player.tell(t(lang, 'mail.inventory_full'));
                            }
                            player.tell(t(lang, 'mail.claim_item_success', fallbackItem.name));
                            return;
                        }
                    }
                    player.tell(t(lang, 'mail.err_snbt_parse', index + 1));
                    allItemsSuccess = false;
                    return;
                }
                const item = mc.newItem(nbt);
                if (item) {
                    if (player.getInventory().hasRoomFor(item)) {
                        player.giveItem(item);
                    } else {
                        mc.spawnItem(item, player.pos);
                        player.tell(t(lang, 'mail.inventory_full'));
                    }
                    player.tell(t(lang, 'mail.claim_item_success', item.name));
                } else {
                    player.tell(t(lang, 'mail.err_item_create', index + 1));
                    allItemsSuccess = false;
                }
            } catch (error) {
                _deps.logger.error(t(getSystemLang(), 'mail.log_grant_item_failed', error.message));
                player.tell(t(lang, 'mail.err_item_grant', index + 1));
                allItemsSuccess = false;
            }
        });
    }

    // 部分物品发放失败时不标记已领取，允许稍后重试
    if (!allItemsSuccess) {
        player.tell(t(lang, 'mail.err_partial_grant'));
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

    player.tell(t(lang, 'mail.claim_success'));
    showMailDetailForm(player, mail);
}

/**
 * 管理员发送全体邮件表单，支持货币附件、物品附件和定时发送
 * @param {Player} player - 管理员玩家
 */
function showSendGlobalMailForm(player) {
    const lang = getLocale(player.xuid);
    const gui = mc.newCustomForm();
    gui.setTitle(t(lang, 'mail.send_global_title'));
    gui.addLabel(t(lang, 'mail.send_global_hint'));
    gui.addSwitch(t(lang, 'mail.use_custom_sender'), false);
    gui.addInput(t(lang, 'mail.custom_sender'), t(lang, 'mail.custom_sender_placeholder'), "");
    gui.addInput(t(lang, 'mail.content_label'), t(lang, 'mail.content_placeholder'), "");
    gui.addInput(t(lang, 'mail.grant_currency', getCurrencyName()), t(lang, 'mail.grant_currency_placeholder'), "");
    gui.addInput(t(lang, 'mail.scheduled_send'), t(lang, 'mail.scheduled_send_format'), "");

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

    const itemOptions = [t(lang, 'mail.none')];
    items.forEach(function(item) {
        let Enchanted = '';
        if (item.isEnchanted) {
            Enchanted = '§d';
        }
        itemOptions.push(Enchanted + item.name + " §rx" + item.count);
    });

    gui.addLabel(t(lang, 'mail.select_attach_max5'));
    gui.addDropdown(t(lang, 'mail.item_num', 1), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 2), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 3), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 4), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 5), itemOptions, 0);

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const useCustomSender = data[1] || false;
        const customSender = data[2] ? data[2].trim() : '';

        const content = data[3] ? data[3].trim() : '';
        if (!content) {
            p.tell(t(lang, 'mail.err_empty_content'));
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
            p.tell(t(lang, 'mail.items_selected', selectedItems.length));
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
    const lang = getLocale(player.xuid);

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
            fromName = t(lang, 'mail.default_sender');
        }
    } else {
        fromName = t(lang, 'mail.admin_sender', player.name);
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
                player.tell(t(lang, 'mail.scheduled_set_success', scheduledTime, hasAttachment ? t(lang, 'mail.with_attach') : ""));

                // 显示发送成功确认表单
                const successForm = mc.newSimpleForm();
                successForm.setTitle(t(lang, 'mail.send_success_title'));
                successForm.setContent(t(lang, 'mail.send_success_content', hasAttachment ? t(lang, 'mail.with_attach') : "", content, fromName, getCurrencyName(), starQian, items.length, scheduledTime));
                successForm.addButton(t(lang, 'mail.btn_back_system'), "textures/ui/recap_glyph_desaturated");
                successForm.addButton(t(lang, 'mail.btn_close'), "textures/ui/crossout");

                player.sendForm(successForm, function(p, id) {
                    if (id === 0) {
                        showMailSystemForm(p);
                    }
                });
                return;
            } else {
                player.tell(t(lang, 'mail.err_scheduled_past'));
                showSendGlobalMailForm(player);
                return;
            }
        } else {
            player.tell(t(lang, 'mail.err_scheduled_format_detail'));
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

    // 通知所有在线玩家
    const onlinePlayers = mc.getOnlinePlayers();
    onlinePlayers.forEach(function(onlinePlayer) {
        if (onlinePlayer.xuid !== player.xuid) {
            const playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(onlinePlayer.xuid, "enableMailNotification") : true;
            const onlineLang = getLocale(onlinePlayer.xuid);
            if (hasAttachment && playerSetting) {
                onlinePlayer.sendToast(t(onlineLang, 'mail.notify_title'), t(onlineLang, 'mail.notify_attach_from', fromName));
                onlinePlayer.tell(t(onlineLang, 'mail.tell_attach_from', fromName));
            } else if (playerSetting) {
                onlinePlayer.sendToast(t(onlineLang, 'mail.notify_title'), t(onlineLang, 'mail.notify_global_from', fromName));
                onlinePlayer.tell(t(onlineLang, 'mail.tell_global_from', fromName));
            }
        }
    });

    if (!scheduledTime) {
        // 立即发送时显示成功确认表单
        const successForm = mc.newSimpleForm();
        successForm.setTitle(t(lang, 'mail.send_success_title'));
        successForm.setContent(t(lang, 'mail.send_success_content', hasAttachment ? t(lang, 'mail.with_attach') : "", content, fromName, getCurrencyName(), starQian, items.length, _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime()));
        successForm.addButton(t(lang, 'mail.btn_back_system'), "textures/ui/recap_glyph_desaturated");
        successForm.addButton(t(lang, 'mail.btn_close'), "textures/ui/crossout");

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
    const lang = getLocale(player.xuid);
    const gui = mc.newCustomForm();
    gui.setTitle(t(lang, 'mail.select_recipient'));
    gui.addDropdown(t(lang, 'mail.search_type'), [t(lang, 'mail.search_uid'), t(lang, 'mail.search_name')], 0);
    gui.addInput(t(lang, 'mail.search_keyword'), t(lang, 'mail.search_placeholder'), "");

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const searchType = data[0];
        const keyword = data[1] ? data[1].trim() : '';

        if (!keyword) {
            p.tell(t(lang, 'mail.err_empty_keyword'));
            showSearchPlayerForMailForm(p);
            return;
        }

        // 搜索类型与 searchPlayers 参数相反：0=UID -> searchType=1, 1=名称 -> searchType=0
        const results = _deps.searchPlayers ? _deps.searchPlayers(keyword, searchType === 1 ? 0 : 1) : [];
        if (results.length === 0) {
            p.tell(t(lang, 'mail.err_no_player'));
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
    const lang = getLocale(player.xuid);
    const gui = mc.newSimpleForm();
    gui.setTitle(t(lang, 'mail.select_recipient'));
    gui.setContent(t(lang, 'mail.multiple_results'));

    results.forEach(function(p) {
        const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(p.xuid) : "textures/ui/icon_steve";
        gui.addButton(t(lang, 'mail.player_item', p.name, p.uid), avatarUrl);
    });

    gui.addButton(t(lang, 'mail.btn_back'), "textures/ui/recap_glyph_desaturated");

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
    const lang = getLocale(player.xuid);
    const gui = mc.newCustomForm();
    gui.setTitle(t(lang, 'mail.send_single_title'));
    gui.addLabel(t(lang, 'mail.recipient_label', target.name));
    gui.addInput(t(lang, 'mail.content_label'), t(lang, 'mail.content_placeholder'), "");
    gui.addInput(t(lang, 'mail.grant_currency', getCurrencyName()), t(lang, 'mail.grant_currency_placeholder'), "");

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
            _deps.logger.error(t(getSystemLang(), 'mail.log_get_slot_failed', slot, error.message));
        }
    }

    const itemOptions = [t(lang, 'mail.none')];
    items.forEach(function(item) {
        let Enchanted = '';
        if (item.isEnchanted) {
            Enchanted = '§d';
        }
        itemOptions.push(Enchanted + item.name + " §rx" + item.count);
    });

    gui.addLabel(t(lang, 'mail.select_attach_max5'));
    gui.addDropdown(t(lang, 'mail.item_num', 1), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 2), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 3), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 4), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 5), itemOptions, 0);

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const content = data[1] ? data[1].trim() : '';
        if (!content) {
            p.tell(t(lang, 'mail.err_empty_content'));
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
            p.tell(t(lang, 'mail.items_selected', selectedItems.length));
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
    const lang = getLocale(player.xuid);
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
        fromName: t(lang, 'mail.admin_sender', player.name),
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
        const targetLang = getLocale(target.xuid);
        if (playerSetting) {
            if (hasAttachment) {
                targetPlayer.sendToast(t(targetLang, 'mail.notify_title'), t(targetLang, 'mail.notify_admin_attach', player.name));
                targetPlayer.tell(t(targetLang, 'mail.tell_admin_attach', player.name));
            } else {
                targetPlayer.sendToast(t(targetLang, 'mail.notify_title'), t(targetLang, 'mail.notify_admin_pm', player.name));
                targetPlayer.tell(t(targetLang, 'mail.tell_admin_pm', player.name));
            }
        }
    }

    player.tell(t(lang, 'mail.mail_sent_to', target.name, hasAttachment ? t(lang, 'mail.with_attach') : ""));
    showMailSystemForm(player);
}

/**
 * 玩家发送邮件表单，需消耗货币（基础100 + 每个附件200）
 * 发送后通过 replaceitem 命令从背包扣除对应物品
 * @param {Player} player - 发送者
 */
function showPlayerSendMailForm(player) {
    const lang = getLocale(player.xuid);
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
        player.sendModalForm(t(lang, 'mail.send_mail'), t(lang, 'mail.no_other_players'), t(lang, 'mail.btn_back'), t(lang, 'mail.btn_close'), function(p, result) {
            if (result) showMailSystemForm(p);
        });
        return;
    }

    const gui = mc.newCustomForm();
    gui.setTitle(t(lang, 'mail.send_mail_title'));
    gui.addLabel(t(lang, 'mail.fee_title'));
    gui.addLabel(t(lang, 'mail.fee_base', getCurrencyName()));
    gui.addLabel(t(lang, 'mail.fee_attach', getCurrencyName()));
    gui.addLabel(t(lang, 'mail.select_recipient_hint'));
    gui.addDropdown(t(lang, 'mail.recipient'), playerOptions, 0);
    gui.addLabel(t(lang, 'mail.content_hint'));
    gui.addInput(t(lang, 'mail.content_label'), t(lang, 'mail.content_placeholder'), "");

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
            _deps.logger.error(t(getSystemLang(), 'mail.log_get_slot_failed', slot, error.message));
        }
    }

    const itemOptions = [t(lang, 'mail.none')];
    items.forEach(function(item) {
        let Enchanted = '';
        if (item.isEnchanted) {
            Enchanted = '§d';
        }
        itemOptions.push(Enchanted + item.name + " §rx" + item.count);
    });

    gui.addLabel(t(lang, 'mail.select_attach_max3'));
    gui.addDropdown(t(lang, 'mail.item_num', 1), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 2), itemOptions, 0);
    gui.addDropdown(t(lang, 'mail.item_num', 3), itemOptions, 0);

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data)) {
            showMailSystemForm(p);
            return;
        }

        const targetIndex = data[4];
        const target = playerList[targetIndex];
        if (!target) {
            p.tell(t(lang, 'mail.err_recipient'));
            showPlayerSendMailForm(p);
            return;
        }

        const content = data[6] ? data[6].trim() : '';
        if (!content) {
            p.tell(t(lang, 'mail.err_empty_content'));
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
                    p.tell(t(lang, 'mail.err_duplicate_item'));
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
            p.tell(t(lang, 'mail.err_insufficient', getCurrencyName(), totalCost, currentStarQian));
            showPlayerSendMailForm(p);
            return;
        }

        // 扣除货币
        if (_deps.reducePlayerMoney) {
            if (!_deps.reducePlayerMoney(p, totalCost, t(lang, 'mail.reason_send_attach'))) {
                p.tell(t(lang, 'mail.err_deduct_failed', getCurrencyName()));
                showPlayerSendMailForm(p);
                return;
            }
        }

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
            const targetLang = getLocale(target.xuid);
            if (playerSetting) {
                if (selectedItems.length > 0) {
                    targetPlayer.sendToast(t(targetLang, 'mail.notify_title'), t(targetLang, 'mail.notify_player_attach', p.name));
                    targetPlayer.tell(t(targetLang, 'mail.tell_player_attach', p.name));
                } else {
                    targetPlayer.sendToast(t(targetLang, 'mail.notify_title'), t(targetLang, 'mail.notify_player_pm', p.name));
                    targetPlayer.tell(t(targetLang, 'mail.tell_player_pm', p.name));
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
                    _deps.logger.warn(t(getSystemLang(), 'mail.log_slot_empty', slotIndex));
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
                _deps.logger.error(t(getSystemLang(), 'mail.log_deduct_item_failed', error.message));
            }
        });

        const hasAttachment = selectedItems.length > 0;
        const successForm = mc.newSimpleForm();
        successForm.setTitle(t(lang, 'mail.send_success_title'));
        successForm.setContent(t(lang, 'mail.player_send_success', hasAttachment ? t(lang, 'mail.with_attach') : "", content, p.name, target.name, selectedItems.length, _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime(), getCurrencyName(), totalCost));
        successForm.addButton(t(lang, 'mail.btn_back_system'), "textures/ui/recap_glyph_desaturated");
        successForm.addButton(t(lang, 'mail.btn_close'), "textures/ui/crossout");

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
    const lang = getLocale(player.xuid);
    const gui = mc.newSimpleForm();
    gui.setTitle(t(lang, 'mail.system_title'));

    let content = "-------------------------\n";
    content += t(lang, 'mail.system_features');
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton(t(lang, 'mail.btn_view_mail'), "textures/ui/mail_icon");
    gui.addButton(t(lang, 'mail.btn_send_mail'), "textures/ui/icon_book_writable");
    gui.addButton(t(lang, 'mail.btn_close'), "textures/ui/cancel");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showMailListForm(p);
        } else if (id === 1) {
            showPlayerSendMailForm(p);
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
