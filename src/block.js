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
 * NECE 方块功能模块
 * 包含连锁挖矿和快速建造两个功能
 */

var _deps = {};
var _debug = false;

// iland API（懒加载）
var _ilandChecked = false;
var _ilandAvailable = false;
var _ilAPI_PosGetLand = null;
var _ilAPI_IsLandOwner = null;
var _ilAPI_IsPlayerTrusted = null;

function initIlandAPI() {
    if (_ilandChecked) return;
    _ilandChecked = true;
    try {
        var fn = ll.import('ILAPI_PosGetLand');
        if (typeof fn === 'function') {
            _ilAPI_PosGetLand = fn;
            _ilAPI_IsLandOwner = ll.import('ILAPI_IsLandOwner');
            _ilAPI_IsPlayerTrusted = ll.import('ILAPI_IsPlayerTrusted');
            _ilandAvailable = true;
            logger.info('[block] iland API 已加载');
        }
    } catch (e) {}
}

/**
 * 检查玩家是否可以在指定位置建造
 * @param {Player} player
 * @param {object} pos - {x, y, z, dimid}
 * @returns {boolean}
 */
function canPlayerBuildAt(player, pos) {
    initIlandAPI();
    if (!_ilandAvailable) return true;
    try {
        var landId = _ilAPI_PosGetLand({ x: pos.x, y: pos.y, z: pos.z, dimid: pos.dimid });
        if (landId === -1 || landId === '-1') return true;
        var xuid = player.xuid;
        if (_ilAPI_IsLandOwner(landId, xuid)) return true;
        if (_ilAPI_IsPlayerTrusted(landId, xuid)) return true;
        return false;
    } catch (e) { return true; }
}

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

// ============ 连锁挖矿部分 ============

var _onChainComplete = null;
var _onQuickBuildComplete = null;
var _itemsMap = null;

// 连锁冷却记录 { xuid: timestamp }
var _chainCooldowns = {};

// 默认计划配置
var DEFAULT_PLANS = {
    free: { dailyLimit: 1000, price: 0, duration: 0 },
    lite: { dailyLimit: 2000, price: 7000, duration: 7 },
    standard: { dailyLimit: 5000, price: 20000, duration: 7 },
    pro: { dailyLimit: 8000, price: 25000, duration: 7 },
    max: { dailyLimit: 50000, price: 500000, duration: 7 }
};

// 套餐名称格式
var PLAN_NAME_FORMAT = {
    free: '§l§i[Free]§r',
    lite: '§l§h[Lite]§r',
    standard: '§l§q[Standard]§r',
    pro: '§l§s[Pro]§r',
    max: '§l§p[Max]§r'
};

function getPlanDisplayName(planName) {
    return PLAN_NAME_FORMAT[planName] || planName;
}

// ============ 快速建造部分 ============

// 建造模式枚举
var BUILD_MODES = ['fill', 'clear', 'water', 'lava'];

// 非填充模式最大方块数量
var MAX_NON_FILL_BLOCKS = 512;

// 玩家启用状态 { xuid: true/false }
var _enabledPlayers = {};

// 玩家建造模式 { xuid: 'fill' | 'clear' | 'water' | 'lava' }
var _playerBuildModes = {};

// 玩家选点状态 { xuid: { pointA: {x,y,z,dimid}, pointB: {x,y,z,dimid} } }
var _playerSelections = {};

// 选点冷却 { xuid: timestamp }
var _selectCooldown = {};



// ============ 初始化 ============

function init(deps) {
    _deps = deps || {};
    registerChainListener();
    registerBlockPlaceListener();
    startBlockTipTimer();
    // 延迟到服务器启动后加载iland API
    mc.listen('onServerStarted', function() {
        initIlandAPI();
    });
}

function dlog() {
    if (!_debug) return;
    var args = ['[DEBUG][block]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.info(args.join(' '));
}

// ============ 连锁挖矿功能 ============

function getChainConfig() {
    return _deps.getConfig ? _deps.getConfig() : {};
}

function getPlanConfig() {
    var chainCfg = getChainConfig();
    if (chainCfg.plans) {
        return chainCfg.plans;
    }
    return DEFAULT_PLANS;
}

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

function savePlanData(xuid, planData) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) return;
    pd.players[xuid].chainPlan = planData;
    if (_deps.savePlayerData) _deps.savePlayerData();
    else if (_deps.savePlayerDataNow) _deps.savePlayerDataNow();
}

function resetDailyUsage(planData) {
    var now = new Date();
    var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    if (planData.lastResetDate !== today) {
        planData.dailyUsed = 0;
        planData.lastResetDate = today;
    }
}

function checkCanChain(xuid) {
    var planData = getPlayerPlanData(xuid);
    resetDailyUsage(planData);

    var planConfig = getPlanConfig();
    var plan = planData.plan || 'free';
    var planInfo = planConfig[plan] || DEFAULT_PLANS.free;

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

function addDailyUsage(xuid, count) {
    var planData = getPlayerPlanData(xuid);
    resetDailyUsage(planData);
    planData.dailyUsed += count;
    savePlanData(xuid, planData);
}

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

    if (currentPlan === planName && planData.expireTime > now) {
        return { success: false, message: t('chain_plan.already_active') };
    }

    var planInfo = planConfig[planName];
    var price = planInfo.price || 0;
    var duration = planInfo.duration || 7;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    var actualPrice = price;

    if (currentPlan !== 'free' && planData.expireTime > now) {
        var currentPlanInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
        var currentPrice = currentPlanInfo.price || 0;
        var priceDiff = price - currentPrice;

        if (priceDiff <= 0) {
            return { success: false, message: t('chain_plan.cannot_downgrade') };
        }

        var remainingDays = Math.ceil((planData.expireTime - now) / (1000 * 60 * 60 * 24));
        var currentDuration = currentPlanInfo.duration || 7;

        actualPrice = Math.ceil(priceDiff * remainingDays / currentDuration);
    }

    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < actualPrice) {
        return { success: false, message: t('chain_plan.insufficient_balance', String(actualPrice), currencyName) };
    }

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

    var expireTime = now + (duration * 24 * 60 * 60 * 1000);

    planData.plan = planName;
    planData.expireTime = expireTime;
    savePlanData(xuid, planData);

    var successDisplayName = getPlanDisplayName(planName);
    return { success: true, message: t('chain_plan.purchase_success', successDisplayName, String(duration)) };
}

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
    var weeklyPrice = planInfo.price || 0;
    var totalPrice = weeklyPrice * weeks;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < totalPrice) {
        return { success: false, message: t('chain_plan.renew_insufficient', String(weeks), String(totalPrice), currencyName) };
    }

    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(currentPlan);
        if (!_deps.reducePlayerMoney(player, totalPrice, 'Block Plan 续费: ' + displayName + ' ' + weeks + '周')) {
            return { success: false, message: t('chain_plan.renew_failed') };
        }
    }

    var baseTime = planData.expireTime > now ? planData.expireTime : now;
    var addDays = weeks * 7;
    planData.expireTime = baseTime + (addDays * 24 * 60 * 60 * 1000);
    savePlanData(xuid, planData);

    var displayName2 = getPlanDisplayName(currentPlan);
    return { success: true, message: t('chain_plan.renew_success', displayName2, String(addDays)) };
}

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

    if (isActive) {
        showActivePlanMenu(player, planData, planInfo, checkResult, currencyName);
    } else {
        showPurchasePlanMenu(player, planData, planInfo, checkResult, currencyName, planConfig);
    }
}

function showActivePlanMenu(player, planData, planInfo, checkResult, currencyName) {
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§bBlock Plan');

    var planConfig = getPlanConfig();
    var expireDate = new Date(planData.expireTime);
    var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
    var planDisplayName = getPlanDisplayName(planData.plan || 'free');

    var content = t('chain.current_plan_label') + planDisplayName + '\n';
    content += t('chain.daily_usage_label') + planData.dailyUsed + '/' + planInfo.dailyLimit + ' Credits' + '\n';
    content += t('chain.expire_time_label', String(expireDate.getFullYear()), String(expireDate.getMonth() + 1), String(expireDate.getDate())) + '\n';
    content += t('chain.remaining_days_label', String(remainingDays)) + '\n';

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

function showRenewMenu(player) {
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
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

        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                var weeks = data[i] + 1;
                showRenewConfirm(p, weeks);
                return;
            }
        }
    });
}

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

function showPurchasePlanMenu(player, planData, planInfo, checkResult, currencyName, planConfig) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§bBlock Plan');

    var currentDisplayName = getPlanDisplayName(planData.plan || 'free');
    fm.addLabel(t('chain.current_plan_label') + currentDisplayName);
    fm.addLabel(t('chain.daily_usage_label') + planData.dailyUsed + '/' + planInfo.dailyLimit + ' Credits');

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

    fm.addLabel(t('chain.plan_free_desc', freeName, String(freeLimit)) + '\n' +
        t('chain.plan_tier_desc_base', liteName, String(liteLimit)) + '\n' +
        t('chain.plan_tier_desc', standardName, standardRatio, liteName) + '\n' +
        t('chain.plan_tier_desc', proName, proRatio, liteName) + '\n' +
        t('chain.plan_tier_desc', maxName, maxRatio, liteName));

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

function getMaxDurability(player) {
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return 0;
        return item.maxDamage || 0;
    } catch (e) {
        return 0;
    }
}

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

function getUnbreakingLevel(item) {
    try {
        var nbt = item.getNbt();
        if (!nbt) return 0;

        var tag = nbt.getTag('tag');
        if (!tag) return 0;
        var ench = tag.getTag('ench');
        if (!ench) return 0;

        var enchArray = ench.toArray();
        for (var i = 0; i < enchArray.length; i++) {
            var e = enchArray[i];
            if (e.id === 17) {
                return e.lvl || 0;
            }
        }
        return 0;
    } catch (e) {
        if (_debug) {
            logger.info('[Block] getUnbreakingLevel 异常: ' + e.message);
        }
        return 0;
    }
}

function applyChainDurability(player, chainCount, unbreakingLevel) {
    setTimeout(function() {
        try {
            var item = player.getHand();
            if (!item || item.isNull()) return;
            var maxDur = item.maxDamage || 0;
            if (maxDur <= 0) return;

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
                logger.info('[Block] 延迟设置耐久: currentDamage=' + currentDamage + ' chainCount=' + chainCount + ' actualDamage=' + actualDamage + ' newDamage=' + newDamage + ' maxDur=' + maxDur + ' unbreaking=' + unbreakingLevel);
            }
        } catch (e) {
            if (_debug) {
                logger.info('[Block] applyChainDurability 异常: ' + e.message);
            }
        }
    }, 50);
}

function getToolType(itemId) {
    if (!itemId) return null;
    var id = itemId.toLowerCase();
    if (id.endsWith('_pickaxe')) return 'pickaxe';
    if (id.endsWith('_axe')) return 'axe';
    if (id.endsWith('_shovel')) return 'shovel';
    if (id.endsWith('_hoe')) return 'hoe';
    return null;
}

function canToolMineBlock(toolType, blockType) {
    var cfg = getChainConfig();
    var blocks = cfg[toolType] || [];
    for (var i = 0; i < blocks.length; i++) {
        if (blocks[i] === blockType) return true;
    }
    return false;
}

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

function savePlayerChainConfig(xuid, cfg) {
    var pd = _deps.getPlayerData ? _deps.getPlayerData() : null;
    if (!pd || !pd.players || !pd.players[xuid]) return;

    var allBlocks = getAllAllowedBlocks();

    var disabledBlocks = {};
    for (var i = 0; i < allBlocks.length; i++) {
        var blockId = allBlocks[i];
        if (cfg.blocks[blockId] === false) {
            disabledBlocks[blockId] = false;
        }
    }

    var chainData = {
        enabled: cfg.enabled === true,
        mineAll: cfg.mineAll === true,
        sneakOnly: cfg.sneakOnly !== false,
        blocks: disabledBlocks
    };
    pd.players[xuid].chain = chainData;

    if (_deps.savePlayerDataNow) {
        _deps.savePlayerDataNow();
    }
}

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

function showChainSettingsForm(player) {
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);
    var chainCheck = checkCanChain(player.xuid);
    var planDisplayName = getPlanDisplayName(chainCheck.plan);

    var fm = mc.newSimpleForm();
    fm.setTitle(t('chain.settings_title') + ' - Block Plan');

    var content = t('chain.current_plan_label') + planDisplayName + '\n';
    content += t('chain.daily_usage_label') + chainCheck.dailyUsed + '/' + chainCheck.dailyLimit + ' Credits' + '\n';
    content += '-------------------------\n';
    fm.setContent(content);

    fm.addButton(t('chain.btn_settings'), "textures/ui/icon_setting");
    fm.addButton(t('chain.btn_plan'), "textures/ui/confirm");
    fm.addButton('§b快速建造', "textures/ui/icon_recipe_item");

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 0) {
            showChainConfigForm(p);
        } else if (id === 1) {
            showPlanMenu(p);
        } else if (id === 2) {
            showBlockForm(p);
        }
    });
}

function showChainConfigForm(player) {
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);

    var fm = mc.newCustomForm();
    fm.setTitle(t('chain.config_title'));
    fm.addSwitch(t('chain.switch_enabled'), playerCfg.enabled);
    fm.addSwitch(t('chain.switch_mine_all'), playerCfg.mineAll);
    fm.addSwitch(t('chain.switch_sneak_only'), playerCfg.sneakOnly);

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

        var switches = [];
        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'boolean') {
                switches.push(data[i]);
            }
        }

        var newCfg = {
            enabled: !!switches[0],
            mineAll: !!switches[1],
            sneakOnly: !!switches[2],
            blocks: {}
        };

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

function doChainMine(player, startBlock, blockType, maxBlocks) {
    var visited = new Set();
    var startPos = startBlock.pos;
    var dim = startPos.dimid;
    var queue = [startPos.x, startPos.y, startPos.z];
    var count = 0;
    var dirs = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1];
    var queueIdx = 0;

    var encode = function(x, y, z) { return (x + 65536) * 4294967296 + (y + 64) * 65536 + (z + 65536); };
    visited.add(encode(startPos.x, startPos.y, startPos.z));

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

            if (count >= maxBlocks) break;
        }
    }

    if (count > 1) {
        try {
            var ppos = player.pos;
            var entities = mc.getAllEntities();
            for (var i = 0; i < entities.length; i++) {
                var e = entities[i];
                if ((e.type === 'minecraft:item' || e.type === 'minecraft:xp_orb') && e.distanceTo(player) < 10) {
                    e.teleport(ppos);
                }
            }
        } catch (e) {}
    }

    return { count: count, durabilityUsed: count };
}

function registerChainListener() {
    mc.listen('onDestroyBlock', function(player, block) {
        try {
            if (!player || !block) return;

            var cfg = getChainConfig();
            if (!cfg.enabled) return;

            // 快速建造非填充模式下禁用连锁
            var xuid = player.xuid;
            if (_enabledPlayers[xuid] && _playerBuildModes[xuid] !== 'fill') return;

            var playerCfg = getPlayerChainConfig(xuid);
            if (!playerCfg.enabled) return;

            if (playerCfg.sneakOnly && !player.isSneaking) return;

            var now = Date.now();
            if (_chainCooldowns[player.xuid] && now - _chainCooldowns[player.xuid] < 200) return;
            _chainCooldowns[player.xuid] = now;

            var item = player.getHand();
            if (!item || item.isNull()) return;
            var toolId = item.type;
            var toolType = getToolType(toolId);
            if (!toolType) return;

            var blockType = block.type;
            if (!playerCfg.mineAll) {
                if (!canToolMineBlock(toolType, blockType)) return;
                if (playerCfg.blocks[blockType] === false) return;
            }

            var chainCheck = checkCanChain(player.xuid);
            if (!chainCheck.canChain) {
                player.sendText(t('chain.tag_prefix') + " §c" + t('chain.daily_limit_msg'), 4);
                return;
            }

            var maxDurability = getMaxDurability(player);
            var currentDurability = getDurability(player);
            var unbreakingLevel = getUnbreakingLevel(item);
            if (_debug) {
                logger.info('[Block] 工具=' + toolId + ' 类型=' + toolType + ' 方块=' + blockType);
                logger.info('[Block] 最大耐久=' + maxDurability + ' 当前耐久=' + currentDurability + ' 耐久附魔=' + unbreakingLevel);
            }
            if (currentDurability <= 0) return;

            var cfgMaxBlocks = cfg.maxBlocks || 64;
            var effectiveDurability = currentDurability * (unbreakingLevel + 1);
            var maxBlocks = Math.min(cfgMaxBlocks, effectiveDurability, chainCheck.remaining);

            var startTime = Date.now();
            var result = doChainMine(player, block, blockType, maxBlocks);
            var elapsed = Date.now() - startTime;

            if (result.count > 0) {
                applyChainDurability(player, result.count, unbreakingLevel);
                addDailyUsage(player.xuid, result.count);
                if (_debug) {
                    logger.info('[Block] 连锁方块数=' + result.count + '，延迟扣除耐久');
                }

                player.sendText(t('chain.tag_prefix') + " §a" + t('chain.chain_complete', String(result.count), String(elapsed)), 4);
                if (_onChainComplete) _onChainComplete(player, result.count);
            }
            if (_debug) {
                logger.info('[Block] 连锁完成: 方块数=' + result.count + ' 耗时=' + elapsed + 'ms');
            }
        } catch (e) {
            logger.error('[Block] 连锁挖矿异常: ' + e.message);
        }
    });
}

// ============ 快速建造功能 ============

/** 构建提示文本 */
function buildBlockTip(xuid) {
    var sel = _playerSelections[xuid] || {};
    var buildMode = _playerBuildModes[xuid] || 'fill';
    var isFillMode = buildMode === 'fill';
    var actionText = isFillMode ? '放置' : '破坏';

    var tip = '§a' + t('quick_build.title') + ' [' + getBuildModeName(buildMode) + ']';
    if (sel.pointA) {
        tip += ' | §eA: [' + sel.pointA.x + ',' + sel.pointA.y + ',' + sel.pointA.z + ']';
    }
    if (sel.pointB) {
        tip += ' | §eB: [' + sel.pointB.x + ',' + sel.pointB.y + ',' + sel.pointB.z + ']';
    }
    if (!sel.pointA) {
        tip += ' | §f' + actionText + '方块选择A点 | §c空手取消';
    } else if (!sel.pointB) {
        tip += ' | §f' + actionText + '方块选择B点 | §c空手取消';
    }
    return tip;
}

/** 启动提示刷新定时器 */
function startBlockTipTimer() {
    setInterval(function() {
        var players = mc.getOnlinePlayers();
        for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (_enabledPlayers[p.xuid]) {
                p.tell(buildBlockTip(p.xuid), 4);
            }
        }
    }, 1000);
}

function toggleBlockMode(player, mode) {
    var xuid = player.xuid;
    if (_enabledPlayers[xuid]) {
        _enabledPlayers[xuid] = false;
        delete _playerSelections[xuid];
        player.tell(t('quick_build.mode_closed'));
        dlog(player.name + ' 关闭快速建造');
    } else {
        _enabledPlayers[xuid] = true;
        _playerBuildModes[xuid] = mode || 'fill';
        _playerSelections[xuid] = {};

        var buildMode = _playerBuildModes[xuid];
        if (buildMode !== 'fill') {
            player.tell('§e连锁挖矿已临时关闭，退出快速建造后自动恢复');
        }

        var modeName = getBuildModeName(buildMode);
        var actionText = buildMode === 'fill' ? '放置' : '破坏';
        player.tell(t('quick_build.status_enabled') + '，当前模式: §b' + modeName + '§r，' + actionText + '第一个方块标记A点');
        player.tell(buildBlockTip(xuid), 4);
        dlog(player.name + ' 开启快速建造，模式: ' + modeName);
    }
}

function getSelectionSize(sel) {
    var dx = Math.abs(sel.pointA.x - sel.pointB.x) + 1;
    var dy = Math.abs(sel.pointA.y - sel.pointB.y) + 1;
    var dz = Math.abs(sel.pointA.z - sel.pointB.z) + 1;
    return { dx: dx, dy: dy, dz: dz, volume: dx * dy * dz };
}

function countItemInInventory(player, itemName) {
    var total = 0;
    var inv = player.getInventory();
    var size = inv.size;
    for (var i = 0; i < size; i++) {
        var item = inv.getItem(i);
        if (item && item.type === itemName) {
            total += item.count;
        }
    }
    return total;
}

function removeItemFromInventory(player, itemName, needCount) {
    var remaining = needCount;
    var inv = player.getInventory();
    var size = inv.size;
    for (var i = 0; i < size && remaining > 0; i++) {
        var item = inv.getItem(i);
        if (item && item.type === itemName) {
            if (item.count <= remaining) {
                remaining -= item.count;
                inv.removeItem(i, item.count);
            } else {
                inv.removeItem(i, remaining);
                remaining = 0;
            }
        }
    }
    return remaining === 0;
}

function fillSelection(player, sel, blockType, tileData) {
    var minX = Math.min(sel.pointA.x, sel.pointB.x);
    var minY = Math.min(sel.pointA.y, sel.pointB.y);
    var minZ = Math.min(sel.pointA.z, sel.pointB.z);
    var maxX = Math.max(sel.pointA.x, sel.pointB.x);
    var maxY = Math.max(sel.pointA.y, sel.pointB.y);
    var maxZ = Math.max(sel.pointA.z, sel.pointB.z);
    var dimid = sel.pointA.dimid;

    var size = getSelectionSize(sel);
    var count = 0;
    dlog(player.name + ' 开始填充选区 [' + minX + ',' + minY + ',' + minZ + '] -> [' + maxX + ',' + maxY + ',' + maxZ + '] 方块:' + blockType + ' 数量:' + size.volume);

    for (var x = minX; x <= maxX; x++) {
        for (var y = minY; y <= maxY; y++) {
            for (var z = minZ; z <= maxZ; z++) {
                mc.setBlock(x, y, z, dimid, blockType, tileData);
                count++;
            }
        }
    }

    dlog(player.name + ' 填充完成，共放置 ' + count + ' 个方块');
}

/** 创造模式直接填充 */
function doCreativeFill(player) {
    var xuid = player.xuid;
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;

    var buildMode = _playerBuildModes[xuid] || 'fill';
    var size = getSelectionSize(sel);

    // 非填充模式限制最大方块数量
    if (buildMode !== 'fill' && size.volume > MAX_NON_FILL_BLOCKS) {
        var modeName = getBuildModeName(buildMode);
        player.tell('§c选区过大，' + modeName + '最大支持 ' + MAX_NON_FILL_BLOCKS + ' 个方块');
        _playerSelections[xuid] = {};
        return;
    }

    if (buildMode === 'clear') {
        fillSelection(player, sel, 'minecraft:air', 0);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell('§a破坏成功，共破坏 ' + size.volume + ' 个方块');
    } else if (buildMode === 'water') {
        fillSelection(player, sel, 'minecraft:water', 0);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell('§a水源填充成功，共填充 ' + size.volume + ' 个方块');
    } else if (buildMode === 'lava') {
        fillSelection(player, sel, 'minecraft:lava', 0);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell('§a岩浆填充成功，共填充 ' + size.volume + ' 个方块');
    } else {
        var mainhand = player.getHand();
        var blockType = mainhand ? mainhand.type : '';
        var tileData = mainhand ? mainhand.aux : 0;

        if (!blockType || blockType === 'minecraft:air') {
            player.tell(t('quick_build.hold_block_first'));
            _playerSelections[xuid] = {};
            return;
        }

        fillSelection(player, sel, blockType, tileData);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell(t('quick_build.fill_success_creative', String(size.volume)));
    }
    _playerSelections[xuid] = {};
}

function showFillConfirmForm(player) {
    var xuid = player.xuid;
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;

    var size = getSelectionSize(sel);
    var buildMode = _playerBuildModes[xuid] || 'fill';

    // 清空/水源/岩浆模式
    if (buildMode !== 'fill') {
        var modeName = getBuildModeName(buildMode);

        // 限制最大方块数量
        if (size.volume > MAX_NON_FILL_BLOCKS) {
            player.tell('§c选区过大，' + modeName + '最大支持 ' + MAX_NON_FILL_BLOCKS + ' 个方块');
            _playerSelections[xuid] = {};
            return;
        }

        // 额度计算：破坏 1/方块，水源/岩浆 2/方块
        var quotaPerBlock = (buildMode === 'clear') ? 1 : 2;
        var quotaNeed = size.volume * quotaPerBlock;
        var chainCheck = checkCanChain(xuid);
        var quotaEnough = chainCheck.remaining >= quotaNeed;
        var planDisplayName = getPlanDisplayName(chainCheck.plan);

        var content = '§6' + modeName + '§r\n\n';
        content += t('quick_build.fill_selection_info') + '\n';
        content += t('quick_build.fill_a_point', String(sel.pointA.x), String(sel.pointA.y), String(sel.pointA.z)) + '\n';
        content += t('quick_build.fill_b_point', String(sel.pointB.x), String(sel.pointB.y), String(sel.pointB.z)) + '\n';
        content += t('quick_build.fill_size', String(size.dx), String(size.dy), String(size.dz)) + '\n';
        content += t('quick_build.fill_need_blocks', String(size.volume)) + '\n\n';
        content += t('quick_build.fill_plan_info', planDisplayName) + '\n';
        content += t('quick_build.fill_quota_need', String(quotaNeed), (quotaEnough ? '§a' : '§c') + chainCheck.remaining + '§r') + '\n';

        if (!quotaEnough) {
            content += '\n' + t('quick_build.fill_insufficient_quota');
        }

        var canFill = quotaEnough;

        player.sendModalForm(
            modeName + '确认',
            content,
            canFill ? t('quick_build.btn_confirm_fill') : t('quick_build.btn_cannot_fill'),
            t('quick_build.btn_cancel_fill'),
            function(pl, result) {
                _playerSelections[pl.xuid] = {};
                if (result === null) return;
                if (!result) {
                    pl.tell(t('quick_build.fill_cancelled'));
                    return;
                }
                var check2 = checkCanChain(pl.xuid);
                if (check2.remaining < quotaNeed) {
                    pl.tell(t('quick_build.fill_quota_insufficient', String(quotaNeed), String(check2.remaining)));
                    return;
                }
                var blockType = buildMode === 'clear' ? 'minecraft:air' :
                               buildMode === 'water' ? 'minecraft:water' : 'minecraft:lava';
                addDailyUsage(pl.xuid, quotaNeed);
                fillSelection(pl, sel, blockType, 0);
                if (_onQuickBuildComplete) _onQuickBuildComplete(pl, size.volume);
                var msg = buildMode === 'clear' ? '§a破坏成功，共破坏 ' + size.volume + ' 个方块' :
                         buildMode === 'water' ? '§a水源填充成功，共填充 ' + size.volume + ' 个方块' :
                         '§a岩浆填充成功，共填充 ' + size.volume + ' 个方块';
                pl.tell(msg);
            }
        );
        return;
    }

    // 填充模式
    var mainhand = player.getHand();
    var blockType = mainhand ? mainhand.type : '';
    var blockName = mainhand ? mainhand.name : '无';
    var tileData = mainhand ? mainhand.aux : 0;

    if (!blockType || blockType === 'minecraft:air') {
        player.tell(t('quick_build.hold_block_first'));
        return;
    }

    var quotaNeed = Math.ceil(size.volume * 0.5);
    var chainCheck = checkCanChain(xuid);
    var quotaEnough = chainCheck.remaining >= quotaNeed;
    var planDisplayName = getPlanDisplayName(chainCheck.plan);

    var haveCount = countItemInInventory(player, blockType);
    var enough = haveCount >= size.volume;

    var content = t('quick_build.fill_selection_info') + '\n';
    content += t('quick_build.fill_a_point', String(sel.pointA.x), String(sel.pointA.y), String(sel.pointA.z)) + '\n';
    content += t('quick_build.fill_b_point', String(sel.pointB.x), String(sel.pointB.y), String(sel.pointB.z)) + '\n';
    content += t('quick_build.fill_size', String(size.dx), String(size.dy), String(size.dz)) + '\n';
    content += t('quick_build.fill_need_blocks', String(size.volume)) + '\n\n';
    content += t('quick_build.fill_block_type', blockName) + '\n';
    content += t('quick_build.fill_inventory_count', (enough ? '§a' : '§c') + haveCount + '§r') + '\n';
    content += t('quick_build.fill_plan_info', planDisplayName) + '\n';
    content += t('quick_build.fill_quota_need', String(quotaNeed), (quotaEnough ? '§a' : '§c') + chainCheck.remaining + '§r') + '\n';

    if (!enough) {
        content += '\n' + t('quick_build.fill_insufficient_blocks');
    }
    if (!quotaEnough) {
        content += '\n' + t('quick_build.fill_insufficient_quota');
    }

    var isCreative = player.gameMode === 1;
    var canFill = isCreative || (enough && quotaEnough);

    player.sendModalForm(
        t('quick_build.fill_confirm_title'),
        content,
        canFill ? t('quick_build.btn_confirm_fill') : t('quick_build.btn_cannot_fill'),
        t('quick_build.btn_cancel_fill'),
        function(pl, result) {
            _playerSelections[pl.xuid] = {};
            if (result === null) return;
            if (!result) {
                pl.tell(t('quick_build.fill_cancelled'));
                return;
            }
            if (isCreative) {
                fillSelection(pl, sel, blockType, tileData);
                if (_onQuickBuildComplete) _onQuickBuildComplete(pl, size.volume);
                pl.tell(t('quick_build.fill_success_creative', String(size.volume)));
                return;
            }
            var check2 = checkCanChain(pl.xuid);
            if (check2.remaining < quotaNeed) {
                pl.tell(t('quick_build.fill_quota_insufficient', String(quotaNeed), String(check2.remaining)));
                return;
            }
            if (!enough) {
                pl.tell(t('quick_build.fill_blocks_insufficient', String(size.volume), String(haveCount)));
                return;
            }
            if (removeItemFromInventory(pl, blockType, size.volume)) {
                pl.refreshItems();
                addDailyUsage(pl.xuid, quotaNeed);
                fillSelection(pl, sel, blockType, tileData);
                if (_onQuickBuildComplete) _onQuickBuildComplete(pl, size.volume);
                pl.tell(t('quick_build.fill_success', String(size.volume), String(quotaNeed)));
            } else {
                pl.tell(t('quick_build.fill_failed'));
            }
        }
    );
}

/** 判断物品是否为方块 */
function isBlockItem(item) {
    if (!item || !item.type) return false;
    var t = item.type;
    if (t === 'minecraft:air') return false;
    // 排除常见非方块物品
    if (t.endsWith('_sword') || t.endsWith('_pickaxe') || t.endsWith('_axe') ||
        t.endsWith('_shovel') || t.endsWith('_hoe') || t.endsWith('_helmet') ||
        t.endsWith('_chestplate') || t.endsWith('_leggings') || t.endsWith('_boots') ||
        t.endsWith('_shield') || t.indexOf('_spawn_egg') !== -1) return false;
    return true;
}

function registerBlockPlaceListener() {
    // 清空/水源/岩浆模式：左键选点
    mc.listen('onDestroyBlock', function(player, block) {
        try {
            var xuid = player.xuid;
            if (!_enabledPlayers[xuid]) return;
            if (!_playerSelections[xuid]) return;

            var buildMode = _playerBuildModes[xuid] || 'fill';
            if (buildMode === 'fill') return;

            var sel = _playerSelections[xuid];
            var now = Date.now();
            if (_selectCooldown[xuid] && now - _selectCooldown[xuid] < 500) return;
            _selectCooldown[xuid] = now;

            var placePos = { x: block.pos.x, y: block.pos.y, z: block.pos.z, dimid: block.pos.dimid };

            if (!canPlayerBuildAt(player, placePos)) {
                player.tell(t('quick_build.land_no_permission'));
                return false;
            }

            if (!sel.pointA) {
                sel.pointA = placePos;
                player.tell('§aA点已标记: [' + placePos.x + ',' + placePos.y + ',' + placePos.z + ']，破坏第二个方块标记B点');
                return false;
            }
            if (!sel.pointB) {
                sel.pointB = placePos;
                player.tell('§aB点已标记: [' + placePos.x + ',' + placePos.y + ',' + placePos.z + ']');
                if (player.gameMode === 1) {
                    doCreativeFill(player);
                } else {
                    showFillConfirmForm(player);
                }
                return false;
            }
            return false;
        } catch (e) { logger.error('[block] onDestroyBlock异常: ' + e.message); }
    });

    // 右键事件：空手取消（所有模式）+ 填充模式选点
    mc.listen('onUseItemOn', function(player, item, block, side, pos) {
        try {
            var xuid = player.xuid;
            if (!_enabledPlayers[xuid]) return;
            if (!_playerSelections[xuid]) return;

            var sel = _playerSelections[xuid];

            // 空手右键：取消选区/退出模式（所有模式生效）
            if (!item || !isBlockItem(item)) {
                var now2 = Date.now();
                if (_selectCooldown[xuid] && now2 - _selectCooldown[xuid] < 1000) return;
                _selectCooldown[xuid] = now2;
                if (sel.pointA || sel.pointB) {
                    _playerSelections[xuid] = {};
                    player.tell(t('quick_build.selection_cancelled'));
                } else {
                    _enabledPlayers[xuid] = false;
                    delete _playerSelections[xuid];
                    player.tell(t('quick_build.mode_closed'));
                }
                return;
            }

            // 非填充模式不处理右键选点
            var buildMode = _playerBuildModes[xuid] || 'fill';
            if (buildMode !== 'fill') return;

            var now = Date.now();
            if (_selectCooldown[xuid] && now - _selectCooldown[xuid] < 500) return;
            _selectCooldown[xuid] = now;

            var placePos = { x: block.pos.x, y: block.pos.y, z: block.pos.z, dimid: block.pos.dimid };
            if (side === 0) placePos.y -= 1;
            else if (side === 1) placePos.y += 1;
            else if (side === 2) placePos.z -= 1;
            else if (side === 3) placePos.z += 1;
            else if (side === 4) placePos.x -= 1;
            else if (side === 5) placePos.x += 1;

            if (!canPlayerBuildAt(player, placePos)) {
                player.tell(t('quick_build.land_no_permission'));
                return false;
            }

            if (!sel.pointA) {
                sel.pointA = placePos;
                player.tell(t('quick_build.a_marked', String(placePos.x), String(placePos.y), String(placePos.z)));
                return false;
            }
            if (!sel.pointB) {
                sel.pointB = placePos;
                player.tell(t('quick_build.b_marked', String(placePos.x), String(placePos.y), String(placePos.z)));
                if (player.gameMode === 1) {
                    doCreativeFill(player);
                } else {
                    showFillConfirmForm(player);
                }
                return false;
            }
            return false;
        } catch (e) { logger.error('[block] onUseItemOn异常: ' + e.message); }
    });
}

function getBuildModeName(mode) {
    var names = { fill: '填充模式', clear: '破坏模式', water: '水源模式', lava: '岩浆模式' };
    return names[mode] || '填充模式';
}

function showBlockForm(player) {
    var xuid = player.xuid;
    var currentMode = _playerBuildModes[xuid] || 'fill';
    var enabled = !!_enabledPlayers[xuid];
    var status = enabled ? t('quick_build.status_enabled') : t('quick_build.status_disabled');

    var fm = mc.newCustomForm();
    fm.setTitle(t('quick_build.title'));

    fm.addLabel('§6' + t('quick_build.title') + '§r\n' +
        t('quick_build.status_enabled').replace('§a', '') + ': ' + status + '\n\n' +
        t('quick_build.usage_title') + '\n' +
        t('quick_build.usage_desc'));

    var modeOptions = BUILD_MODES.map(function(m) { return getBuildModeName(m); });
    var modeIndex = BUILD_MODES.indexOf(currentMode);
    fm.addDropdown('建造模式', modeOptions, modeIndex >= 0 ? modeIndex : 0);

    player.sendForm(fm, function(pl, data) {
        if (data == null) return;

        var selectedMode = 'fill';
        for (var i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                selectedMode = BUILD_MODES[data[i]] || 'fill';
                break;
            }
        }
        _playerBuildModes[pl.xuid] = selectedMode;

        // 重新检查当前启用状态
        var nowEnabled = !!_enabledPlayers[pl.xuid];
        if (!nowEnabled) {
            // 未启用，开启快速建造
            toggleBlockMode(pl, selectedMode);
        } else {
            // 已启用，切换模式并重置选区
            _playerSelections[pl.xuid] = {};
            var modeName = getBuildModeName(selectedMode);
            pl.tell('§a建造模式已切换为: ' + modeName);
            pl.tell(buildBlockTip(pl.xuid), 4);
            dlog(pl.name + ' 切换建造模式: ' + modeName);
        }
    });
}

// ============ 命令注册 ============

function registerBlockCommand(registerPlayerCommand) {
    registerPlayerCommand('block', 'Block功能菜单', function(player) {
        showChainSettingsForm(player);
    });
    registerPlayerCommand('bp', 'Block Plan', function(p) { showPlanMenu(p); });
}

function setDebugMode(enabled) { _debug = !!enabled; }
function setOnChainComplete(fn) { _onChainComplete = fn; }
function setOnQuickBuildComplete(fn) { _onQuickBuildComplete = fn; }

module.exports = {
    init: init,
    registerBlockCommand: registerBlockCommand,
    setDebugMode: setDebugMode,
    setOnChainComplete: setOnChainComplete,
    setOnQuickBuildComplete: setOnQuickBuildComplete,
    checkCanChain: checkCanChain,
    addDailyUsage: addDailyUsage,
    purchasePlan: purchasePlan,
    renewPlan: renewPlan,
    showPlanMenu: showPlanMenu,
    getPlayerPlanData: getPlayerPlanData
};
