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
 * NLCE 聊天记录日志模块
 * 持久化存储聊天记录，支持按日期查询和Web面板查看
 */


var D = require('./debug');
const fs = require('fs');
const pathModule = require('path');

var LOG_DIR = pathModule.join(__dirname, '..', 'logs');
var CHAT_LOG_DIR = pathModule.join(LOG_DIR, 'chat');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(CHAT_LOG_DIR);

var currentLogFile = null;
var currentLogDate = '';

function getTodayDate() {
    var now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

function getLogPath(dateStr) {
    return pathModule.join(CHAT_LOG_DIR, 'chat-' + dateStr + '.jsonl');
}

function openLogFile() {
    var today = getTodayDate();
    if (currentLogDate === today && currentLogFile) return;

    if (currentLogFile) {
        try { fs.closeSync(currentLogFile); } catch (e) {}
    }

    currentLogDate = today;
    var logPath = getLogPath(today);
    currentLogFile = fs.openSync(logPath, 'a');
}

function writeMessage(msg) {
    try {
        openLogFile();
        var line = JSON.stringify({
            time: msg.time,
            sender: msg.sender,
            message: msg.message,
            type: msg.type
        }) + '\n';
        fs.writeSync(currentLogFile, line);
    } catch (e) {
        console.error('[ChatLog] 写入失败:', e.message);
    }
}

function checkDateChange() {
    var today = getTodayDate();
    if (today !== currentLogDate) {
        if (currentLogFile) {
            try { fs.closeSync(currentLogFile); } catch (e) {}
            currentLogFile = null;
        }
        currentLogDate = '';
        openLogFile();
    }
}

function init() {
	D.debugLogModule('chatLog')('init: 初始化完成');
    openLogFile();

    setInterval(function() {
        checkDateChange();
    }, 30000);

    setInterval(function() {
        try {
            if (currentLogFile) {
                fs.fsyncSync(currentLogFile);
            }
        } catch (e) {}
    }, 30000);
}

function getAvailableDates() {
    try {
        ensureDir(CHAT_LOG_DIR);
        var files = fs.readdirSync(CHAT_LOG_DIR);
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
    return new Promise(function(resolve, reject) {
        var date = options.date || '';
        var page = parseInt(options.page) || 1;
        var pageSize = parseInt(options.pageSize) || 100;
        var sender = (options.sender || '').trim().toLowerCase();
        var keyword = (options.keyword || '').trim().toLowerCase();

        if (!date) {
            var now = new Date();
            date = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
        }

        var logPath = getLogPath(date);

        if (!fs.existsSync(logPath)) {
            resolve({
                messages: [],
                pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 },
                date: date
            });
            return;
        }

        var results = [];
        var content = fs.readFileSync(logPath, 'utf-8');
        var lines = content.split('\n').filter(function(l) { return l.trim().length > 0; });

        lines.forEach(function(line) {
            try {
                var msg = JSON.parse(line);

                if (sender && (msg.sender || '').toLowerCase().indexOf(sender) === -1) {
                    return;
                }

                if (keyword && (msg.message || '').toLowerCase().indexOf(keyword) === -1) {
                    return;
                }

                results.push(msg);
            } catch (e) {}
        });

        var total = results.length;
        var totalPages = Math.ceil(total / pageSize);
        var start = (page - 1) * pageSize;
        var end = start + pageSize;
        var paged = results.slice(start, end);

        resolve({
            messages: paged,
            pagination: {
                page: page,
                pageSize: pageSize,
                total: total,
                totalPages: totalPages
            },
            date: date
        });
    });
}

module.exports = {
    init: init,
    writeMessage: writeMessage,
    getAvailableDates: getAvailableDates,
    queryHistory: queryHistory
};
