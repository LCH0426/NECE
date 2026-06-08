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
 * NECE 玩家管理路由模块
 * 提供在线玩家查询、踢出、经济操作、弹窗、玩家列表/详情、排行、系统统计、游戏模式修改等API
 */

function registerRoutes(router, d) {

    // 用 items.json 中的中文名和贴图补全物品信息
    function enrichItems(items, itemsMap) {
        if (!items || !itemsMap) return items || [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const shortId = (it.type || '').replace(/^minecraft:/, '');
            const info = itemsMap[shortId];
            if (info) {
                if (info.name) it.name = info.name;
                if (info.texture) it.image = info.texture;
            }
            if (!it.image) it.image = '';
        }
        return items;
    }

    // 获取当前在线玩家列表（含余额、设备信息、位置等实时数据）
    router.get('/players/online', d.adminAuth, function(req, res) {
        try {
            let onlinePlayers = d.mc.getOnlinePlayers();
            let players = onlinePlayers.map(function(p) {
                let balance = 0;
                try { balance = d.money.get(p.xuid) || 0; } catch (e) { balance = 0; }

                let ip = '';
                let ping = 0;
                let os = '';
                try {
                    let device = p.getDevice();
                    if (device) {
                        ip = device.ip || '';
                        ping = device.avgPing || 0;
                        os = device.os || '';
                    }
                } catch (e) {}

                // 从持久化数据获取上次记录的IP（离线后仍可查询）
                let lastIp = '';
                try {
                    const pd = d.getPlayerData();
                    if (pd && pd.players && pd.players[p.xuid]) {
                        lastIp = pd.players[p.xuid].lastIp || '';
                    }
                } catch (e) {}

                let isBanned = false;
                try { isBanned = d.banModule.isPlayerBanned(p.xuid, ip); } catch (e) {}
                let activeTitle = '萌新';
                try { activeTitle = d.chatModule.getPlayerActiveTitle(p.xuid); } catch (e) {}

                return {
                    name: p.name,
                    realName: p.realName || p.name,
                    xuid: p.xuid,
                    uuid: p.uuid || '',
                    ip: ip,
                    lastIp: lastIp,
                    dimension: p.dimension || 0,
                    position: p.pos || null,
                    balance: balance,
                    isBanned: isBanned,
                    activeTitle: activeTitle,
                    gameMode: p.gameMode || 0,
                    ping: ping,
                    os: os
                };
            });

            res.json({ code: 200, data: { players: players, count: players.length } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取在线玩家失败: ' + e.message });
        }
    });

    // 踢出指定玩家（需在线），记录操作日志
    router.post('/players/kick', d.adminAuth, function(req, res) {
        let xuid = req.body.xuid;
        let reason = req.body.reason || '';

        if (!xuid) {
            return res.status(400).json({ code: 400, msg: '缺少xuid参数' });
        }

        try {
            let player = d.mc.getPlayer(xuid);
            if (!player) {
                return res.status(404).json({ code: 404, msg: '玩家不在线' });
            }

            const kickReason = reason || '被管理员踢出';
            let playerName = player.name;
            player.kick(kickReason);

            d.adminLog.log(req.user.uid, '踢出玩家', playerName + '(' + xuid + ')', '原因: ' + kickReason);

            res.json({ code: 200, msg: '已踢出玩家 ' + playerName });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '踢出玩家失败: ' + e.message });
        }
    });

    // 管理员经济操作：增加/减少/设置玩家余额，操作后通知在线玩家
    router.post('/players/money', d.adminAuth, function(req, res) {
        let xuid = req.body.xuid;
        let action = req.body.action;
        let amount = req.body.amount;

        if (!xuid || !action || amount === undefined) {
            return res.status(400).json({ code: 400, msg: '缺少必要参数 (xuid, action, amount)' });
        }

        const intAmount = Math.floor(Number(amount));
        if (isNaN(intAmount) || intAmount <= 0) {
            return res.status(400).json({ code: 400, msg: '金额必须为正整数' });
        }

        try {
            if (typeof d.money === 'undefined' || d.money === null) {
                return res.status(500).json({ code: 500, msg: '经济系统未加载' });
            }

            const beforeBalance = d.money.get(xuid) || 0;
            let success = false;

            if (action === 'add') {
                success = d.money.add(xuid, intAmount);
            } else if (action === 'reduce') {
                success = d.money.reduce(xuid, intAmount);
            } else if (action === 'set') {
                // set操作通过差额计算转为add或reduce
                const currentBalance = d.money.get(xuid) || 0;
                if (intAmount >= currentBalance) {
                    success = d.money.add(xuid, intAmount - currentBalance);
                } else {
                    success = d.money.reduce(xuid, currentBalance - intAmount);
                }
            } else {
                return res.status(400).json({ code: 400, msg: '无效操作，支持: add, reduce, set' });
            }

            if (success) {
                const afterBalance = d.money.get(xuid) || 0;
                let playerName = d.getPlayerName(xuid);

                const actionNames = { add: '增加', reduce: '减少', set: '设置' };
                d.adminLog.log(req.user.uid, '经济操作', playerName + '(' + xuid + ')',
                    actionNames[action] + ' ' + intAmount + ' (余额: ' + beforeBalance + ' -> ' + afterBalance + ')');

                // 玩家在线时发送Toast通知余额变动
                try {
                    let targetPlayer = d.mc.getPlayer(xuid);
                    if (targetPlayer) {
                        const diff = afterBalance - beforeBalance;
                        const sign = diff >= 0 ? '+' : '';
                        const currencyName = d.getCurrencyName();
                        const sourceMap = { add: '管理员增加', reduce: '管理员减少', set: '管理员设置' };
                        targetPlayer.sendToast(sourceMap[action] || '管理员操作', sign + diff + currencyName);
                    }
                } catch (e) {}

                res.json({
                    code: 200,
                    msg: '操作成功',
                    data: { xuid: xuid, name: playerName, action: action, amount: intAmount, before: beforeBalance, after: afterBalance }
                });
            } else {
                res.status(500).json({ code: 500, msg: '经济操作失败，余额可能不足' });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '经济操作失败: ' + e.message });
        }
    });

    // 向指定在线玩家发送弹窗消息（SimpleForm，仅一个关闭按钮）
    router.post('/players/popup', d.adminAuth, function(req, res) {
        let xuid = req.body.xuid;
        let content = req.body.content;

        if (!xuid) {
            return res.status(400).json({ code: 400, msg: '缺少xuid参数' });
        }

        if (!content || !content.trim()) {
            return res.status(400).json({ code: 400, msg: '消息内容不能为空' });
        }

        if (content.length > 1000) {
            return res.status(400).json({ code: 400, msg: '消息内容不能超过1000字符' });
        }

        try {
            let player = d.mc.getPlayer(xuid);
            if (!player) {
                return res.status(404).json({ code: 404, msg: '玩家不在线' });
            }

            let playerName = player.name;

            const form = d.mc.newSimpleForm();
            form.setTitle('管理员远程消息');
            form.setContent(content.trim());
            form.addButton('关闭');
            player.sendForm(form, function() {});

            d.adminLog.log(req.user.uid, '发送弹窗', playerName + '(' + xuid + ')', '内容: ' + content.trim());

            res.json({ code: 200, msg: '弹窗已发送给 ' + playerName });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '发送弹窗失败: ' + e.message });
        }
    });

    // 获取全量玩家列表（支持搜索和分页），按UID升序排列
    router.get('/players', d.adminAuth, function(req, res) {
        try {
            let playerData = d.getPlayerData();
            if (!playerData || !playerData.players) {
                return res.status(500).json({ code: 500, msg: '无法读取玩家数据' });
            }

            let page = parseInt(req.query.page) || 1;
            let pageSize = parseInt(req.query.pageSize) || 20;
            let search = (req.query.search || '').trim().toLowerCase();

            let playerList = [];
            let players = playerData.players;

            // 按名称、UID或XUID模糊匹配搜索（先不加载余额，分页后再批量获取）
            Object.keys(players).forEach(function(xuid) {
                let p = players[xuid];
                const matchSearch = !search ||
                    (p.name && p.name.toLowerCase().indexOf(search) !== -1) ||
                    (String(p.uid) && String(p.uid).indexOf(search) !== -1) ||
                    xuid.toLowerCase().indexOf(search) !== -1;

                if (matchSearch) {
                    playerList.push({
                        uid: p.uid,
                        name: p.name || '',
                        xuid: xuid,
                        registerTime: p.registerTime || '',
                        playTime: (p.count && p.count.playTime) || 0,
                        vipExpire: (p.vipdata && p.vipdata.expireTime) || 0,
                        lastIp: p.lastIp || '',
                        platform: p.platform || ''
                    });
                }
            });

            playerList.sort(function(a, b) { return a.uid - b.uid; });

            let total = playerList.length;
            let totalPages = Math.ceil(total / pageSize);
            let start = (page - 1) * pageSize;
            const end = start + pageSize;
            let pagedPlayers = playerList.slice(start, end);

            // 只对当前页的玩家获取余额、在线状态、封禁状态和称号
            pagedPlayers.forEach(function(p) {
                try { p.balance = d.money.get(p.xuid) || 0; } catch (e) { p.balance = 0; }
                try { p.isOnline = !!d.mc.getPlayer(p.xuid); } catch (e) { p.isOnline = false; }
                try { p.isBanned = d.banModule.isPlayerBanned(p.xuid, p.lastIp); } catch (e) { p.isBanned = false; }
                try { p.activeTitle = d.chatModule.getPlayerActiveTitle(p.xuid); } catch (e) { p.activeTitle = ''; }
            });

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages }
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取玩家列表失败: ' + e.message });
        }
    });

    // 玩家UID排行（支持升序/降序），用于查看注册顺序
    router.get('/players/rank/uid', d.adminAuth, function(req, res) {
        try {
            let playerData = d.getPlayerData();
            if (!playerData || !playerData.players) {
                return res.status(500).json({ code: 500, msg: '无法读取玩家数据' });
            }

            let page = parseInt(req.query.page) || 1;
            let pageSize = parseInt(req.query.pageSize) || 20;
            let order = (req.query.order || 'asc').toLowerCase();

            let playerList = [];
            let players = playerData.players;

            Object.keys(players).forEach(function(xuid) {
                let p = players[xuid];
                playerList.push({
                    uid: p.uid,
                    name: p.name || '',
                    xuid: xuid,
                    registerTime: p.registerTime || '',
                    playTime: (p.count && p.count.playTime) || 0
                });
            });

            if (order === 'desc') {
                playerList.sort(function(a, b) { return b.uid - a.uid; });
            } else {
                playerList.sort(function(a, b) { return a.uid - b.uid; });
            }

            let total = playerList.length;
            let totalPages = Math.ceil(total / pageSize);
            let start = (page - 1) * pageSize;
            let pagedPlayers = playerList.slice(start, start + pageSize);

            // 只对当前页的玩家获取余额、封禁状态和称号
            pagedPlayers.forEach(function(p) {
                try { p.balance = d.money.get(p.xuid) || 0; } catch (e) { p.balance = 0; }
                try { p.isBanned = d.banModule.isPlayerBanned(p.xuid, p.lastIp); } catch (e) { p.isBanned = false; }
                try { p.activeTitle = d.chatModule.getPlayerActiveTitle(p.xuid); } catch (e) { p.activeTitle = ''; }
            });

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    sort: { field: 'uid', order: order },
                    pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages }
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取UID排行失败: ' + e.message });
        }
    });

    // 玩家在线时间排行（默认降序，活跃玩家在前）
    router.get('/players/rank/playtime', d.adminAuth, function(req, res) {
        try {
            let playerData = d.getPlayerData();
            if (!playerData || !playerData.players) {
                return res.status(500).json({ code: 500, msg: '无法读取玩家数据' });
            }

            let page = parseInt(req.query.page) || 1;
            let pageSize = parseInt(req.query.pageSize) || 20;
            let order = (req.query.order || 'desc').toLowerCase();

            let playerList = [];
            let players = playerData.players;

            Object.keys(players).forEach(function(xuid) {
                let p = players[xuid];
                playerList.push({
                    uid: p.uid,
                    name: p.name || '',
                    xuid: xuid,
                    playTime: (p.count && p.count.playTime) || 0,
                    registerTime: p.registerTime || ''
                });
            });

            if (order === 'asc') {
                playerList.sort(function(a, b) { return a.playTime - b.playTime; });
            } else {
                playerList.sort(function(a, b) { return b.playTime - a.playTime; });
            }

            let total = playerList.length;
            let totalPages = Math.ceil(total / pageSize);
            let start = (page - 1) * pageSize;
            let pagedPlayers = playerList.slice(start, start + pageSize);

            // 只对当前页的玩家获取余额、封禁状态和称号
            pagedPlayers.forEach(function(p) {
                try { p.balance = d.money.get(p.xuid) || 0; } catch (e) { p.balance = 0; }
                try { p.isBanned = d.banModule.isPlayerBanned(p.xuid, p.lastIp); } catch (e) { p.isBanned = false; }
                try { p.activeTitle = d.chatModule.getPlayerActiveTitle(p.xuid); } catch (e) { p.activeTitle = ''; }
            });

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    sort: { field: 'playTime', order: order },
                    pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages }
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取在线时间排行失败: ' + e.message });
        }
    });

    // 玩家余额排行（默认降序，土豪在前）
    router.get('/players/rank/balance', d.adminAuth, function(req, res) {
        try {
            let playerData = d.getPlayerData();
            if (!playerData || !playerData.players) {
                return res.status(500).json({ code: 500, msg: '无法读取玩家数据' });
            }

            let page = parseInt(req.query.page) || 1;
            let pageSize = parseInt(req.query.pageSize) || 20;
            let order = (req.query.order || 'desc').toLowerCase();

            // 复用 monitoring 模块的余额排行缓存（5分钟TTL），避免每次请求遍历所有玩家
            const cachedList = d.monitoring.getFullBalanceRank(order);
            const players = playerData.players;

            // 合并缓存的余额数据与玩家详情
            const playerList = cachedList.map(function(item) {
                const p = players[item.xuid] || {};
                return {
                    uid: p.uid || 0,
                    name: item.name || p.name || '',
                    xuid: item.xuid,
                    balance: item.balance,
                    playTime: (p.count && p.count.playTime) || 0,
                    registerTime: p.registerTime || ''
                };
            });

            let total = playerList.length;
            let totalPages = Math.ceil(total / pageSize);
            let start = (page - 1) * pageSize;
            const pagedPlayers = playerList.slice(start, start + pageSize);

            // 添加封禁状态和称号
            pagedPlayers.forEach(function(p) {
                try { p.isBanned = d.banModule.isPlayerBanned(p.xuid, p.lastIp); } catch (e) { p.isBanned = false; }
                try { p.activeTitle = d.chatModule.getPlayerActiveTitle(p.xuid); } catch (e) { p.activeTitle = ''; }
            });

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    sort: { field: 'balance', order: order },
                    pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages }
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取余额排行失败: ' + e.message });
        }
    });

    // 获取指定玩家详情（含在线状态、设备信息、完整玩家数据）
    router.get('/players/:xuid', d.adminAuth, function(req, res) {
        try {
            let xuid = req.params.xuid;
            let playerData = d.getPlayerData();

            if (!playerData || !playerData.players || !playerData.players[xuid]) {
                return res.status(404).json({ code: 404, msg: '玩家不存在' });
            }

            const pData = playerData.players[xuid];
            let balance = 0;
            try { balance = d.money.get(xuid) || 0; } catch (e) { balance = 0; }

            // 玩家在线时附加实时设备和位置信息
            let isOnline = false;
            let onlineInfo = null;
            try {
                const onlinePlayer = d.mc.getPlayer(xuid);
                if (onlinePlayer) {
                    isOnline = true;
                    let deviceIp = '';
                    let devicePing = 0;
                    let deviceOs = '';
                    try {
                        const device = onlinePlayer.getDevice();
                        if (device) {
                            deviceIp = device.ip || '';
                            devicePing = device.avgPing || 0;
                            deviceOs = device.os || '';
                        }
                    } catch (e) {}
                    onlineInfo = {
                        ip: deviceIp,
                        dimension: onlinePlayer.dimension || 0,
                        position: onlinePlayer.pos || null,
                        gameMode: onlinePlayer.gameMode || 0,
                        ping: devicePing,
                        os: deviceOs
                    };
                }
            } catch (e) {}

            // 封禁状态和称号
            let isBanned = false;
            try { isBanned = d.banModule.isPlayerBanned(xuid, pData.lastIp); } catch (e) {}
            let activeTitle = '萌新';
            try { activeTitle = d.chatModule.getPlayerActiveTitle(xuid); } catch (e) {}

            res.json({
                code: 200,
                data: {
                    uid: pData.uid,
                    name: pData.name || '',
                    xuid: xuid,
                    uuid: pData.uuid || '',
                    registerTime: pData.registerTime || '',
                    balance: balance,
                    isOnline: isOnline,
                    isBanned: isBanned,
                    activeTitle: activeTitle,
                    onlineInfo: onlineInfo,
                    lastIp: pData.lastIp || '',
                    platform: pData.platform || '',
                    playerData: pData
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取玩家详情失败: ' + e.message });
        }
    });

    // 修改在线玩家游戏模式（通过执行gamemode命令），支持多种模式别名
    router.put('/players/:xuid/gamemode', d.adminAuth, function(req, res) {
        try {
            let xuid = req.params.xuid;
            const mode = req.body.mode;

            // 模式别名映射：支持全名、缩写、数字ID
            const MODE_MAP = {
                'survival': { cmd: 'survival', name: '生存', id: 0 },
                's': { cmd: 'survival', name: '生存', id: 0 },
                '0': { cmd: 'survival', name: '生存', id: 0 },
                'creative': { cmd: 'creative', name: '创造', id: 1 },
                'c': { cmd: 'creative', name: '创造', id: 1 },
                '1': { cmd: 'creative', name: '创造', id: 1 },
                'adventure': { cmd: 'adventure', name: '冒险', id: 2 },
                'a': { cmd: 'adventure', name: '冒险', id: 2 },
                '2': { cmd: 'adventure', name: '冒险', id: 2 },
                'spectator': { cmd: 'spectator', name: '旁观', id: 6 },
                'sp': { cmd: 'spectator', name: '旁观', id: 6 },
                '6': { cmd: 'spectator', name: '旁观', id: 6 }
            };

            const modeStr = String(mode).toLowerCase();
            const modeInfo = MODE_MAP[modeStr];
            if (!modeInfo) {
                return res.status(400).json({ code: 400, msg: '无效的游戏模式，可选值: survival(生存), creative(创造), adventure(冒险), spectator(旁观)' });
            }

            const player = d.mc.getPlayer(xuid);
            if (!player) {
                return res.status(404).json({ code: 404, msg: '玩家不在线' });
            }

            let playerName = player.realName || player.name;
            const oldMode = player.gameMode;
            const MODE_NAMES = { 0: '生存', 1: '创造', 2: '冒险', 6: '旁观' };
            const oldModeName = MODE_NAMES[oldMode] || '未知';

            let cmdResult = d.mc.runcmd('gamemode ' + modeInfo.cmd + ' "' + playerName + '"');
            if (!cmdResult) {
                return res.status(500).json({ code: 500, msg: '修改游戏模式失败' });
            }

            d.adminLog.log(req.user.uid, '修改游戏模式', playerName + '(' + xuid + ')',
                oldModeName + '(' + oldMode + ') → ' + modeInfo.name + '(' + modeInfo.id + ')');

            res.json({
                code: 200,
                msg: '游戏模式修改成功',
                data: { name: playerName, xuid: xuid, oldMode: oldMode, oldModeName: oldModeName, newMode: modeInfo.id, newModeName: modeInfo.name }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改游戏模式失败: ' + e.message });
        }
    });

    // 获取服务器系统统计信息（CPU、内存、磁盘等，按需采集）
    router.get('/system/stats', d.adminAuth, async function(req, res) {
        try {
            await d.monitoring.refreshStats();
            let stats = d.monitoring.getSystemStats();
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取系统信息失败: ' + e.message });
        }
    });

    // 获取服务器货币名称（用于前端显示）
    router.get('/currency-name', d.adminAuth, function(req, res) {
        res.json({ code: 200, data: { name: d.getCurrencyName() } });
    });

    // 根据物品ID查询物品名称和贴图路径
    router.get('/item-info', d.adminAuth, function(req, res) {
        let itemId = (req.query.id || '').trim();
        if (!itemId) return res.status(400).json({ code: 400, msg: '缺少id参数' });
        const shortId = itemId.replace(/^minecraft:/, '');
        let name = d.getItemName(shortId);
        let image = d.getItemTexture(shortId);
        res.json({ code: 200, data: { id: itemId, name: name, image: image } });
    });

    // 获取服务器TPS（每秒刻数，衡量服务器负载）
    router.get('/tps', d.adminAuth, function(req, res) {
        try {
            let data = d.monitoring.getTps();
            res.json({ code: 200, data: data });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取TPS失败: ' + e.message });
        }
    });

    // 获取全服玩家总余额统计
    router.get('/allmoney', d.adminAuth, function(req, res) {
        try {
            let data = d.monitoring.getAllMoney();
            res.json({ code: 200, data: data });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取全服余额失败: ' + e.message });
        }
    });

    // 获取经济排行数据（Top N富有的玩家）
    router.get('/economy/rank', d.adminAuth, function(req, res) {
        try {
            let data = d.monitoring.getEconomyRank();
            res.json({ code: 200, data: data });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取经济排行失败: ' + e.message });
        }
    });
    // 获取单个玩家背包（在线玩家实时查询，离线玩家返回缓存数据）
    router.get('/players/:xuid/inventory', d.adminAuth, function(req, res) {
        try {
            let xuid = req.params.xuid;
            const itemsMap = d.getItemsMap();

            // 尝试实时查询在线玩家
            let onlinePlayer = null;
            try { onlinePlayer = d.mc.getPlayer(xuid); } catch (e) {}

            if (onlinePlayer) {
                const inventory = [];
                const armor = [];
                const offhand = [];

                try {
                    const inv = onlinePlayer.getInventory();
                    const allItems = inv.getAllItems();
                    for (let s = 0; s < allItems.length; s++) {
                        const it = allItems[s];
                        if (it.type && it.type !== '' && it.type !== 'minecraft:air') {
                            const shortId = it.type.replace(/^minecraft:/, '');
                            const info = itemsMap[shortId];
                            inventory.push({
                                slot: s, type: it.type, count: it.count,
                                name: (info && info.name) ? info.name : (it.name || shortId),
                                image: (info && info.texture) ? info.texture : ''
                            });
                        }
                    }
                } catch (e) {}

                try {
                    const armorContainer = onlinePlayer.getArmor();
                    if (armorContainer) {
                        const armorSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
                        const armorItems = armorContainer.getAllItems();
                        for (let s = 0; s < armorItems.length; s++) {
                            const it = armorItems[s];
                            if (it.type && it.type !== '' && it.type !== 'minecraft:air') {
                                const shortId = it.type.replace(/^minecraft:/, '');
                                const info = itemsMap[shortId];
                                armor.push({
                                    slot: armorSlots[s] || s, type: it.type, count: it.count,
                                    name: (info && info.name) ? info.name : (it.name || shortId),
                                    image: (info && info.texture) ? info.texture : ''
                                });
                            }
                        }
                    }
                } catch (e) {}

                // 副手物品（getOffHand返回Item对象，非Container）
                try {
                    const offhandItem = onlinePlayer.getOffHand();
                    if (offhandItem && offhandItem.type && offhandItem.type !== '' && offhandItem.type !== 'minecraft:air') {
                        const shortId = offhandItem.type.replace(/^minecraft:/, '');
                        const info = itemsMap[shortId];
                        offhand.push({
                            slot: 0, type: offhandItem.type, count: offhandItem.count,
                            name: (info && info.name) ? info.name : (offhandItem.name || shortId),
                            image: (info && info.texture) ? info.texture : ''
                        });
                    }
                } catch (e) {}

                return res.json({
                    code: 200,
                    data: { xuid: xuid, online: true, inventory: inventory, armor: armor, offhand: offhand }
                });
            }

            // 离线玩家：从数据库读取缓存并补全物品信息
            const cached = d.database.getPlayerInventorySQL(xuid);
            if (!cached) {
                return res.status(404).json({ code: 404, msg: '无背包缓存数据' });
            }
            res.json({
                code: 200,
                data: {
                    xuid: xuid, online: false,
                    inventory: enrichItems(cached.items, itemsMap),
                    armor: enrichItems(cached.armor || [], itemsMap),
                    offhand: enrichItems(cached.offhand || [], itemsMap),
                    saveTime: cached.saveTime
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取背包数据失败: ' + e.message });
        }
    });

    // 获取所有在线玩家背包（实时查询，含装备栏和副手）
    router.get('/inventory/online', d.adminAuth, function(req, res) {
        try {
            let onlinePlayers = [];
            try { onlinePlayers = d.mc.getOnlinePlayers(); } catch (e) {}
            const itemsMap = d.getItemsMap();

            const result = [];
            onlinePlayers.forEach(function(p) {
                try {
                    const inventory = [];
                    const armor = [];
                    const inv = p.getInventory();
                    const allItems = inv.getAllItems();
                    for (let s = 0; s < allItems.length; s++) {
                        const it = allItems[s];
                        if (it.type && it.type !== '' && it.type !== 'minecraft:air') {
                            const shortId = it.type.replace(/^minecraft:/, '');
                            const info = itemsMap[shortId];
                            inventory.push({
                                slot: s, type: it.type, count: it.count,
                                name: (info && info.name) ? info.name : (it.name || shortId),
                                image: (info && info.texture) ? info.texture : ''
                            });
                        }
                    }
                    try {
                        const armorContainer = p.getArmor();
                        if (armorContainer) {
                            const armorSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
                            const armorItems = armorContainer.getAllItems();
                            for (let s = 0; s < armorItems.length; s++) {
                                const it = armorItems[s];
                                if (it.type && it.type !== '' && it.type !== 'minecraft:air') {
                                    const shortId = it.type.replace(/^minecraft:/, '');
                                    const info = itemsMap[shortId];
                                    armor.push({
                                        slot: armorSlots[s] || s, type: it.type, count: it.count,
                                        name: (info && info.name) ? info.name : (it.name || shortId),
                                        image: (info && info.texture) ? info.texture : ''
                                    });
                                }
                            }
                        }
                    } catch (e) {}
                    const offhand = [];
                    try {
                        const offhandItem = p.getOffHand();
                        if (offhandItem && offhandItem.type && offhandItem.type !== '' && offhandItem.type !== 'minecraft:air') {
                            const shortId = offhandItem.type.replace(/^minecraft:/, '');
                            const info = itemsMap[shortId];
                            offhand.push({
                                slot: 0, type: offhandItem.type, count: offhandItem.count,
                                name: (info && info.name) ? info.name : (offhandItem.name || shortId),
                                image: (info && info.texture) ? info.texture : ''
                            });
                        }
                    } catch (e) {}
                    result.push({ xuid: p.xuid, name: p.name, inventory: inventory, armor: armor, offhand: offhand });
                } catch (e) {}
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取在线背包数据失败: ' + e.message });
        }
    });

    // 使指定在线玩家客户端崩溃
    router.post('/players/crash', d.adminAuth, function(req, res) {
        try {
            const identifier = (req.body.identifier || '').trim();
            if (!identifier) return res.status(400).json({ code: 400, msg: '缺少identifier参数（玩家名或XUID）' });

            let target = null;
            try { target = d.mc.getPlayer(identifier); } catch (e) {}
            if (!target) {
                const onlinePlayers = d.mc.getOnlinePlayers();
                for (let i = 0; i < onlinePlayers.length; i++) {
                    if (onlinePlayers[i].name === identifier) { target = onlinePlayers[i]; break; }
                }
            }
            if (!target) return res.status(404).json({ code: 404, msg: '玩家不在线' });

            const success = target.crash();
            if (success) {
                d.adminLog.log(req.user.uid, '崩溃玩家客户端', target.name, 'XUID:' + target.xuid);
                res.json({ code: 200, msg: '已执行', data: { name: target.name, xuid: target.xuid } });
            } else {
                res.status(500).json({ code: 500, msg: '执行失败' });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '操作失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
