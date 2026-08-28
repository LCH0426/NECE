/**
 * NECE 自动备份系统测试 —— 驱动 src/backup.js 真实逻辑
 * node_modules 中未安装 7zip-min，故通过 Module._load stub 注入伪 7z。
 * 覆盖：备份配置、备份目录、列表解析/排序/格式化、统计、删除校验、数量清理
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { setupMocks, teardownMocks, freshRequire, clearAllIntervals } = require('../helpers/setup');
const i18n = require('../../src/i18n');

// stub 未安装的 7zip-min
const fake7z = { cmd: function(args, cb) { if (cb) cb(null); } };
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === '7zip-min') return fake7z;
    return origLoad.apply(this, arguments);
};

describe('backup', () => {
    let backup, backupDir, origCwd, tmpDir;

    function clearBackupDir() {
        if (!fs.existsSync(backupDir)) return;
        fs.readdirSync(backupDir).forEach(function(f) {
            fs.unlinkSync(path.join(backupDir, f));
        });
    }

    function writeBackup(name, mtime) {
        const p = path.join(backupDir, name);
        fs.writeFileSync(p, 'x'.repeat(100));
        if (mtime) fs.utimesSync(p, new Date(mtime), new Date(mtime));
        return p;
    }

    before(() => {
        setupMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nece-backup-test-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);

        backup = freshRequire('../../src/backup');
        backup.init({
            t: i18n.t,
            getSystemLanguage: function() { return 'zh_CN'; },
            getConfig: function() { return { enabled: false, maxCount: 2 }; }
        });
        backupDir = backup.getBackupDir();
    });

    after(() => {
        clearAllIntervals();
        process.chdir(origCwd);
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        Module._load = origLoad;
        teardownMocks();
    });

    it('保存配置并返回，未启用定时器', () => {
        const c = backup.getConfig();
        assert.equal(c.enabled, false);
        assert.equal(c.maxCount, 2);
        assert.equal(backup.isBackupRunning(), false);
        assert.ok(backupDir.indexOf('backup') !== -1);
    });

    it('getBackupList 仅包含 7z/zip，解析世界名并按时间倒序', () => {
        clearBackupDir();
        writeBackup('Bedrock level_2025-01-01_10-00-00.7z', 1600000000000);
        writeBackup('Bedrock level_2025-01-02_11-30-00.7z', 1600086400000);
        writeBackup('data_backup_2025-01-03_09-00-00.zip', 1600172800000);
        writeBackup('notes.txt');

        const list = backup.getBackupList();
        assert.equal(list.length, 3);
        // 时间倒序：zip 最新在前
        assert.equal(list[0].filename, 'data_backup_2025-01-03_09-00-00.zip');
        assert.equal(list[0].type, 'data');
        assert.equal(list[1].filename, 'Bedrock level_2025-01-02_11-30-00.7z');
        assert.equal(list[1].world, 'Bedrock level');
        assert.equal(list[1].type, 'world');
        assert.ok(typeof list[0].sizeFormatted === 'string');
        assert.ok(list[0].time > 0);
    });

    it('getBackupStats 汇总数量与总大小', () => {
        const stats = backup.getBackupStats();
        assert.equal(stats.count, 3);
        assert.ok(stats.totalSize > 0);
        assert.equal(stats.backups.length, 3);
    });

    it('deleteBackup 各种校验', () => {
        assert.ok(backup.deleteBackup('').error);
        assert.ok(backup.deleteBackup('../evil.7z').error);
        assert.ok(backup.deleteBackup('a/b.7z').error);
        assert.ok(backup.deleteBackup('x.txt').error);
        assert.ok(backup.deleteBackup('nope.7z').error);
    });

    it('deleteBackup 删除存在的备份文件', () => {
        writeBackup('Bedrock level_2025-01-01_10-00-00.7z');
        const res = backup.deleteBackup('Bedrock level_2025-01-01_10-00-00.7z');
        assert.equal(res.success, true);
        assert.equal(fs.existsSync(path.join(backupDir, 'Bedrock level_2025-01-01_10-00-00.7z')), false);
    });

    it('cleanupOldBackups 按数量保留最新的 N 份', () => {
        clearBackupDir();
        writeBackup('w1_2025-01-01_00-00-00.7z', 1600000000000);
        writeBackup('w2_2025-01-02_00-00-00.7z', 1600086400000);
        writeBackup('w3_2025-01-03_00-00-00.7z', 1600172800000);
        const deleted = backup.cleanupOldBackups();
        assert.equal(deleted.length, 1);
        assert.equal(deleted[0].filename, 'w1_2025-01-01_00-00-00.7z');
        const list = backup.getBackupList();
        assert.equal(list.length, 2);
        const names = list.map(function(b) { return b.filename; });
        assert.equal(names.includes('w2_2025-01-02_00-00-00.7z'), true);
        assert.equal(names.includes('w3_2025-01-03_00-00-00.7z'), true);
    });
});