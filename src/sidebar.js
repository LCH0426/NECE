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
 * NECE 侧边栏渲染模块
 * 渲染 actionbar 和侧边栏信息面板
 */

let _deps = {};

// 侧边栏设置缓存，避免每秒重复读取数据库；xuid -> { enableActionbar, sidebarSettings }
let _sidebarCache = {};
let _sidebarCacheTime = 0;  // 上次全局缓存刷新时间戳

// 余额缓存，减少每秒频繁调用 money.get()；xuid -> number
let _sidebarMoneyCache = {};
let _sidebarMoneyCacheTime = 0;  // 上次余额缓存刷新时间戳

// 玩家设备/群系缓存，减少昂贵的LLSE API调用；xuid -> { device, deviceTime, biome, biomeTime }
let _playerDeviceCache = {};
let _playerBiomeCache = {};
const DEVICE_CACHE_TTL = 0;      // 设备信息不缓存，每秒更新
const BIOME_CACHE_TTL = 1000;    // 生物群系缓存1秒

// 上次渲染的侧边栏内容，内容不变时跳过重复渲染；xuid -> string
let _lastRenderedSidebar = {};

/** Minecraft 生物群系英文 ID 到中文名称的映射 */
const BIOME_NAMES = {
    "ocean": "海洋", "plains": "平原", "desert": "沙漠", "extreme_hills": "风袭丘陵",
    "forest": "森林", "taiga": "针叶林", "swampland": "沼泽", "river": "河流",
    "hell": "下界荒地", "the_end": "末地", "legacy_frozen_ocean": "冻洋（旧版）", "frozen_river": "冻河",
    "ice_plains": "雪原", "ice_mountains": "雪山", "mushroom_island": "蘑菇岛", "mushroom_island_shore": "蘑菇岛岸",
    "beach": "沙滩", "desert_hills": "沙漠丘陵", "forest_hills": "繁茂的丘陵", "taiga_hills": "针叶林丘陵",
    "extreme_hills_edge": "山地边缘", "jungle": "丛林", "jungle_hills": "丛林丘陵", "jungle_edge": "稀疏丛林",
    "deep_ocean": "深海", "stone_beach": "石岸", "cold_beach": "积雪沙滩",
    "birch_forest": "桦木森林", "birch_forest_hills": "桦木森林丘陵", "roofed_forest": "黑森林",
    "cold_taiga": "积雪针叶林", "cold_taiga_hills": "积雪的针叶林丘陵",
    "mega_taiga": "原始松木针叶林", "mega_taiga_hills": "巨型针叶林丘陵",
    "extreme_hills_plus_trees": "风袭森林", "savanna": "热带草原", "savanna_plateau": "热带高原",
    "mesa": "恶地", "mesa_plateau_stone": "繁茂的恶地高原", "mesa_plateau": "恶地高原",
    "warm_ocean": "暖水海洋", "deep_warm_ocean": "暖水深海", "lukewarm_ocean": "温水海洋",
    "deep_lukewarm_ocean": "温水深海", "cold_ocean": "冷水海洋", "deep_cold_ocean": "冷水深海",
    "frozen_ocean": "冻洋", "deep_frozen_ocean": "冰冻深海", "bamboo_jungle": "竹林", "bamboo_jungle_hills": "竹林丘陵",
    "sunflower_plains": "向日葵平原", "desert_mutated": "沙漠湖泊", "extreme_hills_mutated": "风袭沙砾丘陵",
    "flower_forest": "繁花森林", "taiga_mutated": "针叶林山地", "swampland_mutated": "沼泽丘陵",
    "ice_plains_spikes": "冰刺之地", "jungle_mutated": "丛林变种", "jungle_edge_mutated": "丛林边缘变种",
    "birch_forest_mutated": "原始桦木森林", "birch_forest_hills_mutated": "高大桦木丘陵",
    "roofed_forest_mutated": "黑森林丘陵", "cold_taiga_mutated": "积雪的针叶林山地",
    "redwood_taiga_mutated": "原始云杉针叶林", "redwood_taiga_hills_mutated": "巨型云杉针叶林丘陵",
    "extreme_hills_plus_trees_mutated": "沙砾山地+", "savanna_mutated": "风袭热带草原",
    "savanna_plateau_mutated": "破碎的热带高原", "mesa_bryce": "风蚀恶地",
    "mesa_plateau_stone_mutated": "繁茂的恶地高原变种", "mesa_plateau_mutated": "恶地高原变种",
    "soulsand_valley": "灵魂沙峡谷", "crimson_forest": "绯红森林", "warped_forest": "诡异森林",
    "basalt_deltas": "玄武岩三角洲", "jagged_peaks": "尖峭山峰", "frozen_peaks": "冰封山峰",
    "snowy_slopes": "积雪山坡", "grove": "雪林", "meadow": "草甸", "lush_caves": "繁茂洞穴",
    "dripstone_caves": "溶洞", "stony_peaks": "裸岩山峰", "deep_dark": "深暗之域",
    "mangrove_swamp": "红树林沼泽", "cherry_grove": "樱花树林", "pale_garden": "苍白之园"
};
// 上次渲染的时间行；xuid -> string
let _lastRenderedTime = {};

// 缓存非时间数据的侧边栏行；xuid -> { sidebarData, compactLines, isCompact, sidebarSettings }
let _sidebarDataCache = {};

/**
 * 初始化侧边栏模块并启动渲染循环
 * @param {object} deps - 依赖对象（constants, getPlayerSetting, money, config, tpsData 等）
 */
function init(deps) {
	_deps = deps;
	startRenderLoop();
}

/**
 * 启动每秒一次的渲染定时器
 * 遍历所有在线玩家，根据各自的侧边栏开关决定显示内容
 */
function startRenderLoop() {
	const SIDEBAR_SETTING_KEYS = ['enableActionbarPing', 'enableActionbarMoney', 'enableActionbarTime', 'enableActionbarTps', 'enableActionbarSpeed', 'enableActionbarBiome'];
	const SIDEBAR_CACHE_TTL = 0;
	const SIDEBAR_MONEY_CACHE_TTL = 0;

	setInterval(function() {
		const onlinePlayers = mc.getOnlinePlayers();
		if (onlinePlayers.length === 0) return;
		const now = Date.now();
		const isFullUpdate = true;

		// 定期清空设置缓存，使玩家修改的设置能生效
		if (now - _sidebarCacheTime > SIDEBAR_CACHE_TTL) {
			_sidebarCache = {};
			_sidebarCacheTime = now;
		}
		// 余额缓存独立刷新周期，避免过于频繁查询
		if (now - _sidebarMoneyCacheTime > SIDEBAR_MONEY_CACHE_TTL) {
			_sidebarMoneyCache = {};
			_sidebarMoneyCacheTime = now;
		}

		onlinePlayers.forEach(function(pl) {
			if (pl.isSimulatedPlayer()) return;
			const xuid = pl.xuid;

			// 懒加载：首次遇到玩家时读取其侧边栏相关设置并缓存
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

			// ---- actionbar: 显示 UID ----
			if (cached.enableActionbar) {
				let uidText;
				try {
					let uid = pl.uid;
					uidText = uid === "配置异常" ? "§c配置异常" :
						uid === "未注册" ? "§c未注册" : "" + uid;
				} catch (error) {
					uidText = "§c获取失败";
				}
				// setTitle type=4 表示 actionbar 区域
				pl.setTitle("UID: " + uidText, 4);
			}

			// ---- 侧边栏面板 ----
			let hasSidebar = false;
			const sidebarSettings = cached.sidebarSettings;
			for (let sk in sidebarSettings) {
				if (sidebarSettings[sk]) { hasSidebar = true; break; }
			}

			if (hasSidebar) {
				try {
					const cfg = _deps.getConfig ? _deps.getConfig() : {};
					const isCompact = cfg.sidebarCompact || (cfg.sidebar && cfg.sidebar.compact);

					// 全量更新：重建余额、延迟、TPS、速度、群系等数据
					if (isFullUpdate || !_sidebarDataCache[xuid]) {
						const sidebarData = {};
						let sidebarScore = 0;
						const compactLines = [];

						// 余额行
						if (sidebarSettings.enableActionbarMoney) {
							if (_sidebarMoneyCache[xuid] === undefined) {
								_sidebarMoneyCache[xuid] = _deps.money.get(xuid) || 0;
							}
							const moneyLine = "§6§c" + _deps.getCurrencyName() + "§r: " + _sidebarMoneyCache[xuid];
							if (isCompact) { compactLines.push(moneyLine); } else { sidebarData[moneyLine] = sidebarScore++; }
						}

						// 延迟行
						if (sidebarSettings.enableActionbarPing) {
							let device = _playerDeviceCache[xuid];
							if (!device || now - (device._cacheTime || 0) > DEVICE_CACHE_TTL) {
								device = pl.getDevice();
								if (device) device._cacheTime = now;
								_playerDeviceCache[xuid] = device;
							}
							let pingLine;
							if (device && device.lastPing !== undefined && device.lastPing !== null) {
								const ping = device.lastPing;
								const pingColor = ping > 200 ? "§m" : ping > 95 ? "§6" : "§a";
								pingLine = "§6延迟: " + pingColor + ping + "ms";
							} else {
								pingLine = "§e延迟: N/A";
							}
							if (isCompact) { compactLines.push(pingLine); } else { sidebarData[pingLine] = sidebarScore++; }
						}

						// TPS行
						if (sidebarSettings.enableActionbarTps) {
							const tpsData = _deps.tpsData;
							const tps = parseFloat(tpsData['tps']);
							const tpsColor = tps <= 12 ? "§c" : tps <= 17 ? "§e" : "§a";
							const tpsLine = "§6TPS:" + tpsColor + tpsData['tps'];
							if (isCompact) { compactLines.push(tpsLine); } else { sidebarData[tpsLine] = sidebarScore++; }
						}

						// 移动速度行
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
							if (isCompact) { compactLines.push(speedLine); } else { sidebarData[speedLine] = sidebarScore++; }
						}

						// 生物群系行
						if (sidebarSettings.enableActionbarBiome) {
							let biomeLine;
							try {
								let cachedBiome = _playerBiomeCache[xuid];
								if (!cachedBiome || now - (cachedBiome._cacheTime || 0) > BIOME_CACHE_TTL) {
									const biome = pl.getBiomeName();
									cachedBiome = biome ? { value: biome, _cacheTime: now } : null;
									_playerBiomeCache[xuid] = cachedBiome;
								}
								if (cachedBiome && cachedBiome.value !== undefined && cachedBiome.value !== null) {
									let biomeId = cachedBiome.value;
									if (biomeId.startsWith("minecraft:")) biomeId = biomeId.substring(10);
									const chineseBiomeName = BIOME_NAMES[biomeId] || biomeId;
									biomeLine = "§d" + chineseBiomeName;
								} else {
									biomeLine = "§e生物群系: N/A";
								}
							} catch (error) {
								biomeLine = "§e生物群系: N/A";
							}
							if (isCompact) { compactLines.push(biomeLine); } else { sidebarData[biomeLine] = sidebarScore++; }
						}

						_sidebarDataCache[xuid] = { sidebarData: sidebarData, compactLines: compactLines, isCompact: isCompact };
					}

					// 每秒更新：重建完整 sidebarData
					const cachedData = _sidebarDataCache[xuid];
					const sidebarData = {};
					for (const k in cachedData.sidebarData) {
						sidebarData[k] = cachedData.sidebarData[k];
					}
					const compactLines = cachedData.compactLines.slice();

					// 当前时间行
					if (sidebarSettings.enableActionbarTime) {
						const timeNow = new Date();
						const h = timeNow.getHours();
						const m = timeNow.getMinutes();
						const s = timeNow.getSeconds();
						const timeLine = "§b时间: " + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
						if (isCompact) { compactLines.push(timeLine); } else { sidebarData[timeLine] = 0; }
					}

					// 紧凑模式：所有行用换行符拼接为一个侧边栏条目
					if (isCompact && compactLines.length > 0) {
						sidebarData[compactLines.join("\n")] = 100;
					}

					// 内容不变时跳过重复渲染
					let sidebarKey = "";
					if (isCompact) {
						// 紧凑模式：只比较非时间的 compactLines 内容
						sidebarKey = compactLines.join("|");
					} else {
						for (const k in sidebarData) {
							if (k.indexOf("§b时间:") === -1) {
								sidebarKey += k + "|";
							}
						}
					}
					if (_lastRenderedSidebar[xuid] !== sidebarKey) {
						_lastRenderedSidebar[xuid] = sidebarKey;
						pl.removeSidebar();
						pl.setSidebar("§a侧边栏信息", sidebarData, 0);
					} else if (!isCompact) {
						// 非紧凑模式：时间行在 sidebarData 中，需要检测时间变化
						let timeKey = "";
						for (const k in sidebarData) {
							if (k.indexOf("§b时间:") !== -1) { timeKey = k; break; }
						}
						if (timeKey && _lastRenderedTime[xuid] !== timeKey) {
							_lastRenderedTime[xuid] = timeKey;
							pl.removeSidebar();
							pl.setSidebar("§a侧边栏信息", sidebarData, 0);
						}
					}
				} catch (error) {}
			} else {
				try {
					if (_lastRenderedSidebar[xuid] !== "") {
						_lastRenderedSidebar[xuid] = "";
						_lastRenderedTime[xuid] = "";
						_sidebarDataCache[xuid] = null;
						pl.removeSidebar();
					}
				} catch (error) {}
			}
		});
	}, 1000);
}

/**
 * 清除指定玩家的侧边栏设置缓存，下次渲染时重新读取
 * @param {string} xuid - 玩家XUID
 */
function clearPlayerCache(xuid) {
	delete _sidebarCache[xuid];
	delete _playerDeviceCache[xuid];
	delete _playerBiomeCache[xuid];
	delete _lastRenderedSidebar[xuid];
	delete _lastRenderedTime[xuid];
	delete _sidebarDataCache[xuid];
}

module.exports = {
	init: init,
	clearPlayerCache: clearPlayerCache
};
