/**
 * NECE 测试运行器
 * 运行所有单元测试并生成报告
 */

const path = require('path');
const fs = require('fs');

console.log('NECE 测试套件');
console.log('='.repeat(60));
console.log(`运行时间: ${new Date().toLocaleString()}`);
console.log(`工作目录: ${process.cwd()}`);
console.log('='.repeat(60));

// 测试文件列表
const testFiles = [
    'unit/utils.test.js',
    'unit/database.test.js',
    'unit/economy.test.js',
    'unit/shop.test.js',
    'unit/guild.test.js',
    'unit/i18n.test.js'
];

// 运行测试
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

testFiles.forEach(file => {
    const testPath = path.join(__dirname, file);
    if (fs.existsSync(testPath)) {
        try {
            require(testPath);
        } catch (e) {
            console.log(`\n✗ 加载 ${file} 失败: ${e.message}`);
            totalFailed++;
        }
    } else {
        console.log(`\n○ ${file} 不存在，跳过`);
        totalSkipped++;
    }
});

// 获取测试框架的统计
const framework = require('./test-framework');
const stats = framework.getStats();

// 打印最终报告
const success = framework.printReport();

// 退出码
process.exit(success ? 0 : 1);
