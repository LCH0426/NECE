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
 * NECE 工具函数
 * 提供时间格式化、目录创建、文件操作等通用工具方法
 */


const fs = require('fs');
const pathModule = require('path');

/**
 * 确保文件所在目录存在，不存在则递归创建
 * @param {string} filePath - 目标文件路径
 */
function ensureDir(filePath) {
    const dir = pathModule.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * 将秒数格式化为可读的中文时间字符串（如"1天2小时3分4秒"）
 * @param {number} totalSeconds - 总秒数
 * @returns {string} 格式化后的时间文本
 */
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

/** 获取当前时间的点分隔字符串 */
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

/** 判断字符串是否为正整数 */
function isInteger(num) {
    return /^[0-9]*[1-9][0-9]*$/.test(num);
}

/**
 * 检测给定 IP 地址是否为 IPv6 格式
 * @param {string} ip - IP 地址字符串
 * @returns {boolean}
 */
function detectIPv6(ip) {
    if (!ip) return false;
    if (ip.includes(":") && !ip.includes(".")) return true;
    if (ip.includes("::")) return true;
    if (/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(ip)) return true;
    if (/^([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*)?::([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*)?$/.test(ip)) return true;
    return false;
}

/**
 * 去除 IP 地址中的端口号，支持 IPv4 和 IPv6（方括号）格式
 * @param {string} ip - 可能带端口的 IP 地址
 * @returns {string} 纯 IP 地址
 */
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

/**
 * 根据 IP 地址判断网络类型（内网/公网IPv4/公网IPv6/中续转发/未知）
 * @param {string} ip - IP 地址
 * @returns {string} 网络类型中文描述
 */
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

/** 移除 Minecraft 格式化代码 */
function cleanFormatting(text) {
    return text.replace(/\u00A7[0-9a-fk-or]/g, "");
}

/**
 * 递归同步复制整个目录
 * @param {string} src - 源目录路径
 * @param {string} dest - 目标目录路径
 */
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

/** 递归删除目录及其所有内容 */
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

/**
 * 安全传送玩家到指定坐标
 * 优先使用 API 传送，失败时回退到 /tp 命令
 * @param {Player} player - 玩家对象
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} z - Z坐标
 * @param {number} dim - 维度ID
 * @returns {boolean} 是否成功
 */
function safeTeleport(player, x, y, z, dim) {
    try {
        player.teleport(new FloatPos(x, y, z, dim));
        return true;
    } catch (e) {
        try {
            player.runcmd('tp ' + x + ' ' + y + ' ' + z);
            return true;
        } catch (e2) {
            return false;
        }
    }
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
    rmrf,
    safeTeleport
};
