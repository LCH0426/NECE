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
 * NLCE 快捷菜单系统
 * 每个玩家可从全局菜单项中选择最多5个快捷入口，通过/qcd、/qmenu命令或右键指南针触发
 * 菜单项配置由 quickMenuConfigDM 管理，玩家选择存储在 playerData.quickmenu.slots 中
 */

let _deps = {};
let quickMenuConfig = { items: [] };  // 全局菜单配置 { items: [{ name, img, comm }] }

/**
 * 初始化快捷菜单模块
 * @param {object} deps - 依赖对象
 */
function init(deps) {
	_deps = deps;
}

/**
 * 从 DataManager 加载菜单配置，并将名称中的"星茜"替换为当前货币名
 */
function loadConfig() {
	quickMenuConfig = _deps.quickMenuConfigDM.load();
	const cn = _deps.getCurrencyName();
	(quickMenuConfig.items || []).forEach(function(btn) {
		if (btn.name) btn.name = btn.name.replace(/星茜/g, cn);
	});
}

/**
 * 获取玩家的快捷菜单配置，首次访问时自动初始化为空槽位
 * @param {string} xuid - 玩家XUID
 * @returns {{ slots: number[] }} 玩家菜单配置，slots为菜单项索引数组
 */
function getPlayerQuickMenu(xuid) {
	let p = _deps.getPlayerData().players[xuid];
	if (!p) return { slots: [] };
	if (!p.quickmenu) {
		p.quickmenu = { slots: [] };
	}
	return p.quickmenu;
}

/**
 * 更新玩家的快捷菜单槽位并保存
 * @param {string} xuid - 玩家XUID
 * @param {number[]} slots - 新的槽位索引数组
 */
function setPlayerQuickMenu(xuid, slots) {
	const p = _deps.getPlayerData().players[xuid];
	if (!p) return;
	if (!p.quickmenu) {
		p.quickmenu = { slots: [] };
	}
	p.quickmenu.slots = slots;
	_deps.savePlayerData();
}

/**
 * 显示快捷菜单表单，点击按钮执行对应命令，最后一个按钮为编辑入口
 * @param {Player} player - 玩家
 */
function showQuickMenu(player) {
	let xuid = player.xuid;
	let playerMenu = getPlayerQuickMenu(xuid);
	let gui = mc.newSimpleForm();
	gui.setTitle("§l§a快捷菜单");

	if (!playerMenu.slots || playerMenu.slots.length === 0) {
		gui.setContent("§e您还没有设置快捷菜单\n§a请点击下方按钮进行设置");
	} else {
		gui.setContent("§a点击按钮快速执行命令");
		playerMenu.slots.forEach(function(slotIndex) {
			let item = quickMenuConfig.items[slotIndex];
			if (item) {
				gui.addButton(item.name, item.img);
			}
		});
	}

	// 最后一个固定按钮：修改菜单设置
	gui.addButton("§e§l修改快捷菜单", "textures/ui/icon_setting");

	player.sendForm(gui, function(p, id) {
		if (id === null || id === undefined) return;

		const slots = playerMenu.slots || [];
		if (id < slots.length) {
			// 点击了某个菜单项，执行其绑定的命令
			const slotIndex = slots[id];
			const item = quickMenuConfig.items[slotIndex];
			if (item) {
				p.runcmd(item.comm);
			}
		} else {
			// 点击了"修改快捷菜单"按钮
			showEditQuickMenu(p);
		}
	});
}

/**
 * 显示编辑快捷菜单的自定义表单，提供5个下拉框选择菜单项（去重）
 * @param {Player} player - 玩家
 */
function showEditQuickMenu(player) {
	let xuid = player.xuid;
	const playerMenu = getPlayerQuickMenu(xuid);
	const currentSlots = playerMenu.slots || [];

	const gui = mc.newCustomForm();
	gui.setTitle("§l§e编辑快捷菜单");
	gui.addLabel("§a请选择最多5个快捷功能（重复选择会忽略）：");

	// 下拉框选项：第一个为"不选择"，后续为所有可用菜单项
	const options = quickMenuConfig.items.map(function(item) { return item.name; });
	options.unshift("§c不选择");

	for (let i = 0; i < 5; i++) {
		// 当前槽位的索引+1对应下拉框选项（+1因为第0项是"不选择"）
		const defaultIndex = currentSlots[i] !== undefined ? currentSlots[i] + 1 : 0;
		gui.addDropdown("快捷入口 " + (i + 1), options, Math.min(defaultIndex, options.length - 1));
	}

	gui.addLabel("§e提示：选择后会覆盖之前的设置");

	player.sendForm(gui, function(p, data) {
		if (data === null || data === undefined) {
			showQuickMenu(p);
			return;
		}

		const newSlots = [];
		const selectedSet = {};  // 用于去重，已选中的菜单项索引不再重复添加

		// data[0]是label，data[1]~data[5]是5个下拉框的选中值
		for (let i = 1; i <= 5; i++) {
			const selectedIndex = data[i];
			if (selectedIndex > 0 && !selectedSet[selectedIndex]) {
				selectedSet[selectedIndex] = true;
				newSlots.push(selectedIndex - 1);  // 转换回菜单项索引
			}
		}

		setPlayerQuickMenu(p.xuid, newSlots);
		p.tell("§a快捷菜单已更新！共设置 " + newSlots.length + " 个快捷入口");
		showQuickMenu(p);
	});
}

/**
 * 注册 qcd/qmenu 游戏内命令，绑定到快捷菜单打开函数
 * @param {function} registerPlayerCommand - 玩家命令注册函数
 */
function registerCommands(registerPlayerCommand) {
	registerPlayerCommand("qcd", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
	registerPlayerCommand("qmenu", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
}

/**
 * 注册指南针右键监听：手持指南针右键方块打开快捷菜单
 * 内置1秒防抖，防止连续触发；玩家退出时清理冷却记录
 */
function registerCompassListener() {
	const quickMenuCooldown = {};  // xuid -> 上次触发时间戳

	mc.listen("onUseItemOn", function(player, item) {
		if (item && item.type === "minecraft:compass") {
			const xuid = player.xuid;
			const now = Date.now();
			const lastUse = quickMenuCooldown[xuid] || 0;

			// 1秒内重复使用则忽略
			if (now - lastUse < 1000) {
				return false;
			}

			quickMenuCooldown[xuid] = now;
			showQuickMenu(player);
			return false;
		}
	});

	// 玩家退出时清理其冷却记录，防止内存泄漏
	mc.listen("onLeft", function(player) {
		delete quickMenuCooldown[player.xuid];
	});
}

module.exports = {
	init: init,
	loadConfig: loadConfig,
	showQuickMenu: showQuickMenu,
	registerCommands: registerCommands,
	registerCompassListener: registerCompassListener
};
