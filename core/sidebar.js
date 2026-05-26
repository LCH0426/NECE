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
 * NLCE 侧边栏渲染
 * 侧边栏/actionbar 信息渲染，每秒更新
 */

let _deps = {};
let _sidebarCache = {};
let _sidebarCacheTime = 0;
let _sidebarMoneyCache = {};
let _sidebarMoneyCacheTime = 0;

function init(deps) {
    _deps = deps;
    startRenderLoop();
}

function startRenderLoop() {
    const SIDEBAR_SETTING_KEYS = _deps.constants.SIDEBAR_SETTING_KEYS;
    const SIDEBAR_CACHE_TTL = _deps.constants.SIDEBAR_CACHE_TTL;
    const SIDEBAR_MONEY_CACHE_TTL = _deps.constants.SIDEBAR_MONEY_CACHE_TTL;
    const BIOME_NAMES = _deps.constants.BIOME_NAMES;

    setInterval(function() {
        const onlinePlayers = mc.getOnlinePlayers();
        if (onlinePlayers.length === 0) return;
        const now = Date.now();
        if (now - _sidebarCacheTime > SIDEBAR_CACHE_TTL) {
            _sidebarCache = {};
            _sidebarCacheTime = now;
        }
        if (now - _sidebarMoneyCacheTime > SIDEBAR_MONEY_CACHE_TTL) {
            _sidebarMoneyCache = {};
            _sidebarMoneyCacheTime = now;
        }
        onlinePlayers.forEach(function(pl) {
            if (pl.isSimulatedPlayer()) return;
            const xuid = pl.xuid;

            let cached = _sidebarCache[xuid];
            if (!cached) {
                cached = {
                    enableActionbar: _deps.getPlayerSetting(xuid, "enableActionbar"),
                    sidebarSettings: {}
                };
                for (let k = 0; k < SIDEBAR_SETTING_KEYS.length; k++) {
                    const key = SIDEBAR_SETTING_KEYS[k];
                    cached.sidebarSettings[key] = _deps.getPlayerSetting(xuid, key);
                }
                _sidebarCache[xuid] = cached;
            }

            if (cached.enableActionbar) {
                let uidText;
                try {
                    let uid = pl.uid;
                    uidText = uid === "配置异常" ? "§c配置异常" :
                        uid === "未注册" ? "§c未注册" : "" + uid;
                } catch (error) {
                    uidText = "§c获取失败";
                }
                pl.setTitle("UID: " + uidText, 4);
            }

            let hasSidebar = false;
            const sidebarSettings = cached.sidebarSettings;
            for (let sk in sidebarSettings) {
                if (sidebarSettings[sk]) { hasSidebar = true; break; }
            }

            if (hasSidebar) {
                try {
                    const sidebarData = {};
                    let sidebarScore = 100;
                    const compactLines = [];
                    const isCompact = _deps.config.get("sidebarCompact");

                    if (sidebarSettings.enableActionbarMoney) {
                        if (_sidebarMoneyCache[xuid] === undefined) {
                            _sidebarMoneyCache[xuid] = _deps.money.get(xuid) || 0;
                        }
                        const moneyLine = "§6§c" + _deps.getCurrencyName() + "§r: " + _sidebarMoneyCache[xuid];
                        if (isCompact) { compactLines.push(moneyLine); } else { sidebarData[moneyLine] = sidebarScore--; }
                    }

                    if (sidebarSettings.enableActionbarPing) {
                        const device = pl.getDevice();
                        let pingLine;
                        if (device && device.lastPing !== undefined && device.lastPing !== null) {
                            const ping = device.lastPing;
                            const pingColor = ping > 200 ? "§m" : ping > 95 ? "§6" : "§a";
                            pingLine = "§6延迟: " + pingColor + ping + "ms";
                        } else {
                            pingLine = "§e延迟: N/A";
                        }
                        if (isCompact) { compactLines.push(pingLine); } else { sidebarData[pingLine] = sidebarScore--; }
                    }

                    if (sidebarSettings.enableActionbarTps) {
                        const tpsData = _deps.tpsData;
                        const tps = parseFloat(tpsData['tps']);
                        const tpsColor = tps <= 12 ? "§c" : tps <= 17 ? "§e" : "§a";
                        const tpsLine = "§6TPS:" + tpsColor + tpsData['tps'];
                        if (isCompact) { compactLines.push(tpsLine); } else { sidebarData[tpsLine] = sidebarScore--; }
                    }

                    if (sidebarSettings.enableActionbarSpeed) {
                        let speedLine;
                        try {
                            const speed = pl.speed;
                            if (speed !== undefined && speed !== null) {
                                const speedColor = speed <= 10 ? "§a" : speed <= 20 ? "§b" : "§6";
                                speedLine = "§6速度: " + speedColor + speed.toFixed(2);
                            } else {
                                speedLine = "§e速度: N/A";
                            }
                        } catch (error) {
                            speedLine = "§e速度: N/A";
                        }
                        if (isCompact) { compactLines.push(speedLine); } else { sidebarData[speedLine] = sidebarScore--; }
                    }

                    if (sidebarSettings.enableActionbarBiome) {
                        let biomeLine;
                        try {
                            const biome = pl.getBiomeName();
                            if (biome !== undefined && biome !== null) {
                                let biomeId = biome;
                                if (biomeId.startsWith("minecraft:")) biomeId = biomeId.substring(10);
                                const chineseBiomeName = BIOME_NAMES[biomeId] || biomeId;
                                biomeLine = "§d" + chineseBiomeName;
                            } else {
                                biomeLine = "§e生物群系: N/A";
                            }
                        } catch (error) {
                            biomeLine = "§e生物群系: N/A";
                        }
                        if (isCompact) { compactLines.push(biomeLine); } else { sidebarData[biomeLine] = sidebarScore--; }
                    }

                    if (sidebarSettings.enableActionbarTime) {
                        const timeNow = new Date();
                        const h = timeNow.getHours();
                        const m = timeNow.getMinutes();
                        const s = timeNow.getSeconds();
                        const timeLine = "§b时间: " + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
                        if (isCompact) { compactLines.push(timeLine); } else { sidebarData[timeLine] = sidebarScore--; }
                    }

                    if (isCompact && compactLines.length > 0) {
                        sidebarData[compactLines.join("\n")] = 100;
                    }

                    pl.removeSidebar();
                    pl.setSidebar("§a侧边栏信息", sidebarData, 0);
                } catch (error) {}
            } else {
                try {
                    pl.removeSidebar();
                } catch (error) {}
            }
        });
    }, 1000);
}

function clearPlayerCache(xuid) {
    delete _sidebarCache[xuid];
}

module.exports = {
    init: init,
    clearPlayerCache: clearPlayerCache
};
