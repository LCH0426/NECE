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
 * 公会创建/解散、成员管理、传送点、总部、公会金库、申请加入/邀请
 */

const database = require('./database');

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
let getConfig = null;       // () => guildConfig
let getCurrencyName = null;
let getPlayerName = null;   // (xuid) => name
let getPlayerData = null;   // () => playerData
let mailApi = null;         // 邮件模块
let chatModule = null;      // 聊天模块（用于清除公会名缓存）
let notifyEconomyChange = null;

/** 模块初始化 */
function init(deps) {
    logger = deps.logger || { info: console.log, warn: console.log, error: console.error };
    getPlayerMoney = deps.getPlayerMoney || function() { return 0; };
    addPlayerMoney = deps.addPlayerMoney || function() { return false; };
    reducePlayerMoney = deps.reducePlayerMoney || function() { return false; };
    getConfig = deps.getConfig || function() { return {}; };
    getCurrencyName = deps.getCurrencyName || function() { return '金币'; };
    getPlayerName = deps.getPlayerName || function(xuid) { return xuid; };
    getPlayerData = deps.getPlayerData || function() { return null; };
    mailApi = deps.mailApi || null;
    chatModule = deps.chatModule || null;
    notifyEconomyChange = deps.notifyEconomyChange || function() {};
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
    player.sendModalForm(title, text, '§a返回', '§c关闭', function(p, result) {
        if (result && backFn) backFn(p);
    });
}

/**
 * 发送系统邮件给指定玩家
 * @param {string} xuid - 收件人XUID
 * @param {string} content - 邮件内容
 */
function sendSystemMail(xuid, content) {
    if (!mailApi || !mailApi.addMail) return;
    try {
        var mailId = mailApi.getNextId ? mailApi.getNextId() : Date.now();
        if (mailApi.incrementNextId) mailApi.incrementNextId();
        var timeStr = mailApi.formatMailTime ? mailApi.formatMailTime() : new Date().toLocaleString();
        mailApi.addMail({
            id: mailId,
            fromXuid: 'system',
            fromName: '系统',
            toXuid: String(xuid),
            content: content,
            time: timeStr,
            read: false,
            starQian: 0,
            items: [],
            claimed: false
        });
        // 收件人在线时推送通知
        try {
            var tp = mc.getPlayer(String(xuid));
            if (tp) {
                tp.sendToast('§e新邮件提醒', '§a您收到了一封系统邮件');
                tp.tell('§e[邮件] §a您收到了一封系统邮件，请在邮件系统中查看');
            }
        } catch (e) {}
    } catch (e) {
        logger.warn('[Guild] 发送系统邮件失败: ' + e.message);
    }
}

/** 安全传送玩家 */
function safeTeleport(player, x, y, z, dim) {
    try {
        player.teleport(new FloatPos(x, y, z, dim));
        return true;
    } catch (e) {
        try {
            player.runcmd('tp ' + x + ' ' + y + ' ' + z);
            return true;
        } catch (e2) {
            return false;
        }
    }
}

/** 检查并设置传送冷却 */
function checkCooldown(xuid) {
    var cd = cfg().teleportCooldown || 10;
    if (guildTpCooldowns[xuid]) {
        var remaining = Math.ceil((guildTpCooldowns[xuid] - Date.now()) / 1000);
        if (remaining > 0) return remaining;
    }
    guildTpCooldowns[xuid] = Date.now() + cd * 1000;
    return 0;
}

/** 检查玩家是否为服务器管理员（OP） */
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
        player.tell('§e[公会] §c你已经在一个公会中了，请先退出当前公会');
        return;
    }

    if (!name || name.length < 2 || name.length > 16) {
        player.tell('§e[公会] §c公会名称长度需在2-16个字符之间');
        return;
    }

    if (database.getGuildByName(name)) {
        player.tell('§e[公会] §c公会名称"' + name + '"已被使用');
        return;
    }

    var cost = cfg().createCost || 1000;
    if (cost > 0) {
        var balance = getPlayerMoney(player);
        if (balance < cost) {
            player.tell('§e[公会] §c创建公会需要 ' + cost + ' ' + getCurrencyName() + '，你只有 ' + balance);
            return;
        }
        reducePlayerMoney(player, cost, '创建公会');
    }

    var maxMembers = cfg().maxMembers || 20;
    var guildId = database.createGuild(name, description, xuid, maxMembers);
    player.tell('§e[公会] §a公会"' + name + '"创建成功！');
    logger.info('[Guild] 玩家 ' + player.name + ' 创建公会: ' + name + ' (ID:' + guildId + ')');
}

/** 解散公会（确认弹窗） */
function doDisbandGuild(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    if (guild.owner !== xuid) { player.tell('§e[公会] §c只有会长才能解散公会'); return; }

    player.sendModalForm(
        '§c确认解散公会',
        '你确定要解散公会"' + guild.name + '"吗？\n§e此操作不可撤销，所有成员和传送点将被清除！',
        '§c确认解散',
        '§a取消',
        function(p, result) {
            if (!result) return;
            var members = database.getGuildMembers(guild.id);
            var disbandName = guild.name;
            for (var mi = 0; mi < members.length; mi++) {
                sendSystemMail(members[mi].xuid, '§c§6' + disbandName + '§c公会已被会长解散');
                try { var mp = mc.getPlayer(members[mi].xuid); if (mp) mp.tell('§e[公会] §c公会"' + disbandName + '"已被会长解散'); } catch (e) {}
            }
            database.deleteGuild(guild.id);
            if (chatModule) chatModule.clearAllOrgNameCache();
            p.tell('§e[公会] §a公会"' + disbandName + '"已解散');
            logger.info('[Guild] 玩家 ' + p.name + ' 解散公会: ' + disbandName);
        }
    );
}

/** 查看公会信息 */
function doShowInfo(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }

    var members = database.getGuildMembers(guild.id);
    var tps = database.getGuildTeleports(guild.id);
    var ownerName = getPlayerName(guild.owner);
    var myRole = getEffectiveRole(player, guild);
    var roleStr = myRole === 'owner' ? '§6会长' : (myRole === 'admin' ? '§b管理员' : '§a成员');
    var hqStr = guild.hqX != null ? ('X:' + Math.round(guild.hqX) + ' Y:' + Math.round(guild.hqY) + ' Z:' + Math.round(guild.hqZ)) : '未设置';

    var content = '§b公会名称: §f' + guild.name + '\n' +
        '§b公会描述: §f' + (guild.description || '无') + '\n' +
        '§b会长: §f' + ownerName + '\n' +
        '§b你的身份: ' + roleStr + '\n' +
        '§b等级: §f' + guild.level + '\n' +
        '§b成员数: §f' + members.length + '/' + guild.maxMembers + '\n' +
        '§b传送点: §f' + tps.length + '/' + (cfg().maxTeleports || 5) + '\n' +
        '§b公会资金: §f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + '\n' +
        '§b总部位置: §f' + hqStr;

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b公会信息 - ' + guild.name);
    fm.setContent(content);
    fm.addButton('§a返回', 'textures/ui/recap_glyph_desaturated');
    player.sendForm(fm, function() { showMainMenu(player); });
}

/** 列出所有公会 - 按钮显示，点击查看详情 */
function doListGuilds(player) {
    var guilds = database.getAllGuilds();
    if (guilds.length === 0) { showEmptyTipForm(player, '§e公会列表', '§a当前没有任何公会。', showMainMenu); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b公会列表');

    for (var i = 0; i < guilds.length; i++) {
        var g = guilds[i];
        var mc2 = database.getMemberCount(g.id);
        var ownerName = getPlayerName(g.owner);
        fm.addButton('§a' + g.name + ' | 会长:§f' + ownerName + ' | §e' + mc2 + '/' + g.maxMembers + '人', 'textures/ui/icon_best3');
    }
    fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null || id === guilds.length) { showMainMenu(p); return; }
        if (id < guilds.length) {
            showGuildDetail(p, guilds[id]);
        }
    });
}

/** 显示公会详情（从公会列表点击进入） */
function showGuildDetail(player, guild) {
    var members = database.getGuildMembers(guild.id);
    var tps = database.getGuildTeleports(guild.id);
    var ownerName = getPlayerName(guild.owner);
    var hqStr = guild.hqX != null ? ('X:' + Math.round(guild.hqX) + ' Y:' + Math.round(guild.hqY) + ' Z:' + Math.round(guild.hqZ)) : '未设置';

    var content = '§b公会名称: §f' + guild.name + '\n' +
        '§b描述: §f' + (guild.description || '无') + '\n' +
        '§b会长: §f' + ownerName + '\n' +
        '§b等级: §f' + guild.level + '\n' +
        '§b成员: §f' + members.length + '/' + guild.maxMembers + '\n' +
        '§b传送点: §f' + tps.length + '\n' +
        '§b资金: §f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + '\n' +
        '§b总部: §f' + hqStr;

    content += '\n\n§b--- 成员 ---';
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? '§6会长' : (m.role === 'admin' ? '§b管理' : '§a成员');
        content += '\n' + mr + ' §f' + m.name;
    }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b' + guild.name);
    fm.setContent(content);
    var myXuid = String(player.xuid);
    var myGuild = database.getGuildByPlayer(myXuid);
    if (!myGuild) {
        fm.addButton('§a申请加入公会', 'textures/ui/color_plus');
    }
    fm.addButton('§7返回公会列表', 'textures/ui/back');

    player.sendForm(fm, function(p, id) {
        if (id === null) { doListGuilds(p); return; }
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
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }

    var tp = database.getGuildTeleportByName(guild.id, tpName);
    if (!tp) { player.tell('§e[公会] §c公会中没有名为"' + tpName + '"的传送点'); return; }

    var remain = checkCooldown(xuid);
    if (remain > 0) { player.tell('§e[公会] §c传送冷却中，请等待 ' + remain + ' 秒'); return; }

    if (safeTeleport(player, tp.x, tp.y, tp.z, tp.dim)) {
        player.tell('§e[公会] §a已传送到公会传送点: ' + tp.name);
    } else {
        player.tell('§e[公会] §c传送失败');
    }
}

/** 传送到公会总部 */
function doTeleportHQ(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    if (guild.hqX == null) {
        showEmptyTipForm(player, '§c总部未设置', '§e公会总部尚未设置，请联系会长或管理员设置总部后重试。', showMainMenu);
        return;
    }

    var remain = checkCooldown(xuid);
    if (remain > 0) { player.tell('§e[公会] §c传送冷却中，请等待 ' + remain + ' 秒'); return; }

    if (safeTeleport(player, guild.hqX, guild.hqY, guild.hqZ, guild.hqDim)) {
        player.tell('§e[公会] §a已传送到公会总部');
    } else {
        player.tell('§e[公会] §c传送失败');
    }
}

/** 设置公会总部（会长/管理员） */
function doSetHQ(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能设置总部'); return; }

    var pos = player.pos;
    database.updateGuild(guild.id, { hqX: pos.x, hqY: pos.y, hqZ: pos.z, hqDim: String(player.dimid) });
    player.tell('§e[公会] §a公会总部已设置在当前位置: X:' + Math.round(pos.x) + ' Y:' + Math.round(pos.y) + ' Z:' + Math.round(pos.z));
}

/** 存入公会资金 */
function doDeposit(player, amount) {
    if (!amount || amount <= 0 || isNaN(amount)) { player.tell('§e[公会] §c请输入有效金额'); return; }
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }

    var balance = getPlayerMoney(player);
    if (balance < amount) { player.tell('§e[公会] §c余额不足，当前余额: ' + balance); return; }

    reducePlayerMoney(player, amount, '存入公会资金');
    database.updateGuild(guild.id, { fund: guild.fund + amount });
    player.tell('§e[公会] §a已存入 ' + amount.toFixed(2) + ' ' + getCurrencyName() + ' 到公会资金');
    logger.info('[Guild] ' + player.name + ' 存入公会"' + guild.name + '" ' + amount);
}

/** 取出公会资金 */
function doWithdraw(player, amount) {
    if (!amount || amount <= 0 || isNaN(amount)) { player.tell('§e[公会] §c请输入有效金额'); return; }
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }

    var role = getEffectiveRole(player, guild);
    var adminOnly = cfg().withdrawAdminOnly;
    if (adminOnly && role !== 'owner' && role !== 'admin') {
        player.tell('§e[公会] §c只有会长或管理员才能取出公会资金');
        return;
    }

    if (guild.fund < amount) { player.tell('§e[公会] §c公会资金不足，当前: ' + guild.fund.toFixed(2)); return; }

    addPlayerMoney(player, amount, '取出公会资金');
    database.updateGuild(guild.id, { fund: guild.fund - amount });
    player.tell('§e[公会] §a已从公会资金取出 ' + amount.toFixed(2) + ' ' + getCurrencyName());
    logger.info('[Guild] ' + player.name + ' 从公会"' + guild.name + '"取出 ' + amount);
}

/** 添加公会传送点 */
function doAddTeleport(player, tpName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能添加传送点'); return; }

    var maxTP = cfg().maxTeleports || 5;
    if (database.getGuildTeleportCount(guild.id) >= maxTP) {
        player.tell('§e[公会] §c传送点数量已达上限 (' + maxTP + ')');
        return;
    }

    if (database.getGuildTeleportByName(guild.id, tpName)) {
        player.tell('§e[公会] §c传送点"' + tpName + '"已存在');
        return;
    }

    var pos = player.pos;
    var dimStr = String(player.dimid);
    database.addGuildTeleport(guild.id, tpName, pos.x, pos.y, pos.z, dimStr, xuid);
    player.tell('§e[公会] §a公会传送点"' + tpName + '"已添加');
}

/** 删除公会传送点 */
function doDelTeleport(player, tpName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能删除传送点'); return; }

    var tp = database.getGuildTeleportByName(guild.id, tpName);
    if (!tp) { player.tell('§e[公会] §c传送点"' + tpName + '"不存在'); return; }

    database.removeGuildTeleport(tp.id, guild.id);
    player.tell('§e[公会] §a公会传送点"' + tpName + '"已删除');
}

/** 踢出成员 */
function doKickMember(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能踢出成员'); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell('§e[公会] §c公会中没有名为"' + targetName + '"的成员'); return; }
    if (target.xuid === xuid) { player.tell('§e[公会] §c不能踢出自己'); return; }
    if (target.role === 'owner') { player.tell('§e[公会] §c不能踢出会长'); return; }
    if (role === 'admin' && target.role === 'admin') { player.tell('§e[公会] §c管理员不能踢出其他管理员'); return; }

    database.removeGuildMember(target.xuid);
    if (chatModule) chatModule.clearOrgNameCache(target.xuid);
    player.tell('§e[公会] §a已将"' + targetName + '"踢出公会');
    sendSystemMail(target.xuid, '§c' + player.name + '已将您从"' + guild.name + '"公会移除');
    try {
        var targetPlayer = mc.getPlayer(target.xuid);
        if (targetPlayer) targetPlayer.tell('§e[公会] §c你已被踢出公会"' + guild.name + '"');
    } catch (e) {}
    logger.info('[Guild] ' + player.name + ' 踢出 ' + targetName + ' (公会:' + guild.name + ')');
}

/** 提升为管理员 */
function doPromote(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    if (guild.owner !== xuid) { player.tell('§e[公会] §c只有会长才能提升成员'); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell('§e[公会] §c公会中没有名为"' + targetName + '"的成员'); return; }
    if (target.role === 'owner') { player.tell('§e[公会] §c不能操作会长'); return; }
    if (target.role === 'admin') { player.tell('§e[公会] §e该玩家已经是管理员'); return; }

    var adminCount = 0;
    for (var j = 0; j < members.length; j++) {
        if (members[j].role === 'admin') adminCount++;
    }
    var maxAdmins = cfg().maxAdmins || 3;
    if (adminCount >= maxAdmins) { player.tell('§e[公会] §c管理员数量已达上限 (' + maxAdmins + ')'); return; }

    database.updateMemberRole(target.xuid, 'admin');
    player.tell('§e[公会] §a已将"' + targetName + '"提升为管理员');
    sendSystemMail(target.xuid, '§a您已被§6' + guild.name + '§a公会会长提拔为管理员');
    try {
        var tp = mc.getPlayer(target.xuid);
        if (tp) tp.tell('§e[公会] §a你已被提升为公会"' + guild.name + '"的管理员');
    } catch (e) {}
}

/** 降为普通成员 */
function doDemote(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    if (guild.owner !== xuid) { player.tell('§e[公会] §c只有会长才能降级成员'); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell('§e[公会] §c公会中没有名为"' + targetName + '"的成员'); return; }
    if (target.role !== 'admin') { player.tell('§e[公会] §e该玩家不是管理员'); return; }

    database.updateMemberRole(target.xuid, 'member');
    player.tell('§e[公会] §a已将"' + targetName + '"降为普通成员');
    sendSystemMail(target.xuid, '§c您已被§6' + guild.name + '§c公会会长移除了该公会的管理员权限');
    try {
        var tp = mc.getPlayer(target.xuid);
        if (tp) tp.tell('§e[公会] §c你已被降为公会"' + guild.name + '"的普通成员');
    } catch (e) {}
}

/** 转让会长 */
function doTransfer(player, targetName) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    if (guild.owner !== xuid) { player.tell('§e[公会] §c只有会长才能转让公会'); return; }

    var members = database.getGuildMembers(guild.id);
    var target = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === targetName) { target = members[i]; break; }
    }
    if (!target) { player.tell('§e[公会] §c公会中没有名为"' + targetName + '"的成员'); return; }
    if (target.xuid === xuid) { player.tell('§e[公会] §c不能转让给自己'); return; }

    player.sendModalForm(
        '§e确认转让公会',
        '你确定要将公会"' + guild.name + '"的会长转让给"' + targetName + '"吗？\n§c转让后你将成为管理员，此操作不可撤销！',
        '§a确认转让',
        '§c取消',
        function(p, result) {
            if (!result) return;
            database.updateGuild(guild.id, { owner: target.xuid });
            database.updateMemberRole(target.xuid, 'owner');
            database.updateMemberRole(xuid, 'admin');
            p.tell('§e[公会] §a公会已转让给"' + targetName + '"');
            sendSystemMail(target.xuid, '§a你已被§e' + p.name + '§a任命为公会§6' + guild.name + '§a的新会长');
            sendSystemMail(xuid, '§e你已将公会§6' + guild.name + '§e的会长转让给§a' + targetName);
            try {
                var tp = mc.getPlayer(target.xuid);
                if (tp) tp.tell('§e[公会] §a你已成为公会"' + guild.name + '"的新会长');
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

        // 按uid精确匹配（数字）
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

        // 按玩家名精确匹配（不区分大小写）
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
    fm.setTitle('§l§b公会系统');

    var isAdmin = isServerAdmin(player);

    if (guild) {
        var role = getEffectiveRole(player, guild);
        var roleStr = role === 'owner' ? '§6会长' : (role === 'admin' ? '§b管理员' : '§a成员');
        var pendingCount = (_joinRequests[guild.id] || []).length;
        var pendingStr = pendingCount > 0 ? '\n§e有 ' + pendingCount + ' 条加入申请待处理' : '';
        fm.setContent('§b当前公会: §f' + guild.name + ' (' + roleStr + '§f)\n§b资金: §f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + pendingStr);

        fm.addButton('§b公会信息', 'textures/ui/icon_book_writable');
        fm.addButton('§a成员管理', 'textures/ui/FriendsDiversity');
        fm.addButton('§e传送点管理', 'textures/items/compass_item');
        fm.addButton('§6公积金', 'textures/ui/MCoin.png');
        fm.addButton('§d传送到总部', 'textures/items/bed_red');
        fm.addButton('§9公会列表', 'textures/ui/icon_best3');
        if (role === 'owner' || role === 'admin') {
            fm.addButton('§d邀请玩家', 'textures/ui/color_plus');
            fm.addButton('§e处理申请' + (pendingCount > 0 ? ' §c(' + pendingCount + ')' : ''), 'textures/ui/icon_book_writable');
        }
        if (isAdmin) {
            fm.addButton('§c管理面板', 'textures/ui/op');
        }
        fm.addButton('§c退出公会', 'textures/ui/refresh_light');
    } else {
        var myInvites = _guildInvites[xuid] || [];
        var inviteStr = myInvites.length > 0 ? '\n§e你有 ' + myInvites.length + ' 条公会邀请' : '';
        fm.setContent('§e你还没有加入任何公会' + inviteStr);
        fm.addButton('§9查看所有公会', 'textures/ui/icon_best3');
        fm.addButton('§d处理请求', 'textures/ui/FriendsDiversity');
        if (myInvites.length > 0) {
            fm.addButton('§e查看邀请 §c(' + myInvites.length + ')', 'textures/ui/icon_book_writable');
        }
        if (isAdmin) {
            fm.addButton('§c管理面板', 'textures/ui/op');
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
    fm.setTitle('§l§a创建公会');
    fm.addInput('公会名称', '2-16个字符', '');
    fm.addInput('公会描述', '可选', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var name = (data[0] || '').trim();
        var desc = (data[1] || '').trim();
        if (!name) { p.tell('§e[公会] §c公会名称不能为空'); return; }
        doCreateGuild(p, name, desc);
    });
}

/** 公会信息面板 */
function showGuildInfoPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }

    var members = database.getGuildMembers(guild.id);
    var tps = database.getGuildTeleports(guild.id);
    var ownerName = getPlayerName(guild.owner);
    var role = getEffectiveRole(player, guild);
    var roleStr = role === 'owner' ? '§6会长' : (role === 'admin' ? '§b管理员' : '§a成员');
    var hqStr = guild.hqX != null ? ('X:' + Math.round(guild.hqX) + ' Y:' + Math.round(guild.hqY) + ' Z:' + Math.round(guild.hqZ)) : '未设置';

    var content = '§b公会名称: §f' + guild.name + '\n' +
        '§b描述: §f' + (guild.description || '无') + '\n' +
        '§b会长: §f' + ownerName + '\n' +
        '§b你的身份: ' + roleStr + '\n' +
        '§b等级: §f' + guild.level + '\n' +
        '§b成员: §f' + members.length + '/' + guild.maxMembers + '\n' +
        '§b传送点: §f' + tps.length + '/' + (cfg().maxTeleports || 5) + '\n' +
        '§b资金: §f' + guild.fund.toFixed(2) + ' ' + getCurrencyName() + '\n' +
        '§b总部: §f' + hqStr;

    content += '\n\n§b--- 成员列表 ---';
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? '§6会长' : (m.role === 'admin' ? '§b管理' : '§a成员');
        content += '\n' + mr + ' §f' + m.name;
    }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b公会信息 - ' + guild.name);
    fm.setContent(content);
    if (role === 'owner' || role === 'admin') {
        fm.addButton('§e修改公会名称', 'textures/ui/book_edit_default');
    }
    fm.addButton('§a返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) { showMainMenu(p); return; }
        if (role === 'owner' || role === 'admin') {
            if (id === 0) { showChangeGuildNameForm(p, guild); return; }
        }
        showMainMenu(p);
    });
}

/** 修改公会名称表单（会长/管理员） */
function showChangeGuildNameForm(player, guild) {
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能修改公会名称'); return; }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e修改公会名称');
    fm.addLabel('§b当前名称: §f' + guild.name);
    fm.addInput('新公会名称', '2-16个字符', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showGuildInfoPanel(p); return; }
        var newName = (data[1] || '').trim();
        if (!newName) { p.tell('§e[公会] §c公会名称不能为空'); showChangeGuildNameForm(p, guild); return; }
        if (newName.length < 2 || newName.length > 16) { p.tell('§e[公会] §c公会名称长度需在2-16个字符之间'); showChangeGuildNameForm(p, guild); return; }
        if (newName === guild.name) { p.tell('§e[公会] §e新名称与当前名称相同'); showGuildInfoPanel(p); return; }
        if (database.getGuildByName(newName)) { p.tell('§e[公会] §c公会名称"' + newName + '"已被使用'); showChangeGuildNameForm(p, guild); return; }

        var oldName = guild.name;
        database.updateGuild(guild.id, { name: newName });
        if (chatModule) chatModule.clearAllOrgNameCache();
        p.tell('§e[公会] §a公会名称已从"' + oldName + '"修改为"' + newName + '"');

        // 通知所有成员
        var members = database.getGuildMembers(guild.id);
        for (var i = 0; i < members.length; i++) {
            sendSystemMail(members[i].xuid, '§e公会名称已由§a' + p.name + '§e修改为§6' + newName + '§e（原名:§f' + oldName + '§e）');
            try {
                var tp = mc.getPlayer(members[i].xuid);
                if (tp) tp.sendToast('§e[公会] §e公会更名', '§a公会已更名为 ' + newName);
            } catch (e) {}
        }

        logger.info('[Guild] ' + p.name + ' 将公会"' + oldName + '"更名为"' + newName + '"');
        // 重新读取公会数据后返回信息面板
        var updated = database.getGuild(guild.id);
        if (updated) showGuildInfoPanel(p);
        else showMainMenu(p);
    });
}

/** 成员管理面板 - 使用下拉菜单选择成员和操作 */
function showMemberManagePanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);

    var members = database.getGuildMembers(guild.id);
    var memberNames = [];
    var memberMap = [];
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? '[会长]' : (m.role === 'admin' ? '[管理]' : '[成员]');
        memberNames.push(mr + ' ' + m.name);
        memberMap.push(m);
    }

    var actions = ['查看信息'];
    var actionKeys = ['info'];
    if (role === 'owner' || role === 'admin') {
        actions.push('踢出公会');
        actionKeys.push('kick');
    }
    if (role === 'owner') {
        actions.push('设置管理员');
        actionKeys.push('promote');
        actions.push('移除管理员');
        actionKeys.push('demote');
        actions.push('转让会长');
        actionKeys.push('transfer');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§a成员管理 (' + members.length + '/' + guild.maxMembers + ')');
    fm.addDropdown('选择成员', memberNames, 0);
    fm.addDropdown('选择操作', actions, 0);

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
                if (target.xuid === xuid) { p.tell('§e[公会] §c不能踢出自己'); showMemberManagePanel(p); return; }
                if (target.role === 'owner') { p.tell('§e[公会] §c不能踢出会长'); showMemberManagePanel(p); return; }
                if (role === 'admin' && target.role === 'admin') { p.tell('§e[公会] §c管理员不能踢出其他管理员'); showMemberManagePanel(p); return; }
                p.sendModalForm('§c确认踢出', '确定要将"' + target.name + '"踢出公会吗？', '§c确认', '§a取消', function(p2, r) {
                    if (!r) { showMemberManagePanel(p2); return; }
                    database.removeGuildMember(target.xuid);
                    if (chatModule) chatModule.clearOrgNameCache(target.xuid);
                    p2.tell('§e[公会] §a已将"' + target.name + '"踢出公会');
                    sendSystemMail(target.xuid, '§c' + p2.name + '已将您从"' + guild.name + '"公会移除');
                    try { var tp = mc.getPlayer(target.xuid); if (tp) tp.tell('§e[公会] §c你已被踢出公会"' + guild.name + '"'); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 踢出 ' + target.name + ' (公会:' + guild.name + ')');
                    showMemberManagePanel(p2);
                });
                break;
            case 'promote':
                if (target.role === 'owner') { p.tell('§e[公会] §c不能操作会长'); showMemberManagePanel(p); return; }
                if (target.role === 'admin') { p.tell('§e[公会] §e该玩家已经是管理员'); showMemberManagePanel(p); return; }
                var adminCount = 0;
                for (var j = 0; j < members.length; j++) { if (members[j].role === 'admin') adminCount++; }
                if (adminCount >= (cfg().maxAdmins || 3)) { p.tell('§e[公会] §c管理员数量已达上限'); showMemberManagePanel(p); return; }
                database.updateMemberRole(target.xuid, 'admin');
                p.tell('§e[公会] §a已将"' + target.name + '"提升为管理员');
                sendSystemMail(target.xuid, '§a您已被§6' + guild.name + '§a公会会长提拔为管理员');
                try { var tp2 = mc.getPlayer(target.xuid); if (tp2) tp2.tell('§e[公会] §a你已被提升为公会"' + guild.name + '"的管理员'); } catch (e) {}
                showMemberManagePanel(p);
                break;
            case 'demote':
                if (target.role !== 'admin') { p.tell('§e[公会] §e该玩家不是管理员'); showMemberManagePanel(p); return; }
                database.updateMemberRole(target.xuid, 'member');
                p.tell('§e[公会] §a已将"' + target.name + '"降为普通成员');
                sendSystemMail(target.xuid, '§c您已被§6' + guild.name + '§c公会会长移除了该公会的管理员权限');
                try { var tp3 = mc.getPlayer(target.xuid); if (tp3) tp3.tell('§e[公会] §c你已被降为公会"' + guild.name + '"的普通成员'); } catch (e) {}
                showMemberManagePanel(p);
                break;
            case 'transfer':
                if (target.xuid === xuid) { p.tell('§e[公会] §c不能转让给自己'); showMemberManagePanel(p); return; }
                p.sendModalForm('§d确认转让', '确定要将公会"' + guild.name + '"的会长转让给"' + target.name + '"吗？', '§a确认', '§c取消', function(p2, r) {
                    if (!r) { showMemberManagePanel(p2); return; }
                    database.updateGuild(guild.id, { owner: target.xuid });
                    database.updateMemberRole(target.xuid, 'owner');
                    database.updateMemberRole(xuid, 'admin');
                    p2.tell('§e[公会] §a公会已转让给"' + target.name + '"');
                    sendSystemMail(target.xuid, '§a你已被§e' + p2.name + '§a任命为公会§6' + guild.name + '§a的新会长');
                    sendSystemMail(xuid, '§e你已将公会§6' + guild.name + '§e的会长转让给§a' + target.name);
                    try { var tp4 = mc.getPlayer(target.xuid); if (tp4) tp4.tell('§e[公会] §a你已成为公会"' + guild.name + '"的新会长'); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 转让公会"' + guild.name + '"给 ' + target.name);
                    showMemberManagePanel(p2);
                });
                break;
        }
    });
}

/** 查看成员信息 */
function showMemberInfo(player, guild, member) {
    var roleStr = member.role === 'owner' ? '§6会长' : (member.role === 'admin' ? '§b管理员' : '§a成员');
    var content = '§b成员名: §f' + member.name + '\n' +
        '§bXUID: §f' + member.xuid + '\n' +
        '§b身份: ' + roleStr + '\n' +
        '§b加入时间: §f' + new Date(member.joinedAt).toLocaleString();

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§b成员信息');
    fm.setContent(content);
    fm.addButton('§a返回', 'textures/ui/recap_glyph_desaturated');
    player.sendForm(fm, function() { showMemberManagePanel(player); });
}

/** 传送点管理面板 */
function showTeleportPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);

    var tps = database.getGuildTeleports(guild.id);
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§e传送点管理');

    var content = '§b传送点 (' + tps.length + '/' + (cfg().maxTeleports || 5) + ')\n';
    if (tps.length > 0) {
        for (var i = 0; i < tps.length; i++) {
            content += '§a' + tps[i].name + ' (X:' + Math.round(tps[i].x) + ' Y:' + Math.round(tps[i].y) + ' Z:' + Math.round(tps[i].z) + ')\n';
        }
    } else {
        content += '暂无传送点\n';
    }
    fm.setContent(content);

    for (var j = 0; j < tps.length; j++) {
        fm.addButton('§a传送: ' + tps[j].name, 'textures/items/ender_pearl');
    }
    var btnOffset = tps.length;
    if (role === 'owner' || role === 'admin') {
        fm.addButton('§b添加传送点', 'textures/ui/color_plus');
        fm.addButton('§c删除传送点', 'textures/ui/hammer_l');
        fm.addButton('§6设置总部', 'textures/items/bed_red');
    }
    fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null) { showMainMenu(p); return; }
        if (id < btnOffset) {
            var tp = tps[id];
            var remain = checkCooldown(String(p.xuid));
            if (remain > 0) { p.tell('§e[公会] §c传送冷却中，请等待 ' + remain + ' 秒'); return; }
            if (safeTeleport(p, tp.x, tp.y, tp.z, tp.dim)) {
                p.tell('§e[公会] §a已传送到: ' + tp.name);
            } else {
                p.tell('§e[公会] §c传送失败');
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
    fm.setTitle('§l§b添加公会传送点');
    fm.addInput('传送点名称', '请输入名称', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showTeleportPanel(p); return; }
        var name = (data[0] || '').trim();
        if (!name) { p.tell('§e[公会] §c名称不能为空'); return; }
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
    fm.setTitle('§l§c删除传送点');
    fm.setContent('§e选择要删除的传送点:');

    for (var i = 0; i < tps.length; i++) {
        fm.addButton('§c' + tps[i].name, 'textures/ui/hammer_l');
    }
    fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null || id === tps.length) { showTeleportPanel(p); return; }
        if (id < tps.length) {
            database.removeGuildTeleport(tps[id].id, guild.id);
            p.tell('§e[公会] §a传送点"' + tps[id].name + '"已删除');
            showTeleportPanel(p);
        }
    });
}

/** 公会金库面板 - 使用下拉菜单选择操作 */
function showTreasuryPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }

    var role = getEffectiveRole(player, guild);
    var operations = ['存入公积金'];
    if (role === 'owner' || role === 'admin' || !cfg().withdrawAdminOnly) {
        operations.push('取出公积金');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§6公会金库');
    fm.addLabel('§b当前资金: §f' + guild.fund.toFixed(2) + ' ' + getCurrencyName());
    fm.addLabel('§b你的余额: §f' + getPlayerMoney(player) + ' ' + getCurrencyName());
    fm.addDropdown('选择操作', operations, 0);
    fm.addInput('金额', '请输入金额', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var opIdx = data[2];
        var amountStr = (data[3] || '').trim();
        var amount = parseFloat(amountStr);

        if (!amountStr || isNaN(amount) || amount <= 0) {
            p.tell('§e[公会] §c请输入有效金额');
            showTreasuryPanel(p);
            return;
        }

        if (opIdx === 0) {
            doDeposit(p, amount);
        } else {
            doWithdraw(p, amount);
        }
        showTreasuryPanel(p);
    });
}

/** 退出公会 */
function doLeaveGuild(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    if (guild.owner === xuid) { player.tell('§e[公会] §c会长不能退出公会，请先转让会长或解散公会'); return; }

    player.sendModalForm(
        '§c确认退出公会',
        '你确定要退出公会"' + guild.name + '"吗？',
        '§c确认退出',
        '§a取消',
        function(p, result) {
            if (!result) return;
            database.removeGuildMember(xuid);
            if (chatModule) chatModule.clearOrgNameCache(xuid);
            p.tell('§e[公会] §a你已退出公会"' + guild.name + '"');
            // 通知会长和管理员
            var members = database.getGuildMembers(guild.id);
            for (var m = 0; m < members.length; m++) {
                if (members[m].role === 'owner' || members[m].role === 'admin') {
                    sendSystemMail(members[m].xuid, '§e玩家§a' + p.name + '§e已退出公会§6' + guild.name);
                    try {
                        var tp = mc.getPlayer(members[m].xuid);
                        if (tp) tp.sendToast('§e[公会] §e成员变动', '§a' + p.name + ' 已退出公会');
                    } catch (e) {}
                }
            }
            logger.info('[Guild] ' + p.name + ' 退出公会: ' + guild.name);
        }
    );
}

// ==================== 申请加入 / 邀请系统 ====================

/** 查看公会邀请面板（无公会玩家） */
function showPendingInvitesPanel(player) {
    var xuid = String(player.xuid);
    if (database.getGuildByPlayer(xuid)) { player.tell('§e[公会] §c你已在公会中'); return; }

    var invites = _guildInvites[xuid] || [];
    if (invites.length === 0) {
        player.tell('§e[公会] §e你没有待处理的公会邀请');
        showMainMenu(player);
        return;
    }

    var inviteNames = [];
    for (var i = 0; i < invites.length; i++) {
        var inv = invites[i];
        inviteNames.push(inv.guildName + ' (邀请人:' + inv.inviterName + ')');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e公会邀请 (' + invites.length + '条)');
    fm.addDropdown('选择邀请', inviteNames, 0);
    fm.addDropdown('操作', ['接受邀请', '拒绝邀请'], 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var invIdx = data[0];
        var actionIdx = data[1];
        var inv = invites[invIdx];
        if (!inv) { showMainMenu(p); return; }

        if (actionIdx === 0) {
            // 接受邀请
            if (database.getGuildByPlayer(String(p.xuid))) {
                p.tell('§e[公会] §c你已在公会中');
                _guildInvites[xuid] = [];
                showMainMenu(p);
                return;
            }
            var guild = database.getGuild(inv.guildId);
            if (!guild) {
                p.tell('§e[公会] §c该公会已不存在');
                _guildInvites[xuid].splice(invIdx, 1);
                showPendingInvitesPanel(p);
                return;
            }
            if (database.getMemberCount(guild.id) >= guild.maxMembers) {
                p.tell('§e[公会] §c该公会成员已满');
                _guildInvites[xuid].splice(invIdx, 1);
                showPendingInvitesPanel(p);
                return;
            }
            database.addGuildMember(xuid, guild.id, 'member');
            _guildInvites[xuid] = []; // 清空所有邀请
            p.tell('§e[公会] §a你已加入公会"' + guild.name + '"');
            logger.info('[Guild] ' + p.name + ' 接受邀请加入公会: ' + guild.name);
            // 通知邀请人（邮件 + 在线消息）
            if (inv.inviterXuid) {
                sendSystemMail(inv.inviterXuid, '§a玩家§e' + p.name + '§a已接受你的公会邀请，加入了§6' + guild.name + '§a公会');
            }
            try { var tp = mc.getPlayer(inv.inviterName); if (tp) tp.tell('§e[公会] §a"' + p.name + '"已接受你的公会邀请'); } catch (e) {}
        } else {
            // 拒绝邀请
            _guildInvites[xuid].splice(invIdx, 1);
            p.tell('§e[公会] §e已拒绝公会"' + inv.guildName + '"的邀请');
            if (inv.inviterXuid) {
                sendSystemMail(inv.inviterXuid, '§c玩家§e' + p.name + '§c拒绝了你对§6' + inv.guildName + '§c公会的邀请');
            }
            try { var tp2 = mc.getPlayer(inv.inviterName); if (tp2) tp2.tell('§e[公会] §c"' + p.name + '"拒绝了你的公会邀请'); } catch (e) {}
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
    if (database.getGuildByPlayer(xuid)) { player.tell('§e[公会] §c你已在公会中'); return; }

    var guilds = database.getAllGuilds();
    if (guilds.length === 0) { showEmptyTipForm(player, '§e公会列表', '§a当前没有任何公会。', showMainMenu); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§d申请加入公会');

    var content = '§b选择要申请加入的公会:\n';
    for (var i = 0; i < guilds.length; i++) {
        var g = guilds[i];
        var mc2 = database.getMemberCount(g.id);
        var ownerName = getPlayerName(g.owner);
        content += '\n§a' + g.name + ' | 会长:§f' + ownerName + ' | 成员:§f' + mc2 + '/' + g.maxMembers;
    }
    fm.setContent(content);

    for (var j = 0; j < guilds.length; j++) {
        var gm = guilds[j];
        var cnt = database.getMemberCount(gm.id);
        fm.addButton('§a' + gm.name + ' (' + cnt + '/' + gm.maxMembers + ')', 'textures/ui/icon_best3');
    }
    fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null || id === guilds.length) { showMainMenu(p); return; }
        if (id < guilds.length) {
            doSubmitJoinRequest(p, guilds[id]);
        }
    });
}

/** 提交加入申请（带确认弹窗 + 通知会长/管理员） */
function doSubmitJoinRequest(player, guild) {
    var xuid = String(player.xuid);

    if (database.getGuildByPlayer(xuid)) { player.tell('§e[公会] §c你已在公会中'); return; }

    var requests = _joinRequests[guild.id] || [];
    for (var i = 0; i < requests.length; i++) {
        if (requests[i].xuid === xuid) { player.tell('§e[公会] §e你已经向该公会提交了申请，请等待审批'); return; }
    }

    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
        player.tell('§e[公会] §c该公会成员已满');
        return;
    }

    var ownerName = getPlayerName(guild.owner);
    player.sendModalForm(
        '§d确认申请加入',
        '你确定要申请加入公会"' + guild.name + '"吗？\n§7会长: §f' + ownerName + '\n§7成员: §f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers + '\n\n提交后需等待会长/管理员审批',
        '§a确认申请',
        '§c取消',
        function(p, result) {
            if (!result) { showMainMenu(p); return; }
            // 再次检查（弹窗期间状态可能变化）
            if (database.getGuildByPlayer(String(p.xuid))) { p.tell('§e[公会] §c你已在公会中'); return; }
            if (database.getMemberCount(guild.id) >= guild.maxMembers) { p.tell('§e[公会] §c该公会成员已满'); return; }

            if (!_joinRequests[guild.id]) _joinRequests[guild.id] = [];
            _joinRequests[guild.id].push({ xuid: String(p.xuid), name: p.name, time: Date.now() });
            p.tell('§e[公会] §a已向公会"' + guild.name + '"提交加入申请，请等待会长/管理员审批');

            // 通知会长和管理员
            var members = database.getGuildMembers(guild.id);
            for (var m = 0; m < members.length; m++) {
                if (members[m].role === 'owner' || members[m].role === 'admin') {
                    sendSystemMail(members[m].xuid, '§e玩家§a' + p.name + '§e申请加入公会"' + guild.name + '"，请前往公会系统处理申请');
                    try {
                        var tp = mc.getPlayer(members[m].xuid);
                        if (tp) tp.sendToast('§e[公会] §e新申请提醒', '§a' + p.name + ' 申请加入你的公会');
                    } catch (e) {}
                }
            }

            logger.info('[Guild] ' + p.name + ' 申请加入公会: ' + guild.name);
            showMainMenu(p);
        }
    );
}

/** 处理加入申请面板（会长/管理员） */
function showJoinRequestsPanel(player) {
    var xuid = String(player.xuid);
    var guild = database.getGuildByPlayer(xuid);
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能处理申请'); return; }

    var requests = _joinRequests[guild.id] || [];
    if (requests.length === 0) {
        showEmptyTipForm(player, '§e无待处理申请', '§a当前没有待处理的加入申请。', showMainMenu);
        return;
    }

    var requestNames = [];
    for (var i = 0; i < requests.length; i++) {
        requestNames.push(requests[i].name + ' (' + requests[i].xuid + ')');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e处理加入申请 (' + requests.length + '条)');
    fm.addDropdown('选择申请人', requestNames, 0);
    fm.addDropdown('操作', ['批准加入', '拒绝申请'], 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showMainMenu(p); return; }
        var reqIdx = data[0];
        var actionIdx = data[1];
        var req = requests[reqIdx];
        if (!req) { showMainMenu(p); return; }

        var actionStr = actionIdx === 0 ? '批准' : '拒绝';
        var btnConfirm = actionIdx === 0 ? '§a确认批准' : '§c确认拒绝';
        p.sendModalForm(
            '§e确认' + actionStr,
            '确定要' + actionStr + '玩家 §a' + req.name + '§f 的加入申请吗？',
            btnConfirm,
            '§c取消',
            function(p2, result) {
                if (!result) { showJoinRequestsPanel(p2); return; }

                // 重新获取申请列表（弹窗期间可能变化）
                var freshReqs = _joinRequests[guild.id] || [];
                var freshReq = null;
                var freshIdx = -1;
                for (var fi = 0; fi < freshReqs.length; fi++) {
                    if (freshReqs[fi].xuid === req.xuid) { freshReq = freshReqs[fi]; freshIdx = fi; break; }
                }
                if (!freshReq) { p2.tell('§e[公会] §e该申请已不存在'); showJoinRequestsPanel(p2); return; }

                if (actionIdx === 0) {
                    if (database.getGuildByPlayer(freshReq.xuid)) {
                        p2.tell('§e[公会] §c该玩家已加入其他公会');
                        _joinRequests[guild.id].splice(freshIdx, 1);
                        showJoinRequestsPanel(p2);
                        return;
                    }
                    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
                        p2.tell('§e[公会] §c公会成员已满');
                        showJoinRequestsPanel(p2);
                        return;
                    }
                    database.addGuildMember(freshReq.xuid, guild.id, 'member');
                    _joinRequests[guild.id].splice(freshIdx, 1);
                    p2.tell('§e[公会] §a已批准"' + freshReq.name + '"加入公会');
                    sendSystemMail(freshReq.xuid, '§a你加入公会§6' + guild.name + '§a的申请已被批准，欢迎加入！');
                    try { var tp = mc.getPlayer(freshReq.xuid); if (tp) tp.tell('§e[公会] §a你的加入公会"' + guild.name + '"申请已被批准'); } catch (e) {}
                    logger.info('[Guild] ' + p2.name + ' 批准 ' + freshReq.name + ' 加入公会: ' + guild.name);
                } else {
                    _joinRequests[guild.id].splice(freshIdx, 1);
                    p2.tell('§e[公会] §e已拒绝"' + freshReq.name + '"的加入申请');
                    sendSystemMail(freshReq.xuid, '§c你加入公会§6' + guild.name + '§c的申请已被拒绝');
                    try { var tp2 = mc.getPlayer(freshReq.xuid); if (tp2) tp2.tell('§e[公会] §c你加入公会"' + guild.name + '"的申请已被拒绝'); } catch (e) {}
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
    if (!guild) { player.tell('§e[公会] §c你没有加入任何公会'); return; }
    var role = getEffectiveRole(player, guild);
    if (role !== 'owner' && role !== 'admin') { player.tell('§e[公会] §c只有会长或管理员才能邀请'); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§d邀请玩家加入 ' + guild.name);
    fm.setContent('§b当前成员: §f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers);
    fm.addButton('§a选择在线玩家', 'textures/ui/FriendsDiversity');
    fm.addButton('§b搜索玩家', 'textures/ui/magnifyingGlass');

    player.sendForm(fm, function(p, id) {
        if (id === null) { showMainMenu(p); return; }
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
            showEmptyTipForm(player, '§e邀请玩家', '§a当前没有可邀请的在线玩家。', showMainMenu);
            return;
        }

        var fm = mc.newSimpleForm();
        fm.setTitle('§l§a选择在线玩家');
        fm.setContent('§b可邀请的在线玩家 (' + candidates.length + '人)');
        for (var j = 0; j < candidates.length; j++) {
            fm.addButton('§a' + candidates[j].name, 'textures/ui/icon_steve');
        }
        fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

        player.sendForm(fm, function(p, id) {
            if (id === null || id === candidates.length) { showInvitePlayerForm(p); return; }
            if (id < candidates.length) {
                var target = candidates[id];
                p.sendModalForm(
                    '§d确认邀请',
                    '确定要邀请 §a' + target.name + '§f 加入公会"' + guild.name + '"吗？',
                    '§a发送邀请',
                    '§c取消',
                    function(p2, result) {
                        if (!result) { showInvitePlayerForm(p2); return; }
                        doSendInvite(p2, guild, String(target.xuid));
                    }
                );
            }
        });
    } catch (e) {
        player.tell('§e[公会] §c获取在线玩家列表失败');
        showInvitePlayerForm(player);
    }
}

/** 搜索玩家邀请表单 - 输入玩家名/UID搜索，找到后需确认 */
function showSearchInviteForm(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b搜索玩家');
    fm.addInput('玩家名或UID', '输入玩家名或UID进行搜索', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showInvitePlayerForm(p); return; }
        var query = (data[0] || '').trim();
        if (!query) { p.tell('§e[公会] §c请输入玩家名或UID'); showInvitePlayerForm(p); return; }

        var targetXuid = findPlayerXuid(query);
        if (!targetXuid) { p.tell('§e[公会] §c未找到玩家"' + query + '"'); showSearchInviteForm(p, guild); return; }

        var targetName = getPlayerName(targetXuid);
        p.sendModalForm(
            '§d确认邀请',
            '找到玩家: §a' + targetName + '§f\nXUID: §7' + targetXuid + '\n\n确定要邀请该玩家加入公会"' + guild.name + '"吗？',
            '§a发送邀请',
            '§c取消',
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

    if (targetXuid === xuid) { player.tell('§e[公会] §c不能邀请自己'); showInvitePlayerForm(player); return; }

    if (database.getGuildByPlayer(targetXuid)) {
        player.tell('§e[公会] §c该玩家已在其他公会中');
        showInvitePlayerForm(player);
        return;
    }

    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
        player.tell('§e[公会] §c公会成员已满');
        showInvitePlayerForm(player);
        return;
    }

    // 检查是否已邀请
    var existing = _guildInvites[targetXuid] || [];
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].guildId === guild.id) {
            player.tell('§e[公会] §e已经向该玩家发送过邀请了');
            showInvitePlayerForm(player);
            return;
        }
    }

    // 发送邀请
    if (!_guildInvites[targetXuid]) _guildInvites[targetXuid] = [];
    _guildInvites[targetXuid].push({
        guildId: guild.id,
        guildName: guild.name,
        inviterName: player.name,
        inviterXuid: xuid,
        time: Date.now()
    });

    var targetName = getPlayerName(targetXuid);
    player.tell('§e[公会] §a已向"' + targetName + '"发送公会邀请，等待对方接受');
    try {
        var tp = mc.getPlayer(targetXuid);
        if (tp) tp.tell('§e[公会] §a你收到了公会"' + guild.name + '"的邀请，请在公会系统中查看');
    } catch (e) {}
    logger.info('[Guild] ' + player.name + ' 邀请 ' + targetName + ' 加入公会: ' + guild.name);
    showInvitePlayerForm(player);
}

// ==================== 管理员面板 ====================

/** 管理员公会管理面板 - 按钮显示公会 */
function showAdminPanel(player) {
    if (!isServerAdmin(player)) { player.tell('§e[公会] §c你没有管理权限'); return; }

    var guilds = database.getAllGuilds();
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§c管理员 - 公会管理');

    if (guilds.length === 0) {
        showEmptyTipForm(player, '§c管理面板', '§a当前没有任何公会。', showMainMenu);
        return;
    }

    for (var j = 0; j < guilds.length; j++) {
        var gm = guilds[j];
        var memCount = database.getMemberCount(gm.id);
        fm.addButton('§a' + gm.name + ' (' + memCount + '人 | §6' + gm.fund.toFixed(0) + ')', 'textures/ui/icon_best3');
    }
    fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null || id === guilds.length) { showMainMenu(p); return; }
        if (id < guilds.length) {
            showAdminGuildManage(p, guilds[id]);
        }
    });
}

/** 管理员 - 选定公会后的管理选项 */
function showAdminGuildManage(player, guild) {
    if (!isServerAdmin(player)) { player.tell('§e[公会] §c你没有管理权限'); return; }

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§c管理 - ' + guild.name);
    fm.setContent('§b会长: §f' + getPlayerName(guild.owner) + ' | 成员: §f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers + ' | 资金: §6' + guild.fund.toFixed(2));

    fm.addButton('§a成员管理', 'textures/ui/FriendsDiversity');
    fm.addButton('§e传送点管理', 'textures/items/compass_item');
    fm.addButton('§6资金管理', 'textures/ui/icon_coin');
    fm.addButton('§d邀请玩家', 'textures/ui/color_plus');
    fm.addButton('§e修改公会名称', 'textures/ui/book_edit_default');
    fm.addButton('§c解散公会', 'textures/ui/hammer_l');
    fm.addButton('§7返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null || id === 6) { showAdminPanel(p); return; }
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
    if (!isServerAdmin(player)) { player.tell('§e[公会] §c你没有管理权限'); return; }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§e修改公会名称 - ' + guild.name);
    fm.addLabel('§b当前名称: §f' + guild.name);
    fm.addInput('新公会名称', '2-16个字符', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminGuildManage(p, guild); return; }
        var newName = (data[1] || '').trim();
        if (!newName) { p.tell('§e[公会] §c公会名称不能为空'); showAdminChangeGuildName(p, guild); return; }
        if (newName.length < 2 || newName.length > 16) { p.tell('§e[公会] §c公会名称长度需在2-16个字符之间'); showAdminChangeGuildName(p, guild); return; }
        if (newName === guild.name) { p.tell('§e[公会] §e新名称与当前名称相同'); showAdminGuildManage(p, guild); return; }
        if (database.getGuildByName(newName)) { p.tell('§e[公会] §c公会名称"' + newName + '"已被使用'); showAdminChangeGuildName(p, guild); return; }

        var oldName = guild.name;
        database.updateGuild(guild.id, { name: newName });
        if (chatModule) chatModule.clearAllOrgNameCache();
        p.tell('§e[公会] §a公会名称已从"' + oldName + '"修改为"' + newName + '"');

        // 通知所有成员
        var members = database.getGuildMembers(guild.id);
        for (var i = 0; i < members.length; i++) {
            sendSystemMail(members[i].xuid, '§e公会名称已被系统管理员修改为§6' + newName + '§e（原名:§f' + oldName + '§e）');
            try {
                var tp = mc.getPlayer(members[i].xuid);
                if (tp) tp.sendToast('§e[公会] §e公会更名', '§a公会已更名为 ' + newName);
            } catch (e) {}
        }

        logger.info('[Guild] 管理员 ' + p.name + ' 将公会"' + oldName + '"更名为"' + newName + '"');
        var updated = database.getGuild(guild.id);
        if (updated) showAdminGuildManage(p, updated);
        else showAdminPanel(p);
    });
}

/** 管理员 - 成员管理（下拉菜单选择成员和操作） */
function showAdminMemberManage(player, guild) {
    var members = database.getGuildMembers(guild.id);

    var memberNames = [];
    var memberMap = [];
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var mr = m.role === 'owner' ? '[会长]' : (m.role === 'admin' ? '[管理]' : '[成员]');
        memberNames.push(mr + ' ' + m.name);
        memberMap.push(m);
    }

    var actions = ['查看信息', '踢出公会', '设置管理员', '移除管理员', '转让会长'];
    var actionKeys = ['info', 'kick', 'promote', 'demote', 'transfer'];

    var fm = mc.newCustomForm();
    fm.setTitle('§l§c管理成员 - ' + guild.name + ' (' + members.length + '人)');
    fm.addDropdown('选择成员', memberNames, 0);
    fm.addDropdown('选择操作', actions, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminGuildManage(p, guild); return; }
        var memberIdx = data[0];
        var actionIdx = data[1];
        var target = memberMap[memberIdx];
        var action = actionKeys[actionIdx];

        if (!target) { showAdminGuildManage(p, guild); return; }

        switch (action) {
            case 'info':
                var rs = target.role === 'owner' ? '§6会长' : (target.role === 'admin' ? '§b管理员' : '§a成员');
                var info = '§b成员名: §f' + target.name + '\n§bXUID: §f' + target.xuid + '\n§b身份: ' + rs + '\n§b加入时间: §f' + new Date(target.joinedAt).toLocaleString();
                var infFm = mc.newSimpleForm();
                infFm.setTitle('§l§b成员信息');
                infFm.setContent(info);
                infFm.addButton('§a返回', 'textures/ui/recap_glyph_desaturated');
                p.sendForm(infFm, function() { showAdminMemberManage(p, guild); });
                break;
            case 'kick':
                if (target.role === 'owner') { p.tell('§e[公会] §c不能踢出会长'); showAdminMemberManage(p, guild); return; }
                p.sendModalForm('§c确认踢出', '确定要将"' + target.name + '"踢出公会"' + guild.name + '"吗？', '§c确认', '§a取消', function(p2, r) {
                    if (!r) { showAdminMemberManage(p2, guild); return; }
                    database.removeGuildMember(target.xuid);
                    if (chatModule) chatModule.clearOrgNameCache(target.xuid);
                    p2.tell('§e[公会] §a已将"' + target.name + '"踢出公会');
                    sendSystemMail(target.xuid, '§c系统管理员' + p2.name + '已将您从"' + guild.name + '"公会移除');
                    try { var tp = mc.getPlayer(target.xuid); if (tp) tp.tell('§e[公会] §c你已被管理员踢出公会"' + guild.name + '"'); } catch (e) {}
                    logger.info('[Guild] 管理员 ' + p2.name + ' 踢出 ' + target.name + ' (公会:' + guild.name + ')');
                    showAdminMemberManage(p2, guild);
                });
                break;
            case 'promote':
                if (target.role === 'owner') { p.tell('§e[公会] §c不能操作会长'); showAdminMemberManage(p, guild); return; }
                if (target.role === 'admin') { p.tell('§e[公会] §e该玩家已是管理员'); showAdminMemberManage(p, guild); return; }
                var ac = 0;
                for (var j = 0; j < members.length; j++) { if (members[j].role === 'admin') ac++; }
                if (ac >= (cfg().maxAdmins || 3)) { p.tell('§e[公会] §c管理员数量已达上限'); showAdminMemberManage(p, guild); return; }
                database.updateMemberRole(target.xuid, 'admin');
                p.tell('§e[公会] §a已将"' + target.name + '"提升为管理员');
                sendSystemMail(target.xuid, '§a您已被§6' + guild.name + '§a公会管理员提拔为管理员');
                try { var tp2 = mc.getPlayer(target.xuid); if (tp2) tp2.tell('§e[公会] §a你已被管理员提升为公会"' + guild.name + '"的管理员'); } catch (e) {}
                showAdminMemberManage(p, guild);
                break;
            case 'demote':
                if (target.role !== 'admin') { p.tell('§e[公会] §e该玩家不是管理员'); showAdminMemberManage(p, guild); return; }
                database.updateMemberRole(target.xuid, 'member');
                p.tell('§e[公会] §a已将"' + target.name + '"降为普通成员');
                sendSystemMail(target.xuid, '§c您已被§6' + guild.name + '§c公会管理员移除了该公会的管理员权限');
                try { var tp3 = mc.getPlayer(target.xuid); if (tp3) tp3.tell('§e[公会] §c你已被管理员降为公会"' + guild.name + '"的普通成员'); } catch (e) {}
                showAdminMemberManage(p, guild);
                break;
            case 'transfer':
                if (target.role === 'owner') { p.tell('§e[公会] §c该玩家已是会长'); showAdminMemberManage(p, guild); return; }
                p.sendModalForm('§d确认转让会长', '确定要将公会"' + guild.name + '"的会长转让给"' + target.name + '"吗？', '§a确认', '§c取消', function(p2, r) {
                    if (!r) { showAdminMemberManage(p2, guild); return; }
                    var oldOwner = guild.owner;
                    database.updateGuild(guild.id, { owner: target.xuid });
                    database.updateMemberRole(target.xuid, 'owner');
                    if (oldOwner !== target.xuid) database.updateMemberRole(oldOwner, 'admin');
                    p2.tell('§e[公会] §a公会"' + guild.name + '"的会长已转让给"' + target.name + '"');
                    sendSystemMail(target.xuid, '§a你已被系统管理员任命为公会§6' + guild.name + '§a的新会长');
                    if (oldOwner !== target.xuid) {
                        sendSystemMail(oldOwner, '§e公会§6' + guild.name + '§e的会长已被系统管理员转让给§a' + target.name);
                    }
                    try { var tp4 = mc.getPlayer(target.xuid); if (tp4) tp4.tell('§e[公会] §a你已成为公会"' + guild.name + '"的新会长'); } catch (e) {}
                    logger.info('[Guild] 管理员 ' + p2.name + ' 转让公会"' + guild.name + '"给 ' + target.name);
                    showAdminMemberManage(p2, guild);
                });
                break;
        }
    });
}

/** 管理员 - 邀请玩家（两个按钮：选择在线玩家 / 搜索玩家） */
function showAdminInviteForm(player, guild) {
    var fm = mc.newSimpleForm();
    fm.setTitle('§l§d邀请玩家 - ' + guild.name);
    fm.setContent('§b当前成员: §f' + database.getMemberCount(guild.id) + '/' + guild.maxMembers);
    fm.addButton('§a选择在线玩家', 'textures/ui/FriendsDiversity');
    fm.addButton('§b搜索玩家', 'textures/ui/magnifyingGlass');

    player.sendForm(fm, function(p, id) {
        if (id === null) { showAdminGuildManage(p, guild); return; }
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
            showEmptyTipForm(player, '§e邀请玩家', '§a当前没有可邀请的在线玩家。', showMainMenu);
            return;
        }

        var fm = mc.newSimpleForm();
        fm.setTitle('§l§a选择在线玩家');
        fm.setContent('§b可邀请的在线玩家 (' + candidates.length + '人)');
        for (var j = 0; j < candidates.length; j++) {
            fm.addButton('§a' + candidates[j].name, 'textures/ui/icon_steve');
        }
        fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

        player.sendForm(fm, function(p, id) {
            if (id === null || id === candidates.length) { showAdminInviteForm(p, guild); return; }
            if (id < candidates.length) {
                var target = candidates[id];
                p.sendModalForm(
                    '§d确认邀请',
                    '确定要邀请 §a' + target.name + '§f 加入公会"' + guild.name + '"吗？',
                    '§a发送邀请',
                    '§c取消',
                    function(p2, result) {
                        if (!result) { showAdminInviteForm(p2, guild); return; }
                        doAdminSendInvite(p2, guild, String(target.xuid));
                    }
                );
            }
        });
    } catch (e) {
        player.tell('§e[公会] §c获取在线玩家列表失败');
        showAdminInviteForm(player, guild);
    }
}

/** 管理员 - 搜索玩家邀请，找到后需确认 */
function showAdminSearchInvite(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b搜索玩家');
    fm.addInput('玩家名或UID', '输入玩家名或UID进行搜索', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminInviteForm(p, guild); return; }
        var query = (data[0] || '').trim();
        if (!query) { p.tell('§e[公会] §c请输入玩家名或UID'); showAdminInviteForm(p, guild); return; }

        var targetXuid = findPlayerXuid(query);
        if (!targetXuid) { p.tell('§e[公会] §c未找到玩家"' + query + '"'); showAdminSearchInvite(p, guild); return; }

        var targetName = getPlayerName(targetXuid);
        p.sendModalForm(
            '§d确认邀请',
            '找到玩家: §a' + targetName + '§f\nXUID: §7' + targetXuid + '\n\n确定要邀请该玩家加入公会"' + guild.name + '"吗？',
            '§a发送邀请',
            '§c取消',
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
        player.tell('§e[公会] §c该玩家已在其他公会中');
        showAdminInviteForm(player, guild);
        return;
    }

    if (database.getMemberCount(guild.id) >= guild.maxMembers) {
        player.tell('§e[公会] §c公会成员已满');
        showAdminInviteForm(player, guild);
        return;
    }

    var existing = _guildInvites[targetXuid] || [];
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].guildId === guild.id) {
            player.tell('§e[公会] §e已经向该玩家发送过邀请了');
            showAdminInviteForm(player, guild);
            return;
        }
    }

    if (!_guildInvites[targetXuid]) _guildInvites[targetXuid] = [];
    _guildInvites[targetXuid].push({
        guildId: guild.id,
        guildName: guild.name,
        inviterName: player.name,
        inviterXuid: String(player.xuid),
        time: Date.now()
    });

    var targetName = getPlayerName(targetXuid);
    player.tell('§e[公会] §a已向"' + targetName + '"发送公会邀请，等待对方接受');
    try { var tp = mc.getPlayer(targetXuid); if (tp) tp.tell('§e[公会] §a你收到了公会"' + guild.name + '"的邀请，请在公会系统中查看'); } catch (e) {}
    logger.info('[Guild] 管理员 ' + player.name + ' 邀请 ' + targetName + ' 加入公会: ' + guild.name);
    showAdminInviteForm(player, guild);
}

/** 管理员 - 传送点管理 */
function showAdminTeleportManage(player, guild) {
    var tps = database.getGuildTeleports(guild.id);

    var fm = mc.newSimpleForm();
    fm.setTitle('§l§e管理传送点 - ' + guild.name);

    var content = '§b传送点 (' + tps.length + '/' + (cfg().maxTeleports || 5) + ')\n';
    if (tps.length > 0) {
        for (var i = 0; i < tps.length; i++) {
            content += '§a' + tps[i].name + ' (X:' + Math.round(tps[i].x) + ' Y:' + Math.round(tps[i].y) + ' Z:' + Math.round(tps[i].z) + ')\n';
        }
    } else {
        content += '暂无传送点\n';
    }
    fm.setContent(content);

    fm.addButton('§b添加传送点', 'textures/ui/color_plus');
    fm.addButton('§c删除传送点', 'textures/ui/hammer_l');
    fm.addButton('§d设置总部到当前位置', 'textures/items/bed_red');
    fm.addButton('返回', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(fm, function(p, id) {
        if (id === null || id === 3) { showAdminGuildManage(p, guild); return; }
        switch (id) {
            case 0: showAdminAddTeleportForm(p, guild); break;
            case 1: showAdminDelTeleportForm(p, guild); break;
            case 2:
                var pos = p.pos;
                database.updateGuild(guild.id, { hqX: pos.x, hqY: pos.y, hqZ: pos.z, hqDim: String(p.dimid) });
                p.tell('§e[公会] §a公会"' + guild.name + '"的总部已设置在当前位置');
                logger.info('[Guild] 管理员 ' + p.name + ' 设置公会"' + guild.name + '"总部');
                showAdminTeleportManage(p, guild);
                break;
        }
    });
}

/** 管理员 - 添加传送点 */
function showAdminAddTeleportForm(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§b添加传送点 - ' + guild.name);
    fm.addInput('传送点名称', '请输入名称', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminTeleportManage(p, guild); return; }
        var name = (data[0] || '').trim();
        if (!name) { p.tell('§e[公会] §c名称不能为空'); showAdminTeleportManage(p, guild); return; }

        var maxTP = cfg().maxTeleports || 5;
        if (database.getGuildTeleportCount(guild.id) >= maxTP) {
            p.tell('§e[公会] §c传送点数量已达上限 (' + maxTP + ')');
            showAdminTeleportManage(p, guild);
            return;
        }

        if (database.getGuildTeleportByName(guild.id, name)) {
            p.tell('§e[公会] §c传送点"' + name + '"已存在');
            showAdminTeleportManage(p, guild);
            return;
        }

        var pos = p.pos;
        database.addGuildTeleport(guild.id, name, pos.x, pos.y, pos.z, String(p.dimid), String(p.xuid));
        p.tell('§e[公会] §a传送点"' + name + '"已添加到公会"' + guild.name + '"');
        showAdminTeleportManage(p, guild);
    });
}

/** 管理员 - 删除传送点（下拉菜单） */
function showAdminDelTeleportForm(player, guild) {
    var tps = database.getGuildTeleports(guild.id);
    if (tps.length === 0) { player.tell('§e[公会] §e暂无传送点'); showAdminTeleportManage(player, guild); return; }

    var tpNames = [];
    for (var i = 0; i < tps.length; i++) {
        tpNames.push(tps[i].name + ' (' + Math.round(tps[i].x) + ',' + Math.round(tps[i].y) + ',' + Math.round(tps[i].z) + ')');
    }

    var fm = mc.newCustomForm();
    fm.setTitle('§l§c删除传送点 - ' + guild.name);
    fm.addDropdown('选择要删除的传送点', tpNames, 0);

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminTeleportManage(p, guild); return; }
        var tpIdx = data[0];
        var tp = tps[tpIdx];
        if (!tp) { showAdminTeleportManage(p, guild); return; }
        database.removeGuildTeleport(tp.id, guild.id);
        p.tell('§e[公会] §a传送点"' + tp.name + '"已删除');
        showAdminTeleportManage(p, guild);
    });
}

/** 管理员 - 资金管理（下拉菜单选择操作） */
function showAdminTreasuryPanel(player, guild) {
    var fm = mc.newCustomForm();
    fm.setTitle('§l§6管理资金 - ' + guild.name);
    fm.addLabel('§b当前资金: §f' + guild.fund.toFixed(2) + ' ' + getCurrencyName());
    fm.addDropdown('选择操作', ['直接设置金额', '存入资金', '取出资金'], 0);
    fm.addInput('金额', '请输入金额', '');

    player.sendForm(fm, function(p, data) {
        if (data == null) { showAdminGuildManage(p, guild); return; }

        var opIdx = data[1];
        var amountStr = (data[2] || '').trim();
        var amount = parseFloat(amountStr);

        if (!amountStr || isNaN(amount) || amount < 0) {
            p.tell('§e[公会] §c请输入有效金额');
            showAdminTreasuryPanel(p, guild);
            return;
        }

        switch (opIdx) {
            case 0:
                database.updateGuild(guild.id, { fund: amount });
                p.tell('§e[公会] §a公会"' + guild.name + '"的资金已设置为 ' + amount.toFixed(2));
                logger.info('[Guild] 管理员 ' + p.name + ' 设置公会"' + guild.name + '"资金为 ' + amount);
                break;
            case 1:
                database.updateGuild(guild.id, { fund: guild.fund + amount });
                p.tell('§e[公会] §a已向公会"' + guild.name + '"存入 ' + amount.toFixed(2));
                logger.info('[Guild] 管理员 ' + p.name + ' 向公会"' + guild.name + '"存入 ' + amount);
                break;
            case 2:
                if (guild.fund < amount) {
                    p.tell('§e[公会] §c公会资金不足');
                } else {
                    database.updateGuild(guild.id, { fund: guild.fund - amount });
                    p.tell('§e[公会] §a已从公会"' + guild.name + '"取出 ' + amount.toFixed(2));
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
    if (!isServerAdmin(player)) { player.tell('§e[公会] §c你没有管理权限'); return; }

    var memberCount = database.getMemberCount(guild.id);
    player.sendModalForm(
        '§c管理员 - 确认解散公会',
        '你确定要解散公会"' + guild.name + '"吗？\n\n§e会长: ' + getPlayerName(guild.owner) + '\n§e成员数: ' + memberCount + '\n§e资金: ' + guild.fund.toFixed(2) + '\n\n§c此操作不可撤销！',
        '§c确认解散',
        '§a取消',
        function(p, result) {
            if (!result) { showAdminGuildManage(p, guild); return; }
            var members = database.getGuildMembers(guild.id);
            var disbandGuildName = guild.name;
            for (var i = 0; i < members.length; i++) {
                sendSystemMail(members[i].xuid, '§c§6' + disbandGuildName + '§c公会已被系统管理员解散');
                try { var mp = mc.getPlayer(members[i].xuid); if (mp) mp.tell('§e[公会] §c你的公会"' + disbandGuildName + '"已被管理员解散'); } catch (e) {}
            }
            database.deleteGuild(guild.id);
            if (chatModule) chatModule.clearAllOrgNameCache();
            p.tell('§e[公会] §a公会"' + guild.name + '"已被解散');
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
