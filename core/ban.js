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
 * NLCE 玩家封禁系统
 * 支持按名称/UID/XUID封禁解封玩家，IP关联封禁检测，游戏内命令与GUI表单操作
 */


const fs = require('fs');
const pathModule = require('path');
const U = require('./utils');
const D = require('./debug');

let banDM = null;
let banData = {
    entries: {}
};
let _deps = {};

function init(dm, deps) {
	D.debugLogModule('ban')('init: 初始化完成');
    banDM = dm;
    _deps = deps || {};
    banData = banDM.load();
    if (!banData.entries) banData.entries = {};
}

function saveData() {
    if (!banData.entries) banData.entries = {};
    banDM.save(true);
}

function resolvePlayer(identifier) {
    let result = null;
    const playerData = _deps.playerData || {};
    const players = playerData.players || playerData;

    let onlinePlayer = mc.getPlayer(identifier);
    if (onlinePlayer) {
        return {
            xuid: onlinePlayer.xuid,
            name: onlinePlayer.name,
            uid: onlinePlayer.xuid,
            ip: onlinePlayer.getDevice ? onlinePlayer.getDevice().ip : (onlinePlayer.ip || ''),
            online: true
        };
    }

    for (let xuid in players) {
        if (!players.hasOwnProperty(xuid)) continue;
        const info = players[xuid];
        if (info.name && info.name.toLowerCase() === identifier.toLowerCase()) {
            result = {
                xuid: xuid,
                name: info.name,
                uid: info.uid || xuid,
                ip: '',
                online: false
            };
            break;
        }
        if (info.uid && String(info.uid) === String(identifier)) {
            result = {
                xuid: xuid,
                name: info.name || '未知玩家',
                uid: info.uid,
                ip: '',
                online: false
            };
            break;
        }
    }

    if (!result) {
        if (banData.entries[identifier]) {
            let entry = banData.entries[identifier];
            return {
                xuid: identifier,
                name: entry.name || '未知玩家',
                uid: entry.uid || identifier,
                ip: entry.ip || '',
                online: false
            };
        }
    }

    return result;
}

function banPlayer(identifier, reason, operator) {
    reason = reason || '管理员封禁';
    operator = operator || '控制台';

    let playerInfo = resolvePlayer(identifier);
    if (!playerInfo) {
        return { success: false, message: '未找到玩家：' + identifier };
    }

    let xuid = playerInfo.xuid;
    if (banData.entries[xuid]) {
        return { success: false, message: '玩家 ' + playerInfo.name + ' 已在封禁列表中' };
    }

    let ip = playerInfo.ip;
    if (!ip) {
        let onlinePlayer = mc.getPlayer(xuid);
        if (onlinePlayer && onlinePlayer.getDevice) {
            ip = onlinePlayer.getDevice().ip;
        }
    }

    banData.entries[xuid] = {
        name: playerInfo.name,
        uid: playerInfo.uid,
        ip: ip || '',
        reason: reason,
        operator: operator,
        time: U.getCurrentTimeString(),
        banned: true
    };
    saveData();

    const onlinePlayer = mc.getPlayer(xuid);
    if (onlinePlayer) {
        onlinePlayer.kick('§c你已被封禁\n§e原因：' + reason + '\n§e操作者：' + operator);
    }

    let msg = '已封禁玩家 ' + playerInfo.name + ' (XUID: ' + xuid;
    if (playerInfo.uid && playerInfo.uid !== xuid) msg += ', UID: ' + playerInfo.uid;
    if (ip) msg += ', IP: ' + ip;
    msg += ')，原因：' + reason;

    return { success: true, message: msg, xuid: xuid };
}

function unbanPlayer(identifier) {
    const playerInfo = resolvePlayer(identifier);
    if (!playerInfo) {
        if (banData.entries[identifier]) {
            let entry = banData.entries[identifier];
            delete banData.entries[identifier];
            saveData();
            return { success: true, message: '已解封 XUID: ' + identifier + ' (' + (entry.name || '未知') + ')' };
        }
        return { success: false, message: '未找到玩家：' + identifier };
    }

    const xuid = playerInfo.xuid;
    if (!banData.entries[xuid]) {
        return { success: false, message: '玩家 ' + playerInfo.name + ' 不在封禁列表中' };
    }

    let entry = banData.entries[xuid];
    delete banData.entries[xuid];
    saveData();

    const msg = '已解封玩家 ' + playerInfo.name + ' (XUID: ' + xuid + ')';
    return { success: true, message: msg };
}

function isPlayerBanned(xuid, ip) {
    if (banData.entries[xuid] && banData.entries[xuid].banned) {
        return { banned: true, reason: banData.entries[xuid].reason, entry: banData.entries[xuid] };
    }
    if (ip) {
        for (let bxuid in banData.entries) {
            if (!banData.entries.hasOwnProperty(bxuid)) continue;
            let entry = banData.entries[bxuid];
            if (entry.banned && entry.ip && entry.ip === ip) {
                return { banned: true, reason: 'IP关联封禁 (关联XUID: ' + bxuid + ', 原因: ' + entry.reason + ')', entry: entry };
            }
        }
    }
    return { banned: false };
}

function getBanList() {
    let list = [];
    for (let xuid in banData.entries) {
        if (!banData.entries.hasOwnProperty(xuid)) continue;
        const entry = banData.entries[xuid];
        if (entry.banned) {
            list.push(Object.assign({ xuid: xuid }, entry));
        }
    }
    return list;
}

function showBanListForm(player) {
    let banList = getBanList();
    let gui = mc.newSimpleForm();
    gui.setTitle("§l§c封禁列表");

    if (banList.length === 0) {
        gui.setContent("§a当前没有封禁的玩家");
    } else {
        gui.setContent("§c共有 " + banList.length + " 名被封禁的玩家：\n点击查看详情");
        banList.forEach(function(entry) {
            gui.addButton("§c" + entry.name + "\n§6XUID: " + entry.xuid + " | 原因: " + entry.reason);
        });
    }

    gui.addButton("§a封禁玩家", "textures/ui/color_plus");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id >= 0 && id < banList.length) {
            showBanDetailForm(p, banList[id]);
        } else if (id === banList.length) {
            showBanPlayerForm(p);
        } else {
            if (_deps.showAdminMenu) _deps.showAdminMenu(p);
        }
    });
}

function showBanDetailForm(player, entry) {
    let gui = mc.newSimpleForm();
    gui.setTitle("§l§c封禁详情 - " + entry.name);

    let content = "-------------------------\n";
    content += "§c玩家名称：§f" + entry.name + "\n";
    content += "§cXUID：§f" + entry.xuid + "\n";
    content += "§cUID：§f" + (entry.uid || "未知") + "\n";
    content += "§cIP：§f" + (entry.ip || "未记录") + "\n";
    content += "§c封禁原因：§f" + entry.reason + "\n";
    content += "§c操作者：§f" + entry.operator + "\n";
    content += "§c封禁时间：§f" + entry.time + "\n";
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton("§a解封", "textures/ui/check");
    gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            p.sendModalForm("§a确认解封", "§a确定要解封玩家 §f" + entry.name + " §a吗？", "§a确认", "§c取消", function(pl, res) {
                if (res) {
                    let result = unbanPlayer(entry.xuid);
                    pl.tell(result.message);
                    showBanListForm(pl);
                } else {
                    showBanDetailForm(pl, entry);
                }
            });
        } else {
            showBanListForm(p);
        }
    });
}

function showBanPlayerForm(player) {
    const gui = mc.newCustomForm();
    gui.setTitle("§l§c封禁玩家");
    gui.addInput("玩家ID/UID/XUID", "输入玩家名称、UID或XUID", "");
    gui.addInput("封禁原因", "输入封禁原因（可选）", "管理员封禁");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            showBanListForm(p);
            return;
        }

        let identifier = (data[0] || "").trim();
        let reason = (data[1] || "").trim() || "管理员封禁";

        if (!identifier) {
            p.tell("§c请输入玩家标识！");
            showBanPlayerForm(p);
            return;
        }

        let result = banPlayer(identifier, reason, p.name);
        p.tell(result.success ? "§a" + result.message : "§c" + result.message);
        showBanListForm(p);
    });
}

function registerConsoleCommands() {
    try {
        mc.regConsoleCmd('ban', '封禁玩家 (支持ID/UID/XUID)', function(args) {
            if (args.length < 1) {
                logger.info('用法: ban <玩家ID/UID/XUID> [原因]');
                return;
            }
            let identifier = args[0];
            let reason = args.length > 1 ? args.slice(1).join(' ') : '控制台封禁';
            let result = banPlayer(identifier, reason, '控制台');
            logger.info(result.message);
        });
    } catch (error) {
        logger.error('/ban 控制台命令注册出错！错误：' + error);
    }

    try {
        mc.regConsoleCmd('unban', '解封玩家 (支持ID/UID/XUID)', function(args) {
            if (args.length < 1) {
                logger.info('用法: unban <玩家ID/UID/XUID>');
                return;
            }
            let identifier = args[0];
            let result = unbanPlayer(identifier);
            logger.info(result.message);
        });
    } catch (error) {
        logger.error('/unban 控制台命令注册出错！错误：' + error);
    }

    try {
        mc.regConsoleCmd('banlist', '查看封禁列表', function(args) {
            const banList = getBanList();
            if (banList.length === 0) {
                logger.info('当前没有封禁的玩家');
                return;
            }
            logger.info('封禁列表 (' + banList.length + ' 人)：');
            banList.forEach(function(entry) {
                logger.info('  ' + entry.name + ' | XUID: ' + entry.xuid + ' | UID: ' + (entry.uid || '未知') + ' | IP: ' + (entry.ip || '未记录') + ' | 原因: ' + entry.reason + ' | 操作者: ' + entry.operator);
            });
        });
    } catch (error) {
        logger.error('/banlist 控制台命令注册出错！错误：' + error);
    }
}

function registerGameCommands() {
    try {
        const banCmd = mc.newCommand('ban', '封禁玩家', PermType.GameMasters);
        banCmd.mandatory('target', ParamType.RawText);
        banCmd.optional('reason', ParamType.RawText);
        banCmd.overload(['target', 'reason']);
        banCmd.setCallback(function(_cmd, origin, output, results) {
            let player = origin.player;
            let identifier = String(results.target || '').trim();
            const reason = String(results.reason || '管理员封禁').trim();
            if (!identifier) {
                if (player) player.tell('§c用法: /ban <玩家ID/UID/XUID> [原因]');
                else logger.info('用法: ban <玩家ID/UID/XUID> [原因]');
                return;
            }
            const operator = player ? player.name : '控制台';
            let result = banPlayer(identifier, reason, operator);
            if (player) player.tell(result.success ? '§a' + result.message : '§c' + result.message);
            else logger.info(result.message);
        });
        banCmd.setup();
    } catch (error) {
        logger.error('/ban 游戏命令注册出错！错误：' + error);
    }

    try {
        const unbanCmd = mc.newCommand('unban', '解封玩家', PermType.GameMasters);
        unbanCmd.mandatory('target', ParamType.RawText);
        unbanCmd.overload(['target']);
        unbanCmd.setCallback(function(_cmd, origin, output, results) {
            let player = origin.player;
            const identifier = String(results.target || '').trim();
            if (!identifier) {
                if (player) player.tell('§c用法: /unban <玩家ID/UID/XUID>');
                else logger.info('用法: unban <玩家ID/UID/XUID>');
                return;
            }
            const result = unbanPlayer(identifier);
            if (player) player.tell(result.success ? '§a' + result.message : '§c' + result.message);
            else logger.info(result.message);
        });
        unbanCmd.setup();
    } catch (error) {
        logger.error('/unban 游戏命令注册出错！错误：' + error);
    }

    try {
        const banlistCmd = mc.newCommand('banlist', '查看封禁列表', PermType.GameMasters);
        banlistCmd.overload([]);
        banlistCmd.setCallback(function(_cmd, origin, output, results) {
            const player = origin.player;
            if (player) {
                showBanListForm(player);
            } else {
                const list = getBanList();
                if (list.length === 0) {
                    logger.info('当前没有封禁的玩家');
                } else {
                    logger.info('封禁列表 (' + list.length + ' 人)：');
                    list.forEach(function(entry) {
                        logger.info('  ' + entry.name + ' | XUID: ' + entry.xuid + ' | 原因: ' + entry.reason);
                    });
                }
            }
        });
        banlistCmd.setup();
    } catch (error) {
        logger.error('/banlist 游戏命令注册出错！错误：' + error);
    }
}

function apiBan(identifier, reason, operator) {
    return banPlayer(identifier, reason || 'API封禁', operator || 'API');
}

function apiUnban(identifier) {
    return unbanPlayer(identifier);
}

function apiGetBanList() {
    return getBanList();
}

function apiIsBanned(xuid, ip) {
    return isPlayerBanned(xuid, ip);
}

module.exports = {
    init: init,
    banPlayer: banPlayer,
    unbanPlayer: unbanPlayer,
    isPlayerBanned: isPlayerBanned,
    getBanList: getBanList,
    showBanListForm: showBanListForm,
    registerConsoleCommands: registerConsoleCommands,
    registerGameCommands: registerGameCommands,
    apiBan: apiBan,
    apiUnban: apiUnban,
    apiGetBanList: apiGetBanList,
    apiIsBanned: apiIsBanned
};
