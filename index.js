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

const fs = require('fs');
const database = require('./core/database');
const debugModule = require('./core/debug');
const webServer = require('./core/server');
const behaviorLog = require('./core/behaviorLog');
const C = require('./core/constants');
const U = require('./core/utils');
const shopModule = require('./core/shop');
const teleportModule = require('./core/teleport');
const vipModuleCreator = require('./core/vip');
const cdkModuleCreator = require('./core/cdk');
const rankModuleCreator = require('./core/rank');
const bankModuleCreator = require('./core/bank');
const backupModule = require('./core/backup');
const messageBoardModule = require('./core/messageBoard');
const friendModule = require('./core/friend');
const wishModule = require('./core/wish');
const banModule = require('./core/ban');
const mailModule = require('./core/mail');
const economyModule = require('./core/economy');
const playerDataModule = require('./core/playerData');
const avatarModule = require('./core/avatar');
const chatModule = require('./core/chat');
const citlaliaModule = require('./core/citlalia');
const sidebarModule = require('./core/sidebar');
const quickMenuModule = require('./core/quickMenu');
const personalCenter = require('./core/personalCenter');


const PLUGIN_NAME = "NLCE";
const DESIGNATION_NAME = "Robin";
const PLUGIN_AUTHOR = "LCH0426";

ll.registerPlugin(PLUGIN_NAME, DESIGNATION_NAME, [1, 9, 9], { Author: PLUGIN_AUTHOR });

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
const QUICK_MENU_CONFIG_PATH = C.PATHS.QUICK_MENU_CONFIG;
const NAR_CONFIG_PATH = C.PATHS.NAR_CONFIG;
const ITEMS_DATA_PATH = C.PATHS.ITEMS_DATA;
const HOMES_DATA_PATH = C.PATHS.HOMES_DATA;
const WARPS_DATA_PATH = C.PATHS.WARPS_DATA;
const CHAT_CFG_PATH = C.PATHS.CHAT_CFG;
const BAD_WORDS_PATH = C.PATHS.BAD_WORDS;

let config;
let playerData = { nextUid: 10000, players: {} };
let playerSettings;
let levelUpExp = [];
const _joinTimestamps = {};
let onlinePlayers = {};
let shopData;
let recycleConfig;
let wishConfig = {};
let spawnEggShopConfig = {
	currency: {
		name: (wishConfig && wishConfig.dustName) || "星尘"
	},
	items: []
};
let narConfig = {
	npc_actions: {}
};
let tpsData = {
	tps: '20.00',
	tps_Count: null,
	tps_Time_start: 0,
	tps_Time_end: 0
};

let commonDeps = null;

// Debug 模式
let _debugMode = false;
const debugLog = debugModule.debugLog;
const debugWarn = debugModule.debugWarn;

const _saveTimers = {};
const _saveFns = {};
let _saveTimerSeq = 0;

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

function flushAllSaves() {
	Object.keys(_saveTimers).forEach(flushSave);
}

// ============ 数据持久化基础设施 ============
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
DataManager.prototype.load = function() {
	// SQL 模式
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
	// JSON 模式
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
		this.data = JSON.parse(JSON.stringify(this.defaultData));
		logger.error('加载失败[' + this.path + ']：' + e.message);
	}
	return this.data;
};
DataManager.prototype.save = function(immediate) {
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
			// 内存变更防抖后写入，随后触发2秒防抖写磁盘
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
DataManager.prototype.get = function() {
	return this.data;
};
DataManager.prototype.getPlayerData = function(xuid, defaultPlayerData) {
	if (!this.data.players) this.data.players = {};
	if (!this.data.players[xuid]) {
		this.data.players[xuid] = JSON.parse(JSON.stringify(defaultPlayerData));
		this.save();
	}
	return this.data.players[xuid];
};

const _dataManagers = {};

function registerDataManager(name, path, defaultData, options) {
	const dm = new DataManager(path, defaultData, options);
	_dataManagers[name] = dm;
	return dm;
}

// 初始化所有配置文件与数据
function initLevelExpTable() {
	levelUpExp[0] = 0;
	let total = 0;
	for (let i = 0; i < C.LEVEL_EXP_STEPS.length; i++) {
		total += C.LEVEL_EXP_STEPS[i];
		levelUpExp[i + 1] = total;
	}
}

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
JsonConfigFileAdapter.prototype.init = function(name, defaultValue) {
	if (this._data[name] === undefined) {
		this._data[name] = defaultValue;
		this._save();
	}
	return this._data[name];
};
JsonConfigFileAdapter.prototype.get = function(name, defaultValue) {
	if (this._data[name] !== undefined) return this._data[name];
	return defaultValue !== undefined ? defaultValue : null;
};
JsonConfigFileAdapter.prototype.set = function(name, value) {
	this._data[name] = value;
	this._save();
	return true;
};
JsonConfigFileAdapter.prototype.delete = function(name) {
	if (this._data[name] !== undefined) {
		delete this._data[name];
		this._save();
		return true;
	}
	return false;
};
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
JsonConfigFileAdapter.prototype.getPath = function() {
	return this._path;
};
JsonConfigFileAdapter.prototype.read = function() {
	return JSON.stringify(this._data, null, 2);
};
JsonConfigFileAdapter.prototype.write = function(content) {
	try {
		this._data = JSON.parse(content);
		this._save();
		return true;
	} catch (e) {
		return false;
	}
};
JsonConfigFileAdapter.prototype._save = function() {
	try {
		U.ensureDir(this._path);
		fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
	} catch (e) {
		logger.error('JsonConfigFileAdapter保存失败[' + this._path + ']：' + e.message);
	}
};

// 初始化排行榜配置
function initRankConfig() {
	try {
		config = new JsonConfigFileAdapter(CONFIG_PATH);
		config.init("debug", false);
		_debugMode = config.get("debug", false);
		debugModule.setDebugMode(_debugMode);
		config.init("currencyName", "星茜");
		config.init("enableRank", true);
		config.init("enableShop", true);
		config.init("enableCdk", true);
		config.init("enableRecycle", true);
		config.init("enableDustShop", true);
		config.init("enableWish", true);
		config.init("enableBank", true);
		config.init("enableVip", true);
		config.init("enableFriend", true);
		config.init("enableMessageBoard", true);
		config.init("enableMail", true);
		config.init("enableLevel", true);
		config.init("enableBack", true);
		config.init("sidebarCompact", false);
		config.init("teleport", {
			"enabled": true,
			"enableHome": true,
			"enableWarp": true,
			"enableTpa": true,
			"enableRtp": true,
			"homeLimit": 10,
			"homeCooldown": 10,
			"tpaCooldown": 30,
			"tpaTimeout": 30,
			"tpaCost": 0,
			"warpCost": 0,
			"rtpCost": 0,
			"rtpCooldown": 60,
			"rtpRange": 5000,
			"rtpMinRange": 500,
			"rtpProtectionRadius": 500,
			"rtpMaxAttempts": 100,
			"rtpProtectionSeconds": 5
		});
		config.init("backupConfig", {
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
			"jwtSecret": "NLCE_Default_Secret_Change_Me",
			"jwtExpire": "15m",
			"jwtRefreshSecret": "NLCE_Default_Refresh_Secret_Change_Me",
			"jwtRefreshExpire": "7d"
		});
	} catch (error) {
		config = {
			get: (key) => true,
			set: () => true,
			init: () => {},
			reload: () => {}
		};
		logger.error(`排行榜配置初始化失败！错误：${error.message}`);
	}
}

const IPV4_MESSAGE = C.IPV4_MESSAGE;
const IPV6_MESSAGE = C.IPV6_MESSAGE;

function initPlayerData() {
	if (database.isPlayerDbReady()) {
		// SQL 模式：从数据库加载玩家核心数据
		const sqlPlayers = database.getAllPlayerDataSQL();
		const sqlNextUid = database.getNextUidSQL();
		playerData = { nextUid: sqlNextUid, players: sqlPlayers };
		logger.info('[NLCE] 玩家核心数据已从SQL加载 (' + Object.keys(sqlPlayers).length + ' 个玩家)');
		debugLog('initPlayerData: SQL模式, nextUid=' + sqlNextUid + ', 玩家数=' + Object.keys(sqlPlayers).length);
	} else {
		playerData = playerDataDM.load();
		debugLog('initPlayerData: JSON模式, 玩家数=' + Object.keys(playerData.players || {}).length);
	}
	if (!playerData.players) playerData.players = {};
	if (!playerData.nextUid) playerData.nextUid = 10000;
}

const savePlayerData = playerDataModule.savePlayerData;
const savePlayerDataNow = playerDataModule.savePlayerDataNow;

function initPlayerSettings() {
	playerSettings = playerSettingsDM.load();
}

const loadItemsDataMap = playerDataModule.loadItemsDataMap;

function initShopData() {
	shopData = shopDataDM.load();
}

function initCdkData() {
	cdkDataDM.load();
}

function initRecycleConfig() {
	recycleConfig = recycleConfigDM.load();
	if (!fs.existsSync(RECYCLE_LOG_DIR)) {
		fs.mkdirSync(RECYCLE_LOG_DIR, { recursive: true });
	}
}


const getPlayerSetting = playerDataModule.getPlayerSetting;
const setPlayerSetting = playerDataModule.setPlayerSetting;




const playerDataDM = registerDataManager('playerData', PLAYER_DATA_PATH, {
	nextUid: 10000,
	players: {}
}, {
	saveDelay: 10000
});
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
const quickMenuConfigDM = registerDataManager('quickMenuConfig', QUICK_MENU_CONFIG_PATH, {
	items: []
});
const playerSettingsDM = registerDataManager('playerSettings', PLAYER_SETTINGS_PATH, {}, {
	pretty: false,
	sqlPrefix: 'settings'
});
playerDataModule.setDataManagers(playerDataDM);
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

const DEFAULT_WISH_CONFIG = {
	"dustName": "星尘",
	"coreName": "星核",
	"description": "",
	"banner": "",
	"rates": {
		"fiveStar": 0.006,
		"fourStar": 0.051,
		"fiveStarSoftPity": 73,
		"fiveStarHardPity": 90,
		"fourStarGuarantee": 10
	},
	"cost": {
		"single": 160,
		"ten": 1600
	},
	"rewards": {
		"threeStar": {
			"minDust": 10,
			"maxDust": 40
		},
		"fourStar": [],
		"fiveStar": []
	},
	"coreShop": []
};

function initWishConfig() {
	try {
		config.init("wishConfig", Object.assign({}, DEFAULT_WISH_CONFIG, {
			"dustName": "三星副产物",
			"coreName": "五星副产物",
			"description": "进行祈愿时，遵循以下概率与保底规则"
		}));
		wishConfig = config.get("wishConfig");
		if (!wishConfig || typeof wishConfig !== 'object') {
			wishConfig = {};
		}
		if (!wishConfig.dustName) wishConfig.dustName = DEFAULT_WISH_CONFIG.dustName;
		if (!wishConfig.coreName) wishConfig.coreName = DEFAULT_WISH_CONFIG.coreName;
		if (!wishConfig.description) wishConfig.description = DEFAULT_WISH_CONFIG.description;
		if (!wishConfig.banner) wishConfig.banner = DEFAULT_WISH_CONFIG.banner;
		if (!wishConfig.rates) wishConfig.rates = Object.assign({}, DEFAULT_WISH_CONFIG.rates);
		if (!wishConfig.cost) wishConfig.cost = Object.assign({}, DEFAULT_WISH_CONFIG.cost);
		if (!wishConfig.rewards) wishConfig.rewards = {};
		if (!wishConfig.rewards.threeStar) wishConfig.rewards.threeStar = Object.assign({}, DEFAULT_WISH_CONFIG.rewards.threeStar);
		if (!wishConfig.rewards.fourStar) wishConfig.rewards.fourStar = [];
		if (!wishConfig.rewards.fiveStar) wishConfig.rewards.fiveStar = [];
		if (!wishConfig.coreShop) wishConfig.coreShop = [];
	} catch (error) {
		wishConfig = JSON.parse(JSON.stringify(DEFAULT_WISH_CONFIG));
		logger.error(`祈愿配置加载失败！错误：使用默认配置：${error.message}`);
	}
}

function initDeathPointData() {
	teleportModule.initDeathPoint(deathPointDM);
}







// ============ 模块初始化 ============
async function initAllConfigs() {
	initLevelExpTable();
	initRankConfig();
		economyModule.init({ config: config, getPlayerData: function() { return playerData; }, getPlayerAvatarUrl: getPlayerAvatarUrl });
		playerDataModule.init({ database: database, config: config, constants: C, fs: fs, itemsDataPath: ITEMS_DATA_PATH,
			getPlayerData: function() { return playerData; },
			getPlayerSettings: function() { return playerSettings; },
			savePlayerSettings: function() { playerSettingsDM.save(true); }
		});
		avatarModule.init({
			getPlayerData: function() { return playerData; },
			savePlayerData: savePlayerData,
			showPersonalCenterForm: personalCenter.showPersonalCenterForm
		});
		database.setDebugMode(_debugMode);
		debugLog("initAllConfigs: Debug模式已" + (_debugMode ? "开启" : "关闭"));
		// 初始化玩家数据库(SQL)
	try {
		await database.initPlayerDatabase();
		logger.info('[NLCE] 玩家数据库(SQL)初始化完成');
	} catch (e) {
		logger.error('[NLCE] 玩家数据库初始化失败，使用JSON模式: ' + e.message);
	}
	initPlayerData();
	initPlayerSettings();
	initShopData();
	initCdkData();
	loadItemsDataMap();
	initRecycleConfig();
	messageBoardModule.init(messageBoardDM);
	initWishConfig();
	spawnEggShopConfig = spawnEggShopDM.load();
	initDeathPointData();
	debugLog('friendModule.init: 好友模块初始化, playerData.players 条目=' + Object.keys(playerData.players || {}).length);
	friendModule.init(friendDM, messageDM, {
		playerData: playerData.players,
		getPlayerInfoByXuid: function(xuid) { return playerData.players[xuid] || null; },
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		getPlayerSetting: getPlayerSetting,
		showPersonalCenterForm: personalCenter.showPersonalCenterForm
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
	quickMenuModule.init({ quickMenuConfigDM: quickMenuConfigDM, getCurrencyName: getCurrencyName, getPlayerData: function() { return playerData; }, savePlayerData: savePlayerData });
	quickMenuModule.loadConfig();
	chatModule.init({ fs: fs, U: U, chatCfgPath: CHAT_CFG_PATH, badWordsPath: BAD_WORDS_PATH, webServer: webServer });
	chatModule.loadChatConfig();
	chatModule.registerChatListener();
	initNarConfig();
	backupModule.init(config.get("backupConfig"));

// ============ 依赖注入与模块创建 ============
	commonDeps = {
		getPlayerMoney: getPlayerMoney,
		addPlayerMoney: addPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoneyByXuid: addPlayerMoneyByXuid,
		getPlayerMoneyByXuid: getPlayerMoneyByXuid,
		getCurrencyName: getCurrencyName,
		notifyEconomyChange: notifyEconomyChange,
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		getVipInfo: getVipInfo,
		giveItemById: giveItemById,
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		shopData: shopData,
		recycleConfig: recycleConfig,
		showRecycleForm: function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); },
		RECYCLE_LOG_DIR: RECYCLE_LOG_DIR,
		getPlayerSetting: getPlayerSetting,
		money: money,
		openMainMenu: personalCenter.openMainMenu
	};

	teleportModule.init(config, homesDM, warpsDM, commonDeps);

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

	wishModule.init(wishDM, enchantBookShopDM, spawnEggShopDM, wishConfig, {
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		getCurrencyName: getCurrencyName,
		notifyEconomyChange: notifyEconomyChange,
		playerData: playerData.players,
		savePlayerDataNow: savePlayerDataNow,
		money: money,
		openMainMenu: personalCenter.openMainMenu,
		vipModule: vipModule,
		showPersonalCenterForm: personalCenter.showPersonalCenterForm
	});
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

	// 个人中心模块初始化（必须在所有模块之后）
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
		commonDeps: commonDeps
	});
	personalCenter.setLevelUpExp(levelUpExp);
	personalCenter.installPrototypeExtensions();
}

// 4. 事件监听

// ============ 核心事件监听 ============
mc.listen("onJoin", (player) => {
	const playerXUID = player.xuid;
	const playerName = player.name;
	const playerUUID = player.uuid;
	debugLog('onJoin: 玩家加入 ' + playerName + ' (XUID: ' + playerXUID + '), playerData.players 条目数=' + Object.keys(playerData.players || {}).length + ', 已存在=' + (!!playerData.players[playerXUID]));

	if (!playerData.players[playerXUID]) {
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
	} else {
		playerData.players[playerXUID].name = playerName;
		debugLog('onJoin: 老玩家 ' + playerName + ' (XUID: ' + playerXUID + ') UID: ' + playerData.players[playerXUID].uid);
		try {
			const dev = player.getDevice();
			if (dev && dev.ip) playerData.players[playerXUID].lastIp = dev.ip;
			if (dev && dev.os) playerData.players[playerXUID].platform = dev.os;
		} catch(e) {}
		if (playerData.players[playerXUID].uid === undefined) {
			playerData.players[playerXUID].uid = 9999;
			logger.warn(`玩家 ${playerName} 数据缺失UID，已补全为9999`);
		}
		if (playerData.players[playerXUID].healthBonus === undefined) {
			playerData.players[playerXUID].healthBonus = 0;
		}
	}

	savePlayerDataNow();

	_joinTimestamps[playerXUID] = Date.now();
	onlinePlayers[String(playerXUID)] = true;
	personalCenter.obtainStatBlock(playerXUID);

	const xuid = String(playerXUID);
	const now = Date.now();

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
				savePlayerData();
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

	// ipDetector功能：网络协议检测（根据玩家设置）
	economyModule.checkPendingTransfers(player);
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

	let p = playerData.players[xuidStr];
	if (p) {
		p.leavetime = Date.now();
	}
	savePlayerDataNow();
});

function initStatTrackers() {
	mc.listen("onDestroyBlock", function(player, block) {
		if (!config.get("enableRank")) return;
		personalCenter.bumpStat(player.xuid, "mining", 1);
	});

	mc.listen("afterPlaceBlock", function(player, block) {
		if (!config.get("enableRank")) return;
		personalCenter.bumpStat(player.xuid, "placing", 1);
	});

	mc.listen("onMobDie", function(mob, source, cause) {
		if (!config.get("enableRank")) return;
		if (!source || !source.isPlayer()) return;
		const killer = source.toPlayer();
		if (killer && !killer.isSimulatedPlayer() && killer.realName !== undefined) {
			personalCenter.bumpStat(killer.xuid, "kills", 1);
			personalCenter.bumpStat(killer.xuid, "mobKills", 1);
		}
	});

	mc.listen("onPlayerDie", function(player, source) {
		if (!config.get("enableRank")) return;
		personalCenter.bumpStat(player.xuid, "deaths", 1);

		if (config.get("enableBack")) {
			teleportModule.recordDeathPoint(player);

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

function tickOnlineDurations() {
	if (!config.get("enableRank")) return;
	let now = Date.now();
	Object.keys(_joinTimestamps).forEach(function(xuid) {
		const blk = personalCenter.obtainStatBlock(xuid);
		if (!blk) return;
		blk.playTime += Math.floor((now - _joinTimestamps[xuid]) / 1000);
		_joinTimestamps[xuid] = now;
	});
	savePlayerData();
}

setInterval(tickOnlineDurations, 58848);

setInterval(() => {
	const now = Date.now();
	let updated = false;
	Object.keys(onlinePlayers).forEach(xuid => {
		const p = playerData.players[xuid];
		if (p) {
			p.leavetime = now;
			updated = true;
		}
	});
	if (updated) {
		savePlayerData();
	}
}, 30000);




// ============ 功能函数 ============


// ============ 功能函数 ============
// 经济系统 (core/economy.js)

const getCurrencyName = economyModule.getCurrencyName;
const notifyEconomyChange = economyModule.notifyEconomyChange;
const getPlayerMoney = economyModule.getPlayerMoney;
const reducePlayerMoney = economyModule.reducePlayerMoney;
const addPlayerMoney = economyModule.addPlayerMoney;
const getPlayerMoneyByXuid = economyModule.getPlayerMoneyByXuid;
const addPlayerMoneyByXuid = economyModule.addPlayerMoneyByXuid;

function giveItem(player, itemData, count) {
	let id = typeof itemData === 'string' ? itemData : itemData.id;
	const aux = typeof itemData === 'string' ? 0 : (itemData.aux || 0);
	const testItem = mc.newItem(id, 1);
	testItem.setAux(aux);
	if (testItem.isStackable) {
		let remaining = count;
		while (remaining > 0) {
			const stackSize = Math.min(remaining, 64);
			let item = mc.newItem(id, stackSize);
			item.setAux(aux);
			player.giveItem(item);
			remaining -= stackSize;
		}
	} else {
		for (let i = 0; i < count; i++) {
			let item = mc.newItem(id, 1);
			item.setAux(aux);
			player.giveItem(item);
		}
	}
	player.refreshItems();
}

function giveItemById(player, itemId, count) {
	giveItem(player, { id: itemId, aux: 0 }, count);
}

function getVipInfo(player) {
	return commonDeps.vipModule.getVipInfo(player);
}





// TPS 计算
mc.listen("onTick", () => {
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
});

mc.listen("onServerStarted", async () => {
	await initAllConfigs();
	registerAllCommands();
	banModule.registerConsoleCommands();
	banModule.registerGameCommands();
	citlaliaModule.init({ constants: C, getPlayerData: function() { return playerData; }, getPlayerSetting: getPlayerSetting });
	sidebarModule.init({ constants: C, config: config, money: money, getCurrencyName: getCurrencyName, getPlayerSetting: getPlayerSetting, tpsData: tpsData });
	quickMenuModule.registerCommands(registerPlayerCommand);
	quickMenuModule.registerCompassListener();
	registerWebCommands();
	initWebServer();
	behaviorLog.init();

	setInterval(function() { mailModule.checkScheduledMails(); }, 30000);

	// 服务器关闭时刷新所有待写入数据（防止数据丢失）
	mc.listen("onServerStopping", function() {
		logger.info('[NLCE] 正在保存所有待写入数据...');
		flushAllSaves();
		if (database.isPlayerDbReady()) {
			database.cancelPendingSave();
			savePlayerDataNow();
			database.savePlayerDatabase();
		}
		database.cancelPendingAuthSave();
		database.saveDatabase();
	});

	const mem = process.memoryUsage();
	logger.info('[NLCE] 内存使用 - 堆已用: ' + (mem.heapUsed / 1024 / 1024).toFixed(2) + 'MB, 堆总量: ' + (mem.heapTotal / 1024 / 1024).toFixed(2) + 'MB, RSS: ' + (mem.rss / 1024 / 1024).toFixed(2) + 'MB');
});

mc.listen("onPreJoin", function(pl) {
	const ip = pl.getDevice ? pl.getDevice().ip : '';
	const banCheck = banModule.isPlayerBanned(pl.xuid, ip);
	if (banCheck.banned) {
		pl.kick('§c你已被封禁\n§e原因：' + banCheck.reason);
		return false;
	}
});


// 命令注册

// ============ 命令注册 ============
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
			handler(player);
		});
		cmd.setup();
	} catch (error) {
		logger.error("/" + name + " 命令注册出错！错误：" + error);
	}
}

function registerAllCommands() {
	const tpCfg = teleportModule.tpsConfig();
	const tpEnabled = function() { return teleportModule.tpsConfig().enabled; };
	const tpHomeEnabled = function() { let c = teleportModule.tpsConfig(); return c.enabled && c.enableHome; };
	const tpWarpEnabled = function() { let c = teleportModule.tpsConfig(); return c.enabled && c.enableWarp; };
	const tpTpaEnabled = function() { let c = teleportModule.tpsConfig(); return c.enabled && c.enableTpa; };
	const tpRtpEnabled = function() { const c = teleportModule.tpsConfig(); return c.enabled && c.enableRtp; };
	const commands = [
		["shop", "商店系统", function(p) { shopModule.showShopMainForm(p, commonDeps); }, "enableShop"],
		["rank", "排行榜", function(p) { commonDeps.rankModule.showRankMainForm(p); }, "enableRank"],
		["cdk", "CDK兑换", function(p) { commonDeps.cdkModule.showCdkRedeemForm(p); }, "enableCdk"],
		["pay", "经济系统", function(p) { economyModule.showMoneyMainForm(p); }],
		["mb", "打开留言板", function(p) { messageBoardModule.showMainForm(p); }, "enableMessageBoard"],
		["vip", "VIP系统", function(p) { commonDeps.vipModule.showVipMenu(p); }, "enableVip"],
		["bank", "银行系统", function(p) { commonDeps.bankModule.showBankMainForm(p); }, "enableBank"],
		["wish", "祈愿系统", function(p) { wishModule.showWishMainForm(p); }, "enableWish"],
		["recycle", "回收系统", function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); }, "enableRecycle"],
		["level", "等级奖励", function(p) { personalCenter.showLevelRewardForm(p); }, "enableLevel"],
		["xpshop", "经验商店", function(p) { shopModule.showXPBuyForm(p, commonDeps); }, "enableDustShop"],
		["dustshop", "星尘商店", function(p) { wishModule.showDustShopMainForm(p); }, "enableDustShop"],
		["enchantshop", "附魔书商店", function(p) { wishModule.showEnchantBookShopForm(p); }, "enableDustShop"],
		["settings", "个人设置", personalCenter.showPlayerSettingsForm],
		["back", "返回死亡点", function(p) { teleportModule.showDeathPointMenu(p); }, "enableBack"],
		["mail", "打开邮件系统", function(p) { mailModule.showMailSystemForm(p); }, "enableMail"],
		["rc", "打开批量回收界面", function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); }, "enableRecycle"],
		["friend", "打开好友系统", function(p) { friendModule.showMyFriendsForm(p); }, "enableFriend"],
		["network", "网络信息", personalCenter.showNetworkInfoForm],
		["tpg", "传送系统主菜单", function(p) { teleportModule.showTpgMainMenu(p, commonDeps); }, tpEnabled],
		["home", "家园系统", function(p) { teleportModule.showHomeMainForm(p, commonDeps); }, tpHomeEnabled],
		["warp", "公共传送点", function(p) { teleportModule.showWarpMainForm(p, commonDeps); }, tpWarpEnabled],
		["tpa", "互传系统-传送到玩家", function(p) { teleportModule.showTpaMainForm(p, commonDeps); }, tpTpaEnabled],
		["tpn", "互传系统-请玩家传送过来", function(p) { teleportModule.showTpaMainForm(p, commonDeps); }, tpTpaEnabled],
		["tpy", "互传系统-双方互传", function(p) { teleportModule.showTpaMainForm(p, commonDeps); }, tpTpaEnabled],
		["tpcancel", "取消传送请求", function(p) { teleportModule.cancelTpaRequest(p); }, tpTpaEnabled],
		["tpaccept", "接受传送请求", function(p) { teleportModule.acceptTpaRequestByPlayer(p, commonDeps); }, tpTpaEnabled],
		["tpdeny", "拒绝传送请求", function(p) { teleportModule.denyTpaRequestByPlayer(p); }, tpTpaEnabled],
		["rtp", "随机传送", function(p) { teleportModule.executeRtp(p, commonDeps); }, tpRtpEnabled]
	];
	for (let i = 0; i < commands.length; i++) {
		let cmd = commands[i];
		registerPlayerCommand(cmd[0], cmd[1], cmd[2], cmd[3]);
	}
}





// 头像系统 (core/avatar.js)

const getPlayerAvatarUrl = avatarModule.getPlayerAvatarUrl;
const showAvatarSettingsForm = avatarModule.showAvatarSettingsForm;


// ============ 玩家搜索与工具 ============
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

// 检查未读消息和邮件
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

// 入服给钟和指南针功能
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

function initNarConfig() {
	narConfig = narConfigDM.load();
	if (!narConfig.npc_actions) narConfig.npc_actions = {};
}

mc.listen("onAttackEntity", function(player, entity) {
	try {
		const entityType = entity.type;
		const entityName = U.cleanFormatting(entity.name);

		const actions = narConfig.npc_actions;
		if (actions && actions[entityType]) {
			for (let i = 0; i < actions[entityType].length; i++) {
				let action = actions[entityType][i];
				if (U.cleanFormatting(action.name) === entityName) {
					const cmd = action.command.replace(/@s/g, player.name);

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





// Web API 系统

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
		const serverStats = require('./core/serverStats');
		serverStats.init(tpsData, money, playerDataDM);
		webServer.onReload('recycle', function() {
			recycleConfig = recycleConfigDM.load();
		});
		webServer.onReload('shop', function() {
			shopData = shopDataDM.load();
		});
		webServer.onReload('cdk', function() {
			cdkDataDM.load();
		});
		webServer.onReload('wish', function() {
			try {
				config.reload();
				wishConfig = config.get("wishConfig") || wishConfig;
				wishModule.reloadConfig(wishConfig);
			} catch (e) {}
		});
		webServer.onReload('config', function() {
			try {
				config.reload();
				wishConfig = config.get("wishConfig") || wishConfig;
				wishModule.reloadConfig(wishConfig);
				backupModule.reload(config.get("backupConfig"));
			} catch (e) {}
		});
		webServer.startServer(webConfig);
	}).catch(function(e) {
		logger.error('[Web] 数据库初始化失败: ' + e.message);
	});
}

function registerWebCommands() {
	try {
		const passwdCmd = mc.newCommand('passwd', '设置或修改Web登录密码', PermType.Any);
		passwdCmd.optional('args', ParamType.RawText);
		passwdCmd.overload();
		passwdCmd.overload('args');
		passwdCmd.setCallback(function(_cmd, origin, output, results) {
			if (!results.args) {
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
			const parts = String(results.args).trim().split(/\s+/);
			if (parts.length < 2) {
				output.error('用法: passwd <uid> <密码>');
				return;
			}
			let uid = parts[0];
			const pwd = parts[1];
			if (pwd.length < 6) {
				output.error('密码长度不能少于6位');
				return;
			}
			database.setPassword(String(uid), pwd);
			output.success('已为UID ' + uid + ' 设置Web登录密码');
		});
		passwdCmd.setup();
	} catch (error) {
		logger.error('/passwd 命令注册出错！错误：' + error);
	}

	try {
		mc.regConsoleCmd('admin', '管理员管理 (add/del uid)', function(args) {
			if (args.length < 2) {
				logger.info('用法: admin <add|del> <uid>');
				return;
			}
			let action = args[0];
			const uid = args[1];
			if (action === 'add') {
				if (database.addAdmin(String(uid))) {
					logger.info('已添加UID ' + uid + ' 为管理员');
				} else {
					logger.info('UID ' + uid + ' 已经是管理员');
				}
			} else if (action === 'del') {
				if (database.removeAdmin(String(uid))) {
					logger.info('已移除UID ' + uid + ' 的管理员权限');
				} else {
					logger.info('UID ' + uid + ' 不是管理员');
				}
			} else {
				logger.info('用法: admin <add|del> <uid>');
			}
		});
	} catch (error) {
		logger.error('/admin 命令注册出错！错误：' + error);
	}

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

function showPasswdForm(player) {
	const xuid = player.xuid;
	const hasPwd = database.hasPassword(xuid);

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

		database.setPassword(player.xuid, pwd1);
		player.tell('§aWeb登录密码设置成功！你的UID为: §e' + player.xuid);
		player.tell('§7请使用UID和密码登录Web管理面板');
	});
}

if (typeof ll !== 'undefined' && ll.onUnload) {
	ll.onUnload(function() {
		webServer.stopServer();
		database.saveDatabase();
	});
}

colorLog("yellow",    " _   _   _         _____   ______ ");
colorLog("yellow",    "| \\ | | | |       / ____| |  ____|");
colorLog("yellow",    "|  \\| | | |      | |      | |__   ");
colorLog("yellow",    "| . ` | | |      | |      |  __|  ");
colorLog("yellow",    "| |\\  | | |____  | |____  | |____ ");
colorLog("yellow",    "|_| \\_| |______|  \\_____| |______|");

logger.info("");
logger.info(`       NLCE 1.9.9 (${DESIGNATION_NAME})`);
logger.info("");