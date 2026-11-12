/**
 * NECE 统一日志模块测试 —— 驱动 src/logStore.js 真实逻辑
 * 覆盖：按日文件写入、字段顺序、缓冲刷盘、坏行跳过、日期列表、事件过滤、时间转换、写失败回队
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { setupMocks, teardownMocks, clearAllIntervals } = require('../helpers/setup');

const logStore = require('../../src/logStore');

describe('logStore', () => {
    let tmpDir;

    function todayFile() {
        return path.join(tmpDir, logStore.formatDate(new Date()) + '.jsonl');
    }

    function clearLogDir() {
        if (!fs.existsSync(tmpDir)) return;
        fs.readdirSync(tmpDir).forEach(function(f) {
            fs.unlinkSync(path.join(tmpDir, f));
        });
    }

    function writeDay(dateStr, entries) {
        const p = path.join(tmpDir, dateStr + '.jsonl');
        fs.writeFileSync(p, entries.map(function(e) { return JSON.stringify(e); }).join('\n') + '\n', 'utf-8');
        return p;
    }

    before(() => {
        setupMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nece-logstore-test-'));
    });

    beforeEach(() => {
        clearLogDir();
        logStore.init({ dir: tmpDir });
    });

    afterEach(() => {
        logStore.shutdown();
        clearLogDir();
    });

    after(() => {
        clearAllIntervals();
        teardownMocks();
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('append 先进入缓冲区，flush 后按日期写入 JSONL', () => {
        logStore.append('chat', { sender: 'Steve', message: 'hello', type: 'player' });
        assert.equal(fs.existsSync(todayFile()), false);

        logStore.flush();
        const lines = fs.readFileSync(todayFile(), 'utf-8').trim().split('\n');
        assert.equal(lines.length, 1);

        const entry = JSON.parse(lines[0]);
        assert.equal(entry.event, 'chat');
        assert.equal(entry.sender, 'Steve');
        assert.equal(entry.message, 'hello');
        assert.equal(entry.type, 'player');
        assert.match(entry.time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        assert.equal(entry.level, 'info');
        assert.deepEqual(Object.keys(entry).slice(0, 3), ['time', 'level', 'event']);
    });

    it('支持显式日志级别，非法级别回退到 info', () => {
        logStore.append('auth.login_failed', { uid: '1' }, 'warn');
        logStore.append('chat', { sender: 'A' }, 'verbose');
        logStore.flush();

        const entries = fs.readFileSync(todayFile(), 'utf-8').trim().split('\n').map(JSON.parse);
        assert.equal(entries[0].level, 'warn');
        assert.equal(entries[1].level, 'info');
        assert.equal(logStore.normalizeLevel('ERR'), 'err');
        assert.equal(logStore.normalizeLevel('nope'), 'info');
    });

    it('调用方传入的 time/event 不会覆盖统一字段', () => {
        logStore.append('admin.ban', { time: 'bad', event: 'bad', admin: '10000', action: '封禁玩家' });
        logStore.flush();
        const entry = JSON.parse(fs.readFileSync(todayFile(), 'utf-8').trim());
        assert.equal(entry.event, 'admin.ban');
        assert.match(entry.time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        assert.equal(entry.admin, '10000');
        assert.equal(entry.action, '封禁玩家');
    });

    it('readEntries 跳过无效行并返回有效条目', () => {
        fs.writeFileSync(todayFile(), [
            JSON.stringify({ time: '2026-11-12 10:00:00', event: 'chat', sender: 'A' }),
            '{bad json',
            JSON.stringify({ time: '2026-11-12 10:00:01', event: 'chat', sender: 'B' })
        ].join('\n') + '\n', 'utf-8');

        const entries = logStore.readEntries(logStore.formatDate(new Date()));
        assert.equal(entries.length, 2);
        assert.deepEqual(entries.map(function(e) { return e.sender; }), ['A', 'B']);
    });

    it('listDates 按日期倒序排列并忽略非日志文件', () => {
        writeDay('2026-01-01', []);
        writeDay('2026-01-03', []);
        writeDay('2026-01-02', []);
        fs.writeFileSync(path.join(tmpDir, 'behavior.csv'), 'x');

        assert.deepEqual(logStore.listDates(), ['2026-01-03', '2026-01-02', '2026-01-01']);
    });

    it('datesWithEvent 同时支持精确匹配与前缀匹配', () => {
        writeDay('2026-01-01', [
            { time: '2026-01-01 00:00:00', event: 'chat', sender: 'A' }
        ]);
        writeDay('2026-01-02', [
            { time: '2026-01-02 00:00:00', event: 'admin.ban', admin: '10000' }
        ]);
        writeDay('2026-01-03', [
            { time: '2026-01-03 00:00:00', event: 'economy.reduce', player: 'A' }
        ]);

        assert.deepEqual(logStore.datesWithEvent('chat'), ['2026-01-01']);
        assert.deepEqual(logStore.datesWithEvent('admin.'), ['2026-01-02']);
        assert.deepEqual(logStore.datesWithEvent('economy.'), ['2026-01-03']);
    });

    it('parseTimeToMillis 将本地时间字符串转换为毫秒时间戳', () => {
        const expected = new Date(2026, 0, 2, 3, 4, 5).getTime();
        assert.equal(logStore.parseTimeToMillis('2026-01-02 03:04:05'), expected);
        assert.equal(logStore.parseTimeToMillis('bad'), 0);
        assert.equal(logStore.parseTimeToMillis(''), 0);
    });

    it('写入失败时数据回队，恢复后下次 flush 成功写入', () => {
        const origWriteSync = fs.writeSync;
        logStore.append('chat', { sender: 'Steve', message: 'retry' });

        fs.writeSync = function() { throw new Error('disk full'); };
        logStore.flush();
        fs.writeSync = origWriteSync;

        // 打开文件句柄会创建空文件，但不应写入任何内容
        const sizeAfterFail = fs.existsSync(todayFile()) ? fs.statSync(todayFile()).size : 0;
        assert.equal(sizeAfterFail, 0);
        logStore.flush();

        const lines = fs.readFileSync(todayFile(), 'utf-8').trim().split('\n');
        assert.equal(lines.length, 1);
        assert.equal(JSON.parse(lines[0]).message, 'retry');
    });

    it('shutdown 会刷盘并写入缓冲数据', () => {
        logStore.append('chat', { sender: 'Steve', message: 'bye' });
        logStore.shutdown();

        const lines = fs.readFileSync(todayFile(), 'utf-8').trim().split('\n');
        assert.equal(lines.length, 1);
        assert.equal(JSON.parse(lines[0]).message, 'bye');
    });
});
