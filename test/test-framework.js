/**
 * NECE 单元测试框架
 * 测试核心模块的功能
 */

const assert = require('assert');
const path = require('path');

// 测试结果统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;
const failures = [];

/**
 * 测试用例
 */
function test(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failedTests++;
        failures.push({ name, error: e.message });
        console.log(`  ✗ ${name}`);
        console.log(`    ${e.message}`);
    }
}

/**
 * 跳过测试
 */
function skip(name, reason) {
    totalTests++;
    skippedTests++;
    console.log(`  ○ ${name} (skipped: ${reason})`);
}

/**
 * 断言工具
 */
function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(msg || `Expected ${expected}, got ${actual}`);
    }
}

function assertTruthy(value, msg) {
    if (!value) {
        throw new Error(msg || `Expected truthy, got ${value}`);
    }
}

function assertFalsy(value, msg) {
    if (value) {
        throw new Error(msg || `Expected falsy, got ${value}`);
    }
}

function assertDeepEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

/**
 * 打印测试报告
 */
function printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('NECE 测试报告');
    console.log('='.repeat(60));
    console.log(`总计: ${totalTests} 个测试`);
    console.log(`通过: ${passedTests} 个`);
    console.log(`失败: ${failedTests} 个`);
    console.log(`跳过: ${skippedTests} 个`);
    console.log(`通过率: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);
    
    if (failures.length > 0) {
        console.log('\n失败详情:');
        failures.forEach((f, i) => {
            console.log(`  ${i + 1}. ${f.name}`);
            console.log(`     ${f.error}`);
        });
    }
    
    console.log('='.repeat(60));
    return failedTests === 0;
}

module.exports = {
    test,
    skip,
    assertEqual,
    assertTruthy,
    assertFalsy,
    assertDeepEqual,
    printReport,
    getStats: () => ({ total: totalTests, passed: passedTests, failed: failedTests, skipped: skippedTests })
};
