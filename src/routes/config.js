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
 * NECE 配置路由模块
 * 祈愿配置管理API，修改后触发热重载
 */

function registerRoutes(router, d) {

    const WISH_CONFIG_PATH = d.pathModule.join(__dirname, '..', '..', 'wish_config.json');
    const MAIN_CONFIG_PATH = d.pathModule.join(__dirname, '..', '..', 'config.json');

    // 从wish_config.json读取祈愿配置
    function loadWishConfig() {
        try {
            let content = d.fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return {};
        }
    }

    // 保存祈愿配置到wish_config.json，触发祈愿模块热重载
    function saveWishConfig(wishCfg) {
        try {
            d.fs.writeFileSync(WISH_CONFIG_PATH, JSON.stringify(wishCfg, null, 4), 'utf-8');
            d.triggerReload('wish');
        } catch (e) {
            throw e;
        }
    }

    // ===== 以下祈愿相关接口仅在 wish 模块存在时注册 =====
    if (d.hasWish) {

    // 获取祈愿配置
    router.get('/wish', d.adminAuth, function(req, res) {
        try {
            let config = loadWishConfig();
            res.json({ code: 200, data: config });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取祈愿配置失败: ' + e.message });
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
            res.status(500).json({ code: 500, msg: '修改卡池信息失败: ' + e.message });
        }
    });

    // 添加四星奖励物品
    router.post('/wish/fourStar', d.adminAuth, function(req, res) {
        try {
            let name = req.body.name;
            let snbt = req.body.snbt;
            if (!name || !snbt) {
                return res.status(400).json({ code: 400, msg: 'name和snbt为必填项' });
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
            res.status(500).json({ code: 500, msg: '添加四星奖励失败: ' + e.message });
        }
    });

    // 修改指定索引的四星奖励
    router.put('/wish/fourStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fourStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.status(404).json({ code: 404, msg: '奖励不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            config.rewards.fourStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '修改四星奖励', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改四星奖励失败: ' + e.message });
        }
    });

    // 删除指定索引的四星奖励
    router.delete('/wish/fourStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fourStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.status(404).json({ code: 404, msg: '奖励不存在' });
            }
            let removed = list.splice(idx, 1)[0];
            config.rewards.fourStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '删除四星奖励', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除四星奖励失败: ' + e.message });
        }
    });

    // 添加五星奖励物品
    router.post('/wish/fiveStar', d.adminAuth, function(req, res) {
        try {
            let name = req.body.name;
            let snbt = req.body.snbt;
            if (!name || !snbt) {
                return res.status(400).json({ code: 400, msg: 'name和snbt为必填项' });
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
            res.status(500).json({ code: 500, msg: '添加五星奖励失败: ' + e.message });
        }
    });

    // 修改指定索引的五星奖励
    router.put('/wish/fiveStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fiveStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.status(404).json({ code: 404, msg: '奖励不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            config.rewards.fiveStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '修改五星奖励', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改五星奖励失败: ' + e.message });
        }
    });

    // 删除指定索引的五星奖励
    router.delete('/wish/fiveStar/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = (config.rewards && config.rewards.fiveStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.status(404).json({ code: 404, msg: '奖励不存在' });
            }
            let removed = list.splice(idx, 1)[0];
            config.rewards.fiveStar = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '删除五星奖励', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除五星奖励失败: ' + e.message });
        }
    });

    // 添加核心兑换商店物品
    router.post('/wish/coreShop', d.adminAuth, function(req, res) {
        try {
            let name = req.body.name;
            let snbt = req.body.snbt;
            let cost = req.body.cost;
            if (!name || !snbt || cost === undefined) {
                return res.status(400).json({ code: 400, msg: 'name、snbt和cost为必填项' });
            }
            let config = loadWishConfig();
            if (!config.coreShop) config.coreShop = [];
            let item = { name: name, snbt: snbt, cost: cost, description: req.body.description || '', icon: req.body.icon || '' };
            config.coreShop.push(item);
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '添加核心兑换物品', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加核心兑换物品失败: ' + e.message });
        }
    });

    // 修改指定索引的核心兑换物品
    router.put('/wish/coreShop/:index', d.adminAuth, function(req, res) {
        try {
            let idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = config.coreShop || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.status(404).json({ code: 404, msg: '兑换物品不存在' });
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
            res.status(500).json({ code: 500, msg: '修改核心兑换物品失败: ' + e.message });
        }
    });

    // 删除指定索引的核心兑换物品
    router.delete('/wish/coreShop/:index', d.adminAuth, function(req, res) {
        try {
            const idx = parseInt(req.params.index);
            let config = loadWishConfig();
            let list = config.coreShop || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.status(404).json({ code: 404, msg: '兑换物品不存在' });
            }
            let removed = list.splice(idx, 1)[0];
            config.coreShop = list;
            saveWishConfig(config);
            d.adminLog.log(req.user.uid, '删除核心兑换物品', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除核心兑换物品失败: ' + e.message });
        }
    });

    // 修改三星物品的尘核掉落范围
    router.put('/wish/threeStar', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (!cfg.rewards) cfg.rewards = {};
            if (!cfg.rewards.threeStar) cfg.rewards.threeStar = {};
            if (req.body.minDust !== undefined) {
                const min = parseInt(req.body.minDust);
                if (isNaN(min) || min < 0) return res.status(400).json({ code: 400, msg: 'minDust必须为非负整数' });
                cfg.rewards.threeStar.minDust = min;
            }
            if (req.body.maxDust !== undefined) {
                const max = parseInt(req.body.maxDust);
                if (isNaN(max) || max < 0) return res.status(400).json({ code: 400, msg: 'maxDust必须为非负整数' });
                cfg.rewards.threeStar.maxDust = max;
            }
            if (cfg.rewards.threeStar.minDust > cfg.rewards.threeStar.maxDust) {
                return res.status(400).json({ code: 400, msg: 'minDust不能大于maxDust' });
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改三星物品配置', JSON.stringify(cfg.rewards.threeStar));
            res.json({ code: 200, msg: '修改成功', data: cfg.rewards.threeStar });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改三星物品配置失败: ' + e.message });
        }
    });

    // 修改祈愿概率配置
    router.put('/wish/rates', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (!cfg.rates) cfg.rates = {};
            if (req.body.fiveStar !== undefined) {
                let v = parseFloat(req.body.fiveStar);
                if (isNaN(v) || v < 0 || v > 1) return res.status(400).json({ code: 400, msg: 'fiveStar概率必须在0-1之间' });
                cfg.rates.fiveStar = v;
            }
            if (req.body.fourStar !== undefined) {
                let v = parseFloat(req.body.fourStar);
                if (isNaN(v) || v < 0 || v > 1) return res.status(400).json({ code: 400, msg: 'fourStar概率必须在0-1之间' });
                cfg.rates.fourStar = v;
            }
            // 软保底：达到该抽数后概率逐步提升
            if (req.body.fiveStarSoftPity !== undefined) {
                let v = parseInt(req.body.fiveStarSoftPity);
                if (isNaN(v) || v < 1) return res.status(400).json({ code: 400, msg: 'fiveStarSoftPity必须为正整数' });
                cfg.rates.fiveStarSoftPity = v;
            }
            // 硬保底：达到该抽数必出五星
            if (req.body.fiveStarHardPity !== undefined) {
                let v = parseInt(req.body.fiveStarHardPity);
                if (isNaN(v) || v < 1) return res.status(400).json({ code: 400, msg: 'fiveStarHardPity必须为正整数' });
                cfg.rates.fiveStarHardPity = v;
            }
            if (req.body.fourStarGuarantee !== undefined) {
                let v = parseInt(req.body.fourStarGuarantee);
                if (isNaN(v) || v < 1) return res.status(400).json({ code: 400, msg: 'fourStarGuarantee必须为正整数' });
                cfg.rates.fourStarGuarantee = v;
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改祈愿概率配置', JSON.stringify(cfg.rates));
            res.json({ code: 200, msg: '修改成功', data: cfg.rates });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改祈愿概率配置失败: ' + e.message });
        }
    });

    // 修改祈愿花费配置
    router.put('/wish/cost', d.adminAuth, function(req, res) {
        try {
            let cfg = loadWishConfig();
            if (!cfg.cost) cfg.cost = {};
            if (req.body.single !== undefined) {
                let v = parseInt(req.body.single);
                if (isNaN(v) || v < 0) return res.status(400).json({ code: 400, msg: 'single必须为非负整数' });
                cfg.cost.single = v;
            }
            if (req.body.ten !== undefined) {
                let v = parseInt(req.body.ten);
                if (isNaN(v) || v < 0) return res.status(400).json({ code: 400, msg: 'ten必须为非负整数' });
                cfg.cost.ten = v;
            }
            saveWishConfig(cfg);
            d.adminLog.log(req.user.uid, '修改祈愿花费配置', JSON.stringify(cfg.cost));
            res.json({ code: 200, msg: '修改成功', data: cfg.cost });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改祈愿花费配置失败: ' + e.message });
        }
    });

    // 修改祈愿系统说明文本
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
            res.status(500).json({ code: 500, msg: '修改祈愿系统说明失败: ' + e.message });
        }
    });

    } // end hasWish
}

module.exports = { registerRoutes };
