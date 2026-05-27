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
 * NLCE 服务器监控模块
 * 游戏性能统计（TPS、全服余额、经济排行）+ 系统资源监控（CPU、内存、磁盘、网络）
 * 合并了原 serverStats 和 systemMonitor 两个模块的功能
 */


const D = require('./debug');
const os = require('os');
const fs = require('fs');
const pathModule = require('path');
const si = require('systeminformation');

// ============ 游戏统计（原 serverStats） ============

let tpsDataRef = null;   // TPS数据引用，由index.js传入
let moneyRef = null;     // 经济模块引用，提供get(xuid)接口
let playerDataRef = null; // 玩家数据引用（内存中的 playerData 对象）

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
 */
function init(tpsData, money, pd) {
    D.debugLogModule('monitoring')('init: 初始化完成');
    tpsDataRef = tpsData;
    moneyRef = money;
    playerDataRef = pd;
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

        // 累计银行存款（活期+定期）
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
    economyRankCache.totalBankCurrent = totalBankCurrent;
    economyRankCache.totalBankFixed = totalBankFixed;
    economyRankCache.totalBankAll = totalBankCurrent + totalBankFixed;
    economyRankCache.topBankDeposits = topBankDeposits;
    economyRankCache.timestamp = now;

    return Object.assign({}, economyRankCache, { cached: false });
}

// ============ 系统资源监控（原 systemMonitor） ============

// 系统资源缓存，通过定时轮询更新
const cachedStats = {
    cpu: { usage: 0, cores: os.cpus().length, model: os.cpus()[0] ? os.cpus()[0].model : 'Unknown', perCore: [] },
    memory: { total: 0, used: 0, free: 0, usagePercent: 0 },
    network: { totalDownload: 0, totalUpload: 0, downloadThroughput: 0, uploadThroughput: 0 },
    disk: { total: 0, used: 0, free: 0, usagePercent: 0 },
    worldSize: 0,
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname()
};

let lastCpuSample = null;      // 上一次CPU时间片快照
let lastCpuSampleTime = null;   // 上一次采样时间戳
let cachedCpuUsage = 0;         // 缓存的总体CPU使用率
let cachedPerCoreUsage = [];    // 缓存的每核CPU使用率
let cpuPollTimer = null;
let memPollTimer = null;
let diskPollTimer = null;
let worldSizePollTimer = null;

/**
 * 采样CPU时间片，通过差值计算使用率
 * 基于两次采样的idle/tick差值来推算CPU占用百分比
 */
function sampleCpu() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (let i = 0; i < cpus.length; i++) {
        const cpu = cpus[i].times;
        for (const type in cpu) {
            totalTick += cpu[type];
        }
        totalIdle += cpu.idle;
    }

    const now = Date.now();

    // 有历史采样数据时才计算差值
    if (lastCpuSample !== null && lastCpuSampleTime !== null) {
        const idleDiff = totalIdle - lastCpuSample.idle;
        const tickDiff = totalTick - lastCpuSample.tick;
        if (tickDiff > 0) {
            cachedCpuUsage = (1 - idleDiff / tickDiff) * 100;
            cachedCpuUsage = Math.min(100, Math.max(0, cachedCpuUsage));
        }

        // 逐核计算使用率
        if (lastCpuSample.perCore) {
            cachedPerCoreUsage = [];
            for (let i = 0; i < cpus.length; i++) {
                const cpuTimes = cpus[i].times;
                let coreTick = 0;
                for (const type in cpuTimes) {
                    coreTick += cpuTimes[type];
                }
                const coreIdle = cpuTimes.idle;
                const prevCore = lastCpuSample.perCore[i];
                if (prevCore) {
                    const coreTickDiff = coreTick - prevCore.tick;
                    const coreIdleDiff = coreIdle - prevCore.idle;
                    const coreUsage = coreTickDiff > 0 ? (1 - coreIdleDiff / coreTickDiff) * 100 : 0;
                    cachedPerCoreUsage.push({
                        core: i,
                        speed: cpus[i].speed,
                        usage: Math.min(100, Math.max(0, coreUsage))
                    });
                }
            }
        }
    }

    // 保存当前采样快供下次差值计算
    const perCore = [];
    for (let i = 0; i < cpus.length; i++) {
        const cpuTimes = cpus[i].times;
        let coreTick = 0;
        for (const type in cpuTimes) {
            coreTick += cpuTimes[type];
        }
        perCore.push({ idle: cpuTimes.idle, tick: coreTick });
    }

    lastCpuSample = { idle: totalIdle, tick: totalTick, perCore: perCore };
    lastCpuSampleTime = now;
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

/**
 * 采集网络流量统计，跳过回环接口，结果更新到cachedStats.network
 */
async function collectNetworkInfo() {
    try {
        const stats = await si.networkStats();
        if (!stats || stats.length === 0) return;

        let totalReceived = 0;
        let totalSent = 0;
        let currentDownSpeed = 0;
        let currentUpSpeed = 0;

        for (let i = 0; i < stats.length; i++) {
            const s = stats[i];
            // 跳过回环接口
            if (s.iface && (s.iface.startsWith('Loopback') || s.iface === 'lo')) continue;
            totalReceived += s.rx_bytes || 0;
            totalSent += s.tx_bytes || 0;
            currentDownSpeed += s.rx_sec || 0;
            currentUpSpeed += s.tx_sec || 0;
        }

        // 转换为GB总量和Mbps瞬时速率
        cachedStats.network = {
            totalDownload: totalReceived / (1024 * 1024 * 1024),
            totalUpload: totalSent / (1024 * 1024 * 1024),
            downloadThroughput: (currentDownSpeed * 8) / (1024 * 1024),
            uploadThroughput: (currentUpSpeed * 8) / (1024 * 1024)
        };
    } catch (e) { logger.warn('[Monitor] 获取网络信息失败: ' + e.message); }
}

/**
 * 采集磁盘使用情况，优先匹配服务器所在盘符
 */
async function collectDiskInfo() {
    try {
        const serverDir = process.cwd();
        const driveLetter = pathModule.parse(serverDir).root.replace('\\', '').replace(':', '');

        const disks = await si.fsSize();
        if (!disks || disks.length === 0) return;

        // 优先匹配服务器所在盘符
        for (let i = 0; i < disks.length; i++) {
            const d = disks[i];
            if (d.fs && d.fs.toUpperCase().indexOf(driveLetter.toUpperCase()) !== -1) {
                cachedStats.disk = {
                    total: d.size / (1024 * 1024 * 1024),
                    used: d.used / (1024 * 1024 * 1024),
                    free: (d.size - d.used) / (1024 * 1024 * 1024),
                    usagePercent: d.use || 0
                };
                return;
            }
        }

        // 盘符未匹配时回退到第一个磁盘
        const first = disks[0];
        cachedStats.disk = {
            total: first.size / (1024 * 1024 * 1024),
            used: first.used / (1024 * 1024 * 1024),
            free: (first.size - first.used) / (1024 * 1024 * 1024),
            usagePercent: first.use || 0
        };
    } catch (e) { logger.warn('[Monitor] 获取磁盘信息失败: ' + e.message); }
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
        cores: os.cpus().length,
        model: os.cpus()[0] ? os.cpus()[0].model : 'Unknown',
        perCore: cachedPerCoreUsage
    };
    cachedStats.uptime = os.uptime();
    cachedStats.platform = os.platform();
    cachedStats.hostname = os.hostname();
}

/** 内存轮询回调 */
function memPoll() {
    cachedStats.memory = getMemoryInfo();
}

/** 磁盘和网络轮询回调（并发采集） */
async function diskPoll() {
    await Promise.all([collectNetworkInfo(), collectDiskInfo()]);
}

/**
 * 启动系统资源定时轮询
 * CPU每秒采样、内存/磁盘每10秒、世界大小每12小时
 */
function startPolling(interval) {
    stopPolling();

    // 首次立即采集一次
    sampleCpu();
    cpuPoll();
    memPoll();
    diskPoll();
    updateWorldSize();

    cpuPollTimer = setInterval(cpuPoll, 1000);
    memPollTimer = setInterval(memPoll, 10000);
    diskPollTimer = setInterval(function() {
        diskPoll().catch(function(e) {});
    }, 10000);
    worldSizePollTimer = setInterval(function() {
        updateWorldSize().catch(function(e) {});
    }, 43200000); // 12小时
}

/** 停止所有定时轮询 */
function stopPolling() {
    if (cpuPollTimer) { clearInterval(cpuPollTimer); cpuPollTimer = null; }
    if (memPollTimer) { clearInterval(memPollTimer); memPollTimer = null; }
    if (diskPollTimer) { clearInterval(diskPollTimer); diskPollTimer = null; }
    if (worldSizePollTimer) { clearInterval(worldSizePollTimer); worldSizePollTimer = null; }
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

module.exports = {
    // 游戏统计（原 serverStats）
    init: init,
    getTps: getTps,
    getAllMoney: getAllMoney,
    getEconomyRank: getEconomyRank,
    // 系统监控（原 systemMonitor）
    startPolling: startPolling,
    stopPolling: stopPolling,
    getSystemStats: getSystemStats,
    getMemoryInfo: getMemoryInfo,
    getWorldSize: getWorldSize
};
