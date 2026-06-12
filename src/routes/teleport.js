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
 * NECE 传送路由模块
 * 传送点和家园管理接口
 */

function registerRoutes(router, d) {

    const WARPS_DATA_PATH = d.pathModule.join(__dirname, '..', '..', 'data', 'warps.json');
    const HOMES_DATA_PATH = d.pathModule.join(__dirname, '..', '..', 'data', 'homes.json');

    function readJsonFile(filePath) {
        try {
            if (d.fs.existsSync(filePath)) {
                return JSON.parse(d.fs.readFileSync(filePath, 'utf-8'));
            }
        } catch (e) {}
        return {};
    }

    function writeJsonFile(filePath, data) {
        d.fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
    }

    // 获取所有传送点列表（含坐标、维度、花费和冷却时间）
    router.get('/teleport/warps', d.adminAuth, function(req, res) {
        try {
            let warps = readJsonFile(WARPS_DATA_PATH);
            let list = [];
            for (let name in warps) {
                const w = warps[name];
                list.push({ name: name, x: w.x, y: w.y, z: w.z, dim: w.dim, cost: w.cost || 0, cdSec: w.cdSec || 0 });
            }
            res.json({ code: 200, data: list });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取传送点列表失败: ' + e.message });
        }
    });

    // 添加传送点（名称不可重复）
    router.post('/teleport/warps', d.adminAuth, function(req, res) {
        try {
            let body = req.body;
            let name = (body.name || '').trim();
            if (!name) return res.status(400).json({ code: 400, msg: '传送点名称不能为空' });

            // 坐标类型校验
            var x = Number(body.x), y = Number(body.y), z = Number(body.z);
            var dim = Number(body.dim);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
                return res.status(400).json({ code: 400, msg: '坐标必须为有效数字' });
            }
            if (dim !== 0 && dim !== 1 && dim !== 2) {
                return res.status(400).json({ code: 400, msg: '维度必须为 0(主世界)、1(下界) 或 2(末地)' });
            }
            var cost = Number(body.cost) || 0;
            var cdSec = Number(body.cdSec) || 0;
            if (cost < 0 || cdSec < 0) {
                return res.status(400).json({ code: 400, msg: '费用和冷却时间不能为负数' });
            }

            let warps = readJsonFile(WARPS_DATA_PATH);
            if (warps[name]) return res.status(400).json({ code: 400, msg: '已存在同名传送点' });
            warps[name] = { x: x, y: y, z: z, dim: dim, cost: cost, cdSec: cdSec };
            writeJsonFile(WARPS_DATA_PATH, warps);
            d.adminLog.log(req.user.uid, '添加传送点', '名称:' + name);
            res.json({ code: 200, msg: '传送点添加成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '添加传送点失败: ' + e.message });
        }
    });

    // 修改传送点坐标/维度/花费/冷却（按名称定位）
    router.put('/teleport/warps/:name', d.adminAuth, function(req, res) {
        try {
            let name = req.params.name;
            let body = req.body;
            let warps = readJsonFile(WARPS_DATA_PATH);
            if (!warps[name]) return res.status(404).json({ code: 404, msg: '传送点不存在' });

            if (body.x !== undefined) { var v = Number(body.x); if (!isFinite(v)) return res.status(400).json({code:400,msg:'x 坐标必须为数字'}); warps[name].x = v; }
            if (body.y !== undefined) { var v = Number(body.y); if (!isFinite(v)) return res.status(400).json({code:400,msg:'y 坐标必须为数字'}); warps[name].y = v; }
            if (body.z !== undefined) { var v = Number(body.z); if (!isFinite(v)) return res.status(400).json({code:400,msg:'z 坐标必须为数字'}); warps[name].z = v; }
            if (body.dim !== undefined) { var v = Number(body.dim); if (v !== 0 && v !== 1 && v !== 2) return res.status(400).json({code:400,msg:'维度必须为 0/1/2'}); warps[name].dim = v; }
            if (body.cost !== undefined) { var v = Number(body.cost); if (!isFinite(v) || v < 0) return res.status(400).json({code:400,msg:'费用不能为负数'}); warps[name].cost = v; }
            if (body.cdSec !== undefined) { var v = Number(body.cdSec); if (!isFinite(v) || v < 0) return res.status(400).json({code:400,msg:'冷却时间不能为负数'}); warps[name].cdSec = v; }

            writeJsonFile(WARPS_DATA_PATH, warps);
            d.adminLog.log(req.user.uid, '修改传送点', '名称:' + name);
            res.json({ code: 200, msg: '传送点更新成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '更新传送点失败: ' + e.message });
        }
    });

    // 删除传送点
    router.delete('/teleport/warps/:name', d.adminAuth, function(req, res) {
        try {
            const name = req.params.name;
            const warps = readJsonFile(WARPS_DATA_PATH);
            if (!warps[name]) return res.status(404).json({ code: 404, msg: '传送点不存在' });
            delete warps[name];
            writeJsonFile(WARPS_DATA_PATH, warps);
            d.adminLog.log(req.user.uid, '删除传送点', '名称:' + name);
            res.json({ code: 200, msg: '传送点删除成功' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除传送点失败: ' + e.message });
        }
    });

    // 获取所有玩家的家园列表（展平为一维数组，含所属玩家XUID）
    router.get('/teleport/homes', d.adminAuth, function(req, res) {
        try {
            let homes = readJsonFile(HOMES_DATA_PATH);
            let list = [];
            for (let xuid in homes) {
                const playerHomes = homes[xuid];
                for (let i = 0; i < playerHomes.length; i++) {
                    const h = playerHomes[i];
                    list.push({ xuid: xuid, name: h.name, x: h.x, y: h.y, z: h.z, dim: h.dim, public: h.public || false, sharedWith: h.sharedWith || [] });
                }
            }
            res.json({ code: 200, data: list, total: list.length });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取家园列表失败: ' + e.message });
        }
    });

    // 删除指定玩家的指定家园（按XUID和数组索引定位）
    router.delete('/teleport/homes/:xuid/:index', d.adminAuth, function(req, res) {
        try {
            let xuid = req.params.xuid;
            const index = parseInt(req.params.index);
            const homes = readJsonFile(HOMES_DATA_PATH);
            if (!homes[xuid] || !homes[xuid][index]) {
                return res.status(404).json({ code: 404, msg: '家园不存在' });
            }
            const homeName = homes[xuid][index].name;
            homes[xuid].splice(index, 1);
            writeJsonFile(HOMES_DATA_PATH, homes);
            d.adminLog.log(req.user.uid, '删除家园', '玩家XUID:' + xuid + ' 家园:' + homeName);
            res.json({ code: 200, msg: '家园 ' + homeName + ' 已删除' });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除家园失败: ' + e.message });
        }
    });
}

module.exports = { registerRoutes };
