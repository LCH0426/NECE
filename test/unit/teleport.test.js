/**
 * NECE 传送系统测试 —— 驱动 src/teleport.js 真实逻辑
 * 覆盖：配置读取、家园增删改查（通过表单回调驱动）、TPA 收发/接受/拒绝/取消、
 *      安全传送、死亡点记录与传送、脏标记
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, freshRequire, clearAllIntervals } = require('../helpers/setup');
const i18n = require('../../src/i18n');

// 表单驱动辅助：拦截 player.sendForm 以手动触发表单回调
function harness(p) {
    p._cb = null;
    p.sendForm = function(form, cb) { this._cb = cb; };
    p.sendModalForm = function(title, content, b1, b2, cb) { this._cb = cb; };
}
function submit(p, value) {
    var cb = p._cb;
    p._cb = null;
    if (cb) cb(p, value);
}

// 构造默认 teleport deps
function baseDeps(options) {
    options = options || {};
    return {
        t: i18n.t,
        getSystemLanguage: function() { return 'zh_CN'; },
        getPlayerSetting: function() { return undefined; },
        getConfig: function() { return options.config || {}; },
        playerData: { players: { '10001': { name: 'A' }, '10002': { name: 'B' } } },
        getPlayerMoney: function() { return 1000; },
        reducePlayerMoney: function() { return true; },
        addPlayerMoney: function() { return true; },
        getCurrencyName: function() { return '星茜'; }
    };
}

describe('teleport', () => {
    before(() => setupMocks());
    after(() => teardownMocks());

    describe('tpsConfig (getTpConfig)', () => {
        let tp;
        before(() => {
            tp = freshRequire('../../src/teleport');
            tp.init(createMockDM({}), createMockDM({}), baseDeps({ config: { enabled: false, homeLimit: 5 } }));
        });
        after(() => clearAllIntervals());

        it('读取配置中覆盖的字段', () => {
            const c = tp.tpsConfig();
            assert.equal(c.enabled, false);
            assert.equal(c.homeLimit, 5);
        });
        it('未配置字段使用默认值', () => {
            const c = tp.tpsConfig();
            assert.equal(c.enableHome, true);
            assert.equal(c.enableWarp, true);
            assert.equal(c.enableTpa, true);
            assert.equal(c.warpCost, 0);
            assert.equal(c.rtpRadius, 10000);
            assert.equal(c.homeCooldown, 10);
        });
    });

    describe('safeTeleport', () => {
        let tp;
        let calls;
        before(() => {
            tp = freshRequire('../../src/teleport');
            tp.init(createMockDM({}), createMockDM({}), baseDeps());
        });
        after(() => clearAllIntervals());

        it('使用 FloatPos 成功传送返回 true', () => {
            const p = createAndRegisterPlayer('10001', 'A');
            p.teleport = function(pos) { calls.push(pos); };
            calls = [];
            assert.equal(tp.safeTeleport(p, 1, 2, 3, 0), true);
            assert.equal(calls.length, 1);
            assert.equal(calls[0].type, 'FloatPos');
            assert.equal(calls[0].x, 1);
            assert.equal(calls[0].dim, 0);
        });

        it('dim 为 NaN 或空时默认主世界(0)', () => {
            const p = createAndRegisterPlayer('10001', 'A');
            p.teleport = function(pos) { calls.push(pos.dim); };
            calls = [];
            assert.equal(tp.safeTeleport(p, 1, 2, 3, 'abc'), true);
            assert.equal(calls[0], 0);
        });

        it('teleport 抛错时回退 runcmdEx 仍成功', () => {
            const prev = global.mc.runcmdEx;
            global.mc.runcmdEx = function() { return { success: true, output: '' }; };
            const p = createAndRegisterPlayer('10001', 'A');
            p.teleport = function() { throw new Error('fail'); };
            try {
                assert.equal(tp.safeTeleport(p, 1, 2, 3, 1), true);
            } finally {
                global.mc.runcmdEx = prev;
            }
        });

        it('全部失败时返回 false', () => {
            const prev = global.mc.runcmdEx;
            global.mc.runcmdEx = function() { return { success: false, output: '' }; };
            const p = createAndRegisterPlayer('10001', 'A');
            p.teleport = function() { throw new Error('fail'); };
            p.runcmd = function() { return false; };
            try {
                assert.equal(tp.safeTeleport(p, 1, 2, 3, 1), false);
            } finally {
                global.mc.runcmdEx = prev;
            }
        });
    });

    describe('家园增删改查（表单驱动）', () => {
        let tp, homesDM, deps, A;
        before(() => {
            tp = freshRequire('../../src/teleport');
            homesDM = createMockDM({});
            tp.init(homesDM, createMockDM({}), baseDeps({ config: { homeLimit: 2 } }));
            deps = baseDeps({ config: { homeLimit: 2 } });
            A = createAndRegisterPlayer('10001', 'A');
            harness(A);
        });
        after(() => clearAllIntervals());

        it('新增家园并写入共享数据、标记脏、触发保存', () => {
            tp.showHomeMainForm(A, deps);
            submit(A, 0); // 打开设置家园表单
            submit(A, ['主城', false]); // 输入名称提交
            assert.equal(homesDM.data['10001'].length, 1);
            assert.equal(homesDM.data['10001'][0].name, '主城');
            assert.equal(homesDM.data['10001'][0].dim, A.pos.dimid);
            assert.equal(homesDM.data['10001'][0].public, false);
            assert.deepEqual(tp.flushDirtyHomes(), ['10001']);
            assert.ok(homesDM._saveCount >= 1);
        });

        it('重复名称被拒绝，不新增家园', () => {
            tp.showHomeMainForm(A, deps);
            submit(A, 1); // 已有1个家园，打开设置表单的按钮索引为 1
            submit(A, ['主城', false]); // 重名
            assert.equal(homesDM.data['10001'].length, 1);
        });

        it('删除家园', () => {
            tp.showHomeMainForm(A, deps);
            submit(A, 0); // 选中第一个家园 -> 详情
            submit(A, 2); // 详情中点击删除 -> 确认框
            submit(A, 0); // 确认删除
            assert.equal(homesDM.data['10001'].length, 0);
            assert.deepEqual(tp.flushDirtyHomes(), ['10001']);
        });
    });

    describe('TPA 收发 / 接受 / 拒绝 / 取消', () => {
        let tp, deps, A, B, tpCalls;
        before(() => {
            tp = freshRequire('../../src/teleport');
            deps = baseDeps();
            deps.playerData = { players: { '10001': { name: 'A' }, '10002': { name: 'B' } } };
            tp.init(createMockDM({}), createMockDM({}), deps);
            A = createAndRegisterPlayer('10001', 'A');
            B = createAndRegisterPlayer('10002', 'B');
            harness(A);
            harness(B);
            tpCalls = [];
            A.teleport = function(pos) { tpCalls.push(pos); };
        });
        after(() => clearAllIntervals());

        // 通过 tpa 主菜单向 B 发起一个 tpa 请求
        function sendRequest() {
            tp.showTpaMainForm(A, deps);
            submit(A, [null, 0, 0]); // 选择 B，方式 tpa
        }

        it('发起请求后目标方可接受并传送发起者', () => {
            sendRequest();
            tp.acceptTpaRequestByPlayer(B, deps);
            assert.equal(tpCalls.length, 1);
        });

        it('拒绝后请求被移除，再次接受无效果', () => {
            sendRequest();
            tp.denyTpaRequestByPlayer(B);
            tpCalls.length = 0;
            tp.acceptTpaRequestByPlayer(B, deps);
            assert.equal(tpCalls.length, 0);
        });

        it('发起者可取消全部请求，取消后目标无法接受', () => {
            sendRequest();
            tp.cancelTpaRequest(A);
            tpCalls.length = 0;
            tp.acceptTpaRequestByPlayer(B, deps);
            assert.equal(tpCalls.length, 0);
        });
    });

    describe('死亡点记录与传送', () => {
        let tp, dm, A, tpCalls;
        before(() => {
            tp = freshRequire('../../src/teleport');
            dm = createMockDM({ players: {} });
            tp.initDeathPoint(dm);
            A = createAndRegisterPlayer('10001', 'A');
            tpCalls = [];
            A.teleport = function(pos) { tpCalls.push(pos); };
        });
        after(() => clearAllIntervals());

        it('记录死亡点并保留在数据中', () => {
            tp.recordDeathPoint(A);
            const players = tp.getDeathPointData().players;
            assert.equal(players['10001'].length, 1);
            assert.equal(players['10001'][0].dimId, 0);
            assert.ok(players['10001'][0].timestamp);
        });

        it('超过10条时截断为最近10条', () => {
            for (var i = 0; i < 12; i++) tp.recordDeathPoint(A);
            assert.equal(tp.getDeathPointData().players['10001'].length, 10);
        });

        it('传送到有效索引的死亡点', () => {
            tp.teleportToDeathPoint(A, 0);
            assert.equal(tpCalls.length, 1);
        });

        it('越界索引不传送', () => {
            var len = tpCalls.length;
            tp.teleportToDeathPoint(A, 999);
            assert.equal(tpCalls.length, len);
        });
    });
});