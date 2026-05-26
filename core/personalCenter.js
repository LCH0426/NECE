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
 * NLCE 个人中心模块
 * 包含：个人中心UI、冒险等级UI、等级工具函数、UID搜索、Player原型扩展
 */

const U = require('./utils');
const C = require('./constants');

let _deps = {};
let _levelUpExp = [];
const _clockThrottle = {};

function init(deps) {
    _deps = deps;
}

function setLevelUpExp(table) {
    _levelUpExp = table;
}

// ============ 等级/统计工具函数 ============

function obtainStatBlock(xuid) {
    let pd = _deps.getPlayerData();
    let p = pd.players[xuid];
    if (!p) return null;
    if (!p.count) {
        p.count = { mining: 0, placing: 0, kills: 0, deaths: 0, playTime: 0, mobKills: 0 };
    }
    if (p.count.mobKills === undefined) p.count.mobKills = 0;
    return p.count;
}

function bumpStat(xuid, field, amount) {
    const blk = obtainStatBlock(xuid);
    if (!blk) return;
    blk[field] = (blk[field] || 0) + amount;
}

function getPlayerExpByXuid(xuid) {
    let pd = _deps.getPlayerData();
    let p = pd.players[xuid];
    if (p && p.count && p.count.playTime !== undefined) {
        return Math.floor(p.count.playTime);
    }
    return 0;
}

function calculateAdventureLevel(exp) {
    exp = Math.max(0, exp);
    const maxLevel = _levelUpExp.length;
    let lo = 0, hi = maxLevel - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (exp >= _levelUpExp[mid]) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    const level = lo + 1;
    let currentExp = exp - _levelUpExp[lo];
    let nextExp = lo + 1 < maxLevel ? _levelUpExp[lo + 1] - _levelUpExp[lo] : 0;
    if (level >= maxLevel) {
        nextExp = 0;
        currentExp = exp - _levelUpExp[maxLevel - 1];
    }
    return {
        level: level,
        currentExp: currentExp,
        nextExp: nextExp,
        totalExp: exp
    };
}

function getTotalExpByLevel(targetLevel) {
    targetLevel = Math.max(1, Math.min(targetLevel, _levelUpExp.length));
    return _levelUpExp[targetLevel - 1] || 0;
}

function getPlayerRewardRange(xuid) {
    let pd = _deps.getPlayerData();
    let p = pd.players[xuid];
    if (!p || !p.rw) return { min: 1, max: 0 };
    const parts = p.rw.split("-");
    return {
        min: parseInt(parts[0]) || 1,
        max: parseInt(parts[1]) || 0
    };
}

function updatePlayerRewardRecord(xuid, newMaxLevel) {
    let pd = _deps.getPlayerData();
    let p = pd.players[xuid];
    if (!p) return false;
    const oldRange = getPlayerRewardRange(xuid);
    if (newMaxLevel <= oldRange.max) return false;
    p.rw = "1-" + newMaxLevel;
    _deps.savePlayerDataNow();
    return true;
}

function claimLevelReward(player, rewardExp) {
    if (rewardExp <= 0) return false;
    try {
        if (_deps.money.add(player.xuid, rewardExp)) {
            _deps.notifyEconomyChange(player, rewardExp, "等级奖励");
            return true;
        }
        return false;
    } catch (error) {
        logger.error('玩家 ' + player.name + ' 领取奖励失败：' + error.message);
        return false;
    }
}

function findPlayerByUid(targetUid) {
    let pd = _deps.getPlayerData();
    for (let xuid in pd.players) {
        const player = pd.players[xuid];
        if (player && player.uid === targetUid) {
            let exp = getPlayerExpByXuid(xuid);
            let levelInfo = calculateAdventureLevel(exp);
            return {
                name: player.name,
                uid: player.uid,
                registerTime: player.registerTime,
                rw: player.rw,
                count: player.count,
                xuid: xuid,
                adventureLevel: levelInfo.level,
                adventureExp: levelInfo.currentExp + '/' + (levelInfo.nextExp || '已满级'),
                totalExp: levelInfo.totalExp
            };
        }
    }
    return null;
}

function getAllPlayersSorted() {
    let pd = _deps.getPlayerData();
    return Object.values(pd.players)
        .filter(function(player) { return player && player.uid !== undefined; })
        .sort(function(a, b) { return a.uid - b.uid; });
}

// ============ Player 原型扩展 ============

function installPrototypeExtensions() {
    Object.defineProperty(LLSE_Player.prototype, "uid", {
        get: function() {
            let pd = _deps.getPlayerData();
            const p = pd.players[this.xuid];
            return p && p.uid !== undefined ? p.uid : "未注册";
        },
        set: function() {
            logger.error('禁止修改玩家UID！玩家：' + this.name + '（XUID: ' + this.xuid + '）');
            return false;
        },
        enumerable: true
    });

    Object.defineProperty(LLSE_Player.prototype, "adventureLevelInfo", {
        get: function() {
            const exp = getPlayerExpByXuid(this.xuid);
            return calculateAdventureLevel(exp);
        },
        enumerable: true
    });
}

// ============ 冒险等级 UI ============

function showAdventureLevelDetail(player) {
    let levelInfo = player.adventureLevelInfo;
    let content = '';
    content += '§a玩家名：§f' + player.name + '\n';
    content += '§aUID：§f' + player.uid + '\n';
    content += '§a冒险等级：§f' + levelInfo.level + '级\n';
    content += '§a累计经验：§f' + levelInfo.totalExp + '点\n';
    if (levelInfo.nextExp > 0) {
        content += '§a当前进度：§f' + levelInfo.currentExp + '/' + levelInfo.nextExp + '\n';
        content += '§a升级所需：§f' + (levelInfo.nextExp - levelInfo.currentExp) + ' 点经验\n';
    } else {
        content += '§a当前级进度：§f已满级（' + levelInfo.currentExp + '经验）\n';
        content += '§a提示：§f您已达到最高冒险等级！\n';
    }
    content += '-------------------------\n';

    player.sendModalForm(
        '§a冒险等级详情',
        content,
        '§a返回面板',
        '§c关闭',
        function(p, res) {
            if (res === true) showAdventureLevelPanel(p);
        }
    );
}

function showAdventureLevelPanel(player) {
    let levelInfo = player.adventureLevelInfo;
    const levelPanel = mc.newSimpleForm();
    levelPanel.setTitle('§a冒险等级面板');

    let content = '-------------------------\n';
    content += '§a当前等级：§f' + levelInfo.level + '级\n';
    content += '§a总经验值：§f' + levelInfo.totalExp + '\n';
    if (levelInfo.nextExp > 0) {
        content += '§a当前进度：§f' + levelInfo.currentExp + '/' + levelInfo.nextExp + '\n';
        content += '§a升级所需：§f' + (levelInfo.nextExp - levelInfo.currentExp) + '经验\n';
    } else {
        content += '§a当前进度：§f' + levelInfo.currentExp + '/已满级\n';
        content += '§a状态：§f已达到最高等级！\n';
    }
    content += '-------------------------\n';
    content += '§a选择功能操作';

    levelPanel.setContent(content);
    levelPanel.addButton('§a冒险等级详情', 'textures/ui/sidebar_icons/dressing_room_capes.png');
    levelPanel.addButton('§6等级奖励', 'textures/ui/pary');
    levelPanel.addButton('§c返回个人中心', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(levelPanel, function(p, btnIndex) {
        if (btnIndex === null) return;
        if (btnIndex === 0) showAdventureLevelDetail(p);
        if (btnIndex === 1) showLevelRewardForm(p);
        if (btnIndex === 2) showPersonalCenterForm(p);
    });
}

function showNoRewardForm(player, levelInfo, rwRange) {
    let content = '-------------------------\n' +
        '§c您当前没有可领取的奖励！\n' +
        '§a已领取等级范围：§f' + rwRange.min + '-' + rwRange.max + '级\n' +
        '§a当前冒险等级：§f' + levelInfo.level + '级\n' +
        '-------------------------\n';

    player.sendModalForm(
        '§c无可用奖励',
        content,
        '§a返回面板',
        '§c关闭',
        function(p, res) {
            if (res === true) showAdventureLevelPanel(p);
        }
    );
}

function showRewardClaimForm(player, xuid, rewardExp, availableLevel, rwRange) {
    const cn = _deps.getCurrencyName();
    let content = '-------------------------\n' +
        '§a可领取等级：§f' + (rwRange.max + 1) + '-' + availableLevel + '级\n' +
        '§a奖励§c' + cn + '§r：§f' + rewardExp + ' \n' +
        '§a领取后将记录等级：§f1-' + availableLevel + '级\n' +
        '-------------------------\n' +
        '§c提示：领取后无法重复领取同等级奖励！';

    player.sendModalForm(
        '§6等级奖励领取',
        content,
        '§a确认领取',
        '§c取消',
        function(p, res) {
            if (!res) return;

            const claimSuccess = claimLevelReward(p, rewardExp);
            if (claimSuccess) {
                updatePlayerRewardRecord(xuid, availableLevel);
                let playerMoney = _deps.money.get(p.xuid) || 0;
                const successContent = '-------------------------\n' +
                    '§a恭喜！成功领取等级奖励！\n' +
                    '§a领取等级：§f' + (rwRange.max + 1) + '-' + availableLevel + '级\n' +
                    '§a获得§c' + cn + '§r：§f' + rewardExp + ' §c' + cn + '§r\n' +
                    '§a当前§c' + cn + '余额：§f' + playerMoney + '\n' +
                    '-------------------------\n';

                player.sendModalForm(
                    '§a领取成功',
                    successContent,
                    '§a返回面板',
                    '§c关闭',
                    function(pp, res2) {
                        if (res2 === true) showAdventureLevelPanel(pp);
                    }
                );
            } else {
                const failContent = '-------------------------\n' +
                    '§c奖励领取失败，请稍后重试！\n' +
                    '-------------------------\n';

                player.sendModalForm(
                    '§c领取失败',
                    failContent,
                    '§a返回面板',
                    '§c关闭',
                    function(pp, res2) {
                        if (res2 === true) showAdventureLevelPanel(pp);
                    }
                );
            }
        }
    );
}

function showLevelRewardForm(player) {
    let xuid = player.xuid;
    let levelInfo = player.adventureLevelInfo;
    const rwRange = getPlayerRewardRange(xuid);
    const maxClaimLevel = Math.min(levelInfo.level, _levelUpExp.length - 1);
    let availableLevel = maxClaimLevel > rwRange.max ? maxClaimLevel : 0;

    if (availableLevel === 0) {
        showNoRewardForm(player, levelInfo, rwRange);
        return;
    }

    const oldTotalExp = getTotalExpByLevel(rwRange.max);
    const newTotalExp = getTotalExpByLevel(availableLevel);
    const rewardExp = newTotalExp - oldTotalExp;

    showRewardClaimForm(player, xuid, rewardExp, availableLevel, rwRange);
}

// ============ UID 搜索与列表 ============

function showUidSearchInputForm(player) {
    const inputForm = mc.newCustomForm();
    inputForm.setTitle('UID搜索');
    inputForm.addInput('请输入要查询的UID', '例如：10000', '');

    player.sendForm(inputForm, function(p, inputData) {
        if (inputData === null) return;
        const inputUidStr = inputData[0];
        const targetUid = parseInt(inputUidStr);
        if (isNaN(targetUid) || inputUidStr.trim() === '') {
            p.tell('§c请输入有效的数字UID！', 1);
            return;
        }
        showUidSearchResultForm(p, targetUid);
    });
}

function showUidSearchResultForm(player, targetUid) {
    let playerInfo = findPlayerByUid(targetUid);
    let formTitle, formContent;

    if (playerInfo) {
        formTitle = '§a搜索结果';
        formContent =
            '§aUID: ' + playerInfo.uid + '\n' +
            '§a玩家名: §f' + (playerInfo.name || '未知') + '\n' +
            '§a冒险等级: §f' + (playerInfo.adventureLevel || 1) + '级\n' +
            '§a注册时间: §f' + (playerInfo.registerTime || '未知') + '\n';
    } else {
        formTitle = '§c搜索结果';
        formContent = '§c未找到 UID: ' + targetUid + ' 的玩家信息';
    }

    player.sendModalForm(
        formTitle,
        formContent,
        '§a返回搜索',
        '§c关闭',
        function(_, res) {
            if (res === true) showUidSearchInputForm(player);
        }
    );
}

function showUidListForm(player, currentPage) {
    currentPage = currentPage || 1;
    const allPlayers = getAllPlayersSorted();
    const pageSize = 20;
    const totalPlayers = allPlayers.length;
    const totalPages = Math.max(1, Math.ceil(totalPlayers / pageSize));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);

    const listForm = mc.newSimpleForm();
    listForm.setTitle('UID列表 第 ' + currentPage + '/' + totalPages + ' 页');

    let formContent = '§a玩家UID列表\n-------------------------\n';
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalPlayers);
    const currentPagePlayers = allPlayers.slice(startIndex, endIndex);

    currentPagePlayers.forEach(function(item) {
        formContent +=
            '§a玩家: §f' + (item.name || '未知') + '\n' +
            '§eUID: ' + (item.uid || '未分配') + '\n' +
            '§b注册时间: §f' + (item.registerTime || '未知') + '\n\n';
    });

    listForm.setContent(formContent);
    const buttonIndexMap = { prev: -1, close: -1, next: -1 };

    if (currentPage > 1) {
        listForm.addButton('上一页', 'textures/ui/arrow_left');
        buttonIndexMap.prev = 0;
    }
    listForm.addButton('关闭', 'textures/ui/cancel');
    buttonIndexMap.close = currentPage > 1 ? 1 : 0;
    if (currentPage < totalPages) {
        listForm.addButton('下一页', 'textures/ui/arrow_right');
        buttonIndexMap.next = currentPage > 1 ? 2 : 1;
    }

    player.sendForm(listForm, function(p, buttonIndex) {
        if (buttonIndex === null) return;
        if (buttonIndex === buttonIndexMap.prev) showUidListForm(p, currentPage - 1);
        if (buttonIndex === buttonIndexMap.next) showUidListForm(p, currentPage + 1);
    });
}

// ============ 个人中心 UI ============

function openMainMenu(player) {
    let xuid = player.xuid;
    const bal = _deps.money ? _deps.money.get(xuid) || 0 : 0;
    const fm = mc.newSimpleForm();
    fm.setTitle('§e Citlalia ');
    fm.setContent('§f' + player.name + ' §7| §e' + bal + ' ' + _deps.getCurrencyName());
    let avatarUrl = _deps.getPlayerAvatarUrl(xuid);
    fm.addButton('§9个人中心', avatarUrl);
    const hasMessageBoard = _deps.config.get('enableMessageBoard');
    if (hasMessageBoard) {
        fm.addButton('§b留言板', 'textures/ui/comment');
    }
    if (_deps.teleportModule.tpsConfig().enabled) {
        fm.addButton('§a传送系统', 'textures/ui/icon_multiplayer');
    }
    player.sendForm(fm, function(p, idx) {
        if (idx === null) return;
        if (idx === 0) showPersonalCenterForm(p);
        else if (idx === 1 && hasMessageBoard) _deps.messageBoardModule.showMainForm(p);
        else if ((idx === 2 && hasMessageBoard) || (idx === 1 && !hasMessageBoard)) _deps.teleportModule.showTpgMainMenu(p, _deps.commonDeps);
    });
}

function showPersonalCenterForm(player) {
    let playerXUID = player.xuid;
    let levelInfo = player.adventureLevelInfo;
    let playerMoney = _deps.money ? _deps.money.get(playerXUID) || 0 : 0;

    const centerForm = mc.newSimpleForm();
    centerForm.setTitle('§a个人中心');
    centerForm.setContent(
        '§a玩家名称：' + player.name + '\n' +
        '§a现金：§e' + playerMoney + ' 点§c' + _deps.getCurrencyName() + '§r\n' +
        '-------------------------\n' +
        '§a选择功能操作'
    );

    const avatarUrl = _deps.getPlayerAvatarUrl(playerXUID);
    const unreadMsgCount = _deps.friendModule.getUnreadMessageCount(playerXUID);
    const unreadMailCount = _deps.mailModule.getUnreadMailCount(playerXUID);

    centerForm.addButton('§a个人信息', avatarUrl);
    centerForm.addButton('§b我的好友', 'textures/ui/FriendsIcon');
    centerForm.addButton('§e我的消息 ' + (unreadMsgCount > 0 ? '§c(' + unreadMsgCount + ')' : ''), 'textures/ui/Feedback');
    centerForm.addButton('§d邮件系统 ' + (unreadMailCount > 0 ? '§c(' + unreadMailCount + ')' : ''), 'textures/ui/Envelope');
    centerForm.addButton('§a冒险等级', 'textures/ui/achievements_pause_menu_icon');
    centerForm.addButton('§6数据统计', 'textures/ui/copy');
    centerForm.addButton('§c属性提升', 'textures/ui/jump_boost_effect');
    centerForm.addButton('§6个人偏好设置', 'textures/ui/color_picker');
    centerForm.addButton('§e个人头像设置', 'textures/ui/dressing_room_customization');
    centerForm.addButton('§c返回主菜单', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(centerForm, function(p, buttonIndex) {
        if (buttonIndex === null) return;
        if (buttonIndex === 0) showPersonalInfoForm(p);
        if (buttonIndex === 1) _deps.friendModule.showMyFriendsForm(p);
        if (buttonIndex === 2) _deps.friendModule.showMyMessagesForm(p);
        if (buttonIndex === 3) _deps.mailModule.showMailSystemForm(p);
        if (buttonIndex === 4) showAdventureLevelPanel(p);
        if (buttonIndex === 5) showDataStatisticsForm(p);
        if (buttonIndex === 6) _deps.wishModule.showAttributeUpgradeForm(p);
        if (buttonIndex === 7) showPlayerSettingsForm(p);
        if (buttonIndex === 8) _deps.showAvatarSettingsForm(p);
        if (buttonIndex === 9) openMainMenu(p);
    });
}

function showPersonalInfoForm(player) {
    let playerXUID = player.xuid;
    let pd = _deps.getPlayerData();
    let playerInfo = pd.players[playerXUID] || {};
    let levelInfo = player.adventureLevelInfo;

    const infoForm = mc.newSimpleForm();
    infoForm.setTitle('§a个人信息');

    let content = '-------------------------\n';
    content += '§a玩家名：§f' + player.name + '\n';
    content += '§aUID：§f' + player.uid + '\n';
    content += '§a冒险等级：§f' + levelInfo.level + '级\n';
    content += '§a注册时间：§f' + (playerInfo.registerTime || '未知') + '\n';
    content += '-------------------------\n';

    infoForm.setContent(content);
    infoForm.addButton('§c返回个人中心', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(infoForm, function(p, buttonIndex) {
        if (buttonIndex === null) return;
        if (buttonIndex === 0) showPersonalCenterForm(p);
    });
}

function showDataStatisticsForm(player) {
    let playerXUID = player.xuid;
    let pd = _deps.getPlayerData();
    const pCount = (pd.players[playerXUID] && pd.players[playerXUID].count) || {};
    const levelInfo = player.adventureLevelInfo;
    const playerMoney = _deps.money ? _deps.money.get(playerXUID) || 0 : 0;

    const statsForm = mc.newSimpleForm();
    statsForm.setTitle('§6数据统计');

    let content = '-------------------------\n';
    content += '§a玩家名：§f' + player.name + '\n';
    content += '§aUID：§f' + player.uid + '\n';
    content += '§a冒险等级：§f' + levelInfo.level + '级\n';
    content += '§a累计经验：§f' + levelInfo.totalExp + '点\n';
    content += '§a现金：§e' + playerMoney + ' 点§c' + _deps.getCurrencyName() + '§r\n';
    content += '§a游玩时长：§f' + U.formatTime(pCount.playTime || 0) + '\n';
    content += '§a挖掘方块：§f' + (pCount.mining || 0) + '个\n';
    content += '§a放置方块：§f' + (pCount.placing || 0) + '个\n';
    content += '§a击杀玩家：§f' + (pCount.kills || 0) + '次\n';
    content += '§a死亡次数：§f' + (pCount.deaths || 0) + '次\n';
    content += '-------------------------\n';

    statsForm.setContent(content);
    statsForm.addButton('§c返回个人中心', 'textures/ui/recap_glyph_desaturated');

    player.sendForm(statsForm, function(p, buttonIndex) {
        if (buttonIndex === null) return;
        if (buttonIndex === 0) showPersonalCenterForm(p);
    });
}

function showNetworkInfoForm(player) {
    const playerXUID = player.xuid;
    const pd = _deps.getPlayerData();
    const playerInfo = pd.players[playerXUID] || {};
    const device = player.getDevice();

    const ip = (device && device.ip) ? U.stripIpPort(device.ip) : '未知';
    let networkType = U.getNetworkType(ip);
    let avgPing = (device && device.avgPing !== undefined) ? device.avgPing : 'N/A';
    let avgPacketLoss = (device && device.avgPacketLoss !== undefined) ? (device.avgPacketLoss * 100).toFixed(1) + '%' : 'N/A';
    let os = (device && device.os) ? device.os : '未知';
    if (os === 'Win32') os = 'GDK';

    let networkTypeColor = '§f';
    if (networkType === '中续转发') networkTypeColor = '§e';
    else if (networkType === '内网连接') networkTypeColor = '§b';
    else if (networkType === '公网IPv4') networkTypeColor = '§a';
    else if (networkType === '公网IPv6') networkTypeColor = '§d';

    let pingColor = '§a';
    if (typeof avgPing === 'number') {
        if (avgPing > 200) pingColor = '§c';
        else if (avgPing > 95) pingColor = '§6';
    }

    let packetLossColor = '§a';
    if (typeof avgPacketLoss === 'string' && avgPacketLoss !== 'N/A') {
        const lossVal = parseFloat(avgPacketLoss);
        if (lossVal > 5) packetLossColor = '§c';
        else if (lossVal > 1) packetLossColor = '§6';
    }

    const gui = mc.newSimpleForm();
    gui.setTitle('§9网络信息');

    let content = '-------------------------\n';
    content += '§a玩家名称：§f' + player.name + '\n';
    content += '§aUID：§f' + (playerInfo.uid || '未知') + '\n';
    content += '§aIP地址：§f' + ip + '\n';
    content += '§a网络类型：§f' + networkTypeColor + networkType + '\n';
    content += '§a平均延迟：§f' + pingColor + avgPing + 'ms\n';
    content += '§a平均丢包率：§f' + packetLossColor + avgPacketLoss + '%%\n';
    content += '§a设备系统：§f' + os + '\n';
    content += '-------------------------\n';

    if (player.permLevel !== 0) {
        const onlinePlayers = mc.getOnlinePlayers();
        const otherPlayers = onlinePlayers.filter(function(p) { return p.xuid !== playerXUID; });
        if (otherPlayers.length > 0) {
            content += '\n§6§l在线玩家IP列表：\n';
            content += '-------------------------\n';
            otherPlayers.forEach(function(p) {
                const pDevice = p.getDevice();
                const pIp = (pDevice && pDevice.ip) ? U.stripIpPort(pDevice.ip) : '未知';
                const pType = U.getNetworkType(pIp);
                const pPing = (pDevice && pDevice.avgPing !== undefined) ? pDevice.avgPing + 'ms' : 'N/A';
                content += '§b' + p.name + ' §f- §7' + pIp + ' §f(' + pType + ' §a' + pPing + '§f)\n';
            });
            content += '-------------------------\n';
        }
    }

    gui.setContent(content);
    gui.addButton('§c关闭', 'textures/ui/cancel');

    player.sendForm(gui, function(p, id) {
        if (id === null) return;
    });
}

function showPlayerSettingsForm(player) {
    let xuid = player.xuid;
    const settingsForm = mc.newCustomForm();
    settingsForm.setTitle('§6个人设置');
    const switchIndices = [];
    let dataIdx = 0;
    const schema = C.PLAYER_SETTINGS_SCHEMA;
    for (let i = 0; i < schema.length; i++) {
        const item = schema[i];
        if (item.type === 'label') {
            settingsForm.addLabel(item.text);
            dataIdx++;
        } else {
            settingsForm.addSwitch(item.label, _deps.getPlayerSetting(xuid, item.key));
            switchIndices.push({
                idx: dataIdx,
                key: item.key,
                label: item.label
            });
            dataIdx++;
        }
    }
    player.sendForm(settingsForm, function(p, data) {
        if (data === null || data === undefined) {
            showPersonalCenterForm(p);
            return;
        }
        if (!Array.isArray(data)) {
            showPlayerSettingsForm(p);
            return;
        }
        let changed = false;
        for (let j = 0; j < switchIndices.length; j++) {
            const si = switchIndices[j];
            const newVal = Boolean(data[si.idx]);
            const oldVal = _deps.getPlayerSetting(xuid, si.key);
            if (newVal !== oldVal) {
                _deps.setPlayerSetting(xuid, si.key, newVal);
                p.tell('§a' + si.label.replace(/§./g, '') + '已' + (newVal ? '开启' : '关闭') + '！');
                changed = true;
            }
        }
        if (changed) {
            p.sendModalForm('§a设置修改成功', '§a您的个人设置已成功修改！\n\n请选择操作：', '§a返回个人中心', '§c关闭', function(pl, result) {
                if (result) showPersonalCenterForm(pl);
            });
        } else {
            showPersonalCenterForm(p);
        }
    });
}

// ============ 时钟菜单事件 ============

function registerClockListener() {
    mc.listen('onUseItemOn', function(pl, it) {
        if (!pl || !pl.xuid) return;
        if (it.type !== 'minecraft:clock') return;
        const now = Date.now();
        const xuid = pl.xuid;
        if (_clockThrottle[xuid] && now - _clockThrottle[xuid] < 800) return;
        _clockThrottle[xuid] = now;
        openMainMenu(pl);
    });
}

module.exports = {
    init: init,
    setLevelUpExp: setLevelUpExp,
    installPrototypeExtensions: installPrototypeExtensions,
    registerClockListener: registerClockListener,

    // 工具函数 — 供 index.js 事件监听器使用
    obtainStatBlock: obtainStatBlock,
    bumpStat: bumpStat,
    getPlayerExpByXuid: getPlayerExpByXuid,
    calculateAdventureLevel: calculateAdventureLevel,
    findPlayerByUid: findPlayerByUid,
    getAllPlayersSorted: getAllPlayersSorted,

    // UI入口 — 供命令注册和菜单使用
    openMainMenu: openMainMenu,
    showPersonalCenterForm: showPersonalCenterForm,
    showAdventureLevelPanel: showAdventureLevelPanel,
    showUidSearchInputForm: showUidSearchInputForm,
    showUidListForm: showUidListForm,
    showNetworkInfoForm: showNetworkInfoForm,
    showLevelRewardForm: showLevelRewardForm,
    showPlayerSettingsForm: showPlayerSettingsForm
};
