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
 * NECE 统一日志模块
 * 按日期写入 logs/YYYY-MM-DD.jsonl，每条日志以 time + event 标识，其余字段平铺
 * 内存缓冲批量写入，写入失败自动回队重试，插件卸载时刷盘并关闭句柄
 */

const fs = require('fs');
const pathModule = require('path');

/** 日志根目录 */
let LOG_DIR = pathModule.join(__dirname, '..', 'logs');

/** 缓冲区刷盘间隔 */
const FLUSH_INTERVAL = 1000;

/** 强制落盘间隔 */
const FSYNC_INTERVAL = 30000;

/** 缓冲区最大条数，超过后丢弃最旧的数据，避免磁盘异常时内存无限增长 */
const MAX_PENDING = 50000;

/** syslog 级别，按严重度从高到低排列 */
const LEVELS = ['emerg', 'alert', 'crit', 'err', 'warn', 'notice', 'info', 'debug'];

/** 默认日志级别 */
const DEFAULT_LEVEL = 'info';

/** 规范化日志级别，非法值回退到默认级别 */
function normalizeLevel(level) {
    const value = String(level || '').toLowerCase();
    return LEVELS.indexOf(value) === -1 ? DEFAULT_LEVEL : value;
}

/** 待写入缓冲：{ date, line } */
const _pending = [];

/** 已打开的文件句柄：date -> fd */
const _fds = {};

/** 日期事件过滤缓存：date|match|mtime -> boolean */
const _eventDateCache = {};

let _flushTimer = null;
let _fsyncTimer = null;
let _stopped = false;

/** 数字补零 */
function pad2(n) {
    return String(n).padStart(2, '0');
}

/** 生成本地日期字符串 (YYYY-MM-DD) */
function formatDate(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 生成本地时间字符串 (YYYY-MM-DD HH:mm:ss) */
function formatTime(date) {
    const d = date || new Date();
    return formatDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/** 根据日期生成日志文件路径，格式非法返回 null 防止路径穿越 */
function filePathForDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
    return pathModule.join(LOG_DIR, dateStr + '.jsonl');
}

/** 确保日志目录存在 */
function ensureDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

/**
 * 初始化日志模块
 * @param {Object} [options] - {dir} 可覆盖日志根目录
 */
function init(options) {
    if (options && options.dir) LOG_DIR = options.dir;
    _stopped = false;
    ensureDir();
}

/** 关闭指定日期的文件句柄 */
function closeFd(dateStr) {
    const fd = _fds[dateStr];
    if (fd === undefined || fd === null) return;
    try { fs.closeSync(fd); } catch (e) { /* 忽略关闭失败 */ }
    delete _fds[dateStr];
}

/** 获取指定日期的文件句柄，失败时抛出异常 */
function getFd(dateStr) {
    if (_fds[dateStr] !== undefined && _fds[dateStr] !== null) return _fds[dateStr];
    ensureDir();
    const p = filePathForDate(dateStr);
    if (!p) throw new Error('非法日志日期: ' + dateStr);
    _fds[dateStr] = fs.openSync(p, 'a');
    return _fds[dateStr];
}

/** 启动定时器，首次写入时懒加载 */
function ensureTimers() {
    if (_stopped || _flushTimer) return;
    _flushTimer = setInterval(function() { flush(); }, FLUSH_INTERVAL);
    _fsyncTimer = setInterval(function() {
        Object.keys(_fds).forEach(function(dateStr) {
            try { fs.fsyncSync(_fds[dateStr]); } catch (e) { /* 忽略落盘失败 */ }
        });
    }, FSYNC_INTERVAL);
}

/** 将一批待写数据放回缓冲区头部，保持原始顺序 */
function requeue(items) {
    if (!items.length) return;
    _pending.unshift.apply(_pending, items);
    if (_pending.length > MAX_PENDING) {
        const dropped = _pending.splice(0, _pending.length - MAX_PENDING);
        if (typeof logger !== 'undefined') logger.warn('[LogStore] 日志缓冲溢出，丢弃 ' + dropped.length + ' 条');
    }
}

/**
 * 追加一条日志
 * @param {string} event - 事件名，如 chat / admin.ban / economy.reduce
 * @param {Object} fields - 平铺字段
 * @param {string} [level='info'] - syslog 级别
 * @returns {boolean} 是否进入缓冲区
 */
function append(event, fields, level) {
    if (!event) return false;
    try {
        const now = new Date();
        const dateStr = formatDate(now);
        const entry = Object.assign({}, fields || {});
        const ordered = { time: formatTime(now), level: normalizeLevel(level), event: String(event) };
        Object.keys(entry).forEach(function(k) {
            if (k !== 'time' && k !== 'level' && k !== 'event') ordered[k] = entry[k];
        });
        _pending.push({ date: dateStr, line: JSON.stringify(ordered) });
        if (_pending.length > MAX_PENDING) {
            const dropped = _pending.splice(0, _pending.length - MAX_PENDING);
            if (typeof logger !== 'undefined') logger.warn('[LogStore] 日志缓冲溢出，丢弃 ' + dropped.length + ' 条');
        }
        ensureTimers();
        return true;
    } catch (e) {
        if (typeof logger !== 'undefined') logger.error('[LogStore] 追加日志失败: ' + e.message);
        return false;
    }
}

/** 将缓冲区中的数据按日期写入文件，失败的数据回队等待下次重试 */
function flush() {
    if (_pending.length === 0) return;
    const batch = _pending.splice(0, _pending.length);
    const groups = {};
    const order = [];
    batch.forEach(function(item) {
        if (!groups[item.date]) { groups[item.date] = []; order.push(item.date); }
        groups[item.date].push(item);
    });

    const today = formatDate(new Date());
    order.forEach(function(dateStr) {
        const items = groups[dateStr];
        const lines = items.map(function(item) { return item.line; });
        try {
            fs.writeSync(getFd(dateStr), lines.join('\n') + '\n');
        } catch (e) {
            requeue(items);
            if (typeof logger !== 'undefined') logger.error('[LogStore] 写入日志失败(' + dateStr + '): ' + e.message);
        }
        if (dateStr !== today) closeFd(dateStr);
    });
}

/** 读取指定日期的全部日志条目，文件不存在返回空数组 */
function readEntries(dateStr) {
    const p = filePathForDate(dateStr);
    if (!p) return [];
    try {
        if (!fs.existsSync(p)) return [];
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n');
        const entries = [];
        let bad = 0;
        lines.forEach(function(line) {
            if (!line.trim()) return;
            try {
                const entry = JSON.parse(line);
                if (entry && typeof entry === 'object') entries.push(entry);
            } catch (e) {
                bad++;
            }
        });
        if (bad > 0 && typeof logger !== 'undefined') logger.warn('[LogStore] ' + dateStr + ' 有 ' + bad + ' 行解析失败');
        return entries;
    } catch (e) {
        if (typeof logger !== 'undefined') logger.warn('[LogStore] 读取日志失败(' + dateStr + '): ' + e.message);
        return [];
    }
}

/** 获取所有有日志的日期列表，按日期倒序排列 */
function listDates() {
    try {
        ensureDir();
        return fs.readdirSync(LOG_DIR)
            .filter(function(f) { return /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f); })
            .map(function(f) { return f.replace('.jsonl', ''); })
            .sort()
            .reverse();
    } catch (e) {
        return [];
    }
}

/** 判断事件名是否匹配指定值，以 . 结尾表示前缀匹配 */
function matchesEvent(event, match) {
    const name = String(event || '');
    const target = String(match || '');
    if (!target) return true;
    if (target.charAt(target.length - 1) === '.') return name.indexOf(target) === 0;
    return name === target;
}

/**
 * 获取包含指定事件的日期列表，按日期倒序排列
 * @param {string} match - 事件名，如 chat；以 . 结尾表示前缀匹配，如 admin.
 * @returns {string[]}
 */
function datesWithEvent(match) {
    const dates = listDates();
    const result = [];
    dates.forEach(function(dateStr) {
        const p = filePathForDate(dateStr);
        let mtime = 0;
        let size = 0;
        try {
            const stat = fs.statSync(p);
            mtime = stat.mtimeMs;
            size = stat.size;
        } catch (e) { return; }
        const key = dateStr + '|' + match + '|' + mtime + '|' + size;
        if (Object.prototype.hasOwnProperty.call(_eventDateCache, key)) {
            if (_eventDateCache[key]) result.push(dateStr);
            return;
        }
        let matched = false;
        try {
            const content = fs.readFileSync(p, 'utf-8');
            const lines = content.split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (!line) continue;
                try {
                    const entry = JSON.parse(line);
                    if (matchesEvent(entry.event, match)) { matched = true; break; }
                } catch (e) { /* 跳过无效行 */ }
            }
        } catch (e) {
            matched = false;
        }
        _eventDateCache[key] = matched;
        if (matched) result.push(dateStr);
    });
    return result;
}

/** 将本地时间字符串转换为毫秒时间戳，格式非法返回 0 */
function parseTimeToMillis(timeStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(timeStr || ''));
    if (!m) return 0;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

/** 刷盘、落盘并关闭所有句柄，停止定时器 */
function shutdown() {
    _stopped = true;
    if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
    if (_fsyncTimer) { clearInterval(_fsyncTimer); _fsyncTimer = null; }
    flush();
    Object.keys(_fds).forEach(function(dateStr) {
        try { fs.fsyncSync(_fds[dateStr]); } catch (e) { /* 忽略落盘失败 */ }
        closeFd(dateStr);
    });
}

module.exports = {
    LEVELS: LEVELS,
    DEFAULT_LEVEL: DEFAULT_LEVEL,
    normalizeLevel: normalizeLevel,
    init: init,
    append: append,
    flush: flush,
    readEntries: readEntries,
    listDates: listDates,
    datesWithEvent: datesWithEvent,
    matchesEvent: matchesEvent,
    parseTimeToMillis: parseTimeToMillis,
    formatDate: formatDate,
    formatTime: formatTime,
    shutdown: shutdown
};
