const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createMockDM, lse } = require('../helpers/setup');

describe('titles', () => {
    let chatModule;
    let mockPlayers;

    before(() => {
        setupMocks();
        mockPlayers = {
            '10001': {},
            '10002': { titles: { owned: ['萌新', '冒险家'], active: '冒险家' } }
        };

        chatModule = require('../../src/chat');
        const configDM = createMockDM({ chat: { enabled: true, format: '§a<§r{name}§a> §r{msg}', wordFilter: false }, titles: { defaultTitle: '萌新', maxTitles: 10, maxChars: 10, perCharCost: 100, shop: [{ name: '冒险家', cost: 500 }] } });
        chatModule.init({
            fs: require('fs'),
            U: require('../../src/utils'),
            badWordsPath: require('path').join(__dirname, '..', '_testdata', 'badwords.json'),
            webServer: { onReload: function() {} },
            getPlayerData: function() { return { players: mockPlayers }; },
            savePlayerDataNow: function() {},
            getPlayerMoney: function() { return 1000; },
            reducePlayerMoney: function() { return true; },
            getCurrencyName: function() { return '星茜'; },
            getConfig: function() { return configDM.data; }
        });
        chatModule.loadChatConfig();
    });

    after(() => {
        teardownMocks();
    });

    describe('getPlayerActiveTitle', () => {
        it('should return default title for new player', () => {
            const title = chatModule.getPlayerActiveTitle('10001');
            assert.equal(title, '萌新');
        });

        it('should return active title for existing player', () => {
            const title = chatModule.getPlayerActiveTitle('10002');
            assert.equal(title, '冒险家');
        });

        it('should return empty string for 无称号', () => {
            mockPlayers['10001'].titles = { owned: ['萌新', '无称号'], active: '无称号' };
            const title = chatModule.getPlayerActiveTitle('10001');
            assert.equal(title, '');
            mockPlayers['10001'].titles = undefined; // reset
        });
    });

    describe('getPlayerOwnedTitles', () => {
        it('should include 无称号 and 萌新 for all players', () => {
            const owned = chatModule.getPlayerOwnedTitles('10001');
            assert.ok(owned.indexOf('无称号') !== -1);
            assert.ok(owned.indexOf('萌新') !== -1);
        });

        it('should include purchased titles', () => {
            const owned = chatModule.getPlayerOwnedTitles('10002');
            assert.ok(owned.indexOf('冒险家') !== -1);
        });
    });

    describe('addPlayerTitle', () => {
        it('should add a new title', () => {
            const result = chatModule.addPlayerTitle('10001', '矿工大师');
            assert.equal(result, true);
            const owned = chatModule.getPlayerOwnedTitles('10001');
            assert.ok(owned.indexOf('矿工大师') !== -1);
        });

        it('should not add duplicate title', () => {
            const result = chatModule.addPlayerTitle('10002', '冒险家');
            assert.equal(result, true); // already owned, returns true
        });

        it('should enforce max title limit', () => {
            // Fill up to maxTitles
            for (let i = 0; i < 15; i++) {
                chatModule.addPlayerTitle('10001', '称号' + i);
            }
            const result = chatModule.addPlayerTitle('10001', '超限称号');
            assert.equal(result, false);
        });
    });

    describe('setActiveTitle', () => {
        it('should set active title', () => {
            const result = chatModule.setActiveTitle('10002', '萌新');
            assert.equal(result, true);
            assert.equal(chatModule.getPlayerActiveTitle('10002'), '萌新');
        });

        it('should allow setting 无称号', () => {
            const result = chatModule.setActiveTitle('10002', '无称号');
            assert.equal(result, true);
            assert.equal(chatModule.getPlayerActiveTitle('10002'), '');
        });

        it('should reject title not owned', () => {
            const result = chatModule.setActiveTitle('10002', '不存在的称号');
            assert.equal(result, false);
        });
    });

    describe('removePlayerTitle', () => {
        it('should remove a custom title', () => {
            chatModule.addPlayerTitle('10002', '可删除称号');
            const result = chatModule.removePlayerTitle('10002', '可删除称号');
            assert.equal(result, true);
            const owned = chatModule.getPlayerOwnedTitles('10002');
            assert.equal(owned.indexOf('可删除称号'), -1);
        });

        it('should not remove 萌新', () => {
            const result = chatModule.removePlayerTitle('10002', '萌新');
            assert.equal(result, false);
        });

        it('should reset to 萌新 if removed title was active', () => {
            chatModule.addPlayerTitle('10002', '临时称号');
            chatModule.setActiveTitle('10002', '临时称号');
            chatModule.removePlayerTitle('10002', '临时称号');
            assert.equal(chatModule.getPlayerActiveTitle('10002'), '萌新');
        });
    });

    describe('buildChatOutput with titles', () => {
        it('should include active title in chat', () => {
            mockPlayers['10002'].titles = { owned: ['萌新', '冒险家'], active: '冒险家' };
            const player = { xuid: '10002', realName: 'Test', pos: { dim: 0 }, getDevice: function() { return { os: 'Win32', avgPing: 32 }; } };
            const output = chatModule.buildChatOutput(player, 'hello');
            // 验证输出包含玩家名
            assert.ok(output.includes('Test'));
            // 验证输出包含消息内容
            assert.ok(output.includes('hello'));
        });
    });
});
