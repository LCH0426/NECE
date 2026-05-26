var RANK_PAGE_SIZE = 10;

function createRankModule(deps) {
    var playerData = deps.playerData;
    var getCurrencyName = deps.getCurrencyName;

    function showRankMainForm(player) {
        var fm = mc.newSimpleForm();
        fm.setTitle("排行榜");
        fm.addButton("经济排行榜", "textures/ui/icon_recipe_nature");
        fm.addButton("存款排行榜", "textures/ui/icon_book_writable");
        fm.addButton("击杀排行榜", "textures/ui/icon_sword");
        fm.addButton("死亡排行榜", "textures/ui/icon_wither");
        fm.addButton("挖掘排行榜", "textures/ui/icon_recipe_equipment");
        fm.addButton("关闭", "textures/ui/cancel");
        player.sendForm(fm, function(p, id) {
            if (id === null || id === 5) return;
            var types = ["money", "bank", "kills", "deaths", "mining"];
            showRankDetailForm(p, types[id], 0);
        });
    }

    function getRankData(type) {
        var entries = [];
        var players = playerData.players || {};
        Object.keys(players).forEach(function(xuid) {
            var p = players[xuid];
            if (!p) return;
            var name = p.name || "未知";
            var value = 0;
            switch (type) {
                case "money":
                    if (typeof money !== 'undefined' && money && typeof money.get === 'function') {
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
        var titles = {
            money: "经济排行榜",
            bank: "存款排行榜",
            kills: "击杀排行榜",
            deaths: "死亡排行榜",
            mining: "挖掘排行榜"
        };
        return titles[type] || "排行榜";
    }

    function getRankUnit(type) {
        var units = {
            money: getCurrencyName(),
            bank: getCurrencyName(),
            kills: "次",
            deaths: "次",
            mining: "个"
        };
        return units[type] || "";
    }

    function showRankDetailForm(player, type, page) {
        var allData = getRankData(type);
        var title = getRankTitle(type);
        var unit = getRankUnit(type);
        var totalPages = Math.max(1, Math.ceil(allData.length / RANK_PAGE_SIZE));
        if (page >= totalPages) page = totalPages - 1;
        if (page < 0) page = 0;
        var start = page * RANK_PAGE_SIZE;
        var end = Math.min(start + RANK_PAGE_SIZE, allData.length);
        var pageData = allData.slice(start, end);

        var content = "第" + (page + 1) + "/" + totalPages + "页 共" + allData.length + "人\n\n";

        if (allData.length === 0) {
            content = "暂无数据";
        } else {
            pageData.forEach(function(entry, idx) {
                var rank = start + idx + 1;
                var prefix = "";
                if (rank === 1) prefix = "第一名 ";
                else if (rank === 2) prefix = "第二名 ";
                else if (rank === 3) prefix = "第三名 ";
                else prefix = "第" + rank + "名 ";
                content += prefix + entry.name + " " + entry.value + unit + "\n";
            });
        }

        var fm = mc.newSimpleForm();
        fm.setTitle(title);
        fm.setContent(content);
        if (page > 0) fm.addButton("上一页", "textures/ui/arrow_left");
        if (page < totalPages - 1) fm.addButton("下一页", "textures/ui/arrow_right");
        fm.addButton("返回排行榜", "textures/ui/recap_glyph_desaturated");
        player.sendForm(fm, function(p, id) {
            if (id === null) return;
            var btnIdx = 0;
            var hasPrev = page > 0;
            var hasNext = page < totalPages - 1;
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
