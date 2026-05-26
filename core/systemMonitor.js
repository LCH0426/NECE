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
 * NLCE 系统资源监控
 * 监控CPU、内存、磁盘等服务器硬件资源使用情况
 */


const os = require('os');
const fs = require('fs');
const pathModule = require('path');
const si = require('systeminformation');

var cachedStats = {
    cpu: { usage: 0, cores: os.cpus().length, model: os.cpus()[0] ? os.cpus()[0].model : 'Unknown', perCore: [] },
    memory: { total: 0, used: 0, free: 0, usagePercent: 0 },
    network: { totalDownload: 0, totalUpload: 0, downloadThroughput: 0, uploadThroughput: 0 },
    disk: { total: 0, used: 0, free: 0, usagePercent: 0 },
    worldSize: 0,
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname()
};

var lastCpuSample = null;
var lastCpuSampleTime = null;
var cachedCpuUsage = 0;
var cachedPerCoreUsage = [];
var cpuPollTimer = null;
var memPollTimer = null;
var diskPollTimer = null;
var worldSizePollTimer = null;

function sampleCpu() {
    var cpus = os.cpus();
    var totalIdle = 0;
    var totalTick = 0;

    for (var i = 0; i < cpus.length; i++) {
        var cpu = cpus[i].times;
        for (var type in cpu) {
            totalTick += cpu[type];
        }
        totalIdle += cpu.idle;
    }

    var now = Date.now();

    if (lastCpuSample !== null && lastCpuSampleTime !== null) {
        var idleDiff = totalIdle - lastCpuSample.idle;
        var tickDiff = totalTick - lastCpuSample.tick;
        if (tickDiff > 0) {
            cachedCpuUsage = (1 - idleDiff / tickDiff) * 100;
            cachedCpuUsage = Math.min(100, Math.max(0, cachedCpuUsage));
        }

        if (lastCpuSample.perCore) {
            cachedPerCoreUsage = [];
            for (var i = 0; i < cpus.length; i++) {
                var cpuTimes = cpus[i].times;
                var coreTick = 0;
                for (var type in cpuTimes) {
                    coreTick += cpuTimes[type];
                }
                var coreIdle = cpuTimes.idle;
                var prevCore = lastCpuSample.perCore[i];
                if (prevCore) {
                    var coreTickDiff = coreTick - prevCore.tick;
                    var coreIdleDiff = coreIdle - prevCore.idle;
                    var coreUsage = coreTickDiff > 0 ? (1 - coreIdleDiff / coreTickDiff) * 100 : 0;
                    cachedPerCoreUsage.push({
                        core: i,
                        speed: cpus[i].speed,
                        usage: Math.min(100, Math.max(0, coreUsage))
                    });
                }
            }
        }
    }

    var perCore = [];
    for (var i = 0; i < cpus.length; i++) {
        var cpuTimes = cpus[i].times;
        var coreTick = 0;
        for (var type in cpuTimes) {
            coreTick += cpuTimes[type];
        }
        perCore.push({ idle: cpuTimes.idle, tick: coreTick });
    }

    lastCpuSample = { idle: totalIdle, tick: totalTick, perCore: perCore };
    lastCpuSampleTime = now;
}

function getMemoryInfo() {
    var totalMem = os.totalmem();
    var freeMem = os.freemem();
    var usedMem = totalMem - freeMem;

    return {
        total: totalMem / (1024 * 1024 * 1024),
        used: usedMem / (1024 * 1024 * 1024),
        free: freeMem / (1024 * 1024 * 1024),
        usagePercent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0
    };
}

async function collectNetworkInfo() {
    try {
        var stats = await si.networkStats();
        if (!stats || stats.length === 0) return;

        var totalReceived = 0;
        var totalSent = 0;
        var currentDownSpeed = 0;
        var currentUpSpeed = 0;

        for (var i = 0; i < stats.length; i++) {
            var s = stats[i];
            if (s.iface && (s.iface.startsWith('Loopback') || s.iface === 'lo')) continue;
            totalReceived += s.rx_bytes || 0;
            totalSent += s.tx_bytes || 0;
            currentDownSpeed += s.rx_sec || 0;
            currentUpSpeed += s.tx_sec || 0;
        }

        cachedStats.network = {
            totalDownload: totalReceived / (1024 * 1024 * 1024),
            totalUpload: totalSent / (1024 * 1024 * 1024),
            downloadThroughput: (currentDownSpeed * 8) / (1024 * 1024),
            uploadThroughput: (currentUpSpeed * 8) / (1024 * 1024)
        };
    } catch (e) {}
}

async function collectDiskInfo() {
    try {
        var serverDir = process.cwd();
        var driveLetter = pathModule.parse(serverDir).root.replace('\\', '').replace(':', '');

        var disks = await si.fsSize();
        if (!disks || disks.length === 0) return;

        for (var i = 0; i < disks.length; i++) {
            var d = disks[i];
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

        var first = disks[0];
        cachedStats.disk = {
            total: first.size / (1024 * 1024 * 1024),
            used: first.used / (1024 * 1024 * 1024),
            free: (first.size - first.used) / (1024 * 1024 * 1024),
            usagePercent: first.use || 0
        };
    } catch (e) {}
}

function getWorldSize() {
    return new Promise(function(resolve) {
        var worldPath = pathModule.join(process.cwd(), 'worlds', 'Bedrock level');
        if (!fs.existsSync(worldPath)) { resolve(0); return; }

        var totalSize = 0;
        var queue = [worldPath];

        function processBatch() {
            var batchCount = 0;
            while (queue.length > 0 && batchCount < 50) {
                var dirPath = queue.shift();
                try {
                    var entries = fs.readdirSync(dirPath, { withFileTypes: true });
                    for (var i = 0; i < entries.length; i++) {
                        var entry = entries[i];
                        var fullPath = pathModule.join(dirPath, entry.name);
                        if (entry.isDirectory()) {
                            queue.push(fullPath);
                        } else if (entry.isFile()) {
                            try {
                                var stats = fs.statSync(fullPath);
                                totalSize += stats.size;
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
                batchCount++;
            }

            if (queue.length > 0) {
                setImmediate(processBatch);
            } else {
                resolve(totalSize / (1024 * 1024 * 1024));
            }
        }

        processBatch();
    });
}

async function updateWorldSize() {
    try {
        cachedStats.worldSize = await getWorldSize();
    } catch (e) {}
}

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

function memPoll() {
    cachedStats.memory = getMemoryInfo();
}

async function diskPoll() {
    await Promise.all([collectNetworkInfo(), collectDiskInfo()]);
}

function startPolling(interval) {
    stopPolling();

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
    }, 43200000);
}

function stopPolling() {
    if (cpuPollTimer) { clearInterval(cpuPollTimer); cpuPollTimer = null; }
    if (memPollTimer) { clearInterval(memPollTimer); memPollTimer = null; }
    if (diskPollTimer) { clearInterval(diskPollTimer); diskPollTimer = null; }
    if (worldSizePollTimer) { clearInterval(worldSizePollTimer); worldSizePollTimer = null; }
}

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
    getSystemStats,
    startPolling,
    stopPolling,
    getMemoryInfo,
    getWorldSize
};
