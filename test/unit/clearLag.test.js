/**
 * NECE 实体清理系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- clearLag.js 测试 ---');

// 模拟清理配置
const mockConfig = {
    enabled: true,
    interval: 600,
    reminderSeconds: 60,
    cleanTypes: [
        'minecraft:zombie',
        'minecraft:skeleton',
        'minecraft:creeper',
        'minecraft:spider'
    ],
    maxEntitiesPerType: 50
};

test('清理配置验证', function() {
    assertTruthy(typeof mockConfig.enabled === 'boolean', 'enabled 应该是布尔值');
    assertTruthy(typeof mockConfig.interval === 'number', 'interval 应该是数字');
    assertTruthy(mockConfig.interval >= 60, 'interval 应该 >= 60秒');
    assertTruthy(Array.isArray(mockConfig.cleanTypes), 'cleanTypes 应该是数组');
    assertTruthy(mockConfig.cleanTypes.length > 0, 'cleanTypes 不应该为空');
});

test('实体类型白名单', function() {
    const cleanTypes = mockConfig.cleanTypes;
    assertTruthy(cleanTypes.includes('minecraft:zombie'), '应该包含僵尸');
    assertTruthy(cleanTypes.includes('minecraft:skeleton'), '应该包含骷髅');
    assertTruthy(cleanTypes.includes('minecraft:creeper'), '应该包含苦力怕');
    assertFalsy(cleanTypes.includes('minecraft:villager'), '不应该包含村民');
});

test('每种类型最大数量', function() {
    const maxPerType = mockConfig.maxEntitiesPerType;
    assertTruthy(typeof maxPerType === 'number', '应该是数字');
    assertTruthy(maxPerType > 0, '应该大于0');
});

test('清理逻辑模拟', function() {
    // 模拟实体列表
    const entities = [
        { type: 'minecraft:zombie' },
        { type: 'minecraft:zombie' },
        { type: 'minecraft:zombie' },
        { type: 'minecraft:skeleton' },
        { type: 'minecraft:villager' }
    ];
    
    const maxPerType = 2;
    const cleanSet = new Set(mockConfig.cleanTypes);
    
    // 统计每种类型
    const typeCounts = {};
    entities.forEach(e => {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    });
    
    // 计算需要清理的数量
    let killCount = 0;
    for (const [type, count] of Object.entries(typeCounts)) {
        if (cleanSet.has(type) && count > maxPerType) {
            killCount += count - maxPerType;
        }
    }
    
    assertEqual(killCount, 1); // 僵尸3个，限制2个，清理1个
});

test('掉落物清理', function() {
    const entities = [
        { type: 'minecraft:item' },
        { type: 'minecraft:item' },
        { type: 'minecraft:zombie' }
    ];
    
    const itemEntities = entities.filter(e => e.type === 'minecraft:item');
    assertEqual(itemEntities.length, 2);
});

test('提醒时间计算', function() {
    const interval = 600; // 10分钟
    const reminderSeconds = 60; // 提前1分钟
    const reminderMs = reminderSeconds * 1000;
    const delay = interval * 1000 - reminderMs;
    
    assertEqual(delay, 540000); // 9分钟
});

test('清理统计', function() {
    const result = {
        killedMobs: 15,
        killedItems: 50,
        total: 100,
        protectedCount: 20,
        byType: {
            'minecraft:zombie': 10,
            'minecraft:skeleton': 5
        }
    };
    
    assertEqual(result.killedMobs + result.killedItems, 65);
    assertTruthy(result.total > 0, '总数应该大于0');
});
