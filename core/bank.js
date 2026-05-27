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
 * NLCE 银行系统
 * 提供活期存款和定期存款功能，自动计算利息收益
 */

// 定期存款期限配置：天数 -> { 利率(单期), 名称 }
const FIXED_DEPOSIT_CONFIG = {
    7: { rate: 0.001, name: "周" },
    30: { rate: 0.0099, name: "月" },
    90: { rate: 0.044, name: "季" }
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
    const getCurrencyName = deps.getCurrencyName;
    const openMainMenu = deps.openMainMenu;
    const U = deps.utils;

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

    /**
     * 将自定义时间字符串（年.月.日.时.分.秒）转换为时间戳
     * @param {string} timeStr - 格式 "2026.05.27.14.30.00"
     * @returns {number} 毫秒时间戳，格式错误返回0
     */
    function timeStringToTimestamp(timeStr) {
        const parts = timeStr.split('.');
        if (parts.length !== 6) return 0;
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // JS Date月份从0开始
        const day = parseInt(parts[2]);
        const hour = parseInt(parts[3]);
        const minute = parseInt(parts[4]);
        const second = parseInt(parts[5]);
        return new Date(year, month, day, hour, minute, second).getTime();
    }

    /**
     * 计算并发放活期利息（单利，日利率0.02%）
     * 基于上次计息时间到当前的时间差按天折算
     * @param {object} account - 银行账户数据
     * @returns {number} 本次计算的利息金额
     */
    function calculateCurrentInterest(account) {
        let now = Date.now();
        let lastTimeStr = account.current.lastInterestTime;
        const lastTime = typeof lastTimeStr === 'string' ? timeStringToTimestamp(lastTimeStr) : lastTimeStr;
        const timeDiff = now - lastTime;
        if (timeDiff < 1000) return 0; // 间隔不足1秒不计息
        let days = timeDiff / (1000 * 60 * 60 * 24);
        const dailyRate = 0.0002; // 日利率 0.02%
        let interest = account.current.balance * dailyRate * days;
        if (interest > 0) {
            account.current.balance = Math.floor(account.current.balance + interest);
            account.current.totalInterest = Math.floor(account.current.totalInterest + interest);
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
    function getFixedDepositStatus(deposit) {
        return isFixedDepositMature(deposit) ? "已到期" : "收益正在路上";
    }

    /**
     * 执行活期存取操作（正数存入，负数取出）
     * @param {object} player - 玩家对象
     * @param {number} amount - 操作金额（>0 存入，<0 取出）
     * @returns {{ success: boolean, message: string }}
     */
    function performCurrentOperation(player, amount) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        calculateCurrentInterest(account);

        if (amount > 0) {
            let playerMoney = getPlayerMoney(player);
            if (playerMoney < amount) {
                return { success: false, message: "§c余额不足，需要 " + amount + " 点§c" + getCurrencyName() + "§r，当前只有 " + playerMoney + " 点§c" + getCurrencyName() + "§r" };
            }
            if (!reducePlayerMoney(player, amount, "银行存款")) {
                return { success: false, message: "§c存款失败，货币系统异常" };
            }
            account.current.balance += amount;
            account.current.balance = Math.floor(account.current.balance);
            savePlayerDataNow();
            return { success: true, message: "§a存款成功！存入 " + amount + " 点§c" + getCurrencyName() + "§r，当前银行余额：" + account.current.balance + " 点§c" + getCurrencyName() + "§r" };
        } else if (amount < 0) {
            const withdrawAmount = Math.abs(amount);
            if (account.current.balance < withdrawAmount) {
                return { success: false, message: "§c银行余额不足，需要 " + withdrawAmount + " 点§c" + getCurrencyName() + "§r，当前银行余额：" + Math.floor(account.current.balance) + " 点§c" + getCurrencyName() + "§r" };
            }
            account.current.balance -= withdrawAmount;
            account.current.balance = Math.floor(account.current.balance);
            savePlayerDataNow();
            if (!addPlayerMoney(player, withdrawAmount, "银行取款")) {
                return { success: false, message: "§c取款失败，货币系统异常" };
            }
            return { success: true, message: "§a取款成功！取出 " + withdrawAmount + " 点§c" + getCurrencyName() + "§r，当前银行余额：" + account.current.balance + " 点§c" + getCurrencyName() + "§r" };
        }
        return { success: false, message: "§c请输入有效的金额" };
    }

    /**
     * 办理定期存款，从玩家余额扣除本金并创建定期记录
     * @param {object} player - 玩家对象
     * @param {number} amount - 存款金额
     * @param {number} days - 存款期限（7/30/90）
     * @returns {{ success: boolean, message: string }}
     */
    function depositFixed(player, amount, days) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        if (amount <= 0) return { success: false, message: "§c请输入有效的存款金额" };
        const playerMoney = getPlayerMoney(player);
        if (playerMoney < amount) return { success: false, message: "§c余额不足，需要 " + amount + " 点§c" + getCurrencyName() + "§r，当前只有 " + playerMoney + " 点§c" + getCurrencyName() + "§r" };
        if (!FIXED_DEPOSIT_CONFIG[days]) return { success: false, message: "§c无效的存款期限" };
        if (!reducePlayerMoney(player, amount, "定期存款")) return { success: false, message: "§c存款失败，货币系统异常" };

        const config = FIXED_DEPOSIT_CONFIG[days];
        const now = new Date();
        const startTime = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + '.' + String(now.getHours()).padStart(2, '0') + '.' + String(now.getMinutes()).padStart(2, '0') + '.' + String(now.getSeconds()).padStart(2, '0');
        const matureDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
        const matureTime = matureDate.getFullYear() + '.' + String(matureDate.getMonth() + 1).padStart(2, '0') + '.' + String(matureDate.getDate()).padStart(2, '0') + '.' + String(matureDate.getHours()).padStart(2, '0') + '.' + String(matureDate.getMinutes()).padStart(2, '0') + '.' + String(matureDate.getSeconds()).padStart(2, '0');

        let deposit = {
            id: Date.now(),
            principal: amount,
            rate: config.rate,
            days: days,
            startTime: startTime,
            matureTime: matureTime,
            status: "active"
        };

        account.fixed.push(deposit);
        savePlayerDataNow();
        return { success: true, message: "§a定期存款成功！存入 " + amount + " 点§c" + getCurrencyName() + "§r，期限 " + days + " 天，总利率百分之 " + (config.rate * 100).toFixed(config.rate < 0.01 ? 2 : 1) };
    }

    /**
     * 取出定期存款。到期返还本金+利息；提前取出扣除2%违约金，不给利息
     * @param {object} player - 玩家对象
     * @param {number} depositId - 定期存款ID（时间戳）
     * @returns {{ success: boolean, message: string }}
     */
    function withdrawFixed(player, depositId) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        let depositIndex = account.fixed.findIndex(function(d) { return d.id === depositId; });
        if (depositIndex === -1) return { success: false, message: "§c未找到该定期存款" };

        let deposit = account.fixed[depositIndex];
        if (isFixedDepositMature(deposit)) {
            let interest = Math.floor(calculateFixedInterest(deposit.principal, deposit.rate, deposit.days));
            let totalAmount = Math.floor(deposit.principal + interest);
            if (!addPlayerMoney(player, totalAmount, "定期到期取出")) return { success: false, message: "§c取款失败，货币系统异常" };
            account.fixed.splice(depositIndex, 1);
            savePlayerDataNow();
            return { success: true, message: "§a定期存款取出成功！本金 " + deposit.principal + " 点§c" + getCurrencyName() + "§r，利息 " + interest + " 点§c" + getCurrencyName() + "§r，总计 " + totalAmount + " 点§c" + getCurrencyName() + "§r" };
        } else {
            const penalty = Math.floor(deposit.principal * 0.02);
            const refundAmount = deposit.principal - penalty;
            if (!addPlayerMoney(player, refundAmount, "定期提前取出")) return { success: false, message: "§c取款失败，货币系统异常" };
            account.fixed.splice(depositIndex, 1);
            savePlayerDataNow();
            return { success: true, message: "§a定期存款提前取出成功！本金 " + deposit.principal + " 点§c" + getCurrencyName() + "§r，扣除违约金 " + penalty + " 点§c" + getCurrencyName() + "§r，实际取回 " + refundAmount + " 点§c" + getCurrencyName() + "§r" };
        }
    }

    /**
     * 玩家上线时检查定期存款是否到期，并发送提醒（需玩家开启银行通知设置）
     * @param {object} player - 玩家对象
     * @param {function} getPlayerSetting - 获取玩家设置的函数
     */
    function checkFixedDepositMaturity(player, getPlayerSetting) {
        let xuid = player.xuid;
        if (!getPlayerSetting(xuid, "enableBankNotice")) return;
        let account = getPlayerBankAccount(xuid);
        account.fixed.forEach(function(deposit) {
            if (isFixedDepositMature(deposit)) {
                let datePart = deposit.matureTime.split('.').slice(0, 3).join('.');
                player.tell("§b[" + getCurrencyName() + "储所] §a您于 " + datePart + " 为期" + deposit.days + "天的定期存款已到期，可以取出了！");
            }
        });
    }

    /** 显示银行主界面：活期余额、累计利息、利率说明 */
    function showBankMainForm(player) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        calculateCurrentInterest(account);

        let gui = mc.newSimpleForm();
        gui.setTitle("§l§b" + getCurrencyName() + "储所");

        let content = "-------------------------\n";
        content += "§a活期余额：§f" + Math.floor(account.current.balance) + " 点§c" + getCurrencyName() + "§r\n";
        content += "§a累计利息：§f" + Math.floor(account.current.totalInterest) + " 点§c" + getCurrencyName() + "§r\n";
        content += "§a活期利率：§f0.02%%天\n";
        content += "§a定期利率：\n§f周(7日) 0.11%%/期 \n月（30日） 0.99%%/期 \n季（90日） 4.4%%/期\n\n";
        content += "-------------------------\n";
        content += "§6说明:活期存款采用单利计息，日利率固定为§a0.02%%§6，利息基于本金计算，支持随时存取；定期存款提供7、30、90天固定期限，到期时本金与利息一并返还，但若提前取出则只能取回本金并§m扣除§6本金§a2%%§6的手续费，利息全部扣除\n";

        gui.setContent(content);
        gui.addButton("§a活期存取", "textures/ui/huoqi");
        gui.addButton("§b定期存款", "textures/ui/dq");
        gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === 0) showCurrentOperationForm(p);
            else if (id === 1) showFixedDepositMainForm(p);
            else if (id === 2) openMainMenu(p);
        });
    }

    /** 显示活期存取表单：正数存款，负数取款 */
    function showCurrentOperationForm(player) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        calculateCurrentInterest(account);

        let gui = mc.newCustomForm();
        gui.setTitle("§l§a活期存取");
        gui.addLabel("§a当前银行余额：" + Math.floor(account.current.balance) + " 点§c" + getCurrencyName() + "§r\n§a当前持有余额：" + getPlayerMoney(player) + " 点§c" + getCurrencyName() + "§r\n§a提示：输入正数为存款，负数为取款");
        gui.addInput("输入金额", "例如：100 或 -50", "");

        player.sendForm(gui, function(p, data) {
            if (data === null || typeof data !== "object" || data.length < 2) { showBankMainForm(p); return; }
            let amountStr = (data[1] || "").trim();
            let amount = parseFloat(amountStr);
            if (isNaN(amount)) { p.tell("§c请输入有效的金额"); showCurrentOperationForm(p); return; }
            let result = performCurrentOperation(p, amount);
            p.tell(result.message);
            p.sendModalForm(result.success ? "§a操作成功" : "§c操作失败", result.message, "§a返回", "§c关闭", function(player) { showBankMainForm(player); });
        });
    }

    /** 显示定期存款主界面：利率信息、我的定期入口、存入定期入口 */
    function showFixedDepositMainForm(player) {
        let xuid = player.xuid;
        let account = getPlayerBankAccount(xuid);
        let gui = mc.newSimpleForm();
        gui.setTitle("§l§b定期存款");

        let content = "-------------------------\n";
        content += "§a当前持有余额：§f" + getPlayerMoney(player) + " 点§c" + getCurrencyName() + "§r\n";
        content += "§a定期存款数：§f" + account.fixed.length + " 个\n";
        content += "-------------------------\n";
        content += "§e定期存款利率：\n";
        content += "§f周存（7天）：" + (FIXED_DEPOSIT_CONFIG[7].rate * 100).toFixed(1) + "%%/期\n";
        content += "§f月存（30天）：" + (FIXED_DEPOSIT_CONFIG[30].rate * 100).toFixed(2) + "%%/期\n";
        content += "§f季存（90天）：" + (FIXED_DEPOSIT_CONFIG[90].rate * 100).toFixed(1) + "%%/期\n";

        gui.setContent(content);
        gui.addButton("§a我的定期", "textures/ui/achievements_pause_menu_icon");
        gui.addButton("§b存入定期", "textures/ui/backup_replace");
        gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");

        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === 0) showFixedDepositDetailForm(p);
            else if (id === 1) showFixedDepositForm(p);
            else if (id === 2) showBankMainForm(p);
        });
    }

    /** 显示玩家所有定期存款列表（带到期/未到期状态图标） */
    function showFixedDepositDetailForm(player) {
        const xuid = player.xuid;
        const account = getPlayerBankAccount(xuid);
        if (account.fixed.length === 0) {
            player.sendModalForm("§c无定期存款", "§a您当前没有定期存款", "§a返回", "§c关闭", function(player) { showFixedDepositMainForm(player); });
            return;
        }
        let gui = mc.newSimpleForm();
        gui.setTitle("§l§b定期存款详情");
        account.fixed.forEach(function(deposit) {
            let status = getFixedDepositStatus(deposit);
            let isMature = isFixedDepositMature(deposit);
            const datePart = deposit.matureTime.split('.').slice(0, 3).join('.');
            const buttonText = "§a" + datePart + " 为期" + deposit.days + "天的存款\n§e状态：" + status;
            const icon = isMature ? "textures/ui/daole" : "textures/ui/meidao";
            gui.addButton(buttonText, icon);
        });
        gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === account.fixed.length) { showFixedDepositMainForm(p); }
            else { const deposit = account.fixed[id]; if (deposit) showSingleFixedDepositForm(p, deposit); }
        });
    }

    /** 显示单笔定期存款详情，支持到期取出和提前取出（扣违约金） */
    function showSingleFixedDepositForm(player, deposit) {
        let gui = mc.newSimpleForm();
        gui.setTitle("§l§b定期存款详情");
        const status = getFixedDepositStatus(deposit);
        const isMature = isFixedDepositMature(deposit);
        let content = "-------------------------\n";
        content += "§a存款金额：§f" + deposit.principal + " 点§c" + getCurrencyName() + "§r\n";
        content += "§a存款期限：§f" + deposit.days + " 天（" + FIXED_DEPOSIT_CONFIG[deposit.days].name + "）\n";
        content += "§a存款利率：§f" + (deposit.rate * 100).toFixed(deposit.rate < 0.01 ? 2 : 1) + "%%/期\n";
        content += "§a存款时间：§f" + deposit.startTime + "\n";
        content += "§a到期时间：§f" + deposit.matureTime + "\n";
        content += "§a当前状态：§f" + status + "\n";
        if (isMature) {
            const interest = Math.floor(calculateFixedInterest(deposit.principal, deposit.rate, deposit.days));
            const totalAmount = Math.floor(deposit.principal + interest);
            content += "§a到期收益：§f" + interest + " 点§c" + getCurrencyName() + "§r\n";
            content += "§a总计金额：§f" + totalAmount + " 点§c" + getCurrencyName() + "§r\n";
        }
        content += "-------------------------\n";
        gui.setContent(content);
        gui.addButton("§a取出", "textures/ui/backup_replace");
        gui.addButton("§c返回", "textures/ui/recap_glyph_desaturated");
        player.sendForm(gui, function(p, id) {
            if (id === null) return;
            if (id === 0) {
                if (isMature) {
                    let result = withdrawFixed(p, deposit.id);
                    p.tell(result.message);
                    p.sendModalForm("§a取出成功", result.message, "§a返回", "§c关闭", function(player) { showFixedDepositMainForm(player); });
                } else {
                    p.sendModalForm("§c警告",
                        "-------------------------\n" +
                        "§c定期存款尚未到期\n" +
                        "§a取出将扣除本金百分之2的违约金\n" +
                        "§a本金：" + deposit.principal + " 点§c" + getCurrencyName() + "§r\n" +
                        "§c违约金：" + Math.floor(deposit.principal * 0.02) + " 点§c" + getCurrencyName() + "§r\n" +
                        "§a实际取回：" + (deposit.principal - Math.floor(deposit.principal * 0.02)) + " 点§c" + getCurrencyName() + "§r\n" +
                        "-------------------------\n" +
                        "§e确认是否取出？",
                        "§a确认取出", "§c取消",
                        function(player, res) {
                            if (res) {
                                let result = withdrawFixed(player, deposit.id);
                                player.tell(result.message);
                                player.sendModalForm("§a取出成功", result.message, "§a返回", "§c关闭", function(player) { showFixedDepositMainForm(player); });
                            } else {
                                showSingleFixedDepositForm(player, deposit);
                            }
                        }
                    );
                }
            } else if (id === 1) { showFixedDepositDetailForm(p); }
        });
    }

    /** 显示定期存款存入表单（输入金额 + 选择期限） */
    function showFixedDepositForm(player) {
        const gui = mc.newCustomForm();
        gui.setTitle("§l§b存入定期");
        gui.addInput("输入存款金额", "例如：1000", "");
        gui.addDropdown("选择存款期限", ["7天（周）", "30天（月）", "90天（季）"], 0, "选择定期存款的期限");
        player.sendForm(gui, function(p, data) {
            if (data === null || typeof data !== "object" || data.length < 2) { showFixedDepositMainForm(p); return; }
            const amountStr = (data[0] || "").trim();
            const amount = parseFloat(amountStr);
            const durationIndex = data[1];
            if (isNaN(amount) || amount <= 0) { p.tell("§c请输入有效的存款金额"); showFixedDepositForm(p); return; }
            const days = [7, 30, 90][durationIndex];
            const result = depositFixed(p, amount, days);
            p.tell(result.message);
            p.sendModalForm(result.success ? "§a操作成功" : "§c操作失败", result.message, "§a返回", "§c关闭", function(player) { showFixedDepositMainForm(player); });
        });
    }

    // 导出银行模块公开API
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
