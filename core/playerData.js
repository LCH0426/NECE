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
let _itemsDataPath = '';      // items.json 文件路径
let _getPlayerData = null;    // 获取全局玩家数据的函数
let _getPlayerSettings = null; // 获取全局玩家设置的函数
let _savePlayerSettings = null; // 保存玩家设置的函数

/** 物品 ID -> { name, texture } 映射，启动时从 items.json 加载 */
let itemsDataMap = {};

/** 脏标记集合：记录数据发生变化的玩家 xuid，savePlayerData 只处理这些玩家 */
let _dirtyPlayers = new Set();

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

/** 获取物品数据映射表的引用 */
function getItemsDataMap() {
    return itemsDataMap;
}

/**
 * 标记玩家数据为脏（数据已变化，需要保存）
 * @param {string} xuid - 玩家XUID
 */
function markPlayerDirty(xuid) {
    _dirtyPlayers.add(xuid);
}

/**
 * 保存玩家数据（防抖模式）
 * SQL 模式：仅保存脏标记的玩家 + 2秒防抖写盘
 * JSON 模式：通过 DataManager 防抖保存
 */
function savePlayerData() {
    if (_dirtyPlayers.size === 0) return;
    let playerData = _getPlayerData();
    // 先快照再清空，避免清空后、写入前到达的 markPlayerDirty 调用丢失
    let dirtySnapshot = Array.from(_dirtyPlayers);
    _dirtyPlayers.clear();
    let ops = [];
    dirtySnapshot.forEach(function(xuid) {
        if (playerData.players && playerData.players[xuid]) {
            const data = playerData.players[xuid];
            ops.push(function() { _database.setPlayerDataSQL(xuid, data); });
        }
    });
    _database.batchSavePlayerDb(ops);
    _database.requestSavePlayerDb();
}

/**
 * 立即保存所有脏玩家数据（用于关服等关键操作）
 * 取消待执行的防抖定时器，直接写盘
 */
function savePlayerDataNow() {
    const playerData = _getPlayerData();
    const ops = [];
    // 关服时保存所有玩家（含脏标记的 + 尚未标记但在线的）
    for (let xuid in playerData.players) {
        if (!playerData.players.hasOwnProperty(xuid)) continue;
        (function(xuid, data) {
            ops.push(function() { _database.setPlayerDataSQL(xuid, data); });
        })(xuid, playerData.players[xuid]);
    }
    _dirtyPlayers.clear();
    _database.batchSavePlayerDb(ops);
    _database.cancelPendingSave();
    _database.savePlayerDatabase();
}

/**
 * 只保存单个玩家的数据（防抖写盘），用于只修改了部分玩家时减少写入量
 * 同时标记该玩家为已保存（清除脏标记），避免 savePlayerData 重复写入
 */
function saveSinglePlayerData(xuid) {
    const playerData = _getPlayerData();
    if (_database.isPlayerDbReady() && playerData.players && playerData.players[xuid]) {
        _database.setPlayerDataSQL(xuid, playerData.players[xuid]);
        _dirtyPlayers.delete(xuid);
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
 * 直接写入单条 SQL 记录 + 防抖写盘，避免触发全量保存
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
    if (_database.isPlayerDbReady()) {
        _database.setPlayerSettingSQL(xuid, key, value);
        _database.requestSavePlayerDb();
    }
}

module.exports = {
    init: init,
    getItemsDataMap: getItemsDataMap,
    savePlayerData: savePlayerData,
    savePlayerDataNow: savePlayerDataNow,
    saveSinglePlayerData: saveSinglePlayerData,
    markPlayerDirty: markPlayerDirty,
    loadItemsDataMap: loadItemsDataMap,
    getItemInfoById: getItemInfoById,
    getPlayerSetting: getPlayerSetting,
    setPlayerSetting: setPlayerSetting
};
