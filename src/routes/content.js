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
 * NECE 留言板路由模块
 * 提供留言板的CRUD操作，支持心情标签、删除权限控制
 * 赞助管理已集成至 wish 模块（src/wish.js）
 */

function registerRoutes(router, d) {

    // 确保查询参数为字符串（防止类型混淆注入）
    function safeStr(val) { return typeof val === 'string' ? val : ''; }
    function safeInt(val, def) { var n = parseInt(val); return isNaN(n) ? def : n; }

    // 获取当前用户的留言列表
    router.get('/messages/my', d.auth, function(req, res) {
        try {
            let userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            let options = {
                page: safeInt(req.query.page, 1),
                pageSize: safeInt(req.query.pageSize, 20),
                search: safeStr(req.query.search),
                mood: safeStr(req.query.mood),
                xuid: userXuid,
                includeDeleted: req.query.includeDeleted === 'true'
            };

            let result = d.messageBoard.getMessages(options);

            // 标记当前用户可以删除自己的留言
            result.messages = result.messages.map(function(m) {
                let msg = Object.assign({}, m);
                msg.canDelete = true;
                return msg;
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取我的留言列表失败' });
        }
    });

    // 获取留言板列表
    router.get('/messages', d.auth, function(req, res) {
        try {
            let userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            const isAdminUser = d.database.isAdmin(req.user.uid);
            let options = {
                page: safeInt(req.query.page, 1),
                pageSize: safeInt(req.query.pageSize, 20),
                search: safeStr(req.query.search),
                mood: safeStr(req.query.mood),
                xuid: safeStr(req.query.xuid),
                includeDeleted: false
            };

            // 管理员可查看已删除留言
            if (isAdminUser) {
                options.includeDeleted = req.query.includeDeleted === 'true';
            }

            let result = d.messageBoard.getMessages(options);

            // 标记当前用户是否有权删除每条留言
            result.messages = result.messages.map(function(m) {
                let msg = Object.assign({}, m);
                msg.canDelete = isAdminUser || String(m.xuid) === String(userXuid);
                return msg;
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取留言列表失败' });
        }
    });

    // 管理员专用：获取全部留言列表
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
            res.status(500).json({ code: 500, msg: '获取留言列表失败' });
        }
    });

    // 获取留言详情
    router.get('/messages/:id', d.auth, function(req, res) {
        try {
            let msgId = parseInt(req.params.id);
            let msg = d.messageBoard.getMessageById(msgId);

            if (!msg) {
                return res.status(404).json({ code: 404, msg: '留言不存在' });
            }

            // 已删除的留言只有管理员可以查看
            if (msg.isDeleted && !d.database.isAdmin(req.user.uid)) {
                return res.status(404).json({ code: 404, msg: '留言不存在' });
            }

            let userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            if (!d.database.isAdmin(req.user.uid) && String(msg.xuid) !== String(userXuid)) {
                return res.status(403).json({ code: 403, msg: '无权查看此留言' });
            }

            res.json({ code: 200, data: msg });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取留言详情失败' });
        }
    });

    // 发布留言
    router.post('/messages', d.auth, function(req, res) {
        try {
            let content = req.body.content;
            let mood = req.body.mood || '平静';

            // 类型校验（防止 NoSQL 注入/类型混淆）
            if (typeof content !== 'string') {
                return res.status(400).json({ code: 400, msg: '留言内容类型错误' });
            }
            if (typeof mood !== 'string') {
                return res.status(400).json({ code: 400, msg: '心情值类型错误' });
            }

            if (!content || !content.trim()) {
                return res.status(400).json({ code: 400, msg: '留言内容不能为空' });
            }

            if (content.length > 500) {
                return res.status(400).json({ code: 400, msg: '留言内容不能超过500字符' });
            }

            const MOOD_OPTIONS = ['开心', '难过', '平静', '兴奋', '生气'];
            if (MOOD_OPTIONS.indexOf(mood) === -1) {
                mood = '平静';
            }

            // HTML 转义（防止存储型 XSS）
            content = content.replace(/[&<>"']/g, function(m) {
                return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m];
            });

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
            res.status(500).json({ code: 500, msg: '发布留言失败' });
        }
    });

    // 删除留言
    router.delete('/messages/:id', d.auth, function(req, res) {
        try {
            const msgId = parseInt(req.params.id);
            const msg = d.messageBoard.getMessageById(msgId);

            if (!msg) {
                return res.status(404).json({ code: 404, msg: '留言不存在' });
            }

            if (msg.isDeleted) {
                return res.status(400).json({ code: 400, msg: '留言已被删除' });
            }

            const userXuid = d.getXuidByUid(req.user.uid) || req.user.uid;
            const isAdminUser = d.database.isAdmin(req.user.uid);
            
            // 权限检查：管理员可以删除任何留言，普通用户只能删除自己的留言
            if (!isAdminUser && String(msg.xuid) !== String(userXuid)) {
                return res.status(403).json({ code: 403, msg: '无权删除此留言' });
            }

            if (!d.messageBoard.deleteMessage(msgId)) {
                return res.status(500).json({ code: 500, msg: '删除留言失败' });
            }

            // 仅管理员删他人留言时记录操作日志
            if (isAdminUser && String(msg.xuid) !== String(userXuid)) {
                d.adminLog.log(req.user.uid, '删除留言', 'ID:' + msgId, '作者: ' + msg.playerName + ' 内容: ' + (msg.msg || '').substring(0, 100));
            }

            res.json({ code: 200, msg: '留言已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除留言失败: ' + e.message});
        }
    });
}

module.exports = { registerRoutes };
