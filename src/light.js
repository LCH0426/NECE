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
 * NECE 动态光源模块
 * 通过数据包模拟手持发光物品时的移动光源效果
 * 检测主手/副手物品，发送 UpdateBlock 数据包在玩家位置放置临时光源
 * 不放置真实方块，仅通过数据包对单个玩家可见
 *
 * config.json 配置示例：
 * "light": {
 *   "enabled": true,
 *   "items": {
 *     "minecraft:torch": "minecraft:light_block",
 *     "minecraft:lantern": "minecraft:light_block",
 *     "minecraft:glowstone": "minecraft:light_block",
 *     "minecraft:sea_lantern": "minecraft:light_block",
 *     "minecraft:shroomlight": "minecraft:light_block"
 *   },
 *   "updateInterval": 500
 * }
 */

let _config = null;
let _deps = {};
let _debug = false;

// 玩家上次光源位置 { xuid: { x, y, z, dim } }
const _lastLightPos = {};
// 玩家上次手持物品缓存 { xuid: { main: type, off: type } }，避免每 tick 查询原生 API
const _lastHandItem = {};
// tick 计数器，每 4 tick 检查一次（约5次/秒）
let _tickCounter = 0;

function init(config, deps) {
    _config = config;
    _deps = deps || {};
    _debug = config && config.get('debug') === true;
}

/** 获取光源配置 */
function getLightConfig() {
    return _config ? _config.get('light', {}) : {};
}

/**
 * 检查物品是否为发光物品
 * @param {string} itemType - 物品类型
 * @param {Array} itemsList - 发光物品列表
 * @returns {boolean}
 */
function isLightItem(itemType, itemsList) {
    if (!itemType || !itemsList) return false;
    for (var i = 0; i < itemsList.length; i++) {
        if (itemType === itemsList[i]) return true;
    }
    return false;
}

/**
 * 通过 BinaryStream 发送 UpdateBlock 数据包给玩家（客户端光源，不影响世界）
 * UpdateBlock 数据包 ID = 0x0E (14)
 * @param {Player} player - 玩家
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} z - Z坐标
 * @param {number} dim - 维度ID
 * @param {boolean} isAir - true=恢复原方块，false=放置光源
 */
function sendLightPacket(player, x, y, z, dim, isAir) {
    try {
        var bs = new BinaryStream();
        bs.writeVarInt(x);
        bs.writeVarInt(y);
        var encodedZ = (z & 0x3FFFFFF) | (0 << 26);
        bs.writeVarInt(encodedZ);
        var runtimeId = 0;
        if (!isAir) {
            try {
                var lightBlock = mc.newBlock('minecraft:light_block');
                runtimeId = lightBlock.id;
            } catch (e) {
                runtimeId = 10000;
            }
        }
        bs.writeUnsignedVarInt(runtimeId);
        bs.writeUnsignedVarInt(3);
        bs.writeUnsignedVarInt(0);
        var pkt = bs.createPacket(14);
        player.sendPacket(pkt);
        if (_debug) logger.info('[Light] 发送数据包: ' + (isAir ? '清除' : '放置') + ' (' + x + ',' + y + ',' + z + ') runtimeId=' + runtimeId);
    } catch (e) {
        if (_debug) logger.info('[Light] 发送数据包失败: ' + e.message);
    }
}

/**
 * 清除玩家之前的光源
 * @param {Player} player - 玩家
 */
function clearLastLight(player) {
    var last = _lastLightPos[player.xuid];
    if (last) {
        sendLightPacket(player, last.x, last.y, last.z, last.dim, true);
        delete _lastLightPos[player.xuid];
    }
}

/** 注册动态光源事件监听 */
function registerLightListener() {
    // 每 4 tick 检查一次（约5次/秒），降低原生调用频率
    mc.listen('onTick', function() {
        _tickCounter++;
        if (_tickCounter < 4) return;
        _tickCounter = 0;

        var cfg = getLightConfig();
        if (!cfg.enabled) return;

        var itemsList = cfg.items || [];
        var players = mc.getOnlinePlayers();

        for (var i = 0; i < players.length; i++) {
            var player = players[i];
            var xuid = player.xuid;
            try {
                // 检查主手/副手物品
                var mainItem = player.getHand();
                var mainType = (mainItem && !mainItem.isNull()) ? mainItem.type : '';
                var offItem = null;
                try { offItem = player.getOffHand(); } catch (e) {}
                var offType = (offItem && !offItem.isNull()) ? offItem.type : '';

                // 手持物品未变化时跳过检查
                var cached = _lastHandItem[xuid];
                if (cached && cached.main === mainType && cached.off === offType && !_lastLightPos[xuid]) continue;
                _lastHandItem[xuid] = { main: mainType, off: offType };

                var hasLight = isLightItem(mainType, itemsList) || isLightItem(offType, itemsList);

                if (hasLight) {
                    var pos = player.pos;
                    var lx = Math.floor(pos.x);
                    var ly = Math.floor(pos.y) - 1;
                    var lz = Math.floor(pos.z);
                    var dim = pos.dimid;

                    var last = _lastLightPos[xuid];
                    if (!last || last.x !== lx || last.y !== ly || last.z !== lz || last.dim !== dim) {
                        if (_debug) logger.info('[Light] 更新光源: ' + player.name + ' (' + lx + ',' + ly + ',' + lz + ') dim=' + dim);
                        clearLastLight(player);
                        sendLightPacket(player, lx, ly, lz, dim, false);
                        _lastLightPos[xuid] = { x: lx, y: ly, z: lz, dim: dim };
                    }
                } else {
                    if (_lastLightPos[xuid]) {
                        if (_debug) logger.info('[Light] 清除光源: ' + player.name);
                        clearLastLight(player);
                    }
                }
            } catch (e) {}
        }
    });

    // 玩家退出时清除光源
    mc.listen('onLeft', function(player) {
        if (player) clearLastLight(player);
    });
}

/** 注册光源配置命令 */
function registerLightCommand(registerPlayerCommand) {
    // 光源模块无独立命令，配置在 config.json 中
}

module.exports = {
    init: init,
    registerLightListener: registerLightListener,
    registerLightCommand: registerLightCommand
};
