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
 * NECE 自动备份系统
 * 定时自动备份玩家数据和配置文件，支持7z压缩、备份列表管理和恢复
 * 备份流程：save hold -> 复制世界文件到临时目录 -> 7z压缩 -> save resume -> 清理临时目录
 */


const D = require('./debug');
const fs = require('fs');
const pathModule = require('path');
const _7z = require('7zip-min');
const { copyDirSync, rmrf } = require('./utils');

let backupConfig = null;    // 备份配置（interval、compressionLevel、maxAgeDays、maxCount）
let backupDir = '';         // 备份文件存储目录
let isBackingUp = false;    // 备份进行中标记，防止并发备份
let scheduledTimer = null;  // 定时备份的interval句柄

/**
 * 初始化备份模块，创建备份目录并启动定时备份
 * @param {Object} cfg - 备份配置对象
 */
function init(cfg) {
    D.debugLogModule('backup')('init: 初始化完成');
    backupConfig = cfg || {};
    backupDir = pathModule.resolve(process.cwd(), 'backup');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    startScheduledBackup();
}

/**
 * 热重载备份配置，重启定时器
 * @param {Object} cfg - 新的备份配置
 */
function reload(cfg) {
    stopScheduledBackup();
    backupConfig = cfg || {};
    startScheduledBackup();
}

/** 获取当前备份配置 */
function getConfig() {
    return backupConfig;
}

/** 启动定时备份，interval为0时禁用 */
function startScheduledBackup() {
    if (scheduledTimer) {
        clearInterval(scheduledTimer);
        scheduledTimer = null;
    }
    const intervalHours = backupConfig.interval || 0;
    if (intervalHours <= 0) return;
    const intervalMs = intervalHours * 3600 * 1000;
    scheduledTimer = setInterval(function() {
        executeBackup(function() {});
    }, intervalMs);
}

/** 停止定时备份 */
function stopScheduledBackup() {
    if (scheduledTimer) {
        clearInterval(scheduledTimer);
        scheduledTimer = null;
    }
}

/**
 * 扫描worlds目录获取所有世界存档名称
 * @returns {string[]} 世界目录名列表
 */
function getWorldNames() {
    const worldsDir = pathModule.resolve(process.cwd(), 'worlds');
    if (!fs.existsSync(worldsDir)) return [];
    try {
        return fs.readdirSync(worldsDir, { withFileTypes: true })
            .filter(function(d) { return d.isDirectory(); })
            .map(function(d) { return d.name; });
    } catch (e) {
        return [];
    }
}

/**
 * 格式化当前时间为备份文件名时间戳，格式YYYY-MM-DD_hh-mm-ss
 * @returns {string}
 */
function formatBackupTime() {
    let now = new Date();
    let y = now.getFullYear();
    let M = String(now.getMonth() + 1).padStart(2, '0');
    let d = String(now.getDate()).padStart(2, '0');
    let h = String(now.getHours()).padStart(2, '0');
    let m = String(now.getMinutes()).padStart(2, '0');
    let s = String(now.getSeconds()).padStart(2, '0');
    return y + '-' + M + '-' + d + '_' + h + '-' + m + '-' + s;
}

/**
 * 轮询等待BDS的save hold完成，确认世界文件已锁定可安全复制
 * 通过反复执行save query命令检查文件是否就绪
 * @param {Function} callback - 回调(true/false)表示是否成功锁定
 * @param {number} [maxRetries=30] - 最大重试次数
 * @param {number} [retryInterval=1000] - 每次重试间隔(ms)
 */
function waitForSaveHold(callback, maxRetries, retryInterval) {
    let retries = 0;
    maxRetries = maxRetries || 30;
    retryInterval = retryInterval || 1000;

    function check() {
        retries++;
        try {
            let result = mc.runcmdEx('save query');
            if (result) {
                let output = result.output || '';
                if (result.success && (
                    output.indexOf('Files are now ready to be copied') !== -1 ||
                    output.indexOf('Data saved') !== -1)) {
                    logger.info('save query 确认文件已准备好 (第' + retries + '次查询)');
                    callback(true);
                    return;
                }
                // 前3次和每5次输出一次调试日志
                if (retries <= 3 || retries % 5 === 0) {
                    logger.info('save query 第' + retries + '次查询, success=' + result.success + ', output=' + (output.substring(0, 200) || '(空)'));
                }
            }
        } catch (e) {
            logger.error('save query 异常: ' + e.message);
        }

        if (retries >= maxRetries) {
            logger.error('save query 超时 (' + maxRetries + '次查询)，无法确认文件是否准备好');
            callback(false);
            return;
        }
        setTimeout(check, retryInterval);
    }

    // 延迟5秒开始查询，等待save hold生效
    setTimeout(check, 5000);
}

/**
 * 执行完整的世界备份流程
 * 1. 通知在线玩家 -> 2. save hold -> 3. 等待锁定 -> 4. 复制世界文件 -> 5. save resume -> 6. 后台7z压缩 -> 7. 清理旧备份
 * @param {Function} callback - callback(err, result)，err为错误对象，result包含备份详情
 */
function executeBackup(callback) {
    if (isBackingUp) {
        callback({ error: '备份正在进行中，请稍后再试' });
        return;
    }
    isBackingUp = true;
    const startTime = Date.now();

    // 通知所有在线玩家
    const onlinePlayers = mc.getOnlinePlayers();
    onlinePlayers.forEach(function(p) {
        try { p.sendToast('服务器正在进行地图备份，请耐心等待', '§6备份中'); } catch (e) { logger.warn('[Backup] 发送备份通知失败: ' + e.message); }
    });

    // 延迟1秒后执行save hold，给toast通知显示时间
    setTimeout(function() {
        try {
            const holdResult = mc.runcmdEx('save hold');
            if (holdResult && holdResult.output) {
                logger.info('save hold 输出: ' + holdResult.output.trim());
            }
        } catch (e) {
            logger.error('save hold 执行失败: ' + e.message);
        }

        waitForSaveHold(function(holdSuccess) {
            if (!holdSuccess) {
                // hold失败时恢复存档写入
                try {
                    let resumeResult = mc.runcmdEx('save resume');
                    logger.info('save resume (hold失败) 输出: ' + (resumeResult && resumeResult.output ? resumeResult.output.trim() : '(无)'));
                } catch (e) { logger.error('[Backup] save resume (hold失败) 异常: ' + e.message); }
                isBackingUp = false;
                callback({ error: 'save hold 超时，无法锁定世界存档' });
                return;
            }

            // save query已确认文件就绪
            try {
                const worldNames = getWorldNames();
                if (worldNames.length === 0) {
                    try { mc.runcmdEx('save resume'); } catch (e) { logger.error('[Backup] save resume 失败: ' + e.message); }
                    isBackingUp = false;
                    callback({ error: '未找到世界存档目录' });
                    return;
                }

                // 限制压缩级别在0-9范围内
                let compressionLevel = backupConfig.compressionLevel || 5;
                if (compressionLevel < 0) compressionLevel = 0;
                if (compressionLevel > 9) compressionLevel = 9;

                const timestamp = formatBackupTime();

                // 先尝试直接压缩世界目录，失败则回退到复制临时目录再压缩
                const firstWorld = worldNames[0];
                const firstWorldPath = pathModule.resolve(process.cwd(), 'worlds', firstWorld);
                const firstArchiveName = firstWorld + '_' + timestamp + '.7z';
                const firstArchivePath = pathModule.join(backupDir, firstArchiveName);

                // 确保备份目录存在
                if (!fs.existsSync(backupDir)) {
                    try { fs.mkdirSync(backupDir, { recursive: true }); } catch (e) { /* ignore */ }
                }

                logger.info('尝试直接压缩世界文件 (LZMA2, 级别: ' + compressionLevel + ')...');

                compressTo7z(firstWorldPath, firstArchivePath, compressionLevel, function(firstErr) {
                    if (!firstErr) {
                        // 直接压缩成功，继续处理剩余世界
                        logger.info('直接压缩成功，继续处理其余世界...');
                        var results = [];
                        var fileSize = 0;
                        try { fileSize = fs.statSync(firstArchivePath).size; } catch (e) { /* ignore */ }
                        results.push({ world: firstWorld, file: firstArchiveName, success: true, size: fileSize, sizeFormatted: formatFileSize(fileSize) });

                        if (worldNames.length === 1) {
                            finishBackup(results, startTime, onlinePlayers, callback);
                        } else {
                            var completed = 1;
                            var total = worldNames.length;
                            for (var i = 1; i < worldNames.length; i++) {
                                (function(worldName) {
                                    var worldPath = pathModule.resolve(process.cwd(), 'worlds', worldName);
                                    var archiveName = worldName + '_' + timestamp + '.7z';
                                    var archivePath = pathModule.join(backupDir, archiveName);
                                    compressTo7z(worldPath, archivePath, compressionLevel, function(err) {
                                        if (!err) {
                                            var sz = 0;
                                            try { sz = fs.statSync(archivePath).size; } catch (e) { /* ignore */ }
                                            results.push({ world: worldName, file: archiveName, success: true, size: sz, sizeFormatted: formatFileSize(sz) });
                                        } else {
                                            results.push({ world: worldName, file: archiveName, success: false, error: err.message || String(err) });
                                        }
                                        if (++completed >= total) finishBackup(results, startTime, onlinePlayers, callback);
                                    });
                                })(worldNames[i]);
                            }
                        }
                    } else {
                        // 直接压缩失败，回退到复制临时目录再压缩
                        logger.warn('[Backup] 直接压缩失败，回退到临时目录模式: ' + firstErr.message);
                        // 删除可能残留的失败归档
                        try { if (fs.existsSync(firstArchivePath)) fs.unlinkSync(firstArchivePath); } catch (e) { /* ignore */ }

                        var tempDir = pathModule.join(backupDir, '_temp_' + timestamp);
                        try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) {
                            try { mc.runcmdEx('save resume'); } catch (ex) { logger.error('[Backup] save resume 失败: ' + ex.message); }
                            isBackingUp = false;
                            callback({ error: '创建临时目录失败: ' + e.message });
                            return;
                        }

                        logger.info('正在复制世界文件到临时目录...');
                        var copyErrors = [];
                        for (var ci = 0; ci < worldNames.length; ci++) {
                            var wn = worldNames[ci];
                            var wp = pathModule.resolve(process.cwd(), 'worlds', wn);
                            var twp = pathModule.join(tempDir, wn);
                            try { copyDirSync(wp, twp); } catch (e) { copyErrors.push({ world: wn, error: e.message }); }
                        }

                        // 复制完成，先恢复世界写入，再从临时目录压缩
                        try {
                            var resumeResult = mc.runcmdEx('save resume');
                            logger.info('save resume 输出: ' + (resumeResult && resumeResult.output ? resumeResult.output.trim() : '(无)'));
                        } catch (e) { logger.error('save resume 执行失败: ' + e.message); }

                        if (copyErrors.length > 0) {
                            logger.error('复制世界文件时出错: ' + JSON.stringify(copyErrors));
                        }

                        onlinePlayers.forEach(function(p) {
                            try { p.sendToast('快照已完成，正在后台压缩', '§6压缩中'); } catch (e) { /* ignore */ }
                        });

                        logger.info('从临时目录压缩 (LZMA2, 级别: ' + compressionLevel + ')...');

                        var results = [];
                        var completed = 0;
                        var total = worldNames.length;

                        worldNames.forEach(function(worldName) {
                            var tempWorldPath = pathModule.join(tempDir, worldName);
                            var archiveName = worldName + '_' + timestamp + '.7z';
                            var archivePath = pathModule.join(backupDir, archiveName);

                            compressTo7z(tempWorldPath, archivePath, compressionLevel, function(err) {
                                completed++;
                                if (!err) {
                                    var sz = 0;
                                    try { sz = fs.statSync(archivePath).size; } catch (e) { /* ignore */ }
                                    results.push({ world: worldName, file: archiveName, success: true, size: sz, sizeFormatted: formatFileSize(sz) });
                                } else {
                                    results.push({ world: worldName, file: archiveName, success: false, error: err.message || String(err) });
                                }

                                if (completed >= total) {
                                    // 清理临时目录
                                    try { rmrf(tempDir); } catch (e) { logger.error('清理临时目录失败: ' + e.message); }
                                    finishBackup(results, startTime, onlinePlayers, callback);
                                }
                            });
                        });
                    }
                });
            } catch (e) {
                try {
                    mc.runcmdEx('save resume');
                    logger.error('异常后 save resume 已执行');
                } catch (ex) { logger.error('[Backup] 异常后 save resume 也失败: ' + ex.message); }
                isBackingUp = false;
                callback({ error: '备份失败: ' + e.message });
            }
        });
    }, 1000);
}

/**
 * 备份完成的统一收尾：恢复存档写入、统计结果、通知玩家、清理旧备份
 * @param {Array} results - 各世界的压缩结果
 * @param {number} startTime - 备份开始时间戳
 * @param {Array} onlinePlayers - 在线玩家列表
 * @param {Function} callback - executeBackup 的回调
 */
function finishBackup(results, startTime, onlinePlayers, callback) {
    // 恢复世界写入（如果尚未恢复，比如直接压缩模式）
    try {
        var resumeResult = mc.runcmdEx('save resume');
        if (resumeResult && resumeResult.output && resumeResult.output.indexOf('are resumed') === -1) {
            logger.info('save resume 输出: ' + resumeResult.output.trim());
        }
    } catch (e) { /* 已经 resume 过，忽略 */ }

    var elapsed = Date.now() - startTime;
    var elapsedSec = (elapsed / 1000).toFixed(1);
    var totalBackupSize = 0;
    var successCount = 0;
    var failCount = 0;
    results.forEach(function(r) {
        if (r.success) {
            successCount++;
            totalBackupSize += r.size;
        } else {
            failCount++;
        }
    });

    onlinePlayers.forEach(function(p) {
        try { p.sendToast('地图备份已完成', '备份完成'); } catch (e) { /* ignore */ }
    });

    try {
        if (failCount === 0) {
            logger.info('备份完成！耗时 ' + elapsedSec + ' 秒，总大小 ' + formatFileSize(totalBackupSize) + '，成功 ' + successCount + '/' + results.length);
        } else {
            logger.info('备份完成！耗时 ' + elapsedSec + ' 秒，成功 ' + successCount + '/' + results.length + '，失败 ' + failCount + '/' + results.length);
        }
        results.forEach(function(r) {
            if (r.success) {
                logger.info('备份成功: ' + r.file + ' (' + r.sizeFormatted + ')');
            } else {
                logger.info('备份失败: ' + (r.file || r.world) + ' - ' + (r.error || '未知错误'));
            }
        });
    } catch (e) { logger.warn('[Backup] 输出备份结果失败: ' + e.message); }

    cleanupOldBackups();
    isBackingUp = false;
    callback(null, { results: results, elapsed: elapsedSec, totalSize: totalBackupSize, totalSizeFormatted: formatFileSize(totalBackupSize), successCount: successCount, failCount: failCount });
}

/**
 * 使用7zip-min压缩目录为7z归档
 * @param {string} sourcePath - 待压缩的源目录
 * @param {string} archivePath - 输出的7z文件路径
 * @param {number} compressionLevel - 压缩级别(0-9)
 * @param {Function} callback - callback(err)
 */
function compressTo7z(sourcePath, archivePath, compressionLevel, callback) {
    var args = [
        'a',                    // 添加文件到归档
        '-t7z',                 // 7z格式
        '-mx=' + compressionLevel, // 压缩级别
        '-m0=LZMA2',           // 使用LZMA2算法
        '-aoa',                // 覆盖所有已存在的文件
        '-ssw',                // 压缩共享文件（BDS可能仍在访问部分文件）
        archivePath,
        sourcePath
    ];

    _7z.cmd(args, function(err) {
        if (err) {
            var detail = err.message || 'Unknown error';
            if (err.stderr) detail += ' | stderr: ' + err.stderr.trim();
            logger.warn('[Backup] 7z 压缩失败: ' + detail);
            var enhancedErr = new Error(detail);
            enhancedErr.code = err.code;
            callback(enhancedErr);
        } else {
            callback(null);
        }
    });
}

/**
 * 获取备份文件列表，按时间倒序排列
 * @returns {Array<{filename: string, size: number, sizeFormatted: string, time: number, timeFormatted: string, world: string}>}
 */
function getBackupList() {
    if (!fs.existsSync(backupDir)) return [];
    try {
        const files = fs.readdirSync(backupDir);
        let backups = [];
        files.forEach(function(file) {
            if (!file.endsWith('.7z')) return;
            let filePath = pathModule.join(backupDir, file);
            try {
                const stat = fs.statSync(filePath);
                const parsed = parseBackupFilename(file);
                backups.push({
                    filename: file,
                    size: stat.size,
                    sizeFormatted: formatFileSize(stat.size),
                    time: stat.mtimeMs,
                    timeFormatted: formatDateTime(stat.mtime),
                    world: parsed.world
                });
            } catch (e) { logger.warn('[Backup] 读取备份文件信息失败: ' + e.message); }
        });
        backups.sort(function(a, b) { return b.time - a.time; });
        return backups;
    } catch (e) {
        return [];
    }
}

/**
 * 从备份文件名中解析世界名和时间戳
 * 文件名格式：WorldName_YYYY-MM-DD_hh-mm-ss.7z
 * @param {string} filename
 * @returns {{world: string, timestamp: string}}
 */
function parseBackupFilename(filename) {
    const match = filename.match(/^(.+)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.7z$/);
    if (match) {
        return { world: match[1], timestamp: match[2] };
    }
    return { world: 'unknown', timestamp: '' };
}

/**
 * 获取备份统计信息（数量和总大小）
 * @returns {{count: number, totalSize: number, totalSizeFormatted: string, backups: Array}}
 */
function getBackupStats() {
    let backups = getBackupList();
    let totalSize = 0;
    backups.forEach(function(b) { totalSize += b.size; });
    return {
        count: backups.length,
        totalSize: totalSize,
        totalSizeFormatted: formatFileSize(totalSize),
        backups: backups
    };
}

/**
 * 删除指定备份文件，包含路径遍历安全检查
 * @param {string} filename - 备份文件名（仅允许.7z文件）
 * @returns {{success?: boolean, error?: string}}
 */
function deleteBackup(filename) {
    if (!filename) return { error: '文件名不能为空' };
    // 防止路径遍历攻击
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return { error: '非法文件名' };
    }
    if (!filename.endsWith('.7z')) return { error: '只能删除.7z备份文件' };
    const filePath = pathModule.join(backupDir, filename);
    if (!fs.existsSync(filePath)) return { error: '文件不存在' };
    try {
        fs.unlinkSync(filePath);
        return { success: true };
    } catch (e) {
        return { error: '删除失败: ' + e.message };
    }
}

/**
 * 清理过期和超出数量限制的旧备份
 * 先按maxAgeDays删除过期备份，再按maxCount删除最旧的
 * @returns {Array} 被删除的备份列表
 */
function cleanupOldBackups() {
    const maxAgeDays = backupConfig.maxAgeDays || 0;
    const maxCount = backupConfig.maxCount || 0;
    let backups = getBackupList();
    const deleted = [];

    // 按天数删除过期备份
    if (maxAgeDays > 0) {
        const now = Date.now();
        const maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
        backups.forEach(function(b) {
            if (now - b.time > maxAgeMs) {
                let ageDays = Math.floor((now - b.time) / (24 * 3600 * 1000));
                let result = deleteBackup(b.filename);
                if (result.success) {
                    deleted.push({ filename: b.filename, reason: '过期', ageDays: ageDays });
                    logger.info('已删除 ' + ageDays + ' 天前的备份: ' + b.filename);
                }
            }
        });
    }

    // 按数量限制删除最旧的备份
    if (maxCount > 0) {
        backups = getBackupList();
        const sorted = backups.slice().sort(function(a, b) { return a.time - b.time; });
        while (sorted.length > maxCount) {
            const oldest = sorted.shift();
            const ageDays = Math.floor((Date.now() - oldest.time) / (24 * 3600 * 1000));
            const result = deleteBackup(oldest.filename);
            if (result.success) {
                deleted.push({ filename: oldest.filename, reason: '超出数量限制', ageDays: ageDays });
                logger.info('备份数量超出限制(' + maxCount + ')，已删除 ' + ageDays + ' 天前的备份: ' + oldest.filename);
            }
        }
    }

    return deleted;
}

/** 检查是否正在备份中 */
function isBackupRunning() {
    return isBackingUp;
}

/**
 * 格式化文件大小为人类可读字符串
 * @param {number} bytes - 字节数
 * @returns {string} 如"1.50 GB"
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= units.length) i = units.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

/**
 * 格式化日期为 YYYY-MM-DD hh:mm:ss 字符串
 * @param {Date|string|number} date
 * @returns {string}
 */
function formatDateTime(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return y + '-' + M + '-' + day + ' ' + h + ':' + m + ':' + s;
}

module.exports = {
    init: init,
    reload: reload,
    getConfig: getConfig,
    executeBackup: executeBackup,
    getBackupList: getBackupList,
    getBackupStats: getBackupStats,
    deleteBackup: deleteBackup,
    cleanupOldBackups: cleanupOldBackups,
    isBackupRunning: isBackupRunning,
    getBackupDir: function() { return backupDir; }
};
