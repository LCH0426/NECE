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
 * NECE SQLite数据库管理
 * 认证数据和玩家数据的SQL存储
 */


const fs = require('fs');
const pathModule = require('path');
const crypto = require('crypto');
const { ensureDir } = require('./utils');

/** 认证数据库路径 */
const DB_PATH = 'plugins/NECE/data/nece.db';
/** 玩家数据数据库路径 */
const PLAYER_DB_PATH = 'plugins/NECE/data/playerdata.db';
/** 密码盐值长度 */
const SALT_LENGTH = 32;
/** PBKDF2 迭代次数 */
const HASH_ITERATIONS = 10000;
/** PBKDF2 哈希输出长度 */
const HASH_LENGTH = 64;

let db = null;           // 认证数据库实例 (DBSession)
let playerDb = null;     // 玩家数据库实例 (DBSession)
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

/**
 * 转义SQL字符串值（单引号转义 + 反斜杠转义）
 */
function sqlEscape(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') {
        if (!isFinite(val)) return 'NULL';
        return String(val);
    }
    if (typeof val === 'boolean') return val ? '1' : '0';
    var str = String(val);
    // 转义反斜杠和单引号，防止SQL注入
    str = str.replace(/\\/g, '\\\\').replace(/'/g, "''");
    return "'" + str + "'";
}

/**
 * 执行带参数的SQL（INSERT/UPDATE/DELETE），替换 ? 占位符后通过 session.exec 执行
 * @param {DBSession} session - 数据库会话
 * @param {string} sql - SQL语句（用 ? 占位符）
 * @param {Array} params - 参数数组
 * @returns {Object|null} 成功返回 {}，失败返回 null
 */
function run(session, sql, params) {
    if (!session) return null;
    try {
        var finalSql;
        if (params && params.length > 0) {
            // 验证占位符数量与参数数量匹配
            var placeholderCount = (sql.match(/\?/g) || []).length;
            if (placeholderCount !== params.length) {
                logger.error('[DB] SQL参数数量不匹配: 占位符' + placeholderCount + '个, 参数' + params.length + '个 | SQL: ' + sql.substring(0, 100));
                return null;
            }
            var idx = 0;
            finalSql = sql.replace(/\?/g, function() { return sqlEscape(params[idx++]); });
        } else {
            finalSql = sql;
        }
        if (_debug && sql.indexOf('player_data') === -1 && sql.indexOf('DELETE FROM captcha') === -1 && sql.indexOf('DELETE FROM refresh_tokens') === -1 && sql.indexOf('DELETE FROM access_token_blacklist') === -1) dbDebugLog('run:', finalSql.substring(0, 200));
        session.exec(finalSql);
        return {};
    } catch (e) {
        logger.error('[DB] SQL执行失败: ' + e.message + ' | SQL: ' + sql.substring(0, 100));
        return null;
    }
}

/**
 * 带参数查询，返回 [{col: val}, ...] 对象数组
 * @param {DBSession} session - 数据库会话
 * @param {string} sql - SELECT语句
 * @param {Array} params - 参数数组
 * @returns {Array<Object>} 结果行数组
 */
function query(session, sql, params) {
    if (!session) return [];
    try {
        var stmt = session.prepare(sql);
        if (params && params.length > 0) stmt.bind(params);
        stmt.execute();
        var results = [];
        do {
            var row = stmt.fetch();
            // LLSE 的 fetch() 在无结果时可能返回空对象 {}，需检查是否有实际数据
            if (row && Object.keys(row).length > 0) results.push(row);
        } while (stmt.step());
        if (_debug) dbDebugLog('query:', sql.substring(0, 100), '→', results.length, 'rows');
        return results;
    } catch (e) {
        logger.error('[DB] SQL查询失败: ' + e.message + ' | SQL: ' + sql.substring(0, 100));
        return [];
    }
}

/**
 * 删除玩家核心数据
 * @param {string} xuid - 玩家XUID
 */
function deletePlayerDataSQL(xuid) {
    run(playerDb, 'DELETE FROM player_data WHERE xuid = ?', [xuid]);
}

/** 删除玩家设置 */
function deletePlayerSettingsSQL(xuid) {
    run(playerDb, 'DELETE FROM player_settings WHERE xuid = ?', [xuid]);
}

/** 删除玩家死亡点 */
function deleteDeathPointsSQL(xuid) {
    run(playerDb, 'DELETE FROM death_points WHERE xuid = ?', [xuid]);
}

/** 删除玩家好友关系 */
function deleteFriendsSQL(xuid) {
    run(playerDb, 'DELETE FROM friends WHERE xuid = ? OR friend_xuid = ?', [xuid, xuid]);
}

/** 删除玩家好友请求 */
function deleteFriendRequestsSQL(xuid) {
    run(playerDb, 'DELETE FROM friend_requests WHERE xuid = ? OR from_xuid = ?', [xuid, xuid]);
}

/** 删除玩家私信 */
function deleteMessagesSQL(xuid) {
    run(playerDb, 'DELETE FROM messages WHERE xuid = ? OR from_xuid = ? OR to_xuid = ?', [xuid, xuid, xuid]);
}

/** 删除玩家家园 */
function deleteHomesSQL(xuid) {
    run(playerDb, 'DELETE FROM homes WHERE xuid = ?', [xuid]);
}

/** 删除玩家背包快照 */
function deletePlayerInventorySQL(xuid) {
    run(playerDb, 'DELETE FROM player_inventory WHERE xuid = ?', [xuid]);
}

/** 初始化认证数据库，建表并创建索引 */
function initDatabase() {
    // 迁移：旧文件 nlce.db → nece.db
    var oldPath = 'plugins/NECE/data/nlce.db';
    if (!fs.existsSync(DB_PATH) && fs.existsSync(oldPath)) {
        try { fs.renameSync(oldPath, DB_PATH); } catch (e) {}
    }

    ensureDir(DB_PATH);
    db = new DBSession('sqlite3', { path: DB_PATH });
    if (!db) { logger.error('[DB] 认证数据库打开失败'); return null; }

    db.exec(`CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS admins (
        uid TEXT PRIMARY KEY,
        added_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS captcha (
        captcha_id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        ip TEXT,
        created_at INTEGER NOT NULL
    )`);
    try { db.exec('ALTER TABLE captcha ADD COLUMN ip TEXT'); } catch (e) {}
    db.exec(`CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        token_jti TEXT NOT NULL UNIQUE,
        family_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_uid ON refresh_tokens(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti ON refresh_tokens(token_jti)');
    db.exec(`CREATE TABLE IF NOT EXISTS access_token_blacklist (
        jti TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        uid TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON access_token_blacklist(expires_at)');
    try { db.exec('ALTER TABLE access_token_blacklist ADD COLUMN uid TEXT'); } catch (e) {}

    // 地图画上传表
    db.exec(`CREATE TABLE IF NOT EXISTS mapart_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        upload_time TEXT DEFAULT (datetime('now', 'localtime'))
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_mapart_uid ON mapart_images(uid)');

    dbDebugLog('initDatabase: 认证数据库就绪');
    return db;
}

/** LLSE DBSession 自动持久化，无需手动保存 */
function saveDatabase() { cleanExpiredData(); }
function requestSaveAuthDb() {}
function cancelPendingAuthSave() {}

/** 清理过期的验证码、刷新令牌和黑名单条目 */
function cleanExpiredData() {
    if (!db) return;
    try {
        let now = Date.now();
        const captchaExpire = now - 5 * 60 * 1000;
        run(db, 'DELETE FROM captcha WHERE created_at < ?', [captchaExpire]);
        run(db, 'DELETE FROM refresh_tokens WHERE expires_at < ?', [now]);
        run(db, 'DELETE FROM access_token_blacklist WHERE expires_at < ?', [now]);
    } catch (e) {
        logger.error('清理过期数据失败:', e.message);
    }
}

/** 使用 PBKDF2-SHA512 对密码进行哈希 */
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_LENGTH, 'sha512').toString('hex');
}

/** 生成随机盐值 */
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
    const existing = query(db, 'SELECT uid FROM users WHERE uid = ?', [uid]);
    if (existing.length > 0) {
        run(db, 'UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime(\'now\', \'localtime\') WHERE uid = ?', [hash, salt, uid]);
    } else {
        run(db, 'INSERT INTO users (uid, password_hash, salt) VALUES (?, ?, ?)', [uid, hash, salt]);
    }
    return true;
}

/**
 * 验证用户密码是否正确
 * @param {string} uid - 用户 ID
 * @param {string} password - 待验证的明文密码
 * @returns {boolean} 密码是否匹配
 */
function verifyPassword(uid, password) {
    const rows = query(db, 'SELECT password_hash, salt FROM users WHERE uid = ?', [uid]);
    if (rows.length === 0) return false;
    const hash = hashPassword(password, rows[0].salt);
    try {
        if (hash.length !== rows[0].password_hash.length) return false;
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(rows[0].password_hash, 'hex'));
    } catch (e) { return false; }
}

function hasPassword(uid) {
    return query(db, 'SELECT uid FROM users WHERE uid = ?', [uid]).length > 0;
}

function addAdmin(uid) {
    if (query(db, 'SELECT uid FROM admins WHERE uid = ?', [uid]).length > 0) return false;
    run(db, 'INSERT INTO admins (uid) VALUES (?)', [uid]);
    return true;
}

function removeAdmin(uid) {
    if (query(db, 'SELECT uid FROM admins WHERE uid = ?', [uid]).length === 0) return false;
    run(db, 'DELETE FROM admins WHERE uid = ?', [uid]);
    return true;
}

function isAdmin(uid) {
    return query(db, 'SELECT uid FROM admins WHERE uid = ?', [uid]).length > 0;
}

function getAllAdmins() {
    return query(db, 'SELECT uid, added_at FROM admins').map(function(r) {
        return { uid: r.uid, added_at: r.added_at };
    });
}

/**
 * 生成验证码记录并返回唯一 ID
 * @param {string} code - 验证码文本
 * @returns {string} captchaId（hex 编码的 16 字节随机值）
 */
/**
 * 生成验证码并存储
 * @param {string} code - 验证码文本
 * @param {string} [ip] - 请求者 IP
 * @returns {string} 验证码 ID
 */
function generateCaptcha(code, ip) {
    const captchaId = crypto.randomBytes(16).toString('hex');
    run(db, 'INSERT INTO captcha (captcha_id, code, ip, created_at) VALUES (?, ?, ?, ?)', [captchaId, code, ip || null, Date.now()]);
    return captchaId;
}

function verifyCaptcha(captchaId, input, ip) {
    const rows = query(db, 'SELECT code, ip, created_at FROM captcha WHERE captcha_id = ?', [captchaId]);
    if (rows.length === 0) return false;
    const row = rows[0];
    if (Date.now() - row.created_at > 5 * 60 * 1000) {
        run(db, 'DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
        return false;
    }
    if (row.ip && ip && row.ip !== ip) {
        run(db, 'DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
        return false;
    }
    run(db, 'DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
    return row.code.toLowerCase() === input.toLowerCase();
}

function cleanExpiredCaptchas() {
    run(db, 'DELETE FROM captcha WHERE created_at < ?', [Date.now() - 5 * 60 * 1000]);
}

function saveRefreshToken(uid, jti, familyId, expiresAt) {
    run(db, 'INSERT INTO refresh_tokens (uid, token_jti, family_id, created_at, expires_at, is_revoked) VALUES (?, ?, ?, ?, ?, 0)',
        [uid, jti, familyId, Date.now(), expiresAt]);
}

function findRefreshToken(jti) {
    var rows = query(db, 'SELECT id, uid, token_jti, family_id, created_at, expires_at, is_revoked FROM refresh_tokens WHERE token_jti = ?', [jti]);
    if (rows.length === 0) return null;
    var r = rows[0];
    return { id: r.id, uid: r.uid, tokenJti: r.token_jti, familyId: r.family_id, createdAt: r.created_at, expiresAt: r.expires_at, isRevoked: r.is_revoked === 1 };
}

function revokeRefreshToken(jti) { run(db, 'UPDATE refresh_tokens SET is_revoked = 1 WHERE token_jti = ?', [jti]); }
function revokeFamilyTokens(familyId) { run(db, 'UPDATE refresh_tokens SET is_revoked = 1 WHERE family_id = ?', [familyId]); }
function revokeAllUserTokens(uid) { run(db, 'UPDATE refresh_tokens SET is_revoked = 1 WHERE uid = ?', [uid]); }
function cleanExpiredRefreshTokens() { run(db, 'DELETE FROM refresh_tokens WHERE expires_at < ?', [Date.now()]); }

function blacklistAccessToken(jti, expiresAt, uid) {
    run(db, 'INSERT OR IGNORE INTO access_token_blacklist (jti, expires_at, uid) VALUES (?, ?, ?)', [jti, expiresAt, uid || '']);
}

function blacklistAllUserAccessTokens(uid) {
    // 吊销该用户所有刷新令牌
    var tokens = query(db, 'SELECT family_id FROM refresh_tokens WHERE uid = ? AND is_revoked = 0', [String(uid)]);
    for (var i = 0; i < tokens.length; i++) {
        run(db, 'UPDATE refresh_tokens SET is_revoked = 1 WHERE family_id = ?', [tokens[i].family_id]);
    }
    // 用一个特殊标记让 verifyAccessToken 检测到该用户被全局吊销
    run(db, 'INSERT OR IGNORE INTO access_token_blacklist (jti, expires_at, uid) VALUES (?, ?, ?)', ['__revoke_all_' + uid, Date.now() + 86400000, uid]);
}

function isUserTokenRevoked(uid) {
    return query(db, 'SELECT jti FROM access_token_blacklist WHERE uid = ? AND jti LIKE ?', [String(uid), '__revoke_all_%']).length > 0;
}

function isAccessTokenBlacklisted(jti) {
    return query(db, 'SELECT jti FROM access_token_blacklist WHERE jti = ?', [jti]).length > 0;
}

function cleanExpiredBlacklist() { run(db, 'DELETE FROM access_token_blacklist WHERE expires_at < ?', [Date.now()]); }

// ===================== 地图画上传 SQL 方法 =====================

/** 添加地图画记录 */
function addMapartImage(uid, filename, originalName, fileSize) {
    if (!db) return null;
    run(db, 'INSERT INTO mapart_images (uid, filename, original_name, file_size) VALUES (?, ?, ?, ?)', [uid, filename, originalName, fileSize]);
    var rows = query(db, 'SELECT id FROM mapart_images WHERE uid = ? AND filename = ? ORDER BY id DESC LIMIT 1', [uid, filename]);
    return rows.length > 0 ? rows[0].id : null;
}

/** 获取用户的所有地图画 */
function getMapartImages(uid) {
    if (!db) return [];
    return query(db, 'SELECT id, filename, original_name, file_size, upload_time FROM mapart_images WHERE uid = ? ORDER BY id DESC', [uid]);
}

/** 获取用户的地图画总大小 */
function getMapartTotalSize(uid) {
    if (!db) return 0;
    var rows = query(db, 'SELECT COALESCE(SUM(file_size), 0) as total FROM mapart_images WHERE uid = ?', [uid]);
    return rows.length > 0 ? rows[0].total : 0;
}

/** 获取所有地图画（管理员用） */
function getAllMapartImages() {
    if (!db) return [];
    return query(db, 'SELECT id, uid, filename, original_name, file_size, upload_time FROM mapart_images ORDER BY id DESC');
}

/** 删除指定地图画（需校验 uid） */
function deleteMapartImage(uid, imageId) {
    if (!db) return false;
    var rows = query(db, 'SELECT filename FROM mapart_images WHERE id = ? AND uid = ?', [imageId, uid]);
    if (rows.length === 0) return null;
    run(db, 'DELETE FROM mapart_images WHERE id = ? AND uid = ?', [imageId, uid]);
    return rows[0].filename;
}

/** 根据 id 删除地图画（管理员用，不校验 uid） */
function deleteMapartImageById(imageId) {
    if (!db) return null;
    var rows = query(db, 'SELECT filename, uid FROM mapart_images WHERE id = ?', [imageId]);
    if (rows.length === 0) return null;
    run(db, 'DELETE FROM mapart_images WHERE id = ?', [imageId]);
    return { filename: rows[0].filename, uid: rows[0].uid };
}

/** 根据 id 获取地图画信息 */
function getMapartImageById(imageId) {
    if (!db) return null;
    var rows = query(db, 'SELECT * FROM mapart_images WHERE id = ?', [imageId]);
    return rows.length > 0 ? rows[0] : null;
}

// ===================== 玩家数据 SQL 方法 =====================

/** 初始化玩家数据库，启用 WAL 模式和 64MB 缓存以提升性能 */
function initPlayerDatabase() {
    ensureDir(PLAYER_DB_PATH);
    playerDb = new DBSession('sqlite3', { path: PLAYER_DB_PATH });
    if (!playerDb) { logger.error('[DB] 玩家数据库打开失败'); return null; }

    playerDb.exec("PRAGMA journal_mode=WAL");
    playerDb.exec("PRAGMA synchronous=NORMAL");
    playerDb.exec("PRAGMA cache_size=-64000");

    playerDb.exec(`CREATE TABLE IF NOT EXISTS player_data (
        xuid TEXT PRIMARY KEY, uid INTEGER, name TEXT, uuid TEXT,
        register_time TEXT, leave_time TEXT, health_bonus INTEGER DEFAULT 0,
        rw TEXT, tax_data TEXT DEFAULT '{}', bank_data TEXT DEFAULT '{}',
        quick_menu TEXT DEFAULT '{}', vip_data TEXT DEFAULT '{}',
        avatar TEXT DEFAULT '{}', count TEXT DEFAULT '{}',
        titles TEXT DEFAULT '{}',
        last_ip TEXT DEFAULT '', platform TEXT DEFAULT ''
    )`);

    // 兼容已有数据库：检查缺失列并添加
    var existingCols = {};
    query(playerDb, "PRAGMA table_info(player_data)").forEach(function(r) { existingCols[r.name] = true; });
    [['last_ip', "TEXT DEFAULT ''"], ['platform', "TEXT DEFAULT ''"], ['titles', "TEXT DEFAULT '{}'"],
     ['chain', "TEXT DEFAULT '{}'"], ['chain_plan', "TEXT DEFAULT '{}'"], ['dustshop', "TEXT DEFAULT '{}'"],
     ['sign', "TEXT DEFAULT '{}'"]
    ].forEach(function(col) {
        if (!existingCols[col[0]]) {
            try { playerDb.exec("ALTER TABLE player_data ADD COLUMN " + col[0] + " " + col[1]); } catch (e) {}
        }
    });

    playerDb.exec('CREATE TABLE IF NOT EXISTS player_settings (xuid TEXT, key TEXT, value TEXT, PRIMARY KEY (xuid, key))');
    playerDb.exec('CREATE TABLE IF NOT EXISTS death_points (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, data TEXT)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS friends (xuid TEXT, friend_xuid TEXT, friend_name TEXT, add_time TEXT, PRIMARY KEY (xuid, friend_xuid))');
    playerDb.exec('CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, from_xuid TEXT, from_name TEXT, message TEXT, time TEXT, handled INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, from_xuid TEXT, from_name TEXT, to_xuid TEXT, to_name TEXT, content TEXT, time TEXT, is_read INTEGER DEFAULT 0)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS homes (xuid TEXT, name TEXT, x REAL, y REAL, z REAL, dim INTEGER, last_use TEXT, shared_with TEXT DEFAULT \'[]\', is_public INTEGER DEFAULT 0, PRIMARY KEY (xuid, name))');
    playerDb.exec("CREATE TABLE IF NOT EXISTS player_inventory (xuid TEXT PRIMARY KEY, items TEXT DEFAULT '[]', armor TEXT DEFAULT '[]', offhand TEXT DEFAULT '[]', save_time TEXT)");

    // 兼容已有数据库：检查缺失列并添加
    var invCols = {};
    query(playerDb, "PRAGMA table_info(player_inventory)").forEach(function(r) { invCols[r.name] = true; });
    if (!invCols['armor']) { try { playerDb.exec("ALTER TABLE player_inventory ADD COLUMN armor TEXT DEFAULT '[]'"); } catch (e) {} }
    if (!invCols['offhand']) { try { playerDb.exec("ALTER TABLE player_inventory ADD COLUMN offhand TEXT DEFAULT '[]'"); } catch (e) {} }

    // 兼容已有数据库：homes 表添加 shared_with 列
    var homeCols = {};
    query(playerDb, "PRAGMA table_info(homes)").forEach(function(r) { homeCols[r.name] = true; });
    if (!homeCols['shared_with']) { try { playerDb.exec("ALTER TABLE homes ADD COLUMN shared_with TEXT DEFAULT '[]'"); } catch (e) {} }
    if (!homeCols['is_public']) { try { playerDb.exec("ALTER TABLE homes ADD COLUMN is_public INTEGER DEFAULT 0"); } catch (e) {} }

    createGuildTables();
    // 公会申请/邀请表
    playerDb.exec('CREATE TABLE IF NOT EXISTS guild_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, xuid TEXT NOT NULL, name TEXT, time INTEGER NOT NULL)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS guild_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, target_xuid TEXT NOT NULL, guild_id INTEGER NOT NULL, guild_name TEXT, inviter_name TEXT, inviter_xuid TEXT, time INTEGER NOT NULL)');
    try { playerDb.exec('ALTER TABLE guild_invites ADD COLUMN inviter_xuid TEXT'); } catch (e) {}
    // 待领取转账表
    playerDb.exec('CREATE TABLE IF NOT EXISTS pending_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, target_xuid TEXT NOT NULL, from_name TEXT, from_xuid TEXT, amount REAL NOT NULL, time TEXT)');
    createPlayerCountTable();
    playerDbReady = true;
    dbDebugLog('initPlayerDatabase: 数据库就绪');
    return playerDb;
}

/** 检查玩家数据库是否已初始化可用 */
function isPlayerDbReady() {
    return playerDbReady && playerDb !== null;
}

function markPlayerDbDirty() {}
function savePlayerDatabase() {}
function requestSavePlayerDb() {}
function cancelPendingSave() {}

// --- 玩家核心数据 ---

/**
 * 根据 XUID 获取玩家核心数据，JSON 字段自动解析
 * @param {string} xuid - 玩家 XUID
 * @returns {Object|null} 玩家数据对象，不存在返回 null
 */
function getPlayerDataSQL(xuid) {
    var rows = query(playerDb, 'SELECT uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, titles, last_ip, platform, chain, chain_plan, dustshop, sign FROM player_data WHERE xuid = ?', [xuid]);
    if (rows.length === 0) return null;
    var r = rows[0];
    return {
        uid: r.uid, name: r.name, uuid: r.uuid, registerTime: r.register_time,
        leavetime: r.leave_time, healthBonus: r.health_bonus, rw: r.rw,
        taxdata: JSON.parse(r.tax_data || '{}'), bankdata: JSON.parse(r.bank_data || '{}'),
        quickmenu: JSON.parse(r.quick_menu || '{}'), vipdata: JSON.parse(r.vip_data || '{}'),
        avatar: JSON.parse(r.avatar || '{}'), count: JSON.parse(r.count || '{}'),
        titles: JSON.parse(r.titles || '{}'), lastIp: r.last_ip || '', platform: r.platform || '',
        chain: JSON.parse(r.chain || '{}'), chainPlan: JSON.parse(r.chain_plan || '{}'),
        dustshop: JSON.parse(r.dustshop || '{}'),
        sign: JSON.parse(r.sign || '{}')
    };
}

function setPlayerDataSQL(xuid, data) {
    run(playerDb,
        'INSERT OR REPLACE INTO player_data (xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, titles, last_ip, platform, chain, chain_plan, dustshop, sign) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [xuid, data.uid, data.name, data.uuid, data.registerTime,
         String(data.leavetime || ''), data.healthBonus || 0, data.rw,
         JSON.stringify(data.taxdata || {}), JSON.stringify(data.bankdata || {}),
         JSON.stringify(data.quickmenu || {}), JSON.stringify(data.vipdata || {}),
         JSON.stringify(data.avatar || {}), JSON.stringify(data.count || {}),
         JSON.stringify(data.titles || {}), data.lastIp || '', data.platform || '',
         JSON.stringify(data.chain || {}), JSON.stringify(data.chainPlan || {}),
         JSON.stringify(data.dustshop || {}), JSON.stringify(data.sign || {})]
    );
}

function updateLeaveTimeSQL(xuid, timestamp) {
    run(playerDb, 'UPDATE player_data SET leave_time = ? WHERE xuid = ?', [String(timestamp), xuid]);
}

function updatePlayTimeSQL(xuid, playTime) {
    run(playerDb, "UPDATE player_data SET count = json_set(COALESCE(count, '{}'), '$.playTime', ?) WHERE xuid = ?", [playTime, xuid]);
}

function _safeParse(str, fallback) {
    try { return JSON.parse(str || '{}'); } catch (e) { return fallback || {}; }
}

function _parsePlayerRow(r) {
    return {
        uid: r.uid, name: r.name, uuid: r.uuid, registerTime: r.register_time,
        leavetime: r.leave_time, healthBonus: r.health_bonus, rw: r.rw,
        taxdata: _safeParse(r.tax_data), bankdata: _safeParse(r.bank_data),
        quickmenu: _safeParse(r.quick_menu), vipdata: _safeParse(r.vip_data),
        avatar: _safeParse(r.avatar), count: _safeParse(r.count),
        titles: _safeParse(r.titles), lastIp: r.last_ip || '', platform: r.platform || '',
        chain: _safeParse(r.chain), chainPlan: _safeParse(r.chain_plan),
        dustshop: _safeParse(r.dustshop),
        sign: _safeParse(r.sign)
    };
}

function getAllPlayerDataSQL() {
    var rows = query(playerDb, 'SELECT xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, titles, last_ip, platform, chain, chain_plan, dustshop, sign FROM player_data');
    var players = {};
    rows.forEach(function(r) { players[r.xuid] = _parsePlayerRow(r); });
    return players;
}

function getPlayerDataByUidSQL(uid) {
    var rows = query(playerDb, 'SELECT xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, titles, last_ip, platform, chain, chain_plan, dustshop, sign FROM player_data WHERE uid = ?', [uid]);
    if (rows.length === 0) return null;
    var row = rows[0];
    var data = _parsePlayerRow(row);
    data.xuid = row.xuid;
    return data;
}

function getPlayerDataByNameSQL(name) {
    var rows = query(playerDb, 'SELECT xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, titles, last_ip, platform, chain, chain_plan, dustshop, sign FROM player_data WHERE name = ?', [name]);
    if (rows.length === 0) return null;
    var row = rows[0];
    var data = _parsePlayerRow(row);
    data.xuid = row.xuid;
    return data;
}

function getNextUidSQL() {
    var rows = query(playerDb, 'SELECT MAX(uid) as maxuid FROM player_data');
    if (rows.length === 0 || rows[0].maxuid === null) return 10000;
    return (rows[0].maxuid || 10000) + 1;
}

function getPlayerSettingsSQL(xuid) {
    var rows = query(playerDb, 'SELECT key, value FROM player_settings WHERE xuid = ?', [xuid]);
    var settings = {};
    rows.forEach(function(r) {
        try { settings[r.key] = JSON.parse(r.value); }
        catch (e) { settings[r.key] = r.value; }
    });
    return settings;
}

function getAllPlayerSettingsSQL() {
    var rows = query(playerDb, 'SELECT xuid, key, value FROM player_settings');
    var all = {};
    rows.forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = {};
        try { all[r.xuid][r.key] = JSON.parse(r.value); }
        catch (e) { all[r.xuid][r.key] = r.value; }
    });
    return all;
}

/** 设置玩家单项设置，值自动 JSON 序列化 */
function setPlayerSettingSQL(xuid, key, value) {
    run(playerDb, 'INSERT OR REPLACE INTO player_settings (xuid, key, value) VALUES (?, ?, ?)', [xuid, key, JSON.stringify(value)]);
}

function getDeathPointsSQL(xuid) {
    return query(playerDb, 'SELECT data FROM death_points WHERE xuid = ? ORDER BY id', [xuid]).map(function(r) { return JSON.parse(r.data); });
}

function getAllDeathPointsSQL() {
    var all = {};
    query(playerDb, 'SELECT xuid, data FROM death_points ORDER BY id').forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = [];
        all[r.xuid].push(JSON.parse(r.data));
    });
    return all;
}

function setDeathPointsSQL(xuid, points) {
    // 增量保存：对比数据库中的现有记录，仅插入新增、删除多余的
    var existing = query(playerDb, 'SELECT id, data FROM death_points WHERE xuid = ? ORDER BY id', [xuid]);
    var existingData = existing.map(function(r) { return r.data; });
    var newData = (points || []).map(function(p) { return JSON.stringify(p); });

    // 数据完全一致则跳过
    if (existingData.length === newData.length) {
        var same = true;
        for (var i = 0; i < existingData.length; i++) {
            if (existingData[i] !== newData[i]) { same = false; break; }
        }
        if (same) return;
    }

    // 计算差量：找出需要删除的 id 和需要插入的数据
    var existingSet = new Set(existingData);
    var newSet = new Set(newData);

    // 删除在新列表中不存在的记录
    var idsToDelete = [];
    for (var i = 0; i < existingData.length; i++) {
        if (!newSet.has(existingData[i])) {
            idsToDelete.push(existing[i].id);
        }
    }
    if (idsToDelete.length > 0) {
        var placeholders = idsToDelete.map(function() { return '?'; }).join(',');
        run(playerDb, 'DELETE FROM death_points WHERE id IN (' + placeholders + ')', idsToDelete);
    }

    // 插入在旧列表中不存在的新记录
    for (var j = 0; j < newData.length; j++) {
        if (!existingSet.has(newData[j])) {
            run(playerDb, 'INSERT INTO death_points (xuid, data) VALUES (?, ?)', [xuid, newData[j]]);
        }
    }
}

function addDeathPointSQL(xuid, point) {
    run(playerDb, 'INSERT INTO death_points (xuid, data) VALUES (?, ?)', [xuid, JSON.stringify(point)]);
    // 保留最近10条，删除多余的
    run(playerDb, 'DELETE FROM death_points WHERE xuid = ? AND id NOT IN (SELECT id FROM death_points WHERE xuid = ? ORDER BY id DESC LIMIT 10)', [xuid, xuid]);
}

function getFriendsSQL(xuid) {
    var friends = query(playerDb, 'SELECT friend_xuid, friend_name, add_time FROM friends WHERE xuid = ?', [xuid])
        .map(function(r) { return { xuid: r.friend_xuid, name: r.friend_name, addTime: r.add_time }; });
    var requests = query(playerDb, 'SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 0', [xuid])
        .map(function(r) { return { xuid: r.from_xuid, name: r.from_name, message: r.message, time: r.time, handled: r.handled === 1, rejected: r.rejected === 1 }; });
    var sentRequests = query(playerDb, 'SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 1', [xuid])
        .map(function(r) { return { xuid: r.from_xuid, name: r.from_name, message: r.message, time: r.time, handled: r.handled === 1, rejected: r.rejected === 1 }; });
    return { friends: friends, requests: requests, sentRequests: sentRequests };
}

function getAllFriendsSQL() {
    var all = {};
    query(playerDb, 'SELECT xuid, friend_xuid, friend_name, add_time FROM friends').forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = { friends: [], requests: [], sentRequests: [] };
        all[r.xuid].friends.push({ xuid: r.friend_xuid, name: r.friend_name, addTime: r.add_time });
    });
    query(playerDb, 'SELECT xuid, from_xuid, from_name, message, time, handled, rejected, is_sent FROM friend_requests').forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = { friends: [], requests: [], sentRequests: [] };
        var entry = { xuid: r.from_xuid, name: r.from_name, message: r.message, time: r.time, handled: r.handled === 1, rejected: r.rejected === 1 };
        if (r.is_sent === 1) all[r.xuid].sentRequests.push(entry);
        else all[r.xuid].requests.push(entry);
    });
    return all;
}

function addFriendSQL(xuid, friendXuid, friendName, addTime) {
    run(playerDb, 'INSERT OR REPLACE INTO friends (xuid, friend_xuid, friend_name, add_time) VALUES (?, ?, ?, ?)', [xuid, friendXuid, friendName, addTime]);
}
function removeFriendSQL(xuid, friendXuid) {
    run(playerDb, 'DELETE FROM friends WHERE xuid = ? AND friend_xuid = ?', [xuid, friendXuid]);
}
function addFriendRequestSQL(xuid, fromXuid, fromName, message, time, isSent) {
    run(playerDb, 'INSERT INTO friend_requests (xuid, from_xuid, from_name, message, time, handled, rejected, is_sent) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
        [xuid, fromXuid, fromName, message, time, isSent ? 1 : 0]);
}
function handleFriendRequestSQL(xuid, fromXuid, rejected) {
    run(playerDb, 'UPDATE friend_requests SET handled = 1, rejected = ? WHERE xuid = ? AND from_xuid = ? AND handled = 0',
        [rejected ? 1 : 0, xuid, fromXuid]);
}
function clearFriendsSQL(xuid) { run(playerDb, 'DELETE FROM friends WHERE xuid = ?', [xuid]); }
function clearFriendRequestsSQL(xuid) { run(playerDb, 'DELETE FROM friend_requests WHERE xuid = ?', [xuid]); }

/** 增量保存好友数据：对比数据库现有记录，仅增删改差异部分 */
function setFriendsSQL(xuid, friends, requests, sentRequests) {
    // --- 好友列表增量 ---
    var existingFriends = query(playerDb, 'SELECT friend_xuid, friend_name, add_time FROM friends WHERE xuid = ?', [xuid]);
    var existingFriendMap = {};
    existingFriends.forEach(function(r) { existingFriendMap[r.friend_xuid] = r; });
    var newFriendXuids = new Set((friends || []).map(function(f) { return f.xuid; }));
    var existingFriendXuids = new Set(Object.keys(existingFriendMap));

    // 删除不在新列表中的好友
    existingFriendXuids.forEach(function(fxuid) {
        if (!newFriendXuids.has(fxuid)) {
            run(playerDb, 'DELETE FROM friends WHERE xuid = ? AND friend_xuid = ?', [xuid, fxuid]);
        }
    });

    // 插入或更新好友
    (friends || []).forEach(function(f) {
        if (!existingFriendXuids.has(f.xuid)) {
            run(playerDb, 'INSERT OR REPLACE INTO friends (xuid, friend_xuid, friend_name, add_time) VALUES (?, ?, ?, ?)', [xuid, f.xuid, f.name, f.addTime]);
        } else {
            var e = existingFriendMap[f.xuid];
            if (e.friend_name !== f.name || e.add_time !== f.addTime) {
                run(playerDb, 'UPDATE friends SET friend_name = ?, add_time = ? WHERE xuid = ? AND friend_xuid = ?', [f.name, f.addTime, xuid, f.xuid]);
            }
        }
    });

    // --- 好友请求增量（全量替换，因为请求数据量小且状态变化复杂） ---
    var existingReqCount = query(playerDb, 'SELECT COUNT(*) as cnt FROM friend_requests WHERE xuid = ? AND is_sent = 0', [xuid])[0].cnt;
    var existingSentCount = query(playerDb, 'SELECT COUNT(*) as cnt FROM friend_requests WHERE xuid = ? AND is_sent = 1', [xuid])[0].cnt;
    var newReqLen = (requests || []).length;
    var newSentLen = (sentRequests || []).length;

    // 只有数量或内容变化时才重建
    if (existingReqCount !== newReqLen) {
        run(playerDb, 'DELETE FROM friend_requests WHERE xuid = ? AND is_sent = 0', [xuid]);
        (requests || []).forEach(function(r) {
            run(playerDb, 'INSERT INTO friend_requests (xuid, from_xuid, from_name, message, time, handled, rejected, is_sent) VALUES (?, ?, ?, ?, ?, 0, 0, 0)',
                [xuid, r.xuid, r.name, r.message, r.time]);
        });
    }
    if (existingSentCount !== newSentLen) {
        run(playerDb, 'DELETE FROM friend_requests WHERE xuid = ? AND is_sent = 1', [xuid]);
        (sentRequests || []).forEach(function(r) {
            run(playerDb, 'INSERT INTO friend_requests (xuid, from_xuid, from_name, message, time, handled, rejected, is_sent) VALUES (?, ?, ?, ?, ?, 0, 0, 1)',
                [xuid, r.xuid, r.name, r.message, r.time]);
        });
    }
}

function getMessagesSQL(xuid) {
    return query(playerDb, 'SELECT from_xuid, from_name, to_xuid, to_name, content, time, is_read FROM messages WHERE xuid = ? ORDER BY id', [xuid])
        .map(function(r) { return { fromXuid: r.from_xuid, fromName: r.from_name, toXuid: r.to_xuid, toName: r.to_name, content: r.content, time: r.time, read: r.is_read === 1 }; });
}

function getAllMessagesSQL() {
    var all = {};
    query(playerDb, 'SELECT xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read FROM messages ORDER BY xuid, id').forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = { messages: [] };
        all[r.xuid].messages.push({ fromXuid: r.from_xuid, fromName: r.from_name, toXuid: r.to_xuid, toName: r.to_name, content: r.content, time: r.time, read: r.is_read === 1 });
    });
    return all;
}

function addMessageSQL(xuid, msg) {
    if (!msg) return;
    run(playerDb, 'INSERT INTO messages (xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [xuid, msg.fromXuid || '', msg.fromName || '', msg.toXuid || '', msg.toName || '', msg.content || '', msg.time || '', msg.read ? 1 : 0]);
}

/** 将指定发送者的未读消息标记为已读 */
function markMessagesReadSQL(xuid, fromXuid) {
    run(playerDb, 'UPDATE messages SET is_read = 1 WHERE xuid = ? AND from_xuid = ? AND is_read = 0', [xuid, fromXuid]);
}
function deleteMessageSQL(xuid, fromXuid, time) {
    run(playerDb, 'DELETE FROM messages WHERE xuid = ? AND from_xuid = ? AND time = ?', [xuid, fromXuid, time]);
}
function clearMessagesSQL(xuid) { run(playerDb, 'DELETE FROM messages WHERE xuid = ?', [xuid]); }

/** 增量保存消息数据：对比数据库现有记录，仅插入新增消息 */
function setMessagesSQL(xuid, messages) {
    var existingCount = query(playerDb, 'SELECT COUNT(*) as cnt FROM messages WHERE xuid = ?', [xuid])[0].cnt;
    var newMsgs = messages || [];

    // 如果数量一致，大概率无变化，跳过
    if (existingCount === newMsgs.length) return;

    // 新消息比旧的多，只插入多出来的部分（消息是追加模式）
    if (newMsgs.length > existingCount) {
        for (var i = existingCount; i < newMsgs.length; i++) {
            var m = newMsgs[i];
            if (!m) continue;
            run(playerDb, 'INSERT INTO messages (xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [xuid, m.fromXuid || '', m.fromName || '', m.toXuid || '', m.toName || '', m.content || '', m.time || '', m.read ? 1 : 0]);
        }
    } else {
        // 消息变少了（被删除），全量重建
        run(playerDb, 'DELETE FROM messages WHERE xuid = ?', [xuid]);
        newMsgs.forEach(function(m) {
            if (!m) return;
            run(playerDb, 'INSERT INTO messages (xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [xuid, m.fromXuid || '', m.fromName || '', m.toXuid || '', m.toName || '', m.content || '', m.time || '', m.read ? 1 : 0]);
        });
    }
}

function _parseHomeRow(r) {
    var shared = [];
    try { shared = JSON.parse(r.shared_with || '[]'); } catch (e) { shared = []; }
    return { name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, lastUse: r.last_use, sharedWith: shared, public: !!r.is_public };
}

function getHomesSQL(xuid) {
    return query(playerDb, 'SELECT name, x, y, z, dim, last_use, shared_with, is_public FROM homes WHERE xuid = ?', [xuid])
        .map(_parseHomeRow);
}

function getAllHomesSQL() {
    var all = {};
    query(playerDb, 'SELECT xuid, name, x, y, z, dim, last_use, shared_with, is_public FROM homes').forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = [];
        all[r.xuid].push(_parseHomeRow(r));
    });
    return all;
}

function setHomesSQL(xuid, homes) {
    // 增量保存：对比数据库中的现有记录，按 name 进行 diff
    var existing = query(playerDb, 'SELECT name, x, y, z, dim, last_use, shared_with, is_public FROM homes WHERE xuid = ?', [xuid]);
    var existingMap = {};
    existing.forEach(function(r) { existingMap[r.name] = r; });

    var newNames = new Set((homes || []).map(function(h) { return h.name; }));
    var existingNames = new Set(Object.keys(existingMap));

    // 删除在新列表中不存在的家园
    existingNames.forEach(function(name) {
        if (!newNames.has(name)) {
            run(playerDb, 'DELETE FROM homes WHERE xuid = ? AND name = ?', [xuid, name]);
        }
    });

    // 插入或更新的家园
    (homes || []).forEach(function(h) {
        var sharedWith = JSON.stringify(h.sharedWith || []);
        if (!existingNames.has(h.name)) {
            // 新增
            run(playerDb, 'INSERT INTO homes (xuid, name, x, y, z, dim, last_use, shared_with, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [xuid, h.name, h.x, h.y, h.z, h.dim || 0, h.lastUse || 0, sharedWith, h.public ? 1 : 0]);
        } else {
            // 检查是否有变化
            var e = existingMap[h.name];
            if (e.x !== h.x || e.y !== h.y || e.z !== h.z || e.dim !== (h.dim || 0) || e.last_use !== (h.lastUse || 0) || e.shared_with !== sharedWith || e.is_public !== (h.public ? 1 : 0)) {
                run(playerDb, 'UPDATE homes SET x = ?, y = ?, z = ?, dim = ?, last_use = ?, shared_with = ?, is_public = ? WHERE xuid = ? AND name = ?',
                    [h.x, h.y, h.z, h.dim || 0, h.lastUse || 0, sharedWith, h.public ? 1 : 0, xuid, h.name]);
            }
        }
    });
}

function addHomeSQL(xuid, home) {
    run(playerDb, 'INSERT INTO homes (xuid, name, x, y, z, dim, last_use, shared_with, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [xuid, home.name, home.x, home.y, home.z, home.dim || 0, home.lastUse || 0, JSON.stringify(home.sharedWith || []), home.public ? 1 : 0]);
}
function removeHomeSQL(xuid, name) { run(playerDb, 'DELETE FROM homes WHERE xuid = ? AND name = ?', [xuid, name]); }
function updateHomeSQL(xuid, name, home) {
    run(playerDb, 'UPDATE homes SET x = ?, y = ?, z = ?, dim = ?, last_use = ?, shared_with = ?, is_public = ? WHERE xuid = ? AND name = ?',
        [home.x, home.y, home.z, home.dim || 0, home.lastUse || 0, JSON.stringify(home.sharedWith || []), home.public ? 1 : 0, xuid, name]);
}

function savePlayerInventorySQL(xuid, items, armor, offhand) {
    run(playerDb, 'INSERT OR REPLACE INTO player_inventory (xuid, items, armor, offhand, save_time) VALUES (?, ?, ?, ?, ?)',
        [xuid, JSON.stringify(items || []), JSON.stringify(armor || []), JSON.stringify(offhand || []), String(Date.now())]);
}

function getPlayerInventorySQL(xuid) {
    var rows = query(playerDb, 'SELECT items, armor, offhand, save_time FROM player_inventory WHERE xuid = ?', [xuid]);
    if (rows.length === 0) return null;
    var r = rows[0];
    return { items: JSON.parse(r.items || '[]'), armor: JSON.parse(r.armor || '[]'), offhand: JSON.parse(r.offhand || '[]'), saveTime: r.save_time };
}

// ===================== 公会系统 SQL 方法 =====================

function createGuildTables() {
    playerDb.exec(`CREATE TABLE IF NOT EXISTS guilds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT DEFAULT '',
        owner TEXT NOT NULL, level INTEGER DEFAULT 1, fund REAL DEFAULT 0, max_members INTEGER DEFAULT 20,
        hq_x REAL, hq_y REAL, hq_z REAL, hq_dim TEXT, created_at INTEGER NOT NULL
    )`);
    playerDb.exec(`CREATE TABLE IF NOT EXISTS guild_members (
        xuid TEXT NOT NULL, guild_id INTEGER NOT NULL, role TEXT DEFAULT 'member',
        joined_at INTEGER NOT NULL, PRIMARY KEY (xuid),
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
    )`);
    playerDb.exec(`CREATE TABLE IF NOT EXISTS guild_teleports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, name TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, dim TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
    )`);
}

function createPlayerCountTable() {
    playerDb.exec('CREATE TABLE IF NOT EXISTS player_count_history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, count INTEGER NOT NULL)');
    playerDb.exec('CREATE INDEX IF NOT EXISTS idx_player_count_ts ON player_count_history(timestamp)');
}

// --- 公会申请/邀请 SQL ---

function getGuildRequestsSQL(guildId) {
    return query(playerDb, 'SELECT xuid, name, time FROM guild_requests WHERE guild_id = ?', [guildId])
        .map(function(r) { return { xuid: r.xuid, name: r.name, time: r.time }; });
}

function getAllGuildRequestsSQL() {
    return query(playerDb, 'SELECT guild_id, xuid, name, time FROM guild_requests');
}

function addGuildRequestSQL(guildId, xuid, name, time) {
    run(playerDb, 'INSERT INTO guild_requests (guild_id, xuid, name, time) VALUES (?, ?, ?, ?)', [guildId, xuid, name, time]);
}

function removeGuildRequestSQL(guildId, xuid) {
    run(playerDb, 'DELETE FROM guild_requests WHERE guild_id = ? AND xuid = ?', [guildId, xuid]);
}

function clearGuildRequestsSQL(guildId) {
    run(playerDb, 'DELETE FROM guild_requests WHERE guild_id = ?', [guildId]);
}

function getGuildInvitesSQL(targetXuid) {
    return query(playerDb, 'SELECT guild_id, guild_name, inviter_name, inviter_xuid, time FROM guild_invites WHERE target_xuid = ?', [targetXuid])
        .map(function(r) { return { guildId: r.guild_id, guildName: r.guild_name, inviterName: r.inviter_name, inviterXuid: r.inviter_xuid, time: r.time }; });
}

function getAllGuildInvitesSQL() {
    return query(playerDb, 'SELECT target_xuid, guild_id, guild_name, inviter_name, inviter_xuid, time FROM guild_invites');
}

function addGuildInviteSQL(targetXuid, guildId, guildName, inviterName, inviterXuid, time) {
    run(playerDb, 'INSERT INTO guild_invites (target_xuid, guild_id, guild_name, inviter_name, inviter_xuid, time) VALUES (?, ?, ?, ?, ?, ?)', [targetXuid, guildId, guildName, inviterName, inviterXuid || '', time]);
}

function removeGuildInviteSQL(targetXuid, guildId) {
    run(playerDb, 'DELETE FROM guild_invites WHERE target_xuid = ? AND guild_id = ?', [targetXuid, guildId]);
}

function clearGuildInvitesSQL(targetXuid) {
    run(playerDb, 'DELETE FROM guild_invites WHERE target_xuid = ?', [targetXuid]);
}

function clearExpiredGuildRequestsSQL(maxAge) {
    run(playerDb, 'DELETE FROM guild_requests WHERE time < ?', [Date.now() - maxAge]);
}

function clearExpiredGuildInvitesSQL(maxAge) {
    run(playerDb, 'DELETE FROM guild_invites WHERE time < ?', [Date.now() - maxAge]);
}

// --- 待领取转账 SQL ---

function getPendingTransfersSQL(targetXuid) {
    return query(playerDb, 'SELECT from_name, from_xuid, amount, time FROM pending_transfers WHERE target_xuid = ?', [targetXuid])
        .map(function(r) { return { from: r.from_name, fromXuid: r.from_xuid, amount: r.amount, time: r.time }; });
}

function addPendingTransferSQL(targetXuid, fromName, fromXuid, amount, time) {
    run(playerDb, 'INSERT INTO pending_transfers (target_xuid, from_name, from_xuid, amount, time) VALUES (?, ?, ?, ?, ?)',
        [targetXuid, fromName, fromXuid, amount, time]);
}

function clearPendingTransfersSQL(targetXuid) {
    run(playerDb, 'DELETE FROM pending_transfers WHERE target_xuid = ?', [targetXuid]);
}

function insertPlayerCount(timestamp, count) {
    run(playerDb, 'INSERT INTO player_count_history (timestamp, count) VALUES (?, ?)', [timestamp, count]);
    run(playerDb, 'DELETE FROM player_count_history WHERE timestamp < ?', [timestamp - 7 * 24 * 60 * 60]);
}

function getPlayerCountHistory(startTime, endTime) {
    return query(playerDb, 'SELECT timestamp, count FROM player_count_history WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC', [startTime, endTime])
        .map(function(r) { return { timestamp: r.timestamp, count: r.count }; });
}

function getPlayerCountLatest() {
    var rows = query(playerDb, 'SELECT timestamp, count FROM player_count_history ORDER BY timestamp DESC LIMIT 1');
    return rows.length > 0 ? { timestamp: rows[0].timestamp, count: rows[0].count } : null;
}

function _parseGuildRow(r) {
    return { id: r.id, name: r.name, description: r.description, owner: r.owner,
        level: r.level, fund: r.fund, maxMembers: r.max_members,
        hqX: r.hq_x, hqY: r.hq_y, hqZ: r.hq_z, hqDim: r.hq_dim, createdAt: r.created_at };
}

function createGuild(name, description, owner, maxMembers) {
    var now = Date.now();
    run(playerDb, 'INSERT INTO guilds (name, description, owner, max_members, created_at) VALUES (?, ?, ?, ?, ?)',
        [name, description || '', owner, maxMembers || 20, now]);
    var rows = query(playerDb, 'SELECT last_insert_rowid() as id');
    var guildId = rows.length > 0 ? rows[0].id : null;
    if (guildId) run(playerDb, 'INSERT INTO guild_members (xuid, guild_id, role, joined_at) VALUES (?, ?, ?, ?)', [owner, guildId, 'owner', now]);
    return guildId;
}

function getGuild(guildId) {
    var rows = query(playerDb, 'SELECT id, name, description, owner, level, fund, max_members, hq_x, hq_y, hq_z, hq_dim, created_at FROM guilds WHERE id = ?', [guildId]);
    return rows.length > 0 ? _parseGuildRow(rows[0]) : null;
}

function getGuildByName(name) {
    var rows = query(playerDb, 'SELECT id, name, description, owner, level, fund, max_members, hq_x, hq_y, hq_z, hq_dim, created_at FROM guilds WHERE name = ?', [name]);
    return rows.length > 0 ? _parseGuildRow(rows[0]) : null;
}

function getGuildByPlayer(xuid) {
    var rows = query(playerDb, 'SELECT g.id, g.name, g.description, g.owner, g.level, g.fund, g.max_members, g.hq_x, g.hq_y, g.hq_z, g.hq_dim, g.created_at FROM guilds g INNER JOIN guild_members gm ON g.id = gm.guild_id WHERE gm.xuid = ?', [xuid]);
    return rows.length > 0 ? _parseGuildRow(rows[0]) : null;
}

function getAllGuilds() {
    return query(playerDb, 'SELECT id, name, description, owner, level, fund, max_members, hq_x, hq_y, hq_z, hq_dim, created_at FROM guilds ORDER BY id').map(_parseGuildRow);
}

function deleteGuild(guildId) {
    run(playerDb, 'DELETE FROM guild_teleports WHERE guild_id = ?', [guildId]);
    run(playerDb, 'DELETE FROM guild_members WHERE guild_id = ?', [guildId]);
    run(playerDb, 'DELETE FROM guilds WHERE id = ?', [guildId]);
}

function updateGuild(guildId, fields) {
    if (!fields) return;
    var sets = [], vals = [];
    var fieldMap = { name: 'name', description: 'description', owner: 'owner', level: 'level', fund: 'fund', maxMembers: 'max_members', hqX: 'hq_x', hqY: 'hq_y', hqZ: 'hq_z', hqDim: 'hq_dim' };
    for (var key in fields) {
        if (fields.hasOwnProperty(key) && fieldMap[key]) { sets.push(fieldMap[key] + ' = ?'); vals.push(fields[key]); }
    }
    if (sets.length === 0) return;
    vals.push(guildId);
    run(playerDb, 'UPDATE guilds SET ' + sets.join(', ') + ' WHERE id = ?', vals);
}

function updateGuildFundReduce(guildId, amount) {
    if (amount <= 0) return false;
    var before = query(playerDb, 'SELECT fund FROM guilds WHERE id = ?', [guildId]);
    if (before.length === 0 || before[0].fund < amount) return false;
    run(playerDb, 'UPDATE guilds SET fund = fund - ? WHERE id = ?', [amount, guildId]);
    return true;
}

function updateGuildFundAdd(guildId, amount) {
    if (amount <= 0) return false;
    run(playerDb, 'UPDATE guilds SET fund = fund + ? WHERE id = ?', [amount, guildId]);
    return true;
}

function addGuildMember(xuid, guildId, role) {
    run(playerDb, 'INSERT OR REPLACE INTO guild_members (xuid, guild_id, role, joined_at) VALUES (?, ?, ?, ?)', [xuid, guildId, role || 'member', Date.now()]);
}
function removeGuildMember(xuid) { run(playerDb, 'DELETE FROM guild_members WHERE xuid = ?', [xuid]); }

function getGuildMembers(guildId) {
    return query(playerDb, 'SELECT gm.xuid, gm.role, gm.joined_at, pd.name FROM guild_members gm LEFT JOIN player_data pd ON gm.xuid = pd.xuid WHERE gm.guild_id = ? ORDER BY gm.joined_at', [guildId])
        .map(function(r) { return { xuid: r.xuid, role: r.role, joinedAt: r.joined_at, name: r.name || r.xuid }; });
}

function getMemberCount(guildId) {
    var rows = query(playerDb, 'SELECT COUNT(*) as cnt FROM guild_members WHERE guild_id = ?', [guildId]);
    return rows.length > 0 ? rows[0].cnt : 0;
}

function getMemberRole(xuid) {
    var rows = query(playerDb, 'SELECT role FROM guild_members WHERE xuid = ?', [xuid]);
    return rows.length > 0 ? rows[0].role : null;
}

function updateMemberRole(xuid, role) { run(playerDb, 'UPDATE guild_members SET role = ? WHERE xuid = ?', [role, xuid]); }

function addGuildTeleport(guildId, name, x, y, z, dim, createdBy) {
    run(playerDb, 'INSERT INTO guild_teleports (guild_id, name, x, y, z, dim, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [guildId, name, x, y, z, dim, createdBy, Date.now()]);
}
function removeGuildTeleport(tpId, guildId) { run(playerDb, 'DELETE FROM guild_teleports WHERE id = ? AND guild_id = ?', [tpId, guildId]); }

function getGuildTeleports(guildId) {
    return query(playerDb, 'SELECT id, name, x, y, z, dim, created_by, created_at FROM guild_teleports WHERE guild_id = ? ORDER BY id', [guildId])
        .map(function(r) { return { id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, createdBy: r.created_by, createdAt: r.created_at }; });
}

function getGuildTeleportCount(guildId) {
    var rows = query(playerDb, 'SELECT COUNT(*) as cnt FROM guild_teleports WHERE guild_id = ?', [guildId]);
    return rows.length > 0 ? rows[0].cnt : 0;
}

function getGuildTeleportByName(guildId, name) {
    var rows = query(playerDb, 'SELECT id, name, x, y, z, dim, created_by, created_at FROM guild_teleports WHERE guild_id = ? AND name = ?', [guildId, name]);
    if (rows.length === 0) return null;
    var r = rows[0];
    return { id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, createdBy: r.created_by, createdAt: r.created_at };
}

// --- 批量保存优化 ---

function batchSavePlayerDb(operations) {
    if (!playerDb) return;
    run(playerDb, 'BEGIN TRANSACTION');
    try {
        operations.forEach(function(op) { if (typeof op === 'function') op(); });
        run(playerDb, 'COMMIT');
    } catch (e) {
        try { run(playerDb, 'ROLLBACK'); } catch (re) {}
        logger.error('[PlayerDB] 批量操作失败:', e.message);
    }
}

function sqlGetAll(prefix) {
    try {
        var all = {};
        query(playerDb, 'SELECT xuid, data FROM dm_' + prefix).forEach(function(r) {
            try { all[r.xuid] = JSON.parse(r.data); } catch (e) { all[r.xuid] = {}; }
        });
        return all;
    } catch (e) { return {}; }
}

function sqlSet(prefix, xuid, data) {
    run(playerDb, 'INSERT OR REPLACE INTO dm_' + prefix + ' (xuid, data) VALUES (?, ?)', [xuid, JSON.stringify(data)]);
}

function sqlDelete(prefix, xuid) {
    run(playerDb, 'DELETE FROM dm_' + prefix + ' WHERE xuid = ?', [xuid]);
}

function sqlEnsureTable(prefix) {
    playerDb.exec('CREATE TABLE IF NOT EXISTS dm_' + prefix + ' (xuid TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT "{}")');
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
    cleanExpiredData,
    cleanExpiredCaptchas,
    saveRefreshToken,
    findRefreshToken,
    revokeRefreshToken,
    revokeFamilyTokens,
    revokeAllUserTokens,
    cleanExpiredRefreshTokens,
    blacklistAccessToken,
    blacklistAllUserAccessTokens,
    isAccessTokenBlacklisted,
    isUserTokenRevoked,
    cleanExpiredBlacklist,
    // 玩家数据SQL
    initPlayerDatabase,
    isPlayerDbReady,
    savePlayerDatabase,
    markPlayerDbDirty,
    requestSavePlayerDb,
    cancelPendingSave,
    getPlayerDataSQL,
    getPlayerDataByUidSQL,
    getPlayerDataByNameSQL,
    setPlayerDataSQL,
    updateLeaveTimeSQL,
    updatePlayTimeSQL,
    getAllPlayerDataSQL,
    getNextUidSQL,
    getPlayerSettingsSQL,
    getAllPlayerSettingsSQL,
    setPlayerSettingSQL,
    getDeathPointsSQL,
    getAllDeathPointsSQL,
    setDeathPointsSQL,
    addDeathPointSQL,
    getFriendsSQL,
    getAllFriendsSQL,
    addFriendSQL,
    removeFriendSQL,
    addFriendRequestSQL,
    handleFriendRequestSQL,
    clearFriendsSQL,
    clearFriendRequestsSQL,
    setFriendsSQL,
    getMessagesSQL,
    getAllMessagesSQL,
    addMessageSQL,
    markMessagesReadSQL,
    deleteMessageSQL,
    clearMessagesSQL,
    setMessagesSQL,
    getHomesSQL,
    getAllHomesSQL,
    setHomesSQL,
    addHomeSQL,
    removeHomeSQL,
    updateHomeSQL,
    batchSavePlayerDb,
    savePlayerInventorySQL,
    getPlayerInventorySQL,
    // 玩家数据删除SQL
    deletePlayerDataSQL,
    deletePlayerSettingsSQL,
    deleteDeathPointsSQL,
    deleteFriendsSQL,
    deleteFriendRequestsSQL,
    deleteMessagesSQL,
    deleteHomesSQL,
    deletePlayerInventorySQL,
    // 公会系统SQL
    createGuildTables,
    createGuild,
    getGuild,
    getGuildByName,
    getGuildByPlayer,
    getAllGuilds,
    deleteGuild,
    updateGuild,
    updateGuildFundReduce,
    updateGuildFundAdd,
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
    // 公会申请/邀请SQL
    getGuildRequestsSQL,
    getAllGuildRequestsSQL,
    addGuildRequestSQL,
    removeGuildRequestSQL,
    clearGuildRequestsSQL,
    getGuildInvitesSQL,
    getAllGuildInvitesSQL,
    addGuildInviteSQL,
    removeGuildInviteSQL,
    clearGuildInvitesSQL,
    clearExpiredGuildRequestsSQL,
    clearExpiredGuildInvitesSQL,
    // 待领取转账SQL
    getPendingTransfersSQL,
    addPendingTransferSQL,
    clearPendingTransfersSQL,
    // 玩家人数统计SQL
    insertPlayerCount,
    getPlayerCountHistory,
    getPlayerCountLatest,
    // 通用SQL辅助
    sqlGetAll,
    sqlSet,
    sqlDelete,
    sqlEnsureTable,
    // 地图画上传SQL
    addMapartImage,
    getMapartImages,
    getMapartTotalSize,
    getAllMapartImages,
    deleteMapartImage,
    deleteMapartImageById,
    getMapartImageById,
    // Debug
    setDebugMode
};
