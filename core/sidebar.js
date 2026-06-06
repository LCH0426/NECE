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
 * 每秒遍历在线玩家，根据个人设置渲染 actionbar（UID显示）和侧边栏信息面板
 * 支持的信息项：余额、延迟、TPS、移动速度、生物群系、当前时间
 * 支持紧凑模式（compact）将多行合并为一个侧边栏条目
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
const DEVICE_CACHE_TTL = 5000;   // 设备信息缓存5秒
const BIOME_CACHE_TTL = 1000;    // 生物群系缓存1秒

// 上次渲染的侧边栏内容，内容不变时跳过重复渲染；xuid -> string
let _lastRenderedSidebar = {};
// 上次渲染的时间行（非紧凑模式下检测时间变化）；xuid -> string
let _lastRenderedTime = {};

// 分层渲染计数器：每秒+1，满5时执行全量重建
let _renderTick = 0;

// 缓存非时间数据的侧边栏行（避免每秒重建）；xuid -> { sidebarData, compactLines, isCompact, sidebarSettings }
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
	const SIDEBAR_SETTING_KEYS = _deps.constants.SIDEBAR_SETTING_KEYS;
	const SIDEBAR_CACHE_TTL = _deps.constants.SIDEBAR_CACHE_TTL;
	const SIDEBAR_MONEY_CACHE_TTL = _deps.constants.SIDEBAR_MONEY_CACHE_TTL;
	const BIOME_NAMES = _deps.constants.BIOME_NAMES;

	setInterval(function() {
		const onlinePlayers = mc.getOnlinePlayers();
		if (onlinePlayers.length === 0) return;
		const now = Date.now();
		_renderTick++;
		const isFullUpdate = _renderTick >= 5;
		if (isFullUpdate) _renderTick = 0;

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
					const isCompact = _deps.config.get("sidebarCompact");

					// 全量更新（每5秒）：重建余额、延迟、TPS、速度、群系等数据
					if (isFullUpdate || !_sidebarDataCache[xuid]) {
						const sidebarData = {};
						let sidebarScore = 100;
						const compactLines = [];

						// 余额行
						if (sidebarSettings.enableActionbarMoney) {
							if (_sidebarMoneyCache[xuid] === undefined) {
								_sidebarMoneyCache[xuid] = _deps.money.get(xuid) || 0;
							}
							const moneyLine = "§6§c" + _deps.getCurrencyName() + "§r: " + _sidebarMoneyCache[xuid];
							if (isCompact) { compactLines.push(moneyLine); } else { sidebarData[moneyLine] = sidebarScore--; }
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
							if (isCompact) { compactLines.push(pingLine); } else { sidebarData[pingLine] = sidebarScore--; }
						}

						// TPS行
						if (sidebarSettings.enableActionbarTps) {
							const tpsData = _deps.tpsData;
							const tps = parseFloat(tpsData['tps']);
							const tpsColor = tps <= 12 ? "§c" : tps <= 17 ? "§e" : "§a";
							const tpsLine = "§6TPS:" + tpsColor + tpsData['tps'];
							if (isCompact) { compactLines.push(tpsLine); } else { sidebarData[tpsLine] = sidebarScore--; }
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
							if (isCompact) { compactLines.push(speedLine); } else { sidebarData[speedLine] = sidebarScore--; }
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
							if (isCompact) { compactLines.push(biomeLine); } else { sidebarData[biomeLine] = sidebarScore--; }
						}

						_sidebarDataCache[xuid] = { sidebarData: sidebarData, compactLines: compactLines, isCompact: isCompact };
					}

					// 每秒更新：重建完整 sidebarData（复用缓存的非时间数据 + 新时间行）
					const cachedData = _sidebarDataCache[xuid];
					const sidebarData = {};
					for (const k in cachedData.sidebarData) {
						sidebarData[k] = cachedData.sidebarData[k];
					}
					const compactLines = cachedData.compactLines.slice();

					// 当前时间行（每秒更新）
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
						// 紧凑模式：只比较非时间的 compactLines 内容（时间每秒变化但不影响数据）
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
