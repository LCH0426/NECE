const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, lse } = require('../helpers/setup');

describe('ban', () => {
    let ban;
    let sharedPlayers;
    let dm;

    before(() => {
        setupMocks();
        sharedPlayers = {
            '10001': { name: 'Test1', uid: 'u1' },
            '10002': { name: 'Test2', uid: 'u2' }
        };
        ban = require('../../src/ban');
    });

    after(() => {
        teardownMocks();
    });

    // 每次用干净的 DataManager 重新 init，隔离封禁数据
    function freshInit(defaultData) {
        dm = createMockDM(defaultData || { entries: {} });
        ban.init(dm, {
            playerData: { players: sharedPlayers },
            t: function(lang, key) { return key; },
            getSystemLanguage: function() { return 'zh_CN'; },
            getPlayerSetting: function() { return false; },
            showAdminMenu: null
        });
        return dm;
    }

    describe('banPlayer', () => {
        it('should ban a player by name and record the entry', () => {
            freshInit();
            const res = ban.banPlayer('Test1', '作弊', 'OP');
            assert.equal(res.success, true);
            assert.equal(res.xuid, '10001');
            const list = ban.getBanList();
            assert.equal(list.length, 1);
            assert.equal(list[0].name, 'Test1');
            assert.equal(list[0].reason, '作弊');
            assert.equal(list[0].operator, 'OP');
            assert.equal(list[0].banned, true);
        });

        it('should reject a duplicate ban', () => {
            freshInit();
            ban.banPlayer('Test1', '作弊', 'OP');
            const res = ban.banPlayer('Test1', '再来一次', 'OP');
            assert.equal(res.success, false);
        });

        it('should fail when the player cannot be resolved', () => {
            freshInit();
            const res = ban.banPlayer('nobody', 'x', 'OP');
            assert.equal(res.success, false);
        });
    });

    describe('isPlayerBanned', () => {
        it('should report banned by xuid', () => {
            freshInit();
            ban.banPlayer('Test1', '作弊', 'OP');
            const r = ban.isPlayerBanned('10001');
            assert.equal(r.banned, true);
            assert.equal(r.reason, '作弊');
            assert.equal(ban.isPlayerBanned('10002').banned, false);
        });

        it('should report banned via a linked IP for an online player', () => {
            freshInit();
            const p = createAndRegisterPlayer('20000', 'OnlineP');
            ban.banPlayer('20000', '多开开挂', 'OP');
            const ip = p.getDevice().ip;
            assert.ok(ip, '在线玩家应能取到IP');
            const r = ban.isPlayerBanned('30000', ip);
            assert.equal(r.banned, true);
        });
    });

    describe('unbanPlayer', () => {
        it('should unban and remove the entry', () => {
            freshInit();
            ban.banPlayer('Test1', '作弊', 'OP');
            const res = ban.unbanPlayer('Test1');
            assert.equal(res.success, true);
            assert.equal(ban.getBanList().length, 0);
            const again = ban.unbanPlayer('Test1');
            assert.equal(again.success, false);
        });

        it('should unban a banned xuid not present in player data', () => {
            freshInit({
                entries: {
                    '99999': { name: 'Old', uid: 'o', ip: '', reason: 'r', operator: 'op', time: 't', banned: true }
                }
            });
            const res = ban.unbanPlayer('99999');
            assert.equal(res.success, true);
            assert.equal(ban.getBanList().length, 0);
        });
    });

    describe('api*', () => {
        it('should expose ban/unban/list/isBanned API', () => {
            freshInit();
            assert.equal(ban.apiBan('Test1', '作弊').success, true);
            assert.equal(ban.apiGetBanList().length, 1);
            assert.equal(ban.apiIsBanned('10001').banned, true);
            assert.equal(ban.apiUnban('Test1').success, true);
        });
    });

    describe('showBanListForm', () => {
        it('should build a form listing banned entries', () => {
            freshInit();
            ban.banPlayer('Test1', '作弊', 'OP');
            const p = createAndRegisterPlayer('10003', 'Admin');
            let fm = null;
            p.sendForm = function(f) { fm = f; };
            p.sendModalForm = function() {};
            ban.showBanListForm(p);
            assert.ok(fm, '应发送封禁列表表单');
            assert.equal(fm._buttons.length, 3); // 1条记录 + 封禁玩家 + 返回
        });
    });

    describe('registerGameCommands', () => {
        it('should register ban/unban/banlist game commands', () => {
            freshInit();
            const beforeCount = lse.mc._commands.length;
            ban.registerGameCommands();
            assert.ok(lse.mc._commands.length >= beforeCount + 3, '应注册 pban/punban/pbanlist 三个命令');
            const names = lse.mc._commands.slice(beforeCount).map(function(c) { return c._name; });
            assert.ok(names.indexOf('pban') >= 0);
            assert.ok(names.indexOf('punban') >= 0);
            assert.ok(names.indexOf('pbanlist') >= 0);
        });
    });
});