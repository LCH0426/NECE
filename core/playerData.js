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

let _database = null;
let _C = null;
let _fs = null;
let _playerDataDM = null;
let _itemsDataPath = '';
let _getPlayerData = null;
let _getPlayerSettings = null;
let _savePlayerSettings = null;

let itemsDataMap = {};

function init(deps) {
    _database = deps.database;
    _C = deps.constants;
    _fs = deps.fs;
    _itemsDataPath = deps.itemsDataPath;
    _getPlayerData = deps.getPlayerData;
    _getPlayerSettings = deps.getPlayerSettings;
    _savePlayerSettings = deps.savePlayerSettings;
}

function setDataManagers(playerDataDM) {
    _playerDataDM = playerDataDM;
}

function getItemsDataMap() {
    return itemsDataMap;
}

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

function loadItemsDataMap() {
    try {
        const content = _fs.readFileSync(_itemsDataPath, 'utf-8');
        const data = JSON.parse(content);
        itemsDataMap = data.item || {};
    } catch (e) {
        itemsDataMap = {};
    }
}

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

function getPlayerSetting(xuid, key) {
    let playerSettings = _getPlayerSettings();
    if (!playerSettings[xuid]) {
        playerSettings[xuid] = Object.assign({}, _C.DEFAULT_PLAYER_SETTINGS);
    }
    return playerSettings[xuid][key] !== undefined ? playerSettings[xuid][key] : false;
}

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
    loadItemsDataMap: loadItemsDataMap,
    getItemInfoById: getItemInfoById,
    getPlayerSetting: getPlayerSetting,
    setPlayerSetting: setPlayerSetting
};
