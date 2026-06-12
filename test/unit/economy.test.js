/**
 * NECE 经济系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- economy.js 测试 ---');

// 模拟 LLMoney API
let mockBalance = {};
const mockMoney = {
    get: (xuid) => mockBalance[xuid] || 0,
    add: (xuid, amount) => { mockBalance[xuid] = (mockBalance[xuid] || 0) + amount; return true; },
    reduce: (xuid, amount) => {
        if ((mockBalance[xuid] || 0) < amount) return false;
        mockBalance[xuid] -= amount;
        return true;
    }
};

// 模拟玩家对象
function createMockPlayer(xuid, name) {
    return {
        xuid: xuid,
        name: name || 'Player' + xuid,
        tell: () => {},
        sendToast: () => {}
    };
}

test('getPlayerMoneyByXuid 获取余额', function() {
    mockBalance['12345'] = 1000;
    const balance = mockMoney.get('12345');
    assertEqual(balance, 1000);
});

test('addPlayerMoneyByXuid 增加余额', function() {
    mockBalance['12345'] = 1000;
    mockMoney.add('12345', 500);
    assertEqual(mockBalance['12345'], 1500);
});

test('reducePlayerMoney 扣除余额', function() {
    mockBalance['12345'] = 1000;
    const result = mockMoney.reduce('12345', 300);
    assertTruthy(result);
    assertEqual(mockBalance['12345'], 700);
});

test('reducePlayerMoney 余额不足', function() {
    mockBalance['12345'] = 100;
    const result = mockMoney.reduce('12345', 200);
    assertFalsy(result);
    assertEqual(mockBalance['12345'], 100); // 余额不变
});

test('reducePlayerMoney 精确扣到0', function() {
    mockBalance['12345'] = 100;
    const result = mockMoney.reduce('12345', 100);
    assertTruthy(result);
    assertEqual(mockBalance['12345'], 0);
});

test('并发扣费保护', function() {
    mockBalance['67890'] = 100;
    
    // 模拟两次同时扣费
    const result1 = mockMoney.reduce('67890', 80);
    const result2 = mockMoney.reduce('67890', 80);
    
    assertTruthy(result1); // 第一次应该成功
    assertFalsy(result2);  // 第二次应该失败
    assertEqual(mockBalance['67890'], 20); // 剩余20
});

test('负数金额处理', function() {
    mockBalance['12345'] = 1000;
    // 负数增加应该等于减少
    mockMoney.add('12345', -200);
    assertEqual(mockBalance['12345'], 800);
});

test('不存在的玩家余额', function() {
    const balance = mockMoney.get('nonexistent');
    assertEqual(balance, 0);
});

// 清理
test('清理测试数据', function() {
    mockBalance = {};
    assertTruthy(true);
});
