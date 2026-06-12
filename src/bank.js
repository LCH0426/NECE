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
 * NECE 银行系统
 * 提供活期存款和定期存款功能，自动计算利息收益
 */

// 定期存款期限配置：天数 -> { 利率(单期), nameKey }
const FIXED_DEPOSIT_CONFIG = {
    7: { rate: 0.001, nameKey: "bank.period_week" },
    30: { rate: 0.0099, nameKey: "bank.period_month" },
    90: { rate: 0.044, nameKey: "bank.period_season" }
};

/**
 * 创建银行模块（工厂模式）
 * @param {object} deps - 依赖注入对象，包含 playerData、经济操作函数等
 * @returns {object} 银行模块公开API
 */
function createBankModule(deps) {
    const playerData = deps.playerData;
    const savePlayerDataNow = deps.savePlayerDataNow;
    const getPlayerMoney = deps.getPlayerMoney;
    const reducePlayerMoney = deps.reducePlayerMoney;
    const addPlayerMoney = deps.addPlayerMoney;
    const confirmPurchase = deps.confirmPurchase || null;
    const getCurrencyName = deps.getCurrencyName;
    const openMainMenu = deps.openMainMenu;
    const U = deps.utils;
    const t = deps.t;
    const getPlayerSetting = deps.getPlayerSetting;

    /**
     * 获取玩家语言设置
     * @param {string} xuid
     * @returns {string}
     */
    function getLocale(xuid) {
        return getPlayerSetting ? getPlayerSetting(xuid, 'locale') : 'zh_CN';
    }

    /**
     * 获取玩家银行账户，不存在则初始化默认结构并立即保存
     * @param {string} xuid - 玩家XUID
     * @returns {object|null} 银行账户数据 { current, fixed[] }
     */
    function getPlayerBankAccount(xuid) {
        const p = playerData.players[xuid];
        if (!p) return null;
        if (!p.bankdata) {
            p.bankdata = {
                current: {
                    balance: 0,
                    lastInterestTime: U.getCurrentTimeString(),
                    totalInterest: 0
                },
                fixed: []
            };
            savePlayerDataNow();
        }
        return p.bankdata;
    }

    /** 获取银行账户，若不存在则自动创建 */
    function ensureBankAccount(player) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        if (!account) {
            // 玩家数据被删除但玩家仍在线，重建数据
            if (!playerData.players[xuid]) {
                playerData.players[xuid] = {};
            }
            playerData.players[xuid].bankdata = {
                current: {
                    balance: 0,
                    lastInterestTime: U.getCurrentTimeString(),
                    totalInterest: 0
                },
                fixed: []
            };
            savePlayerDataNow();
            account = playerData.players[xuid].bankdata;
        }
        return account;
    }

    /**
     * 将自定义时间字符串（年.月.日.时.分.秒）转换为时间戳
     * @param {string} timeStr - 格式 "2026.05.27.14.30.00"
     * @returns {number} 毫秒时间戳，格式错误返回0
     */
    function timeStringToTimestamp(timeStr) {
        const parts = timeStr.split('.');
        if (parts.length !== 6) return 0;
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        const hour = parseInt(parts[3]);
        const minute = parseInt(parts[4]);
        const second = parseInt(parts[5]);
        return new Date(year, month, day, hour, minute, second).getTime();
    }

    /**
     * 计算并发放活期利息（单利，日利率0.02%）
     * @param {object} account - 银行账户数据
     * @returns {number} 本次计算的利息金额
     */
    function calculateCurrentInterest(account) {
        let now = Date.now();
        let lastTimeStr = account.current.lastInterestTime;
        const lastTime = typeof lastTimeStr === 'string' ? timeStringToTimestamp(lastTimeStr) : lastTimeStr;
        const timeDiff = now - lastTime;
        if (timeDiff < 1000) return 0;
        let days = timeDiff / (1000 * 60 * 60 * 24);
        const dailyRate = 0.0002;
        let interest = Math.round(account.current.balance * dailyRate * days);
        if (interest > 0) {
            account.current.balance = account.current.balance + interest;
            account.current.totalInterest = account.current.totalInterest + interest;
            account.current.lastInterestTime = U.getCurrentTimeString();
            savePlayerDataNow();
        }
        return interest;
    }

    /**
     * 计算定期存款到期利息（单利，本金 x 利率）
     * @param {number} principal - 本金
     * @param {number} rate - 期利率
     * @param {number} days - 存款天数
     * @returns {number} 利息金额
     */
    function calculateFixedInterest(principal, rate, days) {
        return principal * rate;
    }

    /** 判断定期存款是否已到期 */
    function isFixedDepositMature(deposit) {
        const matureTimestamp = timeStringToTimestamp(deposit.matureTime);
        return Date.now() >= matureTimestamp;
    }

    /** 获取定期存款状态描述文字 */
    function getFixedDepositStatus(deposit, lang) {
        return isFixedDepositMature(deposit) ? t(lang, 'bank.fixed_status_mature') : t(lang, 'bank.fixed_status_active');
    }

    /**
     * 执行活期存取操作（正数存入，负数取出）
     * @param {object} player - 玩家对象
     * @param {number} amount - 操作金额（>0 存入，<0 取出）
     * @param {Function} [callback] - 操作完成后的回调 (result) => void，result: { success: boolean, message: string }
     * @returns {{ success: boolean, message: string }|undefined} 同步结果，或undefined表示异步操作
     */
    function performCurrentOperation(player, amount, callback) {
        let xuid = player.xuid;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        let currency = getCurrencyName();
        calculateCurrentInterest(account);

        if (amount > 0) {
            let playerMoney = getPlayerMoney(player);
            if (playerMoney < amount) {
                let result = { success: false, message: t(lang, 'bank.err_insufficient_balance', amount, currency, playerMoney) };
                if (callback) { callback(result); return; }
                return result;
            }
            if (confirmPurchase) {
                confirmPurchase(player, amount, t(lang, 'bank.reason_deposit'), function(p) {
                    if (!reducePlayerMoney(p, amount, t(lang, 'bank.reason_deposit'))) {
                        let r = { success: false, message: t(lang, 'bank.err_deposit_failed') };
                        if (callback) callback(r);
                        else p.tell(r.message);
                        return;
                    }
                    account.current.balance += amount;
                    account.current.balance = Math.floor(account.current.balance);
                    savePlayerDataNow();
                    let r = { success: true, message: t(lang, 'bank.deposit_success', amount, currency, account.current.balance) };
                    if (callback) callback(r);
                    else p.tell(r.message);
                }, function(p) {
                    // 取消回调
                    if (callback) callback({ success: false, message: '' });
                });
                return; // 异步操作，不返回同步结果
            }
            if (!reducePlayerMoney(player, amount, t(lang, 'bank.reason_deposit'))) {
                let result = { success: false, message: t(lang, 'bank.err_deposit_failed') };
                if (callback) { callback(result); return; }
                return result;
            }
            account.current.balance += amount;
            account.current.balance = Math.floor(account.current.balance);
            savePlayerDataNow();
            let result = { success: true, message: t(lang, 'bank.deposit_success', amount, currency, account.current.balance) };
            if (callback) { callback(result); return; }
            return result;
        } else if (amount < 0) {
            const withdrawAmount = Math.abs(amount);
            if (account.current.balance < withdrawAmount) {
                let result = { success: false, message: t(lang, 'bank.err_bank_insufficient', withdrawAmount, currency, Math.floor(account.current.balance)) };
                if (callback) { callback(result); return; }
                return result;
            }
            if (!addPlayerMoney(player, withdrawAmount, t(lang, 'bank.reason_withdraw'))) {
                let result = { success: false, message: t(lang, 'bank.err_withdraw_failed') };
                if (callback) { callback(result); return; }
                return result;
            }
            account.current.balance -= withdrawAmount;
            account.current.balance = Math.floor(account.current.balance);
            savePlayerDataNow();
            let result = { success: true, message: t(lang, 'bank.withdraw_success_msg', withdrawAmount, currency, account.current.balance) };
            if (callback) { callback(result); return; }
            return result;
        }
        let result = { success: false, message: t(lang, 'bank.err_invalid_amount') };
        if (callback) { callback(result); return; }
        return result;
    }

    /**
     * 办理定期存款
     * @param {object} player - 玩家对象
     * @param {number} amount - 存款金额
     * @param {number} days - 存款期限（7/30/90）
     * @returns {{ success: boolean, message: string }}
     */
    function depositFixed(player, amount, days) {
        let xuid = player.xuid;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        let currency = getCurrencyName();
        if (amount <= 0) return { success: false, message: t(lang, 'bank.err_invalid_deposit_amount') };
        const playerMoney = getPlayerMoney(player);
        if (playerMoney < amount) return { success: false, message: t(lang, 'bank.err_insufficient_balance', amount, currency, playerMoney) };
        if (!FIXED_DEPOSIT_CONFIG[days]) return { success: false, message: t(lang, 'bank.err_invalid_duration') };
        if (!reducePlayerMoney(player, amount, t(lang, 'bank.reason_fixed_deposit'))) return { success: false, message: t(lang, 'bank.err_deposit_failed') };

        const config = FIXED_DEPOSIT_CONFIG[days];
        const now = new Date();
        const startTime = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + '.' + String(now.getHours()).padStart(2, '0') + '.' + String(now.getMinutes()).padStart(2, '0') + '.' + String(now.getSeconds()).padStart(2, '0');
        const matureDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
        const matureTime = matureDate.getFullYear() + '.' + String(matureDate.getMonth() + 1).padStart(2, '0') + '.' + String(matureDate.getDate()).padStart(2, '0') + '.' + String(matureDate.getHours()).padStart(2, '0') + '.' + String(matureDate.getMinutes()).padStart(2, '0') + '.' + String(matureDate.getSeconds()).padStart(2, '0');

        let deposit = {
            id: Date.now() + '_' + Math.random().toString(36).substring(2, 8),
            principal: amount,
            rate: config.rate,
            days: days,
            startTime: startTime,
            matureTime: matureTime,
            status: "active"
        };

        account.fixed.push(deposit);
        savePlayerDataNow();
        return { success: true, message: t(lang, 'bank.deposit_fixed_success', amount, currency, days, (config.rate * 100).toFixed(config.rate < 0.01 ? 2 : 1)) };
    }

    /**
     * 取出定期存款
     * @param {object} player - 玩家对象
     * @param {number} depositId - 定期存款ID（时间戳）
     * @returns {{ success: boolean, message: string }}
     */
    function withdrawFixed(player, depositId) {
        let xuid = player.xuid;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        let currency = getCurrencyName();
        let depositIndex = account.fixed.findIndex(function(d) { return d.id === depositId; });
        if (depositIndex === -1) return { success: false, message: t(lang, 'bank.err_fixed_not_found') };

        let deposit = account.fixed[depositIndex];
        if (isFixedDepositMature(deposit)) {
            let interest = Math.floor(calculateFixedInterest(deposit.principal, deposit.rate, deposit.days));
            let totalAmount = Math.floor(deposit.principal + interest);
            if (!addPlayerMoney(player, totalAmount, t(lang, 'bank.reason_fixed_mature'))) return { success: false, message: t(lang, 'bank.err_withdraw_failed') };
            account.fixed.splice(depositIndex, 1);
            savePlayerDataNow();
            return { success: true, message: t(lang, 'bank.withdraw_fixed_success', deposit.principal, currency, interest, totalAmount) };
        } else {
            const penalty = Math.floor(deposit.principal * 0.02);
            const refundAmount = deposit.principal - penalty;
            if (!addPlayerMoney(player, refundAmount, t(lang, 'bank.reason_fixed_early'))) return { success: false, message: t(lang, 'bank.err_withdraw_failed') };
            account.fixed.splice(depositIndex, 1);
            savePlayerDataNow();
            return { success: true, message: t(lang, 'bank.early_withdraw_success', deposit.principal, currency, penalty, refundAmount) };
        }
    }

    /**
     * 玩家上线时检查定期存款是否到期
     * @param {object} player - 玩家对象
     * @param {function} getPlayerSettingFn - 获取玩家设置的函数
     */
    function checkFixedDepositMaturity(player, getPlayerSettingFn) {
        let xuid = player.xuid;
        if (!getPlayerSettingFn(xuid, "enableBankNotice")) return;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        account.fixed.forEach(function(deposit) {
            if (isFixedDepositMature(deposit)) {
                let datePart = deposit.matureTime.split('.').slice(0, 3).join('.');
                player.tell(t(lang, 'bank.maturity_notice', getCurrencyName(), datePart, deposit.days));
            }
        });
    }

    /** 显示银行主界面 */
    function showBankMainForm(player) {
        let xuid = player.xuid;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        let currency = getCurrencyName();
        calculateCurrentInterest(account);

        let gui = mc.newSimpleForm();
        gui.setTitle(t(lang, 'bank.title', currency));

        let content = "-------------------------\n";
        content += t(lang, 'bank.balance', Math.floor(account.current.balance), currency) + "\n";
        content += t(lang, 'bank.total_interest', Math.floor(account.current.totalInterest), currency) + "\n";
        content += t(lang, 'bank.current_rate') + "\n";
        content += t(lang, 'bank.fixed_rates') + "\n";
        content += "-------------------------\n";
        content += t(lang, 'bank.description');

        gui.setContent(content);
        gui.addButton(t(lang, 'bank.current_op'), "textures/ui/huoqi");
        gui.addButton(t(lang, 'bank.fixed_deposit'), "textures/ui/dq");
        gui.addButton(t(lang, 'bank.back'), "textures/ui/recap_glyph_desaturated");

        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === 0) showCurrentOperationForm(p);
            else if (id === 1) showFixedDepositMainForm(p);
            else if (id === 2) openMainMenu(p);
        });
    }

    /** 显示操作结果模式表单 */
    function showOperationResultForm(player, result, returnFn) {
        let lang = getLocale(player.xuid);
        let title = result.success ? t(lang, 'bank.op_success_title') : t(lang, 'bank.op_failed_title');
        player.sendModalForm(title, result.message || '', t(lang, 'bank.back'), t(lang, 'bank.close'), function(p, id) {
            if (id === null || id === 1) return; // 关闭弹窗
            if (returnFn) returnFn(p);
            else showBankMainForm(p);
        });
    }

    /** 显示活期存取表单 */
    function showCurrentOperationForm(player) {
        let xuid = player.xuid;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        let currency = getCurrencyName();
        calculateCurrentInterest(account);

        let gui = mc.newCustomForm();
        gui.setTitle(t(lang, 'bank.current_op_title'));
        gui.addLabel(t(lang, 'bank.current_balance', Math.floor(account.current.balance), currency) + "\n" + t(lang, 'bank.current_held', getPlayerMoney(player), currency) + "\n" + t(lang, 'bank.current_hint'));
        gui.addInput(t(lang, 'bank.input_amount'), t(lang, 'bank.input_placeholder'), "");

        player.sendForm(gui, function(p, data) {
            if (data == null || typeof data !== "object" || data.length < 2) { showBankMainForm(p); return; }
            let amountStr = (data[1] || "").trim();
            let amount = parseFloat(amountStr);
            if (isNaN(amount)) { p.tell(t(lang, 'bank.err_invalid_amount')); showCurrentOperationForm(p); return; }
            let syncResult = performCurrentOperation(p, amount, function(result) {
                showOperationResultForm(p, result);
            });
            if (syncResult !== undefined) {
                showOperationResultForm(p, syncResult);
            }
        });
    }

    /** 显示定期存款主界面 */
    function showFixedDepositMainForm(player) {
        let xuid = player.xuid;
        let account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        let currency = getCurrencyName();
        let gui = mc.newSimpleForm();
        gui.setTitle(t(lang, 'bank.fixed_title'));

        let content = "-------------------------\n";
        content += t(lang, 'bank.current_held', getPlayerMoney(player), currency) + "\n";
        content += t(lang, 'bank.fixed_count', account.fixed.length);
        content += "-------------------------\n";
        content += t(lang, 'bank.fixed_rates_title');
        content += t(lang, 'bank.fixed_rate_week', (FIXED_DEPOSIT_CONFIG[7].rate * 100).toFixed(1));
        content += t(lang, 'bank.fixed_rate_month', (FIXED_DEPOSIT_CONFIG[30].rate * 100).toFixed(2));
        content += t(lang, 'bank.fixed_rate_season', (FIXED_DEPOSIT_CONFIG[90].rate * 100).toFixed(1));

        gui.setContent(content);
        gui.addButton(t(lang, 'bank.my_fixed'), "textures/ui/achievements_pause_menu_icon");
        gui.addButton(t(lang, 'bank.deposit_fixed'), "textures/ui/backup_replace");
        gui.addButton(t(lang, 'bank.back'), "textures/ui/recap_glyph_desaturated");

        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === 0) showFixedDepositDetailForm(p);
            else if (id === 1) showFixedDepositForm(p);
            else if (id === 2) showBankMainForm(p);
        });
    }

    /** 显示玩家所有定期存款列表 */
    function showFixedDepositDetailForm(player) {
        const xuid = player.xuid;
        const account = ensureBankAccount(player);
        let lang = getLocale(xuid);
        if (account.fixed.length === 0) {
            player.sendModalForm(t(lang, 'bank.no_fixed'), t(lang, 'bank.no_fixed_msg'), t(lang, 'bank.back'), t(lang, 'bank.cancel'), function(player) { showFixedDepositMainForm(player); });
            return;
        }
        let gui = mc.newSimpleForm();
        gui.setTitle(t(lang, 'bank.fixed_detail_title'));
        account.fixed.forEach(function(deposit) {
            let status = getFixedDepositStatus(deposit, lang);
            let isMature = isFixedDepositMature(deposit);
            const datePart = deposit.matureTime.split('.').slice(0, 3).join('.');
            const buttonText = t(lang, 'bank.fixed_item_text', datePart, deposit.days, status);
            const icon = isMature ? "textures/ui/daole" : "textures/ui/meidao";
            gui.addButton(buttonText, icon);
        });
        gui.addButton(t(lang, 'bank.back'), "textures/ui/recap_glyph_desaturated");
        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === account.fixed.length) { showFixedDepositMainForm(p); }
            else { const deposit = account.fixed[id]; if (deposit) showSingleFixedDepositForm(p, deposit); }
        });
    }

    /** 显示单笔定期存款详情 */
    function showSingleFixedDepositForm(player, deposit) {
        let lang = getLocale(player.xuid);
        let currency = getCurrencyName();
        let gui = mc.newSimpleForm();
        gui.setTitle(t(lang, 'bank.fixed_detail_title'));
        const status = getFixedDepositStatus(deposit, lang);
        const isMature = isFixedDepositMature(deposit);
        let content = "-------------------------\n";
        content += t(lang, 'bank.principal', deposit.principal, currency);
        content += t(lang, 'bank.duration', deposit.days, t(lang, FIXED_DEPOSIT_CONFIG[deposit.days].nameKey));
        content += t(lang, 'bank.rate', (deposit.rate * 100).toFixed(deposit.rate < 0.01 ? 2 : 1));
        content += t(lang, 'bank.start_time', deposit.startTime);
        content += t(lang, 'bank.mature_time', deposit.matureTime);
        content += t(lang, 'bank.status', status);
        if (isMature) {
            const interest = Math.floor(calculateFixedInterest(deposit.principal, deposit.rate, deposit.days));
            const totalAmount = Math.floor(deposit.principal + interest);
            content += t(lang, 'bank.mature_income', interest, currency);
            content += t(lang, 'bank.total_amount', totalAmount, currency);
        }
        content += "-------------------------\n";
        gui.setContent(content);
        gui.addButton(t(lang, 'bank.withdraw'), "textures/ui/backup_replace");
        gui.addButton(t(lang, 'bank.back'), "textures/ui/recap_glyph_desaturated");
        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === 0) {
                if (isMature) {
                    let result = withdrawFixed(p, deposit.id);
                    showOperationResultForm(p, result, showFixedDepositMainForm);
                } else {
                    p.sendModalForm(t(lang, 'bank.early_withdraw_warn'),
                        t(lang, 'bank.early_withdraw_msg', deposit.principal, currency, Math.floor(deposit.principal * 0.02), deposit.principal - Math.floor(deposit.principal * 0.02)),
                        t(lang, 'bank.confirm_withdraw'), t(lang, 'bank.cancel'),
                        function(player, res) {
                            if (res) {
                                let result = withdrawFixed(player, deposit.id);
                                showOperationResultForm(player, result, showFixedDepositMainForm);
                            } else {
                                showSingleFixedDepositForm(player, deposit);
                            }
                        }
                    );
                }
            } else if (id === 1) { showFixedDepositDetailForm(p); }
        });
    }

    /** 显示定期存款存入表单 */
    function showFixedDepositForm(player) {
        let lang = getLocale(player.xuid);
        let currency = getCurrencyName();
        const gui = mc.newCustomForm();
        gui.setTitle(t(lang, 'bank.deposit_input_title'));
        gui.addInput(t(lang, 'bank.deposit_input_amount'), t(lang, 'bank.deposit_input_placeholder'), "");
        gui.addDropdown(t(lang, 'bank.deposit_duration_select'), [t(lang, 'bank.deposit_duration_week'), t(lang, 'bank.deposit_duration_month'), t(lang, 'bank.deposit_duration_season')], 0);
        player.sendForm(gui, function(p, data) {
            if (data == null || typeof data !== "object" || data.length < 2) { showFixedDepositMainForm(p); return; }
            const amountStr = (data[0] || "").trim();
            const amount = parseFloat(amountStr);
            const durationIndex = data[1];
            if (isNaN(amount) || amount <= 0) { p.tell(t(lang, 'bank.err_invalid_deposit_amount')); showFixedDepositForm(p); return; }
            const days = [7, 30, 90][durationIndex];
            const result = depositFixed(p, amount, days);
            showOperationResultForm(p, result, showFixedDepositMainForm);
        });
    }

    return {
        getPlayerBankAccount: getPlayerBankAccount,
        calculateCurrentInterest: calculateCurrentInterest,
        checkFixedDepositMaturity: checkFixedDepositMaturity,
        showBankMainForm: showBankMainForm,
        showCurrentOperationForm: showCurrentOperationForm,
        showFixedDepositMainForm: showFixedDepositMainForm,
        showFixedDepositDetailForm: showFixedDepositDetailForm,
        showSingleFixedDepositForm: showSingleFixedDepositForm,
        showFixedDepositForm: showFixedDepositForm,
        performCurrentOperation: performCurrentOperation,
        depositFixed: depositFixed,
        withdrawFixed: withdrawFixed
    };
}

module.exports = {
    create: createBankModule
};
