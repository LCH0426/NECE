/**
 * 测试辅助工具
 * 注入 LSE 全局 Mock，初始化临时数据库，提供通用测试工具
 */

const path = require('path');
const fs = require('fs');
const lse = require('../mock/lse');
const { MockDataManager } = require('../mock/datamanager');

const TEST_DATA_DIR = path.join(__dirname, '..', '_testdata');

/** 注入 LSE 全局 Mock 对象 */
function setupMocks() {
    lse.injectGlobals();
    lse.logger.clear();
    lse.money.clear();
    lse.mc._clearAll();
}

/** 清理全局 Mock */
function teardownMocks() {
    lse.clearGlobals();
}

/** 创建临时测试数据目录 */
function ensureTestDataDir() {
    if (!fs.existsSync(TEST_DATA_DIR)) {
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    return TEST_DATA_DIR;
}

/** 清理临时测试数据目录 */
function cleanupTestDataDir() {
    if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
}

/** 创建 Mock 玩家并注入 mc */
function createAndRegisterPlayer(xuid, name) {
    var player = lse.createMockPlayer(xuid, name);
    lse.mc._mockPlayers.set(String(xuid), player);
    return player;
}

/** 创建 Mock DataManager */
function createMockDM(defaultData) {
    return new MockDataManager(defaultData);
}

/** 获取模块并清除 require 缓存（用于隔离测试） */
function freshRequire(modulePath) {
    var resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    return require(modulePath);
}

/** 清除所有 setInterval（防止测试进程不退出） */
function clearAllIntervals() {
    // 获取当前所有活跃的 timer 并清除
    const timers = global._activeTimers || [];
    timers.forEach(function(id) { clearInterval(id); clearTimeout(id); });
}

module.exports = {
    lse,
    setupMocks,
    teardownMocks,
    ensureTestDataDir,
    cleanupTestDataDir,
    createAndRegisterPlayer,
    createMockDM,
    freshRequire,
    clearAllIntervals,
    TEST_DATA_DIR
};
