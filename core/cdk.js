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
 * NLCE CDK兑换码系统
 * 创建和管理礼包兑换码，支持物品、货币等多种奖励类型
 */


const cdkModuleInstance = null;

function createCdkModule(deps) {
    const cdkDataDM = deps.cdkDataDM;
    const addPlayerMoney = deps.addPlayerMoney;
    const getCurrencyName = deps.getCurrencyName;
    const giveItemById = deps.giveItemById;

    function getCdkData() {
        return cdkDataDM.load();
    }

    function showCdkRedeemForm(player) {
        const fm = mc.newCustomForm();
        fm.setTitle("CDK兑换");
        fm.addInput("请输入兑换码", "兑换码", "");
        player.sendForm(fm, function(p, data) {
            if (data === null || !data || !data[0]) return;
            const code = data[0].trim();
            if (!code) { p.tell("兑换码不能为空"); return; }
            redeemCdk(p, code);
        });
    }

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

        if (cdkInfo.usedBy && cdkInfo.usedBy[xuid]) {
            player.sendModalForm("兑换失败", "你已经使用过该兑换码", "重新输入", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
            return;
        }

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

        let rewards = cdkInfo.rewards;
        if (!rewards || !rewards.length) {
            if (cdkInfo.type) {
                rewards = [{ type: cdkInfo.type }];
                if (cdkInfo.type === "item") { rewards[0].itemId = cdkInfo.itemId; rewards[0].itemName = cdkInfo.itemName; rewards[0].count = cdkInfo.count; }
                else if (cdkInfo.type === "snbt") { rewards[0].snbt = cdkInfo.snbt; rewards[0].itemName = cdkInfo.itemName; }
                else if (cdkInfo.type === "money") { rewards[0].amount = cdkInfo.amount; }
            } else {
                rewards = [];
            }
        }

        const rewardDescs = [];
        rewards.forEach(function(r) {
            switch (r.type) {
                case "item":
                    const count = r.count || 1;
                    giveItemById(player, r.itemId, count);
                    rewardDescs.push((r.itemName || r.itemId) + " x" + count);
                    break;
                case "snbt":
                    const snbtItem = mc.newItem(r.snbt);
                    if (snbtItem) {
                        player.giveItem(snbtItem);
                    }
                    rewardDescs.push(r.itemName || "SNBT物品");
                    break;
                case "money":
                    const amount = r.amount || 0;
                    addPlayerMoney(player, amount, "CDK兑换");
                    rewardDescs.push(amount + getCurrencyName());
                    break;
            }
        });

        if (!cdkInfo.usedBy) cdkInfo.usedBy = {};
        cdkInfo.usedBy[xuid] = { name: player.name, time: new Date().toLocaleString() };
        cdkDataDM.save();

        const desc = rewardDescs.length > 0 ? rewardDescs.join("\n") : "无奖励";
        player.sendModalForm("兑换成功", "获得:\n" + desc, "继续兑换", "关闭", function(pl, ok) {
            if (ok === true) showCdkRedeemForm(pl);
        });
    }

    return {
        showCdkRedeemForm: showCdkRedeemForm,
        redeemCdk: redeemCdk
    };
}

module.exports = {
    create: createCdkModule
};
