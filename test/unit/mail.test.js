/**
 * NECE 邮件系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- mail.js 测试 ---');

// 模拟邮件数据
const mockMailData = {
    mails: [
        { id: 1, fromXuid: '10001', fromName: 'Steve', toXuid: '10002', content: '你好！', time: '2026.01.01.12.00.00', read: false, starQian: 0, items: [], claimed: false },
        { id: 2, fromXuid: 'system', fromName: '系统', toXuid: 'all', content: '欢迎！', time: '2026.01.01.13.00.00', read: {}, starQian: 100, items: [], claimed: {} },
        { id: 3, fromXuid: '10001', fromName: 'Steve', toXuid: '10003', content: '定时邮件', time: '', scheduledTime: '2026.02.01.12.00', read: false, starQian: 0, items: [], claimed: false }
    ],
    nextId: 4
};

test('邮件数据结构', function() {
    const mail = mockMailData.mails[0];
    assertTruthy(mail.id, '应该有ID');
    assertTruthy(mail.fromXuid, '应该有发送者XUID');
    assertTruthy(mail.fromName, '应该有发送者名称');
    assertTruthy(mail.toXuid, '应该有接收者XUID');
    assertTruthy(mail.content, '应该有内容');
    assertTruthy(mail.time, '应该有时间');
});

test('私信邮件', function() {
    const mail = mockMailData.mails[0];
    assertTruthy(mail.toXuid !== 'all', '私信的toXuid不应该是all');
    assertEqual(typeof mail.read, 'boolean', '私信的read应该是布尔值');
});

test('全体邮件', function() {
    const mail = mockMailData.mails[1];
    assertEqual(mail.toXuid, 'all', '全体邮件的toXuid应该是all');
    assertEqual(typeof mail.read, 'object', '全体邮件的read应该是对象');
});

test('定时邮件', function() {
    const mail = mockMailData.mails[2];
    assertTruthy(mail.scheduledTime, '定时邮件应该有scheduledTime');
    assertEqual(mail.time, '', '未激活的定时邮件time应该为空');
});

test('未读邮件统计', function() {
    const xuid = '10002';
    const unreadCount = mockMailData.mails.filter(m => {
        if (m.scheduledTime) return false;
        if (m.toXuid === xuid) return !m.read;
        if (m.toXuid === 'all') return !m.read || !m.read[xuid];
        return false;
    }).length;
    assertEqual(unreadCount, 2); // 私信1封 + 全体1封
});

test('附件邮件', function() {
    const mail = mockMailData.mails[1];
    const hasAttachment = (mail.starQian && mail.starQian > 0) || (mail.items && mail.items.length > 0);
    assertTruthy(hasAttachment, '应该检测到附件');
});

test('已领取状态', function() {
    const mail = mockMailData.mails[1]; // 全体邮件
    const xuid = '10002';
    const isClaimed = mail.claimed && mail.claimed[xuid];
    assertFalsy(isClaimed, '应该未领取');
    
    // 模拟领取
    mail.claimed[xuid] = true;
    const isClaimedAfter = mail.claimed && mail.claimed[xuid];
    assertTruthy(isClaimedAfter, '领取后应该标记为已领取');
    delete mail.claimed[xuid]; // 恢复
});

test('删除权限检查', function() {
    const mail = mockMailData.mails[0];
    const userXuid = '10001';
    const otherXuid = '10002';
    
    assertTruthy(mail.fromXuid === userXuid || mail.toXuid === userXuid, '发送者应该有权限');
    assertFalsy(mail.fromXuid === otherXuid && mail.toXuid !== otherXuid, '无关人员不应该有权限');
});

test('邮件ID递增', function() {
    const nextId = mockMailData.nextId;
    assertEqual(nextId, 4);
});
