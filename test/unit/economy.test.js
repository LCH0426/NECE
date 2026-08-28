/**
 * NECE 经济系统测试
 * 覆盖 src/economy.js 的余额查询、货币增减、货币名称读取等功能
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, freshRequire, clearAllIntervals, lse } = require('../helpers/setup');

describe('economy 模块', () => {
    let economy;

    before(() => {
        setupMocks();
        createAndRegisterPlayer('10001', '玩家一');
        createAndRegisterPlayer('10002', '玩家二');

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