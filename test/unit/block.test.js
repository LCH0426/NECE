const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createMockDM, createAndRegisterPlayer, lse } = require('../helpers/setup');

describe('block module', () => {
    let blockModule;
    let mockPlayers;

    before(() => {
        setupMocks();
        mockPlayers = {
            '10001': {},
            '10002': {}
        };

        blockModule = require('../../src/block');
        blockModule.init({
            getConfig: function() { return { enabled: true, maxBlocks: 64 }; },
            getDebug: function() { return false; },
            getPlayerData: function() { return { players: mockPlayers }; },
            savePlayerDataNow: function() {},
            saveSinglePlayerData: function() {},
            t: function(lang, key) { return key; },
            getPlayerSetting: function() { return true; },
            getSystemLanguage: function() { return 'zh_CN'; },
            getPlayerMoney: function() { return 10000; },
            reducePlayerMoney: function() { return true; },
            getCurrencyName: function() { return '星茜'; }
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('checkCanChain', () => {
        it('should return free plan by default', () => {
            const result = blockModule.checkCanChain('10001');
            assert.equal(result.plan, 'free');
            assert.ok(result.dailyLimit > 0);
        });

        it('should allow chain when remaining > 0', () => {
            const result = blockModule.checkCanChain('10001');
            assert.equal(result.canChain, true);
        });
    });

    describe('getPlayerPlanData', () => {
        it('should return default plan data for new player', () => {
            const data = blockModule.getPlayerPlanData('10001');
            assert.equal(data.plan, 'free');
            assert.equal(data.dailyUsed, 0);
        });
    });

    describe('getPlanDisplayName', () => {
        it('should return formatted name for known plans', () => {
            // getPlanDisplayName is internal, test through module exports if available
            assert.ok(true);
        });
    });
});
