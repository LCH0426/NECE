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
 * NECE 公会系统
 * 公会创建解散、成员管理、传送点、金库
 */

const database = require('./database');
const teleportModule = require('./teleport');

// 传送冷却记录 { xuid: expireTimestamp }
const guildTpCooldowns = {};

// 申请加入记录 { guildId: [{ xuid, name, time }] }
var _joinRequests = {};

// 公会邀请记录 { targetXuid: [{ guildId, guildName, inviterName, time }] }
var _guildInvites = {};

let logger = null;
let getPlayerMoney = null;       // (player) => number
let addPlayerMoney = null;       // (player, amount) => bool
let reducePlayerMoney = null;    // (player, amount) => bool
let confirmPurchase = null;      // (player, cost, onConfirm, onCancel) => void
let getConfig = null;       // () => guildConfig
let getCurrencyName = null;
let getPlayerName = null;   // (xuid) => name
let getPlayerData = null;   // () => playerData
let mailApi = null;         // 邮件模块
let chatModule = null;      // 聊天模块（用于清除公会名缓存）
let notifyEconomyChange = null;
let _t = null;
let _getLang = null;

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

/** 模块初始化 */
function init(deps) {
    logger = deps.logger || { info: console.log, warn: console.log, error: console.error };
    getPlayerMoney = deps.getPlayerMoney || function() { return 0; };
    addPlayerMoney = deps.addPlayerMoney || function() { return false; };
    reducePlayerMoney = deps.reducePlayerMoney || function() { return false; };
    confirmPurchase = deps.confirmPurchase || null;
    getConfig = deps.getConfig || function() { return {}; };
    getCurrencyName = deps.getCurrencyName || function() { return _t ? _t(getLang(), 'guild.currency_fallback') : '金币'; };
    getPlayerName = deps.getPlayerName || function(xuid) { return xuid; };
    getPlayerData = deps.getPlayerData || function() { return null; };
    mailApi = deps.mailApi || null;
    chatModule = deps.chatModule || null;
    notifyEconomyChange = deps.notifyEconomyChange || function() {};
    _t = deps.t || null;
    _getLang = deps.getSystemLanguage || null;

    // 从数据库加载待处理的申请和邀请
    _loadGuildRequestsFromDB();
    _loadGuildInvitesFromDB();

    // 每10分钟清理超过30分钟的申请和邀请记录
    setInterval(function() {
        database.clearExpiredGuildRequestsSQL(1800000);
        database.clearExpiredGuildInvitesSQL(1800000);
        // 同步清理内存缓存
        _loadGuildRequestsFromDB();
        _loadGuildInvitesFromDB();
    }, 600000);
}

/** 从数据库加载公会申请到内存缓存（单次查询所有数据） */
function _loadGuildRequestsFromDB() {
    _joinRequests = {};
    try {
        var all = database.getAllGuildRequestsSQL ? database.getAllGuildRequestsSQL() : [];
        all.forEach(function(r) {
            if (!_joinRequests[r.guild_id]) _joinRequests[r.guild_id] = [];
            _joinRequests[r.guild_id].push({ xuid: r.xuid, name: r.name, time: r.time });
        });
    } catch (e) {}
}

/** 从数据库加载公会邀请到内存缓存（单次查询所有数据） */
function _loadGuildInvitesFromDB() {
    _guildInvites = {};
    try {
        var all = database.getAllGuildInvitesSQL ? database.getAllGuildInvitesSQL() : [];
        all.forEach(function(r) {
            if (!_guildInvites[r.target_xuid]) _guildInvites[r.target_xuid] = [];
            _guildInvites[r.target_xuid].push({ guildId: r.guild_id, guildName: r.guild_name, inviterName: r.inviter_name, time: r.time });
        });
    } catch (e) {}
}

/** 获取当前公会配置 */
function cfg() {
    return getConfig() || {};
}

/**
 * 显示空值提醒表单（sendModalForm，标题+提示文本+关闭/返回按钮）
 * @param {Player} player - 玩家
 * @param {string} title - 表单标题
 * @param {string} text - 提示文本
 * @param {Function} backFn - 点击返回时调用的函数
 */
function showEmptyTipForm(player, title, text, backFn) {
    player.sendModalForm(title, text, t('guild.back'), t('guild.cancel'), function(p, result) {
        if (result && backFn) backFn(p);
    });
}

/** 发送系统邮件，委托给mailApi.sendSystemMail */
function sendSystemMail(xuid, content) {
    if (mailApi && mailApi.sendSystemMail) mailApi.sendSystemMail(xuid, content);
}

/** 安全传送玩家 */
/** 检查并设置传送冷却 */
function checkCooldown(xuid) {
    var cd = cfg().teleportCooldown !== undefined ? cfg().teleportCooldown : 10;
    if (guildTpCooldowns[xuid]) {
        var remaining = Math.ceil((guildTpCooldowns[xuid] - Date.now()) / 1000);
        if (remaining > 0) return remaining;
    }
    guildTpCooldowns[xuid] = Date.now() + cd * 1000;
    return 0;
}

/** 检查玩家是否为服务器管理员 */
function isServerAdmin(player) {
    try {
        return player.isOP() || player.permLevel >= 1;
    } catch (e) {
        return false;
    }
}

/**
 * 获取玩家在指定公会中的有效角色
 * 服务器管理员自动视为 owner 权限
 */
function getEffectiveRole(player, guild) {
    if (isServerAdmin(player)) return 'owner';
    return database.getMemberRole(String(player.xuid)) || 'member';
}

// ==================== 命令入口 ====================

/** 公会命令主入口 - 直接打开GUI */
function handleCommand(player, args) {
    showMainMenu(player);
}

// ==================== 核心逻辑 ====================

/** 创建公会 */
function doCreateGuild(player, name, description) {
    var xuid = String(player.xuid);

    if (database.getGuildByPlayer(xuid)) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_guild'));
        return;
    }

    if (!name || name.length < 2 || name.length > 16) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_too_long'));
        return;
    }

    if (database.getGuildByName(name)) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_taken', name));
        return;
    }

    var cost = cfg().createCost !== undefined ? cfg().createCost : 1000;
    if (cost > 0 && confirmPurchase) {
        confirmPurchase(player, cost, t('guild.create_cost'), function(p) {
            if (!reducePlayerMoney(p, cost, t('guild.create_cost'))) {
                p.tell(t('guild.tag_prefix') + ' §c' + t('guild.create_failed'));
                return;
            }
            var maxMembers = cfg().maxMembers !== undefined ? cfg().maxMembers : 20;
            var guildId = database.createGuild(name, description, p.xuid, maxMembers);
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.create_success', name));
        });
        return;
    }

    var maxMembers = cfg().maxMembers !== undefined ? cfg().maxMembers : 20;
    var guildId = database.createGuild(name, description, xuid, maxMembers);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.create_success', name));
    logger.info('[Guild] 玩家 ' + player.name + ' 创建公会: ' + name + ' (ID:' + guildId + ')');
}

/** 解散公会 */
function doDisbandGuild(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    if (guild.owner !== xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner')); return; }

    player.sendModalForm(
        t('guild.disband_confirm'),
        t('guild.disband_confirm_body', guild.name),
        t('guild.confirm_disband_ok'),
        t('guild.confirm_cancel'),
        function(p, result) {
            if (!result) return;
            var members = database.getGuildMembers(guild.id);
            var disbandName = guild.name;
            for (var mi = 0; mi < members.length; mi++) {
                sendSystemMail(members[mi].xuid, t('guild.disband_mail_content', disbandName));
                try { var mp = mc.getPlayer(members[mi].xuid); if (mp) mp.tell(t('guild.tag_prefix') + ' ' + t('guild.disband_notify', disbandName)); } catch (e) {}
            }
            database.deleteGuild(guild.id);
            if (chatModule) chatModule.clearAllOrgNameCache();
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.disband_success', disbandName));
            logger.info('[Guild] 玩家 ' + p.name + ' 解散公会: ' + disbandName);
        }
    );
}

/** 查看公会信息 */
function doShowInfo(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }

    var members = database.getGuildMembers(guild.id);
    var tps = database.getGuildTeleports(guild.id);
    var ownerName = getPlayerName(guild.owner);
    var myRole = getEffectiveRole(player, guild);
    var roleStr = myRole === 'owner' ? '§6' + t('guild.owner') : (myRole === 'admin' ? '§b' + t('guild.admin') : '§a' + t('guild.member'));
    var hqStr = guild.hqX != null ? ('X:' + Math.round(guild.hqX) + ' Y:' + Math.round(guild.hqY) + ' Z:' + Math.round(guild.hqZ)) : t('guild.not_set');

    var content = '§b' + t('guild.guild_name') + '§f' + guild.name + '\n' +
        '§b' + t('guild.guild_desc') + '§f' + (guild.description || t('guild.none')) + '\n' +
        '§b' + t('guild.owner_label') + '§f' + ownerName + '\n' +
        '§b' + t('guild.your_role') + roleStr + '\n' +
        '§b' + t('guild.level_label') + '§f' + guild.level + '\n' +
        '§b' + t('guild.member_count') + '§f' + members.length + '/' + guild.maxMembers + '\n' +
        '§b' + t('guild.tp_count') + '§f' + tps.length + '/' + (cfg().maxTeleports !== undefined ? cfg().maxTeleports : 5) + '\n' +
        '§b' + t('guild.fund_label') + '§f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + '\n' +
        '§b' + t('guild.hq_label') + '§f' + hqStr;

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + t('guild.info_title', guild.name));
    fm.setContent(content);
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');
    player.sendForm(fm, function() { showMainMenu(player); });
}

/** 列出所有公会 - 按钮显示，点击查看详情 */
function doListGuilds(player) {
    var guilds = database.getAllGuilds();
    if (guilds.length === 0) { showEmptyTipForm(player, '§e' + t('guild.list_title'), '§a' + t('guild.list_empty'), showMainMenu); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + t('guild.list_title'));

    for (var i = 0; i < guilds.length; i++) {
        var g = guilds[i];
        var mc2 = database.getMemberCount(g.id);
        var ownerName = getPlayerName(g.owner);
        fm.addButton('§a' + g.name + ' | ' + t('guild.owner_prefix') + '§f' + ownerName + ' | §e' + mc2 + '/' + g.maxMembers, 'textures/ui/icon_best3');
    }
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === guilds.length) { showMainMenu(p); return; }
        if (id < guilds.length) {
            showGuildDetail(p, guilds[id]);
        }
    });
}

/** 显示公会详情 */
function showGuildDetail(player, guild) {
    var members = database.getGuildMembers(guild.id);
    var tps = database.getGuildTeleports(guild.id);
    var ownerName = getPlayerName(guild.owner);
    var hqStr = guild.hqX != null ? ('X:' + Math.round(guild.hqX) + ' Y:' + Math.round(guild.hqY) + ' Z:' + Math.round(guild.hqZ)) : t('guild.not_set');

    var content = '§b' + t('guild.guild_name') + '§f' + guild.name + '\n' +
        '§b' + t('guild.desc_label') + '§f' + (guild.description || t('guild.none')) + '\n' +
        '§b' + t('guild.owner_label') + '§f' + ownerName + '\n' +
        '§b' + t('guild.level_label') + '§f' + guild.level + '\n' +
        '§b' + t('guild.members_label') + '§f' + members.length + '/' + guild.maxMembers + '\n' +
        '§b' + t('guild.tps_label') + '§f' + tps.length + '\n' +
        '§b' + t('guild.fund_label_short') + '§f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + '\n' +
        '§b' + t('guild.hq_label_short') + '§f' + hqStr;

    content += '\n\n§b' + t('guild.members_section');
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? '§6' + t('guild.owner') : (m.role === 'admin' ? '§b' + t('guild.admin_short') : '§a' + t('guild.member'));
        content += '\n' + mr + ' §f' + m.name;
    }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + guild.name);
    fm.setContent(content);
    var myXuid = String(player.xuid);
    var myGuild = database.getGuildByPlayer(myXuid);
    if (!myGuild) {
        fm.addButton('§a' + t('guild.apply_join'), 'textures/ui/color_plus');
    }
    fm.addButton(t('guild.back_to_list'), 'textures/ui/refresh_light');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (!myGuild && id === 0) {
            doSubmitJoinRequest(p, guild);
            return;
        }
        doListGuilds(p);
    });
}

/** 传送到公会传送点 */
function doTeleportTo(player, tpName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }

    var tp = database.getGuildTeleportByName(guild.id, tpName);
    if (!tp) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_not_found', tpName)); return; }

    var remain = checkCooldown(xuid);
    if (remain > 0) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_cooldown', remain)); return; }

    if (teleportModule.safeTeleport(player, tp.x, tp.y, tp.z, tp.dim)) {
        player.tell(t('guild.tag_prefix') + ' §a' + t('guild.tp_success') + tp.name);
    } else {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_failed'));
    }
}

/** 传送到公会总部 */
function doTeleportHQ(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    if (guild.hqX == null) {
        showEmptyTipForm(player, '§c' + t('guild.hq_not_set'), '§e' + t('guild.hq_not_set_body'), showMainMenu);
        return;
    }

    var remain = checkCooldown(xuid);
    if (remain > 0) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_cooldown', remain)); return; }

    if (teleportModule.safeTeleport(player, guild.hqX, guild.hqY, guild.hqZ, guild.hqDim)) {
        player.tell(t('guild.tag_prefix') + ' §a' + t('guild.hq_tp_success'));
    } else {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_failed'));
    }
}

/** 设置公会总部 */
function doSetHQ(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_tp')); return; }

    var pos = player.pos;
    database.updateGuild(guild.id, { hqX: pos.x, hqY: pos.y, hqZ: pos.z, hqDim: String(player.dimid) });
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.hq_set_success', Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)));
}

/** 存入公会资金 */
function doDeposit(player, amount) {
    if (!amount || amount <= 0 || isNaN(amount)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.invalid_amount')); return; }
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }

    if (confirmPurchase) {
        confirmPurchase(player, amount, t('guild.deposit_cost'), function(p) {
            if (!reducePlayerMoney(p, amount, t('guild.deposit_cost'))) {
                p.tell(t('guild.tag_prefix') + ' §c' + t('guild.deposit_failed')); return;
            }
            database.updateGuildFundAdd(guild.id, amount);
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.deposit_success', amount.toFixed(2) + ' ' + getCurrencyName()));
        });
        return;
    }
    if (!reducePlayerMoney(player, amount, t('guild.deposit_cost'))) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.deposit_failed')); return;
    }
    database.updateGuildFundAdd(guild.id, amount);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.deposit_success', amount.toFixed(2) + ' ' + getCurrencyName()));
    logger.info('[Guild] ' + player.name + ' 存入公会"' + guild.name + '" ' + amount);
}

/** 取出公会资金 */
function doWithdraw(player, amount) {
    if (!amount || amount <= 0 || isNaN(amount)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.invalid_amount')); return; }
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }

    var role = getEffectiveRole(player, guild);
    var adminOnly = cfg().withdrawAdminOnly;
    if (adminOnly && role !== 'owner' && role !== 'admin') {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_withdraw'));
        return;
    }

    if (!database.updateGuildFundReduce(guild.id, amount)) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.fund_insufficient')); return;
    }

    addPlayerMoney(player, amount, t('guild.withdraw_label'));
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.withdraw_success', amount.toFixed(2) + ' ' + getCurrencyName()));
    logger.info('[Guild] ' + player.name + ' 从公会"' + guild.name + '"取出 ' + amount);
}

/** 添加公会传送点 */
function doAddTeleport(player, tpName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_add_tp')); return; }

    var maxTP = cfg().maxTeleports !== undefined ? cfg().maxTeleports : 5;
    if (database.getGuildTeleportCount(guild.id) >= maxTP) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_limit', maxTP));
        return;
    }

    if (database.getGuildTeleportByName(guild.id, tpName)) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_exists', tpName));
        return;
    }

    var pos = player.pos;
    var dimStr = String(player.dimid);
    database.addGuildTeleport(guild.id, tpName, pos.x, pos.y, pos.z, dimStr, xuid);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.tp_add_success', tpName));
}

/** 删除公会传送点 */
function doDelTeleport(player, tpName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_del_tp')); return; }

    var tp = database.getGuildTeleportByName(guild.id, tpName);
    if (!tp) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_not_found', tpName)); return; }

    database.removeGuildTeleport(tp.id, guild.id);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.tp_delete_success', tpName));
}

/** 踢出成员 */
function doKickMember(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_kick')); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.member_not_found', targetName)); return; }
    if (target.xuid === xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_kick_self')); return; }
    if (target.role === 'owner') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_kick_owner')); return; }
    if (role === 'admin' && target.role === 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_cannot_kick_admin')); return; }

    database.removeGuildMember(target.xuid);
    if (chatModule) chatModule.clearOrgNameCache(target.xuid);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.kick_success', targetName));
    sendSystemMail(target.xuid, '§c' + t('guild.kick_mail', guild.name));
    try {
        var targetPlayer = mc.getPlayer(target.xuid);
        if (targetPlayer) targetPlayer.tell(t('guild.tag_prefix') + ' §c' + t('guild.kicked_notify', guild.name));
    } catch (e) {}
    logger.info('[Guild] ' + player.name + ' 踢出 ' + targetName + ' (公会:' + guild.name + ')');
}

/** 提升为管理员 */
function doPromote(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    if (guild.owner !== xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner_promote2')); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.member_not_found', targetName)); return; }
    if (target.role === 'owner') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner_promote')); return; }
    if (target.role === 'admin') { player.tell(t('guild.tag_prefix') + ' §e' + t('guild.already_admin')); return; }

    var adminCount = 0;
    for (var j = 0; j < members.length; j++) {
        if (members[j].role === 'admin') adminCount++;
    }
    var maxAdmins = cfg().maxAdmins !== undefined ? cfg().maxAdmins : 3;
    if (adminCount >= maxAdmins) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_limit', maxAdmins)); return; }

    database.updateMemberRole(target.xuid, 'admin');
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.promote_success', targetName));
    sendSystemMail(target.xuid, '§a' + t('guild.promote_mail', guild.name));
    try {
        var tp = mc.getPlayer(target.xuid);
        if (tp) tp.tell(t('guild.tag_prefix') + ' §a' + t('guild.promoted_notify', guild.name));
    } catch (e) {}
}

/** 降为普通成员 */
function doDemote(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    if (guild.owner !== xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner_demote')); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.member_not_found', targetName)); return; }
    if (target.role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §e' + t('guild.not_admin')); return; }

    database.updateMemberRole(target.xuid, 'member');
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.demote_success', targetName));
    sendSystemMail(target.xuid, '§c' + t('guild.demote_mail', guild.name));
    try {
        var tp = mc.getPlayer(target.xuid);
        if (tp) tp.tell(t('guild.tag_prefix') + ' §c' + t('guild.demoted_notify', guild.name));
    } catch (e) {}
}

/** 转让会长 */
function doTransfer(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    if (guild.owner !== xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner_transfer')); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.member_not_found', targetName)); return; }
    if (target.xuid === xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_transfer_self')); return; }

    player.sendModalForm(
        t('guild.transfer_confirm'),
        t('guild.transfer_confirm_body', guild.name, targetName),
        t('guild.confirm_transfer_ok'),
        t('guild.confirm_cancel'),
        function(p, result) {
            if (!result) return;
            database.updateGuild(guild.id, { owner: target.xuid });
            database.updateMemberRole(target.xuid, 'owner');
            database.updateMemberRole(xuid, 'admin');
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.transfer_success', targetName));
            sendSystemMail(target.xuid, t('guild.transfer_mail_new', p.name, guild.name));
            sendSystemMail(xuid, t('guild.transfer_mail_old', guild.name, targetName));
            try {
                var tp = mc.getPlayer(target.xuid);
                if (tp) tp.tell(t('guild.tag_prefix') + ' §a' + t('guild.transfer_notify', guild.name));
            } catch (e) {}
            logger.info('[Guild] ' + p.name + ' 转让公会"' + guild.name + '"给 ' + targetName);
        }
    );
}

// ==================== 辅助函数 ====================

/**
 * 通过玩家名或UID搜索玩家XUID
 * @param {string} query - 玩家名或UID
 * @returns {string|null} 找到返回xuid，否则null
 */
function findPlayerXuid(query) {
    try {
        var pd = getPlayerData ? getPlayerData() : null;
        if (!pd || !pd.players) { logger.warn('[Guild][Search] getPlayerData 返回空'); return null; }
        var q = query.trim();
        if (!q) return null;

        var allXuids = Object.keys(pd.players);
        var qNum = parseInt(q);

        logger.info('[Guild][Search] 查询: "' + q + '" | 玩家总数: ' + allXuids.length + ' | isNaN:' + isNaN(qNum) + ' | qNum:' + qNum);

        // 打印前3个玩家的uid字段类型和值，用于调试
        for (var dbg = 0; dbg < Math.min(3, allXuids.length); dbg++) {
            var dp = pd.players[allXuids[dbg]];
            logger.info('[Guild][Search] 样本[' + dbg + '] xuid=' + allXuids[dbg] + ' | uid=' + dp.uid + ' | type=' + typeof dp.uid + ' | name=' + dp.name);
        }

        // 按xuid精确匹配
        if (pd.players[q]) return q;

        // 按uid精确匹配
        if (!isNaN(qNum)) {
            for (var i = 0; i < allXuids.length; i++) {
                var p = pd.players[allXuids[i]];
                if (p.uid !== undefined && Number(p.uid) === qNum) return allXuids[i];
            }
        }

        // 在线玩家兜底搜索
        try {
            var online = mc.getOnlinePlayers();
            logger.info('[Guild][Search] 在线玩家数: ' + online.length);
            var qLower2 = q.toLowerCase();
            for (var oi = 0; oi < online.length; oi++) {
                var op = online[oi];
                if (op.name && op.name.toLowerCase() === qLower2) return String(op.xuid);
                if (!isNaN(qNum) && op.uid !== undefined && Number(op.uid) === qNum) return String(op.xuid);
            }
        } catch (e2) { logger.warn('[Guild][Search] 在线搜索异常: ' + e2.message); }

        // 按玩家名精确匹配
        var qLower = q.toLowerCase();
        for (var j = 0; j < allXuids.length; j++) {
            var p2 = pd.players[allXuids[j]];
            if (p2.name && p2.name.toLowerCase() === qLower) return allXuids[j];
        }

        // 模糊包含匹配
        for (var k = 0; k < allXuids.length; k++) {
            var p3 = pd.players[allXuids[k]];
            if (p3.name && p3.name.toLowerCase().indexOf(qLower) !== -1) return allXuids[k];
        }
    } catch (e) { logger.error('[Guild][Search] 搜索异常: ' + e.message + '\n' + e.stack); }
    return null;
}

// ==================== GUI 表单 ====================

/** 公会主菜单 */
function showMainMenu(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + t('guild.main_title'));

    var isAdmin = isServerAdmin(player);

    if (guild) {
        var role = getEffectiveRole(player, guild);
        var roleStr = role === 'owner' ? '§6' + t('guild.owner') : (role === 'admin' ? '§b' + t('guild.admin') : '§a' + t('guild.member'));
        var pendingCount = (_joinRequests[guild.id] || []).length;
        var pendingStr = pendingCount > 0 ? '\n§e' + t('guild.pending_count', pendingCount) : '';
        fm.setContent('§b' + t('guild.current_guild') + '§f' + guild.name + ' (' + roleStr + '§f)\n§b' + t('guild.fund_label') + '§f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + pendingStr);

        fm.addButton('§b' + t('guild.btn_info'), 'textures/ui/icon_book_writable');
        fm.addButton('§a' + t('guild.btn_member_manage'), 'textures/ui/FriendsDiversity');
        fm.addButton('§e' + t('guild.btn_tp_manage'), 'textures/items/compass_item');
        fm.addButton('§6' + t('guild.btn_treasury'), 'textures/items/gold_ingot');
        fm.addButton('§d' + t('guild.btn_tp_hq'), 'textures/items/bed_red');
        fm.addButton('§9' + t('guild.btn_guild_list'), 'textures/ui/icon_best3');
        if (role === 'owner' || role === 'admin') {
            fm.addButton('§d' + t('guild.btn_invite'), 'textures/ui/color_plus');
            fm.addButton('§e' + t('guild.btn_handle_requests') + (pendingCount > 0 ? ' §c(' + pendingCount + ')' : ''), 'textures/ui/icon_book_writable');
        }
        if (isAdmin) {
            fm.addButton('§c' + t('guild.btn_admin_panel'), 'textures/ui/op');
        }
        fm.addButton('§c' + t('guild.btn_leave'), 'textures/ui/cancel');
    } else {
        var myInvites = _guildInvites[xuid] || [];
        var inviteStr = myInvites.length > 0 ? '\n§e' + t('guild.pending_invite_count', myInvites.length) : '';
        fm.setContent('§e' + t('guild.no_guild_msg') + inviteStr);
        fm.addButton('§9' + t('guild.btn_view_all'), 'textures/ui/icon_best3');
        fm.addButton('§d' + t('guild.btn_handle'), 'textures/ui/FriendsDiversity');
        if (myInvites.length > 0) {
            fm.addButton('§e' + t('guild.btn_view_invites') + ' §c(' + myInvites.length + ')', 'textures/ui/icon_book_writable');
        }
        if (isAdmin) {
            fm.addButton('§c' + t('guild.btn_admin_panel'), 'textures/ui/op');
        }
    }

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (guild) {
            var r = getEffectiveRole(p, guild);
            var isAdmin2 = isServerAdmin(p);
            if (r === 'owner' || r === 'admin') {
                if (isAdmin2) {
                    switch (id) {
                        case 0: showGuildInfoPanel(p); break;
                        case 1: showMemberManagePanel(p); break;
                        case 2: showTeleportPanel(p); break;
                        case 3: showTreasuryPanel(p); break;
                        case 4: doTeleportHQ(p); break;
                        case 5: doListGuilds(p); break;
                        case 6: showInvitePlayerForm(p); break;
                        case 7: showJoinRequestsPanel(p); break;
                        case 8: showAdminPanel(p); break;
                        case 9: doLeaveGuild(p); break;
                    }
                } else {
                    switch (id) {
                        case 0: showGuildInfoPanel(p); break;
                        case 1: showMemberManagePanel(p); break;
                        case 2: showTeleportPanel(p); break;
                        case 3: showTreasuryPanel(p); break;
                        case 4: doTeleportHQ(p); break;
                        case 5: doListGuilds(p); break;
                        case 6: showInvitePlayerForm(p); break;
                        case 7: showJoinRequestsPanel(p); break;
                        case 8: doLeaveGuild(p); break;
                    }
                }
            } else {
                if (isAdmin2) {
                    switch (id) {
                        case 0: showGuildInfoPanel(p); break;
                        case 1: showMemberManagePanel(p); break;
                        case 2: showTeleportPanel(p); break;
                        case 3: showTreasuryPanel(p); break;
                        case 4: doTeleportHQ(p); break;
                        case 5: doListGuilds(p); break;
                        case 6: showAdminPanel(p); break;
                        case 7: doLeaveGuild(p); break;
                    }
                } else {
                    switch (id) {
                        case 0: showGuildInfoPanel(p); break;
                        case 1: showMemberManagePanel(p); break;
                        case 2: showTeleportPanel(p); break;
                        case 3: showTreasuryPanel(p); break;
                        case 4: doTeleportHQ(p); break;
                        case 5: doListGuilds(p); break;
                        case 6: doLeaveGuild(p); break;
                    }
                }
            }
        } else {
            var isAdmin3 = isServerAdmin(p);
            var myInvites2 = _guildInvites[String(p.xuid)] || [];
            var hasInvites = myInvites2.length > 0;
            if (isAdmin3) {
                if (hasInvites) {
                    switch (id) {
                        case 0: doListGuilds(p); break;
                        case 1: showPendingInvitesPanel(p); break;
                        case 2: showAdminPanel(p); break;
                    }
                } else {
                    switch (id) {
                        case 0: doListGuilds(p); break;
                        case 1: showAdminPanel(p); break;
                    }
                }
            } else {
                if (hasInvites) {
                    switch (id) {
                        case 0: doListGuilds(p); break;
                        case 1: showPendingInvitesPanel(p); break;
                    }
                } else {
                    switch (id) {
                        case 0: doListGuilds(p); break;
                    }
                }
            }
        }
    });
}

/** 创建公会表单 */
function showCreateGuildForm(player) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§a' + t('guild.create_title'));
    fm.addInput(t('guild.guild_name_input'), t('guild.guild_name_placeholder'), '');
    fm.addInput(t('guild.guild_desc_input'), t('guild.guild_desc_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var name = (data[0] || '').trim();
        var desc = (data[1] || '').trim();
        if (!name) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_empty')); return; }
        doCreateGuild(p, name, desc);
    });
}

/** 公会信息面板 */
function showGuildInfoPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }

    var members = database.getGuildMembers(guild.id);
    var tps = database.getGuildTeleports(guild.id);
    var ownerName = getPlayerName(guild.owner);
    var role = getEffectiveRole(player, guild);
    var roleStr = role === 'owner' ? '§6' + t('guild.owner') : (role === 'admin' ? '§b' + t('guild.admin') : '§a' + t('guild.member'));
    var hqStr = guild.hqX != null ? ('X:' + Math.round(guild.hqX) + ' Y:' + Math.round(guild.hqY) + ' Z:' + Math.round(guild.hqZ)) : t('guild.not_set');

    var content = '§b' + t('guild.guild_name') + '§f' + guild.name + '\n' +
        '§b' + t('guild.desc_label') + '§f' + (guild.description || t('guild.none')) + '\n' +
        '§b' + t('guild.owner_label') + '§f' + ownerName + '\n' +
        '§b' + t('guild.your_role') + roleStr + '\n' +
        '§b' + t('guild.level_label') + '§f' + guild.level + '\n' +
        '§b' + t('guild.members_label') + '§f' + members.length + '/' + guild.maxMembers + '\n' +
        '§b' + t('guild.tps_label') + '§f' + tps.length + '/' + (cfg().maxTeleports !== undefined ? cfg().maxTeleports : 5) + '\n' +
        '§b' + t('guild.fund_label_short') + '§f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + '\n' +
        '§b' + t('guild.hq_label_short') + '§f' + hqStr;

    content += '\n\n§b' + t('guild.members_section');
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? '§6' + t('guild.owner') : (m.role === 'admin' ? '§b' + t('guild.admin_short') : '§a' + t('guild.member'));
        content += '\n' + mr + ' §f' + m.name;
    }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + t('guild.info_title', guild.name));
    fm.setContent(content);
    if (role === 'owner' || role === 'admin') {
        fm.addButton('§e' + t('guild.btn_change_name'), 'textures/ui/book_edit_default');
    }
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (role === 'owner' || role === 'admin') {
            if (id === 0) { showChangeGuildNameForm(p, guild); return; }
        }
        showMainMenu(p);
    });
}

/** 修改公会名称表单 */
function showChangeGuildNameForm(player, guild) {
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_change_name')); return; }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e' + t('guild.change_name_title'));
    fm.addLabel('§b' + t('guild.current_name') + '§f' + guild.name);
    fm.addInput(t('guild.new_name_placeholder'), t('guild.guild_name_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showGuildInfoPanel(p); return; }
        var newName = (data[1] || '').trim();
        if (!newName) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_empty')); showChangeGuildNameForm(p, guild); return; }
        if (newName.length < 2 || newName.length > 16) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_too_long')); showChangeGuildNameForm(p, guild); return; }
        if (newName === guild.name) { p.tell(t('guild.tag_prefix') + ' §e' + t('guild.name_same')); showGuildInfoPanel(p); return; }
        if (database.getGuildByName(newName)) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_taken', newName)); showChangeGuildNameForm(p, guild); return; }

        var oldName = guild.name;
        database.updateGuild(guild.id, { name: newName });
        if (chatModule) chatModule.clearAllOrgNameCache();
        p.tell(t('guild.tag_prefix') + ' §a' + t('guild.name_changed', oldName, newName));

        // 通知所有成员
        var members = database.getGuildMembers(guild.id);
        for (var i = 0; i < members.length; i++) {
            sendSystemMail(members[i].xuid, t('guild.name_change_mail', p.name, newName, oldName));
            try {
                var tp = mc.getPlayer(members[i].xuid);
                if (tp) tp.sendToast(t('guild.rename_toast'), t('guild.rename_toast_text', newName));
            } catch (e) {}
        }

        logger.info('[Guild] ' + p.name + ' 将公会"' + oldName + '"更名为"' + newName + '"');
        var updated = database.getGuild(guild.id);
        if (updated) showGuildInfoPanel(p);
        else showMainMenu(p);
    });
}

/** 成员管理面板 */
function showMemberManagePanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);

    var members = database.getGuildMembers(guild.id);
    var memberNames = [];
    var memberMap = [];
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? t('guild.role_prefix_owner') : (m.role === 'admin' ? t('guild.role_prefix_admin') : t('guild.role_prefix_member'));
        memberNames.push(mr + ' ' + m.name);
        memberMap.push(m);
    }

    var actions = [t('guild.view_info')];
    var actionKeys = ['info'];
    if (role === 'owner' || role === 'admin') {
        actions.push(t('guild.action_kick'));
        actionKeys.push('kick');
    }
    if (role === 'owner') {
        actions.push(t('guild.action_promote'));
        actionKeys.push('promote');
        actions.push(t('guild.action_demote'));
        actionKeys.push('demote');
        actions.push(t('guild.action_transfer'));
        actionKeys.push('transfer');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§a' + t('guild.member_manage_title', members.length + '/' + guild.maxMembers));
    fm.addDropdown(t('guild.select_member'), memberNames, 0);
    fm.addDropdown(t('guild.select_action'), actions, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var memberIdx = data[0];
        var actionIdx = data[1];
        var target = memberMap[memberIdx];
        var action = actionKeys[actionIdx];

        if (!target) { showMainMenu(p); return; }

        switch (action) {
            case 'info':
                showMemberInfo(p, guild, target);
                break;
            case 'kick':
                if (target.xuid === xuid) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_kick_self')); showMemberManagePanel(p); return; }
                if (target.role === 'owner') { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_kick_owner')); showMemberManagePanel(p); return; }
                if (role === 'admin' && target.role === 'admin') { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_cannot_kick_admin')); showMemberManagePanel(p); return; }
                p.sendModalForm(t('guild.confirm_kick'), t('guild.kick_confirm_body', target.name), t('guild.confirm_ok'), t('guild.confirm_cancel'), function(p2, r) {
                    if (!r) { showMemberManagePanel(p2); return; }
                    database.removeGuildMember(target.xuid);
                    if (chatModule) chatModule.clearOrgNameCache(target.xuid);
                    p2.tell(t('guild.tag_prefix') + ' §a' + t('guild.kick_success', target.name));
                    sendSystemMail(target.xuid, '§c' + t('guild.kick_mail', guild.name));
                    try { var tp = mc.getPlayer(target.xuid); if (tp) tp.tell(t('guild.tag_prefix') + ' §c' + t('guild.kicked_notify', guild.name)); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 踢出 ' + target.name + ' (公会:' + guild.name + ')');
                    showMemberManagePanel(p2);
                });
                break;
            case 'promote':
                if (target.role === 'owner') { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner_promote')); showMemberManagePanel(p); return; }
                if (target.role === 'admin') { p.tell(t('guild.tag_prefix') + ' §e' + t('guild.already_admin')); showMemberManagePanel(p); return; }
                var adminCount = 0;
                for (var j = 0; j < members.length; j++) { if (members[j].role === 'admin') adminCount++; }
                if (adminCount >= (cfg().maxAdmins !== undefined ? cfg().maxAdmins : 3)) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_limit')); showMemberManagePanel(p); return; }
                database.updateMemberRole(target.xuid, 'admin');
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.promote_success', target.name));
                sendSystemMail(target.xuid, '§a' + t('guild.promote_mail', guild.name));
                try { var tp2 = mc.getPlayer(target.xuid); if (tp2) tp2.tell(t('guild.tag_prefix') + ' §a' + t('guild.promoted_notify', guild.name)); } catch (e) {}
                showMemberManagePanel(p);
                break;
            case 'demote':
                if (target.role !== 'admin') { p.tell(t('guild.tag_prefix') + ' §e' + t('guild.not_admin')); showMemberManagePanel(p); return; }
                database.updateMemberRole(target.xuid, 'member');
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.demote_success', target.name));
                sendSystemMail(target.xuid, '§c' + t('guild.demote_mail', guild.name));
                try { var tp3 = mc.getPlayer(target.xuid); if (tp3) tp3.tell(t('guild.tag_prefix') + ' §c' + t('guild.demoted_notify', guild.name)); } catch (e) {}
                showMemberManagePanel(p);
                break;
            case 'transfer':
                if (target.xuid === xuid) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_transfer_self')); showMemberManagePanel(p); return; }
                p.sendModalForm(t('guild.confirm_transfer_title'), t('guild.confirm_transfer_body', guild.name, target.name), t('guild.confirm_ok'), t('guild.confirm_cancel'), function(p2, r) {
                    if (!r) { showMemberManagePanel(p2); return; }
                    database.updateGuild(guild.id, { owner: target.xuid });
                    database.updateMemberRole(target.xuid, 'owner');
                    database.updateMemberRole(xuid, 'admin');
                    p2.tell(t('guild.tag_prefix') + ' §a' + t('guild.transfer_success', target.name));
                    sendSystemMail(target.xuid, t('guild.transfer_mail_new', p2.name, guild.name));
                    sendSystemMail(xuid, t('guild.transfer_mail_old', guild.name, target.name));
                    try { var tp4 = mc.getPlayer(target.xuid); if (tp4) tp4.tell(t('guild.tag_prefix') + ' §a' + t('guild.transfer_notify', guild.name)); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 转让公会"' + guild.name + '"给 ' + target.name);
                    showMemberManagePanel(p2);
                });
                break;
        }
    });
}

/** 查看成员信息 */
function showMemberInfo(player, guild, member) {
    var roleStr = member.role === 'owner' ? '§6' + t('guild.owner') : (member.role === 'admin' ? '§b' + t('guild.admin') : '§a' + t('guild.member'));
    var content = '§b' + t('guild.member_name') + '§f' + member.name + '\n' +
        '§b' + t('guild.xuid_label') + '§f' + member.xuid + '\n' +
        '§b' + t('guild.role_label') + roleStr + '\n' +
        '§b' + t('guild.join_time') + '§f' + new Date(member.joinedAt).toLocaleString();

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + t('guild.member_info_title'));
    fm.setContent(content);
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');
    player.sendForm(fm, function() { showMemberManagePanel(player); });
}

/** 传送点管理面板 */
function showTeleportPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);

    var tps = database.getGuildTeleports(guild.id);
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§e' + t('guild.tp_manage_title'));

    var content = '§b' + t('guild.tp_list_title', tps.length + '/' + (cfg().maxTeleports !== undefined ? cfg().maxTeleports : 5)) + '\n';
    if (tps.length > 0) {
        for (var i = 0; i < tps.length; i++) {
            content += '§a' + tps[i].name + ' (X:' + Math.round(tps[i].x) + ' Y:' + Math.round(tps[i].y) + ' Z:' + Math.round(tps[i].z) + ')\n';
        }
    } else {
        content += t('guild.no_tp') + '\n';
    }
    fm.setContent(content);

    for (var j = 0; j < tps.length; j++) {
        fm.addButton('§a' + t('guild.tp_prefix') + tps[j].name, 'textures/items/ender_pearl');
    }
    var btnOffset = tps.length;
    if (role === 'owner' || role === 'admin') {
        fm.addButton('§b' + t('guild.add_tp'), 'textures/ui/color_plus');
        fm.addButton('§c' + t('guild.delete_tp'), 'textures/ui/hammer_l');
        fm.addButton('§6' + t('guild.set_hq'), 'textures/items/bed_red');
    }
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id < btnOffset) {
            var tp = tps[id];
            var remain = checkCooldown(String(p.xuid));
            if (remain > 0) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_cooldown', remain)); return; }
            if (teleportModule.safeTeleport(p, tp.x, tp.y, tp.z, tp.dim)) {
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.tp_success') + tp.name);
            } else {
                p.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_failed'));
            }
            return;
        }
        var idx = id - btnOffset;
        if (role === 'owner' || role === 'admin') {
            if (idx === 0) { showAddTeleportForm(p); return; }
            if (idx === 1) { showDelTeleportForm(p); return; }
            if (idx === 2) { doSetHQ(p); return; }
            idx -= 3;
        }
        showMainMenu(p);
    });
}

/** 添加传送点表单 */
function showAddTeleportForm(player) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b' + t('guild.add_tp_title'));
    fm.addInput(t('guild.tp_name_placeholder'), t('guild.tp_name_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showTeleportPanel(p); return; }
        var name = (data[0] || '').trim();
        if (!name) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_name_empty')); return; }
        doAddTeleport(p, name);
        showTeleportPanel(p);
    });
}

/** 删除传送点表单 */
function showDelTeleportForm(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) return;
    var tps = database.getGuildTeleports(guild.id);

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§c' + t('guild.delete_tp_title'));
    fm.setContent('§e' + t('guild.select_tp_delete'));

    for (var i = 0; i < tps.length; i++) {
        fm.addButton('§c' + tps[i].name, 'textures/ui/hammer_l');
    }
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === tps.length) { showTeleportPanel(p); return; }
        if (id < tps.length) {
            database.removeGuildTeleport(tps[id].id, guild.id);
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.tp_delete_success', tps[id].name));
            showTeleportPanel(p);
        }
    });
}

/** 公会金库面板 - 使用下拉菜单选择操作 */
function showTreasuryPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }

    var role = getEffectiveRole(player, guild);
    var operations = [t('guild.op_deposit')];
    if (role === 'owner' || role === 'admin' || !cfg().withdrawAdminOnly) {
        operations.push(t('guild.op_withdraw'));
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§6' + t('guild.treasury_title'));
    fm.addLabel('§b' + t('guild.current_funds') + '§f' + guild.fund.toFixed(2) + ' ' + getCurrencyName());
    fm.addLabel('§b' + t('guild.your_balance') + '§f' + getPlayerMoney(player) + ' ' + getCurrencyName());
    fm.addDropdown(t('guild.select_operation'), operations, 0);
    fm.addInput(t('guild.amount_label'), t('guild.amount_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var opIdx = data[2];
        var amountStr = (data[3] || '').trim();
        var amount = parseFloat(amountStr);

        if (!amountStr || isNaN(amount) || amount <= 0) {
            p.tell(t('guild.tag_prefix') + ' §c' + t('guild.invalid_amount'));
            showTreasuryPanel(p);
            return;
        }

        if (opIdx === 0) {
            doDeposit(p, amount);
        } else {
            doWithdraw(p, amount);
        }
    });
}

/** 退出公会 */
function doLeaveGuild(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    if (guild.owner === xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_leave_owner')); return; }

    player.sendModalForm(
        t('guild.leave_confirm'),
        t('guild.leave_confirm_body', guild.name),
        t('guild.confirm_leave_ok'),
        t('guild.confirm_cancel'),
        function(p, result) {
            if (!result) return;
            database.removeGuildMember(xuid);
            if (chatModule) chatModule.clearOrgNameCache(xuid);
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.leave_success', guild.name));
            var members = database.getGuildMembers(guild.id);
            for (var m = 0; m < members.length; m++) {
                if (members[m].role === 'owner' || members[m].role === 'admin') {
                    sendSystemMail(members[m].xuid, '§e' + t('guild.leave_mail', p.name, guild.name));
                    try {
                        var tp = mc.getPlayer(members[m].xuid);
                        if (tp) tp.sendToast(t('guild.leave_toast_title'), t('guild.leave_toast_content', p.name));
                    } catch (e) {}
                }
            }
            logger.info('[Guild] ' + p.name + ' 退出公会: ' + guild.name);
        }
    );
}

// ==================== 申请加入 / 邀请系统 ====================

/** 查看公会邀请面板 */
function showPendingInvitesPanel(player) {
    var xuid = String(player.xuid);
    if (database.getGuildByPlayer(xuid)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_guild_msg')); return; }

    var invites = _guildInvites[xuid] || [];
    if (invites.length === 0) {
        player.tell(t('guild.tag_prefix') + ' §e' + t('guild.no_pending_invites'));
        showMainMenu(player);
        return;
    }

    var inviteNames = [];
    for (var i = 0; i < invites.length; i++) {
        var inv = invites[i];
        inviteNames.push(inv.guildName + ' (' + t('guild.inviter_label') + inv.inviterName + ')');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e' + t('guild.invite_title', invites.length));
    fm.addDropdown(t('guild.select_invite'), inviteNames, 0);
    fm.addDropdown(t('guild.select_action'), [t('guild.accept_invite'), t('guild.reject_invite')], 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var invIdx = data[0];
        var actionIdx = data[1];
        var inv = invites[invIdx];
        if (!inv) { showMainMenu(p); return; }

        if (actionIdx === 0) {
            // 接受邀请
            if (database.getGuildByPlayer(String(p.xuid))) {
                p.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_guild_msg'));
                _guildInvites[xuid] = [];
                database.clearGuildInvitesSQL(xuid);
                showMainMenu(p);
                return;
            }
            var guild = database.getGuild(inv.guildId);
            if (!guild) {
                p.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_not_exist'));
                _guildInvites[xuid].splice(invIdx, 1);
                database.removeGuildInviteSQL(xuid, inv.guildId);
                showPendingInvitesPanel(p);
                return;
            }
            if (database.getMemberCount(guild.id) >= guild.maxMembers) {
                p.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_full'));
                _guildInvites[xuid].splice(invIdx, 1);
                database.removeGuildInviteSQL(xuid, inv.guildId);
                showPendingInvitesPanel(p);
                return;
            }
            database.addGuildMember(xuid, guild.id, 'member');
            _guildInvites[xuid] = [];
            database.clearGuildInvitesSQL(xuid);
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.joined_success', guild.name));
            logger.info('[Guild] ' + p.name + ' 接受邀请加入公会: ' + guild.name);
            // 通知邀请人
            if (inv.inviterXuid) {
                sendSystemMail(inv.inviterXuid, '§a' + t('guild.invite_accepted_mail', guild.name));
            }
            try { var tp = mc.getPlayer(inv.inviterName); if (tp) tp.tell(t('guild.tag_prefix') + ' §a' + t('guild.invite_accepted_notify')); } catch (e) {}
        } else {
            _guildInvites[xuid].splice(invIdx, 1);
            database.removeGuildInviteSQL(xuid, inv.guildId);
            p.tell(t('guild.tag_prefix') + ' §e' + t('guild.invite_rejected', inv.guildName));
            if (inv.inviterXuid) {
                sendSystemMail(inv.inviterXuid, '§c' + t('guild.invite_rejected_mail', inv.guildName));
            }
            try { var tp2 = mc.getPlayer(inv.inviterName); if (tp2) tp2.tell(t('guild.tag_prefix') + ' §c' + t('guild.invite_rejected_notify')); } catch (e) {}
        }

        var remaining = _guildInvites[xuid] || [];
        if (remaining.length > 0) {
            showPendingInvitesPanel(p);
        } else {
            showMainMenu(p);
        }
    });
}

/** 申请加入公会面板 - 列出所有公会供选择 */
function showJoinGuildPanel(player) {
    var xuid = String(player.xuid);
    if (database.getGuildByPlayer(xuid)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_guild_msg')); return; }

    var guilds = database.getAllGuilds();
    if (guilds.length === 0) { showEmptyTipForm(player, '§e' + t('guild.list_title'), '§a' + t('guild.list_empty'), showMainMenu); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§d' + t('guild.join_title'));

    var content = '§b' + t('guild.select_guild') + '\n';
    for (var i = 0; i < guilds.length; i++) {
        var g = guilds[i];
        var mc2 = database.getMemberCount(g.id);
        var ownerName = getPlayerName(g.owner);
        content += '\n§a' + g.name + ' | ' + t('guild.owner_label_btn') + '§f' + ownerName + ' | ' + t('guild.members_label_btn') + '§f' + mc2 + '/' + g.maxMembers;
    }
    fm.setContent(content);

    for (var j = 0; j < guilds.length; j++) {
        var gm = guilds[j];
        var cnt = database.getMemberCount(gm.id);
        fm.addButton('§a' + gm.name + ' (' + cnt + '/' + gm.maxMembers + ')', 'textures/ui/icon_best3');
    }
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === guilds.length) { showMainMenu(p); return; }
        if (id < guilds.length) {
            doSubmitJoinRequest(p, guilds[id]);
        }
    });
}

/** 提交加入申请 */
function doSubmitJoinRequest(player, guild) {
    var xuid = String(player.xuid);

    if (database.getGuildByPlayer(xuid)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_guild_msg')); return; }

    var requests = _joinRequests[guild.id] || [];
    for (var i = 0; i < requests.length; i++) {
        if (requests[i].xuid === xuid) { player.tell(t('guild.tag_prefix') + ' §e' + t('guild.already_submitted')); return; }
    }

    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_full'));
        return;
    }

    var ownerName = getPlayerName(guild.owner);
    player.sendModalForm(
        t('guild.join_confirm'),
        t('guild.join_confirm_body', guild.name, ownerName, database.getMemberCount(guild.id) + '/' + guild.maxMembers),
        t('guild.confirm_apply_ok'),
        t('guild.confirm_cancel'),
        function(p, result) {
            if (!result) { showMainMenu(p); return; }
            // 再次检查状态
            if (database.getGuildByPlayer(String(p.xuid))) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_guild_msg')); return; }
            if (database.getMemberCount(guild.id) >= guild.maxMembers) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_full')); return; }

            if (!_joinRequests[guild.id]) _joinRequests[guild.id] = [];
            var reqData = { xuid: String(p.xuid), name: p.name, time: Date.now() };
            _joinRequests[guild.id].push(reqData);
            database.addGuildRequestSQL(guild.id, reqData.xuid, reqData.name, reqData.time);
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.apply_submitted_to', guild.name));

            var members = database.getGuildMembers(guild.id);
            for (var m = 0; m < members.length; m++) {
                if (members[m].role === 'owner' || members[m].role === 'admin') {
                    sendSystemMail(members[m].xuid, '§e' + t('guild.apply_mail', guild.name));
                    try {
                        var tp = mc.getPlayer(members[m].xuid);
                        if (tp) tp.sendToast(t('guild.apply_toast'), '§a' + p.name + ' ' + t('guild.apply_toast_text'));
                    } catch (e) {}
                }
            }

            logger.info('[Guild] ' + p.name + ' 申请加入公会: ' + guild.name);
            showMainMenu(p);
        }
    );
}

/** 处理加入申请面板 */
function showJoinRequestsPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_requests')); return; }

    var requests = _joinRequests[guild.id] || [];
    if (requests.length === 0) {
        showEmptyTipForm(player, '§e' + t('guild.no_requests'), '§a' + t('guild.no_requests_body'), showMainMenu);
        return;
    }

    var requestNames = [];
    for (var i = 0; i < requests.length; i++) {
        requestNames.push(requests[i].name + ' (' + requests[i].xuid + ')');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e' + t('guild.requests_title', requests.length));
    fm.addDropdown(t('guild.select_applicant'), requestNames, 0);
    fm.addDropdown(t('guild.select_action'), [t('guild.approve_join'), t('guild.reject_request')], 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var reqIdx = data[0];
        var actionIdx = data[1];
        var req = requests[reqIdx];
        if (!req) { showMainMenu(p); return; }

        var actionStr = actionIdx === 0 ? t('guild.approve') : t('guild.reject');
        var btnConfirm = actionIdx === 0 ? t('guild.confirm_approve_ok') : t('guild.confirm_reject_ok');
        var bodyKey = actionIdx === 0 ? 'guild.approve_confirm_body' : 'guild.reject_confirm_body';
        p.sendModalForm(
            '§e' + actionStr,
            t(bodyKey, req.name),
            btnConfirm,
            t('guild.confirm_cancel'),
            function(p2, result) {
                if (!result) { showJoinRequestsPanel(p2); return; }

                // 重新获取申请列表
                var freshReqs = _joinRequests[guild.id] || [];
                var freshReq = null;
                var freshIdx = -1;
                for (var fi = 0; fi < freshReqs.length; fi++) {
                    if (freshReqs[fi].xuid === req.xuid) { freshReq = freshReqs[fi]; freshIdx = fi; break; }
                }
                if (!freshReq) { p2.tell(t('guild.tag_prefix') + ' §e' + t('guild.request_not_exist')); showJoinRequestsPanel(p2); return; }

                if (actionIdx === 0) {
                    if (database.getGuildByPlayer(freshReq.xuid)) {
                        p2.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_joined_other'));
                        _joinRequests[guild.id].splice(freshIdx, 1);
                        database.removeGuildRequestSQL(guild.id, freshReq.xuid);
                        showJoinRequestsPanel(p2);
                        return;
                    }
                    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
                        p2.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_full'));
                        showJoinRequestsPanel(p2);
                        return;
                    }
                    database.addGuildMember(freshReq.xuid, guild.id, 'member');
                    _joinRequests[guild.id].splice(freshIdx, 1);
                    database.removeGuildRequestSQL(guild.id, freshReq.xuid);
                    p2.tell(t('guild.tag_prefix') + ' §a' + t('guild.approved', freshReq.name));
                    sendSystemMail(freshReq.xuid, '§a' + t('guild.approved_mail', guild.name));
                    try { var tp = mc.getPlayer(freshReq.xuid); if (tp) tp.tell(t('guild.tag_prefix') + ' §a' + t('guild.approved_notify', guild.name)); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 批准 ' + freshReq.name + ' 加入公会: ' + guild.name);
                } else {
                    _joinRequests[guild.id].splice(freshIdx, 1);
                    database.removeGuildRequestSQL(guild.id, freshReq.xuid);
                    p2.tell(t('guild.tag_prefix') + ' §e' + t('guild.rejected', freshReq.name));
                    sendSystemMail(freshReq.xuid, '§c' + t('guild.rejected_mail', guild.name));
                    try { var tp2 = mc.getPlayer(freshReq.xuid); if (tp2) tp2.tell(t('guild.tag_prefix') + ' §c' + t('guild.rejected_notify', guild.name)); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 拒绝 ' + freshReq.name + ' 加入公会: ' + guild.name);
                }

                var remaining = _joinRequests[guild.id] || [];
                if (remaining.length > 0) {
                    showJoinRequestsPanel(p2);
                } else {
                    showMainMenu(p2);
                }
            });
        });
    }

/** 邀请玩家加入公会 - 两个按钮：选择在线玩家 / 搜索玩家 */
function showInvitePlayerForm(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_guild')); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_admin_requests')); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§d' + t('guild.invite_title2', guild.name));
    fm.setContent('§b' + t('guild.current_members') + '§f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers);
    fm.addButton('§a' + t('guild.select_online'), 'textures/ui/FriendsDiversity');
    fm.addButton('§b' + t('guild.search_player'), 'textures/ui/magnifyingGlass');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 0) { showOnlinePlayerSelectForm(p, guild); }
        else if (id === 1) { showSearchInviteForm(p, guild); }
        else { showMainMenu(p); }
    });
}

/** 在线玩家选择表单 - 列出未加入公会的在线玩家为按钮 */
function showOnlinePlayerSelectForm(player, guild) {
    var xuid = String(player.xuid);
    try {
        var online = mc.getOnlinePlayers();
        var candidates = [];
        for (var i = 0; i < online.length; i++) {
            var op = online[i];
            if (String(op.xuid) === xuid) continue;
            if (database.getGuildByPlayer(String(op.xuid))) continue;
            candidates.push(op);
        }

        if (candidates.length === 0) {
            showEmptyTipForm(player, '§e' + t('guild.select_online'), '§a' + t('guild.no_online_players'), showMainMenu);
            return;
        }

        var fm = mc.newSimpleForm();
        fm.setTitle('§l§a' + t('guild.select_online'));
        fm.setContent('§b' + t('guild.online_players', candidates.length));
        for (var j = 0; j < candidates.length; j++) {
            fm.addButton('§a' + candidates[j].name, 'textures/ui/icon_steve');
        }
        fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

        player.sendForm(fm, function(p, id) {
            if (id === null) return;
        if (id === candidates.length) { showInvitePlayerForm(p); return; }
            if (id < candidates.length) {
                var target = candidates[id];
                p.sendModalForm(
                    t('guild.confirm_invite'),
                    t('guild.confirm_invite_body', target.name, guild.name),
                    t('guild.confirm_invite_ok'),
                    t('guild.confirm_cancel'),
                    function(p2, result) {
                        if (!result) { showInvitePlayerForm(p2); return; }
                        doSendInvite(p2, guild, String(target.xuid));
                    }
                );
            }
        });
    } catch (e) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_failed'));
        showInvitePlayerForm(player);
    }
}

/** 搜索玩家邀请表单 - 输入玩家名/UID搜索，找到后需确认 */
function showSearchInviteForm(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b' + t('guild.search_title'));
    fm.addInput(t('guild.search_placeholder'), t('guild.search_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showInvitePlayerForm(p); return; }
        var query = (data[0] || '').trim();
        if (!query) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.search_empty')); showInvitePlayerForm(p); return; }

        var targetXuid = findPlayerXuid(query);
        if (!targetXuid) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.not_found', query)); showSearchInviteForm(p, guild); return; }

        var targetName = getPlayerName(targetXuid);
        p.sendModalForm(
            t('guild.confirm_invite'),
            t('guild.found_player', targetName, targetXuid, guild.name),
            t('guild.confirm_invite_ok'),
            t('guild.confirm_cancel'),
            function(p2, result) {
                if (!result) { showInvitePlayerForm(p2); return; }
                doSendInvite(p2, guild, targetXuid);
            }
        );
    });
}

/** 发送公会邀请的通用函数 */
function doSendInvite(player, guild, targetXuid) {
    var xuid = String(player.xuid);

    if (targetXuid === xuid) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_invite_self')); showInvitePlayerForm(player); return; }

    if (database.getGuildByPlayer(targetXuid)) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_other'));
        showInvitePlayerForm(player);
        return;
    }

    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_full'));
        showInvitePlayerForm(player);
        return;
    }

    // 检查是否已邀请
    var existing = _guildInvites[targetXuid] || [];
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].guildId === guild.id) {
            player.tell(t('guild.tag_prefix') + ' §e' + t('guild.already_invited'));
            showInvitePlayerForm(player);
            return;
        }
    }

    if (!_guildInvites[targetXuid]) _guildInvites[targetXuid] = [];
    var inviteTime = Date.now();
    _guildInvites[targetXuid].push({
        guildId: guild.id,
        guildName: guild.name,
        inviterName: player.name,
        inviterXuid: xuid,
        time: inviteTime
    });
    database.addGuildInviteSQL(targetXuid, guild.id, guild.name, player.name, inviteTime);

    var targetName = getPlayerName(targetXuid);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.invite_sent', targetName));
    try {
        var tp = mc.getPlayer(targetXuid);
        if (tp) tp.tell(t('guild.tag_prefix') + ' §a' + t('guild.invite_received', guild.name));
    } catch (e) {}
    logger.info('[Guild] ' + player.name + ' 邀请 ' + targetName + ' 加入公会: ' + guild.name);
    showInvitePlayerForm(player);
}

// ==================== 管理员面板 ====================

/** 管理员公会管理面板 - 按钮显示公会 */
function showAdminPanel(player) {
    if (!isServerAdmin(player)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_admin_permission')); return; }

    var guilds = database.getAllGuilds();
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§c' + t('guild.admin_title'));

    if (guilds.length === 0) {
        showEmptyTipForm(player, t('guild.admin_panel_empty'), '§a' + t('guild.list_empty'), showMainMenu);
        return;
    }

    for (var j = 0; j < guilds.length; j++) {
        var gm = guilds[j];
        var memCount = database.getMemberCount(gm.id);
        fm.addButton('§a' + gm.name + ' (' + memCount + ' | §6' + gm.fund.toFixed(0) + ')', 'textures/ui/icon_best3');
    }
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === guilds.length) { showMainMenu(p); return; }
        if (id < guilds.length) {
            showAdminGuildManage(p, guilds[id]);
        }
    });
}

/** 管理员 - 选定公会后的管理选项 */
function showAdminGuildManage(player, guild) {
    if (!isServerAdmin(player)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_admin_permission')); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§c' + t('guild.admin_manage', guild.name));
    fm.setContent('§b' + t('guild.owner_prefix_label') + '§f' + getPlayerName(guild.owner) + ' | ' + t('guild.members_count') + '§f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers + ' | ' + t('guild.funds_label') + '§6' + guild.fund.toFixed(2));

    fm.addButton('§a' + t('guild.admin_members'), 'textures/ui/FriendsDiversity');
    fm.addButton('§e' + t('guild.admin_tps'), 'textures/items/compass_item');
    fm.addButton('§6' + t('guild.admin_funds'), 'textures/items/gold_ingot');
    fm.addButton('§d' + t('guild.admin_invite'), 'textures/ui/color_plus');
    fm.addButton('§e' + t('guild.admin_rename'), 'textures/ui/book_edit_default');
    fm.addButton('§c' + t('guild.admin_disband'), 'textures/ui/hammer_l');
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 6) { showAdminPanel(p); return; }
        switch (id) {
            case 0: showAdminMemberManage(p, guild); break;
            case 1: showAdminTeleportManage(p, guild); break;
            case 2: showAdminTreasuryPanel(p, guild); break;
            case 3: showAdminInviteForm(p, guild); break;
            case 4: showAdminChangeGuildName(p, guild); break;
            case 5: doAdminDisbandGuild(p, guild); break;
        }
    });
}

/** 管理员 - 修改公会名称 */
function showAdminChangeGuildName(player, guild) {
    if (!isServerAdmin(player)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_admin_permission')); return; }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e' + t('guild.admin_rename_title', guild.name));
    fm.addLabel('§b' + t('guild.current_name') + '§f' + guild.name);
    fm.addInput(t('guild.new_name_placeholder'), t('guild.guild_name_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminGuildManage(p, guild); return; }
        var newName = (data[1] || '').trim();
        if (!newName) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_empty')); showAdminChangeGuildName(p, guild); return; }
        if (newName.length < 2 || newName.length > 16) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_too_long')); showAdminChangeGuildName(p, guild); return; }
        if (newName === guild.name) { p.tell(t('guild.tag_prefix') + ' §e' + t('guild.name_same')); showAdminGuildManage(p, guild); return; }
        if (database.getGuildByName(newName)) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.name_taken', newName)); showAdminChangeGuildName(p, guild); return; }

        var oldName = guild.name;
        database.updateGuild(guild.id, { name: newName });
        if (chatModule) chatModule.clearAllOrgNameCache();
        p.tell(t('guild.tag_prefix') + ' §a' + t('guild.name_changed', oldName, newName));

        var members = database.getGuildMembers(guild.id);
        for (var i = 0; i < members.length; i++) {
            sendSystemMail(members[i].xuid, '§e' + t('guild.admin_rename_mail', newName, oldName));
            try {
                var tp = mc.getPlayer(members[i].xuid);
                if (tp) tp.sendToast(t('guild.rename_toast'), t('guild.rename_toast_text', newName));
            } catch (e) {}
        }

        logger.info('[Guild] 管理员 ' + p.name + ' 将公会"' + oldName + '"更名为"' + newName + '"');
        var updated = database.getGuild(guild.id);
        if (updated) showAdminGuildManage(p, updated);
        else showAdminPanel(p);
    });
}

/** 管理员 - 成员管理 */
function showAdminMemberManage(player, guild) {
    var members = database.getGuildMembers(guild.id);

    var memberNames = [];
    var memberMap = [];
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? t('guild.role_prefix_owner') : (m.role === 'admin' ? t('guild.role_prefix_admin') : t('guild.role_prefix_member'));
        memberNames.push(mr + ' ' + m.name);
        memberMap.push(m);
    }

    var actions = [t('guild.view_info'), t('guild.action_kick'), t('guild.action_promote'), t('guild.action_demote'), t('guild.action_transfer')];
    var actionKeys = ['info', 'kick', 'promote', 'demote', 'transfer'];

    var fm = mc.newCustomForm();
    fm.setTitle('§l§c' + t('guild.admin_member_title', guild.name, members.length));
    fm.addDropdown(t('guild.select_member'), memberNames, 0);
    fm.addDropdown(t('guild.select_action'), actions, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminGuildManage(p, guild); return; }
        var memberIdx = data[0];
        var actionIdx = data[1];
        var target = memberMap[memberIdx];
        var action = actionKeys[actionIdx];

        if (!target) { showAdminGuildManage(p, guild); return; }

        switch (action) {
            case 'info':
                var rs = target.role === 'owner' ? '§6' + t('guild.owner') : (target.role === 'admin' ? '§b' + t('guild.admin') : '§a' + t('guild.member'));
                var info = '§b' + t('guild.member_name') + '§f' + target.name + '\n§b' + t('guild.xuid_label') + '§f' + target.xuid + '\n§b' + t('guild.role_label') + rs + '\n§b' + t('guild.join_time') + '§f' + new Date(target.joinedAt).toLocaleString();
                var infFm = mc.newSimpleForm();
                infFm.setTitle('§l§b' + t('guild.member_info_title'));
                infFm.setContent(info);
                infFm.addButton('§a' + t('guild.back'), 'textures/ui/recap_glyph_desaturated');
                p.sendForm(infFm, function() { showAdminMemberManage(p, guild); });
                break;
            case 'kick':
                if (target.role === 'owner') { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.cannot_kick_owner')); showAdminMemberManage(p, guild); return; }
                p.sendModalForm(t('guild.confirm_kick'), t('guild.admin_kick_confirm_body', target.name, guild.name), t('guild.confirm_ok'), t('guild.confirm_cancel'), function(p2, r) {
                    if (!r) { showAdminMemberManage(p2, guild); return; }
                    database.removeGuildMember(target.xuid);
                    if (chatModule) chatModule.clearOrgNameCache(target.xuid);
                    p2.tell(t('guild.tag_prefix') + ' §a' + t('guild.kick_success', target.name));
                    sendSystemMail(target.xuid, t('guild.admin_kick_mail2', p2.name, guild.name));
                    try { var tp = mc.getPlayer(target.xuid); if (tp) tp.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_kicked_notify2', guild.name)); } catch (e) {}
                    logger.info('[Guild] 管理员 ' + p2.name + ' 踢出 ' + target.name + ' (公会:' + guild.name + ')');
                    showAdminMemberManage(p2, guild);
                });
                break;
            case 'promote':
                if (target.role === 'owner') { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.only_owner_promote')); showAdminMemberManage(p, guild); return; }
                if (target.role === 'admin') { p.tell(t('guild.tag_prefix') + ' §e' + t('guild.admin_promote_msg')); showAdminMemberManage(p, guild); return; }
                var ac = 0;
                for (var j = 0; j < members.length; j++) { if (members[j].role === 'admin') ac++; }
                if (ac >= (cfg().maxAdmins !== undefined ? cfg().maxAdmins : 3)) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_limit')); showAdminMemberManage(p, guild); return; }
                database.updateMemberRole(target.xuid, 'admin');
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.promote_success', target.name));
                sendSystemMail(target.xuid, '§a' + t('guild.admin_promote_mail2', guild.name));
                try { var tp2 = mc.getPlayer(target.xuid); if (tp2) tp2.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_promote_notify2', guild.name)); } catch (e) {}
                showAdminMemberManage(p, guild);
                break;
            case 'demote':
                if (target.role !== 'admin') { p.tell(t('guild.tag_prefix') + ' §e' + t('guild.not_admin')); showAdminMemberManage(p, guild); return; }
                database.updateMemberRole(target.xuid, 'member');
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.demote_success', target.name));
                sendSystemMail(target.xuid, '§c' + t('guild.admin_demote_mail2', guild.name));
                try { var tp3 = mc.getPlayer(target.xuid); if (tp3) tp3.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_demote_notify2', guild.name)); } catch (e) {}
                showAdminMemberManage(p, guild);
                break;
            case 'transfer':
                if (target.role === 'owner') { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_already_owner')); showAdminMemberManage(p, guild); return; }
                p.sendModalForm(t('guild.admin_transfer_confirm_title'), t('guild.admin_transfer_confirm_body', guild.name, target.name), t('guild.confirm_ok'), t('guild.confirm_cancel'), function(p2, r) {
                    if (!r) { showAdminMemberManage(p2, guild); return; }
                    var oldOwner = guild.owner;
                    database.updateGuild(guild.id, { owner: target.xuid });
                    database.updateMemberRole(target.xuid, 'owner');
                    if (oldOwner !== target.xuid) database.updateMemberRole(oldOwner, 'admin');
                    p2.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_transfer_success2', guild.name, target.name));
                    sendSystemMail(target.xuid, '§a' + t('guild.admin_transfer_mail_new2', guild.name));
                    if (oldOwner !== target.xuid) {
                        sendSystemMail(oldOwner, '§e' + t('guild.admin_transfer_mail_old2', guild.name, target.name));
                    }
                    try { var tp4 = mc.getPlayer(target.xuid); if (tp4) tp4.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_transfer_notify2', guild.name)); } catch (e) {}
                    logger.info('[Guild] 管理员 ' + p2.name + ' 转让公会"' + guild.name + '"给 ' + target.name);
                    showAdminMemberManage(p2, guild);
                });
                break;
        }
    });
}

/** 管理员 - 邀请玩家 */
function showAdminInviteForm(player, guild) {
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§d' + t('guild.invite_title2', guild.name));
    fm.setContent('§b' + t('guild.current_members') + '§f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers);
    fm.addButton('§a' + t('guild.select_online'), 'textures/ui/FriendsDiversity');
    fm.addButton('§b' + t('guild.search_player'), 'textures/ui/magnifyingGlass');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 0) { showAdminOnlinePlayerSelect(p, guild); }
        else if (id === 1) { showAdminSearchInvite(p, guild); }
        else { showAdminGuildManage(p, guild); }
    });
}

/** 管理员 - 在线玩家选择 */
function showAdminOnlinePlayerSelect(player, guild) {
    try {
        var online = mc.getOnlinePlayers();
        var candidates = [];
        for (var i = 0; i < online.length; i++) {
            var op = online[i];
            if (database.getGuildByPlayer(String(op.xuid))) continue;
            candidates.push(op);
        }

        if (candidates.length === 0) {
            showEmptyTipForm(player, '§e' + t('guild.select_online'), '§a' + t('guild.no_online_players'), showMainMenu);
            return;
        }

        var fm = mc.newSimpleForm();
        fm.setTitle('§l§a' + t('guild.select_online'));
        fm.setContent('§b' + t('guild.online_players', candidates.length));
        for (var j = 0; j < candidates.length; j++) {
            fm.addButton('§a' + candidates[j].name, 'textures/ui/icon_steve');
        }
        fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

        player.sendForm(fm, function(p, id) {
            if (id === null) return;
        if (id === candidates.length) { showAdminInviteForm(p); return; }
            if (id < candidates.length) {
                var target = candidates[id];
                p.sendModalForm(
                    t('guild.confirm_invite'),
                    t('guild.confirm_invite_body', target.name, guild.name),
                    t('guild.confirm_invite_ok'),
                    t('guild.confirm_cancel'),
                    function(p2, result) {
                        if (!result) { showAdminInviteForm(p2, guild); return; }
                        doAdminSendInvite(p2, guild, String(target.xuid));
                    }
                );
            }
        });
    } catch (e) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_failed'));
        showAdminInviteForm(player, guild);
    }
}

/** 管理员 - 搜索玩家邀请，找到后需确认 */
function showAdminSearchInvite(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b' + t('guild.search_title'));
    fm.addInput(t('guild.search_placeholder'), t('guild.search_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminInviteForm(p, guild); return; }
        var query = (data[0] || '').trim();
        if (!query) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.search_empty')); showAdminInviteForm(p, guild); return; }

        var targetXuid = findPlayerXuid(query);
        if (!targetXuid) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.not_found', query)); showAdminSearchInvite(p, guild); return; }

        var targetName = getPlayerName(targetXuid);
        p.sendModalForm(
            t('guild.confirm_invite'),
            t('guild.found_player', targetName, targetXuid, guild.name),
            t('guild.confirm_invite_ok'),
            t('guild.confirm_cancel'),
            function(p2, result) {
                if (!result) { showAdminInviteForm(p2, guild); return; }
                doAdminSendInvite(p2, guild, targetXuid);
            }
        );
    });
}

/** 管理员 - 发送邀请的通用函数 */
function doAdminSendInvite(player, guild, targetXuid) {
    if (database.getGuildByPlayer(targetXuid)) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.already_in_other'));
        showAdminInviteForm(player, guild);
        return;
    }

    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
        player.tell(t('guild.tag_prefix') + ' §c' + t('guild.guild_full'));
        showAdminInviteForm(player, guild);
        return;
    }

    var existing = _guildInvites[targetXuid] || [];
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].guildId === guild.id) {
            player.tell(t('guild.tag_prefix') + ' §e' + t('guild.already_invited'));
            showAdminInviteForm(player, guild);
            return;
        }
    }

    if (!_guildInvites[targetXuid]) _guildInvites[targetXuid] = [];
    var adminInviteTime = Date.now();
    _guildInvites[targetXuid].push({
        guildId: guild.id,
        guildName: guild.name,
        inviterName: player.name,
        inviterXuid: String(player.xuid),
        time: adminInviteTime
    });
    database.addGuildInviteSQL(targetXuid, guild.id, guild.name, player.name, adminInviteTime);

    var targetName = getPlayerName(targetXuid);
    player.tell(t('guild.tag_prefix') + ' §a' + t('guild.invite_sent', targetName));
    try { var tp = mc.getPlayer(targetXuid); if (tp) tp.tell(t('guild.tag_prefix') + ' §a' + t('guild.invite_received', guild.name)); } catch (e) {}
    logger.info('[Guild] 管理员 ' + player.name + ' 邀请 ' + targetName + ' 加入公会: ' + guild.name);
    showAdminInviteForm(player, guild);
}

/** 管理员 - 传送点管理 */
function showAdminTeleportManage(player, guild) {
    var tps = database.getGuildTeleports(guild.id);

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§e' + t('guild.admin_tp_title', guild.name));

    var content = '§b' + t('guild.tp_list_title', tps.length + '/' + (cfg().maxTeleports !== undefined ? cfg().maxTeleports : 5)) + '\n';
    if (tps.length > 0) {
        for (var i = 0; i < tps.length; i++) {
            content += '§a' + tps[i].name + ' (X:' + Math.round(tps[i].x) + ' Y:' + Math.round(tps[i].y) + ' Z:' + Math.round(tps[i].z) + ')\n';
        }
    } else {
        content += t('guild.admin_no_tp') + '\n';
    }
    fm.setContent(content);

    fm.addButton('§b' + t('guild.add_tp'), 'textures/ui/color_plus');
    fm.addButton('§c' + t('guild.delete_tp'), 'textures/ui/hammer_l');
    fm.addButton('§d' + t('guild.admin_set_hq'), 'textures/items/bed_red');
    fm.addButton(t('guild.back'), 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 3) { showAdminGuildManage(p); return; }
        switch (id) {
            case 0: showAdminAddTeleportForm(p, guild); break;
            case 1: showAdminDelTeleportForm(p, guild); break;
            case 2:
                var pos = p.pos;
                database.updateGuild(guild.id, { hqX: pos.x, hqY: pos.y, hqZ: pos.z, hqDim: String(p.dimid) });
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_hq_set2', guild.name));
                logger.info('[Guild] 管理员 ' + p.name + ' 设置公会"' + guild.name + '"总部');
                showAdminTeleportManage(p, guild);
                break;
        }
    });
}

/** 管理员 - 添加传送点 */
function showAdminAddTeleportForm(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b' + t('guild.admin_add_tp_title', guild.name));
    fm.addInput(t('guild.tp_name_placeholder'), t('guild.tp_name_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminTeleportManage(p, guild); return; }
        var name = (data[0] || '').trim();
        if (!name) { p.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_name_empty')); showAdminTeleportManage(p, guild); return; }

        var maxTP = cfg().maxTeleports !== undefined ? cfg().maxTeleports : 5;
        if (database.getGuildTeleportCount(guild.id) >= maxTP) {
            p.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_limit', maxTP));
            showAdminTeleportManage(p, guild);
            return;
        }

        if (database.getGuildTeleportByName(guild.id, name)) {
            p.tell(t('guild.tag_prefix') + ' §c' + t('guild.tp_exists', name));
            showAdminTeleportManage(p, guild);
            return;
        }

        var pos = p.pos;
        database.addGuildTeleport(guild.id, name, pos.x, pos.y, pos.z, String(p.dimid), String(p.xuid));
        p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_tp_add_success2', name, guild.name));
        showAdminTeleportManage(p, guild);
    });
}

/** 管理员 - 删除传送点 */
function showAdminDelTeleportForm(player, guild) {
    var tps = database.getGuildTeleports(guild.id);
    if (tps.length === 0) { player.tell(t('guild.tag_prefix') + ' §e' + t('guild.admin_no_tp')); showAdminTeleportManage(player, guild); return; }

    var tpNames = [];
    for (var i = 0; i < tps.length; i++) {
        tpNames.push(tps[i].name + ' (' + Math.round(tps[i].x) + ',' + Math.round(tps[i].y) + ',' + Math.round(tps[i].z) + ')');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§c' + t('guild.admin_del_tp_title', guild.name));
    fm.addDropdown(t('guild.select_tp'), tpNames, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminTeleportManage(p, guild); return; }
        var tpIdx = data[0];
        var tp = tps[tpIdx];
        if (!tp) { showAdminTeleportManage(p, guild); return; }
        database.removeGuildTeleport(tp.id, guild.id);
        p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_tp_deleted2', tp.name));
        showAdminTeleportManage(p, guild);
    });
}

/** 管理员 - 资金管理 */
function showAdminTreasuryPanel(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§6' + t('guild.admin_treasury_title', guild.name));
    fm.addLabel('§b' + t('guild.current_funds') + '§f' + guild.fund.toFixed(2) + ' ' + getCurrencyName());
    fm.addDropdown(t('guild.select_operation'), [t('guild.admin_set_amount'), t('guild.admin_deposit'), t('guild.admin_withdraw')], 0);
    fm.addInput(t('guild.amount_label'), t('guild.amount_placeholder'), '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminGuildManage(p, guild); return; }

        var opIdx = data[1];
        var amountStr = (data[2] || '').trim();
        var amount = parseFloat(amountStr);

        if (!amountStr || isNaN(amount) || amount < 0) {
            p.tell(t('guild.tag_prefix') + ' §c' + t('guild.invalid_amount'));
            showAdminTreasuryPanel(p, guild);
            return;
        }

        switch (opIdx) {
            case 0:
                database.updateGuild(guild.id, { fund: amount });
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_fund_set_success', guild.name, amount.toFixed(2)));
                logger.info('[Guild] 管理员 ' + p.name + ' 设置公会"' + guild.name + '"资金为 ' + amount);
                break;
            case 1:
                database.updateGuildFundAdd(guild.id, amount);
                p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_fund_deposit_success', guild.name, amount.toFixed(2)));
                logger.info('[Guild] 管理员 ' + p.name + ' 向公会"' + guild.name + '"存入 ' + amount);
                break;
            case 2:
                if (!database.updateGuildFundReduce(guild.id, amount)) {
                    p.tell(t('guild.tag_prefix') + ' §c' + t('guild.fund_insufficient'));
                } else {
                    p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_fund_withdraw_success', guild.name, amount.toFixed(2)));
                    logger.info('[Guild] 管理员 ' + p.name + ' 从公会"' + guild.name + '"取出 ' + amount);
                }
                break;
        }

        var updated = database.getGuild(guild.id);
        if (updated) showAdminGuildManage(p, updated);
        else showAdminPanel(p);
    });
}

/** 管理员 - 解散公会 */
function doAdminDisbandGuild(player, guild) {
    if (!isServerAdmin(player)) { player.tell(t('guild.tag_prefix') + ' §c' + t('guild.no_admin_permission')); return; }

    var memberCount = database.getMemberCount(guild.id);
    player.sendModalForm(
        t('guild.admin_disband_confirm'),
        t('guild.admin_disband_body2', guild.name, getPlayerName(guild.owner), memberCount, guild.fund.toFixed(2)),
        t('guild.confirm_disband_ok'),
        t('guild.confirm_cancel'),
        function(p, result) {
            if (!result) { showAdminGuildManage(p, guild); return; }
            var members = database.getGuildMembers(guild.id);
            var disbandGuildName = guild.name;
            for (var i = 0; i < members.length; i++) {
                sendSystemMail(members[i].xuid, t('guild.admin_disband_mail_content', disbandGuildName));
                try { var mp = mc.getPlayer(members[i].xuid); if (mp) mp.tell(t('guild.tag_prefix') + ' §c' + t('guild.admin_disband_notify2', disbandGuildName)); } catch (e) {}
            }
            database.deleteGuild(guild.id);
            if (chatModule) chatModule.clearAllOrgNameCache();
            p.tell(t('guild.tag_prefix') + ' §a' + t('guild.admin_disband_success2', guild.name));
            logger.info('[Guild] 管理员 ' + p.name + ' 解散公会: ' + guild.name + ' (ID:' + guild.id + ')');
            showAdminPanel(p);
        }
    );
}

module.exports = {
    init: init,
    handleCommand: handleCommand,
    showMainMenu: showMainMenu
};
