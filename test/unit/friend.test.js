const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, lse } = require('../helpers/setup');

describe('friend', () => {
    let friendModule;
    let player1, player2;

    before(() => {
        setupMocks();
        player1 = createAndRegisterPlayer('10001', 'Player1');
        player2 = createAndRegisterPlayer('10002', 'Player2');

        const friendDM = createMockDM({ players: {} });
        const messageDM = createMockDM({ players: {} });

        // 使用共享引用，setPlayerAvatar 的修改能被 getPlayerAvatarData 读到
        var sharedPlayers = { '10001': {}, '10002': {} };
        friendModule = require('../../src/friend');
        friendModule.init(friendDM, messageDM, {
            playerData: sharedPlayers,
            getPlayerData: function() { return { players: sharedPlayers }; },
            savePlayerData: function() {},
            getPlayerSetting: function() { return true; },
            getPlayerInfoByXuid: function(xuid) { return xuid === '10001' ? player1 : player2; },
            getPlayerAvatarUrl: function(xuid) { return 'textures/ui/icon_steve'; },
            mailApi: null
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('isPlayerFriend', () => {
        it('should return false for non-friends', () => {
            assert.equal(friendModule.isPlayerFriend('10001', '10002'), false);
        });
    });

    describe('getPendingRequestCount', () => {
        it('should return 0 for new player', () => {
            assert.equal(friendModule.getPendingRequestCount('10001'), 0);
        });
    });

    describe('getUnreadMessageCount', () => {
        it('should return 0 for new player', () => {
            assert.equal(friendModule.getUnreadMessageCount('10001'), 0);
        });
    });

    describe('avatar', () => {
        it('should return default avatar for new player', () => {
            const avatar = friendModule.getPlayerAvatarData('10001');
            assert.ok(avatar);
            assert.equal(avatar.type, 'default');
        });

        it('should return steve icon for default avatar', () => {
            const url = friendModule.getPlayerAvatarUrl('10001');
            assert.equal(url, 'textures/ui/icon_steve');
        });

        it('should set and get QQ avatar', () => {
            friendModule.setPlayerAvatar('10001', 'qq', '12345678');
            const avatar = friendModule.getPlayerAvatarData('10001');
            assert.equal(avatar.type, 'qq');
            assert.equal(avatar.value, '12345678');
            const url = friendModule.getPlayerAvatarUrl('10001');
            assert.ok(url.includes('12345678'));
        });

        it('should set and get link avatar', () => {
            friendModule.setPlayerAvatar('10002', 'link', 'https://example.com/avatar.png');
            const url = friendModule.getPlayerAvatarUrl('10002');
            assert.equal(url, 'https://example.com/avatar.png');
        });

        it('should set and get citlalia avatar', () => {
            friendModule.setPlayerAvatar('10002', 'citlalia', 'abc123');
            const url = friendModule.getPlayerAvatarUrl('10002');
            assert.ok(url.includes('citlalia.cn'));
        });

        it('should return avatar type name', () => {
            assert.equal(friendModule.getAvatarTypeName('qq'), 'QQ头像');
            assert.equal(friendModule.getAvatarTypeName('link'), '自定义链接');
            assert.equal(friendModule.getAvatarTypeName('citlalia'), 'Citlalia头像码');
            assert.equal(friendModule.getAvatarTypeName('default'), '默认头像');
        });
    });
});
