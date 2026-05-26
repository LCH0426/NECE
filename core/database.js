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
const SALT_LENGTH = 32;
const HASH_ITERATIONS = 10000;
const HASH_LENGTH = 64;

let db = null;

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
        console.error('[DB] 保存数据库失败:', e.message);
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
        console.error('[DB] 清理过期数据失败:', e.message);
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
    cleanExpiredBlacklist
};
