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
 * NLCE 邮件系统路由模块
 * 提供邮件的CRUD操作API（列表、详情、发送、删除）
 * 支持全局邮件、个人邮件、定时邮件，邮件可附带物品和货币奖励
 */

function registerRoutes(router, d) {

    // 获取邮件列表（支持按类型/关键词筛选，分页返回，含已读/已领统计）
    router.get('/mails', d.adminAuth, function(req, res) {
        try {
            const mailData = d.mailApi.getData();
            const page = parseInt(req.query.page) || 1;
            const pageSize = parseInt(req.query.pageSize) || 20;
            let type = req.query.type || '';
            const search = (req.query.search || '').trim().toLowerCase();

            // 按类型过滤：global(全体)/personal(个人)/scheduled(定时)/normal(普通)
            const mailList = mailData.mails.filter(function(m) {
                if (type === 'global' && m.toXuid !== 'all') return false;
                if (type === 'personal' && m.toXuid === 'all') return false;
                if (type === 'scheduled' && !m.scheduledTime) return false;
                if (type === 'normal' && m.scheduledTime) return false;

                // 多字段模糊搜索：发送者、收件人、内容
                if (search) {
                    const matchFrom = (m.fromName || '').toLowerCase().indexOf(search) !== -1;
                    const matchTo = m.toXuid === 'all' ? ('全体').indexOf(search) !== -1 : (m.toXuid || '').toLowerCase().indexOf(search) !== -1;
                    const matchContent = (m.content || '').toLowerCase().indexOf(search) !== -1;
                    let matchToName = false;
                    if (m.toXuid !== 'all') {
                        matchToName = d.getPlayerName(m.toXuid).toLowerCase().indexOf(search) !== -1;
                    }
                    if (!matchFrom && !matchTo && !matchContent && !matchToName) return false;
                }
                return true;
            });

            // 按ID降序排列（最新的在前）
            mailList.sort(function(a, b) { return b.id - a.id; });

            const total = mailList.length;
            const totalPages = Math.ceil(total / pageSize);
            const start = (page - 1) * pageSize;
            const pagedMails = mailList.slice(start, start + pageSize);

            let result = pagedMails.map(function(m) {
                let toName = m.toXuid === 'all' ? '全体玩家' : d.getPlayerName(m.toXuid);
                let readCount = 0;
                // 全局邮件统计已读人数
                if (m.toXuid === 'all') {
                    if (m.read && typeof m.read === 'object') {
                        readCount = Object.keys(m.read).length;
                    }
                }

                return {
                    id: m.id,
                    fromName: m.fromName || '未知',
                    fromXuid: m.fromXuid || '',
                    toXuid: m.toXuid,
                    toName: toName,
                    content: m.content,
                    time: m.time,
                    starQian: m.starQian || 0,
                    hasItems: !!(m.items && m.items.length > 0),
                    itemCount: m.items ? m.items.length : 0,
                    // 附件物品统一格式化：snbt类型携带完整NBT字符串，普通物品携带id/count/name
                    items: (m.items || []).map(function(it) {
                        let result = { type: it.type || 'item' };
                        if (result.type === 'snbt') {
                            result.snbt = it.snbt || '';
                        } else {
                            result.id = it.id || '';
                            result.count = it.count || 1;
                            result.name = it.name || d.getItemName(it.id) || it.id || '';
                        }
                        return result;
                    }),
                    isGlobal: m.toXuid === 'all',
                    isScheduled: !!m.scheduledTime,
                    scheduledTime: m.scheduledTime || null,
                    readCount: readCount,
                    // 个人邮件read为布尔值，全局邮件为已读玩家对象
                    read: m.toXuid === 'all' ? readCount : !!m.read,
                    claimedCount: m.toXuid === 'all' && m.claimed && typeof m.claimed === 'object' ? Object.keys(m.claimed).length : 0
                };
            });

            res.json({
                code: 200,
                data: {
                    mails: result,
                    pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取邮件列表失败: ' + e.message });
        }
    });

    // 获取邮件详情（含已读玩家列表、已领取玩家列表）
    router.get('/mails/:id', d.adminAuth, function(req, res) {
        try {
            let mailId = parseInt(req.params.id);
            let mail = d.mailApi.getMailById(mailId);

            if (!mail) {
                return res.json({ code: 404, msg: '邮件不存在' });
            }

            const toName = mail.toXuid === 'all' ? '全体玩家' : d.getPlayerName(mail.toXuid);

            // 全局邮件：构建已读玩家列表
            const readList = [];
            if (mail.toXuid === 'all' && mail.read && typeof mail.read === 'object') {
                Object.keys(mail.read).forEach(function(xuid) {
                    if (mail.read[xuid]) {
                        readList.push({ xuid: xuid, name: d.getPlayerName(xuid) });
                    }
                });
            }

            // 全局邮件：构建已领取玩家列表；个人邮件：claimed为布尔值
            let claimedList = [];
            if (mail.toXuid === 'all' && mail.claimed && typeof mail.claimed === 'object') {
                Object.keys(mail.claimed).forEach(function(xuid) {
                    if (mail.claimed[xuid]) {
                        claimedList.push({ xuid: xuid, name: d.getPlayerName(xuid) });
                    }
                });
            } else if (mail.toXuid !== 'all') {
                claimedList = mail.claimed ? [{ xuid: mail.toXuid, name: toName }] : [];
            }

            res.json({
                code: 200,
                data: {
                    id: mail.id,
                    fromName: mail.fromName || '未知',
                    fromXuid: mail.fromXuid || '',
                    toXuid: mail.toXuid,
                    toName: toName,
                    content: mail.content,
                    time: mail.time,
                    starQian: mail.starQian || 0,
                    items: (mail.items || []).map(function(it) {
                        let result = { type: it.type || 'item' };
                        if (result.type === 'snbt') {
                            result.snbt = it.snbt || '';
                        } else {
                            result.id = it.id || '';
                            result.count = it.count || 1;
                            result.name = it.name || d.getItemName(it.id) || it.id || '';
                        }
                        return result;
                    }),
                    isGlobal: mail.toXuid === 'all',
                    isScheduled: !!mail.scheduledTime,
                    scheduledTime: mail.scheduledTime || null,
                    read: mail.read,
                    readList: readList,
                    claimed: mail.claimed,
                    claimedList: claimedList
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取邮件详情失败: ' + e.message });
        }
    });

    // 发送邮件（支持个人/全体/定时，附件支持物品和星签货币奖励）
    router.post('/mails/send', d.adminAuth, function(req, res) {
        let toXuid = req.body.toXuid;
        let content = req.body.content;
        const starQian = req.body.starQian || 0;
        let scheduledTime = req.body.scheduledTime || '';
        const mailItems = req.body.items || [];

        if (!content || !content.trim()) {
            return res.json({ code: 400, msg: '邮件内容不能为空' });
        }

        if (content.length > 2000) {
            return res.json({ code: 400, msg: '邮件内容不能超过2000字符' });
        }

        if (!toXuid) {
            return res.json({ code: 400, msg: '缺少收件人参数 (toXuid，全体邮件请传 "all")' });
        }

        const intStarQian = Math.floor(Number(starQian));
        if (isNaN(intStarQian) || intStarQian < 0) {
            return res.json({ code: 400, msg: d.getCurrencyName() + '奖励必须为非负整数' });
        }

        // 验证并格式化附件物品，为普通物品生成SNBT字符串
        const validatedItems = [];
        if (Array.isArray(mailItems) && mailItems.length > 0) {
            if (mailItems.length > 10) {
                return res.json({ code: 400, msg: '附件物品不能超过10个' });
            }
            for (let i = 0; i < mailItems.length; i++) {
                const it = mailItems[i];
                let itemType = it.type || 'item';

                if (itemType === 'snbt') {
                    if (!it.snbt || typeof it.snbt !== 'string' || !it.snbt.trim()) {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个物品缺少snbt' });
                    }
                    validatedItems.push({ type: 'snbt', snbt: it.snbt.trim() });
                } else {
                    if (!it.id || typeof it.id !== 'string') {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个物品缺少id' });
                    }
                    const count = Math.floor(Number(it.count)) || 1;
                    if (count < 1 || count > 2304) {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个物品数量无效(1-2304)' });
                    }
                    const itemId = it.id.startsWith('minecraft:') ? it.id : 'minecraft:' + it.id;
                    let itemName = d.getItemName(it.id) || it.id;
                    // 生成BDS可用的最小SNBT字符串
                    const snbtStr = '{"Count":' + count + 'b,"Damage":0s,"Name":"' + itemId + '","WasPickedUp":0b}';
                    validatedItems.push({ type: 'item', id: it.id, count: count, name: itemName, snbt: snbtStr });
                }
            }
        }

        // 定时邮件：校验时间格式（2026.05.12.18.00）并确保晚于当前时间
        if (scheduledTime) {
            if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(scheduledTime)) {
                return res.json({ code: 400, msg: '定时时间格式不正确，正确格式：2026.05.12.18.00' });
            }
            const parts = scheduledTime.split('.').map(Number);
            const scheduledDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] || 0, 0);
            if (scheduledDate <= new Date()) {
                return res.json({ code: 400, msg: '定时时间必须晚于当前时间' });
            }
        }

        try {
            // 非全体邮件时验证目标玩家是否存在
            if (toXuid !== 'all') {
                const playerData = d.getPlayerData();
                if (!playerData || !playerData.players || !playerData.players[toXuid]) {
                    return res.json({ code: 404, msg: '目标玩家不存在' });
                }
            }

            const newMail = {
                id: d.mailApi.getNextId(),
                fromXuid: '',
                fromName: '系统',
                toXuid: toXuid,
                content: content.trim(),
                time: d.mailApi.formatMailTime(),
                read: false,
                starQian: intStarQian,
                items: validatedItems,
                // 全局邮件的claimed为对象（记录每个玩家领取状态），个人邮件为布尔值
                claimed: toXuid === 'all' ? {} : false
            };

            if (scheduledTime) {
                newMail.scheduledTime = scheduledTime;
            }

            d.mailApi.addMail(newMail);
            d.mailApi.incrementNextId();

            // 非定时邮件：立即通知在线玩家
            if (!scheduledTime) {
                if (toXuid === 'all') {
                    try {
                        const onlinePlayers = d.mc.getOnlinePlayers();
                        onlinePlayers.forEach(function(p) {
                            try {
                                p.sendToast('§e新邮件提醒', '§a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + d.getCurrencyName() + '奖励' : ''));
                                p.tell('§e[邮件] §a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + d.getCurrencyName() + '奖励，请在邮件系统中领取' : '，请在邮件系统中查看'));
                            } catch (e) {}
                        });
                    } catch (e) {}
                } else {
                    try {
                        const targetPlayer = d.mc.getPlayer(toXuid);
                        if (targetPlayer) {
                            targetPlayer.sendToast('§e新邮件提醒', '§a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + d.getCurrencyName() + '奖励' : ''));
                            targetPlayer.tell('§e[邮件] §a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + d.getCurrencyName() + '奖励，请在邮件系统中领取' : '，请在邮件系统中查看'));
                        }
                    } catch (e) {}
                }
            }

            let targetDesc = toXuid === 'all' ? '全体玩家' : d.getPlayerName(toXuid);
            d.adminLog.log(req.user.uid, '发送邮件', targetDesc, '内容: ' + content.trim().substring(0, 100) + (intStarQian > 0 ? ' ' + d.getCurrencyName() + ': ' + intStarQian : '') + (scheduledTime ? ' 定时: ' + scheduledTime : ''));

            res.json({
                code: 200,
                msg: scheduledTime ? '定时邮件已设置，将在 ' + scheduledTime + ' 发送' : '邮件已发送给 ' + targetDesc,
                data: { id: newMail.id, toXuid: toXuid, toName: targetDesc }
            });
        } catch (e) {
            res.json({ code: 500, msg: '发送邮件失败: ' + e.message });
        }
    });

    // 删除指定邮件（记录操作日志含邮件内容摘要）
    router.delete('/mails/:id', d.adminAuth, function(req, res) {
        try {
            const mailId = parseInt(req.params.id);
            const mail = d.mailApi.getMailById(mailId);

            if (!mail) {
                return res.json({ code: 404, msg: '邮件不存在' });
            }

            const targetDesc = mail.toXuid === 'all' ? '全体玩家' : d.getPlayerName(mail.toXuid);
            const contentPreview = (mail.content || '').substring(0, 100);

            if (!d.mailApi.deleteMail(mailId)) {
                return res.json({ code: 500, msg: '保存邮件数据失败' });
            }

            d.adminLog.log(req.user.uid, '删除邮件', 'ID:' + mailId + ' 目标:' + targetDesc, '内容: ' + contentPreview);

            res.json({ code: 200, msg: '邮件已删除' });
        } catch (e) {
            res.json({ code: 500, msg: '删除邮件失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
