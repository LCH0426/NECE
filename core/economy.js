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
 * 封装 llmoney 经济操作，提供余额查询、增减、通知、转账等功能
 */

const fs = require('fs');
const U = require('./utils');

let _config = null;
let _currencyNameCache = null; // 货币名称缓存，避免重复读取配置
let _deps = {};

// 待领取转账 —— 离线玩家收到转账时暂存于此，上线后自动通知
const pendingTransfersPath = "plugins/NECE/data/pendingTransfers.json";
let pendingTransfers = {};

/** 初始化经济模块，加载待领取转账数据 */
function init(deps) {
    _config = deps.config;
    _currencyNameCache = null;
    _deps = deps;
    _loadPendingTransfers();
}

/** 获取货币名称（带缓存），默认返回"星茜" */
function getCurrencyName() {
    if (_currencyNameCache !== null) return _currencyNameCache;
    _currencyNameCache = _config.get("currencyName") || "星茜";
    return _currencyNameCache;
}

/**
 * 向玩家发送货币变动通知（toast形式）
 * @param {object} player - 目标玩家
 * @param {number} amount - 变动金额（正数为收入，负数为支出）
 * @param {string} source - 变动来源描述
 */
function notifyEconomyChange(player, amount, source) {
    try {
        const sign = amount >= 0 ? "+" : "";
        const line1 = sign + amount + getCurrencyName();
        const line2 = source || "其他";
        player.sendToast(line2, line1);
    } catch (e) { /* player可能已离线 */ }
}

/**
 * 获取玩家余额，包含完整的类型校验和异常处理
 * @param {object} player - 玩家对象（需包含xuid）
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
 * @param {number} value - 扣除金额（自动取整）
 * @param {string} source - 扣费来源描述
 * @returns {boolean} 是否扣费成功
 */
function reducePlayerMoney(player, value, source) {
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
        logger.info('尝试减少玩家 ' + player.name + ' (' + xuid + ') 货币：' + beforeMoney + ' - ' + intValue);

        let success = money.reduce(xuid, intValue);
        logger.info('money.reduce调用结果：' + success);

        const afterMoney = money.get(xuid) || 0;
        logger.info('减少货币后余额：' + afterMoney);

        if (success) {
            notifyEconomyChange(player, -intValue, source || "系统扣费");
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
 * @param {number} value - 增加金额（自动取整）
 * @param {string} source - 收入来源描述
 * @returns {boolean} 是否操作成功
 */
function addPlayerMoney(player, value, source) {
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

        logger.info('尝试增加玩家 ' + player.name + ' (' + xuid + ') 货币：' + intValue);

        let success = money.add(xuid, intValue);
        logger.info('money.add调用结果：' + success);

        if (success) {
            notifyEconomyChange(player, intValue, source || "系统收入");
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
 * 通过XUID获取余额（轻量版，不含日志和玩家对象，适用于离线查询）
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
 * 通过XUID增加货币（玩家在线时自动发送通知）
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
                notifyEconomyChange(player, intValue, source || "系统收入");
            }
        }
        return success;
    } catch (e) {
        return false;
    }
}

// ============ 转账系统 (原 core/pay.js) ============

/** 从磁盘加载待领取转账记录 */
function _loadPendingTransfers() {
    try {
        if (fs.existsSync(pendingTransfersPath)) {
            pendingTransfers = JSON.parse(fs.readFileSync(pendingTransfersPath, 'utf-8'));
        } else {
            pendingTransfers = {};
        }
    } catch (e) {
        pendingTransfers = {};
    }
}

/** 将待领取转账记录持久化到磁盘（防抖，500ms） */
let _savePendingTimer = null;
function _savePendingTransfers() {
    if (_savePendingTimer) clearTimeout(_savePendingTimer);
    _savePendingTimer = setTimeout(function() {
        _savePendingTimer = null;
        try {
            fs.writeFileSync(pendingTransfersPath, JSON.stringify(pendingTransfers, null, '\t'), 'utf-8');
        } catch (e) {
            logger.error("保存待领取转账失败: " + e.message);
        }
    }, 500);
}

/**
 * 写入转账日志到文件
 * @param {string} senderName - 发送者名称
 * @param {string} targetName - 接收者名称
 * @param {number} amount - 转账金额
 * @param {number} senderBalance - 发送者转账后余额
 * @param {number} targetBalance - 接收者转账后余额
 */
function _writeTransferLog(senderName, targetName, amount, senderBalance, targetBalance) {
    try {
        const logDir = "plugins/NECE/logs";
        const logPath = logDir + "/shop.log";
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const timeStr = new Date().toLocaleString();
        const entry = timeStr + " | " + senderName + "向" + targetName + "转账" + amount + " 余额" + senderBalance + " 对方余额" + targetBalance + "\n";
        fs.appendFile(logPath, entry, 'utf-8', function(e) {
            if (e) logger.error("写入转账日志失败: " + e.message);
        });
    } catch (e) {
        logger.error("写入转账日志失败: " + e.message);
    }
}

/** 显示经济系统主界面（余额 + 转账入口） */
function showMoneyMainForm(player) {
    let fm = mc.newSimpleForm();
    fm.setTitle("经济系统");
    let balance = getPlayerMoney(player);
    fm.setContent("当前余额: " + balance + " " + getCurrencyName());
    fm.addButton("转账", "textures/ui/icon_recipe_equipment");
    fm.addButton("关闭", "textures/ui/cancel");
    player.sendForm(fm, function(p, id) {
        if (id === null || id === 1) return;
        if (id === 0) showTransferTypeForm(p);
    });
}

/** 显示转账对象类型选择（在线/离线） */
function showTransferTypeForm(player) {
    let fm = mc.newSimpleForm();
    fm.setTitle("转账");
    fm.setContent("选择转账对象类型");
    fm.addButton("在线玩家", "textures/ui/icon_online");
    fm.addButton("离线玩家", "textures/ui/icon_offline");
    fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
    player.sendForm(fm, function(p, id) {
        if (id === null || id === 2) { showMoneyMainForm(p); return; }
        if (id === 0) showTransferOnlineForm(p);
        else if (id === 1) showTransferOfflineForm(p);
    });
}

/** 显示在线玩家转账表单（下拉选择目标玩家 + 输入金额） */
function showTransferOnlineForm(player) {
    const onlineList = mc.getOnlinePlayers();
    const names = [];
    onlineList.forEach(function(p) {
        if (p.xuid !== player.xuid) {
            names.push(p.realName);
        }
    });
    if (names.length === 0) {
        player.sendModalForm("转账", "当前没有其他在线玩家", "返回", "关闭", function(pl, ok) {
            if (ok === true) showTransferTypeForm(pl);
        });
        return;
    }
    let fm = mc.newCustomForm();
    fm.setTitle("转账给在线玩家");
    fm.addDropdown("选择玩家", names, 0);
    fm.addInput("输入转账金额", "正整数", "");
    player.sendForm(fm, function(p, data) {
        if (data === null || !Array.isArray(data)) return;
        const targetName = names[data[0]];
        let amountStr = (data[1] || "").trim();
        if (!amountStr || !U.isInteger(amountStr) || Number(amountStr) <= 0) {
            p.tell("§e[经济] 请输入有效的转账金额");
            showTransferOnlineForm(p);
            return;
        }
        let amount = Number(amountStr);
        let balance = getPlayerMoney(p);
        if (balance < amount) {
            p.sendModalForm("余额不足", "需要 " + amount + " " + getCurrencyName() + "\n当前余额 " + balance + " " + getCurrencyName(), "返回重新选择", "关闭", function(pl, ok) {
                if (ok === true) showTransferOnlineForm(pl);
            });
            return;
        }
        let target = mc.getPlayer(targetName);
        if (!target) {
            p.sendModalForm("转账失败", "玩家已下线", "返回", "关闭", function(pl, ok) {
                if (ok === true) showTransferTypeForm(pl);
            });
            return;
        }
        p.sendModalForm("确认转账", "转账给 " + targetName + "\n金额 " + amount + " " + getCurrencyName(), "确认转账", "取消", function(pl, ok) {
            if (!ok) return;
            _executeTransfer(pl, targetName, target.xuid, amount);
        });
    });
}

/** 显示离线玩家转账表单（通过名称或UID搜索） */
function showTransferOfflineForm(player) {
    let fm = mc.newCustomForm();
    fm.setTitle("转账给离线玩家");
    fm.addInput("输入玩家名称或UID", "", "");
    player.sendForm(fm, function(p, data) {
        if (data === null || !Array.isArray(data)) return;
        const keyword = (data[0] || "").trim();
        if (!keyword) {
            p.tell("§e[经济] 请输入搜索内容");
            showTransferOfflineForm(p);
            return;
        }
        const results = [];
        // 从玩家数据中模糊搜索名称和UID
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
    fm.setTitle("搜索结果");
    if (results.length === 0) {
        fm.setContent("未找到匹配 \"" + keyword + "\" 的玩家");
    } else {
        fm.setContent("找到 " + results.length + " 个匹配结果\n点击选择转账对象");
        results.forEach(function(r) {
            const avatarUrl = _deps.getPlayerAvatarUrl ? _deps.getPlayerAvatarUrl(r.xuid) : "textures/ui/icon_steve";
            fm.addButton(r.name + "\nUID: " + r.uid, avatarUrl);
        });
    }
    fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
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
    fm.setTitle("转账给 " + target.name);
    fm.addLabel("目标: " + target.name + " (UID: " + target.uid + ")");
    fm.addInput("输入转账金额", "正整数", "");
    player.sendForm(fm, function(p, data) {
        if (data === null || !Array.isArray(data)) return;
        const amountStr = (data[1] || "").trim();
        if (!amountStr || !U.isInteger(amountStr) || Number(amountStr) <= 0) {
            p.tell("§e[经济] 请输入有效的转账金额");
            _showTransferOfflineAmountForm(p, target);
            return;
        }
        const amount = Number(amountStr);
        const balance = getPlayerMoney(p);
        if (balance < amount) {
            p.sendModalForm("余额不足", "需要 " + amount + " " + getCurrencyName() + "\n当前余额 " + balance + " " + getCurrencyName(), "返回重新选择", "关闭", function(pl, ok) {
                if (ok === true) _showTransferOfflineAmountForm(pl, target);
            });
            return;
        }
        p.sendModalForm("确认转账", "转账给 " + target.name + "\n金额 " + amount + " " + getCurrencyName(), "确认转账", "取消", function(pl, ok) {
            if (!ok) return;
            _executeTransfer(pl, target.name, target.xuid, amount);
        });
    });
}

/**
 * 执行转账核心逻辑：扣除发送者余额，增加接收者余额
 * 接收者在线则直接到账，离线则存入待领取队列
 * 内置去重机制，3秒内相同发送者+接收者+金额的转账会被拒绝
 */
const _recentTransfers = {};  // { senderXuid: { key: timestamp }
function _executeTransfer(sender, targetName, targetXuid, amount) {
    // 去重：防止双击重复转账
    const transferKey = targetXuid + ':' + amount;
    const now = Date.now();
    const senderRecent = _recentTransfers[sender.xuid];
    if (senderRecent && senderRecent[transferKey] && now - senderRecent[transferKey] < 3000) {
        sender.tell("§e[经济] 请勿重复转账，请稍后再试");
        return;
    }
    if (!senderRecent) _recentTransfers[sender.xuid] = {};
    _recentTransfers[sender.xuid][transferKey] = now;
    reducePlayerMoney(sender, amount, "转账给" + targetName);
    const targetPlayer = mc.getPlayer(targetXuid);
    if (targetPlayer) {
        addPlayerMoney(targetPlayer, amount, "来自" + sender.realName + "的转账");
    } else {
        // 接收者离线，暂存到待领取队列
        if (!pendingTransfers[targetXuid]) {
            pendingTransfers[targetXuid] = [];
        }
        pendingTransfers[targetXuid].push({
            from: sender.realName,
            fromXuid: sender.xuid,
            amount: amount,
            time: new Date().toLocaleString()
        });
        _savePendingTransfers();
        addPlayerMoneyByXuid(targetXuid, amount);
    }
    const senderBalance = getPlayerMoney(sender);
    const targetBalance = getPlayerMoneyByXuid(targetXuid);
    _writeTransferLog(sender.realName, targetName, amount, senderBalance, targetBalance);
    sender.tell("§e[经济] 转账成功 向" + targetName + "转账" + amount + getCurrencyName() + " 余额" + senderBalance + getCurrencyName());
    sender.sendModalForm("转账成功", "向" + targetName + "转账 " + amount + " " + getCurrencyName() + "\n余额 " + senderBalance + " " + getCurrencyName(), "继续转账", "关闭", function(pl, ok) {
        if (ok === true) showTransferTypeForm(pl);
    });
}

/** 玩家上线时检查并通知待领取的离线转账 */
function checkPendingTransfers(player) {
    const xuid = player.xuid;
    if (!pendingTransfers[xuid] || pendingTransfers[xuid].length === 0) return;
    const transfers = pendingTransfers[xuid];
    transfers.forEach(function(t) {
        player.tell("§e[经济] 您在离线期间收到了一笔来自" + t.from + "的转账 数额为" + t.amount + getCurrencyName());
        notifyEconomyChange(player, t.amount, "来自" + t.from + "的转账");
    });
    delete pendingTransfers[xuid];
    _savePendingTransfers();
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
    showMoneyMainForm: showMoneyMainForm,
    checkPendingTransfers: checkPendingTransfers
};
