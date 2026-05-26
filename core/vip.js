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
 * NLCE VIP会员系统
 * VIP购买、续费、到期管理及VIP专属权益功能
 */


//vip模块

var vipModule = {
    getVipInfo: null,
    showVipMenu: null,
    showVipPurchaseForm: null,
    checkPlayerHasMoonlightBlessing: null
};

function createVipModule(deps) {
    var playerData = deps.playerData;
    var savePlayerDataNow = deps.savePlayerDataNow;
    var getPlayerMoney = deps.getPlayerMoney;
    var reducePlayerMoney = deps.reducePlayerMoney;
    var addPlayerMoney = deps.addPlayerMoney;
    var getCurrencyName = deps.getCurrencyName;
    var openMainMenu = deps.openMainMenu;

    function checkPlayerHasMoonlightBlessing(xuid) {
        var p = playerData.players[xuid];
        return !!(p && p.vipdata && (p.vipdata.permanent || (p.vipdata.expireTime && p.vipdata.expireTime > Date.now())));
    }

    function getVipInfo(player) {
        var xuid = player.xuid;
        var p = playerData.players[xuid];
        if (!p || !p.vipdata) {
            return {
                hasVip: false,
                expireTime: null,
                permanent: false,
                totalSaved: 0
            };
        }

        var vipInfo = p.vipdata;
        var now = Date.now();

        if (vipInfo.permanent) {
            return {
                hasVip: true,
                expireTime: null,
                permanent: true,
                totalSaved: vipInfo.totalSaved || 0
            };
        }

        if (!vipInfo.expireTime || vipInfo.expireTime < now) {
            var totalSaved = vipInfo.totalSaved || 0;
            delete p.vipdata;
            savePlayerDataNow();
            return {
                hasVip: false,
                expireTime: null,
                permanent: false,
                totalSaved: totalSaved
            };
        }

        return {
            hasVip: true,
            expireTime: vipInfo.expireTime,
            permanent: false,
            totalSaved: vipInfo.totalSaved || 0
        };
    }

    function showVipMenu(player) {
        var vipInfo = getVipInfo(player);
        var fm = mc.newSimpleForm();
        fm.setTitle("§l§b月光祝福");

        var content = "";
        if (vipInfo.hasVip) {
            content += "§a当前状态：§e已拥有\n";
            if (vipInfo.permanent) {
                content += "§a到期时间：§f永不过期\n";
                content += "§a剩余天数：§f永久\n";
            } else {
                var expireDate = new Date(vipInfo.expireTime);
                var remainingDays = Math.ceil((vipInfo.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
                content += "§a到期时间：§f" + expireDate.getFullYear() + "年" + (expireDate.getMonth() + 1) + "月" + expireDate.getDate() + "日\n";
                content += "§a剩余天数：§f" + remainingDays + "天\n";
            }
            content += "§a已节约：§f" + vipInfo.totalSaved + " 点§c" + getCurrencyName() + "§r\n";
            content += "-------------------------\n";
            content += "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            fm.addButton("§l§a守望月光的祝福", "textures/ui/manmoon");
        } else {
            content += "§a当前状态：§c未拥有\n";
            content += "§a已节约：§f" + vipInfo.totalSaved + " 点§c" + getCurrencyName() + "§r\n";
            content += "-------------------------\n";
            content += "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            fm.addButton("§l§a缔结月光的祝福", "textures/ui/manmoon");
        }

        fm.setContent(content);
        fm.addButton("§c返回商城", "textures/ui/recap_glyph_desaturated");

        player.sendForm(fm, function(p, id) {
            if (id === null || id === undefined || typeof id !== 'number') {
                return;
            }

            if (id === 1) {
                openMainMenu(p);
            } else if (id === 0) {
                if (vipInfo.permanent) {
                    p.sendModalForm(
                        "§l§b月光的祝福",
                        "-------------------------\n" +
                        "§e月光的祝福如永恒光环般环绕着你，永不消散。\n" +
                        "-------------------------\n" +
                        "§e你已拥有永久的月光祝福，将永享商城折扣！",
                        "§a确定",
                        "§c返回",
                        function(player, result) {
                            showVipMenu(player);
                        }
                    );
                } else {
                    showVipPurchaseForm(p);
                }
            }
        });
    }

    function showVipPurchaseForm(player) {
        var vipInfo = getVipInfo(player);
        var fm = mc.newCustomForm();
        fm.setTitle("§l§b月光祝福");

        var content = "";
        if (vipInfo.hasVip) {
            if (vipInfo.permanent) {
                content += "§a当前状态：§e已拥有\n";
                content += "§a到期时间：§f永不过期\n";
                content += "§a剩余天数：§f永久\n";
                content += "§a已节约：§f" + vipInfo.totalSaved + " 点§c" + getCurrencyName() + "§r\n";
                content += "-------------------------\n";
                content += "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            } else {
                var expireDate = new Date(vipInfo.expireTime);
                var remainingDays = Math.ceil((vipInfo.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
                content += "§a当前状态：§e已拥有\n";
                content += "§a到期时间：§f" + expireDate.getFullYear() + "年" + (expireDate.getMonth() + 1) + "月" + expireDate.getDate() + "日\n";
                content += "§a剩余天数：§f" + remainingDays + "天\n";
                content += "§a已节约：§f" + vipInfo.totalSaved + " 点§c" + getCurrencyName() + "§r\n";
                content += "-------------------------\n";
                content += "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            }
        } else {
            content += "§a当前状态：§c未拥有\n";
            content += "§a已节约：§f" + vipInfo.totalSaved + " 点§c" + getCurrencyName() + "§r\n";
            content += "-------------------------\n";
            content += "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
        }

        fm.addLabel(content);
        fm.addDropdown("选择时长", ["天卡 (800点§c" + getCurrencyName() + "§r)", "周卡 (4800点§c" + getCurrencyName() + "§r)", "月卡 (16800点§c" + getCurrencyName() + "§r)", "季卡 (48000点§c" + getCurrencyName() + "§r)"], 0, "选择月光祝福的时长");

        player.sendForm(fm, function(p, data) {
            if (data === null || data === undefined) {
                return;
            }

            if (typeof data !== "object" || !Array.isArray(data) || data.length < 2) {
                p.tell("§c选择无效，请重新选择");
                showVipMenu(p);
                return;
            }

            var selection = data[1];

            var prices = [800, 4800, 16800, 48000];
            var durations = [1, 7, 30, 90];
            var durationNames = ["天", "周", "月", "季"];

            if (typeof selection !== 'number' || isNaN(selection) || selection < 0 || selection >= prices.length) {
                p.tell("§c选择无效，请重新选择");
                showVipPurchaseForm(p);
                return;
            }

            var selectedPrice = prices[selection];
            var selectedDuration = durations[selection];
            var durationName = durationNames[selection];

            var playerMoney = getPlayerMoney(p);
            if (playerMoney < selectedPrice) {
                p.sendModalForm(
                    "§c购买失败",
                    "-------------------------\n" +
                    "§c购买失败！\n" +
                    "§c余额不足\n" +
                    "§a需要：§f" + selectedPrice + " 点§c" + getCurrencyName() + "§r\n" +
                    "§a当前余额：§f" + playerMoney + " 点§c" + getCurrencyName() + "§r\n" +
                    "-------------------------",
                    "§a返回购买",
                    "§c关闭",
                    function(player, result) {
                        if (result === true) {
                            showVipPurchaseForm(player);
                        }
                    }
                );
                return;
            }

            var reduceSuccess = reducePlayerMoney(p, selectedPrice, "月光祝福");
            if (!reduceSuccess) {
                p.sendModalForm(
                    "§c购买失败",
                    "-------------------------\n" +
                    "§c购买失败！\n" +
                    "§c货币系统异常，请稍后重试\n" +
                    "-------------------------",
                    "§a返回",
                    "§c关闭",
                    function(player, result) {
                        if (result === true) {
                            showVipMenu(player);
                        }
                    }
                );
                return;
            }

            var xuid = p.xuid;
            var now = Date.now();
            var successMessage = "";

            if (selectedDuration === 0) {
                if (!playerData.players[xuid].vipdata) {
                    playerData.players[xuid].vipdata = {
                        permanent: true,
                        totalSaved: 0
                    };
                } else {
                    playerData.players[xuid].vipdata.permanent = true;
                    delete playerData.players[xuid].vipdata.expireTime;
                }

                successMessage = "-------------------------\n" +
                    "§a购买成功！\n" +
                    "§a花费：§f" + selectedPrice + " 点§c" + getCurrencyName() + "§r\n" +
                    "§a剩余余额：§f" + getPlayerMoney(p) + " 点§c" + getCurrencyName() + "§r\n" +
                    "§a剩余时间：§f永久\n" +
                    "§a到期时间：§f永不过期\n" +
                    "-------------------------\n" +
                    "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            } else {
                var expireTime = vipInfo.hasVip && vipInfo.expireTime ? Math.max(vipInfo.expireTime, now) : now;
                var newExpireTime = expireTime + (selectedDuration * 24 * 60 * 60 * 1000);

                if (!playerData.players[xuid].vipdata) {
                    playerData.players[xuid].vipdata = {
                        expireTime: newExpireTime,
                        totalSaved: 0
                    };
                } else {
                    playerData.players[xuid].vipdata.expireTime = newExpireTime;
                }

                var expireDate = new Date(newExpireTime);
                var afterMoney = getPlayerMoney(p);
                var remainingDays = Math.ceil((newExpireTime - Date.now()) / (1000 * 60 * 60 * 24));

                successMessage = "-------------------------\n" +
                    "§a购买成功！\n" +
                    "§a花费：§f" + selectedPrice + " 点§c" + getCurrencyName() + "§r\n" +
                    "§a剩余余额：§f" + afterMoney + " 点§c" + getCurrencyName() + "§r\n" +
                    "§a剩余时间：§f" + remainingDays + "天\n" +
                    "§a到期时间：§f" + expireDate.getFullYear() + "年" + (expireDate.getMonth() + 1) + "月" + expireDate.getDate() + "日\n" +
                    "-------------------------\n" +
                    "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            }

            savePlayerDataNow();

            p.sendModalForm(
                "§a购买成功",
                successMessage,
                "§a确定",
                "§c返回",
                function(player, result) {
                    showVipMenu(player);
                }
            );
        });
    }

    return {
        getVipInfo: getVipInfo,
        showVipMenu: showVipMenu,
        showVipPurchaseForm: showVipPurchaseForm,
        checkPlayerHasMoonlightBlessing: checkPlayerHasMoonlightBlessing
    };
}

module.exports = {
    create: createVipModule
};
