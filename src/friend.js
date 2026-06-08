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
 * NECE 好友与私信系统
 * 好友添加/删除/请求管理，玩家间私信发送与对话历史
 * 数据通过 DataManager 持久化，支持陌生人私信开关和消息通知设置
 */


const C = require('./constants');
const U = require('./utils');
const D = require('./debug');

let friendDM = null;
let messageDM = null;
let friendData = {
    players: {}
};
let messageData = {
    players: {}
};
let _deps = {};

/**
 * 将时间字符串解析为时间戳数值，用于消息排序
 * 支持 "2026.05.27 14:30:00" 格式和标准 Date 可解析格式
 * @param {string} timeStr - 时间字符串
 * @returns {number} 毫秒时间戳，解析失败返回 0
 */
function parseTimeToNum(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (parts) {
        return new Date(
            parseInt(parts[1]),
            parseInt(parts[2]) - 1,
            parseInt(parts[3]),
            parseInt(parts[4]),
            parseInt(parts[5]),
            parseInt(parts[6])
        ).getTime();
    }
    const d = new Date(timeStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * 初始化好友与私信模块
 * @param {DataManager} fdm - 好友数据的 DataManager 实例
 * @param {DataManager} mdm - 私信数据的 DataManager 实例
 * @param {Object} deps - 外部依赖（playerData、getPlayerSetting 等）
 */
function init(fdm, mdm, deps) {
	D.debugLogModule('friend')('init: 初始化完成');
    friendDM = fdm;
    messageDM = mdm;
    _deps = deps || {};
    friendData = friendDM.load();
    if (!friendData.players) friendData.players = {};
    messageData = messageDM.load();
    if (!messageData.players) messageData.players = {};
}

/**
 * 发送系统邮件给指定玩家
 * @param {string} xuid - 收件人XUID
 * @param {string} content - 邮件内容
 */
function sendSystemMail(xuid, content) {
    var mailApi = _deps.mailApi;
    if (!mailApi || !mailApi.addMail) return;
    try {
        var mailId = mailApi.getNextId ? mailApi.getNextId() : Date.now();
        if (mailApi.incrementNextId) mailApi.incrementNextId();
        var timeStr = mailApi.formatMailTime ? mailApi.formatMailTime() : new Date().toLocaleString();
        mailApi.addMail({
            id: mailId,
            fromXuid: 'system',
            fromName: '系统',
            toXuid: String(xuid),
            content: content,
            time: timeStr,
            read: false,
            starQian: 0,
            items: [],
            claimed: false
        });
        try {
            var tp = mc.getPlayer(String(xuid));
            if (tp) {
                tp.sendToast('§e新邮件提醒', '§a您收到了一封系统邮件');
                tp.tell('§e[邮件] §a您收到了一封系统邮件，请在邮件系统中查看');
            }
        } catch (e) {}
    } catch (e) {}
}

/** 立即持久化好友数据到磁盘 */
function saveData() {
    if (!friendData.players) friendData.players = {};
    friendDM.save(true);
    return true;
}

/** 立即持久化私信数据到磁盘 */
function saveMessageData() {
    if (!messageData.players) messageData.players = {};
    messageDM.save(true);
    return true;
}

/**
 * 获取玩家的好友数据，不存在时自动初始化空结构并保存
 * @param {string} xuid - 玩家 XUID
 * @returns {{friends: Array, requests: Array, sentRequests: Array}}
 */
function getPlayerFriendData(xuid) {
    if (!friendData.players[xuid]) {
        friendData.players[xuid] = {
            friends: [],
            requests: [],
            sentRequests: []
        };
        saveData();
    }
    return friendData.players[xuid];
}

/**
 * 获取玩家的私信数据，不存在时自动初始化
 * @param {string} xuid - 玩家 XUID
 * @returns {{messages: Array}}
 */
function getPlayerMessageData(xuid) {
    if (!messageData.players[xuid]) {
        messageData.players[xuid] = {
            messages: []
        };
        saveMessageData();
    }
    return messageData.players[xuid];
}

/**
 * 判断两个玩家是否为好友关系
 * @param {string} xuid1 - 玩家1的 XUID
 * @param {string} xuid2 - 玩家2的 XUID
 * @returns {boolean}
 */
function isPlayerFriend(xuid1, xuid2) {
    const fd = getPlayerFriendData(xuid1);
    return fd.friends.some(function(f) { return f.xuid === xuid2; });
}

/**
 * 按名称或 UID 搜索玩家
 * @param {string} keyword - 搜索关键词
 * @param {number} searchType - 0 按名称模糊匹配，1 按 UID 精确匹配
 * @returns {Array} 匹配的玩家信息数组（含 xuid）
 */
function searchPlayers(keyword, searchType) {
    const results = [];
    const players = _deps.playerData || {};
    for (let xuid in players) {
        if (!players.hasOwnProperty(xuid)) continue;
        const info = players[xuid];
        if (searchType === 0) {
            if (info.name && info.name.toLowerCase().indexOf(keyword.toLowerCase()) !== -1) {
                results.push(Object.assign({ xuid: xuid }, info));
            }
        } else {
            if (info.uid && info.uid.toString() === keyword) {
                results.push(Object.assign({ xuid: xuid }, info));
            }
        }
    }
    return results;
}

/**
 * 发送私信给目标玩家
 * 会检查陌生人私信接收设置，双方均保存消息记录，目标在线时推送通知
 * @param {string} fromXuid - 发送者 XUID
 * @param {string} fromName - 发送者名称
 * @param {string} toXuid - 接收者 XUID
 * @param {string} content - 消息内容
 * @returns {boolean} 是否发送成功
 */
function sendMessage(fromXuid, fromName, toXuid, content) {
    const isFriend = isPlayerFriend(toXuid, fromXuid);
    // 非好友关系时检查接收者是否允许陌生人私信
    if (!isFriend && _deps.getPlayerSetting && !_deps.getPlayerSetting(toXuid, "acceptStrangerMessages")) {
        const fromPlayer = mc.getPlayer(fromXuid);
        if (fromPlayer) {
            fromPlayer.tell("§e[好友] §c对方拒绝接受陌生人私信！");
        }
        return false;
    }

    // 接收方消息记录（标记未读）
    const targetMessages = getPlayerMessageData(toXuid);
    targetMessages.messages.push({
        fromXuid: fromXuid,
        fromName: fromName,
        toXuid: toXuid,
        content: content,
        time: U.getCurrentTimeString(),
        read: false
    });

    // 解析接收者名称用于发送方记录
    const toPlayer = mc.getPlayer(toXuid);
    const toName = toPlayer ? toPlayer.name : (_deps.getPlayerInfoByXuid ? (_deps.getPlayerInfoByXuid(toXuid) || {}).name : null) || "未知玩家";

    // 发送方消息记录（标记已读）
    const senderMessages = getPlayerMessageData(fromXuid);
    senderMessages.messages.push({
        fromXuid: fromXuid,
        fromName: fromName,
        toXuid: toXuid,
        toName: toName,
        content: content,
        time: U.getCurrentTimeString(),
        read: true
    });

    saveMessageData();

    // 在线时推送 toast 通知
    const targetPlayer = mc.getPlayer(toXuid);
    if (targetPlayer && _deps.getPlayerSetting && _deps.getPlayerSetting(toXuid, "enableMessageNotification")) {
        const relationType = isFriend ? "好友" : "陌生人";
        targetPlayer.sendToast("§e新消息提醒", "§a您收到了一条来自" + relationType + " §b" + fromName + " §a的私信");
        targetPlayer.tell("§e[私信] §a您收到了一条来自" + relationType + " §b" + fromName + " §a的私信，请在好友系统中查看");
    }
    return true;
}

/**
 * 显示发送消息表单，含对话历史回溯和分页
 * @param {Player} player - 发送者玩家对象
 * @param {string} toXuid - 接收者 XUID
 * @param {string} toName - 接收者名称
 * @param {number} page - 当前页码（从0开始）
 */
function showSendMessageForm(player, toXuid, toName, page) {
    page = page || 0;
    const xuid = player.xuid;
    const gui = mc.newCustomForm();
    gui.setTitle("§l§b发送消息");

    // 筛选与目标玩家的双向消息，构建聊天历史
    const myMsgData = getPlayerMessageData(xuid);
    const chatHistory = [];

    myMsgData.messages.forEach(function(msg) {
        if (msg.fromXuid === xuid && msg.toXuid === toXuid) {
            chatHistory.push({
                fromName: "我",
                fromXuid: xuid,
                content: msg.content,
                time: msg.time,
                isSelf: true,
                timeNum: parseTimeToNum(msg.time)
            });
        } else if (msg.fromXuid === toXuid) {
            chatHistory.push({
                fromName: msg.fromName,
                fromXuid: msg.fromXuid,
                content: msg.content,
                time: msg.time,
                isSelf: false,
                timeNum: parseTimeToNum(msg.time)
            });
        }
    });

    // 按时间降序排列，最新的消息在前
    chatHistory.sort(function(a, b) { return b.timeNum - a.timeNum; });

    const messagesPerPage = 5;
    const totalPages = Math.ceil(chatHistory.length / messagesPerPage) || 1;
    const currentPage = Math.min(page, totalPages - 1);
    const startIndex = currentPage * messagesPerPage;
    const endIndex = Math.min(startIndex + messagesPerPage, chatHistory.length);
    const pageMessages = chatHistory.slice(startIndex, endIndex);

    let historyContent = "-------------------------\n";
    historyContent += "§e与 §b" + toName + " §e的对话历史 (" + (currentPage + 1) + "/" + totalPages + ")\n";
    historyContent += "-------------------------\n";

    if (pageMessages.length === 0) {
        historyContent += "暂无对话历史\n";
    } else {
        pageMessages.forEach(function(msg) {
            const nameColor = msg.isSelf ? "§a" : "§b";
            historyContent += nameColor + msg.fromName + " " + msg.time + "\n";
            historyContent += "§f" + msg.content + "\n";
            historyContent += "-------------------------\n";
        });
    }

    gui.addLabel(historyContent);

    if (totalPages > 1) {
        const pageOptions = [];
        for (let i = 0; i < totalPages; i++) {
            pageOptions.push("第 " + (i + 1) + " 页");
        }
        gui.addDropdown("选择页码", pageOptions, currentPage);
    }

    gui.addInput("消息内容", "请输入消息内容", "");

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data)) {
            return;
        }

        // 根据是否有分页下拉框，内容输入框的索引不同
        const contentIndex = totalPages > 1 ? 2 : 1;
        const content = data[contentIndex] ? data[contentIndex].trim() : "";

        if (totalPages > 1) {
            const selectedPage = data[1];
            if (selectedPage !== currentPage) {
                showSendMessageForm(p, toXuid, toName, selectedPage);
                return;
            }
        }

        if (!content) {
            p.tell("§e[好友] §c消息内容不能为空！");
            showSendMessageForm(p, toXuid, toName, currentPage);
            return;
        }

        const success = sendMessage(p.xuid, p.name, toXuid, content);
        if (success) {
            p.tell("§e[好友] §a消息已发送给 " + toName + "！");
            showSendMessageForm(p, toXuid, toName, currentPage);
        } else {
            showSendMessageForm(p, toXuid, toName, currentPage);
        }
    });
}

/**
 * 显示"我的消息"列表，按对话对象分组，显示未读数和最新消息预览
 * @param {Player} player
 */
function showMyMessagesForm(player) {
    const xuid = player.xuid;
    const msgData = getPlayerMessageData(xuid);

    // 按时间降序排列所有消息
    const sortedMessages = msgData.messages.slice().sort(function(a, b) {
        return parseTimeToNum(b.time) - parseTimeToNum(a.time);
    });

    // 按对话对方 XUID 分组，记录最新消息和未读计数
    const playerMap = new Map();
    sortedMessages.forEach(function(msg) {
        const otherXuid = msg.fromXuid === xuid ? msg.toXuid : msg.fromXuid;
        const otherName = msg.fromXuid === xuid ? (msg.toName || "未知玩家") : msg.fromName;

        if (!playerMap.has(otherXuid)) {
            playerMap.set(otherXuid, {
                fromXuid: otherXuid,
                fromName: otherName,
                latestMsg: msg,
                unreadCount: 0
            });
        }
        if (!msg.read) {
            const msgPlayerData = playerMap.get(otherXuid);
            msgPlayerData.unreadCount++;
        }
    });

    // 按最新消息时间降序排列对话列表
    const playerList = Array.from(playerMap.values()).sort(function(a, b) {
        return parseTimeToNum(b.latestMsg.time) - parseTimeToNum(a.latestMsg.time);
    });

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b我的消息");

    if (playerList.length === 0) {
        gui.setContent("暂无消息");
    } else {
        const totalUnread = sortedMessages.filter(function(m) { return !m.read; }).length;
        gui.setContent("§a共有 " + playerList.length + " 个对话\n§e未读消息: " + totalUnread + " 条\n点击对话查看详情");
        playerList.forEach(function(playerData) {
            const status = playerData.unreadCount > 0 ? "§e[" + playerData.unreadCount + "条新] " : "";
            // 消息预览截断到15字符
            const preview = playerData.latestMsg.content.length > 15 ?
                playerData.latestMsg.content.substring(0, 15) + "..." :
                playerData.latestMsg.content;
            const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(playerData.fromXuid) : "";
            gui.addButton(status + playerData.fromName + "\n§6" + playerData.latestMsg.time + ": " + preview, avatarUrl);
        });
    }

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id >= 0 && id < playerList.length) {
            showConversationHistoryForm(p, playerList[id].fromXuid, playerList[id].fromName);
        } else {
            if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p);
        }
    });
}

/**
 * 显示与指定玩家的对话历史，查看时自动标记对方消息为已读
 * @param {Player} player
 * @param {string} targetXuid - 对方 XUID
 * @param {string} targetName - 对方名称
 * @param {number} page - 页码（从0开始）
 */
function showConversationHistoryForm(player, targetXuid, targetName, page) {
    page = page || 0;
    const xuid = player.xuid;
    const msgData = getPlayerMessageData(xuid);

    const conversation = [];

    msgData.messages.forEach(function(msg) {
        if (msg.fromXuid === targetXuid) {
            conversation.push(Object.assign({}, msg, { isSelf: false, timeNum: parseTimeToNum(msg.time) }));
            msg.read = true;  // 查看时自动标记已读
        } else if (msg.fromXuid === xuid && msg.toXuid === targetXuid) {
            conversation.push(Object.assign({}, msg, { isSelf: true, timeNum: parseTimeToNum(msg.time) }));
        }
    });

    conversation.sort(function(a, b) { return b.timeNum - a.timeNum; });

    saveMessageData();

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b与 " + targetName + " 的对话");

    const messagesPerPage = 5;
    const totalPages = Math.ceil(conversation.length / messagesPerPage) || 1;
    const currentPage = Math.min(page, totalPages - 1);
    const startIndex = currentPage * messagesPerPage;
    const endIndex = Math.min(startIndex + messagesPerPage, conversation.length);
    const pageMessages = conversation.slice(startIndex, endIndex);

    let content = "-------------------------\n";
    content += "§e与 §b" + targetName + " §e的对话 (" + (currentPage + 1) + "/" + totalPages + ")\n";
    content += "-------------------------\n";

    if (conversation.length === 0) {
        content += "暂无对话历史\n";
    } else {
        pageMessages.forEach(function(msg) {
            const nameColor = msg.isSelf ? "§a" : "§b";
            const name = msg.isSelf ? "我" : msg.fromName;
            content += nameColor + name + " " + msg.time + "\n";
            content += "§f" + msg.content + "\n";
            content += "-------------------------\n";
        });
    }

    gui.setContent(content);

    if (currentPage < totalPages - 1) {
        gui.addButton("§e下一页", "textures/ui/arrow_down");
    }
    if (currentPage > 0) {
        gui.addButton("§e上一页", "textures/ui/arrow_up");
    }

    gui.addButton("§b发送消息", "textures/ui/backup_replace");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        // 按钮索引根据分页按钮的有无动态计算
        let btnIndex = 0;

        if (currentPage < totalPages - 1) {
            if (id === 0) {
                showConversationHistoryForm(p, targetXuid, targetName, currentPage + 1);
                return;
            }
            btnIndex++;
        }

        if (currentPage > 0) {
            if (id === btnIndex) {
                showConversationHistoryForm(p, targetXuid, targetName, currentPage - 1);
                return;
            }
            btnIndex++;
        }

        if (id === btnIndex) {
            showSendMessageForm(p, targetXuid, targetName);
        } else {
            showMyMessagesForm(p);
        }
    });
}

/**
 * 显示单条消息详情，支持回复和删除操作
 * @param {Player} player
 * @param {Object} message - 消息对象
 */
function showMessageDetailForm(player, message) {
    message.read = true;
    saveMessageData();

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b消息详情");

    let content = "-------------------------\n";
    content += "§a来自：§f" + message.fromName + "\n";
    content += "§a时间：§f" + message.time + "\n";
    content += "-------------------------\n";
    content += "§f" + message.content + "\n";
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton("§b回复", "textures/ui/icon_chat");
    gui.addButton("§c删除", "textures/ui/trash_default");
    gui.addButton("返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showSendMessageForm(p, message.fromXuid, message.fromName);
        } else if (id === 1) {
            // 通过引用比较删除特定消息对象
            const msgData = getPlayerMessageData(p.xuid);
            msgData.messages = msgData.messages.filter(function(m) { return m !== message; });
            saveMessageData();
            p.tell("§e[好友] §c消息已删除");
            showMyMessagesForm(p);
        } else if (id === 2) {
            showMyMessagesForm(p);
        }
    });
}

/**
 * 显示好友主界面，包含好友列表、待处理请求数量和在线状态
 * @param {Player} player
 */
function showMyFriendsForm(player) {
    const xuid = player.xuid;
    const friendInfo = getPlayerFriendData(xuid);
    const myFriends = friendInfo.friends;
    const pendingRequests = friendInfo.requests.filter(function(r) { return !r.handled; });
    const pendingCount = pendingRequests.length;

    const gui = mc.newSimpleForm();
    gui.setTitle("§b我的好友");

    let content = "-------------------------\n";
    content += "§a好友数量：§f" + myFriends.length + "\n";
    content += "§a待处理请求：§f" + pendingCount + "\n";
    content += "-------------------------\n";
    gui.setContent(content);

    gui.addButton("§e添加好友", "textures/ui/color_plus");
    gui.addButton("§d好友请求" + (pendingCount > 0 ? " §c(" + pendingCount + ")" : ""), "textures/ui/icon_bell");
    gui.addButton("§b我的消息", "textures/ui/Feedback");

    if (myFriends.length > 0) {
        myFriends.forEach(function(friend) {
            const fi = _deps.getPlayerInfoByXuid ? _deps.getPlayerInfoByXuid(friend.xuid) : null;
            const onlineStatus = mc.getPlayer(friend.xuid) ? "§a[在线]" : "[离线]";
            const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(friend.xuid) : "";
            gui.addButton(onlineStatus + " §b" + (fi ? fi.name : "未知玩家") + "\n§6UID: " + (fi ? fi.uid : "未知"), avatarUrl);
        });
    }

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showSearchFriendForm(p);
        } else if (id === 1) {
            showFriendRequestsForm(p);
        } else if (id === 2) {
            showMyMessagesForm(p);
        } else if (id >= 3 && myFriends.length > 0 && id < 3 + myFriends.length) {
            showFriendDetailForm(p, myFriends[id - 3]);
        } else {
            if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p);
        }
    });
}

/**
 * 显示搜索好友表单，支持按名称或 UID 搜索
 * @param {Player} player
 */
function showSearchFriendForm(player) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§b搜索好友");
    gui.addDropdown("搜索方式", ["玩家名称", "UID"], 0);
    gui.addInput("搜索关键词", "输入玩家名称或UID", "");

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data) || data.length < 2) {
            showMyFriendsForm(p);
            return;
        }

        const searchType = data[0];
        const keyword = (data[1] || "").trim();

        if (!keyword) {
            p.tell("§e[好友] §c请输入搜索关键词！");
            showSearchFriendForm(p);
            return;
        }

        const results = searchPlayers(keyword, searchType);
        showSearchResultsForm(p, results, keyword);
    });
}

/**
 * 显示搜索结果列表
 * @param {Player} player
 * @param {Array} results - 匹配的玩家数组
 * @param {string} keyword - 搜索关键词（用于空结果提示）
 */
function showSearchResultsForm(player, results, keyword) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b搜索结果");

    if (results.length === 0) {
        gui.setContent("§c未找到匹配 \"" + keyword + "\" 的玩家");
    } else {
        gui.setContent("§a找到 " + results.length + " 个匹配结果：\n点击玩家头像查看详情");
        results.forEach(function(p) {
            const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(p.xuid) : "";
            gui.addButton("§b" + p.name + "\n§6UID: " + p.uid, avatarUrl);
        });
    }

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id >= 0 && id < results.length) {
            showPlayerDetailForm(p, results[id]);
        } else {
            showSearchFriendForm(p);
        }
    });
}

/**
 * 显示目标玩家详情页，根据关系状态显示不同操作按钮
 * @param {Player} player
 * @param {Object} targetInfo - 目标玩家信息 {xuid, name, uid, registerTime}
 */
function showPlayerDetailForm(player, targetInfo) {
    const xuid = player.xuid;
    const myFriends = getPlayerFriendData(xuid);
    const isFriend = myFriends.friends.some(function(f) { return f.xuid === targetInfo.xuid; });
    const pendingRequest = myFriends.sentRequests.find(function(r) { return r.xuid === targetInfo.xuid && !r.handled; });
    const hasPendingRequest = !!pendingRequest;
    const wasRejected = myFriends.sentRequests.some(function(r) { return r.xuid === targetInfo.xuid && r.handled && r.rejected; });
    const isSelf = xuid === targetInfo.xuid;

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b" + targetInfo.name);

    let content = "-------------------------\n";
    content += "§a玩家名称：§f" + targetInfo.name + "\n";
    content += "§aUID：§f" + targetInfo.uid + "\n";
    content += "§a注册时间：§f" + (targetInfo.registerTime || "未知") + "\n";
    content += "-------------------------\n";

    if (isSelf) {
        content += "§c这是你自己\n";
    } else if (isFriend) {
        content += "§a你们已经是好友了\n";
    } else if (hasPendingRequest) {
        content += "§e好友请求已发送，等待对方处理\n";
    } else if (wasRejected) {
        content += "§c对方已拒绝您的好友请求\n";
    }

    gui.setContent(content);

    // 根据关系状态动态显示按钮
    if (!isSelf && !isFriend && !hasPendingRequest) {
        gui.addButton("§a添加好友", "textures/ui/color_plus");
    }
    if (!isSelf) {
        gui.addButton("§b发送留言", "textures/ui/Feedback");
    }
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        let btnIndex = 0;
        if (!isSelf && !isFriend && !hasPendingRequest) {
            if (id === 0) {
                showSendFriendRequestForm(p, targetInfo);
                return;
            }
            btnIndex = 1;
        }

        if (!isSelf && id === btnIndex) {
            showSendMessageForm(p, targetInfo.xuid, targetInfo.name);
        } else {
            showMyFriendsForm(p);
        }
    });
}

/**
 * 发送好友请求表单，附带验证消息
 * 同时在双方的请求记录中添加对应条目
 * @param {Player} player
 * @param {Object} targetInfo - 目标玩家信息
 */
function showSendFriendRequestForm(player, targetInfo) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§a发送好友请求");
    gui.addLabel("§e向 §b" + targetInfo.name + " §e发送好友请求");
    gui.addInput("验证消息", "请输入验证消息（可选）", "我是" + player.name);

    player.sendForm(gui, function(p, data) {
        if (data == null || !Array.isArray(data) || data.length < 2) {
            showPlayerDetailForm(p, targetInfo);
            return;
        }

        const message = (data[1] || "").trim() || ("我是" + p.name);

        // 检查对方是否允许接收好友请求
        if (_deps.getPlayerSetting && !_deps.getPlayerSetting(targetInfo.xuid, "allowFriendRequests")) {
            p.tell("§e[好友] §c对方拒绝接受好友请求！");
            showPlayerDetailForm(p, targetInfo);
            return;
        }

        // 在对方的收到请求列表中添加记录
        const targetFriends = getPlayerFriendData(targetInfo.xuid);
        targetFriends.requests.push({
            xuid: p.xuid,
            name: p.name,
            message: message,
            time: U.getCurrentTimeString(),
            handled: false
        });

        // 在自己的已发送请求列表中添加记录
        const myFriends = getPlayerFriendData(p.xuid);
        myFriends.sentRequests.push({
            xuid: targetInfo.xuid,
            name: targetInfo.name,
            message: message,
            time: U.getCurrentTimeString(),
            handled: false
        });

        saveData();

        // 对方在线时推送通知
        const targetPlayer = mc.getPlayer(targetInfo.xuid);
        if (targetPlayer && _deps.getPlayerSetting && _deps.getPlayerSetting(targetInfo.xuid, "enableFriendRequestNotification")) {
            targetPlayer.sendToast("§e好友请求", "§a玩家 §b" + p.name + " §a请求添加您为好友");
            targetPlayer.tell("§e[好友] §a玩家 §b" + p.name + " §a请求添加您为好友，请在好友系统中查看");
        }

        p.tell("§e[好友] §a已向 " + targetInfo.name + " 发送好友请求！");
        showMyFriendsForm(p);
    });
}

/**
 * 显示待处理的好友请求列表
 * @param {Player} player
 */
function showFriendRequestsForm(player) {
    const xuid = player.xuid;
    const friendInfo = getPlayerFriendData(xuid);
    const pendingRequests = friendInfo.requests.filter(function(r) { return !r.handled; });

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§e好友请求");

    if (pendingRequests.length === 0) {
        gui.setContent("暂无新的好友请求");
    } else {
        gui.setContent("§a您有 " + pendingRequests.length + " 个待处理的好友请求：");
        pendingRequests.forEach(function(req) {
            const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(req.xuid) : "";
            gui.addButton("§b" + req.name + "\n§6" + req.message, avatarUrl);
        });
    }

    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id >= 0 && id < pendingRequests.length) {
            showHandleRequestForm(p, pendingRequests[id]);
        } else {
            showMyFriendsForm(p);
        }
    });
}

/**
 * 处理单个好友请求：接受则双向添加好友，拒绝则标记已处理
 * @param {Player} player
 * @param {Object} request - 请求对象 {xuid, name, message, time}
 */
function showHandleRequestForm(player, request) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b处理好友请求");

    let content = "-------------------------\n";
    content += "§a来自：§f" + request.name + "\n";
    content += "§a验证消息：§f" + request.message + "\n";
    content += "§a时间：§f" + request.time + "\n";
    content += "-------------------------\n";
    content += "§e请选择操作：\n";

    gui.setContent(content);
    gui.addButton("§a接受", "textures/ui/check");
    gui.addButton("§c拒绝", "textures/ui/cancel");
    gui.addButton("返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        const myFriends = getPlayerFriendData(p.xuid);
        const requestIndex = myFriends.requests.findIndex(function(r) { return r.xuid === request.xuid && !r.handled; });

        if (id === 0) {
            // 接受：双向添加好友，彻底移除双方请求记录
            if (requestIndex !== -1) {
                myFriends.requests.splice(requestIndex, 1);
                myFriends.friends.push({
                    xuid: request.xuid,
                    name: request.name,
                    addTime: U.getCurrentTimeString()
                });

                const targetFriends = getPlayerFriendData(request.xuid);
                targetFriends.friends.push({
                    xuid: p.xuid,
                    name: p.name,
                    addTime: U.getCurrentTimeString()
                });

                // 彻底移除对方的已发送请求
                const sentIndex = targetFriends.sentRequests.findIndex(function(r) { return r.xuid === p.xuid; });
                if (sentIndex !== -1) {
                    targetFriends.sentRequests.splice(sentIndex, 1);
                }

                saveData();
                p.tell("§e[好友] §a已接受 " + request.name + " 的好友请求！");
            }
        } else if (id === 1) {
            // 拒绝：彻底移除请求记录
            if (requestIndex !== -1) {
                myFriends.requests.splice(requestIndex, 1);

                const targetFriends2 = getPlayerFriendData(request.xuid);
                const sentIndex2 = targetFriends2.sentRequests.findIndex(function(r) { return r.xuid === p.xuid; });
                if (sentIndex2 !== -1) {
                    targetFriends2.sentRequests.splice(sentIndex2, 1);
                }

                saveData();
                sendSystemMail(request.xuid, '§c玩家§e' + p.name + '§c拒绝了你的好友申请');
                p.tell("§e[好友] §c已拒绝 " + request.name + " 的好友请求");
            }
        }

        showFriendRequestsForm(p);
    });
}

/**
 * 显示好友详情页，可发送消息或删除好友
 * @param {Player} player
 * @param {Object} friend - 好友记录 {xuid, name, addTime}
 */
function showFriendDetailForm(player, friend) {
    const fi = _deps.getPlayerInfoByXuid ? _deps.getPlayerInfoByXuid(friend.xuid) : null;
    const friendName = fi ? fi.name : "未知玩家";
    const friendUid = fi ? fi.uid : "未知";
    const isOnline = mc.getPlayer(friend.xuid);
    const onlineStatus = isOnline ? "§a在线" : "离线";

    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b" + friendName);

    let content = "-------------------------\n";
    content += "§a好友名称：§f" + friendName + "\n";
    content += "§aUID：§f" + friendUid + "\n";
    content += "§a状态：" + onlineStatus + "\n";
    content += "§a添加时间：§f" + (friend.addTime || "未知") + "\n";
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton("§b发送消息", "textures/ui/backup_replace");
    gui.addButton("§c删除好友", "textures/ui/trash_default");
    gui.addButton("返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            showSendMessageForm(p, friend.xuid, friendName);
        } else if (id === 1) {
            showDeleteFriendConfirmForm(p, friend);
        } else if (id === 2) {
            showMyFriendsForm(p);
        }
    });
}

/**
 * 删除好友确认弹窗，双向删除好友关系
 * @param {Player} player
 * @param {Object} friend - 好友记录
 */
function showDeleteFriendConfirmForm(player, friend) {
    const fi = _deps.getPlayerInfoByXuid ? _deps.getPlayerInfoByXuid(friend.xuid) : null;
    const friendName = fi ? fi.name : "未知玩家";

    player.sendModalForm(
        "§c删除好友",
        "§c确定要删除好友 §f" + friendName + " §c吗？\n此操作不可恢复！",
        "§c确认删除",
        "§a取消",
        function(p, res) {
            if (res) {
                // 双向从好友列表中移除，并清理相关请求记录
                const myFriends = getPlayerFriendData(p.xuid);
                myFriends.friends = myFriends.friends.filter(function(f) { return f.xuid !== friend.xuid; });
                myFriends.requests = myFriends.requests.filter(function(r) { return r.xuid !== friend.xuid; });
                myFriends.sentRequests = myFriends.sentRequests.filter(function(r) { return r.xuid !== friend.xuid; });

                const targetFriends = getPlayerFriendData(friend.xuid);
                targetFriends.friends = targetFriends.friends.filter(function(f) { return f.xuid !== p.xuid; });
                targetFriends.requests = targetFriends.requests.filter(function(r) { return r.xuid !== p.xuid; });
                targetFriends.sentRequests = targetFriends.sentRequests.filter(function(r) { return r.xuid !== p.xuid; });

                saveData();
                p.tell("§e[好友] §c已删除好友 " + friendName);
            }
            showMyFriendsForm(p);
        }
    );
}

/**
 * 获取玩家未处理的好友请求数量（用于侧边栏/通知角标）
 * @param {string} xuid
 * @returns {number}
 */
function getPendingRequestCount(xuid) {
    const friendInfo = getPlayerFriendData(xuid);
    return friendInfo.requests.filter(function(r) { return !r.handled; }).length;
}

/**
 * 获取玩家未读私信数量
 * @param {string} xuid
 * @returns {number}
 */
function getUnreadMessageCount(xuid) {
    const msgData = getPlayerMessageData(xuid);
    return msgData.messages.filter(function(m) { return !m.read; }).length;
}

// ============ 头像系统（合并自 avatar.js） ============

/**
 * 获取玩家头像数据，首次访问时自动初始化为默认头像
 * @param {string} xuid - 玩家XUID
 * @returns {{ type: string, value: string }} 头像数据对象
 */
function getPlayerAvatarData(xuid) {
    let p = _deps.getPlayerData ? _deps.getPlayerData().players[xuid] : null;
    if (!p) return { type: "default", value: "" };
    if (!p.avatar) {
        p.avatar = { type: "default", value: "" };
        if (_deps.savePlayerData) _deps.savePlayerData();
    }
    return p.avatar;
}

/**
 * 根据头像类型生成完整的图片URL
 * @param {string} xuid - 玩家XUID
 * @returns {string} 头像URL或内置纹理路径
 */
function getPlayerAvatarUrl(xuid) {
    let avatar = getPlayerAvatarData(xuid);
    switch (avatar.type) {
        case "qq":
            return "http://q1.qlogo.cn/g?b=qq&nk=" + avatar.value + "&s=100";
        case "link":
            return avatar.value;
        case "citlalia":
            return "https://citlalia.cn/img/" + avatar.value;
        default:
            return "textures/ui/icon_steve";
    }
}

/**
 * 设置玩家头像类型和值
 * @param {string} xuid - 玩家XUID
 * @param {string} type - 头像类型（qq/link/citlalia）
 * @param {string} value - 头像值（QQ号/URL/图床ID）
 */
function setPlayerAvatar(xuid, type, value) {
    const p = _deps.getPlayerData ? _deps.getPlayerData().players[xuid] : null;
    if (!p) return;
    p.avatar = { type: type, value: value };
    if (_deps.savePlayerData) _deps.savePlayerData();
}

/**
 * 显示头像设置自定义表单
 * @param {Player} player - 玩家
 */
function showAvatarSettingsForm(player) {
    const xuid = player.xuid;
    const avatar = getPlayerAvatarData(xuid);

    const gui = mc.newCustomForm();
    gui.setTitle("§l§e个人头像设置");

    let content = "-------------------------\n";
    content += "§a当前头像类型：§f" + getAvatarTypeName(avatar.type) + "\n";
    content += "§a当前头像值：§f" + (avatar.value || "未设置") + "\n";
    content += "-------------------------\n";
    content += "§e请选择头像设置方式并输入对应值：\n";

    gui.addLabel(content);
    gui.addDropdown("头像类型", ["QQ头像", "自定义链接", "Citlalia头像码"],
        avatar.type === "qq" ? 0 : avatar.type === "link" ? 1 : avatar.type === "citlalia" ? 2 : 0);
    gui.addInput("头像值", "QQ号码/图片链接/头像码", avatar.value || "");

    player.sendForm(gui, function(p, data) {
        if (data == null || !Array.isArray(data)) {
            if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p);
            return;
        }

        let typeIndex = data[1] !== undefined ? data[1] : 0;
        const value = (data[2] || "").trim();

        if (!value) {
            p.tell("§e[头像] §c请输入头像值！");
            showAvatarSettingsForm(p);
            return;
        }

        let type, successMsg;
        if (typeIndex === 0) {
            if (!/^\d+$/.test(value)) {
                p.tell("§e[头像] §c请输入有效的QQ号码（纯数字）！");
                showAvatarSettingsForm(p);
                return;
            }
            type = "qq";
            successMsg = "§e[头像] §aQQ头像设置成功！";
        } else if (typeIndex === 1) {
            if (!value.startsWith("http")) {
                p.tell("§e[头像] §c请输入有效的图片链接（以http开头）！");
                showAvatarSettingsForm(p);
                return;
            }
            type = "link";
            successMsg = "§e[头像] §a自定义链接头像设置成功！";
        } else {
            type = "citlalia";
            successMsg = "§aCitlalia头像码设置成功！";
        }

        setPlayerAvatar(p.xuid, type, value);
        p.tell(successMsg);
        if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p);
    });
}

/** 将头像类型标识符转换为中文显示名称 */
function getAvatarTypeName(type) {
    switch (type) {
        case "qq": return "QQ头像";
        case "link": return "自定义链接";
        case "citlalia": return "Citlalia头像码";
        default: return "默认头像";
    }
}

module.exports = {
    init: init,
    getPlayerFriendData: getPlayerFriendData,
    isPlayerFriend: isPlayerFriend,
    showMyFriendsForm: showMyFriendsForm,
    showMyMessagesForm: showMyMessagesForm,
    showSendMessageForm: showSendMessageForm,
    getPendingRequestCount: getPendingRequestCount,
    getUnreadMessageCount: getUnreadMessageCount,
    searchPlayers: searchPlayers,
    sendMessage: sendMessage,
    // 头像系统
    getPlayerAvatarData: getPlayerAvatarData,
    getPlayerAvatarUrl: getPlayerAvatarUrl,
    setPlayerAvatar: setPlayerAvatar,
    showAvatarSettingsForm: showAvatarSettingsForm,
    getAvatarTypeName: getAvatarTypeName
};
