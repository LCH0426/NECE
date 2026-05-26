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
 * NLCE 好友与私信系统
 * 好友添加/删除/请求管理，玩家间私信发送与对话历史
 */


var C = require('./constants');
var U = require('./utils');
var D = require('./debug');

var friendDM = null;
var messageDM = null;
var friendData = {
    players: {}
};
var messageData = {
    players: {}
};
var _deps = {};

function parseTimeToNum(timeStr) {
    if (!timeStr) return 0;
    var parts = timeStr.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
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
    var d = new Date(timeStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

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

function saveData() {
    if (!friendData.players) friendData.players = {};
    friendDM.save(true);
    return true;
}

function saveMessageData() {
    if (!messageData.players) messageData.players = {};
    messageDM.save(true);
    return true;
}

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

function getPlayerMessageData(xuid) {
    if (!messageData.players[xuid]) {
        messageData.players[xuid] = {
            messages: []
        };
        saveMessageData();
    }
    return messageData.players[xuid];
}

function isPlayerFriend(xuid1, xuid2) {
    var fd = getPlayerFriendData(xuid1);
    return fd.friends.some(function(f) { return f.xuid === xuid2; });
}

function searchPlayers(keyword, searchType) {
    var results = [];
    var players = _deps.playerData || {};
    for (var xuid in players) {
        if (!players.hasOwnProperty(xuid)) continue;
        var info = players[xuid];
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

function sendMessage(fromXuid, fromName, toXuid, content) {
    var isFriend = isPlayerFriend(toXuid, fromXuid);
    if (!isFriend && _deps.getPlayerSetting && !_deps.getPlayerSetting(toXuid, "acceptStrangerMessages")) {
        var fromPlayer = mc.getPlayer(fromXuid);
        if (fromPlayer) {
            fromPlayer.tell("§c对方拒绝接受陌生人私信！");
        }
        return false;
    }

    var targetMessages = getPlayerMessageData(toXuid);
    targetMessages.messages.push({
        fromXuid: fromXuid,
        fromName: fromName,
        toXuid: toXuid,
        content: content,
        time: U.getCurrentTimeString(),
        read: false
    });

    var toPlayer = mc.getPlayer(toXuid);
    var toName = toPlayer ? toPlayer.name : (_deps.getPlayerInfoByXuid ? (_deps.getPlayerInfoByXuid(toXuid) || {}).name : null) || "未知玩家";

    var senderMessages = getPlayerMessageData(fromXuid);
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

    var targetPlayer = mc.getPlayer(toXuid);
    if (targetPlayer && _deps.getPlayerSetting && _deps.getPlayerSetting(toXuid, "enableMessageNotification")) {
        var relationType = isFriend ? "好友" : "陌生人";
        targetPlayer.sendToast("§e新消息提醒", "§a您收到了一条来自" + relationType + " §b" + fromName + " §a的私信");
        targetPlayer.tell("§e[私信] §a您收到了一条来自" + relationType + " §b" + fromName + " §a的私信，请在好友系统中查看");
    }
    return true;
}

function showSendMessageForm(player, toXuid, toName, page) {
    page = page || 0;
    var xuid = player.xuid;
    var gui = mc.newCustomForm();
    gui.setTitle("§l§b发送消息");

    var myMsgData = getPlayerMessageData(xuid);
    var chatHistory = [];

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

    chatHistory.sort(function(a, b) { return b.timeNum - a.timeNum; });

    var messagesPerPage = 5;
    var totalPages = Math.ceil(chatHistory.length / messagesPerPage) || 1;
    var currentPage = Math.min(page, totalPages - 1);
    var startIndex = currentPage * messagesPerPage;
    var endIndex = Math.min(startIndex + messagesPerPage, chatHistory.length);
    var pageMessages = chatHistory.slice(startIndex, endIndex);

    var historyContent = "-------------------------\n";
    historyContent += "§e与 §b" + toName + " §e的对话历史 (" + (currentPage + 1) + "/" + totalPages + ")\n";
    historyContent += "-------------------------\n";

    if (pageMessages.length === 0) {
        historyContent += "暂无对话历史\n";
    } else {
        pageMessages.forEach(function(msg) {
            var nameColor = msg.isSelf ? "§a" : "§b";
            historyContent += nameColor + msg.fromName + " " + msg.time + "\n";
            historyContent += "§f" + msg.content + "\n";
            historyContent += "-------------------------\n";
        });
    }

    gui.addLabel(historyContent);

    if (totalPages > 1) {
        var pageOptions = [];
        for (var i = 0; i < totalPages; i++) {
            pageOptions.push("第 " + (i + 1) + " 页");
        }
        gui.addDropdown("选择页码", pageOptions, currentPage);
    }

    gui.addInput("消息内容", "请输入消息内容", "");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            return;
        }

        var contentIndex = totalPages > 1 ? 2 : 1;
        var content = data[contentIndex] ? data[contentIndex].trim() : "";

        if (totalPages > 1) {
            var selectedPage = data[1];
            if (selectedPage !== currentPage) {
                showSendMessageForm(p, toXuid, toName, selectedPage);
                return;
            }
        }

        if (!content) {
            p.tell("§c消息内容不能为空！");
            showSendMessageForm(p, toXuid, toName, currentPage);
            return;
        }

        var success = sendMessage(p.xuid, p.name, toXuid, content);
        if (success) {
            p.tell("§a消息已发送给 " + toName + "！");
            showSendMessageForm(p, toXuid, toName, currentPage);
        } else {
            showSendMessageForm(p, toXuid, toName, currentPage);
        }
    });
}

function showMyMessagesForm(player) {
    var xuid = player.xuid;
    var msgData = getPlayerMessageData(xuid);

    var sortedMessages = msgData.messages.slice().sort(function(a, b) {
        return parseTimeToNum(b.time) - parseTimeToNum(a.time);
    });

    var playerMap = new Map();
    sortedMessages.forEach(function(msg) {
        var otherXuid = msg.fromXuid === xuid ? msg.toXuid : msg.fromXuid;
        var otherName = msg.fromXuid === xuid ? (msg.toName || "未知玩家") : msg.fromName;

        if (!playerMap.has(otherXuid)) {
            playerMap.set(otherXuid, {
                fromXuid: otherXuid,
                fromName: otherName,
                latestMsg: msg,
                unreadCount: 0
            });
        }
        if (!msg.read) {
            var msgPlayerData = playerMap.get(otherXuid);
            msgPlayerData.unreadCount++;
        }
    });

    var playerList = Array.from(playerMap.values()).sort(function(a, b) {
        return parseTimeToNum(b.latestMsg.time) - parseTimeToNum(a.latestMsg.time);
    });

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b我的消息");

    if (playerList.length === 0) {
        gui.setContent("暂无消息");
    } else {
        var totalUnread = sortedMessages.filter(function(m) { return !m.read; }).length;
        gui.setContent("§a共有 " + playerList.length + " 个对话\n§e未读消息: " + totalUnread + " 条\n点击对话查看详情");
        playerList.forEach(function(playerData) {
            var status = playerData.unreadCount > 0 ? "§e[" + playerData.unreadCount + "条新] " : "";
            var preview = playerData.latestMsg.content.length > 15 ?
                playerData.latestMsg.content.substring(0, 15) + "..." :
                playerData.latestMsg.content;
            var avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(playerData.fromXuid) : "";
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

function showConversationHistoryForm(player, targetXuid, targetName, page) {
    page = page || 0;
    var xuid = player.xuid;
    var msgData = getPlayerMessageData(xuid);

    var conversation = [];

    msgData.messages.forEach(function(msg) {
        if (msg.fromXuid === targetXuid) {
            conversation.push(Object.assign({}, msg, { isSelf: false, timeNum: parseTimeToNum(msg.time) }));
            msg.read = true;
        } else if (msg.fromXuid === xuid && msg.toXuid === targetXuid) {
            conversation.push(Object.assign({}, msg, { isSelf: true, timeNum: parseTimeToNum(msg.time) }));
        }
    });

    conversation.sort(function(a, b) { return b.timeNum - a.timeNum; });

    saveMessageData();

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b与 " + targetName + " 的对话");

    var messagesPerPage = 5;
    var totalPages = Math.ceil(conversation.length / messagesPerPage) || 1;
    var currentPage = Math.min(page, totalPages - 1);
    var startIndex = currentPage * messagesPerPage;
    var endIndex = Math.min(startIndex + messagesPerPage, conversation.length);
    var pageMessages = conversation.slice(startIndex, endIndex);

    var content = "-------------------------\n";
    content += "§e与 §b" + targetName + " §e的对话 (" + (currentPage + 1) + "/" + totalPages + ")\n";
    content += "-------------------------\n";

    if (conversation.length === 0) {
        content += "暂无对话历史\n";
    } else {
        pageMessages.forEach(function(msg) {
            var nameColor = msg.isSelf ? "§a" : "§b";
            var name = msg.isSelf ? "我" : msg.fromName;
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

        var btnIndex = 0;

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

function showMessageDetailForm(player, message) {
    message.read = true;
    saveMessageData();

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b消息详情");

    var content = "-------------------------\n";
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
            var msgData = getPlayerMessageData(p.xuid);
            msgData.messages = msgData.messages.filter(function(m) { return m !== message; });
            saveMessageData();
            p.tell("§c消息已删除");
            showMyMessagesForm(p);
        } else if (id === 2) {
            showMyMessagesForm(p);
        }
    });
}

function showMyFriendsForm(player) {
    var xuid = player.xuid;
    var friendInfo = getPlayerFriendData(xuid);
    var myFriends = friendInfo.friends;
    var pendingRequests = friendInfo.requests.filter(function(r) { return !r.handled; });
    var pendingCount = pendingRequests.length;

    var gui = mc.newSimpleForm();
    gui.setTitle("§b我的好友");

    var content = "-------------------------\n";
    content += "§a好友数量：§f" + myFriends.length + "\n";
    content += "§a待处理请求：§f" + pendingCount + "\n";
    content += "-------------------------\n";
    gui.setContent(content);

    gui.addButton("§e添加好友", "textures/ui/color_plus");
    gui.addButton("§d好友请求" + (pendingCount > 0 ? " §c(" + pendingCount + ")" : ""), "textures/ui/icon_bell");
    gui.addButton("§b我的消息", "textures/ui/icon_chat");

    if (myFriends.length > 0) {
        myFriends.forEach(function(friend) {
            var fi = _deps.getPlayerInfoByXuid ? _deps.getPlayerInfoByXuid(friend.xuid) : null;
            var onlineStatus = mc.getPlayer(friend.xuid) ? "§a[在线]" : "[离线]";
            var avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(friend.xuid) : "";
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

function showSearchFriendForm(player) {
    var gui = mc.newCustomForm();
    gui.setTitle("§l§b搜索好友");
    gui.addDropdown("搜索方式", ["玩家名称", "UID"], 0);
    gui.addInput("搜索关键词", "输入玩家名称或UID", "");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data) || data.length < 2) {
            showMyFriendsForm(p);
            return;
        }

        var searchType = data[0];
        var keyword = (data[1] || "").trim();

        if (!keyword) {
            p.tell("§c请输入搜索关键词！");
            showSearchFriendForm(p);
            return;
        }

        var results = searchPlayers(keyword, searchType);
        showSearchResultsForm(p, results, keyword);
    });
}

function showSearchResultsForm(player, results, keyword) {
    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b搜索结果");

    if (results.length === 0) {
        gui.setContent("§c未找到匹配 \"" + keyword + "\" 的玩家");
    } else {
        gui.setContent("§a找到 " + results.length + " 个匹配结果：\n点击玩家头像查看详情");
        results.forEach(function(p) {
            var avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(p.xuid) : "";
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

function showPlayerDetailForm(player, targetInfo) {
    var xuid = player.xuid;
    var myFriends = getPlayerFriendData(xuid);
    var isFriend = myFriends.friends.some(function(f) { return f.xuid === targetInfo.xuid; });
    var pendingRequest = myFriends.sentRequests.find(function(r) { return r.xuid === targetInfo.xuid && !r.handled; });
    var hasPendingRequest = !!pendingRequest;
    var wasRejected = myFriends.sentRequests.some(function(r) { return r.xuid === targetInfo.xuid && r.handled && r.rejected; });
    var isSelf = xuid === targetInfo.xuid;

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b" + targetInfo.name);

    var content = "-------------------------\n";
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

    if (!isSelf && !isFriend && !hasPendingRequest) {
        gui.addButton("§a添加好友", "textures/ui/color_plus");
    }
    if (!isSelf) {
        gui.addButton("§b发送留言", "textures/ui/Feedback");
    }
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        var btnIndex = 0;
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

function showSendFriendRequestForm(player, targetInfo) {
    var gui = mc.newCustomForm();
    gui.setTitle("§l§a发送好友请求");
    gui.addLabel("§e向 §b" + targetInfo.name + " §e发送好友请求");
    gui.addInput("验证消息", "请输入验证消息（可选）", "我是" + player.name);

    player.sendForm(gui, function(p, data) {
        if (data === null || !Array.isArray(data) || data.length < 2) {
            showPlayerDetailForm(p, targetInfo);
            return;
        }

        var message = (data[1] || "").trim() || ("我是" + p.name);

        if (_deps.getPlayerSetting && !_deps.getPlayerSetting(targetInfo.xuid, "allowFriendRequests")) {
            p.tell("§c对方拒绝接受好友请求！");
            showPlayerDetailForm(p, targetInfo);
            return;
        }

        var targetFriends = getPlayerFriendData(targetInfo.xuid);
        targetFriends.requests.push({
            xuid: p.xuid,
            name: p.name,
            message: message,
            time: U.getCurrentTimeString(),
            handled: false
        });

        var myFriends = getPlayerFriendData(p.xuid);
        myFriends.sentRequests.push({
            xuid: targetInfo.xuid,
            name: targetInfo.name,
            message: message,
            time: U.getCurrentTimeString(),
            handled: false
        });

        saveData();

        var targetPlayer = mc.getPlayer(targetInfo.xuid);
        if (targetPlayer && _deps.getPlayerSetting && _deps.getPlayerSetting(targetInfo.xuid, "enableFriendRequestNotification")) {
            targetPlayer.sendToast("§e好友请求", "§a玩家 §b" + p.name + " §a请求添加您为好友");
            targetPlayer.tell("§e[好友] §a玩家 §b" + p.name + " §a请求添加您为好友，请在好友系统中查看");
        }

        p.tell("§a已向 " + targetInfo.name + " 发送好友请求！");
        showMyFriendsForm(p);
    });
}

function showFriendRequestsForm(player) {
    var xuid = player.xuid;
    var friendInfo = getPlayerFriendData(xuid);
    var pendingRequests = friendInfo.requests.filter(function(r) { return !r.handled; });

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§e好友请求");

    if (pendingRequests.length === 0) {
        gui.setContent("暂无新的好友请求");
    } else {
        gui.setContent("§a您有 " + pendingRequests.length + " 个待处理的好友请求：");
        pendingRequests.forEach(function(req) {
            var avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(req.xuid) : "";
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

function showHandleRequestForm(player, request) {
    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b处理好友请求");

    var content = "-------------------------\n";
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

        var myFriends = getPlayerFriendData(p.xuid);
        var requestIndex = myFriends.requests.findIndex(function(r) { return r.xuid === request.xuid && !r.handled; });

        if (id === 0) {
            if (requestIndex !== -1) {
                myFriends.requests[requestIndex].handled = true;
                myFriends.friends.push({
                    xuid: request.xuid,
                    name: request.name,
                    addTime: U.getCurrentTimeString()
                });

                var targetFriends = getPlayerFriendData(request.xuid);
                targetFriends.friends.push({
                    xuid: p.xuid,
                    name: p.name,
                    addTime: U.getCurrentTimeString()
                });

                var sentIndex = targetFriends.sentRequests.findIndex(function(r) { return r.xuid === p.xuid && !r.handled; });
                if (sentIndex !== -1) {
                    targetFriends.sentRequests[sentIndex].handled = true;
                }

                saveData();
                p.tell("§a已接受 " + request.name + " 的好友请求！");
            }
        } else if (id === 1) {
            if (requestIndex !== -1) {
                myFriends.requests[requestIndex].handled = true;

                var targetFriends2 = getPlayerFriendData(request.xuid);
                var sentIndex2 = targetFriends2.sentRequests.findIndex(function(r) { return r.xuid === p.xuid && !r.handled; });
                if (sentIndex2 !== -1) {
                    targetFriends2.sentRequests[sentIndex2].handled = true;
                    targetFriends2.sentRequests[sentIndex2].rejected = true;
                }

                saveData();
                p.tell("§c已拒绝 " + request.name + " 的好友请求");
            }
        }

        showFriendRequestsForm(p);
    });
}

function showFriendDetailForm(player, friend) {
    var fi = _deps.getPlayerInfoByXuid ? _deps.getPlayerInfoByXuid(friend.xuid) : null;
    var friendName = fi ? fi.name : "未知玩家";
    var friendUid = fi ? fi.uid : "未知";
    var isOnline = mc.getPlayer(friend.xuid);
    var onlineStatus = isOnline ? "§a在线" : "离线";

    var gui = mc.newSimpleForm();
    gui.setTitle("§l§b" + friendName);

    var content = "-------------------------\n";
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

function showDeleteFriendConfirmForm(player, friend) {
    var fi = _deps.getPlayerInfoByXuid ? _deps.getPlayerInfoByXuid(friend.xuid) : null;
    var friendName = fi ? fi.name : "未知玩家";

    player.sendModalForm(
        "§c删除好友",
        "§c确定要删除好友 §f" + friendName + " §c吗？\n此操作不可恢复！",
        "§c确认删除",
        "§a取消",
        function(p, res) {
            if (res) {
                var myFriends = getPlayerFriendData(p.xuid);
                myFriends.friends = myFriends.friends.filter(function(f) { return f.xuid !== friend.xuid; });

                var targetFriends = getPlayerFriendData(friend.xuid);
                targetFriends.friends = targetFriends.friends.filter(function(f) { return f.xuid !== p.xuid; });

                saveData();
                p.tell("§c已删除好友 " + friendName);
            }
            showMyFriendsForm(p);
        }
    );
}

function getPendingRequestCount(xuid) {
    var friendInfo = getPlayerFriendData(xuid);
    return friendInfo.requests.filter(function(r) { return !r.handled; }).length;
}

function getUnreadMessageCount(xuid) {
    var msgData = getPlayerMessageData(xuid);
    return msgData.messages.filter(function(m) { return !m.read; }).length;
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
    sendMessage: sendMessage
};
