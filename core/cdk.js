var cdkModuleInstance = null;

function createCdkModule(deps) {
    var cdkDataDM = deps.cdkDataDM;
    var addPlayerMoney = deps.addPlayerMoney;
    var getCurrencyName = deps.getCurrencyName;
    var giveItemById = deps.giveItemById;

    function getCdkData() {
        return cdkDataDM.load();
    }

    function showCdkRedeemForm(player) {
        var fm = mc.newCustomForm();
        fm.setTitle("CDK兑换");
        fm.addInput("请输入兑换码", "兑换码", "");
        player.sendForm(fm, function(p, data) {
            if (data === null || !data || !data[0]) return;
            var code = data[0].trim();
            if (!code) { p.tell("兑换码不能为空"); return; }
            redeemCdk(p, code);
        });
    }

    function redeemCdk(player, code) {
        var cdkData = getCdkData();
        if (!cdkData || !cdkData.codes || !cdkData.codes[code]) {
            player.sendModalForm("兑换失败", "兑换码不存在", "重新输入", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
            return;
        }

        var cdkInfo = cdkData.codes[code];
        var xuid = player.xuid;

        if (cdkInfo.usedBy && cdkInfo.usedBy[xuid]) {
            player.sendModalForm("兑换失败", "你已经使用过该兑换码", "重新输入", "关闭", function(pl, ok) {
                if (ok === true) showCdkRedeemForm(pl);
            });
            return;
        }

        if (cdkInfo.maxUses > 0) {
            var usedCount = 0;
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

        var rewards = cdkInfo.rewards;
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

        var rewardDescs = [];
        rewards.forEach(function(r) {
            switch (r.type) {
                case "item":
                    var count = r.count || 1;
                    giveItemById(player, r.itemId, count);
                    rewardDescs.push((r.itemName || r.itemId) + " x" + count);
                    break;
                case "snbt":
                    var snbtItem = mc.newItem(r.snbt);
                    if (snbtItem) {
                        player.giveItem(snbtItem);
                    }
                    rewardDescs.push(r.itemName || "SNBT物品");
                    break;
                case "money":
                    var amount = r.amount || 0;
                    addPlayerMoney(player, amount, "CDK兑换");
                    rewardDescs.push(amount + getCurrencyName());
                    break;
            }
        });

        if (!cdkInfo.usedBy) cdkInfo.usedBy = {};
        cdkInfo.usedBy[xuid] = { name: player.name, time: new Date().toLocaleString() };
        cdkDataDM.save();

        var desc = rewardDescs.length > 0 ? rewardDescs.join("\n") : "无奖励";
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
