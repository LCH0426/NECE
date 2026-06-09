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
 * 公会系统的Web管理API路由
 * 分为管理员接口（可管理所有公会）和玩家接口（仅可管理自己的公会）
 */

function registerRoutes(router, d) {

    var database = d.database;

    // ==================== 管理员接口（可管理所有公会） ====================

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
            res.status(500).json({ code: 500, msg: '获取公会列表失败: ' + e.message });
        }
    });

    // 获取公会详情（含成员和传送点）
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
            res.status(500).json({ code: 500, msg: '获取公会详情失败: ' + e.message });
        }
    });

    // 删除公会（管理员可删除任意公会）
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
            res.status(500).json({ code: 500, msg: '删除公会失败: ' + e.message });
        }
    });

    // 更新公会信息（管理员可修改任意公会的所有字段）
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
            res.json({ code: 200, msg: '公会信息已更新' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新公会失败: ' + e.message });
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
            res.status(500).json({ code: 500, msg: '获取传送点失败: ' + e.message });
        }
    });

    // 添加公会传送点（管理员）
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
            res.status(500).json({ code: 500, msg: '添加传送点失败: ' + e.message });
        }
    });

    // 删除公会传送点（管理员）
    router.delete('/admin/guild/:id/teleports/:tpId', d.adminAuth, function(req, res) {
        try {
            var guildId = parseInt(req.params.id);
            var tpId = parseInt(req.params.tpId);
            if (isNaN(guildId) || isNaN(tpId)) { res.status(400).json({ code: 400, msg: '参数无效' }); return; }
            database.removeGuildTeleport(tpId, guildId);
            d.adminLog.log(req.user.uid, '删除公会传送点', '公会ID:' + guildId + ' 传送点ID:' + tpId);
            res.json({ code: 200, msg: '传送点已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除传送点失败: ' + e.message });
        }
    });

    // 更新公会资金（管理员直接设置）
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
            res.json({ code: 200, msg: '公会资金已更新' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新资金失败: ' + e.message });
        }
    });

    // ==================== 玩家接口（仅可管理自己的公会） ====================

    // 创建公会（需要认证玩家身份）
    router.post('/guild/create', d.auth, function(req, res) {
        try {
            var body = req.body || {};
            var name = (body.name || '').trim();
            var description = (body.description || '').trim();

            if (!name || name.length < 2 || name.length > 16) {
                res.status(400).json({ code: 400, msg: '公会名称长度需在2-16个字符之间' });
                return;
            }

            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            if (database.getGuildByPlayer(xuid)) {
                res.status(400).json({ code: 400, msg: '你已经在一个公会中' });
                return;
            }

            if (database.getGuildByName(name)) {
                res.status(400).json({ code: 400, msg: '公会名称已被使用' });
                return;
            }

            var maxMembers = 20;
            try {
                var cfgContent = d.fs.readFileSync(d.pathModule.join(__dirname, '..', '..', 'config.json'), 'utf-8');
                var cfg = JSON.parse(cfgContent);
                if (cfg.guild && cfg.guild.maxMembers) maxMembers = cfg.guild.maxMembers;
            } catch (e) {}

            var guildId = database.createGuild(name, description, xuid, maxMembers);
            res.json({ code: 200, msg: '公会创建成功', data: { id: guildId } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '创建公会失败: ' + e.message });
        }
    });

    // 获取自己的公会信息
    router.get('/guild/my', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            var members = database.getGuildMembers(guild.id);
            var teleports = database.getGuildTeleports(guild.id);

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
                    teleports: teleports,
                    isOwner: guild.owner === xuid,
                    isAdmin: members.some(function(m) { return m.xuid === xuid && m.role === 'admin'; })
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取公会信息失败: ' + e.message });
        }
    });

    // 更新自己的公会信息（仅会长可修改描述）
    router.put('/guild/my', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            // 只有会长可以修改公会信息
            if (guild.owner !== xuid) {
                res.status(403).json({ code: 403, msg: '只有会长可以修改公会信息' });
                return;
            }

            var body = req.body || {};
            var fields = {};
            if (typeof body.description === 'string') fields.description = body.description;

            if (Object.keys(fields).length === 0) {
                res.status(400).json({ code: 400, msg: '没有需要更新的字段' });
                return;
            }

            database.updateGuild(guild.id, fields);
            res.json({ code: 200, msg: '公会信息已更新' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新公会失败: ' + e.message });
        }
    });

    // 解散自己的公会（仅会长）
    router.delete('/guild/my', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            if (guild.owner !== xuid) {
                res.status(403).json({ code: 403, msg: '只有会长可以解散公会' });
                return;
            }

            database.deleteGuild(guild.id);
            res.json({ code: 200, msg: '公会"' + guild.name + '"已解散' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '解散公会失败: ' + e.message });
        }
    });

    // 获取自己的公会传送点列表
    router.get('/guild/my/teleports', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            var teleports = database.getGuildTeleports(guild.id);
            res.json({ code: 200, data: teleports });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取传送点失败: ' + e.message });
        }
    });

    // 添加公会传送点（会长/管理员）
    router.post('/guild/my/teleports', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            // 只有会长和管理员可以添加传送点
            var members = database.getGuildMembers(guild.id);
            var isOwner = guild.owner === xuid;
            var isAdmin = members.some(function(m) { return m.xuid === xuid && m.role === 'admin'; });

            if (!isOwner && !isAdmin) {
                res.status(403).json({ code: 403, msg: '只有会长和管理员可以添加传送点' });
                return;
            }

            var body = req.body || {};
            var name = (body.name || '').trim();
            if (!name) { res.status(400).json({ code: 400, msg: '传送点名称不能为空' }); return; }
            if (typeof body.x !== 'number' || typeof body.y !== 'number' || typeof body.z !== 'number') {
                res.status(400).json({ code: 400, msg: '坐标参数无效' });
                return;
            }

            database.addGuildTeleport(guild.id, name, body.x, body.y, body.z, String(body.dim || '0'), xuid);
            res.json({ code: 200, msg: '传送点已添加' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加传送点失败: ' + e.message });
        }
    });

    // 删除公会传送点（会长/管理员）
    router.delete('/guild/my/teleports/:tpId', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            // 只有会长和管理员可以删除传送点
            var members = database.getGuildMembers(guild.id);
            var isOwner = guild.owner === xuid;
            var isAdmin = members.some(function(m) { return m.xuid === xuid && m.role === 'admin'; });

            if (!isOwner && !isAdmin) {
                res.status(403).json({ code: 403, msg: '只有会长和管理员可以删除传送点' });
                return;
            }

            var tpId = parseInt(req.params.tpId);
            if (isNaN(tpId)) { res.status(400).json({ code: 400, msg: '参数无效' }); return; }

            database.removeGuildTeleport(tpId, guild.id);
            res.json({ code: 200, msg: '传送点已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除传送点失败: ' + e.message });
        }
    });

    // 存入公会资金（任何成员）
    router.post('/guild/my/deposit', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            var body = req.body || {};
            var amount = parseFloat(body.amount);
            if (isNaN(amount) || amount <= 0) {
                res.status(400).json({ code: 400, msg: '存款金额无效' });
                return;
            }

            // 从玩家账户扣除
            var balance = d.money.get(xuid) || 0;
            if (balance < amount) {
                res.status(400).json({ code: 400, msg: '余额不足' });
                return;
            }

            var playerName = d.getPlayerName ? d.getPlayerName(xuid) : xuid;
            d.money.reduce(xuid, amount);
            database.updateGuild(guild.id, { fund: guild.fund + amount });
            // 写入经济日志
            if (d.writeEconomyLog) d.writeEconomyLog({ action: 'reduce', player: playerName, xuid: xuid, amount: amount, balance: d.money.get(xuid) || 0, reason: 'Web存入公会资金' });

            res.json({ code: 200, msg: '存入成功', data: { newFund: guild.fund + amount } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '存入失败: ' + e.message });
        }
    });

    // 取出公会资金（仅会长/管理员，根据配置）
    router.post('/guild/my/withdraw', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            var isOwner = guild.owner === xuid;
            var members = database.getGuildMembers(guild.id);
            var isAdmin = members.some(function(m) { return m.xuid === xuid && m.role === 'admin'; });

            // 根据配置决定权限
            var withdrawAdminOnly = false;
            try {
                var cfgContent = d.fs.readFileSync(d.pathModule.join(__dirname, '..', '..', 'config.json'), 'utf-8');
                var cfg = JSON.parse(cfgContent);
                if (cfg.guild && cfg.guild.withdrawAdminOnly) withdrawAdminOnly = cfg.guild.withdrawAdminOnly;
            } catch (e) {}

            if (withdrawAdminOnly && !isOwner && !isAdmin) {
                res.status(403).json({ code: 403, msg: '只有会长和管理员可以取出资金' });
                return;
            }

            var body = req.body || {};
            var amount = parseFloat(body.amount);
            if (isNaN(amount) || amount <= 0) {
                res.status(400).json({ code: 400, msg: '取款金额无效' });
                return;
            }

            if (guild.fund < amount) {
                res.status(400).json({ code: 400, msg: '公会资金不足' });
                return;
            }

            database.updateGuild(guild.id, { fund: guild.fund - amount });
            d.money.add(xuid, amount);
            var playerName2 = d.getPlayerName ? d.getPlayerName(xuid) : xuid;
            if (d.writeEconomyLog) d.writeEconomyLog({ action: 'add', player: playerName2, xuid: xuid, amount: amount, balance: d.money.get(xuid) || 0, reason: 'Web取出公会资金' });

            res.json({ code: 200, msg: '取出成功', data: { newFund: guild.fund - amount } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '取出失败: ' + e.message });
        }
    });

    // 踢出成员（会长/管理员）
    router.post('/guild/my/kick', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            var isOwner = guild.owner === xuid;
            var members = database.getGuildMembers(guild.id);
            var isAdmin = members.some(function(m) { return m.xuid === xuid && m.role === 'admin'; });

            if (!isOwner && !isAdmin) {
                res.status(403).json({ code: 403, msg: '只有会长和管理员可以踢出成员' });
                return;
            }

            var body = req.body || {};
            var targetXuid = body.xuid;
            if (!targetXuid) { res.status(400).json({ code: 400, msg: '目标玩家XUID无效' }); return; }

            // 不能踢出自己
            if (targetXuid === xuid) {
                res.status(400).json({ code: 400, msg: '不能踢出自己' });
                return;
            }

            // 不能踢出会长
            if (targetXuid === guild.owner) {
                res.status(400).json({ code: 400, msg: '不能踢出会长' });
                return;
            }

            // 管理员不能踢出其他管理员
            if (!isOwner) {
                var targetMember = members.find(function(m) { return m.xuid === targetXuid; });
                if (targetMember && targetMember.role === 'admin') {
                    res.status(403).json({ code: 403, msg: '管理员不能踢出其他管理员' });
                    return;
                }
            }

            database.removeGuildMember(targetXuid);
            res.json({ code: 200, msg: '成员已踢出' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '踢出失败: ' + e.message });
        }
    });

    // 提升成员为管理员（仅会长）
    router.post('/guild/my/promote', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            if (guild.owner !== xuid) {
                res.status(403).json({ code: 403, msg: '只有会长可以提升管理员' });
                return;
            }

            var body = req.body || {};
            var targetXuid = body.xuid;
            if (!targetXuid) { res.status(400).json({ code: 400, msg: '目标玩家XUID无效' }); return; }

            var members = database.getGuildMembers(guild.id);
            var targetMember = members.find(function(m) { return m.xuid === targetXuid; });

            if (!targetMember) {
                res.status(404).json({ code: 404, msg: '目标玩家不在公会中' });
                return;
            }

            if (targetMember.role === 'admin') {
                res.status(400).json({ code: 400, msg: '该玩家已经是管理员' });
                return;
            }

            // 检查管理员数量限制
            var maxAdmins = 3;
            try {
                var cfgContent = d.fs.readFileSync(d.pathModule.join(__dirname, '..', '..', 'config.json'), 'utf-8');
                var cfg = JSON.parse(cfgContent);
                if (cfg.guild && cfg.guild.maxAdmins) maxAdmins = cfg.guild.maxAdmins;
            } catch (e) {}

            var adminCount = members.filter(function(m) { return m.role === 'admin'; }).length;
            if (adminCount >= maxAdmins) {
                res.status(400).json({ code: 400, msg: '管理员数量已达上限(' + maxAdmins + ')' });
                return;
            }

            database.updateMemberRole(targetXuid, 'admin');
            res.json({ code: 200, msg: '已提升为管理员' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '提升失败: ' + e.message });
        }
    });

    // 降级管理员为普通成员（仅会长）
    router.post('/guild/my/demote', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            if (guild.owner !== xuid) {
                res.status(403).json({ code: 403, msg: '只有会长可以降级管理员' });
                return;
            }

            var body = req.body || {};
            var targetXuid = body.xuid;
            if (!targetXuid) { res.status(400).json({ code: 400, msg: '目标玩家XUID无效' }); return; }

            var members = database.getGuildMembers(guild.id);
            var targetMember = members.find(function(m) { return m.xuid === targetXuid; });

            if (!targetMember) {
                res.status(404).json({ code: 404, msg: '目标玩家不在公会中' });
                return;
            }

            if (targetMember.role !== 'admin') {
                res.status(400).json({ code: 400, msg: '该玩家不是管理员' });
                return;
            }

            database.updateMemberRole(targetXuid, 'member');
            res.json({ code: 200, msg: '已降级为普通成员' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '降级失败: ' + e.message });
        }
    });

    // 转让会长（仅会长）
    router.post('/guild/my/transfer', d.auth, function(req, res) {
        try {
            var xuid = d.getXuidByUid(req.user.uid);
            if (!xuid) { res.status(401).json({ code: 401, msg: '无法获取玩家身份' }); return; }

            var guild = database.getGuildByPlayer(xuid);
            if (!guild) { res.status(404).json({ code: 404, msg: '你还没有加入任何公会' }); return; }

            if (guild.owner !== xuid) {
                res.status(403).json({ code: 403, msg: '只有会长可以转让公会' });
                return;
            }

            var body = req.body || {};
            var targetXuid = body.xuid;
            if (!targetXuid) { res.status(400).json({ code: 400, msg: '目标玩家XUID无效' }); return; }

            var members = database.getGuildMembers(guild.id);
            var targetMember = members.find(function(m) { return m.xuid === targetXuid; });

            if (!targetMember) {
                res.status(404).json({ code: 404, msg: '目标玩家不在公会中' });
                return;
            }

            // 将原会长降为普通成员
            database.updateMemberRole(xuid, 'member');
            // 将新会长提升为owner
            database.updateMemberRole(targetXuid, 'owner');
            // 更新公会owner字段
            database.updateGuild(guild.id, { owner: targetXuid });

            res.json({ code: 200, msg: '会长已转让' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '转让失败: ' + e.message });
        }
    });

    // 获取所有公会列表（公开，用于玩家浏览）
    router.get('/guild/list', d.auth, function(req, res) {
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
                    ownerName: d.getPlayerName(g.owner),
                    level: g.level,
                    memberCount: mc2,
                    maxMembers: g.maxMembers,
                    createdAt: g.createdAt
                });
            }
            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取公会列表失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes: registerRoutes };
