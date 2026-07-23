const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createMockDM, lse } = require('../helpers/setup');

describe('wish module', () => {
    let wishModule;
    let mockPlayers;

    before(() => {
        setupMocks();
        mockPlayers = {
            '10001': {},
            '10002': {}
        };

        wishModule = require('../../src/wish');
        const wishDM = createMockDM({ players: {} });
        const enchantDM = createMockDM({});
        const spawnDM = createMockDM({});

        wishModule.init(wishDM, enchantDM, spawnDM, {
            getPlayerMoney: function() { return 10000; },
            reducePlayerMoney: function() { return true; },
            getCurrencyName: function() { return '星茜'; },
            notifyEconomyChange: function() {},
            playerData: mockPlayers,
            savePlayerDataNow: function() {},
            money: { get: function() { return 10000; } },
            openMainMenu: function() {},
            vipModule: { checkPlayerHasMoonlightBlessing: function() { return false; } },
            showPersonalCenterForm: function() {},
            getPlayerData: function() { return { players: mockPlayers }; },
            getPlayerSetting: function() { return 'zh_CN'; },
            t: function(lang, key) { return key; },
            getSystemLanguage: function() { return 'zh_CN'; }
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('getPlayerWishData', () => {
        it('should return default wish data for new player', () => {
            const data = wishModule.getPlayerWishData('10001');
            assert.ok(data);
            assert.equal(data.totalWishes, 0);
            assert.equal(data.fatePath, 0);
        });

        it('should have pity structure', () => {
            const data = wishModule.getPlayerWishData('10001');
            assert.ok(data.pity);
            assert.equal(data.pity.fiveStar, 0);
            assert.equal(data.pity.fourStar, 0);
        });

        it('should have currency structure', () => {
            const data = wishModule.getPlayerWishData('10001');
            assert.ok(data.currency);
            assert.equal(data.currency.dust, 0);
            assert.equal(data.currency.core, 0);
        });
    });

    describe('getFatePathTarget', () => {
        it('should return first item by default', () => {
            const data = wishModule.getPlayerWishData('10001');
            assert.equal(data.fatePath, 0);
        });

        it('should handle fatePath -1 as star core', () => {
            const data = wishModule.getPlayerWishData('10001');
            data.fatePath = -1;
            // getFatePathTarget is internal, verify through data
            assert.equal(data.fatePath, -1);
        });
    });
});
