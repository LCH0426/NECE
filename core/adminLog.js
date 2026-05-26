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

var LOG_DIR = pathModule.join(__dirname, '..', 'logs');
var ADMIN_LOG_DIR = pathModule.join(LOG_DIR, 'admin');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(ADMIN_LOG_DIR);

function getLogFile() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return pathModule.join(ADMIN_LOG_DIR, y + '-' + m + '-' + d + '.log');
}

function log(adminUid, action, target, detail) {
    try {
        var now = new Date();
        var timeStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');

        var line = '[' + timeStr + '] 管理员[' + adminUid + '] ' + action;
        if (target) line += ' 目标[' + target + ']';
        if (detail) line += ' 详情: ' + detail;
        line += '\n';

        var file = getLogFile();
        fs.appendFile(file, line, 'utf-8', function(e) {
            if (e) console.error('[AdminLog] 写入日志失败:', e.message);
        });
    } catch (e) {
        console.error('[AdminLog] 写入日志失败:', e.message);
    }
}

function getLogs(date, page, pageSize) {
    try {
        if (!date) {
            var now = new Date();
            date = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
        }

        var file = pathModule.join(ADMIN_LOG_DIR, date + '.log');
        if (!fs.existsSync(file)) {
            return { entries: [], pagination: { page: page || 1, pageSize: pageSize || 50, total: 0, totalPages: 0 } };
        }

        var content = fs.readFileSync(file, 'utf-8');
        var lines = content.split('\n').filter(function(l) { return l.trim().length > 0; });

        lines.reverse();

        var total = lines.length;
        var p = page || 1;
        var ps = pageSize || 50;
        var totalPages = Math.ceil(total / ps);
        var start = (p - 1) * ps;
        var end = start + ps;
        var paged = lines.slice(start, end);

        var entries = paged.map(function(line) {
            return parseLine(line);
        });

        return {
            entries: entries,
            pagination: {
                page: p,
                pageSize: ps,
                total: total,
                totalPages: totalPages
            },
            date: date
        };
    } catch (e) {
        return { entries: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };
    }
}

function parseLine(line) {
    var result = { raw: line, time: '', admin: '', action: '', target: '', detail: '' };

    var timeMatch = line.match(/^\[([^\]]+)\]/);
    if (timeMatch) result.time = timeMatch[1];

    var adminMatch = line.match(/管理员\[([^\]]+)\]/);
    if (adminMatch) result.admin = adminMatch[1];

    var targetMatch = line.match(/目标\[([^\]]+)\]/);
    if (targetMatch) result.target = targetMatch[1];

    var detailMatch = line.match(/详情: (.+)$/);
    if (detailMatch) result.detail = detailMatch[1];

    var actionMatch = line.match(/\] ([^\[]+) 目标/);
    if (actionMatch) {
        result.action = actionMatch[1].trim();
    } else {
        var afterAdmin = line.replace(/.*管理员\[[^\]]+\]\s*/, '');
        afterAdmin = afterAdmin.replace(/详情:.*$/, '').trim();
        if (afterAdmin) result.action = afterAdmin;
    }

    return result;
}

function getAvailableDates() {
    try {
        ensureDir(ADMIN_LOG_DIR);
        var files = fs.readdirSync(ADMIN_LOG_DIR);
        var dates = files
            .filter(function(f) { return f.endsWith('.log'); })
            .map(function(f) { return f.replace('.log', ''); })
            .sort()
            .reverse();
        return dates;
    } catch (e) {
        return [];
    }
}

module.exports = {
    log,
    getLogs,
    getAvailableDates
};
