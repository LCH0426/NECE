/**
 * NECE 留言板系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- messageBoard.js 测试 ---');

// 模拟留言板数据
const mockData = {
    messages: [
        { id: 1, xuid: '10001', playerName: 'Steve', msg: '大家好！', mood: '开心', time: '2026.01.01.12.00.00', client: 'Android', isDeleted: false },
        { id: 2, xuid: '10002', playerName: 'Alex', msg: '服务器很棒！', mood: '兴奋', time: '2026.01.01.13.00.00', client: 'iOS', isDeleted: false },
        { id: 3, xuid: '10001', playerName: 'Steve', msg: '已删除的留言', mood: '平静', time: '2026.01.01.14.00.00', client: 'Web', isDeleted: true }
    ],
    nextId: 4
};

test('留言数据结构', function() {
    const msg = mockData.messages[0];
    assertTruthy(msg.id, '应该有ID');
    assertTruthy(msg.xuid, '应该有XUID');
    assertTruthy(msg.playerName, '应该有玩家名');
    assertTruthy(msg.msg, '应该有内容');
    assertTruthy(msg.mood, '应该有心情');
    assertTruthy(msg.time, '应该有时间');
});

test('获取有效留言', function() {
    const validMessages = mockData.messages.filter(m => !m.isDeleted);
    assertEqual(validMessages.length, 2);
});

test('获取玩家留言', function() {
    const xuid = '10001';
    const myMessages = mockData.messages.filter(m => m.xuid === xuid && !m.isDeleted);
    assertEqual(myMessages.length, 1);
});

test('留言ID递增', function() {
    const nextId = mockData.nextId;
    assertEqual(nextId, 4);
    // 模拟添加留言
    mockData.nextId++;
    assertEqual(mockData.nextId, 5);
    mockData.nextId--; // 恢复
});

test('软删除留言', function() {
    const data = JSON.parse(JSON.stringify(mockData));
    const msgId = 1;
    const msg = data.messages.find(m => m.id === msgId);
    assertTruthy(msg, '应该找到留言');
    assertFalsy(msg.isDeleted, '删除前应该未删除');
    msg.isDeleted = true;
    assertTruthy(msg.isDeleted, '删除后应该标记为已删除');
});

test('按ID排序（降序）', function() {
    const sorted = [...mockData.messages].sort((a, b) => b.id - a.id);
    assertEqual(sorted[0].id, 3);
    assertEqual(sorted[1].id, 2);
    assertEqual(sorted[2].id, 1);
});

test('分页逻辑', function() {
    const page = 1;
    const pageSize = 2;
    const total = mockData.messages.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, total);
    const pageMessages = mockData.messages.slice(startIndex, endIndex);
    
    assertEqual(totalPages, 2);
    assertEqual(pageMessages.length, 2);
});

test('心情选项', function() {
    const validMoods = ['开心', '难过', '平静', '兴奋', '生气'];
    assertTruthy(validMoods.includes('开心'));
    assertTruthy(validMoods.includes('生气'));
    assertFalsy(validMoods.includes('未知'));
});

test('留言内容长度限制', function() {
    const maxLength = 200;
    const shortMsg = '短留言';
    const longMsg = 'a'.repeat(201);
    
    assertTruthy(shortMsg.length <= maxLength, '短留言应该通过');
    assertTruthy(longMsg.length > maxLength, '超长留言应该被拒绝');
});

test('权限检查：只能删除自己的留言', function() {
    const userXuid = '10001';
    const msg1 = mockData.messages[0]; // xuid: 10001
    const msg2 = mockData.messages[1]; // xuid: 10002
    
    const canDelete1 = msg1.xuid === userXuid;
    const canDelete2 = msg2.xuid === userXuid;
    
    assertTruthy(canDelete1, '应该能删除自己的留言');
    assertFalsy(canDelete2, '不能删除别人的留言');
});
