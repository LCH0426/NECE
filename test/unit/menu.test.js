const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, lse } = require('../helpers/setup');

describe('menu', () => {
    let menuModule;

    before(() => {
        setupMocks();
        createAndRegisterPlayer('10001', 'TestPlayer');

        menuModule = require('../../src/menu');
        menuModule.init({
            config: { get: function(key, def) {
                if (key === 'menu') return { enabled: true, main: { title: 'Test', items: [{ name: 'Test', comm: 'test' }] } };
                if (key === 'quickMenu') return { items: [{ name: 'QItem', img: '', comm: 'qcmd' }] };
                return def;
            }},
            getCurrencyName: function() { return '星茜'; },
            getPlayerData: function() { return { players: { '10001': { quickmenu: { slots: [0] } } } }; },
            savePlayerData: function() {}
        });
        menuModule.loadConfig();
    });

    after(() => {
        teardownMocks();
    });

    describe('showMainMenu', () => {
        it('should be a function', () => {
            assert.equal(typeof menuModule.showMainMenu, 'function');
        });

        it('should call player.sendForm', () => {
            const player = lse.createMockPlayer('10001', 'Test');
            lse.mc._mockPlayers.set('10001', player);
            let formSent = false;
            player.sendForm = function() { formSent = true; };
            menuModule.showMainMenu(player);
            assert.equal(formSent, true);
        });
    });

    describe('showQuickMenu', () => {
        it('should be a function', () => {
            assert.equal(typeof menuModule.showQuickMenu, 'function');
        });
    });

    describe('registerCommands', () => {
        it('should be a function', () => {
            assert.equal(typeof menuModule.registerCommands, 'function');
        });
    });

    describe('registerClockListener', () => {
        it('should be a function', () => {
            assert.equal(typeof menuModule.registerClockListener, 'function');
        });
    });

    describe('registerCompassListener', () => {
        it('should be a function', () => {
            assert.equal(typeof menuModule.registerCompassListener, 'function');
        });
    });
});
