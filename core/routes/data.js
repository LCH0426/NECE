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
 * NLCE Web路由 - 数据管理
 * 处理CDK、白名单、聊天、日志、行为日志和物品搜索相关路由
 */

function registerRoutes(router, d) {

    const CDK_DATA_PATH = d.pathModule.join(__dirname, '..', '..', 'data', 'cdkdata.json');

    // 加载CDK兑换码数据，文件不存在时返回空结构
    function loadCdkData() {
        try {
            if (d.fs.existsSync(CDK_DATA_PATH)) {
                return JSON.parse(d.fs.readFileSync(CDK_DATA_PATH, 'utf-8'));
            }
            return { codes: {} };
        } catch (e) {
            return { codes: {} };
        }
    }

    function saveCdkData(data) {
        d.fs.writeFileSync(CDK_DATA_PATH, JSON.stringify(data, null, '\t'), 'utf-8');
    }

    // 获取CDK兑换码列表（兼容旧格式：单奖励type/itemId和新格式：rewards数组）
    router.get('/cdk/list', d.adminAuth, function(req, res) {
        try {
            let data = loadCdkData();
            let list = [];
            Object.keys(data.codes || {}).forEach(function(code) {
                let cdk = data.codes[code];
                const usedCount = cdk.usedBy ? Object.keys(cdk.usedBy).length : 0;
                let item = { code: code, maxUses: cdk.maxUses, usedCount: usedCount, rewards: cdk.rewards || [] };
                // 旧版CDK无rewards字段，需转换为统一格式返回
                if (cdk.type && !cdk.rewards) {
                    const legacy = { type: cdk.type };
                    if (cdk.type === 'item') { legacy.itemId = cdk.itemId; legacy.itemName = cdk.itemName; legacy.count = cdk.count; }
                    else if (cdk.type === 'snbt') { legacy.snbt = cdk.snbt; legacy.itemName = cdk.itemName; }
                    else if (cdk.type === 'money') { legacy.amount = cdk.amount; }
                    item.rewards = [legacy];
                }
                list.push(item);
            });
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取CDK列表失败: ' + e.message });
        }
    });

    // 添加CDK兑换码（支持rewards数组或旧版type字段，奖励类型：item/snbt/money）
    router.post('/cdk/add', d.adminAuth, function(req, res) {
        try {
            let body = req.body;
            if (!body.code) {
                return res.json({ code: 400, msg: '缺少必要参数 code' });
            }
            let data = loadCdkData();
            if (data.codes[body.code]) {
                return res.json({ code: 400, msg: '兑换码已存在' });
            }
            let cdk = { maxUses: body.maxUses || 0, usedBy: {}, rewards: [] };
            // 优先使用rewards数组格式
            if (body.rewards && Array.isArray(body.rewards)) {
                for (let i = 0; i < body.rewards.length; i++) {
                    let r = body.rewards[i];
                    if (!r.type) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 type' });
                    if (r.type === 'item') {
                        if (!r.itemId) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 itemId' });
                        cdk.rewards.push({ type: 'item', itemId: r.itemId, itemName: r.itemName || r.itemId, count: r.count || 1 });
                    } else if (r.type === 'snbt') {
                        if (!r.snbt) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 snbt' });
                        cdk.rewards.push({ type: 'snbt', snbt: r.snbt, itemName: r.itemName || 'SNBT物品' });
                    } else if (r.type === 'money') {
                        if (!r.amount) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 amount' });
                        cdk.rewards.push({ type: 'money', amount: Number(r.amount) });
                    } else {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个附件类型无效，支持 item/snbt/money' });
                    }
                }
            // 兼容旧版单type字段格式
            } else if (body.type) {
                if (body.type === 'item') {
                    if (!body.itemId) return res.json({ code: 400, msg: '物品类型需要 itemId' });
                    cdk.rewards.push({ type: 'item', itemId: body.itemId, itemName: body.itemName || body.itemId, count: body.count || 1 });
                } else if (body.type === 'snbt') {
                    if (!body.snbt) return res.json({ code: 400, msg: 'SNBT类型需要 snbt' });
                    cdk.rewards.push({ type: 'snbt', snbt: body.snbt, itemName: body.itemName || 'SNBT物品' });
                } else if (body.type === 'money') {
                    if (!body.amount) return res.json({ code: 400, msg: '经济类型需要 amount' });
                    cdk.rewards.push({ type: 'money', amount: Number(body.amount) });
                } else {
                    return res.json({ code: 400, msg: '无效的CDK类型，支持 item/snbt/money' });
                }
            } else {
                return res.json({ code: 400, msg: '缺少 rewards 数组或 type 字段' });
            }
            data.codes[body.code] = cdk;
            saveCdkData(data);
            d.triggerReload('cdk');
            d.adminLog.log(req.user.uid, '添加CDK', '兑换码:' + body.code);
            res.json({ code: 200, msg: '添加成功' });
        } catch (e) {
            res.json({ code: 500, msg: '添加CDK失败: ' + e.message });
        }
    });

    // 删除指定CDK兑换码
    router.post('/cdk/delete', d.adminAuth, function(req, res) {
        try {
            let body = req.body;
            if (!body.code) return res.json({ code: 400, msg: '缺少兑换码' });
            let data = loadCdkData();
            if (!data.codes[body.code]) return res.json({ code: 404, msg: '兑换码不存在' });
            delete data.codes[body.code];
            saveCdkData(data);
            d.triggerReload('cdk');
            d.adminLog.log(req.user.uid, '删除CDK', '兑换码:' + body.code);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除CDK失败: ' + e.message });
        }
    });

    // 修改CDK兑换码（更新maxUses和/或rewards，自动清除旧格式字段）
    router.post('/cdk/modify', d.adminAuth, function(req, res) {
        try {
            let body = req.body;
            if (!body.code) return res.json({ code: 400, msg: '缺少兑换码' });
            let data = loadCdkData();
            if (!data.codes[body.code]) return res.json({ code: 404, msg: '兑换码不存在' });
            const cdk = data.codes[body.code];
            if (body.maxUses !== undefined) cdk.maxUses = Number(body.maxUses);
            if (body.rewards && Array.isArray(body.rewards)) {
                const newRewards = [];
                for (let i = 0; i < body.rewards.length; i++) {
                    const r = body.rewards[i];
                    if (!r.type) continue;
                    if (r.type === 'item') {
                        newRewards.push({ type: 'item', itemId: r.itemId || '', itemName: r.itemName || r.itemId || '', count: r.count || 1 });
                    } else if (r.type === 'snbt') {
                        newRewards.push({ type: 'snbt', snbt: r.snbt || '', itemName: r.itemName || 'SNBT物品' });
                    } else if (r.type === 'money') {
                        newRewards.push({ type: 'money', amount: Number(r.amount) || 0 });
                    }
                }
                cdk.rewards = newRewards;
                // 清除可能残留的旧格式字段，统一为rewards格式
                delete cdk.type;
                delete cdk.itemId;
                delete cdk.itemName;
                delete cdk.count;
                delete cdk.snbt;
                delete cdk.amount;
            }
            saveCdkData(data);
            d.triggerReload('cdk');
            d.adminLog.log(req.user.uid, '修改CDK', '兑换码:' + body.code);
            res.json({ code: 200, msg: '修改成功' });
        } catch (e) {
            res.json({ code: 500, msg: '修改CDK失败: ' + e.message });
        }
    });

    // BDS白名单文件路径（位于服务器根目录）
    const ALLOWLIST_PATH = d.pathModule.join(process.cwd(), 'allowlist.json');

    function readAllowlist() {
        try {
            if (d.fs.existsSync(ALLOWLIST_PATH)) {
                let content = d.fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
                let list = JSON.parse(content);
                if (!Array.isArray(list)) return [];
                return list;
            }
            return [];
        } catch (e) {
            logger.error('[Web] 读取白名单失败: ' + e.message);
            return [];
        }
    }

    function writeAllowlist(list) {
        try {
            d.fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(list, null, 2), 'utf-8');
            return true;
        } catch (e) {
            logger.error('[Web] 写入白名单失败: ' + e.message);
            return false;
        }
    }

    // 获取白名单列表（支持按名称/XUID搜索和分页）
    router.get('/allowlist', d.adminAuth, function(req, res) {
        try {
            let list = readAllowlist();
            let search = (req.query.search || '').trim().toLowerCase();
            let page = parseInt(req.query.page) || 1;
            let pageSize = parseInt(req.query.pageSize) || 20;

            let filtered = list;
            if (search) {
                filtered = list.filter(function(item) {
                    return (item.name && item.name.toLowerCase().indexOf(search) !== -1) ||
                           (item.xuid && item.xuid.toLowerCase().indexOf(search) !== -1);
                });
            }

            let total = filtered.length;
            let totalPages = Math.ceil(total / pageSize);
            let start = (page - 1) * pageSize;
            const paged = filtered.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    list: paged.map(function(item) {
                        return { name: item.name || '', xuid: item.xuid || '', ignoresPlayerLimit: item.ignoresPlayerLimit || false };
                    }),
                    pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取白名单失败: ' + e.message });
        }
    });

    // 添加白名单（通过BDS allowlist add命令，同时写入allowlist.json）
    router.post('/allowlist', d.adminAuth, function(req, res) {
        try {
            let name = (req.body.name || '').trim();
            if (!name) {
                return res.json({ code: 400, msg: '玩家名字不能为空' });
            }

            let list = readAllowlist();
            const exists = list.some(function(item) {
                return item.name && item.name.toLowerCase() === name.toLowerCase();
            });

            if (exists) {
                return res.json({ code: 409, msg: '玩家 ' + name + ' 已在白名单中' });
            }

            let cmdResult = d.mc.runcmd('allowlist add "' + name + '"');
            if (!cmdResult) {
                return res.json({ code: 500, msg: '执行 allowlist add 命令失败' });
            }

            d.adminLog.log(req.user.uid, '添加白名单', name, '');

            res.json({ code: 200, msg: '已添加 ' + name + ' 到白名单' });
        } catch (e) {
            res.json({ code: 500, msg: '添加白名单失败: ' + e.message });
        }
    });

    // 删除白名单（通过BDS allowlist remove命令）
    router.delete('/allowlist', d.adminAuth, function(req, res) {
        try {
            let name = (req.body.name || '').trim();
            if (!name) {
                return res.json({ code: 400, msg: '玩家名字不能为空' });
            }

            let list = readAllowlist();
            const found = list.some(function(item) {
                return item.name && item.name.toLowerCase() === name.toLowerCase();
            });

            if (!found) {
                return res.json({ code: 404, msg: '玩家 ' + name + ' 不在白名单中' });
            }

            const cmdResult = d.mc.runcmd('allowlist remove "' + name + '"');
            if (!cmdResult) {
                return res.json({ code: 500, msg: '执行 allowlist remove 命令失败' });
            }

            d.adminLog.log(req.user.uid, '删除白名单', name, '');

            res.json({ code: 200, msg: '已从白名单移除 ' + name });
        } catch (e) {
            res.json({ code: 500, msg: '删除白名单失败: ' + e.message });
        }
    });

    // 获取内存中的最近聊天记录（支持时间范围过滤，最大500条）
    router.get('/chat/history', d.adminAuth, function(req, res) {
        try {
            let limit = parseInt(req.query.limit) || 100;
            if (limit > 500) limit = 500;
            if (limit < 1) limit = 1;

            const before = req.query.before;
            const after = req.query.after;

            let messages = d.chatHistory;

            // before/after为时间戳，用于游标分页
            if (before) {
                const beforeTime = parseInt(before);
                if (!isNaN(beforeTime)) {
                    messages = messages.filter(function(m) { return m.time < beforeTime; });
                }
            }

            if (after) {
                const afterTime = parseInt(after);
                if (!isNaN(afterTime)) {
                    messages = messages.filter(function(m) { return m.time > afterTime; });
                }
            }

            let result = messages.slice(-limit);
            res.json({ code: 200, data: { messages: result, total: d.chatHistory.length } });
        } catch (e) {
            res.json({ code: 500, msg: '获取聊天记录失败: ' + e.message });
        }
    });

    // 查询持久化聊天日志（按日期、发送者、关键词过滤，分页返回）
    router.get('/chat/log', d.adminAuth, function(req, res) {
        let options = {
            date: req.query.date || '',
            page: parseInt(req.query.page) || 1,
            pageSize: parseInt(req.query.pageSize) || 100,
            sender: req.query.sender || '',
            keyword: req.query.keyword || ''
        };

        d.chatModule.queryHistory(options).then(function(result) {
            res.json({ code: 200, data: result });
        }).catch(function(e) {
            res.json({ code: 500, msg: '查询聊天记录失败: ' + e.message });
        });
    });

    // 获取有聊天记录的日期列表（用于前端日期选择器）
    router.get('/chat/log/dates', d.adminAuth, function(req, res) {
        try {
            let dates = d.chatModule.getAvailableDates();
            res.json({ code: 200, data: { dates: dates } });
        } catch (e) {
            res.json({ code: 500, msg: '获取聊天日期列表失败: ' + e.message });
        }
    });

    // 管理员全服广播消息，同时写入内存记录和持久化日志
    router.post('/chat/send', d.adminAuth, function(req, res) {
        let message = req.body.message;

        if (!message || !message.trim()) {
            return res.json({ code: 400, msg: '消息不能为空' });
        }

        if (message.length > 500) {
            return res.json({ code: 400, msg: '消息长度不能超过500字符' });
        }

        try {
            d.mc.broadcast('[服务器] ' + message.trim());

            const msgObj = { time: Date.now(), sender: 'Server', message: message.trim(), type: 'server' };

            d.chatHistory.push(msgObj);

            // 超出上限时裁剪旧消息，防止内存无限增长
            if (d.chatHistory.length > d.MAX_CHAT_HISTORY) {
                d.chatHistory.splice(0, d.chatHistory.length - d.MAX_CHAT_HISTORY);
            }

            d.chatModule.writeMessage(msgObj);

            d.adminLog.log(req.user.uid, '全服广播', '全体玩家', '内容: ' + message.trim());

            res.json({ code: 200, msg: '消息已发送' });
        } catch (e) {
            res.json({ code: 500, msg: '发送消息失败: ' + e.message });
        }
    });

    // 查询管理员操作日志（按日期分页）
    router.get('/logs', d.adminAuth, function(req, res) {
        try {
            const date = req.query.date || '';
            let page = parseInt(req.query.page) || 1;
            let pageSize = parseInt(req.query.pageSize) || 50;

            let result = d.adminLog.getLogs(date, page, pageSize);
            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取日志失败: ' + e.message });
        }
    });

    // 获取有操作日志的日期列表
    router.get('/logs/dates', d.adminAuth, function(req, res) {
        try {
            let dates = d.adminLog.getAvailableDates();
            res.json({ code: 200, data: { dates: dates } });
        } catch (e) {
            res.json({ code: 500, msg: '获取日期列表失败: ' + e.message });
        }
    });

    // 获取有玩家行为日志的日期列表
    router.get('/behavior/dates', d.adminAuth, function(req, res) {
        try {
            const dates = d.behaviorLog.availableDates();
            res.json({ code: 200, data: { dates: dates } });
        } catch (e) {
            res.json({ code: 500, msg: '获取行为日志日期列表失败: ' + e.message });
        }
    });

    // 获取行为日志支持的事件类型列表（用于前端筛选）
    router.get('/behavior/events', d.adminAuth, function(req, res) {
        try {
            const events = d.behaviorLog.actionTypes();
            res.json({ code: 200, data: { events: events } });
        } catch (e) {
            res.json({ code: 500, msg: '获取事件类型列表失败: ' + e.message });
        }
    });

    // 查询玩家行为日志（支持按日期、玩家名、事件类型过滤）
    router.get('/behavior/logs', d.adminAuth, function(req, res) {
        let options = {
            date: req.query.date || '',
            player: req.query.player || '',
            eventType: req.query.eventType || '',
            page: parseInt(req.query.page) || 1,
            pageSize: parseInt(req.query.pageSize) || 50
        };

        d.behaviorLog.queryLogs(options).then(function(result) {
            res.json({ code: 200, data: result });
        }).catch(function(e) {
            res.json({ code: 500, msg: '查询行为日志失败: ' + e.message });
        });
    });

    // 物品搜索：按ID或名称模糊匹配，返回物品列表（含贴图）
    router.get('/items/search', d.adminAuth, function(req, res) {
        try {
            const keyword = (req.query.keyword || '').trim().toLowerCase();
            if (!keyword) return res.json({ code: 400, msg: '缺少keyword参数' });
            const itemMap = d.getItemsMap();
            const results = [];
            Object.keys(itemMap).forEach(function(id) {
                let item = itemMap[id];
                let name = (typeof item === 'object') ? (item.name || id) : item;
                if (id.toLowerCase().indexOf(keyword) >= 0 || name.toLowerCase().indexOf(keyword) >= 0) {
                    let texture = (typeof item === 'object') ? (item.texture || '') : '';
                    results.push({ id: 'minecraft:' + id, name: name, image: texture });
                }
            });
            res.json({ code: 200, data: results });
        } catch (e) {
            res.json({ code: 500, msg: '搜索物品失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
