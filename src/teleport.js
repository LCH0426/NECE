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
 * NECE 传送系统
 * 家园、公共地标、互传请求、死亡点返回
 */

const D = require('./debug');

var _t = null;
var _getLang = null;

function getLang() {
    return _getLang ? _getLang() : 'zh_CN';
}

function t(key) {
    if (!_t) return key;
    var lang = getLang();
    var args = [lang];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    return _t.apply(null, args);
}

// 待处理的TPA请求，key为 requestId，value为请求详情对象
const teleportPendingRequests = {};

// 传送冷却记录，key为 xuid_type，value为冷却截止时间戳
const teleportCooldowns = {};

let _deps = {};
// RTP 摔伤保护：记录刚RTP的玩家，60秒内取消掉落伤害
var _rtpProtected = {};
// 家园脏标记
var _dirtyHomes = {};
// 死亡点脏标记
var _dirtyDeathPoints = {};

/** 注册RTP摔伤保护事件 */
function registerRtpProtection() {
    mc.listen('onMobHurt', function(mob, source, damage, cause) {
        if (cause !== 5) return;
        if (!mob) return;
        // mob 是 Entity 对象，需要 toPlayer() 转为 Player 才能获取 xuid
        var player = mob.toPlayer ? mob.toPlayer() : null;
        var isPlayer = player !== null;
        var debugOn = _deps.debugMode && _deps.debugMode();
        if (debugOn) logger.info('[RTP保护] onMobHurt触发 cause=' + cause + ' damage=' + damage + ' isPlayer=' + isPlayer + ' name=' + (player ? player.name : (mob.name || 'N/A')) + ' xuid=' + (player ? player.xuid : 'N/A'));
        if (!isPlayer) return;
        var expireAt = _rtpProtected[player.xuid];
        if (expireAt) {
            if (Date.now() < expireAt) {
                if (debugOn) logger.info('[RTP保护] 拦截玩家 ' + player.name + ' 的掉落伤害 (' + damage + ')，保护剩余：' + Math.round((expireAt - Date.now()) / 1000) + 's');
                return false;
            }
            delete _rtpProtected[player.xuid];
        }
    });
}

/** 运行时读取传送配置，支持热重载 */
function getTpConfig() {
    var c = _deps.getConfig ? _deps.getConfig() : {};
    return {
        enabled: c.enabled !== undefined ? c.enabled : true,
        enableHome: c.enableHome !== undefined ? c.enableHome : true,
        enableWarp: c.enableWarp !== undefined ? c.enableWarp : true,
        enableTpa: c.enableTpa !== undefined ? c.enableTpa : true,
        homeLimit: c.homeLimit !== undefined ? c.homeLimit : 10,
        homeCooldown: c.homeCooldown !== undefined ? c.homeCooldown : 10,
        tpaCooldown: c.tpaCooldown !== undefined ? c.tpaCooldown : 30,
        tpaTimeout: c.tpaTimeout !== undefined ? c.tpaTimeout : 30,
        tpaCost: c.tpaCost !== undefined ? c.tpaCost : 0,
        warpCost: c.warpCost !== undefined ? c.warpCost : 0,
        enableRtp: c.enableRtp !== undefined ? c.enableRtp : true,
        rtpRadius: c.rtpRadius !== undefined ? c.rtpRadius : 10000,
        rtpCooldown: c.rtpCooldown !== undefined ? c.rtpCooldown : 60,
        rtpCost: c.rtpCost !== undefined ? c.rtpCost : 0
    };
}
let homesData = {};       // 家园数据 { xuid: [{ name, x, y, z, dim, sharedWith, ... }] }
let warpsData = {};       // 公共地标数据 { name: { x, y, z, dim, cost, ... } }
let homesDM = null;       // 家园数据的 DataManager 实例
let warpsDM = null;       // 地标数据的 DataManager 实例

/**
 * 生成冷却记录的唯一key
 * @param {string} xuid - 玩家XUID
 * @param {string} type - 冷却类型（home/tpa）
 * @returns {string} 拼接后的key
 */
function getTeleportCooldownKey(xuid, type) {
	return xuid + "_" + type;
}

/**
 * 检查玩家指定类型的传送冷却是否仍在生效
 * @param {string} xuid - 玩家XUID
 * @param {string} type - 冷却类型
 * @returns {number} 剩余秒数，0表示已冷却完毕
 */
function checkTeleportCooldown(xuid, type) {
	const key = getTeleportCooldownKey(xuid, type);
	if (teleportCooldowns[key]) {
		const now = Date.now();
		if (now < teleportCooldowns[key]) {
			const remaining = Math.ceil((teleportCooldowns[key] - now) / 1000);
			return remaining;
		}
		delete teleportCooldowns[key];
	}
	return 0;
}

/**
 * 设置玩家指定类型的传送冷却
 * @param {string} xuid - 玩家XUID
 * @param {string} type - 冷却类型
 * @param {number} seconds - 冷却秒数
 */
function setTeleportCooldown(xuid, type, seconds) {
	const key = getTeleportCooldownKey(xuid, type);
	teleportCooldowns[key] = Date.now() + seconds * 1000;
}

/**
 * 安全传送玩家，优先使用 FloatPos API，失败时回退到 /tp 命令
 * @param {Player} player - 目标玩家
 * @param {number} x - 目标X坐标
 * @param {number} y - 目标Y坐标
 * @param {number} z - 目标Z坐标
 * @param {number} dim - 维度ID
 * @returns {boolean} 是否传送成功
 */
/**
 * 获取玩家的家园列表，首次访问时自动初始化为空数组
 * @param {string} xuid - 玩家XUID
 * @returns {Array} 家园数组
 */
function getPlayerHomes(xuid) {
	if (!homesData[xuid]) homesData[xuid] = [];
	return homesData[xuid];
}

/** 标记家园数据为脏 */
function markHomeDirty(xuid) { _dirtyHomes[xuid] = true; }

/** 获取并清空家园脏标记 */
function flushDirtyHomes() {
    var list = Object.keys(_dirtyHomes);
    _dirtyHomes = {};
    return list;
}

/** 标记死亡点数据为脏 */
function markDeathPointDirty(xuid) { _dirtyDeathPoints[xuid] = true; }

/** 获取并清空死亡点脏标记 */
function flushDirtyDeathPoints() {
    var list = Object.keys(_dirtyDeathPoints);
    _dirtyDeathPoints = {};
    return list;
}

/** 通过 DataManager 防抖保存家园数据 */
function saveHomesData() {
	if (homesDM) homesDM.save();
}

/** 通过 DataManager 防抖保存地标数据 */
function saveWarpsData() {
	if (warpsDM) warpsDM.save();
}

/**
 * 初始化传送模块，加载配置和数据，启动定时清理任务
 * @param {object} config - 配置适配器
 * @param {DataManager} _homesDM - 家园数据管理器
 * @param {DataManager} _warpsDM - 地标数据管理器
 * @param {object} deps - 依赖对象
 */
function init(_homesDM, _warpsDM, deps) {
	D.debugLogModule('teleport')('init: 初始化完成');
	_deps = deps || {};
	_t = _deps.t || null;
	_getLang = _deps.getSystemLanguage || null;
	homesDM = _homesDM;
	warpsDM = _warpsDM;

	// 传送配置运行时读取，支持热重载

	homesData = homesDM.load();
	warpsData = warpsDM.load();
	registerRtpProtection();
	D.debugLogModule('teleport')('init: 家园数=' + Object.keys(homesData).length + ', 地标数=' + Object.keys(warpsData).length);


	// 每5秒清理超时的TPA请求，通知双方玩家
	setInterval(function() {
		const now = Date.now();
		for (const reqId in teleportPendingRequests) {
			const req = teleportPendingRequests[reqId];
			if (now - req.timestamp > getTpConfig().tpaTimeout * 1000) {
				const fromPlayer = mc.getPlayer(req.fromXuid);
				const toPlayer = mc.getPlayer(req.toXuid);
				if (fromPlayer) fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.request_timeout'));
				if (toPlayer) toPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.request_timeout'));
				delete teleportPendingRequests[reqId];
			}
		}
	}, 5000);

	// 每30秒清理已过期的冷却记录，防止内存泄漏
	setInterval(function() {
		const now = Date.now();
		for (const key in teleportCooldowns) {
			if (now > teleportCooldowns[key]) {
				delete teleportCooldowns[key];
			}
		}
	}, 30000);
}

/**
 * 显示传送系统主菜单，根据配置动态显示可用功能按钮
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showTpgMainMenu(player, deps) {
	if (!getTpConfig().enabled) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.disabled'));
		return;
	}

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§b" + t('tp.main_title'));
	fm.setContent("§a" + t('tp.select_function'));

	if (getTpConfig().enableHome) {
		fm.addButton("§6" + t('tp.home_system'), "textures/ui/icon_recipe_nature");
	}
	if (getTpConfig().enableWarp) {
		fm.addButton("§d" + t('tp.warp_system'), "textures/ui/icon_multiplayer");
	}
	if (getTpConfig().enableTpa) {
		fm.addButton("§b" + t('tp.tpa_system'), "textures/ui/dressing_room_skins");
	}
	var rtpCfg = _deps.getConfig ? _deps.getConfig() : {};
	if (rtpCfg.enableRtp !== false) {
		fm.addButton("§a" + t('tp.random_teleport'), "textures/ui/icon_map");
	}

	// 通过累计 btnIndex 将表单按钮ID映射到实际功能，跳过被禁用的功能
	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		let btnIndex = 0;
		if (getTpConfig().enableHome) {
			if (btnIndex === id) { showHomeMainForm(p, deps); return; }
			btnIndex++;
		}
		if (getTpConfig().enableWarp) {
			if (btnIndex === id) { showWarpMainForm(p, deps); return; }
			btnIndex++;
		}
		if (getTpConfig().enableTpa) {
			if (btnIndex === id) { showTpaMainForm(p, deps); return; }
			btnIndex++;
		}
		if (rtpCfg.enableRtp !== false) {
			if (btnIndex === id) { showRtpConfirmForm(p); return; }
			btnIndex++;
		}
	});
}

/**
 * 显示互传（TPA）主菜单，使用 CustomForm 在单页内选择玩家和传送方式
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showTpaMainForm(player, deps) {
	if (!getTpConfig().enableTpa) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.tpa_disabled'));
		return;
	}

	// 获取在线玩家列表（排除自己和模拟玩家）
	const onlinePlayers = mc.getOnlinePlayers();
	const otherPlayers = onlinePlayers.filter(function(p) {
		return p.xuid !== player.xuid && !p.isSimulatedPlayer();
	});

	if (otherPlayers.length === 0) {
		player.sendModalForm("§e" + t('tp.tpa_title'), "§a" + t('tp.no_online_players'), t('tp.back'), t('tp.close'), function(p, result) {
			if (result) showTpgMainMenu(p, deps);
		});
		return;
	}

	const playerNames = otherPlayers.map(function(p) { return p.name; });

	const fm = mc.newCustomForm();
	fm.setTitle("§l§b" + t('tp.tpa_title'));
	fm.addLabel("§a" + t('tp.select_player'));
	fm.addDropdown(t('tp.select_player'), playerNames, 0);
	fm.addDropdown(t('tp.select_method'), [t('tp.tpa_type_to_you'), t('tp.tpa_type_to_them')], 0);

	// 检查是否有发给当前玩家的待处理请求
	let hasPending = false;
	for (const reqId in teleportPendingRequests) {
		const req = teleportPendingRequests[reqId];
		if (req.toXuid === player.xuid) {
			hasPending = true;
			break;
		}
	}
	if (hasPending) {
		fm.addSwitch("§c" + t('tp.handle_pending'), false);
	}

	player.sendForm(fm, function(p, data) {
		if (data == null) return;

		// CustomForm 返回数组：[label(skip), playerDropdown, typeDropdown, pendingSwitch?]
		const playerIdx = data[1];
		const typeIdx = data[2];
		const pendingSwitch = hasPending ? data[3] : false;

		if (pendingSwitch) {
			showTpaPendingRequests(p, deps);
			return;
		}

		// 通过xuid重新获取目标玩家，避免闭包中的player对象已失效
		const targetXuid = otherPlayers[playerIdx] ? otherPlayers[playerIdx].xuid : null;
		if (!targetXuid) return;
		const target = mc.getPlayer(targetXuid);
		if (!target) {
			p.tell(t('tp.tag_prefix') + " §c" + t('tp.target_offline'));
			return;
		}

		const type = typeIdx === 0 ? 'tpa' : 'tpn';
		sendTpaRequest(p, target, type, deps);
	});
}


/**
 * 发送TPA传送请求，检查冷却、余额、拒绝模式和重复请求后创建请求并弹窗给目标玩家
 * @param {Player} fromPlayer - 请求发起者
 * @param {Player} toPlayer - 请求目标玩家
 * @param {string} type - TPA类型
 * @param {object} deps - 依赖对象
 */
function sendTpaRequest(fromPlayer, toPlayer, type, deps) {
	const cd = checkTeleportCooldown(fromPlayer.xuid, 'tpa');
	if (cd > 0) {
		fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.cooldown', cd));
		return;
	}

	if (getTpConfig().tpaCost > 0) {
		const bal = deps.getPlayerMoney(fromPlayer);
		if (bal < getTpConfig().tpaCost) {
			fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.insufficient_balance', getTpConfig().tpaCost, deps.getCurrencyName()));
			return;
		}
	}

	const rejectMode = deps.getPlayerSetting(toPlayer.xuid, "enableTpaRejectMode");
	if (rejectMode) {
		fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.player_reject'));
		return;
	}

	for (const reqId in teleportPendingRequests) {
		const existing = teleportPendingRequests[reqId];
		if (existing.fromXuid === fromPlayer.xuid && existing.toXuid === toPlayer.xuid) {
			fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.already_sent'));
			return;
		}
	}

	const reqId = fromPlayer.xuid + "_" + toPlayer.xuid + "_" + Date.now();
	teleportPendingRequests[reqId] = {
		fromXuid: fromPlayer.xuid,
		fromName: fromPlayer.name,
		toXuid: toPlayer.xuid,
		toName: toPlayer.name,
		type: type,
		timestamp: Date.now()
	};

	const typeDesc = type === 'tpa' ? t('tp.tpa_type_to_you') : type === 'tpn' ? t('tp.tpa_type_to_them') : t('tp.tpa_type_mutual');
	fromPlayer.tell(t('tp.tag_prefix') + " §a" + t('tp.request_sent', toPlayer.name, typeDesc));

	toPlayer.tell(t('tp.tag_prefix') + " §b" + fromPlayer.name + " §a" + t('tp.request_notify', fromPlayer.name, typeDesc));

	// 弹窗给目标玩家，请求同意或拒绝
	const fm = mc.newSimpleForm();
	fm.setTitle("§l§e" + t('tp.pending_requests'));
	fm.setContent(t('tp.player_label') + fromPlayer.name + " §a" + t('tp.request_notify', fromPlayer.name, typeDesc));
	fm.addButton("§a" + t('tp.accept'), "textures/ui/check");
	fm.addButton("§c" + t('tp.deny'), "textures/ui/cancel");

	// 保存发起者xuid，避免闭包中引用可能失效的player对象
	const fromXuid = fromPlayer.xuid;

	toPlayer.sendForm(fm, function(p, id) {
		// 重新验证请求是否仍然有效（可能已被超时清理）
		if (!teleportPendingRequests[reqId]) {
			return;
		}
		if (id == null) {
			// 玩家关闭表单（ESC或被其他表单覆盖），不立即删除请求
			// 请求会保留直到超时自动清理，玩家可以通过 /tpy /tpn 命令或菜单处理
			const fromP = mc.getPlayer(fromXuid);
			if (fromP) fromP.tell(t('tp.tag_prefix') + " §c" + t('tp.request_pending', p.name));
			return;
		}
		if (id === 0) {
			acceptTpaRequest(reqId, p, deps);
		} else {
			denyTpaRequest(reqId, p);
		}
	});
}

/**
 * 接受TPA传送请求，执行实际传送操作（含费用扣除和冷却设置）
 * @param {string} reqId - 请求ID
 * @param {Player} byPlayer - 接受请求的玩家（目标方）
 * @param {object} deps - 依赖对象
 */
function acceptTpaRequest(reqId, byPlayer, deps) {
	const req = teleportPendingRequests[reqId];
	if (!req) {
		byPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.request_invalid'));
		return;
	}

	const now = Date.now();
	if (now - req.timestamp > getTpConfig().tpaTimeout * 1000) {
		delete teleportPendingRequests[reqId];
		byPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.request_timeout'));
		return;
	}

	const fromPlayer = mc.getPlayer(req.fromXuid);
	const toPlayer = mc.getPlayer(req.toXuid);
	if (!fromPlayer || !toPlayer) {
		delete teleportPendingRequests[reqId];
		byPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.target_offline_cancel'));
		return;
	}

	if (getTpConfig().tpaCost > 0) {
		const bal = deps.getPlayerMoney(fromPlayer);
		if (bal < getTpConfig().tpaCost) {
			delete teleportPendingRequests[reqId];
			fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.insufficient_cancel'));
			return;
		}
		deps.reducePlayerMoney(fromPlayer, getTpConfig().tpaCost, t('tp.reason_mutual'));
	}

	delete teleportPendingRequests[reqId];

	if (req.type === 'tpa') {
		const toPos = toPlayer.pos;
		safeTeleport(fromPlayer, toPos.x, toPos.y, toPos.z, toPos.dimid);
		fromPlayer.tell(t('tp.tag_prefix') + " §a" + t('tp.accepted_to', toPlayer.name));
		toPlayer.tell(t('tp.tag_prefix') + " §a" + t('tp.accepted_from', fromPlayer.name));
	} else if (req.type === 'tpn') {
		const fromPos = fromPlayer.pos;
		safeTeleport(toPlayer, fromPos.x, fromPos.y, fromPos.z, fromPos.dimid);
		fromPlayer.tell(t('tp.tag_prefix') + " §a" + t('tp.accepted_from', toPlayer.name));
		toPlayer.tell(t('tp.tag_prefix') + " §a" + t('tp.accepted_to', fromPlayer.name));
	}

	setTeleportCooldown(fromPlayer.xuid, 'tpa', getTpConfig().tpaCooldown);
}

/**
 * 拒绝TPA传送请求
 * @param {string} reqId - 请求ID
 * @param {Player} byPlayer - 拒绝请求的玩家
 */
function denyTpaRequest(reqId, byPlayer) {
	const req = teleportPendingRequests[reqId];
	if (!req) {
		byPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.request_invalid'));
		return;
	}

	const fromPlayer = mc.getPlayer(req.fromXuid);
	delete teleportPendingRequests[reqId];

	byPlayer.tell(t('tp.tag_prefix') + " §a" + t('tp.denied'));
	if (fromPlayer) {
		fromPlayer.tell(t('tp.tag_prefix') + " §c" + t('tp.denied_notify', byPlayer.name));
	}
}

/**
 * 显示发给当前玩家的所有待处理TPA请求列表
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showTpaPendingRequests(player, deps) {
	const pending = [];
	for (const reqId in teleportPendingRequests) {
		const req = teleportPendingRequests[reqId];
		if (req.toXuid === player.xuid) {
			pending.push({ id: reqId, req: req });
		}
	}

	if (pending.length === 0) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.no_pending'));
		showTpaMainForm(player, deps);
		return;
	}

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§e" + t('tp.pending_requests'));

	pending.forEach(function(item) {
		const typeDesc = item.req.type === 'tpa' ? t('tp.tpa_type_short_to_you') : item.req.type === 'tpn' ? t('tp.tpa_type_short_to_them') : t('tp.tpa_type_short_mutual');
		fm.addButton("§b" + item.req.fromName + " - " + typeDesc);
	});

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		const item = pending[id];
		if (!item) return;

		// 选中某个请求后弹出详情确认窗
		const subFm = mc.newSimpleForm();
		subFm.setTitle("§l§e" + t('tp.request_detail'));
		const typeDesc = item.req.type === 'tpa' ? t('tp.tpa_type_short_to_you') : item.req.type === 'tpn' ? t('tp.tpa_type_short_to_them') : t('tp.tpa_type_short_mutual');
		subFm.setContent(t('tp.player_request_label', item.req.fromName, typeDesc));
		subFm.addButton("§a" + t('tp.accept'), "textures/ui/check");
		subFm.addButton("§c" + t('tp.deny'), "textures/ui/cancel");

		p.sendForm(subFm, function(p2, btnId) {
			if (btnId == null) return;
			if (btnId === 0) {
				acceptTpaRequest(item.id, p2, deps);
			} else {
				denyTpaRequest(item.id, p2);
			}
		}
		);
	});
}

/**
 * 取消当前玩家发起的所有待处理TPA请求
 * @param {Player} player - 玩家
 */
function cancelTpaRequest(player) {
	let found = false;
	const toDelete = [];
	for (const reqId in teleportPendingRequests) {
		const req = teleportPendingRequests[reqId];
		if (req.fromXuid === player.xuid) {
			const toPlayer = mc.getPlayer(req.toXuid);
			if (toPlayer) {
				toPlayer.tell(t('tp.tag_prefix') + " §c" + player.name + " " + t('tp.cancel_tpa_notify'));
			}
			toDelete.push(reqId);
			found = true;
		}
	}
	for (var i = 0; i < toDelete.length; i++) {
		delete teleportPendingRequests[toDelete[i]];
	}
	if (found) {
		player.tell(t('tp.tag_prefix') + " §a" + t('tp.cancelled_all'));
	} else {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.no_pending'));
	}
}

/**
 * 快捷接受最近一条发给自己的TPA请求（供命令使用）
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function acceptTpaRequestByPlayer(player, deps) {
	let foundReq = null;
	let foundReqId = null;
	const now = Date.now();
	// 遍历所有请求，找到发给自己的最新一条
	for (const reqId in teleportPendingRequests) {
		const req = teleportPendingRequests[reqId];
		if (req.toXuid === player.xuid) {
			if (!foundReq || req.timestamp > foundReq.timestamp) {
				foundReq = req;
				foundReqId = reqId;
			}
		}
	}
	if (!foundReq) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.no_pending'));
		return;
	}
	acceptTpaRequest(foundReqId, player, deps);
}

/**
 * 快捷拒绝最近一条发给自己的TPA请求（供命令使用）
 * @param {Player} player - 玩家
 */
function denyTpaRequestByPlayer(player) {
	let foundReq = null;
	let foundReqId = null;
	// 遍历所有请求，找到发给自己的最新一条
	for (const reqId in teleportPendingRequests) {
		const req = teleportPendingRequests[reqId];
		if (req.toXuid === player.xuid) {
			if (!foundReq || req.timestamp > foundReq.timestamp) {
				foundReq = req;
				foundReqId = reqId;
			}
		}
	}
	if (!foundReq) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.no_pending'));
		return;
	}
	denyTpaRequest(foundReqId, player);
}

/**
 * 显示家园系统主菜单，列出自己的家园和他人共享的家园
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showHomeMainForm(player, deps) {
	if (!getTpConfig().enableHome) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.home_disabled'));
		return;
	}

	const xuid = player.xuid;
	const homes = getPlayerHomes(xuid);
	const sharedHomes = getSharedHomesForPlayer(player.name, deps);

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§6" + t('tp.home_system'));
	fm.setContent(t('tp.home_count_info', String(homes.length), String(getTpConfig().homeLimit)) + (sharedHomes.length > 0 ? t('tp.home_shared_count', String(sharedHomes.length)) : ""));

	if (homes.length > 0) {
		homes.forEach(function(home) {
			const dimName = home.dim === 0 ? t('tp.dim_overworld') : home.dim === 1 ? t('tp.dim_nether') : t('tp.dim_end');
			fm.addButton("§b" + home.name + "\n" + dimName + " (" + Math.floor(home.x) + ", " + Math.floor(home.y) + ", " + Math.floor(home.z) + ")", "textures/ui/icon_recipe_nature");
		});
	}

	// 追加他人共享给自己的家园按钮
	if (sharedHomes.length > 0) {
		sharedHomes.forEach(function(item) {
			const dimName = item.home.dim === 0 ? t('tp.dim_overworld') : item.home.dim === 1 ? t('tp.dim_nether') : t('tp.dim_end');
			fm.addButton("§d" + item.home.name + t('tp.from_label_btn', item.ownerName) + "\n" + dimName, "textures/ui/FriendsIcon");
		});
	}

	fm.addButton("§a" + t('tp.set_home'), "textures/ui/color_plus");
	fm.addButton("§c" + t('tp.back'), "textures/ui/recap_glyph_desaturated");

	const ownHomeCount = homes.length;
	const sharedHomeCount = sharedHomes.length;

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		if (id === ownHomeCount + sharedHomeCount) {
			showHomeSetForm(p, deps);
		} else if (id === ownHomeCount + sharedHomeCount + 1) {
			showTpgMainMenu(p, deps);
		} else if (id < ownHomeCount) {
			showHomeDetailForm(p, homes[id], id, deps);
		} else if (id >= ownHomeCount && id < ownHomeCount + sharedHomeCount) {
			const sharedItem = sharedHomes[id - ownHomeCount];
			teleportToHome(p, sharedItem.home, sharedItem.ownerXuid);
		}
	});
}

/**
 * 遍历所有玩家的家园数据，查找共享给指定玩家名的家园
 * @param {string} playerName - 被共享的玩家名
 * @param {object} deps - 依赖对象
 * @returns {Array} 共享家园列表，每项包含 home、ownerXuid、ownerName、homeIndex
 */
function getSharedHomesForPlayer(playerName, deps) {
	const result = [];
	for (const xuid in homesData) {
		const homes = homesData[xuid];
		if (!homes) continue;
		let ownerName = "";
		if (deps.playerData.players[xuid]) {
			ownerName = deps.playerData.players[xuid].name || "";
		}
		for (let i = 0; i < homes.length; i++) {
			const home = homes[i];
			if (home.sharedWith && home.sharedWith.indexOf(playerName) !== -1) {
				result.push({ home: home, ownerXuid: xuid, ownerName: ownerName, homeIndex: i });
			}
		}
	}
	return result;
}

/**
 * 显示设置家园表单，输入名称和公开开关后保存当前位置为家园
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showHomeSetForm(player, deps) {
	const xuid = player.xuid;
	const homes = getPlayerHomes(xuid);

	if (homes.length >= getTpConfig().homeLimit) {
		player.tell(t('tp.home_tag_prefix') + " §c" + t('tp.home_limit', getTpConfig().homeLimit));
		showHomeMainForm(player, deps);
		return;
	}

	const fm = mc.newCustomForm();
	fm.setTitle("§l§6" + t('tp.set_home'));
	fm.addInput("§a" + t('tp.home_name'), t('tp.home_name_placeholder'));
	fm.addSwitch("§a" + t('tp.is_public'), false);

	player.sendForm(fm, function(p, data) {
		if (data == null) { showHomeMainForm(p, deps); return; }

		const name = String(data[0] || "").trim();
		if (!name) {
			p.tell(t('tp.home_tag_prefix') + " §c" + t('tp.home_name_empty'));
			showHomeSetForm(p, deps);
			return;
		}

		const existing = homes.some(function(h) { return h.name === name; });
		if (existing) {
			p.tell(t('tp.home_tag_prefix') + " §c" + t('tp.home_name_duplicate'));
			showHomeSetForm(p, deps);
			return;
		}

		const pos = p.pos;
		const isPublic = data[1] || false;
		homes.push({
			name: name,
			x: pos.x,
			y: pos.y,
			z: pos.z,
			dim: pos.dimid,
			public: isPublic,
			sharedWith: [],
			lastUse: 0
		});
		markHomeDirty(p.xuid);
		saveHomesData();
		p.tell(t('tp.home_tag_prefix') + " §a" + t('tp.home_set_success', name));
		showHomeMainForm(p, deps);
	});
}

/**
 * 显示单个家园的详情面板（传送、共享设置、删除）
 * @param {Player} player - 玩家
 * @param {object} home - 家园数据对象
 * @param {number} homeIndex - 家园在数组中的索引
 * @param {object} deps - 依赖对象
 */
function showHomeDetailForm(player, home, homeIndex, deps) {
	const dimName = home.dim === 0 ? t('tp.dim_overworld') : home.dim === 1 ? t('tp.dim_nether') : t('tp.dim_end');

	const fm = mc.newSimpleForm();
	fm.setTitle(t('tp.home_detail_title', home.name));
	fm.setContent(
		t('tp.home_name_label') + home.name + "\n" +
		t('tp.home_location_label') + dimName + " (" + Math.floor(home.x) + ", " + Math.floor(home.y) + ", " + Math.floor(home.z) + ")\n" +
		"§a" + t('tp.home_public_label') + "§f" + (home.public ? t('tp.yes') : t('tp.no')) + "\n" +
		"§a" + t('tp.home_shared_label') + "§f" + (home.sharedWith && home.sharedWith.length > 0 ? home.sharedWith.join(", ") : t('tp.none'))
	);

	fm.addButton("§a" + t('tp.teleport'), "textures/ui/icon_recipe_nature");
	fm.addButton("§e" + t('tp.share_settings'), "textures/ui/FriendsIcon");
	fm.addButton("§c" + t('tp.delete_home'), "textures/ui/trash_default");
	fm.addButton("§c" + t('tp.back'), "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		switch (id) {
			case 0: teleportToHome(p, home); break;
			case 1: showHomeShareForm(p, home, homeIndex, deps); break;
			case 2: showHomeDeleteConfirm(p, home, homeIndex, deps); break;
			case 3: showHomeMainForm(p, deps); break;
		}
	});
}

/**
 * 传送到指定家园位置，检查冷却后执行传送并更新lastUse时间戳
 * @param {Player} player - 玩家
 * @param {object} home - 家园数据对象
 */
function teleportToHome(player, home, ownerXuid) {
	var homeOwnerXuid = ownerXuid || player.xuid;
	const cd = checkTeleportCooldown(player.xuid, 'home');
	if (cd > 0) {
		player.tell(t('tp.home_tag_prefix') + " §c" + t('tp.home_cooldown', cd));
		return;
	}

	if (safeTeleport(player, home.x, home.y, home.z, home.dim)) {
		home.lastUse = Date.now();
		markHomeDirty(homeOwnerXuid);
		saveHomesData();
		setTeleportCooldown(player.xuid, 'home', getTpConfig().homeCooldown);
		player.tell(t('tp.home_tag_prefix') + " §a" + t('tp.home_teleported', home.name));
	} else {
		player.tell(t('tp.home_tag_prefix') + " §c" + t('tp.tp_failed'));
	}
}

/**
 * 显示家园共享管理面板，可添加或移除共享玩家
 * @param {Player} player - 玩家
 * @param {object} home - 家园数据对象
 * @param {number} homeIndex - 家园索引
 * @param {object} deps - 依赖对象
 */
function showHomeShareForm(player, home, homeIndex, deps) {
	const fm = mc.newSimpleForm();
	fm.setTitle(t('tp.share_settings_title', home.name));

	const sharedList = home.sharedWith || [];
	fm.setContent("§a" + t('tp.current_shared') + "§f" + (sharedList.length > 0 ? sharedList.join(", ") : t('tp.none')));

	fm.addButton("§a" + t('tp.add_share'), "textures/ui/color_plus");

	if (sharedList.length > 0) {
		sharedList.forEach(function(name) {
			fm.addButton(t('tp.remove_btn', name), "textures/ui/cancel");
		});
	}

	fm.addButton("§c" + t('tp.back'), "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id == null) return;

		if (id === 0) {
			showHomeShareAddForm(p, home, homeIndex, deps);
		} else if (id === sharedList.length + 1) {
			showHomeDetailForm(p, home, homeIndex, deps);
		} else if (id > 0 && id <= sharedList.length) {
			const removeName = sharedList[id - 1];
			const idx = home.sharedWith.indexOf(removeName);
			if (idx !== -1) {
				home.sharedWith.splice(idx, 1);
				markHomeDirty(p.xuid);
				saveHomesData();
				p.tell(t('tp.home_tag_prefix') + " §a" + t('tp.share_removed', removeName));
			}
			showHomeShareForm(p, home, homeIndex, deps);
		}
	});
}

/**
 * 显示添加共享玩家表单，通过玩家名查找XUID后添加到共享列表
 * @param {Player} player - 玩家
 * @param {object} home - 家园数据对象
 * @param {number} homeIndex - 家园索引
 * @param {object} deps - 依赖对象
 */
function showHomeShareAddForm(player, home, homeIndex, deps) {
	const fm = mc.newCustomForm();
	fm.setTitle("§l§6" + t('tp.add_share'));
	fm.addInput("§a" + t('tp.search_player'), t('tp.search_placeholder'));

	player.sendForm(fm, function(p, data) {
		if (data == null) { showHomeShareForm(p, home, homeIndex, deps); return; }

		const keyword = String(data[0] || "").trim().toLowerCase();
		if (!keyword) {
			showHomeShareForm(p, home, homeIndex, deps);
			return;
		}

		// 模糊搜索：按名称、UID、XUID 匹配
		const results = [];
		const players = deps.playerData ? (deps.playerData.players || {}) : {};
		for (const x in players) {
			if (!players.hasOwnProperty(x)) continue;
			const info = players[x];
			const name = (info.name || '').toLowerCase();
			const uid = String(info.uid || '').toLowerCase();
			if (name === keyword || uid === keyword || x.toLowerCase() === keyword) {
				results.unshift({ xuid: x, name: info.name || x, uid: info.uid || '' });
			} else if (name.indexOf(keyword) !== -1) {
				results.push({ xuid: x, name: info.name || x, uid: info.uid || '' });
			}
		}

		if (results.length === 0) {
			p.tell(t('tp.home_tag_prefix') + " §c" + t('tp.player_not_found', keyword));
			showHomeShareAddForm(p, home, homeIndex, deps);
			return;
		}

		// 显示搜索结果列表供选择
		var sf = mc.newSimpleForm();
		sf.setTitle(t('tp.search_result_title', keyword));
		sf.setContent(t('tp.found_players_select', String(results.length)));
		results.forEach(function(r) {
			sf.addButton("§e" + r.name + "\nUID: " + r.uid);
		});
		sf.addButton(t('tp.back'), "textures/ui/recap_glyph_desaturated");
		p.sendForm(sf, function(p2, id) {
			if (id == null || id === results.length) { showHomeShareAddForm(p2, home, homeIndex, deps); return; }
			var selected = results[id];
			if (!home.sharedWith) home.sharedWith = [];
			if (home.sharedWith.indexOf(selected.name) === -1) {
				home.sharedWith.push(selected.name);
				markHomeDirty(p2.xuid);
				saveHomesData();
				p2.tell(t('tp.home_tag_prefix') + " §a" + t('tp.share_added', selected.name));
			} else {
				p2.tell(t('tp.home_tag_prefix') + " §c" + t('tp.already_shared'));
			}
			showHomeShareForm(p2, home, homeIndex, deps);
		});
	});
}

/**
 * 显示删除家园确认弹窗
 * @param {Player} player - 玩家
 * @param {object} home - 家园数据对象
 * @param {number} homeIndex - 家园索引
 * @param {object} deps - 依赖对象
 */
function showHomeDeleteConfirm(player, home, homeIndex, deps) {
	const fm = mc.newSimpleForm();
	fm.setTitle("§l§c" + t('tp.delete_home'));
	fm.setContent(t('tp.delete_confirm_msg', home.name));

	fm.addButton("§c" + t('tp.confirm_delete'), "textures/ui/trash_default");
	fm.addButton("§a" + t('tp.cancel'), "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		if (id === 1) {
			showHomeDetailForm(p, home, homeIndex, deps);
			return;
		}

		const homes = getPlayerHomes(p.xuid);
		homes.splice(homeIndex, 1);
		markHomeDirty(p.xuid);
		saveHomesData();
		p.tell(t('tp.home_tag_prefix') + " §a" + t('tp.home_deleted', home.name));
		showHomeMainForm(p, deps);
	});
}

/**
 * 显示公共传送点列表，管理员可额外看到管理入口
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showWarpMainForm(player, deps) {
	if (!getTpConfig().enableWarp) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.warp_disabled'));
		return;
	}

	const warpNames = Object.keys(warpsData);

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§d" + t('tp.warp_title'));

	if (warpNames.length === 0) {
		fm.setContent("§c" + t('tp.no_warps'));
	} else {
		fm.setContent(t('tp.warp_count_info', String(warpNames.length)));
		warpNames.forEach(function(name) {
			const warp = warpsData[name];
			const dimName = warp.dim === 0 ? t('tp.dim_overworld') : warp.dim === 1 ? t('tp.dim_nether') : t('tp.dim_end');
			fm.addButton("§b" + name + "\n" + dimName + " (" + Math.floor(warp.x) + ", " + Math.floor(warp.y) + ", " + Math.floor(warp.z) + ")", "textures/ui/icon_multiplayer");
		});
	}

	// permLevel > 0 表示管理员，显示管理按钮
	if (player.permLevel > 0) {
		fm.addButton("§6" + t('tp.admin_manage'), "textures/ui/icon_setting");
	}

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		if (id < warpNames.length) {
			const warpName = warpNames[id];
			teleportToWarp(p, warpName, deps);
		} else if (player.permLevel > 0 && id === warpNames.length) {
			showWarpAdminForm(p, deps);
		}
	});
}

/**
 * 传送到指定公共地标，扣除费用，传送失败时退款
 * @param {Player} player - 玩家
 * @param {string} warpName - 地标名称
 * @param {object} deps - 依赖对象
 */
function teleportToWarp(player, warpName, deps) {
	const warp = warpsData[warpName];
	if (!warp) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.warp_not_exist'));
		return;
	}

	// 扣除地标传送费用
	if (getTpConfig().warpCost > 0) {
		const bal = deps.getPlayerMoney(player);
		if (bal < getTpConfig().warpCost) {
			player.tell(t('tp.tag_prefix') + " §c" + t('tp.warp_insufficient', getTpConfig().warpCost, deps.getCurrencyName()));
			return;
		}
		deps.reducePlayerMoney(player, getTpConfig().warpCost, t('tp.reason_warp', warpName));
	}

	if (safeTeleport(player, warp.x, warp.y, warp.z, warp.dim)) {
		player.tell(t('tp.tag_prefix') + " §a" + t('tp.warp_teleported', warpName));
	} else {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.tp_failed'));
		// 传送失败时退还费用
		if (getTpConfig().warpCost > 0) {
			deps.addPlayerMoney(player, getTpConfig().warpCost, t('tp.reason_warp_refund'));
		}
	}
}

/**
 * 显示地标管理面板（添加/删除地标）
 * @param {Player} player - 管理员玩家
 * @param {object} deps - 依赖对象
 */
function showWarpAdminForm(player, deps) {
	const fm = mc.newSimpleForm();
	fm.setTitle("§l§6" + t('tp.warp_admin_title'));
	fm.setContent("§a" + t('tp.select_action'));

	fm.addButton("§a" + t('tp.add_warp'), "textures/ui/color_plus");
	fm.addButton("§c" + t('tp.delete_warp'), "textures/ui/trash_default");
	fm.addButton("§c" + t('tp.back'), "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		switch (id) {
			case 0: showWarpAddForm(p, deps); break;
			case 1: showWarpDeleteForm(p, deps); break;
			case 2: showWarpMainForm(p, deps); break;
		}
	});
}

/**
 * 显示添加地标表单，以管理员当前位置创建新地标
 * @param {Player} player - 管理员玩家
 * @param {object} deps - 依赖对象
 */
function showWarpAddForm(player, deps) {
	const fm = mc.newCustomForm();
	fm.setTitle("§l§6" + t('tp.add_warp'));
	fm.addInput("§a" + t('tp.warp_name'), t('tp.warp_name_placeholder'));
	fm.addInput("§a" + t('tp.warp_cost'), "0");

	player.sendForm(fm, function(p, data) {
		if (data == null) { showWarpAdminForm(p, deps); return; }

		const name = String(data[0] || "").trim();
		if (!name) {
			p.tell(t('tp.tag_prefix') + " §c" + t('tp.warp_name_empty'));
			showWarpAddForm(p, deps);
			return;
		}

		if (warpsData[name]) {
			p.tell(t('tp.tag_prefix') + " §c" + t('tp.warp_name_duplicate'));
			showWarpAddForm(p, deps);
			return;
		}

		const cost = parseInt(data[1]) || 0;
		const pos = p.pos;
		warpsData[name] = {
			x: pos.x,
			y: pos.y,
			z: pos.z,
			dim: pos.dimid,
			cdSec: 0,
			cost: cost
		};
		saveWarpsData();
		p.tell(t('tp.tag_prefix') + " §a" + t('tp.warp_add_success', name));
		showWarpAdminForm(p, deps);
	});
}

/**
 * 显示删除地标表单，选择要删除的地标
 * @param {Player} player - 管理员玩家
 * @param {object} deps - 依赖对象
 */
function showWarpDeleteForm(player, deps) {
	const warpNames = Object.keys(warpsData);

	if (warpNames.length === 0) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.no_warps_delete'));
		showWarpAdminForm(player, deps);
		return;
	}

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§c" + t('tp.delete_warp'));
	fm.setContent("§c" + t('tp.select_warp'));

	warpNames.forEach(function(name) {
		fm.addButton("§c" + name);
	});

	player.sendForm(fm, function(p, id) {
		if (id == null) return;

		const name = warpNames[id];
		if (name && warpsData[name]) {
			delete warpsData[name];
			saveWarpsData();
			p.tell(t('tp.tag_prefix') + " §a" + t('tp.warp_deleted', name));
		}
		showWarpAdminForm(p, deps);
	});
}

/**
 * 从指定坐标向下搜索安全的落地Y坐标
 * 检测条件：脚下方块非空气/水/熔岩（实体），头顶两格空气，且非危险方块
 * @param {number} x - 目标X坐标
 * @param {number} z - 目标Z坐标
 * @param {number} dim - 维度ID
 * @returns {number|null} 安全Y坐标（玩家站立位置），找不到返回null
 */
function findSafeY(x, z, dim) {
	try {
		let safeY = null;
		if (dim === 0 || dim === 2) {
			// 主世界/末地：从 Y=200 向下扫描（地形实际高度上限），减少无效扫描
			// 区块加载检测：若 Y=200 和 Y=100 均为空气，可能区块未加载，跳过
			const topBlock = mc.getBlock(new IntPos(x, 200, z, dim));
			const midBlock = mc.getBlock(new IntPos(x, 100, z, dim));
			if (topBlock && midBlock && topBlock.type === "minecraft:air" && midBlock.type === "minecraft:air") {
				return null;
			}

			// 缓存上一层查询结果，每层从 3 次原生调用减为 1 次
			let prevBlock = null;
			for (let y = 200; y >= -64; y--) {
				const block = prevBlock || mc.getBlock(new IntPos(x, y, z, dim));
				const blockAbove = mc.getBlock(new IntPos(x, y + 1, z, dim));
				const blockAbove2 = mc.getBlock(new IntPos(x, y + 2, z, dim));
				prevBlock = blockAbove;
				if (block && blockAbove && blockAbove2) {
					const isSolid = block.type !== "minecraft:air" && block.type !== "minecraft:water" && block.type !== "minecraft:lava";
					const isAir1 = blockAbove.type === "minecraft:air";
					const isAir2 = blockAbove2.type === "minecraft:air";
					const isDangerous = block.type === "minecraft:lava" || block.type === "minecraft:cactus" || block.type === "minecraft:fire";
					if (isSolid && isAir1 && isAir2 && !isDangerous) {
						safeY = y + 1;
						break;
					}
				}
			}
		} else if (dim === 1) {
			// 下界：Y范围 0~127，不排除水（下界无水）
			let prevBlock = null;
			for (let y = 127; y >= 0; y--) {
				const block = prevBlock || mc.getBlock(new IntPos(x, y, z, dim));
				const blockAbove = mc.getBlock(new IntPos(x, y + 1, z, dim));
				const blockAbove2 = mc.getBlock(new IntPos(x, y + 2, z, dim));
				prevBlock = blockAbove;
				if (block && blockAbove && blockAbove2) {
					const isSolid = block.type !== "minecraft:air" && block.type !== "minecraft:lava";
					const isAir1 = blockAbove.type === "minecraft:air";
					const isAir2 = blockAbove2.type === "minecraft:air";
					if (isSolid && isAir1 && isAir2) {
						safeY = y + 1;
						break;
					}
				}
			}
		}
		return safeY;
	} catch (e) {
		return null;
	}
}

// ============ 死亡点返回系统 ============

let deathPointData = { players: {} };  // 死亡点数据 { xuid: [{ x, y, z, dimId, dimName, time, timestamp }] }
let deathPointDM = null;               // 死亡点数据的 DataManager 实例

/**
 * 初始化死亡点数据模块
 * @param {DataManager} dm - 数据管理器实例
 */
function initDeathPoint(dm) {
	deathPointDM = dm;
	deathPointData = deathPointDM.load();
	if (!deathPointData.players) deathPointData.players = {};
}

/** 立即持久化死亡点数据到磁盘 */
function saveDeathPointData() {
	if (!deathPointData.players) deathPointData.players = {};
	deathPointDM.save(true);
	return true;
}

/**
 * 记录玩家死亡位置，最多保留最近10条记录
 * @param {Player} player - 死亡的玩家
 */
function recordDeathPoint(player) {
	try {
		const xuid = player.xuid;
		const pos = player.pos;
		const dimId = player.pos.dimid;
		const dimName = getDimensionName(dimId);
		const time = system.getTimeStr();

		if (!deathPointData.players[xuid]) {
			deathPointData.players[xuid] = [];
		}

		const deathPoints = deathPointData.players[xuid];

		// unshift 将最新记录插入数组头部，保持时间倒序
		deathPoints.unshift({
			x: Math.floor(pos.x),
			y: Math.floor(pos.y),
			z: Math.floor(pos.z),
			dimId: dimId,
			dimName: dimName,
			time: time,
			timestamp: Date.now()
		});

		// 超出10条时截断旧记录，避免无限增长
		if (deathPoints.length > 10) {
			deathPoints.length = 10;
		}

		// 单条插入到数据库，自动保留最近10条
		var db = _deps.database;
		if (db && db.addDeathPointSQL) {
			db.addDeathPointSQL(xuid, deathPoints[0]);
		} else {
			saveDeathPointData();
		}
		logger.info('[死亡点] 玩家 ' + player.name + ' 死亡点已记录：' + dimName + ' (' + pos.x + ', ' + pos.y + ', ' + pos.z + ')');
	} catch (error) {
		logger.error('[死亡点] 记录死亡点失败：' + error.message);
	}
}

/**
 * 显示死亡点列表菜单，选择后可传送到对应死亡位置
 * @param {Player} player - 玩家
 */
function showDeathPointMenu(player) {
	const xuid = player.xuid;
	const deathPoints = deathPointData.players[xuid] || [];

	if (deathPoints.length === 0) {
		player.sendModalForm(
			"§c" + t('tp.no_death_records'),
			t('tp.no_death_content'),
			t('tp.ok'),
			t('tp.close'),
			function() {}
		);
		return;
	}

	const menuForm = mc.newSimpleForm();
	menuForm.setTitle("§c§l" + t('tp.death_title'));

	let content = "-------------------------\n";
	content += "§a" + t('tp.death_records', deathPoints.length) + "\n";
	content += "-------------------------\n";

	menuForm.setContent(content);

	deathPoints.forEach(function(point, index) {
		const timeStr = point.time || t('tp.unknown_time');
		const dimName = point.dimName || t('tp.unknown_dim');
		menuForm.addButton(
			"§c[" + (index + 1) + "] §f" + timeStr + "\n" + dimName + " §f(" + point.x + ", " + point.y + ", " + point.z + ")",
			"textures/ui/heart_new"
		);
	});

	menuForm.addButton("§c" + t('tp.close'), "textures/ui/cancel");

	player.sendForm(menuForm, function(p, buttonIndex) {
		if (buttonIndex == null) return;

		if (buttonIndex === deathPoints.length) {
			return;
		}

		if (buttonIndex < 0 || buttonIndex >= deathPoints.length) {
			p.tell("§c" + t('tp.death_error_index'));
			return;
		}

		const selectedPoint = deathPoints[buttonIndex];

		if (!selectedPoint) {
			p.tell("§c" + t('tp.death_error_data'));
			return;
		}

		const dimName = selectedPoint.dimName || t('tp.unknown_dim');
		const timeStr = selectedPoint.time || t('tp.unknown_time');

		p.sendModalForm(
			"§c" + t('tp.confirm_tp_title'),
			t('tp.confirm_tp_content', dimName, selectedPoint.x, selectedPoint.y, selectedPoint.z, timeStr),
			t('tp.confirm_tp_btn'),
			t('tp.cancel'),
			function(pl, result) {
				if (result) {
					teleportToDeathPoint(pl, buttonIndex);
				} else {
					showDeathPointMenu(pl);
				}
			}
		);
	});
}

/**
 * 传送到指定索引的死亡点
 * @param {Player} player - 玩家
 * @param {number} index - 死亡记录索引
 */
function teleportToDeathPoint(player, index) {
	const xuid = player.xuid;
	const deathPoints = deathPointData.players[xuid] || [];

	if (index < 0 || index >= deathPoints.length) {
		player.tell("§c" + t('tp.death_tp_failed'));
		return;
	}

	const point = deathPoints[index];

	if (!point) {
		player.sendModalForm("§c" + t('tp.death_point'), "§e" + t('tp.death_data_missing'), t('tp.back'), t('tp.close'), function(p, result) {
			if (result) showDeathPointMenu(p);
		});
		return;
	}

	try {
		const dimName = point.dimName || t('tp.unknown_dim');
		const x = point.x || 0;
		const y = point.y || 64;
		const z = point.z || 0;
		const dimId = point.dimId || 0;

		safeTeleport(player, x + 0.5, y, z + 0.5, dimId);
		player.tell("§a" + t('tp.death_teleported', dimName, x, y, z));
		logger.info("[死亡点] 玩家 " + player.name + " 传送到死亡点：" + dimName + " (" + x + ", " + y + ", " + z + ")");
	} catch (error) {
		player.tell("§c" + t('tp.death_tp_error', error.message));
		logger.error("[死亡点] 传送玩家到死亡点失败：" + error.message);
	}
}

/**
 * 安全传送玩家到指定坐标，支持跨维度
 * 先用 API 传送，失败则回退到 execute in 命令
 * @param {Player} player
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} dim - 维度ID
 * @returns {boolean}
 */
function safeTeleport(player, x, y, z, dim) {
    dim = parseInt(dim, 10);
    if (isNaN(dim)) dim = 0;
    var dimNames = { 0: 'minecraft:overworld', 1: 'minecraft:nether', 2: 'minecraft:the_end' };
    var dimName = dimNames[dim] || 'minecraft:overworld';
    try {
        player.teleport(new FloatPos(x, y, z, dim));
        return true;
    } catch (e) {
        try {
            var result = mc.runcmdEx('execute in ' + dimName + ' run tp "' + player.realName + '" ' + x + ' ' + y + ' ' + z);
            if (result && result.success) return true;
        } catch (e2) {}
        try {
            if (player.runcmd('tp ' + x + ' ' + y + ' ' + z)) return true;
        } catch (e3) {}
        return false;
    }
}

/**
 * 将维度ID转换为中文名称
 * @param {number} dimId - 维度ID（0=主世界, 1=下界, 2=末地）
 * @returns {string} 维度中文名称
 */
function getDimensionName(dimId) {
	if (dimId === 0) return t('tp.dim_overworld');
	if (dimId === 1) return t('tp.dim_nether');
	if (dimId === 2) return t('tp.dim_end');
	return t('tp.dim_unknown', dimId);
}

/**
 * 随机传送到安全位置，主世界范围内
 * @param {Player} player
 */
function showRtpConfirmForm(player) {
	var cfg = _deps.getConfig ? _deps.getConfig() : {};
	var rtpEnabled = cfg.enableRtp !== undefined ? cfg.enableRtp : true;
	if (!rtpEnabled) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.rtp_disabled'));
		return;
	}
	var cd = checkTeleportCooldown(player.xuid, 'rtp');
	if (cd > 0) {
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.rtp_cooldown', cd));
		return;
	}
	var cost = cfg.rtpCost !== undefined ? cfg.rtpCost : 0;
	var radius = cfg.rtpRadius !== undefined ? cfg.rtpRadius : 10000;
	var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : t('tp.currency_fallback');
	var costText = cost > 0 ? t('tp.cost_label') + cost + " " + currencyName : "";
	player.sendModalForm(
		"§a" + t('tp.rtp_title'),
		"§a" + t('tp.rtp_confirm', radius, costText),
		t('tp.confirm'),
		t('tp.cancel'),
		function(p, result) {
			if (result !== true) return;
			executeRtp(p, radius, cost);
		}
	);
}

/**
 * 执行随机传送：生成随机坐标，检测安全位置后传送
 * @param {Player} player
 * @param {number} radius
 * @param {number} cost
 */
function executeRtp(player, radius, cost) {
	if (cost > 0) {
		if (!_deps.reducePlayerMoney || !_deps.reducePlayerMoney(player, cost, t('tp.reason_rtp'))) {
			player.tell(t('tp.tag_prefix') + " §c" + t('tp.rtp_insufficient'));
			return;
		}
	}
	var x = Math.floor(Math.random() * radius * 2) - radius;
	var z = Math.floor(Math.random() * radius * 2) - radius;
	player.sendText(t('tp.tag_prefix') + " §a" + t('tp.rtp_teleporting'), 0);
	// 先传送到高空强制加载区块，启用摔伤保护防止掉血
	_rtpProtected[player.xuid] = Date.now() + 60000;
	if (_deps.debugMode && _deps.debugMode()) logger.info('[RTP] 玩家 ' + player.name + ' 开始RTP，目标 (' + x + ', ' + z + ')，已启用60秒摔伤保护');
	if (!safeTeleport(player, x + 0.5, 320, z + 0.5, 0)) {
		delete _rtpProtected[player.xuid];
		player.tell(t('tp.tag_prefix') + " §c" + t('tp.tp_failed'));
		if (cost > 0 && _deps.addPlayerMoney) {
			_deps.addPlayerMoney(player, cost, t('tp.reason_rtp_refund'));
		}
		return;
	}
	// 区块已加载，寻找安全地面高度
	var safeY = findSafeY(x, z, 0);
	if (_deps.debugMode && _deps.debugMode()) logger.info('[RTP] 玩家 ' + player.name + ' findSafeY结果: ' + safeY);
	if (safeY !== null) {
		safeTeleport(player, x + 0.5, safeY, z + 0.5, 0);
		player.tell(t('tp.tag_prefix') + " §a" + t('tp.rtp_success', x, safeY, z));
	} else {
		// 找不到安全位置但已在高空，保留摔伤保护让玩家缓慢降落
		player.tell(t('tp.tag_prefix') + " §a" + t('tp.rtp_success2', x, z));
	}
	// 60秒后清理保护记录（onMobHurt 中也会自动清理过期的）
	setTimeout(function() { delete _rtpProtected[player.xuid]; }, 60000);
	var rtpCfg = _deps.getConfig ? _deps.getConfig() : {};
	var rtpCd = rtpCfg.rtpCooldown !== undefined ? rtpCfg.rtpCooldown : 60;
	setTeleportCooldown(player.xuid, 'rtp', rtpCd);
}

module.exports = {
	init: init,
	showTpgMainMenu: showTpgMainMenu,
	showTpaMainForm: showTpaMainForm,
	showHomeMainForm: showHomeMainForm,
	showWarpMainForm: showWarpMainForm,
	cancelTpaRequest: cancelTpaRequest,
	acceptTpaRequestByPlayer: acceptTpaRequestByPlayer,
	denyTpaRequestByPlayer: denyTpaRequestByPlayer,
	tpsConfig: getTpConfig,
	initDeathPoint: initDeathPoint,
	showRtpConfirmForm: showRtpConfirmForm,
	recordDeathPoint: recordDeathPoint,
	showDeathPointMenu: showDeathPointMenu,
	teleportToDeathPoint: teleportToDeathPoint,
	getDeathPointData: function() { return deathPointData; },
	safeTeleport: safeTeleport,
	flushDirtyHomes: flushDirtyHomes,
	flushDirtyDeathPoints: flushDirtyDeathPoints
};
