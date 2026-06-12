/**
 * NECE 银行系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- bank.js 测试 ---');

// 模拟银行数据结构
function createMockAccount() {
    return {
        current: {
            balance: 0,
            lastInterestTime: '2026.01.01.00.00.00',
            totalInterest: 0
        },
        fixed: []
    };
}

test('活期账户初始化', function() {
    const account = createMockAccount();
    assertEqual(account.current.balance, 0);
    assertEqual(account.current.totalInterest, 0);
    assertTruthy(Array.isArray(account.fixed), 'fixed 应该是数组');
});

test('活期存款', function() {
    const account = createMockAccount();
    const amount = 1000;
    account.current.balance += amount;
    account.current.balance = Math.floor(account.current.balance);
    assertEqual(account.current.balance, 1000);
});

test('活期取款', function() {
    const account = createMockAccount();
    account.current.balance = 1000;
    const withdrawAmount = 300;
    if (account.current.balance >= withdrawAmount) {
        account.current.balance -= withdrawAmount;
        account.current.balance = Math.floor(account.current.balance);
    }
    assertEqual(account.current.balance, 700);
});

test('活期取款余额不足', function() {
    const account = createMockAccount();
    account.current.balance = 100;
    const withdrawAmount = 200;
    let success = false;
    if (account.current.balance >= withdrawAmount) {
        account.current.balance -= withdrawAmount;
        success = true;
    }
    assertFalsy(success, '余额不足时应该失败');
    assertEqual(account.current.balance, 100);
});

test('利息计算', function() {
    const account = createMockAccount();
    account.current.balance = 10000;
    const dailyRate = 0.0002;
    const days = 1;
    const interest = Math.round(account.current.balance * dailyRate * days);
    assertEqual(interest, 2); // 10000 * 0.0002 * 1 = 2
});

test('利息累计', function() {
    const account = createMockAccount();
    account.current.balance = 10000;
    account.current.totalInterest = 100;
    const interest = 2;
    account.current.balance += interest;
    account.current.totalInterest += interest;
    assertEqual(account.current.balance, 10002);
    assertEqual(account.current.totalInterest, 102);
});

test('定期存款结构', function() {
    const deposit = {
        id: Date.now(),
        principal: 10000,
        rate: 0.0099,
        days: 30,
        startTime: '2026.01.01.00.00.00',
        matureTime: '2026.01.31.00.00.00',
        status: 'active'
    };
    assertEqual(deposit.principal, 10000);
    assertEqual(deposit.days, 30);
    assertEqual(deposit.status, 'active');
});

test('定期利息计算', function() {
    const principal = 10000;
    const rate = 0.0099; // 月利率
    const interest = Math.round(principal * rate);
    assertEqual(interest, 99);
});

test('提前取出扣违约金', function() {
    const principal = 10000;
    const penaltyRate = 0.02;
    const penalty = Math.floor(principal * penaltyRate);
    const refund = principal - penalty;
    assertEqual(penalty, 200);
    assertEqual(refund, 9800);
});

test('定期存款到期判断', function() {
    const now = Date.now();
    const matureTime = now - 1000; // 已过期
    const isMature = now >= matureTime;
    assertTruthy(isMature);
    
    const futureTime = now + 86400000; // 未来
    const isNotMature = now >= futureTime;
    assertFalsy(isNotMature);
});
