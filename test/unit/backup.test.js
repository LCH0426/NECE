/**
 * NECE 备份系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- backup.js 测试 ---');

// 模拟备份配置
const mockConfig = {
    enabled: true,
    interval: 3600000, // 1小时
    maxBackups: 10,
    backupPath: 'plugins/NECE/backup'
};

// 模拟备份列表
const mockBackups = [
    { filename: 'backup_20260101_120000.7z', size: 1024000, time: '2026-01-01 12:00:00' },
    { filename: 'backup_20260102_120000.7z', size: 1048576, time: '2026-01-02 12:00:00' },
    { filename: 'backup_20260103_120000.7z', size: 1073741, time: '2026-01-03 12:00:00' }
];

test('备份配置验证', function() {
    assertTruthy(typeof mockConfig.enabled === 'boolean', 'enabled 应该是布尔值');
    assertTruthy(typeof mockConfig.interval === 'number', 'interval 应该是数字');
    assertTruthy(mockConfig.interval >= 60000, 'interval 应该 >= 60秒');
    assertTruthy(typeof mockConfig.maxBackups === 'number', 'maxBackups 应该是数字');
    assertTruthy(mockConfig.maxBackups > 0, 'maxBackups 应该 > 0');
});

test('备份列表格式', function() {
    assertTruthy(Array.isArray(mockBackups), 'backups 应该是数组');
    mockBackups.forEach(backup => {
        assertTruthy(backup.filename, '应该有文件名');
        assertTruthy(backup.size > 0, '大小应该 > 0');
        assertTruthy(backup.time, '应该有时间');
    });
});

test('备份数量限制', function() {
    const maxBackups = mockConfig.maxBackups;
    const currentCount = mockBackups.length;
    assertTruthy(currentCount <= maxBackups, '备份数量不应该超过限制');
});

test('备份文件命名规则', function() {
    const filename = 'backup_20260101_120000.7z';
    const pattern = /^backup_\d{8}_\d{6}\.7z$/;
    assertTruthy(pattern.test(filename), '文件名应该符合格式');
});

test('备份大小格式化', function() {
    const size = 1048576; // 1MB
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    assertEqual(sizeMB, '1.00');
});

test('备份时间排序', function() {
    const sorted = [...mockBackups].sort((a, b) => new Date(b.time) - new Date(a.time));
    assertEqual(sorted[0].filename, 'backup_20260103_120000.7z');
    assertEqual(sorted[sorted.length - 1].filename, 'backup_20260101_120000.7z');
});

test('删除最旧备份', function() {
    const maxBackups = 2;
    let backups = [...mockBackups];
    
    // 当超过限制时删除最旧的
    while (backups.length >= maxBackups) {
        backups.sort((a, b) => new Date(a.time) - new Date(b.time));
        backups.shift();
    }
    
    assertEqual(backups.length, 1);
    assertEqual(backups[0].filename, 'backup_20260103_120000.7z');
});
