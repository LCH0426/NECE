const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, lse } = require('../helpers/setup');

describe('economy', () => {
    let economy;
    let player;

    before(() => {
        setupMocks();
        player = createAndRegisterPlayer('10001', 'TestPlayer');
        lse.money.set('10001', 1000);

        const configDM = createMockDM({ currencyName: '星茜' });
        economy = require('../../src/economy');
        economy.init({
            config: { get: function(key, def) { return configDM.get(key) || def; } },
            getPlayerData: function() { return { players: {} }; },
            getPlayerAvatarUrl: function() { return ''; },
            logger: lse.logger
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('getCurrencyName', () => {
        it('should return configured currency name', () => {
            assert.equal(economy.getCurrencyName(), '星茜');
        });
    });

    describe('getPlayerMoneyByXuid', () => {
        it('should return player balance', () => {
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 1000);
        });

        it('should return 0 for unknown player', () => {
            assert.equal(economy.getPlayerMoneyByXuid('99999'), 0);
        });
    });

    describe('addPlayerMoneyByXuid', () => {
        it('should increase balance', () => {
            economy.addPlayerMoneyByXuid('10001', 500);
            assert.equal(economy.getPlayerMoneyByXuid('10001'), 1500);
        });
    });

    describe('reducePlayerMoney', () => {
        it('should decrease balance via money global', () => {
            lse.money.set('10001', 1500);
            const result = economy.reducePlayerMoney({ xuid: '10001', realName: 'TestPlayer', tell: function() {} }, 200);
            assert.equal(lse.money.get('10001'), 1300);
        });
    });
});
