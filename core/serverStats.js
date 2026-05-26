
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

var tpsDataRef = null;
var moneyRef = null;
var playerDataDMRef = null;

var allMoneyCache = {
    totalMoney: 0,
    playerCount: 0,
    timestamp: 0
};
var ALL_MONEY_CACHE_TTL = 30000;

var economyRankCache = {
    topBalances: [],
    totalBankCurrent: 0,
    totalBankFixed: 0,
    totalBankAll: 0,
    topBankDeposits: [],
    timestamp: 0
};
var ECONOMY_RANK_CACHE_TTL = 300000;

function init(tpsData, money, playerDataDM) {
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
    var now = Date.now();
    if (now - allMoneyCache.timestamp < ALL_MONEY_CACHE_TTL) {
        return {
            totalMoney: allMoneyCache.totalMoney,
            playerCount: allMoneyCache.playerCount,
            cached: true
        };
    }

    var total = 0;
    var count = 0;

    if (!moneyRef || typeof moneyRef.get !== 'function') {
        return { totalMoney: 0, playerCount: 0, cached: false };
    }

    if (playerDataDMRef && playerDataDMRef.data && playerDataDMRef.data.players) {
        var players = playerDataDMRef.data.players;
        var xuids = Object.keys(players);
        for (var i = 0; i < xuids.length; i++) {
            try {
                var bal = moneyRef.get(xuids[i]);
                if (typeof bal === 'number' && !isNaN(bal)) {
                    total += bal;
                    count++;
                }
            } catch (e) {}
        }
    }

    allMoneyCache.totalMoney = total;
    allMoneyCache.playerCount = count;
    allMoneyCache.timestamp = now;

    return { totalMoney: total, playerCount: count, cached: false };
}

function getEconomyRank() {
    var now = Date.now();
    if (now - economyRankCache.timestamp < ECONOMY_RANK_CACHE_TTL) {
        return Object.assign({}, economyRankCache, { cached: true });
    }

    if (!playerDataDMRef || !playerDataDMRef.data || !playerDataDMRef.data.players) {
        return { topBalances: [], totalBankCurrent: 0, totalBankFixed: 0, totalBankAll: 0, topBankDeposits: [], cached: false };
    }

    var players = playerDataDMRef.data.players;
    var xuids = Object.keys(players);
    var balanceList = [];
    var bankDepositList = [];
    var totalBankCurrent = 0;
    var totalBankFixed = 0;

    for (var i = 0; i < xuids.length; i++) {
        var xuid = xuids[i];
        var p = players[xuid];
        var name = p.name || '';

        var bal = 0;
        if (moneyRef && typeof moneyRef.get === 'function') {
            try { bal = moneyRef.get(xuid) || 0; } catch (e) {}
        }
        if (typeof bal === 'number' && !isNaN(bal)) {
            balanceList.push({ name: name, xuid: xuid, balance: bal });
        }

        if (p.bankdata) {
            var currentBalance = (p.bankdata.current && typeof p.bankdata.current.balance === 'number') ? p.bankdata.current.balance : 0;
            totalBankCurrent += currentBalance;

            var playerFixedTotal = 0;
            if (Array.isArray(p.bankdata.fixed)) {
                for (var j = 0; j < p.bankdata.fixed.length; j++) {
                    var dep = p.bankdata.fixed[j];
                    if (dep.status === 'active' && typeof dep.principal === 'number') {
                        playerFixedTotal += dep.principal;
                    }
                }
            }
            totalBankFixed += playerFixedTotal;

            var playerBankTotal = currentBalance + playerFixedTotal;
            if (playerBankTotal > 0) {
                bankDepositList.push({ name: name, xuid: xuid, bankTotal: playerBankTotal, current: currentBalance, fixed: playerFixedTotal });
            }
        }
    }

    balanceList.sort(function(a, b) { return b.balance - a.balance; });
    bankDepositList.sort(function(a, b) { return b.bankTotal - a.bankTotal; });

    var topBalances = balanceList.slice(0, 5).map(function(item) {
        return { name: item.name, balance: item.balance };
    });

    var topBankDeposits = bankDepositList.slice(0, 5).map(function(item) {
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
