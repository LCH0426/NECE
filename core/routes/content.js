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
 * NLCE 留言板与赞助路由模块
 * 提供留言板的CRUD操作和赞助记录管理API
 * 留言板支持心情标签、删除权限控制；赞助记录为JSON文件存储
 */

function registerRoutes(router, d) {

    const SPONSORSHIP_PATH = d.pathModule.join(__dirname, '..', '..', 'data', 'sponsorship.json');

    // 加载赞助记录，文件不存在时自动创建空数组
    function loadSponsorship() {
        try {
            if (!d.fs.existsSync(SPONSORSHIP_PATH)) {
                d.fs.writeFileSync(SPONSORSHIP_PATH, '[]', 'utf-8');
                return [];
            }
            let content = d.fs.readFileSync(SPONSORSHIP_PATH, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return [];
        }
    }

    function saveSponsorship(data) {
        d.fs.writeFileSync(SPONSORSHIP_PATH, JSON.stringify(data, null, 2), 'utf-8');
    }

    // 获取留言板列表（普通用户仅看自己的，管理员可看全部含已删除）
    router.get('/messages', d.auth, function(req, res) {
        try {
            let userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            const isAdminUser = d.database.isAdmin(req.user.uid);
            let options = {
                page: req.query.page,
                pageSize: req.query.pageSize,
                search: req.query.search,
                mood: req.query.mood,
                xuid: req.query.xuid || '',
                includeDeleted: false
            };

            // 管理员可查看已删除留言和全部玩家留言
            if (isAdminUser) {
                options.includeDeleted = req.query.includeDeleted === 'true';
            } else {
                options.xuid = userXuid;
            }

            let result = d.messageBoard.getMessages(options);

            // 标记当前用户是否有权删除每条留言（自己的或管理员可删）
            result.messages = result.messages.map(function(m) {
                let msg = Object.assign({}, m);
                msg.canDelete = isAdminUser || m.xuid === userXuid;
                return msg;
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取留言列表失败: ' + e.message });
        }
    });

    // 管理员专用：获取全部留言列表（含所有筛选条件和已删除留言）
    router.get('/messages/all', d.adminAuth, function(req, res) {
        try {
            const options = {
                page: req.query.page,
                pageSize: req.query.pageSize,
                search: req.query.search,
                mood: req.query.mood,
                xuid: req.query.xuid || '',
                includeDeleted: req.query.includeDeleted === 'true'
            };

            let result = d.messageBoard.getMessages(options);

            result.messages = result.messages.map(function(m) {
                let msg = Object.assign({}, m);
                msg.canDelete = true;
                return msg;
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取留言列表失败: ' + e.message });
        }
    });

    // 获取留言详情（仅本人或管理员可查看）
    router.get('/messages/:id', d.auth, function(req, res) {
        try {
            let msgId = parseInt(req.params.id);
            let msg = d.messageBoard.getMessageById(msgId);

            if (!msg) {
                return res.json({ code: 404, msg: '留言不存在' });
            }

            let userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            if (!d.database.isAdmin(req.user.uid) && msg.xuid !== userXuid) {
                return res.json({ code: 403, msg: '无权查看此留言' });
            }

            res.json({ code: 200, data: msg });
        } catch (e) {
            res.json({ code: 500, msg: '获取留言详情失败: ' + e.message });
        }
    });

    // 发布留言（支持心情标签，限制500字符，标记来源为Web）
    router.post('/messages', d.auth, function(req, res) {
        try {
            let content = req.body.content;
            let mood = req.body.mood || '平静';

            if (!content || !content.trim()) {
                return res.json({ code: 400, msg: '留言内容不能为空' });
            }

            if (content.length > 500) {
                return res.json({ code: 400, msg: '留言内容不能超过500字符' });
            }

            const MOOD_OPTIONS = ['开心', '难过', '平静', '兴奋', '生气'];
            if (MOOD_OPTIONS.indexOf(mood) === -1) {
                mood = '平静';
            }

            let xuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            const playerName = d.getPlayerNameByUid(req.user.uid);

            const newMsg = {
                id: d.messageBoard.getNextId(),
                xuid: xuid,
                playerName: playerName,
                msg: content.trim(),
                mood: mood,
                time: d.messageBoard.formatTime(),
                client: 'Web',
                isDeleted: false
            };

            d.messageBoard.addMessage(newMsg);

            res.json({ code: 200, msg: '留言发布成功', data: { id: newMsg.id } });
        } catch (e) {
            res.json({ code: 500, msg: '发布留言失败: ' + e.message });
        }
    });

    // 删除留言（软删除，仅本人或管理员可操作，管理员删他人留言记录日志）
    router.delete('/messages/:id', d.auth, function(req, res) {
        try {
            const msgId = parseInt(req.params.id);
            const msg = d.messageBoard.getMessageById(msgId);

            if (!msg) {
                return res.json({ code: 404, msg: '留言不存在' });
            }

            const userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            if (!d.database.isAdmin(req.user.uid) && msg.xuid !== userXuid) {
                return res.json({ code: 403, msg: '无权删除此留言' });
            }

            if (msg.isDeleted) {
                return res.json({ code: 400, msg: '留言已被删除' });
            }

            if (!d.messageBoard.deleteMessage(msgId)) {
                return res.json({ code: 500, msg: '删除留言失败' });
            }

            // 仅管理员删他人留言时记录操作日志
            if (d.database.isAdmin(req.user.uid) && msg.xuid !== userXuid) {
                d.adminLog.log(req.user.uid, '删除留言', 'ID:' + msgId, '作者: ' + msg.playerName + ' 内容: ' + (msg.msg || '').substring(0, 100));
            }

            res.json({ code: 200, msg: '留言已删除' });
        } catch (e) {
            res.json({ code: 500, msg: '删除留言失败: ' + e.message });
        }
    });

    // 获取赞助列表（公开接口，无需认证，供前端展示赞助墙）
    router.get('/sponsorship', function(req, res) {
        try {
            let list = loadSponsorship();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取赞助列表失败: ' + e.message });
        }
    });

    // 添加赞助记录（管理员操作）
    router.post('/sponsorship', d.adminAuth, function(req, res) {
        try {
            let id = req.body.id;
            let amount = req.body.amount;
            let message = req.body.message || '';
            let avatar = req.body.avatar || '';

            if (!id || typeof id !== 'string' || !id.trim()) {
                return res.json({ code: 400, msg: '缺少赞助者ID' });
            }
            if (!amount || typeof amount !== 'string' || !amount.trim()) {
                return res.json({ code: 400, msg: '缺少赞助金额' });
            }

            let list = loadSponsorship();
            const newEntry = { id: id.trim(), amount: amount.trim(), message: message.trim(), avatar: avatar.trim() };
            list.push(newEntry);
            saveSponsorship(list);

            d.adminLog.log(req.user.uid, '添加赞助', 'ID:' + newEntry.id + ' 金额:' + newEntry.amount);
            res.json({ code: 200, msg: '添加成功', data: newEntry });
        } catch (e) {
            res.json({ code: 500, msg: '添加赞助失败: ' + e.message });
        }
    });

    // 修改赞助记录（按数组索引定位）
    router.put('/sponsorship/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let list = loadSponsorship();

            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '赞助记录不存在' });
            }

            let entry = list[idx];
            if (req.body.id !== undefined) entry.id = String(req.body.id).trim();
            if (req.body.amount !== undefined) entry.amount = String(req.body.amount).trim();
            if (req.body.message !== undefined) entry.message = String(req.body.message).trim();
            if (req.body.avatar !== undefined) entry.avatar = String(req.body.avatar).trim();

            saveSponsorship(list);

            d.adminLog.log(req.user.uid, '修改赞助', '索引:' + idx + ' ID:' + entry.id);
            res.json({ code: 200, msg: '修改成功', data: entry });
        } catch (e) {
            res.json({ code: 500, msg: '修改赞助失败: ' + e.message });
        }
    });

    // 删除赞助记录（按数组索引定位）
    router.delete('/sponsorship/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let list = loadSponsorship();

            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '赞助记录不存在' });
            }

            let removed = list.splice(idx, 1)[0];
            saveSponsorship(list);

            d.adminLog.log(req.user.uid, '删除赞助', 'ID:' + removed.id + ' 金额:' + removed.amount);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除赞助失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
