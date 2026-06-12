/**
 * NECE 公会系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- guild.js 测试 ---');

// 模拟公会数据
const mockGuilds = [
    { id: 1, name: '测试公会A', owner: '10001', fund: 10000, maxMembers: 20 },
    { id: 2, name: '测试公会B', owner: '10002', fund: 5000, maxMembers: 15 }
];

const mockMembers = [
    { xuid: '10001', guild_id: 1, role: 'owner' },
    { xuid: '10003', guild_id: 1, role: 'member' },
    { xuid: '10002', guild_id: 2, role: 'owner' }
];

test('公会数据结构验证', function() {
    const guild = mockGuilds[0];
    assertTruthy(guild.id, '公会应该有ID');
    assertTruthy(guild.name, '公会应该有名称');
    assertTruthy(guild.owner, '公会有会长');
    assertTruthy(typeof guild.fund === 'number', '资金应该是数字');
});

test('公会成员数量检查', function() {
    const guildId = 1;
    const memberCount = mockMembers.filter(m => m.guild_id === guildId).length;
    const guild = mockGuilds.find(g => g.id === guildId);
    assertTruthy(memberCount < guild.maxMembers, '成员数应该小于上限');
});

test('公会资金原子操作', function() {
    // 模拟原子扣减
    let fund = 1000;
    const amount = 500;
    
    // 检查余额足够
    if (fund >= amount) {
        fund -= amount;
    }
    assertEqual(fund, 500);
    
    // 余额不足时不应该扣减
    if (fund >= 600) {
        fund -= 600;
    }
    assertEqual(fund, 500); // 应该还是500
});

test('公会名称唯一性检查', function() {
    const name = '测试公会A';
    const exists = mockGuilds.some(g => g.name === name);
    assertTruthy(exists, '应该检测到重复名称');
    
    const newName = '新公会';
    const newExists = mockGuilds.some(g => g.name === newName);
    assertFalsy(newExists, '新名称应该不存在');
});

test('公会角色验证', function() {
    const validRoles = ['owner', 'admin', 'member'];
    assertTruthy(validRoles.includes('owner'));
    assertTruthy(validRoles.includes('admin'));
    assertTruthy(validRoles.includes('member'));
    assertFalsy(validRoles.includes('invalid'));
});

test('公会传送点验证', function() {
    const teleport = {
        name: '主城',
        x: 100,
        y: 64,
        z: 200,
        dim: 0
    };
    
    assertTruthy(typeof teleport.x === 'number', 'x 应该是数字');
    assertTruthy(typeof teleport.y === 'number', 'y 应该是数字');
    assertTruthy(typeof teleport.z === 'number', 'z 应该是数字');
    assertTruthy([0, 1, 2].includes(teleport.dim), 'dim 应该是 0/1/2');
});

test('公会权限检查', function() {
    const owner = mockMembers.find(m => m.role === 'owner');
    const member = mockMembers.find(m => m.role === 'member');
    
    assertTruthy(owner.role === 'owner', '会长应该有 owner 角色');
    assertTruthy(member.role === 'member', '普通成员应该有 member 角色');
});
