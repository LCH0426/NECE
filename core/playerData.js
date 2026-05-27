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
 * NLCE 玩家数据管理
 * 玩家核心数据和设置的保存、查询，物品数据映射
 */

let _database = null;         // database.js 模块引用
let _C = null;                // constants 模块引用
let _fs = null;               // fs 模块引用
let _playerDataDM = null;     // 玩家数据的 DataManager 实例（JSON 模式回退用）
let _itemsDataPath = '';      // items.json 文件路径
let _getPlayerData = null;    // 获取全局玩家数据的函数
let _getPlayerSettings = null; // 获取全局玩家设置的函数
let _savePlayerSettings = null; // 保存玩家设置的函数

/** 物品 ID -> { name, texture } 映射，启动时从 items.json 加载 */
let itemsDataMap = {};

/** 注入依赖，由 index.js 的 initAllConfigs 调用 */
function init(deps) {
    _database = deps.database;
    _C = deps.constants;
    _fs = deps.fs;
    _itemsDataPath = deps.itemsDataPath;
    _getPlayerData = deps.getPlayerData;
    _getPlayerSettings = deps.getPlayerSettings;
    _savePlayerSettings = deps.savePlayerSettings;
}

/** 设置 DataManager 实例，用于 SQL 不可用时回退到 JSON 存储 */
function setDataManagers(playerDataDM) {
    _playerDataDM = playerDataDM;
}

/** 获取物品数据映射表的引用 */
function getItemsDataMap() {
    return itemsDataMap;
}

/**
 * 保存玩家数据（防抖模式）
 * SQL 模式：批量写入 + 2秒防抖写盘
 * JSON 模式：通过 DataManager 防抖保存
 */
function savePlayerData() {
    let playerData = _getPlayerData();
    if (_database.isPlayerDbReady()) {
        let ops = [];
        for (let xuid in playerData.players) {
            if (!playerData.players.hasOwnProperty(xuid)) continue;
            (function(xuid, data) {
                ops.push(function() { _database.setPlayerDataSQL(xuid, data); });
            })(xuid, playerData.players[xuid]);
        }
        _database.batchSavePlayerDb(ops);
        _database.requestSavePlayerDb();
    } else {
        _playerDataDM.save();
    }
}

/**
 * 立即保存玩家数据（用于关服等关键操作）
 * 取消待执行的防抖定时器，直接写盘
 */
function savePlayerDataNow() {
    const playerData = _getPlayerData();
    if (_database.isPlayerDbReady()) {
        const ops = [];
        for (let xuid in playerData.players) {
            if (!playerData.players.hasOwnProperty(xuid)) continue;
            (function(xuid, data) {
                ops.push(function() { _database.setPlayerDataSQL(xuid, data); });
            })(xuid, playerData.players[xuid]);
        }
        _database.batchSavePlayerDb(ops);
        _database.cancelPendingSave();
        _database.savePlayerDatabase();
    } else {
        _playerDataDM.save(true);
    }
}

/** 只保存单个玩家的数据（防抖写盘），用于只修改了部分玩家时减少写入量 */
function saveSinglePlayerData(xuid) {
    const playerData = _getPlayerData();
    if (_database.isPlayerDbReady() && playerData.players && playerData.players[xuid]) {
        _database.setPlayerDataSQL(xuid, playerData.players[xuid]);
        _database.requestSavePlayerDb();
    }
}

/** 从 items.json 加载物品数据到内存映射表，文件不存在则置空 */
function loadItemsDataMap() {
    try {
        const content = _fs.readFileSync(_itemsDataPath, 'utf-8');
        const data = JSON.parse(content);
        itemsDataMap = data.item || {};
    } catch (e) {
        itemsDataMap = {};
    }
}

/**
 * 根据物品 ID 获取中文名和贴图路径，自动去除 minecraft: 前缀
 * @param {string} itemId - 物品完整 ID（如 "minecraft:diamond_sword"）
 * @returns {{ name: string, texture: string }}
 */
function getItemInfoById(itemId) {
    const shortId = itemId.replace(/^minecraft:/, '');
    let item = itemsDataMap[shortId];
    if (item && typeof item === 'object') {
        return { name: item.name || shortId, texture: item.texture || '' };
    }
    if (typeof item === 'string') {
        return { name: item, texture: '' };
    }
    return { name: shortId, texture: '' };
}

/**
 * 获取玩家单项设置值，未设置时返回默认值
 * @param {string} xuid - 玩家 XUID
 * @param {string} key - 设置项 key
 * @returns {*} 设置值（默认 false）
 */
function getPlayerSetting(xuid, key) {
    let playerSettings = _getPlayerSettings();
    if (!playerSettings[xuid]) {
        playerSettings[xuid] = Object.assign({}, _C.DEFAULT_PLAYER_SETTINGS);
    }
    return playerSettings[xuid][key] !== undefined ? playerSettings[xuid][key] : false;
}

/**
 * 设置玩家单项设置并持久化，玩家无设置记录时自动初始化
 * @param {string} xuid - 玩家 XUID
 * @param {string} key - 设置项 key
 * @param {*} value - 设置值
 */
function setPlayerSetting(xuid, key, value) {
    const playerSettings = _getPlayerSettings();
    if (!playerSettings[xuid]) {
        playerSettings[xuid] = Object.assign({}, _C.DEFAULT_PLAYER_SETTINGS);
    }
    playerSettings[xuid][key] = value;
    _savePlayerSettings();
}

module.exports = {
    init: init,
    setDataManagers: setDataManagers,
    getItemsDataMap: getItemsDataMap,
    savePlayerData: savePlayerData,
    savePlayerDataNow: savePlayerDataNow,
    saveSinglePlayerData: saveSinglePlayerData,
    loadItemsDataMap: loadItemsDataMap,
    getItemInfoById: getItemInfoById,
    getPlayerSetting: getPlayerSetting,
    setPlayerSetting: setPlayerSetting
};
