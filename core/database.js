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

const initSqlJs = require('sql.js');
const fs = require('fs');
const pathModule = require('path');
const crypto = require('crypto');

const DB_PATH = 'plugins/NLCE/data/nlce.db';
const PLAYER_DB_PATH = 'plugins/NLCE/data/playerdata.db';
const SALT_LENGTH = 32;
const HASH_ITERATIONS = 10000;
const HASH_LENGTH = 64;

let db = null;
let playerDb = null;
let playerDbReady = false;

function ensureDir(filePath) {
    var dir = pathModule.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

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

function saveDatabase() {
    if (!db) return;
    try {
        cleanExpiredData();
        const data = db.export();
        const buffer = Buffer.from(data);
        ensureDir(DB_PATH);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
        console.error('保存数据库失败:', e.message);
    }
}

function cleanExpiredData() {
    if (!db) return;
    try {
        var now = Date.now();
        var captchaExpire = now - 5 * 60 * 1000;
        db.run('DELETE FROM captcha WHERE created_at < ?', [captchaExpire]);
        db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [now]);
        db.run('DELETE FROM access_token_blacklist WHERE expires_at < ?', [now]);
    } catch (e) {
        console.error('清理过期数据失败:', e.message);
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

    const existing = db.exec('SELECT uid FROM users WHERE uid = ?', [uid]);
    if (existing.length > 0 && existing[0].values.length > 0) {
        db.run('UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime(\'now\', \'localtime\') WHERE uid = ?', [hash, salt, uid]);
    } else {
        db.run('INSERT INTO users (uid, password_hash, salt) VALUES (?, ?, ?)', [uid, hash, salt]);
    }
    saveDatabase();
    return true;
}

function verifyPassword(uid, password) {
    const result = db.exec('SELECT password_hash, salt FROM users WHERE uid = ?', [uid]);
    if (result.length === 0 || result[0].values.length === 0) return false;

    const storedHash = result[0].values[0][0];
    const salt = result[0].values[0][1];
    const hash = hashPassword(password, salt);
    return hash === storedHash;
}

function hasPassword(uid) {
    const result = db.exec('SELECT uid FROM users WHERE uid = ?', [uid]);
    return result.length > 0 && result[0].values.length > 0;
}

function addAdmin(uid) {
    const existing = db.exec('SELECT uid FROM admins WHERE uid = ?', [uid]);
    if (existing.length > 0 && existing[0].values.length > 0) return false;
    db.run('INSERT INTO admins (uid) VALUES (?)', [uid]);
    saveDatabase();
    return true;
}

function removeAdmin(uid) {
    const existing = db.exec('SELECT uid FROM admins WHERE uid = ?', [uid]);
    if (existing.length === 0 || existing[0].values.length === 0) return false;
    db.run('DELETE FROM admins WHERE uid = ?', [uid]);
    saveDatabase();
    return true;
}

function isAdmin(uid) {
    const result = db.exec('SELECT uid FROM admins WHERE uid = ?', [uid]);
    return result.length > 0 && result[0].values.length > 0;
}

function getAllAdmins() {
    const result = db.exec('SELECT uid, added_at FROM admins');
    if (result.length === 0) return [];
    return result[0].values.map(row => ({ uid: row[0], added_at: row[1] }));
}

function generateCaptcha(code) {
    const captchaId = crypto.randomBytes(16).toString('hex');
    const createdAt = Date.now();

    db.run('INSERT INTO captcha (captcha_id, code, created_at) VALUES (?, ?, ?)', [captchaId, code, createdAt]);
    saveDatabase();
    return captchaId;
}

function verifyCaptcha(captchaId, input) {
    const result = db.exec('SELECT code, created_at FROM captcha WHERE captcha_id = ?', [captchaId]);
    if (result.length === 0 || result[0].values.length === 0) return false;

    const code = result[0].values[0][0];
    const createdAt = result[0].values[0][1];

    if (Date.now() - createdAt > 5 * 60 * 1000) {
        db.run('DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
        saveDatabase();
        return false;
    }

    db.run('DELETE FROM captcha WHERE captcha_id = ?', [captchaId]);
    saveDatabase();

    return code.toLowerCase() === input.toLowerCase();
}

function cleanExpiredCaptchas() {
    const expireTime = Date.now() - 5 * 60 * 1000;
    db.run('DELETE FROM captcha WHERE created_at < ?', [expireTime]);
    saveDatabase();
}

function saveRefreshToken(uid, jti, familyId, expiresAt) {
    var now = Date.now();
    db.run(
        'INSERT INTO refresh_tokens (uid, token_jti, family_id, created_at, expires_at, is_revoked) VALUES (?, ?, ?, ?, ?, 0)',
        [uid, jti, familyId, now, expiresAt]
    );
    saveDatabase();
}

function findRefreshToken(jti) {
    var result = db.exec(
        'SELECT id, uid, token_jti, family_id, created_at, expires_at, is_revoked FROM refresh_tokens WHERE token_jti = ?',
        [jti]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;

    var row = result[0].values[0];
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

function revokeRefreshToken(jti) {
    db.run('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_jti = ?', [jti]);
    saveDatabase();
}

function revokeFamilyTokens(familyId) {
    db.run('UPDATE refresh_tokens SET is_revoked = 1 WHERE family_id = ?', [familyId]);
    saveDatabase();
}

function revokeAllUserTokens(uid) {
    db.run('UPDATE refresh_tokens SET is_revoked = 1 WHERE uid = ?', [uid]);
    saveDatabase();
}

function cleanExpiredRefreshTokens() {
    var now = Date.now();
    db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [now]);
    saveDatabase();
}

function blacklistAccessToken(jti, expiresAt) {
    db.run(
        'INSERT OR IGNORE INTO access_token_blacklist (jti, expires_at) VALUES (?, ?)',
        [jti, expiresAt]
    );
    saveDatabase();
}

function isAccessTokenBlacklisted(jti) {
    var result = db.exec('SELECT jti FROM access_token_blacklist WHERE jti = ?', [jti]);
    return result.length > 0 && result[0].values.length > 0;
}

function cleanExpiredBlacklist() {
    var now = Date.now();
    db.run('DELETE FROM access_token_blacklist WHERE expires_at < ?', [now]);
    saveDatabase();
}

// ===================== 玩家数据 SQL 方法 =====================

async function initPlayerDatabase() {
    ensureDir(PLAYER_DB_PATH);
    const SQL = await initSqlJs();
    if (fs.existsSync(PLAYER_DB_PATH)) {
        const buffer = fs.readFileSync(PLAYER_DB_PATH);
        playerDb = new SQL.Database(buffer);
    } else {
        playerDb = new SQL.Database();
    }
    playerDb.run("PRAGMA journal_mode=WAL");
    playerDb.run("PRAGMA synchronous=NORMAL");
    playerDb.run("PRAGMA cache_size=-64000");
    playerDbReady = true;
    savePlayerDatabase();
    return playerDb;
}

function isPlayerDbReady() {
    return playerDbReady && playerDb !== null;
}

function savePlayerDatabase() {
    if (!playerDb) return;
    try {
        const data = playerDb.export();
        const buffer = Buffer.from(data);
        ensureDir(PLAYER_DB_PATH);
        fs.writeFileSync(PLAYER_DB_PATH, buffer);
    } catch (e) {
        console.error('[PlayerDB] 保存失败:', e.message);
    }
}

// --- 玩家核心数据 ---

function getPlayerDataSQL(xuid) {
    if (!playerDb) return null;
    var result = playerDb.exec(
        'SELECT uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count FROM player_data WHERE xuid = ?',
        [xuid]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    var row = result[0].values[0];
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
        count: JSON.parse(row[12] || '{}')
    };
}

function setPlayerDataSQL(xuid, data) {
    if (!playerDb) return;
    playerDb.run(
        `INSERT OR REPLACE INTO player_data
         (xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [xuid, data.uid, data.name, data.uuid, data.registerTime,
         String(data.leavetime || ''), data.healthBonus || 0, data.rw,
         JSON.stringify(data.taxdata || {}), JSON.stringify(data.bankdata || {}),
         JSON.stringify(data.quickmenu || {}), JSON.stringify(data.vipdata || {}),
         JSON.stringify(data.avatar || {}), JSON.stringify(data.count || {})]
    );
}

function getAllPlayerDataSQL() {
    if (!playerDb) return {};
    var result = playerDb.exec(
        'SELECT xuid, uid, name, uuid, register_time, leave_time, health_bonus, rw, tax_data, bank_data, quick_menu, vip_data, avatar, count FROM player_data'
    );
    var players = {};
    if (result.length === 0) return players;
    var cols = result[0].columns;
    result[0].values.forEach(function(row) {
        var obj = {};
        for (var i = 1; i < cols.length; i++) {
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
            count: JSON.parse(obj.count || '{}')
        };
    });
    return players;
}

function getNextUidSQL() {
    if (!playerDb) return 10000;
    var result = playerDb.exec('SELECT MAX(uid) FROM player_data');
    if (result.length === 0 || result[0].values.length === 0 || result[0].values[0][0] === null) return 10000;
    return (result[0].values[0][0] || 10000) + 1;
}

// --- 玩家设置 ---

function getPlayerSettingsSQL(xuid) {
    if (!playerDb) return {};
    var result = playerDb.exec('SELECT key, value FROM player_settings WHERE xuid = ?', [xuid]);
    var settings = {};
    if (result.length === 0) return settings;
    result[0].values.forEach(function(row) {
        try { settings[row[0]] = JSON.parse(row[1]); }
        catch (e) { settings[row[0]] = row[1]; }
    });
    return settings;
}

function getAllPlayerSettingsSQL() {
    if (!playerDb) return {};
    var result = playerDb.exec('SELECT xuid, key, value FROM player_settings');
    var all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        if (!all[row[0]]) all[row[0]] = {};
        try { all[row[0]][row[1]] = JSON.parse(row[2]); }
        catch (e) { all[row[0]][row[1]] = row[2]; }
    });
    return all;
}

function setPlayerSettingSQL(xuid, key, value) {
    if (!playerDb) return;
    playerDb.run(
        'INSERT OR REPLACE INTO player_settings (xuid, key, value) VALUES (?, ?, ?)',
        [xuid, key, JSON.stringify(value)]
    );
}

// --- 死亡点 ---

function getDeathPointsSQL(xuid) {
    if (!playerDb) return [];
    var result = playerDb.exec('SELECT data FROM death_points WHERE xuid = ? ORDER BY id', [xuid]);
    if (result.length === 0) return [];
    return result[0].values.map(function(row) { return JSON.parse(row[0]); });
}

function getAllDeathPointsSQL() {
    if (!playerDb) return {};
    var result = playerDb.exec('SELECT xuid, data FROM death_points ORDER BY id');
    var all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        if (!all[row[0]]) all[row[0]] = [];
        all[row[0]].push(JSON.parse(row[1]));
    });
    return all;
}

function setDeathPointsSQL(xuid, points) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM death_points WHERE xuid = ?', [xuid]);
    if (points && points.length > 0) {
        var stmt = playerDb.prepare('INSERT INTO death_points (xuid, data) VALUES (?, ?)');
        points.forEach(function(p) {
            stmt.run([xuid, JSON.stringify(p)]);
        });
        stmt.free();
    }
}

// --- 好友 ---

function getFriendsSQL(xuid) {
    if (!playerDb) return { friends: [], requests: [], sentRequests: [] };
    var friends = [];
    var fr = playerDb.exec('SELECT friend_xuid, friend_name, add_time FROM friends WHERE xuid = ?', [xuid]);
    if (fr.length > 0) {
        friends = fr[0].values.map(function(r) { return { xuid: r[0], name: r[1], addTime: r[2] }; });
    }
    var requests = [];
    var req = playerDb.exec('SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 0', [xuid]);
    if (req.length > 0) {
        requests = req[0].values.map(function(r) {
            return { xuid: r[0], name: r[1], message: r[2], time: r[3], handled: r[4] === 1, rejected: r[5] === 1 };
        });
    }
    var sentRequests = [];
    var sent = playerDb.exec('SELECT from_xuid, from_name, message, time, handled, rejected FROM friend_requests WHERE xuid = ? AND is_sent = 1', [xuid]);
    if (sent.length > 0) {
        sentRequests = sent[0].values.map(function(r) {
            return { xuid: r[0], name: r[1], message: r[2], time: r[3], handled: r[4] === 1, rejected: r[5] === 1 };
        });
    }
    return { friends: friends, requests: requests, sentRequests: sentRequests };
}

function getAllFriendsSQL() {
    if (!playerDb) return {};
    var result = playerDb.exec('SELECT DISTINCT xuid FROM friends UNION SELECT DISTINCT xuid FROM friend_requests');
    var all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        all[row[0]] = getFriendsSQL(row[0]);
    });
    return all;
}

function addFriendSQL(xuid, friendXuid, friendName, addTime) {
    if (!playerDb) return;
    playerDb.run('INSERT OR REPLACE INTO friends (xuid, friend_xuid, friend_name, add_time) VALUES (?, ?, ?, ?)',
        [xuid, friendXuid, friendName, addTime]);
}

function removeFriendSQL(xuid, friendXuid) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM friends WHERE xuid = ? AND friend_xuid = ?', [xuid, friendXuid]);
}

function addFriendRequestSQL(xuid, fromXuid, fromName, message, time, isSent) {
    if (!playerDb) return;
    playerDb.run('INSERT INTO friend_requests (xuid, from_xuid, from_name, message, time, handled, rejected, is_sent) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
        [xuid, fromXuid, fromName, message, time, isSent ? 1 : 0]);
}

function handleFriendRequestSQL(xuid, fromXuid, rejected) {
    if (!playerDb) return;
    playerDb.run('UPDATE friend_requests SET handled = 1, rejected = ? WHERE xuid = ? AND from_xuid = ? AND handled = 0',
        [rejected ? 1 : 0, xuid, fromXuid]);
}

function clearFriendRequestsSQL(xuid) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM friend_requests WHERE xuid = ?', [xuid]);
}

// --- 私信消息 ---

function getMessagesSQL(xuid) {
    if (!playerDb) return [];
    var result = playerDb.exec('SELECT from_xuid, from_name, to_xuid, to_name, content, time, is_read FROM messages WHERE xuid = ? ORDER BY id', [xuid]);
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return { fromXuid: r[0], fromName: r[1], toXuid: r[2], toName: r[3], content: r[4], time: r[5], read: r[6] === 1 };
    });
}

function getAllMessagesSQL() {
    if (!playerDb) return {};
    var result = playerDb.exec('SELECT DISTINCT xuid FROM messages');
    var all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        all[row[0]] = { messages: getMessagesSQL(row[0]) };
    });
    return all;
}

function addMessageSQL(xuid, msg) {
    if (!playerDb) return;
    playerDb.run(
        'INSERT INTO messages (xuid, from_xuid, from_name, to_xuid, to_name, content, time, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [xuid, msg.fromXuid, msg.fromName, msg.toXuid, msg.toName, msg.content, msg.time, msg.read ? 1 : 0]
    );
}

function markMessagesReadSQL(xuid, fromXuid) {
    if (!playerDb) return;
    playerDb.run('UPDATE messages SET is_read = 1 WHERE xuid = ? AND from_xuid = ? AND is_read = 0', [xuid, fromXuid]);
}

function deleteMessageSQL(xuid, fromXuid, time) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM messages WHERE xuid = ? AND from_xuid = ? AND time = ?', [xuid, fromXuid, time]);
}

function clearMessagesSQL(xuid) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM messages WHERE xuid = ?', [xuid]);
}

// --- 家园传送点 ---

function getHomesSQL(xuid) {
    if (!playerDb) return [];
    var result = playerDb.exec('SELECT name, x, y, z, dim, last_use FROM homes WHERE xuid = ?', [xuid]);
    if (result.length === 0) return [];
    return result[0].values.map(function(r) {
        return { name: r[0], x: r[1], y: r[2], z: r[3], dim: r[4], lastUse: r[5] };
    });
}

function getAllHomesSQL() {
    if (!playerDb) return {};
    var result = playerDb.exec('SELECT DISTINCT xuid FROM homes');
    var all = {};
    if (result.length === 0) return all;
    result[0].values.forEach(function(row) {
        all[row[0]] = getHomesSQL(row[0]);
    });
    return all;
}

function setHomesSQL(xuid, homes) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM homes WHERE xuid = ?', [xuid]);
    if (homes && homes.length > 0) {
        var stmt = playerDb.prepare('INSERT INTO homes (xuid, name, x, y, z, dim, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)');
        homes.forEach(function(h) {
            stmt.run([xuid, h.name, h.x, h.y, h.z, h.dim || 0, h.lastUse || 0]);
        });
        stmt.free();
    }
}

function addHomeSQL(xuid, home) {
    if (!playerDb) return;
    playerDb.run('INSERT INTO homes (xuid, name, x, y, z, dim, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [xuid, home.name, home.x, home.y, home.z, home.dim || 0, home.lastUse || 0]);
}

function removeHomeSQL(xuid, name) {
    if (!playerDb) return;
    playerDb.run('DELETE FROM homes WHERE xuid = ? AND name = ?', [xuid, name]);
}

function updateHomeSQL(xuid, name, home) {
    if (!playerDb) return;
    playerDb.run('UPDATE homes SET x = ?, y = ?, z = ?, dim = ?, last_use = ? WHERE xuid = ? AND name = ?',
        [home.x, home.y, home.z, home.dim || 0, home.lastUse || 0, xuid, name]);
}

// --- 批量保存优化 ---

function batchSavePlayerDb(operations) {
    if (!playerDb) return;
    playerDb.run('BEGIN TRANSACTION');
    try {
        operations.forEach(function(op) { op(); });
        playerDb.run('COMMIT');
    } catch (e) {
        playerDb.run('ROLLBACK');
        console.error('[PlayerDB] 批量操作失败:', e.message);
    }
}

// --- 通用SQL DataManager 辅助方法 ---

function sqlGetAll(prefix) {
    if (!playerDb) return {};
    var table = 'dm_' + prefix;
    try {
        var result = playerDb.exec('SELECT xuid, data FROM ' + table);
        var all = {};
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

function sqlSet(prefix, xuid, data) {
    if (!playerDb) return;
    var table = 'dm_' + prefix;
    playerDb.run('INSERT OR REPLACE INTO ' + table + ' (xuid, data) VALUES (?, ?)',
        [xuid, JSON.stringify(data)]);
}

function sqlDelete(prefix, xuid) {
    if (!playerDb) return;
    var table = 'dm_' + prefix;
    playerDb.run('DELETE FROM ' + table + ' WHERE xuid = ?', [xuid]);
}

function sqlEnsureTable(prefix) {
    if (!playerDb) return;
    var table = 'dm_' + prefix;
    playerDb.run('CREATE TABLE IF NOT EXISTS ' + table + ' (xuid TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT "{}")');
}

module.exports = {
    initDatabase,
    saveDatabase,
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
    // 通用SQL辅助
    sqlGetAll,
    sqlSet,
    sqlDelete,
    sqlEnsureTable
};
