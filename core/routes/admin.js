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
 * NLCE Web路由 - 管理面板
 * 处理备份管理和封禁管理相关路由
 * 备份使用7z压缩，封禁支持按XUID或IP识别
 */

function registerRoutes(router, d) {

    // 获取备份统计信息（为每个备份文件附加下载URL）
    router.get('/backup/stats', d.adminAuth, function(req, res) {
        try {
            const stats = d.backupModule.getBackupStats();
            if (stats.backups) {
                stats.backups.forEach(function(b) {
                    b.downloadUrl = '/api/v1/backup/download/' + encodeURIComponent(b.filename);
                });
            }
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份统计失败: ' + e.message });
        }
    });

    // 获取备份文件列表（含下载链接）
    router.get('/backup/list', d.adminAuth, function(req, res) {
        try {
            const backups = d.backupModule.getBackupList();
            backups.forEach(function(b) {
                b.downloadUrl = '/api/v1/backup/download/' + encodeURIComponent(b.filename);
            });
            res.json({ code: 200, data: backups });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份列表失败: ' + e.message });
        }
    });

    // 手动触发备份（异步执行，通过回调返回结果）
    router.post('/backup/execute', d.adminAuth, function(req, res) {
        try {
            // 防止并发备份
            if (d.backupModule.isBackupRunning()) {
                return res.json({ code: 400, msg: '备份正在进行中，请稍后再试' });
            }
            d.adminLog.log(req.user.uid, '执行备份', '手动触发');
            d.backupModule.executeBackup(function(err, result) {
                if (err) {
                    res.json({ code: 500, msg: err.error || '备份失败' });
                } else {
                    res.json({ code: 200, msg: '备份完成', data: result });
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '备份失败: ' + e.message });
        }
    });

    // 查询备份是否正在执行
    router.get('/backup/status', d.adminAuth, function(req, res) {
        try {
            res.json({ code: 200, data: { isRunning: d.backupModule.isBackupRunning() } });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份状态失败: ' + e.message });
        }
    });

    // 删除指定备份文件
    router.delete('/backup/:filename', d.adminAuth, function(req, res) {
        try {
            let filename = req.params.filename;
            let result = d.backupModule.deleteBackup(filename);
            if (result.success) {
                d.adminLog.log(req.user.uid, '删除备份', '文件:' + filename);
                res.json({ code: 200, msg: '备份已删除' });
            } else {
                res.json({ code: 400, msg: result.error });
            }
        } catch (e) {
            res.json({ code: 500, msg: '删除备份失败: ' + e.message });
        }
    });

    // 下载备份文件（校验文件名防路径穿越，仅允许.7z文件）
    router.get('/backup/download/:filename', d.adminAuth, d.backupDownloadLimiter, function(req, res) {
        try {
            const filename = req.params.filename;
            // 防止路径穿越攻击
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                return res.json({ code: 400, msg: '非法文件名' });
            }
            if (!filename.endsWith('.7z')) {
                return res.json({ code: 400, msg: '只能下载.7z备份文件' });
            }
            const backupDir = d.backupModule.getBackupDir();
            const filePath = d.pathModule.join(backupDir, filename);
            if (!d.fs.existsSync(filePath)) {
                return res.json({ code: 404, msg: '文件不存在' });
            }
            res.download(filePath, filename);
        } catch (e) {
            res.json({ code: 500, msg: '下载备份失败: ' + e.message });
        }
    });

    // 获取备份配置（压缩等级、定时间隔、保留天数、最大数量）
    router.get('/backup/config', d.adminAuth, function(req, res) {
        try {
            let cfg = d.backupModule.getConfig();
            res.json({ code: 200, data: cfg });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份配置失败: ' + e.message });
        }
    });

    // 更新备份配置（数值边界限制后写入config.json并重载备份模块）
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

            const MAIN_CONFIG_PATH = d.pathModule.join(__dirname, '..', '..', 'config.json');
            try {
                const mainCfg = JSON.parse(d.fs.readFileSync(MAIN_CONFIG_PATH, 'utf-8'));
                mainCfg.backupConfig = cfg;
                d.fs.writeFileSync(MAIN_CONFIG_PATH, JSON.stringify(mainCfg, null, 4), 'utf-8');
            } catch (e) {
                return res.json({ code: 500, msg: '保存配置文件失败: ' + e.message });
            }

            d.backupModule.reload(cfg);
            d.adminLog.log(req.user.uid, '修改备份配置', JSON.stringify(cfg));
            res.json({ code: 200, msg: '备份配置已更新', data: cfg });
        } catch (e) {
            res.json({ code: 500, msg: '更新备份配置失败: ' + e.message });
        }
    });

    // 获取封禁列表（含封禁原因和操作人）
    router.get('/ban/list', d.adminAuth, function(req, res) {
        try {
            const list = d.banModule.apiGetBanList();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取封禁列表失败: ' + e.message });
        }
    });

    // 封禁玩家（支持按XUID、名称或IP识别）
    router.post('/ban', d.adminAuth, function(req, res) {
        try {
            let identifier = (req.body.identifier || '').trim();
            const reason = (req.body.reason || '').trim() || 'Web管理面板封禁';
            const operator = (req.body.operator || '').trim() || 'Web管理面板';

            if (!identifier) return res.json({ code: 400, msg: '缺少identifier参数' });

            let result = d.banModule.apiBan(identifier, reason, operator);
            if (result.success) {
                d.adminLog.log(req.user.uid, '封禁玩家', identifier, '原因: ' + reason);
            }
            res.json({ code: result.success ? 200 : 400, msg: result.message, data: result.success ? { xuid: result.xuid } : null });
        } catch (e) {
            res.json({ code: 500, msg: '封禁操作失败: ' + e.message });
        }
    });

    // 解封玩家（支持按XUID、名称或IP识别）
    router.post('/unban', d.adminAuth, function(req, res) {
        try {
            const identifier = (req.body.identifier || '').trim();
            if (!identifier) return res.json({ code: 400, msg: '缺少identifier参数' });

            let result = d.banModule.apiUnban(identifier);
            if (result.success) {
                d.adminLog.log(req.user.uid, '解封玩家', identifier);
            }
            res.json({ code: result.success ? 200 : 400, msg: result.message });
        } catch (e) {
            res.json({ code: 500, msg: '解封操作失败: ' + e.message });
        }
    });

    // 查询指定玩家是否被封禁（可同时传入XUID和IP进行联合判断）
    router.get('/ban/check', d.adminAuth, function(req, res) {
        try {
            const xuid = (req.query.xuid || '').trim();
            const ip = (req.query.ip || '').trim();
            if (!xuid) return res.json({ code: 400, msg: '缺少xuid参数' });

            const result = d.banModule.apiIsBanned(xuid, ip);
            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '查询封禁状态失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
