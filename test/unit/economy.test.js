/**
 * NECE 经济系统测试
 * 覆盖 src/economy.js 的余额查询、货币增减、货币名称读取等功能
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { setupMocks, teardownMocks, createAndRegisterPlayer, freshRequire, clearAllIntervals, lse } = require('../helpers/setup');
const logStore = require('../../src/logStore');

describe('economy 模块', () => {
    let economy;
    let logDir;

    function readTodayLogs() {
        logStore.flush();
        return logStore.readEntries(logStore.formatDate(new Date()));
    }

    before(() => {
        setupMocks();
        createAndRegisterPlayer('10001', '玩家一');
        createAndRegisterPlayer('10002', '玩家二');
        logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nece-economy-test-'));
        logStore.init({ dir: logDir });

        // 使用 freshRequire 隔离模块状态
        economy = freshRequire('../../src/economy');
        economy.init({
            getSystemLanguage: function() { return 'zh_CN'; },
            getPlayerSetting: function() { return 'zh_CN'; },
            // 注入 loadLocale，让 getCurrencyName 能读到货币名称
            loadLocale: function() { return { _meta: { currencyName: '星茜' } }; },
            getDebug: function() { return false; },
            database: null,
            getPlayerData: function() { return { players: {} }; },
            getPlayerAvatarUrl: function(xuid) { return 'textures/ui/icon_steve'; }
        });
    });

    after(() => {
        // init 中 new 了 setInterval，清理以免测试进程不退出
        clearAllIntervals();
        logStore.shutdown();
        if (fs.existsSync(logDir)) fs.rmSync(logDir, { recursive: true, force: true });
        teardownMocks();
    });

    describe('getCurrencyName', () => {
        it('从 loadLocale 读取货币名称', () => {
            assert.equal(economy.getCurrencyName(), '星茜');
        });
    });

    describe('getPlayerMoneyByXuid', () => {
        it('读取已有余额', () => {
            lse.money.set('10001', 1200);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 1200);
        });
        it('无余额返回 0', () => {
            assert.equal(economy.getPlayerMoneyByXuid('noexist'), 0);
        });
    });

    describe('getPlayerMoney', () => {
        it('通过玩家对象读取余额', () => {
            lse.money.set('10001', 300);
            const p = lse.mc.getPlayer('10001');
            assert.equal(economy.getPlayerMoney(p), 300);
        });
        it('余额异常时返回 0', () => {
            lse.money.set('10002', NaN);
            const p = lse.mc.getPlayer('10002');
            assert.equal(economy.getPlayerMoney(p), 0);
        });
    });

    describe('addPlayerMoneyByXuid / reducePlayerMoneyByXuid', () => {
        it('XUID 加钱', () => {
            lse.money.set('10001', 100);
            assert.equal(economy.addPlayerMoneyByXuid('10001', 500), true);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 600);
        });
        it('XUID 减钱', () => {
            lse.money.set('10001', 1000);
            assert.equal(economy.reducePlayerMoneyByXuid('10001', 200), true);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 800);
        });
        it('XUID 余额不足时减钱失败且余额不变', () => {
            lse.money.set('10001', 50);
            assert.equal(economy.reducePlayerMoneyByXuid('10001', 200), false);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 50);
        });
        it('XUID 非法金额返回 false', () => {
            assert.equal(economy.addPlayerMoneyByXuid('10001', 0), false);
            assert.equal(economy.addPlayerMoneyByXuid('10001', 'abc'), false);
            assert.equal(economy.reducePlayerMoneyByXuid('10001', 0), false);
        });
        it('XUID 加钱写入 economy.add 日志', () => {
            lse.money.set('10001', 100);
            assert.equal(economy.addPlayerMoneyByXuid('10001', 250, '签到测试'), true);
            const hits = readTodayLogs().filter(function(e) {
                return e.event === 'economy.add' && e.reason === '签到测试';
            });
            assert.equal(hits.length, 1);
            assert.equal(hits[0].xuid, '10001');
            assert.equal(hits[0].amount, 250);
            assert.equal(hits[0].balance, 350);
        });
        it('XUID 减钱写入 economy.reduce 日志', () => {
            lse.money.set('10001', 500);
            assert.equal(economy.reducePlayerMoneyByXuid('10001', 120, '扣费测试'), true);
            const hits = readTodayLogs().filter(function(e) {
                return e.event === 'economy.reduce' && e.reason === '扣费测试';
            });
            assert.equal(hits.length, 1);
            assert.equal(hits[0].amount, 120);
            assert.equal(hits[0].balance, 380);
        });
        it('skipLog 为 true 时不写日志', () => {
            lse.money.set('10001', 100);
            assert.equal(economy.addPlayerMoneyByXuid('10001', 30, '跳过日志测试', true), true);
            const hits = readTodayLogs().filter(function(e) {
                return e.reason === '跳过日志测试';
            });
            assert.equal(hits.length, 0);
        });
    });

    describe('addPlayerMoney / reducePlayerMoney', () => {
        it('玩家对象加钱', () => {
            lse.money.set('10001', 100);
            const p = lse.mc.getPlayer('10001');
            assert.equal(economy.addPlayerMoney(p, 50), true);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 150);
        });
        it('玩家对象减钱', () => {
            lse.money.set('10001', 100);
            const p = lse.mc.getPlayer('10001');
            assert.equal(economy.reducePlayerMoney(p, 30), true);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 70);
        });
        it('玩家对象余额不足时减钱失败且余额不变', () => {
            lse.money.set('10001', 10);
            const p = lse.mc.getPlayer('10001');
            assert.equal(economy.reducePlayerMoney(p, 30), false);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 10);
        });
        it('非法金额被拒绝', () => {
            const p = lse.mc.getPlayer('10001');
            assert.equal(economy.addPlayerMoney(p, 'abc'), false);
            assert.equal(economy.reducePlayerMoney(p, -5), false);
        });
    });
});