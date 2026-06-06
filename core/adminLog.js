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
 * NECE 管理员操作审计日志模块
 * 记录管理员在Web面板和游戏内的所有操作，按日期分文件存储，支持分页查询
 */


const fs = require('fs');
const pathModule = require('path');

const LOG_DIR = pathModule.join(__dirname, '..', 'logs');
const ADMIN_LOG_DIR = pathModule.join(LOG_DIR, 'admin');

/** 确保目录存在，不存在则递归创建 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(ADMIN_LOG_DIR);

/**
 * 获取当天日志文件路径，格式：logs/admin/YYYY-MM-DD.log
 * @returns {string} 日志文件绝对路径
 */
function getLogFile() {
    let now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return pathModule.join(ADMIN_LOG_DIR, y + '-' + m + '-' + d + '.log');
}

/**
 * 写入一条管理员操作日志
 * 日志格式：[时间] 管理员[uid] 动作 目标[xxx] 详情: xxx
 * @param {string} adminUid - 管理员XUID或标识
 * @param {string} action - 操作类型（如"封禁玩家"、"修改商店"）
 * @param {string} [target] - 操作目标（可选）
 * @param {string} [detail] - 操作详情（可选）
 */
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
            if (e) logger.error('[AdminLog] 写入日志失败: ' + e.message);
        });
    } catch (e) {
        logger.error('[AdminLog] 写入日志失败: ' + e.message);
    }
}

/**
 * 按日期分页查询管理员日志，结果按时间倒序排列
 * @param {string} [date] - 查询日期，格式YYYY-MM-DD，默认今天
 * @param {number} [page=1] - 页码
 * @param {number} [pageSize=50] - 每页条数
 * @returns {{entries: Array, pagination: Object, date: string}} 日志条目和分页信息
 */
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

        // 倒序排列，最新的日志在前
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

/**
 * 解析单行日志文本为结构化对象
 * @param {string} line - 原始日志行
 * @returns {{raw: string, time: string, admin: string, action: string, target: string, detail: string}}
 */
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

    // 优先从"管理员xxx 动作 目标"格式中提取action
    const actionMatch = line.match(/\] ([^\[]+) 目标/);
    if (actionMatch) {
        result.action = actionMatch[1].trim();
    } else {
        // 无目标字段时，取管理员标签之后、详情之前的内容作为action
        let afterAdmin = line.replace(/.*管理员\[[^\]]+\]\s*/, '');
        afterAdmin = afterAdmin.replace(/详情:.*$/, '').trim();
        if (afterAdmin) result.action = afterAdmin;
    }

    return result;
}

/**
 * 获取所有有日志记录的日期列表，按日期倒序排列
 * @returns {string[]} 日期字符串数组，格式YYYY-MM-DD
 */
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
