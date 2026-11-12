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

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

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
	const lang = getLocale(player.xuid);
    // 服务器 OP 跳过领地区域检测（开启快速建造时的领地选区检测仍保留，见 toggleBlockMode）
    try { if (player && player.isOP && player.isOP()) return true; } catch (e) {}
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

// ============ 连锁挖矿部分 ============

var _onChainComplete = null;
var _onQuickBuildComplete = null;
var _itemsMap = null;

// 连锁冷却记录 { xuid: timestamp }
var _chainCooldowns = {};

// 破坏开始时附近物品实体快照 { xuid: { entityId: true } }
var _breakItemSnapshots = {};

// 无掉落提示冷却 { xuid: timestamp }
var _noDropTipCooldowns = {};

// 建筑助手（仅OP）：选区导出/导入 .nbt 结构文件（gzip 压缩 JSON 容器，本插件自读写往返，保留完整方块状态与方块实体）
// 选区逻辑复用快速建造的破坏模式（左键选点+拦截破坏，空手右键取消/退出），通过 _playerBuildModes='assistant' 标记区分
var ASSISTANT_BOSSBAR_UID = 88001;
var ASSISTANT_BATCH_SIZE = 5000;

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
    max: '§l§p[Max]§r',
    ultra: '§l§6[Ultra]§r'
};

// ultra 套餐硬编码配置
var ULTRA_PRICE = 9999999;

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

// 建筑助手快照指针 { xuid: { file, dimid, minX, minY, minZ, maxX, maxY, maxZ, total } }
// 快照物理文件保存在 data/temp 目录，日期命名，用后仅清空指针保留文件
var _assistantSnapshots = {};

// 建筑助手选区用途 { xuid: 'export' | 'copy' }，决定两点齐后触发的表单
var _assistantSelMode = {};

// 剪贴板指针 { xuid: { file, dimid, size, total } }
// 剪贴板文件保存在 data/temp，每玩家固定一份，粘贴后仅清空指针保留文件
var _clipboard = {};

function getTempDir() {
    var dir = path.join(__dirname, '..', 'data', 'temp');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { logger.error('[block] 创建temp目录失败: ' + e.message); }
    return dir;
}

function snapshotFileName(xuid) {
    return 'assistant_snapshot_' + xuid + '_' + Date.now() + '.nbt';
}

// 读取快照文件，返回 {size, palette, blocks, tileEntities}，失败返回 null
function readSnapshotFile(filePath) {
    try {
        var raw = fs.readFileSync(filePath);
        var data;
        try { data = JSON.parse(zlib.gunzipSync(raw).toString('utf-8')); } catch (e) { data = JSON.parse(raw.toString('utf-8')); }
        return data;
    } catch (e) { return null; }
}

// 保存目标区域快照到 data/temp，返回文件路径，失败返回 null
// 异步分批保存目标区域方块到文件，带进度条，完成后回调 onDone(filePath|null)
function saveSnapshotRegion(player, minPos, maxPos, dimid, filePath, progressKey, onDone) {
    var lang = getLocale(player.xuid);
    var sx = maxPos.x - minPos.x + 1, sy = maxPos.y - minPos.y + 1, sz = maxPos.z - minPos.z + 1;
    var total = sx * sy * sz;
    var palette = [{ name: 'minecraft:air', aux: 0, snbt: '' }];
    var paletteMap = {};
    var blocks = new Array(total);
    var tileEntities = [];
    var plane = sx * sz;
    var i = 0;
    if (!filePath) filePath = path.join(getTempDir(), snapshotFileName(player.xuid));
    assistantSetBossBar(player, t(lang, progressKey || 'quick_build.assistant_import_progress', '0'), 0);

    function batch() {
        var end = Math.min(i + ASSISTANT_BATCH_SIZE, total);
        for (; i < end; i++) {
            var y = Math.floor(i / plane);
            var r = i - y * plane;
            var z = Math.floor(r / sx);
            var x = r - z * sx;
            var wx = minPos.x + x, wy = minPos.y + y, wz = minPos.z + z;
            var b = null;
            try { b = mc.getBlock(wx, wy, wz, dimid); } catch (e) { b = null; }
            if (!b || !b.type || b.type === 'minecraft:air') {
                blocks[i] = 0;
                continue;
            }
            var aux = 0;
            try { aux = (typeof b.tileData !== 'undefined' ? b.tileData : (typeof b.aux !== 'undefined' ? b.aux : 0)); } catch (e) { aux = 0; }
            var hasBE = true;
            try { if (typeof b.hasBlockEntity === 'function') hasBE = b.hasBlockEntity(); } catch (e) { hasBE = true; }
            var snbt = '';
            var key;
            if (hasBE) {
                try { snbt = b.getNbt().toSNBT(); } catch (e) { snbt = ''; }
                key = snbt || ('__fail__' + b.type + '__' + aux);
            } else {
                key = '__plain__' + b.type + '__' + aux;
            }
            var idx = paletteMap[key];
            if (idx == null) {
                idx = palette.length;
                paletteMap[key] = idx;
                palette.push({ name: b.type, aux: aux, snbt: snbt });
            }
            blocks[i] = idx;
            if (hasBE) {
                try {
                    var be = mc.getBlockEntity(wx, wy, wz, dimid);
                    if (be) {
                        var beSnbt = be.getNbt().toSNBT();
                        if (beSnbt) tileEntities.push({ x: x, y: y, z: z, snbt: beSnbt });
                    }
                } catch (e) { }
            }
        }
        var pct = Math.floor((i / total) * 100);
        assistantSetBossBar(player, t(lang, progressKey || 'quick_build.assistant_import_progress', String(pct)), pct);
        updateTaskAnim(player, i, total);
        if (i < total) {
            setTimeout(batch, 0);
        } else {
            assistantRemoveBossBar(player);
            try {
                var data = {
                    version: 1,
                    dimid: dimid,
                    size: { x: sx, y: sy, z: sz },
                    origin: { x: minPos.x, y: minPos.y, z: minPos.z },
                    palette: palette,
                    blocks: blocks,
                    tileEntities: tileEntities
                };
                var gz = zlib.gzipSync(Buffer.from(JSON.stringify(data), 'utf-8'));
                fs.writeFileSync(filePath, gz);
                if (onDone) onDone(filePath);
            } catch (e) {
                logger.error('[block] 区域保存失败: ' + e.message);
                if (onDone) onDone(null);
            }
        }
    }

    batch();
}

// 用快照文件恢复目标区域，恢复成功后清空该玩家快照指针
function undoImport(player, snapshotMeta) {
    var lang = getLocale(player.xuid);
    var data = readSnapshotFile(snapshotMeta.file);
    if (!data) {
        player.tell(t(lang, 'quick_build.assistant_undo_failed'));
        delete _assistantSnapshots[player.xuid];
        return;
    }
    var sx = data.size.x, sy = data.size.y, sz = data.size.z;
    var total = sx * sy * sz;
    var palette = data.palette || [{ name: 'minecraft:air', aux: 0, snbt: '' }];
    var blocks = data.blocks || [];
    var tileEntities = data.tileEntities || [];
    var dimid = snapshotMeta.dimid;
    var minX = snapshotMeta.minX, minY = snapshotMeta.minY, minZ = snapshotMeta.minZ;
    var plane = sx * sz;
    var i = 0;

    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);

    function batch() {
        var end = Math.min(i + ASSISTANT_BATCH_SIZE, total);
        for (; i < end; i++) {
            var y = Math.floor(i / plane);
            var r = i - y * plane;
            var z = Math.floor(r / sx);
            var x = r - z * sx;
            var wx = minX + x, wy = minY + y, wz = minZ + z;
            var entry = palette[blocks[i]] || palette[0];
            var bname = entry.name || 'minecraft:air';
            try {
                mc.setBlock(wx, wy, wz, dimid, bname, entry.aux || 0);
                if (bname !== 'minecraft:air' && entry.snbt) {
                    var nb = mc.getBlock(wx, wy, wz, dimid);
                    if (nb) nb.setNbt(NBT.parseSNBT(entry.snbt));
                }
            } catch (e) { }
        }
        var pct = Math.floor((i / total) * 100);
        assistantSetBossBar(player, t(lang, 'quick_build.assistant_undo_progress', String(pct)), pct);
        updateTaskAnim(player, i, total);
        if (i < total) {
            setTimeout(batch, 0);
        } else {
            undoTileEntities();
        }
    }

    function undoTileEntities() {
        var j = 0, teTotal = tileEntities.length;
        function teBatch() {
            var end = Math.min(j + ASSISTANT_BATCH_SIZE, teTotal);
            for (; j < end; j++) {
                var te = tileEntities[j];
                try {
                    var be = mc.getBlockEntity(minX + te.x, minY + te.y, minZ + te.z, dimid);
                    if (be) be.setNbt(NBT.parseSNBT(te.snbt));
                } catch (e) { }
            }
            var pct = teTotal > 0 ? Math.floor((j / teTotal) * 100) : 100;
            assistantSetBossBar(player, t(lang, 'quick_build.assistant_undo_progress', String(pct)), pct);
            updateTaskAnim(player, j, teTotal);
            if (j < teTotal) setTimeout(teBatch, 0);
            else {
                assistantRemoveBossBar(player);
                stopTaskAnim(player);
                releaseTaskLock(player);
                delete _assistantSnapshots[player.xuid];
                player.tell(t(lang, 'quick_build.assistant_undo_success', String(total)));
            }
        }
        if (teTotal === 0) {
            assistantRemoveBossBar(player);
            stopTaskAnim(player);
            releaseTaskLock(player);
            delete _assistantSnapshots[player.xuid];
            player.tell(t(lang, 'quick_build.assistant_undo_success', String(total)));
        } else {
            teBatch();
        }
    }

    batch();
}

// ============ 初始化 ============

function init(deps) {
    _deps = deps || {};
    registerChainListener();
    registerBlockPlaceListener();
    startBlockTipTimer();
    startAssistantParticleTimer();
    // 玩家切换维度或退出游戏时取消进行中的任务
    mc.listen('onChangeDim', function(pl, dimid) {
        if (pl) cancelPlayerTask(pl);
    });
    mc.listen('onLeft', function(pl) {
        if (pl) cancelPlayerTask(pl);
    });
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

    var plan = planData.plan || 'free';

    // ultra 套餐：无限额度，永不过期
    if (plan === 'ultra') {
        return {
            canChain: true,
            remaining: Infinity,
            plan: 'ultra',
            dailyLimit: Infinity,
            dailyUsed: planData.dailyUsed
        };
    }

    var planConfig = getPlanConfig();
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

function purchaseUltraPlan(player) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var now = Date.now();
    var currentPlan = planData.plan || 'free';
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    // 已拥有 ultra
    if (currentPlan === 'ultra') {
        return { success: false, message: t(lang, 'chain_plan.ultra_already_owned') };
    }

    var actualPrice = ULTRA_PRICE;

    // 计算当前套餐剩余价值
    if (currentPlan !== 'free' && planData.expireTime > now) {
        var planConfig = getPlanConfig();
        var currentPlanInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
        var currentPrice = currentPlanInfo.price || 0;
        var currentDuration = currentPlanInfo.duration || 7;
        var remainingDays = Math.ceil((planData.expireTime - now) / (1000 * 60 * 60 * 24));
        var remainingValue = Math.ceil(currentPrice * remainingDays / currentDuration);
        actualPrice = ULTRA_PRICE - remainingValue;
    }

    if (actualPrice < 0) actualPrice = 0;

    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < actualPrice) {
        return { success: false, message: t(lang, 'chain_plan.insufficient_balance', String(actualPrice), currencyName) };
    }

    if (_deps.reducePlayerMoney) {
        if (!_deps.reducePlayerMoney(player, actualPrice, 'Block Plan 购买: §l§6[Ultra]§r')) {
            return { success: false, message: t(lang, 'chain_plan.purchase_failed') };
        }
    }

    planData.plan = 'ultra';
    planData.expireTime = 0;
    savePlanData(xuid, planData);

    return { success: true, message: t(lang, 'chain_plan.ultra_purchase_success') };
}

function purchasePlan(player, planName) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var planConfig = getPlanConfig();

    // ultra 套餐特殊处理
    if (planName === 'ultra') {
        return purchaseUltraPlan(player);
    }

    if (!planConfig[planName]) {
        return { success: false, message: t(lang, 'chain_plan.invalid_plan') };
    }

    if (planName === 'free') {
        return { success: false, message: t(lang, 'chain_plan.cannot_purchase_free') };
    }

    var planData = getPlayerPlanData(xuid);
    var now = Date.now();
    var currentPlan = planData.plan || 'free';

    // ultra 用户不能购买低级套餐
    if (currentPlan === 'ultra') {
        return { success: false, message: t(lang, 'chain_plan.ultra_already_owned') };
    }

    if (currentPlan === planName && planData.expireTime > now) {
        return { success: false, message: t(lang, 'chain_plan.already_active') };
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
            return { success: false, message: t(lang, 'chain_plan.cannot_downgrade') };
        }

        var remainingDays = Math.ceil((planData.expireTime - now) / (1000 * 60 * 60 * 24));
        var currentDuration = currentPlanInfo.duration || 7;

        actualPrice = Math.ceil(priceDiff * remainingDays / currentDuration);
    }

    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < actualPrice) {
        return { success: false, message: t(lang, 'chain_plan.insufficient_balance', String(actualPrice), currencyName) };
    }

    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(planName);
        var currentDisplayName = getPlanDisplayName(currentPlan);
        var reason = currentPlan !== 'free' && planData.expireTime > now ?
            'Block Plan 升级: ' + currentDisplayName + ' -> ' + displayName :
            'Block Plan 购买: ' + displayName;
        if (!_deps.reducePlayerMoney(player, actualPrice, reason)) {
            return { success: false, message: t(lang, 'chain_plan.purchase_failed') };
        }
    }

    var expireTime = now + (duration * 24 * 60 * 60 * 1000);

    planData.plan = planName;
    planData.expireTime = expireTime;
    savePlanData(xuid, planData);

    var successDisplayName = getPlanDisplayName(planName);
    return { success: true, message: t(lang, 'chain_plan.purchase_success', successDisplayName, String(duration)) };
}

function renewPlan(player, weeks) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var planConfig = getPlanConfig();
    var planData = getPlayerPlanData(xuid);
    var now = Date.now();
    var currentPlan = planData.plan || 'free';

    if (currentPlan === 'free') {
        return { success: false, message: t(lang, 'chain_plan.cannot_renew_free') };
    }

    if (weeks < 1 || weeks > 3) {
        return { success: false, message: t(lang, 'chain_plan.invalid_weeks') };
    }

    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var weeklyPrice = planInfo.price || 0;
    var totalPrice = weeklyPrice * weeks;
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';

    var playerMoney = _deps.getPlayerMoney ? _deps.getPlayerMoney(player) : 0;
    if (playerMoney < totalPrice) {
        return { success: false, message: t(lang, 'chain_plan.renew_insufficient', String(weeks), String(totalPrice), currencyName) };
    }

    if (_deps.reducePlayerMoney) {
        var displayName = getPlanDisplayName(currentPlan);
        if (!_deps.reducePlayerMoney(player, totalPrice, 'Block Plan 续费: ' + displayName + ' ' + weeks + '周')) {
            return { success: false, message: t(lang, 'chain_plan.renew_failed') };
        }
    }

    var baseTime = planData.expireTime > now ? planData.expireTime : now;
    var addDays = weeks * 7;
    planData.expireTime = baseTime + (addDays * 24 * 60 * 60 * 1000);
    savePlanData(xuid, planData);

    var displayName2 = getPlanDisplayName(currentPlan);
    return { success: true, message: t(lang, 'chain_plan.renew_success', displayName2, String(addDays)) };
}

function showPlanMenu(player) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    resetDailyUsage(planData);

    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS.free;
    var checkResult = checkCanChain(xuid);
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    // ultra 永不过期，视为已激活
    var isActive = currentPlan === 'ultra' || (currentPlan !== 'free' && planData.expireTime > Date.now());

    if (isActive) {
        showActivePlanMenu(player, planData, planInfo, checkResult, currencyName);
    } else {
        showPurchasePlanMenu(player, planData, planInfo, checkResult, currencyName, planConfig);
    }
}

function showActivePlanMenu(player, planData, planInfo, checkResult, currencyName) {
	const lang = getLocale(player.xuid);
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§bBlock Plan');

    var isUltra = planData.plan === 'ultra';
    var planDisplayName = getPlanDisplayName(planData.plan || 'free');

    var content = t(lang, 'chain.current_plan_label') + planDisplayName + '\n';

    if (isUltra) {
        content += t(lang, 'chain.daily_usage_label') + planData.dailyUsed + ' Credits\n';
        content += '到期时间: §a' + t(lang, 'chain_plan.ultra_expire_label') + '\n';
    } else {
        var expireDate = new Date(planData.expireTime);
        var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
        content += t(lang, 'chain.daily_usage_label') + planData.dailyUsed + '/' + planInfo.dailyLimit + ' Credits' + '\n';
        content += t(lang, 'chain.expire_time_label', String(expireDate.getFullYear()), String(expireDate.getMonth() + 1), String(expireDate.getDate())) + '\n';
        content += t(lang, 'chain.remaining_days_label', String(remainingDays)) + '\n';
    }

    var planConfig = getPlanConfig();
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

    content += t(lang, 'chain.plan_free_desc', freeName, String(freeLimit)) + '\n';
    content += t(lang, 'chain.plan_tier_desc_base', liteName, String(liteLimit)) + '\n';
    content += t(lang, 'chain.plan_tier_desc', standardName, standardRatio, liteName) + '\n';
    content += t(lang, 'chain.plan_tier_desc', proName, proRatio, liteName) + '\n';
    content += t(lang, 'chain.plan_tier_desc', maxName, maxRatio, liteName) + '\n';
    content += '§l§6[Ultra]§r - ' + t(lang, 'chain_plan.ultra_desc') + '\n';

    fm.setContent(content);

    // ultra 套餐隐藏续费和升级按钮
    if (!isUltra) {
        fm.addButton(t(lang, 'chain.btn_renew'), "textures/ui/confirm");
        fm.addButton(t(lang, 'chain.btn_upgrade'), "textures/ui/jump_boost_effect");
    }
    fm.addButton(t(lang, 'chain.btn_back'), "textures/ui/recap_glyph_desaturated");

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (isUltra) {
            if (id === 0) showChainSettingsForm(p);
        } else {
            if (id === 0) {
                showRenewMenu(p);
            } else if (id === 1) {
                showUpgradeMenu(p);
            } else if (id === 2) {
                showChainSettingsForm(p);
            }
        }
    });
}

function showRenewMenu(player) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var planInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var weeklyPrice = planInfo.price || 0;
    var currentDisplayName = getPlanDisplayName(currentPlan);

    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'chain_plan.renew_title'));

    fm.addLabel(t(lang, 'chain.current_plan_label') + currentDisplayName);
    fm.addLabel(t(lang, 'chain_plan.weekly_price', String(weeklyPrice), currencyName));

    var renewOptions = [
        t(lang, 'chain_plan.renew_option', '1', String(weeklyPrice), currencyName),
        t(lang, 'chain_plan.renew_option', '2', String(weeklyPrice * 2), currencyName),
        t(lang, 'chain_plan.renew_option', '3', String(weeklyPrice * 3), currencyName)
    ];
    fm.addDropdown(t(lang, 'chain_plan.select_renew_weeks'), renewOptions, 0);

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
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var planConfig = getPlanConfig();
    var currentPlan = planData.plan || 'free';
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var currentDisplayName = getPlanDisplayName(currentPlan);

    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'chain_plan.upgrade_title'));

    fm.addLabel(t(lang, 'chain.current_plan_label') + currentDisplayName);

    var planOrder = ['lite', 'standard', 'pro', 'max', 'ultra'];
    var currentIndex = planOrder.indexOf(currentPlan);
    var upgradeOptions = [];
    var upgradePlans = [];

    var currentPlanInfo = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
    var currentPrice = currentPlanInfo.price || 0;
    var currentDuration = currentPlanInfo.duration || 7;
    var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));

    for (var i = currentIndex + 1; i < planOrder.length; i++) {
        var pName = planOrder[i];
        if (pName === 'ultra') {
            // ultra 套餐：计算当前套餐剩余价值抵扣
            var ultraPrice = ULTRA_PRICE;
            if (currentPlan !== 'free' && planData.expireTime > Date.now()) {
                var remainingValue = Math.ceil(currentPrice * remainingDays / currentDuration);
                ultraPrice = ULTRA_PRICE - remainingValue;
                if (ultraPrice < 0) ultraPrice = 0;
            }
            upgradeOptions.push('§l§6[Ultra]§r - ' + t(lang, 'chain_plan.ultra_desc') + ' - ' + ultraPrice + ' ' + currencyName);
        } else {
            var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
            var priceDiff = (pInfo.price || 0) - currentPrice;
            var upgradePrice = Math.ceil(priceDiff * remainingDays / currentDuration);
            var displayName = getPlanDisplayName(pName);
            upgradeOptions.push(t(lang, 'chain_plan.upgrade_option', displayName, String(pInfo.dailyLimit), String(upgradePrice), currencyName));
        }
        upgradePlans.push(pName);
    }

    if (upgradeOptions.length === 0) {
        fm.addLabel(t(lang, 'chain_plan.max_level_plan'));
    } else {
        fm.addDropdown(t(lang, 'chain_plan.select_upgrade_plan'), upgradeOptions, 0);
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
	const lang = getLocale(player.xuid);
    var fm = mc.newCustomForm();
    fm.setTitle('§l§bBlock Plan');

    var currentDisplayName = getPlanDisplayName(planData.plan || 'free');
    fm.addLabel(t(lang, 'chain.current_plan_label') + currentDisplayName);
    fm.addLabel(t(lang, 'chain.daily_usage_label') + planData.dailyUsed + '/' + planInfo.dailyLimit + ' Credits');

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

    fm.addLabel(t(lang, 'chain.plan_free_desc', freeName, String(freeLimit)) + '\n' +
        t(lang, 'chain.plan_tier_desc_base', liteName, String(liteLimit)) + '\n' +
        t(lang, 'chain.plan_tier_desc', standardName, standardRatio, liteName) + '\n' +
        t(lang, 'chain.plan_tier_desc', proName, proRatio, liteName) + '\n' +
        t(lang, 'chain.plan_tier_desc', maxName, maxRatio, liteName) + '\n' +
        '§l§6[Ultra]§r - ' + t(lang, 'chain_plan.ultra_desc'));

    var planOptions = [];
    var planKeys = ['lite', 'standard', 'pro', 'max', 'ultra'];

    for (var i = 0; i < planKeys.length; i++) {
        var pName = planKeys[i];
        if (pName === 'ultra') {
            planOptions.push(t(lang, 'chain_plan.ultra_option', t(lang, 'chain_plan.ultra_desc'), String(ULTRA_PRICE), currencyName));
        } else {
            var pInfo = planConfig[pName] || DEFAULT_PLANS[pName];
            var displayName = getPlanDisplayName(pName);
            planOptions.push(t(lang, 'chain_plan.plan_option', displayName, String(pInfo.dailyLimit), String(pInfo.price || 0), currencyName, String(pInfo.duration || 0)));
        }
    }

    fm.addDropdown(t(lang, 'chain_plan.select_plan'), planOptions, 0);

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

function showPurchaseConfirm(player, planName, displayPrice) {
	const lang = getLocale(player.xuid);
    var planConfig = getPlanConfig();
    var currencyName = _deps.getCurrencyName ? _deps.getCurrencyName() : '';
    var displayName = getPlanDisplayName(planName);
    var xuid = player.xuid;
    var planData = getPlayerPlanData(xuid);
    var currentPlan = planData.plan || 'free';

    // 计算实际价格（含当前套餐抵扣）
    var actualPrice = displayPrice;
    if (actualPrice === undefined) {
        if (planName === 'ultra') {
            actualPrice = ULTRA_PRICE;
            if (currentPlan !== 'free' && planData.expireTime > Date.now()) {
                var planConfig2 = getPlanConfig();
                var currentPlanInfo = planConfig2[currentPlan] || DEFAULT_PLANS[currentPlan];
                var currentPrice = currentPlanInfo.price || 0;
                var currentDuration = currentPlanInfo.duration || 7;
                var remainingDays = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
                var remainingValue = Math.ceil(currentPrice * remainingDays / currentDuration);
                actualPrice = ULTRA_PRICE - remainingValue;
                if (actualPrice < 0) actualPrice = 0;
            }
        } else {
            var planInfo = planConfig[planName] || DEFAULT_PLANS[planName];
            actualPrice = planInfo.price || 0;
            if (currentPlan !== 'free' && planData.expireTime > Date.now()) {
                var currentPlanInfo2 = planConfig[currentPlan] || DEFAULT_PLANS[currentPlan];
                var currentPrice2 = currentPlanInfo2.price || 0;
                var priceDiff = actualPrice - currentPrice2;
                if (priceDiff > 0) {
                    var remainingDays2 = Math.ceil((planData.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
                    var currentDuration2 = currentPlanInfo2.duration || 7;
                    actualPrice = Math.ceil(priceDiff * remainingDays2 / currentDuration2);
                }
            }
        }
    }

    // ultra 套餐特殊处理
    if (planName === 'ultra') {
        player.sendModalForm(
            t(lang, 'chain_plan.confirm_title'),
            '§l§6[Ultra]§r - ' + t(lang, 'chain_plan.ultra_desc') + '\n§a价格: §e' + actualPrice + ' ' + currencyName,
            t(lang, 'chain_plan.btn_confirm'),
            t(lang, 'chain_plan.btn_cancel'),
            function(p, result) {
                if (result === true) {
                    var purchaseResult = purchasePlan(p, planName);
                    p.tell(purchaseResult.message);
                    if (purchaseResult.success) showPlanMenu(p);
                } else {
                    showPlanMenu(p);
                }
            }
        );
        return;
    }

    var planInfo = planConfig[planName] || DEFAULT_PLANS[planName];

    player.sendModalForm(
        t(lang, 'chain_plan.confirm_title'),
        t(lang, 'chain_plan.confirm_content', displayName, String(planInfo.dailyLimit), String(actualPrice), currencyName, String(planInfo.duration)),
        t(lang, 'chain_plan.btn_confirm'),
        t(lang, 'chain_plan.btn_cancel'),
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
	const lang = getLocale(player.xuid);
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
        t(lang, 'chain_plan.renew_confirm_title'),
        t(lang, 'chain_plan.renew_confirm_content', displayName, String(weeks), String(totalPrice), currencyName),
        t(lang, 'chain_plan.btn_confirm_renew'),
        t(lang, 'chain_plan.btn_cancel'),
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
	const lang = getLocale(player.xuid);
    try {
        var item = player.getHand();
        if (!item || item.isNull()) return 0;
        return item.maxDamage || 0;
    } catch (e) {
        return 0;
    }
}

function getDurability(player) {
	const lang = getLocale(player.xuid);
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
	const lang = getLocale(player.xuid);
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

// 读取指定附魔等级
function getEnchantmentLevel(item, enchId) {
    try {
        var nbt = item.getNbt();
        if (!nbt) return 0;
        var tag = nbt.getTag('tag');
        if (!tag) return 0;
        var ench = tag.getTag('ench');
        if (!ench) return 0;
        var enchArray = ench.toArray();
        for (var i = 0; i < enchArray.length; i++) {
            if (enchArray[i].id === enchId) return enchArray[i].lvl || 0;
        }
        return 0;
    } catch (e) {
        return 0;
    }
}

// 是否带精准采集
function hasSilkTouch(item) {
    return getEnchantmentLevel(item, 16) > 0;
}

// 在方块位置掉落方块物品
function spawnBlockAsItem(block) {
    try {
        var snbt = '{Name:"' + block.type + '",Count:1b,Damage:' + (block.tileData || 0) + 's}';
        var nbt = NBT.parseSNBT(snbt);
        if (nbt) {
            var itemObj = mc.newItem(nbt);
            if (itemObj && !itemObj.isNull()) {
                mc.spawnItem(itemObj, block.pos);
                return;
            }
        }
    } catch (e) {}
    try {
        block.destroy(true);
    } catch (e2) {}
}

// 获取范围内掉落物实体 id 集合
function getNearbyItemIds(pos) {
    var ids = {};
    try {
        var center = new FloatPos(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5, pos.dimid);
        var entities = mc.getEntities(center, 4);
        for (var i = 0; i < entities.length; i++) {
            var e = entities[i];
            if (!e || e.type !== 'minecraft:item') continue;
            var key = e.uniqueId;
            if (key === undefined || key === null) key = e.id;
            ids[key] = true;
        }
    } catch (e) {}
    return ids;
}

// 对比快照判断是否出现新的掉落物
function hasNewItemDrop(snapshot, pos) {
    if (!snapshot) return true;
    var current = getNearbyItemIds(pos);
    for (var id in current) {
        if (!snapshot[id]) return true;
    }
    return false;
}

// 首块无掉落提示
function showChainNoDropTip(player) {
    var now = Date.now();
    if (_noDropTipCooldowns[player.xuid] && now - _noDropTipCooldowns[player.xuid] < 3000) return;
    _noDropTipCooldowns[player.xuid] = now;
    player.sendText('§c[连锁] 当前工具无法正常开采该方块，未触发连锁', 4);
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
	const lang = getLocale(player.xuid);
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);
    var chainCheck = checkCanChain(player.xuid);
    var planDisplayName = getPlanDisplayName(chainCheck.plan);

    var fm = mc.newSimpleForm();
    fm.setTitle(t(lang, 'chain.settings_title') + ' - Block Plan');

    var content = t(lang, 'chain.current_plan_label') + planDisplayName + '\n';
    if (chainCheck.plan === 'ultra') {
        content += t(lang, 'chain.daily_usage_label') + chainCheck.dailyUsed + ' Credits\n';
    } else {
        content += t(lang, 'chain.daily_usage_label') + chainCheck.dailyUsed + '/' + chainCheck.dailyLimit + ' Credits\n';
    }
    content += '-------------------------\n';
    fm.setContent(content);

    fm.addButton(t(lang, 'chain.btn_settings'), "textures/ui/icon_setting");
    fm.addButton(t(lang, 'chain.btn_plan'), "textures/ui/confirm");
    fm.addButton('§b' + t(lang, 'quick_build.title'), "textures/ui/icon_recipe_item");
    if (isPlayerOP(player)) {
        fm.addButton(t(lang, 'quick_build.assistant_btn'), "textures/ui/icon_book_writable");
    }

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 0) {
            showChainConfigForm(p);
        } else if (id === 1) {
            showPlanMenu(p);
        } else if (id === 2) {
            showBlockForm(p);
        } else if (id === 3) {
            showAssistantForm(p);
        }
    });
}

function showChainConfigForm(player) {
	const lang = getLocale(player.xuid);
    var cfg = getChainConfig();
    var playerCfg = getPlayerChainConfig(player.xuid);

    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'chain.config_title'));
    fm.addSwitch(t(lang, 'chain.switch_enabled'), playerCfg.enabled);
    fm.addSwitch(t(lang, 'chain.switch_mine_all'), playerCfg.mineAll);
    fm.addSwitch(t(lang, 'chain.switch_sneak_only'), playerCfg.sneakOnly);

    var blockIdList = [];
    var toolTypes = ['pickaxe', 'axe', 'shovel', 'hoe'];
    var toolNames = { pickaxe: t(lang, 'chain.tool_pickaxe'), axe: t(lang, 'chain.tool_axe'), shovel: t(lang, 'chain.tool_shovel'), hoe: t(lang, 'chain.tool_hoe') };

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
        p.tell(t(lang, 'chain.tag_prefix') + " §a" + t(lang, 'chain.settings_saved'));
    });
}

function doChainMine(player, startBlock, blockType, maxBlocks) {
	const lang = getLocale(player.xuid);
    var visited = new Set();
    var startPos = startBlock.pos;
    var dim = startPos.dimid;
    var queue = [startPos.x, startPos.y, startPos.z];
    var count = 0;
    var dirs = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1];
    var queueIdx = 0;

    var handItem = player.getHand();
    var silkTouch = handItem ? hasSilkTouch(handItem) : false;

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

            try {
                if (silkTouch) {
                    spawnBlockAsItem(b);
                    b.destroy(false);
                } else {
                    b.destroy(true);
                }
                count++;
            } catch (e) { continue; }
            queue.push(nx, ny, nz);

            if (count >= maxBlocks) break;
        }
    }

    if (count > 1) {
        try {
            var ppos = player.pos;
            var entities = mc.getEntities(ppos, 16);
            for (var i = 0; i < entities.length; i++) {
                var e = entities[i];
                if (e.type === 'minecraft:item' || e.type === 'minecraft:xp_orb') {
                    e.teleport(ppos);
                }
            }
        } catch (e) {}
    }

    return { count: count, durabilityUsed: count };
}

function registerChainListener() {
    mc.listen('onStartDestroyBlock', function(player, block) {
        if (!player || !block) return;
        try {
            var p = block.pos;
            _breakItemSnapshots[player.xuid] = getNearbyItemIds(new IntPos(p.x, p.y, p.z, p.dimid));
        } catch (e) {}
    });

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

            var isCreative = player.gameMode === 1;
            var cfgMaxBlocks = cfg.maxBlocks || 64;
            var maxBlocks;
            var unbreakingLevel = 0;

            if (isCreative) {
                // 创造模式：不消耗耐久、不消耗每日额度，仅受配置上限限制
                maxBlocks = cfgMaxBlocks;
            } else {
                var chainCheck = checkCanChain(player.xuid);
                if (!chainCheck.canChain) {
                    player.sendText(t(getSystemLang(), 'chain.tag_prefix') + " §c" + t(getSystemLang(), 'chain.daily_limit_msg'), 4);
                    return;
                }

                var maxDurability = getMaxDurability(player);
                var currentDurability = getDurability(player);
                unbreakingLevel = getUnbreakingLevel(item);
                if (_debug) {
                    logger.info('[Block] 工具=' + toolId + ' 类型=' + toolType + ' 方块=' + blockType);
                    logger.info('[Block] 最大耐久=' + maxDurability + ' 当前耐久=' + currentDurability + ' 耐久附魔=' + unbreakingLevel);
                }
                if (currentDurability <= 0) return;

                var effectiveDurability = currentDurability * (unbreakingLevel + 1);
                maxBlocks = Math.min(cfgMaxBlocks, effectiveDurability, chainCheck.remaining);
            }

            var startPos = { x: block.pos.x, y: block.pos.y, z: block.pos.z, dimid: block.pos.dimid };
            var snapshot = _breakItemSnapshots[xuid];
            delete _breakItemSnapshots[xuid];

            function runChain() {
                var startTime = Date.now();
                var result = doChainMine(player, { pos: startPos }, blockType, maxBlocks);
                var elapsed = Date.now() - startTime;

                if (result.count > 0) {
                    if (!isCreative) {
                        applyChainDurability(player, result.count, unbreakingLevel);
                        addDailyUsage(player.xuid, result.count);
                        if (_debug) {
                            logger.info('[Block] 连锁方块数=' + result.count + '，延迟扣除耐久');
                        }
                    }

                    player.sendText(t(getSystemLang(), 'chain.tag_prefix') + " §a" + t(getSystemLang(), 'chain.chain_complete', String(result.count), String(elapsed)), 4);
                    if (_onChainComplete) _onChainComplete(player, result.count);
                }
                if (_debug) {
                    logger.info('[Block] 连锁完成: 方块数=' + result.count + ' 耗时=' + elapsed + 'ms');
                }
            }

            if (isCreative || hasNewItemDrop(snapshot, startPos)) {
                runChain();
                return;
            }

            setTimeout(function() {
                if (hasNewItemDrop(snapshot, startPos)) {
                    runChain();
                } else {
                    showChainNoDropTip(player);
                }
            }, 50);
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

    // 建筑助手模式：独立提示文本（选区逻辑与破坏模式一致）
    if (buildMode === 'assistant') {
        var aLang = getLocale(xuid);
        var aTip = t(aLang, 'quick_build.assistant_tip_export');
        if (sel.pointA) {
            aTip += t(aLang, 'quick_build.assistant_tip_point', 'A', String(sel.pointA.x), String(sel.pointA.y), String(sel.pointA.z));
        }
        if (sel.pointB) {
            aTip += t(aLang, 'quick_build.assistant_tip_point', 'B', String(sel.pointB.x), String(sel.pointB.y), String(sel.pointB.z));
        }
        if (!sel.pointA) {
            aTip += t(aLang, 'quick_build.assistant_tip_select_a');
        } else if (!sel.pointB) {
            aTip += t(aLang, 'quick_build.assistant_tip_select_b');
        }
        return aTip;
    }

    var isFillMode = buildMode === 'fill';
    var actionText = isFillMode ? t(getSystemLang(), 'quick_build.action_place') : t(getSystemLang(), 'quick_build.action_break');

    var tip = '§a' + t(getSystemLang(), 'quick_build.title') + ' [' + getBuildModeName(buildMode) + ']';
    if (sel.pointA) {
        tip += ' | §eA: [' + sel.pointA.x + ',' + sel.pointA.y + ',' + sel.pointA.z + ']';
    }
    if (sel.pointB) {
        tip += ' | §eB: [' + sel.pointB.x + ',' + sel.pointB.y + ',' + sel.pointB.z + ']';
    }
    if (!sel.pointA) {
        tip += ' | §f' + t(getSystemLang(), 'quick_build.select_a_hint', actionText) + ' | §c空手取消';
    } else if (!sel.pointB) {
        tip += ' | §f' + t(getSystemLang(), 'quick_build.select_b_hint', actionText) + ' | §c空手取消';
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

// 沿坐标轴方向在一条棱上每格发射一个粒子
function spawnParticleLine(pos, axis, from, to, dimid) {
    var step = (to >= from) ? 1 : -1;
    for (var v = from; v !== to + step; v += step) {
        var p = { x: pos.x, y: pos.y, z: pos.z, dimid: dimid };
        if (axis === 'x') p.x = v;
        else if (axis === 'y') p.y = v;
        else p.z = v;
        try { mc.spawnParticle(p, 'crop_growth_area_emitter'); } catch (e) { }
    }
}

// 绘制选区长方体线框：底面 4 条 + 顶面 4 条 + 4 条竖直高，共 12 条（每格一个粒子，所有玩家可见）
function drawSelectionBorder(sel) {
    var minX = Math.min(sel.pointA.x, sel.pointB.x), maxX = Math.max(sel.pointA.x, sel.pointB.x);
    var minY = Math.min(sel.pointA.y, sel.pointB.y), maxY = Math.max(sel.pointA.y, sel.pointB.y);
    var minZ = Math.min(sel.pointA.z, sel.pointB.z), maxZ = Math.max(sel.pointA.z, sel.pointB.z);
    var dimid = sel.pointA.dimid;
    // 底面 4 条
    spawnParticleLine({ x: minX, y: minY, z: minZ }, 'x', minX, maxX, dimid);
    spawnParticleLine({ x: minX, y: minY, z: maxZ }, 'x', minX, maxX, dimid);
    spawnParticleLine({ x: minX, y: minY, z: minZ }, 'z', minZ, maxZ, dimid);
    spawnParticleLine({ x: maxX, y: minY, z: minZ }, 'z', minZ, maxZ, dimid);
    // 顶面 4 条
    spawnParticleLine({ x: minX, y: maxY, z: minZ }, 'x', minX, maxX, dimid);
    spawnParticleLine({ x: minX, y: maxY, z: maxZ }, 'x', minX, maxX, dimid);
    spawnParticleLine({ x: minX, y: maxY, z: minZ }, 'z', minZ, maxZ, dimid);
    spawnParticleLine({ x: maxX, y: maxY, z: minZ }, 'z', minZ, maxZ, dimid);
    // 4 条竖直高
    spawnParticleLine({ x: minX, y: minY, z: minZ }, 'y', minY, maxY, dimid);
    spawnParticleLine({ x: maxX, y: minY, z: minZ }, 'y', minY, maxY, dimid);
    spawnParticleLine({ x: minX, y: minY, z: maxZ }, 'y', minY, maxY, dimid);
    spawnParticleLine({ x: maxX, y: minY, z: maxZ }, 'y', minY, maxY, dimid);
}

// 每秒为建筑助手模式且有完整选区的玩家绘制粒子边框
function startAssistantParticleTimer() {
    setInterval(function() {
        var players = mc.getOnlinePlayers();
        for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (!_enabledPlayers[p.xuid]) continue;
            if (_playerBuildModes[p.xuid] !== 'assistant') continue;
            var sel = _playerSelections[p.xuid];
            if (sel && sel.pointA && sel.pointB) {
                drawSelectionBorder(sel);
            }
        }
    }, 1000);
}

// 建筑助手统一选点处理：记录一点，两点齐后按选区用途触发对应表单
function handleAssistantPoint(player, sel, placePos) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    if (!sel.pointA) {
        sel.pointA = placePos;
        player.tell(t(lang, 'quick_build.assistant_point_a', String(placePos.x), String(placePos.y), String(placePos.z)));
    } else if (!sel.pointB) {
        sel.pointB = placePos;
        player.tell(t(lang, 'quick_build.assistant_point_b', String(placePos.x), String(placePos.y), String(placePos.z)));
    }
    if (sel.pointA && sel.pointB) {
        if (_assistantSelMode[xuid] === 'copy') {
            showCopyModeForm(player);
        } else {
            showExportForm(player);
        }
    }
}

function toggleBlockMode(player, mode) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    if (_enabledPlayers[xuid]) {
        _enabledPlayers[xuid] = false;
        delete _playerSelections[xuid];
        player.tell(t(lang, 'quick_build.mode_closed'));
        dlog(player.name + ' 关闭快速建造');
    } else {
        // 检查 iland 选区模式
        try {
            var isSelecting = ll.import('ILAPI_IsSelecting');
            if (isSelecting && isSelecting(xuid)) {
                player.tell(t(lang, 'quick_build.iland_selecting'));
                return;
            }
        } catch (e) {}

        _enabledPlayers[xuid] = true;
        _playerBuildModes[xuid] = mode || 'fill';
        _playerSelections[xuid] = {};

        var buildMode = _playerBuildModes[xuid];
        if (buildMode !== 'fill') {
            player.tell(t(lang, 'quick_build.chain_temp_disabled'));
        }

        var modeName = getBuildModeName(buildMode);
        var actionText = buildMode === 'fill' ? t(lang, 'quick_build.action_place') : t(lang, 'quick_build.action_break');
        player.tell(t(lang, 'quick_build.status_enabled') + '，' + t(lang, 'quick_build.current_mode', modeName) + '，' + t(lang, 'quick_build.select_a_point', actionText));
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
	const lang = getLocale(player.xuid);
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
	const lang = getLocale(player.xuid);
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
	const lang = getLocale(player.xuid);
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
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;

    var buildMode = _playerBuildModes[xuid] || 'fill';
    var size = getSelectionSize(sel);

    // 非填充模式限制最大方块数量（创造模式不限制）
    var isCreative = player.gameMode === 1;
    if (!isCreative && buildMode !== 'fill' && size.volume > MAX_NON_FILL_BLOCKS) {
        var modeName = getBuildModeName(buildMode);
        player.tell(t(lang, 'quick_build.selection_too_large', modeName, MAX_NON_FILL_BLOCKS));
        _playerSelections[xuid] = {};
        return;
    }

    if (buildMode === 'clear') {
        fillSelection(player, sel, 'minecraft:air', 0);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell(t(lang, 'quick_build.break_success', size.volume));
    } else if (buildMode === 'water') {
        fillSelection(player, sel, 'minecraft:water', 0);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell(t(lang, 'quick_build.water_success', size.volume));
    } else if (buildMode === 'lava') {
        fillSelection(player, sel, 'minecraft:lava', 0);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell(t(lang, 'quick_build.lava_success', size.volume));
    } else {
        var mainhand = player.getHand();
        var blockType = mainhand ? mainhand.type : '';
        var tileData = mainhand ? mainhand.aux : 0;

        if (!blockType || blockType === 'minecraft:air') {
            player.tell(t(lang, 'quick_build.hold_block_first'));
            _playerSelections[xuid] = {};
            return;
        }

        fillSelection(player, sel, blockType, tileData);
        if (_onQuickBuildComplete) _onQuickBuildComplete(player, size.volume);
        player.tell(t(lang, 'quick_build.fill_success_creative', String(size.volume)));
    }
    _playerSelections[xuid] = {};
}

function showFillConfirmForm(player) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;

    var size = getSelectionSize(sel);
    var buildMode = _playerBuildModes[xuid] || 'fill';

    // 清空/水源/岩浆模式
    if (buildMode !== 'fill') {
        var modeName = getBuildModeName(buildMode);

        // 限制最大方块数量（创造模式不限制）
        var isCreative = player.gameMode === 1;
        if (!isCreative && size.volume > MAX_NON_FILL_BLOCKS) {
            player.tell(t(lang, 'quick_build.selection_too_large', modeName, MAX_NON_FILL_BLOCKS));
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
        content += t(lang, 'quick_build.fill_selection_info') + '\n';
        content += t(lang, 'quick_build.fill_a_point', String(sel.pointA.x), String(sel.pointA.y), String(sel.pointA.z)) + '\n';
        content += t(lang, 'quick_build.fill_b_point', String(sel.pointB.x), String(sel.pointB.y), String(sel.pointB.z)) + '\n';
        content += t(lang, 'quick_build.fill_size', String(size.dx), String(size.dy), String(size.dz)) + '\n';
        content += t(lang, 'quick_build.fill_need_blocks', String(size.volume)) + '\n\n';
        content += t(lang, 'quick_build.fill_plan_info', planDisplayName) + '\n';
        content += t(lang, 'quick_build.fill_quota_need', String(quotaNeed), (quotaEnough ? '§a' : '§c') + chainCheck.remaining + '§r') + '\n';

        if (!quotaEnough) {
            content += '\n' + t(lang, 'quick_build.fill_insufficient_quota');
        }

        var canFill = quotaEnough;

        player.sendModalForm(
            t(lang, 'quick_build.confirm_title', modeName),
            content,
            canFill ? t(lang, 'quick_build.btn_confirm_fill') : t(lang, 'quick_build.btn_cannot_fill'),
            t(lang, 'quick_build.btn_cancel_fill'),
            function(pl, result) {
                _playerSelections[pl.xuid] = {};
                if (result === null) return;
                if (!result) {
                    pl.tell(t(lang, 'quick_build.fill_cancelled'));
                    return;
                }
                var check2 = checkCanChain(pl.xuid);
                if (check2.remaining < quotaNeed) {
                    pl.tell(t(lang, 'quick_build.fill_quota_insufficient', String(quotaNeed), String(check2.remaining)));
                    return;
                }
                var blockType = buildMode === 'clear' ? 'minecraft:air' :
                               buildMode === 'water' ? 'minecraft:water' : 'minecraft:lava';
                addDailyUsage(pl.xuid, quotaNeed);
                fillSelection(pl, sel, blockType, 0);
                if (_onQuickBuildComplete) _onQuickBuildComplete(pl, size.volume);
                var msg = buildMode === 'clear' ? t(lang, 'quick_build.break_success', size.volume) :
                         buildMode === 'water' ? t(lang, 'quick_build.water_success', size.volume) :
                         t(lang, 'quick_build.lava_success', size.volume);
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
        player.tell(t(lang, 'quick_build.hold_block_first'));
        return;
    }

    var quotaNeed = Math.ceil(size.volume * 0.5);
    var chainCheck = checkCanChain(xuid);
    var quotaEnough = chainCheck.remaining >= quotaNeed;
    var planDisplayName = getPlanDisplayName(chainCheck.plan);

    var haveCount = countItemInInventory(player, blockType);
    var enough = haveCount >= size.volume;

    var content = t(lang, 'quick_build.fill_selection_info') + '\n';
    content += t(lang, 'quick_build.fill_a_point', String(sel.pointA.x), String(sel.pointA.y), String(sel.pointA.z)) + '\n';
    content += t(lang, 'quick_build.fill_b_point', String(sel.pointB.x), String(sel.pointB.y), String(sel.pointB.z)) + '\n';
    content += t(lang, 'quick_build.fill_size', String(size.dx), String(size.dy), String(size.dz)) + '\n';
    content += t(lang, 'quick_build.fill_need_blocks', String(size.volume)) + '\n\n';
    content += t(lang, 'quick_build.fill_block_type', blockName) + '\n';
    content += t(lang, 'quick_build.fill_inventory_count', (enough ? '§a' : '§c') + haveCount + '§r') + '\n';
    content += t(lang, 'quick_build.fill_plan_info', planDisplayName) + '\n';
    content += t(lang, 'quick_build.fill_quota_need', String(quotaNeed), (quotaEnough ? '§a' : '§c') + chainCheck.remaining + '§r') + '\n';

    if (!enough) {
        content += '\n' + t(lang, 'quick_build.fill_insufficient_blocks');
    }
    if (!quotaEnough) {
        content += '\n' + t(lang, 'quick_build.fill_insufficient_quota');
    }

    var isCreative = player.gameMode === 1;
    var canFill = isCreative || (enough && quotaEnough);

    player.sendModalForm(
        t(lang, 'quick_build.fill_confirm_title'),
        content,
        canFill ? t(lang, 'quick_build.btn_confirm_fill') : t(lang, 'quick_build.btn_cannot_fill'),
        t(lang, 'quick_build.btn_cancel_fill'),
        function(pl, result) {
            _playerSelections[pl.xuid] = {};
            if (result === null) return;
            if (!result) {
                pl.tell(t(lang, 'quick_build.fill_cancelled'));
                return;
            }
            if (isCreative) {
                fillSelection(pl, sel, blockType, tileData);
                if (_onQuickBuildComplete) _onQuickBuildComplete(pl, size.volume);
                pl.tell(t(lang, 'quick_build.fill_success_creative', String(size.volume)));
                return;
            }
            var check2 = checkCanChain(pl.xuid);
            if (check2.remaining < quotaNeed) {
                pl.tell(t(lang, 'quick_build.fill_quota_insufficient', String(quotaNeed), String(check2.remaining)));
                return;
            }
            if (!enough) {
                pl.tell(t(lang, 'quick_build.fill_blocks_insufficient', String(size.volume), String(haveCount)));
                return;
            }
            if (removeItemFromInventory(pl, blockType, size.volume)) {
                pl.refreshItems();
                addDailyUsage(pl.xuid, quotaNeed);
                fillSelection(pl, sel, blockType, tileData);
                if (_onQuickBuildComplete) _onQuickBuildComplete(pl, size.volume);
                pl.tell(t(lang, 'quick_build.fill_success', String(size.volume), String(quotaNeed)));
            } else {
                pl.tell(t(lang, 'quick_build.fill_failed'));
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
    // 清空/水源/岩浆/建筑助手模式：左键选点（拦截破坏）
    mc.listen('onDestroyBlock', function(player, block) {
        try {
            var xuid = player.xuid;
            var lang = getLocale(xuid);
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
                player.tell(t(lang, 'quick_build.land_no_permission'));
                return false;
            }

            var isAssistant = buildMode === 'assistant';

            if (isAssistant) {
                handleAssistantPoint(player, sel, placePos);
            } else {
                if (!sel.pointA) {
                    sel.pointA = placePos;
                    player.tell(t(lang, 'quick_build.a_marked', placePos.x, placePos.y, placePos.z));
                } else if (!sel.pointB) {
                    sel.pointB = placePos;
                    player.tell(t(lang, 'quick_build.b_marked', placePos.x, placePos.y, placePos.z));
                }
                if (sel.pointA && sel.pointB) {
                    if (player.gameMode === 1) {
                        doCreativeFill(player);
                    } else {
                        showFillConfirmForm(player);
                    }
                }
            }
            return false;
        } catch (e) { logger.error('[block] onDestroyBlock异常: ' + e.message); }
    });

    // 右键事件：空手取消（所有模式）+ 填充模式选点
    mc.listen('onUseItemOn', function(player, item, block, side, pos) {
        try {
            var xuid = player.xuid;
            var lang = getLocale(xuid);
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
                    player.tell(t(lang, 'quick_build.selection_cancelled'));
                } else {
                    _enabledPlayers[xuid] = false;
                    delete _playerSelections[xuid];
                    player.tell(t(lang, 'quick_build.mode_closed'));
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
                player.tell(t(lang, 'quick_build.land_no_permission'));
                return false;
            }

            if (!sel.pointA) {
                sel.pointA = placePos;
                player.tell(t(lang, 'quick_build.a_marked', String(placePos.x), String(placePos.y), String(placePos.z)));
            } else if (!sel.pointB) {
                sel.pointB = placePos;
                player.tell(t(lang, 'quick_build.b_marked', String(placePos.x), String(placePos.y), String(placePos.z)));
            }
            if (sel.pointA && sel.pointB) {
                if (player.gameMode === 1) {
                    doCreativeFill(player);
                } else {
                    showFillConfirmForm(player);
                }
            }
            return false;
        } catch (e) { logger.error('[block] onUseItemOn异常: ' + e.message); }
    });
}

function getBuildModeName(mode) {
    if (mode === 'assistant') return t(getSystemLang(), 'quick_build.assistant_mode_name');
    var names = { fill: '填充模式', clear: '破坏模式', water: '水源模式', lava: '岩浆模式' };
    return names[mode] || '填充模式';
}

function showBlockForm(player) {
	const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var currentMode = _playerBuildModes[xuid] || 'fill';
    var enabled = !!_enabledPlayers[xuid];
    var status = enabled ? t(lang, 'quick_build.status_enabled') : t(lang, 'quick_build.status_disabled');

    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.title'));

    fm.addLabel('§6' + t(lang, 'quick_build.title') + '§r\n' +
        t(lang, 'quick_build.status_enabled').replace('§a', '') + ': ' + status + '\n\n' +
        t(lang, 'quick_build.usage_title') + '\n' +
        t(lang, 'quick_build.usage_desc'));

    var modeOptions = BUILD_MODES.map(function(m) { return getBuildModeName(m); });
    var modeIndex = BUILD_MODES.indexOf(currentMode);
    fm.addDropdown(t(lang, 'quick_build.select_mode'), modeOptions, modeIndex >= 0 ? modeIndex : 0);

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
            pl.tell(t(lang, 'quick_build.mode_switched', modeName));
            pl.tell(buildBlockTip(pl.xuid), 4);
            dlog(pl.name + ' 切换建造模式: ' + modeName);
        }
    });
}

// ============ 命令注册 ============

// 命令选点：在选区模式下将当前玩家所在方块设为基础点，A/B 顺序任意，两点齐后触发后续流程
function setSelectionPointByCommand(player, pointName) {
    const lang = getLocale(player.xuid);
    var xuid = player.xuid;
    if (!_enabledPlayers[xuid] || !_playerSelections[xuid]) {
        player.tell(t(lang, 'quick_build.mode_closed'));
        return;
    }
    var sel = _playerSelections[xuid];
    var buildMode = _playerBuildModes[xuid] || 'fill';
    var isAssistant = buildMode === 'assistant';
    var pos = player.pos;
    if (!pos) return;
    var placePos = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), dimid: pos.dimid };

    if (!canPlayerBuildAt(player, placePos)) {
        player.tell(t(lang, 'quick_build.land_no_permission'));
        return;
    }

    // 无论选 A 还是选 B 都直接记录，A/B 顺序任意
    if (pointName === 'a') {
        sel.pointA = placePos;
        player.tell(t(lang, isAssistant ? 'quick_build.assistant_point_a' : 'quick_build.a_marked',
            String(placePos.x), String(placePos.y), String(placePos.z)));
    } else {
        sel.pointB = placePos;
        player.tell(t(lang, isAssistant ? 'quick_build.assistant_point_b' : 'quick_build.b_marked',
            String(placePos.x), String(placePos.y), String(placePos.z)));
    }

    // 两点齐了才触发后续流程
    if (!sel.pointA || !sel.pointB) return;
    if (isAssistant) {
        if (_assistantSelMode[xuid] === 'copy') {
            showCopyModeForm(player);
        } else {
            showExportForm(player);
        }
    } else {
        if (player.gameMode === 1) {
            doCreativeFill(player);
        } else {
            showFillConfirmForm(player);
        }
    }
}

function registerBlockCommand(registerPlayerCommand) {
    registerPlayerCommand('bp', 'Block Plan', function(p) { showPlanMenu(p); });

    try {
        var cmd = mc.newCommand('block', 'Block功能菜单', PermType.Any);
        cmd.optional('point', ParamType.String);
        cmd.overload([]);
        cmd.overload(['point']);
        cmd.setCallback(function(_cmd, origin, output, results) {
            var player = origin.player;
            if (!player) {
                output.error('§c此命令仅限玩家在游戏内执行！');
                return;
            }
            if (results && results.point) {
                var pt = String(results.point).toLowerCase();
                if (pt === 'a' || pt === 'b') {
                    setSelectionPointByCommand(player, pt);
                    return;
                }
            }
            showChainSettingsForm(player);
        });
        cmd.setup();
    } catch (e) {
        logger.error('[block] /block 命令注册出错: ' + e.message);
    }
}

function setDebugMode(enabled) { _debug = !!enabled; }
function setOnChainComplete(fn) { _onChainComplete = fn; }
function setOnQuickBuildComplete(fn) { _onQuickBuildComplete = fn; }

/** 获取玩家快速建造模式状态 */
function isQuickBuildEnabled(xuid) {
    return !!_enabledPlayers[xuid];
}

// ==================== 建筑助手（仅OP）====================
// 选区导出/导入 .nbt 结构文件（gzip 压缩 JSON 容器，本插件自读写往返，保留完整方块状态与方块实体）

function isPlayerOP(player) {
    try { return !!(player && player.isOP && player.isOP()); } catch (e) { return false; }
}

function getStructureDir() {
    // 插件目录下的 data/structure（src/block.js -> 上层即插件根目录 NECE/）
    var dir = path.join(__dirname, '..', 'data', 'structure');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { logger.error('[block] 创建目录失败: ' + e.message); }
    return dir;
}

// 退出建筑助手选区模式：清除启用状态、建造模式、选区
function exitAssistantMode(player) {
    var xuid = player.xuid;
    _enabledPlayers[xuid] = false;
    delete _playerBuildModes[xuid];
    delete _playerSelections[xuid];
}

function listStructureFiles() {
    try {
        return fs.readdirSync(getStructureDir())
            .filter(function(n) {
                var ln = n.toLowerCase();
                // 同时支持本插件自定义 .nbt（gzip JSON）与基岩版结构方块导出的 .mcstructure
                return ln.endsWith('.nbt') || ln.endsWith('.mcstructure');
            })
            .sort();
    } catch (e) { return []; }
}

function sanitizeStructureName(name) {
    if (!name) return '';
    return String(name).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.nbt$/i, '').replace(/\s+/g, '_');
}

function assistantSetBossBar(player, title, percent) {
    try { player.setBossBar(ASSISTANT_BOSSBAR_UID, title, Math.max(0, Math.min(100, Math.floor(percent))), 3); } catch (e) { }
}

function assistantRemoveBossBar(player) {
    try { player.removeBossBar(ASSISTANT_BOSSBAR_UID); } catch (e) { }
}

// 任务动画帧符号
var _TASK_ANIM_FRAMES = ['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾'];
// 任务动画状态 { xuid: { startTime, done, total, timer } }
var _taskAnims = {};
// 任务锁 { xuid: true }，每玩家同时只能跑一个异步任务
var _taskLocks = {};

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatETA(sec) {
    if (sec < 0) sec = 0;
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

// 获取任务锁，已有任务则提示并返回 false
function acquireTaskLock(player) {
    var xuid = player.xuid;
    if (_taskLocks[xuid]) {
        try { player.tell(t(getLocale(xuid), 'quick_build.assistant_task_busy')); } catch (e) { }
        return false;
    }
    _taskLocks[xuid] = true;
    return true;
}
function releaseTaskLock(player) {
    delete _taskLocks[player.xuid];
}

// 开始任务动画，每秒更新 title 位置
function startTaskAnim(player) {
    var xuid = player.xuid;
    stopTaskAnim(player);
    _taskAnims[xuid] = { startTime: Date.now(), done: 0, total: 1, timer: null };
    _taskAnims[xuid].timer = setInterval(function() { renderTaskAnim(player, xuid); }, 1000);
}
// 更新动画进度，不影响 bossbar
function updateTaskAnim(player, done, total) {
    var xuid = player.xuid;
    var anim = _taskAnims[xuid];
    if (!anim) return;
    anim.done = done;
    anim.total = total;
    renderTaskAnim(player, xuid);
}
// 停止动画并清理状态
function stopTaskAnim(player) {
    var xuid = player.xuid;
    var anim = _taskAnims[xuid];
    if (anim && anim.timer) { try { clearInterval(anim.timer); } catch (e) { } }
    delete _taskAnims[xuid];
}
// 渲染一帧动画到 title 位置
function renderTaskAnim(player, xuid) {
    var anim = _taskAnims[xuid];
    if (!anim) return;
    var now = Date.now();
    var frame = Math.floor((now - anim.startTime) / 1000) % _TASK_ANIM_FRAMES.length;
    var ch = _TASK_ANIM_FRAMES[frame];
    var done = anim.done, total = anim.total;
    var etaStr = '--:--:--';
    if (done > 0 && total > done) {
        var usedSec = (now - anim.startTime) / 1000;
        var remainSec = Math.floor((usedSec / done) * (total - done));
        etaStr = formatETA(remainSec);
    }
    try { player.tell(ch + ' ' + done + '/' + total + ' ETA: ' + etaStr, 4); } catch (e) { }
}

// 玩家退出或切换维度时取消任务，释放锁并移除 bossbar
function cancelPlayerTask(player) {
    var xuid = player.xuid;
    if (!_taskAnims[xuid]) return;
    stopTaskAnim(player);
    releaseTaskLock(player);
    try { player.removeBossBar(ASSISTANT_BOSSBAR_UID); } catch (e) { }
}

// 进入建筑助手选区模式，selMode 区分选区用途 export/copy
function enterAssistantSelection(player, selMode) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    try {
        var isSelecting = ll.import('ILAPI_IsSelecting');
        if (isSelecting && isSelecting(xuid)) {
            player.tell(t(lang, 'quick_build.assistant_iland_selecting'));
            return false;
        }
    } catch (e) {}
    _enabledPlayers[xuid] = true;
    _playerBuildModes[xuid] = 'assistant';
    _playerSelections[xuid] = {};
    _assistantSelMode[xuid] = selMode || 'export';
    player.tell(t(lang, 'quick_build.assistant_enter_mode'));
    player.tell(buildBlockTip(xuid), 4);
    return true;
}

function showAssistantForm(player) {
    if (!isPlayerOP(player)) return;
    var lang = getLocale(player.xuid);
    var xuid = player.xuid;
    var hasSnapshot = !!_assistantSnapshots[xuid];
    var hasClipboard = !!_clipboard[xuid];
    var funcs = [t(lang, 'quick_build.assistant_export'), t(lang, 'quick_build.assistant_import'), t(lang, 'quick_build.assistant_copy'), t(lang, 'quick_build.assistant_shape')];
    var idxUndo = -1, idxPaste = -1, idxShape = 3;
    if (hasSnapshot) { funcs.push(t(lang, 'quick_build.assistant_undo')); idxUndo = funcs.length - 1; }
    if (hasClipboard) { funcs.push(t(lang, 'quick_build.assistant_paste')); idxPaste = funcs.length - 1; }
    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_form_label'));
    fm.addDropdown(t(lang, 'quick_build.assistant_func_dropdown'), funcs, 0);
    player.sendForm(fm, function(pl, data) {
        if (data == null) return;
        var plang = getLocale(pl.xuid);
        var idx = (typeof data[1] === 'number') ? data[1] : 0;
        // 撤回导入
        if (hasSnapshot && idx === idxUndo) {
            var meta = _assistantSnapshots[pl.xuid];
            if (!meta) {
                pl.tell(t(plang, 'quick_build.assistant_no_snapshot'));
                return;
            }
            undoImport(pl, meta);
            return;
        }
        // 粘贴选区
        if (hasClipboard && idx === idxPaste) {
            showPasteCoordForm(pl);
            return;
        }
        // 形状生成
        if (idx === idxShape) {
            showShapeSelectForm(pl);
            return;
        }
        if (idx === 1) {
            showImportFileForm(pl);
        } else if (idx === 2) {
            enterAssistantSelection(pl, 'copy');
        } else {
            enterAssistantSelection(pl, 'export');
        }
    });
}

function showExportForm(player) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;

    var ax = Math.min(sel.pointA.x, sel.pointB.x), bx = Math.max(sel.pointA.x, sel.pointB.x);
    var ay = Math.min(sel.pointA.y, sel.pointB.y), by = Math.max(sel.pointA.y, sel.pointB.y);
    var az = Math.min(sel.pointA.z, sel.pointB.z), bz = Math.max(sel.pointA.z, sel.pointB.z);
    var sx = bx - ax + 1, sy = by - ay + 1, sz = bz - az + 1;
    var volume = sx * sy * sz;
    var dimid = sel.pointA.dimid;

    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_export_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_export_label', String(sx), String(sy), String(sz), String(ax), String(ay), String(az), String(bx), String(by), String(bz), String(volume), String(dimid)));
    fm.addInput(t(lang, 'quick_build.assistant_name_label'), t(lang, 'quick_build.assistant_name_placeholder'), '');
    player.sendForm(fm, function(pl, data) {
        if (data == null) {
            pl.tell(t(lang, 'quick_build.assistant_cancelled'));
            exitAssistantMode(pl);
            return;
        }
        var name = sanitizeStructureName(data[1]);
        if (!name) {
            pl.tell(t(lang, 'quick_build.assistant_invalid_name'));
            exitAssistantMode(pl);
            return;
        }
        exportStructure(pl, { x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }, dimid, name);
        exitAssistantMode(pl);
    });
}

function showImportFileForm(player) {
    var lang = getLocale(player.xuid);
    var files = listStructureFiles();
    if (files.length === 0) {
        player.tell(t(lang, 'quick_build.assistant_no_files'));
        return;
    }
    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_import_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_import_label'));
    fm.addDropdown(t(lang, 'quick_build.assistant_file_dropdown'), files, 0);
    player.sendForm(fm, function(pl, data) {
        if (data == null) return;
        var idx = (typeof data[1] === 'number') ? data[1] : 0;
        var filename = files[idx];
        if (!filename) return;
        showImportCoordForm(pl, filename);
    });
}

function showImportCoordForm(player, filename) {
    var lang = getLocale(player.xuid);
    var px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_coord_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_coord_label', filename, String(px), String(py), String(pz)));
    fm.addInput(t(lang, 'quick_build.assistant_x_label'), t(lang, 'quick_build.assistant_coord_placeholder', String(px)), String(px));
    fm.addInput(t(lang, 'quick_build.assistant_y_label'), t(lang, 'quick_build.assistant_coord_placeholder', String(py)), String(py));
    fm.addInput(t(lang, 'quick_build.assistant_z_label'), t(lang, 'quick_build.assistant_coord_placeholder', String(pz)), String(pz));
    fm.addSlider(t(lang, 'quick_build.assistant_rotate_label'), 0, 360, 90, 0);
    fm.addSwitch(t(lang, 'quick_build.assistant_mirror_x'), false);
    fm.addSwitch(t(lang, 'quick_build.assistant_mirror_z'), false);
    fm.addSwitch(t(lang, 'quick_build.assistant_snapshot_toggle'), false);
    player.sendForm(fm, function(pl, data) {
        if (data == null) return;
        var x = parseInt(data[1]), y = parseInt(data[2]), z = parseInt(data[3]);
        if (isNaN(x)) x = Math.floor(pl.pos.x);
        if (isNaN(y)) y = Math.floor(pl.pos.y);
        if (isNaN(z)) z = Math.floor(pl.pos.z);
        var rotate = (typeof data[4] === 'number') ? (data[4] % 360) : 0;
        if (rotate === 360) rotate = 0;
        var mirrorX = !!(data[5]);
        var mirrorZ = !!(data[6]);
        var snapshot = !!(data[7]);
        importStructureDispatch(pl, filename, x, y, z, rotate, mirrorX, mirrorZ, snapshot);
    });
}

// 复制选区：两点齐后弹表单，显示范围，询问重新选点还是保存
function showCopyModeForm(player) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;
    var ax = Math.min(sel.pointA.x, sel.pointB.x), bx = Math.max(sel.pointA.x, sel.pointB.x);
    var ay = Math.min(sel.pointA.y, sel.pointB.y), by = Math.max(sel.pointA.y, sel.pointB.y);
    var az = Math.min(sel.pointA.z, sel.pointB.z), bz = Math.max(sel.pointA.z, sel.pointB.z);
    var sx = bx - ax + 1, sy = by - ay + 1, sz = bz - az + 1;
    var volume = sx * sy * sz;
    var content = t(lang, 'quick_build.assistant_copy_label',
        String(sx), String(sy), String(sz), String(ax), String(ay), String(az),
        String(bx), String(by), String(bz), String(volume), String(sel.pointA.dimid));
    player.sendModalForm(
        t(lang, 'quick_build.assistant_copy_title'),
        content,
        t(lang, 'quick_build.assistant_copy_save'),
        t(lang, 'quick_build.assistant_copy_redo'),
        function(pl, result) {
            if (result == null) {
                exitAssistantMode(pl);
                return;
            }
            if (result) {
                copySelectionToClipboard(pl);
            } else {
                _playerSelections[pl.xuid] = {};
                pl.tell(t(lang, 'quick_build.assistant_redo_point'));
                pl.tell(buildBlockTip(pl.xuid), 4);
            }
        }
    );
}

// 复制选区到剪贴板，保存到 data/temp/clipboard_<xuid>.nbt，完成后退出选区模式
function copySelectionToClipboard(player) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    var sel = _playerSelections[xuid];
    if (!sel || !sel.pointA || !sel.pointB) return;
    var minPos = {
        x: Math.min(sel.pointA.x, sel.pointB.x),
        y: Math.min(sel.pointA.y, sel.pointB.y),
        z: Math.min(sel.pointA.z, sel.pointB.z)
    };
    var maxPos = {
        x: Math.max(sel.pointA.x, sel.pointB.x),
        y: Math.max(sel.pointA.y, sel.pointB.y),
        z: Math.max(sel.pointA.z, sel.pointB.z)
    };
    var dimid = sel.pointA.dimid;
    var sx = maxPos.x - minPos.x + 1, sy = maxPos.y - minPos.y + 1, sz = maxPos.z - minPos.z + 1;
    var filePath = path.join(getTempDir(), 'clipboard_' + xuid + '.nbt');
    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);
    saveSnapshotRegion(player, minPos, maxPos, dimid, filePath, 'quick_build.assistant_copy_progress', function(snapFile) {
        exitAssistantMode(player);
        stopTaskAnim(player);
        releaseTaskLock(player);
        if (snapFile) {
            _clipboard[xuid] = { file: snapFile, dimid: dimid, size: { x: sx, y: sy, z: sz }, total: sx * sy * sz };
            player.tell(t(lang, 'quick_build.assistant_copy_success', String(sx * sy * sz)));
        } else {
            player.tell(t(lang, 'quick_build.assistant_copy_failed'));
        }
    });
}

// 粘贴选区坐标表单（复用导入坐标表单，数据源为剪贴板）
function showPasteCoordForm(player) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    var cb = _clipboard[xuid];
    if (!cb) {
        player.tell(t(lang, 'quick_build.assistant_no_clipboard'));
        return;
    }
    var px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_paste_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_paste_label', String(cb.size.x), String(cb.size.y), String(cb.size.z), String(px), String(py), String(pz)));
    fm.addInput(t(lang, 'quick_build.assistant_x_label'), t(lang, 'quick_build.assistant_coord_placeholder', String(px)), String(px));
    fm.addInput(t(lang, 'quick_build.assistant_y_label'), t(lang, 'quick_build.assistant_coord_placeholder', String(py)), String(py));
    fm.addInput(t(lang, 'quick_build.assistant_z_label'), t(lang, 'quick_build.assistant_coord_placeholder', String(pz)), String(pz));
    fm.addSlider(t(lang, 'quick_build.assistant_rotate_label'), 0, 360, 90, 0);
    fm.addSwitch(t(lang, 'quick_build.assistant_mirror_x'), false);
    fm.addSwitch(t(lang, 'quick_build.assistant_mirror_z'), false);
    fm.addSwitch(t(lang, 'quick_build.assistant_snapshot_toggle'), false);
    player.sendForm(fm, function(pl, data) {
        if (data == null) return;
        var x = parseInt(data[1]), y = parseInt(data[2]), z = parseInt(data[3]);
        if (isNaN(x)) x = Math.floor(pl.pos.x);
        if (isNaN(y)) y = Math.floor(pl.pos.y);
        if (isNaN(z)) z = Math.floor(pl.pos.z);
        var rotate = (typeof data[4] === 'number') ? (data[4] % 360) : 0;
        if (rotate === 360) rotate = 0;
        var mirrorX = !!(data[5]);
        var mirrorZ = !!(data[6]);
        var snapshot = !!(data[7]);
        pasteFromClipboard(pl, x, y, z, rotate, mirrorX, mirrorZ, snapshot);
    });
}

// 粘贴剪贴板结构到目标坐标，支持旋转/镜像/快照，完成后清空剪贴板指针
function pasteFromClipboard(player, ox, oy, oz, rotate, mirrorX, mirrorZ, snapshot) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    var cb = _clipboard[xuid];
    if (!cb) {
        player.tell(t(lang, 'quick_build.assistant_no_clipboard'));
        return;
    }
    var data = readSnapshotFile(cb.file);
    if (!data) {
        player.tell(t(lang, 'quick_build.assistant_paste_failed'));
        delete _clipboard[xuid];
        return;
    }
    var sx = data.size.x, sy = data.size.y, sz = data.size.z;
    var total = sx * sy * sz;
    var palette = data.palette || [{ name: 'minecraft:air', aux: 0, snbt: '' }];
    var blocks = data.blocks || [];
    var tileEntities = data.tileEntities || [];
    var dimid = (player.pos && typeof player.pos.dimid !== 'undefined') ? player.pos.dimid : cb.dimid;
    var plane = sx * sz;
    var rmod = ((rotate || 0) % 360 + 360) % 360;
    var nsx = (rmod === 90 || rmod === 270) ? sz : sx;
    var nsz = (rmod === 90 || rmod === 270) ? sx : sz;
    var i = 0;

    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);
    player.tell(t(lang, 'quick_build.assistant_pasting', String(nsx), String(sy), String(nsz), String(total), String(ox), String(oy), String(oz)));
    assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_progress', '0'), 0);

    function batch() {
        var end = Math.min(i + ASSISTANT_BATCH_SIZE, total);
        for (; i < end; i++) {
            var y = Math.floor(i / plane);
            var r = i - y * plane;
            var z = Math.floor(r / sx);
            var x = r - z * sx;
            var tc = transformLocalCoord(x, z, sx, sz, rotate, mirrorX, mirrorZ);
            var wx = ox + tc.x, wy = oy + y, wz = oz + tc.z;
            var entry = palette[blocks[i]] || palette[0];
            var bname = entry.name || 'minecraft:air';
            if (bname === 'minecraft:air') {
                try { mc.setBlock(wx, wy, wz, dimid, 'minecraft:air', 0); } catch (e) { }
                continue;
            }
            try {
                mc.setBlock(wx, wy, wz, dimid, bname, entry.aux || 0);
                if (entry.snbt) {
                    var nb = mc.getBlock(wx, wy, wz, dimid);
                    if (nb) nb.setNbt(NBT.parseSNBT(entry.snbt));
                }
            } catch (e) { }
        }
        var pct = Math.floor((i / total) * 100);
        assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_progress', String(pct)), pct);
        updateTaskAnim(player, i, total);
        if (i < total) {
            setTimeout(batch, 0);
        } else {
            importTileEntities();
        }
    }

    function importTileEntities() {
        var j = 0, teTotal = tileEntities.length;
        function teBatch() {
            var end = Math.min(j + ASSISTANT_BATCH_SIZE, teTotal);
            for (; j < end; j++) {
                var te = tileEntities[j];
                var tc2 = transformLocalCoord(te.x, te.z, sx, sz, rotate, mirrorX, mirrorZ);
                try {
                    var be = mc.getBlockEntity(ox + tc2.x, oy + te.y, oz + tc2.z, dimid);
                    if (be) be.setNbt(NBT.parseSNBT(te.snbt));
                } catch (e) { }
            }
            var pct = teTotal > 0 ? Math.floor((j / teTotal) * 100) : 100;
            assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_te_progress', String(pct)), pct);
            updateTaskAnim(player, j, teTotal);
            if (j < teTotal) setTimeout(teBatch, 0);
            else finishPaste();
        }
        if (teTotal === 0) finishPaste();
        else teBatch();
    }

    function finishPaste() {
        assistantRemoveBossBar(player);
        stopTaskAnim(player);
        releaseTaskLock(player);
        delete _clipboard[xuid];
        player.tell(t(lang, 'quick_build.assistant_paste_success', String(total), String(tileEntities.length)));
    }

    startImportWithSnapshot(player, snapshot, { x: ox, y: oy, z: oz }, { x: ox + nsx - 1, y: oy + sy - 1, z: oz + nsz - 1 }, dimid, function() { batch(); });
}

// 校验方块命名空间，仅允许合法字符
function isValidBlockName(name) {
    return typeof name === 'string' && /^[a-z0-9_:.\-]+$/i.test(name);
}

// 形状选择表单，先选形状再填填充方块
function showShapeSelectForm(player) {
    var lang = getLocale(player.xuid);
    var handBlock = 'minecraft:stone';
    try {
        var hand = player.getHand();
        if (hand && !hand.isNull() && hand.type) handBlock = hand.type;
    } catch (e) { }
    var shapes = [
        t(lang, 'quick_build.assistant_shape_circle'),
        t(lang, 'quick_build.assistant_shape_cylinder'),
        t(lang, 'quick_build.assistant_shape_sphere'),
        t(lang, 'quick_build.assistant_shape_box'),
        t(lang, 'quick_build.assistant_shape_prism'),
        t(lang, 'quick_build.assistant_shape_poly')
    ];
    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_shape_select_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_shape_select_label'));
    fm.addDropdown(t(lang, 'quick_build.assistant_shape_dropdown'), shapes, 0);
    fm.addInput(t(lang, 'quick_build.assistant_block_label'), t(lang, 'quick_build.assistant_block_placeholder'), handBlock);
    player.sendForm(fm, function(pl, data) {
        if (data == null) return;
        var idx = (typeof data[1] === 'number') ? data[1] : 0;
        var shape = ['circle', 'cylinder', 'sphere', 'box', 'prism', 'poly'][idx] || 'circle';
        var blockName = String(data[2] || '').trim();
        if (!isValidBlockName(blockName)) {
            pl.tell(t(lang, 'quick_build.assistant_shape_invalid_block'));
            return;
        }
        showShapeParamForm(pl, shape, blockName);
    });
}

// 形状参数表单，按形状动态展示输入项
function showShapeParamForm(player, shape, blockName) {
    var lang = getLocale(player.xuid);
    var px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
    var fm = mc.newCustomForm();
    fm.setTitle(t(lang, 'quick_build.assistant_shape_param_title'));
    fm.addLabel(t(lang, 'quick_build.assistant_shape_param_block', blockName));
    if (shape === 'circle') {
        fm.addInput(t(lang, 'quick_build.assistant_x_label'), '', String(px));
        fm.addInput(t(lang, 'quick_build.assistant_y_label'), '', String(py));
        fm.addInput(t(lang, 'quick_build.assistant_z_label'), '', String(pz));
        fm.addInput(t(lang, 'quick_build.assistant_shape_outer_r'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_inner_r'), '', '');
    } else if (shape === 'cylinder') {
        fm.addInput(t(lang, 'quick_build.assistant_shape_outer_r'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_inner_r'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_height'), '', '');
    } else if (shape === 'sphere') {
        fm.addInput(t(lang, 'quick_build.assistant_shape_outer_r'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_inner_r'), '', '');
    } else if (shape === 'box') {
        fm.addInput(t(lang, 'quick_build.assistant_shape_length'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_width'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_height'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_in_length'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_in_width'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_in_height'), '', '');
    } else if (shape === 'prism') {
        fm.addInput(t(lang, 'quick_build.assistant_shape_side1'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_side2'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_side3'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_height'), '', '');
    } else if (shape === 'poly') {
        fm.addInput(t(lang, 'quick_build.assistant_shape_faces'), '', '');
        fm.addInput(t(lang, 'quick_build.assistant_shape_edge'), '', '');
    }
    fm.addSwitch(t(lang, 'quick_build.assistant_shape_snapshot'), false);
    player.sendForm(fm, function(pl, data) {
        if (data == null) return;
        var params = parseShapeParams(shape, data, px, py, pz);
        var err = validateShapeParams(shape, params, lang);
        if (err) {
            pl.tell(err);
            return;
        }
        var snapshot = !!(data[data.length - 1]);
        generateShape(pl, shape, blockName, params, snapshot);
    });
}

// 从表单数据提取形状参数，空坐标回退到玩家位置
function parseShapeParams(shape, data, px, py, pz) {
    var num = function(v) { var n = parseInt(v); return isNaN(n) ? 0 : n; };
    if (shape === 'circle') {
        var cx = parseInt(data[1]); if (isNaN(cx)) cx = px;
        var cy2 = parseInt(data[2]); if (isNaN(cy2)) cy2 = py;
        var cz2 = parseInt(data[3]); if (isNaN(cz2)) cz2 = pz;
        return { cx: cx, cy: cy2, cz: cz2, outerR: num(data[4]), innerR: num(data[5]) };
    }
    if (shape === 'cylinder') return { cx: px, cy: py, cz: pz, outerR: num(data[1]), innerR: num(data[2]), height: num(data[3]) };
    if (shape === 'sphere') return { cx: px, cy: py, cz: pz, outerR: num(data[1]), innerR: num(data[2]) };
    if (shape === 'box') return { cx: px, cy: py, cz: pz, len: num(data[1]), wid: num(data[2]), hei: num(data[3]), inLen: num(data[4]), inWid: num(data[5]), inHei: num(data[6]) };
    if (shape === 'prism') return { cx: px, cy: py, cz: pz, s1: num(data[1]), s2: num(data[2]), s3: num(data[3]), height: num(data[4]) };
    if (shape === 'poly') return { cx: px, cy: py, cz: pz, faces: num(data[1]), edge: num(data[2]) };
    return { cx: px, cy: py, cz: pz };
}

// 校验形状参数，非法返回错误消息，合法返回 null 并补充几何数据
function validateShapeParams(shape, p, lang) {
    var invalid = t(lang, 'quick_build.assistant_shape_invalid_param');
    var gte = t(lang, 'quick_build.assistant_shape_inner_gte_outer', t(lang, 'quick_build.assistant_shape_inner_r'), t(lang, 'quick_build.assistant_shape_outer_r'));
    if (shape === 'circle' || shape === 'sphere') {
        if (p.outerR < 0) return invalid;
        if (p.innerR > 0 && p.innerR >= p.outerR) return gte;
        return null;
    }
    if (shape === 'cylinder') {
        if (p.outerR < 0 || p.height < 1) return invalid;
        if (p.innerR > 0 && p.innerR >= p.outerR) return gte;
        return null;
    }
    if (shape === 'box') {
        if (p.len < 1 || p.wid < 1 || p.hei < 1) return invalid;
        p.hollow = (p.inLen > 0 && p.inLen < p.len && p.inWid > 0 && p.inWid < p.wid && p.inHei > 0 && p.inHei < p.hei);
        return null;
    }
    if (shape === 'prism') {
        if (p.height < 1) return invalid;
        var a = p.s1, b = p.s2, c = p.s3;
        if (a <= 0 || b <= 0 || c <= 0) return invalid;
        if (!(a + b > c && a + c > b && b + c > a)) return t(lang, 'quick_build.assistant_shape_bad_triangle');
        p.tri = triangleVerts(a, b, c);
        return null;
    }
    if (shape === 'poly') {
        if (p.faces < 3) return t(lang, 'quick_build.assistant_shape_bad_faces');
        if (p.edge < 1) return invalid;
        p.verts = polyVerts(p.faces, p.edge);
        return null;
    }
    return null;
}

// 三边三角形顶点，重心对齐到原点
function triangleVerts(s1, s2, s3) {
    var ax = 0, az = 0;
    var bx = s1, bz = 0;
    var cx = (s2 * s2 + s1 * s1 - s3 * s3) / (2 * s1);
    var cy = Math.sqrt(Math.max(0, s2 * s2 - cx * cx));
    var gx = (ax + bx + cx) / 3;
    var gz = (az + bz + cy) / 3;
    return [
        { x: ax - gx, z: az - gz },
        { x: bx - gx, z: bz - gz },
        { x: cx - gx, z: cy - gz }
    ];
}

// 正N边形顶点，外接圆半径由边长与面数决定
function polyVerts(faces, edge) {
    var r = edge / (2 * Math.sin(Math.PI / faces));
    var verts = [];
    for (var i = 0; i < faces; i++) {
        var ang = (i * 2 * Math.PI) / faces;
        verts.push({ x: r * Math.cos(ang), z: r * Math.sin(ang) });
    }
    return verts;
}

// 三点叉积
function cross2(o, a, b) {
    return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

// 点在三角形内判断，同侧法
function pointInTriangle(px, pz, tri) {
    var p = { x: px, z: pz };
    var d1 = cross2(p, tri[0], tri[1]);
    var d2 = cross2(p, tri[1], tri[2]);
    var d3 = cross2(p, tri[2], tri[0]);
    var hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    var hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
}

// 点在凸多边形内判断，同侧法
function pointInConvexPoly(px, pz, verts) {
    var n = verts.length;
    var p = { x: px, z: pz };
    var sign = null;
    for (var i = 0; i < n; i++) {
        var a = verts[i], b = verts[(i + 1) % n];
        var c = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
        if (Math.abs(c) < 1e-9) continue;
        var s = c > 0 ? 1 : -1;
        if (sign == null) sign = s;
        else if (sign !== s) return false;
    }
    return true;
}

// 形状包围盒局部范围，玩家坐标为原点
function shapeMinMax(shape, params) {
    if (shape === 'circle') {
        var r = params.outerR;
        return { minX: -r, maxX: r, minY: 0, maxY: 0, minZ: -r, maxZ: r };
    }
    if (shape === 'cylinder') {
        var r2 = params.outerR, hy = Math.floor(params.height / 2);
        return { minX: -r2, maxX: r2, minY: -hy, maxY: params.height - 1 - hy, minZ: -r2, maxZ: r2 };
    }
    if (shape === 'sphere') {
        var r3 = params.outerR;
        return { minX: -r3, maxX: r3, minY: -r3, maxY: r3, minZ: -r3, maxZ: r3 };
    }
    if (shape === 'box') {
        var l = params.len, w = params.wid, he = params.hei;
        var lx = Math.floor(l / 2), wx = Math.floor(w / 2), hx = Math.floor(he / 2);
        return { minX: -lx, maxX: l - 1 - lx, minY: -hx, maxY: he - 1 - hx, minZ: -wx, maxZ: w - 1 - wx };
    }
    if (shape === 'prism') {
        var tv = params.tri;
        var minx = Math.min(tv[0].x, tv[1].x, tv[2].x), maxx = Math.max(tv[0].x, tv[1].x, tv[2].x);
        var minz = Math.min(tv[0].z, tv[1].z, tv[2].z), maxz = Math.max(tv[0].z, tv[1].z, tv[2].z);
        var hy2 = Math.floor(params.height / 2);
        return { minX: Math.floor(minx) - 1, maxX: Math.ceil(maxx) + 1, minY: -hy2, maxY: params.height - 1 - hy2, minZ: Math.floor(minz) - 1, maxZ: Math.ceil(maxz) + 1 };
    }
    if (shape === 'poly') {
        var rp = params.edge / (2 * Math.sin(Math.PI / params.faces));
        var hy3 = Math.floor(params.edge / 2);
        return { minX: Math.floor(-rp) - 1, maxX: Math.ceil(rp) + 1, minY: -hy3, maxY: params.edge - 1 - hy3, minZ: Math.floor(-rp) - 1, maxZ: Math.ceil(rp) + 1 };
    }
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
}

// 判断局部坐标是否在形状内
function insideShape(shape, params, dx, dy, dz) {
    if (shape === 'circle' || shape === 'cylinder') {
        var d2 = dx * dx + dz * dz;
        if (d2 > params.outerR * params.outerR) return false;
        if (params.innerR > 0 && d2 <= params.innerR * params.innerR) return false;
        return true;
    }
    if (shape === 'sphere') {
        var s2 = dx * dx + dy * dy + dz * dz;
        if (s2 > params.outerR * params.outerR) return false;
        if (params.innerR > 0 && s2 <= params.innerR * params.innerR) return false;
        return true;
    }
    if (shape === 'box') {
        if (params.hollow) {
            var lx = Math.floor(params.inLen / 2), wx = Math.floor(params.inWid / 2), hx = Math.floor(params.inHei / 2);
            if (dx >= -lx && dx <= params.inLen - 1 - lx && dz >= -wx && dz <= params.inWid - 1 - wx && dy >= -hx && dy <= params.inHei - 1 - hx) return false;
        }
        return true;
    }
    if (shape === 'prism') return pointInTriangle(dx, dz, params.tri);
    if (shape === 'poly') return pointInConvexPoly(dx, dz, params.verts);
    return false;
}

// 形状显示名
function shapeDisplayName(lang, shape) {
    var keys = {
        circle: 'quick_build.assistant_shape_circle',
        cylinder: 'quick_build.assistant_shape_cylinder',
        sphere: 'quick_build.assistant_shape_sphere',
        box: 'quick_build.assistant_shape_box',
        prism: 'quick_build.assistant_shape_prism',
        poly: 'quick_build.assistant_shape_poly'
    };
    return t(lang, keys[shape] || keys.circle);
}

// 生成形状，快照后分批放置，完成可撤回
function generateShape(player, shape, blockName, params, snapshot) {
    var xuid = player.xuid;
    var lang = getLocale(xuid);
    var dimid = (player.pos && typeof player.pos.dimid !== 'undefined') ? player.pos.dimid : 0;
    var cx = params.cx, cy = params.cy, cz = params.cz;
    var mm = shapeMinMax(shape, params);
    var minPos = { x: cx + mm.minX, y: cy + mm.minY, z: cz + mm.minZ };
    var maxPos = { x: cx + mm.maxX, y: cy + mm.maxY, z: cz + mm.maxZ };
    var count = 0;
    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);
    player.tell(t(lang, 'quick_build.assistant_shape_generating', shapeDisplayName(lang, shape)));
    startImportWithSnapshot(player, snapshot, minPos, maxPos, dimid, function() {
        var sx = mm.maxX - mm.minX + 1, sy = mm.maxY - mm.minY + 1, sz = mm.maxZ - mm.minZ + 1;
        var total = sx * sy * sz;
        var i = 0;
        function batch() {
            var end = Math.min(i + ASSISTANT_BATCH_SIZE, total);
            for (; i < end; i++) {
                var ly = Math.floor(i / (sx * sz));
                var rr = i - ly * (sx * sz);
                var lz = Math.floor(rr / sx);
                var lx = rr - lz * sx;
                var dx = mm.minX + lx, dy = mm.minY + ly, dz = mm.minZ + lz;
                if (insideShape(shape, params, dx, dy, dz)) {
                    try { mc.setBlock(cx + dx, cy + dy, cz + dz, dimid, blockName, 0); count++; } catch (e) { }
                }
            }
            var pct = Math.floor((i / total) * 100);
            assistantSetBossBar(player, t(lang, 'quick_build.assistant_shape_progress', String(pct)), pct);
            updateTaskAnim(player, i, total);
            if (i < total) setTimeout(batch, 0);
            else finish();
        }
        batch();
    });

    function finish() {
        assistantRemoveBossBar(player);
        stopTaskAnim(player);
        releaseTaskLock(player);
        player.tell(t(lang, 'quick_build.assistant_shape_success', String(count)));
    }
}

// 索引编码：i = x + sx * (z + sz * y)
function exportStructure(player, minPos, maxPos, dimid, name) {
    var lang = getLocale(player.xuid);
    var sx = maxPos.x - minPos.x + 1, sy = maxPos.y - minPos.y + 1, sz = maxPos.z - minPos.z + 1;
    var total = sx * sy * sz;
    var palette = [{ name: 'minecraft:air', aux: 0, snbt: '' }];
    var paletteMap = {};
    var blocks = new Array(total);
    var tileEntities = [];
    var count = 0;
    var i = 0;
    var plane = sx * sz;

    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);
    player.tell(t(lang, 'quick_build.assistant_exporting', String(sx), String(sy), String(sz), String(total)));
    assistantSetBossBar(player, t(lang, 'quick_build.assistant_export_progress', '0'), 0);

    function batch() {
        var end = Math.min(i + ASSISTANT_BATCH_SIZE, total);
        for (; i < end; i++) {
            var y = Math.floor(i / plane);
            var r = i - y * plane;
            var z = Math.floor(r / sx);
            var x = r - z * sx;
            var wx = minPos.x + x, wy = minPos.y + y, wz = minPos.z + z;
            var b = null;
            try { b = mc.getBlock(wx, wy, wz, dimid); } catch (e) { b = null; }
            if (!b || !b.type || b.type === 'minecraft:air') {
                blocks[i] = 0;
                continue;
            }
            var aux = 0;
            try { aux = (typeof b.tileData !== 'undefined' ? b.tileData : (typeof b.aux !== 'undefined' ? b.aux : 0)); } catch (e) { aux = 0; }
            var hasBE = true;
            try { if (typeof b.hasBlockEntity === 'function') hasBE = b.hasBlockEntity(); } catch (e) { hasBE = true; }
            var snbt = '';
            var key;
            if (hasBE) {
                try { snbt = b.getNbt().toSNBT(); } catch (e) { snbt = ''; }
                key = snbt || ('__fail__' + b.type + '__' + aux);
            } else {
                key = '__plain__' + b.type + '__' + aux;
            }
            var idx = paletteMap[key];
            if (idx == null) {
                idx = palette.length;
                paletteMap[key] = idx;
                palette.push({ name: b.type, aux: aux, snbt: snbt });
            }
            blocks[i] = idx;
            count++;
            if (hasBE) {
                try {
                    var be = mc.getBlockEntity(wx, wy, wz, dimid);
                    if (be) {
                        var beSnbt = be.getNbt().toSNBT();
                        if (beSnbt) tileEntities.push({ x: x, y: y, z: z, snbt: beSnbt });
                    }
                } catch (e) { }
            }
        }
        var pct = Math.floor((i / total) * 100);
        assistantSetBossBar(player, t(lang, 'quick_build.assistant_export_progress', String(pct)), pct);
        updateTaskAnim(player, i, total);
        if (i < total) {
            setTimeout(batch, 0);
        } else {
            try {
                var data = {
                    version: 1,
                    dimid: dimid,
                    size: { x: sx, y: sy, z: sz },
                    origin: { x: minPos.x, y: minPos.y, z: minPos.z },
                    palette: palette,
                    blocks: blocks,
                    tileEntities: tileEntities
                };
                var filePath = path.join(getStructureDir(), name + '.nbt');
                var gz = zlib.gzipSync(Buffer.from(JSON.stringify(data), 'utf-8'));
                fs.writeFileSync(filePath, gz);
                assistantRemoveBossBar(player);
                stopTaskAnim(player);
                releaseTaskLock(player);
                player.tell(t(lang, 'quick_build.assistant_export_success', name, String(count), String(tileEntities.length), String(palette.length - 1)));
            } catch (e) {
                assistantRemoveBossBar(player);
                stopTaskAnim(player);
                releaseTaskLock(player);
                logger.error('[block] 导出失败: ' + e.message);
                player.tell(t(lang, 'quick_build.assistant_export_failed', e.message));
            }
        }
    }

    batch();
}

// ==================== .mcstructure 导入支持（基岩版原生结构格式）====================
// .mcstructure 是基岩版结构方块导出的原生格式，为小端序二进制 NBT（可能 gzip 压缩）。
// 方块名与状态已是基岩版原生格式（minecraft:xxx + states 复合标签），无需 Java→基岩跨版本映射。
// block_indices 为平坦 Int 数组（-1 表示空气），无 Litematica 的 LongArray 位打包。
// 下面实现：① 小端序 NBT 解析器；② NBT→SNBT 序列化（方块实体复用）；③ 基岩版 states→aux 尽力映射；④ 导入主流程。

var NBT_TAG = { End:0, Byte:1, Short:2, Int:3, Long:4, Float:5, Double:6, ByteArray:7, String:8, List:9, Compound:10, IntArray:11, LongArray:12 };

// 小端序 NBT 读取器（基岩版 .mcstructure 使用小端序，与 Java 版大端序 NBT 不同）
function LeNbtReader(buf) { this.buf = buf; this.pos = 0; }
LeNbtReader.prototype.byte = function(){ return this.buf[this.pos++]; };
LeNbtReader.prototype.short = function(){ var v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; };
LeNbtReader.prototype.ushort = function(){ var v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; };
LeNbtReader.prototype.int = function(){ var v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; };
LeNbtReader.prototype.long = function(){ var v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return v; };
LeNbtReader.prototype.float = function(){ var v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; };
LeNbtReader.prototype.double = function(){ var v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; };
LeNbtReader.prototype.string = function(){ var len = this.ushort(); var s = this.buf.toString('utf8', this.pos, this.pos + len); this.pos += len; return s; };
LeNbtReader.prototype.byteArray = function(){ var len = this.int(); var b = this.buf.slice(this.pos, this.pos + len); this.pos += len; return b; };
LeNbtReader.prototype.intArray = function(){ var len = this.int(); var a = new Array(len); for (var i = 0; i < len; i++) a[i] = this.int(); return a; };
LeNbtReader.prototype.longArray = function(){ var len = this.int(); var a = new Array(len); for (var i = 0; i < len; i++) a[i] = this.long(); return a; };

// 读取单个 NBT 载荷为节点 { t: 标签类型, v: 值 }
//   标量 v 为 number/BigInt/string/Buffer；Compound v 为 {key:node}；List v 为 [node...]；
//   IntArray v 为 number[]；LongArray v 为 BigInt[]；ByteArray v 为 Buffer。
function leNbtReadPayload(r, type) {
    switch (type) {
        case NBT_TAG.Byte: return { t: type, v: r.byte() };
        case NBT_TAG.Short: return { t: type, v: r.short() };
        case NBT_TAG.Int: return { t: type, v: r.int() };
        case NBT_TAG.Long: return { t: type, v: r.long() };
        case NBT_TAG.Float: return { t: type, v: r.float() };
        case NBT_TAG.Double: return { t: type, v: r.double() };
        case NBT_TAG.ByteArray: return { t: type, v: r.byteArray() };
        case NBT_TAG.String: return { t: type, v: r.string() };
        case NBT_TAG.List: {
            var et = r.byte(); var len = r.int(); var arr = new Array(len);
            for (var i = 0; i < len; i++) arr[i] = leNbtReadPayload(r, et);
            return { t: type, v: arr };
        }
        case NBT_TAG.Compound: {
            var obj = {};
            while (true) {
                var tt = r.byte();
                if (tt === NBT_TAG.End) break;
                var name = r.string();
                obj[name] = leNbtReadPayload(r, tt);
            }
            return { t: type, v: obj };
        }
        case NBT_TAG.IntArray: return { t: type, v: r.intArray() };
        case NBT_TAG.LongArray: return { t: type, v: r.longArray() };
    }
    return null;
}

// 解析整棵小端序 NBT（已解压的 buffer），返回根 Compound 节点；解析失败返回 null
function leNbtParse(buf) {
    try {
        var r = new LeNbtReader(buf);
        var rootType = r.byte();
        if (rootType !== NBT_TAG.Compound) return null;       // .mcstructure 根必为 Compound
        var rootName = r.string();                            // 根名字段（忽略）
        return leNbtReadPayload(r, rootType);
    } catch (e) { return null; }
}

// 节点访问助手：同时接受节点 {t,v} 与已解包的复合对象（普通 {key:node}），避免 nbtCompound 解包后无法再 nbtGet
function nbtGet(compNode, key) {
    if (!compNode) return null;
    var v = (compNode.t !== undefined) ? compNode.v : compNode;
    return (v && v[key]) ? v[key] : null;
}
function nbtStr(node) { return node ? String(node.v) : ''; }
function nbtInt(node) { return node ? Number(node.v) : 0; }
function nbtCompound(node) { return (node && node.t === NBT_TAG.Compound) ? node.v : null; }
function nbtList(node) { return (node && node.t === NBT_TAG.List) ? node.v : null; }

// 从 List[Int] 或 IntArray 节点读取指定位置的 int 值
// .mcstructure 的 size 与 block_indices 可能是 List[Int] 或 IntArray，统一处理
function nbtArrInt(node, idx) {
    if (!node) return 0;
    if (node.t === NBT_TAG.List) {
        var arr = node.v;
        return (arr && idx < arr.length && arr[idx]) ? Number(arr[idx].v) : 0;
    }
    if (node.t === NBT_TAG.IntArray) {
        return (idx < node.v.length) ? node.v[idx] : 0;
    }
    return 0;
}

// 将 NBT 节点序列化为 SNBT 字符串（用于把 .mcstructure 中的方块实体喂给 NBT.parseSNBT + setNbt）
function nbtToSnbt(node) {
    if (!node) return 'null';
    switch (node.t) {
        case NBT_TAG.Byte: return node.v + 'b';
        case NBT_TAG.Short: return node.v + 's';
        case NBT_TAG.Int: return String(node.v);
        case NBT_TAG.Long: return node.v.toString() + 'L';
        case NBT_TAG.Float: return node.v + 'f';
        case NBT_TAG.Double: return node.v + 'd';
        case NBT_TAG.ByteArray: {
            var b = node.v; var ps = [];
            for (var i = 0; i < b.length; i++) ps.push(b[i] + 'B');
            return '[B;' + ps.join(',') + ']';
        }
        case NBT_TAG.String: return '"' + String(node.v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        case NBT_TAG.List: {
            var items = node.v; var ls = [];
            for (var k = 0; k < items.length; k++) ls.push(nbtToSnbt(items[k]));
            return '[' + ls.join(',') + ']';
        }
        case NBT_TAG.Compound: {
            var o = node.v; var ks = Object.keys(o); var cs = [];
            for (var m = 0; m < ks.length; m++) cs.push('"' + ks[m] + '":' + nbtToSnbt(o[ks[m]]));
            return '{' + cs.join(',') + '}';
        }
        case NBT_TAG.IntArray: {
            var ia = node.v; var ip = [];
            for (var n = 0; n < ia.length; n++) ip.push(String(ia[n]));
            return '[I;' + ip.join(',') + ']';
        }
        case NBT_TAG.LongArray: {
            var la = node.v; var lp = [];
            for (var q = 0; q < la.length; q++) lp.push(la[q].toString() + 'L');
            return '[L;' + lp.join(',') + ']';
        }
    }
    return 'null';
}

// 字符串状态到 aux 的映射常量（依据微软官方 Aux Value to Block State Map）
var _AUX_CARDINAL = { south: 0, west: 1, north: 2, east: 3 };
var _AUX_FACING = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
var _AUX_LEVER = { down_east_west: 0, east: 1, west: 2, south: 3, north: 4, up_north_south: 5, up_east_west: 6, down_north_south: 7 };
var _AUX_TORCH = { unknown: 0, west: 1, east: 2, north: 3, south: 4, top: 5 };
var _AUX_STRUCTURE_TYPE = { save: 0, load: 1, corner: 2, data: 3, export: 4 };

// 将基岩版方块状态（states 复合标签）转换为 aux 数值（setBlock 的 data 值）
// 兼容旧格式 int 状态（direction/facing_direction/upside_down_bit）与
// 1.21.40+ 新格式字符串状态（minecraft:cardinal_direction/minecraft:facing_direction/minecraft:vertical_half）
function mapBedrockStatesToAux(name, statesNode) {
    if (!statesNode) return 0;
    var states = nbtCompound(statesNode);
    if (!states) return 0;
    var aux = 0;
    var shortName = name.indexOf(':') >= 0 ? name.slice(name.indexOf(':') + 1) : name;

    function stv(key) { var node = nbtGet(states, key); return node ? node.v : null; }
    function stb(key) { var v = stv(key); return v === true || v === 1 || v === '1' || v === 'true'; }
    function sti(key) { var v = stv(key); return typeof v === 'number' ? v : 0; }
    function sts(key) { var v = stv(key); return typeof v === 'string' ? v : ''; }

    // 横向朝向：旧 int direction/weirdo_direction，新字符串 minecraft:cardinal_direction
    function getDir() {
        if (stv('direction') !== null) return sti('direction');
        if (stv('weirdo_direction') !== null) return sti('weirdo_direction');
        var cd = sts('minecraft:cardinal_direction');
        return _AUX_CARDINAL[cd] || 0;
    }

    // 六向朝向：旧 int facing_direction，新字符串 minecraft:facing_direction
    function getFacing() {
        if (stv('facing_direction') !== null) return sti('facing_direction');
        var fd = sts('minecraft:facing_direction');
        return _AUX_FACING[fd] || 0;
    }

    // 倒置：旧 upside_down_bit，新字符串 minecraft:vertical_half
    function isUpsideDown() {
        if (stv('upside_down_bit') !== null) return stb('upside_down_bit');
        return sts('minecraft:vertical_half') === 'top';
    }

    // 楼梯：direction + 4*倒置
    if (shortName.endsWith('_stairs')) {
        aux = getDir() + (isUpsideDown() ? 4 : 0);
    }
    // 门：direction + 4*open + 8*upper，door_hinge_bit 无法编码在 aux 中，忽略
    else if (shortName.endsWith('_door')) {
        aux = getDir() + (stb('open_bit') ? 4 : 0) + (stb('upper_block_bit') ? 8 : 0);
    }
    // 栅栏门：direction + 4*open + 8*in_wall
    else if (shortName.endsWith('_fence_gate')) {
        aux = getDir() + (stb('open_bit') ? 4 : 0) + (stb('in_wall_bit') ? 8 : 0);
    }
    // 活板门：direction + 4*倒置 + 8*open
    else if (shortName.endsWith('_trapdoor')) {
        aux = getDir() + (isUpsideDown() ? 4 : 0) + (stb('open_bit') ? 8 : 0);
    }
    // 床：direction + 8*head，occupied_bit 忽略
    else if (shortName.endsWith('_bed')) {
        aux = getDir() + (stb('head_piece_bit') ? 8 : 0);
    }
    // 拉杆：lever_direction 字符串映射 + 8*open
    else if (shortName === 'lever') {
        if (stv('lever_direction') !== null) aux = _AUX_LEVER[sts('lever_direction')] || 0;
        else if (stv('facing_direction') !== null) aux = sti('facing_direction');
        if (stb('open_bit')) aux += 8;
    }
    // 按钮：facing + 8*pressed
    else if (shortName.endsWith('_button')) {
        aux = getFacing() + (stb('button_pressed_bit') ? 8 : 0);
    }
    // 火把：torch_facing_direction 字符串映射
    else if (shortName === 'torch' || shortName === 'wall_torch' || shortName === 'redstone_torch' || shortName === 'redstone_wall_torch' || shortName === 'soul_torch' || shortName === 'soul_wall_torch') {
        if (stv('torch_facing_direction') !== null) aux = _AUX_TORCH[sts('torch_facing_direction')] || 0;
        else if (stv('facing_direction') !== null) aux = sti('facing_direction');
    }
    // 六向 facing 方块：观察者/活塞/潜影盒/桶/发射器/投掷器/熔炉等
    else if (shortName === 'observer' || shortName.endsWith('_piston') || shortName.endsWith('_shulker_box') || shortName === 'barrel' || shortName === 'dropper' || shortName === 'dispenser' || shortName === 'furnace' || shortName === 'blast_furnace' || shortName === 'smoker') {
        aux = getFacing();
        if (shortName === 'observer' && stb('powered_bit')) aux += 8;
        else if (shortName === 'barrel' && stb('open_bit')) aux += 8;
        else if ((shortName === 'dropper' || shortName === 'dispenser') && stb('triggered_bit')) aux += 8;
    }
    // 铁砧：cardinal_direction
    else if (shortName === 'anvil') {
        aux = getDir();
    }
    // 原木/木头/菌柄/玄武岩/锁链：pillar_axis（0=y, 1=x, 2=z）
    else if (shortName.endsWith('_log') || shortName.endsWith('_wood') || shortName.endsWith('_stem') || shortName === 'basalt' || shortName === 'chain') {
        var axis = sts('pillar_axis');
        if (axis === 'x') aux = 1;
        else if (axis === 'z') aux = 2;
    }
    // 墙上的告示牌/横幅：facing
    else if (shortName.endsWith('_wall_sign') || shortName.endsWith('_wall_banner')) {
        aux = getFacing();
    }
    // 立式告示牌：ground_sign_direction
    else if (shortName.endsWith('_standing_sign')) {
        aux = sti('ground_sign_direction');
    }
    // 铁轨：rail_direction + 8*rail_data
    else if (shortName === 'rail' || shortName.endsWith('_rail')) {
        aux = sti('rail_direction') + (stb('rail_data_bit') ? 8 : 0);
    }
    // 树叶：persistent_bit → aux 1
    else if (shortName === 'leaves' || shortName.endsWith('_leaves')) {
        if (stb('persistent_bit')) aux = 1;
    }
    // 甘蔗/仙人掌：age
    else if (shortName === 'sugar_cane' || shortName === 'cactus') {
        aux = sti('age');
    }
    // 竹子：8*age_bit + 叶大小(0-2) + 粗(1)
    else if (shortName === 'bamboo') {
        var leaf = sts('bamboo_leaf_size');
        var leafIdx = leaf === 'large_leaves' ? 2 : (leaf === 'small_leaves' ? 1 : 0);
        aux = (stb('age_bit') ? 8 : 0) + leafIdx + (sts('bamboo_stalk_thickness') === 'thick' ? 1 : 0);
    }
    else if (shortName === 'bamboo_sapling') {
        aux = stb('age_bit') ? 1 : 0;
    }
    // 耕地：moisturized_amount
    else if (shortName === 'farmland') {
        aux = sti('moisturized_amount');
    }
    // 藤蔓：vine_direction_bits
    else if (shortName === 'vine') {
        aux = sti('vine_direction_bits');
    }
    // 可可豆：direction + 4*age
    else if (shortName === 'cocoa') {
        aux = sti('direction') + sti('age') * 4;
    }
    // 农作物：growth
    else if (shortName === 'wheat' || shortName === 'carrots' || shortName === 'potatoes' || shortName === 'beetroot') {
        aux = sti('growth');
    }
    // 双格植物：8*upper
    else if (shortName === 'peony' || shortName === 'lilac' || shortName === 'rose_bush' || shortName === 'sunflower' || shortName === 'tall_grass' || shortName === 'large_fern' || shortName === 'pitcher_plant') {
        aux = stb('upper_block_bit') ? 8 : 0;
    }
    // 结构方块：structure_block_type
    else if (shortName === 'structure_block') {
        var stt = sts('structure_block_type');
        if (stt && _AUX_STRUCTURE_TYPE[stt] !== undefined) aux = _AUX_STRUCTURE_TYPE[stt];
    }
    return aux;
}

// 导入 .mcstructure：基岩版原生结构格式，解析方块调色板与 block_indices，按坐标平移导入
function importMcStructure(player, filename, ox, oy, oz, rotate, mirrorX, mirrorZ, snapshot) {
    var lang = getLocale(player.xuid);
    var filePath = path.join(getStructureDir(), filename);
    var raw;
    try { raw = fs.readFileSync(filePath); } catch (e) {
        player.tell(t(lang, 'quick_build.assistant_read_failed', e.message));
        return;
    }
    var unz;
    try { unz = zlib.gunzipSync(raw); } catch (e) { unz = raw; }   // 非压缩时直接用原始 buffer
    var root = leNbtParse(unz);
    if (!root || root.t !== NBT_TAG.Compound) {
        player.tell(t(lang, 'quick_build.assistant_mcstructure_bad'));
        return;
    }

    // size: List[Int] 或 IntArray → [sx, sy, sz]（基岩版结构方块尺寸全为正，无负尺寸问题）
    var sizeNode = nbtGet(root, 'size');
    if (!sizeNode) { player.tell(t(lang, 'quick_build.assistant_mcstructure_bad')); return; }
    var sx = nbtArrInt(sizeNode, 0), sy = nbtArrInt(sizeNode, 1), sz = nbtArrInt(sizeNode, 2);
    var total = sx * sy * sz;
    if (total <= 0) { player.tell(t(lang, 'quick_build.assistant_mcstructure_bad')); return; }

    // structure.palette.default.block_palette: List[Compound] of {name, states, version}
    var structure = nbtCompound(nbtGet(root, 'structure'));
    if (!structure) { player.tell(t(lang, 'quick_build.assistant_mcstructure_bad')); return; }
    var paletteComp = nbtCompound(nbtGet(structure, 'palette'));
    if (!paletteComp) { player.tell(t(lang, 'quick_build.assistant_mcstructure_bad')); return; }
    var defaultPalette = nbtCompound(nbtGet(paletteComp, 'default'));
    if (!defaultPalette) { player.tell(t(lang, 'quick_build.assistant_mcstructure_bad')); return; }
    var blockPalette = nbtList(nbtGet(defaultPalette, 'block_palette')) || [];

    // block_indices: List[List[Int]]，第一层为方块层（-1 表示空气）
    var blockIndices = nbtList(nbtGet(structure, 'block_indices'));
    if (!blockIndices || blockIndices.length === 0) {
        player.tell(t(lang, 'quick_build.assistant_mcstructure_bad'));
        return;
    }
    var blockLayerNode = blockIndices[0];

    // block_position_data: Compound，键为平坦索引（字符串），值为方块实体数据
    var blockPosData = nbtCompound(nbtGet(defaultPalette, 'block_position_data')) || {};

    var dimid = (player.pos && typeof player.pos.dimid !== 'undefined') ? player.pos.dimid : 0;

    // 变换后的最终尺寸（旋转会交换 x/z）
    var rmod = ((rotate || 0) % 360 + 360) % 360;
    var nsx = (rmod === 90 || rmod === 270) ? sz : sx;
    var nsz = (rmod === 90 || rmod === 270) ? sx : sz;

    // 基岩版 .mcstructure 平坦索引顺序：z 最快、y 中间、x 最慢，i = z + sz*(y + sy*x)
    // 与自定义 .nbt 格式的 x 最快顺序不同，不能用 plane 解码
    var blockOps = [];
    var teOps = [];
    for (var i = 0; i < total; i++) {
        var zz = i % sz;
        var rest = Math.floor(i / sz);
        var yy = rest % sy;
        var xx = Math.floor(rest / sy);
        var tc = transformLocalCoord(xx, zz, sx, sz, rotate, mirrorX, mirrorZ);
        var wx = ox + tc.x, wy = oy + yy, wz = oz + tc.z;

        var pi = nbtArrInt(blockLayerNode, i);
        var bname = 'minecraft:air', baux = 0;
        if (pi >= 0 && pi < blockPalette.length) {
            var pe = nbtCompound(blockPalette[pi]);
            bname = nbtStr(nbtGet(pe, 'name')) || nbtStr(nbtGet(pe, 'Name')) || 'minecraft:air';
            if (bname !== 'minecraft:air') {
                baux = mapBedrockStatesToAux(bname, nbtGet(pe, 'states'));
            }
        }
        blockOps.push({ wx: wx, wy: wy, wz: wz, name: bname, aux: baux });

        // 检查是否有方块实体数据（block_position_data 以平坦索引为键）
        var posData = nbtGet(blockPosData, String(i));
        if (posData) {
            teOps.push({ wx: wx, wy: wy, wz: wz, node: posData });
        }
    }

    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);
    player.tell(t(lang, 'quick_build.assistant_importing', filename, String(nsx), String(sy), String(nsz), String(total), String(ox), String(oy), String(oz)));
    assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_progress', '0'), 0);

    var i2 = 0;
    var totalBlocks = blockOps.length;
    function batch() {
        var end = Math.min(i2 + ASSISTANT_BATCH_SIZE, totalBlocks);
        for (; i2 < end; i2++) {
            var op = blockOps[i2];
            try { mc.setBlock(op.wx, op.wy, op.wz, dimid, op.name, op.aux || 0); } catch (e) { }
        }
        var pct = totalBlocks > 0 ? Math.floor((i2 / totalBlocks) * 100) : 100;
        assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_progress', String(pct)), pct);
        updateTaskAnim(player, i2, totalBlocks);
        if (i2 < totalBlocks) setTimeout(batch, 0);
        else importTileEntities();
    }
    function importTileEntities() {
        var j = 0, teTotal = teOps.length;
        if (teTotal === 0) {
            assistantRemoveBossBar(player);
            stopTaskAnim(player);
            releaseTaskLock(player);
            player.tell(t(lang, 'quick_build.assistant_import_success_no_te', filename, String(totalBlocks)));
            return;
        }
        function teBatch() {
            var end = Math.min(j + ASSISTANT_BATCH_SIZE, teTotal);
            for (; j < end; j++) {
                var op = teOps[j];
                try {
                    var be = mc.getBlockEntity(op.wx, op.wy, op.wz, dimid);
                    if (be) {
                        // 从 block_position_data 提取方块实体 NBT（尝试常见字段名）
                        var teNode = nbtGet(op.node, 'block_entity_data') || nbtGet(op.node, 'block_traits') || op.node;
                        be.setNbt(NBT.parseSNBT(nbtToSnbt(teNode)));
                    }
                } catch (e) { }
            }
            var pct = Math.floor((j / teTotal) * 100);
            assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_te_progress', String(pct)), pct);
            updateTaskAnim(player, j, teTotal);
            if (j < teTotal) setTimeout(teBatch, 0);
            else {
                assistantRemoveBossBar(player);
                stopTaskAnim(player);
                releaseTaskLock(player);
                player.tell(t(lang, 'quick_build.assistant_import_success', filename, String(totalBlocks), String(teTotal)));
            }
        }
        teBatch();
    }
    startImportWithSnapshot(player, snapshot, { x: ox, y: oy, z: oz }, { x: ox + nsx - 1, y: oy + sy - 1, z: oz + nsz - 1 }, dimid, function() { batch(); });
}

// 有快照时先异步保存目标区域，保存完成后再开始导入；无快照直接导入
function startImportWithSnapshot(player, snapshot, minPos, maxPos, dimid, startImportFn) {
    var lang = getLocale(player.xuid);
    if (!snapshot) {
        startImportFn();
        return;
    }
    saveSnapshotRegion(player, minPos, maxPos, dimid, null, 'quick_build.assistant_snapshot_progress', function(snapFile) {
        var nsx = maxPos.x - minPos.x + 1;
        var sy = maxPos.y - minPos.y + 1;
        var nsz = maxPos.z - minPos.z + 1;
        if (snapFile) {
            _assistantSnapshots[player.xuid] = {
                file: snapFile,
                dimid: dimid,
                minX: minPos.x, minY: minPos.y, minZ: minPos.z,
                maxX: maxPos.x, maxY: maxPos.y, maxZ: maxPos.z,
                total: nsx * sy * nsz
            };
            player.tell(t(lang, 'quick_build.assistant_snapshot_created', String(nsx * sy * nsz)));
        }
        startImportFn();
    });
}

// 局部坐标变换：先镜像再绕Y轴顺时针旋转，返回新局部坐标与变换后尺寸
function transformLocalCoord(lx, lz, sx, sz, rotate, mirrorX, mirrorZ) {
    var nx = lx, nz = lz;
    if (mirrorX) nx = (sx - 1) - nx;
    if (mirrorZ) nz = (sz - 1) - nz;
    var r = ((rotate || 0) % 360 + 360) % 360;
    var nsx = sx, nsz = sz;
    var tx, tz;
    if (r === 90) { tx = nz; tz = sx - 1 - nx; nsx = sz; nsz = sx; }
    else if (r === 180) { tx = sx - 1 - nx; tz = sz - 1 - nz; }
    else if (r === 270) { tx = sz - 1 - nz; tz = nx; nsx = sz; nsz = sx; }
    else { tx = nx; tz = nz; }
    return { x: tx, z: tz, sx: nsx, sz: nsz };
}

// 按扩展名分发：.mcstructure → 基岩版原生结构导入；其余 → 自定义 .nbt（gzip JSON）导入
function importStructureDispatch(player, filename, x, y, z, rotate, mirrorX, mirrorZ, snapshot) {
    var ln = filename.toLowerCase();
    if (ln.endsWith('.mcstructure')) {
        importMcStructure(player, filename, x, y, z, rotate, mirrorX, mirrorZ, snapshot);
    } else {
        importStructure(player, filename, x, y, z, rotate, mirrorX, mirrorZ, snapshot);
    }
}

function importStructure(player, filename, ox, oy, oz, rotate, mirrorX, mirrorZ, snapshot) {
    var lang = getLocale(player.xuid);
    var filePath = path.join(getStructureDir(), filename);
    var raw;
    try { raw = fs.readFileSync(filePath); } catch (e) {
        player.tell(t(lang, 'quick_build.assistant_read_failed', e.message));
        return;
    }
    var data;
    try {
        data = JSON.parse(zlib.gunzipSync(raw).toString('utf-8'));
    } catch (e) {
        try { data = JSON.parse(raw.toString('utf-8')); } catch (e2) {
            player.tell(t(lang, 'quick_build.assistant_parse_failed', e.message));
            return;
        }
    }

    var sx = data.size.x, sy = data.size.y, sz = data.size.z;
    var total = sx * sy * sz;
    var palette = data.palette || [{ name: 'minecraft:air', aux: 0, snbt: '' }];
    var blocks = data.blocks || [];
    var tileEntities = data.tileEntities || [];
    var dimid = (player.pos && typeof player.pos.dimid !== 'undefined') ? player.pos.dimid : (data.dimid || 0);
    var plane = sx * sz;
    // 变换后的最终尺寸（旋转会交换 x/z）
    var nsx = ((rotate % 360 + 360) % 360 === 90 || (rotate % 360 + 360) % 360 === 270) ? sz : sx;
    var nsz = ((rotate % 360 + 360) % 360 === 90 || (rotate % 360 + 360) % 360 === 270) ? sx : sz;
    var i = 0;

    if (!acquireTaskLock(player)) return;
    startTaskAnim(player);
    player.tell(t(lang, 'quick_build.assistant_importing', filename, String(nsx), String(sy), String(nsz), String(total), String(ox), String(oy), String(oz)));
    assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_progress', '0'), 0);

    function batch() {
        var end = Math.min(i + ASSISTANT_BATCH_SIZE, total);
        for (; i < end; i++) {
            var y = Math.floor(i / plane);
            var r = i - y * plane;
            var z = Math.floor(r / sx);
            var x = r - z * sx;
            var tc = transformLocalCoord(x, z, sx, sz, rotate, mirrorX, mirrorZ);
            var wx = ox + tc.x, wy = oy + y, wz = oz + tc.z;
            var entry = palette[blocks[i]] || palette[0];
            var bname = entry.name || 'minecraft:air';
            if (bname === 'minecraft:air') {
                try { mc.setBlock(wx, wy, wz, dimid, 'minecraft:air', 0); } catch (e) { }
                continue;
            }
            try {
                mc.setBlock(wx, wy, wz, dimid, bname, entry.aux || 0);
                if (entry.snbt) {
                    var nb = mc.getBlock(wx, wy, wz, dimid);
                    if (nb) nb.setNbt(NBT.parseSNBT(entry.snbt));
                }
            } catch (e) { }
        }
        var pct = Math.floor((i / total) * 100);
        assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_progress', String(pct)), pct);
        updateTaskAnim(player, i, total);
        if (i < total) {
            setTimeout(batch, 0);
        } else {
            importTileEntities();
        }
    }

    function importTileEntities() {
        var j = 0, teTotal = tileEntities.length;
        if (teTotal === 0) {
            assistantRemoveBossBar(player);
            stopTaskAnim(player);
            releaseTaskLock(player);
            player.tell(t(lang, 'quick_build.assistant_import_success_no_te', filename, String(total)));
            return;
        }
        function teBatch() {
            var end = Math.min(j + ASSISTANT_BATCH_SIZE, teTotal);
            for (; j < end; j++) {
                var te = tileEntities[j];
                var tc2 = transformLocalCoord(te.x, te.z, sx, sz, rotate, mirrorX, mirrorZ);
                try {
                    var be = mc.getBlockEntity(ox + tc2.x, oy + te.y, oz + tc2.z, dimid);
                    if (be) be.setNbt(NBT.parseSNBT(te.snbt));
                } catch (e) { }
            }
            var pct = Math.floor((j / teTotal) * 100);
            assistantSetBossBar(player, t(lang, 'quick_build.assistant_import_te_progress', String(pct)), pct);
            updateTaskAnim(player, j, teTotal);
            if (j < teTotal) {
                setTimeout(teBatch, 0);
            } else {
                assistantRemoveBossBar(player);
                stopTaskAnim(player);
                releaseTaskLock(player);
                player.tell(t(lang, 'quick_build.assistant_import_success', filename, String(total), String(teTotal)));
            }
        }
        teBatch();
    }

    startImportWithSnapshot(player, snapshot, { x: ox, y: oy, z: oz }, { x: ox + nsx - 1, y: oy + sy - 1, z: oz + nsz - 1 }, dimid, function() { batch(); });
}

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
    getPlayerPlanData: getPlayerPlanData,
    isQuickBuildEnabled: isQuickBuildEnabled
};
