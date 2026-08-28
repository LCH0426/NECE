const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, clearAllIntervals, lse } = require('../helpers/setup');

describe('guild module', () => {
    let guildModule;
    let database;
    let player;

    // 内存公会/成员表（与 database 模块打补丁联动）
    const guildDb = { guilds: {}, members: {} };

    before(() => {
        setupMocks();

        player = createAndRegisterPlayer('10001', 'Owner');

        // 打补丁真实 database 模块的"公会"相关接口，guild.js 在调用时才访问 database.xxx，因此共享同一导出对象即可生效
        database = require('../../src/database');
        database.getAllGuildRequestsSQL = function() { return []; };
        database.getAllGuildInvitesSQL = function() { return []; };
        database.getGuildByPlayer = function(xuid) {
            xuid = String(xuid);
            for (const gid in guildDb.guilds) {
                const g = guildDb.guilds[gid];
                if ((guildDb.members[gid] || []).some(function(m) { return m.xuid === xuid; })) return g;
            }
            return null;
        };
        database.getGuildByName = function(name) {
            for (const gid in guildDb.guilds) if (guildDb.guilds[gid].name === name) return guildDb.guilds[gid];
            return null;
        };
        database.getGuild = function(id) { return guildDb.guilds[id] || null; };
        database.createGuild = function(name, description, owner, maxMembers) {
            const id = Object.keys(guildDb.guilds).length + 1;
            const guild = { id, name, description, owner: String(owner), fund: 100, level: 1, maxMembers: maxMembers || 20, hqX: null, hqY: null, hqZ: null, hqDim: null };
            guildDb.guilds[id] = guild;
            guildDb.members[id] = [{ xuid: String(owner), role: 'owner', name: 'Player' + owner, joinedAt: Date.now() }];
            return id;
        };
        database.getGuildMembers = function(gid) { return (guildDb.members[gid] || []); };
        database.getMemberCount = function(gid) { return (guildDb.members[gid] || []).length; };
        database.getMemberRole = function(xuid) {
            xuid = String(xuid);
            for (const gid in guildDb.members) {
                const m = (guildDb.members[gid] || []).find(function(mm) { return mm.xuid === xuid; });
                if (m) return m.role;
            }
            return null;
        };
        database.getGuildTeleports = function() { return []; };
        database.getGuildTeleportCount = function() { return 0; };
        database.getAllGuilds = function() { return Object.values(guildDb.guilds); };
        database.deleteGuild = function(id) {
            if (!guildDb.guilds[id]) return;
            delete guildDb.guilds[id];
            delete guildDb.members[id];
        };
        database.updateGuild = function(id, patch) {
            const g = guildDb.guilds[id];
            if (!g) return;
            for (const k in patch) g[k] = patch[k];
        };

        // 传送模块打补丁，避免真实传送逻辑
        const teleportModule = require('../../src/teleport');
        teleportModule.safeTeleport = function() { return true; };

        guildModule = require('../../src/guild');
        guildModule.init({
            logger: lse.logger,
            getConfig: function() { return { createCost: 100, maxMembers: 20, maxAdmins: 3, maxTeleports: 5, teleportCooldown: 10, withdrawAdminOnly: true }; },
            getCurrencyName: function() { return '金币'; },
            getPlayerName: function(xuid) { return 'Player' + xuid; },
            getPlayerData: function() { return { players: {} }; },
            getPlayerSetting: function() { return null; },
            t: function(lang, key) { return key; },
            getSystemLanguage: function() { return 'zh_CN'; },
            chatModule: { clearOrgNameCache: function() {}, clearAllOrgNameCache: function() {} },
            mailApi: null
        });
    });

    after(() => {
        clearAllIntervals(); // 关闭 init 中注册的 setInterval
        teardownMocks();
    });

    describe('showMainMenu for a guild member', () => {
        it('should open the in-guild management menu (button set)', () => {
            // 让 10001 成为一个公会（owner）
            const gid = database.createGuild('TestGuild', 'desc', '10001', 20);
            const guild = guildDb.guilds[gid];
            assert.equal(guild.owner, '10001');

            let captured = null;
            player.sendForm = function(fm) { captured = fm; };
            guildModule.showMainMenu(player);

            assert.ok(captured, '应调用 player.sendForm');
            // owner 非管理员：信息/成员/传送点/金库/总部/公会列表/邀请/处理申请/退出 = 9 个按钮
            assert.equal(captured._buttons.length, 9);
        });
    });

    describe('showMainMenu for a non-member', () => {
        it('should open the no-guild menu with fewer options', () => {
            const stranger = createAndRegisterPlayer('20000', 'Stranger');
            let captured = null;
            stranger.sendForm = function(fm) { captured = fm; };
            guildModule.showMainMenu(stranger);

            assert.ok(captured, '应调用 player.sendForm');
            // 无公会：仅 查看所有公会 一个按钮
            assert.equal(captured._buttons.length, 1);
        });
    });

    describe('handleCommand', () => {
        it('should delegate to showMainMenu (opens main menu form)', () => {
            let captured = null;
            player.sendForm = function(fm) { captured = fm; };
            guildModule.handleCommand(player, []);
            assert.ok(captured, '应调用 player.sendForm');
        });
    });
});