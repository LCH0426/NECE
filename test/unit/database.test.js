const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, ensureTestDataDir, cleanupTestDataDir } = require('../helpers/setup');
const path = require('path');
const fs = require('fs');

describe('database', () => {
    let db;

    before(async () => {
        setupMocks();
        const testDir = ensureTestDataDir();
        // 覆盖数据库路径到测试目录
        process.chdir(path.join(__dirname, '..'));
        db = require('../../src/database');
        db.setDebugMode(false);
        await db.initDatabase();
    });

    after(() => {
        teardownMocks();
        cleanupTestDataDir();
    });

    describe('密码管理', () => {
        it('should set and verify password', () => {
            db.setPassword('user1', 'pass123');
            assert.equal(db.hasPassword('user1'), true);
            assert.equal(db.verifyPassword('user1', 'pass123'), true);
            assert.equal(db.verifyPassword('user1', 'wrong'), false);
        });

        it('should return false for non-existent user', () => {
            assert.equal(db.hasPassword('nobody'), false);
            assert.equal(db.verifyPassword('nobody', 'pass'), false);
        });

        it('should update existing password', () => {
            db.setPassword('user1', 'newpass');
            assert.equal(db.verifyPassword('user1', 'newpass'), true);
            assert.equal(db.verifyPassword('user1', 'pass123'), false);
        });
    });

    describe('管理员管理', () => {
        it('should add and check admin', () => {
            assert.equal(db.addAdmin('10001'), true);
            assert.equal(db.isAdmin('10001'), true);
            assert.equal(db.isAdmin('99999'), false);
        });

        it('should not add duplicate admin', () => {
            assert.equal(db.addAdmin('10001'), false);
        });

        it('should remove admin', () => {
            assert.equal(db.removeAdmin('10001'), true);
            assert.equal(db.isAdmin('10001'), false);
        });

        it('should return false when removing non-admin', () => {
            assert.equal(db.removeAdmin('99999'), false);
        });

        it('should list all admins', () => {
            db.addAdmin('20001');
            db.addAdmin('20002');
            const admins = db.getAllAdmins();
            assert.ok(admins.length >= 2);
        });
    });

    describe('验证码', () => {
        it('should generate and verify captcha', () => {
            const id = db.generateCaptcha('ABC123');
            assert.ok(id);
            assert.equal(db.verifyCaptcha(id, 'abc123'), true);
            assert.equal(db.verifyCaptcha(id, 'abc123'), false); // 已使用
        });

        it('should reject wrong captcha', () => {
            const id = db.generateCaptcha('XYZ');
            assert.equal(db.verifyCaptcha(id, 'WRONG'), false);
        });
    });

    describe('玩家数据SQL', () => {
        it('should init player database', async () => {
            await db.initPlayerDatabase();
            assert.equal(db.isPlayerDbReady(), true);
        });

        it('should set and get player data', () => {
            db.setPlayerDataSQL('test_xuid', {
                uid: 10001, name: 'TestPlayer', uuid: 'uuid-1',
                registerTime: '2026-01-01', leavetime: '', healthBonus: 0,
                rw: '', taxdata: {}, bankdata: {}, quickmenu: {},
                vipdata: {}, avatar: {}, count: { playTime: 100 },
                lastIp: '127.0.0.1', platform: 'Win32'
            });
            const data = db.getPlayerDataSQL('test_xuid');
            assert.ok(data);
            assert.equal(data.name, 'TestPlayer');
            assert.equal(data.uid, 10001);
            assert.equal(data.count.playTime, 100);
        });

        it('should update leave time partially', () => {
            db.updateLeaveTimeSQL('test_xuid', '1234567890');
            const data = db.getPlayerDataSQL('test_xuid');
            assert.equal(data.leavetime, '1234567890');
        });

        it('should update play time partially', () => {
            db.updatePlayTimeSQL('test_xuid', 500);
            const data = db.getPlayerDataSQL('test_xuid');
            assert.equal(data.count.playTime, 500);
        });

        it('should return null for non-existent player', () => {
            assert.equal(db.getPlayerDataSQL('no_such_xuid'), null);
        });
    });

    describe('玩家设置', () => {
        it('should set and get player settings', () => {
            db.setPlayerSettingSQL('test_xuid', 'enableWelcome', true);
            db.setPlayerSettingSQL('test_xuid', 'enableSidebar', false);
            const settings = db.getPlayerSettingsSQL('test_xuid');
            assert.equal(settings.enableWelcome, true);
            assert.equal(settings.enableSidebar, false);
        });
    });

    describe('公会系统', () => {
        it('should create guild and retrieve by name', () => {
            const id = db.createGuild('TestGuild', 'A test guild', 'owner_xuid', 20);
            assert.ok(id > 0);
            const guild = db.getGuildByName('TestGuild');
            assert.ok(guild);
            assert.equal(guild.name, 'TestGuild');
            assert.equal(guild.owner, 'owner_xuid');
        });

        it('should find guild by player', () => {
            const guild = db.getGuildByPlayer('owner_xuid');
            assert.ok(guild);
            assert.equal(guild.name, 'TestGuild');
        });

        it('should add and list members', () => {
            const guild = db.getGuildByName('TestGuild');
            db.addGuildMember('member1', guild.id, 'member');
            const members = db.getGuildMembers(guild.id);
            assert.ok(members.length >= 2);
        });

        it('should delete guild', () => {
            const guild = db.getGuildByName('TestGuild');
            db.deleteGuild(guild.id);
            assert.equal(db.getGuildByName('TestGuild'), null);
        });
    });
});
