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
 * NECE 每日游戏时长统计API
 * GitHub contributions 风格热力图数据
 */

const logStore = require('../logStore');

const DAYS_IN_YEAR = 365;

// 时长档位区间边界，单位秒，0为空，(0,1h]档1、(1h,2h]档2、(2h,3h]档3、(3h,6h]档4、6h以上档5
const LEVEL_BOUNDS = [3600, 7200, 10800, 21600];

function formatDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calcLevel(seconds) {
    if (seconds <= 0) return 0;
    for (var i = 0; i < LEVEL_BOUNDS.length; i++) {
        if (seconds <= LEVEL_BOUNDS[i]) return i + 1;
    }
    return 5;
}

// ==================== 路由 ====================

function registerRoutes(router, d) {
    var database = d.database;
    var auth = d.auth;
    var adminAuth = d.adminAuth;

    // 解析目标玩家：管理员可传 name/xuid 查他人，否则查自己
    function resolveTargetXuid(req) {
        var queryName = (req.query.name || '').toString().trim();
        var queryXuid = (req.query.xuid || '').toString().trim();
        if (queryName || queryXuid) {
            if (!database.isAdmin(req.user.uid)) return { error: 403, msg: '仅管理员可查询其他玩家' };
            if (queryXuid) return { xuid: queryXuid };
            var pd = d.getPlayerData();
            if (pd && pd.players) {
                var keys = Object.keys(pd.players);
                for (var i = 0; i < keys.length; i++) {
                    if (pd.players[keys[i]].name === queryName) return { xuid: keys[i] };
                }
            }
            return { error: 404, msg: '玩家不存在' };
        }
        var self = d.getXuidByUid(req.user.uid);
        if (!self) return { error: 404, msg: '当前账号未绑定游戏玩家' };
        return { xuid: self };
    }

    function buildHeatmapData(targetXuid) {
        var days = [];
        var now = new Date();
        for (var j = DAYS_IN_YEAR - 1; j >= 0; j--) {
            days.push(formatDate(new Date(now.getTime() - j * 86400000)));
        }
        var playMap = database.getPlayTimeRangeSQL(targetXuid, days[0], days[days.length - 1]);
        var totalPlayTime = 0;
        var playerRow = database.getPlayerDataSQL(targetXuid);
        if (playerRow && playerRow.count && typeof playerRow.count.playTime === 'number') {
            totalPlayTime = playerRow.count.playTime;
        }
        var activeDays = 0;
        var result = days.map(function(date) {
            var sec = playMap[date] || 0;
            if (sec > 0) activeDays++;
            return { date: date, seconds: sec, level: calcLevel(sec) };
        });
        return {
            playerName: d.getPlayerName(targetXuid),
            totalPlayTime: totalPlayTime,
            activeDays: activeDays,
            registerTime: playerRow ? playerRow.registerTime : '',
            leavetime: playerRow ? playerRow.leavetime : '',
            days: result
        };
    }

    /**
     * GET /playtime/heatmap
     * 查询最近一年每日游戏时长，name/xuid 参数仅管理员
     */
    router.get('/playtime/heatmap', auth, function(req, res) {
        try {
            var target = resolveTargetXuid(req);
            if (target.error) return res.status(target.error).json({ code: target.error, msg: target.msg });
            var data = buildHeatmapData(target.xuid);
            data.xuid = target.xuid;
            return res.json({ code: 200, data: data });
        } catch (e) {
            return res.status(500).json({ code: 500, msg: '查询游戏时长失败: ' + e.message });
        }
    });

    // ==================== 随机分配 ====================

    var DAY_CAP = 28800; // 每天上限8小时

    // 解析日期字符串，支持时间戳与 YYYY-MM-DD 等格式
    function parseDateStr(s) {
        if (!s) return null;
        if (/^\d+$/.test(String(s).trim())) {
            var n = parseInt(s, 10);
            if (n > 1e12) return new Date(n);
            if (n > 1e9) return new Date(n * 1000);
            return null;
        }
        var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(String(s).trim());
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }

    function toDateStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // 寒暑假：2-3月、7-8月整月
    function isVacation(d) {
        var m = d.getMonth() + 1;
        return m === 2 || m === 3 || m === 7 || m === 8;
    }

    // 加权不放回抽样
    function pickWeighted(pool, n) {
        var picked = [];
        var arr = pool.slice();
        while (picked.length < n && arr.length > 0) {
            var wsum = 0;
            for (var i = 0; i < arr.length; i++) wsum += arr[i].w;
            var r = Math.random() * wsum;
            var acc = 0;
            var idx = arr.length - 1;
            for (var j = 0; j < arr.length; j++) {
                acc += arr[j].w;
                if (r <= acc) { idx = j; break; }
            }
            picked.push(arr[idx]);
            arr.splice(idx, 1);
        }
        return picked;
    }

    // 随机分配总时长到空闲天数，寒暑假不分周末权重
    function randomAssign(xuid, end) {
        var pData = database.getPlayerDataSQL(xuid);
        if (!pData) return { error: '玩家数据不存在' };
        var reg = parseDateStr(pData.registerTime);
        if (!reg) return { error: '未找到玩家注册时间' };
        var start = new Date(reg.getFullYear(), reg.getMonth(), reg.getDate());
        var endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        if (endDay < start) return { error: '结束时间早于注册时间' };
        var total = pData.count && typeof pData.count.playTime === 'number' ? Math.floor(pData.count.playTime) : 0;
        if (total <= 0) return { error: '该玩家无游戏时长可分配' };

        var existed = database.getPlayTimeRangeSQL(xuid, toDateStr(start), toDateStr(endDay));
        var slots = [];
        for (var dt = new Date(start); dt <= endDay; dt.setDate(dt.getDate() + 1)) {
            var ds = toDateStr(dt);
            if (existed[ds]) continue;
            var wd = dt.getDay();
            var weekend = (wd === 0 || wd === 6);
            var w = (!isVacation(dt) && weekend) ? 3 : 1;
            slots.push({ date: ds, w: w, assigned: 0 });
        }
        if (slots.length === 0) return { error: '时间范围内无空闲天数' };
        if (total > slots.length * DAY_CAP) return { error: '总游戏时长超出空闲天数容量，无法完成分配' };

        // 期望活跃天数：约每2小时一个活跃日，随机波动后取整收拢
        var expectDays = Math.round(total / 7200 * (0.6 + Math.random() * 0.8));
        var nd = Math.max(1, Math.min(expectDays, slots.length));
        // 按权重随机选出活跃天数
        var targets = pickWeighted(slots, nd);
        // 每个活跃日随机个性化上限 0.5~8 小时，形成高峰低谷
        targets.forEach(function(t) { t.cap = Math.round(1800 + Math.random() * 27000); });

        var remaining = total;
        var active = targets.slice();
        // 按权重动态配额加随机扰动，单日累积不超8小时，总量不超剩余
        while (remaining > 0 && active.length > 0) {
            var wsum = 0;
            for (var i = 0; i < active.length; i++) wsum += active[i].w;
            var next = [];
            for (var k = 0; k < active.length; k++) {
                var s = active[k];
                var quota = Math.floor(remaining * s.w / wsum);
                if (quota <= 0) continue;
                var noise = 0.7 + Math.random() * 0.6;
                var target = Math.min(Math.floor(quota * noise), (s.cap || DAY_CAP) - s.assigned, remaining);
                if (target <= 0) continue;
                s.assigned += target;
                remaining -= target;
                if (s.assigned < (s.cap || DAY_CAP) && remaining > 0) next.push(s);
            }
            active = next;
        }
        // 选中天数容量不够时，从全部空格兜底补齐
        if (remaining > 0) {
            for (var j = 0; j < slots.length && remaining > 0; j++) {
                var sp = slots[j];
                var can = DAY_CAP - sp.assigned;
                if (can > 0) {
                    var add = Math.min(can, remaining);
                    sp.assigned += add;
                    remaining -= add;
                }
            }
        }
        if (remaining > 0) return { error: '分配失败，仍有剩余时长' };

        var assigned = 0;
        for (var q = 0; q < slots.length; q++) {
            if (slots[q].assigned > 0) {
                database.addPlayTimeSQL(xuid, slots[q].date, slots[q].assigned);
                assigned++;
            }
        }
        // 记录已分配标记
        database.setRandomAssignedSQL(xuid, Date.now().toString());
        return { assigned: assigned, totalSeconds: total };
    }

    /**
     * POST /playtime/random-assign
     * 按注册时间至结束时间随机分配总时长，body: { xuid, endType: last|now|custom, endDate? }
     */
    router.post('/playtime/random-assign', adminAuth, function(req, res) {
        try {
            var xuid = (req.body.xuid || '').toString().trim();
            if (!xuid) return res.status(400).json({ code: 400, msg: '缺少 xuid' });
            var endType = (req.body.endType || 'last').toString();
            var pData = database.getPlayerDataSQL(xuid);
            if (!pData) return res.status(404).json({ code: 404, msg: '玩家数据不存在' });
            var end;
            if (endType === 'custom') {
                end = parseDateStr(req.body.endDate);
                if (!end) return res.status(400).json({ code: 400, msg: '自定义结束时间格式错误' });
            } else if (endType === 'now') {
                end = new Date();
            } else {
                end = parseDateStr(pData.leavetime);
                if (!end) return res.status(400).json({ code: 400, msg: '该玩家无最后登录时间，请改用当前时间或自定义' });
            }
            var result = randomAssign(xuid, end);
            if (result.error) return res.status(400).json({ code: 400, msg: result.error });
            d.logStore.append('admin.playtime_assign', { admin: req.user.uid, ip: d.getClientIp(req), target: pData.name + '(' + xuid + ')', detail: '覆盖' + result.assigned + '天，共' + result.totalSeconds + '秒' });
            return res.json({ code: 200, msg: '随机分配完成', data: result });
        } catch (e) {
            return res.status(500).json({ code: 500, msg: '随机分配失败: ' + e.message });
        }
    });

    /**
     * GET /playtime/unassigned
     * 统计尚未重新分配热力图的玩家
     */
    router.get('/playtime/unassigned', adminAuth, function(req, res) {
        try {
            var all = database.getAllPlayerDataSQL();
            var keys = Object.keys(all);
            var list = [];
            for (var i = 0; i < keys.length; i++) {
                var p = all[keys[i]];
                if (p.randomAssigned) continue;
                list.push({
                    xuid: keys[i],
                    name: p.name || keys[i],
                    uid: p.uid || 0,
                    registerTime: p.registerTime || '',
                    leavetime: p.leavetime || '',
                    playTime: (p.count && typeof p.count.playTime === 'number') ? p.count.playTime : 0
                });
            }
            return res.json({ code: 200, data: { total: list.length, players: list } });
        } catch (e) {
            return res.status(500).json({ code: 500, msg: '获取未分配玩家失败: ' + e.message });
        }
    });

    /**
     * POST /playtime/batch-random-assign
     * 批量按注册时间至结束时间随机分配总时长，body: { xuids: [], endType: last|now }
     */
    router.post('/playtime/batch-random-assign', adminAuth, function(req, res) {
        try {
            var xuids = Array.isArray(req.body.xuids) ? req.body.xuids : [];
            if (xuids.length === 0) return res.status(400).json({ code: 400, msg: '缺少待分配玩家列表' });
            var endType = (req.body.endType || 'last').toString();
            var results = [];
            var successCount = 0;
            var failCount = 0;
            for (var i = 0; i < xuids.length; i++) {
                var xuid = String(xuids[i] || '').trim();
                var name = d.getPlayerName(xuid) || xuid;
                if (!xuid) {
                    failCount++;
                    results.push({ xuid: xuid, name: name, success: false, error: 'XUID无效' });
                    continue;
                }
                var pData = database.getPlayerDataSQL(xuid);
                if (!pData) {
                    failCount++;
                    results.push({ xuid: xuid, name: name, success: false, error: '玩家数据不存在' });
                    continue;
                }
                var end;
                if (endType === 'now') {
                    end = new Date();
                } else {
                    end = parseDateStr(pData.leavetime);
                    if (!end) {
                        failCount++;
                        results.push({ xuid: xuid, name: name, success: false, error: '无最后登录时间' });
                        continue;
                    }
                }
                var result = randomAssign(xuid, end);
                if (result.error) {
                    failCount++;
                    results.push({ xuid: xuid, name: name, success: false, error: result.error });
                } else {
                    successCount++;
                    results.push({ xuid: xuid, name: name, success: true, assigned: result.assigned, totalSeconds: result.totalSeconds });
                }
            }
            logStore.append('admin.playtime_batch_assign', {
                admin: String(req.user.uid),
                ip: d.getClientIp(req),
                total: xuids.length,
                success: successCount,
                failed: failCount,
                end_type: endType
            });
            return res.json({ code: 200, data: { total: xuids.length, successCount: successCount, failCount: failCount, results: results } });
        } catch (e) {
            return res.status(500).json({ code: 500, msg: '批量分配失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };