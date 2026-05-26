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

const fs = require('fs');
const pathModule = require('path');
const csv = require('csv-parser');

var LOG_DIR = pathModule.join(__dirname, '..', 'logs', 'behavior');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(LOG_DIR);

var ACTION_LABELS = {
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

var _CSV_BOM = '\ufeff时间,维度,来源,X,Y,Z,事件,目标,x,y,z,附加信息';

var _pendingLines = [];
var _activeFd = null;
var _activeDate = '';

function todayStamp() {
    var now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

function filePathForDate(stamp) {
    return pathModule.join(LOG_DIR, 'actions-' + stamp + '.csv');
}

function ensureFileOpen() {
    var stamp = todayStamp();
    if (_activeDate === stamp && _activeFd) return;

    if (_activeFd) {
        try { fs.closeSync(_activeFd); } catch (e) {}
    }

    _activeDate = stamp;
    var p = filePathForDate(stamp);
    var fresh = !fs.existsSync(p);

    _activeFd = fs.openSync(p, 'a');

    if (fresh) {
        fs.writeSync(_activeFd, _CSV_BOM + '\n');
    }
}

function sanitizeCsvField(val) {
    if (val === undefined || val === null) return '';
    var s = String(val);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function appendEntry(rec) {
    var now = new Date();
    var ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

    var line = sanitizeCsvField(ts) + ',' + sanitizeCsvField(rec.dim) + ',' + sanitizeCsvField(rec.source) + ',' + sanitizeCsvField(rec.sx) + ',' + sanitizeCsvField(rec.sy) + ',' + sanitizeCsvField(rec.sz)
        + ',' + sanitizeCsvField(rec.action) + ',' + sanitizeCsvField(rec.target) + ',' + sanitizeCsvField(rec.tx) + ',' + sanitizeCsvField(rec.ty) + ',' + sanitizeCsvField(rec.tz) + ',' + sanitizeCsvField(rec.detail);

    _pendingLines.push(line);
}

function drainBuffer() {
    if (_pendingLines.length === 0) return;

    try {
        ensureFileOpen();

        var batch = _pendingLines.splice(0, _pendingLines.length);
        var content = batch.join('\n') + '\n';
        fs.writeSync(_activeFd, content);
    } catch (e) {
        console.error('[ActionLog] 写入失败:', e.message);
    }
}

function rotateIfNeeded() {
    var stamp = todayStamp();
    if (stamp !== _activeDate) {
        drainBuffer();
        if (_activeFd) {
            try { fs.closeSync(_activeFd); } catch (e) {}
            _activeFd = null;
        }
        _activeDate = '';
        ensureFileOpen();
    }
}

function init() {
    ensureFileOpen();

    setInterval(function() {
        rotateIfNeeded();
        drainBuffer();
    }, 1000);

    setInterval(function() {
        try {
            if (_activeFd) {
                fs.fsyncSync(_activeFd);
            }
        } catch (e) {}
    }, 30000);
}

function labelOf(eventKey) {
    return ACTION_LABELS[eventKey] || eventKey;
}

function availableDates() {
    try {
        ensureDir(LOG_DIR);
        var files = fs.readdirSync(LOG_DIR);
        return files
            .filter(function(f) { return f.startsWith('actions-') && f.endsWith('.csv'); })
            .map(function(f) { return f.replace('actions-', '').replace('.csv', ''); })
            .sort()
            .reverse();
    } catch (e) {
        return [];
    }
}

function actionTypes() {
    return Object.keys(ACTION_LABELS).map(function(key) {
        return { key: key, name: ACTION_LABELS[key] };
    });
}

function queryLogs(options) {
    return new Promise(function(resolve, reject) {
        var date = options.date || '';
        var player = (options.player || '').trim().toLowerCase();
        var eventType = (options.eventType || '').trim();
        var page = parseInt(options.page) || 1;
        var pageSize = parseInt(options.pageSize) || 50;

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

        var logPath = filePathForDate(date);

        if (!fs.existsSync(logPath)) {
            resolve({
                entries: [],
                pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 },
                date: date
            });
            return;
        }

        var results = [];
        var headers = ['时间', '维度', '来源', 'X', 'Y', 'Z', '事件', '目标', 'x', 'y', 'z', '附加信息'];

        fs.createReadStream(logPath, { encoding: 'utf-8' })
            .pipe(csv({ headers: headers, skipLines: 1, separator: ',' }))
            .on('data', function(row) {
                if (player) {
                    var source = (row['来源'] || '').toLowerCase();
                    var target = (row['目标'] || '').toLowerCase();
                    if (source.indexOf(player) === -1 && target.indexOf(player) === -1) {
                        return;
                    }
                }

                if (eventType) {
                    var event = row['事件'] || '';
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
                results.reverse();

                var total = results.length;
                var totalPages = Math.ceil(total / pageSize);
                var start = (page - 1) * pageSize;
                var end = start + pageSize;
                var paged = results.slice(start, end);

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
