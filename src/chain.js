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
 * NECE 连锁挖矿模块
 * 使用工具挖掘时自动连锁破坏相邻同类方块
 * 按工具类型配置可连锁方块，通过命名空间自动识别工具
 */

let _config = null;
let _deps = {};
let _debug = false;
let _onChainComplete = null;
let _itemsMap = null;

// 配置缓存
let _cachedConfig = null;
let _configVersion = 0;

// 连锁冷却记录 { xuid: timestamp }
const _chainCooldowns = {};

// ============ 连锁计划系统 ============

// 默认计划配置
const DEFAULT_PLANS = {
    free: { dailyLimit: 100, price: 0, duration: 0 },
    lite: { dailyLimit: 500, price: 500, duration: 7 },
    standard: { dailyLimit: 1000, price: 1000, duration: 7 },
    pro: { dailyLimit: 2000, price: 1800, duration: 7 },
    max: { dailyLimit: 5000, price: 3000, duration: 7 }
};

// 套餐名称格式
const PLAN_NAME_FORMAT = {
    free: '§l§i[Free]§r',
    lite: '§l§h[Lite]§r',
    standard: '§l§q[Standard]§r',
    pro: '§l§s[Pro]§r',
    max: '§l§p[Max]§r'
};

/**
 * 获取套餐显示名称
 * @param {string} planName - 计划名称
 * @returns {string}
 */
function getPlanDisplayName(planName) {
    return PLAN_NAME_FORMAT[planName] || planName;
}

function init(config, deps) {
    _config = config;
    _deps = deps || {};
    _debug = config && config.get('debug') === true;
}

/** 获取连锁全局配置，带缓存 */
function getChainConfig() {
    if (!_config) return {};
    var currentVersion = _config._version || 0;
    if (!_cachedConfig || currentVersion !== _configVersion) {
        _cachedConfig = _config.get('chain', {});
        _configVersion = currentVersion;
    }
    return _cachedConfig;
}

/**
 * 获取计划配置
 * @returns {object}
 */
function getPlanConfig() {
    var chainCfg = getChainConfig();
    if (chainCfg.plans) {
        return chainCfg.plans;
    }
    return DEFAULT_PLANS;
}

/**
 * 获取玩家连锁计划数据
 * @param {string} xuid
 * @returns {object}
 */
function getPlayerPlanData(xuid) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) {
        return { plan: 'free', expireTime: 0, dailyUsed: 0, lastResetDate: '' };
    }
    var player = pd.players[xuid];
    if (!player.chainPlan) {
        player.chainPlan = { plan: 'free', expireTime: 0, dailyUsed: 0, lastResetDate: '' };
    }
    return player.chainPlan;
}

/**
 * 保存玩家连锁计划数据
 * @param {string} xuid
 * @param {object} planData
 */
function savePlanData(xuid, planData) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) return;
    pd.players[xuid].chainPlan = planData;
    if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
}

/**
 * 重置每日用量（凌晨重置）
 * @param {object} planData
 */
function resetDailyUsage(planData) {
    var now = new Date();
    var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    if (planData.lastResetDate !== today) {
        planData.dailyUsed = 0;
        planData.lastResetDate = today;
    }
}

/**
 * 检查玩家是否可以继续连锁
 * @param {string} xuid
 * @returns {{ canChain: boolean, remaining: number, plan: string, dailyLimit: number }}
 */
function checkCanChain(xuid) {
    var planData = getPlayerPlanData(xuid);
    resetDailyUsage(planData);

    var planConfig = getPlanConfig();
    var plan = planData.plan || 'free';
    var planInfo = planConfig[plan] || DEFAULT_PLANS.free;

    // 检查付费计划是否过期
    if (plan !== 'free' && planData.expireTime > 0 && Date.now() > planData.expireTime) {
        planData.plan = 'free';
        planData.expireTime = 0;
        savePlanData(xuid, planData);
        plan = 'free';
        planInfo = planConfig['free'] || DEFAULT_PLANS.free;
    }

    var dailyLimit = planInfo.dailyLimit || 100;
    var remaining = dailyLimit - planData.dailyUsed;

    return {
        canChain: remaining > 0,
        remaining: Math.max(0, remaining),
        plan: plan,
        dailyLimit: dailyLimit,
        dailyUsed: planData.dailyUsed
    };
}

/**
 * 增加每日用量
 * @param {string} xuid
 * @param {number} count - 连锁方块数
 */
function addDailyUsage(xuid, count) {
    var planData = getPlayerPlanData(xuid);
    resetDailyUsage(planData);
    planData.dailyUsed += count;
    savePlanData(xuid, planData);
}

/**
 * 购买/升级计划
 * @param {object} player - 玩家对象
 * @param {string} planName - 计划名称
 * @returns {{ success: boolean, message: string }}
 */
function purchasePlan(player, planName) {
    var xuid = player.xuid;
    var planConfig = getPlanConfig();

    if (!planConfig[planName]) {
        return { success: false, message: '§c无效的计划' };
    }

    if (planName === 'free') {
        return { success: false, message: '§c不能购买免费计划' };
    }

    var planData = getPlayerPlanData(xuid);
    var now = Date.now();
    var currentPlan = planData.plan || 'free';

    // 检查是否已有相同计划且未过期
    if (currentPlan === planName && planData.expireTime > now) {
        return { success: false, message: '§c您已有该计划且未过期，请使用续费功能' };
    }

    var planInfo = planConfig[planName];
    var price = planInfo.price || 0;
    var duration = planInfo.duration || 7;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    // 计算实际价格（如果是升级，补差价）
    var actualPrice = price;

    if (currentPlan !== 'free' && planData.expireTime > now) {
        // 已有付费计划且未过期，计算差价
        var currentPlanInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
        var currentPrice = currentPlanInfo.price || 0;
        var priceDiff = price - currentPrice;

        if (priceDiff <= 0) {
            return { success: false, message: '§c不能降级或购买相同等级的计划' };
        }

        // 计算剩余天数
        var remainingDays = Math.ceil((planData.expireTime - now) / (1000 * 60 * 60 * 24));

        // 差价 = (新计划价格 - 旧计划价格) * 剩余天数 / 7
        actualPrice = Math.ceil(priceDiff * remainingDays / 7);
    }

    // 检查余额
    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < actualPrice) {
        return { success: false, message: '§c余额不足！需要 ' + actualPrice + ' ' + currencyName };
    }

    // 扣费
    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(planName);
        var currentDisplayName = getPlanDisplayName(currentPlan);
        var reason = currentPlan !== 'free' && planData.expireTime > now ?
            'Block Plan 升级: ' + currentDisplayName + ' -> ' + displayName :
            'Block Plan 购买: ' + displayName;
        if (!_deps.reducePlayerMoney(player, actualPrice, reason)) {
            return { success: false, message: '§c购买失败' };
        }
    }

    // 更新计划（新计划替换旧计划）
    var expireTime = now + (duration * 24 * 60 * 60 * 1000);

    planData.plan = planName;
    planData.expireTime = expireTime;
    savePlanData(xuid, planData);

    var successDisplayName = getPlanDisplayName(planName);
    return { success: true, message: '§a购买成功！计划: ' + successDisplayName + ', 时长: ' + duration + ' 天' };
}

/**
 * 续费当前计划
 * @param {object} player - 玩家对象
 * @param {number} weeks - 续费周数（1-3）
 * @returns {{ success: boolean, message: string }}
 */
function renewPlan(player, weeks) {
    var xuid = player.xuid;
    var planConfig = getPlanConfig();
    var planData = getPlayerPlanData(xuid);
    var now = Date.now();
    var currentPlan = planData.plan || 'free';

    if (currentPlan === 'free') {
        return { success: false, message: '§c免费计划无法续费，请先购买付费计划' };
    }

    if (weeks < 1 || weeks > 3) {
        return { success: false, message: '§c续费周数必须在1-3之间' };
    }

    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var weeklyPrice = Math.ceil((planInfo.price || 0) / (planInfo.duration || 7) * 7);
    var totalPrice = weeklyPrice * weeks;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    // 检查余额
    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < totalPrice) {
        return { success: false, message: '§c余额不足！续费' + weeks + '周需要 ' + totalPrice + ' ' + currencyName };
    }

    // 扣费
    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(currentPlan);
        if (!_deps.reducePlayerMoney(player, totalPrice, 'Block Plan 续费: ' + displayName + ' ' + weeks + '周')) {
            return { success: false, message: '§c续费失败' };
        }
    }

    // 延长到期时间
    var baseTime = planData.expireTime > now ? planData.expireTime : now;
    var addDays = weeks * 7;
    planData.expireTime = baseTime + (addDays * 24 * 60 * 60 * 1000);
    savePlanData(xuid, planData);

    var displayName2 = getPlanDisplayName(currentPlan);
    return { success: true, message: '§a续费成功！计划: ' + displayName2 + ', 延长: ' + addDays + ' 天' };
}

/**
 * 显示连锁计划主界面
 * @param {Player} player
 */
function showPlanMenu(player) {
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    resetDailyUsage(planData);

    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS.free;
    var checkResult = checkCanChain(xuid);
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var isActive = currentPlan !== 'free' && planData.expireTime > Date.now();

    // 根据是否已购买计划显示不同界面
    if (isActive) {
        // 已购买且未到期：显示两个独立按钮（续费和升级）
        showActivePlanMenu(player, planData, planInfo, checkResult, currencyName);
    } else {
        // 未购买或已到期：显示下拉菜单选择购买
        showPurchasePlanMenu(player, planData, planInfo, checkResult, currencyName, planConfig);
    }
}

/**
 * 显示已激活计划的界面（续费和升级按钮）
 */
function showActivePlanMenu(player, planData, planInfo, checkResult, currencyName) {
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§bBlock Plan');

    var planConfig = getPlanConfig();
    var expireDate = new Date(planData.expireTime);
    var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
    var planDisplayName = getPlanDisplayName(planData.plan || 'free');

    var content = '§a当前计划：' + planDisplayName + '\n';
    content += '§a今日用量：§f' + planData.dailyUsed + '/' + planInfo.dailyLimit + '\n';
    content += '§a今日剩余：§f' + checkResult.remaining + '\n';
    content += '§a到期时间：§f' + expireDate.getFullYear() + '年' + (expireDate.getMonth() + 1) + '月' + expireDate.getDate() + '日\n';
    content += '§a剩余天数：§f' + remainingDays + ' 天\n';
    content += '\n§e§lBlock Plan 说明：\n';
    content += '§r§7购买 Block Plan 可提升每日连锁方块上限\n\n';

    var plans = ['free', 'lite', 'standard', 'pro', 'max'];
    for (var i = 0; i < plans.length; i++) {
        var pName = plans[i];
        var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
        var pDisplayName = getPlanDisplayName(pName);
        content += pDisplayName + ' §7- ' + pInfo.dailyLimit + '/天';
        if (pName === 'free') content += ' §e(默认)';
        content += '\n';
    }

    fm.setContent(content);
    fm.addButton('§a续费计划', "textures/ui/confirm");
    fm.addButton('§b升级计划', "textures/ui/jump_boost_effect");
    fm.addButton('§c返回', "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 0) {
            showRenewMenu(p);
        } else if (id === 1) {
            showUpgradeMenu(p);
        } else if (id === 2) {
            showChainSettingsForm(p);
        }
    });
}

/**
 * 显示续费界面
 */
function showRenewMenu(player) {
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var weeklyPrice = Math.ceil((planInfo.price || 0) / (planInfo.duration || 7) * 7);
    var currentDisplayName = getPlanDisplayName(currentPlan);

    var fm = mc.newCustomForm();
    fm.setTitle('§l§aBlock Plan - 续费');

    fm.addLabel('§a当前计划：' + currentDisplayName);
    fm.addLabel('§a每周价格：§f' + weeklyPrice + ' ' + currencyName);

    var renewOptions = [
        '1周 - ' + weeklyPrice + currencyName,
        '2周 - ' + (weeklyPrice * 2) + currencyName,
        '3周 - ' + (weeklyPrice * 3) + currencyName
    ];
    fm.addDropdown('选择续费周数', renewOptions, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) {
            showPlanMenu(p);
            return;
        }

        // 找到下拉菜单的索引
        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                var weeks = data[i] + 1;
                showRenewConfirm(p, weeks);
                return;
            }
        }
    });
}

/**
 * 显示升级界面
 */
function showUpgradeMenu(player) {
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var currentDisplayName = getPlanDisplayName(currentPlan);

    var fm = mc.newCustomForm();
    fm.setTitle('§l§bBlock Plan - 升级');

    fm.addLabel('§a当前计划：' + currentDisplayName);

    // 只显示比当前计划更高级的计划
    var planOrder = ['lite', 'standard', 'pro', 'max'];
    var currentIndex = planOrder.indexOf(currentPlan);
    var upgradeOptions = [];
    var upgradePlans = [];

    var currentPlanInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currentPrice = currentPlanInfo.price || 0;
    var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));

    for (var i = currentIndex + 1; i < planOrder.length; i++) {
        var pName = planOrder[i];
        var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
        var priceDiff = (pInfo.price || 0) - currentPrice;
        var upgradePrice = Math.ceil(priceDiff * remainingDays / 7);
        var displayName = getPlanDisplayName(pName);

        upgradeOptions.push(displayName + ' - 每日' + pInfo.dailyLimit + '个 - 补差价' + upgradePrice + currencyName);
        upgradePlans.push(pName);
    }

    if (upgradeOptions.length === 0) {
        fm.addLabel('§c您已是最高级别计划，无法继续升级');
    } else {
        fm.addDropdown('选择升级计划', upgradeOptions, 0);
    }

    player.sendForm(fm, function(p, data) {
        if (data == null) {
            showPlanMenu(p);
            return;
        }

        if (upgradeOptions.length > 0) {
            for (var i = 0; i < data.length; i++) {
                if (typeof data[i] === 'number') {
                    var selectedPlan = upgradePlans[data[i]];
                    showPurchaseConfirm(p, selectedPlan);
                    return;
                }
            }
        }
    });
}

/**
 * 显示购买计划界面（未购买或已到期时）
 */
function showPurchasePlanMenu(player, planData, planInfo, checkResult, currencyName, planConfig) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§bBlock Plan');

    // 显示当前计划信息
    var currentDisplayName = getPlanDisplayName(planData.plan || 'free');
    fm.addLabel('§a当前计划：' + currentDisplayName);
    fm.addLabel('§a今日用量：§f' + planData.dailyUsed + '/' + planInfo.dailyLimit);
    fm.addLabel('§a今日剩余：§f' + checkResult.remaining);

    // 添加描述文本
    var freeLimit = (planConfig.free || DEFAULT_PLANS.free).dailyLimit;
    var liteLimit = (planConfig.lite || DEFAULT_PLANS.lite).dailyLimit;
    var standardLimit = (planConfig.standard || DEFAULT_PLANS.standard).dailyLimit;
    var proLimit = (planConfig.pro || DEFAULT_PLANS.pro).dailyLimit;
    var maxLimit = (planConfig.max || DEFAULT_PLANS.max).dailyLimit;

    var freeName = getPlanDisplayName('free');
    var liteName = getPlanDisplayName('lite');
    var standardName = getPlanDisplayName('standard');
    var proName = getPlanDisplayName('pro');
    var maxName = getPlanDisplayName('max');

    fm.addLabel('§e§lBlock Plan 说明：\n' +
        '§r§7购买 Block Plan 可提升每日连锁方块上限\n\n' +
        freeName + ' §7- ' + freeLimit + '/天 §e(默认)\n' +
        liteName + ' §7- ' + liteLimit + '/天\n' +
        standardName + ' §7- ' + standardLimit + '/天\n' +
        proName + ' §7- ' + proLimit + '/天\n' +
        maxName + ' §7- ' + maxLimit + '/天');

    // 下拉菜单选择计划
    var planOptions = [];
    var planKeys = ['lite', 'standard', 'pro', 'max'];

    for (var i = 0; i < planKeys.length; i++) {
        var pName = planKeys[i];
        var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
        var displayName = getPlanDisplayName(pName);
        planOptions.push(displayName + ' - 每日' + pInfo.dailyLimit + '个 - ' + (pInfo.price || 0) + currencyName + ' - ' + (pInfo.duration || 0) + '天');
    }

    fm.addDropdown('选择计划', planOptions, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) return;

        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                var selectedPlan = planKeys[data[i]];
                showPurchaseConfirm(p, selectedPlan);
                return;
            }
        }
    });
}

/**
 * 显示购买确认界面
 * @param {Player} player
 * @param {string} planName
 */
function showPurchaseConfirm(player, planName) {
    var planConfig = getPlanConfig();
    var planInfo = planConfig[planName] || DEFAULT_PLANS[planName];
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var displayName = getPlanDisplayName(planName);

    player.sendModalForm(
        '§cBlock Plan - 确认购买',
        '§a计划名称：' + displayName + '\n§a每日上限：§f' + planInfo.dailyLimit + ' 个\n§a价格：§f' + planInfo.price + ' ' + currencyName + '\n§a时长：§f' + planInfo.duration + ' 天\n\n§c确认购买？',
        '§a确认购买',
        '§c取消',
        function(p, result) {
            if (result === true) {
                var purchaseResult = purchasePlan(p, planName);
                p.tell(purchaseResult.message);
                if (purchaseResult.success) {
                    showPlanMenu(p);
                }
            } else {
                showPlanMenu(p);
            }
        }
    );
}

/**
 * 显示续费确认界面
 * @param {Player} player
 * @param {number} weeks - 续费周数
 */
function showRenewConfirm(player, weeks) {
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var currentPlan = planData.plan || 'free';
    var planConfig = getPlanConfig();
    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    var weeklyPrice = Math.ceil((planInfo.price || 0) / (planInfo.duration || 7) * 7);
    var totalPrice = weeklyPrice * weeks;
    var displayName = getPlanDisplayName(currentPlan);

    player.sendModalForm(
        '§cBlock Plan - 确认续费',
        '§a当前计划：' + displayName + '\n§a续费周数：§f' + weeks + ' 周\n§a续费金额：§f' + totalPrice + ' ' + currencyName + '\n\n§c确认续费？',
        '§a确认续费',
        '§c取消',
        function(p, result) {
            if (result === true) {
                var renewResult = renewPlan(p, weeks);
                p.tell(renewResult.message);
                if (renewResult.success) {
                    showPlanMenu(p);
                }
            } else {
                showPlanMenu(p);
            }
        }
    );
}

/**
 * 获取工具最大耐久度
 * @param {Player} player
 * @returns {number}
 */
function getMaxDurability(player) {
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return 0;
        return item.maxDamage || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 获取玩家手持工具当前剩余耐久度
 * @param {Player} player
 * @returns {number}
 */
function getDurability(player) {
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return 0;
        var maxDur = item.maxDamage || 0;
        if (maxDur <= 0) return 0;
        var damage = item.damage || 0;
        return maxDur - damage;
    } catch (e) {
        return 0;
    }
}

/**
 * 获取耐久附魔等级
 * BDS使用tag.ench，附魔ID为数字格式
 * @param {Item} item
 * @returns {number} 附魔等级，无附魔返回0
 */
function getUnbreakingLevel(item) {
    try {
        var nbt = item.getNbt();
        if (!nbt) return 0;

        // BDS: tag.ench 是 NbtList of NbtCompound
        var tag = nbt.getTag('tag');
        if (!tag) return 0;
        var ench = tag.getTag('ench');
        if (!ench) return 0;

        // 转换为数组读取
        var enchArray = ench.toArray();
        for (var i = 0; i < enchArray.length; i++) {
            var e = enchArray[i];
            // BDS附魔: {id: 17, lvl: 3}
            if (e.id === 17) {
                return e.lvl || 0;
            }
        }
        return 0;
    } catch (e) {
        if (_debug) {
            logger.info('[Chain] getUnbreakingLevel 异常: ' + e.message);
        }
        return 0;
    }
}

/**
 * 设置玩家手持工具耐久度
 * 延迟执行以确保游戏自身耐久扣除已完成
 * 考虑耐久附魔：每次消耗概率为 1/(等级+1)
 * @param {Player} player
 * @param {number} chainCount - 连锁破坏的方块数
 * @param {number} unbreakingLevel - 耐久附魔等级
 */
function applyChainDurability(player, chainCount, unbreakingLevel) {
    setTimeout(function() {
        try {
            var item = player.getHand();
            if (!item || item.isNull()) return;
            var maxDur = item.maxDamage || 0;
            if (maxDur <= 0) return;

            // 按概率计算实际消耗的耐久
            var actualDamage = 0;
            var chance = 1 / (unbreakingLevel + 1);
            for (var i = 0; i < chainCount; i++) {
                if (Math.random() < chance) {
                    actualDamage++;
                }
            }

            var currentDamage = item.damage || 0;
            var newDamage = currentDamage + actualDamage;
            if (newDamage >= maxDur) {
                newDamage = maxDur - 1;
            }
            item.setDamage(newDamage);
            player.refreshItems();
            if (_debug) {
                logger.info('[Chain] 延迟设置耐久: currentDamage=' + currentDamage + ' chainCount=' + chainCount + ' actualDamage=' + actualDamage + ' newDamage=' + newDamage + ' maxDur=' + maxDur + ' unbreaking=' + unbreakingLevel);
            }
        } catch (e) {
            if (_debug) {
                logger.info('[Chain] applyChainDurability 异常: ' + e.message);
            }
        }
    }, 50);
}

/**
 * 根据手持物品ID判断工具类型
 * 通过命名空间后缀判断，支持所有材质（木/石/铁/金/钻/下界合金）
 * @param {string} itemId - 物品ID，如 minecraft:diamond_pickaxe
 * @returns {string|null} 工具类型：pickaxe/axe/shovel/hoe，或 null
 */
function getToolType(itemId) {
    if (!itemId) return null;
    var id = itemId.toLowerCase();
    if (id.endsWith('_pickaxe')) return 'pickaxe';
    if (id.endsWith('_axe')) return 'axe';
    if (id.endsWith('_shovel')) return 'shovel';
    if (id.endsWith('_hoe')) return 'hoe';
    return null;
}

/**
 * 检查指定工具类型是否可以连锁指定方块
 * @param {string} toolType - 工具类型
 * @param {string} blockType - 方块类型
 * @returns {boolean}
 */
function canToolMineBlock(toolType, blockType) {
    var cfg = getChainConfig();
    var blocks = cfg[toolType] || [];
    for (var i = 0; i < blocks.length; i++) {
        if (blocks[i] === blockType) return true;
    }
    return false;
}

/**
 * 获取所有可连锁的方块列表（合并所有工具类型）
 * @returns {string[]}
 */
function getAllAllowedBlocks() {
    var cfg = getChainConfig();
    var allBlocks = [];
    var types = ['pickaxe', 'axe', 'shovel', 'hoe'];
    for (var i = 0; i < types.length; i++) {
        var blocks = cfg[types[i]] || [];
        for (var j = 0; j < blocks.length; j++) {
            if (allBlocks.indexOf(blocks[j]) === -1) {
                allBlocks.push(blocks[j]);
            }
        }
    }
    return allBlocks;
}

/** 获取玩家连锁个人配置，默认全部启用 */
function getPlayerChainConfig(xuid) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    var defaultCfg = { enabled: true, mineAll: false, sneakOnly: true, blocks: {} };
    if (!pd || !pd.players || !pd.players[xuid]) return defaultCfg;
    var p = pd.players[xuid];
    if (!p.chain) {
        p.chain = defaultCfg;
    }
    if (p.chain.enabled === undefined) p.chain.enabled = true;
    if (p.chain.mineAll === undefined) p.chain.mineAll = false;
    if (p.chain.sneakOnly === undefined) p.chain.sneakOnly = true;
    if (!p.chain.blocks) p.chain.blocks = {};
    return p.chain;
}

/** 保存玩家连锁配置，只保存被禁用的方块以节省空间 */
function savePlayerChainConfig(xuid, cfg) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) return;

    // 获取当前配置中的所有方块
    var allBlocks = getAllAllowedBlocks();

    // 只保存被禁用的方块
    var disabledBlocks = {};
    for (var i = 0; i < allBlocks.length; i++) {
        var blockId = allBlocks[i];
        if (cfg.blocks[blockId] === false) {
            disabledBlocks[blockId] = false;
        }
    }

    // 保存精简配置
    var chainData = {
        enabled: cfg.enabled === true,
        mineAll: cfg.mineAll === true,
        sneakOnly: cfg.sneakOnly !== false,
        blocks: disabledBlocks
    };
    pd.players[xuid].chain = chainData;

    // 立即写入数据库
    if (_deps.savePlayerDataNow) {
        _deps.savePlayerDataNow();
    }
}

/** 获取方块的中文名 */
function getBlockName(blockId) {
    if (!_itemsMap) {
        try {
            var fs = require('fs');
            var path = require('path');
            var itemsPath = path.join(__dirname, '..', 'public', 'textures', 'items.json');
            var data = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
            _itemsMap = data.item || {};
        } catch (e) { _itemsMap = {}; }
    }
    var key = blockId.replace('minecraft:', '');
    var entry = _itemsMap[key];
    if (entry) return (typeof entry === 'object') ? (entry.name || key) : entry;
    return key;
}

/** 显示连锁设置表单 */
function showChainSettingsForm(player) {
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);
    var chainCheck = checkCanChain(player.xuid);
    var planDisplayName = getPlanDisplayName(chainCheck.plan);

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§6连锁挖矿 - Block Plan');

    var content = '§a当前计划：' + planDisplayName + '\n';
    content += '§a今日用量：§f' + chainCheck.dailyUsed + '/' + chainCheck.dailyLimit + '\n';
    content += '§a今日剩余：§f' + chainCheck.remaining + '\n';
    content += '-------------------------\n';
    fm.setContent(content);

    fm.addButton('§a连锁设置', "textures/ui/icon_setting");
    fm.addButton('§bBlock Plan', "textures/ui/confirm");

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 0) {
            showChainConfigForm(p);
        } else if (id === 1) {
            showPlanMenu(p);
        }
    });
}

/** 显示连锁配置表单 */
function showChainConfigForm(player) {
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);

    var fm = mc.newCustomForm();
    fm.setTitle("§l§6连锁挖矿设置");
    fm.addSwitch("§a连锁总开关", playerCfg.enabled);
    fm.addSwitch("§c无视方块配置", playerCfg.mineAll);
    fm.addSwitch("§e蹲下时才启用连锁", playerCfg.sneakOnly);

    // 记录每个工具类型对应的方块ID列表
    var blockIdList = [];
    var toolTypes = ['pickaxe', 'axe', 'shovel', 'hoe'];
    var toolNames = { pickaxe: '§7稿子', axe: '§7斧子', shovel: '§7铲子', hoe: '§7锄头' };

    for (var t = 0; t < toolTypes.length; t++) {
        var toolKey = toolTypes[t];
        var blocks = cfg[toolKey] || [];
        if (blocks.length > 0) {
            fm.addLabel(toolNames[toolKey]);
            for (var i = 0; i < blocks.length; i++) {
                var blockId = blocks[i];
                var name = getBlockName(blockId);
                var enabled = playerCfg.blocks[blockId] !== false;
                fm.addSwitch(name, enabled);
                blockIdList.push(blockId);
            }
        }
    }

    player.sendForm(fm, function(p, data) {
        if (data === null || data === undefined) {
            showChainSettingsForm(p);
            return;
        }

        // CustomForm 返回数组：[switch0, switch1, switch2, ...]
        // 去掉 label 后，直接按顺序读取
        var switches = [];
        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'boolean') {
                switches.push(data[i]);
            }
        }

        // switches[0] = 总开关, switches[1] = 无视方块配置, switches[2] = 蹲下启用
        var newCfg = {
            enabled: !!switches[0],
            mineAll: !!switches[1],
            sneakOnly: !!switches[2],
            blocks: {}
        };

        // 从索引3开始是方块开关
        for (var i = 0; i < blockIdList.length; i++) {
            var blockId = blockIdList[i];
            var isEnabled = !!switches[i + 3];
            if (!isEnabled) {
                newCfg.blocks[blockId] = false;
            }
        }

        savePlayerChainConfig(p.xuid, newCfg);
        p.tell("§e[连锁] §a连锁设置已保存！");
    });
}

/** 注册连锁命令 */
function registerChainCommand(registerPlayerCommand) {
    registerPlayerCommand("chain", "连锁挖矿设置", function(p) { showChainSettingsForm(p); });
    registerPlayerCommand("bp", "Block Plan", function(p) { showPlanMenu(p); });
}

/** 注册连锁挖矿事件监听 */
function registerChainListener() {
    mc.listen('onDestroyBlock', function(player, block) {
        try {
            if (!player || !block) return;

            var cfg = getChainConfig();
            if (!cfg.enabled) return;

            // 检查玩家个人配置
            var playerCfg = getPlayerChainConfig(player.xuid);
            if (!playerCfg.enabled) return;

            // 检查蹲下状态
            if (playerCfg.sneakOnly && !player.isSneaking) return;

            // 简化冷却检查：只按玩家冷却
            var now = Date.now();
            if (_chainCooldowns[player.xuid] && now - _chainCooldowns[player.xuid] < 200) return;
            _chainCooldowns[player.xuid] = now;

            // 检查手持工具类型
            var item = player.getHand();
            if (!item || item.isNull()) return;
            var toolId = item.type;
            var toolType = getToolType(toolId);
            if (!toolType) return;

            // 检查方块类型
            var blockType = block.type;
            if (!playerCfg.mineAll) {
                if (!canToolMineBlock(toolType, blockType)) return;
                if (playerCfg.blocks[blockType] === false) return;
            }

            // 检查每日用量限制
            var chainCheck = checkCanChain(player.xuid);
            if (!chainCheck.canChain) {
                player.sendText("§e[连锁] §c今日连锁用量已用完，请购买计划或等待明天重置", 4);
                return;
            }

            // 获取当前工具耐久和附魔
            var maxDurability = getMaxDurability(player);
            var currentDurability = getDurability(player);
            var unbreakingLevel = getUnbreakingLevel(item);
            if (_debug) {
                logger.info('[Chain] 工具=' + toolId + ' 类型=' + toolType + ' 方块=' + blockType);
                logger.info('[Chain] 最大耐久=' + maxDurability + ' 当前耐久=' + currentDurability + ' 耐久附魔=' + unbreakingLevel);
            }
            if (currentDurability <= 0) return;

            // 连锁上限：考虑耐久附魔和每日用量限制
            var cfgMaxBlocks = cfg.maxBlocks || 64;
            var effectiveDurability = currentDurability * (unbreakingLevel + 1);
            var maxBlocks = Math.min(cfgMaxBlocks, effectiveDurability, chainCheck.remaining);

            // 执行连锁
            var startTime = Date.now();
            var result = doChainMine(player, block, blockType, maxBlocks);
            var elapsed = Date.now() - startTime;

            if (result.count > 0) {
                // 延迟扣除工具耐久，按概率计算实际消耗
                applyChainDurability(player, result.count, unbreakingLevel);
                // 记录每日用量
                addDailyUsage(player.xuid, result.count);
                if (_debug) {
                    logger.info('[Chain] 连锁方块数=' + result.count + '，延迟扣除耐久');
                }

                player.sendText("§e[连锁] §a共连锁 " + result.count + " 个方块，耗时 " + elapsed + "ms", 4);
                if (_onChainComplete) _onChainComplete(player, result.count);
            }
            if (_debug) {
                logger.info('[Chain] 连锁完成: 方块数=' + result.count + ' 耗时=' + elapsed + 'ms');
            }
        } catch (e) {
            logger.error('[Chain] 连锁挖矿异常: ' + e.message);
        }
    });
}

/** 执行连锁挖矿 BFS */
function doChainMine(player, startBlock, blockType, maxBlocks) {
    var visited = new Set();
    var startPos = startBlock.pos;
    var dim = startPos.dimid;
    var queue = [startPos.x, startPos.y, startPos.z];
    var count = 0;
    var dirs = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1];
    var queueIdx = 0;

    // 坐标编码（偏移避免负数碰撞）
    var encode = function(x, y, z) { return (x + 65536) * 4294967296 + (y + 64) * 65536 + (z + 65536); };
    visited.add(encode(startPos.x, startPos.y, startPos.z));

    // BFS 遍历相邻方块，不包括起始方块
    while (queueIdx < queue.length && count < maxBlocks) {
        var qx = queue[queueIdx], qy = queue[queueIdx+1], qz = queue[queueIdx+2];
        queueIdx += 3;

        for (var d = 0; d < 18; d += 3) {
            var nx = qx + dirs[d], ny = qy + dirs[d+1], nz = qz + dirs[d+2];
            var key = encode(nx, ny, nz);
            if (visited.has(key)) continue;
            visited.add(key);

            var b = null;
            try { b = mc.getBlock(nx, ny, nz, dim); } catch (e) { continue; }
            if (!b || b.type !== blockType) continue;

            try { b.destroy(true); count++; } catch (e) { continue; }
            queue.push(nx, ny, nz);

            // 达到上限立即停止
            if (count >= maxBlocks) break;
        }
    }

    // 传送掉落物到玩家脚下（只传送近距离的掉落物，避免影响其他玩家）
    if (count > 1) {
        try {
            var ppos = player.pos;
            var entities = mc.getAllEntities();
            for (var i = 0; i < entities.length; i++) {
                var e = entities[i];
                // 只传送10格内的掉落物，避免误传送其他玩家的物品
                if (e.type === 'minecraft:item' && e.distanceTo(player) < 10) {
                    e.teleport(ppos);
                }
            }
        } catch (e) {}
    }

    return { count: count, durabilityUsed: count };
}

function setDebugMode(enabled) { _debug = !!enabled; }
function setOnChainComplete(fn) { _onChainComplete = fn; }

module.exports = {
    init: init,
    registerChainListener: registerChainListener,
    registerChainCommand: registerChainCommand,
    setDebugMode: setDebugMode,
    setOnChainComplete: setOnChainComplete,
    checkCanChain: checkCanChain,
    addDailyUsage: addDailyUsage,
    purchasePlan: purchasePlan,
    renewPlan: renewPlan,
    showPlanMenu: showPlanMenu,
    getPlayerPlanData: getPlayerPlanData
};
