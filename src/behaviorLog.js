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
 * NECE 玩家行为日志模块
 * 记录玩家的方块放置/破坏、击杀、死亡、物品操作等行为事件
 * 日志以 CSV 格式按日期分文件存储，使用内存缓冲区批量写入以提升性能
 */


const D = require('./debug');
const fs = require('fs');
const pathModule = require('path');
const csv = require('csv-parser');

const LOG_DIR = pathModule.join(__dirname, '..', 'logs', 'behavior');

/** 确保目录不存在时递归创建 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(LOG_DIR);

// 事件类型中文标签映射
const ACTION_LABELS = {
    onPreJoin: '开始进服',
    onJoin: '进入服务器',
    onLeft: '离开服务器',
    onPlayerDie: '玩家死亡',
    onPlayerCmd: '玩家执行命令',
    onChat: '发送对话',
    onUseItem: '使用物品',
    onUseItemOn: '使用物品点击方块',
    onTakeItem: '捡起物品',
    onDropItem: '丢出物品',
    onStartDestroyBlock: '开始破坏方块',
    onDestroyBlock: '破坏方块',
    onPlaceBlock: '放置方块',
    onOpenContainer: '打开容器',
    onCloseContainer: '关闭容器',
    onInventoryOut: '物品栏 取出物品',
    onInventoryIn: '物品栏 放入物品',
    onContainerOut: '容器 取出物品',
    onContainerIn: '容器 放入物品',
    onExplode: '爆炸',
    onBedExplode: '床爆炸',
    onRespawnAnchorExplode: '重生锚爆炸',
    onBlockExploded: '方块被爆炸破坏'
};

// CSV 文件 BOM 头 + 中文列名表头（Excel 兼容）
const _CSV_BOM = '﻿时间,维度,来源,X,Y,Z,事件,目标,x,y,z,附加信息';

// 写入缓冲区，累积多条记录后批量刷盘
const _pendingLines = [];
let _activeFd = null;   // 当前打开的文件描述符
let _activeDate = '';   // 当前文件对应的日期

/** 获取当前日期字符串 (YYYY-MM-DD) */
function todayStamp() {
    let now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

/** 根据日期生成日志文件路径 */
function filePathForDate(stamp) {
    return pathModule.join(LOG_DIR, 'actions-' + stamp + '.csv');
}

/**
 * 确保当天的日志文件已打开
 * 跨天时自动关闭旧文件并打开新文件，新文件写入 CSV 表头
 */
function ensureFileOpen() {
    let stamp = todayStamp();
    if (_activeDate === stamp && _activeFd) return;

    if (_activeFd) {
        try { fs.closeSync(_activeFd); } catch (e) { if (e && e.message) logger.warn('[BehaviorLog] ' + e.message); }
    }

    _activeDate = stamp;
    const p = filePathForDate(stamp);
    const fresh = !fs.existsSync(p);  // 新文件才需要写表头

    _activeFd = fs.openSync(p, 'a');

    if (fresh) {
        fs.writeSync(_activeFd, _CSV_BOM + '\n');
    }
}

/**
 * 对 CSV 字段进行安全处理：含逗号/引号/换行时用引号包裹，引号转义为双引号
 * @param {*} val - 字段值
 * @returns {string} 安全的 CSV 字段字符串
 */
function sanitizeCsvField(val) {
    if (val === undefined || val === null) return '';
    const s = String(val);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * 将一条行为记录追加到写入缓冲区（不立即写盘）
 * @param {Object} rec - {dim, source, sx, sy, sz, action, target, tx, ty, tz, detail}
 */
function appendEntry(rec) {
    const now = new Date();
    const ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

    const line = sanitizeCsvField(ts) + ',' + sanitizeCsvField(rec.dim) + ',' + sanitizeCsvField(rec.source) + ',' + sanitizeCsvField(rec.sx) + ',' + sanitizeCsvField(rec.sy) + ',' + sanitizeCsvField(rec.sz)
        + ',' + sanitizeCsvField(rec.action) + ',' + sanitizeCsvField(rec.target) + ',' + sanitizeCsvField(rec.tx) + ',' + sanitizeCsvField(rec.ty) + ',' + sanitizeCsvField(rec.tz) + ',' + sanitizeCsvField(rec.detail);

    _pendingLines.push(line);
}

/**
 * 将缓冲区中的所有记录一次性写入文件
 * 使用 splice 一次性取出所有待写入行，避免并发追加丢失
 */
function drainBuffer() {
    if (_pendingLines.length === 0) return;

    try {
        ensureFileOpen();

        const batch = _pendingLines.splice(0, _pendingLines.length);
        const content = batch.join('\n') + '\n';
        fs.writeSync(_activeFd, content);
    } catch (e) {
        logger.error('[BehaviorLog] 写入失败: ' + e.message);
    }
}

/** 检查日期变化，跨天时刷盘关闭旧文件并打开新文件 */
function rotateIfNeeded() {
    const stamp = todayStamp();
    if (stamp !== _activeDate) {
        drainBuffer();
        if (_activeFd) {
            try { fs.closeSync(_activeFd); } catch (e) { if (e && e.message) logger.warn('[BehaviorLog] ' + e.message); }
            _activeFd = null;
        }
        _activeDate = '';
        ensureFileOpen();
    }
}

/**
 * 初始化行为日志模块，启动定时刷盘和事件监听
 * 每秒检查日志轮转并刷缓冲区，每30秒强制 fsync 防数据丢失
 */
function init() {
	D.debugLogModule('behaviorLog')('init: 初始化完成');
    ensureFileOpen();

    // 每秒批量写入缓冲区，同时检查跨天轮转
    setInterval(function() {
        rotateIfNeeded();
        drainBuffer();
    }, 1000);

    // 每30秒强制 fsync 确保数据落盘
    setInterval(function() {
        try {
            if (_activeFd) {
                fs.fsyncSync(_activeFd);
            }
        } catch (e) { if (e && e.message) logger.warn('[BehaviorLog] ' + e.message); }
    }, 30000);

    registerEventListeners();
}

/**
 * 安全获取玩家坐标，防止玩家对象无效时崩溃
 * @param {Player} pl
 * @returns {Object|null} 坐标对象或 null
 */
function safePlayerPos(pl) {
    try {
        if (!pl) return null;
        let pos = pl.pos;
        if (!pos || typeof pos.x !== 'number') return null;
        return pos;
    } catch(e) {
        return null;
    }
}

/**
 * 安全获取方块坐标
 * @param {Block} bl
 * @returns {Object|null}
 */
function safeBlockPos(bl) {
    try {
        if (!bl) return null;
        let pos = bl.pos;
        if (!pos || typeof pos.x !== 'number') return null;
        return pos;
    } catch(e) {
        return null;
    }
}

/**
 * 将坐标格式化为整数字符串，null 坐标返回空字符串
 * @param {Object|null} pos
 * @returns {{sx: string, sy: string, sz: string}}
 */
function fmtCoord(pos) {
    if (!pos) return { sx: '', sy: '', sz: '' };
    return { sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0) };
}

/** 注册所有游戏事件监听器，每个事件记录对应的行为日志 */
function registerEventListeners() {
    mc.listen("onPreJoin", function(pl) {
        try {
            appendEntry({ action: labelOf('onPreJoin'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: '', tx: '', ty: '', tz: '', detail: 'xuid=' + pl.xuid });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onJoin", function(pl) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onJoin'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: '', tx: '', ty: '', tz: '', detail: 'xuid=' + pl.xuid });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onLeft", function(pl) {
        try {
            appendEntry({ action: labelOf('onLeft'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: '', tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onPlayerDie", function(pl) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onPlayerDie'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: '', tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onPlayerCmd", function(pl, cmd) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onPlayerCmd'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: cmd, tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onChat", function(pl, msg) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onChat'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: msg, tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onUseItem", function(pl, it) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onUseItem'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: it.name, tx: '', ty: '', tz: '', detail: '类型:' + it.type });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onUseItemOn", function(pl, it, bl) {
        try {
            let pos = safePlayerPos(pl);
            let blPos = safeBlockPos(bl);
            if (!pos) return;
            let c = fmtCoord(pos);
            let bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onUseItemOn'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '使用物品:' + it.name + ' 类型:' + it.type });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onTakeItem", function(pl, en, it) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onTakeItem'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: it.name, tx: '', ty: '', tz: '', detail: '数量:' + it.count });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onDropItem", function(pl, it) {
        try {
            let pos = safePlayerPos(pl);
            if (!pos) return;
            let c = fmtCoord(pos);
            appendEntry({ action: labelOf('onDropItem'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: it.name, tx: '', ty: '', tz: '', detail: '数量:' + it.count });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onStartDestroyBlock", function(pl, bl) {
        try {
            let pos = safePlayerPos(pl);
            let blPos = safeBlockPos(bl);
            if (!pos) return;
            let c = fmtCoord(pos);
            let bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onStartDestroyBlock'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onDestroyBlock", function(pl, bl) {
        try {
            let pos = safePlayerPos(pl);
            let blPos = safeBlockPos(bl);
            if (!pos) return;
            let c = fmtCoord(pos);
            let bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onDestroyBlock'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onPlaceBlock", function(pl, bl) {
        try {
            let pos = safePlayerPos(pl);
            let blPos = safeBlockPos(bl);
            if (!pos) return;
            let c = fmtCoord(pos);
            let bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onPlaceBlock'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onOpenContainer", function(pl, bl) {
        try {
            let pos = safePlayerPos(pl);
            let blPos = safeBlockPos(bl);
            if (!pos) return;
            let c = fmtCoord(pos);
            let bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onOpenContainer'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onCloseContainer", function(pl, bl) {
        try {
            const pos = safePlayerPos(pl);
            let blPos = safeBlockPos(bl);
            if (!pos) return;
            const c = fmtCoord(pos);
            let bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onCloseContainer'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    // 物品栏变动：oldItem有/newItem无=取出，oldItem无/newItem有=放入
    mc.listen("onInventoryChange", function(pl, slotNum, oldItem, newItem) {
        try {
            if (oldItem && !newItem) {
                appendEntry({ action: labelOf('onInventoryOut'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: oldItem.name, tx: '', ty: '', tz: '', detail: '数量:' + oldItem.count + ' 槽位:' + slotNum });
            } else if (!oldItem && newItem) {
                appendEntry({ action: labelOf('onInventoryIn'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: newItem.name, tx: '', ty: '', tz: '', detail: '数量:' + newItem.count + ' 槽位:' + slotNum });
            }
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    // 容器变动：按方块坐标记录
    mc.listen("onContainerChange", function(bl, slotNum, oldItem, newItem) {
        try {
            let blPos = safeBlockPos(bl);
            let bc = fmtCoord(blPos);
            if (oldItem && !newItem) {
                appendEntry({ action: labelOf('onContainerOut'), dim: blPos ? String(blPos.dim) : '', source: '', sx: '', sy: '', sz: '', target: oldItem.name, tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '数量:' + oldItem.count + ' 槽位:' + slotNum });
            } else if (!oldItem && newItem) {
                appendEntry({ action: labelOf('onContainerIn'), dim: blPos ? String(blPos.dim) : '', source: '', sx: '', sy: '', sz: '', target: newItem.name, tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '数量:' + newItem.count + ' 槽位:' + slotNum });
            }
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onExplode", function(source, pos) {
        try {
            if (!pos) return;
            appendEntry({ action: labelOf('onExplode'), dim: String(pos.dim), source: source || '', sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0), target: '', tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onBedExplode", function(pos) {
        try {
            if (!pos) return;
            appendEntry({ action: labelOf('onBedExplode'), dim: String(pos.dim), source: '', sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0), target: '', tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onRespawnAnchorExplode", function(pos) {
        try {
            if (!pos) return;
            appendEntry({ action: labelOf('onRespawnAnchorExplode'), dim: String(pos.dim), source: '', sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0), target: '', tx: '', ty: '', tz: '', detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });

    mc.listen("onBlockExploded", function(bl, source) {
        try {
            const blPos = safeBlockPos(bl);
            const bc = fmtCoord(blPos);
            appendEntry({ action: labelOf('onBlockExploded'), dim: blPos ? String(blPos.dim) : '', source: source || '', sx: '', sy: '', sz: '', target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
        } catch(e) { if (e && e.message) logger.warn('[BehaviorLog] 事件记录异常: ' + e.message); }
    });
}

/**
 * 获取事件类型对应的中文标签
 * @param {string} eventKey - 事件键名，如 "onJoin"
 * @returns {string} 中文标签，如 "进入服务器"
 */
function labelOf(eventKey) {
    return ACTION_LABELS[eventKey] || eventKey;
}

/**
 * 获取所有有日志的日期列表（降序排列）
 * @returns {string[]}
 */
function availableDates() {
    try {
        ensureDir(LOG_DIR);
        const files = fs.readdirSync(LOG_DIR);
        return files
            .filter(function(f) { return f.startsWith('actions-') && f.endsWith('.csv'); })
            .map(function(f) { return f.replace('actions-', '').replace('.csv', ''); })
            .sort()
            .reverse();
    } catch (e) {
        return [];
    }
}

/**
 * 获取所有支持的事件类型列表
 * @returns {Array<{key: string, name: string}>}
 */
function actionTypes() {
    return Object.keys(ACTION_LABELS).map(function(key) {
        return { key: key, name: ACTION_LABELS[key] };
    });
}

/**
 * 查询行为日志，支持按日期、玩家名、事件类型筛选和分页
 * 使用 csv-parser 流式读取 CSV 文件，适合大文件
 * @param {Object} options - {date, player, eventType, page, pageSize}
 * @returns {Promise<{entries, pagination, date}>}
 */
function queryLogs(options) {
    return new Promise(function(resolve, reject) {
        let date = options.date || '';
        const player = (options.player || '').trim().toLowerCase();
        const eventType = (options.eventType || '').trim();
        const page = parseInt(options.page) || 1;
        const pageSize = parseInt(options.pageSize) || 50;

        // 未指定日期时默认取最新一天
        if (!date) {
            date = availableDates()[0] || '';
        }

        if (!date) {
            resolve({
                entries: [],
                pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 },
                date: ''
            });
            return;
        }

        const logPath = filePathForDate(date);

        if (!fs.existsSync(logPath)) {
            resolve({
                entries: [],
                pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 },
                date: date
            });
            return;
        }

        const results = [];
        const headers = ['时间', '维度', '来源', 'X', 'Y', 'Z', '事件', '目标', 'x', 'y', 'z', '附加信息'];

        fs.createReadStream(logPath, { encoding: 'utf-8' })
            .pipe(csv({ headers: headers, skipLines: 1, separator: ',' }))
            .on('data', function(row) {
                // 玩家名模糊匹配（来源和目标字段）
                if (player) {
                    const source = (row['来源'] || '').toLowerCase();
                    const target = (row['目标'] || '').toLowerCase();
                    if (source.indexOf(player) === -1 && target.indexOf(player) === -1) {
                        return;
                    }
                }

                // 事件类型精确匹配
                if (eventType) {
                    const event = row['事件'] || '';
                    if (event !== eventType) {
                        return;
                    }
                }

                results.push({
                    time: row['时间'] || '',
                    dim: row['维度'] || '',
                    source: row['来源'] || '',
                    x: row['X'] || '',
                    y: row['Y'] || '',
                    z: row['Z'] || '',
                    event: row['事件'] || '',
                    target: row['目标'] || '',
                    tx: row['x'] || '',
                    ty: row['y'] || '',
                    tz: row['z'] || '',
                    extra: row['附加信息'] || ''
                });
            })
            .on('end', function() {
                // 读取完成后按时间降序排列
                results.reverse();

                const total = results.length;
                const totalPages = Math.ceil(total / pageSize);
                const start = (page - 1) * pageSize;
                const end = start + pageSize;
                const paged = results.slice(start, end);

                resolve({
                    entries: paged,
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    },
                    date: date
                });
            })
            .on('error', function(err) {
                resolve({
                    entries: [],
                    pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 },
                    date: date
                });
            });
    });
}

module.exports = {
    init: init,
    appendEntry: appendEntry,
    labelOf: labelOf,
    availableDates: availableDates,
    actionTypes: actionTypes,
    queryLogs: queryLogs,
    LOG_DIR: LOG_DIR
};
