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
 * NLCE 聊天系统
 * 聊天配置、敏感词过滤、消息格式化、onChat事件监听、聊天记录日志
 */

let _deps = {};
let _fs = null;
let _U = null;
let _pathModule = null;

let chatCfg = { enabled: true, format: "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§a<§r{name}§a> §r{msg}", wordFilter: true };
let badWordList = [];
let badWordRegex = null;
let orgNameResolver = null;

// 聊天日志状态
let _chatLogDir = null;
let _currentLogFile = null;
let _currentLogDate = '';

function init(deps) {
    _deps = deps;
    _fs = deps.fs;
    _U = deps.U;
    _pathModule = require('path');
    _chatLogDir = _pathModule.join(__dirname, '..', 'logs', 'chat');
    _ensureChatLogDir();
    _openLogFile();
    setInterval(function() { _checkDateChange(); }, 30000);
    setInterval(function() {
        try { if (_currentLogFile) _fs.fsyncSync(_currentLogFile); } catch (e) {}
    }, 30000);
}

function loadChatConfig() {
    try {
        const chatCfgPath = _deps.chatCfgPath;
        const badWordsPath = _deps.badWordsPath;
        if (_fs.existsSync(chatCfgPath)) {
            const raw = _fs.readFileSync(chatCfgPath, 'utf-8');
            const parsed = raw ? JSON.parse(raw) : {};
            chatCfg = Object.assign(chatCfg, parsed);
            if (parsed.profanityFilter !== undefined && parsed.wordFilter === undefined) {
                chatCfg.wordFilter = parsed.profanityFilter;
                delete chatCfg.profanityFilter;
                _fs.writeFileSync(chatCfgPath, JSON.stringify(chatCfg, null, 4), 'utf-8');
            }
        } else {
            _U.ensureDir(chatCfgPath);
            _fs.writeFileSync(chatCfgPath, JSON.stringify(chatCfg, null, 4), 'utf-8');
        }
        if (_fs.existsSync(badWordsPath)) {
            const bwRaw = _fs.readFileSync(badWordsPath, 'utf-8');
            badWordList = (bwRaw ? JSON.parse(bwRaw) : []).filter(function(w) { return w && w.trim() !== ""; });
        } else {
            _U.ensureDir(badWordsPath);
            _fs.writeFileSync(badWordsPath, JSON.stringify(["", ""], null, 4), 'utf-8');
            badWordList = [];
        }
        rebuildBadWordRegex();
    } catch (e) {
        logger.error("[聊天] 配置加载失败: " + e.message);
    }
}

function rebuildBadWordRegex() {
    if (!badWordList || badWordList.length === 0) { badWordRegex = null; return; }
    const parts = badWordList.map(function(w) { return w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).filter(Boolean);
    badWordRegex = parts.length > 0 ? new RegExp(parts.join('|'), 'i') : null;
}

function resolveOrgName(xuid) {
    if (orgNameResolver === null) {
        orgNameResolver = ll.hasExported('orgEX', 'orgEX_getPlayerOrgName') ? ll.import('orgEX', 'orgEX_getPlayerOrgName') : false;
    }
    if (!orgNameResolver) return '§c无§r';
    try {
        const n = orgNameResolver(xuid);
        return (n && n.trim()) ? n : '§c无§r';
    } catch (e) { return '§c无§r'; }
}

function isBadWord(text) {
    if (!chatCfg.wordFilter || !badWordRegex) return false;
    return badWordRegex.test(text);
}

const CHAT_PLACEHOLDER_MAP = {
    dim: function(p) { return p.pos ? p.pos.dim : "未知"; },
    os: function(p) { let d = p.getDevice(); const o = d ? d.os : "未知"; return o === "Win32" ? "GDK" : o; },
    ping: function(p) { const d = p.getDevice(); return d ? d.avgPing : "N/A"; },
    org: function(p) { return resolveOrgName(p.xuid); },
    name: function(p) { return p.realName; }
};

function buildChatOutput(player, message) {
    const pattern = chatCfg.format || "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§a<§r{name}§a> §r{msg}";
    return pattern.replace(/\{(\w+)\}/g, function(match, key) {
        if (key === 'msg') return message;
        const fn = CHAT_PLACEHOLDER_MAP[key];
        return fn ? fn(player) : '';
    });
}

function _ensureChatLogDir() {
    if (!_fs.existsSync(_chatLogDir)) {
        _fs.mkdirSync(_chatLogDir, { recursive: true });
    }
}

function _getTodayDate() {
    let now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

function _getLogPath(dateStr) {
    return _pathModule.join(_chatLogDir, 'chat-' + dateStr + '.jsonl');
}

function _openLogFile() {
    let today = _getTodayDate();
    if (_currentLogDate === today && _currentLogFile) return;
    if (_currentLogFile) {
        try { _fs.closeSync(_currentLogFile); } catch (e) {}
    }
    _currentLogDate = today;
    _currentLogFile = _fs.openSync(_getLogPath(today), 'a');
}

function _checkDateChange() {
    const today = _getTodayDate();
    if (today !== _currentLogDate) {
        if (_currentLogFile) {
            try { _fs.closeSync(_currentLogFile); } catch (e) {}
            _currentLogFile = null;
        }
        _currentLogDate = '';
        _openLogFile();
    }
}

function _writeChatMessage(msg) {
    try {
        _openLogFile();
        const line = JSON.stringify({
            time: msg.time,
            sender: msg.sender,
            message: msg.message,
            type: msg.type
        }) + '\n';
        _fs.writeSync(_currentLogFile, line);
    } catch (e) {
        console.error('[ChatLog] 写入失败:', e.message);
    }
}

function getAvailableDates() {
    try {
        _ensureChatLogDir();
        const files = _fs.readdirSync(_chatLogDir);
        return files
            .filter(function(f) { return f.startsWith('chat-') && f.endsWith('.jsonl'); })
            .map(function(f) { return f.replace('chat-', '').replace('.jsonl', ''); })
            .sort()
            .reverse();
    } catch (e) {
        return [];
    }
}

function queryHistory(options) {
    return new Promise(function(resolve) {
        let date = options.date || '';
        const page = parseInt(options.page) || 1;
        const pageSize = parseInt(options.pageSize) || 100;
        const sender = (options.sender || '').trim().toLowerCase();
        const keyword = (options.keyword || '').trim().toLowerCase();

        if (!date) {
            const now = new Date();
            date = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
        }

        const logPath = _getLogPath(date);

        if (!_fs.existsSync(logPath)) {
            resolve({
                messages: [],
                pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 },
                date: date
            });
            return;
        }

        const results = [];
        const content = _fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n').filter(function(l) { return l.trim().length > 0; });

        lines.forEach(function(line) {
            try {
                const msg = JSON.parse(line);
                if (sender && (msg.sender || '').toLowerCase().indexOf(sender) === -1) return;
                if (keyword && (msg.message || '').toLowerCase().indexOf(keyword) === -1) return;
                results.push(msg);
            } catch (e) {}
        });

        const total = results.length;
        const totalPages = Math.ceil(total / pageSize);
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const paged = results.slice(start, end);

        resolve({
            messages: paged,
            pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages },
            date: date
        });
    });
}

function registerChatListener() {
    mc.listen("onChat", function(pl, msg) {
        _deps.webServer.addChatMessage(pl.name, msg, 'player');
        _writeChatMessage({ time: Date.now(), sender: pl.name, message: msg, type: 'player' });

        if (!chatCfg.enabled) return true;

        if (isBadWord(msg)) {
            pl.sendToast('§e消息拦截', '§f发送内容包含违规词语，已被系统过滤');
            return false;
        }

        mc.broadcast(buildChatOutput(pl, msg));
        return false;
    });
}

function getChatCfg() {
    return chatCfg;
}

module.exports = {
    init: init,
    loadChatConfig: loadChatConfig,
    isBadWord: isBadWord,
    buildChatOutput: buildChatOutput,
    registerChatListener: registerChatListener,
    getChatCfg: getChatCfg,
    writeMessage: _writeChatMessage,
    getAvailableDates: getAvailableDates,
    queryHistory: queryHistory
};
