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
 * NECE VIP会员系统
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
    const t = deps.t;
    const getPlayerSetting = deps.getPlayerSetting;
    const getSystemLanguage = deps.getSystemLanguage;

    /**
     * 获取玩家语言设置
     * @param {string} xuid
     * @returns {string}
     */
    function getLocale(xuid) {
        if (getPlayerSetting) {
            var locale = getPlayerSetting(xuid, 'locale');
            if (locale) return locale;
        }
        return getSystemLanguage ? getSystemLanguage() : 'zh_CN';
    }

    /** 检查玩家是否拥有月光祝福 */
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

    /** 显示月光祝福主界面 */
    function showVipMenu(player) {
        const lang = getLocale(player.xuid);
        let vipInfo = getVipInfo(player);
        let fm = mc.newSimpleForm();
        fm.setTitle(t(lang, 'vip.title'));

        let content = "";
        if (vipInfo.hasVip) {
            content += t(lang, 'vip.status_owned');
            if (vipInfo.permanent) {
                content += t(lang, 'vip.expire_permanent');
                content += t(lang, 'vip.remaining_permanent');
            } else {
                let expireDate = new Date(vipInfo.expireTime);
                let remainingDays = Math.ceil((vipInfo.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
                content += t(lang, 'vip.expire_date', expireDate.getFullYear(), expireDate.getMonth() + 1, expireDate.getDate());
                content += t(lang, 'vip.remaining_days', remainingDays);
            }
            content += t(lang, 'vip.total_saved', vipInfo.totalSaved, getCurrencyName());
            content += "-------------------------\n";
            content += t(lang, 'vip.discount_info');
            fm.addButton(t(lang, 'vip.btn_guardian'), "textures/ui/manmoon");
        } else {
            content += t(lang, 'vip.status_none');
            content += t(lang, 'vip.total_saved', vipInfo.totalSaved, getCurrencyName());
            content += "-------------------------\n";
            content += t(lang, 'vip.discount_info');
            fm.addButton(t(lang, 'vip.btn_contract'), "textures/ui/manmoon");
        }

        fm.setContent(content);
        fm.addButton(t(lang, 'vip.btn_back_shop'), "textures/ui/recap_glyph_desaturated");

        player.sendForm(fm, function(p, id) {
            if (id === null || id === undefined || typeof id !== 'number') {
                return;
            }

            if (id === 1) {
                openMainMenu(p);
            } else if (id === 0) {
                if (vipInfo.permanent) {
                    p.sendModalForm(
                        t(lang, 'vip.permanent_title'),
                        t(lang, 'vip.permanent_content'),
                        t(lang, 'vip.btn_confirm'),
                        t(lang, 'vip.btn_back'),
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

    /** 显示VIP购买/续费表单 */
    function showVipPurchaseForm(player) {
        const lang = getLocale(player.xuid);
        const vipInfo = getVipInfo(player);
        const fm = mc.newCustomForm();
        fm.setTitle(t(lang, 'vip.title'));

        let content = "";
        if (vipInfo.hasVip) {
            if (vipInfo.permanent) {
                content += t(lang, 'vip.status_owned');
                content += t(lang, 'vip.expire_permanent');
                content += t(lang, 'vip.remaining_permanent');
                content += t(lang, 'vip.total_saved', vipInfo.totalSaved, getCurrencyName());
                content += "-------------------------\n";
                content += t(lang, 'vip.discount_info');
            } else {
                let expireDate = new Date(vipInfo.expireTime);
                let remainingDays = Math.ceil((vipInfo.expireTime - Date.now()) / (1000 * 60 * 60 * 24));
                content += t(lang, 'vip.status_owned');
                content += t(lang, 'vip.expire_date', expireDate.getFullYear(), expireDate.getMonth() + 1, expireDate.getDate());
                content += t(lang, 'vip.remaining_days', remainingDays);
                content += t(lang, 'vip.total_saved', vipInfo.totalSaved, getCurrencyName());
                content += "-------------------------\n";
                content += t(lang, 'vip.discount_info');
            }
        } else {
            content += t(lang, 'vip.status_none');
            content += t(lang, 'vip.total_saved', vipInfo.totalSaved, getCurrencyName());
            content += "-------------------------\n";
            content += t(lang, 'vip.discount_info');
        }

        fm.addLabel(content);
        fm.addDropdown(t(lang, 'vip.select_duration'), [
            t(lang, 'vip.duration_day', getCurrencyName()),
            t(lang, 'vip.duration_week', getCurrencyName()),
            t(lang, 'vip.duration_month', getCurrencyName()),
            t(lang, 'vip.duration_season', getCurrencyName())
        ], 0);

        player.sendForm(fm, function(p, data) {
            if (data == null || data === undefined) {
                return;
            }

            if (typeof data !== "object" || !Array.isArray(data) || data.length < 2) {
                p.tell(t(lang, 'vip.err_invalid_selection'));
                showVipMenu(p);
                return;
            }

            const selection = data[1];

            const prices = [800, 4800, 16800, 48000];
            const durations = [1, 7, 30, 90];

            if (typeof selection !== 'number' || isNaN(selection) || selection < 0 || selection >= prices.length) {
                p.tell(t(lang, 'vip.err_invalid_selection'));
                showVipPurchaseForm(p);
                return;
            }

            const selectedPrice = prices[selection];
            let selectedDuration = durations[selection];

            const playerMoney = getPlayerMoney(p);
            if (playerMoney < selectedPrice) {
                p.sendModalForm(
                    t(lang, 'vip.purchase_failed'),
                    t(lang, 'vip.insufficient_balance', selectedPrice, getCurrencyName(), playerMoney, getCurrencyName()),
                    t(lang, 'vip.btn_back_purchase'),
                    t(lang, 'vip.btn_close'),
                    function(player, result) {
                        if (result === true) {
                            showVipPurchaseForm(player);
                        }
                    }
                );
                return;
            }

            const reduceSuccess = reducePlayerMoney(p, selectedPrice, t(lang, 'vip.purchase_reason'));
            if (!reduceSuccess) {
                p.sendModalForm(
                    t(lang, 'vip.purchase_failed'),
                    t(lang, 'vip.system_error'),
                    t(lang, 'vip.btn_back'),
                    t(lang, 'vip.btn_close'),
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

                successMessage = t(lang, 'vip.purchase_success_permanent', selectedPrice, getCurrencyName(), getPlayerMoney(p), getCurrencyName());
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

                successMessage = t(lang, 'vip.purchase_success', selectedPrice, getCurrencyName(), afterMoney, getCurrencyName(), remainingDays, expireDate.getFullYear(), expireDate.getMonth() + 1, expireDate.getDate());
            }

            savePlayerDataNow();

            p.sendModalForm(
                t(lang, 'vip.purchase_success_title'),
                successMessage,
                t(lang, 'vip.btn_confirm'),
                t(lang, 'vip.btn_back'),
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
