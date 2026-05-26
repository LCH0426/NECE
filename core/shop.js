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
 * NLCE 商店与回收系统
 * 商品购买/出售、物品回收、商店分组与物品管理
 */


const fs = require('fs');
const U = require('./utils');

var RECYCLE_PAGE_SIZE = 10;

function writeShopLog(player, itemName, count, cost, balance) {
	try {
		var logDir = "plugins/NLCE/logs";
		var logPath = logDir + "/shop.log";
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}
		var timeStr = new Date().toLocaleString();
		var entry = timeStr + " | " + player.name + "买了" + count + "个" + itemName + " 花费" + cost + " 余额" + balance + "\n";
		fs.appendFile(logPath, entry, 'utf-8', function(e) {
			if (e) logger.error("写入商店日志失败: " + e.message);
		});
	} catch (e) {
		logger.error("写入商店日志失败: " + e.message);
	}
}

function writeShopSellLog(player, itemName, count, income, balance) {
	try {
		var logDir = "plugins/NLCE/logs";
		var logPath = logDir + "/shop.log";
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}
		var timeStr = new Date().toLocaleString();
		var entry = timeStr + " | " + player.name + "卖了" + count + "个" + itemName + " 获得" + income + " 余额" + balance + "\n";
		fs.appendFile(logPath, entry, 'utf-8', function(e) {
			if (e) logger.error("写入商店日志失败: " + e.message);
		});
	} catch (e) {
		logger.error("写入商店日志失败: " + e.message);
	}
}

function calcInventorySpace(player, itemId) {
	var space = 0;
	player.getInventory().getAllItems().forEach(function(slot) {
		if (slot.type === '') space += 64;
		else if (slot.type === itemId) space += 64 - slot.count;
	});
	return space;
}

function countOwnedItems(player, itemId) {
	var total = 0;
	player.getInventory().getAllItems().forEach(function(slot) {
		if (slot && slot.type === itemId) total += slot.count;
	});
	return total;
}

function getRecyclePrice(recycleConfig, itemType) {
	var recycleItems = recycleConfig.recycleItems || {};
	var entry = recycleItems[itemType];
	if (!entry) return 0;
	if (typeof entry === 'object') return entry.price || 0;
	return entry;
}

function getRecycleName(recycleConfig, itemType) {
	var recycleItems = recycleConfig.recycleItems || {};
	var entry = recycleItems[itemType];
	if (entry && typeof entry === 'object' && entry.name) return entry.name;
	return itemType.replace('minecraft:', '');
}

function getRecycleImage(recycleConfig, itemType) {
	var recycleItems = recycleConfig.recycleItems || {};
	var entry = recycleItems[itemType];
	if (entry && typeof entry === 'object' && entry.image) return entry.image;
	return '';
}

function calculateRecyclableItems(player, recycleConfig) {
	var recycleItems = recycleConfig.recycleItems || {};
	var inventory = player.getInventory();
	var recyclable = {};
	var totalValue = 0;

	for (var i = 0; i < inventory.size; i++) {
		var item = inventory.getItem(i);
		if (!item.isNull() && recycleItems[item.type]) {
			var itemType = item.type;
			var price = getRecyclePrice(recycleConfig, itemType);
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

function writeRecycleLog(player, items, totalValue, before, after, RECYCLE_LOG_DIR) {
	try {
		var logPath = RECYCLE_LOG_DIR + "/" + player.name + ".log";
		var timeStr = new Date().toLocaleString();
		var itemsStr = Object.entries(items)
			.map(function(entry) { return entry[0].replace('minecraft:', '') + '×' + entry[1].count; })
			.join(", ");
		var logEntry = timeStr + " | 回收: " + itemsStr + " | 获得: " + totalValue + " | 余额: " + before + " → " + after + "\n";
		U.ensureDir(logPath);
		fs.appendFile(logPath, logEntry, 'utf-8', function(e) {
			if (e) logger.error("写入回收日志失败：" + e.message);
		});
	} catch (error) {
		logger.error("写入回收日志失败：" + error.message);
	}
}

function recycleItemsFromInventory(player, recycleConfig, deps) {
	var result = calculateRecyclableItems(player, recycleConfig);
	var recyclable = result.recyclable;
	var totalValue = result.totalValue;

	if (totalValue <= 0) {
		player.tell("§c没有可回收的物品！");
		return;
	}

	var currentBalance = deps.getPlayerMoney(player);

	var inventory = player.getInventory();
	for (var i = 0; i < inventory.size; i++) {
		var item = inventory.getItem(i);
		if (!item.isNull() && recyclable[item.type]) {
			inventory.setItem(i, mc.newItem("minecraft:air", 0));
		}
	}
	player.refreshItems();

	deps.addPlayerMoney(player, totalValue, "一键回收");

	var newBalance = deps.getPlayerMoney(player);

	writeRecycleLog(player, recyclable, totalValue, currentBalance, newBalance, deps.RECYCLE_LOG_DIR);

	player.tell("§a回收成功！");
	player.tell("§e+" + totalValue + " 点§c" + deps.getCurrencyName() + "§r §8| §b余额: " + newBalance + " 点§c" + deps.getCurrencyName() + "§r");
}

function showRecycleForm(player, recycleConfig, deps) {
	var result = calculateRecyclableItems(player, recycleConfig);
	var recyclable = result.recyclable;
	var totalValue = result.totalValue;

	if (Object.keys(recyclable).length === 0) {
		var fm = mc.newSimpleForm();
		fm.setTitle("§a回收系统");
		fm.setContent("§c您的背包中没有可回收的物品！");
		fm.addButton("§a确定");
		player.sendForm(fm, function() {});
		return;
	}

	var content = "§e背包中可回收的物品：\n§r\n";

	Object.keys(recyclable).forEach(function(itemType) {
		var data = recyclable[itemType];
		var itemName = getRecycleName(recycleConfig, itemType);
		content += "§f" + itemName + " ×" + data.count + " §8| §e" + (data.count * data.price) + " 点§c" + deps.getCurrencyName() + "§r\n";
	});

	content += "§r\n§6总价值: §e" + totalValue + " 点§c" + deps.getCurrencyName() + "§r";

	var fm = mc.newSimpleForm();
	fm.setTitle("§a物品回收");
	fm.setContent(content);
	fm.addButton("§b查看所有可回收项", "textures/ui/icon_book_writable");
	fm.addButton("§a确认回收");
	fm.addButton("§c取消");

	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === 0) {
			showAllRecyclableItems(p, recycleConfig, deps, 0);
		} else if (id === 1) {
			recycleItemsFromInventory(p, recycleConfig, deps);
		}
	});
}

function showAllRecyclableItems(player, recycleConfig, deps, page) {
	var recycleItems = recycleConfig.recycleItems || {};
	var keys = Object.keys(recycleItems);
	if (keys.length === 0) {
		var fm = mc.newSimpleForm();
		fm.setTitle("§a所有可回收项");
		fm.setContent("§c暂无可回收物品配置");
		fm.addButton("§a返回", "textures/ui/recap_glyph_desaturated");
		player.sendForm(fm, function(p, id) {
			if (id === 0) showRecycleForm(p, recycleConfig, deps);
		});
		return;
	}

	var totalPages = Math.ceil(keys.length / RECYCLE_PAGE_SIZE);
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	var start = page * RECYCLE_PAGE_SIZE;
	var end = Math.min(start + RECYCLE_PAGE_SIZE, keys.length);
	var pageKeys = keys.slice(start, end);

	var fm = mc.newSimpleForm();
	fm.setTitle("§a所有可回收项 §7(" + (page + 1) + "/" + totalPages + ")");

	pageKeys.forEach(function(itemType) {
		var name = getRecycleName(recycleConfig, itemType);
		var price = getRecyclePrice(recycleConfig, itemType);
		var image = getRecycleImage(recycleConfig, itemType);
		fm.addButton(name + "\n回收价 " + price + deps.getCurrencyName(), image || "");
	});

	if (page > 0) {
		fm.addButton("§e上一页", "textures/ui/recap_glyph_desaturated");
	}
	if (page < totalPages - 1) {
		fm.addButton("§e下一页", "textures/ui/recap_glyph_desaturated");
	}
	fm.addButton("§a返回", "textures/ui/recap_glyph_desaturated");

	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		var btnCount = pageKeys.length;
		var hasPrev = page > 0;
		var hasNext = page < totalPages - 1;

		if (id < btnCount) {
			showAllRecyclableItems(p, recycleConfig, deps, page);
		} else if (id === btnCount && hasPrev && hasNext) {
			showAllRecyclableItems(p, recycleConfig, deps, page - 1);
		} else if (id === btnCount && hasPrev && !hasNext) {
			showAllRecyclableItems(p, recycleConfig, deps, page - 1);
		} else if (id === btnCount + 1 && hasPrev && hasNext) {
			if (id === btnCount + 1) {
				showAllRecyclableItems(p, recycleConfig, deps, page + 1);
			} else {
				showRecycleForm(p, recycleConfig, deps);
			}
		} else if (id === btnCount && !hasPrev && hasNext) {
			showAllRecyclableItems(p, recycleConfig, deps, page + 1);
		} else {
			showRecycleForm(p, recycleConfig, deps);
		}
	});
}

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

function calculateTotalXP(currentL, currentXP, upgradeN) {
	var totalXP = 0;
	for (var i = 0; i < upgradeN; i++) {
		var targetLevel = currentL + i;
		var xpToNext = calculateXPNext(targetLevel);
		if (i === 0) {
			totalXP += (xpToNext - currentXP);
		} else {
			totalXP += xpToNext;
		}
	}
	return totalXP;
}

function showXPBuyForm(player, deps) {
	var currentLevel = player.getLevel();
	var currentXPInLevel = player.getCurrentExperience();
	var xpToNextLevel = calculateXPNext(currentLevel);
	var needXPToCurrentNext = xpToNextLevel - currentXPInLevel;

	var xuid = player.xuid;
	var balance = deps.money.get(xuid) || 0;

	var gui = mc.newCustomForm();
	gui.setTitle("\u00a7l\u00a7b\u7ecf\u9a8c\u8d2d\u4e70");

	var content = "\u00a7a\u5f53\u524d\u7b49\u7ea7\uff1a\u00a7f" + currentLevel + " \u7ea7\n";
	content += "\u00a7a\u5f53\u524d\u7b49\u7ea7\u8fdb\u5ea6\uff1a\u00a7f" + currentXPInLevel + " / " + xpToNextLevel + "\n";
	content += "\u00a7a\u8ddd\u79bb\u4e0b\u4e00\u7ea7\uff1a\u8fd8\u9700 \u00a7f" + needXPToCurrentNext + " \u70b9\u7ecf\u9a8c\n";
	content += "\u00a7a\u5151\u6362\u6bd4\u4f8b\uff1a\u00a7f1 \u7ecf\u9a8c = \u00a7e10 \u70b9" + deps.getCurrencyName() + "\n";
	content += "\u00a7a\u60a8\u5f53\u524d\u62e5\u6709\uff1a\u00a7f" + balance + " \u70b9" + deps.getCurrencyName() + "\n";

	gui.addLabel(content);

	var levelOptions = ["\u624b\u52a8\u8f93\u5165\u7ecf\u9a8c"];
	for (var i = 1; i <= 10; i++) {
		levelOptions.push("\u5347\u7ea7" + i + "\u7ea7");
	}
	gui.addStepSlider("\u9009\u62e9\u5347\u7ea7\u7b49\u7ea7", levelOptions, 0, "\u9009\u62e9\u8981\u5347\u7ea7\u7684\u7b49\u7ea7\u6570");

	gui.addInput("\u624b\u52a8\u8f93\u5165\u7ecf\u9a8c\u6570\u91cf", "\u8f93\u5165\u6b63\u6574\u6570\uff08\u5982100\u3001500\uff09", "");

	player.sendForm(gui, function(p, data) {
		if (data === null || typeof data !== "object" || data.length < 3) {
			deps.openMainMenu(p);
			return;
		}

		var levelIndex = data[1];
		var customXP = data[2] || "";

		var xpAmount = 0;
		var useCustomXP = false;

		if (customXP) {
			var customXPAmount = parseInt(customXP);
			if (!isNaN(customXPAmount) && customXPAmount > 0) {
				xpAmount = customXPAmount;
				useCustomXP = true;
			}
		}

		if (!useCustomXP && levelIndex > 0) {
			var upgradeLevels = levelIndex;
			var newCurrentLevel = p.getLevel();
			var newCurrentXPInLevel = p.getCurrentExperience();
			xpAmount = calculateTotalXP(newCurrentLevel, newCurrentXPInLevel, upgradeLevels);
		}

		if (xpAmount < 1) {
			p.sendModalForm(
				"\u00a7c\u8f93\u5165\u9519\u8bef",
				"\u00a7c\u8bf7\u9009\u62e9\u5347\u7ea7\u7b49\u7ea7\u6216\u8f93\u5165\u6709\u6548\u7684\u7ecf\u9a8c\u6570\u91cf\uff01",
				"\u00a7a\u91cd\u65b0\u8f93\u5165",
				"\u00a7c\u5173\u95ed",
				function(player, res) {
					if (res === true) showXPBuyForm(player, deps);
				}
			);
			return;
		}

		var cost = xpAmount * 10;
		var playerBalance = deps.money.get(p.xuid) || 0;

		if (playerBalance < cost) {
			p.sendModalForm(
				"\u00a7c" + deps.getCurrencyName() + "\u4e0d\u8db3",
				"\u00a7c\u8d2d\u4e70 \u00a7f" + xpAmount + " \u70b9\u7ecf\u9a8c \u00a7c\u9700\u8981 \u00a7e" + cost + " \u70b9" + deps.getCurrencyName() + "\n\u00a7c\u60a8\u5f53\u524d\u4ec5\u62e5\u6709 \u00a7e" + playerBalance + " \u70b9" + deps.getCurrencyName() + "\n\u00a7c\u8bf7\u5148\u83b7\u53d6\u8db3\u591f" + deps.getCurrencyName() + "\u540e\u518d\u5c1d\u8bd5",
				"\u00a7a\u8fd4\u56de",
				"\u00a7c\u5173\u95ed",
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

function showXPBuyConfirmForm(player, xpAmount, cost, playerBalance, deps) {
	player.sendModalForm(
		"\u00a7a\u786e\u8ba4\u8d2d\u4e70",
		"\u00a7a\u8d2d\u4e70\u7ecf\u9a8c\uff1a\u00a7f" + xpAmount + " \u70b9\n\u00a7c\u6d88\u8017" + deps.getCurrencyName() + "\uff1a\u00a7e" + cost + " \u70b9\n\u00a7c\u60a8\u5f53\u524d" + deps.getCurrencyName() + "\uff1a\u00a7e" + playerBalance + " \u70b9\n\u00a7c\u8d2d\u4e70\u540e\u5269\u4f59\uff1a\u00a7e" + (playerBalance - cost) + " \u70b9",
		"\u00a7a\u786e\u8ba4\u8d2d\u4e70",
		"\u00a7c\u53d6\u6d88",
		function(p, isConfirm) {
			if (!p) return;
			if (!isConfirm) {
				showXPBuyForm(p, deps);
				return;
			}

			var xuid = p.xuid;
			var reduceSuccess = deps.money.reduce(xuid, cost);

			if (reduceSuccess) {
				deps.notifyEconomyChange(p, -cost, "\u8d2d\u4e70\u7ecf\u9a8c");
				var addXPSuccess = p.addExperience(xpAmount);

				if (addXPSuccess) {
					var newLevel = p.getLevel();
					var remainingBalance = deps.money.get(xuid) || 0;

					p.sendModalForm(
						"\u00a7a\u8d2d\u4e70\u6210\u529f",
						"\u00a7a\u6210\u529f\u8d2d\u4e70 \u00a7f" + xpAmount + " \u70b9\u7ecf\u9a8c\uff01\n\u00a7a\u5f53\u524d\u7b49\u7ea7\uff1a\u00a7f" + newLevel + " \u7ea7\n\u00a7c\u6d88\u8017" + deps.getCurrencyName() + "\uff1a\u00a7e" + cost + " \u70b9\n\u00a7c\u5269\u4f59" + deps.getCurrencyName() + "\uff1a\u00a7e" + remainingBalance + " \u70b9",
						"\u00a7a\u7ee7\u7eed\u8d2d\u4e70",
						"\u00a7c\u5b8c\u6210",
						function(pl, isContinue) {
							if (!pl) return;
							if (isContinue) showXPBuyForm(pl, deps);
						}
					);
				} else {
					p.sendModalForm(
						"\u00a7c\u8d2d\u4e70\u5931\u8d25",
						"\u00a7c\u7cfb\u7edf\u9519\u8bef\uff1a\u7ecf\u9a8c\u6dfb\u52a0\u5931\u8d25\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458",
						"\u00a7a\u786e\u5b9a",
						"\u00a7c\u5173\u95ed",
						function(pl, res) {
							if (res === true) showXPBuyForm(pl, deps);
						}
					);
				}
			} else {
				p.sendModalForm(
					"\u00a7c\u8d2d\u4e70\u5931\u8d25",
					"\u00a7c\u7cfb\u7edf\u9519\u8bef\uff1a\u6263\u9664\u5931\u8d25\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458",
					"\u00a7a\u786e\u5b9a",
					"\u00a7c\u5173\u95ed",
					function(pl, res) {
						if (res === true) showXPBuyForm(pl, deps);
					}
				);
			}
		}
	);
}

function showShopMainForm(player, deps) {
	var fm = mc.newSimpleForm();
	fm.setTitle("商店");
	fm.setContent("选择一个功能");
	fm.addButton("物品购买", "textures/ui/icon_recipe_equipment");
	fm.addButton("物品回收", "textures/ui/trash_default");
	fm.addButton("关闭", "textures/ui/cancel");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === 2) return;
		if (id === 0) showBuyMenu(p, deps);
		else if (id === 1) showSellMenu(p, deps);
	});
}

function showBuyMenu(player, deps) {
	var fm = mc.newSimpleForm();
	fm.setTitle("物品购买");
	fm.addButton("搜索物品", "textures/ui/magnifyingGlass");
	if (deps.shopData && deps.shopData.Buy) {
		deps.shopData.Buy.forEach(function(grp) {
			fm.addButton(grp.name, grp.image || "");
		});
	}
	fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === 0) {
			showBuySearchForm(p, deps);
		} else if (deps.shopData && deps.shopData.Buy && id <= deps.shopData.Buy.length) {
			showBuyGroupForm(p, deps.shopData.Buy[id - 1], deps);
		}
	});
}

function showBuySearchForm(player, deps) {
	var fm = mc.newCustomForm();
	fm.setTitle("搜索物品");
	fm.addInput("输入物品名称或ID", "", "");
	player.sendForm(fm, function(p, data) {
		if (data === null || !data || !data[0]) {
			showBuyMenu(p, deps);
			return;
		}
		var kw = data[0].trim().toLowerCase();
		if (!kw) { showBuyMenu(p, deps); return; }
		showBuySearchResults(p, kw, deps);
	});
}

function showBuySearchResults(player, keyword, deps) {
	var results = [];
	if (deps.shopData && deps.shopData.Buy) {
		deps.shopData.Buy.forEach(function(grp) {
			(grp.items || []).forEach(function(it) {
				if (it.name.toLowerCase().indexOf(keyword) >= 0 || it.id.toLowerCase().indexOf(keyword) >= 0) {
					results.push(it);
				}
			});
		});
	}
	var fm = mc.newSimpleForm();
	fm.setTitle("搜索: " + keyword);
	if (results.length === 0) {
		fm.setContent("未找到匹配的物品");
	}
	results.forEach(function(it) {
		fm.addButton(it.name + "\n售价 " + it.money + deps.getCurrencyName() + "/个", it.image || "");
	});
	fm.addButton("重新搜索", "textures/ui/magnifyingGlass");
	fm.addButton("返回上一级", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === results.length) showBuySearchForm(p, deps);
		else if (id === results.length + 1) showBuyMenu(p, deps);
		else if (id < results.length) showBuyItemForm(p, results[id], deps);
	});
}

function showBuyGroupForm(player, group, deps) {
	var items = group.items || [];
	var fm = mc.newSimpleForm();
	fm.setTitle(group.name);
	items.forEach(function(it) {
		fm.addButton(it.name + "\n售价 " + it.money + deps.getCurrencyName() + "/个", it.image || "");
	});
	fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === items.length) {
			showBuyMenu(p, deps);
			return;
		}
		if (id < items.length) showBuyItemForm(p, items[id], deps);
	});
}

function showBuyItemForm(player, item, deps) {
	var vipInfo = deps.getVipInfo(player);
	var hasVip = vipInfo.hasVip;
	var discount = hasVip ? 0.85 : 1;
	var unitPrice = item.money;
	var discountPrice = Math.floor(unitPrice * discount);
	var balance = deps.getPlayerMoney(player);
	var invSpace = calcInventorySpace(player, item.id);

	var content = "物品id: " + item.id.replace("minecraft:", "") + "\n";
	content += "售价: " + unitPrice + deps.getCurrencyName() + "/个\n";
	if (hasVip) {
		content += "优惠价: " + discountPrice + deps.getCurrencyName() + "/个\n";
	}
	content += "余额: " + balance + " " + deps.getCurrencyName() + "\n";
	content += "背包空间: " + invSpace + "格";

	var fm = mc.newCustomForm();
	fm.setTitle(item.name);
	fm.addLabel(content);
	fm.addInput("输入购买数量", "正整数", "");
	fm.addSlider("快速选择数量", 0, 128, 1, 0);
	player.sendForm(fm, function(p, data) {
		if (data === null || !Array.isArray(data)) return;
		var inputStr = (data[1] || "").trim();
		var sliderVal = data[2] || 0;
		var count;
		if (sliderVal > 0) {
			count = sliderVal;
		} else if (inputStr && U.isInteger(inputStr) && Number(inputStr) > 0) {
			count = Number(inputStr);
		} else {
			p.tell("请输入有效的购买数量");
			showBuyItemForm(p, item, deps);
			return;
		}
		if (count <= 0) {
			p.tell("购买数量必须大于0");
			showBuyItemForm(p, item, deps);
			return;
		}

		var price = hasVip ? discountPrice : unitPrice;
		var totalCost = price * count;
		var currentBalance = deps.getPlayerMoney(p);
		var currentSpace = calcInventorySpace(p, item.id);

		if (currentBalance < totalCost) {
			p.sendModalForm("余额不足", "需要 " + totalCost + " " + deps.getCurrencyName() + "\n当前余额 " + currentBalance + " " + deps.getCurrencyName(), "返回重新选择", "关闭", function(pl, ok) {
				if (ok === true) showBuyItemForm(pl, item, deps);
			});
			return;
		}
		if (currentSpace < count) {
			p.sendModalForm("背包空间不足", "需要 " + count + "格空间\n当前可用 " + currentSpace + "格", "返回重新选择", "关闭", function(pl, ok) {
				if (ok === true) showBuyItemForm(pl, item, deps);
			});
			return;
		}

		p.sendModalForm("确认购买", item.name + " x" + count + "\n花费 " + totalCost + " " + deps.getCurrencyName(), "确认购买", "取消", function(pl, ok) {
			if (!ok) return;
			executePurchase(pl, item, count, price, totalCost, hasVip, unitPrice, deps);
		});
	});
}

function executePurchase(player, item, count, unitPrice, totalCost, hasVip, originalUnitPrice, deps) {
	deps.reducePlayerMoney(player, totalCost, "商店购买");
	deps.giveItemById(player, item.id, count);

	if (hasVip) {
		var saved = originalUnitPrice * count - totalCost;
		var xuid = player.xuid;
		if (deps.playerData.players[xuid] && deps.playerData.players[xuid].vipdata) {
			deps.playerData.players[xuid].vipdata.totalSaved = (deps.playerData.players[xuid].vipdata.totalSaved || 0) + saved;
		}
		deps.savePlayerDataNow();
	}

	var newBalance = deps.getPlayerMoney(player);
	writeShopLog(player, item.name, count, totalCost, newBalance);
	player.tell("购买成功 " + item.name + " x" + count + " 花费" + totalCost + deps.getCurrencyName() + " 余额" + newBalance + deps.getCurrencyName());
	player.sendModalForm("购买成功", item.name + " x" + count + "\n花费 " + totalCost + " " + deps.getCurrencyName() + "\n余额 " + newBalance + " " + deps.getCurrencyName(), "返回购物", "关闭", function(pl, ok) {
		if (ok === true) showBuyMenu(pl, deps);
	});
}

function showSellMenu(player, deps) {
	var fm = mc.newSimpleForm();
	fm.setTitle("物品回收");
	fm.addButton("搜索物品", "textures/ui/magnifyingGlass");
	fm.addButton("一键回收", "textures/ui/refresh");
	if (deps.shopData && deps.shopData.Sell) {
		deps.shopData.Sell.forEach(function(grp) {
			fm.addButton(grp.name, grp.image || "");
		});
	}
	fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === 0) {
			showSellSearchForm(p, deps);
		} else if (id === 1) {
			showRecycleForm(p, deps.recycleConfig, deps);
		} else if (deps.shopData && deps.shopData.Sell && id <= deps.shopData.Sell.length + 1) {
			showSellGroupForm(p, deps.shopData.Sell[id - 2], deps);
		}
	});
}

function showSellSearchForm(player, deps) {
	var fm = mc.newCustomForm();
	fm.setTitle("搜索回收物品");
	fm.addInput("输入物品名称或ID", "", "");
	player.sendForm(fm, function(p, data) {
		if (data === null || !data || !data[0]) {
			showSellMenu(p, deps);
			return;
		}
		var kw = data[0].trim().toLowerCase();
		if (!kw) { showSellMenu(p, deps); return; }
		showSellSearchResults(p, kw, deps);
	});
}

function showSellSearchResults(player, keyword, deps) {
	var results = [];
	if (deps.shopData && deps.shopData.Sell) {
		deps.shopData.Sell.forEach(function(grp) {
			(grp.items || []).forEach(function(it) {
				if (it.name.toLowerCase().indexOf(keyword) >= 0 || it.id.toLowerCase().indexOf(keyword) >= 0) {
					results.push(it);
				}
			});
		});
	}
	var fm = mc.newSimpleForm();
	fm.setTitle("搜索回收: " + keyword);
	if (results.length === 0) {
		fm.setContent("未找到匹配的物品");
	}
	results.forEach(function(it) {
		fm.addButton(it.name + "\n回收价 " + it.money + deps.getCurrencyName() + "/个", it.image || "");
	});
	fm.addButton("重新搜索", "textures/ui/magnifyingGlass");
	fm.addButton("返回上一级", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id === results.length) showSellSearchForm(p, deps);
		else if (id === results.length + 1) showSellMenu(p, deps);
		else if (id < results.length) showSellItemForm(p, results[id], deps);
	});
}

function showSellGroupForm(player, group, deps) {
	var items = group.items || [];
	var fm = mc.newSimpleForm();
	fm.setTitle(group.name);
	items.forEach(function(it) {
		fm.addButton(it.name + "\n回收价 " + it.money + deps.getCurrencyName() + "/个", it.image || "");
	});
	fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === items.length) {
			showSellMenu(p, deps);
			return;
		}
		if (id < items.length) showSellItemForm(p, items[id], deps);
	});
}

function showSellItemForm(player, item, deps) {
	var balance = deps.getPlayerMoney(player);
	var owned = countOwnedItems(player, item.id);

	var content = "物品id: " + item.id.replace("minecraft:", "") + "\n";
	content += "回收价: " + item.money + deps.getCurrencyName() + "/个\n";
	content += "余额: " + balance + " " + deps.getCurrencyName() + "\n";
	content += "持有数量: " + owned + "个";

	var fm = mc.newCustomForm();
	fm.setTitle(item.name);
	fm.addLabel(content);
	fm.addSwitch("全部出售", false);
	fm.addInput("输入出售数量", "正整数", "");
	player.sendForm(fm, function(p, data) {
		if (data === null || !Array.isArray(data)) return;
		var sellAll = data[1] || false;
		var inputStr = (data[2] || "").trim();
		var count;
		if (sellAll) {
			var ownedCount = countOwnedItems(p, item.id);
			if (ownedCount <= 0) {
				p.sendModalForm("物品不足", "你没有该物品", "返回重新选择", "关闭", function(pl, ok) {
					if (ok === true) showSellItemForm(pl, item, deps);
				});
				return;
			}
			count = ownedCount;
		} else if (inputStr && U.isInteger(inputStr) && Number(inputStr) > 0) {
			count = Number(inputStr);
		} else {
			p.tell("请输入有效的出售数量");
			showSellItemForm(p, item, deps);
			return;
		}
		if (count <= 0) {
			p.tell("出售数量必须大于0");
			showSellItemForm(p, item, deps);
			return;
		}

		var currentOwned = countOwnedItems(p, item.id);
		if (currentOwned === 0) {
			p.sendModalForm("物品不足", "你没有该物品", "返回重新选择", "关闭", function(pl, ok) {
				if (ok === true) showSellItemForm(pl, item, deps);
			});
			return;
		}
		if (count > currentOwned) {
			p.sendModalForm("数量不足", "需要 " + count + "个\n当前持有 " + currentOwned + "个", "返回重新选择", "关闭", function(pl, ok) {
				if (ok === true) showSellItemForm(pl, item, deps);
			});
			return;
		}

		var income = count * item.money;
		p.sendModalForm("确认回收", item.name + " x" + count + "\n获得 " + income + " " + deps.getCurrencyName(), "确认回收", "取消", function(pl, ok) {
			if (!ok) return;
			executeSell(pl, item, count, income, deps);
		});
	});
}

function executeSell(player, item, count, income, deps) {
	mc.runcmd('clear "' + player.realName + '" ' + item.id + ' 0 ' + count);
	deps.addPlayerMoney(player, income, "商店回收");
	var newBalance = deps.getPlayerMoney(player);
	writeShopSellLog(player, item.name, count, income, newBalance);
	player.tell("回收成功 " + item.name + " x" + count + " 获得" + income + deps.getCurrencyName() + " 余额" + newBalance + deps.getCurrencyName());
	player.sendModalForm("回收成功", item.name + " x" + count + "\n获得 " + income + " " + deps.getCurrencyName() + "\n余额 " + newBalance + " " + deps.getCurrencyName(), "返回回收", "关闭", function(pl, ok) {
		if (ok === true) showSellMenu(pl, deps);
	});
}

module.exports = {
	showShopMainForm: showShopMainForm,
	showRecycleForm: showRecycleForm,
	showXPBuyForm: showXPBuyForm
};
