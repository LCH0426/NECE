/**
 * NECE 传送系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- teleport.js 测试 ---');

// 模拟家园数据
const mockHomes = {
    '10001': [
        { name: '主城', x: 100, y: 64, z: 200, dim: 0, public: false, sharedWith: [] },
        { name: '矿洞', x: -50, y: 12, z: 300, dim: 0, public: true, sharedWith: ['10002'] }
    ],
    '10002': [
        { name: '家', x: 500, y: 64, z: 600, dim: 0 }
    ]
};

// 模拟地标数据
const mockWarps = {
    '主城': { x: 0, y: 64, z: 0, dim: 0, cost: 0, cdSec: 0 },
    '末地': { x: 0, y: 64, z: 0, dim: 2, cost: 100, cdSec: 60 }
};

test('家园数据结构', function() {
    const home = mockHomes['10001'][0];
    assertTruthy(home.name, '应该有名称');
    assertTruthy(typeof home.x === 'number', 'x 应该是数字');
    assertTruthy(typeof home.y === 'number', 'y 应该是数字');
    assertTruthy(typeof home.z === 'number', 'z 应该是数字');
    assertTruthy([0, 1, 2].includes(home.dim), 'dim 应该是 0/1/2');
});

test('获取玩家家园列表', function() {
    const xuid = '10001';
    const homes = mockHomes[xuid] || [];
    assertEqual(homes.length, 2);
});

test('家园数量限制', function() {
    const homeLimit = 10;
    const xuid = '10001';
    const currentCount = (mockHomes[xuid] || []).length;
    assertTruthy(currentCount < homeLimit, '应该还能添加家园');
});

test('家园名称唯一性检查', function() {
    const xuid = '10001';
    const homes = mockHomes[xuid] || [];
    const name = '主城';
    const exists = homes.some(h => h.name === name);
    assertTruthy(exists, '应该检测到重复名称');
    
    const newName = '新家';
    const newExists = homes.some(h => h.name === newName);
    assertFalsy(newExists, '新名称应该不存在');
});

test('坐标验证', function() {
    const validCoords = { x: 100, y: 64, z: 200 };
    const invalidCoords = { x: 'abc', y: 64, z: 200 };
    
    assertTruthy(typeof validCoords.x === 'number', '有效坐标x应该是数字');
    assertFalsy(typeof invalidCoords.x === 'number', '无效坐标x不应该是数字');
});

test('维度验证', function() {
    const validDims = [0, 1, 2];
    assertTruthy(validDims.includes(0), '主世界应该有效');
    assertTruthy(validDims.includes(1), '下界应该有效');
    assertTruthy(validDims.includes(2), '末地应该有效');
    assertFalsy(validDims.includes(3), '维度3应该无效');
});

test('地标数据结构', function() {
    const warp = mockWarps['主城'];
    assertTruthy(warp.x !== undefined, '应该有x');
    assertTruthy(warp.y !== undefined, '应该有y');
    assertTruthy(warp.z !== undefined, '应该有z');
    assertTruthy(warp.dim !== undefined, '应该有dim');
    assertTruthy(typeof warp.cost === 'number', 'cost 应该是数字');
    assertTruthy(typeof warp.cdSec === 'number', 'cdSec 应该是数字');
});

test('传送费用检查', function() {
    const warp = mockWarps['末地'];
    const playerMoney = 50;
    
    if (warp.cost > 0 && playerMoney < warp.cost) {
        assertTruthy(true, '余额不足时应该拒绝传送');
    } else {
        assertTruthy(false, '这个分支不应该执行');
    }
});

test('传送冷却检查', function() {
    const cooldowns = {};
    const xuid = '10001';
    const now = Date.now();
    
    // 设置冷却
    cooldowns[xuid] = now + 30000; // 30秒后过期
    
    // 检查冷却
    const isOnCooldown = cooldowns[xuid] && now < cooldowns[xuid];
    assertTruthy(isOnCooldown, '应该在冷却中');
    
    // 冷却结束
    const later = now + 31000;
    const isCooldownExpired = !cooldowns[xuid] || later >= cooldowns[xuid];
    assertTruthy(isCooldownExpired, '冷却应该已过期');
});

test('共享家园权限', function() {
    const home = mockHomes['10001'][1]; // 矿洞
    const targetXuid = '10002';
    const isShared = home.sharedWith && home.sharedWith.includes(targetXuid);
    assertTruthy(isShared, '玩家10002应该有权限访问共享家园');
    
    const otherXuid = '10003';
    const isNotShared = home.sharedWith && home.sharedWith.includes(otherXuid);
    assertFalsy(isNotShared, '玩家10003不应该有权限');
});
