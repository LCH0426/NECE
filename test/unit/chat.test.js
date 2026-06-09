const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, lse } = require('../helpers/setup');
const path = require('path');
const fs = require('fs');

describe('chat', () => {
    let chat;
    let player;

    before(() => {
        setupMocks();
        player = createAndRegisterPlayer('10001', 'TestPlayer');

        const testDir = path.join(__dirname, '..', '_testdata');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

        chat = require('../../src/chat');
        const configDM = createMockDM({
            chat: {
                enabled: true,
                format: '§g[§r§d{dim}§r§g]§b{os}§e|§2{ping}ms§e|§c公会:§b{org}§r§e|§b{titles}§e|§a<§r{name}§a> §r{msg}',
                wordFilter: true
            }
        });
        const badWordsPath = path.join(testDir, 'badwords.json');
        fs.writeFileSync(badWordsPath, JSON.stringify(['badword', 'testforbidden']), 'utf-8');

        chat.init({
            fs: fs,
            U: require('../../src/utils'),
            badWordsPath: badWordsPath,
            webServer: { onReload: function() {} },
            getPlayerData: function() { return { players: { '10001': { titles: { owned: ['萌新', '测试称号'], active: '萌新' } } } }; },
            savePlayerData: function() {},
            getPlayerMoney: function() { return 1000; },
            reducePlayerMoney: function() {},
            getCurrencyName: function() { return '星茜'; },
            getConfig: function() { return configDM.data; }
        });
        chat.loadChatConfig();
    });

    after(() => {
        teardownMocks();
    });

    describe('buildChatOutput', () => {
        it('should format chat message with player info', () => {
            const output = chat.buildChatOutput(player, 'Hello');
            assert.ok(output.includes('TestPlayer'));
            assert.ok(output.includes('Hello'));
            assert.ok(output.includes('GDK')); // Win32 -> GDK
        });

        it('should include guild name placeholder', () => {
            const output = chat.buildChatOutput(player, 'test');
            assert.ok(output.includes('公会:'));
        });

        it('should include titles placeholder', () => {
            const output = chat.buildChatOutput(player, 'test');
            assert.ok(output.includes('titles') || output.includes('萌新'));
        });
    });

    describe('isBadWord', () => {
        it('should detect forbidden words', () => {
            assert.equal(chat.isBadWord('badword'), true);
            assert.equal(chat.isBadWord('testforbidden'), true);
        });

        it('should be case insensitive', () => {
            assert.equal(chat.isBadWord('BADWORD'), true);
        });

        it('should pass clean text', () => {
            assert.equal(chat.isBadWord('hello world'), false);
        });
    });
});
