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
 * NECE 经济系统
 * 余额查询、增减、转账、经济日志
 */

const fs = require('fs');
const U = require('./utils');
const i18n = require('./i18n');

let _currencyNameCache = null;
let _deps = {};

/** 初始化经济模块 */
function init(deps) {
    _currencyNameCache = null;
    _deps = deps;

    // 每5分钟清理超过10分钟的转账去重记录
    setInterval(function() {
        var now = Date.now();
        for (var xuid in _recentTransfers) {
            if (!_recentTransfers.hasOwnProperty(xuid)) continue;
            var records = _recentTransfers[xuid];
            for (var key in records) {
                if (records.hasOwnProperty(key) && now - records[key] > 600000) {
                    delete records[key];
                }
            }
            if (Object.keys(records).length === 0) {
                delete _recentTransfers[xuid];
            }
        }
    }, 300000);
}

/**
 * 获取系统默认语言
 * @returns {string}
 */
function getSystemLang() {
    return _deps.getSystemLanguage ? _deps.getSystemLanguage() : 'zh_CN';
}

/**
 * 本地翻译包装
 * @param {string} key - 翻译键
 * @param {...any} args - 替换参数
 * @returns {string}
 */
function t(key) {
    var lang = getSystemLang();
    var args = [lang, key];
    for (var i = 1; i < arguments.length; i++) {
        args.push(arguments[i]);
    }
    return i18n.t.apply(null, args);
}

/** 获取货币名称 */
function getCurrencyName() {
    if (_currencyNameCache !== null) return _currencyNameCache;
    try {
        var langData = _deps.loadLocale ? _deps.loadLocale(getSystemLang()) : null;
        if (langData && langData._meta && langData._meta.currencyName) {
            _currencyNameCache = langData._meta.currencyName;
            return _currencyNameCache;
        }
    } catch (e) {}
    _currencyNameCache = t('economy.currency_fallback');
    return _currencyNameCache;
}

/**
 * 向玩家发送货币变动通知
 * @param {object} player - 目标玩家
 * @param {number} amount - 变动金额
 * @param {string} source - 变动来源描述
 */
function notifyEconomyChange(player, amount, source) {
    try {
        const sign = amount >= 0 ? "+" : "";
        const line1 = sign + amount + getCurrencyName();
        const line2 = source || t('economy.other');
        player.sendToast(line2, line1);
    } catch (e) { /* player可能已离线 */ }
}

/**
 * 获取玩家余额
 * @param {object} player - 玩家对象
 * @returns {number} 玩家余额，异常时返回0
 */
function getPlayerMoney(player) {
    try {
        if (typeof money === 'undefined' || money === null) {
            logger.error('money对象不存在，无法获取玩家货币！');
            return 0;
        }
        if (typeof money.get !== 'function') {
            logger.error('money对象没有get方法，无法获取玩家货币！');
            return 0;
        }

        let xuid = player.xuid;

        if (!xuid) {
            logger.error('玩家XUID不存在，无法获取货币！');
            return 0;
        }

        let balance = money.get(xuid);
        if (typeof balance !== 'number' || isNaN(balance)) {
            logger.info('玩家 ' + player.name + ' (' + xuid + ') 余额为NaN或不是数字，返回0');
            return 0;
        }

        return balance;
    } catch (error) {
        logger.error('获取玩家货币时发生错误：' + error.message);
        if (error.stack) {
            logger.error('错误堆栈：' + error.stack);
        }
        return 0;
    }
}

/**
 * 扣除玩家货币
 * @param {object} player - 玩家对象
 * @param {number} value - 扣除金额
 * @param {string} reason - 扣费原因
 * @returns {boolean} 是否扣费成功
 */
function reducePlayerMoney(player, value, reason) {
    try {
        if (typeof money === 'undefined' || money === null) {
            logger.error('money对象不存在，无法减少玩家货币！');
            return false;
        }
        if (typeof money.reduce !== 'function') {
            logger.error('money对象没有reduce方法，无法减少玩家货币！');
            return false;
        }

        let intValue = Math.floor(Number(value));
        let xuid = player.xuid;

        if (!xuid) {
            logger.error('玩家XUID不存在，无法减少货币！');
            return false;
        }

        if (typeof money.get !== 'function') {
            logger.error('money对象没有get方法，无法获取玩家余额！');
            return false;
        }

        const beforeMoney = money.get(xuid) || 0;
        if (_deps.getDebug && _deps.getDebug()) logger.info('尝试减少玩家 ' + player.name + ' (' + xuid + ') 货币：' + beforeMoney + ' - ' + intValue);

        let success = money.reduce(xuid, intValue);
        if (_deps.getDebug && _deps.getDebug()) logger.info('money.reduce调用结果：' + success);

        const afterMoney = money.get(xuid) || 0;
        if (_deps.getDebug && _deps.getDebug()) logger.info('减少货币后余额：' + afterMoney);

        if (success) {
            writeEconomyLog({
                action: 'reduce',
                player: player.name || '',
                xuid: xuid,
                amount: intValue,
                balance: afterMoney,
                reason: reason || t('economy.reason_system_deduct')
            });
            notifyEconomyChange(player, -intValue, reason || t('economy.reason_system_deduct'));
            return true;
        } else {
            logger.error('减少玩家 ' + player.name + ' 货币失败！');
            return false;
        }
    } catch (error) {
        logger.error('减少玩家货币时发生错误：' + error.message);
        if (error.stack) {
            logger.error('错误堆栈：' + error.stack);
        }
        return false;
    }
}

/**
 * 增加玩家货币
 * @param {object} player - 玩家对象
 * @param {number} value - 增加金额
 * @param {string} reason - 收入原因
 * @returns {boolean} 是否操作成功
 */
function addPlayerMoney(player, value, reason) {
    try {
        if (typeof money === 'undefined' || money === null) {
            logger.error('money对象不存在，无法增加玩家货币！');
            return false;
        }
        if (typeof money.add !== 'function') {
            logger.error('money对象没有add方法，无法增加玩家货币！');
            return false;
        }

        let intValue = Math.floor(Number(value));
        let xuid = player.xuid;

        if (!xuid) {
            logger.error('玩家XUID不存在，无法增加货币！');
            return false;
        }

        if (_deps.getDebug && _deps.getDebug()) logger.info('尝试增加玩家 ' + player.name + ' (' + xuid + ') 货币：' + intValue);

        let success = money.add(xuid, intValue);
        if (_deps.getDebug && _deps.getDebug()) logger.info('money.add调用结果：' + success);

        if (success) {
            const afterMoney = money.get(xuid) || 0;
            writeEconomyLog({
                action: 'add',
                player: player.name || '',
                xuid: xuid,
                amount: intValue,
                balance: afterMoney,
                reason: reason || t('economy.reason_system_income')
            });
            notifyEconomyChange(player, intValue, reason || t('economy.reason_system_income'));
            return true;
        } else {
            logger.error('增加玩家 ' + player.name + ' 货币失败！');
            return false;
        }
    } catch (error) {
        logger.error('增加玩家货币时发生错误：' + error.message);
        if (error.stack) {
            logger.error('错误堆栈：' + error.stack);
        }
        return false;
    }
}

/**
 * 通过XUID获取余额
 * @param {string} xuid - 玩家XUID
 * @returns {number} 余额，异常时返回0
 */
function getPlayerMoneyByXuid(xuid) {
    try {
        if (typeof money === 'undefined' || money === null) return 0;
        if (typeof money.get !== 'function') return 0;
        if (!xuid) return 0;
        let balance = money.get(xuid);
        if (typeof balance !== 'number' || isNaN(balance)) return 0;
        return balance;
    } catch (e) {
        return 0;
    }
}

/**
 * 通过XUID增加货币
 * @param {string} xuid - 玩家XUID
 * @param {number} value - 增加金额
 * @param {string} source - 收入来源描述
 * @returns {boolean} 是否成功
 */
function addPlayerMoneyByXuid(xuid, value, source) {
    try {
        if (typeof money === 'undefined' || money === null) return false;
        if (typeof money.add !== 'function') return false;
        if (!xuid) return false;
        const intValue = Math.floor(Number(value));
        const success = money.add(xuid, intValue);
        if (success) {
            const player = mc.getPlayer(xuid);
            if (player) {
                notifyEconomyChange(player, intValue, source || t('economy.reason_system_income'));
            }
        }
        return success;
    } catch (e) {
        return false;
    }
}

/**
 * 通过XUID减少货币
 * @param {string} xuid - 玩家XUID
 * @param {number} value - 扣除金额
 * @param {string} source - 扣费来源描述
 * @returns {boolean} 是否成功
 */
function reducePlayerMoneyByXuid(xuid, value, source) {
    try {
        if (typeof money === 'undefined' || money === null) return false;
        if (typeof money.reduce !== 'function') return false;
        if (!xuid) return false;
        const intValue = Math.floor(Number(value));
        const success = money.reduce(xuid, intValue);
        if (success) {
            const player = mc.getPlayer(xuid);
            if (player) {
                notifyEconomyChange(player, -intValue, source || t('economy.reason_system_deduct'));
            }
        }
        return success;
    } catch (e) {
        return false;
    }
}

// ============ 转账系统 ============


/**
 * 写入统一经济日志
 * @param {object} entry - 日志条目
 */
function writeEconomyLog(entry) {
    try {
        const logDir = "plugins/NECE/logs/economy";
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const now = new Date();
        const dateStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
        const logPath = logDir + "/economy-" + dateStr + ".jsonl";
        entry.time = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');
        const line = JSON.stringify(entry) + '\n';
        fs.appendFile(logPath, line, 'utf-8', function(e) {
            if (e) logger.error("[EconomyLog] 写入日志失败: " + e.message);
        });
    } catch (e) {
        logger.error("[EconomyLog] 写入日志失败: " + e.message);
    }
}

/**
 * 写入转账日志
 */
function _writeTransferLog(senderName, targetName, amount, senderBalance, targetBalance) {
    writeEconomyLog({
        action: 'transfer',
        player: senderName,
        target: targetName,
        amount: amount,
        balance: senderBalance,
        detail: t('economy.log_target_balance', targetBalance)
    });
}

/** 显示经济系统主界面 */
function showMoneyMainForm(player) {
    let fm = mc.newSimpleForm();
    fm.setTitle(t('economy.main_title'));
    let balance = getPlayerMoney(player);
    fm.setContent(t('economy.main_content', balance, getCurrencyName()));
    fm.addButton(t('economy.main_btn_transfer'), "textures/ui/icon_recipe_equipment");
    fm.addButton(t('economy.btn_close'), "textures/ui/cancel");
    player.sendForm(fm, function(p, id) {
        if (id === null || id === 1) return;
        if (id === 0) showTransferTypeForm(p);
    });
}

/** 显示经济面板 */
function showEconomyPanel(player) {
    let fm = mc.newSimpleForm();
    fm.setTitle(t('economy.panel_title'));
    let balance = getPlayerMoney(player);
    fm.setContent(t('economy.panel_balance', balance, getCurrencyName()));
    fm.addButton(t('economy.panel_btn_transfer'), "textures/ui/icon_recipe_equipment");
    fm.addButton(t('economy.panel_btn_bill'), "textures/ui/icon_book_writable");
    fm.addButton(t('economy.btn_close'), "textures/ui/cancel");
    player.sendForm(fm, function(p, id) {
        if (id === null || id === 2) return;
        if (id === 0) showTransferTypeForm(p);
        if (id === 1) showEconomyLogForm(p, 1);
    });
}

/** 显示转账对象类型选择 */
function showTransferTypeForm(player) {
    let fm = mc.newSimpleForm();
    fm.setTitle(t('economy.transfer_title'));
    fm.setContent(t('economy.transfer_select_type'));
    fm.addButton(t('economy.transfer_online'), "textures/ui/online");
    fm.addButton(t('economy.transfer_offline'), "textures/ui/offline");
    fm.addButton(t('economy.btn_back'), "textures/ui/recap_glyph_desaturated");
    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id === 2) { showEconomyPanel(p); return; }
        if (id === 0) showTransferOnlineForm(p);
        else if (id === 1) showTransferOfflineForm(p);
    });
}

/** 显示在线玩家转账表单 */
function showTransferOnlineForm(player) {
    const onlineList = mc.getOnlinePlayers();
    const names = [];
    onlineList.forEach(function(p) {
        if (p.xuid !== player.xuid) {
            names.push(p.realName);
        }
    });
    if (names.length === 0) {
        player.sendModalForm(t('economy.transfer_title'), t('economy.transfer_no_other_online'), t('economy.btn_back'), t('economy.btn_close'), function(pl, ok) {
            if (ok === true) showTransferTypeForm(pl);
        });
        return;
    }
    let fm = mc.newCustomForm();
    fm.setTitle(t('economy.transfer_to_online_title'));
    fm.addDropdown(t('economy.transfer_select_player'), names, 0);
    fm.addInput(t('economy.transfer_input_amount'), t('economy.transfer_input_placeholder'), "");
    player.sendForm(fm, function(p, data) {
        if (data == null || !Array.isArray(data)) return;
        const targetName = names[data[0]];
        let amountStr = (data[1] || "").trim();
        if (!amountStr || !U.isInteger(amountStr) || Number(amountStr) <= 0) {
            p.tell(t('economy.transfer_invalid_amount'));
            showTransferOnlineForm(p);
            return;
        }
        let amount = Number(amountStr);
        let balance = getPlayerMoney(p);
        if (balance < amount) {
            p.sendModalForm(t('economy.transfer_insufficient_title'), t('economy.transfer_insufficient_body', amount, getCurrencyName(), balance, getCurrencyName()), t('economy.transfer_btn_reselect'), t('economy.btn_close'), function(pl, ok) {
                if (ok === true) showTransferOnlineForm(pl);
            });
            return;
        }
        let target = mc.getPlayer(targetName);
        if (!target) {
            p.sendModalForm(t('economy.transfer_failed_title'), t('economy.transfer_player_offline'), t('economy.btn_back'), t('economy.btn_close'), function(pl, ok) {
                if (ok === true) showTransferTypeForm(pl);
            });
            return;
        }
        p.sendModalForm(t('economy.transfer_confirm_title'), t('economy.transfer_confirm_body', targetName, amount, getCurrencyName()), t('economy.transfer_btn_confirm'), t('economy.transfer_btn_cancel'), function(pl, ok) {
            if (!ok) return;
            _executeTransfer(pl, targetName, target.xuid, amount);
        });
    });
}

/** 显示离线玩家转账表单 */
function showTransferOfflineForm(player) {
    let fm = mc.newCustomForm();
    fm.setTitle(t('economy.transfer_to_offline_title'));
    fm.addInput(t('economy.transfer_input_name_uid'), "", "");
    player.sendForm(fm, function(p, data) {
        if (data == null || !Array.isArray(data)) return;
        const keyword = (data[0] || "").trim();
        if (!keyword) {
            p.tell(t('economy.transfer_input_search_hint'));
            showTransferOfflineForm(p);
            return;
        }
        const results = [];
        const players = _deps.getPlayerData ? (_deps.getPlayerData().players || {}) : {};
        Object.keys(players).forEach(function(xuid) {
            const info = players[xuid];
            let match = false;
            if (info.name && info.name.toLowerCase().indexOf(keyword.toLowerCase()) >= 0) match = true;
            if (info.uid && info.uid.toString() === keyword) match = true;
            if (match && xuid !== p.xuid) {
                results.push({ xuid: xuid, name: info.name, uid: info.uid });
            }
        });
        _showTransferOfflineResultsForm(p, results, keyword);
    });
}

/** 显示离线玩家搜索结果列表 */
function _showTransferOfflineResultsForm(player, results, keyword) {
    let fm = mc.newSimpleForm();
    fm.setTitle(t('economy.transfer_search_title'));
    if (results.length === 0) {
        fm.setContent(t('economy.transfer_no_match', keyword));
    } else {
        fm.setContent(t('economy.transfer_match_results', results.length));
        results.forEach(function(r) {
            const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(r.xuid) : "textures/ui/icon_steve";
            fm.addButton(r.name + "\nUID: " + r.uid, avatarUrl);
        });
    }
    fm.addButton(t('economy.btn_back'), "textures/ui/recap_glyph_desaturated");
    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        if (id >= results.length) {
            showTransferOfflineForm(p);
            return;
        }
        const target = results[id];
        _showTransferOfflineAmountForm(p, target);
    });
}

/** 显示离线玩家转账金额输入表单 */
function _showTransferOfflineAmountForm(player, target) {
    const fm = mc.newCustomForm();
    fm.setTitle(t('economy.transfer_to_name_title', target.name));
    fm.addLabel(t('economy.transfer_target_label', target.name, target.uid));
    fm.addInput(t('economy.transfer_input_amount'), t('economy.transfer_input_placeholder'), "");
    player.sendForm(fm, function(p, data) {
        if (data == null || !Array.isArray(data)) return;
        const amountStr = (data[1] || "").trim();
        if (!amountStr || !U.isInteger(amountStr) || Number(amountStr) <= 0) {
            p.tell(t('economy.transfer_invalid_amount'));
            _showTransferOfflineAmountForm(p, target);
            return;
        }
        const amount = Number(amountStr);
        const balance = getPlayerMoney(p);
        if (balance < amount) {
            p.sendModalForm(t('economy.transfer_insufficient_title'), t('economy.transfer_insufficient_body', amount, getCurrencyName(), balance, getCurrencyName()), t('economy.transfer_btn_reselect'), t('economy.btn_close'), function(pl, ok) {
                if (ok === true) _showTransferOfflineAmountForm(pl, target);
            });
            return;
        }
        p.sendModalForm(t('economy.transfer_confirm_title'), t('economy.transfer_confirm_body', target.name, amount, getCurrencyName()), t('economy.transfer_btn_confirm'), t('economy.transfer_btn_cancel'), function(pl, ok) {
            if (!ok) return;
            _executeTransfer(pl, target.name, target.xuid, amount);
        });
    });
}

/**
 * 执行转账核心逻辑
 */
const _recentTransfers = {};
function _executeTransfer(sender, targetName, targetXuid, amount) {
    const transferKey = targetXuid + ':' + amount;
    const now = Date.now();
    const senderXuid = sender.xuid;

    // 初始化发送者的转账记录（如果不存在）
    if (!_recentTransfers[senderXuid]) {
        _recentTransfers[senderXuid] = {};
    }

    // 检查是否在3秒内重复转账
    const lastTransferTime = _recentTransfers[senderXuid][transferKey];
    if (lastTransferTime && (now - lastTransferTime) < 3000) {
        sender.tell(t('economy.transfer_duplicate'));
        return;
    }

    // 记录本次转账时间
    _recentTransfers[senderXuid][transferKey] = now;
    if (!reducePlayerMoney(sender, amount, t('economy.reason_transfer_to', targetName))) {
        sender.tell(t('economy.transfer_deduct_failed'));
        return;
    }
    const targetPlayer = mc.getPlayer(targetXuid);
    if (targetPlayer) {
        addPlayerMoney(targetPlayer, amount, t('economy.reason_transfer_from', sender.realName));
    } else {
        _deps.database.addPendingTransferSQL(targetXuid, sender.realName, sender.xuid, amount, new Date().toLocaleString());
    }
    const senderBalance = getPlayerMoney(sender);
    const targetBalance = targetPlayer ? getPlayerMoney(targetPlayer) : getPlayerMoneyByXuid(targetXuid);
    _writeTransferLog(sender.realName, targetName, amount, senderBalance, targetBalance);
    sender.tell(t('economy.transfer_success_tell', targetName, amount, getCurrencyName(), senderBalance, getCurrencyName()));
    sender.sendModalForm(t('economy.transfer_success_title'), t('economy.transfer_success_body', targetName, amount, getCurrencyName(), senderBalance, getCurrencyName()), t('economy.transfer_btn_continue'), t('economy.btn_close'), function(pl, ok) {
        if (ok === true) showTransferTypeForm(pl);
    });
}

/** 玩家上线时检查并通知待领取的离线转账 */
function checkPendingTransfers(player) {
    if (!_deps.database || !_deps.database.getPendingTransfersSQL) return;
    const xuid = player.xuid;
    const transfers = _deps.database.getPendingTransfersSQL(xuid);
    if (transfers.length === 0) return;
    transfers.forEach(function(tr) {
        player.tell(t('economy.transfer_pending_notify', tr.from, tr.amount, getCurrencyName()));
        addPlayerMoney(player, tr.amount, t('economy.reason_transfer_from', tr.from));
    });
    _deps.database.clearPendingTransfersSQL(xuid);
}

/**
 * 统一账单确认弹窗
 * @param {Player} player - 玩家对象
 * @param {number} cost - 消费金额
 * @param {string} reason - 操作原因
 * @param {Function} onConfirm - 确认后的回调
 * @param {Function} [onCancel] - 取消后的回调
 */
function confirmPurchase(player, cost, reason, onConfirm, onCancel) {
    var currencyName = getCurrencyName();
    var balance = getPlayerMoney(player);

    if (balance < cost) {
        var fm = mc.newSimpleForm();
        fm.setTitle(t('economy.bill_insufficient_title'));
        fm.setContent(
            t('economy.bill_op_label', reason || t('economy.bill_unknown_op')) + "\n" +
            t('economy.bill_need_label', cost, currencyName) + "\n" +
            t('economy.bill_balance_label', balance, currencyName) + "\n\n" +
            t('economy.bill_insufficient_msg')
        );
        fm.addButton(t('economy.btn_close'));
        player.sendForm(fm, function(p) { if (onCancel) onCancel(p); });
        return;
    }

    var remaining = balance - cost;
    var fm = mc.newSimpleForm();
    fm.setTitle(t('economy.bill_confirm_title'));
    fm.setContent(
        t('economy.bill_op_label', reason || t('economy.bill_unknown_op')) + "\n" +
        t('economy.bill_need_label', cost, currencyName) + "\n" +
        t('economy.bill_own_label', balance, currencyName) + "\n" +
        t('economy.bill_remaining_label', remaining, currencyName)
    );
    fm.addButton(t('economy.btn_confirm'));
    fm.addButton(t('economy.btn_cancel'));
    player.sendForm(fm, function(p, id) {
        if (id === null || id === 1) {
            if (onCancel) onCancel(p);
            return;
        }
        if (id === 0) onConfirm(p);
    });
}

/**
 * 读取指定玩家的经济日志
 * @param {string} playerName - 玩家名称
 * @param {number} page - 页码
 * @param {number} pageSize - 每页条数
 * @returns {{ logs: Array, total: number, page: number, totalPages: number }}
 */
function readEconomyLog(playerName, page, pageSize) {
    page = page || 1;
    pageSize = pageSize || 10;
    var logDir = "plugins/NECE/logs/economy";
    try {
        if (!fs.existsSync(logDir)) return { logs: [], total: 0, page: page, totalPages: 0 };
        var files = fs.readdirSync(logDir)
            .filter(function(f) { return f.endsWith('.jsonl'); })
            .sort().reverse()
            .slice(0, 7);
        var allLogs = [];
        files.forEach(function(f) {
            try {
                var content = fs.readFileSync(logDir + '/' + f, 'utf-8');
                content.split('\n').forEach(function(line) {
                    if (!line.trim()) return;
                    try {
                        var entry = JSON.parse(line);
                        if (entry.player === playerName) allLogs.push(entry);
                    } catch (e) {}
                });
            } catch (e) {}
        });
        allLogs.sort(function(a, b) {
            var ta = Date.parse(a.time) || 0;
            var tb = Date.parse(b.time) || 0;
            return tb - ta;
        });
        var total = allLogs.length;
        var totalPages = Math.ceil(total / pageSize) || 1;
        var start = (page - 1) * pageSize;
        return { logs: allLogs.slice(start, start + pageSize), total: total, page: page, totalPages: totalPages };
    } catch (e) {
        return { logs: [], total: 0, page: page, totalPages: 0 };
    }
}

/**
 * 显示玩家经济日志表单
 * @param {Player} player - 玩家对象
 * @param {number} page - 页码
 */
function showEconomyLogForm(player, page) {
    page = page || 1;
    var result = readEconomyLog(player.realName, page, 10);
    var currencyName = getCurrencyName();
    var balance = getPlayerMoney(player);

    var content = t('economy.log_balance', balance, currencyName) + "\n";
    content += t('economy.log_page_info', result.page, result.totalPages, result.total) + "\n\n";

    if (result.logs.length === 0) {
        content += t('economy.log_no_records');
    } else {
        result.logs.forEach(function(log, i) {
            var actionIcon = log.action === 'reduce' ? '§c-' : '§a+';
            var actionText = log.action === 'reduce' ? t('economy.log_expense') : t('economy.log_income');
            content += actionIcon + log.amount + " " + actionText + " §f" + (log.reason || '') + " §8" + (log.time || '') + "\n";
        });
    }

    var fm = mc.newSimpleForm();
    fm.setTitle(t('economy.log_title'));
    fm.setContent(content);
    if (page > 1) fm.addButton(t('economy.btn_prev_page'));
    if (page < result.totalPages) fm.addButton(t('economy.btn_next_page'));
    fm.addButton(t('economy.btn_close'));

    player.sendForm(fm, function(p, id) {
        if (id === null) return;
        var btnIdx = 0;
        if (page > 1) {
            if (id === btnIdx) { showEconomyLogForm(p, page - 1); return; }
            btnIdx++;
        }
        if (page < result.totalPages) {
            if (id === btnIdx) { showEconomyLogForm(p, page + 1); return; }
            btnIdx++;
        }
        if (id === btnIdx) return;
    });
}

module.exports = {
    init: init,
    getCurrencyName: getCurrencyName,
    notifyEconomyChange: notifyEconomyChange,
    getPlayerMoney: getPlayerMoney,
    reducePlayerMoney: reducePlayerMoney,
    addPlayerMoney: addPlayerMoney,
    getPlayerMoneyByXuid: getPlayerMoneyByXuid,
    addPlayerMoneyByXuid: addPlayerMoneyByXuid,
    reducePlayerMoneyByXuid: reducePlayerMoneyByXuid,
    showMoneyMainForm: showMoneyMainForm,
    showTransferTypeForm: showTransferTypeForm,
    showEconomyPanel: showEconomyPanel,
    checkPendingTransfers: checkPendingTransfers,
    writeEconomyLog: writeEconomyLog,
    readEconomyLog: readEconomyLog,
    confirmPurchase: confirmPurchase,
    showEconomyLogForm: showEconomyLogForm
};
