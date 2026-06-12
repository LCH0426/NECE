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
 * NECE CDK兑换码系统
 * 创建和管理礼包兑换码，支持物品、SNBT序列化物品、货币等多种奖励类型
 * 使用工厂模式，通过createCdkModule(deps)创建模块实例
 */


const cdkModuleInstance = null;

/**
 * 创建CDK模块实例（工厂模式）
 * @param {Object} deps - 依赖对象
 * @param {Object} deps.cdkDataDM - CDK数据的DataManager实例
 * @param {Function} deps.addPlayerMoney - 增加玩家货币函数
 * @param {Function} deps.getCurrencyName - 获取货币名称函数
 * @param {Function} deps.giveItemById - 通过ID给予物品函数
 * @returns {{showCdkRedeemForm: Function, redeemCdk: Function}}
 */
function createCdkModule(deps) {
    const cdkDataDM = deps.cdkDataDM;
    const addPlayerMoney = deps.addPlayerMoney;
    const getCurrencyName = deps.getCurrencyName;

    /** 加载CDK数据 */
    function getCdkData() {
        return cdkDataDM.load();
    }

    /**
     * 显示CDK兑换输入表单
     * @param {Player} player - 打开表单的玩家
     */
    function showCdkRedeemForm(player) {
        const fm = mc.newCustomForm();
        fm.setTitle("CDK兑换");
        fm.addInput("请输入兑换码", "兑换码", "");
        player.sendForm(fm, function(p, data) {
            if (data == null || !data || !data[0]) return;
            const code = data[0].trim();
            if (!code) { p.tell("§e[兑换] 兑换码不能为空"); return; }
            redeemCdk(p, code);
        });
    }

    /**
     * 执行CDK兑换逻辑
     * 验证兑换码有效性、是否已使用、是否达到使用上限，然后发放奖励
     * @param {Player} player - 兑换玩家
     * @param {string} code - 兑换码
     */
    function redeemCdk(player, code) {
        const cdkData = getCdkData();
        if (!cdkData || !cdkData.codes || !cdkData.codes[code]) {
            player.sendModalForm("兑换失败", "兑换码不存在", "重新输入", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
            return;
        }

        const cdkInfo = cdkData.codes[code];
        const xuid = player.xuid;

        // 检查该玩家是否已使用过此兑换码
        if (cdkInfo.usedBy && cdkInfo.usedBy[xuid]) {
            player.sendModalForm("兑换失败", "你已经使用过该兑换码", "重新输入", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
            return;
        }

        // 检查兑换码是否已达到全局使用上限
        if (cdkInfo.maxUses > 0) {
            let usedCount = 0;
            if (cdkInfo.usedBy) {
                usedCount = Object.keys(cdkInfo.usedBy).length;
            }
            if (usedCount >= cdkInfo.maxUses) {
                player.sendModalForm("兑换失败", "该兑换码已被全部使用", "重新输入", "关闭", function(pl, ok) {
                    if (ok === true) showCdkRedeemForm(pl);
                });
                return;
            }
        }

        // 构建奖励列表：优先使用rewards数组，兼容旧版单奖励格式
        let rewards = cdkInfo.rewards;
        if (!rewards || !rewards.length) {
            // 兼容旧版CDK数据格式
            if (cdkInfo.type) {
                rewards = [{ type: cdkInfo.type }];
                if (cdkInfo.type === "item") { rewards[0].itemId = cdkInfo.itemId; rewards[0].itemName = cdkInfo.itemName; rewards[0].count = cdkInfo.count; }
                else if (cdkInfo.type === "snbt") { rewards[0].snbt = cdkInfo.snbt; rewards[0].itemName = cdkInfo.itemName; }
                else if (cdkInfo.type === "money") { rewards[0].amount = cdkInfo.amount; }
            } else {
                rewards = [];
            }
        }

        // 逐个发放奖励并收集描述
        const rewardDescs = [];
        const failedDescs = [];
        rewards.forEach(function(r) {
            switch (r.type) {
                case "item":
                    const count = r.count || 1;
                    var itemSuccess = true;
                    for (var ci = 0; ci < count; ci++) {
                        var item = mc.newItem(r.itemId, 1);
                        if (!item || !player.giveItem(item)) { itemSuccess = false; break; }
                    }
                    if (itemSuccess) {
                        rewardDescs.push((r.itemName || r.itemId) + " x" + count);
                    } else {
                        failedDescs.push((r.itemName || r.itemId) + " x" + count);
                    }
                    break;
                case "snbt":
                    const snbtItem = mc.newItem(r.snbt);
                    if (snbtItem && player.giveItem(snbtItem)) {
                        rewardDescs.push(r.itemName || "SNBT物品");
                    } else {
                        failedDescs.push(r.itemName || "SNBT物品");
                    }
                    break;
                case "money":
                    const amount = r.amount || 0;
                    if (addPlayerMoney(player, amount, "CDK兑换")) {
                        rewardDescs.push(amount + getCurrencyName());
                    } else {
                        failedDescs.push(amount + getCurrencyName());
                    }
                    break;
            }
        });

        // 仅当全部奖励发放成功时才标记CDK已使用
        if (failedDescs.length === 0) {
            if (!cdkInfo.usedBy) cdkInfo.usedBy = {};
            cdkInfo.usedBy[xuid] = { name: player.name, time: new Date().toLocaleString() };
            cdkDataDM.save();
        }

        if (failedDescs.length > 0) {
            var msg = "部分奖励发放失败（背包可能已满）：\n" + failedDescs.join("\n");
            if (rewardDescs.length > 0) msg += "\n\n已获得:\n" + rewardDescs.join("\n");
            msg += "\n\n请腾出背包空间后重新兑换";
            player.sendModalForm("兑换部分成功", msg, "重新兑换", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
        } else {
            const desc = rewardDescs.length > 0 ? rewardDescs.join("\n") : "无奖励";
            player.sendModalForm("兑换成功", "获得:\n" + desc, "继续兑换", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
        }
    }

    return {
        showCdkRedeemForm: showCdkRedeemForm,
        redeemCdk: redeemCdk
    };
}

module.exports = {
    create: createCdkModule
};
