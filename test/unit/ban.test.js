const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, lse } = require('../helpers/setup');
const fs = require('fs');
const path = require('path');

describe('ban', () => {
    let banModule;

    before(() => {
        setupMocks();
        createAndRegisterPlayer('10001', 'TestPlayer');

        const testDir = path.join(__dirname, '..', '_testdata');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

        const banDM = createMockDM({ bans: [] });
        banModule = require('../../src/ban');
        banModule.init(banDM, {
            playerData: { '10001': { name: 'TestPlayer', lastIp: '127.0.0.1' } }
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('isPlayerBanned', () => {
        it('should return not banned for new player', () => {
            const result = banModule.isPlayerBanned('10001', '127.0.0.1');
            assert.equal(result.banned, false);
        });
    });

    describe('apiBan / apiUnban', () => {
        it('should ban player by xuid', () => {
            const result = banModule.apiBan('10001', 'Test reason', 'Admin');
            assert.equal(result.success, true);
            const status = banModule.isPlayerBanned('10001', '127.0.0.1');
            assert.equal(status.banned, true);
        });

        it('should unban player by xuid', () => {
            const result = banModule.apiUnban('10001');
            assert.equal(result.success, true);
            const status = banModule.isPlayerBanned('10001', '127.0.0.1');
            assert.equal(status.banned, false);
        });

        it('should return error when banning non-existent player', () => {
            const result = banModule.apiBan('99999', 'reason', 'Admin');
            assert.equal(result.success, false);
        });
    });

    describe('apiGetBanList', () => {
        it('should return ban list', () => {
            banModule.apiBan('10001', 'Test', 'Admin');
            const list = banModule.apiGetBanList();
            assert.ok(Array.isArray(list));
            assert.ok(list.length > 0);
            banModule.apiUnban('10001');
        });
    });
});
