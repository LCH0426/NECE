
/**
 * Copyright (C) [2026] [LCH0426]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * NLCE 服务器性能监控
 * 实时追踪TPS和MSPT，提供性能数据接口
 */


const D = require('./debug');
let tpsDataRef = null;
let moneyRef = null;
let playerDataDMRef = null;

const allMoneyCache = {
    totalMoney: 0,
    playerCount: 0,
    timestamp: 0
};
const ALL_MONEY_CACHE_TTL = 30000;

const economyRankCache = {
    topBalances: [],
    totalBankCurrent: 0,
    totalBankFixed: 0,
    totalBankAll: 0,
    topBankDeposits: [],
    timestamp: 0
};
const ECONOMY_RANK_CACHE_TTL = 300000;

function init(tpsData, money, playerDataDM) {
	D.debugLogModule('serverStats')('init: 初始化完成');
    tpsDataRef = tpsData;
    moneyRef = money;
    playerDataDMRef = playerDataDM;
}

function getTps() {
    if (!tpsDataRef) return { tps: '20.00' };
    return {
        tps: tpsDataRef.tps || '20.00'
    };
}

function getAllMoney() {
    let now = Date.now();
    if (now - allMoneyCache.timestamp < ALL_MONEY_CACHE_TTL) {
        return {
            totalMoney: allMoneyCache.totalMoney,
            playerCount: allMoneyCache.playerCount,
            cached: true
        };
    }

    let total = 0;
    let count = 0;

    if (!moneyRef || typeof moneyRef.get !== 'function') {
        return { totalMoney: 0, playerCount: 0, cached: false };
    }

    if (playerDataDMRef && playerDataDMRef.data && playerDataDMRef.data.players) {
        let players = playerDataDMRef.data.players;
        let xuids = Object.keys(players);
        for (let i = 0; i < xuids.length; i++) {
            try {
                let bal = moneyRef.get(xuids[i]);
                if (typeof bal === 'number' && !isNaN(bal)) {
                    total += bal;
                    count++;
                }
            } catch (e) { logger.warn('[ServerStats] ' + e.message); }
        }
    }

    allMoneyCache.totalMoney = total;
    allMoneyCache.playerCount = count;
    allMoneyCache.timestamp = now;

    return { totalMoney: total, playerCount: count, cached: false };
}

function getEconomyRank() {
    const now = Date.now();
    if (now - economyRankCache.timestamp < ECONOMY_RANK_CACHE_TTL) {
        return Object.assign({}, economyRankCache, { cached: true });
    }

    if (!playerDataDMRef || !playerDataDMRef.data || !playerDataDMRef.data.players) {
        return { topBalances: [], totalBankCurrent: 0, totalBankFixed: 0, totalBankAll: 0, topBankDeposits: [], cached: false };
    }

    const players = playerDataDMRef.data.players;
    const xuids = Object.keys(players);
    const balanceList = [];
    const bankDepositList = [];
    let totalBankCurrent = 0;
    let totalBankFixed = 0;

    for (let i = 0; i < xuids.length; i++) {
        const xuid = xuids[i];
        const p = players[xuid];
        const name = p.name || '';

        let bal = 0;
        if (moneyRef && typeof moneyRef.get === 'function') {
            try { bal = moneyRef.get(xuid) || 0; } catch (e) { logger.warn('[ServerStats] ' + e.message); }
        }
        if (typeof bal === 'number' && !isNaN(bal)) {
            balanceList.push({ name: name, xuid: xuid, balance: bal });
        }

        if (p.bankdata) {
            const currentBalance = (p.bankdata.current && typeof p.bankdata.current.balance === 'number') ? p.bankdata.current.balance : 0;
            totalBankCurrent += currentBalance;

            let playerFixedTotal = 0;
            if (Array.isArray(p.bankdata.fixed)) {
                for (let j = 0; j < p.bankdata.fixed.length; j++) {
                    const dep = p.bankdata.fixed[j];
                    if (dep.status === 'active' && typeof dep.principal === 'number') {
                        playerFixedTotal += dep.principal;
                    }
                }
            }
            totalBankFixed += playerFixedTotal;

            const playerBankTotal = currentBalance + playerFixedTotal;
            if (playerBankTotal > 0) {
                bankDepositList.push({ name: name, xuid: xuid, bankTotal: playerBankTotal, current: currentBalance, fixed: playerFixedTotal });
            }
        }
    }

    balanceList.sort(function(a, b) { return b.balance - a.balance; });
    bankDepositList.sort(function(a, b) { return b.bankTotal - a.bankTotal; });

    let topBalances = balanceList.slice(0, 5).map(function(item) {
        return { name: item.name, balance: item.balance };
    });

    let topBankDeposits = bankDepositList.slice(0, 5).map(function(item) {
        return { name: item.name, bankTotal: item.bankTotal, current: item.current, fixed: item.fixed };
    });

    economyRankCache.topBalances = topBalances;
    economyRankCache.totalBankCurrent = totalBankCurrent;
    economyRankCache.totalBankFixed = totalBankFixed;
    economyRankCache.totalBankAll = totalBankCurrent + totalBankFixed;
    economyRankCache.topBankDeposits = topBankDeposits;
    economyRankCache.timestamp = now;

    return Object.assign({}, economyRankCache, { cached: false });
}

module.exports = {
    init: init,
    getTps: getTps,
    getAllMoney: getAllMoney,
    getEconomyRank: getEconomyRank
};
