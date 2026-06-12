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
 * NECE 排行榜系统
 * UID、在线时间、余额等多维度排行榜数据计算与展示
 */


const RANK_PAGE_SIZE = 10;

function createRankModule(deps) {
    const playerData = deps.playerData;
    const getCurrencyName = deps.getCurrencyName;
    const getMoneyByXuid = deps.getMoneyByXuid;

    function showRankMainForm(player) {
        let fm = mc.newSimpleForm();
        fm.setTitle("排行榜");
        fm.addButton("经济排行榜", "textures/ui/icon_recipe_nature");
        fm.addButton("存款排行榜", "textures/ui/icon_book_writable");
        fm.addButton("击杀排行榜", "textures/items/diamond_sword");
        fm.addButton("死亡排行榜", "textures/ui/bad_omen_effect");
        fm.addButton("挖掘排行榜", "textures/items/diamond_pickaxe");
        fm.addButton("关闭", "textures/ui/cancel");
        player.sendForm(fm, function(p, id) {
            if (id === null || id === 5) return;
            const types = ["money", "bank", "kills", "deaths", "mining"];
            showRankDetailForm(p, types[id], 0);
        });
    }

    function getRankData(type) {
        const entries = [];
        const players = playerData.players || {};
        Object.keys(players).forEach(function(xuid) {
            const p = players[xuid];
            if (!p) return;
            const name = p.name || "未知";
            let value = 0;
            switch (type) {
                case "money":
                    if (getMoneyByXuid) {
                        value = getMoneyByXuid(xuid) || 0;
                    } else if (typeof money !== 'undefined' && money && typeof money.get === 'function') {
                        value = money.get(xuid) || 0;
                    }
                    break;
                case "bank":
                    if (p.bankdata && p.bankdata.current) {
                        value = p.bankdata.current.balance || 0;
                    }
                    break;
                case "kills":
                    if (p.count) value = p.count.kills || 0;
                    break;
                case "deaths":
                    if (p.count) value = p.count.deaths || 0;
                    break;
                case "mining":
                    if (p.count) value = p.count.mining || 0;
                    break;
            }
            entries.push({ name: name, value: value });
        });
        entries.sort(function(a, b) { return b.value - a.value; });
        return entries;
    }

    function getRankTitle(type) {
        const titles = {
            money: "经济排行榜",
            bank: "存款排行榜",
            kills: "击杀排行榜",
            deaths: "死亡排行榜",
            mining: "挖掘排行榜"
        };
        return titles[type] || "排行榜";
    }

    function getRankUnit(type) {
        const units = {
            money: getCurrencyName(),
            bank: getCurrencyName(),
            kills: "次",
            deaths: "次",
            mining: "个"
        };
        return units[type] || "";
    }

    function showRankDetailForm(player, type, page) {
        const allData = getRankData(type);
        const title = getRankTitle(type);
        const unit = getRankUnit(type);
        const totalPages = Math.max(1, Math.ceil(allData.length / RANK_PAGE_SIZE));
        if (page >= totalPages) page = totalPages - 1;
        if (page < 0) page = 0;
        const start = page * RANK_PAGE_SIZE;
        const end = Math.min(start + RANK_PAGE_SIZE, allData.length);
        const pageData = allData.slice(start, end);

        let content = "第" + (page + 1) + "/" + totalPages + "页 共" + allData.length + "人\n\n";

        if (allData.length === 0) {
            content = "暂无数据";
        } else {
            pageData.forEach(function(entry, idx) {
                let rank = start + idx + 1;
                let prefix = "";
                if (rank === 1) prefix = "第一名 ";
                else if (rank === 2) prefix = "第二名 ";
                else if (rank === 3) prefix = "第三名 ";
                else prefix = "第" + rank + "名 ";
                content += prefix + entry.name + " " + entry.value + unit + "\n";
            });
        }

        const fm = mc.newSimpleForm();
        fm.setTitle(title);
        fm.setContent(content);
        if (page > 0) fm.addButton("上一页", "textures/ui/arrow_left");
        if (page < totalPages - 1) fm.addButton("下一页", "textures/ui/arrow_right");
        fm.addButton("返回排行榜", "textures/ui/recap_glyph_desaturated");
        player.sendForm(fm, function(p, id) {
            if (id === null) return;
            let btnIdx = 0;
            const hasPrev = page > 0;
            const hasNext = page < totalPages - 1;
            if (hasPrev && id === btnIdx) {
                showRankDetailForm(p, type, page - 1);
                return;
            }
            if (hasPrev) btnIdx++;
            if (hasNext && id === btnIdx) {
                showRankDetailForm(p, type, page + 1);
                return;
            }
            if (hasNext) btnIdx++;
            if (id === btnIdx) showRankMainForm(p);
        });
    }

    return {
        showRankMainForm: showRankMainForm,
        showRankDetailForm: showRankDetailForm,
        getRankData: getRankData
    };
}

module.exports = {
    create: createRankModule
};
