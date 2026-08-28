/**
 * NECE 邮件系统测试 —— 驱动 src/mail.js 真实逻辑
 * 覆盖：初始化数据结构、添加/查询/删除、发系统邮件、未读统计、分类统计、定时邮件激活、旧数据迁移
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createMockDM, freshRequire } = require('../helpers/setup');
const i18n = require('../../src/i18n');

function baseDeps() {
    return {
        t: i18n.t,
        getSystemLanguage: function() { return 'zh_CN'; },
        getPlayerSetting: function() { return true; },
        getCurrencyName: function() { return '星茜'; },
        addPlayerMoney: function() {}
    };
}

// 重置共享 mailData，保证每个用例独立
function resetData(mail) {
    const d = mail.getData();
    d.mails.length = 0;
    d.nextId = 1;
}

describe('mail', () => {
    before(() => setupMocks());
    after(() => teardownMocks());

    describe('基础数据结构与 CRUD', () => {
        let mail, mailDM;
        before(() => {
            mail = freshRequire('../../src/mail');
            mailDM = createMockDM({ players: {} });
            mail.init(mailDM, baseDeps());
        });

        it('init 后保证 mails 数组和 nextId', () => {
            const d = mail.getData();
            assert.ok(Array.isArray(d.mails));
            assert.equal(d.nextId, 1);
            assert.equal(mail.getNextId(), 1);
        });

        it('添加 / 查询 / 删除邮件', () => {
            resetData(mail);
            mail.addMail({ id: 1, fromXuid: 'system', toXuid: '10002', content: 'hello' });
            assert.equal(mail.getMailById(1).content, 'hello');
            assert.equal(mail.getMailById(999), null);
            assert.equal(mail.deleteMail(1), true);
            assert.equal(mail.getMailById(1), null);
            assert.equal(mail.deleteMail(123), false);
        });

        it('nextId 递增并保存', () => {
            resetData(mail);
            assert.equal(mail.getNextId(), 1);
            mail.incrementNextId();
            assert.equal(mail.getNextId(), 2);
            assert.ok(mailDM._saveCount >= 1);
        });

        it('sendSystemMail 生成系统邮件并通知统计', () => {
            resetData(mail);
            mail.sendSystemMail('10003', '公告内容');
            const d = mail.getData();
            assert.equal(d.mails.length, 1);
            assert.equal(d.mails[0].fromXuid, 'system');
            assert.equal(d.mails[0].toXuid, '10003');
            assert.equal(d.mails[0].content, '公告内容');
            assert.equal(d.nextId, 2);
            assert.equal(mail.getUnreadMailCount('10003'), 1);
            assert.equal(mail.getUnreadMailCount('10001'), 0);
        });
    });

    describe('未读统计与分类', () => {
        let mail;
        before(() => {
            mail = freshRequire('../../src/mail');
            mail.init(createMockDM({ players: {} }), baseDeps());
        });

        it('排除定向非本人、定时、已删除和已读邮件后统计', () => {
            resetData(mail);
            const d = mail.getData();
            // 私信未读
            d.mails.push({ id: 1, toXuid: '10002', read: {}, deleted: {}, scheduledTime: undefined });
            // 全体未读
            d.mails.push({ id: 2, toXuid: 'all', read: {}, deleted: {} });
            // 全体已读
            d.mails.push({ id: 3, toXuid: 'all', read: { '10002': true }, deleted: {} });
            // 定时邮件（不计入）
            d.mails.push({ id: 4, toXuid: 'all', read: {}, deleted: {}, scheduledTime: '2099.01.01.00.00' });
            // 已删除
            d.mails.push({ id: 5, toXuid: 'all', read: {}, deleted: { '10002': true } });
            assert.equal(mail.getUnreadMailCount('10002'), 2);
        });

        it('按附件分类统计未读邮件', () => {
            resetData(mail);
            const d = mail.getData();
            d.mails.push({ id: 1, toXuid: 'all', read: {}, deleted: {}, starQian: 0, items: [] });
            d.mails.push({ id: 2, toXuid: 'all', read: {}, deleted: {}, starQian: 100, items: [] });
            d.mails.push({ id: 3, toXuid: 'all', read: {}, deleted: {}, starQian: 0, items: [{ snbt: 'x' }] });
            const info = mail.getUnreadMailInfo('10002');
            assert.equal(info.count, 3);
            assert.equal(info.attachmentCount, 2);
            assert.equal(info.normalCount, 1);
        });
    });

    describe('定时邮件激活', () => {
        let mail;
        before(() => {
            mail = freshRequire('../../src/mail');
            mail.init(createMockDM({ players: {} }), baseDeps());
        });

        it('到期的定时邮件被激活并移除定时标记', () => {
            resetData(mail);
            const d = mail.getData();
            const past = '2020.01.01.12.00';
            d.mails.push({ id: 1, fromName: 'Admin', toXuid: 'all', content: '旧', scheduledTime: past, starQian: 0, items: [] });
            mail.checkScheduledMails();
            assert.equal(d.mails[0].scheduledTime, undefined);
            assert.ok(d.mails[0].time);
        });

        it('未到期的定时邮件保持不动', () => {
            resetData(mail);
            const d = mail.getData();
            const future = '2099.01.01.12.00';
            d.mails.push({ id: 1, toXuid: 'all', scheduledTime: future });
            mail.checkScheduledMails();
            assert.equal(d.mails[0].scheduledTime, future);
        });
    });

    describe('旧数据迁移', () => {
        it('read/claimed/deleted 布尔值迁移为对象格式并触发保存', () => {
            const mailDM = createMockDM({
                players: {},
                mails: [
                    { id: 1, toXuid: '10002', read: false, claimed: true, deleted: false },
                    { id: 2, toXuid: '10003', read: true, claimed: false, deleted: undefined }
                ]
            });
            const mail = freshRequire('../../src/mail');
            mail.init(mailDM, baseDeps());
            const d = mail.getData();
            const m1 = d.mails[0];
            assert.equal(typeof m1.read, 'object');
            assert.equal(typeof m1.claimed, 'object');
            assert.equal(typeof m1.deleted, 'object');
            const m2 = d.mails[1];
            // read===true 迁移后按收件人标记为已读
            assert.equal(m2.read['10003'], true);
            assert.ok(mailDM._saveCount >= 1);
        });
    });
});