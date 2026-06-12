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
 * NECE 玩家封禁系统
 * 支持按名称/UID/XUID封禁解封玩家，IP关联封禁检测，游戏内命令与GUI表单操作
 * 封禁数据通过DataManager持久化存储
 */


const fs = require('fs');
const pathModule = require('path');
const U = require('./utils');
const D = require('./debug');

let banDM = null;       // 封禁数据的DataManager实例
let banData = {
    entries: {}         // {xuid: {name, uid, ip, reason, operator, time, banned}}
};
let _deps = {};

/** 获取系统语言 */
function getLang() {
    return _deps.getSystemLanguage ? _deps.getSystemLanguage() : 'zh_CN';
}

/** 翻译函数 */
function t(key) {
    if (!_deps.t) return key;
    var lang = getLang();
    var args = [lang];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    return _deps.t.apply(null, args);
}

/**
 * 初始化封禁模块
 * @param {Object} dm - DataManager实例，用于封禁数据持久化
 * @param {Object} deps - 外部依赖（playerData、t、getSystemLanguage）
 */
function init(dm, deps) {
    D.debugLogModule('ban')('init: 初始化完成');
    banDM = dm;
    _deps = deps || {};
    banData = banDM.load();
    if (!banData.entries) banData.entries = {};
}

/** 立即保存封禁数据到磁盘 */
function saveData() {
    if (!banData.entries) banData.entries = {};
    banDM.save(true);
}

/**
 * 根据标识符（名称/UID/XUID/在线玩家名）解析出玩家信息
 * 优先匹配在线玩家，其次遍历玩家数据，最后检查封禁列表
 * @param {string} identifier - 玩家名称、UID或XUID
 * @returns {?{xuid: string, name: string, uid: string, ip: string, online: boolean}} 解析结果，未找到返回null
 */
function resolvePlayer(identifier) {
    let result = null;
    const playerData = _deps.playerData || {};
    const players = playerData.players || playerData;

    // 优先检查在线玩家
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

    // 遍历玩家数据，按名称或UID匹配
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
                name: info.name || t('ban.unknown_player'),
                uid: info.uid,
                ip: '',
                online: false
            };
            break;
        }
    }

    // 未在玩家数据中找到时，检查是否为已封禁的XUID
    if (!result) {
        if (banData.entries[identifier]) {
            let entry = banData.entries[identifier];
            return {
                xuid: identifier,
                name: entry.name || t('ban.unknown_player'),
                uid: entry.uid || identifier,
                ip: entry.ip || '',
                online: false
            };
        }
    }

    return result;
}

/**
 * 封禁玩家：记录封禁信息并踢出在线玩家
 * @param {string} identifier - 玩家标识（名称/UID/XUID）
 * @param {string} [reason='管理员封禁'] - 封禁原因
 * @param {string} [operator='控制台'] - 操作者名称
 * @returns {{success: boolean, message: string, xuid?: string}}
 */
function banPlayer(identifier, reason, operator) {
    reason = reason || t('ban.default_reason');
    operator = operator || t('ban.default_operator');

    let playerInfo = resolvePlayer(identifier);
    if (!playerInfo) {
        return { success: false, message: t('ban.err_player_not_found', identifier) };
    }

    let xuid = playerInfo.xuid;
    if (banData.entries[xuid]) {
        return { success: false, message: t('ban.err_already_banned', playerInfo.name) };
    }

    // 尝试获取IP
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

    // 在线玩家直接踢出
    const onlinePlayer = mc.getPlayer(xuid);
    if (onlinePlayer) {
        onlinePlayer.kick(t('ban.kick_msg', reason, operator));
    }

    var uidPart = (playerInfo.uid && playerInfo.uid !== xuid) ? t('ban.ban_success_uid', playerInfo.uid) : '';
    var ipPart = ip ? t('ban.ban_success_ip', ip) : '';
    return { success: true, message: t('ban.ban_success', playerInfo.name, xuid, uidPart + ipPart, reason), xuid: xuid };
}

/**
 * 解封玩家：从封禁列表中移除
 * @param {string} identifier - 玩家标识（名称/UID/XUID）
 * @returns {{success: boolean, message: string}}
 */
function unbanPlayer(identifier) {
    const playerInfo = resolvePlayer(identifier);
    if (!playerInfo) {
        // 玩家数据中找不到时，尝试直接按XUID从封禁列表解封
        if (banData.entries[identifier]) {
            let entry = banData.entries[identifier];
            delete banData.entries[identifier];
            saveData();
            return { success: true, message: t('ban.unban_success_xuid', identifier, entry.name || t('ban.unknown')) };
        }
        return { success: false, message: t('ban.err_player_not_found', identifier) };
    }

    const xuid = playerInfo.xuid;
    if (!banData.entries[xuid]) {
        return { success: false, message: t('ban.err_not_banned', playerInfo.name) };
    }

    let entry = banData.entries[xuid];
    delete banData.entries[xuid];
    saveData();

    return { success: true, message: t('ban.unban_success', playerInfo.name, xuid) };
}

/**
 * 检查玩家是否被封禁，支持IP关联封禁检测
 * @param {string} xuid - 玩家XUID
 * @param {string} [ip] - 玩家IP，提供后会检查是否有相同IP的封禁记录
 * @returns {{banned: boolean, reason?: string, entry?: Object}}
 */
function isPlayerBanned(xuid, ip) {
    // 先按XUID检查
    if (banData.entries[xuid] && banData.entries[xuid].banned) {
        return { banned: true, reason: banData.entries[xuid].reason, entry: banData.entries[xuid] };
    }
    // 再按IP关联检查，防止换号绕过封禁
    if (ip) {
        for (let bxuid in banData.entries) {
            if (!banData.entries.hasOwnProperty(bxuid)) continue;
            let entry = banData.entries[bxuid];
            if (entry.banned && entry.ip && entry.ip === ip) {
                return { banned: true, reason: t('ban.ip_linked_ban', bxuid, entry.reason), entry: entry };
            }
        }
    }
    return { banned: false };
}

/**
 * 获取所有封禁玩家列表
 * @returns {Array<{xuid: string, name: string, uid: string, ip: string, reason: string, operator: string, time: string}>}
 */
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

/**
 * 显示封禁列表GUI表单，可查看详情或添加新封禁
 * @param {Player} player - 打开表单的玩家
 */
function showBanListForm(player) {
    let banList = getBanList();
    let gui = mc.newSimpleForm();
    gui.setTitle(t('ban.title_ban_list'));

    if (banList.length === 0) {
        player.sendModalForm(t('ban.title_ban_list'), t('ban.empty_ban_list'), t('ban.btn_back'), t('ban.btn_close'), function(p, result) {
            if (result) showBanMainForm(p);
        });
        return;
    } else {
        gui.setContent(t('ban.ban_list_content', banList.length));
        banList.forEach(function(entry) {
            gui.addButton(t('ban.ban_list_entry', entry.name, entry.xuid, entry.reason));
        });
    }

    // 最后两个按钮：封禁玩家、返回
    gui.addButton(t('ban.btn_ban_player'), "textures/ui/color_plus");
    gui.addButton(t('ban.btn_back'), "textures/ui/recap_glyph_desaturated");

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

/**
 * 显示单个封禁记录的详情表单，提供解封操作
 * @param {Player} player - 打开表单的玩家
 * @param {Object} entry - 封禁记录对象
 */
function showBanDetailForm(player, entry) {
    let gui = mc.newSimpleForm();
    gui.setTitle(t('ban.title_ban_detail', entry.name));

    let content = "-------------------------\n";
    content += t('ban.detail_name', entry.name) + "\n";
    content += t('ban.detail_xuid', entry.xuid) + "\n";
    content += t('ban.detail_uid', entry.uid || t('ban.unknown')) + "\n";
    content += t('ban.detail_ip', entry.ip || t('ban.unrecorded')) + "\n";
    content += t('ban.detail_reason', entry.reason) + "\n";
    content += t('ban.detail_operator', entry.operator) + "\n";
    content += t('ban.detail_time', entry.time) + "\n";
    content += "-------------------------\n";

    gui.setContent(content);
    gui.addButton(t('ban.btn_unban'), "textures/ui/check");
    gui.addButton(t('ban.btn_back'), "textures/ui/recap_glyph_desaturated");

    player.sendForm(gui, function(p, id) {
        if (id === null) return;

        if (id === 0) {
            // 解封前弹出二次确认
            p.sendModalForm(t('ban.confirm_unban_title'), t('ban.confirm_unban_msg', entry.name), t('ban.btn_confirm'), t('ban.btn_cancel'), function(pl, res) {
                if (res) {
                    let result = unbanPlayer(entry.xuid);
                    pl.tell("" + result.message);
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

/**
 * 显示封禁玩家的自定义表单，输入标识符和原因
 * @param {Player} player - 打开表单的玩家
 */
function showBanPlayerForm(player) {
    const gui = mc.newCustomForm();
    gui.setTitle(t('ban.title_ban_player'));
    gui.addInput(t('ban.input_id_placeholder'), t('ban.input_id_hint'), "");
    gui.addInput(t('ban.input_reason_placeholder'), t('ban.input_reason_hint'), t('ban.default_reason'));

    player.sendForm(gui, function(p, data) {
        if (data == null || data === undefined || !Array.isArray(data)) {
            showBanListForm(p);
            return;
        }

        let identifier = (data[0] || "").trim();
        let reason = (data[1] || "").trim() || t('ban.default_reason');

        if (!identifier) {
            p.tell(t('ban.err_empty_identifier'));
            showBanPlayerForm(p);
            return;
        }

        let result = banPlayer(identifier, reason, p.name);
        p.tell("" + (result.success ? "§a" + result.message : "§c" + result.message));
        showBanListForm(p);
    });
}

/** 注册控制台命令：ban、unban、banlist */
function registerConsoleCommands() {
    try {
        mc.regConsoleCmd('ban', t('ban.cmd_ban_desc'), function(args) {
            if (args.length < 1) {
                logger.info(t('ban.cmd_usage_ban'));
                return;
            }
            let identifier = args[0];
            let reason = args.length > 1 ? args.slice(1).join(' ') : t('ban.default_operator') + t('ban.default_reason');
            let result = banPlayer(identifier, reason, t('ban.default_operator'));
            logger.info(result.message);
        });
    } catch (error) {
        logger.error(t('ban.err_cmd_register', 'ban', error));
    }

    try {
        mc.regConsoleCmd('unban', t('ban.cmd_unban_desc'), function(args) {
            if (args.length < 1) {
                logger.info(t('ban.cmd_usage_unban'));
                return;
            }
            let identifier = args[0];
            let result = unbanPlayer(identifier);
            logger.info(result.message);
        });
    } catch (error) {
        logger.error(t('ban.err_cmd_register', 'unban', error));
    }

    try {
        mc.regConsoleCmd('banlist', t('ban.cmd_banlist_desc'), function(args) {
            const banList = getBanList();
            if (banList.length === 0) {
                logger.info(t('ban.cmd_banlist_empty'));
                return;
            }
            logger.info(t('ban.cmd_banlist_header', banList.length));
            banList.forEach(function(entry) {
                logger.info(t('ban.cmd_banlist_entry', entry.name, entry.xuid, entry.uid || t('ban.unknown'), entry.ip || t('ban.unrecorded'), entry.reason, entry.operator));
            });
        });
    } catch (error) {
        logger.error(t('ban.err_cmd_register', 'banlist', error));
    }
}

/** 注册游戏内命令：/ban、/unban、/banlist */
function registerGameCommands() {
    try {
        const banCmd = mc.newCommand('ban', t('ban.game_cmd_ban'), PermType.GameMasters);
        banCmd.mandatory('target', ParamType.RawText);
        banCmd.optional('reason', ParamType.RawText);
        banCmd.overload(['target', 'reason']);
        banCmd.setCallback(function(_cmd, origin, output, results) {
            let player = origin.player;
            let identifier = String(results.target || '').trim();
            const reason = String(results.reason || t('ban.default_reason')).trim();
            if (!identifier) {
                if (player) player.tell(t('ban.game_usage_ban'));
                else logger.info(t('ban.cmd_usage_ban'));
                return;
            }
            const operator = player ? player.name : t('ban.default_operator');
            let result = banPlayer(identifier, reason, operator);
            if (player) player.tell('' + (result.success ? '§a' + result.message : '§c' + result.message));
            else logger.info(result.message);
        });
        banCmd.setup();
    } catch (error) {
        logger.error(t('ban.err_cmd_register', 'ban', error));
    }

    try {
        const unbanCmd = mc.newCommand('unban', t('ban.game_cmd_unban'), PermType.GameMasters);
        unbanCmd.mandatory('target', ParamType.RawText);
        unbanCmd.overload(['target']);
        unbanCmd.setCallback(function(_cmd, origin, output, results) {
            let player = origin.player;
            const identifier = String(results.target || '').trim();
            if (!identifier) {
                if (player) player.tell(t('ban.game_usage_unban'));
                else logger.info(t('ban.cmd_usage_unban'));
                return;
            }
            const result = unbanPlayer(identifier);
            if (player) player.tell('' + (result.success ? '§a' + result.message : '§c' + result.message));
            else logger.info(result.message);
        });
        unbanCmd.setup();
    } catch (error) {
        logger.error(t('ban.err_cmd_register', 'unban', error));
    }

    try {
        const banlistCmd = mc.newCommand('banlist', t('ban.game_cmd_banlist'), PermType.GameMasters);
        banlistCmd.overload([]);
        banlistCmd.setCallback(function(_cmd, origin, output, results) {
            const player = origin.player;
            if (player) {
                showBanListForm(player);
            } else {
                const list = getBanList();
                if (list.length === 0) {
                    logger.info(t('ban.cmd_banlist_empty'));
                } else {
                    logger.info(t('ban.cmd_banlist_header', list.length));
                    list.forEach(function(entry) {
                        logger.info(t('ban.cmd_banlist_entry_short', entry.name, entry.xuid, entry.reason));
                    });
                }
            }
        });
        banlistCmd.setup();
    } catch (error) {
        logger.error(t('ban.err_cmd_register', 'banlist', error));
    }
}

/** Web API用封禁接口，默认操作者为"API" */
function apiBan(identifier, reason, operator) {
    return banPlayer(identifier, reason || t('ban.default_reason_api'), operator || t('ban.default_operator_api'));
}

/** Web API用解封接口 */
function apiUnban(identifier) {
    return unbanPlayer(identifier);
}

/** Web API用获取封禁列表接口 */
function apiGetBanList() {
    return getBanList();
}

/** Web API用封禁状态检查接口 */
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
