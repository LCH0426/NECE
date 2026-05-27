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
 * 日志以 JSONL 格式按日期分文件存储，支持关键词/发送者过滤查询
 */

let _deps = {};
let _fs = null;
let _U = null;
let _pathModule = null;

// 默认聊天配置：启用状态、格式模板、敏感词开关
let chatCfg = { enabled: true, format: "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§a<§r{name}§a> §r{msg}", wordFilter: true };
let badWordList = [];
let badWordRegex = null;  // 预编译的敏感词正则，避免每次检测时重建
let orgNameResolver = null;  // 延迟加载公会名称查询函数（orgEX插件导出）

// 聊天日志文件句柄与日期追踪
let _chatLogDir = null;
let _currentLogFile = null;  // 当前打开的文件描述符
let _currentLogDate = '';

/**
 * 初始化聊天模块，创建日志目录并启动定时任务
 * @param {Object} deps - 依赖注入对象，包含 fs、U 等工具
 */
function init(deps) {
    _deps = deps;
    _fs = deps.fs;
    _U = deps.U;
    _pathModule = require('path');
    _chatLogDir = _pathModule.join(__dirname, '..', 'logs', 'chat');
    _ensureChatLogDir();
    _openLogFile();
    // 每30秒检查日期变化，必要时切换日志文件
    setInterval(function() { _checkDateChange(); }, 30000);
    // 每30秒强制刷盘，防止日志丢失
    setInterval(function() {
        try { if (_currentLogFile) _fs.fsyncSync(_currentLogFile); } catch (e) { logger.warn('[ChatLog] fsync 失败: ' + e.message); }
    }, 30000);
}

/**
 * 从磁盘加载聊天配置和敏感词列表
 * 兼容旧字段名 profanityFilter -> wordFilter 的自动迁移
 */
function loadChatConfig() {
    try {
        const chatCfgPath = _deps.chatCfgPath;
        const badWordsPath = _deps.badWordsPath;
        if (_fs.existsSync(chatCfgPath)) {
            const raw = _fs.readFileSync(chatCfgPath, 'utf-8');
            const parsed = raw ? JSON.parse(raw) : {};
            chatCfg = Object.assign(chatCfg, parsed);
            // 兼容旧字段名 profanityFilter，自动迁移为 wordFilter
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
            // 过滤掉空字符串条目
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

/**
 * 根据当前敏感词列表重建预编译正则表达式
 * 对特殊正则字符进行转义，以 | 连接，不区分大小写
 */
function rebuildBadWordRegex() {
    if (!badWordList || badWordList.length === 0) { badWordRegex = null; return; }
    const parts = badWordList.map(function(w) { return w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).filter(Boolean);
    badWordRegex = parts.length > 0 ? new RegExp(parts.join('|'), 'i') : null;
}

/**
 * 查询玩家所属公会名称，通过 orgEX 插件导出函数实现
 * 首次调用时检测导出可用性，后续使用缓存结果
 * @param {string} xuid - 玩家 XUID
 * @returns {string} 公会名称，无公会返回"§c无§r"
 */
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

/**
 * 检测文本是否包含敏感词
 * @param {string} text - 待检测文本
 * @returns {boolean} 是否命中敏感词过滤
 */
function isBadWord(text) {
    if (!chatCfg.wordFilter || !badWordRegex) return false;
    return badWordRegex.test(text);
}

// 聊天格式占位符映射表：{key} -> 对应的玩家信息获取函数
const CHAT_PLACEHOLDER_MAP = {
    dim: function(p) { return p.pos ? p.pos.dim : "未知"; },
    os: function(p) { let d = p.getDevice(); const o = d ? d.os : "未知"; return o === "Win32" ? "GDK" : o; },
    ping: function(p) { const d = p.getDevice(); return d ? d.avgPing : "N/A"; },
    org: function(p) { return resolveOrgName(p.xuid); },
    name: function(p) { return p.realName; }
};

/**
 * 根据配置模板和玩家信息构建格式化的聊天输出
 * @param {Object} player - 发送消息的玩家对象
 * @param {string} message - 聊天消息内容
 * @returns {string} 格式化后的聊天字符串
 */
function buildChatOutput(player, message) {
    const pattern = chatCfg.format || "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§a<§r{name}§a> §r{msg}";
    return pattern.replace(/\{(\w+)\}/g, function(match, key) {
        if (key === 'msg') return message;
        const fn = CHAT_PLACEHOLDER_MAP[key];
        return fn ? fn(player) : '';
    });
}

/** 确保聊天日志目录存在 */
function _ensureChatLogDir() {
    if (!_fs.existsSync(_chatLogDir)) {
        _fs.mkdirSync(_chatLogDir, { recursive: true });
    }
}

/** 获取当前日期字符串 (YYYY-MM-DD) */
function _getTodayDate() {
    let now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

/** 根据日期字符串生成对应的日志文件路径 */
function _getLogPath(dateStr) {
    return _pathModule.join(_chatLogDir, 'chat-' + dateStr + '.jsonl');
}

/**
 * 打开或切换到当天的日志文件
 * 若当前已打开且日期匹配则跳过，避免重复打开
 */
function _openLogFile() {
    let today = _getTodayDate();
    if (_currentLogDate === today && _currentLogFile) return;
    if (_currentLogFile) {
        try { _fs.closeSync(_currentLogFile); } catch (e) { logger.warn('[ChatLog] 关闭日志文件失败: ' + e.message); }
    }
    _currentLogDate = today;
    _currentLogFile = _fs.openSync(_getLogPath(today), 'a');
}

/** 定时检查日期变化，跨天时关闭旧文件并打开新文件 */
function _checkDateChange() {
    const today = _getTodayDate();
    if (today !== _currentLogDate) {
        if (_currentLogFile) {
            try { _fs.closeSync(_currentLogFile); } catch (e) { logger.warn('[ChatLog] 关闭日志文件失败: ' + e.message); }
            _currentLogFile = null;
        }
        _currentLogDate = '';
        _openLogFile();
    }
}

/**
 * 将一条聊天消息以 JSON 行追加写入当天日志文件
 * @param {Object} msg - {time, sender, message, type}
 */
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
        logger.error('[ChatLog] 写入失败: ' + e.message);
    }
}

/**
 * 获取所有有聊天日志的日期列表（降序排列）
 * @returns {string[]} 日期字符串数组，如 ["2026-05-27", "2026-05-26"]
 */
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

/**
 * 按条件查询聊天历史记录
 * @param {Object} options - {date, page, pageSize, sender, keyword}
 * @returns {Promise<{messages, pagination, date}>}
 */
function queryHistory(options) {
    return new Promise(function(resolve) {
        let date = options.date || '';
        const page = parseInt(options.page) || 1;
        const pageSize = parseInt(options.pageSize) || 100;
        const sender = (options.sender || '').trim().toLowerCase();
        const keyword = (options.keyword || '').trim().toLowerCase();

        // 未指定日期时默认查当天
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
                // 发送者名称模糊匹配
                if (sender && (msg.sender || '').toLowerCase().indexOf(sender) === -1) return;
                // 关键词模糊匹配
                if (keyword && (msg.message || '').toLowerCase().indexOf(keyword) === -1) return;
                results.push(msg);
            } catch (e) { logger.warn('[ChatLog] 解析日志行失败: ' + e.message); }
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

/**
 * 注册游戏内聊天事件监听
 * 拦截原始消息后写日志、过滤敏感词、广播格式化消息
 */
function registerChatListener() {
    mc.listen("onChat", function(pl, msg) {
        // 向 Web 面板推送实时聊天消息
        _deps.webServer.addChatMessage(pl.name, msg, 'player');
        _writeChatMessage({ time: Date.now(), sender: pl.name, message: msg, type: 'player' });

        if (!chatCfg.enabled) return true;

        if (isBadWord(msg)) {
            pl.sendToast('§e消息拦截', '§f发送内容包含违规词语，已被系统过滤');
            return false;  // 阻止原始消息广播
        }

        mc.broadcast(buildChatOutput(pl, msg));
        return false;  // 替换为格式化消息广播
    });
}

/** 获取当前聊天配置的只读引用 */
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
