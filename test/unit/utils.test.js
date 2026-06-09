const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, ensureTestDataDir, cleanupTestDataDir } = require('../helpers/setup');
const path = require('path');

describe('utils', () => {
    let U;

    before(() => {
        setupMocks();
        ensureTestDataDir();
        U = require('../../src/utils');
    });

    after(() => {
        teardownMocks();
        cleanupTestDataDir();
    });

    describe('formatTime', () => {
        it('should format seconds to Chinese time string', () => {
            assert.equal(U.formatTime(0), '0秒');
            assert.equal(U.formatTime(65), '1分5秒');
            assert.equal(U.formatTime(3661), '1小时1分1秒');
        });

        it('should handle negative values', () => {
            assert.equal(U.formatTime(-5), '-5秒');
        });
    });

    describe('isInteger', () => {
        it('should return true for positive integer strings', () => {
            assert.equal(U.isInteger('42'), true);
            assert.equal(U.isInteger('100'), true);
            assert.equal(U.isInteger('1'), true);
        });

        it('should return false for non-integer strings', () => {
            assert.equal(U.isInteger('0'), false);
            assert.equal(U.isInteger('3.14'), false);
            assert.equal(U.isInteger('abc'), false);
            assert.equal(U.isInteger(''), false);
        });
    });

    describe('detectIPv6', () => {
        it('should detect IPv6 addresses', () => {
            assert.equal(U.detectIPv6('::1'), true);
            assert.equal(U.detectIPv6('2001:db8::1'), true);
        });

        it('should reject IPv4 addresses', () => {
            assert.equal(U.detectIPv6('127.0.0.1'), false);
            assert.equal(U.detectIPv6('192.168.1.1'), false);
        });
    });

    describe('cleanFormatting', () => {
        it('should remove Minecraft formatting codes', () => {
            assert.equal(U.cleanFormatting('§aHello§bWorld'), 'HelloWorld');
            assert.equal(U.cleanFormatting('§6§lBold'), 'Bold');
        });

        it('should return plain text unchanged', () => {
            assert.equal(U.cleanFormatting('Hello'), 'Hello');
        });
    });

    describe('ensureDir', () => {
        it('should create directory if not exists', () => {
            const testDir = path.join(__dirname, '..', '_testdata', 'ensure_test', 'sub');
            U.ensureDir(path.join(testDir, 'file.txt'));
            const fs = require('fs');
            assert.equal(fs.existsSync(testDir), true);
        });
    });
});
