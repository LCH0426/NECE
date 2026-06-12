/**
 * NECE 数据库模块测试
 */

const { test, assertEqual, assertTruthy, assertFalsy } = require('../test-framework');

console.log('\n--- database.js 测试 ---');

// 模拟 sql.js 环境
let db = null;

// 同步测试数据库操作
test('数据库基础操作', function() {
    try {
        const initSqlJs = require('sql.js');
        initSqlJs().then(SQL => {
            db = new SQL.Database();
            
            // 创建表
            db.run(`CREATE TABLE IF NOT EXISTS test (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                value INTEGER DEFAULT 0
            )`);
            
            // 插入数据
            db.run('INSERT INTO test (name, value) VALUES (?, ?)', ['test1', 100]);
            let result = db.exec('SELECT name, value FROM test WHERE id = 1');
            assertEqual(result[0].values[0][0], 'test1');
            assertEqual(result[0].values[0][1], 100);
            
            // 更新数据
            db.run('UPDATE test SET value = ? WHERE id = ?', [200, 1]);
            result = db.exec('SELECT value FROM test WHERE id = 1');
            assertEqual(result[0].values[0][0], 200);
            
            // 删除数据
            db.run('DELETE FROM test WHERE id = ?', [1]);
            result = db.exec('SELECT COUNT(*) FROM test');
            assertEqual(result[0].values[0][0], 0);
            
            console.log('    ✓ 数据库基础操作通过');
        });
    } catch (e) {
        console.log('    ○ sql.js 不可用，跳过数据库测试');
    }
});

test('JSON 字段处理', function() {
    if (!db) return;
    db.run(`CREATE TABLE IF NOT EXISTS json_test (
        id INTEGER PRIMARY KEY,
        data TEXT
    )`);
    const testData = { name: 'test', value: 123 };
    db.run('INSERT INTO json_test (data) VALUES (?)', [JSON.stringify(testData)]);
    const result = db.exec('SELECT data FROM json_test WHERE id = 1');
    const parsed = JSON.parse(result[0].values[0][0]);
    assertEqual(parsed.name, 'test');
    assertEqual(parsed.value, 123);
});

test('原子更新操作', function() {
    if (!db) return;
    db.run(`CREATE TABLE IF NOT EXISTS fund_test (
        id INTEGER PRIMARY KEY,
        fund INTEGER DEFAULT 1000
    )`);
    db.run('INSERT INTO fund_test (id, fund) VALUES (1, 1000)');
    
    // 原子扣减
    db.run('UPDATE fund_test SET fund = fund - ? WHERE id = ? AND fund >= ?', [500, 1, 500]);
    let result = db.exec('SELECT fund FROM fund_test WHERE id = 1');
    assertEqual(result[0].values[0][0], 500);
    
    // 余额不足时不应该扣减
    db.run('UPDATE fund_test SET fund = fund - ? WHERE id = ? AND fund >= ?', [600, 1, 600]);
    result = db.exec('SELECT fund FROM fund_test WHERE id = 1');
    assertEqual(result[0].values[0][0], 500); // 应该还是500
});

test('批量操作', function() {
    if (!db) return;
    db.run('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
        db.run('INSERT INTO test (name, value) VALUES (?, ?)', ['item' + i, i]);
    }
    db.run('COMMIT');
    const result = db.exec('SELECT COUNT(*) FROM test');
    assertEqual(result[0].values[0][0], 100);
});
