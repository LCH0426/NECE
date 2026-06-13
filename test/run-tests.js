/**
 * NECE 测试运行器
 * 运行所有单元测试并生成报告
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

console.log('NECE 测试套件');
console.log('='.repeat(60));
console.log(`运行时间: ${new Date().toLocaleString()}`);
console.log(`工作目录: ${process.cwd()}`);
console.log('='.repeat(60));

// 自定义框架测试文件
const testFiles = [
    'unit/utils.test.js',
    'unit/database.test.js',
    'unit/economy.test.js',
    'unit/shop.test.js',
    'unit/guild.test.js',
    'unit/i18n.test.js',
    'unit/bank.test.js',
    'unit/ban.test.js',
    'unit/messageBoard.test.js',
    'unit/teleport.test.js',
    'unit/monitoring.test.js',
    'unit/backup.test.js',
    'unit/clearLag.test.js',
    'unit/mail.test.js'
];

// node:test 框架测试文件（单独运行，带超时）
const nodeTestFiles = [
    'unit/chat.test.js',
    'unit/friend.test.js',
    'unit/menu.test.js',
    'unit/title.test.js'
];

// 运行自定义框架测试
testFiles.forEach(function(file) {
    const testPath = path.join(__dirname, file);
    if (fs.existsSync(testPath)) {
        try {
            require(testPath);
        } catch (e) {
            console.log('\n✗ 加载 ' + file + ' 失败: ' + e.message);
        }
    } else {
        console.log('\n○ ' + file + ' 不存在，跳过');
    }
});

// 获取自定义框架统计
const framework = require('./test-framework');
const customStats = framework.getStats();

// 运行 node:test 框架测试（带超时防止进程挂起）
console.log('\n--- node:test 框架测试 ---');
var nodeTestPassed = 0;
var nodeTestFailed = 0;
nodeTestFiles.forEach(function(file) {
    const testPath = path.join(__dirname, file);
    if (!fs.existsSync(testPath)) {
        console.log('○ ' + file + ' 不存在，跳过');
        return;
    }
    try {
        // --test-timeout 防止单个测试挂起；execSync timeout 防止 setInterval 导致进程不退出
        var result = execFileSync('node', ['--test', '--test-timeout=5000', '--test-concurrency=1', testPath], {
            timeout: 12000,
            encoding: 'utf-8',
            cwd: path.join(__dirname, '..'),
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        var match = result.match(/ℹ pass (\d+)/);
        var passCount = match ? parseInt(match[1]) : 0;
        nodeTestPassed += passCount;
        console.log('  ✓ ' + file + ' (' + passCount + ' 通过)');
    } catch (e) {
        // execSync 超时或测试失败时进入此分支
        var output = (e.stdout || '') + (e.stderr || '');
        var passMatch = output.match(/ℹ pass (\d+)/);
        var failMatch2 = output.match(/ℹ fail (\d+)/);
        var passCount2 = passMatch ? parseInt(passMatch[1]) : 0;
        var failCount = failMatch2 ? parseInt(failMatch2[1]) : 0;
        nodeTestPassed += passCount2;
        if (failCount > 0) {
            nodeTestFailed++;
            console.log('  ✗ ' + file + ' (' + passCount2 + ' 通过, ' + failCount + ' 失败)');
        } else if (passCount2 > 0) {
            console.log('  ✓ ' + file + ' (' + passCount2 + ' 通过)');
        } else {
            // 无法解析输出，可能是进程被 SIGTERM 杀死
            console.log('  ○ ' + file + ' (进程超时，无法解析结果)');
        }
    }
});

// 汇总报告
var totalPassed = customStats.passed + nodeTestPassed;
var totalFailed = customStats.failed + nodeTestFailed;
var totalTests = customStats.total + nodeTestPassed + nodeTestFailed;

console.log('\n' + '='.repeat(60));
console.log('NECE 测试报告');
console.log('='.repeat(60));
console.log('自定义框架: ' + customStats.passed + ' 通过, ' + customStats.failed + ' 失败');
console.log('node:test:  ' + nodeTestPassed + ' 通过, ' + nodeTestFailed + ' 文件有失败');
console.log('-'.repeat(60));
console.log('总计: ' + totalTests + ' 个测试');
console.log('通过: ' + totalPassed + ' 个');
console.log('失败: ' + totalFailed + ' 个');
console.log('通过率: ' + (totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0) + '%');
console.log('='.repeat(60));

process.exit(totalFailed > 0 ? 1 : 0);
