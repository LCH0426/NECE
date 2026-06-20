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

let _deps = {};
let _debug = false;

function getLang() {
    return _deps.getSystemLanguage ? _deps.getSystemLanguage() : 'zh_CN';
}

function t(key) {
    if (!_deps.t) return key;
    var lang = getLang();
    var args = [lang];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    return _deps.t.apply(null, args);
}
let _onChainComplete = null;
let _itemsMap = null;

// 连锁冷却记录 { xuid: timestamp }
const _chainCooldowns = {};

// ============ 连锁计划系统 ============

// 默认计划配置
const DEFAULT_PLANS = {
    free: { dailyLimit: 1000, price: 0, duration: 0 },
    lite: { dailyLimit: 2000, price: 7000, duration: 7 },
    standard: { dailyLimit: 5000, price: 20000, duration: 7 },
    pro: { dailyLimit: 8000, price: 25000, duration: 7 },
    max: { dailyLimit: 50000, price: 500000, duration: 7 }
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

function init(deps) {
    _deps = deps || {};
    _debug = deps.getDebug ? deps.getDebug() : false;
}

/** 获取连锁全局配置 */
function getChainConfig() {
    return _deps.getConfig ? _deps.getConfig() : {};
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
    // 使用防抖保存代替立即保存，避免连锁挖矿时频繁IO
    if (_deps.savePlayerData) _deps.savePlayerData();
    else if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
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
        return { success: false, message: t('chain_plan.invalid_plan') };
    }

    if (planName === 'free') {
        return { success: false, message: t('chain_plan.cannot_purchase_free') };
    }

    var planData = getPlayerPlanData(xuid);
    var now = Date.now();
    var currentPlan = planData.plan || 'free';

    // 检查是否已有相同计划且未过期
    if (currentPlan === planName && planData.expireTime > now) {
        return { success: false, message: t('chain_plan.already_active') };
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
            return { success: false, message: t('chain_plan.cannot_downgrade') };
        }

        // 计算剩余天数
        var remainingDays = Math.ceil((planData.expireTime - now) / (1000 * 60 * 60 * 24));
        var currentDuration = currentPlanInfo.duration || 7;

        // 差价 = (新计划价格 - 旧计划价格) * 剩余天数 / 旧计划周期天数
        actualPrice = Math.ceil(priceDiff * remainingDays / currentDuration);
    }

    // 检查余额
    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < actualPrice) {
        return { success: false, message: t('chain_plan.insufficient_balance', String(actualPrice), currencyName) };
    }

    // 扣费
    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(planName);
        var currentDisplayName = getPlanDisplayName(currentPlan);
        var reason = currentPlan !== 'free' && planData.expireTime > now ?
            'Block Plan 升级: ' + currentDisplayName + ' -> ' + displayName :
            'Block Plan 购买: ' + displayName;
        if (!_deps.reducePlayerMoney(player, actualPrice, reason)) {
            return { success: false, message: t('chain_plan.purchase_failed') };
        }
    }

    // 更新计划（新计划替换旧计划）
    var expireTime = now + (duration * 24 * 60 * 60 * 1000);

    planData.plan = planName;
    planData.expireTime = expireTime;
    savePlanData(xuid, planData);

    var successDisplayName = getPlanDisplayName(planName);
    return { success: true, message: t('chain_plan.purchase_success', successDisplayName, String(duration)) };
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
        return { success: false, message: t('chain_plan.cannot_renew_free') };
    }

    if (weeks < 1 || weeks > 3) {
        return { success: false, message: t('chain_plan.invalid_weeks') };
    }

    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    // 续费价格直接使用一个周期的价格
    var weeklyPrice = planInfo.price || 0;
    var totalPrice = weeklyPrice * weeks;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    // 检查余额
    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < totalPrice) {
        return { success: false, message: t('chain_plan.renew_insufficient', String(weeks), String(totalPrice), currencyName) };
    }

    // 扣费
    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(currentPlan);
        if (!_deps.reducePlayerMoney(player, totalPrice, 'Block Plan 续费: ' + displayName + ' ' + weeks + '周')) {
            return { success: false, message: t('chain_plan.renew_failed') };
        }
    }

    // 延长到期时间
    var baseTime = planData.expireTime > now ? planData.expireTime : now;
    var addDays = weeks * 7;
    planData.expireTime = baseTime + (addDays * 24 * 60 * 60 * 1000);
    savePlanData(xuid, planData);

    var displayName2 = getPlanDisplayName(currentPlan);
    return { success: true, message: t('chain_plan.renew_success', displayName2, String(addDays)) };
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

    var content = t('chain.current_plan_label') + planDisplayName + '\n';
    content += t('chain.daily_usage_label') + planData.dailyUsed + '/' + planInfo.dailyLimit + '\n';
    content += t('chain.expire_time_label', String(expireDate.getFullYear()), String(expireDate.getMonth() + 1), String(expireDate.getDate())) + '\n';
    content += t('chain.remaining_days_label', String(remainingDays)) + '\n';
    content += '\n' + t('chain.plan_desc_title') + '\n';
    content += t('chain.plan_desc_body') + '\n\n';

    var freeLimit = (planConfig.free || DEFAULT_PLANS.free).dailyLimit;
    var liteLimit = (planConfig.lite || DEFAULT_PLANS.lite).dailyLimit;
    var standardLimit = (planConfig.standard || DEFAULT_PLANS.standard).dailyLimit;
    var proLimit = (planConfig.pro || DEFAULT_PLANS.pro).dailyLimit;
    var maxLimit = (planConfig.max || DEFAULT_PLANS.max).dailyLimit;

    var standardRatio = (standardLimit / liteLimit).toFixed(1);
    var proRatio = (proLimit / liteLimit).toFixed(0);
    var maxRatio = (maxLimit / liteLimit).toFixed(0);

    var freeName = getPlanDisplayName('free');
    var liteName = getPlanDisplayName('lite');
    var standardName = getPlanDisplayName('standard');
    var proName = getPlanDisplayName('pro');
    var maxName = getPlanDisplayName('max');

    content += t('chain.plan_free_desc', freeName, String(freeLimit)) + '\n';
    content += t('chain.plan_tier_desc_base', liteName, String(liteLimit)) + '\n';
    content += t('chain.plan_tier_desc', standardName, standardRatio, liteName) + '\n';
    content += t('chain.plan_tier_desc', proName, proRatio, liteName) + '\n';
    content += t('chain.plan_tier_desc', maxName, maxRatio, liteName) + '\n';

    fm.setContent(content);
    fm.addButton(t('chain.btn_renew'), "textures/ui/confirm");
    fm.addButton(t('chain.btn_upgrade'), "textures/ui/jump_boost_effect");
    fm.addButton(t('chain.btn_back'), "textures/ui/recap_glyph_desaturated");

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
    // 续费价格直接使用一个周期的价格
    var weeklyPrice = planInfo.price || 0;
    var currentDisplayName = getPlanDisplayName(currentPlan);

    var fm = mc.newCustomForm();
    fm.setTitle(t('chain_plan.renew_title'));

    fm.addLabel(t('chain.current_plan_label') + currentDisplayName);
    fm.addLabel(t('chain_plan.weekly_price', String(weeklyPrice), currencyName));

    var renewOptions = [
        t('chain_plan.renew_option', '1', String(weeklyPrice), currencyName),
        t('chain_plan.renew_option', '2', String(weeklyPrice * 2), currencyName),
        t('chain_plan.renew_option', '3', String(weeklyPrice * 3), currencyName)
    ];
    fm.addDropdown(t('chain_plan.select_renew_weeks'), renewOptions, 0);

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
    fm.setTitle(t('chain_plan.upgrade_title'));

    fm.addLabel(t('chain.current_plan_label') + currentDisplayName);

    // 只显示比当前计划更高级的计划
    var planOrder = ['lite', 'standard', 'pro', 'max'];
    var currentIndex = planOrder.indexOf(currentPlan);
    var upgradeOptions = [];
    var upgradePlans = [];

    var currentPlanInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currentPrice = currentPlanInfo.price || 0;
    var currentDuration = currentPlanInfo.duration || 7;
    var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));

    for (var i = currentIndex + 1; i < planOrder.length; i++) {
        var pName = planOrder[i];
        var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
        var priceDiff = (pInfo.price || 0) - currentPrice;
        var upgradePrice = Math.ceil(priceDiff * remainingDays / currentDuration);
        var displayName = getPlanDisplayName(pName);

        upgradeOptions.push(t('chain_plan.upgrade_option', displayName, String(pInfo.dailyLimit), String(upgradePrice), currencyName));
        upgradePlans.push(pName);
    }

    if (upgradeOptions.length === 0) {
        fm.addLabel(t('chain_plan.max_level_plan'));
    } else {
        fm.addDropdown(t('chain_plan.select_upgrade_plan'), upgradeOptions, 0);
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
    fm.addLabel(t('chain.current_plan_label') + currentDisplayName);
    fm.addLabel(t('chain.daily_usage_label') + planData.dailyUsed + '/' + planInfo.dailyLimit);

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

    var standardRatio = (standardLimit / liteLimit).toFixed(1);
    var proRatio = (proLimit / liteLimit).toFixed(0);
    var maxRatio = (maxLimit / liteLimit).toFixed(0);

    fm.addLabel(t('chain.plan_desc_title') + '\n' +
        t('chain.plan_desc_body') + '\n\n' +
        t('chain.plan_free_desc', freeName, String(freeLimit)) + '\n' +
        t('chain.plan_tier_desc_base', liteName, String(liteLimit)) + '\n' +
        t('chain.plan_tier_desc', standardName, standardRatio, liteName) + '\n' +
        t('chain.plan_tier_desc', proName, proRatio, liteName) + '\n' +
        t('chain.plan_tier_desc', maxName, maxRatio, liteName));

    // 下拉菜单选择计划
    var planOptions = [];
    var planKeys = ['lite', 'standard', 'pro', 'max'];

    for (var i = 0; i < planKeys.length; i++) {
        var pName = planKeys[i];
        var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
        var displayName = getPlanDisplayName(pName);
        planOptions.push(t('chain_plan.plan_option', displayName, String(pInfo.dailyLimit), String(pInfo.price || 0), currencyName, String(pInfo.duration || 0)));
    }

    fm.addDropdown(t('chain_plan.select_plan'), planOptions, 0);

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
        t('chain_plan.confirm_title'),
        t('chain_plan.confirm_content', displayName, String(planInfo.dailyLimit), String(planInfo.price), currencyName, String(planInfo.duration)),
        t('chain_plan.btn_confirm'),
        t('chain_plan.btn_cancel'),
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

    var weeklyPrice = planInfo.price || 0;
    var totalPrice = weeklyPrice * weeks;
    var displayName = getPlanDisplayName(currentPlan);

    player.sendModalForm(
        t('chain_plan.renew_confirm_title'),
        t('chain_plan.renew_confirm_content', displayName, String(weeks), String(totalPrice), currencyName),
        t('chain_plan.btn_confirm_renew'),
        t('chain_plan.btn_cancel'),
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
    fm.setTitle(t('chain.settings_title') + ' - Block Plan');

    var content = t('chain.current_plan_label') + planDisplayName + '\n';
    content += t('chain.daily_usage_label') + chainCheck.dailyUsed + '/' + chainCheck.dailyLimit + '\n';
    content += '-------------------------\n';
    fm.setContent(content);

    fm.addButton(t('chain.btn_settings'), "textures/ui/icon_setting");
    fm.addButton(t('chain.btn_plan'), "textures/ui/confirm");

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
    fm.setTitle(t('chain.config_title'));
    fm.addSwitch(t('chain.switch_enabled'), playerCfg.enabled);
    fm.addSwitch(t('chain.switch_mine_all'), playerCfg.mineAll);
    fm.addSwitch(t('chain.switch_sneak_only'), playerCfg.sneakOnly);

    // 记录每个工具类型对应的方块ID列表
    var blockIdList = [];
    var toolTypes = ['pickaxe', 'axe', 'shovel', 'hoe'];
    var toolNames = { pickaxe: t('chain.tool_pickaxe'), axe: t('chain.tool_axe'), shovel: t('chain.tool_shovel'), hoe: t('chain.tool_hoe') };

    for (var ti = 0; ti < toolTypes.length; ti++) {
        var toolKey = toolTypes[ti];
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
        if (data == null) {
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
        p.tell(t('chain.tag_prefix') + " §a" + t('chain.settings_saved'));
    });
}

/** 注册连锁命令 */
function registerChainCommand(registerPlayerCommand) {
    registerPlayerCommand("chain", t('chain.cmd_chain_desc'), function(p) { showChainSettingsForm(p); });
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
                player.sendText(t('chain.tag_prefix') + " §c" + t('chain.daily_limit_msg'), 4);
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

                player.sendText(t('chain.tag_prefix') + " §a" + t('chain.chain_complete', String(result.count), String(elapsed)), 4);
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
