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

// ============ 模块导入 ============
const fs = require('fs');
const database = require('./src/database');
const debugModule = require('./src/debug');
const webServer = require('./src/server');
const behaviorLog = require('./src/behaviorLog');
const C = require('./src/constants');
const U = require('./src/utils');
const shopModule = require('./src/shop');
const teleportModule = require('./src/teleport');
const vipModuleCreator = require('./src/vip');
const cdkModuleCreator = require('./src/cdk');
const rankModuleCreator = require('./src/rank');
const bankModuleCreator = require('./src/bank');
const backupModule = require('./src/backup');
const messageBoardModule = require('./src/messageBoard');
const friendModule = require('./src/friend');
let wishModule = null;
let hasWish = false;
try { wishModule = require('./src/wish'); hasWish = true; } catch (e) { /* wish模块不存在时跳过 */ }
const banModule = require('./src/ban');
const mailModule = require('./src/mail');
const economyModule = require('./src/economy');
const playerDataModule = require('./src/playerData');
const chatModule = require('./src/chat');
const sidebarModule = require('./src/sidebar');
const menuModule = require('./src/menu');
const personalCenter = require('./src/personalCenter');
const guildModule = require('./src/guild');
const motdModule = require('./src/motd');
const clearLagModule = require('./src/clearLag');


// ============ 插件注册 ============
const PLUGIN_NAME = "NECE";
const DESIGNATION_NAME = "Robin";
const PLUGIN_AUTHOR = "LCH0426";

ll.registerPlugin(PLUGIN_NAME, DESIGNATION_NAME, [1, 9, 9], { Author: PLUGIN_AUTHOR });

// ============ 全局路径常量 ============
const CONFIG_PATH = C.PATHS.CONFIG;
const PLAYER_DATA_PATH = C.PATHS.PLAYER_DATA;
const PLAYER_SETTINGS_PATH = C.PATHS.PLAYER_SETTINGS;
const SHOP_DATA_PATH = C.PATHS.SHOP_DATA;
const CDK_DATA_PATH = C.PATHS.CDK_DATA;
const RECYCLE_DATA_PATH = C.PATHS.RECYCLE_DATA;
const RECYCLE_LOG_DIR = C.PATHS.RECYCLE_LOG_DIR;
const MESSAGEBOARD_DATA_PATH = C.PATHS.MESSAGEBOARD_DATA;
const WISH_DATA_PATH = C.PATHS.WISH_DATA;
const ENCHANT_BOOK_SHOP_PATH = C.PATHS.ENCHANT_BOOK_SHOP;
const SPAWN_EGG_SHOP_PATH = C.PATHS.SPAWN_EGG_SHOP;
const DEATH_POINT_DATA_PATH = C.PATHS.DEATH_POINT_DATA;
const FRIEND_DATA_PATH = C.PATHS.FRIEND_DATA;
const MESSAGE_DATA_PATH = C.PATHS.MESSAGE_DATA;
const BAN_DATA_PATH = C.PATHS.BAN_DATA;
const MAIL_DATA_PATH = C.PATHS.MAIL_DATA;
const NAR_CONFIG_PATH = C.PATHS.NAR_CONFIG;
const ITEMS_DATA_PATH = C.PATHS.ITEMS_DATA;
const HOMES_DATA_PATH = C.PATHS.HOMES_DATA;
const WARPS_DATA_PATH = C.PATHS.WARPS_DATA;
const BAD_WORDS_PATH = C.PATHS.BAD_WORDS;
const GUILD_DATA_PATH = C.PATHS.GUILD_DATA;

// ============ 全局运行时状态 ============
let config;                                            // 主配置（JsonConfigFileAdapter）
let playerData = { nextUid: 10000, players: {} };      // 玩家核心数据（xuid -> 玩家信息）
let playerSettings;                                    // 玩家个人设置
let levelUpExp = [];                                   // 等级经验表（由LEVEL_EXP_STEPS累加生成）
const _joinTimestamps = {};                            // 玩家加入时间戳（xuid -> Date.now()），用于计算在线时长
let onlinePlayers = {};                                // 当前在线玩家集合（xuid -> true）
let shopData;                                          // 商店商品数据
let recycleConfig;                                     // 回收系统配置
let spawnEggShopConfig = {                             // 刷怪蛋商店配置
	currency: {
		name: "星尘"
	},
	items: []
};
let narConfig = {                                      // NPC攻击响应配置
	npc_actions: {}
};
let tpsData = {                                        // TPS实时计算数据
	tps: '20.00',
	tps_Count: null,
	tps_Time_start: 0,
	tps_Time_end: 0
};

let commonDeps = null;                                 // 共享依赖包，传递给需要广泛访问的模块
let _initialized = false;                              // 模块初始化完成标志，防止 onJoin 在重载时提前触发

// Debug 模式
let _debugMode = false;
const debugLog = debugModule.debugLog;
const debugWarn = debugModule.debugWarn;

// ============ 防抖保存机制 ============
const _saveTimers = {};   // key -> 序号，用于判断定时器是否过期
const _saveFns = {};      // key -> 实际保存函数
let _saveTimerSeq = 0;    // 全局递增序号，确保旧定时器被新调用覆盖后不会执行

/**
 * 防抖保存：同一key的多次调用只执行最后一次，中间的被跳过
 * @param {string} key - 保存标识（通常用文件路径）
 * @param {Function} saveFn - 实际写入函数
 * @param {number} delay - 延迟毫秒数（默认5000）
 */
function debouncedSave(key, saveFn, delay) {
	delay = delay || 5000;
	_saveFns[key] = saveFn;
	_saveTimerSeq++;
	const seq = _saveTimerSeq;
	_saveTimers[key] = seq;
	setTimeout(() => {
		if (_saveTimers[key] === seq) {
			saveFn();
			delete _saveTimers[key];
			delete _saveFns[key];
		}
	}, delay);
}

/** 立即执行指定key的待写入保存（用于关服等关键操作） */
function flushSave(key) {
	if (_saveTimers[key] !== undefined) {
		_saveTimers[key] = -1;
		delete _saveTimers[key];
		if (_saveFns[key]) {
			_saveFns[key]();
			delete _saveFns[key];
		}
	}
}

/** 立即执行所有待写入保存（关服前调用，防止数据丢失） */
function flushAllSaves() {
	Object.keys(_saveTimers).forEach(flushSave);
}

// ============ 数据持久化基础设施 ============

/**
 * 数据管理器：统一的JSON/SQL双模式数据持久化层
 * 根据 options.sqlPrefix 自动选择SQL或JSON存储
 * @param {string} path - JSON文件路径
 * @param {Object} defaultData - 默认数据（文件不存在或SQL为空时使用）
 * @param {Object} options - { pretty, saveDelay, sqlPrefix }
 */
function DataManager(path, defaultData, options) {
	options = options || {};
	this.path = path;
	this.data = null;
	this.defaultData = defaultData;
	this.pretty = options.pretty !== false;
	this.saveDelay = options.saveDelay || 5000;
	this.saveKey = path;
	this.sqlPrefix = options.sqlPrefix || null;
	this.useSQL = false;
	this._dirtyKeys = {};
}

/** 加载数据：优先SQL（若配置了sqlPrefix且数据库就绪），否则从JSON文件读取 */
DataManager.prototype.load = function() {
	// SQL 模式：按sqlPrefix分发到对应的专用加载函数
	if (this.sqlPrefix && database.isPlayerDbReady()) {
		this.useSQL = true;
		try {
			switch (this.sqlPrefix) {
				case 'settings':
					this.data = database.getAllPlayerSettingsSQL();
					break;
				case 'deathPoints':
					this.data = { players: database.getAllDeathPointsSQL() };
					break;
				case 'friends':
					this.data = { players: database.getAllFriendsSQL() };
					break;
				case 'messages':
					this.data = { players: database.getAllMessagesSQL() };
					break;
				case 'homes':
					this.data = database.getAllHomesSQL();
					break;
				default:
					database.sqlEnsureTable(this.sqlPrefix);
					this.data = database.sqlGetAll(this.sqlPrefix);
			}
			// SQL返回空数据时回退到默认数据
			if (!this.data || Object.keys(this.data).length === 0) {
				this.data = JSON.parse(JSON.stringify(this.defaultData));
			}
		} catch (e) {
			this.data = JSON.parse(JSON.stringify(this.defaultData));
			logger.error('SQL加载失败[' + this.sqlPrefix + ']：' + e.message);
		}
		debugLog('DataManager.load: SQL [' + this.sqlPrefix + '] 条目=' + Object.keys(this.data || {}).length);
		return this.data;
	}
	// JSON 模式：文件不存在或为空时写入默认数据
	try {
		if (!fs.existsSync(this.path)) {
			U.ensureDir(this.path);
			fs.writeFileSync(this.path, JSON.stringify(this.defaultData, null, this.pretty ? 2 : 0), 'utf-8');
			this.data = JSON.parse(JSON.stringify(this.defaultData));
		} else {
			let content = fs.readFileSync(this.path, 'utf-8');
			if (!content || content.trim() === '') {
				fs.writeFileSync(this.path, JSON.stringify(this.defaultData, null, this.pretty ? 2 : 0), 'utf-8');
				this.data = JSON.parse(JSON.stringify(this.defaultData));
			} else {
				this.data = JSON.parse(content);
			}
		}
	} catch (e) {
		// JSON 解析失败：备份原文件，不要用空数据覆盖
		try {
			var backupPath = this.path + '.bak.' + Date.now();
			fs.copyFileSync(this.path, backupPath);
			logger.warn('==============================');
			logger.warn('[!! 数据文件格式错误 !!');
			logger.warn('文件：' + this.path);
			logger.warn('错误：' + e.message);
			logger.warn('已备份到：' + backupPath);
			logger.warn('请修复文件格式后重启服务器');
			logger.warn('==============================');
		} catch (backupErr) {
			logger.error('备份失败[' + this.path + ']：' + backupErr.message);
		}
		this.data = JSON.parse(JSON.stringify(this.defaultData));
		this._loadFailed = true; // 标记加载失败，阻止后续保存覆盖原文件
	}
	return this.data;
};

/**
 * 保存数据：immediate=true时立即写入，否则走防抖延迟
 * SQL模式下：先写内存变更到SQL，再触发2秒防抖写磁盘
 * JSON模式下：直接写文件
 */
DataManager.prototype.save = function(immediate) {
	// 加载失败时禁止保存，防止空数据覆盖原文件
	if (this._loadFailed) {
		debugLog('DataManager.save: 跳过保存，因为加载失败 [' + this.path + ']');
		return;
	}
	const self = this;
	// SQL 模式
	if (this.useSQL) {
		const doSQLSave = function() {
			debugLog('DataManager.save: SQL模式 [' + self.sqlPrefix + ']');
			try {
				switch (self.sqlPrefix) {
					case 'settings':
						for (let xuid in self.data) {
							if (!self.data.hasOwnProperty(xuid)) continue;
							const s = self.data[xuid];
							for (let k in s) {
								if (s.hasOwnProperty(k)) database.setPlayerSettingSQL(xuid, k, s[k]);
							}
						}
						break;
					case 'deathPoints':
						const dpPlayers = self.data.players || self.data;
					debugLog('save deathPoints: dpPlayers keys=' + Object.keys(dpPlayers).length);
						for (let xuid in dpPlayers) {
							if (!dpPlayers.hasOwnProperty(xuid)) continue;
							database.setDeathPointsSQL(xuid, dpPlayers[xuid]);
						}
						break;
					case 'friends':
						const frPlayers = self.data.players || self.data;
					debugLog('save friends: frPlayers keys=' + Object.keys(frPlayers).length);
						for (let xuid in frPlayers) {
							if (!frPlayers.hasOwnProperty(xuid)) continue;
							const fd = frPlayers[xuid];
							database.clearFriendsSQL(xuid);
							(fd.friends || []).forEach(function(f) {
								database.addFriendSQL(xuid, f.xuid, f.name, f.addTime);
							});
							database.clearFriendRequestsSQL(xuid);
							(fd.requests || []).forEach(function(r) {
								database.addFriendRequestSQL(xuid, r.xuid, r.name, r.message, r.time, false);
							});
							(fd.sentRequests || []).forEach(function(r) {
								database.addFriendRequestSQL(xuid, r.xuid, r.name, r.message, r.time, true);
							});
						}
						break;
					case 'messages':
						const msgPlayers = self.data.players || self.data;
					debugLog('save messages: msgPlayers keys=' + Object.keys(msgPlayers).length);
						for (let xuid in msgPlayers) {
							if (!msgPlayers.hasOwnProperty(xuid)) continue;
							database.clearMessagesSQL(xuid);
							const msgs = msgPlayers[xuid].messages || [];
							msgs.forEach(function(m) {
								database.addMessageSQL(xuid, m);
							});
						}
						break;
					case 'homes':
					debugLog('save homes: data keys=' + Object.keys(self.data).length);
						for (let xuid in self.data) {
							if (!self.data.hasOwnProperty(xuid)) continue;
							database.setHomesSQL(xuid, self.data[xuid]);
						}
						break;
					default:
						for (let key in self.data) {
							if (!self.data.hasOwnProperty(key)) continue;
							database.sqlSet(self.sqlPrefix, key, self.data[key]);
						}
				}
			} catch (e) {
				logger.error('SQL保存失败[' + self.sqlPrefix + ']：' + e.message);
			}
		};
		if (immediate) {
			doSQLSave();
			database.savePlayerDatabase();
		} else {
			// 防抖写入SQL，随后触发2秒防抖写磁盘（requestSavePlayerDb自带2秒防抖）
			debouncedSave(this.saveKey, function() {
				doSQLSave();
				database.requestSavePlayerDb();
			}, this.saveDelay);
		}
		return;
	}
	// JSON 模式
	const doSave = function() {
		debugLog('DataManager.save: JSON模式 [' + self.path + ']');
		try {
			U.ensureDir(self.path);
			fs.writeFileSync(self.path, JSON.stringify(self.data, null, self.pretty ? 2 : 0), 'utf-8');
		} catch (e) {
			logger.error('保存失败[' + self.path + ']：' + e.message);
		}
	};
	if (immediate) {
		doSave();
	} else {
		debouncedSave(this.saveKey, doSave, this.saveDelay);
	}
};

/** 获取原始数据引用 */
DataManager.prototype.get = function() {
	return this.data;
};

/**
 * 获取指定玩家的数据，不存在时自动创建并触发保存
 * @param {string} xuid - 玩家XUID
 * @param {Object} defaultPlayerData - 新玩家的默认数据模板
 */
DataManager.prototype.getPlayerData = function(xuid, defaultPlayerData) {
	if (!this.data.players) this.data.players = {};
	if (!this.data.players[xuid]) {
		this.data.players[xuid] = JSON.parse(JSON.stringify(defaultPlayerData));
		this.save();
	}
	return this.data.players[xuid];
};

// 所有已注册的DataManager实例集合
const _dataManagers = {};

/** 注册一个DataManager实例到全局集合，便于统一管理 */
function registerDataManager(name, path, defaultData, options) {
	const dm = new DataManager(path, defaultData, options);
	_dataManagers[name] = dm;
	return dm;
}

// ============ 配置与数据初始化 ============

/** 根据LEVEL_EXP_STEPS累加生成等级经验表 */
function initLevelExpTable() {
	levelUpExp[0] = 0;
	let total = 0;
	for (let i = 0; i < C.LEVEL_EXP_STEPS.length; i++) {
		total += C.LEVEL_EXP_STEPS[i];
		levelUpExp[i + 1] = total;
	}
}

/**
 * JSON配置文件适配器：提供init/get/set/delete等标准接口
 * 用于config.json等需要按key存取的配置文件（不同于DataManager的全量读写）
 */
function JsonConfigFileAdapter(filePath, defaultContent) {
	this._path = filePath;
	this._data = {};
	try {
		U.ensureDir(filePath);
		if (fs.existsSync(filePath)) {
			let content = fs.readFileSync(filePath, 'utf-8');
			if (content && content.trim() !== '') {
				this._data = JSON.parse(content);
			}
		} else {
			if (defaultContent) {
				const defaultData = JSON.parse(defaultContent);
				this._data = defaultData;
				fs.writeFileSync(filePath, defaultContent, 'utf-8');
			}
		}
	} catch (e) {
		logger.error('JsonConfigFileAdapter加载失败[' + filePath + ']：' + e.message);
	}
}

/** 内部辅助：按点号路径解析嵌套对象，返回 { obj, key } 或 null */
JsonConfigFileAdapter.prototype._resolve = function(path) {
	if (path.indexOf('.') === -1) return { obj: this._data, key: path };
	var parts = path.split('.');
	var current = this._data;
	for (var i = 0; i < parts.length - 1; i++) {
		if (current === null || current === undefined || typeof current !== 'object') return null;
		current = current[parts[i]];
	}
	if (current === null || current === undefined || typeof current !== 'object') return null;
	return { obj: current, key: parts[parts.length - 1] };
};

/** 初始化配置项：不存在时写入默认值并保存（支持点号路径） */
JsonConfigFileAdapter.prototype.init = function(name, defaultValue) {
	var resolved = this._resolve(name);
	if (!resolved) {
		// 父路径不存在，需要逐层创建
		if (name.indexOf('.') !== -1) {
			var parts = name.split('.');
			var current = this._data;
			for (var i = 0; i < parts.length - 1; i++) {
				if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
					current[parts[i]] = {};
				}
				current = current[parts[i]];
			}
			if (current[parts[parts.length - 1]] === undefined) {
				current[parts[parts.length - 1]] = defaultValue;
				this._save();
			}
			return current[parts[parts.length - 1]];
		}
		this._data[name] = defaultValue;
		this._save();
		return this._data[name];
	}
	if (resolved.obj[resolved.key] === undefined) {
		resolved.obj[resolved.key] = defaultValue;
		this._save();
	}
	return resolved.obj[resolved.key];
};

/** 获取配置项，可指定默认值（支持点号路径如 'shop.enabled'） */
JsonConfigFileAdapter.prototype.get = function(name, defaultValue) {
	if (name.indexOf('.') === -1) {
		if (this._data[name] !== undefined) return this._data[name];
		return defaultValue !== undefined ? defaultValue : null;
	}
	var resolved = this._resolve(name);
	if (resolved && resolved.obj[resolved.key] !== undefined) return resolved.obj[resolved.key];
	return defaultValue !== undefined ? defaultValue : null;
};

/** 设置配置项并立即保存（支持点号路径） */
JsonConfigFileAdapter.prototype.set = function(name, value) {
	if (name.indexOf('.') === -1) {
		this._data[name] = value;
		this._save();
		return true;
	}
	var resolved = this._resolve(name);
	if (!resolved) {
		// 父路径不存在，逐层创建
		var parts = name.split('.');
		var current = this._data;
		for (var i = 0; i < parts.length - 1; i++) {
			if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
				current[parts[i]] = {};
			}
			current = current[parts[i]];
		}
		current[parts[parts.length - 1]] = value;
		this._save();
		return true;
	}
	resolved.obj[resolved.key] = value;
	this._save();
	return true;
};

/** 删除配置项并立即保存（支持点号路径） */
JsonConfigFileAdapter.prototype.delete = function(name) {
	if (name.indexOf('.') === -1) {
		if (this._data[name] !== undefined) {
			delete this._data[name];
			this._save();
			return true;
		}
		return false;
	}
	var resolved = this._resolve(name);
	if (resolved && resolved.obj[resolved.key] !== undefined) {
		delete resolved.obj[resolved.key];
		this._save();
		return true;
	}
	return false;
};

/** 从磁盘重新加载配置（不丢失内存中已有但磁盘上没有的key） */
JsonConfigFileAdapter.prototype.reload = function() {
	try {
		if (fs.existsSync(this._path)) {
			const content = fs.readFileSync(this._path, 'utf-8');
			if (content && content.trim() !== '') {
				this._data = JSON.parse(content);
			}
		}
		return true;
	} catch (e) {
		return false;
	}
};

/** 获取配置文件路径 */
JsonConfigFileAdapter.prototype.getPath = function() {
	return this._path;
};

/** 读取全部配置为格式化JSON字符串 */
JsonConfigFileAdapter.prototype.read = function() {
	return JSON.stringify(this._data, null, 2);
};

/** 写入JSON字符串覆盖全部配置 */
JsonConfigFileAdapter.prototype.write = function(content) {
	try {
		this._data = JSON.parse(content);
		this._save();
		return true;
	} catch (e) {
		return false;
	}
};

/** 内部保存：将_data序列化写入磁盘（防抖模式，50ms内多次调用只写一次） */
JsonConfigFileAdapter.prototype._save = function() {
	var self = this;
	if (self._saveTimer) clearTimeout(self._saveTimer);
	self._saveTimer = setTimeout(function() {
		self._saveTimer = null;
		try {
			U.ensureDir(self._path);
			fs.writeFileSync(self._path, JSON.stringify(self._data, null, 2), 'utf-8');
		} catch (e) {
			logger.error('JsonConfigFileAdapter保存失败[' + self._path + ']：' + e.message);
		}
	}, 50);
};

/** 立即写入磁盘（用于关服等关键操作，取消防抖直接写） */
JsonConfigFileAdapter.prototype.flush = function() {
	if (this._saveTimer) {
		clearTimeout(this._saveTimer);
		this._saveTimer = null;
	}
	try {
		U.ensureDir(this._path);
		fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
	} catch (e) {
		logger.error('JsonConfigFileAdapter保存失败[' + this._path + ']：' + e.message);
	}
};

/** 初始化主配置文件，注册所有默认配置项（功能开关、传送参数、Web设置等） */
function initRankConfig() {
	try {
		config = new JsonConfigFileAdapter(CONFIG_PATH);
		config.init("debug", false);
		_debugMode = config.get("debug", false);
		debugModule.setDebugMode(_debugMode);
		config.init("currencyName", "星茜");
		config.init("sidebarCompact", false);
		// 功能开关：统一嵌套到各自模块的 enabled 字段
		config.init("shop", { "enabled": true, "enableRecycle": true, "enableXpShop": true });
		config.init("rank", { "enabled": true });
		config.init("cdk", { "enabled": true });
		config.init("bank", { "enabled": true });
		config.init("vip", { "enabled": true });
		config.init("friend", { "enabled": true });
		config.init("messageBoard", { "enabled": true });
		config.init("mail", { "enabled": true });
		config.init("level", { "enabled": true });
		config.init("back", { "enabled": true });
		config.init("guild", {
			"enabled": true,
			"createCost": 1000,
			"maxMembers": 20,
			"maxTeleports": 5,
			"maxAdmins": 3,
			"depositCost": 0,
			"withdrawAdminOnly": false,
			"teleportCooldown": 10
		});
		config.init("teleport", {
			"enabled": true,
			"enableHome": true,
			"enableWarp": true,
			"enableTpa": true,
			"homeLimit": 10,
			"homeCooldown": 10,
			"tpaCooldown": 30,
			"tpaTimeout": 30,
			"tpaCost": 0,
			"warpCost": 0
		});
		config.init("backup", {
			"compressionLevel": 5,
			"interval": 0,
			"maxAgeDays": 0,
			"maxCount": 0
		});
		config.init("web", {
			"enabled": true,
			"enableFrontend": true,
			"port": 8080,
			"host": "0.0.0.0",
			"jwtSecret": "NECE_Default_Secret_Change_Me",
			"jwtExpire": "15m",
			"jwtRefreshSecret": "NECE_Default_Refresh_Secret_Change_Me",
			"jwtRefreshExpire": "7d"
		});
		// 旧键迁移：将旧格式的 enable* 标志和 *Config 键迁移到新的嵌套结构
		_migrateOldConfigKeys();
	} catch (error) {
		// 配置加载失败时使用全通过的降级配置，避免插件完全无法启动
		config = {
			get: (key) => true,
			set: () => true,
			init: () => {},
			reload: () => {}
		};
		logger.error(`排行榜配置初始化失败！错误：${error.message}`);
	}
}

/** 一次性迁移旧格式配置键到新的嵌套结构 */
function _migrateOldConfigKeys() {
	var _data = config._data;
	var _changed = false;

	// enable* 标志迁移到各模块子对象
	var _enableMap = {
		'enableShop': ['shop', 'enabled'],
		'enableRecycle': ['shop', 'enableRecycle'],
		'enableDustShop': ['shop', 'enableXpShop'],
		'enableRank': ['rank', 'enabled'],
		'enableCdk': ['cdk', 'enabled'],
		'enableBank': ['bank', 'enabled'],
		'enableVip': ['vip', 'enabled'],
		'enableFriend': ['friend', 'enabled'],
		'enableMessageBoard': ['messageBoard', 'enabled'],
		'enableMail': ['mail', 'enabled'],
		'enableLevel': ['level', 'enabled'],
		'enableBack': ['back', 'enabled'],
		'enableGuild': ['guild', 'enabled']
	};
	for (var oldKey in _enableMap) {
		if (_data[oldKey] !== undefined) {
			var target = _enableMap[oldKey];
			if (!_data[target[0]] || typeof _data[target[0]] !== 'object') _data[target[0]] = {};
			_data[target[0]][target[1]] = _data[oldKey];
			delete _data[oldKey];
			_changed = true;
		}
	}

	// *Config 键重命名（去掉 Config 后缀）
	var _renameMap = {
		'wishConfig': 'wish',
		'guildConfig': 'guild',
		'backupConfig': 'backup',
		'menuConfig': 'menu',
		'motdConfig': 'motd'
	};
	for (var oldName in _renameMap) {
		if (_data[oldName] !== undefined) {
			var newName = _renameMap[oldName];
			if (_data[newName] === undefined || typeof _data[newName] !== 'object') {
				_data[newName] = {};
			}
			// 合并旧值到新键（保留新键中已有的字段）
			var oldVal = _data[oldName];
			if (typeof oldVal === 'object' && oldVal !== null) {
				for (var k in oldVal) {
					if (oldVal.hasOwnProperty(k)) {
						_data[newName][k] = oldVal[k];
					}
				}
			}
			delete _data[oldName];
			_changed = true;
		}
	}

	// 删除冗余的 enableMotd（已有 motd.enabled）
	if (_data['enableMotd'] !== undefined) {
		delete _data['enableMotd'];
		_changed = true;
	}

	if (_changed) {
		config._save();
		logger.info('[配置文件已从旧格式迁移到新嵌套结构');
	}
}

const IPV4_MESSAGE = C.IPV4_MESSAGE;
const IPV6_MESSAGE = C.IPV6_MESSAGE;

/** 初始化玩家核心数据：优先从SQL加载，否则从JSON文件加载 */
function initPlayerData() {
	// SQL 模式：从数据库加载玩家核心数据
	const sqlPlayers = database.getAllPlayerDataSQL();
	const sqlNextUid = database.getNextUidSQL();
	playerData = { nextUid: sqlNextUid, players: sqlPlayers };
	logger.info(' 玩家核心数据已从SQL加载 (' + Object.keys(sqlPlayers).length + ' 个玩家)');
	debugLog('initPlayerData: SQL模式, nextUid=' + sqlNextUid + ', 玩家数=' + Object.keys(sqlPlayers).length);
	if (!playerData.players) playerData.players = {};
	if (!playerData.nextUid) playerData.nextUid = 10000;
}

// 从playerDataModule获取玩家数据保存函数（防抖/立即/单玩家）
const savePlayerData = playerDataModule.savePlayerData;
const savePlayerDataNow = playerDataModule.savePlayerDataNow;
const saveSinglePlayerData = playerDataModule.saveSinglePlayerData;

/** 从DataManager加载玩家个人设置 */
function initPlayerSettings() {
	playerSettings = playerSettingsDM.load();
}

const loadItemsDataMap = playerDataModule.loadItemsDataMap;

/** 加载商店商品数据 */
function initShopData() {
	shopData = shopDataDM.load();
}

/** 加载CDK兑换码数据 */
function initCdkData() {
	cdkDataDM.load();
}

/** 加载回收配置，确保回收日志目录存在 */
function initRecycleConfig() {
	recycleConfig = recycleConfigDM.load();
	if (!fs.existsSync(RECYCLE_LOG_DIR)) {
		fs.mkdirSync(RECYCLE_LOG_DIR, { recursive: true });
	}
}


// 从playerDataModule获取玩家设置的读写函数
const getPlayerSetting = playerDataModule.getPlayerSetting;
const setPlayerSetting = playerDataModule.setPlayerSetting;


// ============ DataManager实例注册 ============

const wishDM = registerDataManager('wish', WISH_DATA_PATH, {
	players: {}
});
const deathPointDM = registerDataManager('deathPoint', DEATH_POINT_DATA_PATH, {}, {
	sqlPrefix: 'deathPoints'
});
const friendDM = registerDataManager('friend', FRIEND_DATA_PATH, {}, {
	sqlPrefix: 'friends'
});
const messageDM = registerDataManager('message', MESSAGE_DATA_PATH, {}, {
	sqlPrefix: 'messages'
});
const banDM = registerDataManager('ban', BAN_DATA_PATH, {
	entries: {}
});
const mailDM = registerDataManager('mail', MAIL_DATA_PATH, {
	mails: [],
	nextId: 1
});
const messageBoardDM = registerDataManager('messageBoard', MESSAGEBOARD_DATA_PATH, {
	messages: [],
	nextId: 1
});
const playerSettingsDM = registerDataManager('playerSettings', PLAYER_SETTINGS_PATH, {}, {
	pretty: false,
	sqlPrefix: 'settings'
});
const narConfigDM = registerDataManager('narConfig', NAR_CONFIG_PATH, {
	npc_actions: {}
});
const homesDM = registerDataManager('homes', HOMES_DATA_PATH, {}, {
	sqlPrefix: 'homes'
});
const warpsDM = registerDataManager('warps', WARPS_DATA_PATH, {});

const DEFAULT_ENCHANT_BOOK_CONFIG = C.DEFAULT_ENCHANT_BOOK_CONFIG;
const enchantBookShopDM = registerDataManager('enchantBookShop', ENCHANT_BOOK_SHOP_PATH, DEFAULT_ENCHANT_BOOK_CONFIG);
const spawnEggShopDM = registerDataManager('spawnEggShop', SPAWN_EGG_SHOP_PATH, spawnEggShopConfig);

const shopDataDM = registerDataManager('shopData', SHOP_DATA_PATH, {
	Buy: [],
	Sell: []
});

const cdkDataDM = registerDataManager('cdkData', CDK_DATA_PATH, {
	codes: {}
});

const recycleConfigDM = registerDataManager('recycleConfig', RECYCLE_DATA_PATH, {
	recycleItems: {}
});

/** 将死亡点DataManager传递给传送模块 */
function initDeathPointData() {
	teleportModule.initDeathPoint(deathPointDM);
}


// ============ 模块初始化 ============

/**
 * 主初始化函数：按顺序加载所有配置、初始化数据库、创建并注入模块依赖
 * 调用时机：onServerStarted
 */
async function initAllConfigs() {
	initLevelExpTable();
	initRankConfig();
	// 经济模块和玩家数据模块需要最先初始化（其他模块依赖它们）
	economyModule.init({ config: config, getPlayerData: function() { return playerData; }, getPlayerAvatarUrl: getPlayerAvatarUrl });
	playerDataModule.init({ database: database, config: config, constants: C, fs: fs, itemsDataPath: ITEMS_DATA_PATH,
		getPlayerData: function() { return playerData; },
		getPlayerSettings: function() { return playerSettings; },
		savePlayerSettings: function() { playerSettingsDM.save(true); }
	});
	database.setDebugMode(_debugMode);
	debugLog("initAllConfigs: Debug模式已" + (_debugMode ? "开启" : "关闭"));
	debugLog("initAllConfigs: 开始初始化所有模块...");
	// 初始化玩家数据库(SQL)
	await database.initPlayerDatabase();
	debugLog("initAllConfigs: 玩家数据库初始化完成");
	initPlayerData();
	debugLog("initAllConfigs: 玩家数据加载完成, 玩家数=" + Object.keys(playerData.players || {}).length);
	initPlayerSettings();
	initShopData();
	initCdkData();
	loadItemsDataMap();
	initRecycleConfig();
	debugLog("initAllConfigs: 商店/CDK/物品/回收配置加载完成");
	messageBoardModule.init(messageBoardDM);
	spawnEggShopConfig = spawnEggShopDM.load();
	initDeathPointData();
	debugLog('friendModule.init: 好友模块初始化, playerData.players 条目=' + Object.keys(playerData.players || {}).length);
	friendModule.init(friendDM, messageDM, {
		playerData: playerData.players,
		getPlayerData: function() { return playerData; },
		savePlayerData: savePlayerData,
		getPlayerInfoByXuid: function(xuid) { return playerData.players[xuid] || null; },
		getPlayerAvatarUrl: friendModule.getPlayerAvatarUrl,
		getPlayerSetting: getPlayerSetting,
		showPersonalCenterForm: personalCenter.showPersonalCenterForm,
		mailApi: mailModule
	});
	debugLog('banModule.init: 封禁模块初始化完成');
	banModule.init(banDM, {
		playerData: playerData.players
	});
	mailModule.init(mailDM, {
		U: U,
		money: money,
		getCurrencyName: getCurrencyName,
		getPlayerSetting: getPlayerSetting,
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		searchPlayers: searchPlayers,
		notifyEconomyChange: notifyEconomyChange,
		logger: logger,
		showPersonalCenterForm: personalCenter.showPersonalCenterForm
	});
	menuModule.init({ config: config, getCurrencyName: getCurrencyName, getPlayerData: function() { return playerData; }, savePlayerData: savePlayerData });
	menuModule.loadConfig();
	chatModule.init({ fs: fs, U: U, badWordsPath: BAD_WORDS_PATH, webServer: webServer,
		getPlayerData: function() { return playerData; }, savePlayerData: savePlayerData,
		getPlayerMoney: getPlayerMoney, reducePlayerMoney: reducePlayerMoney,
		getCurrencyName: getCurrencyName, getConfig: function() { return config._data || {}; }
	});
	chatModule.loadChatConfig();
	chatModule.registerChatListener();
	initNarConfig();
	backupModule.init(config.get("backup"));

	guildModule.init({
		logger: logger,
		getPlayerMoney: getPlayerMoney,
		addPlayerMoney: addPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		getConfig: function() { return config.get('guild'); },
		getCurrencyName: getCurrencyName,
		getPlayerName: function(xuid) {
			var p = playerData.players[xuid];
			return p ? p.name : xuid;
		},
		getPlayerData: function() { return playerData; },
		mailApi: mailModule,
		chatModule: chatModule,
		notifyEconomyChange: notifyEconomyChange
	});

	// ============ 依赖注入与模块创建 ============
	// commonDeps：共享依赖包，聚合常用函数/数据，传递给需要广泛访问的模块
	commonDeps = {
		// 经济系统
		getPlayerMoney: getPlayerMoney,       // (Player) => number — 获取在线玩家余额
		addPlayerMoney: addPlayerMoney,       // (Player, number, string?) => void — 增加余额
		reducePlayerMoney: reducePlayerMoney, // (Player, number, string?) => boolean — 减少余额
		addPlayerMoneyByXuid: addPlayerMoneyByXuid,   // (xuid, number) => void — 按XUID增加余额
		getPlayerMoneyByXuid: getPlayerMoneyByXuid,   // (xuid) => number — 按XUID查询余额
		getCurrencyName: getCurrencyName,     // () => string — 获取货币名称
		notifyEconomyChange: notifyEconomyChange, // (Player, number, string?) => void — 发送余额变动通知
		money: money,                         // LLMoney API: get(xuid)/add(xuid,n)/reduce(xuid,n)
		// 玩家数据
		playerData: playerData,               // 内存中的玩家数据对象 { players: {}, nextUid: number }
		savePlayerDataNow: savePlayerDataNow, // () => void — 立即保存所有玩家数据（关服用）
		getPlayerSetting: getPlayerSetting,   // (xuid, key) => any — 获取玩家个人设置
		getPlayerAvatarUrl: getPlayerAvatarUrl, // (xuid) => string — 获取玩家头像URL
		getVipInfo: getVipInfo,               // (xuid) => object|null — 获取VIP信息
		giveItemById: giveItemById,           // (Player, itemId, count) => boolean — 给予物品
		// 商店/回收
		shopData: shopData,                   // 商店商品数据
		recycleConfig: recycleConfig,         // 回收配置
		showRecycleForm: function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); },
		RECYCLE_LOG_DIR: RECYCLE_LOG_DIR,     // 回收日志目录
		// UI
		openMainMenu: personalCenter.openMainMenu // (Player) => void — 打开主菜单
	};

	teleportModule.init(config, homesDM, warpsDM, commonDeps);

	// 使用工厂模式创建的模块（vip/cdk/rank/bank），创建后挂到commonDeps上
	let vipModule = vipModuleCreator.create({
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		openMainMenu: personalCenter.openMainMenu
	});
	commonDeps.vipModule = vipModule;

	if (hasWish) {
		wishModule.init(wishDM, enchantBookShopDM, spawnEggShopDM, {
			getPlayerMoney: getPlayerMoney,
			reducePlayerMoney: reducePlayerMoney,
			getCurrencyName: getCurrencyName,
			notifyEconomyChange: notifyEconomyChange,
			playerData: playerData.players,
			savePlayerDataNow: savePlayerDataNow,
			money: money,
			openMainMenu: personalCenter.openMainMenu,
			vipModule: vipModule,
			showPersonalCenterForm: personalCenter.showPersonalCenterForm,
			constants: C,
			getPlayerData: function() { return playerData; },
			getPlayerSetting: getPlayerSetting
		});
	}
	commonDeps.wishModule = wishModule;

	let cdkModule = cdkModuleCreator.create({
		cdkDataDM: cdkDataDM,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		giveItemById: giveItemById
	});
	commonDeps.cdkModule = cdkModule;

	let rankModule = rankModuleCreator.create({
		playerData: playerData,
		getCurrencyName: getCurrencyName
	});
	commonDeps.rankModule = rankModule;

	let bankModule = bankModuleCreator.create({
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		openMainMenu: personalCenter.openMainMenu,
		utils: U
	});
	commonDeps.bankModule = bankModule;

	// 个人中心模块初始化（必须在所有模块之后，因为它依赖其他模块的引用）
	personalCenter.init({
		getPlayerData: function() { return playerData; },
		savePlayerDataNow: savePlayerDataNow,
		money: money,
		config: config,
		getCurrencyName: getCurrencyName,
		notifyEconomyChange: notifyEconomyChange,
		getPlayerSetting: getPlayerSetting,
		setPlayerSetting: setPlayerSetting,
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		showAvatarSettingsForm: showAvatarSettingsForm,
		friendModule: friendModule,
		mailModule: mailModule,
		wishModule: wishModule,
		messageBoardModule: messageBoardModule,
		teleportModule: teleportModule,
		menuModule: menuModule,
		commonDeps: commonDeps
	});
	personalCenter.setLevelUpExp(levelUpExp);
	personalCenter.installPrototypeExtensions();

	// MOTD 动态轮换模块
	motdModule.init(config);
	motdModule.start();

	// 定时实体清理模块
	clearLagModule.init(config);
	clearLagModule.start();

	_initialized = true;
}

// ============ 核心事件监听 ============

/**
 * 玩家加入事件：创建新玩家数据或更新老玩家信息，记录在线状态，发送欢迎消息
 * 同时处理：IP检测、银行定期到期检查、未读消息提醒、入服物品发放
 */
mc.listen("onJoin", (player) => {
	if (!_initialized) return; // 防止插件重载时模块未初始化完毕
	const playerXUID = String(player.xuid);
	const playerName = player.name;
	const playerUUID = player.uuid;
	debugLog('onJoin: 玩家加入 ' + playerName + ' (XUID: ' + playerXUID + '), playerData.players 条目数=' + Object.keys(playerData.players || {}).length + ', 已存在=' + (!!playerData.players[playerXUID]));

	if (!playerData.players[playerXUID]) {
		// 新玩家：分配UID并创建初始数据
		let nextUid = playerData.nextUid || 10000;
			// 防止UID冲突：检查nextUid是否已被其他玩家使用
			let _uidTaken = false;
			for (let _xuid in playerData.players) {
				if (playerData.players[_xuid] && playerData.players[_xuid].uid === nextUid) {
					_uidTaken = true;
					debugWarn('onJoin: UID ' + nextUid + ' 已被 XUID ' + _xuid + ' 使用，寻找下一个可用UID');
					break;
				}
			}
			if (_uidTaken) {
				let _maxUid = nextUid;
				for (let _xuid in playerData.players) {
					if (playerData.players[_xuid] && playerData.players[_xuid].uid > _maxUid) _maxUid = playerData.players[_xuid].uid;
				}
				nextUid = _maxUid + 1;
				playerData.nextUid = nextUid;
				debugLog('onJoin: 修正后UID=' + nextUid);
			}
		playerData.players[playerXUID] = {
			uid: nextUid,
			registerTime: system.getTimeStr(),
			name: playerName,
			uuid: playerUUID,
			healthBonus: 0,
			lastIp: (function() { try { let d = player.getDevice(); return d && d.ip ? d.ip : ''; } catch(e) { return ''; } })(),
			platform: (function() { try { const d = player.getDevice(); return d && d.os ? d.os : ''; } catch(e) { return ''; } })()
		};
		playerData.nextUid = nextUid + 1;
		debugLog('onJoin: 新玩家 ' + playerName + ' (XUID: ' + playerXUID + ') 分配UID: ' + nextUid);
		player.tell(`§a注册成功！您的UID：${nextUid}`, 1);
		logger.info(`新玩家 ${playerName}（XUID: ${playerXUID}）分配UID: ${nextUid}`);
		playerDataModule.markPlayerDirty(playerXUID);
	} else {
		// 老玩家：更新名字和设备信息
		playerData.players[playerXUID].name = playerName;
		debugLog('onJoin: 老玩家 ' + playerName + ' (XUID: ' + playerXUID + ') UID: ' + playerData.players[playerXUID].uid);
		try {
			const dev = player.getDevice();
			if (dev && dev.ip) playerData.players[playerXUID].lastIp = dev.ip;
			if (dev && dev.os) playerData.players[playerXUID].platform = dev.os;
		} catch(e) { logger.warn('[Core] 获取玩家设备信息失败: ' + e.message); }
		// 数据兼容：补全旧数据缺失的字段
		if (playerData.players[playerXUID].uid === undefined) {
			playerData.players[playerXUID].uid = 9999;
			logger.warn(`玩家 ${playerName} 数据缺失UID，已补全为9999`);
		}
		if (playerData.players[playerXUID].healthBonus === undefined) {
			playerData.players[playerXUID].healthBonus = 0;
		}
		playerDataModule.markPlayerDirty(playerXUID);
	}

	_joinTimestamps[playerXUID] = Date.now();
	onlinePlayers[String(playerXUID)] = true;
	personalCenter.obtainStatBlock(playerXUID);

	const xuid = String(playerXUID);
	const now = Date.now();

	// 欢迎消息：老玩家显示离线时长和总游戏时长，新玩家显示欢迎语
	if (getPlayerSetting(xuid, "enableWelcome")) {
		try {
			let p = playerData.players[playerXUID];
			if (p && p.leavetime) {
				const lastLeave = p.leavetime;
				const awaySeconds = Math.floor((now - lastLeave) / 1000);
				const awayTime = U.formatTime(awaySeconds);

				const playTime = p.count && p.count.playTime ? p.count.playTime : 0;
				const totalPlayTime = U.formatTime(playTime);

				player.sendToast(
					`§b欢迎回来，§6${playerName}`,
					`§b距离您上次游玩已经过去§a${awayTime}§b，您的总游戏时长为:§a${totalPlayTime}`
				);

				delete p.leavetime;
			} else {
				player.sendToast(
					'§6欢迎来到§cCitlalia服务器！',
					'§b这是你第一次加入服务器，已发放新手礼包到您的背包'
				);
			}
		} catch (error) {
			logger.error(`处理玩家欢迎消息时出错：${error.message}`);
		}
	}

	// 统一保存一次（合并了之前分散的两次 saveSinglePlayerData 调用）
	saveSinglePlayerData(playerXUID);

	// 检查并通知玩家的待处理经济转账
	economyModule.checkPendingTransfers(player);
	// ipDetector功能：网络协议检测（根据玩家设置）
	if (getPlayerSetting(xuid, "enableIpDetector")) {
		try {
			const device = player.getDevice();

			if (device && device.ip) {
				const isIPv6 = U.detectIPv6(U.stripIpPort(device.ip));

				if (isIPv6) {
					player.tell(IPV6_MESSAGE);
				} else {
					player.tell(IPV4_MESSAGE);
				}
			}
		} catch (error) {
			logger.error(`处理IP检测时出错：${error.message}`);
		}
	}

	// Debug 模式弹窗（首次进服提示，使用独立JSON记录已关闭的玩家）
	if (_debugMode) {
		try {
			const debugDismissedPath = C.PATHS.DEBUG_DISMISSED;
			let dismissed = {};
			try { dismissed = JSON.parse(fs.readFileSync(debugDismissedPath, 'utf-8')); } catch (e) {}
			if (!dismissed[playerXUID]) {
				const form = mc.newSimpleForm();
				form.setTitle("Debug Mod");
				form.setContent("你正在参与服务器测试，如遇问题请反馈给管理员。");
				form.addButton("关闭");
				player.sendForm(form, function() {
					dismissed[playerXUID] = true;
					try { fs.writeFileSync(debugDismissedPath, JSON.stringify(dismissed), 'utf-8'); } catch (e) {}
				});
			}
		} catch (e) { logger.warn('[Debug] 弹窗异常: ' + e.message); }
	}

	// 检查定期存款到期情况
	try {
		commonDeps.bankModule.checkFixedDepositMaturity(player, getPlayerSetting);
	} catch (error) {
		logger.error(`检查定期存款到期情况时出错：${error.message}`);
	}

	// 检查未读消息和邮件
	try {
		setTimeout(() => {
			checkUnreadMessagesAndMails(player);
		}, 3000); // 延迟3秒显示，避免与其他消息冲突
	} catch (error) {
		logger.error(`检查未读消息时出错：${error.message}`);
	}

	// 入服给钟和指南针功能（根据玩家设置，默认开启）
	try {
		setTimeout(() => {
			giveJoinItems(player);
		}, 1000); // 延迟1秒给物品
	} catch (error) {
		logger.error(`入服给物品时出错：${error.message}`);
	}
});

/**
 * 玩家离开事件：累计在线时长，清除在线状态和缓存，记录离开时间
 */
mc.listen("onLeft", (player) => {
	const xuid = player.xuid;
	const xuidStr = String(xuid);
	if (_joinTimestamps[xuid]) {
		let sessionSec = Math.floor((Date.now() - _joinTimestamps[xuid]) / 1000);
		personalCenter.bumpStat(xuid, "playTime", sessionSec);
		delete _joinTimestamps[xuid];
	}

	delete onlinePlayers[xuidStr];
	sidebarModule.clearPlayerCache(xuidStr);

	// 记录离开时间，下次加入时用于计算"您已离开X小时"
	let p = playerData.players[xuidStr];
	if (p) {
		p.leavetime = Date.now();
		playerDataModule.markPlayerDirty(xuidStr);
	}
	saveSinglePlayerData(xuidStr);
	// 保存背包快照到数据库（供API查询离线玩家背包）
	try {
		const inv = player.getInventory();
		const allItems = inv.getAllItems();
		const snapshot = [];
		for (let s = 0; s < allItems.length; s++) {
			const it = allItems[s];
			if (it.type && it.type !== '' && it.type !== 'minecraft:air') {
				snapshot.push({ slot: s, type: it.type, count: it.count, name: it.name || '' });
			}
		}
		const armorSnapshot = [];
		try {
			const armorContainer = player.getArmor();
			if (armorContainer) {
				const armorSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
				const armorItems = armorContainer.getAllItems();
				for (let s = 0; s < armorItems.length; s++) {
					const it = armorItems[s];
					if (it.type && it.type !== '' && it.type !== 'minecraft:air') {
						armorSnapshot.push({ slot: armorSlots[s] || s, type: it.type, count: it.count, name: it.name || '' });
					}
				}
			}
		} catch (e) {}
		const offhandSnapshot = [];
		try {
			const offhandItem = player.getOffHand();
			if (offhandItem && offhandItem.type && offhandItem.type !== '' && offhandItem.type !== 'minecraft:air') {
				offhandSnapshot.push({ slot: 0, type: offhandItem.type, count: offhandItem.count, name: offhandItem.name || '' });
			}
		} catch (e) {}
		database.savePlayerInventorySQL(xuidStr, snapshot, armorSnapshot, offhandSnapshot);
	} catch (e) { logger.warn('保存背包快照失败: ' + e.message); }
});

/** 注册游戏行为统计监听（挖掘、放置、击杀、死亡）和死亡点记录 */
// 热路径缓存：避免每次事件都走 config.get 的 dot-path 解析
var _rankEnabled = true;
var _backEnabled = true;
function _refreshStatConfigCache() {
	if (!config) return; // config 尚未初始化时跳过
	_rankEnabled = config.get("rank.enabled") !== false;
	_backEnabled = config.get("back.enabled") !== false;
}
function initStatTrackers() {
	_refreshStatConfigCache();
	mc.listen("onDestroyBlock", function(player, block) {
		if (!_rankEnabled) return;
		personalCenter.bumpStat(player.xuid, "mining", 1);
	});

	mc.listen("afterPlaceBlock", function(player, block) {
		if (!_rankEnabled) return;
		personalCenter.bumpStat(player.xuid, "placing", 1);
	});

	mc.listen("onMobDie", function(mob, source, cause) {
		if (!_rankEnabled) return;
		if (!source || !source.isPlayer()) return;
		const killer = source.toPlayer();
		if (killer && !killer.isSimulatedPlayer() && killer.realName !== undefined) {
			personalCenter.bumpStat(killer.xuid, "kills", 1);
			personalCenter.bumpStat(killer.xuid, "mobKills", 1);
		}
	});

	mc.listen("onPlayerDie", function(player, source) {
		if (!_rankEnabled) return;
		personalCenter.bumpStat(player.xuid, "deaths", 1);

		if (_backEnabled) {
			teleportModule.recordDeathPoint(player);

			// 死亡传送弹窗：记录死亡点后弹窗询问是否传送回去
			if (getPlayerSetting(player.xuid, "enableDeathTeleportPopup")) {
				const dpData = teleportModule.getDeathPointData();
				const deathPoints = dpData.players[player.xuid];
				if (deathPoints && deathPoints.length > 0) {
					const latestDeath = deathPoints[0];
					const dp_xuid = player.xuid;
					setTimeout(function() {
						const pl = mc.getPlayer(dp_xuid);
						if (pl) {
							pl.sendModalForm(
								"§c您已死亡",
								"死亡位置：§f" + latestDeath.dimName + "\n" +
								"坐标：§fX:" + latestDeath.x + " Y:" + latestDeath.y + " Z:" + latestDeath.z + "\n" +
								"时间：§f" + latestDeath.time + "\n\n" +
								"§e是否传送回死亡地点？",
								"§a确认传送",
								"§c取消",
								function(p, result) {
									if (result) {
										teleportModule.teleportToDeathPoint(p, 0);
									}
								}
							);
						}
				}, 1000);
				}
			}
		}
	});
}

initStatTrackers();

/** 定时（约59秒）累计在线玩家的游戏时长到统计数据，只保存有变化的玩家 */
function tickOnlineDurations() {
	if (!_rankEnabled) return;
	let now = Date.now();
	Object.keys(_joinTimestamps).forEach(function(xuid) {
		const blk = personalCenter.obtainStatBlock(xuid);
		if (!blk) return;
		blk.playTime += Math.floor((now - _joinTimestamps[xuid]) / 1000);
		_joinTimestamps[xuid] = now;
		// 仅更新 count JSON 中的 playTime，避免全行写入
		database.updatePlayTimeSQL(xuid, blk.playTime);
	});
}

setInterval(tickOnlineDurations, 58848);

// 定时（30秒）清理已离线但未触发 onLeft 的残留条目（崩溃等异常情况）
// 使用 mc.getOnlinePlayers() 单次原生调用替代 N 次 mc.getPlayer()
var _leavetimeWriteTick = 0;
setInterval(() => {
	const now = Date.now();
	// 一次原生调用获取所有在线玩家，构建 xuid Set
	const onlineList = mc.getOnlinePlayers();
	const onlineSet = {};
	for (var i = 0; i < onlineList.length; i++) {
		onlineSet[String(onlineList[i].xuid)] = true;
	}
	// 清理残留条目
	Object.keys(onlinePlayers).forEach(xuid => {
		if (!onlineSet[xuid]) {
			delete onlinePlayers[xuid];
			delete _joinTimestamps[xuid];
			sidebarModule.clearPlayerCache(xuid);
		}
	});
	// leavetime 仅每5个周期（约2.5分钟）写入一次，降低 SQLite 写入频率
	_leavetimeWriteTick++;
	if (_leavetimeWriteTick >= 5) {
		_leavetimeWriteTick = 0;
		Object.keys(onlinePlayers).forEach(xuid => {
			const p = playerData.players[xuid];
			if (p) {
				p.leavetime = now;
				database.updateLeaveTimeSQL(xuid, String(now));
			}
		});
	}
}, 30000);


// ============ 经济系统代理 ============

// 从economyModule导出常用经济操作函数（通过闭包代理到模块内部实现）
const getCurrencyName = economyModule.getCurrencyName;
const notifyEconomyChange = economyModule.notifyEconomyChange;
const getPlayerMoney = economyModule.getPlayerMoney;
const reducePlayerMoney = economyModule.reducePlayerMoney;
const addPlayerMoney = economyModule.addPlayerMoney;
const getPlayerMoneyByXuid = economyModule.getPlayerMoneyByXuid;
const addPlayerMoneyByXuid = economyModule.addPlayerMoneyByXuid;

/**
 * 给玩家发放物品，自动处理可堆叠物品的分批（64个一组）
 * @param {Player} player - 目标玩家
 * @param {string|Object} itemData - 物品ID字符串或{id, aux}对象
 * @param {number} count - 数量
 */
function giveItem(player, itemData, count) {
	let id = typeof itemData === 'string' ? itemData : itemData.id;
	const aux = typeof itemData === 'string' ? 0 : (itemData.aux || 0);
	const testItem = mc.newItem(id, 1);
	testItem.setAux(aux);
	if (testItem.isStackable) {
		// 可堆叠物品：每64个一组分批发放
		let remaining = count;
		while (remaining > 0) {
			const stackSize = Math.min(remaining, 64);
			let item = mc.newItem(id, stackSize);
			item.setAux(aux);
			player.giveItem(item);
			remaining -= stackSize;
		}
	} else {
		// 不可堆叠物品：逐个发放
		for (let i = 0; i < count; i++) {
			let item = mc.newItem(id, 1);
			item.setAux(aux);
			player.giveItem(item);
		}
	}
	player.refreshItems();
}

/** 根据物品ID发放物品的简化接口 */
function giveItemById(player, itemId, count) {
	giveItem(player, { id: itemId, aux: 0 }, count);
}

/** 获取玩家的VIP信息 */
function getVipInfo(player) {
	return commonDeps.vipModule.getVipInfo(player);
}


// ============ TPS实时计算 ============
// 每个游戏刻（tick）计数，累计20个tick后根据实际耗时计算TPS值
mc.listen("onTick", () => {
	if (debugModule.isUnloading()) return;
	if (tpsData['tps_Count'] == null) {
		tpsData['tps_Time_start'] = Date.now();
		tpsData['tps_Time_end'] = 0;
		tpsData['tps_Count'] = 0;
	} else {
		tpsData['tps_Count']++;
	}
	if (tpsData['tps_Count'] != null && tpsData['tps_Count'] >= 20) {
		tpsData['tps_Time_end'] = Date.now();
		const elapsed = tpsData['tps_Time_end'] - tpsData['tps_Time_start'];
		const tpsValue = 20000 / elapsed;  // 20个tick理想耗时20000ms（每tick=1000ms），实际耗时越长TPS越低
		tpsData['tps'] = tpsValue >= 20 ? '20.00' : tpsValue.toFixed(2);
		tpsData['tps_Count'] = null;
	}
});

// ============ 服务器启动完成事件 ============
mc.listen("onServerStarted", async () => {
	await initAllConfigs();
	registerAllCommands();
	// /org 命令：打开公会系统GUI
	if (config.get("guild.enabled")) {
		try {
			var orgCmd = mc.newCommand('org', '公会系统', PermType.Any);
			orgCmd.overload([]);
			orgCmd.setCallback(function(_cmd, origin, output) {
				var player = origin.player;
				if (!player) { output.error('§c此命令仅玩家可在游戏内执行！'); return; }
				if (!config.get("guild.enabled")) { player.tell('§c公会系统当前已关闭！'); return; }
				guildModule.showGuildMainForm(player);
			});
			orgCmd.setup();
		} catch (e) { logger.error('/org 命令注册出错！错误：' + e); }
	}
	banModule.registerConsoleCommands();
	banModule.registerGameCommands();
	sidebarModule.init({ constants: C, config: config, money: money, getCurrencyName: getCurrencyName, getPlayerSetting: getPlayerSetting, tpsData: tpsData });
	menuModule.registerCommands(registerPlayerCommand);
	menuModule.registerCompassListener();
	menuModule.registerClockListener();
	registerWebCommands();
	initWebServer();
	behaviorLog.init();

	// 定时检查计划发送的邮件
	setInterval(function() { mailModule.checkScheduledMails(); }, 30000);

	const mem = process.memoryUsage();
	logger.info('[内存使用] - 堆已用: ' + (mem.heapUsed / 1024 / 1024).toFixed(2) + 'MB, 堆总量: ' + (mem.heapTotal / 1024 / 1024).toFixed(2) + 'MB, RSS: ' + (mem.rss / 1024 / 1024).toFixed(2) + 'MB');
});

/** 玩家预加入事件：检查封禁状态，被封禁的玩家在此阶段踢出 */
mc.listen("onPreJoin", function(pl) {
	const ip = pl.getDevice ? pl.getDevice().ip : '';
	const banCheck = banModule.isPlayerBanned(pl.xuid, ip);
	if (banCheck.banned) {
		pl.kick('§c你已被封禁\n§e原因：' + banCheck.reason);
		return false;
	}
});


// ============ 命令注册 ============

/**
 * 注册一个简单的玩家命令（无参数，仅玩家可用）
 * @param {string} name - 命令名
 * @param {string} desc - 命令描述
 * @param {Function} handler - 处理函数(player)
 * @param {string|Function} configCheck - 配置项名或返回bool的函数，用于跳过禁用功能的命令
 * @param {number} permission - 权限等级（默认PermType.Any）
 */
function registerPlayerCommand(name, desc, handler, configCheck, permission) {
	try {
		if (configCheck) {
			const enabled = (typeof configCheck === 'function') ? configCheck() : config.get(configCheck);
			if (!enabled) {
				logger.debug("[命令] /" + name + " 已跳过注册（功能已禁用）");
				return;
			}
		}
		let cmd = mc.newCommand(name, desc, permission || PermType.Any);
		cmd.overload([]);
		cmd.setCallback(function(_cmd, origin, output, _results) {
			let player = origin.player;
			if (!player) {
				output.error("§c此命令仅玩家可在游戏内执行！");
				return;
			}
			// 每次执行时动态检查功能开关，支持运行时禁用
			if (configCheck) {
				const enabled = (typeof configCheck === 'function') ? configCheck() : config.get(configCheck);
				if (!enabled) {
					player.tell("§c该功能当前已关闭！");
					return;
				}
			}
			handler(player);
		});
		cmd.setup();
	} catch (error) {
		logger.error("/" + name + " 命令注册出错！错误：" + error);
	}
}

/** 批量注册所有游戏内命令（商店/排行榜/传送/好友等），根据配置开关决定是否注册 */
function registerAllCommands() {
	const tpCfg = teleportModule.tpsConfig();
	const tpEnabled = function() { return teleportModule.tpsConfig().enabled; };
	const tpHomeEnabled = function() { let c = teleportModule.tpsConfig(); return c.enabled && c.enableHome; };
	const tpWarpEnabled = function() { let c = teleportModule.tpsConfig(); return c.enabled && c.enableWarp; };
	const tpTpaEnabled = function() { let c = teleportModule.tpsConfig(); return c.enabled && c.enableTpa; };
	const commands = [
		["shop", "商店系统", function(p) { shopModule.showShopMainForm(p, commonDeps); }, "shop.enabled"],
		["rank", "排行榜", function(p) { commonDeps.rankModule.showRankMainForm(p); }, "rank.enabled"],
		["cdk", "CDK兑换", function(p) { commonDeps.cdkModule.showCdkRedeemForm(p); }, "cdk.enabled"],
		["pay", "经济系统", function(p) { economyModule.showMoneyMainForm(p); }],
		["mb", "打开留言板", function(p) { messageBoardModule.showMainForm(p); }, "messageBoard.enabled"],
		["vip", "VIP系统", function(p) { commonDeps.vipModule.showVipMenu(p); }, "vip.enabled"],
		["bank", "银行系统", function(p) { commonDeps.bankModule.showBankMainForm(p); }, "bank.enabled"],
		["recycle", "回收系统", function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); }, "shop.enableRecycle"],
		["level", "等级奖励", function(p) { personalCenter.showLevelRewardForm(p); }, "level.enabled"],
		["xpshop", "经验商店", function(p) { shopModule.showXPBuyForm(p, commonDeps); }, "shop.enableXpShop"],
		["settings", "个人设置", personalCenter.showPlayerSettingsForm],
		["back", "返回死亡点", function(p) { teleportModule.showDeathPointMenu(p); }, "back.enabled"],
		["mail", "打开邮件系统", function(p) { mailModule.showMailSystemForm(p); }, "mail.enabled"],
		["rc", "打开批量回收界面", function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); }, "shop.enableRecycle"],
		["friend", "打开好友系统", function(p) { friendModule.showMyFriendsForm(p); }, "friend.enabled"],
		["network", "网络信息", personalCenter.showNetworkInfoForm],
		["tpg", "传送系统主菜单", function(p) { teleportModule.showTpgMainMenu(p, commonDeps); }, tpEnabled],
		["home", "家园系统", function(p) { teleportModule.showHomeMainForm(p, commonDeps); }, tpHomeEnabled],
		["warp", "公共传送点", function(p) { teleportModule.showWarpMainForm(p, commonDeps); }, tpWarpEnabled],
		["tpa", "互传系统", function(p) { teleportModule.showTpaMainForm(p, commonDeps); }, tpTpaEnabled],
		["tpcancel", "取消传送请求", function(p) { teleportModule.cancelTpaRequest(p); }, tpTpaEnabled],
		["tpaccept", "接受传送请求", function(p) { teleportModule.acceptTpaRequestByPlayer(p, commonDeps); }, tpTpaEnabled],
		["tpdeny", "拒绝传送请求", function(p) { teleportModule.denyTpaRequestByPlayer(p); }, tpTpaEnabled]
	];
	for (let i = 0; i < commands.length; i++) {
		let cmd = commands[i];
		if (!cmd) continue;
		registerPlayerCommand(cmd[0], cmd[1], cmd[2], cmd[3]);
	}
	if (hasWish) {
		wishModule.registerCommands(registerPlayerCommand);
	}
	chatModule.registerTitleCommand(registerPlayerCommand);
}


// ============ 头像系统代理（已合并到好友模块） ============

const getPlayerAvatarUrl = friendModule.getPlayerAvatarUrl;
const showAvatarSettingsForm = friendModule.showAvatarSettingsForm;


// ============ 玩家搜索与工具 ============

/**
 * 按名字或UID搜索玩家
 * @param {string} keyword - 搜索关键词
 * @param {number} searchType - 0按名字模糊匹配，其他按UID精确匹配
 * @returns {Array} 匹配的玩家信息数组（含xuid字段）
 */
function searchPlayers(keyword, searchType) {
	const results = [];
	const players = playerData.players;

	for (let xuid in players) {
		const info = players[xuid];
		if (searchType === 0) {
			if (info.name && info.name.toLowerCase().includes(keyword.toLowerCase())) {
				results.push(Object.assign({ xuid: xuid }, info));
			}
		} else {
			if (info.uid && info.uid.toString() === keyword) {
				results.push(Object.assign({ xuid: xuid }, info));
			}
		}
	}

	return results;
}

/** 玩家加入时检查并提醒未读私信、邮件和好友请求 */
function checkUnreadMessagesAndMails(player) {
	const xuid = player.xuid;

	let msg = "§e[提醒] ";
	let hasUnread = false;

	// 获取未读消息数量（只在开启私信提醒时显示）
	if (getPlayerSetting(xuid, "enableMessageNotification")) {
		const unreadMsgCount = friendModule.getUnreadMessageCount(xuid);
		if (unreadMsgCount > 0) {
			msg += `§a您有 §b${unreadMsgCount} §a条私信未读 `;
			hasUnread = true;
		}
	}

	if (getPlayerSetting(xuid, "enableMailNotification")) {
		const mailInfo = mailModule.getUnreadMailInfo(xuid);
		const unreadMailCount = mailInfo.count;
		if (unreadMailCount > 0) {
			if (mailInfo.attachmentCount > 0 && mailInfo.normalCount > 0) {
				msg += `§a有 §b${unreadMailCount} §a封邮件未读(§e含${mailInfo.attachmentCount}封附件邮件§a)`;
			} else if (mailInfo.attachmentCount > 0) {
				msg += `§a有 §b${unreadMailCount} §a封附件邮件未读`;
			} else {
				msg += `§a有 §b${unreadMailCount} §a封普通邮件未读`;
			}
			hasUnread = true;
		}
	}

	// 检查好友请求
	const pendingRequestCount = friendModule.getPendingRequestCount(xuid);
	if (pendingRequestCount > 0) {
		msg += `§a有 §b${pendingRequestCount} §a个未处理的好友请求`;
		hasUnread = true;
	}

	// 发送提醒
	if (hasUnread) {
		player.tell(msg);
	}
}

/** 入服发放菜单钟和快捷菜单指南针（需背包中不存在才发放，根据玩家设置控制） */
function giveJoinItems(player) {
	const xuid = player.xuid;

	// 获取玩家设置，默认为true（开启）
	const enableGiveClock = getPlayerSetting(xuid, "enableGiveClock");
	const enableGiveCompass = getPlayerSetting(xuid, "enableGiveCompass");

	// 给钟（菜单）
	if (enableGiveClock !== false) {
		try {
			// 检查背包中是否已有名为"菜单"的钟
			const hasClock = player.getInventory().getAllItems().some(item =>
				item && item.type === "minecraft:clock" && item.name === "§l§b菜单"
			);

			if (!hasClock) {
				const clock = mc.newItem("minecraft:clock", 1);
				if (clock) {
					clock.setDisplayName("§l§b菜单");
					clock.setLore(["§a右键打开主菜单", "§e点击使用菜单功能"]);
					player.giveItem(clock);
				}
			}
		} catch (error) {
			logger.error(`给钟失败：${error.message}`);
		}
	}

	// 给指南针（快捷菜单）
	if (enableGiveCompass !== false) {
		try {
			// 检查背包中是否已有名为"快捷菜单"的指南针
			const hasCompass = player.getInventory().getAllItems().some(item =>
				item && item.type === "minecraft:compass" && item.name === "§l§a快捷菜单"
			);

			if (!hasCompass) {
				const compass = mc.newItem("minecraft:compass", 1);
				if (compass) {
					compass.setDisplayName("§l§a快捷菜单");
					compass.setLore(["§a右键打开快捷菜单", "§e点击使用快捷功能"]);
					player.giveItem(compass);
				}
			}
		} catch (error) {
			logger.error(`给指南针失败：${error.message}`);
		}
	}
}


// ============================== NPC攻击响应系统 ==============================

/** 加载NPC攻击响应配置（narConfig），确保npc_actions字段存在 */
function initNarConfig() {
	narConfig = narConfigDM.load();
	if (!narConfig.npc_actions) narConfig.npc_actions = {};
}

/** NPC攻击响应：玩家攻击实体时匹配配置，执行对应命令并发送消息 */
mc.listen("onAttackEntity", function(player, entity) {
	try {
		const entityType = entity.type;
		const entityName = U.cleanFormatting(entity.name);

		const actions = narConfig.npc_actions;
		if (actions && actions[entityType]) {
			for (let i = 0; i < actions[entityType].length; i++) {
				let action = actions[entityType][i];
				if (U.cleanFormatting(action.name) === entityName) {
					// @s占位符替换为玩家名字（过滤命令注入字符）
					const safeName = player.name.replace(/[;&|`$(){}[\]<>!#]/g, '');
					const cmd = action.command.replace(/@s/g, safeName);

					if (action.permission === "console") {
						mc.runcmdEx(cmd);
					} else {
						player.runcmd(cmd);
					}

					if (action.message) {
						player.tell(action.message);
					}

					break;
				}
			}
		}
	} catch (e) {
		logger.error("NPC攻击响应出错：" + e.message);
	}
});


// ============ Web API系统 ============

/**
 * 初始化Web管理面板：读取配置，初始化认证数据库，注册重载钩子，启动Express服务器
 */
function initWebServer() {
	let webConfig = config.get('web');
	if (!webConfig || typeof webConfig === 'string') {
		webConfig = {};
	}
	if (!webConfig.enabled) {
		logger.info('[Web] Web服务器已在配置中禁用');
		return;
	}
	database.initDatabase().then(function() {
		logger.info('[Web] 数据库初始化完成');
		const monitoring = require('./src/monitoring');
		monitoring.init(tpsData, money, playerData, database);
		monitoring.startPlayerCountSampling(600000); // 10分钟记录一次玩家人数
		// 注册Web面板的热重载回调（修改数据后可通过Web触发重新加载）
		webServer.onReload('recycle', function() {
			recycleConfig = recycleConfigDM.load();
			if (commonDeps) commonDeps.recycleConfig = recycleConfig;
		});
		webServer.onReload('shop', function() {
			shopData = shopDataDM.load();
			if (commonDeps) commonDeps.shopData = shopData;
		});
		webServer.onReload('cdk', function() {
			cdkDataDM.load();
		});
		if (hasWish) {
			webServer.onReload('wish', function() {
				try {
					wishModule.reloadConfig();
				} catch (e) { logger.error('[Core] 重载祈愿配置失败: ' + e.message); }
			});
		}
		webServer.onReload('config', function() {
			try {
				config.reload();
				_refreshStatConfigCache();
				if (hasWish) wishModule.reloadConfig();
				backupModule.reload(config.get("backup"));
				clearLagModule.reload();
			} catch (e) { logger.error('[Core] 重载配置失败: ' + e.message); }
		});
		webServer.setPlayerDataRef(playerData);
		webServer.setConfigRef(config);
		webServer.setHasWish(hasWish, hasWish ? wishModule : null);
		// JWT 密钥管理：优先从 data/.jwt_secret 读取，不存在则自动生成
		(function loadOrGenerateJwtSecrets() {
			var crypto = require('crypto');
			var secretPath = 'plugins/NECE/data/.jwt_secret';
			try {
				if (fs.existsSync(secretPath)) {
					var saved = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
					webConfig.jwtSecret = saved.jwtSecret;
					webConfig.jwtRefreshSecret = saved.jwtRefreshSecret;
				} else {
					throw new Error('no secret file');
				}
			} catch (e) {
				webConfig.jwtSecret = crypto.randomBytes(48).toString('base64url');
				webConfig.jwtRefreshSecret = crypto.randomBytes(48).toString('base64url');
				try {
					U.ensureDir(secretPath);
					fs.writeFileSync(secretPath, JSON.stringify({
						jwtSecret: webConfig.jwtSecret,
						jwtRefreshSecret: webConfig.jwtRefreshSecret
					}, null, 2), 'utf-8');
					logger.info('[安全] 已自动生成 JWT 密钥并保存到 data/.jwt_secret');
				} catch (writeErr) {
					logger.error('[安全] 保存 JWT 密钥失败: ' + writeErr.message);
				}
			}
		})();
		// 移除 config.json 中残留的默认密钥（密钥已由 data/.jwt_secret 管理）
		if (webConfig.jwtSecret === 'NECE_Default_Secret_Change_Me' || webConfig.jwtRefreshSecret === 'NECE_Default_Refresh_Secret_Change_Me') {
			delete webConfig.jwtSecret;
			delete webConfig.jwtRefreshSecret;
			config.set('web', webConfig);
			logger.info('[安全] 已清除 config.json 中的默认 JWT 密钥');
		}
		webServer.startServer(webConfig);
	}).catch(function(e) {
		logger.error('[Web] 数据库初始化失败: ' + e.message);
	});
}

/** 注册Web相关的游戏命令和控制台命令（passwd/admin/backup/debug） */
function registerWebCommands() {
	// passwd命令：游戏内无参数打开表单，控制台带参数直接设置密码
	try {
		const passwdCmd = mc.newCommand('passwd', '设置或修改Web登录密码', PermType.Any);
		passwdCmd.mandatory('uid', ParamType.Int);
		passwdCmd.optional('password', ParamType.RawText);
		passwdCmd.overload(['uid', 'password']);
		passwdCmd.setCallback(function(_cmd, origin, output, results) {
			if (results.uid === undefined || results.uid === null) {
				if (origin.player) {
					showPasswdForm(origin.player);
				} else {
					output.error('用法: passwd <uid> <密码>');
				}
				return;
			}
			if (origin.player) {
				output.error('带参数的passwd仅控制台可用！');
				return;
			}
			const uid = String(results.uid);
			const pwd = results.password ? String(results.password).trim() : '';
			if (!pwd || pwd.length < 6) {
				output.error('密码长度不能少于6位');
				return;
			}
			database.setPassword(uid, pwd);
			output.success('已为UID ' + uid + ' 设置Web登录密码');
		});
		passwdCmd.setup();
	} catch (error) {
		logger.error('/passwd 命令注册出错！错误：' + error);
	}

	// admin控制台命令：添加/移除Web面板管理员（支持UID或玩家名）
	try {
		const adminCmd = mc.newCommand('admin', '管理员管理 (add/del <uid|玩家名>) [仅控制台]', PermType.GameMasters);
		adminCmd.mandatory('action', ParamType.String);
		adminCmd.mandatory('id', ParamType.RawText);
		adminCmd.overload(['action', 'id']);
		adminCmd.setCallback(function(_cmd, origin, output, results) {
			if (origin.player) {
				output.error('admin 命令仅控制台可用！');
				return;
			}
			if (!results.action || !results.id) {
				output.error('用法: admin <add|del> <uid|玩家名>');
				return;
			}
			const action = String(results.action).trim();
			if (action !== 'add' && action !== 'del') {
				output.error('用法: admin <add|del> <uid|玩家名>');
				return;
			}
			const input = String(results.id).trim();
			let uid = null;
			// 纯数字视为UID，否则按玩家名查找
			if (/^\d+$/.test(input)) {
				uid = input;
			} else {
				const pd = playerData;
				if (pd && pd.players) {
					const xuids = Object.keys(pd.players);
					for (let i = 0; i < xuids.length; i++) {
						if (pd.players[xuids[i]].name === input) {
							uid = String(pd.players[xuids[i]].uid);
							break;
						}
					}
				}
				if (!uid) {
					output.error('未找到玩家: ' + input);
					return;
				}
			}
			if (action === 'add') {
				if (database.addAdmin(uid)) {
					output.success('已添加UID ' + uid + ' (' + input + ') 为管理员');
				} else {
					output.error('UID ' + uid + ' 已经是管理员');
				}
			} else if (action === 'del') {
				if (database.removeAdmin(uid)) {
					output.success('已移除UID ' + uid + ' (' + input + ') 的管理员权限');
				} else {
					output.error('UID ' + uid + ' 不是管理员');
				}
			}
		});
		adminCmd.setup();
	} catch (error) {
		logger.error('/admin 命令注册出错！错误：' + error);
	}

	// backup控制台命令：手动执行世界备份
	try {
		mc.regConsoleCmd('backup', '手动执行世界备份', function(args) {
			if (backupModule.isBackupRunning()) {
				logger.info('备份正在进行中，请稍后再试');
				return;
			}
			logger.info('开始执行世界备份...');
			backupModule.executeBackup(function(err, result) {
				if (err) {
					logger.info('备份失败: ' + err.error);
				}
			});
		});
	} catch (error) {
		logger.error('/backup 控制台命令注册出错！错误：' + error);
	}
	// debug控制台命令：切换Debug模式
	try {
		mc.regConsoleCmd('debug', '切换Debug模式', function(args) {
			_debugMode = !_debugMode;
			database.setDebugMode(_debugMode);
			debugModule.setDebugMode(_debugMode);
			logger.info('Debug模式已' + (_debugMode ? '开启' : '关闭'));
		});
	} catch (error) {
		logger.error('/debug 控制台命令注册出错！错误：' + error);
	}

	// backup游戏命令：管理员在游戏内手动执行备份
	try {
		const backupCmd = mc.newCommand('backup', '手动执行世界备份', PermType.GameMasters);
		backupCmd.overload([]);
		backupCmd.setCallback(function(_cmd, origin, output, _results) {
			const player = origin.player;
			if (backupModule.isBackupRunning()) {
				if (player) {
					player.tell('§c备份正在进行中，请稍后再试');
				} else {
					output.error('备份正在进行中，请稍后再试');
				}
				return;
			}
			if (player) {
				player.tell('§e开始执行世界备份...');
			}
			backupModule.executeBackup(function(err, result) {
				if (err) {
					if (player) {
						player.tell('§c备份失败: ' + err.error);
					}
				} else {
					if (player) {
						player.tell('§a备份完成！耗时 ' + result.elapsed + ' 秒，大小 ' + result.totalSizeFormatted);
					}
				}
			});
		});
		backupCmd.setup();
	} catch (error) {
		logger.error('/backup 游戏命令注册出错！错误：' + error);
	}
}

/** 显示Web密码管理表单（游戏内GUI入口） */
function showPasswdForm(player) {
	const xuid = player.xuid;
	const playerInfo = playerData.players[xuid];
	const uid = playerInfo ? String(playerInfo.uid) : xuid;
	const hasPwd = database.hasPassword(uid);

	let fm = mc.newSimpleForm();
	fm.setTitle('§l§9Web密码管理');
	fm.setContent(hasPwd ? '§e你已设置Web登录密码，输入新密码可重置' : '§e请设置Web登录密码（用于网页端登录）');
	fm.addButton('§2设置/修改密码', 'textures/ui/color_plus');

	player.sendForm(fm, function(player, id) {
		if (id === null) return;
		if (id === 0) {
			showSetPasswordForm(player);
		}
	});
}

/** 显示设置密码表单：输入两次密码，校验一致性后保存到数据库 */
function showSetPasswordForm(player) {
	const fm = mc.newCustomForm();
	fm.setTitle('§l§9设置Web密码');
	fm.addInput('输入密码', '请输入密码（至少6位）', '');
	fm.addInput('确认密码', '请再次输入密码', '');

	player.sendForm(fm, function(player, data) {
		if (data === null) return;
		const pwd1 = data[0] || '';
		const pwd2 = data[1] || '';

		if (!pwd1 || !pwd2) {
			player.tell('§c密码不能为空！');
			return;
		}
		if (pwd1.length < 6) {
			player.tell('§c密码长度不能少于6位！');
			return;
		}
		if (pwd1 !== pwd2) {
			player.tell('§c两次输入的密码不一致！');
			return;
		}

		const playerInfo = playerData.players[player.xuid];
		const uid = playerInfo ? String(playerInfo.uid) : player.xuid;
		database.setPassword(uid, pwd1);
		player.tell('§aWeb登录密码设置成功！你的UID为: §e' + uid);
		player.tell('§7请使用UID和密码登录Web管理面板');
	});
}

// ============ 插件卸载钩子 ============
// LSE环境下的插件卸载事件，保存所有数据并停止Web服务器
if (typeof ll !== 'undefined' && ll.onUnload) {
	ll.onUnload(function() {
		debugModule.setUnloading();
		flushAllSaves();
		if (config && config.flush) config.flush();
		if (database.isPlayerDbReady()) {
			database.cancelPendingSave();
			savePlayerDataNow();
			database.savePlayerDatabase();
		}
		database.cancelPendingAuthSave();
		database.saveDatabase();
		webServer.stopServer();
	});
}

// ============ 启动Banner ============

logger.info("");
colorLog("yellow", "███╗   ██╗███████╗ ██████╗███████╗");
colorLog("yellow", "████╗  ██║██╔════╝██╔════╝██╔════╝");
colorLog("yellow", "██╔██╗ ██║█████╗  ██║     █████╗  ");
colorLog("yellow", "██║╚██╗██║██╔══╝  ██║     ██╔══╝  ");
colorLog("yellow", "██║ ╚████║███████╗╚██████╗███████╗");
colorLog("yellow", "╚═╝  ╚═══╝╚══════╝ ╚═════╝╚══════╝");
logger.info("");
try {
    var _manifest = JSON.parse(fs.readFileSync('plugins/NECE/manifest.json', 'utf-8'));
    var _ver = _manifest.version || 'unknown';
} catch (e) { var _ver = 'unknown'; }
logger.info(`       NECE ${_ver} (${DESIGNATION_NAME})`);
logger.info("");
