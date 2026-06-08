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
 * NECE 聊天系统
 * 聊天配置、敏感词过滤、消息格式化、onChat事件监听、聊天记录日志
 * 日志以 JSONL 格式按日期分文件存储，支持关键词/发送者过滤查询
 */

let _deps = {};
let _fs = null;
let _U = null;
let _pathModule = null;

// 默认聊天配置：启用状态、格式模板、敏感词开关
let chatCfg = { enabled: true, format: "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§b{titles}§e|§a<§r{name}§a> §r{msg}", wordFilter: true };
let badWordList = [];
let badWordRegex = null;  // 预编译的敏感词正则，避免每次检测时重建

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
 * 从 config.json 的 chat 节加载聊天配置，从独立文件加载敏感词列表
 */
function loadChatConfig() {
    try {
        // 聊天配置从 config.json 加载
        var cfg = _deps.getConfig ? _deps.getConfig() : {};
        if (cfg && cfg.chat) {
            chatCfg = Object.assign(chatCfg, cfg.chat);
        }
        // 敏感词列表从独立文件加载
        const badWordsPath = _deps.badWordsPath;
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
 * 查询玩家所属公会名称（NECE 公会系统）
 * 带 per-xuid 缓存，TTL 5分钟，避免每条消息都查数据库
 */
var _orgNameCache = {};  // { xuid: { name, expire } }
var ORG_CACHE_TTL = 5 * 60 * 1000; // 5分钟

function resolveOrgName(xuid) {
    var now = Date.now();
    var cached = _orgNameCache[xuid];
    if (cached && cached.expire > now) return cached.name;
    try {
        var database = require('./database');
        if (database.isPlayerDbReady()) {
            var guild = database.getGuildByPlayer(String(xuid));
            var name = (guild && guild.name) ? guild.name : '§c无§r';
            _orgNameCache[xuid] = { name: name, expire: now + ORG_CACHE_TTL };
            return name;
        }
    } catch (e) {}
    return '§c无§r';
}

/** 清除指定玩家的公会名缓存（退出/被踢时调用） */
function clearOrgNameCache(xuid) {
    delete _orgNameCache[xuid];
}

/** 清除所有公会名缓存（公会改名/解散时调用） */
function clearAllOrgNameCache() {
    _orgNameCache = {};
}

// ============ 称号系统 ============

/** 获取玩家称号数据，首次访问时自动初始化 */
function _getPlayerTitles(xuid) {
    var pd = _deps.getPlayerData();
    if (!pd || !pd.players || !pd.players[xuid]) return { owned: ['萌新'], active: '萌新' };
    var p = pd.players[xuid];
    if (!p.titles) {
        p.titles = { owned: ['萌新'], active: '萌新' };
    }
    if (!p.titles.owned || p.titles.owned.length === 0) {
        p.titles.owned = ['萌新'];
    }
    if (!p.titles.active) {
        p.titles.active = '萌新';
    }
    return p.titles;
}

/** 获取玩家当前称号（用于聊天格式），默认返回"萌新"，"无称号"时返回空字符串 */
function getPlayerActiveTitle(xuid) {
    var titles = _getPlayerTitles(xuid);
    if (titles.active === '无称号') return '';
    return titles.active || '萌新';
}

/** 获取玩家拥有的所有称号（始终包含"无称号"选项） */
function getPlayerOwnedTitles(xuid) {
    var owned = _getPlayerTitles(xuid).owned || ['萌新'];
    // 确保"无称号"始终在列表首位
    if (owned.indexOf('无称号') === -1) {
        return ['无称号'].concat(owned);
    }
    return owned;
}

/** 为玩家添加称号（管理员/Web API 调用） */
function addPlayerTitle(xuid, title) {
    var titles = _getPlayerTitles(xuid);
    if (titles.owned.indexOf(title) === -1) {
        titles.owned.push(title);
    }
    if (_deps.savePlayerData) _deps.savePlayerData();
}

/** 设置玩家当前称号（"无称号"始终可选） */
function setActiveTitle(xuid, title) {
    var titles = _getPlayerTitles(xuid);
    if (title !== '无称号' && titles.owned.indexOf(title) === -1) return false;
    titles.active = title;
    if (_deps.savePlayerData) _deps.savePlayerData();
    return true;
}

/** 删除玩家的指定称号，不能删除默认称号"萌新" */
function removePlayerTitle(xuid, title) {
    if (title === '萌新') return false;
    var titles = _getPlayerTitles(xuid);
    var idx = titles.owned.indexOf(title);
    if (idx === -1) return false;
    titles.owned.splice(idx, 1);
    if (titles.active === title) titles.active = '萌新';
    if (_deps.savePlayerData) _deps.savePlayerData();
    return true;
}

/** 获取称号商店配置 */
function getTitleShopConfig() {
    var cfg = _deps.getConfig ? _deps.getConfig() : {};
    return (cfg && cfg.titles) ? cfg.titles : { defaultTitle: '萌新', shop: [] };
}

/** 显示称号系统主界面 */
function showTitleMainForm(player) {
    try {
        var fm = mc.newSimpleForm();
        fm.setTitle("§l§b称号系统");
        fm.setContent("§a当前称号: §b" + getPlayerActiveTitle(player.xuid));
        fm.addButton("§e设置称号", "textures/ui/icon_setting");
        fm.addButton("§a购买称号", "textures/ui/marketplace");
        player.sendForm(fm, function(p, id) {
            if (id === null) return;
            if (id === 0) showSetTitleForm(p);
            if (id === 1) showBuyTitleForm(p);
        });
    } catch (e) {
        logger.error('[Chat/Title] showTitleMainForm 错误: ' + e.message);
    }
}

/** 显示设置称号表单（选择已拥有的称号） */
function showSetTitleForm(player) {
    try {
        var owned = getPlayerOwnedTitles(player.xuid);
        var current = getPlayerActiveTitle(player.xuid);
        var fm = mc.newSimpleForm();
        fm.setTitle("§l§e设置称号");
        fm.setContent("§a当前称号: §b" + current + "\n§a点击选择要使用的称号：");
        owned.forEach(function(t) {
            fm.addButton((t === current ? "§b★ " : "") + t);
        });
        player.sendForm(fm, function(p, id) {
            if (id == null) { showTitleMainForm(p); return; }
            var selected = owned[id];
            if (selected) {
                setActiveTitle(p.xuid, selected);
                p.tell("§e[称号] §a称号已设置为: §b" + selected);
            }
        });
    } catch (e) {
        logger.error('[Chat/Title] showSetTitleForm 错误: ' + e.message);
    }
}

/**
 * 移除 Minecraft 颜色代码（§0-§9, §a-§v, §l, §r, §o, §n, §m, §k）后的纯文本长度
 * @param {string} text - 含颜色代码的文本
 * @returns {number} 纯文本字符数
 */
function getPlainTextLength(text) {
    return text.replace(/§[0-9a-vk-or]/gi, '').length;
}

/**
 * 检查称号是否包含违禁词（基于纯文本，去除颜色代码后检测）
 * @param {string} title - 称号文本
 * @returns {boolean} 是否包含违禁词
 */
function isTitleForbidden(title) {
    var plain = title.replace(/§[0-9a-vk-or]/gi, '');
    return isBadWord(plain);
}

/** 显示购买称号表单（含预设称号 + 自定义称号入口） */
function showBuyTitleForm(player) {
    try {
        var shopConfig = getTitleShopConfig();
        var shop = shopConfig.shop || [];
        var owned = getPlayerOwnedTitles(player.xuid);
        var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '星茜';
        var balance = 0;
        try { balance = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0; } catch (e) {}

        // 过滤掉已拥有的称号
        var available = shop.filter(function(item) { return owned.indexOf(item.name) === -1; });

        var fm = mc.newSimpleForm();
        fm.setTitle("§l§a购买称号");
        fm.setContent("§a余额: §e" + balance + " " + currencyName + "\n§7选择预设称号或自定义称号");
        available.forEach(function(item) {
            fm.addButton("§b" + item.name + " §e- " + item.cost + " " + currencyName);
        });
        fm.addButton("§a✦ §l自定义称号 §7(§e" + shopConfig.perCharCost + " " + currencyName + "/字§7)");

        player.sendForm(fm, function(p, id) {
            if (id === null) { showTitleMainForm(p); return; }
            if (id < available.length) {
                // 预设称号 → 二次确认
                var item = available[id];
                if (!item) return;
                showBuyConfirmForm(p, item.name, item.cost, 'preset');
            } else {
                // 自定义称号
                showCustomTitleForm(p);
            }
        });
    } catch (e) {
        logger.error('[Chat/Title] showBuyTitleForm 错误: ' + e.message);
    }
}

/**
 * 显示购买确认表单（二次确认）
 * @param {Player} player - 玩家
 * @param {string} titleName - 称号名称
 * @param {number} cost - 费用
 * @param {string} type - 'preset' 或 'custom'
 */
function showBuyConfirmForm(player, titleName, cost, type) {
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '星茜';
    var balance = 0;
    try { balance = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0; } catch (e) {}

    // 重复购买检查
    var currentOwned = getPlayerOwnedTitles(player.xuid);
    if (currentOwned.indexOf(titleName) !== -1) {
        player.tell("§e[称号] §c你已经拥有该称号！");
        return;
    }

    var fm = mc.newModalForm();
    fm.setTitle("§e确认购买");
    fm.setContent(
        "§a称号: §b" + titleName + "\n" +
        "§a费用: §e" + cost + " " + currencyName + "\n" +
        "§a余额: §e" + balance + " " + currencyName + "\n\n" +
        (balance < cost ? "§c⚠ 余额不足！" : "§a确认购买？")
    );
    fm.setConfirmButton("§a确认购买");
    fm.setCancelButton("§c取消");

    player.sendForm(fm, function(p, result) {
        if (!result) { showBuyTitleForm(p); return; }

        // 再次检查余额
        var bal = 0;
        try { bal = _deps.getPlayerMoney ? _deps.getPlayerMoney(p) : 0; } catch (e) {}
        if (bal < cost) {
            p.tell("§e[称号] §c余额不足！需要 " + cost + " " + currencyName);
            return;
        }

        // 再次检查重复
        var owned = getPlayerOwnedTitles(p.xuid);
        if (owned.indexOf(titleName) !== -1) {
            p.tell("§e[称号] §c你已经拥有该称号！");
            return;
        }

        // 扣款
        try {
            _deps.reducePlayerMoney(p, cost, "购买称号: " + titleName);
        } catch (e) {
            p.tell("§e[称号] §c扣款失败: " + e.message);
            return;
        }

        addPlayerTitle(p.xuid, titleName);
        setActiveTitle(p.xuid, titleName);
        p.tell("§e[称号] §a成功购买并设置称号: §b" + titleName);
    });
}

/** 显示自定义称号输入表单 */
function showCustomTitleForm(player) {
    var shopConfig = getTitleShopConfig();
    var maxChars = shopConfig.maxChars || 10;
    var perCharCost = shopConfig.perCharCost || 100;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '星茜';

    var fm = mc.newCustomForm();
    fm.setTitle("§l§a自定义称号");
    fm.addLabel(
        "§a规则说明:\n" +
        "§7- 最多 §e" + maxChars + " §7个字符（不含颜色代码）\n" +
        "§7- 每字 §e" + perCharCost + " " + currencyName + "\n" +
        "§7- 支持颜色代码: §1§2§3§4§5§6§7§8§9§a§b§c§d§e§f\n" +
        "§7- 不得包含违禁词"
    );
    fm.addInput("称号内容", "输入称号，可用§加颜色代码", "");

    player.sendForm(fm, function(p, data) {
        if (data === null) { showBuyTitleForm(p); return; }

        var input = (data[1] || '').trim();
        if (!input) {
            p.tell("§e[称号] §c称号不能为空！");
            showCustomTitleForm(p);
            return;
        }

        // 计算纯文本长度
        var plainLen = getPlainTextLength(input);
        if (plainLen === 0) {
            p.tell("§e[称号] §c称号内容不能为空！");
            showCustomTitleForm(p);
            return;
        }
        if (plainLen > maxChars) {
            p.tell("§e[称号] §c称号超过最大长度限制！当前 " + plainLen + " 字，上限 " + maxChars + " 字");
            showCustomTitleForm(p);
            return;
        }

        // 违禁词检测
        if (isTitleForbidden(input)) {
            p.tell("§e[称号] §c称号包含违禁词，请修改后重试");
            showCustomTitleForm(p);
            return;
        }

        // 计算费用
        var cost = plainLen * perCharCost;

        // 重复检查
        var owned = getPlayerOwnedTitles(p.xuid);
        if (owned.indexOf(input) !== -1) {
            p.tell("§e[称号] §c你已经拥有该称号！");
            return;
        }

        // 进入二次确认
        showBuyConfirmForm(p, input, cost, 'custom');
    });
}

/** 注册 /titles 命令 */
function registerTitleCommand(registerPlayerCommand) {
    registerPlayerCommand("titles", "称号系统", function(p) { showTitleMainForm(p); });
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
    titles: function(p) { return getPlayerActiveTitle(p.xuid); },
    name: function(p) { return p.realName; }
};

/**
 * 根据配置模板和玩家信息构建格式化的聊天输出
 * 空称号时自动移除对应的 §e| 分隔符，避免显示多余的竖线
 * @param {Object} player - 发送消息的玩家对象
 * @param {string} message - 聊天消息内容
 * @returns {string} 格式化后的聊天字符串
 */
function buildChatOutput(player, message) {
    const pattern = chatCfg.format || "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§b{titles}§e|§a<§r{name}§a> §r{msg}";
    var result = pattern.replace(/\{(\w+)\}/g, function(m, key) {
        if (key === 'msg') return message;
        const fn = CHAT_PLACEHOLDER_MAP[key];
        return fn ? fn(player) : '';
    });
    // 空称号时移除多余的 §b§e| 分隔符，避免显示 "||"
    var titleVal = getPlayerActiveTitle(player.xuid);
    if (!titleVal) {
        result = result.replace(/§b§e\|/g, '');
    }
    return result;
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
    clearOrgNameCache: clearOrgNameCache,
    clearAllOrgNameCache: clearAllOrgNameCache,
    registerChatListener: registerChatListener,
    getChatCfg: getChatCfg,
    writeMessage: _writeChatMessage,
    getAvailableDates: getAvailableDates,
    queryHistory: queryHistory,
    // 称号系统
    getPlayerActiveTitle: getPlayerActiveTitle,
    getPlayerOwnedTitles: getPlayerOwnedTitles,
    addPlayerTitle: addPlayerTitle,
    setActiveTitle: setActiveTitle,
    removePlayerTitle: removePlayerTitle,
    registerTitleCommand: registerTitleCommand
};
