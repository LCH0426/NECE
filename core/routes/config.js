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
 * NLCE 配置路由模块
 * 祈愿配置和功能开关的Web管理API路由
 * 祈愿配置存储在config.json的wishConfig字段中，修改后触发热重载
 */

function registerRoutes(router, d) {

    const WISH_CONFIG_PATH = d.pathModule.join(__dirname, '..', '..', 'config.json');

    // 从config.json中读取wishConfig部分
    function loadWishConfig() {
        try {
            let content = d.fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            let cfg = JSON.parse(content);
            return cfg.wishConfig || {};
        } catch (e) {
            return {};
        }
    }

    // 保存wishConfig回config.json（保留其他配置不变），触发祈愿模块热重载
    function saveWishConfig(wishCfg) {
        try {
            let content = d.fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            let cfg = JSON.parse(content);
            cfg.wishConfig = wishCfg;
            d.fs.writeFileSync(WISH_CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
            d.triggerReload('wish');
        } catch (e) {
            throw e;
        }
    }

    // 获取祈愿配置（管理员接口）
    router.get('/wish', d.adminAuth, function(req, res) {
        try {
            let config = loadWishConfig();
            res.json({ code: 200, data: config });
        } catch (e) {
            res.json({ code: 500, msg: '获取祈愿配置失败: ' + e.message });
        }
    });

    // 修改卡池Banner图片URL
    router.put('/wish/banner', d.adminAuth, function(req, res) {
        try {
            let config = loadWishConfig();
            config.banner = req.body.banner || '';
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '修改卡池信息', 'Banner已更新');
            res.json({ code: 200, msg: '修改成功', data: { banner: config.banner } });
        } catch (e) {
            res.json({ code: 500, msg: '修改卡池信息失败: ' + e.message });
        }
    });

    // 添加四星奖励物品（name为显示名，snbt为物品NBT数据）
    router.post('/wish/fourStar', d.adminAuth, function(req, res) {
        try {
            let name = req.body.name;
            let snbt = req.body.snbt;
            if (!name || !snbt) {
                return res.json({ code: 400, msg: 'name和snbt为必填项' });
            }
            let config = loadWishConfig();
            if (!config.rewards) config.rewards = {};
            if (!config.rewards.fourStar) config.rewards.fourStar = [];
            let item = { name: name, snbt: snbt };
            config.rewards.fourStar.push(item);
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '添加四星奖励', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.json({ code: 500, msg: '添加四星奖励失败: ' + e.message });
        }
    });

    // 修改指定索引的四星奖励
    router.put('/wish/fourStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fourStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            config.rewards.fourStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '修改四星奖励', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.json({ code: 500, msg: '修改四星奖励失败: ' + e.message });
        }
    });

    // 删除指定索引的四星奖励
    router.delete('/wish/fourStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fourStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            let removed = list.splice(idx, 1)[0];
            config.rewards.fourStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '删除四星奖励', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除四星奖励失败: ' + e.message });
        }
    });

    // 添加五星奖励物品
    router.post('/wish/fiveStar', d.adminAuth, function(req, res) {
        try {
            let name = req.body.name;
            let snbt = req.body.snbt;
            if (!name || !snbt) {
                return res.json({ code: 400, msg: 'name和snbt为必填项' });
            }
            let config = loadWishConfig();
            if (!config.rewards) config.rewards = {};
            if (!config.rewards.fiveStar) config.rewards.fiveStar = [];
            let item = { name: name, snbt: snbt };
            config.rewards.fiveStar.push(item);
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '添加五星奖励', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.json({ code: 500, msg: '添加五星奖励失败: ' + e.message });
        }
    });

    // 修改指定索引的五星奖励
    router.put('/wish/fiveStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fiveStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            config.rewards.fiveStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '修改五星奖励', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.json({ code: 500, msg: '修改五星奖励失败: ' + e.message });
        }
    });

    // 删除指定索引的五星奖励
    router.delete('/wish/fiveStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fiveStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            let removed = list.splice(idx, 1)[0];
            config.rewards.fiveStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '删除五星奖励', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除五星奖励失败: ' + e.message });
        }
    });

    // 添加核心兑换商店物品（需指定兑换花费的尘核数量）
    router.post('/wish/coreShop', d.adminAuth, function(req, res) {
        try {
            let name = req.body.name;
            let snbt = req.body.snbt;
            let cost = req.body.cost;
            if (!name || !snbt || cost === undefined) {
                return res.json({ code: 400, msg: 'name、snbt和cost为必填项' });
            }
            let config = loadWishConfig();
            if (!config.coreShop) config.coreShop = [];
            let item = { name: name, snbt: snbt, cost: cost, description: req.body.description || '', icon: req.body.icon || '' };
            config.coreShop.push(item);
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '添加核心兑换物品', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.json({ code: 500, msg: '添加核心兑换物品失败: ' + e.message });
        }
    });

    // 修改指定索引的核心兑换物品
    router.put('/wish/coreShop/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = config.coreShop || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '兑换物品不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            if (req.body.cost !== undefined) list[idx].cost = req.body.cost;
            if (req.body.description !== undefined) list[idx].description = req.body.description;
            if (req.body.icon !== undefined) list[idx].icon = req.body.icon;
            config.coreShop = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '修改核心兑换物品', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.json({ code: 500, msg: '修改核心兑换物品失败: ' + e.message });
        }
    });

    // 删除指定索引的核心兑换物品
    router.delete('/wish/coreShop/:index', d.adminAuth, function(req, res) {
        try {
            const idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = config.coreShop || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '兑换物品不存在' });
            }
            let removed = list.splice(idx, 1)[0];
            config.coreShop = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '删除核心兑换物品', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除核心兑换物品失败: ' + e.message });
        }
    });

    // 修改三星（普通）物品的尘核掉落范围（minDust ~ maxDust）
    router.put('/wish/threeStar', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (!cfg.rewards) cfg.rewards = {};
            if (!cfg.rewards.threeStar) cfg.rewards.threeStar = {};
            if (req.body.minDust !== undefined) {
                const min = parseInt(req.body.minDust);
                if (isNaN(min) || min < 0) return res.json({ code: 400, msg: 'minDust必须为非负整数' });
                cfg.rewards.threeStar.minDust = min;
            }
            if (req.body.maxDust !== undefined) {
                const max = parseInt(req.body.maxDust);
                if (isNaN(max) || max < 0) return res.json({ code: 400, msg: 'maxDust必须为非负整数' });
                cfg.rewards.threeStar.maxDust = max;
            }
            if (cfg.rewards.threeStar.minDust > cfg.rewards.threeStar.maxDust) {
                return res.json({ code: 400, msg: 'minDust不能大于maxDust' });
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改三星物品配置', JSON.stringify(cfg.rewards.threeStar));
            res.json({ code: 200, msg: '修改成功', data: cfg.rewards.threeStar });
        } catch (e) {
            res.json({ code: 500, msg: '修改三星物品配置失败: ' + e.message });
        }
    });

    // 修改祈愿概率配置（含软保底、硬保底、四星保底次数）
    router.put('/wish/rates', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (!cfg.rates) cfg.rates = {};
            if (req.body.fiveStar !== undefined) {
                let v = parseFloat(req.body.fiveStar);
                if (isNaN(v) || v < 0 || v > 1) return res.json({ code: 400, msg: 'fiveStar概率必须在0-1之间' });
                cfg.rates.fiveStar = v;
            }
            if (req.body.fourStar !== undefined) {
                let v = parseFloat(req.body.fourStar);
                if (isNaN(v) || v < 0 || v > 1) return res.json({ code: 400, msg: 'fourStar概率必须在0-1之间' });
                cfg.rates.fourStar = v;
            }
            // 软保底：达到该抽数后概率逐步提升
            if (req.body.fiveStarSoftPity !== undefined) {
                let v = parseInt(req.body.fiveStarSoftPity);
                if (isNaN(v) || v < 1) return res.json({ code: 400, msg: 'fiveStarSoftPity必须为正整数' });
                cfg.rates.fiveStarSoftPity = v;
            }
            // 硬保底：达到该抽数必出五星
            if (req.body.fiveStarHardPity !== undefined) {
                let v = parseInt(req.body.fiveStarHardPity);
                if (isNaN(v) || v < 1) return res.json({ code: 400, msg: 'fiveStarHardPity必须为正整数' });
                cfg.rates.fiveStarHardPity = v;
            }
            if (req.body.fourStarGuarantee !== undefined) {
                let v = parseInt(req.body.fourStarGuarantee);
                if (isNaN(v) || v < 1) return res.json({ code: 400, msg: 'fourStarGuarantee必须为正整数' });
                cfg.rates.fourStarGuarantee = v;
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改祈愿概率配置', JSON.stringify(cfg.rates));
            res.json({ code: 200, msg: '修改成功', data: cfg.rates });
        } catch (e) {
            res.json({ code: 500, msg: '修改祈愿概率配置失败: ' + e.message });
        }
    });

    // 修改祈愿花费配置（单抽和十连的价格）
    router.put('/wish/cost', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (!cfg.cost) cfg.cost = {};
            if (req.body.single !== undefined) {
                let v = parseInt(req.body.single);
                if (isNaN(v) || v < 0) return res.json({ code: 400, msg: 'single必须为非负整数' });
                cfg.cost.single = v;
            }
            if (req.body.ten !== undefined) {
                let v = parseInt(req.body.ten);
                if (isNaN(v) || v < 0) return res.json({ code: 400, msg: 'ten必须为非负整数' });
                cfg.cost.ten = v;
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改祈愿花费配置', JSON.stringify(cfg.cost));
            res.json({ code: 200, msg: '修改成功', data: cfg.cost });
        } catch (e) {
            res.json({ code: 500, msg: '修改祈愿花费配置失败: ' + e.message });
        }
    });

    // 修改祈愿系统自定义货币名称（尘核和核心的显示名称）
    router.put('/wish/names', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (req.body.dustName !== undefined) {
                if (typeof req.body.dustName !== 'string' || req.body.dustName.trim() === '') {
                    return res.json({ code: 400, msg: 'dustName不能为空' });
                }
                cfg.dustName = req.body.dustName.trim();
            }
            if (req.body.coreName !== undefined) {
                if (typeof req.body.coreName !== 'string' || req.body.coreName.trim() === '') {
                    return res.json({ code: 400, msg: 'coreName不能为空' });
                }
                cfg.coreName = req.body.coreName.trim();
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改祈愿自定义名称', 'dustName:' + cfg.dustName + ' coreName:' + cfg.coreName);
            res.json({ code: 200, msg: '修改成功', data: { dustName: cfg.dustName, coreName: cfg.coreName } });
        } catch (e) {
            res.json({ code: 500, msg: '修改自定义名称失败: ' + e.message });
        }
    });

    // 修改祈愿系统说明文本（展示在前端祈愿页面）
    router.put('/wish/description', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (req.body.description !== undefined) {
                cfg.description = req.body.description;
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改祈愿系统说明', 'description已更新');
            res.json({ code: 200, msg: '修改成功', data: { description: cfg.description } });
        } catch (e) {
            res.json({ code: 500, msg: '修改祈愿系统说明失败: ' + e.message });
        }
    });

    // 功能开关映射：旧键名 → [新对象路径, 新字段名]
    var featureMap = [
        ['enableRank', 'rank', 'enabled'],
        ['enableShop', 'shop', 'enabled'],
        ['enableCdk', 'cdk', 'enabled'],
        ['enableRecycle', 'shop', 'enableRecycle'],
        ['enableDustShop', 'shop', 'enableDustShop'],
        ['enableWish', 'wish', 'enabled'],
        ['enableBank', 'bank', 'enabled'],
        ['enableVip', 'vip', 'enabled'],
        ['enableFriend', 'friend', 'enabled'],
        ['enableMessageBoard', 'messageBoard', 'enabled'],
        ['enableMail', 'mail', 'enabled'],
        ['enableLevel', 'level', 'enabled'],
        ['enableBack', 'back', 'enabled'],
        ['enableGuild', 'guild', 'enabled']
    ];

    // 获取所有功能开关状态（未设置的功能默认为开启）
    router.get('/features', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            let content = d.fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            let cfg = JSON.parse(content);
            const features = {};
            featureMap.forEach(function(item) {
                var oldKey = item[0], objKey = item[1], field = item[2];
                var val = (cfg[objKey] && cfg[objKey][field] !== undefined) ? cfg[objKey][field] : true;
                features[oldKey] = val;
            });
            res.json({ code: 200, data: features });
        } catch (e) {
            res.json({ code: 500, msg: '获取功能开关失败: ' + e.message });
        }
    });

    // 批量修改功能开关（只更新请求中包含的字段），触发配置热重载
    router.put('/features', d.adminAuth, d.configLimiter, function(req, res) {
        try {
            let content = d.fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            let cfg = JSON.parse(content);
            const updated = {};
            featureMap.forEach(function(item) {
                var oldKey = item[0], objKey = item[1], field = item[2];
                if (req.body[oldKey] !== undefined) {
                    if (!cfg[objKey] || typeof cfg[objKey] !== 'object') cfg[objKey] = {};
                    cfg[objKey][field] = !!req.body[oldKey];
                    updated[oldKey] = cfg[objKey][field];
                }
            });
            d.fs.writeFileSync(WISH_CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
            d.triggerReload('config');
            d.adminLog.log(req.user.uid, '修改功能开关', JSON.stringify(updated));
            res.json({ code: 200, msg: '修改成功', data: updated });
        } catch (e) {
            res.json({ code: 500, msg: '修改功能开关失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
