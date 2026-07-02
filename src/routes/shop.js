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
 * NECE 商店路由模块
 * 商店、回收、CDK管理接口
 */

function registerRoutes(router, d) {

    const RECYCLE_PATH = d.pathModule.join(__dirname, '..', '..', 'data', 'Recycleitems.json');
    const SHOP_DATA_PATH_API = d.pathModule.join(__dirname, '..', '..', 'data', 'shopdata.json');

    // 复用 server.js 的 getItemsMap，消除重复缓存和 IO
    function loadItemsMap() {
        return d.getItemsMap();
    }

    // 验证物品ID是否在items列表中，返回标准化的minecraft:前缀ID和物品信息
    function validateItemId(rawId) {
        let itemsMap = loadItemsMap();
        let cleanId = rawId.replace(/^minecraft:/, '');
        let item = itemsMap[cleanId];
        if (item) {
            let name = (typeof item === 'object') ? (item.name || cleanId) : item;
            const texture = (typeof item === 'object') ? (item.texture || '') : '';
            return { valid: true, fullId: 'minecraft:' + cleanId, name: name, image: texture };
        }
        return { valid: false };
    }

    function loadRecycleConfig() {
        try {
            let content = d.fs.readFileSync(RECYCLE_PATH, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return { recycleItems: {} };
        }
    }

    // 保存回收配置并触发游戏内热重载
    function saveRecycleConfig(config) {
        d.fs.writeFileSync(RECYCLE_PATH, JSON.stringify(config, null, 2), 'utf-8');
        d.triggerReload('recycle');
    }

    // 合并回收配置和物品映射数据
    function getRecycleItemInfo(id, recycleItems, itemsMap) {
        let cleanId = id.replace(/^minecraft:/, '');
        let entry = recycleItems[id];
        let name = cleanId;
        let image = '';
        let price = 0;
        if (entry && typeof entry === 'object') {
            name = entry.name || cleanId;
            image = entry.image || '';
            price = entry.price;
        } else if (typeof entry === 'number') {
            price = entry;
            let item = itemsMap[cleanId];
            if (item && typeof item === 'object') {
                name = item.name || cleanId;
                image = item.texture || '';
            } else if (typeof item === 'string') {
                name = item;
            }
        }
        return { id: id, name: name, image: image, price: price };
    }

    // 获取回收物品列表
    router.get('/recycle', d.adminAuth, function(req, res) {
        try {
            let config = loadRecycleConfig();
            let itemsMap = loadItemsMap();
            let list = [];
            let recycleItems = config.recycleItems || {};
            Object.keys(recycleItems).forEach(function(id) {
                list.push(getRecycleItemInfo(id, recycleItems, itemsMap));
            });
            res.json({ code: 200, data: list });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取回收列表失败: ' });
        }
    });

    // 添加回收物品
    router.post('/recycle', d.adminAuth, function(req, res) {
        try {
            let rawId = req.body.id;
            let price = req.body.price;
            if (!rawId || price === undefined) {
                return res.status(400).json({ code: 400, msg: 'id和price为必填项' });
            }
            let v = validateItemId(rawId);
            if (!v.valid) {
                return res.status(400).json({ code: 400, msg: '物品ID无效，不在items列表中' });
            }
            let config = loadRecycleConfig();
            if (!config.recycleItems) config.recycleItems = {};
            config.recycleItems[v.fullId] = { name: v.name, image: v.image, price: price };
            saveRecycleConfig(config);
            d.adminLog.log(req.user.uid, '添加回收物品', 'ID:' + v.fullId + ' 价格:' + price);
            res.json({ code: 200, msg: '添加成功', data: { id: v.fullId, name: v.name, image: v.image, price: price } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加回收物品失败: ' });
        }
    });

    // 修改回收物品价格
    router.put('/recycle/:id', d.adminAuth, function(req, res) {
        try {
            let rawId = decodeURIComponent(req.params.id);
            let price = req.body.price;
            if (price === undefined) {
                return res.status(400).json({ code: 400, msg: 'price为必填项' });
            }
            let config = loadRecycleConfig();
            if (!config.recycleItems || config.recycleItems[rawId] === undefined) {
                return res.status(404).json({ code: 404, msg: '回收物品不存在' });
            }
            let itemsMap = loadItemsMap();
            const info = getRecycleItemInfo(rawId, config.recycleItems, itemsMap);
            config.recycleItems[rawId] = { name: info.name, image: info.image, price: price };
            saveRecycleConfig(config);
            d.adminLog.log(req.user.uid, '修改回收物品', 'ID:' + rawId + ' 价格:' + price);
            res.json({ code: 200, msg: '修改成功', data: { id: rawId, name: info.name, image: info.image, price: price } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改回收物品失败: ' });
        }
    });

    // 删除回收物品
    router.delete('/recycle/:id', d.adminAuth, function(req, res) {
        try {
            let rawId = decodeURIComponent(req.params.id);
            const config = loadRecycleConfig();
            if (!config.recycleItems || config.recycleItems[rawId] === undefined) {
                return res.status(404).json({ code: 404, msg: '回收物品不存在' });
            }
            delete config.recycleItems[rawId];
            saveRecycleConfig(config);
            d.adminLog.log(req.user.uid, '删除回收物品', 'ID:' + rawId);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除回收物品失败: ' });
        }
    });

    // 加载商店数据，文件不存在时返回空的Buy/Sell结构
    function loadShopData() {
        try {
            const content = d.fs.readFileSync(SHOP_DATA_PATH_API, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return { Buy: [], Sell: [] };
        }
    }

    function saveShopData(data) {
        d.fs.writeFileSync(SHOP_DATA_PATH_API, JSON.stringify(data, null, 2), 'utf-8');
        d.triggerReload('shop');
    }

    // 获取商店数据
    router.get('/shop', d.adminAuth, function(req, res) {
        try {
            let data = loadShopData();
            let group = req.query.group;
            if (group === 'Buy' || group === 'Sell') {
                res.json({ code: 200, data: data[group] || [] });
            } else {
                res.json({ code: 200, data: data });
            }
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取商店数据失败: ' });
        }
    });

    // 获取指定大组下的分组列表
    router.get('/shop/groups', d.adminAuth, function(req, res) {
        try {
            let data = loadShopData();
            let group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let groups = (data[group] || []).map(function(g, idx) {
                return { index: idx, name: g.name, image: g.image, itemCount: (g.items || []).length };
            });
            res.json({ code: 200, data: groups });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取商店分组失败: ' });
        }
    });

    // 添加商店分组
    router.post('/shop/group', d.adminAuth, function(req, res) {
        try {
            let group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let name = req.body.name;
            let image = req.body.image || '';
            if (!name) {
                return res.status(400).json({ code: 400, msg: '分组名称为必填项' });
            }
            let data = loadShopData();
            if (!data[group]) data[group] = [];
            const newGroup = { name: name, image: image, items: [] };
            data[group].push(newGroup);
            saveShopData(data);
            d.adminLog.log(req.user.uid, '添加商店分组', '大组:' + group + ' 名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: { index: data[group].length - 1, name: name } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加商店分组失败: ' });
        }
    });

    // 修改商店分组名称和图标
    router.put('/shop/group/:groupIdx', d.adminAuth, function(req, res) {
        try {
            let group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let gIdx = parseInt(req.params.groupIdx);
            let data = loadShopData();
            let list = data[group] || [];
            if (isNaN(gIdx) || gIdx < 0 || gIdx >= list.length) {
                return res.status(404).json({ code: 404, msg: '分组不存在' });
            }
            if (req.body.name !== undefined) list[gIdx].name = req.body.name;
            if (req.body.image !== undefined) list[gIdx].image = req.body.image;
            data[group] = list;
            saveShopData(data);
            d.adminLog.log(req.user.uid, '修改商店分组', '索引:' + gIdx + ' 名称:' + list[gIdx].name);
            res.json({ code: 200, msg: '修改成功', data: { index: gIdx, name: list[gIdx].name } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改商店分组失败: ' });
        }
    });

    // 删除商店分组
    router.delete('/shop/group/:groupIdx', d.adminAuth, function(req, res) {
        try {
            let group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let gIdx = parseInt(req.params.groupIdx);
            let data = loadShopData();
            let list = data[group] || [];
            if (isNaN(gIdx) || gIdx < 0 || gIdx >= list.length) {
                return res.status(404).json({ code: 404, msg: '分组不存在' });
            }
            let removed = list.splice(gIdx, 1)[0];
            data[group] = list;
            saveShopData(data);
            d.adminLog.log(req.user.uid, '删除商店分组', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除商店分组失败: ' });
        }
    });

    // 获取指定分组下的物品列表
    router.get('/shop/items', d.adminAuth, function(req, res) {
        try {
            let group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let gIdx = parseInt(req.query.groupIdx);
            if (isNaN(gIdx)) {
                return res.status(400).json({ code: 400, msg: 'groupIdx参数必填' });
            }
            let data = loadShopData();
            let groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.status(404).json({ code: 404, msg: '分组不存在' });
            }
            let items = groups[gIdx].items || [];
            const itemsMap = loadItemsMap();
            // 合并商店物品数据和物品映射表，补充显示名称和贴图
            let result = items.map(function(item, idx) {
                const cleanId = (item.id || '').replace(/^minecraft:/, '');
                let itemInfo = itemsMap[cleanId] || {};
                const itemName = (typeof itemInfo === 'object') ? (itemInfo.name || cleanId) : itemInfo;
                const itemTexture = (typeof itemInfo === 'object') ? (itemInfo.texture || '') : '';
                return { index: idx, id: item.id || '', name: itemName, image: itemTexture, money: item.money || 0 };
            });
            res.json({ code: 200, data: result });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取商店物品失败: ' });
        }
    });

    // 添加商店物品到指定分组
    router.post('/shop/item', d.adminAuth, function(req, res) {
        try {
            let group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let gIdx = parseInt(req.body.groupIdx);
            if (isNaN(gIdx)) {
                return res.status(400).json({ code: 400, msg: 'groupIdx参数必填' });
            }
            const rawId = req.body.id;
            let money = req.body.money;
            if (!rawId || money === undefined) {
                return res.status(400).json({ code: 400, msg: 'id和money为必填项' });
            }
            let v = validateItemId(rawId);
            if (!v.valid) {
                return res.status(400).json({ code: 400, msg: '物品ID无效，不在items列表中' });
            }
            let data = loadShopData();
            let groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.status(404).json({ code: 404, msg: '分组不存在' });
            }
            const newItem = { id: v.fullId, money: money, name: v.name, image: v.image };
            if (!groups[gIdx].items) groups[gIdx].items = [];
            groups[gIdx].items.push(newItem);
            data[group] = groups;
            saveShopData(data);
            d.adminLog.log(req.user.uid, '添加商店物品', '大组:' + group + ' 分组:' + gIdx + ' ID:' + v.fullId);
            res.json({ code: 200, msg: '添加成功', data: { id: v.fullId, name: v.name, money: money } });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加商店物品失败: ' });
        }
    });

    // 修改商店物品的ID和/或价格
    router.put('/shop/item/:itemIdx', d.adminAuth, function(req, res) {
        try {
            let group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            let gIdx = parseInt(req.body.groupIdx);
            let iIdx = parseInt(req.params.itemIdx);
            if (isNaN(gIdx) || isNaN(iIdx)) {
                return res.status(400).json({ code: 400, msg: 'groupIdx和itemIdx参数必填' });
            }
            let data = loadShopData();
            let groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.status(404).json({ code: 404, msg: '分组不存在' });
            }
            let items = groups[gIdx].items || [];
            if (iIdx < 0 || iIdx >= items.length) {
                return res.status(404).json({ code: 404, msg: '物品不存在' });
            }
            // 修改ID时需重新验证物品有效性，同时更新name和image
            if (req.body.id !== undefined) {
                const v = validateItemId(req.body.id);
                if (!v.valid) {
                    return res.status(400).json({ code: 400, msg: '物品ID无效，不在items列表中' });
                }
                items[iIdx].id = v.fullId;
                items[iIdx].name = v.name;
                items[iIdx].image = v.image;
            }
            if (req.body.money !== undefined) {
                items[iIdx].money = req.body.money;
            }
            groups[gIdx].items = items;
            data[group] = groups;
            saveShopData(data);
            d.adminLog.log(req.user.uid, '修改商店物品', '大组:' + group + ' 分组:' + gIdx + ' 物品索引:' + iIdx);
            res.json({ code: 200, msg: '修改成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '修改商店物品失败: ' });
        }
    });

    // 删除商店指定分组中的指定物品
    router.delete('/shop/item/:itemIdx', d.adminAuth, function(req, res) {
        try {
            const group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.status(400).json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            const gIdx = parseInt(req.query.groupIdx);
            const iIdx = parseInt(req.params.itemIdx);
            if (isNaN(gIdx) || isNaN(iIdx)) {
                return res.status(400).json({ code: 400, msg: 'groupIdx参数必填' });
            }
            const data = loadShopData();
            const groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.status(404).json({ code: 404, msg: '分组不存在' });
            }
            let items = groups[gIdx].items || [];
            if (iIdx < 0 || iIdx >= items.length) {
                return res.status(404).json({ code: 404, msg: '物品不存在' });
            }
            const removed = items.splice(iIdx, 1)[0];
            groups[gIdx].items = items;
            data[group] = groups;
            saveShopData(data);
            d.adminLog.log(req.user.uid, '删除商店物品', 'ID:' + (removed.id || ''));
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除商店物品失败: ' });
        }
    });
}

module.exports = { registerRoutes };
