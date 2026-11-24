/**
 * NECE 银行系统测试
 * 覆盖 src/bank.js 的活期存取、定期存款存取、利息计算、账户结构等纯逻辑
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, lse } = require('../helpers/setup');

describe('bank 模块', () => {
    let bank;
    let playerData;
    let balances;
    let saveCount;

    function getPlayerMoney(player) { return balances[player.xuid] || 0; }
    function reducePlayerMoney(player, amount) {
        const b = getPlayerMoney(player);
        if (b < amount) return false;
        balances[player.xuid] = b - amount;
        return true;
    }
    function addPlayerMoney(player, amount) {
        balances[player.xuid] = getPlayerMoney(player) + amount;
        return true;
    }

    before(() => {
        setupMocks();
        balances = { '10001': 5000, '10002': 5000 };
        saveCount = 0;
        playerData = { players: { '10001': {}, '10002': {} } };

        // bank 采用工厂模式 create(deps)
        bank = require('../../src/bank').create({
            playerData,
            savePlayerDataNow: function() { saveCount++; },
            getPlayerMoney,
            reducePlayerMoney,
            addPlayerMoney,
            getCurrencyName: function() { return '星茜'; },
            openMainMenu: function() {},
            utils: require('../../src/utils'),
            t: function(lang, key) { return key; },
            getPlayerSetting: function() { return 'zh_CN'; }
        });
    });

    after(() => {
        teardownMocks();
    });

    describe('getPlayerBankAccount', () => {
        it('不存在的玩家返回 null', () => {
            assert.equal(bank.getPlayerBankAccount('99999'), null);
        });
        it('为已有玩家创建默认账户结构', () => {
            const acc = bank.getPlayerBankAccount('10001');
            assert.ok(acc);
            assert.equal(acc.current.balance, 0);
            assert.equal(acc.current.totalInterest, 0);
            assert.deepEqual(acc.fixed, []);
        });
    });

    describe('calculateCurrentInterest 活期利息', () => {
        it('刚刚结算过则不计息', () => {
            const acc = { current: { balance: 10000, lastInterestTime: require('../../src/utils').getCurrentTimeString(), totalInterest: 0 } };
            assert.equal(bank.calculateCurrentInterest(acc), 0);
            assert.equal(acc.current.balance, 10000);
        });
        it('余额为 0 时不计息', () => {
            const acc = { current: { balance: 0, lastInterestTime: '2026.01.01.00.00.00', totalInterest: 0 } };
            const interest = bank.calculateCurrentInterest(acc);
            assert.equal(interest, 0);
        });
        it('长时间持仓产生利息并累加入账', () => {
            const acc = { current: { balance: 10000, lastInterestTime: '2026.01.01.00.00.00', totalInterest: 0 } };
            const interest = bank.calculateCurrentInterest(acc);
            assert.ok(interest > 0);
            assert.equal(acc.current.balance, 10000 + interest);
            assert.equal(acc.current.totalInterest, interest);
        });
    });

    describe('performCurrentOperation 活期存取', () => {
        it('活期存款成功并更新余额', () => {
            balances['10001'] = 5000;
            const acc = bank.getPlayerBankAccount('10001');
            acc.current.balance = 0;
            const result = bank.performCurrentOperation({ xuid: '10001' }, 100);
            assert.equal(result.success, true);
            assert.equal(acc.current.balance, 100);
            assert.equal(balances['10001'], 4900);
        });
        it('活期取款成功', () => {
            const acc = bank.getPlayerBankAccount('10001');
            acc.current.balance = 1000;
            const beforeMoney = balances['10001'];
            const result = bank.performCurrentOperation({ xuid: '10001' }, -300);
            assert.equal(result.success, true);
            assert.equal(acc.current.balance, 700);
            assert.equal(balances['10001'], beforeMoney + 300);
        });
        it('存款金额超过持币时失败', () => {
            const acc = bank.getPlayerBankAccount('10002');
            acc.current.balance = 0;
            const result = bank.performCurrentOperation({ xuid: '10002' }, 8000);
            assert.equal(result.success, false);
            assert.equal(acc.current.balance, 0);
        });
        it('活期取款余额不足时失败', () => {
            const acc = bank.getPlayerBankAccount('10002');
            acc.current.balance = 100;
            const result = bank.performCurrentOperation({ xuid: '10002' }, -200);
            assert.equal(result.success, false);
            assert.equal(acc.current.balance, 100);
        });
        it('金额为 0 时失败', () => {
            const acc = bank.getPlayerBankAccount('10001');
            const result = bank.performCurrentOperation({ xuid: '10001' }, 0);
            assert.equal(result.success, false);
        });
        it('连续两次存款后重新加载数据不会丢失第一笔', () => {
            const balances2 = { '20001': 5000000 };
            const playerData2 = { players: { '20001': { name: '连续存款' } } };
            const saved = {};
            const dirty = new Set();
            const bank2 = require('../../src/bank').create({
                playerData: playerData2,
                savePlayerDataNow: function() {
                    Array.from(dirty).forEach(function(xuid) {
                        saved[xuid] = JSON.parse(JSON.stringify(playerData2.players[xuid]));
                    });
                    dirty.clear();
                },
                markPlayerDirty: function(xuid) { dirty.add(xuid); },
                getPlayerMoney: function(p) { return balances2[p.xuid] || 0; },
                reducePlayerMoney: function(p, amount) {
                    const b = balances2[p.xuid] || 0;
                    if (b < amount) return false;
                    balances2[p.xuid] = b - amount;
                    return true;
                },
                addPlayerMoney: function(p, amount) {
                    balances2[p.xuid] = (balances2[p.xuid] || 0) + amount;
                    return true;
                },
                getCurrencyName: function() { return '星茜'; },
                openMainMenu: function() {},
                utils: require('../../src/utils'),
                t: function(lang, key) { return key; },
                getPlayerSetting: function() { return 'zh_CN'; }
            });

            bank2.performCurrentOperation({ xuid: '20001' }, 1000000);
            assert.ok(saved['20001'], '第一次存款应已写入数据库');

            // 模拟重启后从数据库重新加载
            playerData2.players['20001'] = JSON.parse(JSON.stringify(saved['20001']));
            bank2.performCurrentOperation({ xuid: '20001' }, 500000);
            assert.equal(playerData2.players['20001'].bankdata.current.balance, 1500000);
        });
    });

    describe('depositFixed 定期存款存入', () => {
        it('存入成功并扣款、生成定期记录', () => {
            balances['10001'] = 5000;
            const acc = bank.getPlayerBankAccount('10001');
            acc.fixed = [];
            const result = bank.depositFixed({ xuid: '10001' }, 1000, 30);
            assert.equal(result.success, true);
            assert.equal(balances['10001'], 4000);
            assert.equal(acc.fixed.length, 1);
            assert.equal(acc.fixed[0].principal, 1000);
            assert.equal(acc.fixed[0].days, 30);
        });
        it('金额不足时失败', () => {
            balances['10002'] = 100;
            const result = bank.depositFixed({ xuid: '10002' }, 200, 7);
            assert.equal(result.success, false);
        });
        it('非法期限失败', () => {
            balances['10001'] = 5000;
            assert.equal(bank.depositFixed({ xuid: '10001' }, 100, 15).success, false);
        });
    });

    describe('withdrawFixed 定期取出', () => {
        it('到期取出返回本金加利息', () => {
            balances['10002'] = 0;
            const acc = bank.getPlayerBankAccount('10002');
            acc.fixed = [{ id: 'd1', principal: 10000, rate: 0.01, days: 30, matureTime: '2020.01.01.00.00.00' }];
            const result = bank.withdrawFixed({ xuid: '10002' }, 'd1');
            assert.equal(result.success, true);
            // 到期：本金 + 利息 = 10000 + floor(10000*0.01) = 10100
            assert.equal(balances['10002'], 10100);
            assert.equal(acc.fixed.length, 0);
        });
        it('未到期提前取出扣除违约金', () => {
            balances['10001'] = 0;
            const acc = bank.getPlayerBankAccount('10001');
            acc.fixed = [{ id: 'd2', principal: 10000, rate: 0.01, days: 30, matureTime: '2999.01.01.00.00.00' }];
            const result = bank.withdrawFixed({ xuid: '10001' }, 'd2');
            assert.equal(result.success, true);
            // 提前取出：本金 - floor(本金*2%)
            assert.equal(balances['10001'], 9800);
            assert.equal(acc.fixed.length, 0);
        });
        it('找不到定期记录时失败', () => {
            assert.equal(bank.withdrawFixed({ xuid: '10002' }, 'nope').success, false);
        });
    });

    describe('checkFixedDepositMaturity 到期提醒', () => {
        it('到期定期玩家上线时收到提醒', () => {
            const player = lse.createMockPlayer('10003', '玩家三');
            lse.mc._mockPlayers.set('10003', player);
            playerData.players['10003'] = {};
            const acc = bank.getPlayerBankAccount('10003');
            acc.fixed = [{ id: 'd3', principal: 5000, rate: 0.01, days: 7, matureTime: '2020.02.02.00.00.00' }];
            const tells = [];
            player.tell = function(msg) { tells.push(msg); };
            bank.checkFixedDepositMaturity(player, function() { return true; });
            assert.equal(tells.length, 1);
        });
        it('开启了提醒但无到期存款时无提醒', () => {
            const player = lse.createMockPlayer('10003', '玩家三');
            const acc = bank.getPlayerBankAccount('10003');
            acc.fixed = [{ id: 'd4', principal: 5000, rate: 0.01, days: 7, matureTime: '2999.02.02.00.00.00' }];
            const tells = [];
            player.tell = function(msg) { tells.push(msg); };
            bank.checkFixedDepositMaturity(player, function() { return true; });
            assert.equal(tells.length, 0);
        });
    });
});