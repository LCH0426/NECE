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
 * NECE 管理面板路由
 * 备份、封禁、清理、称号、经济日志等管理接口
 */

var multer = require('multer');
var zlib = require('zlib');

// 建筑文件上传限制
var STRUCTURE_MAX_FILE_SIZE = 64 * 1024 * 1024;

/**
 * 校验 .mcstructure 文件内容：小端序 NBT 或 gzip 压缩的小端序 NBT，根为 Compound 且含 size 与 structure
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function validateMcstructure(buffer) {
    try {
        var buf = buffer;
        if (buf.length > 2 && buf[0] === 0x1F && buf[1] === 0x8B) {
            buf = zlib.gunzipSync(buf);
        }
        // 根必须为 Compound 标签 10
        if (buf.length < 3 || buf[0] !== 10) return false;
        var pos = 3 + buf.readUInt16LE(1); // 跳过根名
        var hasSize = false, hasStructure = false;

        function skipPayload(p, tag) {
            switch (tag) {
                case 1: return p + 1;                        // Byte
                case 2: return p + 2;                        // Short
                case 3: case 5: return p + 4;                // Int/Float
                case 4: case 6: return p + 8;                // Long/Double
                case 7: {                                    // ByteArray
                    var n7 = buf.readInt32LE(p);
                    return p + 4 + n7;
                }
                case 8: {                                    // String
                    var n8 = buf.readUInt16LE(p);
                    return p + 2 + n8;
                }
                case 9: {                                    // List
                    var et = buf[p];
                    var n9 = buf.readInt32LE(p + 1);
                    var p9 = p + 5;
                    for (var i = 0; i < n9; i++) p9 = skipPayload(p9, et);
                    return p9;
                }
                case 10: {                                   // Compound
                    var p10 = p;
                    while (true) {
                        var t = buf[p10];
                        if (t === 0) return p10 + 1;
                        var nl = buf.readUInt16LE(p10 + 1);
                        p10 += 3 + nl;
                        p10 = skipPayload(p10, t);
                    }
                }
                case 11: {                                   // IntArray
                    var n11 = buf.readInt32LE(p);
                    return p + 4 + n11 * 4;
                }
                case 12: {                                   // LongArray
                    var n12 = buf.readInt32LE(p);
                    return p + 4 + n12 * 8;
                }
                default: throw new Error('unknown tag');
            }
        }

        while (pos < buf.length) {
            var tag = buf[pos];
            if (tag === 0) break;
            var nameLen = buf.readUInt16LE(pos + 1);
            var name = buf.toString('utf8', pos + 3, pos + 3 + nameLen);
            pos += 3 + nameLen;
            if (name === 'size') hasSize = true;
            if (name === 'structure') hasStructure = true;
            pos = skipPayload(pos, tag);
        }
        return hasSize && hasStructure;
    } catch (e) {
        return false;
    }
}

/**
 * 校验 .nbt 文件内容：gzip 压缩的 JSON，含 version 与 size
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function validateNbt(buffer) {
    try {
        if (buffer.length < 2 || buffer[0] !== 0x1F || buffer[1] !== 0x8B) return false;
        var data = JSON.parse(zlib.gunzipSync(buffer).toString('utf-8'));
        return data && typeof data === 'object' && data.size && data.size.x !== undefined && data.size.y !== undefined && data.size.z !== undefined && data.version !== undefined;
    } catch (e) {
        return false;
    }
}

function registerRoutes(router, d) {

    /** 记录管理员操作失败 */
    function logAdminFailure(event, req, target, reason, level) {
        d.logStore.append(event, {
            admin: req.user ? String(req.user.uid) : '',
            ip: d.getClientIp(req),
            target: target || '',
            result: 'failed',
            reason: reason || ''
        }, level || 'warn');
    }

    // 获取备份统计信息
    router.get('/backup/stats', d.adminAuth, function(req, res) {
        try {
            const stats = d.backupModule.getBackupStats();
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份统计失败: ' + e.message});
        }
    });

    // 获取备份文件列表
    router.get('/backup/list', d.adminAuth, function(req, res) {
        try {
            const backups = d.backupModule.getBackupList();
            res.json({ code: 200, data: backups });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份列表失败: ' + e.message});
        }
    });

    // 手动触发备份
    router.post('/backup/execute', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            // 防止并发备份
            if (d.backupModule.isBackupRunning()) {
                logAdminFailure('admin.backup_run', req, '手动触发', 'already_running');
                return res.status(400).json({ code: 400, msg: '备份正在进行中，请稍后再试' });
            }
            d.logStore.append('admin.backup_run', { admin: req.user.uid, ip: d.getClientIp(req), target: '手动触发', detail: '' });
            d.backupModule.executeBackup(function(err, result) {
                if (err) {
                    logAdminFailure('admin.backup_run', req, '手动触发', err.error || 'backup_failed', 'err');
                    res.status(500).json({ code: 500, msg: err.error || '备份失败' });
                } else {
                    res.json({ code: 200, msg: '备份完成', data: result });
                }
            });
        } catch (e) {
            logAdminFailure('admin.backup_run', req, '手动触发', 'exception: ' + e.message, 'err');
            res.status(500).json({ code: 500, msg: '备份失败: ' + e.message});
        }
    });

    // 查询备份是否正在执行
    router.get('/backup/status', d.adminAuth, function(req, res) {
        try {
            res.json({ code: 200, data: { isRunning: d.backupModule.isBackupRunning() } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份状态失败: ' + e.message});
        }
    });

    // 删除指定备份文件
    router.delete('/backup/:filename', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            let filename = req.params.filename;
            // 路径穿越防护
            if (!filename || filename.indexOf('..') !== -1 || filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1 || filename.indexOf('\0') !== -1) {
                logAdminFailure('admin.backup_delete', req, '文件:' + filename, 'invalid_filename');
                return res.status(400).json({ code: 400, msg: '文件名不合法' });
            }
            let result = d.backupModule.deleteBackup(filename);
            if (result.success) {
                d.logStore.append('admin.backup_delete', { admin: req.user.uid, ip: d.getClientIp(req), target: '文件:' + filename, detail: '' });
                res.json({ code: 200, msg: '备份已删除' });
            } else {
                logAdminFailure('admin.backup_delete', req, '文件:' + filename, result.error || 'delete_failed');
                res.status(400).json({ code: 400, msg: result.error });
            }
        } catch (e) {
            logAdminFailure('admin.backup_delete', req, String(req.params.filename || ''), 'exception: ' + e.message, 'err');
            res.status(500).json({ code: 500, msg: '删除备份失败: ' + e.message});
        }
    });

    // 申请临时下载令牌（需要管理员权限）
    router.post('/backup/download-token', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            const filename = (req.body.filename || '').trim();
            if (!filename) {
                logAdminFailure('admin.download_link_generate', req, '', 'missing_filename');
                return res.status(400).json({ code: 400, msg: '缺少filename参数' });
            }
            // 安全校验文件名
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
                logAdminFailure('admin.download_link_generate', req, '文件:' + filename, 'invalid_filename');
                return res.status(400).json({ code: 400, msg: '非法文件名' });
            }
            if (!filename.endsWith('.7z') && !filename.endsWith('.zip')) {
                logAdminFailure('admin.download_link_generate', req, '文件:' + filename, 'invalid_extension');
                return res.status(400).json({ code: 400, msg: '只能下载.7z或.zip备份文件' });
            }
            const backupDir = d.backupModule.getBackupDir();
            const filePath = d.pathModule.join(backupDir, filename);
            const resolvedPath = d.pathModule.resolve(filePath);
            const resolvedBackupDir = d.pathModule.resolve(backupDir);
            if (!resolvedPath.startsWith(resolvedBackupDir + d.pathModule.sep) && resolvedPath !== resolvedBackupDir) {
                logAdminFailure('admin.download_link_generate', req, '文件:' + filename, 'invalid_path');
                return res.status(400).json({ code: 400, msg: '非法文件路径' });
            }
            if (!d.fs.existsSync(filePath)) {
                logAdminFailure('admin.download_link_generate', req, '文件:' + filename, 'file_not_found');
                return res.status(404).json({ code: 404, msg: '文件不存在' });
            }
            const token = d.generateDownloadToken(filename);
            const downloadUrl = '/api/v1/backup/download/' + encodeURIComponent(filename) + '?token=' + token;
            d.logStore.append('admin.download_link_generate', { admin: req.user.uid, ip: d.getClientIp(req), target: '文件:' + filename, detail: '' });
            res.json({
                code: 200,
                data: {
                    downloadUrl: downloadUrl,
                    token: token,
                    expiresIn: 6 * 3600
                }
            });
        } catch (e) {
            logAdminFailure('admin.download_link_generate', req, String(req.body && req.body.filename || ''), 'exception: ' + e.message, 'err');
            res.status(500).json({ code: 500, msg: '生成下载链接失败: ' + e.message});
        }
    });

    // 下载备份文件（仅支持临时下载令牌）
    router.get('/backup/download/:filename', d.backupDownloadLimiter, function(req, res) {
        try {
            const filename = req.params.filename;
            // 防止路径穿越攻击：使用path.resolve验证路径在备份目录内
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
                return res.status(400).json({ code: 400, msg: '非法文件名' });
            }
            if (!filename.endsWith('.7z') && !filename.endsWith('.zip')) {
                return res.status(400).json({ code: 400, msg: '只能下载.7z或.zip备份文件' });
            }

            // 检查临时下载令牌
            var downloadToken = req.query.token;
            if (!downloadToken) {
                return res.status(401).json({ code: 401, msg: '缺少下载令牌，请先申请临时下载链接' });
            }
            var tokenFilename = d.consumeDownloadToken(downloadToken);
            if (!tokenFilename) {
                return res.status(403).json({ code: 403, msg: '下载链接无效或已过期' });
            }
            if (tokenFilename !== filename) {
                return res.status(403).json({ code: 403, msg: '令牌与文件不匹配' });
            }

            const backupDir = d.backupModule.getBackupDir();
            const filePath = d.pathModule.join(backupDir, filename);
            // 二次验证：解析后的绝对路径必须在备份目录内
            const resolvedPath = d.pathModule.resolve(filePath);
            const resolvedBackupDir = d.pathModule.resolve(backupDir);
            if (!resolvedPath.startsWith(resolvedBackupDir + d.pathModule.sep) && resolvedPath !== resolvedBackupDir) {
                return res.status(400).json({ code: 400, msg: '非法文件路径' });
            }
            if (!d.fs.existsSync(filePath)) {
                return res.status(404).json({ code: 404, msg: '文件不存在' });
            }
            res.download(filePath, filename);
        } catch (e) {
            res.status(500).json({ code: 500, msg: '下载备份失败: ' + e.message});
        }
    });

    // 获取备份配置
    router.get('/backup/config', d.adminAuth, function(req, res) {
        try {
            let cfg = d.backupModule.getConfig();
            res.json({ code: 200, data: cfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份配置失败: ' + e.message});
        }
    });

    // 更新备份配置
    router.put('/backup/config', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            const cfg = d.backupModule.getConfig();
            const body = req.body;
            if (typeof body.compressionLevel === 'number') {
                cfg.compressionLevel = Math.max(0, Math.min(9, Math.floor(body.compressionLevel)));
            }
            if (typeof body.interval === 'number') {
                cfg.interval = Math.max(0, body.interval);
            }
            if (typeof body.maxAgeDays === 'number') {
                cfg.maxAgeDays = Math.max(0, body.maxAgeDays);
            }
            if (typeof body.maxCount === 'number') {
                cfg.maxCount = Math.max(0, Math.floor(body.maxCount));
            }
            if (typeof body.compressionAlgorithm === 'string') {
                const allowed = ['LZ4', 'LZMA2', 'ZSTD', 'BZip2', 'PPMd'];
                const algo = body.compressionAlgorithm.toUpperCase();
                if (allowed.indexOf(algo) !== -1) {
                    cfg.compressionAlgorithm = algo;
                }
            }
            if (typeof body.dataBackupInterval === 'number') {
                cfg.dataBackupInterval = Math.max(0, body.dataBackupInterval);
            }

            const MAIN_CONFIG_PATH = d.pathModule.join(__dirname, '..', '..', 'config.json');
            try {
                const mainCfg = JSON.parse(d.fs.readFileSync(MAIN_CONFIG_PATH, 'utf-8'));
                mainCfg.backup = cfg;
                d.fs.writeFileSync(MAIN_CONFIG_PATH, JSON.stringify(mainCfg, null, 4), 'utf-8');
            } catch (e) {
                return res.status(500).json({ code: 500, msg: '保存配置文件失败: ' + e.message});
            }

            d.triggerReload('config');
            var dataInterval = cfg.dataBackupInterval !== undefined ? cfg.dataBackupInterval : 0;
            if (dataInterval > 0) {
                d.backupModule.startDataBackupScheduler(dataInterval * 3600 * 1000);
            } else {
                d.backupModule.stopDataBackupScheduler();
            }
            d.logStore.append('admin.backup_config_update', { admin: req.user.uid, ip: d.getClientIp(req), target: JSON.stringify(cfg), detail: '' });
            res.json({ code: 200, msg: '备份配置已更新', data: cfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新备份配置失败: ' + e.message});
        }
    });

    // ==================== 建筑文件管理 ====================

    // 获取建筑文件列表
    router.get('/structure/list', d.adminAuth, function(req, res) {
        try {
            const structureDir = d.pathModule.join(__dirname, '..', '..', 'data', 'structure');
            if (!d.fs.existsSync(structureDir)) {
                return res.json({ code: 200, data: [] });
            }
            const files = d.fs.readdirSync(structureDir);
            const list = [];
            files.forEach(function(file) {
                const ln = file.toLowerCase();
                if (!ln.endsWith('.nbt') && !ln.endsWith('.mcstructure')) return;
                const filePath = d.pathModule.join(structureDir, file);
                try {
                    const stat = d.fs.statSync(filePath);
                    if (!stat.isFile()) return;
                    list.push({
                        filename: file,
                        size: stat.size,
                        sizeFormatted: formatFileSize(stat.size),
                        time: stat.mtimeMs,
                        timeFormatted: formatDateTime(stat.mtime),
                        type: ln.endsWith('.mcstructure') ? 'mcstructure' : 'nbt'
                    });
                } catch (e) { /* 跳过无法读取的文件 */ }
            });
            list.sort(function(a, b) { return b.time - a.time; });
            res.json({ code: 200, data: list });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取建筑文件列表失败: ' + e.message});
        }
    });

    // 下载建筑文件（Blob方式，需要管理员权限）
    router.get('/structure/download/:filename', d.adminAuth, function(req, res) {
        try {
            const filename = req.params.filename;
            // 防止路径穿越攻击
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
                logAdminFailure('admin.structure_file_download', req, '文件:' + filename, 'invalid_filename');
                return res.status(400).json({ code: 400, msg: '非法文件名' });
            }
            const ln = filename.toLowerCase();
            if (!ln.endsWith('.nbt') && !ln.endsWith('.mcstructure')) {
                logAdminFailure('admin.structure_file_download', req, '文件:' + filename, 'invalid_extension');
                return res.status(400).json({ code: 400, msg: '只能下载.nbt或.mcstructure建筑文件' });
            }
            const structureDir = d.pathModule.join(__dirname, '..', '..', 'data', 'structure');
            const filePath = d.pathModule.join(structureDir, filename);
            const resolvedPath = d.pathModule.resolve(filePath);
            const resolvedDir = d.pathModule.resolve(structureDir);
            if (!resolvedPath.startsWith(resolvedDir + d.pathModule.sep)) {
                logAdminFailure('admin.structure_file_download', req, '文件:' + filename, 'invalid_path');
                return res.status(400).json({ code: 400, msg: '非法文件路径' });
            }
            if (!d.fs.existsSync(filePath)) {
                logAdminFailure('admin.structure_file_download', req, '文件:' + filename, 'file_not_found');
                return res.status(404).json({ code: 404, msg: '文件不存在' });
            }
            d.logStore.append('admin.structure_file_download', { admin: req.user.uid, ip: d.getClientIp(req), target: '文件:' + filename, detail: '' });
            res.download(filePath, filename);
        } catch (e) {
            logAdminFailure('admin.structure_file_download', req, String(req.params.filename || ''), 'exception: ' + e.message, 'err');
            res.status(500).json({ code: 500, msg: '下载建筑文件失败: ' + e.message});
        }
    });

    // 删除建筑文件
    router.delete('/structure/:filename', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            const filename = req.params.filename;
            // 路径穿越防护
            if (!filename || filename.indexOf('..') !== -1 || filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1 || filename.indexOf('\0') !== -1) {
                logAdminFailure('admin.structure_file_delete', req, '文件:' + filename, 'invalid_filename');
                return res.status(400).json({ code: 400, msg: '文件名不合法' });
            }
            const ln = filename.toLowerCase();
            if (!ln.endsWith('.nbt') && !ln.endsWith('.mcstructure')) {
                logAdminFailure('admin.structure_file_delete', req, '文件:' + filename, 'invalid_extension');
                return res.status(400).json({ code: 400, msg: '只能删除.nbt或.mcstructure建筑文件' });
            }
            const structureDir = d.pathModule.join(__dirname, '..', '..', 'data', 'structure');
            const filePath = d.pathModule.join(structureDir, filename);
            if (!d.fs.existsSync(filePath)) {
                logAdminFailure('admin.structure_file_delete', req, '文件:' + filename, 'file_not_found');
                return res.status(404).json({ code: 404, msg: '文件不存在' });
            }
            try {
                d.fs.unlinkSync(filePath);
            } catch (e) {
                logAdminFailure('admin.structure_file_delete', req, '文件:' + filename, 'unlink_failed: ' + e.message, 'err');
                return res.status(500).json({ code: 500, msg: '删除文件失败: ' + e.message});
            }
            d.logStore.append('admin.structure_file_delete', { admin: req.user.uid, ip: d.getClientIp(req), target: '文件:' + filename, detail: '' });
            res.json({ code: 200, msg: '建筑文件已删除' });
        } catch (e) {
            logAdminFailure('admin.structure_file_delete', req, String(req.params.filename || ''), 'exception: ' + e.message, 'err');
            res.status(500).json({ code: 500, msg: '删除建筑文件失败: ' + e.message});
        }
    });

    // 上传建筑文件（需验证文件格式）
    router.post('/structure/upload', d.adminAuth, d.writeLimiter, function(req, res) {
        var upload = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: STRUCTURE_MAX_FILE_SIZE, files: 1 }
        });
        upload.single('file')(req, res, function(err) {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    logAdminFailure('admin.structure_file_upload', req, '', 'file_too_large');
                    return res.status(400).json({ code: 400, msg: '文件大小超过限制，最大 64MB' });
                }
                logAdminFailure('admin.structure_file_upload', req, '', 'upload_error: ' + err.message);
                return res.status(400).json({ code: 400, msg: '上传失败: ' + err.message });
            }
            try {
                var file = req.file;
                if (!file) {
                    logAdminFailure('admin.structure_file_upload', req, '', 'no_file');
                    return res.status(400).json({ code: 400, msg: '未选择文件' });
                }
                var filename = file.originalname || '';
                if (!filename) {
                    logAdminFailure('admin.structure_file_upload', req, '', 'invalid_filename');
                    return res.status(400).json({ code: 400, msg: '文件名不合法' });
                }
                var ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
                if (ext !== '.mcstructure' && ext !== '.nbt') {
                    logAdminFailure('admin.structure_file_upload', req, '文件:' + filename, 'invalid_extension');
                    return res.status(400).json({ code: 400, msg: '仅支持 .mcstructure 或 .nbt 建筑文件' });
                }
                if (ext === '.mcstructure') {
                    if (!validateMcstructure(file.buffer)) {
                        logAdminFailure('admin.structure_file_upload', req, '文件:' + filename, 'invalid_mcstructure');
                        return res.status(400).json({ code: 400, msg: '文件内容不是有效的 .mcstructure 结构文件' });
                    }
                } else {
                    if (!validateNbt(file.buffer)) {
                        logAdminFailure('admin.structure_file_upload', req, '文件:' + filename, 'invalid_nbt');
                        return res.status(400).json({ code: 400, msg: '文件内容不是有效的 .nbt 结构文件' });
                    }
                }
                var structureDir = d.pathModule.join(__dirname, '..', '..', 'data', 'structure');
                if (!d.fs.existsSync(structureDir)) {
                    d.fs.mkdirSync(structureDir, { recursive: true });
                }
                // 文件名消毒并处理重名
                var safeName = String(filename).replace(/[\\/:*?"<>|\0]/g, '_').trim();
                var finalName = safeName;
                var counter = 1;
                var base = safeName.substring(0, safeName.length - ext.length);
                while (d.fs.existsSync(d.pathModule.join(structureDir, finalName))) {
                    finalName = base + '_' + counter + ext;
                    counter++;
                }
                var filePath = d.pathModule.join(structureDir, finalName);
                d.fs.writeFileSync(filePath, file.buffer);
                d.logStore.append('admin.structure_file_upload', { admin: req.user.uid, ip: d.getClientIp(req), target: '文件:' + finalName + ' 大小:' + formatFileSize(file.size), detail: '' });
                res.json({ code: 200, msg: '上传成功', data: { filename: finalName, size: file.size } });
            } catch (e) {
                logAdminFailure('admin.structure_file_upload', req, '', 'exception: ' + e.message, 'err');
                res.status(500).json({ code: 500, msg: '上传建筑文件失败: ' + e.message });
            }
        });
    });

    // 执行数据备份（打包data目录）
    router.post('/backup/data', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            d.backupModule.executeDataBackup(function(err, result) {
                if (err) {
                    res.status(500).json({ code: 500, msg: '数据备份失败: ' + (err.error || err.message || '未知错误') });
                    return;
                }
                d.logStore.append('admin.data_backup', { admin: req.user.uid, ip: d.getClientIp(req), target: '文件:' + result.filename, detail: '' });
                res.json({ code: 200, msg: '数据备份完成', data: result });
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '数据备份失败: ' + e.message});
        }
    });

    // 获取封禁列表
    router.get('/ban/list', d.adminAuth, function(req, res) {
        try {
            const list = d.banModule.apiGetBanList();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取封禁列表失败: ' + e.message});
        }
    });

    // 封禁玩家
    router.post('/ban', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            let xuid = (req.body.xuid || '').trim();
            const reason = (req.body.reason || '').trim() || 'Web管理面板封禁';
            const operator = (req.body.operator || '').trim() || 'Web管理面板';

            if (!xuid) return res.status(400).json({ code: 400, msg: '缺少xuid参数' });

            let result = d.banModule.apiBan(xuid, reason, operator);
            if (result.success) {
                d.logStore.append('admin.ban', { admin: req.user.uid, ip: d.getClientIp(req), target: xuid, detail: '原因: ' + reason });
                const playerName = d.getPlayerName(xuid) || xuid;
                res.json({ code: 200, msg: result.message, data: { xuid: result.xuid, name: playerName, isBanned: true } });
            } else {
                res.status(400).json({ code: 400, msg: result.message });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '封禁操作失败: ' + e.message});
        }
    });

    // 解封玩家
    router.post('/unban', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            const xuid = (req.body.xuid || '').trim();
            if (!xuid) return res.status(400).json({ code: 400, msg: '缺少xuid参数' });

            let result = d.banModule.apiUnban(xuid);
            if (result.success) {
                d.logStore.append('admin.unban', { admin: req.user.uid, ip: d.getClientIp(req), target: xuid, detail: '' });
                const playerName = d.getPlayerName(xuid) || xuid;
                res.json({ code: 200, msg: result.message, data: { xuid: xuid, name: playerName, isBanned: false } });
            } else {
                res.status(400).json({ code: 400, msg: result.message });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '解封操作失败: ' + e.message});
        }
    });

    // 查询指定玩家是否被封禁
    router.get('/ban/check', d.adminAuth, function(req, res) {
        try {
            const xuid = (req.query.xuid || '').trim();
            const ip = (req.query.ip || '').trim();
            if (!xuid) return res.status(400).json({ code: 400, msg: '缺少xuid参数' });

            const result = d.banModule.apiIsBanned(xuid, ip);
            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '查询封禁状态失败: ' + e.message});
        }
    });

    // ==================== 玩家人数统计接口 ====================

    // 获取当前在线人数和今日统计
    router.get('/server/playerCount', d.adminAuth, function(req, res) {
        try {
            const stats = d.monitoring.getPlayerCountStats();
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取人数统计失败: ' + e.message});
        }
    });

    // 查询玩家人数趋势
    router.get('/server/playerCount/trend', d.adminAuth, function(req, res) {
        try {
            const range = (req.query.range || '24h').toLowerCase();
            const now = Math.floor(Date.now() / 1000);
            var startTime;

            switch (range) {
                case '1h': startTime = now - 3600; break;
                case '6h': startTime = now - 21600; break;
                case '7d': startTime = now - 604800; break;
                case '24h':
                default:   startTime = now - 86400; break;
            }

            const records = d.monitoring.getPlayerCountTrend(startTime, now);
            res.json({
                code: 200,
                data: {
                    range: range,
                    startTime: startTime,
                    endTime: now,
                    records: records
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取人数趋势失败: ' + e.message});
        }
    });

    // 查询玩家人数历史
    router.get('/server/playerCount/history', d.adminAuth, function(req, res) {
        try {
            var startTime = parseInt(req.query.start);
            var endTime = parseInt(req.query.end);

            if (isNaN(startTime) || isNaN(endTime)) {
                res.status(400).json({ code: 400, msg: '缺少start或end参数（Unix时间戳秒）' });
                return;
            }
            if (startTime >= endTime) {
                res.status(400).json({ code: 400, msg: 'start必须小于end' });
                return;
            }
            // 限制查询范围不超过30天
            if (endTime - startTime > 30 * 86400) {
                res.status(400).json({ code: 400, msg: '查询范围不能超过30天' });
                return;
            }

            const records = d.monitoring.getPlayerCountTrend(startTime, endTime);
            res.json({
                code: 200,
                data: {
                    startTime: startTime,
                    endTime: endTime,
                    records: records
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取人数历史失败: ' + e.message});
        }
    });

    // ===== 称号管理 =====

    // 获取指定玩家的称号列表
    router.get('/players/:xuid/titles', d.adminAuth, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var owned = d.chatModule.getPlayerOwnedTitles(xuid);
            var active = d.chatModule.getPlayerActiveTitle(xuid);
            res.json({ code: 200, data: { xuid: xuid, owned: owned, active: active } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取玩家称号失败: ' + e.message});
        }
    });

    // 为指定玩家添加称号
    router.post('/players/:xuid/titles', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var title = (req.body.title || '').trim();
            if (!title) {
                return res.status(400).json({ code: 400, msg: '称号不能为空' });
            }
            var playerData = d.getPlayerData();
            if (!playerData || !playerData.players || !playerData.players[xuid]) {
                return res.status(404).json({ code: 404, msg: '玩家不存在' });
            }
            d.chatModule.addPlayerTitle(xuid, title);
            d.logStore.append('admin.title_add', { admin: req.user.uid, ip: d.getClientIp(req), target: '玩家XUID:' + xuid + ' 称号:' + title, detail: '' });
            res.json({ code: 200, msg: '称号添加成功', data: { xuid: xuid, title: title } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加称号失败: ' + e.message});
        }
    });

    // 设置玩家当前使用的称号
    router.put('/players/:xuid/titles/active', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var title = (req.body.title || '').trim();
            if (!title) {
                return res.status(400).json({ code: 400, msg: '称号不能为空' });
            }
            var ok = d.chatModule.setActiveTitle(xuid, title);
            if (!ok) {
                return res.status(400).json({ code: 400, msg: '该玩家未拥有此称号' });
            }
            d.logStore.append('admin.title_set', { admin: req.user.uid, ip: d.getClientIp(req), target: '玩家XUID:' + xuid + ' 称号:' + title, detail: '' });
            res.json({ code: 200, msg: '称号设置成功', data: { xuid: xuid, active: title } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '设置称号失败: ' + e.message});
        }
    });

    // 删除玩家的指定称号
    router.delete('/players/:xuid/titles/:title', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var title = req.params.title;
            if (d.chatModule.removePlayerTitle(xuid, title)) {
                d.logStore.append('admin.title_delete', { admin: req.user.uid, ip: d.getClientIp(req), target: '玩家XUID:' + xuid + ' 称号:' + title, detail: '' });
                res.json({ code: 200, msg: '称号删除成功' });
            } else {
                res.status(404).json({ code: 404, msg: '该玩家未拥有此称号' });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除称号失败: ' + e.message});
        }
    });

    // ===== 经济日志查询 =====

    // 查询指定玩家的经济日志
    router.get('/economy/log/:playerName', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            var playerName = req.params.playerName;
            var page = parseInt(req.query.page) || 1;
            var pageSize = Math.min(parseInt(req.query.pageSize) || 50, 200);
            var date = req.query.date || ''; // 可选日期筛选 YYYY-MM-DD

            // 验证日期格式，防止路径穿越
            if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ code: 400, msg: '日期格式无效，需为 YYYY-MM-DD' });
            }

            // 验证玩家名称，只允许字母数字和下划线
            if (playerName && !/^[a-zA-Z0-9_一-龥]{1,32}$/.test(playerName)) {
                return res.status(400).json({ code: 400, msg: '玩家名称格式无效' });
            }

            // 确定要读取的日志日期（未指定时最多读最近7天）
            var dates = date ? [date] : d.logStore.listDates().slice(0, 7);

            // 读取并筛选指定玩家的日志
            var allLogs = [];
            dates.forEach(function(dateStr) {
                d.logStore.readEntries(dateStr).forEach(function(entry) {
                    if (!d.logStore.matchesEvent(entry.event, 'economy.')) return;
                    if (entry.player === playerName || entry.target === playerName) {
                        allLogs.push(entry);
                    }
                });
            });

            // 按时间倒序排列
            allLogs.sort(function(a, b) { return (b.time || '').localeCompare(a.time || ''); });

            var total = allLogs.length;
            var start = (page - 1) * pageSize;
            var paged = allLogs.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    logs: paged,
                    total: total,
                    page: page,
                    pageSize: pageSize,
                    totalPages: Math.ceil(total / pageSize)
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '查询经济日志失败: ' + e.message});
        }
    });

    // 查询玩家全部经济变动（用于经济管理折线图和交易列表）
    router.get('/economy/history/:xuid', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            var xuid = String(req.params.xuid || '').trim();
            if (!xuid) {
                return res.status(400).json({ code: 400, msg: '请提供玩家XUID' });
            }
            var playerName = d.getPlayerName(xuid) || '';

            var points = [];
            var dates = d.logStore.listDates();
            dates.forEach(function(dateStr) {
                d.logStore.readEntries(dateStr).forEach(function(entry) {
                    if (!d.logStore.matchesEvent(entry.event, 'economy.')) return;
                    var matched = (entry.xuid && String(entry.xuid) === xuid)
                        || (playerName && entry.player === playerName)
                        || (playerName && entry.target === playerName);
                    if (!matched) return;

                    var action = entry.action || '';
                    var rawAmount = typeof entry.amount === 'number' ? entry.amount
                        : (typeof entry.price === 'number' ? entry.price : 0);
                    var negative = action === 'reduce' || action === 'buy' || action === 'transfer';
                    points.push({
                        time: entry.time || '',
                        ts: d.logStore.parseTimeToMillis(entry.time),
                        date: dateStr,
                        event: entry.event || '',
                        action: action,
                        item: entry.item || '',
                        target: entry.target || '',
                        amount: rawAmount,
                        delta: negative ? -rawAmount : rawAmount,
                        balance: typeof entry.balance === 'number' ? entry.balance : null,
                        source: entry.reason || entry.detail || entry.item || action || entry.event || ''
                    });
                });
            });

            points.sort(function(a, b) {
                return (a.ts - b.ts) || String(a.time).localeCompare(String(b.time));
            });

            var total = points.length;
            var truncated = false;
            if (points.length > 5000) {
                points = points.slice(points.length - 5000);
                truncated = true;
            }

            res.json({
                code: 200,
                data: {
                    player: { xuid: xuid, name: playerName },
                    points: points,
                    total: total,
                    truncated: truncated
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '查询经济变动失败: ' + e.message});
        }
    });

    // ==================== 危险操作接口（需要二次验证码） ====================

    // 删除玩家所有数据（需要二次验证码验证）
    router.post('/admin/player/delete-all', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            var xuid = req.body.xuid;
            var captchaId = req.body.captchaId;
            var captchaCode = req.body.captchaCode;

            if (!xuid) {
                return res.status(400).json({ code: 400, msg: '请提供玩家XUID' });
            }
            if (!captchaId || !captchaCode) {
                return res.status(400).json({ code: 400, msg: '需要验证码确认此危险操作' });
            }

            // 验证验证码
            if (!d.database.verifyCaptcha(captchaId, captchaCode, req.ip)) {
                return res.status(400).json({ code: 400, msg: '验证码错误或已过期' });
            }

            // 检查玩家是否存在
            var playerData = d.database.getPlayerDataSQL(xuid);
            if (!playerData) {
                return res.status(404).json({ code: 404, msg: '未找到该玩家数据' });
            }

            var playerName = playerData.name || xuid;

            // 清空玩家余额（LLMoney）
            if (d.money) {
                try {
                    var balance = d.money.get(xuid) || 0;
                    if (balance > 0) {
                        d.money.reduce(xuid, balance);
                    }
                } catch (e) {}
            }

            // 删除玩家核心数据
            d.database.deletePlayerDataSQL(xuid);

            // 删除玩家设置
            d.database.deletePlayerSettingsSQL(xuid);

            // 删除死亡点
            d.database.deleteDeathPointsSQL(xuid);

            // 删除好友关系
            d.database.deleteFriendsSQL(xuid);
            d.database.deleteFriendRequestsSQL(xuid);

            // 删除私信
            d.database.deleteMessagesSQL(xuid);

            // 删除家园
            d.database.deleteHomesSQL(xuid);

            // 删除背包快照
            d.database.deletePlayerInventorySQL(xuid);

            // 从公会中移除玩家
            try {
                var guild = d.database.getGuildByPlayer(xuid);
                if (guild) {
                    d.database.removeGuildMember(xuid);
                }
            } catch (e) {}

            // 记录管理员操作
            d.logStore.append('admin.player_data_delete', { admin: req.user.uid, ip: d.getClientIp(req), target: '玩家:' + playerName + ' XUID:' + xuid, detail: '' });

            // 从内存中移除
            if (d.getPlayerData && d.getPlayerData().players) {
                delete d.getPlayerData().players[xuid];
            }

            res.json({ code: 200, msg: '玩家"' + playerName + '"的所有数据已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除玩家数据失败: ' + e.message});
        }
    });

    // 生成删除玩家数据的验证码
    router.get('/admin/player/delete-captcha', d.adminAuth, d.captchaLimiter, function(req, res) {
        try {
            var captcha = d.svgCaptcha.create({
                size: 4,
                width: 120,
                height: 40,
                fontSize: 36
            });

            var captchaId = d.database.generateCaptcha(captcha.text, req.ip);

            res.json({
                code: 200,
                data: {
                    captchaId: captchaId,
                    svg: captcha.data
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '生成验证码失败: ' + e.message});
        }
    });

    // ==================== 维护模式 API ====================

    // 查询维护模式状态
    router.get('/maintenance/status', d.adminAuth, function(req, res) {
        try {
            if (!d.getMaintenanceMode) {
                return res.status(500).json({ code: 500, msg: 'Maintenance mode function not available' });
            }
            var status = d.getMaintenanceMode();
            var onlineCount = 0;
            try {
                onlineCount = d.mc.getOnlinePlayers().length;
            } catch (e) {}
            res.json({
                code: 200,
                data: {
                    enabled: status.enabled,
                    reason: status.reason || '',
                    onlinePlayers: onlineCount
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: 'Failed to get maintenance status: ' + e.message });
        }
    });

    // 切换维护模式
    router.post('/maintenance/toggle', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            if (!d.setMaintenanceMode) {
                return res.status(500).json({ code: 500, msg: 'Maintenance mode function not available' });
            }
            var enable = req.body.enable;
            var reason = req.body.reason || '';

            if (typeof enable !== 'boolean') {
                return res.status(400).json({ code: 400, msg: 'Missing or invalid "enable" field (boolean required)' });
            }

            var result = d.setMaintenanceMode(enable, reason);
            d.logStore.append(enable ? 'admin.maintenance_enable' : 'admin.maintenance_disable', { admin: req.user.uid, ip: d.getClientIp(req), target: reason || 'No reason', detail: '' });

            res.json({
                code: 200,
                msg: enable ? 'Maintenance mode enabled' : 'Maintenance mode disabled',
                data: result
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: 'Failed to toggle maintenance mode: ' + e.message });
        }
    });

    // 雷劈致死 - 对在线玩家持续雷劈直到死亡或切换创造模式
    var lightningTargets = {};

    function stopLightning(name) {
        if (lightningTargets[name]) {
            clearInterval(lightningTargets[name]);
            delete lightningTargets[name];
        }
    }

    // 全局监听重生事件，重生即停止雷劈
    mc.listen('onRespawn', function(player) {
        if (lightningTargets[player.name]) {
            stopLightning(player.name);
        }
    });

    router.post('/lightning', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            var targetName = req.body.player;
            if (!targetName) {
                return res.status(400).json({ code: 400, msg: '缺少 player 参数' });
            }

            // 检查目标是否在线
            var players = d.mc.getOnlinePlayers();
            var targetPlayer = null;
            for (var i = 0; i < players.length; i++) {
                if (players[i].name === targetName) {
                    targetPlayer = players[i];
                    break;
                }
            }
            if (!targetPlayer) {
                return res.status(404).json({ code: 404, msg: '玩家不在线: ' + targetName });
            }

            // 创造模式不能雷劈
            if (targetPlayer.gameMode === 1) {
                return res.status(400).json({ code: 400, msg: '创造模式玩家无法雷劈' });
            }

            // 如果已经在雷劈中，取消
            if (lightningTargets[targetName]) {
                stopLightning(targetName);
                return res.json({ code: 200, msg: '已取消对 ' + targetName + ' 的雷劈' });
            }

            // 记录上一次血量，用于检测死亡
            var lastHealth = targetPlayer.health;

            // 开始雷劈
            lightningTargets[targetName] = setInterval(function() {
                try {
                    var p = null;
                    var online = d.mc.getOnlinePlayers();
                    for (var j = 0; j < online.length; j++) {
                        if (online[j].name === targetName) {
                            p = online[j];
                            break;
                        }
                    }

                    // 玩家离线，停止
                    if (!p) {
                        stopLightning(targetName);
                        return;
                    }

                    // 切换创造模式，停止
                    if (p.gameMode === 1) {
                        stopLightning(targetName);
                        return;
                    }

                    // 血量从有变无（死亡），停止
                    if (lastHealth > 0 && p.health <= 0) {
                        stopLightning(targetName);
                        return;
                    }

                    lastHealth = p.health;

                    // 召唤闪电
                    d.mc.runcmdEx('execute as "' + targetName + '" at @s run summon lightning_bolt ~ ~ ~');
                } catch (e) {
                    stopLightning(targetName);
                }
            }, 500);

            d.logStore.append('admin.smite', { admin: req.user.uid, ip: d.getClientIp(req), target: targetName, detail: '' });
            res.json({ code: 200, msg: '已开始雷劈 ' + targetName });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '雷劈失败: ' + e.message });
        }
    });
}

/**
 * 格式化字节数为可读字符串
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
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

module.exports = { registerRoutes };
