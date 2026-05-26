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

var mailDM = null;
var mailData = null;
var _deps = {};

function init(dm, deps) {
    mailDM = dm;
    _deps = deps || {};
    mailData = mailDM.load();
    if (!mailData.mails) mailData.mails = [];
    if (!mailData.nextId) mailData.nextId = 1;
}

function getData() {
    return mailData;
}

function save() {
    if (mailDM) {
        mailDM.save();
    }
}

function addMail(mail) {
    mailData.mails.push(mail);
    save();
}

function deleteMail(mailId) {
    var index = mailData.mails.findIndex(function(m) { return m.id === mailId; });
    if (index === -1) return false;
    mailData.mails.splice(index, 1);
    save();
    return true;
}

function getMailById(mailId) {
    return mailData.mails.find(function(m) { return m.id === mailId; }) || null;
}

function getNextId() {
    return mailData.nextId;
}

function incrementNextId() {
    mailData.nextId++;
    save();
}

function formatMailTime() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hour = String(now.getHours()).padStart(2, '0');
    var minute = String(now.getMinutes()).padStart(2, '0');
    var second = String(now.getSeconds()).padStart(2, '0');
    return year + '.' + month + '.' + day + '.' + hour + '.' + minute + '.' + second;
}

function getCurrencyName() {
    return _deps.getCurrencyName ? _deps.getCurrencyName() : '星茜';
}

function getUnreadMailCount(xuid) {
    if (!mailData || !mailData.mails) return 0;
    return mailData.mails.filter(function(m) {
        if (m.scheduledTime) return false;
        if (m.toXuid === xuid) {
            return !m.read;
        } else if (m.toXuid === "all") {
            return !m.read || !m.read[xuid];
        }
        return false;
    }).length;
}

function getUnreadMailInfo(xuid) {
    if (!mailData || !mailData.mails) return { count: 0, attachmentCount: 0, normalCount: 0 };
    var myMails = mailData.mails.filter(function(m) {
        if (m.scheduledTime) return false;
        if (m.toXuid === xuid) {
            return !m.read;
        } else if (m.toXuid === "all") {
            return !m.read || !m.read[xuid];
        }
        return false;
    });
    var attachmentMails = myMails.filter(function(m) { return (m.starQian && m.starQian > 0) || (m.items && m.items.length > 0); });
    var normalMails = myMails.filter(function(m) { return !((m.starQian && m.starQian > 0) || (m.items && m.items.length > 0)); });
    return {
        count: myMails.length,
        attachmentCount: attachmentMails.length,
        normalCount: normalMails.length
    };
}

function checkScheduledMails() {
    var now = new Date();
    var currentTimeStr = _deps.U ? _deps.U.getCurrentTimeString() : formatMailTime();

    var scheduledMails = mailData.mails.filter(function(mail) { return mail.scheduledTime; });
    var needSave = false;

    scheduledMails.forEach(function(mail) {
        var parts = mail.scheduledTime.split('.').map(Number);
        var year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
        var scheduledDate = new Date(year, month - 1, day, hour, minute, 0);

        if (now >= scheduledDate) {
            mail.time = currentTimeStr;
            delete mail.scheduledTime;
            needSave = true;

            var hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
            var onlinePlayers = mc.getOnlinePlayers();
            onlinePlayers.forEach(function(onlinePlayer) {
                var playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(onlinePlayer.xuid, "enableMailNotification") : true;
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

function showScheduledMailManagerForm(player) {
    var scheduledMails = mailData.mails.filter(function(mail) { return mail.scheduledTime; });

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§6定时邮件管理");

    if (scheduledMails.length === 0) {
        gui.setContent("§c暂无定时邮件");
    } else {
        gui.setContent("§7-------------------------\n§a定时邮件数量：§f" + scheduledMails.length + "\n§7-------------------------\n");

        scheduledMails.forEach(function(mail, index) {
            var hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
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

function showScheduledMailDetailForm(player, mail) {
    var gui = mc.newSimpleForm();
    gui.setTitle("§l§6定时邮件详情");

    var hasAttachment = mail.starQian > 0 || (mail.items && mail.items.length > 0);
    var content = "§7------------------------\n";
    content += "§a发送者：§f" + mail.fromName + "\n";
    content += "§a定时时间：§f" + mail.scheduledTime + "\n";
    content += "§a邮件内容：\n§f" + mail.content + "\n";
    content += "§a" + getCurrencyName() + "奖励：§f" + mail.starQian + " 点\n";
    content += "§a附件物品：§f" + (mail.items ? mail.items.length : 0) + " 个\n";
    content += "§a创建时间：§f" + mail.time + "\n";
    content += "§7------------------------\n";

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
            p.tell("§a定时邮件删除成功！");
            showScheduledMailManagerForm(p);
        } else {
            showScheduledMailManagerForm(p);
        }
    });
}

function showModifyScheduledTimeForm(player, mail) {
    var gui = mc.newCustomForm();
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

        var newScheduledTime = (data && data[1]) ? data[1].trim() : '';
        if (!newScheduledTime || !/^\d{4}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(newScheduledTime)) {
            p.tell("§c定时时间格式错误！");
            showModifyScheduledTimeForm(p, mail);
            return;
        }

        var parts = newScheduledTime.split(".").map(Number);
        var year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
        var scheduledDate = new Date(year, month - 1, day, hour, minute, 0);
        var now = new Date();

        if (scheduledDate <= now) {
            p.tell("§c定时时间必须晚于当前时间！");
            showModifyScheduledTimeForm(p, mail);
            return;
        }

        mail.scheduledTime = newScheduledTime;
        save();
        p.tell("§a定时时间修改成功！");
        showScheduledMailDetailForm(p, mail);
    });
}

function showMailSystemForm(player) {
    var isOp = player.isOP();

    if (!isOp) {
        showPlayerMailSystemForm(player);
        return;
    }

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§d邮件系统");

    var content = "-------------------------\n";
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

function showMailListForm(player, page) {
    page = page || 0;
    var xuid = player.xuid;
    var myMails = mailData.mails.filter(function(m) { return (m.toXuid === xuid || m.toXuid === "all") && !m.scheduledTime; });

    myMails.sort(function(a, b) {
        function parseTimeStr(timeStr) {
            var parts = timeStr.split('.').map(Number);
            return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
        }
        return parseTimeStr(b.time) - parseTimeStr(a.time);
    });

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b我的邮件");

    var mailsPerPage = 5;
    var totalPages = Math.ceil(myMails.length / mailsPerPage) || 1;
    var currentPage = Math.min(page, totalPages - 1);
    var startIndex = currentPage * mailsPerPage;
    var endIndex = Math.min(startIndex + mailsPerPage, myMails.length);
    var pageMails = myMails.slice(startIndex, endIndex);

    if (myMails.length === 0) {
        gui.setContent("暂无邮件");
    } else {
        gui.setContent("§a您共有 " + myMails.length + " 封邮件：\n§e当前页：" + (currentPage + 1) + "/" + totalPages);
        pageMails.forEach(function(mail) {
            var isUnread = false;
            if (mail.toXuid === "all") {
                if (!mail.read || !mail.read[xuid]) {
                    isUnread = true;
                }
            } else {
                if (!mail.read) {
                    isUnread = true;
                }
            }
            var type = mail.toXuid === "all" ? "[全体] " : "";
            var icon = isUnread ? "textures/ui/invite_base" : "textures/ui/New_confirm_Hover";
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

        var btnIndex = 0;
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

function showMailDetailForm(player, mail) {
    var xuid = player.xuid;

    if (mail.toXuid === "all") {
        if (!mail.read) mail.read = {};
        mail.read[xuid] = true;
    } else {
        mail.read = true;
    }
    save();

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b邮件详情");

    var content = "-------------------------\n";
    content += "§a发件人：§f" + mail.fromName + "\n";
    content += "§a时间：§f" + mail.time + "\n";
    content += "-------------------------\n";
    content += "§f" + mail.content + "\n";
    content += "-------------------------\n";

    var hasAttachment = (mail.starQian && mail.starQian > 0) || (mail.items && mail.items.length > 0);

    var isClaimed = false;
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
                if (typeof item === 'object' && item.type === 'snbt' && item.snbt) {
                    var nameMatch = item.snbt.match(/"Name"\s*:\s*"([^"]+)"/);
                    var displayName = nameMatch ? nameMatch[1].replace('minecraft:', '') : 'SNBT物品';
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

        var btnIndex = 0;
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
            p.tell("§c邮件已删除");
            showMailListForm(p);
        } else if (id === btnIndex + 1) {
            showMailListForm(p);
        }
    });
}

function claimMailAttachments(player, mail) {
    var xuid = player.xuid;

    var isClaimed = false;
    if (mail.toXuid === "all") {
        isClaimed = mail.claimed && mail.claimed[xuid];
    } else {
        isClaimed = mail.claimed;
    }

    if (isClaimed) {
        player.tell("§c您已经领取过该邮件的附件了！");
        showMailDetailForm(player, mail);
        return;
    }

    if (mail.starQian && mail.starQian > 0) {
        if (_deps.money) {
            _deps.money.add(xuid, mail.starQian);
            if (_deps.notifyEconomyChange) _deps.notifyEconomyChange(player, mail.starQian, "邮件领取");
            player.tell("§a成功领取 " + mail.starQian + " " + getCurrencyName() + "！");
        } else {
            player.tell("§c经济系统未启用，无法发放" + getCurrencyName() + "！");
        }
    }

    var allItemsSuccess = true;
    if (mail.items && mail.items.length > 0) {
        mail.items.forEach(function(itemData, index) {
            try {
                var rawSnbt = typeof itemData === 'object' ? itemData.snbt : itemData;
                if (!rawSnbt || typeof rawSnbt !== 'string' || !rawSnbt.trim()) {
                    _deps.logger.error("[邮件] 物品" + (index + 1) + "缺少有效的snbt数据，itemData类型: " + typeof itemData);
                    player.tell("§c物品 " + (index + 1) + " 数据无效！");
                    allItemsSuccess = false;
                    return;
                }
                var trimmedSnbt = rawSnbt.trim();

                var nbt = null;
                var strategies = [
                    trimmedSnbt,
                    trimmedSnbt.replace(/\\"/g, '"'),
                    trimmedSnbt.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1:'),
                    trimmedSnbt.replace(/\\"/g, '"').replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1:')
                ];
                for (var si = 0; si < strategies.length; si++) {
                    nbt = NBT.parseSNBT(strategies[si]);
                    if (nbt) {
                        break;
                    }
                }

                if (!nbt) {
                    var nameMatch = trimmedSnbt.match(/"?Name"?\s*:\s*"([^"]+)"/) || trimmedSnbt.match(/Name\s*:\s*([^,}\s]+)/);
                    var countMatch = trimmedSnbt.match(/"?Count"?\s*:\s*(\d+)/) || trimmedSnbt.match(/Count\s*:\s*(\d+)/);
                    if (nameMatch) {
                        var itemId = nameMatch[1];
                        var itemCount = countMatch ? parseInt(countMatch[1]) : 1;
                        var fallbackItem = mc.newItem(itemId, itemCount);
                        if (fallbackItem) {
                            if (player.getInventory().hasRoomFor(fallbackItem)) {
                                player.giveItem(fallbackItem);
                            } else {
                                mc.spawnItem(fallbackItem, player.pos);
                                player.tell("§e背包已满，物品已掉落在脚下！");
                            }
                            player.tell("§a成功领取 " + fallbackItem.name + "！");
                            return;
                        }
                    }
                    player.tell("§c物品 " + (index + 1) + " SNBT解析失败！");
                    allItemsSuccess = false;
                    return;
                }
                var item = mc.newItem(nbt);
                if (item) {
                    if (player.getInventory().hasRoomFor(item)) {
                        player.giveItem(item);
                    } else {
                        mc.spawnItem(item, player.pos);
                        player.tell("§e背包已满，物品已掉落在脚下！");
                    }
                    player.tell("§a成功领取 " + item.name + "！");
                } else {
                    player.tell("§c物品 " + (index + 1) + " 创建失败！");
                    allItemsSuccess = false;
                }
            } catch (error) {
                _deps.logger.error("发放邮件物品失败：" + error.message);
                player.tell("§c物品 " + (index + 1) + " 发放失败！");
                allItemsSuccess = false;
            }
        });
    }

    if (!allItemsSuccess) {
        player.tell("§c部分物品发放失败，请稍后重试！");
        showMailDetailForm(player, mail);
        return;
    }

    if (mail.toXuid === "all") {
        if (!mail.claimed) mail.claimed = {};
        mail.claimed[xuid] = true;
    } else {
        mail.claimed = true;
    }
    save();

    player.tell("§a附件领取成功！");
    showMailDetailForm(player, mail);
}

function showSendGlobalMailForm(player) {
    var gui = mc.newCustomForm();
    gui.setTitle("§l§a发送全体邮件");
    gui.addLabel("§e此邮件将发送给所有玩家");
    gui.addSwitch("使用自定义发件人", false);
    gui.addInput("自定义发件人", "不填则显示系统自动投递", "");
    gui.addInput("邮件内容", "请输入邮件内容", "");
    gui.addInput("发放" + getCurrencyName(), "填写数量，为空则不发放", "");
    gui.addInput("定时发送", "格式：2026.02.12.00（年月日时分），为空则立即发送", "");

    var allItems = player.getInventory().getAllItems();
    var items = [];

    for (var key = 0; key < allItems.length; key++) {
        if (allItems[key].type == '') {
            continue;
        }
        allItems[key].slot = key;
        items.push(allItems[key]);
    }

    var itemOptions = ["无"];
    items.forEach(function(item) {
        var Enchanted = '';
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
        if (data === null || data === undefined) {
            showMailSystemForm(p);
            return;
        }

        var useCustomSender = data[1] || false;
        var customSender = data[2] ? data[2].trim() : '';

        var content = data[3] ? data[3].trim() : '';
        if (!content) {
            p.tell("§c邮件内容不能为空！");
            showSendGlobalMailForm(p);
            return;
        }

        var starQianAmount = data[4] ? data[4].trim() : '';
        var starQian = starQianAmount && /^\d+$/.test(starQianAmount) ? parseInt(starQianAmount) : 0;

        var scheduledTime = data[5] ? data[5].trim() : '';

        var selectedItems = [];
        var selectedIndexSet = new Set();

        for (var i = 6; i <= 10; i++) {
            var selectedIndex = data[i];
            if (selectedIndex > 0 && !selectedIndexSet.has(selectedIndex)) {
                selectedIndexSet.add(selectedIndex);
                var item = items[selectedIndex - 1];
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
            p.tell("§a已选择 " + selectedItems.length + " 个物品！");
        }

        sendGlobalMail(p, content, starQian, selectedItems, scheduledTime, useCustomSender, customSender);
    });
}

function sendGlobalMail(player, content, starQian, selectedItems, scheduledTime, useCustomSender, customSender) {
    useCustomSender = useCustomSender || false;
    customSender = customSender || '';

    var items = selectedItems.map(function(item) {
        return {
            snbt: item.snbt,
            name: item.name,
            count: item.count
        };
    });
    var hasAttachment = starQian > 0 || items.length > 0;

    var fromName;
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
        if (/^\d{4}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(scheduledTime)) {
            var parts = scheduledTime.split(".").map(Number);
            var year = parts[0], month = parts[1], day = parts[2], hour = parts[3], minute = parts[4] || 0;
            var scheduledDate = new Date(year, month - 1, day, hour, minute, 0);
            var now = new Date();

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
                player.tell("§a定时邮件设置成功！将在 " + scheduledTime + " 发送" + (hasAttachment ? "（含附件）" : ""));

                var successForm = mc.newSimpleForm();
                successForm.setTitle("§l§a邮件发送成功");
                successForm.setContent("§7-------------------------\n§a邮件发送成功！" + (hasAttachment ? "（含附件）" : "") + "\n§7-------------------------\n§e邮件内容：\n" + content + "\n§7-------------------------\n§a发件人：§e" + fromName + "\n§a" + getCurrencyName() + "奖励：§e" + starQian + " 点\n§a附件物品：§e" + items.length + " 个\n§a定时发送：§e" + scheduledTime + "\n§7-------------------------\n");
                successForm.addButton("§b返回邮件系统", "textures/ui/recap_glyph_desaturated");
                successForm.addButton("§c关闭", "textures/ui/crossout");

                player.sendForm(successForm, function(p, id) {
                    if (id === 0) {
                        showMailSystemForm(p);
                    }
                });
                return;
            } else {
                player.tell("§c定时时间必须晚于当前时间！");
                showSendGlobalMailForm(player);
                return;
            }
        } else {
            player.tell("§c定时时间格式不正确！正确格式：2026.02.12.00");
            showSendGlobalMailForm(player);
            return;
        }
    }

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

    var onlinePlayers = mc.getOnlinePlayers();
    onlinePlayers.forEach(function(onlinePlayer) {
        if (onlinePlayer.xuid !== player.xuid) {
            var playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(onlinePlayer.xuid, "enableMailNotification") : true;
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
        var successForm = mc.newSimpleForm();
        successForm.setTitle("§l§a邮件发送成功");
        successForm.setContent("§7-------------------------\n§a邮件发送成功！" + (hasAttachment ? "（含附件）" : "") + "\n§7-------------------------\n§e邮件内容：\n" + content + "\n§7-------------------------\n§a发件人：§e" + fromName + "\n§a" + getCurrencyName() + "奖励：§e" + starQian + " 点\n§a附件物品：§e" + items.length + " 个\n§a发送时间：§e" + (_deps.U ? _deps.U.getCurrentTimeString() : formatMailTime()) + "\n§7-------------------------\n");
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

function showSearchPlayerForMailForm(player) {
    var gui = mc.newCustomForm();
    gui.setTitle("§l§e选择收件人");
    gui.addDropdown("搜索方式", ["UID", "玩家名称"], 0);
    gui.addInput("搜索关键词", "输入UID或玩家名称", "");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined) {
            showMailSystemForm(p);
            return;
        }

        var searchType = data[0];
        var keyword = data[1] ? data[1].trim() : '';

        if (!keyword) {
            p.tell("§c请输入搜索关键词！");
            showSearchPlayerForMailForm(p);
            return;
        }

        var results = _deps.searchPlayers ? _deps.searchPlayers(keyword, searchType === 1 ? 0 : 1) : [];
        if (results.length === 0) {
            p.tell("§c未找到匹配的玩家！");
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

function showMailTargetSelectForm(player, results) {
    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b选择收件人");
    gui.setContent("§e找到多个匹配结果，请选择：");

    results.forEach(function(p) {
        var avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(p.xuid) : "textures/ui/icon_steve";
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

function showSendSingleMailForm(player, target) {
    var gui = mc.newCustomForm();
    gui.setTitle("§l§e发送邮件");
    gui.addLabel("§e收件人：§b" + target.name);
    gui.addInput("邮件内容", "请输入邮件内容", "");
    gui.addInput("发放" + getCurrencyName(), "填写数量，为空则不发放", "");

    var inventory = player.getInventory();
    var items = [];
    var slotCount = 36;

    for (var slot = 0; slot < slotCount; slot++) {
        try {
            var item = inventory.getItem(slot);
            if (!item) continue;
            var type = item.type;
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

    var itemOptions = ["无"];
    items.forEach(function(item) {
        var Enchanted = '';
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
        if (data === null || data === undefined) {
            showMailSystemForm(p);
            return;
        }

        var content = data[1] ? data[1].trim() : '';
        if (!content) {
            p.tell("§c邮件内容不能为空！");
            showSendSingleMailForm(p, target);
            return;
        }

        var starQianAmount = data[2] ? data[2].trim() : '';
        var starQian = starQianAmount && /^\d+$/.test(starQianAmount) ? parseInt(starQianAmount) : 0;

        var selectedItems = [];
        var selectedIndexSet = new Set();

        for (var i = 4; i <= 8; i++) {
            var selectedIndex = data[i];
            if (selectedIndex > 0 && !selectedIndexSet.has(selectedIndex)) {
                selectedIndexSet.add(selectedIndex);
                var item = items[selectedIndex - 1];
                selectedItems.push({
                    name: item.name,
                    count: item.count,
                    snbt: item.getNbt().toSNBT()
                });
            }
        }

        if (selectedItems.length > 0) {
            p.tell("§a已选择 " + selectedItems.length + " 个物品！");
        }

        sendSingleMail(p, target, content, starQian, selectedItems);
    });
}

function sendSingleMail(player, target, content, starQian, selectedItems) {
    var items = selectedItems.map(function(item) {
        return {
            snbt: item.snbt,
            name: item.name,
            count: item.count
        };
    });
    var hasAttachment = starQian > 0 || items.length > 0;

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

    var targetPlayer = mc.getPlayer(target.xuid);
    if (targetPlayer) {
        var playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(target.xuid, "enableMailNotification") : true;
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

    player.tell("§a邮件已发送给 " + target.name + "！" + (hasAttachment ? "（含附件）" : ""));
    showMailSystemForm(player);
}

function showPlayerSendMailForm(player) {
    var onlinePlayers = mc.getOnlinePlayers();
    var playerOptions = [];
    var playerList = [];

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
        player.tell("§c当前没有其他在线玩家！");
        showMailSystemForm(player);
        return;
    }

    var gui = mc.newCustomForm();
    gui.setTitle("§l§a发送邮件");
    gui.addLabel("§e发送邮件收费标准：");
    gui.addLabel("§c基础费用：100" + getCurrencyName());
    gui.addLabel("§c每添加一个附件：+200" + getCurrencyName());
    gui.addLabel("§e选择收件人：");
    gui.addDropdown("收件人", playerOptions, 0);
    gui.addLabel("§e请输入邮件内容：");
    gui.addInput("邮件内容", "请输入邮件内容", "");

    var inventory = player.getInventory();
    var items = [];
    var slotCount = 36;

    for (var slot = 0; slot < slotCount; slot++) {
        try {
            var item = inventory.getItem(slot);
            if (!item) continue;
            var type = item.type;
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

    var itemOptions = ["无"];
    items.forEach(function(item) {
        var Enchanted = '';
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
        if (data === null || data === undefined) {
            showMailSystemForm(p);
            return;
        }

        var targetIndex = data[4];
        var target = playerList[targetIndex];
        if (!target) {
            p.tell("§c收件人选择错误！");
            showPlayerSendMailForm(p);
            return;
        }

        var content = data[6] ? data[6].trim() : '';
        if (!content) {
            p.tell("§c邮件内容不能为空！");
            showPlayerSendMailForm(p);
            return;
        }

        var selectedItems = [];
        var selectedIndices = new Set();

        for (var i = 8; i <= 10; i++) {
            var selectedIndex = data[i];
            if (selectedIndex > 0) {
                if (selectedIndices.has(selectedIndex)) {
                    p.tell("§c不能重复选择同一物品作为附件！");
                    showPlayerSendMailForm(p);
                    return;
                }
                selectedIndices.add(selectedIndex);

                var item = items[selectedIndex - 1];
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

        var baseCost = 100;
        var attachmentCost = selectedItems.length * 200;
        var totalCost = baseCost + attachmentCost;

        var currentStarQian = _deps.money ? _deps.money.get(p.xuid) || 0 : 0;
        if (currentStarQian < totalCost) {
            p.tell("§c" + getCurrencyName() + "不足！发送邮件需要 " + totalCost + " " + getCurrencyName() + "，您当前只有 " + currentStarQian + " " + getCurrencyName());
            showPlayerSendMailForm(p);
            return;
        }

        if (_deps.money) {
            if (!_deps.money.reduce(p.xuid, totalCost)) {
                p.tell("§c扣除" + getCurrencyName() + "失败！");
                showPlayerSendMailForm(p);
                return;
            }
        }
        if (_deps.notifyEconomyChange) _deps.notifyEconomyChange(p, -totalCost, "发送邮件");

        var itemsFormatted = selectedItems.map(function(item) {
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

        var targetPlayer = mc.getPlayer(target.xuid);
        if (targetPlayer) {
            var playerSetting = _deps.getPlayerSetting ? _deps.getPlayerSetting(target.xuid, "enableMailNotification") : true;
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

        selectedItems.forEach(function(selectedItem, idx) {
            try {
                var slotIndex = parseInt(selectedItem.slot);
                var count = parseInt(selectedItem.count);

                var slotType, replaceSlot;
                if (slotIndex <= 8) {
                    slotType = "slot.hotbar";
                    replaceSlot = slotIndex;
                } else {
                    slotType = "slot.inventory";
                    replaceSlot = slotIndex - 9;
                }

                var playerInventory = p.getInventory();
                var currentItem = playerInventory.getItem(slotIndex);

                if (!currentItem || currentItem.type === '' || currentItem.type === 'minecraft:air') {
                    _deps.logger.warn("[邮件系统] 槽位 " + slotIndex + " 没有物品");
                    return;
                }

                var currentCount = currentItem.count;

                if (currentCount <= count) {
                    var cmd = 'replaceitem entity "' + p.name + '" ' + slotType + ' ' + replaceSlot + ' minecraft:air';
                    mc.runcmd(cmd);
                } else {
                    var newCount = currentCount - count;
                    var itemType = currentItem.type;
                    var cmd = 'replaceitem entity "' + p.name + '" ' + slotType + ' ' + replaceSlot + ' ' + itemType + ' ' + newCount;
                    mc.runcmd(cmd);
                }
            } catch (error) {
                _deps.logger.error("[邮件系统] 扣除物品失败：" + error.message);
            }
        });

        var hasAttachment = selectedItems.length > 0;
        var successForm = mc.newSimpleForm();
        successForm.setTitle("§l§a邮件发送成功");
        successForm.setContent("§7-------------------------\n§a邮件发送成功！" + (hasAttachment ? "（含附件）" : "") + "\n§7-------------------------\n§e邮件内容：\n" + content + "\n§7-------------------------\n§a发件人：§e" + p.name + "\n§a收件人：§e" + target.name + "\n§a附件物品：§e" + selectedItems.length + " 个\n§a发送时间：§e" + (_deps.U ? _deps.U.getCurrentTimeString() : formatMailTime()) + "\n§7-------------------------\n§c扣除" + getCurrencyName() + "：§e" + totalCost + " 点\n§7-------------------------\n");
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

function showPlayerMailSystemForm(player) {
    var gui = mc.newSimpleForm();
    gui.setTitle("§l§d邮件系统");

    var content = "-------------------------\n";
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
