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
 * NLCE 自动备份系统
 * 定时自动备份玩家数据和配置文件，支持备份列表管理和恢复
 */


var D = require('./debug');
const fs = require('fs');
const pathModule = require('path');
const _7z = require('7zip-min');
const U = require('./utils');

var backupConfig = null;
var backupDir = '';
var isBackingUp = false;
var scheduledTimer = null;

function init(cfg) {
	D.debugLogModule('backup')('init: 初始化完成');
    backupConfig = cfg || {};
    backupDir = pathModule.resolve(process.cwd(), 'backup');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    startScheduledBackup();
}

function reload(cfg) {
    stopScheduledBackup();
    backupConfig = cfg || {};
    startScheduledBackup();
}

function getConfig() {
    return backupConfig;
}

function startScheduledBackup() {
    if (scheduledTimer) {
        clearInterval(scheduledTimer);
        scheduledTimer = null;
    }
    var intervalHours = backupConfig.interval || 0;
    if (intervalHours <= 0) return;
    var intervalMs = intervalHours * 3600 * 1000;
    scheduledTimer = setInterval(function() {
        executeBackup(function() {});
    }, intervalMs);
}

function stopScheduledBackup() {
    if (scheduledTimer) {
        clearInterval(scheduledTimer);
        scheduledTimer = null;
    }
}

function getWorldNames() {
    var worldsDir = pathModule.resolve(process.cwd(), 'worlds');
    if (!fs.existsSync(worldsDir)) return [];
    try {
        return fs.readdirSync(worldsDir, { withFileTypes: true })
            .filter(function(d) { return d.isDirectory(); })
            .map(function(d) { return d.name; });
    } catch (e) {
        return [];
    }
}

function formatBackupTime() {
    var now = new Date();
    var y = now.getFullYear();
    var M = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    return y + '-' + M + '-' + d + '_' + h + '-' + m + '-' + s;
}

function waitForSaveHold(callback, maxRetries, retryInterval) {
    var retries = 0;
    maxRetries = maxRetries || 30;
    retryInterval = retryInterval || 1000;

    function check() {
        retries++;
        try {
            var result = mc.runcmdEx('save query');
            if (result) {
                var output = result.output || '';
                if (result.success && (
                    output.indexOf('Files are now ready to be copied') !== -1 ||
                    output.indexOf('Data saved') !== -1)) {
                    logger.info('save query 确认文件已准备好 (第' + retries + '次查询)');
                    callback(true);
                    return;
                }
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

    setTimeout(check, 5000);
}

function executeBackup(callback) {
    if (isBackingUp) {
        callback({ error: '备份正在进行中，请稍后再试' });
        return;
    }
    isBackingUp = true;
    var startTime = Date.now();

    var onlinePlayers = mc.getOnlinePlayers();
    onlinePlayers.forEach(function(p) {
        try { p.sendToast('服务器正在进行地图备份，请耐心等待', '§6备份中'); } catch (e) {}
    });

    setTimeout(function() {
        try {
            var holdResult = mc.runcmdEx('save hold');
            if (holdResult && holdResult.output) {
                logger.info('save hold 输出: ' + holdResult.output.trim());
            }
        } catch (e) {
            logger.error('save hold 执行失败: ' + e.message);
        }

        waitForSaveHold(function(holdSuccess) {
            if (!holdSuccess) {
                try {
                    var resumeResult = mc.runcmdEx('save resume');
                    logger.info('save resume (hold失败) 输出: ' + (resumeResult && resumeResult.output ? resumeResult.output.trim() : '(无)'));
                } catch (e) {}
                isBackingUp = false;
                callback({ error: 'save hold 超时，无法锁定世界存档' });
                return;
            }

            setTimeout(function() {
            try {
                var worldNames = getWorldNames();
                if (worldNames.length === 0) {
                    try { mc.runcmdEx('save resume'); } catch (e) {}
                    isBackingUp = false;
                    callback({ error: '未找到世界存档目录' });
                    return;
                }

                var compressionLevel = backupConfig.compressionLevel || 5;
                if (compressionLevel < 0) compressionLevel = 0;
                if (compressionLevel > 9) compressionLevel = 9;

                var timestamp = formatBackupTime();
                var tempDir = pathModule.join(backupDir, '_temp_' + timestamp);
                try {
                    fs.mkdirSync(tempDir, { recursive: true });
                } catch (e) {
                    try { mc.runcmdEx('save resume'); } catch (ex) {}
                    isBackingUp = false;
                    callback({ error: '创建临时目录失败: ' + e.message });
                    return;
                }

                logger.info('开始复制世界文件到临时目录...');
                var copyErrors = [];
                worldNames.forEach(function(worldName) {
                    var worldPath = pathModule.resolve(process.cwd(), 'worlds', worldName);
                    var tempWorldPath = pathModule.join(tempDir, worldName);
                    try {
                        U.copyDirSync(worldPath, tempWorldPath);
                    } catch (e) {
                        copyErrors.push({ world: worldName, error: e.message });
                    }
                });

                try {
                    var resumeResult = mc.runcmdEx('save resume');
                    logger.info('save resume 输出: ' + (resumeResult && resumeResult.output ? resumeResult.output.trim() : '(无)'));
                } catch (e) {
                    logger.error('save resume 执行失败: ' + e.message);
                }

                if (copyErrors.length > 0) {
                    logger.error('复制世界文件时出错: ' + JSON.stringify(copyErrors));
                }

                onlinePlayers.forEach(function(p) {
                    try { p.sendToast('地图快照已完成，正在后台压缩', '§6压缩中'); } catch (e) {}
                });

                logger.info('世界文件复制完成，save resume 已执行，开始后台压缩...');

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
                            var fileSize = 0;
                            try {
                                var stat = fs.statSync(archivePath);
                                fileSize = stat.size;
                            } catch (e) {}
                            results.push({ world: worldName, file: archiveName, success: true, size: fileSize, sizeFormatted: formatFileSize(fileSize) });
                        } else {
                            results.push({ world: worldName, file: archiveName, success: false, error: err.message || String(err) });
                        }
                        if (completed >= total) {
                            try {
                                U.rmrf(tempDir);
                            } catch (e) {
                                logger.error('清理临时目录失败: ' + e.message);
                            }

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
                                try { p.sendToast('地图备份已完成', '备份完成'); } catch (e) {}
                            });

                            try {
                                if (failCount === 0) {
                                    logger.info('备份完成！耗时 ' + elapsedSec + ' 秒，总大小 ' + formatFileSize(totalBackupSize) + '，成功 ' + successCount + '/' + total);
                                } else {
                                    logger.info('备份完成！耗时 ' + elapsedSec + ' 秒，成功 ' + successCount + '/' + total + '，失败 ' + failCount + '/' + total);
                                }
                                results.forEach(function(r) {
                                    if (r.success) {
                                        logger.info('§a  ✓ ' + r.file + ' (' + r.sizeFormatted + ')');
                                    } else {
                                        logger.info('§c  ✗ ' + (r.file || r.world) + ' - ' + (r.error || '未知错误'));
                                    }
                                });
                            } catch (e) {}

                            cleanupOldBackups();
                            isBackingUp = false;
                            callback(null, { results: results, timestamp: timestamp, elapsed: elapsedSec, totalSize: totalBackupSize, totalSizeFormatted: formatFileSize(totalBackupSize), successCount: successCount, failCount: failCount });
                        }
                    });
                });
            } catch (e) {
                try {
                    mc.runcmdEx('save resume');
                    logger.error('异常后 save resume 已执行');
                } catch (ex) {}
                isBackingUp = false;
                callback({ error: '备份失败: ' + e.message });
            }
            }, 3000);
        });
    }, 1000);
}

function compressTo7z(sourcePath, archivePath, compressionLevel, callback) {
    var args = [
        'a',
        '-t7z',
        '-mx=' + compressionLevel,
        '-m0=LZMA2',
        '-aoa',
        '-ssw',
        archivePath,
        sourcePath
    ];

    _7z.cmd(args, function(err) {
        if (err) {
            var detail = err.message || 'Unknown error';
            if (err.stderr) detail += ' | stderr: ' + err.stderr.trim();
            var enhancedErr = new Error(detail);
            enhancedErr.code = err.code;
            callback(enhancedErr);
        } else {
            callback(null);
        }
    });
}

function getBackupList() {
    if (!fs.existsSync(backupDir)) return [];
    try {
        var files = fs.readdirSync(backupDir);
        var backups = [];
        files.forEach(function(file) {
            if (!file.endsWith('.7z')) return;
            var filePath = pathModule.join(backupDir, file);
            try {
                var stat = fs.statSync(filePath);
                var parsed = parseBackupFilename(file);
                backups.push({
                    filename: file,
                    size: stat.size,
                    sizeFormatted: formatFileSize(stat.size),
                    time: stat.mtimeMs,
                    timeFormatted: formatDateTime(stat.mtime),
                    world: parsed.world
                });
            } catch (e) {}
        });
        backups.sort(function(a, b) { return b.time - a.time; });
        return backups;
    } catch (e) {
        return [];
    }
}

function parseBackupFilename(filename) {
    var match = filename.match(/^(.+)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.7z$/);
    if (match) {
        return { world: match[1], timestamp: match[2] };
    }
    return { world: 'unknown', timestamp: '' };
}

function getBackupStats() {
    var backups = getBackupList();
    var totalSize = 0;
    backups.forEach(function(b) { totalSize += b.size; });
    return {
        count: backups.length,
        totalSize: totalSize,
        totalSizeFormatted: formatFileSize(totalSize),
        backups: backups
    };
}

function deleteBackup(filename) {
    if (!filename) return { error: '文件名不能为空' };
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return { error: '非法文件名' };
    }
    if (!filename.endsWith('.7z')) return { error: '只能删除.7z备份文件' };
    var filePath = pathModule.join(backupDir, filename);
    if (!fs.existsSync(filePath)) return { error: '文件不存在' };
    try {
        fs.unlinkSync(filePath);
        return { success: true };
    } catch (e) {
        return { error: '删除失败: ' + e.message };
    }
}

function cleanupOldBackups() {
    var maxAgeDays = backupConfig.maxAgeDays || 0;
    var maxCount = backupConfig.maxCount || 0;
    var backups = getBackupList();
    var deleted = [];

    if (maxAgeDays > 0) {
        var now = Date.now();
        var maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
        backups.forEach(function(b) {
            if (now - b.time > maxAgeMs) {
                var ageDays = Math.floor((now - b.time) / (24 * 3600 * 1000));
                var result = deleteBackup(b.filename);
                if (result.success) {
                    deleted.push({ filename: b.filename, reason: '过期', ageDays: ageDays });
                    try { logger.info('已删除 ' + ageDays + ' 天前的备份: ' + b.filename); } catch (e) {}
                }
            }
        });
    }

    if (maxCount > 0) {
        backups = getBackupList();
        var sorted = backups.slice().sort(function(a, b) { return a.time - b.time; });
        while (sorted.length > maxCount) {
            var oldest = sorted.shift();
            var ageDays = Math.floor((Date.now() - oldest.time) / (24 * 3600 * 1000));
            var result = deleteBackup(oldest.filename);
            if (result.success) {
                deleted.push({ filename: oldest.filename, reason: '超出数量限制', ageDays: ageDays });
                try { logger.info('备份数量超出限制(' + maxCount + ')，已删除 ' + ageDays + ' 天前的备份: ' + oldest.filename); } catch (e) {}
            }
        }
    }

    return deleted;
}

function isBackupRunning() {
    return isBackingUp;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= units.length) i = units.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function formatDateTime(date) {
    var d = new Date(date);
    var y = d.getFullYear();
    var M = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
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
