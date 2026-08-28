/**
 * NECE 系统监控测试 —— 驱动 src/monitoring.js 真实逻辑
 * 覆盖：TPS 读取/默认值、全服资金统计（含缓存）、经济排行、完整余额排行、
 *      玩家人数采样/趋势/摘要、内存信息
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, freshRequire, clearAllIntervals, lse } = require('../helpers/setup');

describe('monitoring', () => {
    before(() => setupMocks());
    after(() => teardownMocks());

    describe('getTps 默认值', () => {
        let mono;
        before(() => { mono = freshRequire('../../src/monitoring'); });

        it('未初始化时返回默认 20.00', () => {
            assert.deepEqual(mono.getTps(), { tps: '20.00' });
        });
    });

    describe('游戏统计', () => {
        let mono;
        let moneyRef;
        let playerData;

        before(() => {
            mono = freshRequire('../../src/monitoring');
            moneyRef = lse.money;
            playerData = {
                players: {
                    '10001': { name: 'A', bankdata: { current: { balance: 100 }, fixed: [{ status: 'active', principal: 50 }, { status: 'inactive', principal: 999 }] } },
                    '10002': { name: 'B', bankdata: { current: { balance: 20 }, fixed: [] } },
                    '10003': { name: 'C' }
                }
            };
            lse.money.set('10001', 300);
            lse.money.set('10002', 100);
            lse.money.set('10003', 50);
            const db = { getPlayerCountHistory: function() { return []; } };
            mono.init({ tps: '19.50' }, moneyRef, playerData, db);
        });

        it('返回配置的 TPS', () => {
            assert.deepEqual(mono.getTps(), { tps: '19.50' });
        });

        it('getAllMoney 累加全服余额，命中缓存', () => {
            const first = mono.getAllMoney();
            assert.equal(first.totalMoney, 450);
            assert.equal(first.playerCount, 3);
            assert.equal(first.cached, false);
            const second = mono.getAllMoney();
            assert.equal(second.cached, true);
            assert.equal(second.totalMoney, 450);
        });

        it('getEconomyRank 计算余额排行与银行统计', () => {
            const rank = mono.getEconomyRank();
            assert.deepEqual(rank.topBalances, [{ name: 'A', balance: 300 }, { name: 'B', balance: 100 }, { name: 'C', balance: 50 }]);
            // 总活期 100+20=120，总定期仅统计 active 的 50
            assert.equal(rank.totalBankCurrent, 120);
            assert.equal(rank.totalBankFixed, 50);
            assert.equal(rank.totalBankAll, 170);
            assert.equal(rank.topBankDeposits.length, 2);
            assert.equal(rank.topBankDeposits[0].name, 'A');
            assert.equal(rank.topBankDeposits[0].bankTotal, 150);
        });

        it('getFullBalanceRank 支持升降序', () => {
            mono.getEconomyRank(); // 确保缓存已填充
            assert.deepEqual(mono.getFullBalanceRank('desc').map(function(i) { return i.xuid; }), ['10001', '10002', '10003']);
            assert.deepEqual(mono.getFullBalanceRank('asc').map(function(i) { return i.xuid; }), ['10003', '10002', '10001']);
        });
    });

    describe('每天玩家统计', () => {
        let mono;
        let history;
        before(() => {
            mono = freshRequire('../../src/monitoring');
            history = [{ count: 5 }, { count: 3 }];
            const db = { getPlayerCountHistory: function() { return history; } };
            createAndRegisterPlayer('10001', 'A');
            createAndRegisterPlayer('10002', 'B');
            mono.init({ tps: '20' }, lse.money, { players: {} }, db);
        });
        after(() => clearAllIntervals());

        it('getPlayerCountTrend 返回历史记录', () => {
            assert.equal(mono.getPlayerCountTrend(0, 9999999999), history);
        });

        it('getPlayerCountStats 统计当前人数与今日最大/均值', () => {
            const stats = mono.getPlayerCountStats();
            assert.equal(stats.current, 2); // 两个在线玩家
            assert.equal(stats.todayMax, 5);
            assert.equal(stats.todayAvg, 4); // (5+3)/2
            assert.equal(stats.todayRecords, 2);
        });

        it('startPlayerCountSampling 立即采样并写入数据库', () => {
            var calls = [];
            const db = { insertPlayerCount: function(t, c) { calls.push(c); } };
            const m2 = freshRequire('../../src/monitoring');
            m2.init({ tps: '20' }, lse.money, { players: {} }, db);
            m2.startPlayerCountSampling(600000);
            m2.stopPlayerCountSampling();
            assert.equal(calls.length, 1);
            assert.equal(calls[0], 2);
        });
    });

    describe('内存信息', () => {
        let mono;
        before(() => { mono = freshRequire('../../src/monitoring'); });

        it('getMemoryInfo 返回合理的内存字段（GB）', () => {
            const mem = mono.getMemoryInfo();
            assert.ok(mem.total > 0);
            assert.ok(typeof mem.used === 'number');
            assert.ok(typeof mem.free === 'number');
            assert.ok(mem.usagePercent >= 0 && mem.usagePercent <= 100);
        });
    });
});