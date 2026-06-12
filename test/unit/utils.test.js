/**
 * NECE 工具函数测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');
const path = require('path');
const U = require(path.join(__dirname, '..', '..', 'src', 'utils'));

console.log('\n--- utils.js 测试 ---');

test('ensureDir 创建目录', function() {
    const testPath = 'plugins/NECE/test_temp/dir';
    U.ensureDir(testPath);
    const fs = require('fs');
    assertTruthy(fs.existsSync('plugins/NECE/test_temp'), '目录应该被创建');
    // 清理
    fs.rmSync('plugins/NECE/test_temp', { recursive: true, force: true });
});

test('formatTime 格式化秒数', function() {
    // formatTime 接受秒数，不是毫秒
    assertEqual(U.formatTime(1), '1秒');
    assertEqual(U.formatTime(60), '1分');
    assertEqual(U.formatTime(3600), '1小时');
    assertEqual(U.formatTime(86400), '1天');
});

test('formatTime 复合时间', function() {
    assertEqual(U.formatTime(90061), '1天1小时1分1秒');
    assertEqual(U.formatTime(3661), '1小时1分1秒');
});

test('getCurrentTimeString 返回字符串', function() {
    const result = U.getCurrentTimeString();
    assertTruthy(typeof result === 'string', '应该返回字符串');
    assertTruthy(result.includes('.'), '应该包含点分隔符');
});

test('isInteger 正整数字符串检测', function() {
    // isInteger 检查的是字符串是否为正整数
    assertTruthy(U.isInteger('123'));
    assertTruthy(U.isInteger('1'));
    assertFalsy(U.isInteger('0'));
    assertFalsy(U.isInteger('-123'));
    assertFalsy(U.isInteger('123.456'));
    assertFalsy(U.isInteger('abc'));
});

test('detectIPv6 IPv6检测', function() {
    assertTruthy(U.detectIPv6('::1'));
    assertTruthy(U.detectIPv6('2001:db8::1'));
    assertFalsy(U.detectIPv6('192.168.1.1'));
});

test('stripIpPort 去除端口', function() {
    assertEqual(U.stripIpPort('192.168.1.1:19132'), '192.168.1.1');
    assertEqual(U.stripIpPort('192.168.1.1'), '192.168.1.1');
});

test('getNetworkType 网络类型', function() {
    // getNetworkType 返回中文描述
    const result = U.getNetworkType('::1');
    assertTruthy(result.includes('IPv6'), '应该包含IPv6');
    // 内网IP返回"内网连接"
    assertEqual(U.getNetworkType('192.168.1.1'), '内网连接');
});

test('cleanFormatting 清理格式代码', function() {
    assertEqual(U.cleanFormatting('§a测试§r'), '测试');
    assertEqual(U.cleanFormatting('普通文本'), '普通文本');
});
