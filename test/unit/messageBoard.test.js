const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, createMockDM, lse } = require('../helpers/setup');

describe('messageBoard module', () => {
    let messageBoardModule;
    let dm;
    let player;

    before(() => {
        setupMocks();
        player = createAndRegisterPlayer('10001', 'Steve');

        // 共享内存引用：init 中 load() 返回的对象与 addMessage/deleteMessage 修改的是同一引用
        dm = createMockDM({ messages: [], nextId: 1 });

        messageBoardModule = require('../../src/messageBoard');
        messageBoardModule.init(dm, {
            t: function(lang, key) { return key; },
            getSystemLanguage: function() { return 'zh_CN'; },
            getPlayerSetting: function() { return null; }
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('init / getData', () => {
        it('should load existing data from DataManager', () => {
            const data = messageBoardModule.getData();
            assert.ok(data);
            assert.deepEqual(data.messages, []);
            assert.equal(data.nextId, 1);
        });
    });

    describe('addMessage / getMessageById', () => {
        it('should add a message and find it by id', () => {
            messageBoardModule.addMessage({
                id: 1, xuid: '10001', playerName: 'Steve',
                msg: 'hello world', mood: '开心', time: '2026.01.01.12.00.00',
                client: 'Win32', isDeleted: false
            });

            const data = messageBoardModule.getData();
            assert.equal(data.messages.length, 1);

            const msg = messageBoardModule.getMessageById(1);
            assert.ok(msg);
            assert.equal(msg.msg, 'hello world');
            assert.equal(msg.mood, '开心');
        });

        it('should return null for unknown id', () => {
            assert.equal(messageBoardModule.getMessageById(999), null);
        });
    });

    describe('getMessages (Web API filtering)', () => {
        before(() => {
            // 追加不同作者、心情、内容的留言
            messageBoardModule.addMessage({
                id: 2, xuid: '10002', playerName: 'Alex',
                msg: 'server is great', mood: '兴奋', time: '2026.01.01.13.00.00',
                client: 'iOS', isDeleted: false
            });
            messageBoardModule.addMessage({
                id: 3, xuid: '10001', playerName: 'Steve',
                msg: 'another test', mood: '平静', time: '2026.01.01.14.00.00',
                client: 'Android', isDeleted: false
            });
        });

        it('should list all active messages in id-desc order', () => {
            const res = messageBoardModule.getMessages({ page: 1, pageSize: 10 });
            assert.equal(res.total, 3);
            assert.equal(res.messages[0].id, 3);
            assert.equal(res.messages[res.messages.length - 1].id, 1);
        });

        it('should filter by xuid', () => {
            const res = messageBoardModule.getMessages({ xuid: '10002' });
            assert.equal(res.total, 1);
            assert.equal(res.messages[0].playerName, 'Alex');
        });

        it('should filter by mood', () => {
            const res = messageBoardModule.getMessages({ mood: '兴奋' });
            assert.equal(res.total, 1);
            assert.equal(res.messages[0].id, 2);
        });

        it('should search by keyword', () => {
            const res = messageBoardModule.getMessages({ search: 'Steve' });
            assert.equal(res.total, 2);
        });

        it('should paginate correctly', () => {
            const res = messageBoardModule.getMessages({ page: 1, pageSize: 2 });
            assert.equal(res.messages.length, 2);
            assert.equal(res.total, 3);
            assert.equal(res.totalPages, 2);
        });
    });

    describe('deleteMessage (soft delete)', () => {
        it('should soft-delete a message so it is hidden by default', () => {
            assert.equal(messageBoardModule.deleteMessage(3), true);

            const visible = messageBoardModule.getMessages({});
            assert.equal(visible.total, 2);

            const includingDeleted = messageBoardModule.getMessages({ includeDeleted: true });
            assert.equal(includingDeleted.total, 3);

            const msg = messageBoardModule.getMessageById(3);
            assert.equal(msg.isDeleted, true);
        });

        it('should return false for unknown id and change nothing', () => {
            const before = messageBoardModule.getMessages({ includeDeleted: true }).total;
            assert.equal(messageBoardModule.deleteMessage(999), false);
            const afterCount = messageBoardModule.getMessages({ includeDeleted: true }).total;
            assert.equal(before, afterCount);
        });
    });

    describe('getNextId / formatTime', () => {
        it('should increment next id', () => {
            const id1 = messageBoardModule.getNextId();
            const id2 = messageBoardModule.getNextId();
            assert.equal(id2, id1 + 1);
        });

        it('should return formatted current time string', () => {
            const time = messageBoardModule.formatTime();
            assert.ok(/^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(time));
        });
    });

    describe('onSave callback', () => {
        it('should invoke registered callbacks after data saving', () => {
            let saved = 0;
            messageBoardModule.onSave(function() { saved++; });
            messageBoardModule.addMessage({
                id: 99, xuid: '10001', playerName: 'Steve',
                msg: 'trigger save', mood: '平静', time: 't', client: 'Win32', isDeleted: false
            });
            assert.ok(saved >= 1, '保存后应触发 onSave 回调');
        });
    });

    describe('showMainForm', () => {
        it('should open the board main form and call player.sendForm', () => {
            let captured = null;
            player.sendForm = function(fm) { captured = fm; };
            messageBoardModule.showMainForm(player);
            assert.ok(captured, '应调用 player.sendForm');
            // 5 个功能按钮：新增/我的/全部/随机/搜索
            assert.equal(captured._buttons.length, 5);
        });
    });
});