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
 * NLCE 祈愿抽卡系统
 * 模拟原神祈愿机制，支持四星/五星保底、概率配置和历史记录
 */


const fs = require('fs');
const C = require('./constants');
const U = require('./utils');
const D = require('./debug');

let wishDM = null; // 祈愿数据DataManager
let enchantBookShopDM = null; // 附魔书商店配置DataManager
let spawnEggShopDM = null; // 刷怪蛋商店配置DataManager
let wishData = { players: {} }; // 祈愿玩家数据（保底计数、货币、历史等）
let wishConfig = {}; // 祈愿配置（概率、奖池、价格等）
let enchantBookShopConfig = { enchantments: {} }; // 附魔书商店配置
let spawnEggShopConfig = {
    currency: { name: "星尘" },
    items: []
};
let _deps = {};

/** 初始化祈愿模块，加载数据和配置 */
function init(dm, enchDm, spawnDm, cfg, deps) {
	D.debugLogModule('wish')('init: 初始化完成');
    wishDM = dm;
    enchantBookShopDM = enchDm;
    spawnEggShopDM = spawnDm;
    _deps = deps || {};
    wishConfig = cfg || {};
    wishData = wishDM.load();
    if (!wishData.players) wishData.players = {};
    enchantBookShopConfig = enchantBookShopDM.load();
    spawnEggShopConfig = spawnEggShopDM.load();
}

/** 热重载祈愿配置（不重新加载数据） */
function reloadConfig(cfg) {
    wishConfig = cfg || {};
}

/** 立即保存祈愿数据到磁盘 */
function saveWishData() {
    if (!wishData.players) wishData.players = {};
    wishDM.save(true);
    return true;
}

/** 获取玩家祈愿数据，不存在则初始化默认结构 */
function getPlayerWishData(xuid) {
    if (!wishData.players[xuid]) {
        wishData.players[xuid] = {
            totalWishes: 0,
            pity: { fiveStar: 0, fourStar: 0 },
            currency: { dust: 0, core: 0 },
            fiveStarGuarantee: false,
            history: []
        };
        saveWishData();
    }
    return wishData.players[xuid];
}

/**
 * 计算五星概率（含软保底机制）
 * 软保底后概率线性递增，硬保底必出
 * @param {number} pityCount - 距离上次五星的抽数
 * @returns {number} 五星概率
 */
function calculateFiveStarProbability(pityCount) {
    const rates = wishConfig.rates || {};
    const baseRate = rates.fiveStar || 0.006;
    const softPity = rates.fiveStarSoftPity || 73;
    const hardPity = rates.fiveStarHardPity || 90;
    if (pityCount >= hardPity) return 1.0;
    if (pityCount >= softPity) {
        const pityExcess = pityCount - softPity + 1;
        const increment = (1.0 - baseRate) / (hardPity - softPity);
        return baseRate + (pityExcess * increment);
    }
    return baseRate;
}

/**
 * 执行单次祈愿：推进保底计数、判定星级、随机奖励、发放物品
 * @param {object} player - 玩家对象
 * @param {boolean} [shouldSave=true] - 是否立即保存数据（批量祈愿时设为false以提升性能）
 * @returns {object} 奖励对象 { rarity, type, ... }
 */
function performSingleWish(player, shouldSave) {
    if (shouldSave === undefined) shouldSave = true;
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const rates = wishConfig.rates || {};

    wd.pity.fiveStar++;
    wd.pity.fourStar++;
    wd.totalWishes++;

    const fiveStarProb = calculateFiveStarProbability(wd.pity.fiveStar);
    const fourStarProb = rates.fourStar || 0.051;

    let rarity = "threeStar";
    let reward = null;

    if (wd.pity.fourStar >= (rates.fourStarGuarantee || 10)) {
        rarity = "fourStar";
        wd.pity.fourStar = 0;
    } else if (Math.random() < fiveStarProb) {
        rarity = "fiveStar";
        wd.pity.fiveStar = 0;
        wd.pity.fourStar = 0;
    } else if (Math.random() < fourStarProb) {
        rarity = "fourStar";
        wd.pity.fourStar = 0;
    }

    if (rarity === "fiveStar") {
        const fiveStarRewards = (wishConfig.rewards && wishConfig.rewards.fiveStar) || [];
        const hasCustomFiveStar = fiveStarRewards.length > 0;
        let isCore = true;
        let customItem = null;

        if (wd.fiveStarGuarantee && hasCustomFiveStar) {
            customItem = fiveStarRewards[Math.floor(Math.random() * fiveStarRewards.length)];
            isCore = false;
            wd.fiveStarGuarantee = false;
        } else if (hasCustomFiveStar && Math.random() < 0.35) {
            customItem = fiveStarRewards[Math.floor(Math.random() * fiveStarRewards.length)];
            isCore = false;
        }

        if (isCore) {
            wd.currency.core++;
            reward = { rarity: "fiveStar", type: "core", amount: 1 };
            if (hasCustomFiveStar) wd.fiveStarGuarantee = true;
        } else {
            reward = { rarity: "fiveStar", type: "item", name: customItem.name, snbt: customItem.snbt };
        }
    } else if (rarity === "fourStar") {
        const fourStarRewards = (wishConfig.rewards && wishConfig.rewards.fourStar) || [];
        if (fourStarRewards.length > 0) {
            const randomReward = fourStarRewards[Math.floor(Math.random() * fourStarRewards.length)];
            reward = { rarity: "fourStar", type: "item", name: randomReward.name, snbt: randomReward.snbt };
        }
    } else {
        const threeStarConfig = (wishConfig.rewards && wishConfig.rewards.threeStar) || {};
        const minDust = threeStarConfig.minDust || 10;
        const maxDust = threeStarConfig.maxDust || 80;
        const dustAmount = Math.floor(Math.random() * (maxDust - minDust + 1)) + minDust;
        wd.currency.dust += dustAmount;
        reward = { rarity: "threeStar", type: "dust", amount: dustAmount };
    }

    const now = new Date();
    const dateStr = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0');
    const timeStr = U.getCurrentTimeString();
    const record = { date: dateStr, time: timeStr, rarity: rarity, reward: reward };

    // 物品奖励：解析SNBT创建物品，背包有空位则直接给予，否则掉落在地面
    if (reward.type === "item" && reward.snbt) {
        try {
            const item = mc.newItem(NBT.parseSNBT(reward.snbt));
            if (player.getInventory().hasRoomFor(item)) {
                player.giveItem(item);
            } else {
                mc.spawnItem(item, player.pos);
            }
        } catch (error) {
            logger.error('发放祈愿物品失败！错误：' + error.message);
            const compDust = Math.floor(Math.random() * 50) + 30;
            wd.currency.dust += compDust;
            player.tell('§c物品发放失败，补偿您 ' + compDust + ' 点' + (wishConfig.dustName || "星尘"));
        }
    }

    // 批量祈愿时 shouldSave=false，由调用方统一保存，避免频繁IO
    if (shouldSave) {
        try {
            const logPath = 'plugins/NLCE/logs/wish_' + xuid + '.json';
            let logData = [];
            if (fs.existsSync(logPath)) {
                const logStr = fs.readFileSync(logPath, 'utf-8');
                logData = JSON.parse(logStr) || [];
            }
            logData.unshift(record);
            U.ensureDir(logPath);
            fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf-8');
        } catch (error) {
            logger.error('祈愿记录保存到logs失败！错误：' + error.message);
        }
        saveWishData();
    }

    return reward;
}

/**
 * 执行多次祈愿（批量模式），一次性读写日志文件，避免逐次IO
 * @param {object} player - 玩家对象
 * @param {number} count - 祈愿次数
 * @returns {object[]} 每次祈愿的奖励数组
 */
function performMultipleWishes(player, count) {
    const rewards = [];
    const xuid = player.xuid;
    const logPath = 'plugins/NLCE/logs/wish_' + xuid + '.json';
    let logData = [];
    const records = [];

    try {
        if (fs.existsSync(logPath)) {
            const logStr = fs.readFileSync(logPath, 'utf-8');
            logData = JSON.parse(logStr) || [];
        }
    } catch (error) {
        logger.error('祈愿记录读取失败！错误：' + error.message);
    }

    for (let i = 0; i < count; i++) {
        const reward = performSingleWish(player, false);
        rewards.push(reward);
        const now = new Date();
        const dateStr = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0');
        const timeStr = U.getCurrentTimeString();
        records.unshift({ date: dateStr, time: timeStr, rarity: reward.rarity, reward: reward });
    }

    for (let j = 0; j < records.length; j++) {
        logData.unshift(records[j]);
    }

    // 历史记录上限1000条，超出则截断
    if (logData.length > 1000) {
        logData = logData.slice(0, 1000);
    }

    try {
        U.ensureDir(logPath);
        fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf-8');
    } catch (error) {
        logger.error('祈愿记录保存失败！错误：' + error.message);
    }

    saveWishData();
    return rewards;
}

/** 检查玩家余额是否足够支付指定次数的祈愿 */
function checkWishBalance(player, count) {
    const costConfig = wishConfig.cost || {};
    const singleCost = costConfig.single || 160;
    const totalCost = singleCost * count;
    const playerMoney = _deps.getPlayerMoney(player);
    if (playerMoney < totalCost) {
        return {
            success: false,
            message: '§c余额不足，需要 ' + totalCost + ' 点§c' + _deps.getCurrencyName() + '§r，当前只有 ' + playerMoney + ' 点§c' + _deps.getCurrencyName() + '§r'
        };
    }
    return { success: true, cost: totalCost };
}

/** 扣除祈愿费用 */
function deductWishCost(player, cost) {
    return _deps.reducePlayerMoney(player, cost, "祈愿");
}

/** 检查背包是否有足够空位（过滤air物品） */
function checkInventorySpace(player, requiredSlots) {
    try {
        const inventory = player.getInventory();
        const allItems = inventory.getAllItems();
        const actualItems = allItems.filter(function(item) {
            if (!item) return false;
            const itemId = item.id || item.name;
            return itemId && itemId !== 'minecraft:air';
        });
        const emptySlots = inventory.size - actualItems.length;
        return emptySlots >= requiredSlots;
    } catch (error) {
        logger.error('检查背包空间失败！错误：' + error.message);
        return true;
    }
}

/** 显示祈愿主界面：统计信息、祈愿/兑换/历史入口 */
function showWishMainForm(player) {
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b祈愿系统");

    let content = "-------------------------\n";
    content += "§a总抽取次数：§f" + wd.totalWishes + " 次\n";
    content += "§a已垫抽数：§f" + wd.pity.fiveStar + " 抽\n";
    content += "§a" + (wishConfig.dustName || "星尘") + "数量：§f" + wd.currency.dust + " 点\n";
    content += "§a" + (wishConfig.coreName || "星核") + "数量：§f" + wd.currency.core + " 点\n";
    content += "-------------------------\n";
    content += (wishConfig.banner || '') + " \n";

    gui.setContent(content);
    gui.addButton("§a开始祈愿", "textures/ui/pary");
    gui.addButton("§e" + (wishConfig.coreName || "星核") + "兑换", "textures/ui/core");
    gui.addButton("§b查看历史", "textures/ui/achievements_pause_menu_icon");
    gui.addButton("§6详细说明", "textures/ui/creative_icon");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;
        if (id === 0) showWishOperationForm(p);
        else if (id === 1) showCoreShopForm(p);
        else if (id === 2) showWishHistoryForm(p, 1);
        else if (id === 3) showWishInfoForm(p);
        else if (id === 4) { if (_deps.openMainMenu) _deps.openMainMenu(p); }
    });
}

/** 显示祈愿操作界面：单抽、十连、自定义抽取 */
function showWishOperationForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b开始祈愿");
    gui.setContent("§a请选择祈愿方式：");
    gui.addButton("§a单抽 (160点§c" + _deps.getCurrencyName() + "§r)", "textures/ui/pary");
    gui.addButton("§b十连 (1600点§c" + _deps.getCurrencyName() + "§r)", "textures/ui/x10");
    gui.addButton("§6自定义抽取", "textures/ui/pary_edit");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            if (!checkInventorySpace(p, 5)) {
                p.sendModalForm("§c背包空间不足", "§c您的背包至少需要5个空位才能进行祈愿，请清理背包后再尝试。", "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            const balanceCheck = checkWishBalance(p, 1);
            if (!balanceCheck.success) {
                p.sendModalForm("§c余额不足", balanceCheck.message, "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            if (deductWishCost(p, balanceCheck.cost)) {
                const reward = performSingleWish(p);
                showWishResultForm(p, [reward], 1);
            } else {
                p.tell("§c祈愿失败，货币系统异常");
                showWishOperationForm(p);
            }
        } else if (id === 1) {
            if (!checkInventorySpace(p, 5)) {
                p.sendModalForm("§c背包空间不足", "§c您的背包至少需要5个空位才能进行祈愿，请清理背包后再尝试。", "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            const balanceCheck2 = checkWishBalance(p, 10);
            if (!balanceCheck2.success) {
                p.sendModalForm("§c余额不足", balanceCheck2.message, "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            if (deductWishCost(p, balanceCheck2.cost)) {
                const rewards = performMultipleWishes(p, 10);
                showWishResultForm(p, rewards, 10);
            } else {
                p.tell("§c祈愿失败，货币系统异常");
                showWishOperationForm(p);
            }
        } else if (id === 2) {
            if (!checkInventorySpace(p, 5)) {
                p.sendModalForm("§c背包空间不足", "§c您的背包至少需要5个空位才能进行祈愿，请清理背包后再尝试。", "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            const customGui = mc.newCustomForm();
            customGui.setTitle("§l§b自定义抽取");
            customGui.addInput("输入抽取次数", "例如：5", "");
            p.sendForm(customGui, function(player, data) {
                if (data === null || data.length < 1) { showWishOperationForm(player); return; }
                const count = parseInt(data[0]);
                if (isNaN(count) || count <= 0) { player.tell("§c请输入有效的抽取次数"); showWishOperationForm(player); return; }
                if (count > 90) {
                    player.sendModalForm("§c输入错误", "§c最大祈愿数量为90抽，请输入90或以下的抽取次数", "§a重新输入", "§c关闭", function(p, res) { if (res === true) showWishOperationForm(p); else showWishMainForm(p); });
                    return;
                }
                const balanceCheck3 = checkWishBalance(player, count);
                if (!balanceCheck3.success) {
                    player.sendModalForm("§c余额不足", balanceCheck3.message, "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                    return;
                }
                if (deductWishCost(player, balanceCheck3.cost)) {
                    const rewards2 = performMultipleWishes(player, count);
                    showWishResultForm(player, rewards2, count);
                } else {
                    player.tell("§c祈愿失败，货币系统异常");
                    showWishOperationForm(player);
                }
            });
        } else if (id === 3) {
            showWishMainForm(p);
        }
    });
}

/** 显示祈愿结果（合并同类奖励显示），支持再次抽取 */
function showWishResultForm(player, rewards, count) {
    let content = "-------------------------\n";
    let dustCount = 0;
    let dustTotal = 0;
    const fiveStarRewards = [];
    const fourStarRewards = [];

    rewards.forEach(function(reward) {
        if (reward.rarity === "threeStar" && reward.type === "dust") {
            dustCount++;
            dustTotal += reward.amount;
        } else if (reward.rarity === "fiveStar") {
            fiveStarRewards.push(reward);
        } else if (reward.rarity === "fourStar") {
            fourStarRewards.push(reward);
        }
    });

        /** 合并相同奖励的显示（同名物品合并计数） */
        function mergeRewards(rws) {
        const merged = {};
        rws.forEach(function(reward) {
            const key = reward.rarity + '_' + (reward.type === "core" ? "core" : reward.name || "unknown");
            if (!merged[key]) { merged[key] = Object.assign({}, reward, { count: 1 }); }
            else { merged[key].count++; }
        });
        return Object.values(merged);
    }

    const mergedFiveStar = mergeRewards(fiveStarRewards);
    const mergedFourStar = mergeRewards(fourStarRewards);

    mergedFiveStar.forEach(function(reward) {
        const rewardText = reward.type === "core" ? (wishConfig.coreName || "星核") : (reward.name || "未知物品");
        content += "§e5星 " + rewardText + (reward.count > 1 ? " x" + reward.count : "") + "\n";
    });

    mergedFourStar.forEach(function(reward) {
        const rewardText = reward.name || "未知物品";
        content += "§u4星 " + rewardText + (reward.count > 1 ? " x" + reward.count : "") + "\n";
    });

    if (dustCount > 0) {
        content += "§b3星 " + (wishConfig.dustName || "星尘") + " x" + dustCount + " 总计 " + dustTotal + " 点\n";
    }
    content += "-------------------------\n";

    const buttonText = count === 1 ? "§a再次抽取" : "§a再次抽取" + count + "次";

    player.sendModalForm("§l§b祈愿结果", content, buttonText, "§c返回", function(p, res) {
        if (res === true) {
            if (!checkInventorySpace(p, 5)) {
                p.sendModalForm("§c背包空间不足", "§c您的背包至少需要5个空位才能进行祈愿，请清理背包后再尝试。", "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            const balanceCheck = checkWishBalance(p, count);
            if (!balanceCheck.success) {
                p.sendModalForm("§c余额不足", balanceCheck.message, "§a返回", "§c关闭", function(player) { showWishOperationForm(player); });
                return;
            }
            if (deductWishCost(p, balanceCheck.cost)) {
                const newRewards = performMultipleWishes(p, count);
                showWishResultForm(p, newRewards, count);
            } else {
                p.tell("§c祈愿失败，货币系统异常");
                showWishOperationForm(p);
            }
        } else {
            showWishOperationForm(p);
        }
    });
}

/** 显示祈愿系统详细说明（概率、花费、奖励规则） */
function showWishInfoForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b祈愿系统说明");
    let content = "-------------------------\n";
    const _dustName = wishConfig.dustName || "星尘";
    const _coreName = wishConfig.coreName || "星核";
    const _threeStarCfg = (wishConfig.rewards && wishConfig.rewards.threeStar) || {};
    const _minDust = _threeStarCfg.minDust || 10;
    const _maxDust = _threeStarCfg.maxDust || 40;
    if (wishConfig.description) {
        let desc = wishConfig.description;
        desc = desc.replace(/\{coreName\}/g, _coreName);
        desc = desc.replace(/\{dustName\}/g, _dustName);
        desc = desc.replace(/\{minDust\}/g, String(_minDust));
        desc = desc.replace(/\{maxDust\}/g, String(_maxDust));
        content += desc + "\n\n";
    }
    content += "§a祈愿花费：\n";
    content += "§f单抽：" + ((wishConfig.cost && wishConfig.cost.single) || 160) + "点" + _deps.getCurrencyName() + "\n";
    content += "§f十连：" + ((wishConfig.cost && wishConfig.cost.ten) || 1600) + "点" + _deps.getCurrencyName() + "\n\n";
    content += "§a奖励说明：\n";
    content += "§f" + (wishConfig.dustName || "星尘") + "：3星物品，可以用于兑换奖励\n";
    content += "§f" + (wishConfig.coreName || "星核") + "：5星物品，稀有奖励\n\n";
    content += "§a4星奖池：\n§b锭·全部系列\n§b晶体·全部系列";
    content += "-------------------------\n";
    gui.setContent(content);
    gui.addButton("§a返回", "textures/ui/recap_glyph_desaturated");
    player.sendForm(gui, function(p, id) {
        if (id === null || id === 0) showWishMainForm(p);
    });
}

/** 显示星核兑换商店列表 */
function showCoreShopForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§e" + (wishConfig.coreName || "星核") + "兑换商店");
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const coreAmount = wd.currency.core || 0;
    let content = "-------------------------\n";
    content += "§a您当前拥有：§f" + coreAmount + " 颗" + (wishConfig.coreName || "星核") + "\n";
    content += "-------------------------\n";
    content += "§e点击物品查看详情并兑换\n";
    content += "-------------------------\n";
    gui.setContent(content);
    const coreShop = wishConfig.coreShop || [];
    coreShop.forEach(function(item) {
        gui.addButton("§b" + item.name + "\n§6需要 §e" + item.cost + " " + (wishConfig.coreName || "星核"), item.icon || "textures/ui/star_glyph");
    });
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
    player.sendForm(gui, function(p, id) {
        if (id === null) return;
        const shopItems = wishConfig.coreShop || [];
        if (id >= 0 && id < shopItems.length) showCoreShopDetailForm(p, shopItems[id]);
        else if (id === shopItems.length) showWishMainForm(p);
    });
}

/** 显示星核兑换物品详情 */
function showCoreShopDetailForm(player, item) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§e" + item.name);
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const coreAmount = wd.currency.core || 0;
    let content = "-------------------------\n";
    content += "§a物品名称：§f" + item.name + "\n";
    content += "§a物品描述：§f" + item.description + "\n";
    content += "§a兑换价格：§e" + item.cost + " 颗" + (wishConfig.coreName || "星核") + "\n";
    content += "§a当前拥有：§f" + coreAmount + " 颗" + (wishConfig.coreName || "星核") + "\n";
    content += "-------------------------\n";
    if (coreAmount >= item.cost) content += "§a✓ " + (wishConfig.coreName || "星核") + "充足，可以兑换\n";
    else content += "§c✗ " + (wishConfig.coreName || "星核") + "不足，还需要 " + (item.cost - coreAmount) + " 颗\n";
    gui.setContent(content);
    gui.addButton("§a兑换", "textures/ui/check");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
    player.sendForm(gui, function(p, id) {
        if (id === null) return;
        if (id === 0) performCoreExchange(p, item);
        else if (id === 1) showCoreShopForm(p);
    });
}

/** 执行星核兑换：扣除星核、发放物品，失败时自动退还 */
function performCoreExchange(player, item) {
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const coreAmount = wd.currency.core || 0;
    if (coreAmount < item.cost) {
        player.sendModalForm("§c兑换失败", "§c" + (wishConfig.coreName || "星核") + "不足！\n需要 " + item.cost + " 颗" + (wishConfig.coreName || "星核") + "，当前只有 " + coreAmount + " 颗", "§a返回商店", "§c关闭", function(p, res) { if (res) showCoreShopForm(p); });
        return;
    }
    if (!checkInventorySpace(player, 1)) {
        player.sendModalForm("§c兑换失败", "§c背包空间不足！请清理背包后再兑换", "§a返回商店", "§c关闭", function(p, res) { if (res) showCoreShopForm(p); });
        return;
    }
    wd.currency.core -= item.cost;
    saveWishData();
    try {
        const itemObj = mc.newItem(NBT.parseSNBT(item.snbt));
        if (itemObj) {
            player.giveItem(itemObj);
            player.tell("§a成功兑换 " + item.name + "！消耗 " + item.cost + " 颗" + (wishConfig.coreName || "星核"));
            player.sendModalForm("§a兑换成功", "§a成功兑换 " + item.name + "！\n消耗 " + item.cost + " 颗" + (wishConfig.coreName || "星核") + "\n剩余 " + wd.currency.core + " 颗" + (wishConfig.coreName || "星核"), "§a返回", "§c关闭", function(p, res) { if (res) showCoreShopForm(p); });
        } else {
            wd.currency.core += item.cost;
            saveWishData();
            player.tell("§c物品创建失败，" + (wishConfig.coreName || "星核") + "已返还");
            showCoreShopForm(player);
        }
    } catch (error) {
        wd.currency.core += item.cost;
        saveWishData();
        logger.error((wishConfig.coreName || "星核") + '兑换失败：' + error.message);
        player.tell("§c兑换失败，" + (wishConfig.coreName || "星核") + "已返还");
        showCoreShopForm(player);
    }
}

/** 显示星尘商店主界面（凝炼、附魔书兑换、刷怪蛋兑换） */
function showDustShopMainForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b" + (wishConfig.dustName || "星尘") + "商店");
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const dustAmount = wd.currency.dust || 0;
    const today = new Date().toISOString().split('T')[0];
    const dustShopData = getPlayerDustShopData(xuid);
    const todayExchanged = dustShopData.dailyExchange[today] || 0;
    const remaining = Math.max(0, 900 - todayExchanged);
    let content = "-------------------------\n";
    content += "§a您当前拥有：§f" + dustAmount + " 点" + (wishConfig.dustName || "星尘") + "\n";
    content += "§a今日已兑换：§f" + todayExchanged + " / 900 点" + (wishConfig.dustName || "星尘") + "\n";
    content += "§a今日剩余：§f" + remaining + " 点" + (wishConfig.dustName || "星尘") + "\n";
    content += "-------------------------\n";
    content += "§a" + (wishConfig.dustName || "星尘") + "商店功能：\n";
    content += "§e" + (wishConfig.dustName || "星尘") + "凝炼：§f将" + _deps.getCurrencyName() + "兑换为" + (wishConfig.dustName || "星尘") + "\n";
    content += "§d附魔书兑换：§f使用" + (wishConfig.dustName || "星尘") + "兑换附魔书\n";
    content += "§a刷怪蛋兑换：§f使用" + (wishConfig.dustName || "星尘") + "兑换刷怪蛋\n";
    content += "-------------------------\n";
    gui.setContent(content);
    gui.addButton("§e" + (wishConfig.dustName || "星尘") + "凝炼", "textures/ui/xinchen");
    gui.addButton("§d附魔书兑换", "textures/ui/recipe_book_icon");
    gui.addButton("§a刷怪蛋兑换", "textures/items/spawn_eggs/spawn_egg_villager");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
    player.sendForm(gui, function(p, id) {
        if (id === null) return;
        if (id === 0) showDustRefineForm(p);
        else if (id === 1) showEnchantBookShopForm(p);
        else if (id === 2) showSpawnEggShopForm(p);
        else if (id === 3) { if (_deps.openMainMenu) _deps.openMainMenu(p); }
    });
}

/** 获取玩家星尘商店数据（每日兑换记录、累计节省金额） */
function getPlayerDustShopData(xuid) {
    const p = _deps.playerData && _deps.playerData.players && _deps.playerData.players[xuid];
    if (!p) return { dailyExchange: {}, savedMoney: 0 };
    if (!p.dustshop) {
        p.dustshop = { dailyExchange: {}, savedMoney: 0 };
        if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
    }
    return p.dustshop;
}

/** 显示星尘凝炼表单（用货币兑换星尘，每日上限900，VIP享95折） */
function showDustRefineForm(player) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§b" + (wishConfig.dustName || "星尘") + "凝炼");
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const dustAmount = wd.currency.dust || 0;
    const today = new Date().toISOString().split('T')[0];
    const dustShopData = getPlayerDustShopData(xuid);
    const todayExchanged = dustShopData.dailyExchange[today] || 0;
    const remaining = Math.max(0, 900 - todayExchanged);
    const hasMoonlightBlessing = _deps.vipModule && _deps.vipModule.checkPlayerHasMoonlightBlessing ? _deps.vipModule.checkPlayerHasMoonlightBlessing(xuid) : false;
    const balance = _deps.money ? _deps.money.get(xuid) || 0 : 0;
    gui.addLabel("§a您当前拥有：§f" + dustAmount + " 点" + (wishConfig.dustName || "星尘") + "\n§a今日已兑换：§f" + todayExchanged + " / 900 点" + (wishConfig.dustName || "星尘") + "\n§a今日剩余：§f" + remaining + " 点" + (wishConfig.dustName || "星尘") + "\n§a您的" + _deps.getCurrencyName() + "余额：§f" + balance + " 点\n" + (hasMoonlightBlessing ? "§a月光祝福：§f95折优惠" : ""));
    gui.addStepSlider("选择兑换数量", ["0点", "300点", "600点", "900点"], 0, "最多可兑换900点" + (wishConfig.dustName || "星尘"));
    gui.addInput("自定义兑换数量", "输入您要兑换的" + (wishConfig.dustName || "星尘") + "数量", "");
    player.sendForm(gui, function(p, data) {
        if (data === null || typeof data !== "object" || data.length < 3) { showDustShopMainForm(p); return; }
        const sliderIndex = data[1];
        const customAmountStr = data[2] || "";
        let amount = 0;
        if (sliderIndex === 0) amount = 0;
        else if (sliderIndex === 1) amount = 300;
        else if (sliderIndex === 2) amount = 600;
        else if (sliderIndex === 3) amount = 900;
        if (customAmountStr) {
            const customAmount = parseInt(customAmountStr);
            if (!isNaN(customAmount) && customAmount >= 0) amount = customAmount;
        }
        if (amount <= 0) { p.tell("§c请输入有效的兑换数量"); showDustRefineForm(p); return; }
        if (amount > remaining) { p.tell("§c今日剩余兑换额度不足，最多可兑换 " + remaining + " 点" + (wishConfig.dustName || "星尘")); showDustRefineForm(p); return; }
        const exchangeRate = 7;
        let requiredMoney = amount * exchangeRate;
        let savedMoney = 0;
        if (hasMoonlightBlessing) {
            const discountedMoney = Math.floor(requiredMoney * 0.95);
            savedMoney = requiredMoney - discountedMoney;
            requiredMoney = discountedMoney;
        }
        if (balance < requiredMoney) { p.tell("§c" + _deps.getCurrencyName() + "余额不足，需要 " + requiredMoney + " 点" + _deps.getCurrencyName()); showDustRefineForm(p); return; }
        if (_deps.money && _deps.money.reduce(p.xuid, requiredMoney)) {
            _deps.notifyEconomyChange(p, -requiredMoney, (wishConfig.dustName || "星尘") + "兑换");
            wd.currency.dust = (wd.currency.dust || 0) + amount;
            dustShopData.dailyExchange[today] = (dustShopData.dailyExchange[today] || 0) + amount;
            if (savedMoney > 0) dustShopData.savedMoney = (dustShopData.savedMoney || 0) + savedMoney;
            saveWishData();
            if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
            let receipt = "-------------------------\n";
            receipt += "§a兑换成功！\n\n";
            receipt += "§e兑换数量：§f" + amount + " 点" + (wishConfig.dustName || "星尘") + "\n";
            receipt += "§e消耗" + _deps.getCurrencyName() + "：§f" + requiredMoney + " 点\n";
            if (savedMoney > 0) receipt += "§e节约" + _deps.getCurrencyName() + "：§f" + savedMoney + " 点 (月光祝福95折)\n";
            receipt += "§e当前" + (wishConfig.dustName || "星尘") + "：§f" + wd.currency.dust + " 点\n";
            receipt += "§e剩余" + _deps.getCurrencyName() + "：§f" + (_deps.money.get(p.xuid) || 0) + " 点\n";
            receipt += "-------------------------\n";
            p.sendModalForm("§a兑换成功", receipt, "§a确定", "§c关闭", function(pl) { showDustShopMainForm(pl); });
        } else {
            p.tell("§c兑换失败，扣除失败");
            showDustRefineForm(p);
        }
    });
}

/** 显示附魔书商店（列出所有可兑换的附魔效果） */
function showEnchantBookShopForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§d附魔书商店");
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const dustAmount = wd.currency.dust || 0;
    let content = "-------------------------\n";
    content += "§a您当前拥有：§f" + dustAmount + " 点" + (wishConfig.dustName || "星尘") + "\n";
    content += "-------------------------\n";
    content += "§a请选择您想要的附魔效果：\n";
    content += "-------------------------\n";
    gui.setContent(content);
    try {
        const enchantments = enchantBookShopConfig.enchantments || {};
        const enchantIds = Object.keys(enchantments);
        enchantIds.forEach(function(id) {
            const ench = enchantments[id];
            gui.addButton("§l§5" + ench.name + " §r§8[最高等级: §a" + ench.max_lv + "§8]\n§c每级消耗: §e" + ench.cost_per_level + "点" + (wishConfig.dustName || "星尘"));
        });
        gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
        player.sendForm(gui, function(p, id) {
            if (id === null || id === enchantIds.length) { showDustShopMainForm(p); return; }
            showEnchantBookLevelForm(p, enchantIds[id], enchantments[enchantIds[id]]);
        });
    } catch (error) {
        logger.error('附魔书商店配置读取失败：' + error.message);
        player.tell("§c附魔书商店配置读取失败，请联系管理员");
        showDustShopMainForm(player);
    }
}

/** 显示附魔书等级选择表单 */
function showEnchantBookLevelForm(player, enchantId, enchantInfo) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§d" + enchantInfo.name + "附魔书");
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const dustAmount = wd.currency.dust || 0;
    gui.addLabel("附魔效果: §b" + enchantInfo.name + "\n最大等级: §a" + enchantInfo.max_lv + "\n每级消耗: §e" + enchantInfo.cost_per_level + "点" + (wishConfig.dustName || "星尘") + "\n您当前拥有: §f" + dustAmount + "点" + (wishConfig.dustName || "星尘"));
    const maxLevel = enchantInfo.max_lv;
    const levelOptions = [];
    for (let i = 1; i <= maxLevel; i++) levelOptions.push(i + "级");
    gui.addStepSlider("选择等级", levelOptions, 0, "选择" + enchantInfo.name + "附魔书的等级");
    player.sendForm(gui, function(p, data) {
        if (data === null || typeof data !== "object" || data.length < 2) { showEnchantBookShopForm(p); return; }
        const levelIndex = data[1];
        const level = levelIndex + 1;
        let cost = enchantInfo.cost_per_level * level;
        if (dustAmount < cost) {
            p.sendModalForm("§c" + (wishConfig.dustName || "星尘") + "不足", "§c兑换 §6" + enchantInfo.name + " " + level + "级 §c附魔书需要 §e" + cost + " 点" + (wishConfig.dustName || "星尘") + "\n§c您当前仅拥有 §e" + dustAmount + " 点" + (wishConfig.dustName || "星尘") + "\n§c请先获取足够" + (wishConfig.dustName || "星尘") + "后再尝试", "§a返回", "§c关闭", function(player) { showEnchantBookLevelForm(player, enchantId, enchantInfo); });
            return;
        }
        if (!checkInventorySpace(p, 1)) {
            p.sendModalForm("§c背包空间不足", "§c您的背包至少需要1个空位才能兑换附魔书，请清理背包后再尝试。", "§a返回", "§c关闭", function(player) { showEnchantBookLevelForm(player, enchantId, enchantInfo); });
            return;
        }
        processEnchantBookTrade(p, enchantId, enchantInfo, level, cost);
    });
}

/** 执行附魔书兑换：创建附魔书并给予玩家，扣除星尘 */
function processEnchantBookTrade(player, enchantId, enchantInfo, level, cost) {
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    try {
        const book = createEnchantedBook(parseInt(enchantId), level);
        if (!book) { player.tell("§c创建附魔书失败，请联系管理员"); showEnchantBookLevelForm(player, enchantId, enchantInfo); return; }
        const result = player.giveItem(book);
        if (result) {
            wd.currency.dust = (wd.currency.dust || 0) - cost;
            saveWishData();
            player.tell("§a成功兑换 §6" + enchantInfo.name + " " + level + "级 §a附魔书！", 1);
            player.tell("已扣除 §e" + cost + "点" + (wishConfig.dustName || "星尘"), 1);
            let receipt = "-------------------------\n";
            receipt += "§a兑换成功！\n\n";
            receipt += "§e附魔效果：§f" + enchantInfo.name + "\n";
            receipt += "§e附魔等级：§f" + level + "级\n";
            receipt += "§e消耗" + (wishConfig.dustName || "星尘") + "：§f" + cost + "点\n";
            receipt += "§e剩余" + (wishConfig.dustName || "星尘") + "：§f" + wd.currency.dust + "点\n";
            receipt += "-------------------------\n";
            player.sendModalForm("§a兑换成功", receipt, "§a继续兑换", "§c返回", function(pl, res) {
                if (res === true) showEnchantBookShopForm(pl);
                else showDustShopMainForm(pl);
            });
        } else {
            player.tell("§c无法给予附魔书，请确保背包有空间！");
            showEnchantBookLevelForm(player, enchantId, enchantInfo);
        }
    } catch (error) {
        logger.error('附魔书交易失败：' + error.message);
        player.tell("§c兑换失败，请联系管理员");
        showEnchantBookLevelForm(player, enchantId, enchantInfo);
    }
}

/** 通过SNBT创建指定附魔类型和等级的附魔书物品 */
function createEnchantedBook(enchantId, level) {
    try {
        const snbt = '{"Count":1b,"Damage":0s,"Name":"minecraft:enchanted_book","WasPickedUp":0b,"tag":{"ench":[{"id":' + enchantId + 's,"lvl":' + level + 's}]}}';
        const nbt = NBT.parseSNBT(snbt);
        if (nbt === null) { logger.error("解析附魔书SNBT失败: " + snbt); return null; }
        return mc.newItem(nbt);
    } catch (error) {
        logger.error('创建附魔书失败：' + error.message);
        return null;
    }
}

/** 显示刷怪蛋商店列表 */
function showSpawnEggShopForm(player) {
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§d刷怪蛋商店");
    try {
        const currency = spawnEggShopConfig.currency;
        const items = spawnEggShopConfig.items || [];
        const xuid = player.xuid;
        const wd = getPlayerWishData(xuid);
        const dustAmount = wd.currency.dust || 0;
        let content = "§7-------------------------\n";
        content += "§a货币: " + currency.name + "\n";
        content += "§a您当前拥有: §f" + dustAmount + " 点\n";
        content += "§7-------------------------\n";
        content += "§a点击选择要兑换的刷怪蛋:\n";
        content += "§7-------------------------\n";
        gui.setContent(content);
        items.forEach(function(item) {
            gui.addButton(item.name + "\n§c需要: §e" + item.cost + " 点" + currency.name, item.icon);
        });
        gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
        player.sendForm(gui, function(p, id) {
            if (id === null || id === items.length) { showDustShopMainForm(p); return; }
            showSpawnEggConfirmForm(p, items[id], currency);
        });
    } catch (error) {
        logger.error('[刷怪蛋商店] 读取配置失败: ' + error.message);
        player.tell("§c商店配置读取失败，请联系管理员");
        showDustShopMainForm(player);
    }
}

/** 显示刷怪蛋兑换确认表单（滑块选择数量，上限10） */
function showSpawnEggConfirmForm(player, item, currency, quantity) {
    quantity = quantity || 1;
    const gui = mc.newCustomForm();
    gui.setTitle("§l§d确认兑换");
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const dustAmount = wd.currency.dust || 0;
    const totalCost = item.cost * quantity;
    const totalAmount = item.amountGive * quantity;
    let content = "§7-------------------------\n";
    content += "§a您要兑换: " + item.name + "\n";
    content += "§a单价: §f" + item.cost + " 点/个\n";
    content += "§a您拥有: §f" + dustAmount + " 点" + currency.name + "\n";
    content += "§7-------------------------\n";
    if (dustAmount < item.cost) content += "§c您的" + (wishConfig.dustName || "星尘") + "不足！\n";
    else content += "§a调整数量后点击提交\n";
    content += "§7-------------------------\n";
    gui.addLabel(content);
    if (dustAmount >= item.cost) {
        const maxQuantity = Math.min(10, Math.floor(dustAmount / item.cost));
        gui.addSlider("§a选择数量", 1, maxQuantity, 1, quantity);
    }
    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined) { showSpawnEggShopForm(p); return; }
        if (dustAmount >= item.cost) {
            const selectedQuantity = data[1] || 1;
            processSpawnEggPurchase(p, item, currency, selectedQuantity);
        } else {
            showSpawnEggShopForm(p);
        }
    });
}

/** 执行刷怪蛋购买：扣除星尘、创建物品，失败时自动退还星尘 */
function processSpawnEggPurchase(player, item, currency, quantity) {
    quantity = quantity || 1;
    try {
        const xuid = player.xuid;
        const wd = getPlayerWishData(xuid);
        const dustAmount = wd.currency.dust || 0;
        const totalCost = item.cost * quantity;
        const totalAmount = item.amountGive * quantity;
        if (dustAmount < totalCost) { player.tell("§c" + (wishConfig.dustName || "星尘") + "不足！"); showSpawnEggShopForm(player); return; }
        wd.currency.dust = dustAmount - totalCost;
        saveWishData();
        const newItem = mc.newItem(item.id, totalAmount);
        if (!newItem) {
            player.tell("§c创建物品失败，请联系管理员！");
            wd.currency.dust = dustAmount;
            saveWishData();
            showSpawnEggShopForm(player);
            return;
        }
        const result = player.giveItem(newItem);
        if (result) {
            player.tell("§a兑换成功！获得 " + item.name + " x" + totalAmount + "，消耗 " + totalCost + " 点" + (wishConfig.dustName || "星尘"));
            const successForm = mc.newSimpleForm();
            successForm.setTitle("§l§a兑换成功");
            successForm.setContent("§a您已成功兑换！\n\n§a获得: " + item.name + " x" + totalAmount + "\n§c消耗: " + totalCost + " 点" + (wishConfig.dustName || "星尘") + "\n\n§a剩余" + (wishConfig.dustName || "星尘") + ": " + (dustAmount - totalCost) + " 点");
            successForm.addButton("§a继续兑换", item.icon);
            successForm.addButton("§c关闭", "textures/ui/crossout");
            player.sendForm(successForm, function(p, id) {
                if (id === null || id === undefined || id === 1) return;
                if (id === 0) showSpawnEggConfirmForm(p, item, currency, 1);
            });
        } else {
            player.tell("§c背包已满，无法给予物品！");
            wd.currency.dust = dustAmount;
            saveWishData();
            showSpawnEggShopForm(player);
        }
    } catch (error) {
        logger.error('[刷怪蛋商店] 购买失败: ' + error.message);
        player.tell("§c兑换失败，请联系管理员");
        showSpawnEggShopForm(player);
    }
}

/** 显示属性提升界面（用星核提升生命值上限） */
function showAttributeUpgradeForm(player) {
    const xuid = player.xuid;
    const wd = getPlayerWishData(xuid);
    const coreCount = wd.currency.core || 0;
    const attrForm = mc.newSimpleForm();
    attrForm.setTitle("§c§l属性提升");
    attrForm.setContent("§6拥有" + (wishConfig.coreName || "星核") + "：§e" + coreCount + " §f个");
    attrForm.addButton("§c§l生命值上限提升", "textures/ui/heart_new");
    attrForm.addButton("§c返回个人中心", "textures/ui/recap_glyph_desaturated");
    player.sendForm(attrForm, function(p, buttonIndex) {
        if (buttonIndex === null) return;
        if (buttonIndex === 0) showHealthUpgradeConfirmForm(p);
        else if (buttonIndex === 1) { if (_deps.showPersonalCenterForm) _deps.showPersonalCenterForm(p); }
    });
}

/** 显示生命值提升确认表单（5星核=+1HP，上限+20HP） */
function showHealthUpgradeConfirmForm(player) {
    const xuid = player.xuid;
    const playerInfo = _deps.playerData && _deps.playerData.players && _deps.playerData.players[xuid] || {};
    const healthBonus = playerInfo.healthBonus || 0;
    const wd = getPlayerWishData(xuid);
    const coreCount = wd.currency.core || 0;
    const BASE_HEALTH = 40;
    const MAX_BONUS = 20;
    const COST_PER_POINT = 5;
    const currentMaxHealth = BASE_HEALTH + healthBonus;
    const maxCanUpgradePoints = Math.floor(coreCount / COST_PER_POINT);
    const maxCanUpgrade = Math.min(MAX_BONUS - healthBonus, maxCanUpgradePoints);

    if (maxCanUpgrade <= 0) {
        player.sendModalForm("§c无法提升", "§c您没有足够的" + (wishConfig.coreName || "星核") + "或已达到提升上限！", "§a返回", "§c关闭", function(pl, result) { if (result) showAttributeUpgradeForm(pl); });
        return;
    }

    const confirmForm = mc.newCustomForm();
    confirmForm.setTitle("§c§l提升生命值上限");
    confirmForm.addLabel("当前生命值上限：§c" + currentMaxHealth + " §f点");
    confirmForm.addLabel("拥有" + (wishConfig.coreName || "星核") + "：§e" + coreCount + " §f个");
    confirmForm.addLabel("兑换比例：§65" + (wishConfig.coreName || "星核") + " = §c+1点§f生命值");
    confirmForm.addLabel("最多可提升：§e" + maxCanUpgrade + " §f点\n");
    confirmForm.addSlider("§a选择提升点数", 1, maxCanUpgrade, 1, 1);
    confirmForm.addLabel("\n§e消耗：§f选择点数 × " + COST_PER_POINT + " = §e选择点数×5 §f颗" + (wishConfig.coreName || "星核"));
    confirmForm.addLabel("提升后生命值上限：§c" + currentMaxHealth + " + 选择点数\n");

    player.sendForm(confirmForm, function(p, data) {
        if (data === null) { showAttributeUpgradeForm(p); return; }
        const upgradeAmount = data[4];
        const cost = upgradeAmount * COST_PER_POINT;
        if (upgradeAmount > 0 && upgradeAmount <= maxCanUpgrade && cost <= coreCount) {
            wd.currency.core -= cost;
            saveWishData();
            playerInfo.healthBonus = healthBonus + upgradeAmount;
            if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
            const newMaxHealth = BASE_HEALTH + playerInfo.healthBonus;
            p.setMaxHealth(newMaxHealth);
            p.setHealth(newMaxHealth);
            p.sendModalForm("§a提升成功", "§a生命值上限提升成功！\n\n§a提升了：§e+" + upgradeAmount + " §f点\n§a当前上限：§c" + newMaxHealth + " §f点\n§a消耗" + (wishConfig.coreName || "星核") + "：§e" + cost + " §f个\n§a剩余" + (wishConfig.coreName || "星核") + "：§e" + wd.currency.core + " §f个", "§a继续提升", "§c返回", function(pl2, result2) {
                if (result2) showHealthUpgradeConfirmForm(pl2);
                else showAttributeUpgradeForm(pl2);
            });
            logger.info('玩家 ' + p.name + ' 消耗 ' + cost + ' ' + (wishConfig.coreName || "星核") + '提升生命值上限 +' + upgradeAmount + '点，当前：' + newMaxHealth);
        } else {
            p.tell("§c提升失败：参数错误或" + (wishConfig.coreName || "星核") + "不足！");
            showAttributeUpgradeForm(p);
        }
    });
}

/** 分页显示祈愿历史记录（从JSON日志文件读取，上限1000条） */
function showWishHistoryForm(player, page) {
    const xuid = player.xuid;
    const logPath = 'plugins/NLCE/logs/wish_' + xuid + '.json';
    let history = [];
    try {
        if (fs.existsSync(logPath)) {
            const logStr = fs.readFileSync(logPath, 'utf-8');
            history = JSON.parse(logStr) || [];
        }
    } catch (error) {
        logger.error('祈愿历史记录读取失败！错误：' + error.message);
    }
    const itemsPerPage = 20;
    const totalPages = Math.ceil(history.length / itemsPerPage);
    const currentPage = Math.max(1, Math.min(page, totalPages || 1));
    const gui = mc.newSimpleForm();
    gui.setTitle("§l§b祈愿历史 (第" + currentPage + "/" + (totalPages || 1) + ")");
    let content = "-------------------------\n";
    if (history.length === 0) {
        content += "§c暂无祈愿记录\n";
    } else {
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, history.length);
        for (let i = startIndex; i < endIndex; i++) {
            const record = history[i];
            let rarityColor = "";
            let rarityText = "3星";
            let rewardText = "";
            if (record.rarity === "fiveStar") {
                rarityColor = "§e"; rarityText = "5星";
                rewardText = record.reward.type === "core" ? (wishConfig.coreName || "星核") : (record.reward.name || "未知物品");
            } else if (record.rarity === "fourStar") {
                rarityColor = "§u"; rarityText = "4星";
                rewardText = record.reward.type === "core" ? (wishConfig.coreName || "星核") : (record.reward.name || "未知物品");
            } else {
                rarityColor = "§b"; rarityText = "3星";
                rewardText = (wishConfig.dustName || "星尘") + " " + record.reward.amount + " 点";
            }
            content += "§a" + record.date + " " + rarityColor + rarityText + " " + rewardText + "\n";
        }
    }
    content += "-------------------------\n";
    content += "§a总记录数：" + history.length + " 条\n\n§6仅显示前1000条记录";
    gui.setContent(content);
    if (currentPage > 1) gui.addButton("§a上一页", "textures/ui/arrow_left");
    if (currentPage < totalPages) gui.addButton("§a下一页", "textures/ui/arrow_right");
    gui.addButton("§6跳转到页码", "textures/ui/book_metatag_hover");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
    player.sendForm(gui, function(p, id) {
        if (id === null) return;
        let buttonOffset = 0;
        if (currentPage > 1) { if (id === buttonOffset) { showWishHistoryForm(p, currentPage - 1); return; } buttonOffset++; }
        if (currentPage < totalPages) { if (id === buttonOffset) { showWishHistoryForm(p, currentPage + 1); return; } buttonOffset++; }
        if (id === buttonOffset) {
            const jumpGui = mc.newCustomForm();
            jumpGui.setTitle("§l§b跳转到页码");
            jumpGui.addInput("输入页码", "1-" + totalPages, "");
            p.sendForm(jumpGui, function(player, data) {
                if (data === null || data.length < 1) { showWishHistoryForm(player, currentPage); return; }
                const targetPage = parseInt(data[0]);
                if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) { player.tell("§c请输入有效的页码"); showWishHistoryForm(player, currentPage); return; }
                showWishHistoryForm(player, targetPage);
            });
        } else if (id === buttonOffset + 1) {
            showWishMainForm(p);
        }
    });
}

module.exports = {
    init: init,
    reloadConfig: reloadConfig,
    saveWishData: saveWishData,
    getPlayerWishData: getPlayerWishData,
    showWishMainForm: showWishMainForm,
    showDustShopMainForm: showDustShopMainForm,
    showEnchantBookShopForm: showEnchantBookShopForm,
    showAttributeUpgradeForm: showAttributeUpgradeForm,
    getWishData: function() { return wishData; },
    getWishConfig: function() { return wishConfig; }
};
