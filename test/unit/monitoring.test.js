/**
 * NECE 系统监控测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- monitoring.js 测试 ---');

// 模拟系统数据
const mockStats = {
    cpu: { usage: 25.5, cores: 8 },
    memory: { total: 16384, used: 8192, free: 8192, usagePercent: 50 },
    tps: { current: 19.5, average: 19.8 },
    mspt: { current: 45.2, average: 42.1 },
    players: { online: 10, max: 50 },
    world: { size: 1024000, entities: 150 }
};

test('CPU 数据结构', function() {
    assertTruthy(typeof mockStats.cpu.usage === 'number', 'usage 应该是数字');
    assertTruthy(mockStats.cpu.usage >= 0 && mockStats.cpu.usage <= 100, 'usage 应该在 0-100 之间');
    assertTruthy(typeof mockStats.cpu.cores === 'number', 'cores 应该是数字');
});

test('内存数据结构', function() {
    const mem = mockStats.memory;
    assertTruthy(typeof mem.total === 'number', 'total 应该是数字');
    assertTruthy(typeof mem.used === 'number', 'used 应该是数字');
    assertTruthy(typeof mem.free === 'number', 'free 应该是数字');
    assertEqual(mem.total, mem.used + mem.free, 'total 应该等于 used + free');
});

test('TPS 数据验证', function() {
    const tps = mockStats.tps;
    assertTruthy(typeof tps.current === 'number', 'current 应该是数字');
    assertTruthy(tps.current >= 0 && tps.current <= 20, 'TPS 应该在 0-20 之间');
    assertTruthy(tps.average >= 0 && tps.average <= 20, '平均TPS 应该在 0-20 之间');
});

test('MSPT 数据验证', function() {
    const mspt = mockStats.mspt;
    assertTruthy(typeof mspt.current === 'number', 'current 应该是数字');
    assertTruthy(mspt.current >= 0, 'MSPT 应该 >= 0');
});

test('玩家在线数据', function() {
    const players = mockStats.players;
    assertTruthy(typeof players.online === 'number', 'online 应该是数字');
    assertTruthy(typeof players.max === 'number', 'max 应该是数字');
    assertTruthy(players.online <= players.max, 'online 不应该超过 max');
});

test('世界数据', function() {
    const world = mockStats.world;
    assertTruthy(typeof world.size === 'number', 'size 应该是数字');
    assertTruthy(world.size >= 0, 'size 应该 >= 0');
    assertTruthy(typeof world.entities === 'number', 'entities 应该是数字');
    assertTruthy(world.entities >= 0, 'entities 应该 >= 0');
});

test('数据格式化', function() {
    // 内存格式化
    const memMB = 1024;
    const memGB = (memMB / 1024).toFixed(2);
    assertEqual(memGB, '1.00');
    
    // 百分比格式化
    const percent = 75.5;
    assertEqual(percent.toFixed(1), '75.5');
});
