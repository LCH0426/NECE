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
 * NLCE Debug 工具模块
 * 所有模块共用的调试日志功能
 */

/** 全局调试模式开关 */
let _debugMode = false;

/** 全局卸载标志 */
let _unloading = false;

/** 设置卸载标志 */
function setUnloading() {
    _unloading = true;
}

/** 查询是否正在卸载 */
function isUnloading() {
    return _unloading;
}

/**
 * 设置调试模式开关
 * @param {boolean} enabled - 是否启用调试日志
 */
function setDebugMode(enabled) {
    _debugMode = !!enabled;
}

/** 查询当前是否处于调试模式 */
function isDebug() {
    return _debugMode;
}

/** 调试日志输出，仅在调试模式下生效（info 级别） */
function debugLog() {
    if (!_debugMode) return;
    let args = ['[DEBUG]'];
    for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.info(args.join(' '));
}

/** 调试警告输出，仅在调试模式下生效（warn 级别） */
function debugWarn() {
    if (!_debugMode) return;
    let args = ['[DEBUG WARN]'];
    for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.warn(args.join(' '));
}

/**
 * 创建带模块名前缀的调试日志函数，方便按模块过滤日志
 * @param {string} moduleName - 模块名称（如 "chat"、"economy"）
 * @returns {Function} 该模块专用的调试日志函数
 */
function debugLogModule(moduleName) {
    return function() {
        if (!_debugMode) return;
        const args = ['[DEBUG][' + moduleName + ']'];
        for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
        logger.info(args.join(' '));
    };
}

module.exports = {
    setDebugMode: setDebugMode,
    isDebug: isDebug,
    setUnloading: setUnloading,
    isUnloading: isUnloading,
    debugLog: debugLog,
    debugWarn: debugWarn,
    debugLogModule: debugLogModule
};
