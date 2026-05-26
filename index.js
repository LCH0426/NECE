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
const webServer = require('./core/server');
const behaviorLog = require('./core/behaviorLog');
const chatLog = require('./core/chatLog');
const C = require('./core/constants');
const U = require('./core/utils');
const payModule = require('./core/pay');
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
const WISH_CONFIG_PATH = C.PATHS.WISH_CONFIG;
const ENCHANT_BOOK_SHOP_PATH = C.PATHS.ENCHANT_BOOK_SHOP;
const SPAWN_EGG_SHOP_PATH = C.PATHS.SPAWN_EGG_SHOP;
const WISH_HISTORY_LOG_DIR = C.PATHS.WISH_HISTORY_LOG_DIR;
const DEATH_POINT_DATA_PATH = C.PATHS.DEATH_POINT_DATA;
const FRIEND_DATA_PATH = C.PATHS.FRIEND_DATA;
const MESSAGE_DATA_PATH = C.PATHS.MESSAGE_DATA;
const BAN_DATA_PATH = C.PATHS.BAN_DATA;
const MAIL_DATA_PATH = C.PATHS.MAIL_DATA;
const QUICK_MENU_CONFIG_PATH = C.PATHS.QUICK_MENU_CONFIG;
const NAR_CONFIG_PATH = C.PATHS.NAR_CONFIG;
const ITEMS_DATA_PATH = C.PATHS.ITEMS_DATA;
const TPS_DATA_PATH = C.PATHS.TPS_DATA;
const HOMES_DATA_PATH = C.PATHS.HOMES_DATA;
const WARPS_DATA_PATH = C.PATHS.WARPS_DATA;
const CHAT_CFG_PATH = C.PATHS.CHAT_CFG;
const BAD_WORDS_PATH = C.PATHS.BAD_WORDS;

let config;
let playerData = { nextUid: 10000, players: {} };
let playerSettings;
let levelUpExp = [];
var _joinTimestamps = {};
let onlinePlayers = {};
let shopData;
let recycleConfig;
let wishConfig = {};
let spawnEggShopConfig = {
	currency: {
		name: "星尘"
	},
	items: []
};
let quickMenuConfig = {
	items: []
};
let narConfig = {
	npc_actions: {}
};
let itemsDataMap = {};
let tpsData = {
	tps: '20.00',
	tps_Count: null,
	tps_Time_start: 0,
	tps_Time_end: 0
};

var commonDeps = null;

const _saveTimers = {};
const _saveFns = {};
var _saveTimerSeq = 0;

function debouncedSave(key, saveFn, delay) {
	delay = delay || 5000;
	_saveFns[key] = saveFn;
	_saveTimerSeq++;
	var seq = _saveTimerSeq;
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

function DataManager(path, defaultData, options) {
	options = options || {};
	this.path = path;
	this.data = null;
	this.defaultData = defaultData;
	this.pretty = options.pretty !== false;
	this.saveDelay = options.saveDelay || 5000;
	this.saveKey = path;
}
DataManager.prototype.load = function() {
	try {
		if (!fs.existsSync(this.path)) {
			U.ensureDir(this.path);
			fs.writeFileSync(this.path, JSON.stringify(this.defaultData, null, this.pretty ? 2 : 0), 'utf-8');
			this.data = JSON.parse(JSON.stringify(this.defaultData));
		} else {
			var content = fs.readFileSync(this.path, 'utf-8');
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
	var self = this;
	var doSave = function() {
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

var _dataManagers = {};

function registerDataManager(name, path, defaultData, options) {
	var dm = new DataManager(path, defaultData, options);
	_dataManagers[name] = dm;
	return dm;
}

function getDataManager(name) {
	return _dataManagers[name];
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
			var content = fs.readFileSync(filePath, 'utf-8');
			if (content && content.trim() !== '') {
				this._data = JSON.parse(content);
			}
		} else {
			if (defaultContent) {
				var defaultData = JSON.parse(defaultContent);
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
			var content = fs.readFileSync(this._path, 'utf-8');
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
	playerData = playerDataDM.load();
	if (!playerData.players) playerData.players = {};
	if (!playerData.nextUid) playerData.nextUid = 10000;
}

function savePlayerData() {
	playerDataDM.save();
}

function savePlayerDataNow() {
	playerDataDM.save(true);
}

function initPlayerSettings() {
	playerSettings = playerSettingsDM.load();
}

function savePlayerSettings() {
	playerSettingsDM.save(true);
}

function loadItemsDataMap() {
	try {
		var content = fs.readFileSync(ITEMS_DATA_PATH, 'utf-8');
		var data = JSON.parse(content);
		itemsDataMap = data.item || {};
	} catch (e) {
		itemsDataMap = {};
	}
}

function getItemInfoById(itemId) {
	var shortId = itemId.replace(/^minecraft:/, '');
	var item = itemsDataMap[shortId];
	if (item && typeof item === 'object') {
		return { name: item.name || shortId, texture: item.texture || '' };
	}
	if (typeof item === 'string') {
		return { name: item, texture: '' };
	}
	return { name: shortId, texture: '' };
}

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


function getPlayerSetting(xuid, key) {
	if (!playerSettings[xuid]) {
		playerSettings[xuid] = Object.assign({}, C.DEFAULT_PLAYER_SETTINGS);
	}
	return playerSettings[xuid][key] !== undefined ? playerSettings[xuid][key] : false;
}

function setPlayerSetting(xuid, key, value) {
	if (!playerSettings[xuid]) {
		playerSettings[xuid] = Object.assign({}, C.DEFAULT_PLAYER_SETTINGS);
	}
	playerSettings[xuid][key] = value;
	savePlayerSettings();
}




var playerDataDM = registerDataManager('playerData', PLAYER_DATA_PATH, {
	nextUid: 10000,
	players: {}
}, {
	saveDelay: 10000
});
var wishDM = registerDataManager('wish', WISH_DATA_PATH, {
	players: {}
});
var deathPointDM = registerDataManager('deathPoint', DEATH_POINT_DATA_PATH, {
	players: {}
});
var friendDM = registerDataManager('friend', FRIEND_DATA_PATH, {
	players: {}
});
var messageDM = registerDataManager('message', MESSAGE_DATA_PATH, {
	players: {}
});
var banDM = registerDataManager('ban', BAN_DATA_PATH, {
	entries: {}
});
var mailDM = registerDataManager('mail', MAIL_DATA_PATH, {
	mails: [],
	nextId: 1
});
var messageBoardDM = registerDataManager('messageBoard', MESSAGEBOARD_DATA_PATH, {
	messages: [],
	nextId: 1
});
var quickMenuConfigDM = registerDataManager('quickMenuConfig', QUICK_MENU_CONFIG_PATH, {
	items: []
});
var playerSettingsDM = registerDataManager('playerSettings', PLAYER_SETTINGS_PATH, {}, {
	pretty: false
});
var narConfigDM = registerDataManager('narConfig', NAR_CONFIG_PATH, {
	npc_actions: {}
});
var homesDM = registerDataManager('homes', HOMES_DATA_PATH, {});
var warpsDM = registerDataManager('warps', WARPS_DATA_PATH, {});

var DEFAULT_ENCHANT_BOOK_CONFIG = C.DEFAULT_ENCHANT_BOOK_CONFIG;
var enchantBookShopDM = registerDataManager('enchantBookShop', ENCHANT_BOOK_SHOP_PATH, DEFAULT_ENCHANT_BOOK_CONFIG);
var spawnEggShopDM = registerDataManager('spawnEggShop', SPAWN_EGG_SHOP_PATH, spawnEggShopConfig);

var shopDataDM = registerDataManager('shopData', SHOP_DATA_PATH, {
	Buy: [],
	Sell: []
});

var cdkDataDM = registerDataManager('cdkData', CDK_DATA_PATH, {
	codes: {}
});

var recycleConfigDM = registerDataManager('recycleConfig', RECYCLE_DATA_PATH, {
	recycleItems: {}
});

var DEFAULT_WISH_CONFIG = {
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

function saveDeathPointData() {
	teleportModule.getDeathPointData();
}

function getDimensionName(dimId, colored) {
	var id = Number(dimId);
	if (colored) {
		switch (id) {
			case 0:
				return "§a主世界";
			case 1:
				return "§c地狱";
			case 2:
				return "§d末地";
			default:
				return "未知维度(" + dimId + ")";
		}
	}
	switch (id) {
		case 0:
			return "主世界";
		case 1:
			return "下界";
		case 2:
			return "末地";
		default:
			return "未知维度";
	}
}

function getPlayerBankAccount(xuid) { return commonDeps.bankModule.getPlayerBankAccount(xuid); }
function calculateCurrentInterest(account) { return commonDeps.bankModule.calculateCurrentInterest(account); }
function checkFixedDepositMaturity(player) { return commonDeps.bankModule.checkFixedDepositMaturity(player, getPlayerSetting); }
function showBankMainForm(player) { commonDeps.bankModule.showBankMainForm(player); }
function showCurrentOperationForm(player) { commonDeps.bankModule.showCurrentOperationForm(player); }
function showFixedDepositMainForm(player) { commonDeps.bankModule.showFixedDepositMainForm(player); }
function showFixedDepositDetailForm(player) { commonDeps.bankModule.showFixedDepositDetailForm(player); }
function showSingleFixedDepositForm(player, deposit) { commonDeps.bankModule.showSingleFixedDepositForm(player, deposit); }
function showFixedDepositForm(player) { commonDeps.bankModule.showFixedDepositForm(player); }
function performCurrentOperation(player, amount) { return commonDeps.bankModule.performCurrentOperation(player, amount); }
function depositFixed(player, amount, days) { return commonDeps.bankModule.depositFixed(player, amount, days); }
function withdrawFixed(player, depositId) { return commonDeps.bankModule.withdrawFixed(player, depositId); }

function initAllConfigs() {
	initLevelExpTable();
	initRankConfig();
	initPlayerData();
	initPlayerSettings();
	initShopData();
	initCdkData();
	payModule.load();
	loadItemsDataMap();
	initRecycleConfig();
	messageBoardModule.init(messageBoardDM);
	initWishConfig();
	spawnEggShopConfig = spawnEggShopDM.load();
	initDeathPointData();
	friendModule.init(friendDM, messageDM, {
		playerData: playerData.players,
		getPlayerInfoByXuid: getPlayerInfoByXuid,
		getPlayerAvatarUrl: getPlayerAvatarUrl,
		getPlayerSetting: getPlayerSetting,
		showPersonalCenterForm: showPersonalCenterForm
	});
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
		showPersonalCenterForm: showPersonalCenterForm
	});
	initQuickMenuConfig();
	loadChatConfig();
	initNarConfig();
	backupModule.init(config.get("backupConfig"));
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
		openMainMenu: openMainMenu
	};

	teleportModule.init(config, homesDM, warpsDM, commonDeps);

	var vipModule = vipModuleCreator.create({
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		openMainMenu: openMainMenu
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
		openMainMenu: openMainMenu,
		vipModule: vipModule,
		showPersonalCenterForm: showPersonalCenterForm
	});
	commonDeps.wishModule = wishModule;

	var cdkModule = cdkModuleCreator.create({
		cdkDataDM: cdkDataDM,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		giveItemById: giveItemById
	});
	commonDeps.cdkModule = cdkModule;

	var rankModule = rankModuleCreator.create({
		playerData: playerData,
		getCurrencyName: getCurrencyName
	});
	commonDeps.rankModule = rankModule;

	var bankModule = bankModuleCreator.create({
		playerData: playerData,
		savePlayerDataNow: savePlayerDataNow,
		getPlayerMoney: getPlayerMoney,
		reducePlayerMoney: reducePlayerMoney,
		addPlayerMoney: addPlayerMoney,
		getCurrencyName: getCurrencyName,
		openMainMenu: openMainMenu,
		utils: U
	});
	commonDeps.bankModule = bankModule;
}

function obtainStatBlock(xuid) {
	var p = playerData.players[xuid];
	if (!p) return null;
	if (!p.count) {
		p.count = { mining: 0, placing: 0, kills: 0, deaths: 0, playTime: 0, mobKills: 0 };
	}
	if (p.count.mobKills === undefined) p.count.mobKills = 0;
	return p.count;
}

function bumpStat(xuid, field, amount) {
	var blk = obtainStatBlock(xuid);
	if (!blk) return;
	blk[field] = (blk[field] || 0) + amount;
}

function getPlayerExpByXuid(xuid) {
	var p = playerData.players[xuid];
	if (p && p.count && p.count.playTime !== undefined) {
		return Math.floor(p.count.playTime);
	}
	return 0;
}

function calculateAdventureLevel(exp) {
	exp = Math.max(0, exp);
	var maxLevel = levelUpExp.length;
	var lo = 0, hi = maxLevel - 1;
	while (lo < hi) {
		var mid = Math.ceil((lo + hi) / 2);
		if (exp >= levelUpExp[mid]) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	var level = lo + 1;
	var currentExp = exp - levelUpExp[lo];
	var nextExp = lo + 1 < maxLevel ? levelUpExp[lo + 1] - levelUpExp[lo] : 0;
	if (level >= maxLevel) {
		nextExp = 0;
		currentExp = exp - levelUpExp[maxLevel - 1];
	}
	return {
		level: level,
		currentExp: currentExp,
		nextExp: nextExp,
		totalExp: exp
	};
}

function getTotalExpByLevel(targetLevel) {
	targetLevel = Math.max(1, Math.min(targetLevel, levelUpExp.length));
	return levelUpExp[targetLevel - 1] || 0;
}

function getPlayerRewardRange(xuid) {
	var p = playerData.players[xuid];
	if (!p || !p.rw) return { min: 1, max: 0 };
	var parts = p.rw.split("-");
	return {
		min: parseInt(parts[0]) || 1,
		max: parseInt(parts[1]) || 0
	};
}

function updatePlayerRewardRecord(xuid, newMaxLevel) {
	var p = playerData.players[xuid];
	if (!p) return false;
	var oldRange = getPlayerRewardRange(xuid);
	if (newMaxLevel <= oldRange.max) return false;
	p.rw = "1-" + newMaxLevel;
	savePlayerDataNow();
	return true;
}

function claimLevelReward(player, rewardExp) {
	if (rewardExp <= 0) return false;
	try {
		if (money.add(player.xuid, rewardExp)) {
			notifyEconomyChange(player, rewardExp, "等级奖励");
			return true;
		}
		return false;
	} catch (error) {
		logger.error(`玩家 ${player.name} 领取奖励失败：${error.message}`);
		return false;
	}
}

function findPlayerByUid(targetUid) {
	for (const xuid in playerData.players) {
		const player = playerData.players[xuid];
		if (player && player.uid === targetUid) {
			const exp = getPlayerExpByXuid(xuid);
			const levelInfo = calculateAdventureLevel(exp);
			return {
				...player,
				xuid: xuid,
				adventureLevel: levelInfo.level,
				adventureExp: `${levelInfo.currentExp}/${levelInfo.nextExp || "已满级"}`,
				totalExp: levelInfo.totalExp
			};
		}
	}
	return null;
}

function getAllPlayersSorted() {
	return Object.values(playerData.players)
		.filter(player => player && player.uid !== undefined)
		.sort((a, b) => a.uid - b.uid);
}

// 4. 事件监听
mc.listen("onJoin", (player) => {
	const playerXUID = player.xuid;
	const playerName = player.name;
	const playerUUID = player.uuid;

	if (!playerData.players[playerXUID]) {
		var nextUid = playerData.nextUid || 10000;
		playerData.players[playerXUID] = {
			uid: nextUid,
			registerTime: system.getTimeStr(),
			name: playerName,
			uuid: playerUUID,
			healthBonus: 0,
			lastIp: (function() { try { var d = player.getDevice(); return d && d.ip ? d.ip : ''; } catch(e) { return ''; } })(),
			platform: (function() { try { var d = player.getDevice(); return d && d.os ? d.os : ''; } catch(e) { return ''; } })()
		};
		playerData.nextUid = nextUid + 1;
		player.tell(`§a注册成功！您的UID：${nextUid}`, 1);
		logger.info(`新玩家 ${playerName}（XUID: ${playerXUID}）分配UID: ${nextUid}`);
	} else {
		playerData.players[playerXUID].name = playerName;
		try {
			var dev = player.getDevice();
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
	obtainStatBlock(playerXUID);

	const xuid = String(playerXUID);
	const now = Date.now();

	if (getPlayerSetting(xuid, "enableWelcome")) {
		try {
			var p = playerData.players[playerXUID];
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
	payModule.checkPendingTransfers(player, commonDeps);
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
		checkFixedDepositMaturity(player);
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
		bumpStat(xuid, "playTime", sessionSec);
		delete _joinTimestamps[xuid];
	}

	delete onlinePlayers[xuidStr];
	delete _sidebarCache[xuid];

	var p = playerData.players[xuidStr];
	if (p) {
		p.leavetime = Date.now();
	}
	savePlayerDataNow();
});

function initStatTrackers() {
	mc.listen("onDestroyBlock", function(player, block) {
		if (!config.get("enableRank")) return;
		bumpStat(player.xuid, "mining", 1);
	});

	mc.listen("afterPlaceBlock", function(player, block) {
		if (!config.get("enableRank")) return;
		bumpStat(player.xuid, "placing", 1);
	});

	mc.listen("onMobDie", function(mob, source, cause) {
		if (!config.get("enableRank")) return;
		if (!source || !source.isPlayer()) return;
		var killer = source.toPlayer();
		if (killer && !killer.isSimulatedPlayer() && killer.realName !== undefined) {
			bumpStat(killer.xuid, "kills", 1);
			bumpStat(killer.xuid, "mobKills", 1);
		}
	});

	mc.listen("onPlayerDie", function(player, source) {
		if (!config.get("enableRank")) return;
		bumpStat(player.xuid, "deaths", 1);

		if (config.get("enableBack")) {
			teleportModule.recordDeathPoint(player);

			if (getPlayerSetting(player.xuid, "enableDeathTeleportPopup")) {
				var dpData = teleportModule.getDeathPointData();
				var deathPoints = dpData.players[player.xuid];
				if (deathPoints && deathPoints.length > 0) {
					var latestDeath = deathPoints[0];
					var dp_xuid = player.xuid;
					setTimeout(function() {
						var pl = mc.getPlayer(dp_xuid);
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
	var now = Date.now();
	Object.keys(_joinTimestamps).forEach(function(xuid) {
		var blk = obtainStatBlock(xuid);
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
		var p = playerData.players[xuid];
		if (p) {
			p.leavetime = now;
			updated = true;
		}
	});
	if (updated) {
		savePlayerData();
	}
}, 30000);

// 5. Player原型扩展
Object.defineProperty(LLSE_Player.prototype, "uid", {
	get: function() {
		var p = playerData.players[this.xuid];
		return p && p.uid !== undefined ? p.uid : "未注册";
	},
	set: function() {
		logger.error(`禁止修改玩家UID！玩家：${this.name}（XUID: ${this.xuid}）`);
		return false;
	},
	enumerable: true
});

Object.defineProperty(LLSE_Player.prototype, "adventureLevelInfo", {
	get: function() {
		const exp = getPlayerExpByXuid(this.xuid);
		return calculateAdventureLevel(exp);
	},
	enumerable: true
});

// 6. 冒险等级面板
function showAdventureLevelDetail(player) {
	const levelInfo = player.adventureLevelInfo;
	let content = ``;
	content += `§a玩家名：§f${player.name}\n`;
	content += `§aUID：§f${player.uid}\n`;
	content += `§a冒险等级：§f${levelInfo.level}级\n`;
	content += `§a累计经验：§f${levelInfo.totalExp}点\n`;
	if (levelInfo.nextExp > 0) {
		const progress = Math.round((levelInfo.currentExp / levelInfo.nextExp) * 100);
		content += `§a当前进度：§f${levelInfo.currentExp}/${levelInfo.nextExp}\n`;
		content += `§a升级所需：§f${levelInfo.nextExp - levelInfo.currentExp} 点经验\n`;
	} else {
		content += `§a当前级进度：§f已满级（${levelInfo.currentExp}经验）\n`;
		content += `§a提示：§f您已达到最高冒险等级！\n`;
	}
	content += `-------------------------\n`;

	player.sendModalForm(
		"§a冒险等级详情",
		content,
		"§a返回面板",
		"§c关闭",
		(p, res) => {
			if (res === true) showAdventureLevelPanel(p);
		}
	);
}

function showAdventureLevelPanel(player) {
	const levelInfo = player.adventureLevelInfo;
	const levelPanel = mc.newSimpleForm();
	levelPanel.setTitle(`§a冒险等级面板`);

	let content = `-------------------------\n`;
	content += `§a当前等级：§f${levelInfo.level}级\n`;
	content += `§a总经验值：§f${levelInfo.totalExp}\n`;
	if (levelInfo.nextExp > 0) {
		content += `§a当前进度：§f${levelInfo.currentExp}/${levelInfo.nextExp}\n`;
		content += `§a升级所需：§f${levelInfo.nextExp - levelInfo.currentExp}经验\n`;
	} else {
		content += `§a当前进度：§f${levelInfo.currentExp}/已满级\n`;
		content += `§a状态：§f已达到最高等级！\n`;
	}
	content += `-------------------------\n`;
	content += `§a选择功能操作`;

	levelPanel.setContent(content);
	levelPanel.addButton("§a冒险等级详情", "textures/ui/sidebar_icons/dressing_room_capes.png");
	levelPanel.addButton("§6等级奖励", "textures/ui/pary");
	levelPanel.addButton("§c返回个人中心", "textures/ui/recap_glyph_desaturated");

	player.sendForm(levelPanel, (p, btnIndex) => {
		if (btnIndex === null) return;
		if (btnIndex === 0) showAdventureLevelDetail(p);
		if (btnIndex === 1) showLevelRewardForm(p);
		if (btnIndex === 2) showPersonalCenterForm(p);
	});
}

// 7. 等级奖励功能
function showNoRewardForm(player, levelInfo, rwRange) {
	const content = `-------------------------\n` +
		`§c您当前没有可领取的奖励！\n` +
		`§a已领取等级范围：§f${rwRange.min}-${rwRange.max}级\n` +
		`§a当前冒险等级：§f${levelInfo.level}级\n` +
		`-------------------------\n`;

	player.sendModalForm(
		"§c无可用奖励",
		content,
		"§a返回面板",
		"§c关闭",
		(p, res) => {
			if (res === true) showAdventureLevelPanel(p);
		}
	);
}

function showRewardClaimForm(player, xuid, rewardExp, availableLevel, rwRange) {
	const content = `-------------------------\n` +
		`§a可领取等级：§f${rwRange.max + 1}-${availableLevel}级\n` +
		`§a奖励§c${getCurrencyName()}§r：§f${rewardExp} \n` +
		`§a领取后将记录等级：§f1-${availableLevel}级\n` +
		`-------------------------\n` +
		`§c提示：领取后无法重复领取同等级奖励！`;

	player.sendModalForm(
		"§6等级奖励领取",
		content,
		"§a确认领取",
		"§c取消",
		(p, res) => {
			if (!res) return;

			const claimSuccess = claimLevelReward(p, rewardExp);
			if (claimSuccess) {
				updatePlayerRewardRecord(xuid, availableLevel);
				const playerMoney = money.get(p.xuid) || 0;
				const successContent = `-------------------------\n` +
					`§a恭喜！成功领取等级奖励！\n` +
					`§a领取等级：§f${rwRange.max + 1}-${availableLevel}级\n` +
					`§a获得§c${getCurrencyName()}§r：§f${rewardExp} §c${getCurrencyName()}§r\n` +
					`§a当前§c${getCurrencyName()}余额：§f${playerMoney}\n` +
					`-------------------------\n`;

				player.sendModalForm(
					"§a领取成功",
					successContent,
					"§a返回面板",
					"§c关闭",
					(pp, res2) => {
						if (res2 === true) showAdventureLevelPanel(pp);
					}
				);
			} else {
				const failContent = `-------------------------\n` +
					`§c奖励领取失败，请稍后重试！\n` +
					`-------------------------\n`;

				player.sendModalForm(
					"§c领取失败",
					failContent,
					"§a返回面板",
					"§c关闭",
					(pp, res2) => {
						if (res2 === true) showAdventureLevelPanel(pp);
					}
				);
			}
		}
	);
}

function showLevelRewardForm(player) {
	const xuid = player.xuid;
	const levelInfo = player.adventureLevelInfo;
	const rwRange = getPlayerRewardRange(xuid);
	const maxClaimLevel = Math.min(levelInfo.level, levelUpExp.length - 1);
	const availableLevel = maxClaimLevel > rwRange.max ? maxClaimLevel : 0;

	if (availableLevel === 0) {
		showNoRewardForm(player, levelInfo, rwRange);
		return;
	}

	const oldTotalExp = getTotalExpByLevel(rwRange.max);
	const newTotalExp = getTotalExpByLevel(availableLevel);
	const rewardExp = newTotalExp - oldTotalExp;

	showRewardClaimForm(player, xuid, rewardExp, availableLevel, rwRange);
}

// 8. UID搜索与列表功能
function showUidSearchInputForm(player) {
	const inputForm = mc.newCustomForm();
	inputForm.setTitle("UID搜索");
	inputForm.addInput("请输入要查询的UID", "例如：10000", "");

	player.sendForm(inputForm, (p, inputData) => {
		if (inputData === null) return;
		const inputUidStr = inputData[0];
		const targetUid = parseInt(inputUidStr);
		if (isNaN(targetUid) || inputUidStr.trim() === "") {
			p.tell("§c请输入有效的数字UID！", 1);
			return;
		}
		showUidSearchResultForm(p, targetUid);
	});
}

function showUidSearchResultForm(player, targetUid) {
	const playerInfo = findPlayerByUid(targetUid);
	let formTitle, formContent;

	if (playerInfo) {
		formTitle = "§a搜索结果";
		formContent =
			`§aUID: ${playerInfo.uid}\n` +
			`§a玩家名: §f${playerInfo.name || "未知"}\n` +
			`§a冒险等级: §f${playerInfo.adventureLevel || 1}级\n` +
			`§a注册时间: §f${playerInfo.registerTime || "未知"}\n`;
	} else {
		formTitle = "§c搜索结果";
		formContent = `§c未找到 UID: ${targetUid} 的玩家信息`;
	}

	player.sendModalForm(
		formTitle,
		formContent,
		"§a返回搜索",
		"§c关闭",
		(_, res) => {
			if (res === true) showUidSearchInputForm(player);
		}
	);
}

function showUidListForm(player, currentPage = 1) {
	const allPlayers = getAllPlayersSorted();
	const pageSize = 20;
	const totalPlayers = allPlayers.length;
	const totalPages = Math.max(1, Math.ceil(totalPlayers / pageSize));
	currentPage = Math.min(Math.max(currentPage, 1), totalPages);

	const listForm = mc.newSimpleForm();
	listForm.setTitle(`UID列表 第 ${currentPage}/${totalPages} 页`);

	let formContent = "§a玩家UID列表\n-------------------------\n";
	const startIndex = (currentPage - 1) * pageSize;
	const endIndex = Math.min(startIndex + pageSize, totalPlayers);
	const currentPagePlayers = allPlayers.slice(startIndex, endIndex);

	currentPagePlayers.forEach(item => {
		const exp = getPlayerExpByXuid(item.xuid || "");
		const levelInfo = calculateAdventureLevel(exp);
		formContent +=
			`§a玩家: §f${item.name || "未知"}\n` +
			`§eUID: ${item.uid || "未分配"}\n` +
			`§b注册时间: §f${item.registerTime || "未知"}\n\n`;
	});

	listForm.setContent(formContent);
	let buttonIndexMap = {
		prev: -1,
		close: -1,
		next: -1
	};

	if (currentPage > 1) {
		listForm.addButton("上一页", "textures/ui/arrow_left");
		buttonIndexMap.prev = 0;
	}
	listForm.addButton("关闭", "textures/ui/cancel");
	buttonIndexMap.close = currentPage > 1 ? 1 : 0;
	if (currentPage < totalPages) {
		listForm.addButton("下一页", "textures/ui/arrow_right");
		buttonIndexMap.next = currentPage > 1 ? 2 : 1;
	}

	player.sendForm(listForm, (p, buttonIndex) => {
		if (buttonIndex === null) return;
		if (buttonIndex === buttonIndexMap.prev) showUidListForm(p, currentPage - 1);
		if (buttonIndex === buttonIndexMap.next) showUidListForm(p, currentPage + 1);
	});
}

/**
 * 物品使用事件处理 - 钟菜单功能
 * @param {Player} pl 玩家对象
 * @param {Item} it 物品对象
 * @param {*} _bl 方块
 * @param {*} _side 面
 * @param {*} _pos 位置
 */
var _clockThrottle = {};

mc.listen("onUseItemOn", function(pl, it, bl, side) {
	if (!pl || !pl.xuid) return;
	if (it.type !== "minecraft:clock") return;
	var now = Date.now();
	var xuid = pl.xuid;
	if (_clockThrottle[xuid] && now - _clockThrottle[xuid] < 800) return;
	_clockThrottle[xuid] = now;
	openMainMenu(pl);
});

function openMainMenu(player) {
	var xuid = player.xuid;
	var bal = money ? money.get(xuid) || 0 : 0;
	var fm = mc.newSimpleForm();
	fm.setTitle("§e Citlalia ");
	fm.setContent("§f" + player.name + " §7| §e" + bal + " " + getCurrencyName());
	var avatarUrl = getPlayerAvatarUrl(xuid);
	fm.addButton("§9个人中心", avatarUrl);
	var hasMessageBoard = config.get("enableMessageBoard");
	if (hasMessageBoard) {
		fm.addButton("§b留言板", "textures/ui/comment");
	}
	if (teleportModule.tpsConfig().enabled) {
		fm.addButton("§a传送系统", "textures/ui/icon_multiplayer");
	}
	player.sendForm(fm, function(p, idx) {
		if (idx === null) return;
		if (idx === 0) showPersonalCenterForm(p);
		else if (idx === 1 && hasMessageBoard) messageBoardModule.showMainForm(p);
		else if ((idx === 2 && hasMessageBoard) || (idx === 1 && !hasMessageBoard)) teleportModule.showTpgMainMenu(p, commonDeps);
	});
}

function showPersonalCenterForm(player) {
	const playerXUID = player.xuid;
	const playerInfo = playerData.players[playerXUID] || {};
	const levelInfo = player.adventureLevelInfo;
	const playerMoney = money ? money.get(playerXUID) || 0 : 0;

	const centerForm = mc.newSimpleForm();
	centerForm.setTitle("§a个人中心");
	centerForm.setContent(
		`§a玩家名称：${player.name}\n` +
		`§a现金：§e${playerMoney} 点§c${getCurrencyName()}§r\n` +
		`-------------------------\n` +
		`§a选择功能操作`
	);

	// 获取玩家头像
	const avatarUrl = getPlayerAvatarUrl(playerXUID);

	// 获取未读消息数量
	const unreadMsgCount = friendModule.getUnreadMessageCount(playerXUID);

	const unreadMailCount = mailModule.getUnreadMailCount(playerXUID);

	centerForm.addButton("§a个人信息", avatarUrl);
	centerForm.addButton("§b我的好友", "textures/ui/FriendsIcon");
	centerForm.addButton(`§e我的消息 ${unreadMsgCount > 0 ? "§c(" + unreadMsgCount + ")" : ""}`, "textures/ui/Feedback");
	centerForm.addButton(`§d邮件系统 ${unreadMailCount > 0 ? "§c(" + unreadMailCount + ")" : ""}`, "textures/ui/Envelope");
	centerForm.addButton("§a冒险等级", "textures/ui/achievements_pause_menu_icon");
	centerForm.addButton("§6数据统计", "textures/ui/copy");
	centerForm.addButton("§c属性提升", "textures/ui/jump_boost_effect");
	centerForm.addButton("§6个人偏好设置", "textures/ui/color_picker");
	centerForm.addButton("§e个人头像设置", "textures/ui/dressing_room_customization");
	centerForm.addButton("§c返回主菜单", "textures/ui/recap_glyph_desaturated");

	player.sendForm(centerForm, (p, buttonIndex) => {
		if (buttonIndex === null) return;
		if (buttonIndex === 0) showPersonalInfoForm(p);
		if (buttonIndex === 1) friendModule.showMyFriendsForm(p);
		if (buttonIndex === 2) friendModule.showMyMessagesForm(p);
		if (buttonIndex === 3) mailModule.showMailSystemForm(p);
		if (buttonIndex === 4) showAdventureLevelPanel(p);
		if (buttonIndex === 5) showDataStatisticsForm(p);
		if (buttonIndex === 6) wishModule.showAttributeUpgradeForm(p);
		if (buttonIndex === 7) showPlayerSettingsForm(p);
		if (buttonIndex === 8) showAvatarSettingsForm(p);
		if (buttonIndex === 9) openMainMenu(p);
	});
}

function showPersonalInfoForm(player) {
	const playerXUID = player.xuid;
	const playerInfo = playerData.players[playerXUID] || {};
	const levelInfo = player.adventureLevelInfo;
	const avatarUrl = getPlayerAvatarUrl(playerXUID);

	const infoForm = mc.newSimpleForm();
	infoForm.setTitle("§a个人信息");

	let content = `-------------------------\n`;
	content += `§a玩家名：§f${player.name}\n`;
	content += `§aUID：§f${player.uid}\n`;
	content += `§a冒险等级：§f${levelInfo.level}级\n`;
	content += `§a注册时间：§f${playerInfo.registerTime || "未知"}\n`;
	content += `-------------------------\n`;

	infoForm.setContent(content);
	infoForm.addButton("§c返回个人中心", "textures/ui/recap_glyph_desaturated");

	player.sendForm(infoForm, (p, buttonIndex) => {
		if (buttonIndex === null) return;
		if (buttonIndex === 0) showPersonalCenterForm(p);
	});
}

function showDataStatisticsForm(player) {
	const playerXUID = player.xuid;
	const pCount = (playerData.players[playerXUID] && playerData.players[playerXUID].count) || {};
	const levelInfo = player.adventureLevelInfo;
	const playerMoney = money ? money.get(playerXUID) || 0 : 0;

	const statsForm = mc.newSimpleForm();
	statsForm.setTitle("§6数据统计");

	let content = `-------------------------\n`;
	content += `§a玩家名：§f${player.name}\n`;
	content += `§aUID：§f${player.uid}\n`;
	content += `§a冒险等级：§f${levelInfo.level}级\n`;
	content += `§a累计经验：§f${levelInfo.totalExp}点\n`;
	content += `§a现金：§e${playerMoney} 点§c${getCurrencyName()}§r\n`;
	content += `§a游玩时长：§f${U.formatTime(pCount.playTime || 0)}\n`;
	content += `§a挖掘方块：§f${pCount.mining || 0}个\n`;
	content += `§a放置方块：§f${pCount.placing || 0}个\n`;
	content += `§a击杀玩家：§f${pCount.kills || 0}次\n`;
	content += `§a死亡次数：§f${pCount.deaths || 0}次\n`;
	content += `-------------------------\n`;

	statsForm.setContent(content);
	statsForm.addButton("§c返回个人中心", "textures/ui/recap_glyph_desaturated");

	player.sendForm(statsForm, (p, buttonIndex) => {
		if (buttonIndex === null) return;
		if (buttonIndex === 0) showPersonalCenterForm(p);
	});
}

function showNetworkInfoForm(player) {
	const playerXUID = player.xuid;
	const playerInfo = playerData.players[playerXUID] || {};
	const device = player.getDevice();

	var ip = (device && device.ip) ? U.stripIpPort(device.ip) : "未知";
	var networkType = U.getNetworkType(ip);
	var avgPing = (device && device.avgPing !== undefined) ? device.avgPing : "N/A";
	var avgPacketLoss = (device && device.avgPacketLoss !== undefined) ? (device.avgPacketLoss * 100).toFixed(1) + "%" : "N/A";
	var os = (device && device.os) ? device.os : "未知";
	if (os === "Win32") os = "GDK";

	var networkTypeColor = "§f";
	if (networkType === "中续转发") networkTypeColor = "§e";
	else if (networkType === "内网连接") networkTypeColor = "§b";
	else if (networkType === "公网IPv4") networkTypeColor = "§a";
	else if (networkType === "公网IPv6") networkTypeColor = "§d";

	var pingColor = "§a";
	if (typeof avgPing === "number") {
		if (avgPing > 200) pingColor = "§c";
		else if (avgPing > 95) pingColor = "§6";
	}

	var packetLossColor = "§a";
	if (typeof avgPacketLoss === "string" && avgPacketLoss !== "N/A") {
		var lossVal = parseFloat(avgPacketLoss);
		if (lossVal > 5) packetLossColor = "§c";
		else if (lossVal > 1) packetLossColor = "§6";
	}

	const gui = mc.newSimpleForm();
	gui.setTitle("§9网络信息");

	var content = "-------------------------\n";
	content += "§a玩家名称：§f" + player.name + "\n";
	content += "§aUID：§f" + (playerInfo.uid || "未知") + "\n";
	content += "§aIP地址：§f" + ip + "\n";
	content += "§a网络类型：§f" + networkTypeColor + networkType + "\n";
	content += "§a平均延迟：§f" + pingColor + avgPing + "ms\n";
	content += "§a平均丢包率：§f" + packetLossColor + avgPacketLoss + "%%\n";
	content += "§a设备系统：§f" + os + "\n";
	content += "-------------------------\n";

	if (player.permLevel !== 0) {
		var onlinePlayers = mc.getOnlinePlayers();
		var otherPlayers = onlinePlayers.filter(function(p) { return p.xuid !== playerXUID; });
		if (otherPlayers.length > 0) {
			content += "\n§6§l在线玩家IP列表：\n";
			content += "-------------------------\n";
			otherPlayers.forEach(function(p) {
				var pDevice = p.getDevice();
				var pIp = (pDevice && pDevice.ip) ? U.stripIpPort(pDevice.ip) : "未知";
				var pType = U.getNetworkType(pIp);
				var pPing = (pDevice && pDevice.avgPing !== undefined) ? pDevice.avgPing + "ms" : "N/A";
				content += "§b" + p.name + " §f- §7" + pIp + " §f(" + pType + " §a" + pPing + "§f)\n";
			});
			content += "-------------------------\n";
		}
	}

	gui.setContent(content);
	gui.addButton("§c关闭", "textures/ui/cancel");

	player.sendForm(gui, function(p, id) {
		if (id === null) return;
	});
}

// 根据XUID获取玩家信息
function getPlayerInfoByXuid(xuid) {
	return playerData.players[xuid] || null;
}

var PLAYER_SETTINGS_SCHEMA = C.PLAYER_SETTINGS_SCHEMA;

function showPlayerSettingsForm(player) {
	var xuid = player.xuid;
	var settingsForm = mc.newCustomForm();
	settingsForm.setTitle("§6个人设置");
	var switchIndices = [];
	var dataIdx = 0;
	for (var i = 0; i < PLAYER_SETTINGS_SCHEMA.length; i++) {
		var item = PLAYER_SETTINGS_SCHEMA[i];
		if (item.type === 'label') {
			settingsForm.addLabel(item.text);
			dataIdx++;
		} else {
			settingsForm.addSwitch(item.label, getPlayerSetting(xuid, item.key));
			switchIndices.push({
				idx: dataIdx,
				key: item.key,
				label: item.label
			});
			dataIdx++;
		}
	}
	player.sendForm(settingsForm, function(p, data) {
		if (data === null || data === undefined) {
			showPersonalCenterForm(p);
			return;
		}
		if (!Array.isArray(data)) {
			showPlayerSettingsForm(p);
			return;
		}
		var changed = false;
		for (var j = 0; j < switchIndices.length; j++) {
			var si = switchIndices[j];
			var newVal = Boolean(data[si.idx]);
			var oldVal = getPlayerSetting(xuid, si.key);
			if (newVal !== oldVal) {
				setPlayerSetting(xuid, si.key, newVal);
				p.tell("§a" + si.label.replace(/§./g, '') + "已" + (newVal ? "开启" : "关闭") + "！");
				changed = true;
			}
		}
		if (changed) {
			p.sendModalForm("§a设置修改成功", "§a您的个人设置已成功修改！\n\n请选择操作：", "§a返回个人中心", "§c关闭", function(pl, result) {
				if (result) showPersonalCenterForm(pl);
			});
		} else {
			showPersonalCenterForm(p);
		}
	});
	logger.info("玩家 " + player.name + " 打开个人设置菜单");
}


function showRankMainForm(player) {
	commonDeps.rankModule.showRankMainForm(player);
}

function showRankDetailForm(player, type, page) {
	commonDeps.rankModule.showRankDetailForm(player, type, page);
}

function showCdkRedeemForm(player) {
	commonDeps.cdkModule.showCdkRedeemForm(player);
}

function redeemCdk(player, code) {
	commonDeps.cdkModule.redeemCdk(player, code);
}

// 转账系统


var _currencyNameCache = null;
function getCurrencyName() {
	if (_currencyNameCache !== null) return _currencyNameCache;
	_currencyNameCache = config.get("currencyName") || "星茜";
	return _currencyNameCache;
}

function notifyEconomyChange(player, amount, source) {
	try {
		var sign = amount >= 0 ? "+" : "";
		var line1 = sign + amount + getCurrencyName();
		var line2 = source || "其他";
		player.sendToast(line2, line1);
	} catch (e) {}
}

function getPlayerMoney(player) {
	try {
		if (typeof money === 'undefined' || money === null) {
			logger.error('money对象不存在，无法获取玩家货币！');
			return 0;
		}
		if (typeof money.get !== 'function') {
			logger.error('money对象没有get方法，无法获取玩家货币！');
			return 0;
		}

		const xuid = player.xuid;

		if (!xuid) {
			logger.error('玩家XUID不存在，无法获取货币！');
			return 0;
		}

		const balance = money.get(xuid);
		if (typeof balance !== 'number' || isNaN(balance)) {
			logger.info('玩家 ' + player.name + ' (' + xuid + ') 余额为NaN或不是数字，返回0');
			return 0;
		}

		return balance;
	} catch (error) {
		logger.error('获取玩家货币时发生错误：' + error.message);
		if (error.stack) {
			logger.error('错误堆栈：' + error.stack);
		}
		return 0;
	}
}

function reducePlayerMoney(player, value, source) {
	try {
		if (typeof money === 'undefined' || money === null) {
			logger.error('money对象不存在，无法减少玩家货币！');
			return false;
		}
		if (typeof money.reduce !== 'function') {
			logger.error('money对象没有reduce方法，无法减少玩家货币！');
			return false;
		}

		const intValue = Math.floor(Number(value));
		const xuid = player.xuid;

		if (!xuid) {
			logger.error('玩家XUID不存在，无法减少货币！');
			return false;
		}

		if (typeof money.get !== 'function') {
			logger.error('money对象没有get方法，无法获取玩家余额！');
			return false;
		}

		const beforeMoney = money.get(xuid) || 0;
		logger.info('尝试减少玩家 ' + player.name + ' (' + xuid + ') 货币：' + beforeMoney + ' - ' + intValue);

		const success = money.reduce(xuid, intValue);
		logger.info('money.reduce调用结果：' + success);

		const afterMoney = money.get(xuid) || 0;
		logger.info('减少货币后余额：' + afterMoney);

		if (success) {
			notifyEconomyChange(player, -intValue, source || "系统扣费");
			return true;
		} else {
			logger.error('减少玩家 ' + player.name + ' 货币失败！');
			return false;
		}
	} catch (error) {
		logger.error('减少玩家货币时发生错误：' + error.message);
		if (error.stack) {
			logger.error('错误堆栈：' + error.stack);
		}
		return false;
	}
}

function addPlayerMoney(player, value, source) {
	try {
		if (typeof money === 'undefined' || money === null) {
			logger.error('money对象不存在，无法增加玩家货币！');
			return false;
		}
		if (typeof money.add !== 'function') {
			logger.error('money对象没有add方法，无法增加玩家货币！');
			return false;
		}

		const intValue = Math.floor(Number(value));
		const xuid = player.xuid;

		if (!xuid) {
			logger.error('玩家XUID不存在，无法增加货币！');
			return false;
		}

		logger.info('尝试增加玩家 ' + player.name + ' (' + xuid + ') 货币：' + intValue);

		const success = money.add(xuid, intValue);
		logger.info('money.add调用结果：' + success);

		if (success) {
			notifyEconomyChange(player, intValue, source || "系统收入");
			return true;
		} else {
			logger.error('增加玩家 ' + player.name + ' 货币失败！');
			return false;
		}
	} catch (error) {
		logger.error('增加玩家货币时发生错误：' + error.message);
		if (error.stack) {
			logger.error('错误堆栈：' + error.stack);
		}
		return false;
	}
}

function getPlayerMoneyByXuid(xuid) {
	try {
		if (typeof money === 'undefined' || money === null) return 0;
		if (typeof money.get !== 'function') return 0;
		if (!xuid) return 0;
		var balance = money.get(xuid);
		if (typeof balance !== 'number' || isNaN(balance)) return 0;
		return balance;
	} catch (e) {
		return 0;
	}
}

function addPlayerMoneyByXuid(xuid, value, source) {
	try {
		if (typeof money === 'undefined' || money === null) return false;
		if (typeof money.add !== 'function') return false;
		if (!xuid) return false;
		var intValue = Math.floor(Number(value));
		var success = money.add(xuid, intValue);
		if (success) {
			var player = mc.getPlayer(xuid);
			if (player) {
				notifyEconomyChange(player, intValue, source || "系统收入");
			}
		}
		return success;
	} catch (e) {
		return false;
	}
}

function giveItem(player, itemData, count) {
	var id = typeof itemData === 'string' ? itemData : itemData.id;
	var aux = typeof itemData === 'string' ? 0 : (itemData.aux || 0);
	var testItem = mc.newItem(id, 1);
	testItem.setAux(aux);
	if (testItem.isStackable) {
		var remaining = count;
		while (remaining > 0) {
			var stackSize = Math.min(remaining, 64);
			var item = mc.newItem(id, stackSize);
			item.setAux(aux);
			player.giveItem(item);
			remaining -= stackSize;
		}
	} else {
		for (var i = 0; i < count; i++) {
			var item = mc.newItem(id, 1);
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

function showVipMenu(player) {
	commonDeps.vipModule.showVipMenu(player);
}

function showVipPurchaseForm(player) {
	commonDeps.vipModule.showVipPurchaseForm(player);
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
		var elapsed = tpsData['tps_Time_end'] - tpsData['tps_Time_start'];
		var tpsValue = 20000 / elapsed;
		tpsData['tps'] = tpsValue >= 20 ? '20.00' : tpsValue.toFixed(2);
		tpsData['tps_Count'] = null;
	}
});

mc.listen("onServerStarted", () => {
	initAllConfigs();
	registerAllCommands();
	banModule.registerConsoleCommands();
	banModule.registerGameCommands();
	initCitlaliaFeatures();
	initUidDisplay();
	initQuickMenuSystem();
	registerWebCommands();
	initWebServer();
	initBehaviorLog();
	chatLog.init();

	setInterval(function() { mailModule.checkScheduledMails(); }, 30000);

	var mem = process.memoryUsage();
	logger.info('[NLCE] 内存使用 - 堆已用: ' + (mem.heapUsed / 1024 / 1024).toFixed(2) + 'MB, 堆总量: ' + (mem.heapTotal / 1024 / 1024).toFixed(2) + 'MB, RSS: ' + (mem.rss / 1024 / 1024).toFixed(2) + 'MB');
});

mc.listen("onPreJoin", function(pl) {
	var ip = pl.getDevice ? pl.getDevice().ip : '';
	var banCheck = banModule.isPlayerBanned(pl.xuid, ip);
	if (banCheck.banned) {
		pl.kick('§c你已被封禁\n§e原因：' + banCheck.reason);
		return false;
	}
});

// 聊天事件监听
mc.listen("onChat", function(pl, msg) {
	webServer.addChatMessage(pl.name, msg, 'player');
	chatLog.writeMessage({ time: Date.now(), sender: pl.name, message: msg, type: 'player' });

	if (!chatCfg.enabled) return true;

	if (isBadWord(msg)) {
		pl.sendToast('§e消息拦截', '§f发送内容包含违规词语，已被系统过滤');
		return false;
	}

	mc.broadcast(buildChatOutput(pl, msg));
	return false;
});

function initBehaviorLog() {
	behaviorLog.init();

	function safePlayerPos(pl) {
		try {
			if (!pl) return null;
			var pos = pl.pos;
			if (!pos || typeof pos.x !== 'number') return null;
			return pos;
		} catch(e) {
			return null;
		}
	}

	function safeBlockPos(bl) {
		try {
			if (!bl) return null;
			var pos = bl.pos;
			if (!pos || typeof pos.x !== 'number') return null;
			return pos;
		} catch(e) {
			return null;
		}
	}

	function fmtCoord(pos) {
		if (!pos) return { sx: '', sy: '', sz: '' };
		return { sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0) };
	}

	mc.listen("onPreJoin", function(pl) {
		try {
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onPreJoin'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: '', tx: '', ty: '', tz: '', detail: 'xuid=' + pl.xuid });
		} catch(e) {}
	});

	mc.listen("onJoin", function(pl) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onJoin'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: '', tx: '', ty: '', tz: '', detail: 'xuid=' + pl.xuid });
		} catch(e) {}
	});

	mc.listen("onLeft", function(pl) {
		try {
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onLeft'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: '', tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onPlayerDie", function(pl) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onPlayerDie'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: '', tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onPlayerCmd", function(pl, cmd) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onPlayerCmd'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: cmd, tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onChat", function(pl, msg) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onChat'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: msg, tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onUseItem", function(pl, it) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onUseItem'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: it.name, tx: '', ty: '', tz: '', detail: '类型:' + it.type });
		} catch(e) {}
	});

	mc.listen("onUseItemOn", function(pl, it, bl) {
		try {
			var pos = safePlayerPos(pl);
			var blPos = safeBlockPos(bl);
			if (!pos) return;
			var c = fmtCoord(pos);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onUseItemOn'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '使用物品:' + it.name + ' 类型:' + it.type });
		} catch(e) {}
	});

	mc.listen("onTakeItem", function(pl, en, it) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onTakeItem'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: it.name, tx: '', ty: '', tz: '', detail: '数量:' + it.count });
		} catch(e) {}
	});

	mc.listen("onDropItem", function(pl, it) {
		try {
			var pos = safePlayerPos(pl);
			if (!pos) return;
			var c = fmtCoord(pos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onDropItem'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: it.name, tx: '', ty: '', tz: '', detail: '数量:' + it.count });
		} catch(e) {}
	});

	mc.listen("onStartDestroyBlock", function(pl, bl) {
		try {
			var pos = safePlayerPos(pl);
			var blPos = safeBlockPos(bl);
			if (!pos) return;
			var c = fmtCoord(pos);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onStartDestroyBlock'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
		} catch(e) {}
	});

	mc.listen("onDestroyBlock", function(pl, bl) {
		try {
			var pos = safePlayerPos(pl);
			var blPos = safeBlockPos(bl);
			if (!pos) return;
			var c = fmtCoord(pos);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onDestroyBlock'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
		} catch(e) {}
	});

	mc.listen("onPlaceBlock", function(pl, bl) {
		try {
			var pos = safePlayerPos(pl);
			var blPos = safeBlockPos(bl);
			if (!pos) return;
			var c = fmtCoord(pos);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onPlaceBlock'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
		} catch(e) {}
	});

	mc.listen("onOpenContainer", function(pl, bl) {
		try {
			var pos = safePlayerPos(pl);
			var blPos = safeBlockPos(bl);
			if (!pos) return;
			var c = fmtCoord(pos);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onOpenContainer'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
		} catch(e) {}
	});

	mc.listen("onCloseContainer", function(pl, bl) {
		try {
			var pos = safePlayerPos(pl);
			var blPos = safeBlockPos(bl);
			if (!pos) return;
			var c = fmtCoord(pos);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onCloseContainer'), dim: String(pos.dim), source: pl.realName, sx: c.sx, sy: c.sy, sz: c.sz, target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
		} catch(e) {}
	});

	mc.listen("onInventoryChange", function(pl, slotNum, oldItem, newItem) {
		try {
			if (oldItem && !newItem) {
				behaviorLog.appendEntry({ action: behaviorLog.labelOf('onInventoryOut'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: oldItem.name, tx: '', ty: '', tz: '', detail: '数量:' + oldItem.count + ' 槽位:' + slotNum });
			} else if (!oldItem && newItem) {
				behaviorLog.appendEntry({ action: behaviorLog.labelOf('onInventoryIn'), dim: '', source: pl.realName, sx: '', sy: '', sz: '', target: newItem.name, tx: '', ty: '', tz: '', detail: '数量:' + newItem.count + ' 槽位:' + slotNum });
			}
		} catch(e) {}
	});

	mc.listen("onContainerChange", function(bl, slotNum, oldItem, newItem) {
		try {
			var blPos = safeBlockPos(bl);
			var bc = fmtCoord(blPos);
			if (oldItem && !newItem) {
				behaviorLog.appendEntry({ action: behaviorLog.labelOf('onContainerOut'), dim: blPos ? String(blPos.dim) : '', source: '', sx: '', sy: '', sz: '', target: oldItem.name, tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '数量:' + oldItem.count + ' 槽位:' + slotNum });
			} else if (!oldItem && newItem) {
				behaviorLog.appendEntry({ action: behaviorLog.labelOf('onContainerIn'), dim: blPos ? String(blPos.dim) : '', source: '', sx: '', sy: '', sz: '', target: newItem.name, tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '数量:' + newItem.count + ' 槽位:' + slotNum });
			}
		} catch(e) {}
	});

	mc.listen("onExplode", function(source, pos) {
		try {
			if (!pos) return;
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onExplode'), dim: String(pos.dim), source: source || '', sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0), target: '', tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onBedExplode", function(pos) {
		try {
			if (!pos) return;
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onBedExplode'), dim: String(pos.dim), source: '', sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0), target: '', tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onRespawnAnchorExplode", function(pos) {
		try {
			if (!pos) return;
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onRespawnAnchorExplode'), dim: String(pos.dim), source: '', sx: pos.x.toFixed(0), sy: pos.y.toFixed(0), sz: pos.z.toFixed(0), target: '', tx: '', ty: '', tz: '', detail: '' });
		} catch(e) {}
	});

	mc.listen("onBlockExploded", function(bl, source) {
		try {
			var blPos = safeBlockPos(bl);
			var bc = fmtCoord(blPos);
			behaviorLog.appendEntry({ action: behaviorLog.labelOf('onBlockExploded'), dim: blPos ? String(blPos.dim) : '', source: source || '', sx: '', sy: '', sz: '', target: bl ? bl.name : '', tx: bc.sx, ty: bc.sy, tz: bc.sz, detail: '' });
		} catch(e) {}
	});
}

// 命令注册
function registerPlayerCommand(name, desc, handler, configCheck, permission) {
	try {
		if (configCheck) {
			var enabled = (typeof configCheck === 'function') ? configCheck() : config.get(configCheck);
			if (!enabled) {
				logger.debug("[命令] /" + name + " 已跳过注册（功能已禁用）");
				return;
			}
		}
		var cmd = mc.newCommand(name, desc, permission || PermType.Any);
		cmd.overload([]);
		cmd.setCallback(function(_cmd, origin, output, _results) {
			var player = origin.player;
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
	var tpCfg = teleportModule.tpsConfig();
	var tpEnabled = function() { return teleportModule.tpsConfig().enabled; };
	var tpHomeEnabled = function() { var c = teleportModule.tpsConfig(); return c.enabled && c.enableHome; };
	var tpWarpEnabled = function() { var c = teleportModule.tpsConfig(); return c.enabled && c.enableWarp; };
	var tpTpaEnabled = function() { var c = teleportModule.tpsConfig(); return c.enabled && c.enableTpa; };
	var tpRtpEnabled = function() { var c = teleportModule.tpsConfig(); return c.enabled && c.enableRtp; };
	var commands = [
		["shop", "商店系统", function(p) { shopModule.showShopMainForm(p, commonDeps); }, "enableShop"],
		["rank", "排行榜", function(p) { showRankMainForm(p); }, "enableRank"],
		["cdk", "CDK兑换", function(p) { showCdkRedeemForm(p); }, "enableCdk"],
		["pay", "经济系统", function(p) { payModule.showMoneyMainForm(p, commonDeps); }],
		["mb", "打开留言板", function(p) { messageBoardModule.showMainForm(p); }, "enableMessageBoard"],
		["vip", "VIP系统", function(p) { showVipMenu(p); }, "enableVip"],
		["bank", "银行系统", function(p) { showBankMainForm(p); }, "enableBank"],
		["wish", "祈愿系统", function(p) { wishModule.showWishMainForm(p); }, "enableWish"],
		["recycle", "回收系统", function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); }, "enableRecycle"],
		["level", "等级奖励", function(p) { showLevelRewardForm(p); }, "enableLevel"],
		["xpshop", "经验商店", function(p) { shopModule.showXPBuyForm(p, commonDeps); }, "enableDustShop"],
		["dustshop", "星尘商店", function(p) { wishModule.showDustShopMainForm(p); }, "enableDustShop"],
		["enchantshop", "附魔书商店", function(p) { wishModule.showEnchantBookShopForm(p); }, "enableDustShop"],
		["settings", "个人设置", showPlayerSettingsForm],
		["back", "返回死亡点", function(p) { teleportModule.showDeathPointMenu(p); }, "enableBack"],
		["mail", "打开邮件系统", function(p) { mailModule.showMailSystemForm(p); }, "enableMail"],
		["rc", "打开批量回收界面", function(p) { shopModule.showRecycleForm(p, recycleConfig, commonDeps); }, "enableRecycle"],
		["friend", "打开好友系统", function(p) { friendModule.showMyFriendsForm(p); }, "enableFriend"],
		["network", "网络信息", showNetworkInfoForm],
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
	for (var i = 0; i < commands.length; i++) {
		var cmd = commands[i];
		registerPlayerCommand(cmd[0], cmd[1], cmd[2], cmd[3]);
	}
}

var BIOME_NAMES = C.BIOME_NAMES;

var SIDEBAR_SETTING_KEYS = C.SIDEBAR_SETTING_KEYS;

var _sidebarCache = {};
var _sidebarCacheTime = 0;
var SIDEBAR_CACHE_TTL = C.SIDEBAR_CACHE_TTL;
var _sidebarMoneyCache = {};
var _sidebarMoneyCacheTime = 0;
var SIDEBAR_MONEY_CACHE_TTL = C.SIDEBAR_MONEY_CACHE_TTL;

function initUidDisplay() {
	setInterval(() => {
		var onlinePlayers = mc.getOnlinePlayers();
		if (onlinePlayers.length === 0) return;
		var now = Date.now();
		if (now - _sidebarCacheTime > SIDEBAR_CACHE_TTL) {
			_sidebarCache = {};
			_sidebarCacheTime = now;
		}
		if (now - _sidebarMoneyCacheTime > SIDEBAR_MONEY_CACHE_TTL) {
			_sidebarMoneyCache = {};
			_sidebarMoneyCacheTime = now;
		}
		onlinePlayers.forEach(pl => {
			if (pl.isSimulatedPlayer()) return;
			var xuid = pl.xuid;

			var cached = _sidebarCache[xuid];
			if (!cached) {
				cached = {
					enableActionbar: getPlayerSetting(xuid, "enableActionbar"),
					sidebarSettings: {}
				};
				for (var k = 0; k < SIDEBAR_SETTING_KEYS.length; k++) {
					var key = SIDEBAR_SETTING_KEYS[k];
					cached.sidebarSettings[key] = getPlayerSetting(xuid, key);
				}
				_sidebarCache[xuid] = cached;
			}

			if (cached.enableActionbar) {
				var uidText;
				try {
					var uid = pl.uid;
					uidText = uid === "配置异常" ? "§c配置异常" :
						uid === "未注册" ? "§c未注册" : "" + uid;
				} catch (error) {
					uidText = "§c获取失败";
				}
				pl.setTitle("UID: " + uidText, 4);
			}

			var hasSidebar = false;
			var sidebarSettings = cached.sidebarSettings;
			for (var sk in sidebarSettings) {
				if (sidebarSettings[sk]) { hasSidebar = true; break; }
			}

			if (hasSidebar) {
				try {
					var sidebarData = {};
					var sidebarScore = 100;
					var compactLines = [];
					var isCompact = config.get("sidebarCompact");

					if (sidebarSettings.enableActionbarMoney) {
						if (_sidebarMoneyCache[xuid] === undefined) {
							_sidebarMoneyCache[xuid] = money.get(xuid) || 0;
						}
						var moneyLine = "§6§c" + getCurrencyName() + "§r: " + _sidebarMoneyCache[xuid];
						if (isCompact) { compactLines.push(moneyLine); } else { sidebarData[moneyLine] = sidebarScore--; }
					}

					if (sidebarSettings.enableActionbarPing) {
						var device = pl.getDevice();
						var pingLine;
						if (device && device.lastPing !== undefined && device.lastPing !== null) {
							var ping = device.lastPing;
							var pingColor = ping > 200 ? "§m" : ping > 95 ? "§6" : "§a";
							pingLine = "§6延迟: " + pingColor + ping + "ms";
						} else {
							pingLine = "§e延迟: N/A";
						}
						if (isCompact) { compactLines.push(pingLine); } else { sidebarData[pingLine] = sidebarScore--; }
					}

					if (sidebarSettings.enableActionbarTps) {
						var tps = parseFloat(tpsData['tps']);
						var tpsColor = tps <= 12 ? "§c" : tps <= 17 ? "§e" : "§a";
						var tpsLine = "§6TPS:" + tpsColor + tpsData['tps'];
						if (isCompact) { compactLines.push(tpsLine); } else { sidebarData[tpsLine] = sidebarScore--; }
					}

					if (sidebarSettings.enableActionbarSpeed) {
						var speedLine;
						try {
							var speed = pl.speed;
							if (speed !== undefined && speed !== null) {
								var speedColor = speed <= 10 ? "§a" : speed <= 20 ? "§b" : "§6";
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
						var biomeLine;
						try {
							var biome = pl.getBiomeName();
							if (biome !== undefined && biome !== null) {
								var biomeId = biome;
								if (biomeId.startsWith("minecraft:")) biomeId = biomeId.substring(10);
								var chineseBiomeName = BIOME_NAMES[biomeId] || biomeId;
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
						var timeNow = new Date();
						var h = timeNow.getHours();
						var m = timeNow.getMinutes();
						var s = timeNow.getSeconds();
						var timeLine = "§b时间: " + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
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


// Citlalia 功能整合

// 击杀特效配置
const KillEffectConfig = C.KillEffectConfig;

// 初始化 Citlalia 功能
function initCitlaliaFeatures() {
	// 击杀特效
	mc.listen('onPlayerDie', (player, source) => {
		try {
			if (source && source.isPlayer()) {
				const pos = {
					x: Math.floor(player.pos.x) + 0.5,
					y: Math.floor(player.pos.y),
					z: Math.floor(player.pos.z) + 0.5
				};
				mc.runcmdEx(`summon lightning_bolt ${pos.x} ${pos.y} ${pos.z}`);
				source.setFire(Number(0), Boolean(true));
				source.addEffect(
					Number(KillEffectConfig.RESISTANCE.id),
					Number(KillEffectConfig.RESISTANCE.baseDuration),
					Number(4),
					Boolean(false)
				);
				source.addEffect(
					Number(KillEffectConfig.FIRE_RESISTANCE.id),
					Number(KillEffectConfig.FIRE_RESISTANCE.duration),
					Number(0),
					Boolean(true)
				);
			}
		} catch (e) {
			logger.error(`[Citlalia] 击杀特效错误 => ${e.stack}`);
		}
	});

	// 健康值设置 - 默认40点，无配置文件，可通过星核提升
	const DEFAULT_MAX_HEALTH = 40;
	const DEFAULT_HEALTH = 40;
	const MAX_HEALTH_BONUS = 20;

	mc.listen("onJoin", function(player) {
		const xuid = player.xuid;
		const playerInfo = playerData.players[xuid] || {};
		const healthBonus = playerInfo.healthBonus || 0;

		const maxHealth = DEFAULT_MAX_HEALTH + healthBonus;
		player.setMaxHealth(maxHealth);
		player.setHealth(maxHealth);
		logger.info(`设置玩家 ${player.name} 生命值: Max=${maxHealth} (基础${DEFAULT_MAX_HEALTH} + 提升${healthBonus}), Current=${maxHealth}`);
	});

	// 图腾自动替换
	mc.listen('onConsumeTotem', (pl) => {
		if (!getPlayerSetting(pl.xuid, "enableTotemReplace")) {
			return;
		}
		let bag = pl.getInventory().getAllItems();
		for (const it of bag) {
			if (it.type === 'minecraft:totem_of_undying') {
				it.setNull();
				pl.refreshItems();
				return false;
			}
		}
	});

	// 逐月之痕效果管理
	const MOON_SW_EFFECTS = [1, 8, 10, 11, 16]; // 速度、跳跃增强、生命恢复、抗性、夜视
	const MOON_SW_ITEM = 'citlalia:moon_sw';
	const EFFECT_DURATION = 400; // 20秒
	const EFFECT_INTERVAL = 200; // 每10秒刷新一次效果（减少调用频率）

	// 记录手持逐月之痕的玩家 {xuid: {lastRefresh: timestamp}}
	const moonSwPlayers = new Map();
	let tickCounter = 0;

	// 每tick检查玩家手持物品（但效果刷新有间隔）
	mc.listen("onTick", () => {
		tickCounter++;
		const onlinePlayers = mc.getOnlinePlayers();
		const now = Date.now();

		onlinePlayers.forEach(player => {
			try {
				const xuid = player.xuid;
				const handItem = player.getHand();
				const isHoldingMoonSw = handItem && handItem.type === MOON_SW_ITEM;
				const swData = moonSwPlayers.get(xuid);

				if (isHoldingMoonSw) {
					if (!swData) {
						moonSwPlayers.set(xuid, {
							lastRefresh: now
						});
						MOON_SW_EFFECTS.forEach(effectId => {
							player.addEffect(effectId, EFFECT_DURATION, 0, false);
						});
					} else if (tickCounter % EFFECT_INTERVAL === 0) {
						swData.lastRefresh = now;
						MOON_SW_EFFECTS.forEach(effectId => {
							player.addEffect(effectId, EFFECT_DURATION, 0, false);
						});
					}
				} else {
					if (swData) {
						moonSwPlayers.delete(xuid);
						MOON_SW_EFFECTS.forEach(effectId => {
							player.removeEffect(effectId);
						});
					}
				}
			} catch (e) {
				// 静默处理错误
			}
		});

		// 重置计数器防止溢出
		if (tickCounter >= 1000000) tickCounter = 0;
	});

	// 玩家离开时清理记录
	mc.listen("onLeft", (player) => {
		moonSwPlayers.delete(player.xuid);
	});

}

// 聊天系统
var chatCfg = { enabled: true, format: "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§a<§r{name}§a> §r{msg}", wordFilter: true };
var badWordList = [];
var badWordRegex = null;
var orgNameResolver = null;

function loadChatConfig() {
	try {
		if (fs.existsSync(CHAT_CFG_PATH)) {
			var raw = fs.readFileSync(CHAT_CFG_PATH, 'utf-8');
			var parsed = raw ? JSON.parse(raw) : {};
			chatCfg = Object.assign(chatCfg, parsed);
			if (parsed.profanityFilter !== undefined && parsed.wordFilter === undefined) {
				chatCfg.wordFilter = parsed.profanityFilter;
				delete chatCfg.profanityFilter;
				fs.writeFileSync(CHAT_CFG_PATH, JSON.stringify(chatCfg, null, 4), 'utf-8');
			}
		} else {
			U.ensureDir(CHAT_CFG_PATH);
			fs.writeFileSync(CHAT_CFG_PATH, JSON.stringify(chatCfg, null, 4), 'utf-8');
		}
		if (fs.existsSync(BAD_WORDS_PATH)) {
			var bwRaw = fs.readFileSync(BAD_WORDS_PATH, 'utf-8');
			badWordList = (bwRaw ? JSON.parse(bwRaw) : []).filter(function(w) { return w && w.trim() !== ""; });
		} else {
			U.ensureDir(BAD_WORDS_PATH);
			fs.writeFileSync(BAD_WORDS_PATH, JSON.stringify(["", ""], null, 4), 'utf-8');
			badWordList = [];
		}
		rebuildBadWordRegex();
	} catch (e) {
		logger.error("[聊天] 配置加载失败: " + e.message);
	}
}

function rebuildBadWordRegex() {
	if (!badWordList || badWordList.length === 0) { badWordRegex = null; return; }
	var parts = badWordList.map(function(w) { return w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).filter(Boolean);
	badWordRegex = parts.length > 0 ? new RegExp(parts.join('|'), 'i') : null;
}

function resolveOrgName(xuid) {
	if (orgNameResolver === null) {
		orgNameResolver = ll.hasExported('orgEX', 'orgEX_getPlayerOrgName') ? ll.import('orgEX', 'orgEX_getPlayerOrgName') : false;
	}
	if (!orgNameResolver) return '§c无§r';
	try {
		var n = orgNameResolver(xuid);
		return (n && n.trim()) ? n : '§c无§r';
	} catch (e) { return '§c无§r'; }
}

function isBadWord(text) {
	if (!chatCfg.wordFilter || !badWordRegex) return false;
	return badWordRegex.test(text);
}

var CHAT_PLACEHOLDER_MAP = {
	dim: function(p) { return p.pos ? p.pos.dim : "未知"; },
	os: function(p) { var d = p.getDevice(); var o = d ? d.os : "未知"; return o === "Win32" ? "GDK" : o; },
	ping: function(p) { var d = p.getDevice(); return d ? d.avgPing : "N/A"; },
	org: function(p) { return resolveOrgName(p.xuid); },
	name: function(p) { return p.realName; }
};

function buildChatOutput(player, message) {
	var pattern = chatCfg.format || "§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§a<§r{name}§a> §r{msg}";
	return pattern.replace(/\{(\w+)\}/g, function(match, key) {
		if (key === 'msg') return message;
		var fn = CHAT_PLACEHOLDER_MAP[key];
		return fn ? fn(player) : '';
	});
}


function getPlayerAvatarData(xuid) {
	var p = playerData.players[xuid];
	if (!p) return { type: "default", value: "" };
	if (!p.avatar) {
		p.avatar = {
			type: "default",
			value: ""
		};
		savePlayerData();
	}
	return p.avatar;
}

// 获取玩家头像URL
function getPlayerAvatarUrl(xuid) {
	const avatar = getPlayerAvatarData(xuid);
	switch (avatar.type) {
		case "qq":
			return `http://q1.qlogo.cn/g?b=qq&nk=${avatar.value}&s=100`;
		case "link":
			return avatar.value;
		case "citlalia":
			return `https://citlalia.cn/img/${avatar.value}`;
		default:
			return "textures/ui/icon_steve";
	}
}

function setPlayerAvatar(xuid, type, value) {
	var p = playerData.players[xuid];
	if (!p) return;
	p.avatar = {
		type: type,
		value: value
	};
	savePlayerData();
}

// 显示头像设置菜单
function showAvatarSettingsForm(player) {
	const xuid = player.xuid;
	const avatar = getPlayerAvatarData(xuid);

	const gui = mc.newCustomForm();
	gui.setTitle("§l§e个人头像设置");

	let content = "-------------------------\n";
	content += `§a当前头像类型：§f${getAvatarTypeName(avatar.type)}\n`;
	content += `§a当前头像值：§f${avatar.value || "未设置"}\n`;
	content += "-------------------------\n";
	content += "§e请选择头像设置方式并输入对应值：\n";

	gui.addLabel(content);
	gui.addDropdown("头像类型", ["QQ头像", "自定义链接", "Citlalia头像码"],
		avatar.type === "qq" ? 0 : avatar.type === "link" ? 1 : avatar.type === "citlalia" ? 2 : 0);
	gui.addInput("头像值", "QQ号码/图片链接/头像码", avatar.value || "");

	player.sendForm(gui, (p, data) => {
		if (data === null || data === undefined || !Array.isArray(data)) {
			showPersonalCenterForm(p);
			return;
		}

		const typeIndex = data[1] !== undefined ? data[1] : 0;
		const value = data[2]?.trim();

		if (!value) {
			p.tell("§c请输入头像值！");
			showAvatarSettingsForm(p);
			return;
		}

		let type, successMsg;
		if (typeIndex === 0) {
			// QQ头像
			if (!/^\d+$/.test(value)) {
				p.tell("§c请输入有效的QQ号码（纯数字）！");
				showAvatarSettingsForm(p);
				return;
			}
			type = "qq";
			successMsg = `§aQQ头像设置成功！`;
		} else if (typeIndex === 1) {
			// 自定义链接
			if (!value.startsWith("http")) {
				p.tell("§c请输入有效的图片链接（以http开头）！");
				showAvatarSettingsForm(p);
				return;
			}
			type = "link";
			successMsg = `§a自定义链接头像设置成功！`;
		} else {
			// Citlalia头像码
			type = "citlalia";
			successMsg = `§aCitlalia头像码设置成功！`;
		}

		setPlayerAvatar(p.xuid, type, value);
		p.tell(successMsg);
		showPersonalCenterForm(p);
	});
}

// 获取头像类型名称
function getAvatarTypeName(type) {
	switch (type) {
		case "qq":
			return "QQ头像";
		case "link":
			return "自定义链接";
		case "citlalia":
			return "Citlalia头像码";
		default:
			return "默认头像";
	}
}

// QQ头像设置

function searchPlayers(keyword, searchType) {
	var results = [];
	var players = playerData.players;

	for (var xuid in players) {
		var info = players[xuid];
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
		var mailInfo = mailModule.getUnreadMailInfo(xuid);
		var unreadMailCount = mailInfo.count;
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

// 初始化快捷菜单配置
function initQuickMenuConfig() {
	quickMenuConfig = quickMenuConfigDM.load();
	var cn = getCurrencyName();
	if (cn !== '星茜') {
		(quickMenuConfig.buttons || []).forEach(function(btn) {
			if (btn.name) btn.name = btn.name.replace(/星茜/g, cn);
		});
	}
}

function getPlayerQuickMenu(xuid) {
	var p = playerData.players[xuid];
	if (!p) return { slots: [] };
	if (!p.quickmenu) {
		p.quickmenu = { slots: [] };
	}
	return p.quickmenu;
}

function setPlayerQuickMenu(xuid, slots) {
	var p = playerData.players[xuid];
	if (!p) return;
	if (!p.quickmenu) {
		p.quickmenu = { slots: [] };
	}
	p.quickmenu.slots = slots;
	savePlayerData();
}

// 显示快捷菜单
function showQuickMenu(player) {
	const xuid = player.xuid;
	const playerMenu = getPlayerQuickMenu(xuid);
	const gui = mc.newSimpleForm();
	gui.setTitle("§l§a快捷菜单");

	if (!playerMenu.slots || playerMenu.slots.length === 0) {
		gui.setContent("§e您还没有设置快捷菜单\n§a请点击下方按钮进行设置");
	} else {
		gui.setContent("§a点击按钮快速执行命令");
		// 显示已设置的快捷入口
		playerMenu.slots.forEach(slotIndex => {
			const item = quickMenuConfig.items[slotIndex];
			if (item) {
				gui.addButton(item.name, item.img);
			}
		});
	}

	// 添加修改快捷菜单按钮（第6个按钮）
	gui.addButton("§e§l修改快捷菜单", "textures/ui/icon_setting");

	player.sendForm(gui, (p, id) => {
		if (id === null || id === undefined) return;

		const slots = playerMenu.slots || [];
		if (id < slots.length) {
			// 执行快捷命令
			const slotIndex = slots[id];
			const item = quickMenuConfig.items[slotIndex];
			if (item) {
				p.runcmd(item.comm);
			}
		} else {
			// 点击修改快捷菜单
			showEditQuickMenu(p);
		}
	});
}

// 显示编辑快捷菜单
function showEditQuickMenu(player) {
	const xuid = player.xuid;
	const playerMenu = getPlayerQuickMenu(xuid);
	const currentSlots = playerMenu.slots || [];

	const gui = mc.newCustomForm();
	gui.setTitle("§l§e编辑快捷菜单");
	gui.addLabel("§a请选择最多5个快捷功能（重复选择会忽略）：");

	// 准备选项
	const options = quickMenuConfig.items.map((item, index) => `${item.name}`);
	options.unshift("§c不选择");

	// 添加5个下拉菜单
	for (let i = 0; i < 5; i++) {
		const defaultIndex = currentSlots[i] !== undefined ? currentSlots[i] + 1 : 0;
		gui.addDropdown(`快捷入口 ${i + 1}`, options, Math.min(defaultIndex, options.length - 1));
	}

	gui.addLabel("§e提示：选择后会覆盖之前的设置");

	player.sendForm(gui, (p, data) => {
		if (data === null || data === undefined) {
			showQuickMenu(p);
			return;
		}

		const newSlots = [];
		const selectedSet = new Set();

		// 解析选择（从索引1开始，因为0是"不选择"）
		for (let i = 1; i <= 5; i++) {
			const selectedIndex = data[i];
			if (selectedIndex > 0 && !selectedSet.has(selectedIndex)) {
				selectedSet.add(selectedIndex);
				newSlots.push(selectedIndex - 1); // 减1因为选项前面加了"不选择"
			}
		}

		// 保存设置
		setPlayerQuickMenu(p.xuid, newSlots);
		p.tell(`§a快捷菜单已更新！共设置 ${newSlots.length} 个快捷入口`);

		// 返回快捷菜单
		showQuickMenu(p);
	});
}

// 注册快捷菜单命令
function registerQuickMenuCommands() {
	registerPlayerCommand("qcd", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
	registerPlayerCommand("qmenu", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
}

// 初始化快捷菜单系统
function initQuickMenuSystem() {
	// 注册命令
	registerQuickMenuCommands();

	// 监听指南针右键
	const quickMenuCooldown = new Map(); // 冷却时间记录

	mc.listen("onUseItemOn", (player, item) => {
		if (item && item.type === "minecraft:compass") {
			const xuid = player.xuid;
			const now = Date.now();
			const lastUse = quickMenuCooldown.get(xuid) || 0;

			// 1秒冷却时间，防止重复触发
			if (now - lastUse < 1000) {
				return false;
			}

			quickMenuCooldown.set(xuid, now);
			showQuickMenu(player);
			return false; // 阻止默认行为
		}
	});

	// 玩家离开时清理冷却记录
	mc.listen("onLeft", (player) => {
		quickMenuCooldown.delete(player.xuid);
	});
}

// ============================== NPC攻击响应系统 ==============================

function initNarConfig() {
	narConfig = narConfigDM.load();
	if (!narConfig.npc_actions) narConfig.npc_actions = {};
}

mc.listen("onAttackEntity", function(player, entity) {
	try {
		var entityType = entity.type;
		var entityName = U.cleanFormatting(entity.name);

		var actions = narConfig.npc_actions;
		if (actions && actions[entityType]) {
			for (var i = 0; i < actions[entityType].length; i++) {
				var action = actions[entityType][i];
				if (U.cleanFormatting(action.name) === entityName) {
					var cmd = action.command.replace(/@s/g, player.name);

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
	var webConfig = config.get('web');
	if (!webConfig || typeof webConfig === 'string') {
		webConfig = {};
	}
	if (!webConfig.enabled) {
		logger.info('[Web] Web服务器已在配置中禁用');
		return;
	}
	database.initDatabase().then(function() {
		logger.info('[Web] 数据库初始化完成');
		var serverStats = require('./core/serverStats');
		serverStats.init(tpsData, money, playerDataDM);
		var messageBoardApi = require('./core/messageBoardApi');
		messageBoardApi.init(messageBoardDM);
		messageBoardModule.onSave(function() { messageBoardApi.invalidateCache(); });
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
		var passwdCmd = mc.newCommand('passwd', '设置或修改Web登录密码', PermType.Any);
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
			var parts = String(results.args).trim().split(/\s+/);
			if (parts.length < 2) {
				output.error('用法: passwd <uid> <密码>');
				return;
			}
			var uid = parts[0];
			var pwd = parts[1];
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
			var action = args[0];
			var uid = args[1];
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
		var backupCmd = mc.newCommand('backup', '手动执行世界备份', PermType.GameMasters);
		backupCmd.overload([]);
		backupCmd.setCallback(function(_cmd, origin, output, _results) {
			var player = origin.player;
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
	var xuid = player.xuid;
	var hasPwd = database.hasPassword(xuid);

	var fm = mc.newSimpleForm();
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
	var fm = mc.newCustomForm();
	fm.setTitle('§l§9设置Web密码');
	fm.addInput('输入密码', '请输入密码（至少6位）', '');
	fm.addInput('确认密码', '请再次输入密码', '');

	player.sendForm(fm, function(player, data) {
		if (data === null) return;
		var pwd1 = data[0] || '';
		var pwd2 = data[1] || '';

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

colorLog("yellow",    " _   _   _         _____   ______ ",
colorLog("yellow",    "| \\ | | | |       / ____| |  ____|",
colorLog("yellow",    "|  \\| | | |      | |      | |__   ",
colorLog("yellow",    "| . ` | | |      | |      |  __|  ",
colorLog("yellow",    "| |\\  | | |____  | |____  | |____ ",
colorLog("yellow",    "|_| \\_| |______|  \\_____| |______|"
);

logger.info("");
logger.info(`       NLCE 1.9.9 (${DESIGNATION_NAME})`);
logger.info("");