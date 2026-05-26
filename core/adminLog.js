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
 * NLCE 管理员操作审计日志模块
 * 记录管理员在Web面板和游戏内的所有操作，支持按日期查询
 */


const fs = require('fs');
const pathModule = require('path');

const LOG_DIR = pathModule.join(__dirname, '..', 'logs');
const ADMIN_LOG_DIR = pathModule.join(LOG_DIR, 'admin');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(ADMIN_LOG_DIR);

function getLogFile() {
    let now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return pathModule.join(ADMIN_LOG_DIR, y + '-' + m + '-' + d + '.log');
}

function log(adminUid, action, target, detail) {
    try {
        let now = new Date();
        const timeStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');

        let line = '[' + timeStr + '] 管理员[' + adminUid + '] ' + action;
        if (target) line += ' 目标[' + target + ']';
        if (detail) line += ' 详情: ' + detail;
        line += '\n';

        let file = getLogFile();
        fs.appendFile(file, line, 'utf-8', function(e) {
            if (e) console.error('写入日志失败:', e.message);
        });
    } catch (e) {
        console.error('写入日志失败:', e.message);
    }
}

function getLogs(date, page, pageSize) {
    try {
        if (!date) {
            const now = new Date();
            date = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
        }

        const file = pathModule.join(ADMIN_LOG_DIR, date + '.log');
        if (!fs.existsSync(file)) {
            return { entries: [], pagination: { page: page || 1, pageSize: pageSize || 50, total: 0, totalPages: 0 } };
        }

        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n').filter(function(l) { return l.trim().length > 0; });

        lines.reverse();

        const total = lines.length;
        const p = page || 1;
        const ps = pageSize || 50;
        const totalPages = Math.ceil(total / ps);
        const start = (p - 1) * ps;
        const end = start + ps;
        const paged = lines.slice(start, end);

        const entries = paged.map(function(line) {
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
    const result = { raw: line, time: '', admin: '', action: '', target: '', detail: '' };

    const timeMatch = line.match(/^\[([^\]]+)\]/);
    if (timeMatch) result.time = timeMatch[1];

    const adminMatch = line.match(/管理员\[([^\]]+)\]/);
    if (adminMatch) result.admin = adminMatch[1];

    const targetMatch = line.match(/目标\[([^\]]+)\]/);
    if (targetMatch) result.target = targetMatch[1];

    const detailMatch = line.match(/详情: (.+)$/);
    if (detailMatch) result.detail = detailMatch[1];

    const actionMatch = line.match(/\] ([^\[]+) 目标/);
    if (actionMatch) {
        result.action = actionMatch[1].trim();
    } else {
        let afterAdmin = line.replace(/.*管理员\[[^\]]+\]\s*/, '');
        afterAdmin = afterAdmin.replace(/详情:.*$/, '').trim();
        if (afterAdmin) result.action = afterAdmin;
    }

    return result;
}

function getAvailableDates() {
    try {
        ensureDir(ADMIN_LOG_DIR);
        const files = fs.readdirSync(ADMIN_LOG_DIR);
        const dates = files
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
