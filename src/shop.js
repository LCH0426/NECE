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
 * NECE 商店与回收系统
 * 商品购买/出售、物品回收、商店分组与物品管理
 */


const fs = require('fs');
const U = require('./utils');
const economyModule = require('./economy');

const RECYCLE_PAGE_SIZE = 10;
var _deps = {};

function init(deps) {
    _deps = deps || {};
}

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

/**
 * 写入购买日志（JSONL 格式，统一输出到 economy 日志）
 * @param {object} player - 玩家对象
 * @param {string} itemName - 物品名称
 * @param {number} count - 购买数量
 * @param {number} cost - 总花费
 * @param {number} balance - 购买后余额
 */
function writeShopLog(player, itemName, count, cost, balance) {
	try {
		economyModule.writeEconomyLog({
			action: 'buy',
			player: player.name,
			item: itemName,
			count: count,
			price: cost,
			balance: balance
		});
	} catch (e) {
		logger.error(t(getSystemLang(), 'shop.log_write_failed') + e.message);
	}
}

/**
 * 写入出售/回收日志（JSONL 格式，统一输出到 economy 日志）
 * @param {object} player - 玩家对象
 * @param {string} itemName - 物品名称
 * @param {number} count - 数量
 * @param {number} income - 收入
 * @param {number} balance - 出售后余额
 */
function writeShopSellLog(player, itemName, count, income, balance) {
	try {
		economyModule.writeEconomyLog({
			action: 'sell',
			player: player.name,
			item: itemName,
			count: count,
			price: income,
			balance: balance
		});
	} catch (e) {
		logger.error(t(getSystemLang(), 'shop.log_write_failed') + e.message);
	}
}

/**
 * 计算背包中可容纳指定物品的剩余空间
 * @param {object} player - 玩家对象
 * @param {string} itemId - 物品ID
 * @returns {number} 可容纳数量
 */
function calcInventorySpace(player, itemId) {
	let space = 0;
	player.getInventory().getAllItems().forEach(function(slot) {
		if (!slot) return;
		if (slot.type === '' || slot.type === 'minecraft:air') space += 64;
		else if (slot.type === itemId) space += 64 - slot.count;
	});
	return space;
}

/** 统计玩家背包中指定物品的持有总数 */
function countOwnedItems(player, itemId) {
	let total = 0;
	player.getInventory().getAllItems().forEach(function(slot) {
		if (slot && slot.type === itemId) total += slot.count;
	});
	return total;
}

/** 获取指定物品的回收价格 */
function getRecyclePrice(recycleConfig, itemType) {
	const recycleItems = recycleConfig.recycleItems || {};
	const entry = recycleItems[itemType];
	if (!entry) return 0;
	if (typeof entry === 'object') return entry.price || 0;
	return entry;
}

/** 获取回收物品的显示名称，配置中无名称则去掉minecraft:前缀 */
function getRecycleName(recycleConfig, itemType) {
	const recycleItems = recycleConfig.recycleItems || {};
	const entry = recycleItems[itemType];
	if (entry && typeof entry === 'object' && entry.name) return entry.name;
	return itemType.replace('minecraft:', '');
}

/** 获取回收物品的图标路径 */
function getRecycleImage(recycleConfig, itemType) {
	const recycleItems = recycleConfig.recycleItems || {};
	const entry = recycleItems[itemType];
	if (entry && typeof entry === 'object' && entry.image) return entry.image;
	return '';
}

/**
 * 遍历玩家背包，找出所有可回收物品并计算总价值
 * @returns {{ recyclable: object, totalValue: number }}
 */
function calculateRecyclableItems(player, recycleConfig) {
	const recycleItems = recycleConfig.recycleItems || {};
	const inventory = player.getInventory();
	const recyclable = {};
	let totalValue = 0;

	for (let i = 0; i < inventory.size; i++) {
		const item = inventory.getItem(i);
		if (!item || item.isNull()) continue;
		if (recycleItems[item.type]) {
			const itemType = item.type;
			const price = getRecyclePrice(recycleConfig, itemType);
			recyclable[itemType] = recyclable[itemType] || {
				count: 0,
				price: price
			};
			recyclable[itemType].count += item.count;
			totalValue += item.count * price;
		}
	}

	return {
		recyclable: recyclable,
		totalValue: totalValue
	};
}

/** 写入回收日志 */
function writeRecycleLog(player, items, totalValue, before, after) {
	try {
		var itemsStr = Object.entries(items)
			.map(function(entry) { return entry[0].replace('minecraft:', '') + '×' + entry[1].count; })
			.join(", ");
		economyModule.writeEconomyLog({
			action: 'recycle',
			player: player.name,
			price: totalValue,
			balance: after,
			detail: itemsStr
		});
	} catch (e) {
		logger.error(t(getSystemLang(), 'shop.log_recycle_write_failed') + e.message);
	}
}

/** 执行一键回收：确认后移除背包中所有可回收物品并发放货币 */
function recycleItemsFromInventory(player, recycleConfig, deps) {
	const lang = getLocale(player.xuid);
	const result = calculateRecyclableItems(player, recycleConfig);
	const recyclable = result.recyclable;
	const totalValue = result.totalValue;

	if (totalValue <= 0) {
		player.sendModalForm(t(lang, 'shop.recycle_title'), t(lang, 'shop.recycle_empty'), t(lang, 'shop.return_shop'), t(lang, 'shop.close'), function(p, result) {
			if (result) showShopMainForm(p, deps);
		});
		return;
	}

	// 构造物品摘要
	var itemNames = Object.keys(recyclable).map(function(type) {
		return getRecycleName(recycleConfig, type) + "×" + recyclable[type].count;
	}).join(t(lang, 'shop.enum_separator'));

	player.sendModalForm(t(lang, 'shop.recycle_confirm'), t(lang, 'shop.recycle_confirm_body') + itemNames + t(lang, 'shop.expected_gain') + totalValue + " " + deps.getCurrencyName(), t(lang, 'shop.confirm_recycle'), t(lang, 'shop.cancel'), function(p, result) {
		if (result !== true) return;
		const pLang = getLocale(p.xuid);
		// 重新计算当前背包中实际可回收物品，防止确认期间背包变动
		const actualResult = calculateRecyclableItems(p, recycleConfig);
		const actualRecyclable = actualResult.recyclable;
		const actualTotalValue = actualResult.totalValue;

		if (actualTotalValue <= 0) {
			p.tell(t(pLang, 'shop.recycle_empty_now'));
			return;
		}

		const currentBalance = deps.getPlayerMoney(p);

		// 逐槽位精确匹配：只清除确认时仍在该槽位的可回收物品
		const inventory = p.getInventory();
		let actualEarned = 0;
		for (let i = 0; i < inventory.size; i++) {
			const item = inventory.getItem(i);
			if (!item || item.isNull()) continue;
			if (actualRecyclable[item.type]) {
				const price = getRecyclePrice(recycleConfig, item.type);
				actualEarned += item.count * price;
				inventory.setItem(i, mc.newItem("minecraft:air", 0));
			}
		}
		p.refreshItems();

		if (actualEarned <= 0) {
			p.tell(t(pLang, 'shop.recycle_failed'));
			return;
		}

		deps.addPlayerMoney(p, actualEarned, t(pLang, 'shop.reason_recycle_all'));

		const newBalance = deps.getPlayerMoney(p);

		writeRecycleLog(p, actualRecyclable, actualEarned, currentBalance, newBalance);

		p.tell(t(pLang, 'shop.recycle_success'));
		p.tell(t(pLang, 'shop.shop_tag') + actualEarned + t(pLang, 'shop.item_price_suffix') + deps.getCurrencyName() + t(pLang, 'shop.balance_inline') + newBalance + t(pLang, 'shop.item_price_suffix') + deps.getCurrencyName() + "§r");
	});
}

/** 显示回收确认界面，列出可回收物品及总价值 */
function showRecycleForm(player, recycleConfig, deps) {
	const lang = getLocale(player.xuid);
	const result = calculateRecyclableItems(player, recycleConfig);
	const recyclable = result.recyclable;
	const totalValue = result.totalValue;

	if (Object.keys(recyclable).length === 0) {
		player.sendModalForm(t(lang, 'shop.recycle_title'), t(lang, 'shop.recycle_empty_msg'), t(lang, 'shop.return_shop'), t(lang, 'shop.close'), function(p, result) {
			if (result) showShopMainForm(p, deps);
		});
		return;
	}

	let content = t(lang, 'shop.recycle_items_title');

	Object.keys(recyclable).forEach(function(itemType) {
		const data = recyclable[itemType];
		const itemName = getRecycleName(recycleConfig, itemType);
		content += "§f" + itemName + " ×" + data.count + " §8| §e" + (data.count * data.price) + t(lang, 'shop.item_price_suffix') + deps.getCurrencyName() + "§r\n";
	});

	content += t(lang, 'shop.total_value') + totalValue + t(lang, 'shop.item_price_suffix') + deps.getCurrencyName() + "§r";

	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.item_recycle_title'));
	fm.setContent(content);
	fm.addButton(t(lang, 'shop.view_all_recyclable'), "textures/ui/icon_book_writable");
	fm.addButton(t(lang, 'shop.confirm_recycle_btn'));
	fm.addButton(t(lang, 'shop.cancel_btn'));

	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === 0) {
			showAllRecyclableItems(p, recycleConfig, deps, 0);
		} else if (id === 1) {
			recycleItemsFromInventory(p, recycleConfig, deps);
		}
	});
}

/** 分页显示所有可回收物品配置列表 */
function showAllRecyclableItems(player, recycleConfig, deps, page) {
	const lang = getLocale(player.xuid);
	const recycleItems = recycleConfig.recycleItems || {};
	const keys = Object.keys(recycleItems);
	if (keys.length === 0) {
		const fm = mc.newSimpleForm();
		fm.setTitle(t(lang, 'shop.all_recyclable_title'));
		fm.setContent(t(lang, 'shop.no_recyclable_config'));
		fm.addButton(t(lang, 'shop.back'), "textures/ui/recap_glyph_desaturated");
		player.sendForm(fm, function(p, id) {
			if (id === 0) showRecycleForm(p, recycleConfig, deps);
		});
		return;
	}

	const totalPages = Math.ceil(keys.length / RECYCLE_PAGE_SIZE);
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const start = page * RECYCLE_PAGE_SIZE;
	const end = Math.min(start + RECYCLE_PAGE_SIZE, keys.length);
	const pageKeys = keys.slice(start, end);

	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.all_recyclable_page') + (page + 1) + "/" + totalPages + ")");

	pageKeys.forEach(function(itemType) {
		const name = getRecycleName(recycleConfig, itemType);
		const price = getRecyclePrice(recycleConfig, itemType);
		const image = getRecycleImage(recycleConfig, itemType);
		fm.addButton(name + t(lang, 'shop.recycle_price') + price + deps.getCurrencyName(), image || "");
	});

	if (page > 0) {
		fm.addButton(t(lang, 'shop.prev_page'), "textures/ui/recap_glyph_desaturated");
	}
	if (page < totalPages - 1) {
		fm.addButton(t(lang, 'shop.next_page'), "textures/ui/recap_glyph_desaturated");
	}
	fm.addButton(t(lang, 'shop.back'), "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		const btnCount = pageKeys.length;

		// 构建导航按钮的回调映射
		var actions = [];
		if (page > 0) actions.push('prev');
		if (page < totalPages - 1) actions.push('next');
		actions.push('back');

		var navIdx = id - btnCount;
		if (navIdx < 0 || navIdx >= actions.length) return;
		var action = actions[navIdx];

		if (action === 'prev') {
			showAllRecyclableItems(p, recycleConfig, deps, page - 1);
		} else if (action === 'next') {
			showAllRecyclableItems(p, recycleConfig, deps, page + 1);
		} else {
			showRecycleForm(p, recycleConfig, deps);
		}
	});
}

/**
 * 计算指定等级升级到下一级所需经验值（Minecraft原版公式）
 * @param {number} level - 当前等级
 * @returns {number} 升级所需经验值
 */
function calculateXPNext(level) {
	if (level >= 0 && level <= 15) {
		return 2 * level + 7;
	} else if (level >= 16 && level <= 30) {
		return 5 * level - 38;
	} else if (level >= 31) {
		return 9 * level - 158;
	}
	return 0;
}

/**
 * 计算从当前等级升到目标等级所需的总经验值
 * @param {number} currentL - 当前等级
 * @param {number} currentXP - 当前等级内已有经验
 * @param {number} upgradeN - 要升的级数
 * @returns {number} 所需总XP
 */
function calculateTotalXP(currentL, currentXP, upgradeN) {
	let totalXP = 0;
	for (let i = 0; i < upgradeN; i++) {
		const targetLevel = currentL + i;
		const xpToNext = calculateXPNext(targetLevel);
		if (i === 0) {
			totalXP += (xpToNext - currentXP);
		} else {
			totalXP += xpToNext;
		}
	}
	return totalXP;
}

/** 显示经验购买表单 */
function showXPBuyForm(player, deps) {
	const lang = getLocale(player.xuid);
	const currentLevel = player.getLevel();
	const currentXPInLevel = player.getCurrentExperience();
	const xpToNextLevel = calculateXPNext(currentLevel);
	const needXPToCurrentNext = xpToNextLevel - currentXPInLevel;

	const xuid = player.xuid;
	const balance = deps.getPlayerMoney ? deps.getPlayerMoney(player) : (deps.money ? deps.money.get(xuid) || 0 : 0);

	const gui = mc.newCustomForm();
	gui.setTitle(t(lang, 'shop.xp_title'));

	let content = t(lang, 'shop.current_level') + currentLevel + t(lang, 'shop.level_suffix');
	content += t(lang, 'shop.current_progress') + currentXPInLevel + " / " + xpToNextLevel + "\n";
	content += t(lang, 'shop.next_level_need') + needXPToCurrentNext + t(lang, 'shop.exp_suffix');
	content += t(lang, 'shop.exchange_rate') + deps.getCurrencyName() + "\n";
	content += t(lang, 'shop.you_have') + balance + t(lang, 'shop.point_suffix') + deps.getCurrencyName() + "\n";

	gui.addLabel(content);

	const levelOptions = [t(lang, 'shop.manual_input_exp')];
	for (let i = 1; i <= 10; i++) {
		levelOptions.push(t(lang, 'shop.upgrade') + i + t(lang, 'shop.level_unit'));
	}
	gui.addStepSlider(t(lang, 'shop.select_upgrade_level'), levelOptions, 0, t(lang, 'shop.select_upgrade_tip'));

	gui.addInput(t(lang, 'shop.input_exp_amount'), t(lang, 'shop.input_exp_placeholder'), "");

	player.sendForm(gui, function(p, data) {
		if (data == null) return;
		const pLang = getLocale(p.xuid);

		const levelIndex = data[1];
		const customXP = data[2] || "";

		let xpAmount = 0;
		let useCustomXP = false;

		if (customXP) {
			const customXPAmount = parseInt(customXP);
			if (!isNaN(customXPAmount) && customXPAmount > 0) {
				xpAmount = customXPAmount;
				useCustomXP = true;
			}
		}

		if (!useCustomXP && levelIndex > 0) {
			const upgradeLevels = levelIndex;
			const newCurrentLevel = p.getLevel();
			const newCurrentXPInLevel = p.getCurrentExperience();
			xpAmount = calculateTotalXP(newCurrentLevel, newCurrentXPInLevel, upgradeLevels);
		}

		if (xpAmount < 1) {
			p.sendModalForm(
				t(pLang, 'shop.input_error_title'),
				t(pLang, 'shop.input_error_body'),
				t(pLang, 'shop.retry_input'),
				t(pLang, 'shop.close'),
				function(player, res) {
					if (res === true) showXPBuyForm(player, deps);
				}
			);
			return;
		}

		const cost = xpAmount * 10;
		const playerBalance = deps.money.get(p.xuid) || 0;

		if (playerBalance < cost) {
			p.sendModalForm(
				"§c" + deps.getCurrencyName() + t(pLang, 'shop.currency_insufficient'),
				t(pLang, 'shop.buy_exp_body') + xpAmount + t(pLang, 'shop.buy_exp_body2') + cost + t(pLang, 'shop.item_price_suffix') + deps.getCurrencyName() + t(pLang, 'shop.buy_exp_body3') + playerBalance + t(pLang, 'shop.item_price_suffix') + deps.getCurrencyName() + t(pLang, 'shop.buy_exp_body4') + deps.getCurrencyName() + t(pLang, 'shop.buy_exp_body5'),
				t(pLang, 'shop.return_btn'),
				t(pLang, 'shop.close'),
				function(player, res) {
					if (res === true) showXPBuyForm(player, deps);
				}
			);
			return;
		}

		showXPBuyConfirmForm(p, xpAmount, cost, playerBalance, deps);
	});

	return true;
}

/** 显示经验购买确认对话框 */
function showXPBuyConfirmForm(player, xpAmount, cost, playerBalance, deps) {
	const lang = getLocale(player.xuid);
	player.sendModalForm(
		t(lang, 'shop.confirm_purchase_title'),
		t(lang, 'shop.confirm_purchase_exp') + xpAmount + t(lang, 'shop.cost_label') + deps.getCurrencyName() + t(lang, 'shop.cost_label2') + cost + t(lang, 'shop.current_label') + deps.getCurrencyName() + t(lang, 'shop.cost_label2') + playerBalance + t(lang, 'shop.after_purchase') + (playerBalance - cost) + t(lang, 'shop.item_price_suffix'),
		t(lang, 'shop.confirm_btn'),
		t(lang, 'shop.cancel'),
		function(p, isConfirm) {
			if (!p) return;
			const pLang = getLocale(p.xuid);
			if (!isConfirm) {
				showXPBuyForm(p, deps);
				return;
			}

			const xuid = p.xuid;
			const reduceSuccess = deps.reducePlayerMoney(p, cost, t(pLang, 'shop.reason_buy_exp'));

			if (reduceSuccess) {
				const addXPSuccess = p.addExperience(xpAmount);

				if (addXPSuccess) {
					const newLevel = p.getLevel();
					const remainingBalance = deps.money.get(xuid) || 0;

					p.sendModalForm(
						t(pLang, 'shop.purchase_success'),
						t(pLang, 'shop.purchase_success_exp') + xpAmount + t(pLang, 'shop.exp_suffix2') + newLevel + t(pLang, 'shop.level_suffix') + t(pLang, 'shop.cost_label_inline') + deps.getCurrencyName() + t(pLang, 'shop.cost_label2') + cost + t(pLang, 'shop.item_price_suffix') + t(pLang, 'shop.remaining_label') + deps.getCurrencyName() + t(pLang, 'shop.cost_label2') + remainingBalance + t(pLang, 'shop.item_price_suffix'),
						t(pLang, 'shop.continue_buy'),
						t(pLang, 'shop.done'),
						function(pl, isContinue) {
							if (!pl) return;
							if (isContinue) showXPBuyForm(pl, deps);
						}
					);
				} else {
					// 经验添加失败，退还已扣除的货币
					deps.addPlayerMoney(p, cost, t(pLang, 'shop.reason_refund_exp'));
					p.sendModalForm(
						t(pLang, 'shop.purchase_failed'),
						t(pLang, 'shop.exp_add_failed_refund') + cost + t(pLang, 'shop.item_price_suffix') + deps.getCurrencyName(),
						t(pLang, 'shop.confirm_ok'),
						t(pLang, 'shop.close'),
						function(pl, res) {
							if (res === true) showXPBuyForm(pl, deps);
						}
					);
				}
			} else {
				p.sendModalForm(
					t(pLang, 'shop.purchase_failed'),
					t(pLang, 'shop.deduct_failed'),
					t(pLang, 'shop.confirm_ok'),
					t(pLang, 'shop.close'),
					function(pl, res) {
						if (res === true) showXPBuyForm(pl, deps);
					}
				);
			}
		}
	);
}

/** 显示商店主界面 */
function showShopMainForm(player, deps) {
	const lang = getLocale(player.xuid);
	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.main_title'));
	fm.setContent(t(lang, 'shop.select_function'));
	fm.addButton(t(lang, 'shop.btn_buy'), "textures/ui/icon_recipe_equipment");
	fm.addButton(t(lang, 'shop.btn_sell'), "textures/ui/trash_default");
	fm.addButton(t(lang, 'shop.close'), "textures/ui/cancel");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === 2) return;
		if (id === 0) showBuyMenu(p, deps);
		else if (id === 1) showSellMenu(p, deps);
	});
}

/** 显示购买分类菜单 */
function showBuyMenu(player, deps) {
	const lang = getLocale(player.xuid);
	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.buy_title'));
	fm.addButton(t(lang, 'shop.search_items'), "textures/ui/magnifyingGlass");
	if (deps.shopData && deps.shopData.Buy) {
		deps.shopData.Buy.forEach(function(grp) {
			fm.addButton(grp.name, grp.image || "");
		});
	}
	fm.addButton(t(lang, 'shop.return_prev'), "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === 0) {
			showBuySearchForm(p, deps);
		} else if (deps.shopData && deps.shopData.Buy && id <= deps.shopData.Buy.length) {
			showBuyGroupForm(p, deps.shopData.Buy[id - 1], deps);
		} else {
			showShopMainForm(p, deps);
		}
	});
}

/** 显示购买搜索输入表单 */
function showBuySearchForm(player, deps) {
	const lang = getLocale(player.xuid);
	const fm = mc.newCustomForm();
	fm.setTitle(t(lang, 'shop.search_title'));
	fm.addInput(t(lang, 'shop.search_placeholder'), "", "");
	player.sendForm(fm, function(p, data) {
		if (data == null || !data || typeof data[0] !== 'string' || !data[0].trim()) {
			showBuyMenu(p, deps);
			return;
		}
		const kw = data[0].trim().toLowerCase();
		if (!kw) { showBuyMenu(p, deps); return; }
		showBuySearchResults(p, kw, deps);
	});
}

/** 按关键词模糊搜索所有商品分组中的物品 */
function showBuySearchResults(player, keyword, deps) {
	const lang = getLocale(player.xuid);
	const results = [];
	if (deps.shopData && deps.shopData.Buy) {
		deps.shopData.Buy.forEach(function(grp) {
			(grp.items || []).forEach(function(it) {
				if (!it.name || !it.id) return;
				if (it.name.toLowerCase().indexOf(keyword) >= 0 || it.id.toLowerCase().indexOf(keyword) >= 0) {
					results.push(it);
				}
			});
		});
	}
	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.search_prefix') + keyword);
	if (results.length === 0) {
		fm.setContent(t(lang, 'shop.no_match'));
	}
	results.forEach(function(it) {
		fm.addButton(it.name + t(lang, 'shop.price_prefix') + it.money + deps.getCurrencyName() + t(lang, 'shop.per_unit'), it.image || "");
	});
	fm.addButton(t(lang, 'shop.re_search'), "textures/ui/magnifyingGlass");
	fm.addButton(t(lang, 'shop.return_upper'), "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === results.length) showBuySearchForm(p, deps);
		else if (id === results.length + 1) showBuyMenu(p, deps);
		else if (id < results.length) showBuyItemForm(p, results[id], deps);
	});
}

/** 显示某个商品分组内的物品列表 */
function showBuyGroupForm(player, group, deps) {
	const lang = getLocale(player.xuid);
	const items = group.items || [];
	const fm = mc.newSimpleForm();
	fm.setTitle(group.name);
	items.forEach(function(it) {
		fm.addButton(it.name + t(lang, 'shop.price_prefix') + it.money + deps.getCurrencyName() + t(lang, 'shop.per_unit'), it.image || "");
	});
	fm.addButton(t(lang, 'shop.return_prev'), "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === items.length) {
			showBuyMenu(p, deps);
			return;
		}
		if (id < items.length) showBuyItemForm(p, items[id], deps);
	});
}

/**
 * 显示购买详情表单：展示价格（VIP 85折）、余额、背包空间，输入购买数量
 * 支持手动输入和滑块快速选择
 */
function showBuyItemForm(player, item, deps) {
	const lang = getLocale(player.xuid);
	const vipInfo = deps.getVipInfo(player);
	const hasVip = vipInfo.hasVip;
	const discount = hasVip ? 0.85 : 1;
	const unitPrice = item.money;
	const discountPrice = Math.floor(unitPrice * discount);
	const balance = deps.getPlayerMoney(player);
	const invSpace = calcInventorySpace(player, item.id);

	let content = t(lang, 'shop.item_id') + item.id.replace("minecraft:", "") + "\n";
	content += t(lang, 'shop.price_label') + unitPrice + deps.getCurrencyName() + t(lang, 'shop.per_unit') + "\n";
	if (hasVip) {
		content += t(lang, 'shop.vip_price') + discountPrice + deps.getCurrencyName() + t(lang, 'shop.per_unit') + "\n";
	}
	content += t(lang, 'shop.balance_label') + balance + " " + deps.getCurrencyName() + "\n";
	content += t(lang, 'shop.inventory_space') + invSpace + t(lang, 'shop.slot_unit');

	const fm = mc.newCustomForm();
	fm.setTitle(item.name);
	fm.addLabel(content);
	fm.addInput(t(lang, 'shop.input_buy_count'), t(lang, 'shop.positive_int'), "");
	fm.addSlider(t(lang, 'shop.quick_select_count'), 0, 128, 1, 0);
	player.sendForm(fm, function(p, data) {
		if (data == null || !Array.isArray(data)) return;
		const pLang = getLocale(p.xuid);
		const inputStr = (data[1] || "").trim();
		const sliderVal = data[2] || 0;
		let count;
		if (sliderVal > 0) {
			count = sliderVal;
		} else if (inputStr && U.isInteger(inputStr) && Number(inputStr) > 0) {
			count = Number(inputStr);
		} else {
			p.tell(t(pLang, 'shop.invalid_buy_count'));
			showBuyItemForm(p, item, deps);
			return;
		}
		if (count <= 0) {
			p.tell(t(pLang, 'shop.count_positive'));
			showBuyItemForm(p, item, deps);
			return;
		}

		const price = hasVip ? discountPrice : unitPrice;
		const totalCost = price * count;
		const currentBalance = deps.getPlayerMoney(p);
		const currentSpace = calcInventorySpace(p, item.id);

		if (currentBalance < totalCost) {
			p.sendModalForm(t(pLang, 'shop.insufficient_balance'), t(pLang, 'shop.need_prefix') + totalCost + " " + deps.getCurrencyName() + t(pLang, 'shop.current_balance') + currentBalance + " " + deps.getCurrencyName(), t(pLang, 'shop.return_reselect'), t(pLang, 'shop.close'), function(pl, ok) {
				if (ok === true) showBuyItemForm(pl, item, deps);
			});
			return;
		}
		if (currentSpace < count) {
			p.sendModalForm(t(pLang, 'shop.insufficient_inventory'), t(pLang, 'shop.need_space') + count + t(pLang, 'shop.space_suffix') + currentSpace + t(pLang, 'shop.slot_unit'), t(pLang, 'shop.return_reselect'), t(pLang, 'shop.close'), function(pl, ok) {
				if (ok === true) showBuyItemForm(pl, item, deps);
			});
			return;
		}

		p.sendModalForm(t(pLang, 'shop.confirm_purchase'), item.name + " x" + count + "\n" + t(pLang, 'shop.cost_prefix') + totalCost + " " + deps.getCurrencyName(), t(pLang, 'shop.confirm_btn'), t(pLang, 'shop.cancel'), function(pl, ok) {
			if (!ok) return;
			executePurchase(pl, item, count, price, totalCost, hasVip, unitPrice, deps);
		});
	});
}

/** 执行购买逻辑：扣款、发放物品、VIP折扣累计、写日志 */
function executePurchase(player, item, count, unitPrice, totalCost, hasVip, originalUnitPrice, deps) {
	const lang = getLocale(player.xuid);
	if (!deps.reducePlayerMoney(player, totalCost, t(lang, 'shop.reason_buy'))) {
		player.tell(t(lang, 'shop.buy_deduct_failed'));
		return;
	}
	deps.giveItemById(player, item.id, count);

	if (hasVip) {
		const saved = originalUnitPrice * count - totalCost;
		const xuid = player.xuid;
		if (deps.playerData.players[xuid] && deps.playerData.players[xuid].vipdata) {
			deps.playerData.players[xuid].vipdata.totalSaved = (deps.playerData.players[xuid].vipdata.totalSaved || 0) + saved;
		}
		deps.savePlayerDataNow();
	}

	const newBalance = deps.getPlayerMoney(player);
	writeShopLog(player, item.name, count, totalCost, newBalance);
	player.tell(t(lang, 'shop.buy_success_msg') + item.name + " x" + count + t(lang, 'shop.cost_msg') + totalCost + deps.getCurrencyName() + t(lang, 'shop.balance_msg') + newBalance + deps.getCurrencyName());
	player.sendModalForm(t(lang, 'shop.buy_success_title'), item.name + " x" + count + "\n" + t(lang, 'shop.cost_prefix') + totalCost + " " + deps.getCurrencyName() + "\n" + t(lang, 'shop.balance_label') + newBalance + " " + deps.getCurrencyName(), t(lang, 'shop.return_shopping'), t(lang, 'shop.close'), function(pl, ok) {
		if (ok === true) showBuyMenu(pl, deps);
	});
}

/** 显示出售/回收菜单 */
function showSellMenu(player, deps) {
	const lang = getLocale(player.xuid);
	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.sell_title'));
	fm.addButton(t(lang, 'shop.search_items'), "textures/ui/magnifyingGlass");
	fm.addButton(t(lang, 'shop.one_click_recycle'), "textures/ui/refresh");
	if (deps.shopData && deps.shopData.Sell) {
		deps.shopData.Sell.forEach(function(grp) {
			fm.addButton(grp.name, grp.image || "");
		});
	}
	fm.addButton(t(lang, 'shop.return_prev'), "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === 0) {
			showSellSearchForm(p, deps);
		} else if (id === 1) {
			showRecycleForm(p, deps.recycleConfig, deps);
		} else if (deps.shopData && deps.shopData.Sell && id <= deps.shopData.Sell.length + 1) {
			showSellGroupForm(p, deps.shopData.Sell[id - 2], deps);
		} else {
			showShopMainForm(p, deps);
		}
	});
}

/** 显示出售搜索输入表单 */
function showSellSearchForm(player, deps) {
	const lang = getLocale(player.xuid);
	const fm = mc.newCustomForm();
	fm.setTitle(t(lang, 'shop.search_recycle_title'));
	fm.addInput(t(lang, 'shop.search_placeholder'), "", "");
	player.sendForm(fm, function(p, data) {
		if (data == null || !data || typeof data[0] !== 'string' || !data[0].trim()) {
			showSellMenu(p, deps);
			return;
		}
		const kw = data[0].trim().toLowerCase();
		if (!kw) { showSellMenu(p, deps); return; }
		showSellSearchResults(p, kw, deps);
	});
}

/** 按关键词模糊搜索回收物品 */
function showSellSearchResults(player, keyword, deps) {
	const lang = getLocale(player.xuid);
	const results = [];
	if (deps.shopData && deps.shopData.Sell) {
		deps.shopData.Sell.forEach(function(grp) {
			(grp.items || []).forEach(function(it) {
				if (!it.name || !it.id) return;
				if (it.name.toLowerCase().indexOf(keyword) >= 0 || it.id.toLowerCase().indexOf(keyword) >= 0) {
					results.push(it);
				}
			});
		});
	}
	const fm = mc.newSimpleForm();
	fm.setTitle(t(lang, 'shop.search_recycle_prefix') + keyword);
	if (results.length === 0) {
		fm.setContent(t(lang, 'shop.no_match'));
	}
	results.forEach(function(it) {
		fm.addButton(it.name + t(lang, 'shop.recycle_price_label') + it.money + deps.getCurrencyName() + t(lang, 'shop.per_unit'), it.image || "");
	});
	fm.addButton(t(lang, 'shop.re_search'), "textures/ui/magnifyingGlass");
	fm.addButton(t(lang, 'shop.return_upper'), "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === results.length) showSellSearchForm(p, deps);
		else if (id === results.length + 1) showSellMenu(p, deps);
		else if (id < results.length) showSellItemForm(p, results[id], deps);
	});
}

/** 显示某个回收分组内的物品列表 */
function showSellGroupForm(player, group, deps) {
	const lang = getLocale(player.xuid);
	const items = group.items || [];
	const fm = mc.newSimpleForm();
	fm.setTitle(group.name);
	items.forEach(function(it) {
		fm.addButton(it.name + t(lang, 'shop.recycle_price_label') + it.money + deps.getCurrencyName() + t(lang, 'shop.per_unit'), it.image || "");
	});
	fm.addButton(t(lang, 'shop.return_prev'), "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === items.length) {
			showSellMenu(p, deps);
			return;
		}
		if (id < items.length) showSellItemForm(p, items[id], deps);
	});
}

/** 显示出售详情表单：回收价、持有数量，支持全部出售或输入数量 */
function showSellItemForm(player, item, deps) {
	const lang = getLocale(player.xuid);
	const balance = deps.getPlayerMoney(player);
	const owned = countOwnedItems(player, item.id);

	let content = t(lang, 'shop.item_id') + item.id.replace("minecraft:", "") + "\n";
	content += t(lang, 'shop.recycle_price_label2') + item.money + deps.getCurrencyName() + t(lang, 'shop.per_unit') + "\n";
	content += t(lang, 'shop.balance_label') + balance + " " + deps.getCurrencyName() + "\n";
	content += t(lang, 'shop.owned_count') + owned + t(lang, 'shop.count_unit');

	const fm = mc.newCustomForm();
	fm.setTitle(item.name);
	fm.addLabel(content);
	fm.addSwitch(t(lang, 'shop.sell_all'), false);
	fm.addInput(t(lang, 'shop.input_sell_count'), t(lang, 'shop.positive_int'), "");
	player.sendForm(fm, function(p, data) {
		if (data == null || !Array.isArray(data)) return;
		const pLang = getLocale(p.xuid);
		const sellAll = data[1] || false;
		const inputStr = (data[2] || "").trim();
		let count;
		if (sellAll) {
			const ownedCount = countOwnedItems(p, item.id);
			if (ownedCount <= 0) {
				p.sendModalForm(t(pLang, 'shop.insufficient_items'), t(pLang, 'shop.no_item'), t(pLang, 'shop.return_reselect'), t(pLang, 'shop.close'), function(pl, ok) {
					if (ok === true) showSellItemForm(pl, item, deps);
				});
				return;
			}
			count = ownedCount;
		} else if (inputStr && U.isInteger(inputStr) && Number(inputStr) > 0) {
			count = Number(inputStr);
		} else {
			p.tell(t(pLang, 'shop.invalid_sell_count'));
			showSellItemForm(p, item, deps);
			return;
		}
		if (count <= 0) {
			p.tell(t(pLang, 'shop.sell_count_positive'));
			showSellItemForm(p, item, deps);
			return;
		}

		const currentOwned = countOwnedItems(p, item.id);
		if (currentOwned === 0) {
			p.sendModalForm(t(pLang, 'shop.insufficient_items'), t(pLang, 'shop.no_item'), t(pLang, 'shop.return_reselect'), t(pLang, 'shop.close'), function(pl, ok) {
				if (ok === true) showSellItemForm(pl, item, deps);
			});
			return;
		}
		if (count > currentOwned) {
			p.sendModalForm(t(pLang, 'shop.insufficient_count'), t(pLang, 'shop.need_count') + count + t(pLang, 'shop.current_held') + currentOwned + t(pLang, 'shop.count_unit'), t(pLang, 'shop.return_reselect'), t(pLang, 'shop.close'), function(pl, ok) {
				if (ok === true) showSellItemForm(pl, item, deps);
			});
			return;
		}

		const income = count * item.money;
		p.sendModalForm(t(pLang, 'shop.recycle_confirm'), item.name + " x" + count + "\n" + t(pLang, 'shop.obtained') + income + " " + deps.getCurrencyName(), t(pLang, 'shop.confirm_recycle'), t(pLang, 'shop.cancel'), function(pl, ok) {
			if (!ok) return;
			executeSell(pl, item, count, income, deps);
		});
	});
}

/** 执行出售逻辑：先增加货币，再移除物品，防止货币发放失败时物品丢失 */
function executeSell(player, item, count, income, deps) {
	const lang = getLocale(player.xuid);
	// 先加钱，加钱失败则不扣物品
	if (!deps.addPlayerMoney(player, income, t(lang, 'shop.reason_sell'))) {
		player.tell(t(lang, 'shop.sell_failed'));
		return;
	}
	// 加钱成功后再移除物品
	mc.runcmd('clear "' + player.realName + '" ' + item.id + ' 0 ' + count);
	const newBalance = deps.getPlayerMoney(player);
	writeShopSellLog(player, item.name, count, income, newBalance);
	player.tell(t(lang, 'shop.sell_success_msg') + item.name + " x" + count + t(lang, 'shop.sell_obtained') + income + deps.getCurrencyName() + t(lang, 'shop.balance_msg') + newBalance + deps.getCurrencyName());
	player.sendModalForm(t(lang, 'shop.recycle_success_title'), item.name + " x" + count + "\n" + t(lang, 'shop.obtained') + income + " " + deps.getCurrencyName() + "\n" + t(lang, 'shop.balance_label') + newBalance + " " + deps.getCurrencyName(), t(lang, 'shop.return_recycle'), t(lang, 'shop.close'), function(pl, ok) {
		if (ok === true) showSellMenu(pl, deps);
	});
}

module.exports = {
	init: init,
	showShopMainForm: showShopMainForm,
	showRecycleForm: showRecycleForm,
	showXPBuyForm: showXPBuyForm
};
