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

// 待处理的TPA请求，key为 requestId，value为请求详情对象
const teleportPendingRequests = {};

// 传送冷却记录，key为 xuid_type，value为冷却截止时间戳
const teleportCooldowns = {};

let _deps = {};
let tpsConfig = {};       // 传送系统配置（从config.json加载并补全默认值）
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
	homesDM = _homesDM;
	warpsDM = _warpsDM;

	// 从配置读取传送设置，config.init 已在 index.js 中设置默认值
	let tpCfg = _deps.getConfig ? _deps.getConfig() : {};
	tpsConfig = {
		enabled: tpCfg.enabled !== undefined ? tpCfg.enabled : true,
		enableHome: tpCfg.enableHome !== undefined ? tpCfg.enableHome : true,
		enableWarp: tpCfg.enableWarp !== undefined ? tpCfg.enableWarp : true,
		enableTpa: tpCfg.enableTpa !== undefined ? tpCfg.enableTpa : true,
		homeLimit: tpCfg.homeLimit || 10,
		homeCooldown: tpCfg.homeCooldown || 10,
		tpaCooldown: tpCfg.tpaCooldown || 30,
		tpaTimeout: tpCfg.tpaTimeout || 30,
		tpaCost: tpCfg.tpaCost || 0,
		warpCost: tpCfg.warpCost || 0,
		enableRtp: tpCfg.enableRtp !== undefined ? tpCfg.enableRtp : true,
		rtpRadius: tpCfg.rtpRadius || 10000,
		rtpCooldown: tpCfg.rtpCooldown || 60,
		rtpCost: tpCfg.rtpCost || 0
	};

	homesData = homesDM.load();
	warpsData = warpsDM.load();
	D.debugLogModule('teleport')('init: 家园数=' + Object.keys(homesData).length + ', 地标数=' + Object.keys(warpsData).length + ', 配置=' + JSON.stringify(tpsConfig));

	// 每5秒清理超时的TPA请求，通知双方玩家
	setInterval(function() {
		const now = Date.now();
		for (const reqId in teleportPendingRequests) {
			const req = teleportPendingRequests[reqId];
			if (now - req.timestamp > tpsConfig.tpaTimeout * 1000) {
				const fromPlayer = mc.getPlayer(req.fromXuid);
				const toPlayer = mc.getPlayer(req.toXuid);
				if (fromPlayer) fromPlayer.tell("§e[传送] §c传送请求已超时");
				if (toPlayer) toPlayer.tell("§e[传送] §c来自 " + req.fromName + " 的传送请求已超时");
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
	if (!tpsConfig.enabled) {
		player.tell("§e[传送] §c传送系统已关闭");
		return;
	}

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§b传送系统");
	fm.setContent("§a请选择传送功能");

	if (tpsConfig.enableHome) {
		fm.addButton("§6家园系统", "textures/ui/icon_recipe_nature");
	}
	if (tpsConfig.enableWarp) {
		fm.addButton("§d公共传送点", "textures/ui/icon_multiplayer");
	}
	if (tpsConfig.enableTpa) {
		fm.addButton("§b互传系统", "textures/ui/dressing_room_skins");
	}

	// 通过累计 btnIndex 将表单按钮ID映射到实际功能，跳过被禁用的功能
	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		let btnIndex = 0;
		if (tpsConfig.enableHome) {
			if (btnIndex === id) { showHomeMainForm(p, deps); return; }
			btnIndex++;
		}
		if (tpsConfig.enableWarp) {
			if (btnIndex === id) { showWarpMainForm(p, deps); return; }
			btnIndex++;
		}
		if (tpsConfig.enableTpa) {
			if (btnIndex === id) { showTpaMainForm(p, deps); return; }
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
	if (!tpsConfig.enableTpa) {
		player.tell("§e[传送] §c互传系统已关闭");
		return;
	}

	// 获取在线玩家列表（排除自己和模拟玩家）
	const onlinePlayers = mc.getOnlinePlayers();
	const otherPlayers = onlinePlayers.filter(function(p) {
		return p.xuid !== player.xuid && !p.isSimulatedPlayer();
	});

	if (otherPlayers.length === 0) {
		player.sendModalForm("§e互传系统", "§a当前没有其他在线玩家", "§a返回", "§c关闭", function(p, result) {
			if (result) showTpgMainMenu(p, deps);
		});
		return;
	}

	const playerNames = otherPlayers.map(function(p) { return p.name; });

	const fm = mc.newCustomForm();
	fm.setTitle("§l§b互传系统");
	fm.addLabel("§a选择玩家和传送方式");
	fm.addDropdown("目标玩家", playerNames, 0);
	fm.addDropdown("传送方式", ["传送到其他玩家", "请其他玩家传送到我"], 0);

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
		fm.addSwitch("§c处理待接请求", false);
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
			p.tell("§e[传送] §c目标玩家已下线");
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
		fromPlayer.tell("§e[传送] §c请等待 " + cd + " 秒后再发起传送请求");
		return;
	}

	// 检查发起者余额是否足够支付传送费用
	if (tpsConfig.tpaCost > 0) {
		const bal = deps.getPlayerMoney(fromPlayer);
		if (bal < tpsConfig.tpaCost) {
			fromPlayer.tell("§e[传送] §c余额不足，需要 " + tpsConfig.tpaCost + " " + deps.getCurrencyName());
			return;
		}
	}

	// 检查目标玩家是否开启了拒绝传送模式
	const rejectMode = deps.getPlayerSetting(toPlayer.xuid, "enableTpaRejectMode");
	if (rejectMode) {
		fromPlayer.tell("§e[传送] §c该玩家已设置拒绝传送请求");
		return;
	}

	// 防止对同一目标重复发送请求
	for (const reqId in teleportPendingRequests) {
		const existing = teleportPendingRequests[reqId];
		if (existing.fromXuid === fromPlayer.xuid && existing.toXuid === toPlayer.xuid) {
			fromPlayer.tell("§e[传送] §c你已经向该玩家发送了传送请求，请等待对方处理");
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

	const typeDesc = type === 'tpa' ? "传送到你所在位置" : type === 'tpn' ? "请你传送到他所在位置" : "与你们互相传送到中点";
	fromPlayer.tell("§e[传送] §a已向 " + toPlayer.name + " 发送传送请求（" + typeDesc + "），等待对方确认...");

	// 同时发送文本通知，确保对方即使无法弹出表单也能看到请求
	toPlayer.tell("§e[传送] §b" + fromPlayer.name + " §a请求" + typeDesc + " (输入 §a/tpy 同意, §c/tpn 拒绝)");

	// 弹窗给目标玩家，请求同意或拒绝
	const fm = mc.newSimpleForm();
	fm.setTitle("§l§e传送请求");
	fm.setContent("§a玩家 §b" + fromPlayer.name + " §a请求" + typeDesc);
	fm.addButton("§a同意", "textures/ui/check");
	fm.addButton("§c拒绝", "textures/ui/cancel");

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
			if (fromP) fromP.tell("§e[传送] §c" + p.name + " 未处理你的传送请求，请求仍在等待中");
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
		byPlayer.tell("§e[传送] §c该传送请求已失效");
		return;
	}

	// 二次校验请求是否超时（定时器可能还未触发清理）
	const now = Date.now();
	if (now - req.timestamp > tpsConfig.tpaTimeout * 1000) {
		delete teleportPendingRequests[reqId];
		byPlayer.tell("§e[传送] §c该传送请求已超时");
		return;
	}

	const fromPlayer = mc.getPlayer(req.fromXuid);
	const toPlayer = mc.getPlayer(req.toXuid);
	if (!fromPlayer || !toPlayer) {
		delete teleportPendingRequests[reqId];
		byPlayer.tell("§e[传送] §c对方不在线，传送取消");
		return;
	}

	// 扣除传送费用（从发起者扣除）
	if (tpsConfig.tpaCost > 0) {
		const bal = deps.getPlayerMoney(fromPlayer);
		if (bal < tpsConfig.tpaCost) {
			delete teleportPendingRequests[reqId];
			fromPlayer.tell("§e[传送] §c余额不足，传送取消");
			return;
		}
		deps.reducePlayerMoney(fromPlayer, tpsConfig.tpaCost, "互传费用");
	}

	delete teleportPendingRequests[reqId];

	// 根据请求类型执行不同的传送逻辑
	if (req.type === 'tpa') {
		const toPos = toPlayer.pos;
		safeTeleport(fromPlayer, toPos.x, toPos.y, toPos.z, toPos.dimid);
		fromPlayer.tell("§e[传送] §a已传送到 " + toPlayer.name + " 的位置");
		toPlayer.tell("§e[传送] §a" + fromPlayer.name + " 已传送到你的位置");
	} else if (req.type === 'tpn') {
		const fromPos = fromPlayer.pos;
		safeTeleport(toPlayer, fromPos.x, fromPos.y, fromPos.z, fromPos.dimid);
		fromPlayer.tell("§e[传送] §a" + toPlayer.name + " 已传送到你的位置");
		toPlayer.tell("§e[传送] §a已传送到 " + fromPlayer.name + " 的位置");
	}

	setTeleportCooldown(fromPlayer.xuid, 'tpa', tpsConfig.tpaCooldown);
}

/**
 * 拒绝TPA传送请求
 * @param {string} reqId - 请求ID
 * @param {Player} byPlayer - 拒绝请求的玩家
 */
function denyTpaRequest(reqId, byPlayer) {
	const req = teleportPendingRequests[reqId];
	if (!req) {
		byPlayer.tell("§e[传送] §c该传送请求已失效");
		return;
	}

	const fromPlayer = mc.getPlayer(req.fromXuid);
	delete teleportPendingRequests[reqId];

	byPlayer.tell("§e[传送] §a已拒绝传送请求");
	if (fromPlayer) {
		fromPlayer.tell("§e[传送] §c" + byPlayer.name + " 拒绝了你的传送请求");
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
		player.tell("§e[传送] §c没有待处理的传送请求");
		showTpaMainForm(player, deps);
		return;
	}

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§e待处理传送请求");

	pending.forEach(function(item) {
		const typeDesc = item.req.type === 'tpa' ? "传送到你" : item.req.type === 'tpn' ? "请你传送过去" : "互相传送";
		fm.addButton("§b" + item.req.fromName + " - " + typeDesc);
	});

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		const item = pending[id];
		if (!item) return;

		// 选中某个请求后弹出详情确认窗
		const subFm = mc.newSimpleForm();
		subFm.setTitle("§l§e传送请求详情");
		const typeDesc = item.req.type === 'tpa' ? "传送到你" : item.req.type === 'tpn' ? "请你传送过去" : "互相传送";
		subFm.setContent("§a玩家 §b" + item.req.fromName + " §a请求" + typeDesc);
		subFm.addButton("§a同意", "textures/ui/check");
		subFm.addButton("§c拒绝", "textures/ui/cancel");

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
	for (const reqId in teleportPendingRequests) {
		const req = teleportPendingRequests[reqId];
		if (req.fromXuid === player.xuid) {
			const toPlayer = mc.getPlayer(req.toXuid);
			if (toPlayer) {
				toPlayer.tell("§e[传送] §c" + player.name + " 取消了传送请求");
			}
			delete teleportPendingRequests[reqId];
			found = true;
		}
	}
	if (found) {
		player.tell("§e[传送] §a已取消所有传送请求");
	} else {
		player.tell("§e[传送] §c没有待处理的传送请求");
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
		player.tell("§e[传送] §c没有待处理的传送请求");
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
		player.tell("§e[传送] §c没有待处理的传送请求");
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
	if (!tpsConfig.enableHome) {
		player.tell("§e[传送] §c家园系统已关闭");
		return;
	}

	const xuid = player.xuid;
	const homes = getPlayerHomes(xuid);
	const sharedHomes = getSharedHomesForPlayer(player.name, deps);

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§6家园系统");
	fm.setContent("§a你拥有 §e" + homes.length + "/" + tpsConfig.homeLimit + " §a个家园" + (sharedHomes.length > 0 ? "§a，共享家园 §e" + sharedHomes.length + " §a个" : ""));

	if (homes.length > 0) {
		homes.forEach(function(home) {
			const dimName = home.dim === 0 ? "主世界" : home.dim === 1 ? "下界" : "末地";
			fm.addButton("§b" + home.name + "\n" + dimName + " (" + Math.floor(home.x) + ", " + Math.floor(home.y) + ", " + Math.floor(home.z) + ")", "textures/ui/icon_recipe_nature");
		});
	}

	// 追加他人共享给自己的家园按钮
	if (sharedHomes.length > 0) {
		sharedHomes.forEach(function(item) {
			const dimName = item.home.dim === 0 ? "主世界" : item.home.dim === 1 ? "下界" : "末地";
			fm.addButton("§d" + item.home.name + " (来自" + item.ownerName + ")\n" + dimName, "textures/ui/FriendsIcon");
		});
	}

	fm.addButton("§a设置家园", "textures/ui/color_plus");
	fm.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

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
			teleportToHome(p, sharedItem.home);
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

	if (homes.length >= tpsConfig.homeLimit) {
		player.tell("§e[家园] §c已达到家园数量上限（" + tpsConfig.homeLimit + "个）");
		showHomeMainForm(player, deps);
		return;
	}

	const fm = mc.newCustomForm();
	fm.setTitle("§l§6设置家园");
	fm.addInput("§a家园名称", "请输入家园名称");
	fm.addSwitch("§a是否公开（允许其他玩家传送）", false);

	player.sendForm(fm, function(p, data) {
		if (data == null) { showHomeMainForm(p, deps); return; }

		const name = String(data[0] || "").trim();
		if (!name) {
			p.tell("§e[家园] §c家园名称不能为空");
			showHomeSetForm(p, deps);
			return;
		}

		const existing = homes.some(function(h) { return h.name === name; });
		if (existing) {
			p.tell("§e[家园] §c已存在同名家园");
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
		saveHomesData();
		p.tell("§e[家园] §a家园 §b" + name + " §a设置成功！");
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
	const dimName = home.dim === 0 ? "主世界" : home.dim === 1 ? "下界" : "末地";

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§6家园 - " + home.name);
	fm.setContent(
		"§a名称：§f" + home.name + "\n" +
		"§a位置：§f" + dimName + " (" + Math.floor(home.x) + ", " + Math.floor(home.y) + ", " + Math.floor(home.z) + ")\n" +
		"§a公开：§f" + (home.public ? "是" : "否") + "\n" +
		"§a共享玩家：§f" + (home.sharedWith && home.sharedWith.length > 0 ? home.sharedWith.join(", ") : "无")
	);

	fm.addButton("§a传送", "textures/ui/icon_recipe_nature");
	fm.addButton("§e共享设置", "textures/ui/FriendsIcon");
	fm.addButton("§c删除家园", "textures/ui/trash_default");
	fm.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

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
function teleportToHome(player, home) {
	const cd = checkTeleportCooldown(player.xuid, 'home');
	if (cd > 0) {
		player.tell("§e[家园] §c请等待 " + cd + " 秒后再使用家园传送");
		return;
	}

	if (safeTeleport(player, home.x, home.y, home.z, home.dim)) {
		home.lastUse = Date.now();
		saveHomesData();
		setTeleportCooldown(player.xuid, 'home', tpsConfig.homeCooldown);
		player.tell("§e[家园] §a已传送到家园 §b" + home.name);
	} else {
		player.tell("§e[家园] §c传送失败，请稍后再试");
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
	fm.setTitle("§l§6共享设置 - " + home.name);

	const sharedList = home.sharedWith || [];
	fm.setContent("§a当前共享玩家：§f" + (sharedList.length > 0 ? sharedList.join(", ") : "无"));

	fm.addButton("§a添加共享玩家", "textures/ui/color_plus");

	if (sharedList.length > 0) {
		sharedList.forEach(function(name) {
			fm.addButton("§c移除 " + name, "textures/ui/cancel");
		});
	}

	fm.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

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
				saveHomesData();
				p.tell("§e[家园] §a已移除共享玩家 " + removeName);
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
	fm.setTitle("§l§6添加共享玩家");
	fm.addInput("§a玩家名称/UID/XUID", "输入玩家名称、UID或XUID");

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
			p.tell("§e[家园] §c未找到玩家 " + keyword);
			showHomeShareAddForm(p, home, homeIndex, deps);
			return;
		}

		// 显示搜索结果列表供选择
		var sf = mc.newSimpleForm();
		sf.setTitle("§l§6搜索结果 - " + keyword);
		sf.setContent("§a找到 " + results.length + " 个玩家，点击选择：");
		results.forEach(function(r) {
			sf.addButton("§e" + r.name + "\nUID: " + r.uid);
		});
		sf.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
		p.sendForm(sf, function(p2, id) {
			if (id === null || id === results.length) { showHomeShareAddForm(p2, home, homeIndex, deps); return; }
			var selected = results[id];
			if (!home.sharedWith) home.sharedWith = [];
			if (home.sharedWith.indexOf(selected.name) === -1) {
				home.sharedWith.push(selected.name);
				saveHomesData();
				p2.tell("§e[家园] §a已将 " + selected.name + " 添加到家园共享列表");
			} else {
				p2.tell("§e[家园] §c该玩家已在共享列表中");
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
	fm.setTitle("§l§c删除家园");
	fm.setContent("§c确定要删除家园 §b" + home.name + " §c吗？\n此操作不可撤销！");

	fm.addButton("§c确认删除", "textures/ui/trash_default");
	fm.addButton("§a取消", "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id == null) return;
		if (id === 1) {
			showHomeDetailForm(p, home, homeIndex, deps);
			return;
		}

		const homes = getPlayerHomes(p.xuid);
		homes.splice(homeIndex, 1);
		saveHomesData();
		p.tell("§e[家园] §a已删除家园 §b" + home.name);
		showHomeMainForm(p, deps);
	});
}

/**
 * 显示公共传送点列表，管理员可额外看到管理入口
 * @param {Player} player - 玩家
 * @param {object} deps - 依赖对象
 */
function showWarpMainForm(player, deps) {
	if (!tpsConfig.enableWarp) {
		player.tell("§e[传送] §c公共传送点系统已关闭");
		return;
	}

	const warpNames = Object.keys(warpsData);

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§d公共传送点");

	if (warpNames.length === 0) {
		fm.setContent("§c暂无公共传送点");
	} else {
		fm.setContent("§a共 §e" + warpNames.length + " §a个传送点");
		warpNames.forEach(function(name) {
			const warp = warpsData[name];
			const dimName = warp.dim === 0 ? "主世界" : warp.dim === 1 ? "下界" : "末地";
			fm.addButton("§b" + name + "\n" + dimName + " (" + Math.floor(warp.x) + ", " + Math.floor(warp.y) + ", " + Math.floor(warp.z) + ")", "textures/ui/icon_multiplayer");
		});
	}

	// permLevel > 0 表示管理员，显示管理按钮
	if (player.permLevel > 0) {
		fm.addButton("§6管理传送点（管理员）", "textures/ui/icon_setting");
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
		player.tell("§e[传送] §c传送点不存在");
		return;
	}

	// 扣除地标传送费用
	if (tpsConfig.warpCost > 0) {
		const bal = deps.getPlayerMoney(player);
		if (bal < tpsConfig.warpCost) {
			player.tell("§e[传送] §c余额不足，需要 " + tpsConfig.warpCost + " " + deps.getCurrencyName());
			return;
		}
		deps.reducePlayerMoney(player, tpsConfig.warpCost, "地标传送: " + warpName);
	}

	if (safeTeleport(player, warp.x, warp.y, warp.z, warp.dim)) {
		player.tell("§e[传送] §a已传送到 §b" + warpName);
	} else {
		player.tell("§e[传送] §c传送失败，请稍后再试");
		// 传送失败时退还费用
		if (tpsConfig.warpCost > 0) {
			deps.addPlayerMoney(player, tpsConfig.warpCost, "地标传送失败退款");
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
	fm.setTitle("§l§6传送点管理");
	fm.setContent("§a选择管理操作");

	fm.addButton("§a添加传送点", "textures/ui/color_plus");
	fm.addButton("§c删除传送点", "textures/ui/trash_default");
	fm.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

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
	fm.setTitle("§l§6添加传送点");
	fm.addInput("§a传送点名称", "请输入名称");
	fm.addInput("§a传送费用（0为免费）", "0");

	player.sendForm(fm, function(p, data) {
		if (data == null) { showWarpAdminForm(p, deps); return; }

		const name = String(data[0] || "").trim();
		if (!name) {
			p.tell("§e[传送] §c传送点名称不能为空");
			showWarpAddForm(p, deps);
			return;
		}

		if (warpsData[name]) {
			p.tell("§e[传送] §c已存在同名传送点");
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
		p.tell("§e[传送] §a传送点 §b" + name + " §a添加成功！");
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
		player.tell("§e[传送] §c暂无传送点可删除");
		showWarpAdminForm(player, deps);
		return;
	}

	const fm = mc.newSimpleForm();
	fm.setTitle("§l§c删除传送点");
	fm.setContent("§c选择要删除的传送点");

	warpNames.forEach(function(name) {
		fm.addButton("§c" + name);
	});

	player.sendForm(fm, function(p, id) {
		if (id == null) return;

		const name = warpNames[id];
		if (name && warpsData[name]) {
			delete warpsData[name];
			saveWarpsData();
			p.tell("§e[传送] §a已删除传送点 §b" + name);
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

			// 缓存上一层查询结果，每层从 3 次原生调用减为 2 次
			let prevAbove = null;
			let prevAbove2 = null;
			for (let y = 200; y >= -64; y--) {
				const block = prevAbove || mc.getBlock(new IntPos(x, y, z, dim));
				const blockAbove = prevAbove2 || mc.getBlock(new IntPos(x, y + 1, z, dim));
				const blockAbove2 = mc.getBlock(new IntPos(x, y + 2, z, dim));
				prevAbove = blockAbove;
				prevAbove2 = blockAbove2;
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
			let prevAbove = null;
			let prevAbove2 = null;
			for (let y = 127; y >= 0; y--) {
				const block = prevAbove || mc.getBlock(new IntPos(x, y, z, dim));
				const blockAbove = prevAbove2 || mc.getBlock(new IntPos(x, y + 1, z, dim));
				const blockAbove2 = mc.getBlock(new IntPos(x, y + 2, z, dim));
				prevAbove = blockAbove;
				prevAbove2 = blockAbove2;
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

		saveDeathPointData();
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
			"§c无死亡记录",
			"您还没有死亡记录！",
			"§a确定",
			"§c关闭",
			function() {}
		);
		return;
	}

	const menuForm = mc.newSimpleForm();
	menuForm.setTitle("§c§l死亡点返回");

	let content = "-------------------------\n";
	content += "§a您有 §e" + deathPoints.length + " §a条死亡记录\n";
	content += "点击选择要传送的位置\n";
	content += "-------------------------\n";

	menuForm.setContent(content);

	deathPoints.forEach(function(point, index) {
		const timeStr = point.time || "未知时间";
		const dimName = point.dimName || "未知维度";
		menuForm.addButton(
			"§c[" + (index + 1) + "] §f" + timeStr + "\n" + dimName + " §f(" + point.x + ", " + point.y + ", " + point.z + ")",
			"textures/ui/heart_new"
		);
	});

	menuForm.addButton("§c关闭", "textures/ui/cancel");

	player.sendForm(menuForm, function(p, buttonIndex) {
		if (buttonIndex == null) return;

		if (buttonIndex === deathPoints.length) {
			return;
		}

		if (buttonIndex < 0 || buttonIndex >= deathPoints.length) {
			p.tell("§c错误：无效的死亡记录索引！");
			return;
		}

		const selectedPoint = deathPoints[buttonIndex];

		if (!selectedPoint) {
			p.tell("§c错误：死亡记录数据不存在！");
			return;
		}

		const dimName = selectedPoint.dimName || "未知维度";
		const timeStr = selectedPoint.time || "未知时间";

		// 弹出二次确认窗，防止误传
		p.sendModalForm(
			"§c确认传送",
			"确定要传送到以下位置吗？\n\n" +
			"维度：§f" + dimName + "\n" +
			"坐标：§fX:" + selectedPoint.x + " Y:" + selectedPoint.y + " Z:" + selectedPoint.z + "\n" +
			"时间：§f" + timeStr,
			"§a确认传送",
			"§c取消",
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
		player.tell("§c传送失败：无效的死亡记录！");
		return;
	}

	const point = deathPoints[index];

	if (!point) {
		player.sendModalForm("§c死亡点", "§e死亡点数据不存在，可能已被清除。", "§a返回", "§c关闭", function(p, result) {
			if (result) showDeathPointMenu(p);
		});
		return;
	}

	try {
		const dimName = point.dimName || "未知维度";
		const x = point.x || 0;
		const y = point.y || 64;
		const z = point.z || 0;
		const dimId = point.dimId || 0;

		safeTeleport(player, x + 0.5, y, z + 0.5, dimId);
		player.tell("§a已传送到死亡点 [" + dimName + "] (" + x + ", " + y + ", " + z + ")");
		logger.info("[死亡点] 玩家 " + player.name + " 传送到死亡点：" + dimName + " (" + x + ", " + y + ", " + z + ")");
	} catch (error) {
		player.tell("§c传送失败：" + error.message);
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
            mc.runcmdEx('execute in ' + dimName + ' run tp "' + player.realName + '" ' + x + ' ' + y + ' ' + z);
            return true;
        } catch (e2) {
            try {
                player.runcmd('tp ' + x + ' ' + y + ' ' + z);
                return true;
            } catch (e3) { return false; }
        }
    }
}

/**
 * 将维度ID转换为中文名称
 * @param {number} dimId - 维度ID（0=主世界, 1=下界, 2=末地）
 * @returns {string} 维度中文名称
 */
function getDimensionName(dimId) {
	if (dimId === 0) return "主世界";
	if (dimId === 1) return "下界";
	if (dimId === 2) return "末地";
	return "未知维度(" + dimId + ")";
}

/**
 * 随机传送到安全位置，主世界范围内
 * @param {Player} player
 */
function showRtpConfirmForm(player) {
	if (!tpsConfig.enableRtp) {
		player.tell("§e[传送] §c随机传送功能已关闭");
		return;
	}
	var cd = checkTeleportCooldown(player.xuid, 'rtp');
	if (cd > 0) {
		player.tell("§e[传送] §c请等待 " + cd + " 秒后再使用随机传送");
		return;
	}
	var cost = tpsConfig.rtpCost || 0;
	var radius = tpsConfig.rtpRadius || 10000;
	var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '金币';
	var costText = cost > 0 ? "\n§a费用：§f" + cost + " " + currencyName : "";
	player.sendModalForm(
		"§a随机传送",
		"§a即将传送到主世界随机位置\n§a范围：§f" + radius + " 格" + costText + "\n\n§c确认传送？",
		"§a确认",
		"§c取消",
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
		if (!_deps.reducePlayerMoney || !_deps.reducePlayerMoney(player, cost, "随机传送")) {
			player.tell("§e[传送] §c余额不足，无法传送");
			return;
		}
	}
	var x = Math.floor(Math.random() * radius * 2) - radius;
	var z = Math.floor(Math.random() * radius * 2) - radius;
	var y = 320;
	player.sendText("§e[传送] §a正在寻找安全位置...", 0);
	// 尝试找安全地面高度，最多向下搜索64格
	try {
		var block = mc.getBlock(x, y, z, 0);
		if (block) {
			for (var tryY = y; tryY > 64; tryY--) {
				var b = mc.getBlock(x, tryY, z, 0);
				if (b && b.type !== 'minecraft:air' && b.type !== 'minecraft:water' && b.type !== 'minecraft:lava') {
					y = tryY + 1;
					break;
				}
			}
		}
	} catch (e) {}
	if (safeTeleport(player, x + 0.5, y, z + 0.5, 0)) {
		setTeleportCooldown(player.xuid, 'rtp', tpsConfig.rtpCooldown || 60);
		player.tell("§e[传送] §a已传送到随机位置 (" + x + ", " + y + ", " + z + ")");
	} else {
		player.tell("§e[传送] §c传送失败，请稍后再试");
		if (cost > 0 && _deps.addPlayerMoney) {
			_deps.addPlayerMoney(player, cost, "随机传送失败退款");
		}
	}
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
	tpsConfig: function() { return tpsConfig; },
	initDeathPoint: initDeathPoint,
	showRtpConfirmForm: showRtpConfirmForm,
	recordDeathPoint: recordDeathPoint,
	showDeathPointMenu: showDeathPointMenu,
	teleportToDeathPoint: teleportToDeathPoint,
	getDeathPointData: function() { return deathPointData; },
	safeTeleport: safeTeleport
};
