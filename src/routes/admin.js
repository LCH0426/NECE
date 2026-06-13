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

function registerRoutes(router, d) {

    // 获取备份统计信息
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

    // 获取备份文件列表
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

    // 手动触发备份
    router.post('/backup/execute', d.adminAuth, d.writeLimiter, function(req, res) {
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
    router.delete('/backup/:filename', d.adminAuth, d.writeLimiter, function(req, res) {
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

    // 下载备份文件
    router.get('/backup/download/:filename', d.adminAuth, d.backupDownloadLimiter, function(req, res) {
        try {
            const filename = req.params.filename;
            // 防止路径穿越攻击
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
                return res.status(400).json({ code: 400, msg: '非法文件名' });
            }
            if (!filename.endsWith('.7z') && !filename.endsWith('.zip')) {
                return res.status(400).json({ code: 400, msg: '只能下载.7z或.zip备份文件' });
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

    // 获取备份配置
    router.get('/backup/config', d.adminAuth, function(req, res) {
        try {
            let cfg = d.backupModule.getConfig();
            res.json({ code: 200, data: cfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取备份配置失败: ' + e.message });
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
                return res.status(500).json({ code: 500, msg: '保存配置文件失败: ' + e.message });
            }

            d.triggerReload('config');
            var dataInterval = cfg.dataBackupInterval || 0;
            if (dataInterval > 0) {
                d.backupModule.startDataBackupScheduler(dataInterval * 3600 * 1000);
            } else {
                d.backupModule.stopDataBackupScheduler();
            }
            d.adminLog.log(req.user.uid, '修改备份配置', JSON.stringify(cfg));
            res.json({ code: 200, msg: '备份配置已更新', data: cfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新备份配置失败: ' + e.message });
        }
    });

    // 执行数据备份（打包data目录）
    router.post('/backup/data', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            d.backupModule.executeDataBackup(function(err, result) {
                if (err) {
                    res.status(500).json({ code: 500, msg: '数据备份失败: ' + (err.error || err.message || '未知错误') });
                    return;
                }
                d.adminLog.log(req.user.uid, '执行数据备份', '文件:' + result.filename);
                res.json({ code: 200, msg: '数据备份完成', data: result });
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '数据备份失败: ' + e.message });
        }
    });

    // 获取封禁列表
    router.get('/ban/list', d.adminAuth, function(req, res) {
        try {
            const list = d.banModule.apiGetBanList();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取封禁列表失败: ' + e.message });
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
                d.adminLog.log(req.user.uid, '封禁玩家', xuid, '原因: ' + reason);
                const playerName = d.getPlayerName(xuid) || xuid;
                res.json({ code: 200, msg: result.message, data: { xuid: result.xuid, name: playerName, isBanned: true } });
            } else {
                res.status(400).json({ code: 400, msg: result.message });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '封禁操作失败: ' + e.message });
        }
    });

    // 解封玩家
    router.post('/unban', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            const xuid = (req.body.xuid || '').trim();
            if (!xuid) return res.status(400).json({ code: 400, msg: '缺少xuid参数' });

            let result = d.banModule.apiUnban(xuid);
            if (result.success) {
                d.adminLog.log(req.user.uid, '解封玩家', xuid);
                const playerName = d.getPlayerName(xuid) || xuid;
                res.json({ code: 200, msg: result.message, data: { xuid: xuid, name: playerName, isBanned: false } });
            } else {
                res.status(400).json({ code: 400, msg: result.message });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '解封操作失败: ' + e.message });
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
            res.status(500).json({ code: 500, msg: '获取人数趋势失败: ' + e.message });
        }
    });

    // ==================== ClearLag 实体清理接口 ====================

    // 获取清理配置
    router.get('/clearlag/config', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            let content = d.fs.readFileSync(d.pathModule.join(__dirname, '..', '..', 'config.json'), 'utf-8');
            let cfg = JSON.parse(content);
            let clearLagCfg = cfg.clearLag || {};
            res.json({ code: 200, data: clearLagCfg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取清理配置失败: ' + e.message });
        }
    });

    // 修改清理配置
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
    router.post('/clearlag/execute', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            let result = d.clearLagModule.executeCleanup();
            let totalKilled = result.killedMobs + result.killedItems;
            d.adminLog.log(req.user.uid, '手动触发清理', '生物:' + result.killedMobs + ' 掉落物:' + result.killedItems);
            res.json({
                code: 200,
                msg: '清理完成，共清理 ' + totalKilled + ' 个实体',
                data: {
                    killedMobs: result.killedMobs,
                    killedItems: result.killedItems,
                    totalKilled: totalKilled,
                    totalEntities: result.total,
                    protectedCount: result.protectedCount,
                    byType: result.byType
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '执行清理失败: ' + e.message });
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
    router.post('/player/:xuid/titles', d.adminAuth, d.writeLimiter, function(req, res) {
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

    // 设置玩家当前使用的称号
    router.put('/player/:xuid/titles/active', d.adminAuth, d.writeLimiter, function(req, res) {
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
            d.adminLog.log(req.user.uid, '设置称号', '玩家XUID:' + xuid + ' 称号:' + title);
            res.json({ code: 200, msg: '称号设置成功', data: { xuid: xuid, active: title } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '设置称号失败: ' + e.message });
        }
    });

    // 删除玩家的指定称号
    router.delete('/player/:xuid/titles/:title', d.adminAuth, d.writeLimiter, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var title = req.params.title;
            if (d.chatModule.removePlayerTitle(xuid, title)) {
                d.adminLog.log(req.user.uid, '删除称号', '玩家XUID:' + xuid + ' 称号:' + title);
                res.json({ code: 200, msg: '称号删除成功' });
            } else {
                res.status(404).json({ code: 404, msg: '该玩家未拥有此称号' });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除称号失败: ' + e.message });
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

            var logDir = d.pathModule.resolve(__dirname, '..', '..', 'logs', 'economy');
            if (!d.fs.existsSync(logDir)) {
                return res.json({ code: 200, data: { logs: [], total: 0, page: page, pageSize: pageSize } });
            }

            // 确定要读取的日志文件
            var files = [];
            if (date) {
                var targetFile = d.pathModule.join(logDir, 'economy-' + date + '.jsonl');
                // 验证最终路径在预期目录内
                if (!targetFile.startsWith(logDir)) {
                    return res.status(400).json({ code: 400, msg: '非法路径' });
                }
                files = [targetFile];
            } else {
                try {
                    files = d.fs.readdirSync(logDir)
                        .filter(function(f) { return f.endsWith('.jsonl'); })
                        .sort().reverse() // 最新在前
                        .slice(0, 7) // 最多读7天
                        .map(function(f) { return logDir + '/' + f; });
                } catch (e) { files = []; }
            }

            // 读取并筛选指定玩家的日志
            var allLogs = [];
            files.forEach(function(filePath) {
                try {
                    if (!d.fs.existsSync(filePath)) return;
                    var content = d.fs.readFileSync(filePath, 'utf-8');
                    var lines = content.split('\n').filter(function(l) { return l.trim(); });
                    lines.forEach(function(line) {
                        try {
                            var entry = JSON.parse(line);
                            if (entry.player === playerName || entry.target === playerName) {
                                allLogs.push(entry);
                            }
                        } catch (e) { /* 跳过无效行 */ }
                    });
                } catch (e) { /* 跳过无法读取的文件 */ }
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
            res.status(500).json({ code: 500, msg: '查询经济日志失败: ' + e.message });
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
            d.adminLog.log(req.user.uid, '删除玩家所有数据', '玩家:' + playerName + ' XUID:' + xuid);

            // 从内存中移除
            if (d.getPlayerData && d.getPlayerData().players) {
                delete d.getPlayerData().players[xuid];
            }

            res.json({ code: 200, msg: '玩家"' + playerName + '"的所有数据已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除玩家数据失败: ' + e.message });
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
            res.status(500).json({ code: 500, msg: '生成验证码失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
