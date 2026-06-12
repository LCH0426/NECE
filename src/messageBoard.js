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
 * NECE 留言板系统
 * 玩家可发布带心情标签的留言，支持浏览、搜索、随机查看和删除
 * 数据通过 DataManager 持久化，同时提供 Web API 接口供管理面板调用
 */


const U = require('./utils');

const MOOD_OPTIONS = ['开心', '难过', '平静', '兴奋', '生气'];
const D = require('./debug');

let messageBoardDM = null;
let messageBoardData = {
    messages: [],
    nextId: 1
};
let _deps = {};
let t = null;
// 数据保存后的回调列表
const _onSaveCallbacks = [];

/**
 * 初始化留言板模块，加载数据并修复缺失字段
 * @param {DataManager} dm - 留言板数据的 DataManager 实例
 * @param {Object} deps - 依赖对象
 */
function init(dm, deps) {
	D.debugLogModule('messageBoard')('init: 初始化完成');
    messageBoardDM = dm;
    _deps = deps || {};
    t = _deps.t;
    messageBoardData = messageBoardDM.load();
    if (!Array.isArray(messageBoardData.messages)) messageBoardData.messages = [];
    if (typeof messageBoardData.nextId !== 'number') messageBoardData.nextId = 1;
    // 修复旧数据中缺少的字段
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
 * 保存数据并触发所有注册的保存回调
 * @returns {boolean} 始终返回 true
 */
function saveData() {
    if (!Array.isArray(messageBoardData.messages)) messageBoardData.messages = [];
    messageBoardDM.save();
    _onSaveCallbacks.forEach(function(cb) { try { cb(); } catch(e) { logger.warn('[MessageBoard] 保存回调执行失败: ' + e.message); } });
    return true;
}

/** 获取留言板原始数据 */
function getData() {
    return messageBoardData;
}

/**
 * 显示留言板主表单，展示统计信息和功能入口
 * @param {Player} player
 */
function showMainForm(player) {
    let xuid = player.xuid;
    const playerName = player.realName;
    const lang = getLocale(xuid);
    let validMessages = (messageBoardData.messages || []).filter(function(m) { return !m.isDeleted; });
    let myMessages = validMessages.filter(function(m) { return m.xuid === xuid; });

    let fm = mc.newSimpleForm();
    fm.setTitle(t(lang, 'mb.title'));
    fm.setContent(t(lang, 'mb.main_content', playerName, messageBoardData.messages.length, validMessages.length, myMessages.length));

    fm.addButton(t(lang, 'mb.btn_add'), "textures/ui/book_edit_hover.png");
    fm.addButton(t(lang, 'mb.btn_my'), "textures/ui/comment");
    fm.addButton(t(lang, 'mb.btn_all'), "textures/ui/world_glyph_color_2x");
    fm.addButton(t(lang, 'mb.btn_random'), "textures/ui/recap_glyph_desaturated");
    fm.addButton(t(lang, 'mb.btn_search'), "textures/ui/magnifyingGlass");

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

/**
 * 新增留言表单，包含内容输入和心情选择
 * 留言内容限制 200 字符，自动记录客户端类型
 * @param {Player} player
 */
function createAddMessageForm(player) {
    const lang = getLocale(player.xuid);
    let fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'mb.add_title'));
    fm.addInput(t(lang, 'mb.add_content_label'), "string", "");
    fm.addDropdown(t(lang, 'mb.mood_label'), MOOD_OPTIONS, 0);

    player.sendForm(fm, function(pl, data) {
        if (data == null || !Array.isArray(data)) {
            showMainForm(pl);
            return;
        }
        let msg = String(data[0] || "").trim();
        const moodIndex = typeof data[1] === 'number' ? data[1] : 2;
        if (!msg || msg.length > 200) {
            pl.tell(t(lang, 'mb.err_content'));
            createAddMessageForm(pl);
            return;
        }
        const device = pl.getDevice();
        const client = device ? device.os : t(lang, 'mb.unknown_device');
        const newMessage = {
            id: messageBoardData.nextId,
            xuid: pl.xuid,
            playerName: pl.realName,
            msg: msg,
            mood: MOOD_OPTIONS[moodIndex],
            time: U.getCurrentTimeString(),
            client: client,
            isDeleted: false
        };
        messageBoardData.messages.push(newMessage);
        messageBoardData.nextId++;
        if (saveData()) {
            pl.tell(t(lang, 'mb.add_success'));
        }
        showMainForm(pl);
    });
}

/**
 * "我的留言"分页列表，仅显示当前玩家的未删除留言
 * @param {Player} player
 * @param {number} page - 页码（从1开始）
 */
function createMyMessagesForm(player, page) {
    let xuid = player.xuid;
    const lang = getLocale(xuid);
    let pageSize = 10;
    // 按时间降序排列
    const myMessages = messageBoardData.messages.filter(function(m) { return m.xuid === xuid && !m.isDeleted; });
    // 按 ID 降序排列
    myMessages.sort(function(a, b) { return b.id - a.id; });
    let totalPages = Math.ceil(myMessages.length / pageSize) || 1;
    let startIndex = (page - 1) * pageSize;
    let pageMessages = myMessages.slice(startIndex, startIndex + pageSize);

    let fm = mc.newSimpleForm();
    fm.setTitle(t(lang, 'mb.my_title'));

    let content = t(lang, 'mb.page_info', page, totalPages, pageSize);
    content += "§6——————————————\n";

    if (pageMessages.length === 0) {
        content += t(lang, 'mb.no_messages');
    } else {
        pageMessages.forEach(function(msg) {
            content += t(lang, 'mb.message_item', msg.id, msg.mood, msg.time, msg.msg);
        });
    }

    fm.setContent(content);
    fm.addButton(t(lang, 'mb.btn_add'), "textures/ui/book_edit_hover.png");
    if (page > 1) fm.addButton(t(lang, 'mb.btn_prev'), "textures/ui/arrow_left");
    if (page < totalPages) fm.addButton(t(lang, 'mb.btn_next'), "textures/ui/arrow_right");
    fm.addButton(t(lang, 'mb.btn_back'), "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        // 动态按钮索引计算：根据分页按钮有无偏移
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

/**
 * "所有留言"分页列表，显示全部未删除留言（含作者和客户端信息）
 * @param {Player} player
 * @param {number} page - 页码（从1开始）
 */
function createAllMessagesForm(player, page) {
    const lang = getLocale(player.xuid);
    let pageSize = 10;
    const allMessages = messageBoardData.messages.filter(function(m) { return !m.isDeleted; });
    // 按 ID 降序排列
    allMessages.sort(function(a, b) { return b.id - a.id; });
    let totalPages = Math.ceil(allMessages.length / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const pageMessages = allMessages.slice(startIndex, startIndex + pageSize);
    const totalCount = messageBoardData.messages.length;
    const activeCount = allMessages.length;

    let fm = mc.newSimpleForm();
    fm.setTitle(t(lang, 'mb.all_title'));

    let content = t(lang, 'mb.all_stats', totalCount, activeCount);
    content += t(lang, 'mb.page_info', page, totalPages, pageSize);
    content += "§6——————————————\n";

    if (pageMessages.length === 0) {
        content += t(lang, 'mb.no_messages_page');
    } else {
        pageMessages.forEach(function(msg) {
            content += t(lang, 'mb.all_message_item', msg.id, msg.playerName, msg.mood, msg.client, msg.time, msg.msg);
        });
    }

    fm.setContent(content);
    if (page > 1) fm.addButton(t(lang, 'mb.btn_prev'), "textures/ui/arrow_left");
    if (page < totalPages) fm.addButton(t(lang, 'mb.btn_next'), "textures/ui/arrow_right");
    fm.addButton(t(lang, 'mb.btn_back'), "textures/ui/recap_glyph_desaturated");

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

/**
 * 显示留言详情，作者本人可删除自己的留言
 * @param {Player} player
 * @param {Object} message - 留言对象
 */
function showMessageDetail(player, message) {
    const lang = getLocale(player.xuid);
    const isOwnMessage = message.xuid === player.xuid;
    let content = "§6——————————————\n";
    content += t(lang, 'mb.detail_id', message.id);
    content += t(lang, 'mb.detail_author', message.playerName);
    content += t(lang, 'mb.detail_mood', message.mood);
    content += t(lang, 'mb.detail_time', message.time);
    content += t(lang, 'mb.detail_client', message.client);
    content += "§6——————————————\n";
    content += t(lang, 'mb.detail_content', message.msg);

    if (message.isDeleted) {
        content += "\n§6——————————————\n";
        content += t(lang, 'mb.detail_deleted');
        content += t(lang, 'mb.detail_deleted_time', message.time);
        content += t(lang, 'mb.detail_deleted_client', message.client);
    }

    let fm = mc.newSimpleForm();
    fm.setTitle(t(lang, 'mb.detail_title', message.id));
    fm.setContent(content);
    // 仅作者可见删除按钮
    if (isOwnMessage && !message.isDeleted) {
        fm.addButton(t(lang, 'mb.btn_delete'), "textures/ui/trash_default");
    }
    fm.addButton(t(lang, 'mb.btn_back'), "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        if (id === 0 && isOwnMessage && !message.isDeleted) {
            pl.sendModalForm(
                t(lang, 'mb.delete_confirm_title'),
                t(lang, 'mb.delete_confirm_content', message.id),
                t(lang, 'mb.btn_delete'),
                t(lang, 'mb.btn_cancel'), function(p, result) {
                    if (result === true) {
                        // 软删除：标记 isDeleted 而非从数组移除
                        const msgIndex = messageBoardData.messages.findIndex(function(m) { return m.id === message.id; });
                        if (msgIndex !== -1) {
                            messageBoardData.messages[msgIndex].isDeleted = true;
                            if (saveData()) {
                                p.tell(t(lang, 'mb.delete_success', message.id));
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

/**
 * 随机展示一条有效留言，可反复随机
 * @param {Player} player
 */
function showRandomMessage(player) {
    const lang = getLocale(player.xuid);
    const validMessages = messageBoardData.messages.filter(function(m) { return !m.isDeleted; });
    if (validMessages.length === 0) {
        player.tell(t(lang, 'mb.no_valid_messages'));
        showMainForm(player);
        return;
    }
    const randomIndex = Math.floor(Math.random() * validMessages.length);
    const randomMessage = validMessages[randomIndex];

    let fm = mc.newSimpleForm();
    fm.setTitle(t(lang, 'mb.random_title', randomMessage.id));

    let content = "§6——————————————\n";
    content += t(lang, 'mb.detail_id', randomMessage.id);
    content += t(lang, 'mb.detail_author', randomMessage.playerName);
    content += t(lang, 'mb.detail_mood', randomMessage.mood);
    content += t(lang, 'mb.detail_time', randomMessage.time);
    content += t(lang, 'mb.detail_from', randomMessage.client);
    content += "§6——————————————\n";
    content += t(lang, 'mb.detail_content', randomMessage.msg);

    fm.setContent(content);
    fm.addButton(t(lang, 'mb.btn_random_again'));
    fm.addButton(t(lang, 'mb.btn_back'), "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(pl, id) {
        if (id === null) return;
        if (id === 0) showRandomMessage(pl);
        else showMainForm(pl);
    });
}

/**
 * 按 ID 搜索留言表单
 * @param {Player} player
 */
function createSearchMessageForm(player) {
    const lang = getLocale(player.xuid);
    const fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'mb.search_title'));
    fm.addInput(t(lang, 'mb.search_input'), "ID", "");

    player.sendForm(fm, function(pl, data) {
        if (data == null) {
            showMainForm(pl);
            return;
        }
        let input = String((Array.isArray(data) && data[0] !== undefined ? data[0] : "") || "").trim();
        if (input === "") return;
        const messageId = parseInt(input);
        if (isNaN(messageId) || messageId <= 0) {
            pl.tell(t(lang, 'mb.err_invalid_id'));
            createSearchMessageForm(pl);
            return;
        }
        const message = messageBoardData.messages.find(function(m) { return m.id === messageId; });
        if (!message) {
            pl.tell(t(lang, 'mb.err_not_found', messageId));
            createSearchMessageForm(pl);
            return;
        }
        showMessageDetail(pl, message);
    });
}

// ============ Web API 方法 (原 messageBoardApi) ============

/**
 * Web API：按条件查询留言列表，支持分页、关键词搜索、心情筛选
 * @param {Object} options - {page, pageSize, search, mood, xuid, includeDeleted}
 * @returns {{messages: Array, total: number, page: number, pageSize: number, totalPages: number}}
 */
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
            // 同时搜索留言内容、作者名和 ID
            const msgMatch = (m.msg || '').toLowerCase().indexOf(search) >= 0;
            const nameMatch = (m.playerName || '').toLowerCase().indexOf(search) >= 0;
            const idMatch = m.id.toString() === search;
            if (!msgMatch && !nameMatch && !idMatch) return false;
        }
        return true;
    });

    // 按 ID 降序排列（大的在前面）
    filtered.sort(function(a, b) { return b.id - a.id; });

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return { messages: paged, total: total, page: page, pageSize: pageSize, totalPages: totalPages };
}

/**
 * Web API：根据 ID 查询单条留言
 * @param {number} id
 * @returns {Object|null}
 */
function getMessageById(id) {
    return messageBoardData.messages.find(function(m) { return m.id === id; }) || null;
}

/**
 * Web API：获取下一个可用 ID 并自增
 * @returns {number} 当前可用的留言 ID
 */
function getNextId() {
    return messageBoardData.nextId++;
}

/** 获取当前格式化时间字符串 */
function formatTime() {
    return U.getCurrentTimeString();
}

/**
 * Web API：添加新留言并保存
 * @param {Object} msg - 留言对象
 */
function addMessage(msg) {
    messageBoardData.messages.push(msg);
    saveData();
}

/**
 * Web API：软删除指定 ID 的留言
 * @param {number} id - 留言 ID
 * @returns {boolean} 是否删除成功
 */
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
    /** 注册数据保存后的回调函数 */
    onSave: function(cb) { _onSaveCallbacks.push(cb); },
    getMessages: getMessages,
    getMessageById: getMessageById,
    getNextId: getNextId,
    formatTime: formatTime,
    addMessage: addMessage,
    deleteMessage: deleteMessage
};
