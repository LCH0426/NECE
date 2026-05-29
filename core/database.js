/**
 * Copyright (C) [2026] [LCH0426]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * NLCE SQLite数据库管理
 * 管理认证数据（用户/管理员/JWT令牌）和玩家数据（核心/设置/好友/消息/家园等）的SQL存储
 */


const initSqlJs = require('sql.js');
const fs = require('fs');
const pathModule = require('path');
const crypto = require('crypto');

/** 认证数据库路径 */
const DB_PATH = 'plugins/NLCE/data/nlce.db';
/** 玩家数据数据库路径 */
const PLAYER_DB_PATH = 'plugins/NLCE/data/playerdata.db';
/** 密码盐值长度（字节），输出为 hex 后长度翻倍 */
const SALT_LENGTH = 32;
/** PBKDF2 迭代次数 */
const HASH_ITERATIONS = 10000;
/** PBKDF2 哈希输出长度（字节） */
const HASH_LENGTH = 64;

let db = null;           // 认证数据库实例
let playerDb = null;     // 玩家数据库实例
let playerDbReady = false; // 玩家数据库是否初始化完成
let _debug = false;      // 数据库模块调试开关

/** 设置数据库模块调试模式 */
function setDebugMode(enabled) { _debug = !!enabled; }
/** 数据库专用调试日志，仅在 _debug 开启时输出 */
function dbDebugLog() {
    if (!_debug) return;
    const args = ['[DB]'];
    for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.info(args.join(' '));
}

function ensureDir(filePath) {
    const dir = pathModule.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** 初始化认证数据库（nlce.db），建表并创建索引，支持从已有文件恢复 */
async function initDatabase() {
    ensureDir(DB_PATH);

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
        uid TEXT PRIMARY KEY,
        added_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS captcha (
        captcha_id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        token_jti TEXT NOT NULL UNIQUE,
        family_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_uid ON refresh_tokens(uid)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti ON refresh_tokens(token_jti)`);

    db.run(`CREATE TABLE IF NOT EXISTS access_token_blacklist (
        jti TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON access_token_blacklist(expires_at)`);

    saveDatabase();
    return db;
}

/** 保存认证数据库到磁盘，保存前清理过期数据 */
function saveDatabase() {
    if (!db) return;
    try {
        cleanExpiredData();
        const data = db.export();
        const buffer = Buffer.from(data);
        ensureDir(DB_PATH);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
        logger.error('保存数据库失败:', e.message);
    }
}

let _authDbSaveTimer = null;
/** 防抖保存认证数据库，10秒内多次调用只触发一次实际写入 */
function requestSaveAuthDb() {
    if (_authDbSaveTimer) clearTimeout(_authDbSaveTimer);
    _authDbSaveTimer = setTimeout(function() {
        _authDbSaveTimer = null;
        saveDatabase();
    }, 10000);
}

/** 取消待执行的认证数据库防抖保存（用于关服前立即保存） */
function cancelPendingAuthSave() {
    if (_authDbSaveTimer) {
        clearTimeout(_authDbSaveTimer);
        _authDbSaveTimer = null;
    }
}

/** 清理过期的验证码（5分钟）、刷新令牌和黑名单条目 */
function cleanExpiredData() {
    if (!db) return;
    try {
        let now = Date.now();
        const captchaExpire = now - 5 * 60 * 1000;
        db.run('DELETE FROM captcha WHERE created_at < ?', [captchaExpire]);
        db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [now]);
        db.run('DELETE FROM access_token_blacklist WHERE expires_at < ?', [now]);
    } catch (e) {
        logger.error('清理过期数据失败:', e.message);
    }
}

/** 使用 PBKDF2-SHA512 对密码进行哈希 */
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_LENGTH, 'sha512').toString('hex');
}

/** 生成随机盐值（hex 编码） */
function generateSalt() {
    return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

/**
 * 设置用户密码（存在则更新，不存在则插入）
 * @param {string} uid - 用户 ID
 * @param {string} password - 明文密码
 * @returns {boolean} 始终返回 true
 */
function setPassword(uid, password) {
    const salt = generateSalt();
    const hash = hashPassword(password, salt);

    const existing = db.exec('SELECT uid FROM users WHERE uid = ?', [uid]);
    if (existing.length > 0 && existing[0].values.length > 0) {
        db.run('UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime(\'now\', \'localtime\') WHERE uid = ?', [hash, salt, uid]);
    } else {
        db.run('INSERT INTO users (uid, password_hash, salt) VALUES (?, ?, ?)', [uid, hash, salt]);
    }
    requestSaveAuthDb();
    return true;
}

/**
 * 验证用户密码是否正确
 * @param {string} uid - 用户 ID
 * @param {string} password - 待验证的明文密码
 * @returns {boolean} 密码是否匹配
 */
function verifyPassword(uid, password) {
    const result = db.exec('SELECT password_hash, salt FROM users WHERE uid = ?', [uid]);
    if (result.length === 0 || result[0].values.length === 0) return false;

    const storedHash = result[0].values[0][0];
    const salt = result[0].values[0][1];
    const hash = hashPassword(password, salt);
    return hash === storedHash;
}

/** 检查用户是否已设置密码 */
function hasPassword(uid) {
    const result = db.exec('SELECT uid FROM users WHERE uid = ?', [uid]);
    return result.length > 0 && result[0].values.length > 0;
}

/** 添加管理员，已存在则返回 false */
function addAdmin(uid) {
    const existing = db.exec('SELECT uid FROM admins WHERE uid = ?', [uid]);
    if (existing.length > 0 && existing[0].values.length > 0) return false;
    db.run('INSERT INTO admins (uid) VALUES (?)', [uid]);
    requestSaveAuthDb();
    return true;
}

/** 移除管理员，不存在则返回 false */
function removeAdmin(uid) {
    const existing = db.exec('SELECT uid FROM admins WHERE uid = ?', [uid]);
    if (existing.length === 0 || existing[0].values.length === 0) return false;
    db.run('DELETE FROM admins WHERE uid = ?', [uid]);
    requestSaveAuthDb();
    return true;
}

/** 检查用户是否为管理员 */
function isAdmin(uid) {
    const result = db.exec('SELECT uid FROM admins WHERE uid = ?', [uid]);
    return result.length > 0 && result[0].values.length > 0;
}

/** 获取所有管理员列表及其添加时间 */
function getAllAdmins() {
    const result = db.exec('SELECT uid, added_at FROM admins');
    if (result.length === 0) return [];
    return result[0].values.map(row => ({ uid: row[0], added_at: row[1] }));
}

/**
 * 生成验证码记录并返回唯一 ID
 * @param {string} code - 验证码文本
 * @returns {string} captchaId（hex 编码的 16 字节随机值）
 */
function generateCaptcha(code) {
    const captchaId = crypto.randomBytes(16).toString('hex');
    const createdAt = Date.now();

    db.run('INSERT INTO captcha (captcha_id, code, created_at) VALUES (?, ?, ?)', [captchaId, code, createdAt]);
    requestSaveAuthDb();
    return captchaId;
}

/**
 * 验证验证码（不区分大小写），验证后无论成功与否均删除记录
 * @param {string} captchaId - 验证码 ID
 * @param {string} input - 用户输入的验证码
 * @returns {boolean} 验证码是否匹配且未过期（5分钟有效期）
 */
function verifyCaptcha(captchaId, input) {
    const result = db.exec('SELECT code, created_at FROM captcha WHERE captcha_id = ?', [captchaId]);
    if (result.length === 0 || result[0].values.length === 0) return false;

    const code = result[0].values[0][0];
    const createdAt = result[0].values[0][1];

    if (Date.now() - createdAt > 5 * 60 * 1000) {
        db.run('DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
        requestSaveAuthDb();
        return false;
    }

    db.run('DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
    requestSaveAuthDb();

    return code.toLowerCase() === input.toLowerCase();
}

/** 清除所有过期（超过5分钟）的验证码记录 */
function cleanExpiredCaptchas() {
    const expireTime = Date.now() - 5 * 60 * 1000;
    db.run('DELETE FROM captcha WHERE created_at < ?', [expireTime]);
    requestSaveAuthDb();
}

/**
 * 保存刷新令牌记录
 * @param {string} uid - 用户 ID
 * @param {string} jti - 令牌唯一标识
 * @param {string} familyId - 令牌家族 ID（用于令牌轮换时批量吊销）
 * @param {number} expiresAt - 过期时间戳（毫秒）
 */
function saveRefreshToken(uid, jti, familyId, expiresAt) {
    let now = Date.now();
    db.run(
        'INSERT INTO refresh_tokens (uid, token_jti, family_id, created_at, expires_at, is_revoked) VALUES (?, ?, ?, ?, ?, 0)',
        [uid, jti, familyId, now, expiresAt]
    );
    requestSaveAuthDb();
}

/**
 * 根据 jti 查找刷新令牌
 * @param {string} jti - 令牌唯一标识
 * @returns {Object|null} 令牌对象或 null
 */
function findRefreshToken(jti) {
    let result = db.exec(
        'SELECT id, uid, token_jti, family_id, created_at, expires_at, is_revoked FROM refresh_tokens WHERE token_jti = ?',
        [jti]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;

    let row = result[0].values[0];
    return {
        id: row[0],
        uid: row[1],
        tokenJti: row[2],
        familyId: row[3],
        createdAt: row[4],
        expiresAt: row[5],
        isRevoked: row[6] === 1
    };
}

/** 吊销指定刷新令牌 */
function revokeRefreshToken(jti) {
    db.run('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_jti = ?', [jti]);
    requestSaveAuthDb();
}

/** 吊销同一家族下的所有刷新令牌（用于令牌轮换安全检测） */
function revokeFamilyTokens(familyId) {
    db.run('UPDATE refresh_tokens SET is_revoked = 1 WHERE family_id = ?', [familyId]);
    requestSaveAuthDb();
}

/** 吊销指定用户的所有刷新令牌 */
function revokeAllUserTokens(uid) {
    db.run('UPDATE refresh_tokens SET is_revoked = 1 WHERE uid = ?', [uid]);
    requestSaveAuthDb();
}

/** 删除已过期的刷新令牌记录 */
function cleanExpiredRefreshTokens() {
    let now = Date.now();
    db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [now]);
    requestSaveAuthDb();
}

/** 将访问令牌加入黑名单（用户登出时调用） */
function blacklistAccessToken(jti, expiresAt) {
    db.run(
        'INSERT OR IGNORE INTO access_token_blacklist (jti, expires_at) VALUES (?, ?)',
        [jti, expiresAt]
    );
    requestSaveAuthDb();
}

/** 检查访问令牌是否在黑名单中 */
function isAccessTokenBlacklisted(jti) {
    let result = db.exec('SELECT jti FROM access_token_blacklist WHERE jti = ?', [jti]);
    return result.length > 0 && result[0].values.length > 0;
}

/** 清除已过期的黑名单条目 */
function cleanExpiredBlacklist() {
    const now = Date.now();
    db.run('DELETE FROM access_token_blacklist WHERE expires_at < ?', [now]);
    requestSaveAuthDb();
}

// ===================== 玩家数据 SQL 方法 =====================

/** 初始化玩家数据库，启用 WAL 模式和 64MB 缓存以提升性能 */
async function initPlayerDatabase() {
    ensureDir(PLAYER_DB_PATH);
    const SQL = await initSqlJs();
    if (fs.existsSync(PLAYER_DB_PATH)) {
        const buffer = fs.readFileSync(PLAYER_DB_PATH);
        playerDb = new SQL.Database(buffer);
        dbDebugLog('initPlayerDatabase: 加载现有数据库, 大小=' + buffer.length + ' bytes');
    } else {
        playerDb = new SQL.Database();
        dbDebugLog('initPlayerDatabase: 创建新数据库');
    }
    playerDb.run("PRAGMA journal_mode=WAL");
    playerDb.run("PRAGMA synchronous=NORMAL");
    playerDb.run("PRAGMA cache_size=-64000");

    // 创建所有玩家数据表（IF NOT EXISTS 确保幂等）
    playerDb.run(`CREATE TABLE IF NOT EXISTS player_data (
        xuid TEXT PRIMARY KEY, uid INTEGER, name TEXT, uuid TEXT,
        register_time TEXT, leave_time TEXT, health_bonus INTEGER DEFAULT 0,
        rw TEXT, tax_data TEXT DEFAULT '{}', bank_data TEXT DEFAULT '{}',
        quick_menu TEXT DEFAULT '{}', vip_data TEXT DEFAULT '{}',
        avatar TEXT DEFAULT '{}', count TEXT DEFAULT '{}',
        last_ip TEXT DEFAULT '', platform TEXT DEFAULT ''
    )`);
    // 兼容已有数据库：添加缺失列（已存在则忽略）
    try { playerDb.run("ALTER TABLE player_data ADD COLUMN last_ip TEXT DEFAULT ''"); } catch (e) {}
    try { playerDb.run("ALTER TABLE player_data ADD COLUMN platform TEXT DEFAULT ''"); } catch (e) {}
    playerDb.run('CREATE TABLE IF NOT EXISTS player_settings (xuid TEXT, key TEXT, value TEXT, PRIMARY KEY (xuid, key))');
    playerDb.run('CREATE TABLE IF NOT EXISTS death_points (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, data TEXT)');
    playerDb.run('CREATE TABLE IF NOT EXISTS friends (xuid TEXT, friend_xuid TEXT, friend_name TEXT, add_time TEXT, PRIMARY KEY (xuid, friend_xuid))');
    playerDb.run('CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, from_xuid TEXT, from_name TEXT, message TEXT, time TEXT, handled INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0)');
    playerDb.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, from_xuid TEXT, from_name TEXT, to_xuid TEXT, to_name TEXT, content TEXT, time TEXT, is_read INTEGER DEFAULT 0)');
    playerDb.run('CREATE TABLE IF NOT EXISTS homes (xuid TEXT, name TEXT, x REAL, y REAL, z REAL, dim INTEGER, last_use TEXT, PRIMARY KEY (xuid, name))');
    playerDb.run('CREATE TABLE IF NOT EXISTS player_inventory (xuid TEXT PRIMARY KEY, items TEXT DEFAULT \'[]\', armor TEXT DEFAULT \'[]\', offhand TEXT DEFAULT \'[]\', save_time TEXT)');
    try { playerDb.run('ALTER TABLE player_inventory ADD COLUMN armor TEXT DEFAULT \'[]\''); } catch (e) {}
    try { playerDb.run('ALTER TABLE player_inventory ADD COLUMN offhand TEXT DEFAULT \'[]\''); } catch (e) {}

    // 公会系统表
    createGuildTables();

    playerDbReady = true;
    dbDebugLog('initPlayerDatabase: 数据库就绪');
    _playerDbDirty = true;
    savePlayerDatabase();
    return playerDb;
}

/** 检查玩家数据库是否已初始化可用 */
function isPlayerDbReady() {
    return playerDbReady && playerDb !== null;
}

let _playerDbDirty = false;

/** 标记玩家数据库有未写入磁盘的变更 */
function markPlayerDbDirty() {
    _playerDbDirty = true;
}

/** 将玩家数据库内存内容导出并写入磁盘文件，未脏则跳过 */
function savePlayerDatabase() {
    if (!playerDb) return;
    if (!_playerDbDirty) {
        dbDebugLog('savePlayerDatabase: 数据未变更，跳过导出');
        return;
    }
    try {
        const data = playerDb.export();
        dbDebugLog('savePlayerDatabase: 导出并保存数据库');
        const buffer = Buffer.from(data);
        ensureDir(PLAYER_DB_PATH);
        fs.writeFileSync(PLAYER_DB_PATH, buffer);
        _playerDbDirty = false;
    } catch (e) {
        logger.error('[PlayerDB] 保存失败:', e.message);
    }
}

let _playerDbSaveTimer = null;
/** 防抖保存玩家数据库，30秒内多次调用只触发一次写盘 */
function requestSavePlayerDb() {
    if (_playerDbSaveTimer) clearTimeout(_playerDbSaveTimer);
    _playerDbSaveTimer = setTimeout(function() {
        _playerDbSaveTimer = null;
        savePlayerDatabase();
    }, 30000);
}

/** 取消待执行的玩家数据库防抖保存 */
function cancelPendingSave() {
    if (_playerDbSaveTimer) {
        clearTimeout(_playerDbSaveTimer);
        _playerDbSaveTimer = null;
    }
}

// --- 玩家核心数据 ---

/**
 * 根据 XUID 获取玩家核心数据，JSON 字段自动解析
 * @param {string} xuid - 玩家 XUID
 * @returns {Object|null} 玩家数据对象，不存在返回 null
 */
function getPlayerDataSQL(xuid) {
    if (!playerDb) return null;
    let result = playerDb.exec(
        'SELECT uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, last_ip, platform FROM player_data WHERE xuid = ?',
        [xuid]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    const row = result[0].values[0];
    return {
        uid: row[0],
        name: row[1],
        uuid: row[2],
        registerTime: row[3],
        leavetime: row[4],
        healthBonus: row[5],
        rw: row[6],
        taxdata: JSON.parse(row[7] || '{}'),
        bankdata: JSON.parse(row[8] || '{}'),
        quickmenu: JSON.parse(row[9] || '{}'),
        vipdata: JSON.parse(row[10] || '{}'),
        avatar: JSON.parse(row[11] || '{}'),
        count: JSON.parse(row[12] || '{}'),
        lastIp: row[13] || '',
        platform: row[14] || ''
    };
}

/**
 * 插入或替换玩家核心数据（INSERT OR REPLACE 语义）
 * @param {string} xuid - 玩家 XUID
 * @param {Object} data - 玩家数据对象，JSON 字段自动序列化
 */
function setPlayerDataSQL(xuid, data) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run(
        `INSERT OR REPLACE INTO player_data
         (xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, last_ip, platform)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [xuid, data.uid, data.name, data.uuid, data.registerTime,
         String(data.leavetime || ''), data.healthBonus || 0, data.rw,
         JSON.stringify(data.taxdata || {}), JSON.stringify(data.bankdata || {}),
         JSON.stringify(data.quickmenu || {}), JSON.stringify(data.vipdata || {}),
         JSON.stringify(data.avatar || {}), JSON.stringify(data.count || {}),
         data.lastIp || '', data.platform || '']
    );
}

/** 获取所有玩家核心数据，返回 { xuid: data } 映射 */
function getAllPlayerDataSQL() {
    if (!playerDb) return {};
    dbDebugLog('getAllPlayerDataSQL: 查询所有玩家数据');
    let result = playerDb.exec(
        'SELECT xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, last_ip, platform FROM player_data'
    );
    const players = {};
    if (result.length === 0) return players;
    const cols = result[0].columns;
    result[0].values.forEach(function(row) {
        const obj = {};
        for (let i = 1; i < cols.length; i++) {
            obj[cols[i]] = row[i];
        }
        players[row[0]] = {
            uid: obj.uid,
            name: obj.name,
            uuid: obj.uuid,
            registerTime: obj.register_time,
            leavetime: obj.leave_time,
            healthBonus: obj.health_bonus,
            rw: obj.rw,
            taxdata: JSON.parse(obj.tax_data || '{}'),
            bankdata: JSON.parse(obj.bank_data || '{}'),
            quickmenu: JSON.parse(obj.quick_menu || '{}'),
            vipdata: JSON.parse(obj.vip_data || '{}'),
            avatar: JSON.parse(obj.avatar || '{}'),
            count: JSON.parse(obj.count || '{}'),
            lastIp: obj.last_ip || '',
            platform: obj.platform || ''
        };
    });
    return players;
}

/** 获取下一个可用的玩家 UID（自增逻辑，起始值 10000） */
function getNextUidSQL() {
    if (!playerDb) return 10000;
    let result = playerDb.exec('SELECT MAX(uid) FROM player_data');
    if (result.length === 0 || result[0].values.length === 0 || result[0].values[0][0] === null) return 10000;
    return (result[0].values[0][0] || 10000) + 1;
}

// --- 玩家设置 ---

/** 获取指定玩家的所有设置项，值自动 JSON 解析 */
function getPlayerSettingsSQL(xuid) {
    if (!playerDb) return {};
    let result = playerDb.exec('SELECT key, value FROM player_settings WHERE xuid = ?', [xuid]);
    const settings = {};
    if (result.length === 0) return settings;
    result[0].values.forEach(function(row) {
        try { settings[row[0]] = JSON.parse(row[1]); }
        catch (e) { settings[row[0]] = row[1]; }
    });
    return settings;
}

/** 获取所有玩家的设置，返回 { xuid: { key: value } } 映射 */
function getAllPlayerSettingsSQL() {
    if (!playerDb) return {};
    let result = playerDb.exec('SELECT xuid, key, value FROM player_settings');
    let all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        if (!all[row[0]]) all[row[0]] = {};
        try { all[row[0]][row[1]] = JSON.parse(row[2]); }
        catch (e) { all[row[0]][row[1]] = row[2]; }
    });
    return all;
}

/** 设置玩家单项设置，值自动 JSON 序列化 */
function setPlayerSettingSQL(xuid, key, value) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run(
        'INSERT OR REPLACE INTO player_settings (xuid, key, value) VALUES (?, ?, ?)',
        [xuid, key, JSON.stringify(value)]
    );
}

// --- 死亡点 ---

/** 获取玩家的所有死亡点记录（按 ID 排序） */
function getDeathPointsSQL(xuid) {
    if (!playerDb) return [];
    let result = playerDb.exec('SELECT data FROM death_points WHERE xuid = ? ORDER BY id', [xuid]);
    if (result.length === 0) return [];
    return result[0].values.map(function(row) { return JSON.parse(row[0]); });
}

/** 获取所有玩家的死亡点数据，返回 { xuid: [points] } 映射 */
function getAllDeathPointsSQL() {
    if (!playerDb) return {};
    let result = playerDb.exec('SELECT xuid, data FROM death_points ORDER BY id');
    let all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        if (!all[row[0]]) all[row[0]] = [];
        all[row[0]].push(JSON.parse(row[1]));
    });
    return all;
}

/** 设置玩家死亡点（先删后插，使用 prepared statement 批量写入） */
function setDeathPointsSQL(xuid, points) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM death_points WHERE xuid = ?', [xuid]);
    if (points && points.length > 0) {
        let stmt = playerDb.prepare('INSERT INTO death_points (xuid, data) VALUES (?, ?)');
        points.forEach(function(p) {
            stmt.run([xuid, JSON.stringify(p)]);
        });
        stmt.free();
    }
}

// --- 好友 ---

/** 获取玩家的好友列表、收到的好友请求和发出的好友请求 */
function getFriendsSQL(xuid) {
    if (!playerDb) return { friends: [], requests: [], sentRequests: [] };
    let friends = [];
    const fr = playerDb.exec('SELECT friend_xuid, friend_name, add_time FROM friends WHERE xuid = ?', [xuid]);
    if (fr.length > 0) {
        friends = fr[0].values.map(function(r) { return { xuid: r[0], name: r[1], addTime: r[2] }; });
    }
    let requests = [];
    const req = playerDb.exec('SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 0', [xuid]);
    if (req.length > 0) {
        requests = req[0].values.map(function(r) {
            return { xuid: r[0], name: r[1], message: r[2], time: r[3], handled: r[4] === 1, rejected: r[5] === 1 };
        });
    }
    let sentRequests = [];
    const sent = playerDb.exec('SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 1', [xuid]);
    if (sent.length > 0) {
        sentRequests = sent[0].values.map(function(r) {
            return { xuid: r[0], name: r[1], message: r[2], time: r[3], handled: r[4] === 1, rejected: r[5] === 1 };
        });
    }
    return { friends: friends, requests: requests, sentRequests: sentRequests };
}

/** 获取所有有好友或好友请求的玩家数据 */
function getAllFriendsSQL() {
    if (!playerDb) return {};
    let result = playerDb.exec('SELECT DISTINCT xuid FROM friends UNION SELECT DISTINCT xuid FROM friend_requests');
    let all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        all[row[0]] = getFriendsSQL(row[0]);
    });
    return all;
}

/** 添加好友关系（INSERT OR REPLACE 防重复） */
function addFriendSQL(xuid, friendXuid, friendName, addTime) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('INSERT OR REPLACE INTO friends (xuid, friend_xuid, friend_name, add_time) VALUES (?, ?, ?, ?)',
        [xuid, friendXuid, friendName, addTime]);
}

/** 删除单向好友关系 */
function removeFriendSQL(xuid, friendXuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM friends WHERE xuid = ? AND friend_xuid = ?', [xuid, friendXuid]);
}

/**
 * 添加好友请求记录
 * @param {string} xuid - 接收方 XUID
 * @param {string} fromXuid - 发送方 XUID
 * @param {boolean} isSent - 是否为发出的请求（用于区分收/发方向）
 */
function addFriendRequestSQL(xuid, fromXuid, fromName, message, time, isSent) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('INSERT INTO friend_requests (xuid, from_xuid, from_name, message, time, handled, rejected, is_sent) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
        [xuid, fromXuid, fromName, message, time, isSent ? 1 : 0]);
}

/** 标记好友请求为已处理（接受或拒绝） */
function handleFriendRequestSQL(xuid, fromXuid, rejected) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('UPDATE friend_requests SET handled = 1, rejected = ? WHERE xuid = ? AND from_xuid = ? AND handled = 0',
        [rejected ? 1 : 0, xuid, fromXuid]);
}

/** 清空玩家的所有好友关系 */
function clearFriendsSQL(xuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM friends WHERE xuid = ?', [xuid]);
}

/** 清空玩家的所有好友请求 */
function clearFriendRequestsSQL(xuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM friend_requests WHERE xuid = ?', [xuid]);
}

// --- 私信消息 ---

/** 获取玩家的私信记录（按 ID 排序） */
function getMessagesSQL(xuid) {
    if (!playerDb) return [];
    let result = playerDb.exec('SELECT from_xuid, from_name, to_xuid, to_name, content, time, is_read FROM messages WHERE xuid = ? ORDER BY id', [xuid]);
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return { fromXuid: r[0], fromName: r[1], toXuid: r[2], toName: r[3], content: r[4], time: r[5], read: r[6] === 1 };
    });
}

/** 获取所有有私信记录的玩家数据 */
function getAllMessagesSQL() {
    if (!playerDb) return {};
    let result = playerDb.exec('SELECT DISTINCT xuid FROM messages');
    let all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        all[row[0]] = { messages: getMessagesSQL(row[0]) };
    });
    return all;
}

/** 添加一条私信记录 */
function addMessageSQL(xuid, msg) {
    if (!playerDb || !msg) return;
    markPlayerDbDirty();
    playerDb.run(
        'INSERT INTO messages (xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [xuid, msg.fromXuid || '', msg.fromName || '', msg.toXuid || '', msg.toName || '', msg.content || '', msg.time || '', msg.read ? 1 : 0]
    );
}

/** 将指定发送者的未读消息标记为已读 */
function markMessagesReadSQL(xuid, fromXuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('UPDATE messages SET is_read = 1 WHERE xuid = ? AND from_xuid = ? AND is_read = 0', [xuid, fromXuid]);
}

/** 删除指定的一条私信 */
function deleteMessageSQL(xuid, fromXuid, time) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM messages WHERE xuid = ? AND from_xuid = ? AND time = ?', [xuid, fromXuid, time]);
}

/** 清空玩家的所有私信记录 */
function clearMessagesSQL(xuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM messages WHERE xuid = ?', [xuid]);
}

// --- 家园传送点 ---

/** 获取玩家的所有家园传送点 */
function getHomesSQL(xuid) {
    if (!playerDb) return [];
    let result = playerDb.exec('SELECT name, x, y, z, dim, last_use FROM homes WHERE xuid = ?', [xuid]);
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return { name: r[0], x: r[1], y: r[2], z: r[3], dim: r[4], lastUse: r[5] };
    });
}

/** 获取所有有家园传送点的玩家数据 */
function getAllHomesSQL() {
    if (!playerDb) return {};
    let result = playerDb.exec('SELECT DISTINCT xuid FROM homes');
    let all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        all[row[0]] = getHomesSQL(row[0]);
    });
    return all;
}

/** 设置玩家所有家园传送点（先删后插，使用 prepared statement） */
function setHomesSQL(xuid, homes) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM homes WHERE xuid = ?', [xuid]);
    if (homes && homes.length > 0) {
        const stmt = playerDb.prepare('INSERT INTO homes (xuid, name, x, y, z, dim, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)');
        homes.forEach(function(h) {
            stmt.run([xuid, h.name, h.x, h.y, h.z, h.dim || 0, h.lastUse || 0]);
        });
        stmt.free();
    }
}

/** 新增单个家园传送点 */
function addHomeSQL(xuid, home) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('INSERT INTO homes (xuid, name, x, y, z, dim, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [xuid, home.name, home.x, home.y, home.z, home.dim || 0, home.lastUse || 0]);
}

/** 删除指定名称的家园传送点 */
function removeHomeSQL(xuid, name) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM homes WHERE xuid = ? AND name = ?', [xuid, name]);
}

/** 更新已有家园传送点的坐标、维度等信息 */
function updateHomeSQL(xuid, name, home) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('UPDATE homes SET x = ?, y = ?, z = ?, dim = ?, last_use = ? WHERE xuid = ? AND name = ?',
        [home.x, home.y, home.z, home.dim || 0, home.lastUse || 0, xuid, name]);
}

/**
 * 保存玩家背包快照到数据库
 * @param {string} xuid - 玩家 XUID
 * @param {Array} items - 物品数组 [{slot, type, count, name}]
 * @param {Array} armor - 装备数组 [{slot, type, count, name}]
 * @param {Array} offhand - 副手数组 [{slot, type, count, name}]
 */
function savePlayerInventorySQL(xuid, items, armor, offhand) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('INSERT OR REPLACE INTO player_inventory (xuid, items, armor, offhand, save_time) VALUES (?, ?, ?, ?, ?)',
        [xuid, JSON.stringify(items || []), JSON.stringify(armor || []), JSON.stringify(offhand || []), String(Date.now())]);
}

/**
 * 获取玩家背包快照
 * @param {string} xuid - 玩家 XUID
 * @returns {{ items: Array, armor: Array, offhand: Array, saveTime: string }|null}
 */
function getPlayerInventorySQL(xuid) {
    if (!playerDb) return null;
    let result = playerDb.exec('SELECT items, armor, offhand, save_time FROM player_inventory WHERE xuid = ?', [xuid]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const row = result[0].values[0];
    return {
        items: JSON.parse(row[0] || '[]'),
        armor: JSON.parse(row[1] || '[]'),
        offhand: JSON.parse(row[2] || '[]'),
        saveTime: row[3]
    };
}

// ===================== 公会系统 SQL 方法 =====================

/** 创建公会相关三张表（guilds / guild_members / guild_teleports） */
function createGuildTables() {
    if (!playerDb) return;
    playerDb.run(`CREATE TABLE IF NOT EXISTS guilds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        owner TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        fund REAL DEFAULT 0,
        max_members INTEGER DEFAULT 20,
        hq_x REAL, hq_y REAL, hq_z REAL, hq_dim TEXT,
        created_at INTEGER NOT NULL
    )`);
    playerDb.run(`CREATE TABLE IF NOT EXISTS guild_members (
        xuid TEXT NOT NULL,
        guild_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (xuid),
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
    )`);
    playerDb.run(`CREATE TABLE IF NOT EXISTS guild_teleports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
        dim TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
    )`);
    dbDebugLog('createGuildTables: 公会表创建完成');
}

/** 创建公会，返回新公会的 ID */
function createGuild(name, description, owner, maxMembers) {
    if (!playerDb) return null;
    markPlayerDbDirty();
    const now = Date.now();
    playerDb.run(
        'INSERT INTO guilds (name, description, owner, max_members, created_at) VALUES (?, ?, ?, ?, ?)',
        [name, description || '', owner, maxMembers || 20, now]
    );
    const result = playerDb.exec('SELECT last_insert_rowid()');
    const guildId = result[0].values[0][0];
    // 自动把会长加入成员表
    playerDb.run(
        'INSERT INTO guild_members (xuid, guild_id, role, joined_at) VALUES (?, ?, ?, ?)',
        [owner, guildId, 'owner', now]
    );
    return guildId;
}

/** 根据 ID 获取公会信息 */
function getGuild(guildId) {
    if (!playerDb) return null;
    const result = playerDb.exec(
        'SELECT id, name, description, owner, level, fund, max_members, hq_x, hq_y, hq_z, hq_dim, created_at FROM guilds WHERE id = ?',
        [guildId]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = result[0].values[0];
    return {
        id: r[0], name: r[1], description: r[2], owner: r[3],
        level: r[4], fund: r[5], maxMembers: r[6],
        hqX: r[7], hqY: r[8], hqZ: r[9], hqDim: r[10],
        createdAt: r[11]
    };
}

/** 根据公会名获取公会信息 */
function getGuildByName(name) {
    if (!playerDb) return null;
    const result = playerDb.exec(
        'SELECT id, name, description, owner, level, fund, max_members, hq_x, hq_y, hq_z, hq_dim, created_at FROM guilds WHERE name = ?',
        [name]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = result[0].values[0];
    return {
        id: r[0], name: r[1], description: r[2], owner: r[3],
        level: r[4], fund: r[5], maxMembers: r[6],
        hqX: r[7], hqY: r[8], hqZ: r[9], hqDim: r[10],
        createdAt: r[11]
    };
}

/** 根据玩家 XUID 获取其所在公会信息（单公会制） */
function getGuildByPlayer(xuid) {
    if (!playerDb) return null;
    const result = playerDb.exec(
        `SELECT g.id, g.name, g.description, g.owner, g.level, g.fund, g.max_members,
                g.hq_x, g.hq_y, g.hq_z, g.hq_dim, g.created_at
         FROM guilds g INNER JOIN guild_members gm ON g.id = gm.guild_id WHERE gm.xuid = ?`,
        [xuid]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = result[0].values[0];
    return {
        id: r[0], name: r[1], description: r[2], owner: r[3],
        level: r[4], fund: r[5], maxMembers: r[6],
        hqX: r[7], hqY: r[8], hqZ: r[9], hqDim: r[10],
        createdAt: r[11]
    };
}

/** 获取所有公会列表 */
function getAllGuilds() {
    if (!playerDb) return [];
    const result = playerDb.exec(
        'SELECT id, name, description, owner, level, fund, max_members, hq_x, hq_y, hq_z, hq_dim, created_at FROM guilds ORDER BY id'
    );
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return {
            id: r[0], name: r[1], description: r[2], owner: r[3],
            level: r[4], fund: r[5], maxMembers: r[6],
            hqX: r[7], hqY: r[8], hqZ: r[9], hqDim: r[10],
            createdAt: r[11]
        };
    });
}

/** 删除公会（CASCADE 自动清理成员和传送点） */
function deleteGuild(guildId) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM guild_teleports WHERE guild_id = ?', [guildId]);
    playerDb.run('DELETE FROM guild_members WHERE guild_id = ?', [guildId]);
    playerDb.run('DELETE FROM guilds WHERE id = ?', [guildId]);
}

/** 更新公会字段（动态拼接 SET 子句） */
function updateGuild(guildId, fields) {
    if (!playerDb || !fields) return;
    markPlayerDbDirty();
    var sets = [];
    var vals = [];
    var fieldMap = {
        name: 'name', description: 'description', owner: 'owner',
        level: 'level', fund: 'fund', maxMembers: 'max_members',
        hqX: 'hq_x', hqY: 'hq_y', hqZ: 'hq_z', hqDim: 'hq_dim'
    };
    for (var key in fields) {
        if (fields.hasOwnProperty(key) && fieldMap[key]) {
            sets.push(fieldMap[key] + ' = ?');
            vals.push(fields[key]);
        }
    }
    if (sets.length === 0) return;
    vals.push(guildId);
    playerDb.run('UPDATE guilds SET ' + sets.join(', ') + ' WHERE id = ?', vals);
}

/** 添加公会成员（INSERT OR REPLACE，单公会制下 xuid 是主键） */
function addGuildMember(xuid, guildId, role) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run(
        'INSERT OR REPLACE INTO guild_members (xuid, guild_id, role, joined_at) VALUES (?, ?, ?, ?)',
        [xuid, guildId, role || 'member', Date.now()]
    );
}

/** 移除公会成员 */
function removeGuildMember(xuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM guild_members WHERE xuid = ?', [xuid]);
}

/** 获取公会所有成员信息（含玩家名，从 player_data 关联） */
function getGuildMembers(guildId) {
    if (!playerDb) return [];
    const result = playerDb.exec(
        `SELECT gm.xuid, gm.role, gm.joined_at, pd.name
         FROM guild_members gm LEFT JOIN player_data pd ON gm.xuid = pd.xuid
         WHERE gm.guild_id = ? ORDER BY gm.joined_at`,
        [guildId]
    );
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return { xuid: r[0], role: r[1], joinedAt: r[2], name: r[3] || r[0] };
    });
}

/** 获取公会成员数量 */
function getMemberCount(guildId) {
    if (!playerDb) return 0;
    const result = playerDb.exec('SELECT COUNT(*) FROM guild_members WHERE guild_id = ?', [guildId]);
    if (result.length === 0) return 0;
    return result[0].values[0][0];
}

/** 获取玩家在公会中的角色 */
function getMemberRole(xuid) {
    if (!playerDb) return null;
    const result = playerDb.exec('SELECT role FROM guild_members WHERE xuid = ?', [xuid]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return result[0].values[0][0];
}

/** 更新成员角色 */
function updateMemberRole(xuid, role) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('UPDATE guild_members SET role = ? WHERE xuid = ?', [role, xuid]);
}

/** 添加公会传送点 */
function addGuildTeleport(guildId, name, x, y, z, dim, createdBy) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run(
        'INSERT INTO guild_teleports (guild_id, name, x, y, z, dim, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [guildId, name, x, y, z, dim, createdBy, Date.now()]
    );
}

/** 删除公会传送点 */
function removeGuildTeleport(tpId, guildId) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('DELETE FROM guild_teleports WHERE id = ? AND guild_id = ?', [tpId, guildId]);
}

/** 获取公会所有传送点 */
function getGuildTeleports(guildId) {
    if (!playerDb) return [];
    const result = playerDb.exec(
        'SELECT id, name, x, y, z, dim, created_by, created_at FROM guild_teleports WHERE guild_id = ? ORDER BY id',
        [guildId]
    );
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return { id: r[0], name: r[1], x: r[2], y: r[3], z: r[4], dim: r[5], createdBy: r[6], createdAt: r[7] };
    });
}

/** 获取公会传送点数量 */
function getGuildTeleportCount(guildId) {
    if (!playerDb) return 0;
    const result = playerDb.exec('SELECT COUNT(*) FROM guild_teleports WHERE guild_id = ?', [guildId]);
    if (result.length === 0) return 0;
    return result[0].values[0][0];
}

/** 根据名称查找公会传送点 */
function getGuildTeleportByName(guildId, name) {
    if (!playerDb) return null;
    const result = playerDb.exec(
        'SELECT id, name, x, y, z, dim, created_by, created_at FROM guild_teleports WHERE guild_id = ? AND name = ?',
        [guildId, name]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = result[0].values[0];
    return { id: r[0], name: r[1], x: r[2], y: r[3], z: r[4], dim: r[5], createdBy: r[6], createdAt: r[7] };
}

// --- 批量保存优化 ---

/**
 * 在事务中批量执行玩家数据写入操作，任一失败则整体回滚
 * @param {Function[]} operations - 需要执行的写入函数数组
 */
function batchSavePlayerDb(operations) {
    if (!playerDb) return;
    markPlayerDbDirty();
    playerDb.run('BEGIN TRANSACTION');
    try {
        operations.forEach(function(op) { op(); });
        playerDb.run('COMMIT');
    } catch (e) {
        playerDb.run('ROLLBACK');
        logger.error('[PlayerDB] 批量操作失败:', e.message);
    }
}

// --- 通用SQL DataManager 辅助方法 ---

/**
 * 通用查询：获取某模块（dm_ 前缀表）的所有玩家数据
 * @param {string} prefix - 模块名前缀，对应表名 dm_{prefix}
 * @returns {Object} { xuid: parsedData } 映射
 */
function sqlGetAll(prefix) {
    if (!playerDb) return {};
    let table = 'dm_' + prefix;
    try {
        const result = playerDb.exec('SELECT xuid, data FROM ' + table);
        const all = {};
        if (result.length === 0) return all;
        result[0].values.forEach(function(row) {
            try { all[row[0]] = JSON.parse(row[1]); }
            catch (e) { all[row[0]] = {}; }
        });
        return all;
    } catch (e) {
        return {};
    }
}

/** 通用写入：设置某模块的玩家数据（INSERT OR REPLACE） */
function sqlSet(prefix, xuid, data) {
    if (!playerDb) return;
    markPlayerDbDirty();
    let table = 'dm_' + prefix;
    playerDb.run('INSERT OR REPLACE INTO ' + table + ' (xuid, data) VALUES (?, ?)',
        [xuid, JSON.stringify(data)]);
}

/** 通用删除：删除某模块的指定玩家数据 */
function sqlDelete(prefix, xuid) {
    if (!playerDb) return;
    markPlayerDbDirty();
    let table = 'dm_' + prefix;
    playerDb.run('DELETE FROM ' + table + ' WHERE xuid = ?', [xuid]);
}

/** 确保某模块的 dm_ 前缀表已创建 */
function sqlEnsureTable(prefix) {
    if (!playerDb) return;
    const table = 'dm_' + prefix;
    playerDb.run('CREATE TABLE IF NOT EXISTS ' + table + ' (xuid TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT "{}")');
}

module.exports = {
    initDatabase,
    saveDatabase,
    requestSaveAuthDb,
    cancelPendingAuthSave,
    setPassword,
    verifyPassword,
    hasPassword,
    addAdmin,
    removeAdmin,
    isAdmin,
    getAllAdmins,
    generateCaptcha,
    verifyCaptcha,
    cleanExpiredCaptchas,
    saveRefreshToken,
    findRefreshToken,
    revokeRefreshToken,
    revokeFamilyTokens,
    revokeAllUserTokens,
    cleanExpiredRefreshTokens,
    blacklistAccessToken,
    isAccessTokenBlacklisted,
    cleanExpiredBlacklist,
    // 玩家数据SQL
    initPlayerDatabase,
    isPlayerDbReady,
    savePlayerDatabase,
    markPlayerDbDirty,
    requestSavePlayerDb,
    cancelPendingSave,
    getPlayerDataSQL,
    setPlayerDataSQL,
    getAllPlayerDataSQL,
    getNextUidSQL,
    getPlayerSettingsSQL,
    getAllPlayerSettingsSQL,
    setPlayerSettingSQL,
    getDeathPointsSQL,
    getAllDeathPointsSQL,
    setDeathPointsSQL,
    getFriendsSQL,
    getAllFriendsSQL,
    addFriendSQL,
    removeFriendSQL,
    addFriendRequestSQL,
    handleFriendRequestSQL,
    clearFriendsSQL,
    clearFriendRequestsSQL,
    getMessagesSQL,
    getAllMessagesSQL,
    addMessageSQL,
    markMessagesReadSQL,
    deleteMessageSQL,
    clearMessagesSQL,
    getHomesSQL,
    getAllHomesSQL,
    setHomesSQL,
    addHomeSQL,
    removeHomeSQL,
    updateHomeSQL,
    batchSavePlayerDb,
    savePlayerInventorySQL,
    getPlayerInventorySQL,
    // 公会系统SQL
    createGuildTables,
    createGuild,
    getGuild,
    getGuildByName,
    getGuildByPlayer,
    getAllGuilds,
    deleteGuild,
    updateGuild,
    addGuildMember,
    removeGuildMember,
    getGuildMembers,
    getMemberCount,
    getMemberRole,
    updateMemberRole,
    addGuildTeleport,
    removeGuildTeleport,
    getGuildTeleports,
    getGuildTeleportCount,
    getGuildTeleportByName,
    // 通用SQL辅助
    sqlGetAll,
    sqlSet,
    sqlDelete,
    sqlEnsureTable,
    // Debug
    setDebugMode
};
