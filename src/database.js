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
 * NECE SQLite数据库管理（better-sqlite3）
 * 管理认证数据（用户/管理员/JWT令牌）和玩家数据（核心/设置/好友/消息/家园等）的SQL存储
 * 使用 better-sqlite3 实现真正的增量写入和 WAL 模式
 */

const Database = require('better-sqlite3');
const pathModule = require('path');
const crypto = require('crypto');
const { ensureDir } = require('./utils');

/** 认证数据库路径 */
const DB_PATH = 'plugins/NECE/data/nlce.db';
/** 玩家数据数据库路径 */
const PLAYER_DB_PATH = 'plugins/NECE/data/playerdata.db';
/** 密码盐值长度（字节），输出为 hex 后长度翻倍 */
const SALT_LENGTH = 32;
/** PBKDF2 迭代次数 */
const HASH_ITERATIONS = 10000;
/** PBKDF2 哈希输出长度（字节） */
const HASH_LENGTH = 64;

let db = null;           // 认证数据库实例
let playerDb = null;     // 玩家数据库实例
let playerDbReady = false;
let _debug = false;

function setDebugMode(enabled) { _debug = !!enabled; }
function dbDebugLog() {
    if (!_debug) return;
    const args = ['[DB]'];
    for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
    logger.info(args.join(' '));
}

// ============ 认证数据库 ============

/** 初始化认证数据库（nlce.db），better-sqlite3 直接打开文件，自动持久化 */
function initDatabase() {
    ensureDir(DB_PATH);
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

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
        created_at INTEGER NOT NULL
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        token_jti TEXT NOT NULL UNIQUE,
        family_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_uid ON refresh_tokens(uid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti ON refresh_tokens(token_jti)`);

    db.exec(`CREATE TABLE IF NOT EXISTS access_token_blacklist (
        jti TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON access_token_blacklist(expires_at)`);

    cleanExpiredData();
    return db;
}

/** better-sqlite3 自动持久化，此函数保留兼容性（空操作） */
function saveDatabase() { cleanExpiredData(); }
function requestSaveAuthDb() {}
function cancelPendingAuthSave() {}

/** 清理过期的验证码（5分钟）、刷新令牌和黑名单条目 */
function cleanExpiredData() {
    if (!db) return;
    try {
        const now = Date.now();
        const captchaExpire = now - 5 * 60 * 1000;
        db.prepare('DELETE FROM captcha WHERE created_at < ?').run(captchaExpire);
        db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
        db.prepare('DELETE FROM access_token_blacklist WHERE expires_at < ?').run(now);
    } catch (e) {
        logger.error('清理过期数据失败:', e.message);
    }
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_LENGTH, 'sha512').toString('hex');
}

function generateSalt() {
    return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

function setPassword(uid, password) {
    const salt = generateSalt();
    const hash = hashPassword(password, salt);
    const existing = db.prepare('SELECT uid FROM users WHERE uid = ?').get(uid);
    if (existing) {
        db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime(\'now\', \'localtime\') WHERE uid = ?').run(hash, salt, uid);
    } else {
        db.prepare('INSERT INTO users (uid, password_hash, salt) VALUES (?, ?, ?)').run(uid, hash, salt);
    }
    return true;
}

function verifyPassword(uid, password) {
    const row = db.prepare('SELECT password_hash, salt FROM users WHERE uid = ?').get(uid);
    if (!row) return false;
    const hash = hashPassword(password, row.salt);
    try {
        if (hash.length !== row.password_hash.length) return false;
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.password_hash, 'hex'));
    } catch (e) { return false; }
}

function hasPassword(uid) {
    return !!db.prepare('SELECT uid FROM users WHERE uid = ?').get(uid);
}

function addAdmin(uid) {
    if (db.prepare('SELECT uid FROM admins WHERE uid = ?').get(uid)) return false;
    db.prepare('INSERT INTO admins (uid) VALUES (?)').run(uid);
    return true;
}

function removeAdmin(uid) {
    if (!db.prepare('SELECT uid FROM admins WHERE uid = ?').get(uid)) return false;
    db.prepare('DELETE FROM admins WHERE uid = ?').run(uid);
    return true;
}

function isAdmin(uid) {
    return !!db.prepare('SELECT uid FROM admins WHERE uid = ?').get(uid);
}

function getAllAdmins() {
    return db.prepare('SELECT uid, added_at FROM admins').all();
}

function generateCaptcha(code) {
    const captchaId = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO captcha (captcha_id, code, created_at) VALUES (?, ?, ?)').run(captchaId, code, Date.now());
    return captchaId;
}

function verifyCaptcha(captchaId, input) {
    const row = db.prepare('SELECT code, created_at FROM captcha WHERE captcha_id = ?').get(captchaId);
    if (!row) return false;
    if (Date.now() - row.created_at > 5 * 60 * 1000) {
        db.prepare('DELETE FROM captcha WHERE captcha_id = ?').run(captchaId);
        return false;
    }
    db.prepare('DELETE FROM captcha WHERE captcha_id = ?').run(captchaId);
    return row.code.toLowerCase() === input.toLowerCase();
}

function cleanExpiredCaptchas() {
    db.prepare('DELETE FROM captcha WHERE created_at < ?').run(Date.now() - 5 * 60 * 1000);
}

function saveRefreshToken(uid, jti, familyId, expiresAt) {
    db.prepare('INSERT INTO refresh_tokens (uid, token_jti, family_id, created_at, expires_at, is_revoked) VALUES (?, ?, ?, ?, ?, 0)').run(uid, jti, familyId, Date.now(), expiresAt);
}

function findRefreshToken(jti) {
    const row = db.prepare('SELECT id, uid, token_jti, family_id, created_at, expires_at, is_revoked FROM refresh_tokens WHERE token_jti = ?').get(jti);
    if (!row) return null;
    return { id: row.id, uid: row.uid, tokenJti: row.token_jti, familyId: row.family_id, createdAt: row.created_at, expiresAt: row.expires_at, isRevoked: row.is_revoked === 1 };
}

function revokeRefreshToken(jti) { db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_jti = ?').run(jti); }
function revokeFamilyTokens(familyId) { db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE family_id = ?').run(familyId); }
function revokeAllUserTokens(uid) { db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE uid = ?').run(uid); }
function cleanExpiredRefreshTokens() { db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(Date.now()); }

function blacklistAccessToken(jti, expiresAt) {
    db.prepare('INSERT OR IGNORE INTO access_token_blacklist (jti, expires_at) VALUES (?, ?)').run(jti, expiresAt);
}

function isAccessTokenBlacklisted(jti) {
    return !!db.prepare('SELECT jti FROM access_token_blacklist WHERE jti = ?').get(jti);
}

function cleanExpiredBlacklist() {
    db.prepare('DELETE FROM access_token_blacklist WHERE expires_at < ?').run(Date.now());
}

// ============ 玩家数据库 ============

/** 初始化玩家数据库，启用 WAL 模式和 64MB 缓存 */
function initPlayerDatabase() {
    ensureDir(PLAYER_DB_PATH);
    playerDb = new Database(PLAYER_DB_PATH);
    playerDb.pragma('journal_mode = WAL');
    playerDb.pragma('synchronous = NORMAL');
    playerDb.pragma('cache_size = -64000');

    playerDb.exec(`CREATE TABLE IF NOT EXISTS player_data (
        xuid TEXT PRIMARY KEY, uid INTEGER, name TEXT, uuid TEXT,
        register_time TEXT, leave_time TEXT, health_bonus INTEGER DEFAULT 0,
        rw TEXT, tax_data TEXT DEFAULT '{}', bank_data TEXT DEFAULT '{}',
        quick_menu TEXT DEFAULT '{}', vip_data TEXT DEFAULT '{}',
        avatar TEXT DEFAULT '{}', count TEXT DEFAULT '{}',
        last_ip TEXT DEFAULT '', platform TEXT DEFAULT ''
    )`);
    try { playerDb.exec("ALTER TABLE player_data ADD COLUMN last_ip TEXT DEFAULT ''"); } catch (e) {}
    try { playerDb.exec("ALTER TABLE player_data ADD COLUMN platform TEXT DEFAULT ''"); } catch (e) {}
    playerDb.exec('CREATE TABLE IF NOT EXISTS player_settings (xuid TEXT, key TEXT, value TEXT, PRIMARY KEY (xuid, key))');
    playerDb.exec('CREATE TABLE IF NOT EXISTS death_points (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, data TEXT)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS friends (xuid TEXT, friend_xuid TEXT, friend_name TEXT, add_time TEXT, PRIMARY KEY (xuid, friend_xuid))');
    playerDb.exec('CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, from_xuid TEXT, from_name TEXT, message TEXT, time TEXT, handled INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, from_xuid TEXT, from_name TEXT, to_xuid TEXT, to_name TEXT, content TEXT, time TEXT, is_read INTEGER DEFAULT 0)');
    playerDb.exec('CREATE TABLE IF NOT EXISTS homes (xuid TEXT, name TEXT, x REAL, y REAL, z REAL, dim INTEGER, last_use TEXT, PRIMARY KEY (xuid, name))');
    playerDb.exec('CREATE TABLE IF NOT EXISTS player_inventory (xuid TEXT PRIMARY KEY, items TEXT DEFAULT \'[]\', armor TEXT DEFAULT \'[]\', offhand TEXT DEFAULT \'[]\', save_time TEXT)');
    try { playerDb.exec('ALTER TABLE player_inventory ADD COLUMN armor TEXT DEFAULT \'[]\''); } catch (e) {}
    try { playerDb.exec('ALTER TABLE player_inventory ADD COLUMN offhand TEXT DEFAULT \'[]\''); } catch (e) {}

    createGuildTables();
    createPlayerCountTable();

    playerDbReady = true;
    dbDebugLog('initPlayerDatabase: 数据库就绪');
    return playerDb;
}

function isPlayerDbReady() { return playerDbReady && playerDb !== null; }

// better-sqlite3 自动持久化，以下函数保留兼容性（空操作）
function markPlayerDbDirty() {}
function savePlayerDatabase() {}
function requestSavePlayerDb() {}
function cancelPendingSave() {}

// --- 玩家核心数据 ---

function getPlayerDataSQL(xuid) {
    if (!playerDb) return null;
    const row = playerDb.prepare('SELECT uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, last_ip, platform FROM player_data WHERE xuid = ?').get(xuid);
    if (!row) return null;
    return {
        uid: row.uid, name: row.name, uuid: row.uuid, registerTime: row.register_time,
        leavetime: row.leave_time, healthBonus: row.health_bonus, rw: row.rw,
        taxdata: JSON.parse(row.tax_data || '{}'), bankdata: JSON.parse(row.bank_data || '{}'),
        quickmenu: JSON.parse(row.quick_menu || '{}'), vipdata: JSON.parse(row.vip_data || '{}'),
        avatar: JSON.parse(row.avatar || '{}'), count: JSON.parse(row.count || '{}'),
        lastIp: row.last_ip || '', platform: row.platform || ''
    };
}

function setPlayerDataSQL(xuid, data) {
    if (!playerDb) return;
    playerDb.prepare(`INSERT OR REPLACE INTO player_data
        (xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, last_ip, platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        xuid, data.uid, data.name, data.uuid, data.registerTime,
        String(data.leavetime || ''), data.healthBonus || 0, data.rw,
        JSON.stringify(data.taxdata || {}), JSON.stringify(data.bankdata || {}),
        JSON.stringify(data.quickmenu || {}), JSON.stringify(data.vipdata || {}),
        JSON.stringify(data.avatar || {}), JSON.stringify(data.count || {}),
        data.lastIp || '', data.platform || ''
    );
}

function updateLeaveTimeSQL(xuid, timestamp) {
    if (!playerDb) return;
    playerDb.prepare('UPDATE player_data SET leave_time = ? WHERE xuid = ?').run(String(timestamp), xuid);
}

function updatePlayTimeSQL(xuid, playTime) {
    if (!playerDb) return;
    playerDb.prepare("UPDATE player_data SET count = json_set(COALESCE(count, '{}'), '$.playTime', ?) WHERE xuid = ?").run(playTime, xuid);
}

function getAllPlayerDataSQL() {
    if (!playerDb) return {};
    dbDebugLog('getAllPlayerDataSQL: 查询所有玩家数据');
    const rows = playerDb.prepare('SELECT xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count, last_ip, platform FROM player_data').all();
    const players = {};
    rows.forEach(function(r) {
        players[r.xuid] = {
            uid: r.uid, name: r.name, uuid: r.uuid, registerTime: r.register_time,
            leavetime: r.leave_time, healthBonus: r.health_bonus, rw: r.rw,
            taxdata: JSON.parse(r.tax_data || '{}'), bankdata: JSON.parse(r.bank_data || '{}'),
            quickmenu: JSON.parse(r.quick_menu || '{}'), vipdata: JSON.parse(r.vip_data || '{}'),
            avatar: JSON.parse(r.avatar || '{}'), count: JSON.parse(r.count || '{}'),
            lastIp: r.last_ip || '', platform: r.platform || ''
        };
    });
    return players;
}

function getNextUidSQL() {
    if (!playerDb) return 10000;
    const row = playerDb.prepare('SELECT MAX(uid) as maxUid FROM player_data').get();
    return (row && row.maxUid ? row.maxUid : 10000) + 1;
}

// --- 玩家设置 ---

function getPlayerSettingsSQL(xuid) {
    if (!playerDb) return {};
    const rows = playerDb.prepare('SELECT key, value FROM player_settings WHERE xuid = ?').all(xuid);
    const settings = {};
    rows.forEach(function(r) {
        try { settings[r.key] = JSON.parse(r.value); } catch (e) { settings[r.key] = r.value; }
    });
    return settings;
}

function getAllPlayerSettingsSQL() {
    if (!playerDb) return {};
    const rows = playerDb.prepare('SELECT xuid, key, value FROM player_settings').all();
    const all = {};
    rows.forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = {};
        try { all[r.xuid][r.key] = JSON.parse(r.value); } catch (e) { all[r.xuid][r.key] = r.value; }
    });
    return all;
}

function setPlayerSettingSQL(xuid, key, value) {
    if (!playerDb) return;
    playerDb.prepare('INSERT OR REPLACE INTO player_settings (xuid, key, value) VALUES (?, ?, ?)').run(xuid, key, JSON.stringify(value));
}

// --- 死亡点 ---

function getDeathPointsSQL(xuid) {
    if (!playerDb) return [];
    return playerDb.prepare('SELECT data FROM death_points WHERE xuid = ? ORDER BY id').all(xuid).map(function(r) { return JSON.parse(r.data); });
}

function getAllDeathPointsSQL() {
    if (!playerDb) return {};
    const rows = playerDb.prepare('SELECT xuid, data FROM death_points ORDER BY id').all();
    const all = {};
    rows.forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = [];
        all[r.xuid].push(JSON.parse(r.data));
    });
    return all;
}

function setDeathPointsSQL(xuid, points) {
    if (!playerDb) return;
    const insert = playerDb.prepare('INSERT INTO death_points (xuid, data) VALUES (?, ?)');
    playerDb.transaction(function() {
        playerDb.prepare('DELETE FROM death_points WHERE xuid = ?').run(xuid);
        if (points && points.length > 0) {
            points.forEach(function(p) { insert.run(xuid, JSON.stringify(p)); });
        }
    })();
}

// --- 好友 ---

function getFriendsSQL(xuid) {
    if (!playerDb) return { friends: [], requests: [], sentRequests: [] };
    const friends = playerDb.prepare('SELECT friend_xuid, friend_name, add_time FROM friends WHERE xuid = ?').all(xuid).map(function(r) {
        return { xuid: r.friend_xuid, name: r.friend_name, addTime: r.add_time };
    });
    const requests = playerDb.prepare('SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 0').all(xuid).map(function(r) {
        return { xuid: r.from_xuid, name: r.from_name, message: r.message, time: r.time, handled: r.handled === 1, rejected: r.rejected === 1 };
    });
    const sentRequests = playerDb.prepare('SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 1').all(xuid).map(function(r) {
        return { xuid: r.from_xuid, name: r.from_name, message: r.message, time: r.time, handled: r.handled === 1, rejected: r.rejected === 1 };
    });
    return { friends: friends, requests: requests, sentRequests: sentRequests };
}

function getAllFriendsSQL() {
    if (!playerDb) return {};
    const all = {};
    playerDb.prepare('SELECT xuid, friend_xuid, friend_name, add_time FROM friends').all().forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = { friends: [], requests: [], sentRequests: [] };
        all[r.xuid].friends.push({ xuid: r.friend_xuid, name: r.friend_name, addTime: r.add_time });
    });
    playerDb.prepare('SELECT xuid, from_xuid, from_name, message, time, handled, rejected, is_sent FROM friend_requests').all().forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = { friends: [], requests: [], sentRequests: [] };
        var entry = { xuid: r.from_xuid, name: r.from_name, message: r.message, time: r.time, handled: r.handled === 1, rejected: r.rejected === 1 };
        if (r.is_sent === 1) { all[r.xuid].sentRequests.push(entry); } else { all[r.xuid].requests.push(entry); }
    });
    return all;
}

function addFriendSQL(xuid, friendXuid, friendName, addTime) {
    if (!playerDb) return;
    playerDb.prepare('INSERT OR REPLACE INTO friends (xuid, friend_xuid, friend_name, add_time) VALUES (?, ?, ?, ?)').run(xuid, friendXuid, friendName, addTime);
}

function removeFriendSQL(xuid, friendXuid) {
    if (!playerDb) return;
    playerDb.prepare('DELETE FROM friends WHERE xuid = ? AND friend_xuid = ?').run(xuid, friendXuid);
}

function addFriendRequestSQL(xuid, fromXuid, fromName, message, time, isSent) {
    if (!playerDb) return;
    playerDb.prepare('INSERT INTO friend_requests (xuid, from_xuid, from_name, message, time, handled, rejected, is_sent) VALUES (?, ?, ?, ?, ?, 0, 0, ?)').run(xuid, fromXuid, fromName, message, time, isSent ? 1 : 0);
}

function handleFriendRequestSQL(xuid, fromXuid, rejected) {
    if (!playerDb) return;
    playerDb.prepare('UPDATE friend_requests SET handled = 1, rejected = ? WHERE xuid = ? AND from_xuid = ? AND handled = 0').run(rejected ? 1 : 0, xuid, fromXuid);
}

function clearFriendsSQL(xuid) { if (playerDb) playerDb.prepare('DELETE FROM friends WHERE xuid = ?').run(xuid); }
function clearFriendRequestsSQL(xuid) { if (playerDb) playerDb.prepare('DELETE FROM friend_requests WHERE xuid = ?').run(xuid); }

// --- 私信消息 ---

function getMessagesSQL(xuid) {
    if (!playerDb) return [];
    return playerDb.prepare('SELECT from_xuid, from_name, to_xuid, to_name, content, time, is_read FROM messages WHERE xuid = ? ORDER BY id').all(xuid).map(function(r) {
        return { fromXuid: r.from_xuid, fromName: r.from_name, toXuid: r.to_xuid, toName: r.to_name, content: r.content, time: r.time, read: r.is_read === 1 };
    });
}

function getAllMessagesSQL() {
    if (!playerDb) return {};
    const all = {};
    playerDb.prepare('SELECT xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read FROM messages ORDER BY xuid, id').all().forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = { messages: [] };
        all[r.xuid].messages.push({ fromXuid: r.from_xuid, fromName: r.from_name, toXuid: r.to_xuid, toName: r.to_name, content: r.content, time: r.time, read: r.is_read === 1 });
    });
    return all;
}

function addMessageSQL(xuid, msg) {
    if (!playerDb || !msg) return;
    playerDb.prepare('INSERT INTO messages (xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        xuid, msg.fromXuid || '', msg.fromName || '', msg.toXuid || '', msg.toName || '', msg.content || '', msg.time || '', msg.read ? 1 : 0);
}

function markMessagesReadSQL(xuid, fromXuid) {
    if (!playerDb) return;
    playerDb.prepare('UPDATE messages SET is_read = 1 WHERE xuid = ? AND from_xuid = ? AND is_read = 0').run(xuid, fromXuid);
}

function deleteMessageSQL(xuid, fromXuid, time) {
    if (!playerDb) return;
    playerDb.prepare('DELETE FROM messages WHERE xuid = ? AND from_xuid = ? AND time = ?').run(xuid, fromXuid, time);
}

function clearMessagesSQL(xuid) { if (playerDb) playerDb.prepare('DELETE FROM messages WHERE xuid = ?').run(xuid); }

// --- 家园传送点 ---

function getHomesSQL(xuid) {
    if (!playerDb) return [];
    return playerDb.prepare('SELECT name, x, y, z, dim, last_use FROM homes WHERE xuid = ?').all(xuid).map(function(r) {
        return { name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, lastUse: r.last_use };
    });
}

function getAllHomesSQL() {
    if (!playerDb) return {};
    const all = {};
    playerDb.prepare('SELECT xuid, name, x, y, z, dim, last_use FROM homes').all().forEach(function(r) {
        if (!all[r.xuid]) all[r.xuid] = [];
        all[r.xuid].push({ name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, lastUse: r.last_use });
    });
    return all;
}

function setHomesSQL(xuid, homes) {
    if (!playerDb) return;
    const insert = playerDb.prepare('INSERT INTO homes (xuid, name, x, y, z, dim, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)');
    playerDb.transaction(function() {
        playerDb.prepare('DELETE FROM homes WHERE xuid = ?').run(xuid);
        if (homes && homes.length > 0) {
            homes.forEach(function(h) { insert.run(xuid, h.name, h.x, h.y, h.z, h.dim || 0, h.lastUse || 0); });
        }
    })();
}

function addHomeSQL(xuid, home) {
    if (!playerDb) return;
    playerDb.prepare('INSERT INTO homes (xuid, name, x, y, z, dim, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)').run(xuid, home.name, home.x, home.y, home.z, home.dim || 0, home.lastUse || 0);
}

function removeHomeSQL(xuid, name) {
    if (!playerDb) return;
    playerDb.prepare('DELETE FROM homes WHERE xuid = ? AND name = ?').run(xuid, name);
}

function updateHomeSQL(xuid, name, home) {
    if (!playerDb) return;
    playerDb.prepare('UPDATE homes SET x = ?, y = ?, z = ?, dim = ?, last_use = ? WHERE xuid = ? AND name = ?').run(home.x, home.y, home.z, home.dim || 0, home.lastUse || 0, xuid, name);
}

function savePlayerInventorySQL(xuid, items, armor, offhand) {
    if (!playerDb) return;
    playerDb.prepare('INSERT OR REPLACE INTO player_inventory (xuid, items, armor, offhand, save_time) VALUES (?, ?, ?, ?, ?)').run(
        xuid, JSON.stringify(items || []), JSON.stringify(armor || []), JSON.stringify(offhand || []), String(Date.now()));
}

function getPlayerInventorySQL(xuid) {
    if (!playerDb) return null;
    const row = playerDb.prepare('SELECT items, armor, offhand, save_time FROM player_inventory WHERE xuid = ?').get(xuid);
    if (!row) return null;
    return { items: JSON.parse(row.items || '[]'), armor: JSON.parse(row.armor || '[]'), offhand: JSON.parse(row.offhand || '[]'), saveTime: row.save_time };
}

// ============ 公会系统 SQL 方法 ============

function createGuildTables() {
    if (!playerDb) return;
    playerDb.exec(`CREATE TABLE IF NOT EXISTS guilds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT DEFAULT '',
        owner TEXT NOT NULL, level INTEGER DEFAULT 1, fund REAL DEFAULT 0, max_members INTEGER DEFAULT 20,
        hq_x REAL, hq_y REAL, hq_z REAL, hq_dim TEXT, created_at INTEGER NOT NULL
    )`);
    playerDb.exec(`CREATE TABLE IF NOT EXISTS guild_members (
        xuid TEXT NOT NULL, guild_id INTEGER NOT NULL, role TEXT DEFAULT 'member',
        joined_at INTEGER NOT NULL, PRIMARY KEY (xuid), FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
    )`);
    playerDb.exec(`CREATE TABLE IF NOT EXISTS guild_teleports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, name TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, dim TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
    )`);
    dbDebugLog('createGuildTables: 公会表创建完成');
}

function createPlayerCountTable() {
    if (!playerDb) return;
    playerDb.exec('CREATE TABLE IF NOT EXISTS player_count_history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, count INTEGER NOT NULL)');
    playerDb.exec('CREATE INDEX IF NOT EXISTS idx_player_count_ts ON player_count_history(timestamp)');
    dbDebugLog('createPlayerCountTable: 玩家人数统计表创建完成');
}

function insertPlayerCount(timestamp, count) {
    if (!playerDb) return;
    playerDb.prepare('INSERT INTO player_count_history (timestamp, count) VALUES (?, ?)').run(timestamp, count);
    playerDb.prepare('DELETE FROM player_count_history WHERE timestamp < ?').run(timestamp - 7 * 24 * 60 * 60);
}

function getPlayerCountHistory(startTime, endTime) {
    if (!playerDb) return [];
    return playerDb.prepare('SELECT timestamp, count FROM player_count_history WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(startTime, endTime);
}

function getPlayerCountLatest() {
    if (!playerDb) return null;
    return playerDb.prepare('SELECT timestamp, count FROM player_count_history ORDER BY timestamp DESC LIMIT 1').get() || null;
}

function createGuild(name, description, owner, maxMembers) {
    if (!playerDb) return null;
    const now = Date.now();
    const info = playerDb.prepare('INSERT INTO guilds (name, description, owner, max_members, created_at) VALUES (?, ?, ?, ?, ?)').run(name, description || '', owner, maxMembers || 20, now);
    const guildId = info.lastInsertRowid;
    playerDb.prepare('INSERT INTO guild_members (xuid, guild_id, role, joined_at) VALUES (?, ?, ?, ?)').run(owner, guildId, 'owner', now);
    return guildId;
}

function _rowToGuild(r) {
    if (!r) return null;
    return { id: r.id, name: r.name, description: r.description, owner: r.owner, level: r.level, fund: r.fund, maxMembers: r.max_members, hqX: r.hq_x, hqY: r.hq_y, hqZ: r.hq_z, hqDim: r.hq_dim, createdAt: r.created_at };
}

function getGuild(guildId) { return _rowToGuild(playerDb.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId)); }
function getGuildByName(name) { return _rowToGuild(playerDb.prepare('SELECT * FROM guilds WHERE name = ?').get(name)); }
function getGuildByPlayer(xuid) {
    return _rowToGuild(playerDb.prepare('SELECT g.* FROM guilds g INNER JOIN guild_members gm ON g.id = gm.guild_id WHERE gm.xuid = ?').get(xuid));
}
function getAllGuilds() { return playerDb.prepare('SELECT * FROM guilds ORDER BY id').all().map(_rowToGuild); }

function deleteGuild(guildId) {
    if (!playerDb) return;
    playerDb.prepare('DELETE FROM guild_teleports WHERE guild_id = ?').run(guildId);
    playerDb.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(guildId);
    playerDb.prepare('DELETE FROM guilds WHERE id = ?').run(guildId);
}

function updateGuild(guildId, fields) {
    if (!playerDb || !fields) return;
    const fieldMap = { name: 'name', description: 'description', owner: 'owner', level: 'level', fund: 'fund', maxMembers: 'max_members', hqX: 'hq_x', hqY: 'hq_y', hqZ: 'hq_z', hqDim: 'hq_dim' };
    const sets = [], vals = [];
    for (var key in fields) { if (fields.hasOwnProperty(key) && fieldMap[key]) { sets.push(fieldMap[key] + ' = ?'); vals.push(fields[key]); } }
    if (sets.length === 0) return;
    vals.push(guildId);
    playerDb.prepare('UPDATE guilds SET ' + sets.join(', ') + ' WHERE id = ?').run(vals);
}

function addGuildMember(xuid, guildId, role) {
    if (!playerDb) return;
    playerDb.prepare('INSERT OR REPLACE INTO guild_members (xuid, guild_id, role, joined_at) VALUES (?, ?, ?, ?)').run(xuid, guildId, role || 'member', Date.now());
}

function removeGuildMember(xuid) { if (playerDb) playerDb.prepare('DELETE FROM guild_members WHERE xuid = ?').run(xuid); }

function getGuildMembers(guildId) {
    if (!playerDb) return [];
    return playerDb.prepare('SELECT gm.xuid, gm.role, gm.joined_at, pd.name FROM guild_members gm LEFT JOIN player_data pd ON gm.xuid = pd.xuid WHERE gm.guild_id = ? ORDER BY gm.joined_at').all(guildId).map(function(r) {
        return { xuid: r.xuid, role: r.role, joinedAt: r.joined_at, name: r.name || r.xuid };
    });
}

function getMemberCount(guildId) {
    if (!playerDb) return 0;
    const row = playerDb.prepare('SELECT COUNT(*) as cnt FROM guild_members WHERE guild_id = ?').get(guildId);
    return row ? row.cnt : 0;
}

function getMemberRole(xuid) {
    if (!playerDb) return null;
    const row = playerDb.prepare('SELECT role FROM guild_members WHERE xuid = ?').get(xuid);
    return row ? row.role : null;
}

function updateMemberRole(xuid, role) { if (playerDb) playerDb.prepare('UPDATE guild_members SET role = ? WHERE xuid = ?').run(role, xuid); }

function addGuildTeleport(guildId, name, x, y, z, dim, createdBy) {
    if (!playerDb) return;
    playerDb.prepare('INSERT INTO guild_teleports (guild_id, name, x, y, z, dim, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(guildId, name, x, y, z, dim, createdBy, Date.now());
}

function removeGuildTeleport(tpId, guildId) { if (playerDb) playerDb.prepare('DELETE FROM guild_teleports WHERE id = ? AND guild_id = ?').run(tpId, guildId); }

function getGuildTeleports(guildId) {
    if (!playerDb) return [];
    return playerDb.prepare('SELECT id, name, x, y, z, dim, created_by, created_at FROM guild_teleports WHERE guild_id = ? ORDER BY id').all(guildId).map(function(r) {
        return { id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, createdBy: r.created_by, createdAt: r.created_at };
    });
}

function getGuildTeleportCount(guildId) {
    if (!playerDb) return 0;
    const row = playerDb.prepare('SELECT COUNT(*) as cnt FROM guild_teleports WHERE guild_id = ?').get(guildId);
    return row ? row.cnt : 0;
}

function getGuildTeleportByName(guildId, name) {
    if (!playerDb) return null;
    const r = playerDb.prepare('SELECT id, name, x, y, z, dim, created_by, created_at FROM guild_teleports WHERE guild_id = ? AND name = ?').get(guildId, name);
    if (!r) return null;
    return { id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, dim: r.dim, createdBy: r.created_by, createdAt: r.created_at };
}

// --- 批量操作 ---

/** 在事务中批量执行写入操作（better-sqlite3 原生事务，原子性保证） */
function batchSavePlayerDb(operations) {
    if (!playerDb) return;
    const txn = playerDb.transaction(function() { operations.forEach(function(op) { op(); }); });
    try { txn(); } catch (e) { logger.error('[PlayerDB] 批量操作失败:', e.message); }
}

// --- 通用 SQL DataManager 辅助方法 ---

function sqlGetAll(prefix) {
    if (!playerDb) return {};
    try {
        const rows = playerDb.prepare('SELECT xuid, data FROM dm_' + prefix).all();
        const all = {};
        rows.forEach(function(r) { try { all[r.xuid] = JSON.parse(r.data); } catch (e) { all[r.xuid] = {}; } });
        return all;
    } catch (e) { return {}; }
}

function sqlSet(prefix, xuid, data) {
    if (!playerDb) return;
    playerDb.prepare('INSERT OR REPLACE INTO dm_' + prefix + ' (xuid, data) VALUES (?, ?)').run(xuid, JSON.stringify(data));
}

function sqlDelete(prefix, xuid) {
    if (!playerDb) return;
    playerDb.prepare('DELETE FROM dm_' + prefix + ' WHERE xuid = ?').run(xuid);
}

function sqlEnsureTable(prefix) {
    if (!playerDb) return;
    playerDb.exec('CREATE TABLE IF NOT EXISTS dm_' + prefix + ' (xuid TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT "{}")');
}

module.exports = {
    initDatabase, saveDatabase, requestSaveAuthDb, cancelPendingAuthSave,
    setPassword, verifyPassword, hasPassword, addAdmin, removeAdmin, isAdmin, getAllAdmins,
    generateCaptcha, verifyCaptcha, cleanExpiredCaptchas,
    saveRefreshToken, findRefreshToken, revokeRefreshToken, revokeFamilyTokens, revokeAllUserTokens, cleanExpiredRefreshTokens,
    blacklistAccessToken, isAccessTokenBlacklisted, cleanExpiredBlacklist,
    initPlayerDatabase, isPlayerDbReady, savePlayerDatabase, markPlayerDbDirty, requestSavePlayerDb, cancelPendingSave,
    getPlayerDataSQL, setPlayerDataSQL, updateLeaveTimeSQL, updatePlayTimeSQL, getAllPlayerDataSQL, getNextUidSQL,
    getPlayerSettingsSQL, getAllPlayerSettingsSQL, setPlayerSettingSQL,
    getDeathPointsSQL, getAllDeathPointsSQL, setDeathPointsSQL,
    getFriendsSQL, getAllFriendsSQL, addFriendSQL, removeFriendSQL, addFriendRequestSQL, handleFriendRequestSQL, clearFriendsSQL, clearFriendRequestsSQL,
    getMessagesSQL, getAllMessagesSQL, addMessageSQL, markMessagesReadSQL, deleteMessageSQL, clearMessagesSQL,
    getHomesSQL, getAllHomesSQL, setHomesSQL, addHomeSQL, removeHomeSQL, updateHomeSQL,
    batchSavePlayerDb, savePlayerInventorySQL, getPlayerInventorySQL,
    createGuildTables, createGuild, getGuild, getGuildByName, getGuildByPlayer, getAllGuilds, deleteGuild, updateGuild,
    addGuildMember, removeGuildMember, getGuildMembers, getMemberCount, getMemberRole, updateMemberRole,
    addGuildTeleport, removeGuildTeleport, getGuildTeleports, getGuildTeleportCount, getGuildTeleportByName,
    insertPlayerCount, getPlayerCountHistory, getPlayerCountLatest,
    sqlGetAll, sqlSet, sqlDelete, sqlEnsureTable,
    setDebugMode
};
