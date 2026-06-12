/**
 * NECE i18n 模块测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');
const path = require('path');

console.log('\n--- i18n.js 测试 ---');

// 模拟 i18n 模块
const langDir = path.join(__dirname, '..', '..', 'lang');

test('语言文件存在', function() {
    const fs = require('fs');
    const zhCNPath = path.join(langDir, 'zh_CN.json');
    assertTruthy(fs.existsSync(zhCNPath), 'zh_CN.json 应该存在');
});

test('语言文件格式正确', function() {
    const fs = require('fs');
    const zhCNPath = path.join(langDir, 'zh_CN.json');
    const data = JSON.parse(fs.readFileSync(zhCNPath, 'utf-8'));
    assertTruthy(typeof data === 'object', '应该是对象');
    assertTruthy(data._meta, '应该有 _meta 字段');
});

test('_meta 字段完整', function() {
    const fs = require('fs');
    const zhCNPath = path.join(langDir, 'zh_CN.json');
    const data = JSON.parse(fs.readFileSync(zhCNPath, 'utf-8'));
    assertTruthy(data._meta.author, '应该有 author');
    assertTruthy(data._meta.language, '应该有 language');
    assertTruthy(data._meta.locale, '应该有 locale');
    assertTruthy(data._meta.currencyName, '应该有 currencyName');
});

test('翻译键格式正确', function() {
    const fs = require('fs');
    const zhCNPath = path.join(langDir, 'zh_CN.json');
    const data = JSON.parse(fs.readFileSync(zhCNPath, 'utf-8'));
    
    // 检查 bank 模块的键
    assertTruthy(data.bank, '应该有 bank 模块');
    assertTruthy(data.bank.title, 'bank 应该有 title');
    assertTruthy(data.bank.back, 'bank 应该有 back');
});

test('占位符格式正确', function() {
    const fs = require('fs');
    const zhCNPath = path.join(langDir, 'zh_CN.json');
    const data = JSON.parse(fs.readFileSync(zhCNPath, 'utf-8'));
    
    // 检查带占位符的翻译
    const template = data.bank.balance;
    assertTruthy(template.includes('{0}'), '应该包含 {0} 占位符');
    assertTruthy(template.includes('{1}'), '应该包含 {1} 占位符');
});

test('翻译函数模拟', function() {
    const translations = {
        'bank.title': '§l§b{0}储所',
        'bank.back': '§c返回'
    };
    
    function t(key, ...args) {
        let value = translations[key] || key;
        args.forEach((arg, i) => {
            value = value.replace('{' + i + '}', arg);
        });
        return value;
    }
    
    assertEqual(t('bank.title', '星茜'), '§l§b星茜储所');
    assertEqual(t('bank.back'), '§c返回');
    assertEqual(t('unknown.key'), 'unknown.key'); // 未知键返回键名
});

test('占位符替换', function() {
    function replacePlaceholders(template, ...args) {
        let result = template;
        args.forEach((arg, i) => {
            result = result.replace('{' + i + '}', arg);
        });
        return result;
    }
    
    assertEqual(replacePlaceholders('余额: {0} {1}', 1000, '星茜'), '余额: 1000 星茜');
    assertEqual(replacePlaceholders('第 {0}/{1} 页', 1, 5), '第 1/5 页');
});

test('语言模块数量', function() {
    const fs = require('fs');
    const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));
    assertTruthy(files.length > 0, '应该至少有一个语言文件');
    console.log(`    找到 ${files.length} 个语言文件: ${files.join(', ')}`);
});
