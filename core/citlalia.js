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
 * NLCE Citlalia 功能模块
 * 击杀特效（雷击+火焰+抗性）、自定义血量系统、图腾消耗替换、逐月之痕手持效果
 */

const D = require('./debug');
let _deps = {};

/**
 * 初始化Citlalia模块，注册所有子系统
 * @param {Object} deps - 外部依赖（constants、getPlayerData、getPlayerSetting等）
 */
function init(deps) {
    _deps = deps;
    registerKillEffects();
    registerHealthSystem();
    registerTotemReplace();
    registerMoonSwEffects();
}

/** 注册击杀特效：玩家被其他玩家击杀时，在死亡位置召唤闪电并给予击杀者效果 */
function registerKillEffects() {
    const KillEffectConfig = _deps.constants.KillEffectConfig;
    mc.listen('onPlayerDie', function(player, source) {
        try {
            if (source && source.isPlayer()) {
                // 将坐标对齐到方块中心，闪电效果更精准
                const pos = {
                    x: Math.floor(player.pos.x) + 0.5,
                    y: Math.floor(player.pos.y),
                    z: Math.floor(player.pos.z) + 0.5
                };
                mc.runcmdEx("summon lightning_bolt " + pos.x + " " + pos.y + " " + pos.z);
                source.setFire(0, true);
                // 抗性提升V（等级4），持续baseDuration tick
                source.addEffect(
                    Number(KillEffectConfig.RESISTANCE.id),
                    Number(KillEffectConfig.RESISTANCE.baseDuration),
                    Number(4),
                    false
                );
                // 防火效果，持续duration tick，隐藏粒子
                source.addEffect(
                    Number(KillEffectConfig.FIRE_RESISTANCE.id),
                    Number(KillEffectConfig.FIRE_RESISTANCE.duration),
                    Number(0),
                    true
                );
            }
        } catch (e) {
            logger.error("[Citlalia] 击杀特效错误 => " + e.stack);
        }
    });
}

/** 注册自定义血量系统：玩家加入时根据healthBonus设置最大生命值 */
function registerHealthSystem() {
    const DEFAULT_MAX_HEALTH = 40; // 基础最大生命值（原版为20）

    mc.listen("onJoin", function(player) {
        let xuid = player.xuid;
        const playerInfo = _deps.getPlayerData().players[xuid] || {};
        const healthBonus = playerInfo.healthBonus || 0; // 额外生命值加成
        const maxHealth = DEFAULT_MAX_HEALTH + healthBonus;
        player.setMaxHealth(maxHealth);
        player.setHealth(maxHealth);
    });
}

/** 注册图腾消耗替换：开启后使用图腾时消耗背包中额外的图腾而非手持的 */
function registerTotemReplace() {
    mc.listen('onConsumeTotem', function(pl) {
        if (!_deps.getPlayerSetting(pl.xuid, "enableTotemReplace")) {
            return;
        }
        const bag = pl.getInventory().getAllItems();
        for (let i = 0; i < bag.length; i++) {
            const it = bag[i];
            if (it.type === 'minecraft:totem_of_undying') {
                it.setNull(); // 清空该物品槽位
                pl.refreshItems();
                return false; // 阻止默认的图腾消耗行为
            }
        }
    });
}

/** 注册逐月之痕手持效果：手持citlalia:moon_sw物品时持续获得多种增益效果 */
function registerMoonSwEffects() {
    const MOON_SW_EFFECTS = [1, 8, 10, 11, 16]; // 速度、跳跃提升、伤害吸收、生命恢复、夜视
    const MOON_SW_ITEM = 'citlalia:moon_sw';
    const EFFECT_DURATION = 400; // 效果持续时间（tick），20秒
    const EFFECT_INTERVAL = 200; // 效果刷新间隔（tick），10秒
    const SCAN_INTERVAL = 50;    // 扫描新玩家间隔（tick），2.5秒

    const moonSwPlayers = new Map(); // 跟踪手持该物品的在线玩家 xuid -> { player, lastRefresh }
    let tickCounter = 0;

    mc.listen("onTick", function() {
        if (D.isUnloading()) return;
        tickCounter++;

        // 每tick仅检查已跟踪的玩家（通常0-5人），不遍历全部在线玩家
        moonSwPlayers.forEach(function(swData, xuid) {
            try {
                const player = swData.player;
                if (!player || !player.isOnline()) {
                    moonSwPlayers.delete(xuid);
                    return;
                }
                const handItem = player.getHand();
                if (!handItem || handItem.type !== MOON_SW_ITEM) {
                    // 放下物品，移除效果
                    moonSwPlayers.delete(xuid);
                    MOON_SW_EFFECTS.forEach(function(effectId) {
                        player.removeEffect(effectId);
                    });
                    return;
                }
                // 定期刷新效果
                if (tickCounter % EFFECT_INTERVAL === 0) {
                    MOON_SW_EFFECTS.forEach(function(effectId) {
                        player.addEffect(effectId, EFFECT_DURATION, 0, false);
                    });
                }
            } catch (e) { moonSwPlayers.delete(xuid); }
        });

        // 每 SCAN_INTERVAL tick 扫描未跟踪的玩家是否有新手持该物品
        if (tickCounter % SCAN_INTERVAL === 0) {
            const onlinePlayers = mc.getOnlinePlayers();
            for (let i = 0; i < onlinePlayers.length; i++) {
                const player = onlinePlayers[i];
                const xuid = player.xuid;
                if (moonSwPlayers.has(xuid)) continue;
                try {
                    const handItem = player.getHand();
                    if (handItem && handItem.type === MOON_SW_ITEM) {
                        moonSwPlayers.set(xuid, { player: player });
                        MOON_SW_EFFECTS.forEach(function(effectId) {
                            player.addEffect(effectId, EFFECT_DURATION, 0, false);
                        });
                    }
                } catch (e) {}
            }
        }

        if (tickCounter >= 1000000) tickCounter = 0;
    });

    // 玩家离开时清理跟踪数据
    mc.listen("onLeft", function(player) {
        moonSwPlayers.delete(player.xuid);
    });
}

module.exports = {
    init: init
};
