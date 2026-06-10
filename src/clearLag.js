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
 * NECE 定时实体清理模块
 * 定时清理多余生物和掉落物，防止卡顿
 * 采用黑名单模式，提醒和完成消息使用 tell 发送
 */

var _config = null;
var _mainTimer = null;
var _reminderTimer = null;

/**
 * 初始化实体清理模块
 * @param {object} config - 配置对象，需提供 get 方法
 */
function init(config) {
    _config = config;
}

/**
 * 读取清理配置
 * @returns {object} 配置对象
 */
function getClearLagConfig() {
    if (!_config) return null;
    return _config.get('clearLag', null);
}

/**
 * 启动定时清理
 */
function start() {
    stop();
    var cfg = getClearLagConfig();
    if (!cfg || !cfg.enabled) return;

    var interval = (cfg.interval || 600) * 1000;
    if (interval < 60000) interval = 60000; // 最小60秒

    var reminderMs = (cfg.reminderSeconds || 0) * 1000;

    // 主定时器：每隔 interval 执行清理
    _mainTimer = setInterval(function() {
        executeCleanup();
        // 清理后重新安排提醒
        scheduleReminder(interval, reminderMs);
    }, interval);

    // 安排首次提醒
    scheduleReminder(interval, reminderMs);
}

/**
 * 安排提醒定时器
 * @param {number} interval - 清理间隔（毫秒）
 * @param {number} reminderMs - 提醒提前时间（毫秒）
 */
function scheduleReminder(interval, reminderMs) {
    if (_reminderTimer) {
        clearTimeout(_reminderTimer);
        _reminderTimer = null;
    }
    if (reminderMs > 0 && reminderMs < interval) {
        var delay = interval - reminderMs;
        _reminderTimer = setTimeout(function() {
            sendReminder();
        }, delay);
    }
}

/**
 * 发送清理提醒（使用 tell，位置为音乐盒）
 */
function sendReminder() {
    try {
        var cfg = getClearLagConfig();
        if (!cfg) return;
        var msg = cfg.message || '§e[清理] §6即将清理服务器掉落物和多余生物，请注意！';
        var players = mc.getOnlinePlayers();
        for (var i = 0; i < players.length; i++) {
            try {
                players[i].tell(msg);
            } catch (e) {}
        }
    } catch (e) {
        // 静默处理
    }
}

/**
 * 停止定时清理
 */
function stop() {
    if (_mainTimer) {
        clearInterval(_mainTimer);
        _mainTimer = null;
    }
    if (_reminderTimer) {
        clearTimeout(_reminderTimer);
        _reminderTimer = null;
    }
}

/**
 * 热更新：停止旧定时器，重新从配置启动
 */
function reload() {
    stop();
    start();
}

/**
 * 执行实体清理
 * @returns {{killedMobs: number, killedItems: number, total: number, byType: object}} 清理结果
 */
function executeCleanup() {
    var cfg = getClearLagConfig();
    if (!cfg) return { killedMobs: 0, killedItems: 0, total: 0, protectedCount: 0, byType: {} };

    var cleanTypes = cfg.cleanTypes || [
        'minecraft:zombie',
        'minecraft:zombie_villager',
        'minecraft:husk',
        'minecraft:drowned',
        'minecraft:skeleton',
        'minecraft:stray',
        'minecraft:wither_skeleton',
        'minecraft:creeper',
        'minecraft:spider',
        'minecraft:cave_spider',
        'minecraft:enderman',
        'minecraft:witch',
        'minecraft:slime',
        'minecraft:magma_cube',
        'minecraft:blaze',
        'minecraft:ghast',
        'minecraft:piglin',
        'minecraft:piglin_brute',
        'minecraft:zombified_piglin',
        'minecraft:hoglin',
        'minecraft:zoglin',
        'minecraft:warden',
        'minecraft:elder_guardian',
        'minecraft:guardian',
        'minecraft:phantom',
        'minecraft:vex',
        'minecraft:evoker',
        'minecraft:vindicator',
        'minecraft:ravager',
        'minecraft:pillager',
        'minecraft:shulker',
        'minecraft:silverfish',
        'minecraft:endermite',
        'minecraft:wolf',
        'minecraft:bee'
    ];
    var maxPerType = cfg.maxEntitiesPerType || 50;
    var cleanSet = {};
    for (var i = 0; i < cleanTypes.length; i++) {
        cleanSet[cleanTypes[i]] = true;
    }

    var entities = [];
    try {
        entities = mc.getAllEntities();
    } catch (e) {
        return { killedMobs: 0, killedItems: 0, total: 0, protectedCount: 0, byType: {} };
    }

    if (!entities || entities.length === 0) return { killedMobs: 0, killedItems: 0, total: 0, protectedCount: 0, byType: {} };

    // 按类型分组（仅处理黑名单中的类型和掉落物，其余全部保护）
    var typeGroups = {};
    var protectedCount = 0;
    var itemCount = 0;
    for (var j = 0; j < entities.length; j++) {
        var entity = entities[j];
        if (!entity) continue;
        var type = '';
        try { type = entity.type || ''; } catch (e) { continue; }
        // 统计掉落物
        if (type === 'minecraft:item') {
            itemCount++;
            continue;
        }
        if (!cleanSet[type]) {
            protectedCount++;
            continue;
        }
        if (!typeGroups[type]) typeGroups[type] = [];
        typeGroups[type].push(entity);
    }

    // 清理超出限制的实体
    var killedMobs = 0;
    var byType = {};
    for (var entityType in typeGroups) {
        var group = typeGroups[entityType];
        byType[entityType] = group.length;
        if (group.length > maxPerType) {
            // 保留前 maxPerType 个，清理多余的
            var toKill = group.length - maxPerType;
            for (var k = maxPerType; k < group.length; k++) {
                try {
                    group[k].kill();
                    killedMobs++;
                } catch (e) {
                    // 实体可能已经不存在
                }
            }
        }
    }

    // 清理掉落物
    var killedItems = 0;
    try {
        var itemEntities = mc.getAllEntities();
        for (var m = 0; m < itemEntities.length; m++) {
            var itemEntity = itemEntities[m];
            if (itemEntity && itemEntity.type === 'minecraft:item') {
                try {
                    itemEntity.kill();
                    killedItems++;
                } catch (e) {}
            }
        }
    } catch (e) {}

    // 广播清理完成消息（使用 tell）
    if (killedMobs > 0 || killedItems > 0) {
        try {
            var cleanMsg = cfg.cleanMessage || '§e[清理] §a已清理完成！';
            cleanMsg = cleanMsg.replace('{count}', String(killedMobs + killedItems));
            var players = mc.getOnlinePlayers();
            for (var n = 0; n < players.length; n++) {
                try {
                    players[n].tell(cleanMsg);
                } catch (e) {}
            }
        } catch (e) {}
    }

    return {
        killedMobs: killedMobs,
        killedItems: killedItems,
        total: entities.length,
        protectedCount: protectedCount,
        byType: byType
    };
}

/**
 * 获取当前实体统计（不执行清理）
 * @returns {{totalEntities: number, byType: object, protectedCount: number, cleanableCount: number}}
 */
function getStats() {
    var cfg = getClearLagConfig();
    var cleanTypes = (cfg && cfg.cleanTypes) ? cfg.cleanTypes : [
        'minecraft:zombie', 'minecraft:zombie_villager', 'minecraft:husk', 'minecraft:drowned',
        'minecraft:skeleton', 'minecraft:stray', 'minecraft:wither_skeleton',
        'minecraft:creeper', 'minecraft:spider', 'minecraft:cave_spider',
        'minecraft:enderman', 'minecraft:witch', 'minecraft:slime', 'minecraft:magma_cube',
        'minecraft:blaze', 'minecraft:ghast', 'minecraft:piglin', 'minecraft:piglin_brute',
        'minecraft:zombified_piglin', 'minecraft:hoglin', 'minecraft:zoglin',
        'minecraft:warden', 'minecraft:elder_guardian', 'minecraft:guardian',
        'minecraft:phantom', 'minecraft:vex', 'minecraft:evoker', 'minecraft:vindicator',
        'minecraft:ravager', 'minecraft:pillager', 'minecraft:shulker', 'minecraft:silverfish',
        'minecraft:endermite', 'minecraft:wolf', 'minecraft:bee'
    ];
    var cleanSet = {};
    for (var i = 0; i < cleanTypes.length; i++) {
        cleanSet[cleanTypes[i]] = true;
    }

    var entities = [];
    try {
        entities = mc.getAllEntities();
    } catch (e) {
        return { totalEntities: 0, byType: {}, protectedCount: 0, cleanableCount: 0 };
    }

    var byType = {};
    var protectedCount = 0;
    var cleanableCount = 0;
    for (var j = 0; j < entities.length; j++) {
        var entity = entities[j];
        if (!entity) continue;
        var type = '';
        try { type = entity.type || ''; } catch (e) { continue; }
        if (!cleanSet[type]) {
            protectedCount++;
            continue;
        }
        byType[type] = (byType[type] || 0) + 1;
        cleanableCount++;
    }

    return {
        totalEntities: entities.length,
        byType: byType,
        protectedCount: protectedCount,
        cleanableCount: cleanableCount
    };
}

module.exports = {
    init: init,
    start: start,
    stop: stop,
    reload: reload,
    executeCleanup: executeCleanup,
    getStats: getStats
};
