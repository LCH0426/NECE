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
 * 使用指定工具挖掘方块时，自动连锁破坏相邻同类方块
 * 按工具类型配置可连锁的方块类型，通过手持物品命名空间自动识别工具类型
 * 新版本工具无需手动添加，自动支持所有 *_pickaxe、*_axe、*_shovel、*_hoe
 */

let _config = null;
let _deps = {};
let _debug = false;
let _onChainComplete = null;
let _itemsMap = null; // 物品ID->中文名映射缓存

// 连锁冷却记录 { xuid: timestamp }
const _chainCooldowns = {};

function init(config, deps) {
    _config = config;
    _deps = deps || {};
    _debug = config && config.get('debug') === true;
}

/** 获取连锁全局配置 */
function getChainConfig() {
    return _config ? _config.get('chain', {}) : {};
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
    if (!pd || !pd.players || !pd.players[xuid]) return { enabled: true, mineAll: false, blocks: {} };
    var p = pd.players[xuid];
    if (!p.chain) {
        p.chain = { enabled: true, mineAll: false, blocks: {} };
    }
    if (p.chain.enabled === undefined) p.chain.enabled = true;
    if (p.chain.mineAll === undefined) p.chain.mineAll = false;
    if (!p.chain.blocks) p.chain.blocks = {};
    return p.chain;
}

/** 保存玩家连锁配置 */
function savePlayerChainConfig(xuid, cfg) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) return;
    pd.players[xuid].chain = cfg;
    if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
}

/** 获取方块的中文名（从 items.json 读取） */
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
    var allBlocks = getAllAllowedBlocks();

    var fm = mc.newCustomForm();
    fm.setTitle("§l§6连锁挖矿设置");
    fm.addLabel("§a当前状态: " + (playerCfg.enabled ? "§a已启用" : "§c已关闭"));
    fm.addSwitch("§a连锁总开关", playerCfg.enabled);
    fm.addSwitch("§c无视方块配置（可连锁任意方块）", playerCfg.mineAll);

    // 按工具类型分组显示
    var toolTypes = [
        { key: 'pickaxe', name: '§7稿子可连锁方块' },
        { key: 'axe', name: '§7斧子可连锁方块' },
        { key: 'shovel', name: '§7铲子可连锁方块' },
        { key: 'hoe', name: '§7锄头可连锁方块' }
    ];

    for (var t = 0; t < toolTypes.length; t++) {
        var tool = toolTypes[t];
        var blocks = cfg[tool.key] || [];
        if (blocks.length > 0) {
            fm.addLabel(tool.name);
            for (var i = 0; i < blocks.length; i++) {
                var blockId = blocks[i];
                var name = getBlockName(blockId);
                var enabled = playerCfg.blocks[blockId] !== false; // 默认开启
                fm.addSwitch("  " + name, enabled);
            }
        }
    }

    player.sendForm(fm, function(p, data) {
        if (data === null || data === undefined) return;
        var newCfg = { enabled: !!data[1], mineAll: !!data[2], blocks: {} };
        var idx = 3;
        for (var t = 0; t < toolTypes.length; t++) {
            var blocks = cfg[toolTypes[t].key] || [];
            for (var i = 0; i < blocks.length; i++) {
                newCfg.blocks[blocks[i]] = !!data[idx];
                idx++;
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

            // 冷却检查
            var cooldownKey = player.xuid + ':' + block.pos.x + ',' + block.pos.y + ',' + block.pos.z;
            var now = Date.now();
            if (_chainCooldowns[cooldownKey] && now - _chainCooldowns[cooldownKey] < 500) return;
            _chainCooldowns[cooldownKey] = now;

            // 检查手持工具类型（通过命名空间自动识别）
            var item = player.getHand();
            if (!item || item.isNull()) return;
            var toolId = item.type;
            var toolType = getToolType(toolId);
            if (!toolType) return; // 不是镐子/斧子/铲子/锄头

            // 检查方块类型
            var blockType = block.type;
            if (!playerCfg.mineAll) {
                // 非无视模式：检查该工具类型是否可以连锁此方块
                if (!canToolMineBlock(toolType, blockType)) return;
                // 检查玩家是否开启了该方块的连锁
                if (playerCfg.blocks[blockType] === false) return;
            }
            // mineAll 模式：跳过方块检查，任意方块都可连锁

            // 执行连锁
            var maxBlocks = cfg.maxBlocks || 64;
            var startTime = Date.now();
            var result = doChainMine(player, block, blockType, maxBlocks);
            var elapsed = Date.now() - startTime;

            if (result.count > 1) {
                // 扣除工具耐久
                var extraBlocks = result.count - 1;
                try {
                    var heldItem = player.getHand();
                    if (heldItem && !heldItem.isNull()) {
                        var nbt = heldItem.getNbt();
                        var tag = nbt.getTag('tag');
                        if (!tag) { tag = mc.newCompoundTag('tag'); nbt.setTag('tag', tag); }
                        var currentDamage = tag.getData('Damage') || 0;
                        tag.setData('Damage', currentDamage + extraBlocks);
                        heldItem.setNbt(nbt);
                    }
                } catch (e) {
                    if (_debug) logger.info('[Chain] 扣除耐久失败: ' + e.message);
                }

                player.sendText("§e[连锁] §a共连锁 " + result.count + " 个方块，耗时 " + elapsed + "ms", 4);
                if (_onChainComplete) _onChainComplete(player, extraBlocks);
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

    visited.add(startPos.x + ',' + startPos.y + ',' + startPos.z);
    count++;

    while (queue.length > 0 && count < maxBlocks) {
        var qx = queue.shift(), qy = queue.shift(), qz = queue.shift();
        for (var d = 0; d < 18; d += 3) {
            var nx = qx + dirs[d], ny = qy + dirs[d+1], nz = qz + dirs[d+2];
            var key = nx + ',' + ny + ',' + nz;
            if (visited.has(key)) continue;
            visited.add(key);

            var b = null;
            try { b = mc.getBlock(nx, ny, nz, dim); } catch (e) { continue; }
            if (!b || b.type !== blockType) continue;

            try { b.destroy(true); count++; } catch (e) { continue; }
            queue.push(nx, ny, nz);
        }
    }

    // 传送掉落物到玩家脚下
    if (count > 1) {
        try {
            var ppos = player.pos;
            mc.runcmd('execute as @e[type=item,r=64,x=' + ppos.x + ',y=' + ppos.y + ',z=' + ppos.z + '] at @s run tp @s ' + ppos.x + ' ' + ppos.y + ' ' + ppos.z);
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
