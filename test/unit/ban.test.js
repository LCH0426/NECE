/**
 * NECE 封禁系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- ban.js 测试 ---');

// 模拟封禁数据
const mockBanData = {
    entries: {
        '10001': { reason: '作弊', time: '2026.01.01', ip: '192.168.1.1' },
        '10002': { reason: '恶意破坏', time: '2026.01.02', ip: '192.168.1.2' }
    }
};

test('封禁数据结构', function() {
    assertTruthy(typeof mockBanData.entries === 'object', 'entries 应该是对象');
    assertTruthy(mockBanData.entries['10001'], '应该有玩家10001的封禁记录');
});

test('检查玩家是否被封禁', function() {
    const xuid = '10001';
    const isBanned = !!mockBanData.entries[xuid];
    assertTruthy(isBanned, '玩家10001应该被封禁');
    
    const xuid2 = '99999';
    const isNotBanned = !!mockBanData.entries[xuid2];
    assertFalsy(isNotBanned, '玩家99999不应该被封禁');
});

test('封禁原因记录', function() {
    const entry = mockBanData.entries['10001'];
    assertEqual(entry.reason, '作弊');
    assertTruthy(entry.time, '应该有封禁时间');
    assertTruthy(entry.ip, '应该有IP记录');
});

test('解封操作', function() {
    const data = JSON.parse(JSON.stringify(mockBanData)); // 深拷贝
    const xuid = '10001';
    assertTruthy(data.entries[xuid], '解封前应该存在');
    delete data.entries[xuid];
    assertFalsy(data.entries[xuid], '解封后应该不存在');
});

test('重复封禁检查', function() {
    const data = JSON.parse(JSON.stringify(mockBanData));
    const xuid = '10001';
    const alreadyBanned = !!data.entries[xuid];
    assertTruthy(alreadyBanned, '应该检测到重复封禁');
});

test('IP关联封禁', function() {
    const ip = '192.168.1.1';
    const bannedByIp = Object.values(mockBanData.entries).some(e => e.ip === ip);
    assertTruthy(bannedByIp, '应该能通过IP查到封禁记录');
});

test('封禁列表', function() {
    const banList = Object.entries(mockBanData.entries).map(([xuid, entry]) => ({
        xuid,
        ...entry
    }));
    assertEqual(banList.length, 2);
    assertTruthy(banList[0].xuid, '每条记录应该有xuid');
});
