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
const U = require('./src/utils');
const shopModule = require('./src/shop');
const teleportModule = require('./src/teleport');
const vipModule = require('./src/vip');
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
const chainModule = require('./src/chain');
const i18n = require('./src/i18n');


// ============ 插件注册 ============
const PLUGIN_NAME = "NECE";
const DESIGNATION_NAME = "Robin";
const PLUGIN_AUTHOR = "LCH0426";

ll.registerPlugin(PLUGIN_NAME, DESIGNATION_NAME, [1, 9, 9], { Author: PLUGIN_AUTHOR });

// ============ 全局路径常量 ============
const CONFIG_PATH = "plugins/NECE/config.json";
const SHOP_DATA_PATH = "plugins/NECE/data/shopdata.json";
const CDK_DATA_PATH = "plugins/NECE/data/cdkdata.json";
const RECYCLE_DATA_PATH = "plugins/NECE/data/Recycleitems.json";
const RECYCLE_LOG_DIR = "plugins/NECE/logs/rc";
const MESSAGEBOARD_DATA_PATH = "plugins/NECE/data/MessageBoardData.json";
const WISH_DATA_PATH = "plugins/NECE/data/WishData.json";
const ENCHANT_BOOK_SHOP_PATH = "plugins/NECE/data/EnchantBookShop.json";
const SPAWN_EGG_SHOP_PATH = "plugins/NECE/data/SpawnEggShop.json";
const BAN_DATA_PATH = "plugins/NECE/data/BanData.json";
const MAIL_DATA_PATH = "plugins/NECE/data/MailData.json";
const NAR_CONFIG_PATH = "plugins/NECE/data/NARConfig.json";
const ITEMS_DATA_PATH = "plugins/NECE/data/items.json";
const WARPS_DATA_PATH = "plugins/NECE/data/warps.json";
const BAD_WORDS_PATH = "./plugins/NECE/data/fuckbad.json";

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
const _saveTimers = {};   // key -> setTimeout句柄
const _saveFns = {};      // key -> 实际保存函数

/**
 * 防抖保存：同一key的多次调用只执行最后一次，中间的被跳过
 * delay=0 时立即执行
 * @param {string} key - 保存标识（通常用文件路径）
 * @param {Function} saveFn - 实际写入函数
 * @param {number} delay - 延迟毫秒数（默认0，立即执行）
 */
function debouncedSave(key, saveFn, delay) {
	delay = delay || 0;
	if (delay <= 0) {
		saveFn();
		return;
	}
	if (_saveTimers[key]) clearTimeout(_saveTimers[key]);
	_saveFns[key] = saveFn;
	_saveTimers[key] = setTimeout(function() {
		delete _saveTimers[key];
		if (_saveFns[key]) {
			_saveFns[key]();
			delete _saveFns[key];
		}
	}, delay);
}

/** 立即执行指定key的待写入保存 */
function flushSave(key) {
	if (_saveTimers[key] !== undefined) {
		clearTimeout(_saveTimers[key]);
		delete _saveTimers[key];
		if (_saveFns[key]) {
			_saveFns[key]();
			delete _saveFns[key];
		}
	}
}

/** 立即执行所有待写入保存 */
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
	this.saveDelay = options.saveDelay || 0;
	this.saveKey = path;
	this.sqlPrefix = options.sqlPrefix || null;
	this.useSQL = false;
	this._dirtyKeys = {};
}

/** 加载数据：优先SQL，否则从JSON文件读取 */
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
						var dirtyDP = teleportModule.flushDirtyDeathPoints ? teleportModule.flushDirtyDeathPoints() : [];
						if (dirtyDP.length === 0) break;
						const dpPlayers = self.data.players || self.data;
						dirtyDP.forEach(function(xuid) {
							if (dpPlayers[xuid]) database.setDeathPointsSQL(xuid, dpPlayers[xuid]);
						});
						break;
					case 'friends':
						var dirtyXuids = friendModule.flushDirtyFriendXuids ? friendModule.flushDirtyFriendXuids() : [];
						if (dirtyXuids.length === 0) break;
						const frPlayers = self.data.players || self.data;
						dirtyXuids.forEach(function(xuid) {
							const fd = frPlayers[xuid];
							if (!fd) return;
							database.setFriendsSQL(xuid, fd.friends || [], fd.requests || [], fd.sentRequests || []);
						});
						break;
					case 'messages':
						var dirtyMsg = friendModule.flushDirtyMessages ? friendModule.flushDirtyMessages() : [];
						if (dirtyMsg.length === 0) break;
						const msgPlayers = self.data.players || self.data;
						dirtyMsg.forEach(function(xuid) {
							var pd = msgPlayers[xuid];
							if (!pd) return;
							database.setMessagesSQL(xuid, pd.messages || []);
						});
						break;
					case 'homes':
						var dirtyHomes = teleportModule.flushDirtyHomes ? teleportModule.flushDirtyHomes() : [];
						if (dirtyHomes.length === 0) break;
						dirtyHomes.forEach(function(xuid) {
							if (self.data[xuid]) database.setHomesSQL(xuid, self.data[xuid]);
						});
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
			// SQL写入立即执行，磁盘export防抖（防止高频写入时频繁export拖慢性能）
			doSQLSave();
			debouncedSave(this.saveKey, function() {
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

/** 根据每级经验阶梯累加生成等级经验表 */
const LEVEL_EXP_STEPS = [
	375, 500, 625, 725, 850, 950, 1075, 1200, 1300, 1425,
	1525, 1650, 1775, 1875, 2000, 2375, 2500, 2625, 2775, 2825,
	3425, 3725, 4000, 4300, 4575, 4875, 5150, 5450, 5725, 6025,
	6300, 6600, 6900, 7175, 7475, 7750, 8050, 9050, 10550, 11525,
	12450, 13450, 14400, 15350, 16325, 17275, 18250, 19200, 26400, 28800,
	31200, 33600, 36000, 232350, 258950, 285750, 312825, 340125
];
function initLevelExpTable() {
	levelUpExp[0] = 0;
	let total = 0;
	for (let i = 0; i < LEVEL_EXP_STEPS.length; i++) {
		total += LEVEL_EXP_STEPS[i];
		levelUpExp[i + 1] = total;
	}
}

/**
 * JSON配置文件适配器：提供init/get/set/delete等标准接口
 * 用于config.json等需要按key存取的配置文件（不同于DataManager的全量读写）
 * @throws {Error} 当配置文件存在但JSON解析失败时抛出错误（不覆盖原文件）
 */
function JsonConfigFileAdapter(filePath, defaultContent) {
	this._path = filePath;
	this._data = {};
	U.ensureDir(filePath);
	if (fs.existsSync(filePath)) {
		let content = fs.readFileSync(filePath, 'utf-8');
		if (content && content.trim() !== '') {
			try {
				this._data = JSON.parse(content);
			} catch (parseErr) {
				// JSON解析失败，抛出错误阻止插件加载，不覆盖原文件
				throw new Error('配置文件JSON格式错误[' + filePath + ']：' + parseErr.message);
			}
		}
	} else if (defaultContent) {
		// 文件不存在时才创建默认配置
		const defaultData = JSON.parse(defaultContent);
		this._data = defaultData;
		fs.writeFileSync(filePath, defaultContent, 'utf-8');
	}
}

/** 内部辅助：检查路径片段是否包含原型污染关键字 */
var _PROTO_KEYS = { '__proto__': true, 'constructor': true, 'prototype': true };
function _isUnsafeKey(key) {
	if (!key || typeof key !== 'string') return true;
	return !!_PROTO_KEYS[key];
}

/** 内部辅助：安全地创建对象，避免原型污染 */
function _safeCreateObject() {
	return Object.create(null);
}

/** 内部辅助：按点号路径解析嵌套对象，返回 { obj, key } 或 null */
JsonConfigFileAdapter.prototype._resolve = function(path) {
	if (path.indexOf('.') === -1) {
		if (_isUnsafeKey(path)) return null;
		return { obj: this._data, key: path };
	}
	var parts = path.split('.');
	var current = this._data;
	for (var i = 0; i < parts.length - 1; i++) {
		if (_isUnsafeKey(parts[i])) return null;
		if (current === null || current === undefined || typeof current !== 'object') return null;
		// 安全访问：使用 hasOwnProperty 检查，避免原型链查找
		if (!Object.prototype.hasOwnProperty.call(current, parts[i])) return null;
		current = current[parts[i]];
	}
	if (current === null || current === undefined || typeof current !== 'object') return null;
	if (_isUnsafeKey(parts[parts.length - 1])) return null;
	return { obj: current, key: parts[parts.length - 1] };
};

/** 初始化配置项：不存在时写入默认值并保存 */
JsonConfigFileAdapter.prototype.init = function(name, defaultValue) {
	if (_isUnsafeKey(name)) return defaultValue;
	var resolved = this._resolve(name);
	if (!resolved) {
		// 父路径不存在，需要逐层创建
		if (name.indexOf('.') !== -1) {
			var parts = name.split('.');
			var current = this._data;
			for (var i = 0; i < parts.length - 1; i++) {
				if (_isUnsafeKey(parts[i])) return defaultValue;
				if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
					current[parts[i]] = _safeCreateObject();
				}
				current = current[parts[i]];
			}
			if (_isUnsafeKey(parts[parts.length - 1])) return defaultValue;
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

/** 获取配置项，可指定默认值 */
JsonConfigFileAdapter.prototype.get = function(name, defaultValue) {
	if (name.indexOf('.') === -1) {
		if (this._data[name] !== undefined) return this._data[name];
		return defaultValue !== undefined ? defaultValue : null;
	}
	var resolved = this._resolve(name);
	if (resolved && resolved.obj[resolved.key] !== undefined) return resolved.obj[resolved.key];
	return defaultValue !== undefined ? defaultValue : null;
};

/** 设置配置项并立即保存 */
JsonConfigFileAdapter.prototype.set = function(name, value) {
	if (_isUnsafeKey(name)) return false;
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
			if (_isUnsafeKey(parts[i])) return false;
			if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
				current[parts[i]] = _safeCreateObject();
			}
			current = current[parts[i]];
		}
		if (_isUnsafeKey(parts[parts.length - 1])) return false;
		current[parts[parts.length - 1]] = value;
		this._save();
		return true;
	}
	resolved.obj[resolved.key] = value;
	this._save();
	return true;
};

/** 删除配置项并立即保存 */
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

/**
 * 从磁盘重新加载配置（完全替换内存中的配置）
 * 使用覆盖策略确保磁盘上的修改（包括删除）能正确生效
 */
JsonConfigFileAdapter.prototype.reload = function() {
	try {
		if (fs.existsSync(this._path)) {
			const content = fs.readFileSync(this._path, 'utf-8');
			if (content && content.trim() !== '') {
				// 完全替换：用磁盘内容覆盖内存，确保删除操作也能生效
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

/** 内部保存：将_data序列化写入磁盘，立即写入 */
JsonConfigFileAdapter.prototype._save = function() {
	try {
		U.ensureDir(this._path);
		fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
	} catch (e) {
		logger.error('JsonConfigFileAdapter保存失败[' + this._path + ']：' + e.message);
	}
};

/** 立即写入磁盘，取消防抖 */
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

/**
 * 初始化主配置文件，注册所有默认配置项
 * @throws {Error} 配置文件JSON格式错误时抛出
 */
function initRankConfig() {
	// JsonConfigFileAdapter 构造函数在JSON解析失败时会抛出错误
	// 此处不捕获，让错误向上传播，阻止插件继续加载
	config = new JsonConfigFileAdapter(CONFIG_PATH);
	config.init("debug", false);
	_debugMode = config.get("debug", false);
	debugModule.setDebugMode(_debugMode);
	config.init("sidebar", { "compact": false });
	// 功能开关：统一嵌套到各自模块的 enabled 字段
	config.init("shop", { "enabled": true, "enableRecycle": true, "enableXpShop": true });
	config.init("rank", { "enabled": true });
	config.init("cdk", { "enabled": true });
	config.init("bank", { "enabled": true, "fixedDeposits": { "7": { "rate": 0.001, "nameKey": "bank.period_week" }, "30": { "rate": 0.0099, "nameKey": "bank.period_month" }, "90": { "rate": 0.044, "nameKey": "bank.period_season" } } });
	config.init("vip", { "enabled": true });
	config.init("friend", { "enabled": true });
	config.init("messageBoard", { "enabled": true });
	config.init("mail", { "enabled": true });
	config.init("level", { "enabled": true });
	config.init("back", { "enabled": true });
	config.init("sign", { "enabled": true, "minReward": 100, "maxReward": 8000 });
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
		"warpCost": 0,
		"enableRtp": true,
		"rtpRadius": 10000,
		"rtpCooldown": 60,
		"rtpCost": 0
	});
	config.init("backup", {
		"enabled": true,
		"compressionLevel": 5,
		"interval": 0,
		"maxAgeDays": 0,
		"maxCount": 0,
		"dataBackupInterval": 0
	});
	config.init("behavior", { "enabled": true });
	config.init("titles", {
		"enabled": true,
		"defaultTitle": "萌新",
		"maxTitles": 10,
		"maxChars": 10,
		"perCharCost": 100,
		"forbiddenTitles": ["辅助", "腐竹", "服主", "管理员", "OP", "admin", "owner", "console", "system", "服务器"],
		"shop": [
			{ "name": "冒险家", "cost": 500 },
			{ "name": "矿工大师", "cost": 1000 },
			{ "name": "建筑大师", "cost": 2000 },
			{ "name": "红石达人", "cost": 3000 },
			{ "name": "服务器元老", "cost": 5000 }
		]
	});
	config.init("web", {
		"enabled": true,
		"enableFrontend": true,
		"port": 8080,
		"host": "0.0.0.0",
		"corsOrigin": "",
		"jwtExpire": "15m",
		"jwtRefreshExpire": "7d",
		"trustProxy": false,
		"proxyProtocol": false,
		"secureCookie": false
	});
	// 迁移：为已有配置补充新增字段
	var _webCfg = config.get('web', {});
	if (_webCfg.corsOrigin === undefined) { config.set('web.corsOrigin', ''); }
	if (_webCfg.trustProxy === undefined) { config.set('web.trustProxy', false); }
	if (_webCfg.proxyProtocol === undefined) { config.set('web.proxyProtocol', false); }
	if (_webCfg.secureCookie === undefined) { config.set('web.secureCookie', false); }
	config.init("chat", {
		"enabled": true,
		"format": "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§b{titles}§e|§a<§r{name}§a> §r{msg}",
		"wordFilter": true
	});
	config.init("chain", {
		"enabled": true,
		"mineAll": false,
		"sneakOnly": true,
		"blocks": {},
		"plans": {
			"free": { "dailyLimit": 1000, "price": 0, "duration": 0 },
			"lite": { "dailyLimit": 2000, "price": 7000, "duration": 7 },
			"standard": { "dailyLimit": 5000, "price": 20000, "duration": 7 },
			"pro": { "dailyLimit": 8000, "price": 25000, "duration": 7 },
			"max": { "dailyLimit": 50000, "price": 500000, "duration": 7 }
		}
	});
	config.init("clearLag", {
		"enabled": false,
		"interval": 300,
		"reminder": 60,
		"keepNamed": true,
		"whitelist": []
	});
	config.init("motd", {
		"enabled": false,
		"lines": [],
		"interval": 10
	});
	config.init("menu", {});
	config.init("quickMenu", { "items": [] });
	// 旧键迁移：将旧格式的 enable* 标志和 *Config 键迁移到新的嵌套结构
	_migrateOldConfigKeys();
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

	// *Config 键重命名
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
			// 合并旧值到新键
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

	// 删除冗余的 enableMotd
	if (_data['enableMotd'] !== undefined) {
		delete _data['enableMotd'];
		_changed = true;
	}

	if (_changed) {
		config._save();
		logger.info('[配置文件已从旧格式迁移到新嵌套结构');
	}
}

const IPV4_MESSAGE = "§a本服务器已接入IPv6网络，访问 §rhttps://citlalia.cn/v6 §a来了解如何启用";
const IPV6_MESSAGE = "§a您正在使用IPv6网络访问本服务器";

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

// 从playerDataModule获取玩家数据保存函数
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
const deathPointDM = registerDataManager('deathPoint', '', {}, {
	sqlPrefix: 'deathPoints'
});
const friendDM = registerDataManager('friend', '', {}, {
	sqlPrefix: 'friends'
});
const messageDM = registerDataManager('message', '', {}, {
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
const playerSettingsDM = registerDataManager('playerSettings', '', {}, {
	pretty: false,
	sqlPrefix: 'settings'
});
const narConfigDM = registerDataManager('narConfig', NAR_CONFIG_PATH, {
	npc_actions: {}
});
const homesDM = registerDataManager('homes', '', {}, {
	sqlPrefix: 'homes'
});
const warpsDM = registerDataManager('warps', WARPS_DATA_PATH, {});

const DEFAULT_ENCHANT_BOOK_CONFIG = { enchantments: {
	"0": { name: "保护", max_lv: 4, cost_per_level: 100 }, "1": { name: "火焰保护", max_lv: 4, cost_per_level: 150 },
	"2": { name: "摔落缓冲", max_lv: 4, cost_per_level: 100 }, "3": { name: "爆炸保护", max_lv: 4, cost_per_level: 150 },
	"4": { name: "弹射物保护", max_lv: 4, cost_per_level: 150 }, "5": { name: "荆棘", max_lv: 3, cost_per_level: 200 },
	"6": { name: "水下呼吸", max_lv: 3, cost_per_level: 200 }, "7": { name: "深海探索者", max_lv: 3, cost_per_level: 200 },
	"8": { name: "水下速掘", max_lv: 3, cost_per_level: 200 }, "9": { name: "锋利", max_lv: 5, cost_per_level: 250 },
	"10": { name: "亡灵杀手", max_lv: 5, cost_per_level: 300 }, "11": { name: "节肢杀手", max_lv: 5, cost_per_level: 250 },
	"12": { name: "击退", max_lv: 2, cost_per_level: 150 }, "13": { name: "火焰附加", max_lv: 2, cost_per_level: 200 },
	"14": { name: "抢夺", max_lv: 3, cost_per_level: 200 }, "15": { name: "效率", max_lv: 5, cost_per_level: 200 },
	"16": { name: "精准采集", max_lv: 1, cost_per_level: 500 }, "17": { name: "耐久", max_lv: 3, cost_per_level: 150 },
	"18": { name: "时运", max_lv: 3, cost_per_level: 300 }, "19": { name: "力量", max_lv: 5, cost_per_level: 250 },
	"20": { name: "冲击", max_lv: 2, cost_per_level: 200 }, "21": { name: "火矢", max_lv: 1, cost_per_level: 400 },
	"22": { name: "无限", max_lv: 1, cost_per_level: 1000 }, "23": { name: "海之眷顾", max_lv: 3, cost_per_level: 300 },
	"24": { name: "饵钓", max_lv: 3, cost_per_level: 200 }, "25": { name: "冰霜行者", max_lv: 2, cost_per_level: 400 },
	"26": { name: "经验修补", max_lv: 1, cost_per_level: 800 }, "27": { name: "绑定诅咒", max_lv: 1, cost_per_level: 800 },
	"28": { name: "消失诅咒", max_lv: 1, cost_per_level: 800 }, "29": { name: "穿刺", max_lv: 5, cost_per_level: 250 },
	"30": { name: "激流", max_lv: 3, cost_per_level: 200 }, "31": { name: "忠诚", max_lv: 3, cost_per_level: 200 },
	"32": { name: "引雷", max_lv: 1, cost_per_level: 1000 }, "33": { name: "多重射击", max_lv: 3, cost_per_level: 300 },
	"34": { name: "穿透", max_lv: 4, cost_per_level: 200 }, "35": { name: "快速装填", max_lv: 3, cost_per_level: 200 },
	"36": { name: "灵魂疾行", max_lv: 3, cost_per_level: 300 }, "37": { name: "迅捷潜行", max_lv: 3, cost_per_level: 200 },
	"38": { name: "风爆", max_lv: 3, cost_per_level: 300 }, "39": { name: "致密", max_lv: 3, cost_per_level: 300 },
	"40": { name: "破甲", max_lv: 3, cost_per_level: 300 }, "41": { name: "突进", max_lv: 3, cost_per_level: 300 }
}};
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
 * 主初始化函数：加载配置、初始化数据库、注入模块依赖
 */
function initAllConfigs() {
	initLevelExpTable();
	initRankConfig();
	// 经济模块和玩家数据模块需要最先初始化
	economyModule.init({
		getDebug: function() { return _debugMode; },
		getPlayerData: function() { return playerData; },
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		loadLocale: i18n.loadLocale,
		getSystemLanguage: function() { return config.language || 'zh_CN'; },
		database: database
	});
	playerDataModule.init({ database: database, fs: fs, itemsDataPath: ITEMS_DATA_PATH,
		getPlayerData: function() { return playerData; },
		getPlayerSettings: function() { return playerSettings; },
		savePlayerSettings: function() { playerSettingsDM.save(true); }
	});
	database.setDebugMode(_debugMode);
	debugLog("initAllConfigs: Debug模式已" + (_debugMode ? "开启" : "关闭"));
	debugLog("initAllConfigs: 开始初始化所有模块...");
	// 初始化玩家数据库(SQL)
	database.initPlayerDatabase();
	debugLog("initAllConfigs: 玩家数据库初始化完成");
	initPlayerData();
	debugLog("initAllConfigs: 玩家数据加载完成, 玩家数=" + Object.keys(playerData.players || {}).length);
	initPlayerSettings();
	initShopData();
	initCdkData();
	loadItemsDataMap();
	initRecycleConfig();
	debugLog("initAllConfigs: 商店/CDK/物品/回收配置加载完成");
	messageBoardModule.init(messageBoardDM, {
		t: i18n.t,
		getPlayerSetting: getPlayerSetting,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
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
		mailApi: mailModule,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	debugLog('banModule.init: 封禁模块初始化完成');
	banModule.init(banDM, {
		playerData: playerData.players,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	mailModule.init(mailDM, {
		U: U,
		money: money,
		addPlayerMoney: addPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		getCurrencyName: getCurrencyName,
		getPlayerSetting: getPlayerSetting,
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		searchPlayers: searchPlayers,
		notifyEconomyChange: notifyEconomyChange,
		logger: logger,
		showPersonalCenterForm: personalCenter.showPersonalCenterForm,
		openMainMenu: personalCenter.openMainMenu,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	menuModule.init({ getConfig: function() { return config._data || {}; }, getCurrencyName: getCurrencyName, getPlayerData: function() { return playerData; }, savePlayerData: savePlayerData, getPlayerSetting: getPlayerSetting });
	menuModule.loadConfig();
	chatModule.init({ fs: fs, U: U, badWordsPath: BAD_WORDS_PATH, webServer: webServer,
		getPlayerData: function() { return playerData; }, savePlayerData: savePlayerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney, reducePlayerMoney: reducePlayerMoney,
		getCurrencyName: getCurrencyName, getConfig: function() { return config._data || {}; },
		database: database, t: i18n.t, getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	chatModule.loadChatConfig();
	chatModule.registerChatListener();
	chainModule.init({
		getConfig: function() { return config.get('chain', {}); },
		getDebug: function() { return _debugMode; },
		getPlayerData: function() { return playerData; },
		savePlayerDataNow: savePlayerDataNow,
		saveSinglePlayerData: saveSinglePlayerData,
		t: i18n.t,
		getPlayerSetting: getPlayerSetting,
		getSystemLanguage: function() { return config.language || 'zh_CN'; },
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		getCurrencyName: getCurrencyName,
		openMainMenu: personalCenter.openMainMenu
	});
	chainModule.setOnChainComplete(function(player, extraCount) {
		if (extraCount > 0) personalCenter.bumpStat(player.xuid, 'mining', extraCount);
	});
	chainModule.registerChainListener();
	chainModule.registerChainCommand(registerPlayerCommand);
	initNarConfig();
	backupModule.init({
		getConfig: function() { return config.get('backup'); },
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	var dataBackupInterval = config.get("backup").dataBackupInterval || 0;
	if (dataBackupInterval > 0) {
		backupModule.startDataBackupScheduler(dataBackupInterval * 3600 * 1000);
	}

	guildModule.init({
		logger: logger,
		getPlayerMoney: getPlayerMoney,
		addPlayerMoney: addPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		confirmPurchase: economyModule.confirmPurchase,
		getConfig: function() { return config.get('guild'); },
		getCurrencyName: getCurrencyName,
		getPlayerName: function(xuid) {
			var p = playerData.players[xuid];
			return p ? p.name : xuid;
		},
		getPlayerData: function() { return playerData; },
		mailApi: mailModule,
		chatModule: chatModule,
		notifyEconomyChange: notifyEconomyChange,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
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
		// i18n
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; },
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
		openMainMenu: personalCenter.openMainMenu, // (Player) => void — 打开主菜单
		// 配置
		getConfig: function() { return config.get('teleport'); },
		debugMode: function() { return config.get('debug'); },
		// 数据库
		database: database
	};

	teleportModule.init(homesDM, warpsDM, commonDeps);
	shopModule.init(commonDeps);

	// 初始化VIP模块
	vipModule.init({
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		openMainMenu: personalCenter.openMainMenu,
		t: i18n.t,
		getPlayerSetting: getPlayerSetting,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
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
			getPlayerData: function() { return playerData; },
			getPlayerSetting: getPlayerSetting,
			t: i18n.t,
			getSystemLanguage: function() { return config.language || 'zh_CN'; }
		});
	}
	commonDeps.wishModule = wishModule;

	let cdkModule = cdkModuleCreator.create({
		cdkDataDM: cdkDataDM,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		giveItemById: giveItemById,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	commonDeps.cdkModule = cdkModule;

	let rankModule = rankModuleCreator.create({
		playerData: playerData,
		getCurrencyName: getCurrencyName,
		getMoneyByXuid: getPlayerMoneyByXuid,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	commonDeps.rankModule = rankModule;

	let bankModule = bankModuleCreator.create({
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoney: addPlayerMoney,
		confirmPurchase: economyModule.confirmPurchase,
		getCurrencyName: getCurrencyName,
		openMainMenu: personalCenter.openMainMenu,
		utils: U,
		t: i18n.t,
		getPlayerSetting: playerDataModule.getPlayerSetting
	});
	commonDeps.bankModule = bankModule;

	// 个人中心模块初始化，依赖其他模块
	personalCenter.init({
		getPlayerData: function() { return playerData; },
		savePlayerDataNow: savePlayerDataNow,
		money: money,
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
		commonDeps: commonDeps,
		getSupportedLocales: i18n.getSupportedLocales,
		loadLocale: i18n.loadLocale,
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	personalCenter.setLevelUpExp(levelUpExp);
	personalCenter.installPrototypeExtensions();

	// MOTD 动态轮换模块
	motdModule.init({
		getConfig: function() { return config.get('motd', {}); }
	});
	motdModule.start();

	// 定时实体清理模块
	clearLagModule.init({
		getConfig: function() { return config.get('clearLag'); },
		t: i18n.t,
		getSystemLanguage: function() { return config.language || 'zh_CN'; }
	});
	clearLagModule.start();

	_initialized = true;
}

// ============ 核心事件监听 ============

/**
 * 玩家加入事件：创建或更新玩家数据，发送欢迎消息
 */
mc.listen("onJoin", (player) => {
	if (!_initialized) return; // 防止插件重载时模块未初始化完毕
	try {
	onJoinHandler(player);
	} catch (e) {
		logger.error('[Core] onJoin 回调异常: ' + (e && e.message ? e.message : e));
	}
});

/** onJoin 实际处理逻辑，独立函数便于异常隔离 */
function onJoinHandler(player) {
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

	// 统一保存一次
	saveSinglePlayerData(playerXUID);

	// 检查并通知玩家的待处理经济转账
	economyModule.checkPendingTransfers(player);
	// 网络协议检测
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



	// 检查定期存款到期情况
	try {
		commonDeps.bankModule.checkFixedDepositMaturity(player, getPlayerSetting);
	} catch (error) {
		logger.error(`检查定期存款到期情况时出错：${error.message}`);
	}

	// 检查未读消息和邮件
	{
		const joinXuid2 = player.xuid;
		setTimeout(() => {
			try {
				const p = mc.getPlayer(joinXuid2);
				if (p) checkUnreadMessagesAndMails(p);
			} catch (error) {
				logger.error(`检查未读消息时出错：${error.message}`);
			}
		}, 3000); // 延迟3秒显示，避免与其他消息冲突
	}

	// 入服给钟和指南针
	{
		const joinXuid = player.xuid;
		setTimeout(() => {
			try {
				const p = mc.getPlayer(joinXuid);
				if (p) menuModule.giveJoinItems(p);
			} catch (error) {
				logger.error(`入服给物品时出错：${error.message}`);
			}
		}, 1000); // 延迟1秒给物品
	}
}

/** 玩家离开事件：累计在线时长，清除状态 */
mc.listen("onLeft", (player) => {
	if (!_initialized) return;
	try {
	onLeftHandler(player);
	} catch (e) {
		logger.error('[Core] onLeft 回调异常: ' + (e && e.message ? e.message : e));
	}
});

/** onLeft 实际处理逻辑，独立函数便于异常隔离 */
function onLeftHandler(player) {
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
	// 保存背包快照到数据库
	try {
		if (!player || !_initialized) return;
		const inv = player.getInventory();
		if (!inv) return;
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
}

/** 注册游戏行为统计监听和死亡点记录 */
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
		if (!_initialized || !_rankEnabled) return;
		personalCenter.bumpStat(player.xuid, "mining", 1);
	});

	mc.listen("afterPlaceBlock", function(player, block) {
		if (!_initialized || !_rankEnabled) return;
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

/** 定时累计在线玩家的游戏时长 */
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

setInterval(tickOnlineDurations, 60000);

// 定时清理已离线但未触发 onLeft 的残留条目
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
	// leavetime 仅每5个周期写入一次
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

// 从economyModule导出常用经济操作函数
const getCurrencyName = economyModule.getCurrencyName;
const notifyEconomyChange = economyModule.notifyEconomyChange;
const getPlayerMoney = economyModule.getPlayerMoney;
const reducePlayerMoney = economyModule.reducePlayerMoney;
const addPlayerMoney = economyModule.addPlayerMoney;
const getPlayerMoneyByXuid = economyModule.getPlayerMoneyByXuid;
const addPlayerMoneyByXuid = economyModule.addPlayerMoneyByXuid;

/** 给玩家发放物品，自动处理可堆叠物品的分批 */
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
// 每个游戏刻计数，累计20个tick后根据实际耗时计算TPS值
var _tickEnabled = true; // 关服时置 false，阻止 onTick 继续执行
mc.listen("onTick", () => {
	// 双重检查：_tickEnabled 和 debugModule.isUnloading()
	if (!_tickEnabled || debugModule.isUnloading()) return;
	try {
		if (!_initialized) return;
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
			const tpsValue = 20000 / elapsed;
			tpsData['tps'] = tpsValue >= 20 ? '20.00' : tpsValue.toFixed(2);
			tpsData['tps_Count'] = null;
		}
	} catch (e) { /* 关服时全局对象已销毁，忽略 */ }
});

// ============ 服务器启动完成事件 ============
mc.listen("onServerStarted", async () => {
	try {
		await initAllConfigs();
	} catch (error) {
		logger.error('插件加载失败：' + error.message);
		logger.error('请检查 config.json 文件格式是否正确，然后重启服务器');
		logger.error('插件已停止加载，原配置文件未被覆盖');
		return; // 停止加载插件，不覆盖配置文件
	}
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
				guildModule.showMainMenu(player);
			});
			orgCmd.setup();
		} catch (e) { logger.error('/org 命令注册出错！错误：' + e); }
	}
	banModule.registerConsoleCommands();
	banModule.registerGameCommands();
	sidebarModule.init({ getConfig: function() { return config._data || {}; }, money: money, getCurrencyName: getCurrencyName, getPlayerSetting: getPlayerSetting, tpsData: tpsData, t: i18n.t, getSystemLanguage: function() { return config.language || 'zh_CN'; } });
	menuModule.registerCommands(registerPlayerCommand);
	menuModule.registerCompassListener();
	menuModule.registerClockListener();
	registerWebCommands();
	initWebServer();
	if (config.get('behavior.enabled') !== false) {
		behaviorLog.init({
			t: i18n.t,
			getSystemLanguage: function() { return config.language || 'zh_CN'; }
		});
	}

	// 定时检查计划发送的邮件
	setInterval(function() { mailModule.checkScheduledMails(); }, 30000);

	const mem = process.memoryUsage();
	logger.info('[内存使用] - 堆已用: ' + (mem.heapUsed / 1024 / 1024).toFixed(2) + 'MB, 堆总量: ' + (mem.heapTotal / 1024 / 1024).toFixed(2) + 'MB, RSS: ' + (mem.rss / 1024 / 1024).toFixed(2) + 'MB');
});

/** 玩家预加入事件：检查封禁状态，被封禁的玩家在此阶段踢出 */
mc.listen("onPreJoin", function(pl) {
	var ip = '';
	try { var dev = pl.getDevice ? pl.getDevice() : null; ip = dev && dev.ip ? dev.ip : ''; } catch(e) {}
	const banCheck = banModule.isPlayerBanned(pl.xuid, ip);
	if (banCheck.banned) {
		pl.kick('§c你已被封禁\n§e原因：' + banCheck.reason);
		return false;
	}
});


// ============ 命令注册 ============

/** 注册一个简单的玩家命令 */
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

/** 批量注册所有游戏内命令 */
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
		["pay", "转账", function(p) { economyModule.showTransferTypeForm(p); }],
		["ec", "经济面板", function(p) { economyModule.showEconomyPanel(p); }],
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
		["tpy", "接受传送请求", function(p) { teleportModule.acceptTpaRequestByPlayer(p, commonDeps); }, tpTpaEnabled],
		["tpn", "拒绝传送请求", function(p) { teleportModule.denyTpaRequestByPlayer(p); }, tpTpaEnabled],
		["rtp", "随机传送", function(p) { teleportModule.showRtpConfirmForm(p); }, tpEnabled],
		["sign", "每日签到", function(p) { handleSignCommand(p); }]
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


// ============ 每日签到 ============

function handleSignCommand(player) {
	var signCfg = config.get('sign', { enabled: true, minReward: 100, maxReward: 8000 });
	if (!signCfg.enabled) {
		player.tell("§e[签到] §c签到功能已关闭");
		return;
	}
	var xuid = player.xuid;
	var pd = playerData.players[xuid];
	if (!pd) { player.tell("§e[签到] §c玩家数据异常"); return; }
	if (!pd.sign) pd.sign = {};

	var now = new Date();
	var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
	var yesterday = new Date(now.getTime() - 86400000);
	var yesterdayStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');

	if (pd.sign.lastDate === today) {
		player.tell("§e[签到] §c你今天已经签到过了！");
		return;
	}

	// 计算连续签到天数
	var consecutive = 0;
	if (pd.sign.lastDate === yesterdayStr) {
		consecutive = (pd.sign.consecutive || 0) + 1;
	} else {
		consecutive = 1;
	}

	// 随机奖励
	var minR = signCfg.minReward || 100;
	var maxR = signCfg.maxReward || 8000;
	var reward = Math.floor(Math.random() * (maxR - minR + 1)) + minR;

	// 发放奖励
	if (addPlayerMoney) {
		addPlayerMoney(player, reward, "每日签到");
	}

	// 保存签到记录
	pd.sign.lastDate = today;
	pd.sign.consecutive = consecutive;
	savePlayerDataNow();

	var currencyName = getCurrencyName();
	player.tell("§e[签到] §a您已成功签到！获得" + reward + currencyName + "，已连续签到" + consecutive + "天。");
}

// ============ 头像系统代理 ============

const getPlayerAvatarUrl = friendModule.getPlayerAvatarUrl;
const showAvatarSettingsForm = friendModule.showAvatarSettingsForm;


// ============ 玩家搜索与工具 ============

/** 按名字或UID搜索玩家 */
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

	// 获取未读消息数量
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

// ============================== NPC攻击响应系统 ==============================

/** 加载NPC攻击响应配置 */
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
					// @s占位符替换为玩家名字
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

/** 初始化Web管理面板 */
function initWebServer() {
	let webConfig = config.get('web');
	if (!webConfig || typeof webConfig === 'string') {
		webConfig = {};
	}
	if (!webConfig.enabled) {
		logger.info('[Web] Web服务器已在配置中禁用');
		return;
	}
	database.initDatabase();
	logger.info('[Web] 数据库初始化完成');
	const monitoring = require('./src/monitoring');
	monitoring.init(tpsData, money, playerData, database);
	monitoring.startPlayerCountSampling(600000); // 10分钟记录一次玩家人数
	// 注册Web面板的热重载回调
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
				backupModule.reload();
				var dataBackupInterval = config.get("backup").dataBackupInterval || 0;
				if (dataBackupInterval > 0) {
					backupModule.startDataBackupScheduler(dataBackupInterval * 3600 * 1000);
				} else {
					backupModule.stopDataBackupScheduler();
				}
				clearLagModule.reload();
			} catch (e) { logger.error('[Core] 重载配置失败: ' + e.message); }
		});
		webServer.setPlayerDataRef(playerData);
		webServer.setConfigRef(config);
		webServer.setHasWish(hasWish, hasWish ? wishModule : null, economyModule.writeEconomyLog);
		webServer.setEconomyFunctions({
			getPlayerMoney: economyModule.getPlayerMoney,
			reducePlayerMoney: economyModule.reducePlayerMoney,
			addPlayerMoney: economyModule.addPlayerMoney,
			addPlayerMoneyByXuid: economyModule.addPlayerMoneyByXuid,
			getPlayerMoneyByXuid: economyModule.getPlayerMoneyByXuid
		});
		// JWT 密钥管理：独立变量存储，不写入 config.json
		var _jwtSecret, _jwtRefreshSecret;
		(function loadOrGenerateJwtSecrets() {
			var crypto = require('crypto');
			var secretPath = 'plugins/NECE/data/.jwt_secret';
			try {
				if (fs.existsSync(secretPath)) {
					var saved = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
					_jwtSecret = saved.jwtSecret;
					_jwtRefreshSecret = saved.jwtRefreshSecret;
				} else {
					throw new Error('no secret file');
				}
			} catch (e) {
				_jwtSecret = crypto.randomBytes(48).toString('base64url');
				_jwtRefreshSecret = crypto.randomBytes(48).toString('base64url');
				try {
					U.ensureDir(secretPath);
					fs.writeFileSync(secretPath, JSON.stringify({
						jwtSecret: _jwtSecret,
						jwtRefreshSecret: _jwtRefreshSecret
					}, null, 2), 'utf-8');
					logger.info('[安全] 已自动生成 JWT 密钥并保存到 data/.jwt_secret');
				} catch (writeErr) {
					logger.error('[安全] 保存 JWT 密钥失败: ' + writeErr.message);
				}
			}
		})();
		// 清除 config.json 中残留的密钥字段
		if (webConfig.jwtSecret || webConfig.jwtRefreshSecret || webConfig._jwtSecret || webConfig._jwtRefreshSecret) {
			delete webConfig.jwtSecret;
			delete webConfig.jwtRefreshSecret;
			delete webConfig._jwtSecret;
			delete webConfig._jwtRefreshSecret;
			config.set('web', webConfig);
		}
		webConfig.jwtSecret = _jwtSecret;
		webConfig.jwtRefreshSecret = _jwtRefreshSecret;
	webServer.startServer(webConfig);
}

/** 注册Web相关的游戏命令和控制台命令 */
function registerWebCommands() {
	// passwd命令：游戏内无参数打开表单，控制台带参数直接设置密码
	try {
		const passwdCmd = mc.newCommand('passwd', '设置或修改Web登录密码', PermType.Any);
		passwdCmd.optional('uid', ParamType.Int);
		passwdCmd.optional('password', ParamType.RawText);
		passwdCmd.overload([]);
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

	// admin控制台命令
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
		const backupCmd = mc.newCommand('backup', '手动执行世界备份', PermType.Any);
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

/** 显示Web密码管理表单 */
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
		if (data == null) return;
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
		player.tell('请使用UID和密码登录Web管理面板');
	});
}

// ============ 插件卸载钩子 ============
// LSE环境下的插件卸载事件，保存所有数据并停止Web服务器
if (typeof ll !== 'undefined' && ll.onUnload) {
	ll.onUnload(function() {
		_tickEnabled = false;
		_initialized = false;
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
