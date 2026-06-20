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
 * NECE 服务器监控模块
 * TPS、全服余额、经济排行、系统资源监控
 */


const D = require('./debug');
const os = require('os');
const fs = require('fs');
const pathModule = require('path');

// ============ 游戏统计 ============

let tpsDataRef = null;   // TPS数据引用，由index.js传入
let moneyRef = null;     // 经济模块引用，提供get(xuid)接口
let playerDataRef = null; // 玩家数据引用（内存中的 playerData 对象）
let databaseRef = null;  // 数据库模块引用，用于人数统计持久化

// 全服总资金缓存，避免频繁遍历所有玩家
const allMoneyCache = {
    totalMoney: 0,
    playerCount: 0,
    timestamp: 0
};
const ALL_MONEY_CACHE_TTL = 30000; // 缓存有效期30秒

// 经济排行缓存，包含余额排行和银行存款排行
const economyRankCache = {
    topBalances: [],
    fullBalanceList: [],   // 完整余额排行缓存（供 /players/rank/balance 使用）
    totalBankCurrent: 0,
    totalBankFixed: 0,
    totalBankAll: 0,
    topBankDeposits: [],
    timestamp: 0
};
const ECONOMY_RANK_CACHE_TTL = 300000; // 缓存有效期5分钟

/**
 * 初始化监控模块，注入外部依赖
 * @param {Object} tpsData - TPS数据对象，包含tps属性
 * @param {Object} money - 经济模块，需提供get(xuid)方法
 * @param {Object} pd - 玩家数据对象（内存中的 playerData）
 * @param {Object} db - 数据库模块，需提供insertPlayerCount/getPlayerCountHistory/getPlayerCountLatest方法
 */
function init(tpsData, money, pd, db) {
    D.debugLogModule('monitoring')('init: 初始化完成');
    tpsDataRef = tpsData;
    moneyRef = money;
    playerDataRef = pd;
    databaseRef = db;
}

/**
 * 获取当前服务器TPS
 * @returns {{tps: string}} TPS值，未初始化时默认返回'20.00'
 */
function getTps() {
    if (!tpsDataRef) return { tps: '20.00' };
    return {
        tps: tpsDataRef.tps || '20.00'
    };
}

/**
 * 获取全服玩家总资金，带30秒缓存
 * @returns {{totalMoney: number, playerCount: number, cached: boolean}}
 */
function getAllMoney() {
    const now = Date.now();
    // 缓存未过期时直接返回
    if (now - allMoneyCache.timestamp < ALL_MONEY_CACHE_TTL) {
        return {
            totalMoney: allMoneyCache.totalMoney,
            playerCount: allMoneyCache.playerCount,
            cached: true
        };
    }

    let total = 0;
    let count = 0;

    if (!moneyRef || typeof moneyRef.get !== 'function') {
        return { totalMoney: 0, playerCount: 0, cached: false };
    }

    // 遍历所有已记录的玩家XUID，累加余额
    if (playerDataRef && playerDataRef.players) {
        const players = playerDataRef.players;
        const xuids = Object.keys(players);
        for (let i = 0; i < xuids.length; i++) {
            try {
                const bal = moneyRef.get(xuids[i]);
                if (typeof bal === 'number' && !isNaN(bal)) {
                    total += bal;
                    count++;
                }
            } catch (e) { logger.warn('[Monitoring] ' + e.message); }
        }
    }

    // 更新缓存
    allMoneyCache.totalMoney = total;
    allMoneyCache.playerCount = count;
    allMoneyCache.timestamp = now;

    return { totalMoney: total, playerCount: count, cached: false };
}

/**
 * 获取经济排行数据（余额Top5 + 银行存款Top5 + 全服银行统计），带5分钟缓存
 * @returns {Object} 包含topBalances、totalBankCurrent/Fixed/All、topBankDeposits等字段
 */
function getEconomyRank() {
    const now = Date.now();
    if (now - economyRankCache.timestamp < ECONOMY_RANK_CACHE_TTL) {
        return Object.assign({}, economyRankCache, { cached: true });
    }

    if (!playerDataRef || !playerDataRef.players) {
        return { topBalances: [], totalBankCurrent: 0, totalBankFixed: 0, totalBankAll: 0, topBankDeposits: [], cached: false };
    }

    const players = playerDataRef.players;
    const xuids = Object.keys(players);
    const balanceList = [];
    const bankDepositList = [];
    let totalBankCurrent = 0;
    let totalBankFixed = 0;

    for (let i = 0; i < xuids.length; i++) {
        const xuid = xuids[i];
        const p = players[xuid];
        const name = p.name || '';

        // 获取玩家余额
        let bal = 0;
        if (moneyRef && typeof moneyRef.get === 'function') {
            try { bal = moneyRef.get(xuid) || 0; } catch (e) { logger.warn('[Monitoring] ' + e.message); }
        }
        if (typeof bal === 'number' && !isNaN(bal)) {
            balanceList.push({ name: name, xuid: xuid, balance: bal });
        }

        // 累计银行存款
        if (p.bankdata) {
            const currentBalance = (p.bankdata.current && typeof p.bankdata.current.balance === 'number') ? p.bankdata.current.balance : 0;
            totalBankCurrent += currentBalance;

            let playerFixedTotal = 0;
            if (Array.isArray(p.bankdata.fixed)) {
                for (let j = 0; j < p.bankdata.fixed.length; j++) {
                    const dep = p.bankdata.fixed[j];
                    // 只统计状态为active的定期存款本金
                    if (dep.status === 'active' && typeof dep.principal === 'number') {
                        playerFixedTotal += dep.principal;
                    }
                }
            }
            totalBankFixed += playerFixedTotal;

            const playerBankTotal = currentBalance + playerFixedTotal;
            if (playerBankTotal > 0) {
                bankDepositList.push({ name: name, xuid: xuid, bankTotal: playerBankTotal, current: currentBalance, fixed: playerFixedTotal });
            }
        }
    }

    // 按金额降序排列
    balanceList.sort(function(a, b) { return b.balance - a.balance; });
    bankDepositList.sort(function(a, b) { return b.bankTotal - a.bankTotal; });

    const topBalances = balanceList.slice(0, 5).map(function(item) {
        return { name: item.name, balance: item.balance };
    });

    const topBankDeposits = bankDepositList.slice(0, 5).map(function(item) {
        return { name: item.name, bankTotal: item.bankTotal, current: item.current, fixed: item.fixed };
    });

    // 更新缓存
    economyRankCache.topBalances = topBalances;
    economyRankCache.fullBalanceList = balanceList;
    economyRankCache.totalBankCurrent = totalBankCurrent;
    economyRankCache.totalBankFixed = totalBankFixed;
    economyRankCache.totalBankAll = totalBankCurrent + totalBankFixed;
    economyRankCache.topBankDeposits = topBankDeposits;
    economyRankCache.timestamp = now;

    return Object.assign({}, economyRankCache, { cached: false });
}

// ============ 玩家人数统计 ============

let playerCountTimer = null;

/**
 * 启动玩家人数定时采样
 * @param {number} interval - 采样间隔（毫秒），默认600000（10分钟）
 */
function startPlayerCountSampling(interval) {
    stopPlayerCountSampling();
    interval = interval || 600000;
    if (interval < 60000) interval = 60000; // 最小1分钟

    // 首次立即采样
    samplePlayerCount();

    playerCountTimer = setInterval(function() {
        samplePlayerCount();
    }, interval);

    D.debugLogModule('monitoring')('startPlayerCountSampling: 启动，间隔=' + interval + 'ms');
}

/** 停止玩家人数采样 */
function stopPlayerCountSampling() {
    if (playerCountTimer) {
        clearInterval(playerCountTimer);
        playerCountTimer = null;
    }
}

/** 采样当前在线玩家人数并写入数据库 */
function samplePlayerCount() {
    try {
        var count = 0;
        if (typeof mc !== 'undefined' && mc.getOnlinePlayers) {
            var players = mc.getOnlinePlayers();
            count = players ? players.length : 0;
        }
        var timestamp = Math.floor(Date.now() / 1000);
        if (databaseRef && typeof databaseRef.insertPlayerCount === 'function') {
            databaseRef.insertPlayerCount(timestamp, count);
        }
    } catch (e) {
        logger.warn('[Monitor] 玩家人数采样失败: ' + e.message);
    }
}

/**
 * 查询玩家人数趋势数据
 * @param {number} startTime - 起始时间戳（秒）
 * @param {number} endTime - 结束时间戳（秒）
 * @returns {Array} 记录数组 [{timestamp, count}]
 */
function getPlayerCountTrend(startTime, endTime) {
    if (!databaseRef || typeof databaseRef.getPlayerCountHistory !== 'function') return [];
    return databaseRef.getPlayerCountHistory(startTime, endTime);
}

/**
 * 获取玩家人数统计摘要
 * @returns {{current: number, todayMax: number, todayAvg: number, todayRecords: number}}
 */
function getPlayerCountStats() {
    var result = { current: 0, todayMax: 0, todayAvg: 0, todayRecords: 0 };

    // 当前在线人数
    try {
        if (typeof mc !== 'undefined' && mc.getOnlinePlayers) {
            var players = mc.getOnlinePlayers();
            result.current = players ? players.length : 0;
        }
    } catch (e) {}

    // 今日数据
    try {
        if (databaseRef && typeof databaseRef.getPlayerCountHistory === 'function') {
            var now = Math.floor(Date.now() / 1000);
            var todayStart = now - (now % 86400); // 今日0点UTC时间戳
            // 如果UTC 0点在8小时前，使用本地时间0点
            var localNow = new Date();
            localNow.setHours(0, 0, 0, 0);
            todayStart = Math.floor(localNow.getTime() / 1000);

            var records = databaseRef.getPlayerCountHistory(todayStart, now);
            if (records && records.length > 0) {
                var max = 0;
                var sum = 0;
                for (var i = 0; i < records.length; i++) {
                    var c = records[i].count;
                    if (c > max) max = c;
                    sum += c;
                }
                result.todayMax = max;
                result.todayAvg = Math.round((sum / records.length) * 10) / 10;
                result.todayRecords = records.length;
            }
        }
    } catch (e) {}

    return result;
}

// ============ 系统资源监控 ============

// 静态系统信息，运行期间不会变化，只读取一次
const STATIC_SYSINFO = {
    cores: os.cpus().length,
    model: os.cpus()[0] ? os.cpus()[0].model : 'Unknown',
    platform: os.platform(),
    hostname: os.hostname()
};

// 系统资源缓存，通过定时轮询更新
const cachedStats = {
    cpu: { usage: 0, cores: STATIC_SYSINFO.cores, model: STATIC_SYSINFO.model, perCore: [] },
    memory: { total: 0, used: 0, free: 0, usagePercent: 0 },
    network: { totalDownload: 0, totalUpload: 0, downloadThroughput: 0, uploadThroughput: 0 },
    disk: { total: 0, used: 0, free: 0, usagePercent: 0 },
    worldSize: 0,
    uptime: os.uptime(),
    platform: STATIC_SYSINFO.platform,
    hostname: STATIC_SYSINFO.hostname
};

let cachedCpuUsage = 0;         // 缓存的总体CPU使用率
let cachedPerCoreUsage = [];    // 缓存的每核CPU使用率
let cpuPollTimer = null;
let memPollTimer = null;
let diskPollTimer = null;
let worldSizePollTimer = null;

// CPU 采样状态（os.cpus 差值计算）
var _prevCpuTimes = null;

/**
 * 使用 os.cpus() 采样CPU使用率（含每核数据）
 * 通过对比两次采样的时间差计算利用率
 */
function sampleCpu() {
    var cpus = os.cpus();
    if (!cpus || cpus.length === 0) return;

    var prevTimes = _prevCpuTimes;
    _prevCpuTimes = cpus.map(function(c) { return c.times; });

    if (!prevTimes || prevTimes.length !== cpus.length) return;

    var totalDelta = 0;
    var idleDelta = 0;
    var perCore = [];

    for (var i = 0; i < cpus.length; i++) {
        var cur = cpus[i].times;
        var prev = prevTimes[i];
        var dUser = cur.user - prev.user;
        var dNice = cur.nice - prev.nice;
        var dSys = cur.sys - prev.sys;
        var dIdle = cur.idle - prev.idle;
        var dIrq = cur.irq - prev.irq;
        var dTotal = dUser + dNice + dSys + dIdle + dIrq;
        if (dTotal > 0) {
            perCore.push(Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10);
            totalDelta += dTotal;
            idleDelta += dIdle;
        } else {
            perCore.push(0);
        }
    }

    cachedCpuUsage = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10 : 0;
    cachedPerCoreUsage = perCore;
}

/**
 * 获取内存使用情况（单位GB）
 * @returns {{total: number, used: number, free: number, usagePercent: number}}
 */
function getMemoryInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
        total: totalMem / (1024 * 1024 * 1024),
        used: usedMem / (1024 * 1024 * 1024),
        free: freeMem / (1024 * 1024 * 1024),
        usagePercent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0
    };
}

// 网络吞吐量手动计算状态
var _prevNetBytes = null;
var _prevNetTime = null;

/**
 * 使用 netstat -e 采集网络累计收发字节，手动计算吞吐量
 */
function collectNetworkInfo() {
    try {
        var { execSync } = require('child_process');
        var out = execSync('netstat -e', { encoding: 'utf-8', timeout: 3000 });
        var lines = out.trim().split(/\r?\n/);

        // 找到包含两个纯数字的行（字节数行）
        var totalReceived = 0;
        var totalSent = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            // 匹配 "字节  123456  789012" 或 "Bytes  123456  789012"
            var match = line.match(/(\d+)\s+(\d+)\s*$/);
            if (match) {
                totalReceived = parseInt(match[1]);
                totalSent = parseInt(match[2]);
                break;
            }
        }

        if (totalReceived === 0 && totalSent === 0) return;

        var now = Date.now();
        var downSpeed = 0;
        var upSpeed = 0;

        if (_prevNetBytes && _prevNetTime) {
            var elapsed = (now - _prevNetTime) / 1000;
            if (elapsed > 0 && totalReceived >= _prevNetBytes.rx) {
                downSpeed = (totalReceived - _prevNetBytes.rx) / elapsed;
                upSpeed = (totalSent - _prevNetBytes.tx) / elapsed;
            }
        }

        _prevNetBytes = { rx: totalReceived, tx: totalSent };
        _prevNetTime = now;

        cachedStats.network = {
            totalDownload: totalReceived / (1024 * 1024 * 1024),
            totalUpload: totalSent / (1024 * 1024 * 1024),
            downloadThroughput: (downSpeed * 8) / (1024 * 1024),
            uploadThroughput: (upSpeed * 8) / (1024 * 1024)
        };
    } catch (e) {}
}

/**
 * 采集磁盘使用情况，使用 Node.js 内置 fs.statfsSync
 */
function collectDiskInfo() {
    try {
        var stats = fs.statfsSync(process.cwd());
        var total = stats.blocks * stats.bsize;
        var free = stats.bavail * stats.bsize;
        var used = total - free;
        if (total > 0) {
            cachedStats.disk = {
                total: total / (1024 * 1024 * 1024),
                used: used / (1024 * 1024 * 1024),
                free: free / (1024 * 1024 * 1024),
                usagePercent: Math.round((used / total) * 1000) / 10
            };
        }
    } catch (e) {}
}

/**
 * 递归计算世界存档目录总大小（单位GB）
 * 使用BFS分批处理目录遍历，每批50个目录后通过setImmediate让出事件循环
 * @returns {Promise<number>} 世界大小（GB）
 */
function getWorldSize() {
    return new Promise(function(resolve) {
        const worldPath = pathModule.join(process.cwd(), 'worlds', 'Bedrock level');
        if (!fs.existsSync(worldPath)) { resolve(0); return; }

        let totalSize = 0;
        const queue = [worldPath];

        function processBatch() {
            let batchCount = 0;
            // 每批处理最多50个目录，避免阻塞事件循环
            while (queue.length > 0 && batchCount < 50) {
                const dirPath = queue.shift();
                try {
                    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                    for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];
                        const fullPath = pathModule.join(dirPath, entry.name);
                        if (entry.isDirectory()) {
                            queue.push(fullPath);
                        } else if (entry.isFile()) {
                            try {
                                const stats = fs.statSync(fullPath);
                                totalSize += stats.size;
                            } catch (e) { logger.warn('[Monitor] 获取文件大小失败: ' + e.message); }
                        }
                    }
                } catch (e) { logger.warn('[Monitor] 读取目录失败: ' + e.message); }
                batchCount++;
            }

            if (queue.length > 0) {
                setImmediate(processBatch); // 让出事件循环，避免长时间阻塞
            } else {
                resolve(totalSize / (1024 * 1024 * 1024));
            }
        }

        processBatch();
    });
}

/** 更新缓存中的世界大小 */
async function updateWorldSize() {
    try {
        cachedStats.worldSize = await getWorldSize();
    } catch (e) { logger.warn('[Monitor] 更新世界大小失败: ' + e.message); }
}

/** CPU轮询回调：采样CPU并更新缓存中的系统基本信息 */
function cpuPoll() {
    sampleCpu();
    cachedStats.cpu = {
        usage: cachedCpuUsage,
        cores: STATIC_SYSINFO.cores,
        model: STATIC_SYSINFO.model,
        perCore: { cores: STATIC_SYSINFO.cores, usage: cachedPerCoreUsage }
    };
    cachedStats.uptime = os.uptime();
}

/** 内存轮询回调 */
function memPoll() {
    cachedStats.memory = getMemoryInfo();
}

/** 磁盘和网络轮询回调 */
function diskPoll() {
    collectNetworkInfo();
    collectDiskInfo();
}

/**
 * 启动系统资源采集，首次立即采集一次
 * 之后由 refreshStats() 按需采集（API 请求触发）
 */
function startPolling(interval) {
    stopPolling();
    // 首次采集一次，之后由 API 请求触发 refreshStats 按需采集
    cpuPoll();
    memPoll();
    diskPoll();
    updateWorldSize().catch(function(e) {});
}

/** 停止所有定时轮询 */
function stopPolling() {
    if (cpuPollTimer) { clearInterval(cpuPollTimer); cpuPollTimer = null; }
    if (memPollTimer) { clearInterval(memPollTimer); memPollTimer = null; }
    if (diskPollTimer) { clearInterval(diskPollTimer); diskPollTimer = null; }
    if (worldSizePollTimer) { clearInterval(worldSizePollTimer); worldSizePollTimer = null; }
}

// ============ 按需刷新 ============

let lastOnDemandRefresh = 0;
let lastDiskNetworkPoll = 0;
let lastWorldSizePoll = 0;
const ON_DEMAND_CACHE_TTL = 1000;       // CPU/内存缓存1秒
const DISK_NETWORK_POLL_INTERVAL = 1000;  // 磁盘/网络采集间隔1秒
const WORLD_SIZE_POLL_INTERVAL = 3600000; // 世界大小每小时更新一次

/**
 * 按需刷新系统数据，调用前先检查缓存
 * 由 /system/stats 端点调用，避免持续轮询消耗性能
 */
function refreshStats() {
    var now = Date.now();

    // CPU + 内存：采集，1秒缓存跳过
    if (now - lastOnDemandRefresh > ON_DEMAND_CACHE_TTL) {
        cpuPoll();
        memPoll();
        lastOnDemandRefresh = now;
    }

    // 网络+磁盘：1秒节流
    if (now - lastDiskNetworkPoll > DISK_NETWORK_POLL_INTERVAL) {
        lastDiskNetworkPoll = now;
        collectNetworkInfo();
        collectDiskInfo();
    }

    // 世界大小：异步采集，1小时节流
    if (now - lastWorldSizePoll > WORLD_SIZE_POLL_INTERVAL) {
        lastWorldSizePoll = now;
        updateWorldSize().catch(function(e) {});
    }
}

/**
 * 获取当前系统资源快照
 * @returns {Object} 包含cpu、memory、network、disk、worldSize、uptime等字段
 */
function getSystemStats() {
    return {
        cpu: cachedStats.cpu,
        memory: cachedStats.memory,
        network: cachedStats.network,
        disk: cachedStats.disk,
        worldSize: cachedStats.worldSize,
        uptime: cachedStats.uptime,
        platform: cachedStats.platform,
        hostname: cachedStats.hostname
    };
}

/**
 * 获取完整余额排行（复用 getEconomyRank 的缓存，5分钟TTL）
 * @param {string} order - 'asc' 或 'desc'
 * @returns {Array} 排序后的 [{xuid, name, balance}]
 */
function getFullBalanceRank(order) {
    const now = Date.now();
    if (now - economyRankCache.timestamp >= ECONOMY_RANK_CACHE_TTL) {
        getEconomyRank(); // 触发刷新
    }
    var list = economyRankCache.fullBalanceList || [];
    if (order === 'asc') {
        list = list.slice().sort(function(a, b) { return a.balance - b.balance; });
    }
    // 默认已是降序
    return list;
}

module.exports = {
    // 游戏统计
    init: init,
    getTps: getTps,
    getAllMoney: getAllMoney,
    getEconomyRank: getEconomyRank,
    getFullBalanceRank: getFullBalanceRank,
    // 玩家人数统计
    startPlayerCountSampling: startPlayerCountSampling,
    stopPlayerCountSampling: stopPlayerCountSampling,
    getPlayerCountTrend: getPlayerCountTrend,
    getPlayerCountStats: getPlayerCountStats,
    // 系统监控
    startPolling: startPolling,
    stopPolling: stopPolling,
    refreshStats: refreshStats,
    getSystemStats: getSystemStats,
    getMemoryInfo: getMemoryInfo,
    getWorldSize: getWorldSize,
    updateWorldSize: updateWorldSize
};
