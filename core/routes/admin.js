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
 * NECE Web路由 - 管理面板
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
            res.status(500).json({ code: 500, msg: '获取备份统计失败: ' + e.message });
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
            res.status(500).json({ code: 500, msg: '获取备份列表失败: ' + e.message });
        }
    });

    // 手动触发备份（异步执行，通过回调返回结果）
    router.post('/backup/execute', d.adminAuth, function(req, res) {
        try {
            // 防止并发备份
            if (d.backupModule.isBackupRunning()) {
                return res.status(400).json({ code: 400, msg: '备份正在进行中，请稍后再试' });
            }
            d.adminLog.log(req.user.uid, '执行备份', '手动触发');
            d.backupModule.executeBackup(function(err, result) {
                if (err) {
                    res.status(500).json({ code: 500, msg: err.error || '备份失败' });
                } else {
                    res.json({ code: 200, msg: '备份完成', data: result });
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '备份失败: ' + e.message });
        }
    });

    // 查询备份是否正在执行
    router.get('/backup/status', d.adminAuth, function(req, res) {
        try {
            res.json({ code: 200, data: { isRunning: d.backupModule.isBackupRunning() } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份状态失败: ' + e.message });
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
                res.status(400).json({ code: 400, msg: result.error });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除备份失败: ' + e.message });
        }
    });

    // 下载备份文件（校验文件名防路径穿越，仅允许.7z文件）
    router.get('/backup/download/:filename', d.adminAuth, d.backupDownloadLimiter, function(req, res) {
        try {
            const filename = req.params.filename;
            // 防止路径穿越攻击（含 null 字节注入）
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
                return res.status(400).json({ code: 400, msg: '非法文件名' });
            }
            if (!filename.endsWith('.7z')) {
                return res.status(400).json({ code: 400, msg: '只能下载.7z备份文件' });
            }
            const backupDir = d.backupModule.getBackupDir();
            const filePath = d.pathModule.join(backupDir, filename);
            if (!d.fs.existsSync(filePath)) {
                return res.status(404).json({ code: 404, msg: '文件不存在' });
            }
            res.download(filePath, filename);
        } catch (e) {
            res.status(500).json({ code: 500, msg: '下载备份失败: ' + e.message });
        }
    });

    // 获取备份配置（压缩等级、定时间隔、保留天数、最大数量）
    router.get('/backup/config', d.adminAuth, function(req, res) {
        try {
            let cfg = d.backupModule.getConfig();
            res.json({ code: 200, data: cfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份配置失败: ' + e.message });
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
                mainCfg.backup = cfg;
                d.fs.writeFileSync(MAIN_CONFIG_PATH, JSON.stringify(mainCfg, null, 4), 'utf-8');
            } catch (e) {
                return res.status(500).json({ code: 500, msg: '保存配置文件失败: ' + e.message });
            }

            d.backupModule.reload(cfg);
            d.adminLog.log(req.user.uid, '修改备份配置', JSON.stringify(cfg));
            res.json({ code: 200, msg: '备份配置已更新', data: cfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新备份配置失败: ' + e.message });
        }
    });

    // 获取封禁列表（含封禁原因和操作人）
    router.get('/ban/list', d.adminAuth, function(req, res) {
        try {
            const list = d.banModule.apiGetBanList();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取封禁列表失败: ' + e.message });
        }
    });

    // 封禁玩家（支持按XUID、名称或IP识别）
    router.post('/ban', d.adminAuth, function(req, res) {
        try {
            let identifier = (req.body.identifier || '').trim();
            const reason = (req.body.reason || '').trim() || 'Web管理面板封禁';
            const operator = (req.body.operator || '').trim() || 'Web管理面板';

            if (!identifier) return res.status(400).json({ code: 400, msg: '缺少identifier参数' });

            let result = d.banModule.apiBan(identifier, reason, operator);
            if (result.success) {
                d.adminLog.log(req.user.uid, '封禁玩家', identifier, '原因: ' + reason);
            }
            res.json({ code: result.success ? 200 : 400, msg: result.message, data: result.success ? { xuid: result.xuid } : null });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '封禁操作失败: ' + e.message });
        }
    });

    // 解封玩家（支持按XUID、名称或IP识别）
    router.post('/unban', d.adminAuth, function(req, res) {
        try {
            const identifier = (req.body.identifier || '').trim();
            if (!identifier) return res.status(400).json({ code: 400, msg: '缺少identifier参数' });

            let result = d.banModule.apiUnban(identifier);
            if (result.success) {
                d.adminLog.log(req.user.uid, '解封玩家', identifier);
            }
            res.json({ code: result.success ? 200 : 400, msg: result.message });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '解封操作失败: ' + e.message });
        }
    });

    // 查询指定玩家是否被封禁（可同时传入XUID和IP进行联合判断）
    router.get('/ban/check', d.adminAuth, function(req, res) {
        try {
            const xuid = (req.query.xuid || '').trim();
            const ip = (req.query.ip || '').trim();
            if (!xuid) return res.status(400).json({ code: 400, msg: '缺少xuid参数' });

            const result = d.banModule.apiIsBanned(xuid, ip);
            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '查询封禁状态失败: ' + e.message });
        }
    });

    // ==================== 玩家人数统计接口 ====================

    // 获取当前在线人数和今日统计
    router.get('/server/playerCount', d.adminAuth, function(req, res) {
        try {
            const stats = d.monitoring.getPlayerCountStats();
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取人数统计失败: ' + e.message });
        }
    });

    // 查询玩家人数趋势（预设时间范围）
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
            res.status(500).json({ code: 500, msg: '获取人数趋势失败: ' + e.message });
        }
    });

    // ==================== ClearLag 实体清理接口 ====================

    // 获取清理配置
    router.get('/clearlag/config', d.adminAuth, function(req, res) {
        try {
            let content = d.fs.readFileSync(d.pathModule.join(__dirname, '..', '..', 'config.json'), 'utf-8');
            let cfg = JSON.parse(content);
            let clearLagCfg = cfg.clearLag || {};
            res.json({ code: 200, data: clearLagCfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取清理配置失败: ' + e.message });
        }
    });

    // 修改清理配置（部分更新）
    router.put('/clearlag/config', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            let CONFIG_PATH = d.pathModule.join(__dirname, '..', '..', 'config.json');
            let content = d.fs.readFileSync(CONFIG_PATH, 'utf-8');
            let cfg = JSON.parse(content);
            if (!cfg.clearLag) cfg.clearLag = {};
            var clCfg = cfg.clearLag;
            if (req.body.enabled !== undefined) clCfg.enabled = !!req.body.enabled;
            if (req.body.interval !== undefined) {
                let v = parseInt(req.body.interval);
                if (isNaN(v) || v < 60) return res.status(400).json({ code: 400, msg: 'interval必须>=60秒' });
                clCfg.interval = v;
            }
            if (req.body.reminderSeconds !== undefined) {
                let v = parseInt(req.body.reminderSeconds);
                if (isNaN(v) || v < 0) return res.status(400).json({ code: 400, msg: 'reminderSeconds必须为非负整数' });
                clCfg.reminderSeconds = v;
            }
            if (req.body.message !== undefined) clCfg.message = req.body.message;
            if (req.body.cleanMessage !== undefined) clCfg.cleanMessage = req.body.cleanMessage;
            if (req.body.cleanTypes !== undefined) {
                if (!Array.isArray(req.body.cleanTypes)) return res.status(400).json({ code: 400, msg: 'cleanTypes必须为数组' });
                clCfg.cleanTypes = req.body.cleanTypes;
            }
            if (req.body.maxEntitiesPerType !== undefined) {
                let v = parseInt(req.body.maxEntitiesPerType);
                if (isNaN(v) || v < 1) return res.status(400).json({ code: 400, msg: 'maxEntitiesPerType必须为正整数' });
                clCfg.maxEntitiesPerType = v;
            }
            cfg.clearLag = clCfg;
            d.fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
            d.triggerReload('config');
            d.adminLog.log(req.user.uid, '修改清理配置', JSON.stringify(clCfg));
            res.json({ code: 200, msg: '清理配置已更新', data: clCfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新清理配置失败: ' + e.message });
        }
    });

    // 获取当前实体统计
    router.get('/clearlag/stats', d.adminAuth, function(req, res) {
        try {
            let stats = d.clearLagModule.getStats();
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取实体统计失败: ' + e.message });
        }
    });

    // 手动触发清理
    router.post('/clearlag/execute', d.adminAuth, function(req, res) {
        try {
            let result = d.clearLagModule.executeCleanup();
            d.adminLog.log(req.user.uid, '手动触发清理', '清理了' + result.killed + '个实体');
            res.json({ code: 200, msg: '清理完成', data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '执行清理失败: ' + e.message });
        }
    });

    // 查询玩家人数历史（自定义时间段）
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
            res.status(500).json({ code: 500, msg: '获取人数历史失败: ' + e.message });
        }
    });

    // ===== 称号管理 =====

    // 获取指定玩家的称号列表
    router.get('/player/:xuid/titles', d.adminAuth, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var owned = d.chatModule.getPlayerOwnedTitles(xuid);
            var active = d.chatModule.getPlayerActiveTitle(xuid);
            res.json({ code: 200, data: { xuid: xuid, owned: owned, active: active } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取玩家称号失败: ' + e.message });
        }
    });

    // 为指定玩家添加称号
    router.post('/player/:xuid/titles', d.adminAuth, function(req, res) {
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
            d.adminLog.log(req.user.uid, '添加称号', '玩家XUID:' + xuid + ' 称号:' + title);
            res.json({ code: 200, msg: '称号添加成功', data: { xuid: xuid, title: title } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加称号失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
