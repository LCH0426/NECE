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
 * NLCE 留言板系统
 * 玩家留言板的发布、查看和管理功能
 */


const C = require('./constants');
const U = require('./utils');
const D = require('./debug');

let messageBoardDM = null;
let messageBoardData = {
    messages: [],
    nextId: 1
};
const _onSaveCallbacks = [];

function init(dm) {
	D.debugLogModule('messageBoard')('init: 初始化完成');
    messageBoardDM = dm;
    messageBoardData = messageBoardDM.load();
    if (!Array.isArray(messageBoardData.messages)) messageBoardData.messages = [];
    if (typeof messageBoardData.nextId !== 'number') messageBoardData.nextId = 1;
    let needFix = false;
    messageBoardData.messages.forEach(function(msg) {
        if (typeof msg.isDeleted === 'undefined') {
            msg.isDeleted = false;
            needFix = true;
        }
        if (!msg.mood) {
            msg.mood = '平静';
            needFix = true;
        }
    });
    if (needFix) saveData();
}

function saveData() {
    if (!Array.isArray(messageBoardData.messages)) messageBoardData.messages = [];
    messageBoardDM.save();
    _onSaveCallbacks.forEach(function(cb) { try { cb(); } catch(e) {} });
    return true;
}

function getData() {
    return messageBoardData;
}

function showMainForm(player) {
    let xuid = player.xuid;
    const playerName = player.realName;
    let validMessages = (messageBoardData.messages || []).filter(function(m) { return !m.isDeleted; });
    let myMessages = validMessages.filter(function(m) { return m.xuid === xuid; });

    let fm = mc.newSimpleForm();
    fm.setTitle("§a留言板");
    fm.setContent("§6——————————————\n§f玩家ID：§a" + playerName + "\n§f服务器总留言数：§a" + messageBoardData.messages.length + " §f条（有效：§a" + validMessages.length + "§f条）\n§f我的有效留言数：§a" + myMessages.length + " §f条\n§6——————————————");

    fm.addButton("§a新增留言", "textures/ui/book_edit_hover.png");
    fm.addButton("§6我的留言", "textures/ui/comment");
    fm.addButton("§d所有留言", "textures/ui/world_glyph_color_2x");
    fm.addButton("§b随机留言", "textures/ui/recap_glyph_desaturated");
    fm.addButton("§c搜索留言", "textures/ui/magnifyingGlass");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        switch (id) {
            case 0: createAddMessageForm(pl); break;
            case 1: createMyMessagesForm(pl, 1); break;
            case 2: createAllMessagesForm(pl, 1); break;
            case 3: showRandomMessage(pl); break;
            case 4: createSearchMessageForm(pl); break;
        }
    });
}

function createAddMessageForm(player) {
    let fm = mc.newCustomForm();
    fm.setTitle("§6新增留言");
    fm.addInput("§f请输入留言内容（最多200字符）", "string", "");
    fm.addDropdown("§f选择心情", C.MOOD_OPTIONS, 0);

    player.sendForm(fm, function(pl, data) {
        if (data === null || !Array.isArray(data)) {
            showMainForm(pl);
            return;
        }
        let msg = String(data[0] || "").trim();
        const moodIndex = typeof data[1] === 'number' ? data[1] : 2;
        if (!msg || msg.length > 200) {
            pl.tell("§c[留言板] 留言内容不能为空且不能超过200字符！");
            createAddMessageForm(pl);
            return;
        }
        const device = pl.getDevice();
        const client = device ? device.os : "未知";
        const newMessage = {
            id: messageBoardData.nextId,
            xuid: pl.xuid,
            playerName: pl.realName,
            msg: msg,
            mood: C.MOOD_OPTIONS[moodIndex],
            time: U.getCurrentTimeString(),
            client: client,
            isDeleted: false
        };
        messageBoardData.messages.push(newMessage);
        messageBoardData.nextId++;
        if (saveData()) {
            pl.tell("§a[留言板] 留言发布成功！");
        }
        showMainForm(pl);
    });
}

function createMyMessagesForm(player, page) {
    let xuid = player.xuid;
    let pageSize = 10;
    const myMessages = messageBoardData.messages.filter(function(m) { return m.xuid === xuid && !m.isDeleted; }).reverse();
    let totalPages = Math.ceil(myMessages.length / pageSize) || 1;
    let startIndex = (page - 1) * pageSize;
    let pageMessages = myMessages.slice(startIndex, startIndex + pageSize);

    let fm = mc.newSimpleForm();
    fm.setTitle("§6我的留言");

    let content = "§f当前页：§a第 " + page + "/" + totalPages + " 页（每页" + pageSize + "条）\n";
    content += "§6——————————————\n";

    if (pageMessages.length === 0) {
        content += "§c你还没有发布任何留言～\n§a点击下方按钮发布第一条留言吧！";
    } else {
        pageMessages.forEach(function(msg) {
            content += "§6留言 #" + msg.id + "\n";
            content += "  §f心情：§a" + msg.mood + "\n";
            content += "  §f发布时间：§b" + msg.time + "\n";
            content += "  §f内容：" + msg.msg + "\n";
            content += "§6——————————————\n";
        });
    }

    fm.setContent(content);
    fm.addButton("§a新增留言", "textures/ui/book_edit_hover.png");
    if (page > 1) fm.addButton("§a上一页", "textures/ui/arrow_left");
    if (page < totalPages) fm.addButton("§a下一页", "textures/ui/arrow_right");
    fm.addButton("§c返回主表单", "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        let buttonIndex = 0;
        if (id === buttonIndex) { createAddMessageForm(pl); return; }
        buttonIndex++;
        if (page > 1) {
            if (id === buttonIndex) { createMyMessagesForm(pl, page - 1); return; }
            buttonIndex++;
        }
        if (page < totalPages) {
            if (id === buttonIndex) { createMyMessagesForm(pl, page + 1); return; }
            buttonIndex++;
        }
        if (id === buttonIndex) showMainForm(pl);
    });
}

function createAllMessagesForm(player, page) {
    let pageSize = 10;
    const allMessages = messageBoardData.messages.filter(function(m) { return !m.isDeleted; }).reverse();
    let totalPages = Math.ceil(allMessages.length / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const pageMessages = allMessages.slice(startIndex, startIndex + pageSize);
    const totalCount = messageBoardData.messages.length;
    const activeCount = allMessages.length;

    let fm = mc.newSimpleForm();
    fm.setTitle("§d所有留言");

    let content = "§f总留言数：§a" + totalCount + " 条（有效：§a" + activeCount + " 条）\n";
    content += "§f当前页：§a第 " + page + "/" + totalPages + " 页（每页" + pageSize + "条）\n";
    content += "§6——————————————\n";

    if (pageMessages.length === 0) {
        content += "§c当前页暂无留言\n";
    } else {
        pageMessages.forEach(function(msg) {
            content += "§6留言 #" + msg.id + "\n";
            content += "  §f作者：§a" + msg.playerName + " §f| 心情：§a" + msg.mood + "\n";
            content += "  §f来自 §b" + msg.client + " §f客户端\n";
            content += "  §f发布时间：§b" + msg.time + "\n";
            content += "  §f内容：" + msg.msg + "\n";
            content += "§6——————————————\n";
        });
    }

    fm.setContent(content);
    if (page > 1) fm.addButton("§a上一页", "textures/ui/arrow_left");
    if (page < totalPages) fm.addButton("§a下一页", "textures/ui/arrow_right");
    fm.addButton("§c返回主表单", "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        let buttonIndex = 0;
        if (page > 1) {
            if (id === buttonIndex) { createAllMessagesForm(pl, page - 1); return; }
            buttonIndex++;
        }
        if (page < totalPages) {
            if (id === buttonIndex) { createAllMessagesForm(pl, page + 1); return; }
            buttonIndex++;
        }
        if (id === buttonIndex) showMainForm(pl);
    });
}

function showMessageDetail(player, message) {
    const isOwnMessage = message.xuid === player.xuid;
    let content = "§6——————————————\n";
    content += "§f留言ID：§a" + message.id + "\n";
    content += "§f作者：§a" + message.playerName + "\n";
    content += "§f心情：§a" + message.mood + "\n";
    content += "§f发布时间：§b" + message.time + "\n";
    content += "§f客户端：§b" + message.client + "\n";
    content += "§6——————————————\n";
    content += "§f留言内容：\n§e" + message.msg + "\n";

    if (message.isDeleted) {
        content += "\n§6——————————————\n";
        content += "§c此留言已被删除\n";
        content += "§f删除前发布于：§b" + message.time + "\n";
        content += "§f删除前客户端：§b" + message.client + "\n";
    }

    let fm = mc.newSimpleForm();
    fm.setTitle("§b留言详情 #" + message.id);
    fm.setContent(content);
    if (isOwnMessage && !message.isDeleted) {
        fm.addButton("§c删除这条留言", "textures/ui/trash_default");
    }
    fm.addButton("§a返回主表单", "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        if (id === 0 && isOwnMessage && !message.isDeleted) {
            pl.sendModalForm(
                "§c确认删除",
                "§f确定要删除留言 #" + message.id + " 吗？\n§f删除后将无法恢复！",
                "§c删除",
                "§a取消", function(p, result) {
                    if (result === true) {
                        const msgIndex = messageBoardData.messages.findIndex(function(m) { return m.id === message.id; });
                        if (msgIndex !== -1) {
                            messageBoardData.messages[msgIndex].isDeleted = true;
                            if (saveData()) {
                                p.tell("§a[留言板] 留言 #" + message.id + " 已删除！");
                            }
                        }
                    }
                    showMainForm(p);
                });
        } else {
            showMainForm(pl);
        }
    });
}

function showRandomMessage(player) {
    const validMessages = messageBoardData.messages.filter(function(m) { return !m.isDeleted; });
    if (validMessages.length === 0) {
        player.tell("§c[留言板] 暂无有效留言！");
        showMainForm(player);
        return;
    }
    const randomIndex = Math.floor(Math.random() * validMessages.length);
    const randomMessage = validMessages[randomIndex];

    let fm = mc.newSimpleForm();
    fm.setTitle("§b随机留言 #" + randomMessage.id);

    let content = "§6——————————————\n";
    content += "§f留言ID：§a" + randomMessage.id + "\n";
    content += "§f作者：§a" + randomMessage.playerName + "\n";
    content += "§f心情：§a" + randomMessage.mood + "\n";
    content += "§f发布时间：§b" + randomMessage.time + "\n";
    content += "§f来自 §b" + randomMessage.client + "\n";
    content += "§6——————————————\n";
    content += "§f留言内容：\n§e" + randomMessage.msg + "\n";

    fm.setContent(content);
    fm.addButton("§a再随机一条");
    fm.addButton("§c返回主表单", "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        if (id === 0) showRandomMessage(pl);
        else showMainForm(pl);
    });
}

function createSearchMessageForm(player) {
    const fm = mc.newCustomForm();
    fm.setTitle("§c搜索留言");
    fm.addInput("§f请输入留言ID（数字）", "ID", "");

    player.sendForm(fm, function(pl, data) {
        if (data === null) {
            showMainForm(pl);
            return;
        }
        let input = String((Array.isArray(data) && data[0] !== undefined ? data[0] : "") || "").trim();
        if (input === "") return;
        const messageId = parseInt(input);
        if (isNaN(messageId) || messageId <= 0) {
            pl.tell("§c[留言板] 输入错误！请输入有效的数字ID！");
            createSearchMessageForm(pl);
            return;
        }
        const message = messageBoardData.messages.find(function(m) { return m.id === messageId; });
        if (!message) {
            pl.tell("§c[留言板] 未找到留言 #" + messageId + "！");
            createSearchMessageForm(pl);
            return;
        }
        showMessageDetail(pl, message);
    });
}

// ============ Web API 方法 (原 messageBoardApi) ============

function getMessages(options) {
    options = options || {};
    const page = Math.max(1, parseInt(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(options.pageSize) || 10));
    const search = (options.search || '').trim().toLowerCase();
    const mood = options.mood || '';
    const xuid = options.xuid || '';
    const includeDeleted = options.includeDeleted === true;

    const filtered = messageBoardData.messages.filter(function(m) {
        if (!includeDeleted && m.isDeleted) return false;
        if (xuid && m.xuid !== xuid) return false;
        if (mood && m.mood !== mood) return false;
        if (search) {
            const msgMatch = (m.msg || '').toLowerCase().indexOf(search) >= 0;
            const nameMatch = (m.playerName || '').toLowerCase().indexOf(search) >= 0;
            const idMatch = m.id.toString() === search;
            if (!msgMatch && !nameMatch && !idMatch) return false;
        }
        return true;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize).reverse();

    return { messages: paged, total: total, page: page, pageSize: pageSize, totalPages: totalPages };
}

function getMessageById(id) {
    return messageBoardData.messages.find(function(m) { return m.id === id; }) || null;
}

function getNextId() {
    return messageBoardData.nextId++;
}

function formatTime() {
    return U.getCurrentTimeString();
}

function addMessage(msg) {
    messageBoardData.messages.push(msg);
    saveData();
}

function deleteMessage(id) {
    const msg = messageBoardData.messages.find(function(m) { return m.id === id; });
    if (!msg) return false;
    msg.isDeleted = true;
    saveData();
    return true;
}

module.exports = {
    init: init,
    getData: getData,
    showMainForm: showMainForm,
    onSave: function(cb) { _onSaveCallbacks.push(cb); },
    getMessages: getMessages,
    getMessageById: getMessageById,
    getNextId: getNextId,
    formatTime: formatTime,
    addMessage: addMessage,
    deleteMessage: deleteMessage
};
