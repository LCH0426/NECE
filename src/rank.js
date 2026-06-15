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
const RANK_CACHE_TTL = 60000; // 排行榜缓存60秒

function createRankModule(deps) {
    const playerData = deps.playerData;
    const getCurrencyName = deps.getCurrencyName;
    const getMoneyByXuid = deps.getMoneyByXuid;
    const _t = deps.t || null;
    const _getLang = deps.getSystemLanguage || function() { return 'zh_CN'; };

    function t(key) {
        if (!_t) return key;
        var lang = _getLang();
        var args = [lang];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        return _t.apply(null, args);
    }

    // 排行榜缓存 { type: { data, time } }
    var _rankCache = {};

    function showRankMainForm(player) {
        let fm = mc.newSimpleForm();
        fm.setTitle(t('rank.title'));
        fm.addButton(t('rank.title_money'), "textures/ui/icon_recipe_nature");
        fm.addButton(t('rank.title_bank'), "textures/ui/icon_book_writable");
        fm.addButton(t('rank.title_kills'), "textures/items/diamond_sword");
        fm.addButton(t('rank.title_deaths'), "textures/ui/bad_omen_effect");
        fm.addButton(t('rank.title_mining'), "textures/items/diamond_pickaxe");
        fm.addButton(t('rank.close'), "textures/ui/cancel");
        player.sendForm(fm, function(p, id) {
            if (id === null || id === 5) return;
            const types = ["money", "bank", "kills", "deaths", "mining"];
            showRankDetailForm(p, types[id], 0);
        });
    }

    function getRankData(type) {
        var now = Date.now();
        if (_rankCache[type] && now - _rankCache[type].time < RANK_CACHE_TTL) {
            return _rankCache[type].data;
        }
        const entries = [];
        const players = playerData.players || {};
        Object.keys(players).forEach(function(xuid) {
            const p = players[xuid];
            if (!p) return;
            const name = p.name || t('rank.unknown');
            let value = 0;
            switch (type) {
                case "money":
                    if (getMoneyByXuid) {
                        value = getMoneyByXuid(xuid) || 0;
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
        _rankCache[type] = { data: entries, time: Date.now() };
        return entries;
    }

    function getRankTitle(type) {
        const titles = {
            money: t('rank.title_money'),
            bank: t('rank.title_bank'),
            kills: t('rank.title_kills'),
            deaths: t('rank.title_deaths'),
            mining: t('rank.title_mining')
        };
        return titles[type] || t('rank.title');
    }

    function getRankUnit(type) {
        const units = {
            money: getCurrencyName(),
            bank: getCurrencyName(),
            kills: t('rank.unit_times'),
            deaths: t('rank.unit_times'),
            mining: t('rank.unit_items')
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

        let content = t('rank.page_info', page + 1, totalPages, allData.length);

        if (allData.length === 0) {
            content = t('rank.no_data');
        } else {
            pageData.forEach(function(entry, idx) {
                let rank = start + idx + 1;
                let prefix = "";
                if (rank === 1) prefix = t('rank.rank_1');
                else if (rank === 2) prefix = t('rank.rank_2');
                else if (rank === 3) prefix = t('rank.rank_3');
                else prefix = t('rank.rank_n', rank);
                content += prefix + entry.name + " " + entry.value + unit + "\n";
            });
        }

        const fm = mc.newSimpleForm();
        fm.setTitle(title);
        fm.setContent(content);
        if (page > 0) fm.addButton(t('rank.prev_page'), "textures/ui/arrow_left");
        if (page < totalPages - 1) fm.addButton(t('rank.next_page'), "textures/ui/arrow_right");
        fm.addButton(t('rank.back'), "textures/ui/recap_glyph_desaturated");
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
