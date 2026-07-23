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

const os = require('os');
let _deps = {};

function getLocale(xuid) {
    if (_deps.getPlayerSetting && xuid) {
        return _deps.getPlayerSetting(xuid, 'locale') || getSystemLang();
    }
    return getSystemLang();
}

function getSystemLang() {
    return _deps.getSystemLanguage ? _deps.getSystemLanguage() : 'zh_CN';
}

function t(lang) {
    if (!_deps.t) return lang;
    var args = [];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    return _deps.t.apply(null, args);
}

function getBiomeName(biomeId, lang) {
    return t(lang, 'sidebar.biome_' + biomeId);
}

// 侧边栏设置缓存，避免每秒重复读取数据库；xuid -> { enableActionbar, sidebarSettings }
let _sidebarCache = {};
let _sidebarCacheTime = 0;  // 上次全局缓存刷新时间戳

// 余额缓存，减少每秒频繁调用 money.get()；xuid -> number
let _sidebarMoneyCache = {};
let _sidebarMoneyCacheTime = 0;  // 上次余额缓存刷新时间戳

// 玩家设备/群系缓存，减少昂贵的LLSE API调用；xuid -> { device, deviceTime, biome, biomeTime }
let _playerDeviceCache = {};
let _playerBiomeCache = {};
const DEVICE_CACHE_TTL = 0;
const BIOME_CACHE_TTL = 1000;    // 生物群系缓存1秒

// 上次渲染的侧边栏内容，内容不变时跳过重复渲染；xuid -> string
let _lastRenderedSidebar = {};

// 上次渲染的时间行；xuid -> string
let _lastRenderedTime = {};

// 缓存非时间数据的侧边栏行；xuid -> { sidebarData, compactLines, isCompact, sidebarSettings }
let _sidebarDataCache = {};

// CPU 使用率计算的上次读数
let _cpuLastTick = null;

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
	const SIDEBAR_SETTING_KEYS = ['enableActionbarPing', 'enableActionbarMoney', 'enableActionbarTime', 'enableActionbarTps', 'enableActionbarSpeed', 'enableActionbarBiome', 'enableActionbarShowPing'];
	const SIDEBAR_CACHE_TTL = 0;
	const SIDEBAR_MONEY_CACHE_TTL = 0;

	setInterval(function() {
		const onlinePlayers = mc.getOnlinePlayers();
		if (onlinePlayers.length === 0) return;
		const now = Date.now();
		const isFullUpdate = true;

		// 清理离线玩家的缓存，防止内存泄漏
		const onlineXuids = {};
		for (let oi = 0; oi < onlinePlayers.length; oi++) {
			onlineXuids[onlinePlayers[oi].xuid] = true;
		}
		for (let cxuid in _sidebarCache) {
			if (!onlineXuids[cxuid]) clearPlayerCache(cxuid);
		}
		for (let mxuid in _sidebarMoneyCache) {
			if (!onlineXuids[mxuid]) delete _sidebarMoneyCache[mxuid];
		}

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
			const lang = getLocale(xuid);

			// 懒加载：首次遇到玩家时读取其侧边栏相关设置并缓存
			let cached = _sidebarCache[xuid];
			if (!cached) {
				cached = {
					enableActionbar: _deps.getPlayerSetting(xuid, "enableActionbar"),
					enableDebug: _deps.getPlayerSetting(xuid, "enableDebug"),
					sidebarSettings: {}
				};
				for (let k = 0; k < SIDEBAR_SETTING_KEYS.length; k++) {
					const key = SIDEBAR_SETTING_KEYS[k];
					cached.sidebarSettings[key] = _deps.getPlayerSetting(xuid, key);
				}
				_sidebarCache[xuid] = cached;
			}

			// ---- actionbar: 调试模式 or UID+延迟 ----
			if (cached.enableActionbar || cached.sidebarSettings.enableActionbarShowPing) {
				let actionBar = "";

				if (cached.enableDebug) {
					// 调试模式：显示CPU、内存、BDS、实体
					try {
						// CPU 使用率（对比两次读数差值）
						var cpuUsage = 0;
						var cpus = os.cpus();
						var totalIdle = 0, totalTick = 0;
						for (var ci = 0; ci < cpus.length; ci++) {
							var times = cpus[ci].times;
							totalIdle += times.idle;
							totalTick += times.idle + times.user + times.nice + times.sys + times.irq;
						}
						if (!_cpuLastTick) {
							_cpuLastTick = { idle: totalIdle, total: totalTick };
							cpuUsage = 0;
						} else {
							var idleDiff = totalIdle - _cpuLastTick.idle;
							var totalDiff = totalTick - _cpuLastTick.total;
							cpuUsage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
							_cpuLastTick = { idle: totalIdle, total: totalTick };
						}

						var totalMem = Math.round(os.totalmem() / 1024 / 1024);
						var freeMem = Math.round(os.freemem() / 1024 / 1024);
						var usedMem = totalMem - freeMem;

						// BDS 内存
						var bdsMem = 0;
						try { bdsMem = Math.round(process.memoryUsage().rss / 1024 / 1024); } catch(e) {}

						// 实体数量
						var entityCount = 0;
						try { entityCount = mc.getAllEntities().length; } catch(e) {}

						// 玩家设备信息
						var avgPing = '--';
						var packetLoss = '--';
						var device = _playerDeviceCache[xuid];
						if (!device || now - (device._cacheTime || 0) > DEVICE_CACHE_TTL) {
							device = pl.getDevice();
							if (device) device._cacheTime = now;
							_playerDeviceCache[xuid] = device;
						}
						if (device) {
							avgPing = device.avgPing !== undefined ? device.avgPing : '--';
							packetLoss = device.lastPacketLoss !== undefined ? parseFloat(device.lastPacketLoss.toFixed(1)) : '--';
						}

						var cpuColor = cpuUsage > 80 ? "§c" : cpuUsage > 50 ? "§e" : "§a";
						var memPercent = totalMem > 0 ? Math.round(usedMem / totalMem * 100) : 0;
						var memColor = memPercent > 80 ? "§c" : memPercent > 50 ? "§e" : "§a";

						var lossNum = parseFloat(packetLoss);
						var lossColor = isNaN(lossNum) ? "§7" : lossNum > 10 ? "§c" : lossNum > 3 ? "§e" : "§a";

						actionBar = cpuColor + "CPU：" + cpuUsage + "%" +
							" §7| " + memColor + "MEM：" + usedMem + "/" + totalMem + "MB\n" +
							"§bBDS：" + bdsMem + "MB" +
							" §7| §eENT：" + entityCount +
							" §7| §b" + avgPing + "ms" +
							" §7| " + lossColor + "Lost：" + packetLoss + "%";
					} catch(e) {
						actionBar = "§cDebug Error";
					}
				} else {
					// 正常模式：UID + 延迟
					if (cached.enableActionbar) {
						let uidText;
						try {
							let uid = pl.uid;
							uidText = uid === t(getSystemLang(), 'sidebar.config_error') ? t(getSystemLang(), 'sidebar.config_error') :
								uid === t(getSystemLang(), 'pc.unregistered') ? t(getSystemLang(), 'sidebar.unregistered') : "" + uid;
						} catch (error) {
							uidText = t(getSystemLang(), 'sidebar.fetch_failed');
						}
						actionBar = "UID: " + uidText;
					}
					if (cached.sidebarSettings.enableActionbarShowPing) {
						let device = _playerDeviceCache[xuid];
						if (!device || now - (device._cacheTime || 0) > DEVICE_CACHE_TTL) {
							device = pl.getDevice();
							if (device) device._cacheTime = now;
							_playerDeviceCache[xuid] = device;
						}
						if (device && device.lastPing !== undefined && device.lastPing !== null) {
							const ping = device.lastPing;
							const pingColor = ping > 200 ? "§c" : ping > 95 ? "§6" : "§a";
							if (actionBar) actionBar += " ";
							actionBar += pingColor + ping + "ms";
						}
					}
				}

				if (actionBar) {
					pl.setTitle(actionBar, 4);
				}
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
								const pingColor = ping > 200 ? "§c" : ping > 95 ? "§6" : "§a";
								pingLine = t(getSystemLang(), 'sidebar.latency') + pingColor + ping + "ms";
							} else {
								pingLine = t(getSystemLang(), 'sidebar.latency_na');
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
									speedLine = t(getSystemLang(), 'sidebar.speed') + speedColor + speed.toFixed(2);
								} else {
									speedLine = t(getSystemLang(), 'sidebar.speed_na');
								}
							} catch (error) {
								speedLine = t(getSystemLang(), 'sidebar.speed_na');
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
									const chineseBiomeName = getBiomeName(biomeId, lang);
									biomeLine = "§d" + chineseBiomeName;
								} else {
									biomeLine = t(getSystemLang(), 'sidebar.biome_na');
								}
							} catch (error) {
								biomeLine = t(getSystemLang(), 'sidebar.biome_na');
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
						const timeLine = t(getSystemLang(), 'sidebar.time_label') + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
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
							if (k.indexOf(t(lang, 'sidebar.time_label')) === -1) {
								sidebarKey += k + "|";
							}
						}
					}
					if (_lastRenderedSidebar[xuid] !== sidebarKey) {
						_lastRenderedSidebar[xuid] = sidebarKey;
						pl.removeSidebar();
						pl.setSidebar(t(getSystemLang(), 'sidebar.title'), sidebarData, 0);
					} else if (!isCompact) {
						// 非紧凑模式：时间行在 sidebarData 中，需要检测时间变化
						let timeKey = "";
						for (const k in sidebarData) {
							if (k.indexOf(t(getSystemLang(), 'sidebar.time_label')) !== -1) { timeKey = k; break; }
						}
						if (timeKey && _lastRenderedTime[xuid] !== timeKey) {
							_lastRenderedTime[xuid] = timeKey;
							pl.removeSidebar();
							pl.setSidebar(t(getSystemLang(), 'sidebar.title'), sidebarData, 0);
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
	_sidebarDataCache[xuid] = null;
}

module.exports = {
	init: init,
	clearPlayerCache: clearPlayerCache
};
