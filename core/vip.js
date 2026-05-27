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
 * NLCE VIP会员系统（"月光祝福"）
 * VIP购买、续费、到期管理及VIP专属权益（商城85折优惠）
 */

/**
 * 创建VIP模块（工厂模式）
 * @param {object} deps - 依赖注入对象
 * @returns {object} VIP模块公开API
 */
function createVipModule(deps) {
    const playerData = deps.playerData;
    const savePlayerDataNow = deps.savePlayerDataNow;
    const getPlayerMoney = deps.getPlayerMoney;
    const reducePlayerMoney = deps.reducePlayerMoney;
    const addPlayerMoney = deps.addPlayerMoney;
    const getCurrencyName = deps.getCurrencyName;
    const openMainMenu = deps.openMainMenu;

    /** 检查玩家是否拥有月光祝福（永久VIP或未过期VIP） */
    function checkPlayerHasMoonlightBlessing(xuid) {
        let p = playerData.players[xuid];
        return !!(p && p.vipdata && (p.vipdata.permanent || (p.vipdata.expireTime && p.vipdata.expireTime > Date.now())));
    }

    /**
     * 获取玩家VIP状态信息。过期VIP会自动清除数据并保存
     * @param {object} player - 玩家对象
     * @returns {{ hasVip: boolean, expireTime: number|null, permanent: boolean, totalSaved: number }}
     */
    function getVipInfo(player) {
        let xuid = player.xuid;
        const p = playerData.players[xuid];
        if (!p || !p.vipdata) {
            return {
                hasVip: false,
                expireTime: null,
                permanent: false,
                totalSaved: 0
            };
        }

        let vipInfo = p.vipdata;
        let now = Date.now();

        if (vipInfo.permanent) {
            return {
                hasVip: true,
                expireTime: null,
                permanent: true,
                totalSaved: vipInfo.totalSaved || 0
            };
        }

        if (!vipInfo.expireTime || vipInfo.expireTime < now) {
            const totalSaved = vipInfo.totalSaved || 0;
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

    /** 显示月光祝福主界面（VIP状态、到期时间、累计节省金额） */
    function showVipMenu(player) {
        let vipInfo = getVipInfo(player);
        let fm = mc.newSimpleForm();
        fm.setTitle("§l§b月光祝福");

        let content = "";
        if (vipInfo.hasVip) {
            content += "§a当前状态：§e已拥有\n";
            if (vipInfo.permanent) {
                content += "§a到期时间：§f永不过期\n";
                content += "§a剩余天数：§f永久\n";
            } else {
                let expireDate = new Date(vipInfo.expireTime);
                let remainingDays = Math.ceil((vipInfo.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
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

    /** 显示VIP购买/续费表单（天卡/周卡/月卡/季卡），已有VIP则叠加时长 */
    function showVipPurchaseForm(player) {
        const vipInfo = getVipInfo(player);
        const fm = mc.newCustomForm();
        fm.setTitle("§l§b月光祝福");

        let content = "";
        if (vipInfo.hasVip) {
            if (vipInfo.permanent) {
                content += "§a当前状态：§e已拥有\n";
                content += "§a到期时间：§f永不过期\n";
                content += "§a剩余天数：§f永久\n";
                content += "§a已节约：§f" + vipInfo.totalSaved + " 点§c" + getCurrencyName() + "§r\n";
                content += "-------------------------\n";
                content += "§e拥有月光祝福的玩家将可享受商城85%%折扣！";
            } else {
                let expireDate = new Date(vipInfo.expireTime);
                let remainingDays = Math.ceil((vipInfo.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
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

            const selection = data[1];

            const prices = [800, 4800, 16800, 48000];
            const durations = [1, 7, 30, 90];
            const durationNames = ["天", "周", "月", "季"];

            if (typeof selection !== 'number' || isNaN(selection) || selection < 0 || selection >= prices.length) {
                p.tell("§c选择无效，请重新选择");
                showVipPurchaseForm(p);
                return;
            }

            const selectedPrice = prices[selection];
            let selectedDuration = durations[selection];
            const durationName = durationNames[selection];

            const playerMoney = getPlayerMoney(p);
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

            const reduceSuccess = reducePlayerMoney(p, selectedPrice, "月光祝福");
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

            const xuid = p.xuid;
            const now = Date.now();
            let successMessage = "";

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
                let expireTime = vipInfo.hasVip && vipInfo.expireTime ? Math.max(vipInfo.expireTime, now) : now;
                const newExpireTime = expireTime + (selectedDuration * 24 * 60 * 60 * 1000);

                if (!playerData.players[xuid].vipdata) {
                    playerData.players[xuid].vipdata = {
                        expireTime: newExpireTime,
                        totalSaved: 0
                    };
                } else {
                    playerData.players[xuid].vipdata.expireTime = newExpireTime;
                }

                const expireDate = new Date(newExpireTime);
                const afterMoney = getPlayerMoney(p);
                const remainingDays = Math.ceil((newExpireTime - Date.now()) / (1000 * 60 * 60 * 24));

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
