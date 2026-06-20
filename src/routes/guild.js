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
 * NECE 公会路由模块
 * 公会管理接口（仅管理员）
 */

function registerRoutes(router, d) {

    var database = d.database;

    // 读取公会配置：优先使用注入的内存 config 对象，避免重复磁盘 IO 和缓存不一致
    function getGuildConfig() {
        var cfg = d.getConfig && d.getConfig();
        if (cfg) {
            var guildCfg = cfg.get('guild', {});
            return guildCfg || {};
        }
        // 兜底：config 不可用时直接读文件
        try {
            var cfgContent = d.fs.readFileSync(d.pathModule.join(__dirname, '..', '..', 'config.json'), 'utf-8');
            return JSON.parse(cfgContent).guild || {};
        } catch (e) {
            return {};
        }
    }

    // ==================== 管理员接口 ====================

    // 获取所有公会列表
    router.get('/admin/guild/list', d.adminAuth, function(req, res) {
        try {
            var guilds = database.getAllGuilds();
            var result = [];
            for (var i = 0; i < guilds.length; i++) {
                var g = guilds[i];
                var mc2 = database.getMemberCount(g.id);
                result.push({
                    id: g.id,
                    name: g.name,
                    description: g.description,
                    owner: g.owner,
                    ownerName: d.getPlayerName(g.owner),
                    level: g.level,
                    fund: g.fund,
                    maxMembers: g.maxMembers,
                    memberCount: mc2,
                    hqX: g.hqX,
                    hqY: g.hqY,
                    hqZ: g.hqZ,
                    hqDim: g.hqDim,
                    createdAt: g.createdAt
                });
            }
            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取公会列表失败: ' });
        }
    });

    // 获取公会详情
    router.get('/admin/guild/:id', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            if (isNaN(guildId)) { res.status(400).json({ code: 400, msg: '无效的公会ID' }); return; }
            var guild = database.getGuild(guildId);
            if (!guild) { res.status(404).json({ code: 404, msg: '公会不存在' }); return; }

            var members = database.getGuildMembers(guildId);
            var teleports = database.getGuildTeleports(guildId);

            res.json({
                code: 200,
                data: {
                    guild: {
                        id: guild.id,
                        name: guild.name,
                        description: guild.description,
                        owner: guild.owner,
                        ownerName: d.getPlayerName(guild.owner),
                        level: guild.level,
                        fund: guild.fund,
                        maxMembers: guild.maxMembers,
                        hqX: guild.hqX,
                        hqY: guild.hqY,
                        hqZ: guild.hqZ,
                        hqDim: guild.hqDim,
                        createdAt: guild.createdAt
                    },
                    members: members,
                    teleports: teleports
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取公会详情失败: ' });
        }
    });

    // 删除公会
    router.delete('/admin/guild/:id', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            if (isNaN(guildId)) { res.status(400).json({ code: 400, msg: '无效的公会ID' }); return; }
            var guild = database.getGuild(guildId);
            if (!guild) { res.status(404).json({ code: 404, msg: '公会不存在' }); return; }

            database.deleteGuild(guildId);
            d.adminLog.log(req.user.uid, '删除公会', '公会ID:' + guildId + ' 名称:' + guild.name);
            res.json({ code: 200, msg: '公会"' + guild.name + '"已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除公会失败: ' });
        }
    });

    // 更新公会信息
    router.put('/admin/guild/:id', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            if (isNaN(guildId)) { res.status(400).json({ code: 400, msg: '无效的公会ID' }); return; }
            var guild = database.getGuild(guildId);
            if (!guild) { res.status(404).json({ code: 404, msg: '公会不存在' }); return; }

            var body = req.body || {};
            var fields = {};
            if (typeof body.description === 'string') fields.description = body.description;
            if (typeof body.name === 'string' && body.name.length >= 2 && body.name.length <= 16) {
                var existing = database.getGuildByName(body.name);
                if (existing && existing.id !== guildId) {
                    res.status(400).json({ code: 400, msg: '公会名称已被使用' });
                    return;
                }
                fields.name = body.name;
            }
            if (typeof body.level === 'number' && body.level >= 1) fields.level = body.level;
            if (typeof body.maxMembers === 'number' && body.maxMembers >= 1) fields.maxMembers = body.maxMembers;
            if (typeof body.fund === 'number' && body.fund >= 0) fields.fund = body.fund;

            if (Object.keys(fields).length === 0) {
                res.status(400).json({ code: 400, msg: '没有需要更新的字段' });
                return;
            }

            database.updateGuild(guildId, fields);
            d.adminLog.log(req.user.uid, '修改公会信息', '公会ID:' + guildId + ' 修改:' + JSON.stringify(fields));
            
            // 清除聊天模块的公会名缓存，确保游戏内即时更新
            if (d.chatModule && d.chatModule.clearAllOrgNameCache) {
                d.chatModule.clearAllOrgNameCache();
            }
            
            res.json({ code: 200, msg: '公会信息已更新' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新公会失败: ' });
        }
    });

    // 获取公会传送点列表
    router.get('/admin/guild/:id/teleports', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            if (isNaN(guildId)) { res.status(400).json({ code: 400, msg: '无效的公会ID' }); return; }
            var teleports = database.getGuildTeleports(guildId);
            res.json({ code: 200, data: teleports });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取传送点失败: ' });
        }
    });

    // 添加公会传送点
    router.post('/admin/guild/:id/teleports', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            if (isNaN(guildId)) { res.status(400).json({ code: 400, msg: '无效的公会ID' }); return; }
            var guild = database.getGuild(guildId);
            if (!guild) { res.status(404).json({ code: 404, msg: '公会不存在' }); return; }

            var body = req.body || {};
            var name = (body.name || '').trim();
            if (!name) { res.status(400).json({ code: 400, msg: '传送点名称不能为空' }); return; }
            if (typeof body.x !== 'number' || typeof body.y !== 'number' || typeof body.z !== 'number') {
                res.status(400).json({ code: 400, msg: '坐标参数无效' });
                return;
            }

            database.addGuildTeleport(guildId, name, body.x, body.y, body.z, String(body.dim || '0'), 'web-admin');
            d.adminLog.log(req.user.uid, '添加公会传送点', '公会ID:' + guildId + ' 名称:' + name);
            res.json({ code: 200, msg: '传送点已添加' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加传送点失败: ' });
        }
    });

    // 删除公会传送点
    router.delete('/admin/guild/:id/teleports/:tpId', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            var tpId = parseInt(req.params.tpId);
            if (isNaN(guildId) || isNaN(tpId)) { res.status(400).json({ code: 400, msg: '参数无效' }); return; }
            database.removeGuildTeleport(tpId, guildId);
            d.adminLog.log(req.user.uid, '删除公会传送点', '公会ID:' + guildId + ' 传送点ID:' + tpId);
            res.json({ code: 200, msg: '传送点已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除传送点失败: ' });
        }
    });

    // 更新公会资金
    router.put('/admin/guild/:id/fund', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            if (isNaN(guildId)) { res.status(400).json({ code: 400, msg: '无效的公会ID' }); return; }
            var guild = database.getGuild(guildId);
            if (!guild) { res.status(404).json({ code: 404, msg: '公会不存在' }); return; }

            var body = req.body || {};
            if (typeof body.fund !== 'number' || body.fund < 0) {
                res.status(400).json({ code: 400, msg: '资金数值无效' });
                return;
            }

            database.updateGuild(guildId, { fund: body.fund });
            d.adminLog.log(req.user.uid, '修改公会资金', '公会ID:' + guildId + ' 新资金:' + body.fund);
            
            // 清除聊天模块的公会名缓存，确保游戏内即时更新
            if (d.chatModule && d.chatModule.clearAllOrgNameCache) {
                d.chatModule.clearAllOrgNameCache();
            }
            
            res.json({ code: 200, msg: '公会资金已更新' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新资金失败: ' });
        }
    });
}

module.exports = { registerRoutes: registerRoutes };
