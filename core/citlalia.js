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
 * 击杀特效、血量系统、图腾替换、逐月之痕物品效果
 */

let _deps = {};

function init(deps) {
    _deps = deps;
    registerKillEffects();
    registerHealthSystem();
    registerTotemReplace();
    registerMoonSwEffects();
}

function registerKillEffects() {
    const KillEffectConfig = _deps.constants.KillEffectConfig;
    mc.listen('onPlayerDie', function(player, source) {
        try {
            if (source && source.isPlayer()) {
                const pos = {
                    x: Math.floor(player.pos.x) + 0.5,
                    y: Math.floor(player.pos.y),
                    z: Math.floor(player.pos.z) + 0.5
                };
                mc.runcmdEx("summon lightning_bolt " + pos.x + " " + pos.y + " " + pos.z);
                source.setFire(0, true);
                source.addEffect(
                    Number(KillEffectConfig.RESISTANCE.id),
                    Number(KillEffectConfig.RESISTANCE.baseDuration),
                    Number(4),
                    false
                );
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

function registerHealthSystem() {
    const DEFAULT_MAX_HEALTH = 40;

    mc.listen("onJoin", function(player) {
        let xuid = player.xuid;
        const playerInfo = _deps.getPlayerData().players[xuid] || {};
        const healthBonus = playerInfo.healthBonus || 0;
        const maxHealth = DEFAULT_MAX_HEALTH + healthBonus;
        player.setMaxHealth(maxHealth);
        player.setHealth(maxHealth);
    });
}

function registerTotemReplace() {
    mc.listen('onConsumeTotem', function(pl) {
        if (!_deps.getPlayerSetting(pl.xuid, "enableTotemReplace")) {
            return;
        }
        const bag = pl.getInventory().getAllItems();
        for (let i = 0; i < bag.length; i++) {
            const it = bag[i];
            if (it.type === 'minecraft:totem_of_undying') {
                it.setNull();
                pl.refreshItems();
                return false;
            }
        }
    });
}

function registerMoonSwEffects() {
    const MOON_SW_EFFECTS = [1, 8, 10, 11, 16];
    const MOON_SW_ITEM = 'citlalia:moon_sw';
    const EFFECT_DURATION = 400;
    let EFFECT_INTERVAL = 200;

    const moonSwPlayers = new Map();
    let tickCounter = 0;

    mc.listen("onTick", function() {
        tickCounter++;
        const onlinePlayers = mc.getOnlinePlayers();
        const now = Date.now();

        onlinePlayers.forEach(function(player) {
            try {
                const xuid = player.xuid;
                const handItem = player.getHand();
                const isHoldingMoonSw = handItem && handItem.type === MOON_SW_ITEM;
                const swData = moonSwPlayers.get(xuid);

                if (isHoldingMoonSw) {
                    if (!swData) {
                        moonSwPlayers.set(xuid, { lastRefresh: now });
                        MOON_SW_EFFECTS.forEach(function(effectId) {
                            player.addEffect(effectId, EFFECT_DURATION, 0, false);
                        });
                    } else if (tickCounter % EFFECT_INTERVAL === 0) {
                        swData.lastRefresh = now;
                        MOON_SW_EFFECTS.forEach(function(effectId) {
                            player.addEffect(effectId, EFFECT_DURATION, 0, false);
                        });
                    }
                } else {
                    if (swData) {
                        moonSwPlayers.delete(xuid);
                        MOON_SW_EFFECTS.forEach(function(effectId) {
                            player.removeEffect(effectId);
                        });
                    }
                }
            } catch (e) {}
        });

        if (tickCounter >= 1000000) tickCounter = 0;
    });

    mc.listen("onLeft", function(player) {
        moonSwPlayers.delete(player.xuid);
    });
}

module.exports = {
    init: init
};
