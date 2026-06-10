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
 * NECE 连锁挖矿模块
 * 使用工具挖掘时自动连锁破坏相邻同类方块
 * 按工具类型配置可连锁方块，通过命名空间自动识别工具
 */

let _config = null;
let _deps = {};
let _debug = false;
let _onChainComplete = null;
let _itemsMap = null;

// 配置缓存
let _cachedConfig = null;
let _configVersion = 0;

// 连锁冷却记录 { xuid: timestamp }
const _chainCooldowns = {};

function init(config, deps) {
    _config = config;
    _deps = deps || {};
    _debug = config && config.get('debug') === true;
}

/** 获取连锁全局配置，带缓存 */
function getChainConfig() {
    if (!_config) return {};
    var currentVersion = _config._version || 0;
    if (!_cachedConfig || currentVersion !== _configVersion) {
        _cachedConfig = _config.get('chain', {});
        _configVersion = currentVersion;
    }
    return _cachedConfig;
}

/**
 * 获取工具最大耐久度
 * @param {Player} player
 * @returns {number}
 */
function getMaxDurability(player) {
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return 0;
        return item.maxDamage || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 获取玩家手持工具当前剩余耐久度
 * @param {Player} player
 * @returns {number}
 */
function getDurability(player) {
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return 0;
        var maxDur = item.maxDamage || 0;
        if (maxDur <= 0) return 0;
        var damage = item.damage || 0;
        // 剩余耐久 = 最大耐久 - 已损坏值
        return maxDur - damage;
    } catch (e) {
        return 0;
    }
}

/**
 * 设置玩家手持工具耐久度
 * 通过克隆+NBT修改+物品替换实现
 * @param {Player} player
 * @param {number} damage - 已损坏值
 * @returns {boolean}
 */
function setDurability(player, damage) {
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return false;
        var maxDur = item.maxDamage || 0;
        if (damage >= maxDur) {
            damage = maxDur - 1;
        }
        // 克隆物品并修改 NBT
        var newItem = item.clone();
        var nbt = newItem.getNbt();
        var tag = nbt.getTag('tag');
        if (!tag) {
            tag = new NbtCompound();
            nbt.setTag('tag', tag);
        }
        tag.setInt('Damage', damage);
        newItem.setNbt(nbt);
        // 通过背包替换主手物品
        player.getInventory().setItem(0, newItem);
        if (_debug) {
            logger.info('[Chain] 设置耐久: damage=' + damage + '/' + maxDur);
        }
        return true;
    } catch (e) {
        if (_debug) {
            logger.info('[Chain] setDurability 异常: ' + e.message);
        }
        return false;
    }
}

/**
 * 根据手持物品ID判断工具类型
 * 通过命名空间后缀判断，支持所有材质（木/石/铁/金/钻/下界合金）
 * @param {string} itemId - 物品ID，如 minecraft:diamond_pickaxe
 * @returns {string|null} 工具类型：pickaxe/axe/shovel/hoe，或 null
 */
function getToolType(itemId) {
    if (!itemId) return null;
    var id = itemId.toLowerCase();
    if (id.endsWith('_pickaxe')) return 'pickaxe';
    if (id.endsWith('_axe')) return 'axe';
    if (id.endsWith('_shovel')) return 'shovel';
    if (id.endsWith('_hoe')) return 'hoe';
    return null;
}

/**
 * 检查指定工具类型是否可以连锁指定方块
 * @param {string} toolType - 工具类型
 * @param {string} blockType - 方块类型
 * @returns {boolean}
 */
function canToolMineBlock(toolType, blockType) {
    var cfg = getChainConfig();
    var blocks = cfg[toolType] || [];
    for (var i = 0; i < blocks.length; i++) {
        if (blocks[i] === blockType) return true;
    }
    return false;
}

/**
 * 获取所有可连锁的方块列表（合并所有工具类型）
 * @returns {string[]}
 */
function getAllAllowedBlocks() {
    var cfg = getChainConfig();
    var allBlocks = [];
    var types = ['pickaxe', 'axe', 'shovel', 'hoe'];
    for (var i = 0; i < types.length; i++) {
        var blocks = cfg[types[i]] || [];
        for (var j = 0; j < blocks.length; j++) {
            if (allBlocks.indexOf(blocks[j]) === -1) {
                allBlocks.push(blocks[j]);
            }
        }
    }
    return allBlocks;
}

/** 获取玩家连锁个人配置，默认全部启用 */
function getPlayerChainConfig(xuid) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    var defaultCfg = { enabled: true, mineAll: false, sneakOnly: true, blocks: {} };
    if (!pd || !pd.players || !pd.players[xuid]) return defaultCfg;
    var p = pd.players[xuid];
    if (!p.chain) {
        p.chain = defaultCfg;
    }
    if (p.chain.enabled === undefined) p.chain.enabled = true;
    if (p.chain.mineAll === undefined) p.chain.mineAll = false;
    if (p.chain.sneakOnly === undefined) p.chain.sneakOnly = true;
    if (!p.chain.blocks) p.chain.blocks = {};
    return p.chain;
}

/** 保存玩家连锁配置，只保存被禁用的方块以节省空间 */
function savePlayerChainConfig(xuid, cfg) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) return;

    // 获取当前配置中的所有方块
    var allBlocks = getAllAllowedBlocks();

    // 只保存被禁用的方块（黑名单模式）
    var disabledBlocks = {};
    for (var i = 0; i < allBlocks.length; i++) {
        var blockId = allBlocks[i];
        if (cfg.blocks[blockId] === false) {
            disabledBlocks[blockId] = false;
        }
    }

    // 保存精简配置
    var chainData = {
        enabled: cfg.enabled === true,
        mineAll: cfg.mineAll === true,
        sneakOnly: cfg.sneakOnly !== false,
        blocks: disabledBlocks
    };
    pd.players[xuid].chain = chainData;

    // 立即写入数据库
    if (_deps.savePlayerDataNow) {
        _deps.savePlayerDataNow();
    }
}

/** 获取方块的中文名 */
function getBlockName(blockId) {
    if (!_itemsMap) {
        try {
            var fs = require('fs');
            var path = require('path');
            var itemsPath = path.join(__dirname, '..', 'public', 'textures', 'items.json');
            var data = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
            _itemsMap = data.item || {};
        } catch (e) { _itemsMap = {}; }
    }
    var key = blockId.replace('minecraft:', '');
    var entry = _itemsMap[key];
    if (entry) return (typeof entry === 'object') ? (entry.name || key) : entry;
    return key;
}

/** 显示连锁设置表单 */
function showChainSettingsForm(player) {
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);

    var fm = mc.newCustomForm();
    fm.setTitle("§l§6连锁挖矿设置");
    fm.addSwitch("§a连锁总开关", playerCfg.enabled);
    fm.addSwitch("§c无视方块配置", playerCfg.mineAll);
    fm.addSwitch("§e蹲下时才启用连锁", playerCfg.sneakOnly);

    // 记录每个工具类型对应的方块ID列表
    var blockIdList = [];
    var toolTypes = ['pickaxe', 'axe', 'shovel', 'hoe'];
    var toolNames = { pickaxe: '§7稿子', axe: '§7斧子', shovel: '§7铲子', hoe: '§7锄头' };

    for (var t = 0; t < toolTypes.length; t++) {
        var toolKey = toolTypes[t];
        var blocks = cfg[toolKey] || [];
        if (blocks.length > 0) {
            fm.addLabel(toolNames[toolKey]);
            for (var i = 0; i < blocks.length; i++) {
                var blockId = blocks[i];
                var name = getBlockName(blockId);
                var enabled = playerCfg.blocks[blockId] !== false;
                fm.addSwitch(name, enabled);
                blockIdList.push(blockId);
            }
        }
    }

    player.sendForm(fm, function(p, data) {
        if (data === null || data === undefined) return;

        // CustomForm 返回数组：[switch0, switch1, switch2, ...]
        // 去掉 label 后，直接按顺序读取
        var switches = [];
        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'boolean') {
                switches.push(data[i]);
            }
        }

        // switches[0] = 总开关, switches[1] = 无视方块配置, switches[2] = 蹲下启用
        var newCfg = {
            enabled: !!switches[0],
            mineAll: !!switches[1],
            sneakOnly: !!switches[2],
            blocks: {}
        };

        // 从索引3开始是方块开关
        for (var i = 0; i < blockIdList.length; i++) {
            var blockId = blockIdList[i];
            var isEnabled = !!switches[i + 3];
            if (!isEnabled) {
                newCfg.blocks[blockId] = false;
            }
        }

        savePlayerChainConfig(p.xuid, newCfg);
        p.tell("§e[连锁] §a连锁设置已保存！");
    });
}

/** 注册连锁命令 */
function registerChainCommand(registerPlayerCommand) {
    registerPlayerCommand("chain", "连锁挖矿设置", function(p) { showChainSettingsForm(p); });
}

/** 注册连锁挖矿事件监听 */
function registerChainListener() {
    mc.listen('onDestroyBlock', function(player, block) {
        try {
            if (!player || !block) return;

            var cfg = getChainConfig();
            if (!cfg.enabled) return;

            // 检查玩家个人配置
            var playerCfg = getPlayerChainConfig(player.xuid);
            if (!playerCfg.enabled) return;

            // 检查蹲下状态
            if (playerCfg.sneakOnly && !player.isSneaking) return;

            // 简化冷却检查：只按玩家冷却
            var now = Date.now();
            if (_chainCooldowns[player.xuid] && now - _chainCooldowns[player.xuid] < 200) return;
            _chainCooldowns[player.xuid] = now;

            // 检查手持工具类型
            var item = player.getHand();
            if (!item || item.isNull()) return;
            var toolId = item.type;
            var toolType = getToolType(toolId);
            if (!toolType) return;

            // 检查方块类型
            var blockType = block.type;
            if (!playerCfg.mineAll) {
                if (!canToolMineBlock(toolType, blockType)) return;
                if (playerCfg.blocks[blockType] === false) return;
            }

            // 获取当前工具耐久（手动挖第一个方块时系统已扣1点）
            var maxDurability = getMaxDurability(player);
            var currentDurability = getDurability(player);
            if (_debug) {
                logger.info('[Chain] 工具=' + toolId + ' 类型=' + toolType + ' 方块=' + blockType);
                logger.info('[Chain] 最大耐久=' + maxDurability + ' 当前耐久=' + currentDurability);
            }
            if (currentDurability <= 0) return;

            // 连锁上限：取配置值和当前耐久的较小值
            var cfgMaxBlocks = cfg.maxBlocks || 64;
            var maxBlocks = Math.min(cfgMaxBlocks, currentDurability);

            // 执行连锁
            var startTime = Date.now();
            var result = doChainMine(player, block, blockType, maxBlocks);
            var elapsed = Date.now() - startTime;

            if (result.count > 0) {
                // 扣除工具耐久：连锁破坏的方块数
                try {
                    var currentDamage = maxDurability - currentDurability; // 当前已损坏值
                    var newDamage = currentDamage + result.count; // 新的已损坏值
                    setDurability(player, newDamage);
                    if (_debug) {
                        logger.info('[Chain] 扣除耐久: 当前损坏=' + currentDamage + ' 扣除=' + result.count + ' 新损坏=' + newDamage);
                    }
                } catch (e) {
                    if (_debug) logger.info('[Chain] 扣除耐久失败: ' + e.message);
                }

                player.sendText("§e[连锁] §a共连锁 " + result.count + " 个方块，耗时 " + elapsed + "ms", 4);
                if (_onChainComplete) _onChainComplete(player, result.count);
            }
            if (_debug) {
                logger.info('[Chain] 连锁完成: 方块数=' + result.count + ' 耗时=' + elapsed + 'ms');
            }
        } catch (e) {
            logger.error('[Chain] 连锁挖矿异常: ' + e.message);
        }
    });
}

/** 执行连锁挖矿 BFS */
function doChainMine(player, startBlock, blockType, maxBlocks) {
    var visited = new Set();
    var startPos = startBlock.pos;
    var dim = startPos.dimid;
    var queue = [startPos.x, startPos.y, startPos.z];
    var count = 0;
    var dirs = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1];
    var queueIdx = 0;

    // 数字编码坐标，避免字符串拼接
    var encode = function(x, y, z) { return x * 1000000 + y * 1000 + z; };
    visited.add(encode(startPos.x, startPos.y, startPos.z));

    // BFS 遍历相邻方块（不包括起始方块，因为已经被玩家挖掉了）
    while (queueIdx < queue.length && count < maxBlocks) {
        var qx = queue[queueIdx], qy = queue[queueIdx+1], qz = queue[queueIdx+2];
        queueIdx += 3;

        for (var d = 0; d < 18; d += 3) {
            var nx = qx + dirs[d], ny = qy + dirs[d+1], nz = qz + dirs[d+2];
            var key = encode(nx, ny, nz);
            if (visited.has(key)) continue;
            visited.add(key);

            var b = null;
            try { b = mc.getBlock(nx, ny, nz, dim); } catch (e) { continue; }
            if (!b || b.type !== blockType) continue;

            try { b.destroy(true); count++; } catch (e) { continue; }
            queue.push(nx, ny, nz);

            // 达到上限立即停止
            if (count >= maxBlocks) break;
        }
    }

    // 传送掉落物到玩家脚下
    if (count > 1) {
        try {
            var ppos = player.pos;
            var entities = mc.getAllEntities();
            for (var i = 0; i < entities.length; i++) {
                var e = entities[i];
                if (e.type === 'minecraft:item' && e.distanceTo(player) < 64) {
                    e.teleport(ppos);
                }
            }
        } catch (e) {}
    }

    return { count: count, durabilityUsed: count };
}

function setDebugMode(enabled) { _debug = !!enabled; }
function setOnChainComplete(fn) { _onChainComplete = fn; }

module.exports = {
    init: init,
    registerChainListener: registerChainListener,
    registerChainCommand: registerChainCommand,
    setDebugMode: setDebugMode,
    setOnChainComplete: setOnChainComplete
};
