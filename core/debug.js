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

var _debugMode = false;

function setDebugMode(enabled) {
    _debugMode = !!enabled;
}

function isDebug() {
    return _debugMode;
}

function debugLog() {
    if (!_debugMode) return;
    var args = ['[DEBUG]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.info(args.join(' '));
}

function debugWarn() {
    if (!_debugMode) return;
    var args = ['[DEBUG WARN]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.warn(args.join(' '));
}

function debugLogModule(moduleName) {
    return function() {
        if (!_debugMode) return;
        var args = ['[DEBUG][' + moduleName + ']'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        logger.info(args.join(' '));
    };
}

module.exports = {
    setDebugMode: setDebugMode,
    isDebug: isDebug,
    debugLog: debugLog,
    debugWarn: debugWarn,
    debugLogModule: debugLogModule
};
