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
 * NLCE 工具函数
 * 提供时间格式化、目录创建、文件操作等通用工具方法
 */


const fs = require('fs');
const pathModule = require('path');

function ensureDir(filePath) {
    const dir = pathModule.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function formatTime(totalSeconds) {
    totalSeconds = Math.floor(totalSeconds);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let result = "";
    if (days > 0) result += days + "天";
    if (hours > 0) result += hours + "小时";
    if (minutes > 0) result += minutes + "分";
    if (seconds > 0 || result === "") result += seconds + "秒";
    return result;
}

function getCurrentTimeString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    let second = String(now.getSeconds()).padStart(2, '0');
    return year + "." + month + "." + day + "." + hour + "." + minute + "." + second;
}

function isInteger(num) {
    return /^[0-9]*[1-9][0-9]*$/.test(num);
}

function detectIPv6(ip) {
    if (!ip) return false;
    if (ip.includes(":") && !ip.includes(".")) return true;
    if (ip.includes("::")) return true;
    if (/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(ip)) return true;
    if (/^([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*)?::([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*)?$/.test(ip)) return true;
    return false;
}

function stripIpPort(ip) {
    if (!ip) return ip;
    if (ip.startsWith("[") && ip.includes("]:")) {
        return ip.substring(1, ip.indexOf("]"));
    }
    const lastColon = ip.lastIndexOf(":");
    if (lastColon !== -1) {
        const afterColon = ip.substring(lastColon + 1);
        if (/^\d+$/.test(afterColon)) {
            return ip.substring(0, lastColon);
        }
    }
    return ip;
}

function getNetworkType(ip) {
    if (!ip) return "未知";
    ip = stripIpPort(ip);
    if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return "中续转发";
    if (detectIPv6(ip)) return "公网IPv6";
    const parts = ip.split(".");
    if (parts.length === 4) {
        let first = parseInt(parts[0]);
        let second = parseInt(parts[1]);
        if (first === 10) return "内网连接";
        if (first === 172 && second >= 16 && second <= 31) return "内网连接";
        if (first === 192 && second === 168) return "内网连接";
        if (first === 169 && second === 254) return "内网连接";
    }
    return "公网IPv4";
}

function cleanFormatting(text) {
    return text.replace(/\u00A7[0-9a-fk-or]/g, "");
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    let entries = fs.readdirSync(src, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
        let entry = entries[i];
        const srcPath = pathModule.join(src, entry.name);
        const destPath = pathModule.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function rmrf(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const fullPath = pathModule.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            rmrf(fullPath);
        } else {
            fs.unlinkSync(fullPath);
        }
    }
    fs.rmdirSync(dirPath);
}

module.exports = {
    ensureDir,
    formatTime,
    getCurrentTimeString,
    isInteger,
    detectIPv6,
    stripIpPort,
    getNetworkType,
    cleanFormatting,
    copyDirSync,
    rmrf
};
