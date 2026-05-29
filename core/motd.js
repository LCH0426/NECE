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
 * NLCE 动态 MOTD 模块
 * 定时轮换 MOTD 字符串，支持占位符替换
 *
 * 支持的占位符：
 *   {online}  - 当前在线人数
 *   {max}     - 服务器最大人数
 *   {tps}     - 当前 TPS
 */

let _config = null;
let _timer = null;
let _currentIndex = 0;

/**
 * 初始化动态 MOTD 模块
 * @param {object} config - 配置对象，需提供 get 方法
 */
function init(config) {
    _config = config;
}

/**
 * 启动 MOTD 轮换定时器
 */
function start() {
    if (!_config) return;

    var motdCfg = _config.get('motdConfig', {});
    if (!motdCfg.enabled) return;

    var lines = motdCfg.lines;
    if (!lines || lines.length === 0) return;

    var interval = (motdCfg.interval || 10) * 1000;
    if (interval < 1000) interval = 1000;

    // 立即设置一次
    applyMotd(lines);

    _timer = setInterval(function() {
        applyMotd(lines);
    }, interval);
}

/**
 * 停止 MOTD 轮换
 */
function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

/**
 * 应用当前 MOTD 并轮换到下一条
 * @param {string[]} lines - MOTD 行列表
 */
function applyMotd(lines) {
    try {
        if (!lines || lines.length === 0) return;

        var motd = lines[_currentIndex % lines.length];
        _currentIndex = (_currentIndex + 1) % lines.length;

        // 替换占位符
        motd = replacePlaceholders(motd);

        mc.setMotd(motd);
    } catch (e) {
        // 静默处理，避免影响服务器运行
    }
}

/**
 * 替换 MOTD 中的占位符
 * @param {string} motd - 原始 MOTD 字符串
 * @returns {string} 替换后的 MOTD
 */
function replacePlaceholders(motd) {
    try {
        var onlinePlayers = mc.getOnlinePlayers();
        var online = onlinePlayers ? onlinePlayers.length : 0;
        motd = motd.replace(/\{online\}/g, String(online));
    } catch (e) {
        motd = motd.replace(/\{online\}/g, '?');
    }

    try {
        motd = motd.replace(/\{max\}/g, String(mc.getMaxPlayers()));
    } catch (e) {
        motd = motd.replace(/\{max\}/g, '?');
    }

    try {
        // 尝试从 serverStats 获取 TPS
        var tps = mc.getTPS ? mc.getTPS() : null;
        motd = motd.replace(/\{tps\}/g, tps !== null ? String(tps) : '?');
    } catch (e) {
        motd = motd.replace(/\{tps\}/g, '?');
    }

    return motd;
}

/**
 * 热更新：停止旧定时器，重新从配置启动
 */
function reload() {
    stop();
    _currentIndex = 0;
    start();
}

module.exports = {
    init: init,
    start: start,
    stop: stop,
    reload: reload
};
