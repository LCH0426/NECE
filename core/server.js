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

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');
const pathModule = require('path');
const fs = require('fs');
const database = require('./database');
const systemMonitor = require('./systemMonitor');
const adminLog = require('./adminLog');
const behaviorLog = require('./behaviorLog');
const chatLog = require('./chatLog');
const mailApi = require('./mail');
const serverStats = require('./serverStats');
const messageBoardApi = require('./messageBoardApi');
const backupModule = require('./backup');
const banModule = require('./ban');

const WEB_DIR = pathModule.join(__dirname, '..', 'WEB');
const PLAYER_DATA_PATH = pathModule.join(__dirname, '..', 'data', 'playerdata.json');

const ACCESS_TOKEN_EXPIRE = '15m';
const REFRESH_TOKEN_EXPIRE = '7d';

let app = null;
let server = null;

var chatHistory = [];
var MAX_CHAT_HISTORY = 500;

var _itemsCache = null;
var _itemsCacheTime = 0;
var ITEMS_CACHE_TTL = 60000;

var _currencyNameCache = null;
var _currencyNameCacheTime = 0;
var CURRENCY_CACHE_TTL = 30000;

function getCurrencyName() {
    var now = Date.now();
    if (_currencyNameCache && now - _currencyNameCacheTime < CURRENCY_CACHE_TTL) return _currencyNameCache;
    try {
        var configPath = pathModule.join(__dirname, '..', 'config.json');
        var content = fs.readFileSync(configPath, 'utf-8');
        var config = JSON.parse(content);
        _currencyNameCache = config.currencyName || '星茜';
        _currencyNameCacheTime = now;
    } catch (e) {
        _currencyNameCache = '星茜';
        _currencyNameCacheTime = now;
    }
    return _currencyNameCache;
}

function getItemsMap() {
    var now = Date.now();
    if (_itemsCache && now - _itemsCacheTime < ITEMS_CACHE_TTL) return _itemsCache;
    try {
        var itemsPath = pathModule.join(__dirname, '..', 'WEB', 'textures', 'items.json');
        var content = fs.readFileSync(itemsPath, 'utf-8');
        var itemsData = JSON.parse(content);
        _itemsCache = itemsData.item || itemsData;
        _itemsCacheTime = now;
    } catch (e) {
        _itemsCache = {};
        _itemsCacheTime = now;
    }
    return _itemsCache;
}

function invalidateItemsCache() {
    _itemsCache = null;
    _itemsCacheTime = 0;
}

function getItemName(itemId) {
    var map = getItemsMap();
    var item = map[itemId];
    if (item && typeof item === 'object') return item.name || itemId;
    if (typeof item === 'string') return item;
    return itemId;
}

function getItemTexture(itemId) {
    var map = getItemsMap();
    var item = map[itemId];
    if (item && typeof item === 'object') return item.texture || '';
    return '';
}

function parseCookies(req) {
    var cookieHeader = req.headers.cookie || '';
    var cookies = {};
    cookieHeader.split(';').forEach(function(pair) {
        var parts = pair.trim().split('=');
        if (parts.length >= 2) {
            cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
    });
    return cookies;
}

function setRefreshTokenCookie(res, refreshToken, maxAge) {
    var isSecure = false;
    res.setHeader('Set-Cookie', [
        'refresh_token=' + refreshToken,
        'Path=/api/v1/auth',
        'HttpOnly',
        isSecure ? 'Secure' : '',
        'SameSite=Strict',
        'Max-Age=' + Math.floor(maxAge / 1000)
    ].filter(Boolean).join('; '));
}

function clearRefreshTokenCookie(res) {
    res.setHeader('Set-Cookie', [
        'refresh_token=',
        'Path=/api/v1/auth',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0'
    ].join('; '));
}

function generateJti() {
    return crypto.randomBytes(16).toString('hex');
}

function generateFamilyId() {
    return crypto.randomBytes(16).toString('hex');
}

function getRefreshSecret(webConfig) {
    return webConfig.jwtRefreshSecret || (webConfig.jwtSecret + '_refresh');
}

function issueTokenPair(uid, webConfig, existingFamilyId) {
    var role = database.isAdmin(String(uid)) ? 'admin' : 'user';
    var familyId = existingFamilyId || generateFamilyId();
    var accessJti = generateJti();
    var refreshJti = generateJti();

    var accessToken = jwt.sign(
        { uid: String(uid), role: role, jti: accessJti, type: 'access' },
        webConfig.jwtSecret,
        { expiresIn: webConfig.jwtExpire || ACCESS_TOKEN_EXPIRE }
    );

    var refreshToken = jwt.sign(
        { uid: String(uid), role: role, jti: refreshJti, familyId: familyId, type: 'refresh' },
        getRefreshSecret(webConfig),
        { expiresIn: webConfig.jwtRefreshExpire || REFRESH_TOKEN_EXPIRE }
    );

    var decoded = jwt.decode(refreshToken);
    var refreshExpiresAt = decoded.exp * 1000;

    database.saveRefreshToken(String(uid), refreshJti, familyId, refreshExpiresAt);

    return {
        accessToken: accessToken,
        refreshToken: refreshToken,
        refreshExpiresAt: refreshExpiresAt
    };
}

function createApp(webConfig) {
    app = express();

    app.use(cors({
        origin: true,
        credentials: true
    }));
    app.use(express.json());

    var v1Router = createV1Routes(webConfig);
    app.use('/api/v1', v1Router);

    app.use('/api/auth/login', function(req, res) {
        res.status(410).json({ code: 410, msg: 'API已迁移，请使用 /api/v1/auth/login' });
    });
    app.use('/api/admin', function(req, res) {
        res.status(410).json({ code: 410, msg: 'API已迁移，请使用 /api/v1/ 前缀' });
    });

    if (webConfig.enableFrontend !== false) {
        app.use(express.static(WEB_DIR));
        app.get(/^\/(?!api).*/, (req, res) => {
            res.sendFile(pathModule.join(WEB_DIR, 'index.html'));
        });
    }

    return app;
}

function requireAuth(webConfig) {
    return function(req, res, next) {
        var authHeader = req.headers['authorization'];
        var token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

        if (!token) {
            return res.status(401).json({ code: 401, msg: '未登录' });
        }

        jwt.verify(token, webConfig.jwtSecret, function(err, user) {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(401).json({ code: 401, msg: 'Access Token 已过期', tokenExpired: true });
                }
                return res.status(403).json({ code: 403, msg: 'Token 已失效' });
            }

            if (user.type && user.type !== 'access') {
                return res.status(403).json({ code: 403, msg: '无效的 Token 类型' });
            }

            if (user.jti && database.isAccessTokenBlacklisted(user.jti)) {
                return res.status(403).json({ code: 403, msg: 'Token 已被吊销' });
            }

            req.user = user;
            next();
        });
    };
}

function requireAdmin(webConfig) {
    return function(req, res, next) {
        var authHeader = req.headers['authorization'];
        var token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

        if (!token) {
            return res.status(401).json({ code: 401, msg: '未登录' });
        }

        jwt.verify(token, webConfig.jwtSecret, function(err, user) {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(401).json({ code: 401, msg: 'Access Token 已过期', tokenExpired: true });
                }
                return res.status(403).json({ code: 403, msg: 'Token 已失效' });
            }

            if (user.type && user.type !== 'access') {
                return res.status(403).json({ code: 403, msg: '无效的 Token 类型' });
            }

            if (user.jti && database.isAccessTokenBlacklisted(user.jti)) {
                return res.status(403).json({ code: 403, msg: 'Token 已被吊销' });
            }

            if (!database.isAdmin(user.uid)) {
                return res.status(403).json({ code: 403, msg: '无管理员权限' });
            }
            req.user = user;
            next();
        });
    };
}

function getPlayerData() {
    try {
        if (fs.existsSync(PLAYER_DATA_PATH)) {
            var content = fs.readFileSync(PLAYER_DATA_PATH, 'utf-8');
            return JSON.parse(content);
        }
    } catch (e) {
        console.error('[Web] 读取玩家数据失败:', e.message);
    }
    return null;
}

var _playerNameCache = {};
var _playerNameCacheTime = 0;
var PLAYER_NAME_CACHE_TTL = 30000;
var _uidToXuidCache = {};
var _uidToXuidCacheTime = 0;
var UID_TO_XUID_CACHE_TTL = 30000;

function getPlayerName(xuid) {
    var now = Date.now();
    if (now - _playerNameCacheTime > PLAYER_NAME_CACHE_TTL) {
        _playerNameCache = {};
        _playerNameCacheTime = now;
        var pd = getPlayerData();
        if (pd && pd.players) {
            var xuids = Object.keys(pd.players);
            for (var i = 0; i < xuids.length; i++) {
                if (pd.players[xuids[i]].name) {
                    _playerNameCache[xuids[i]] = pd.players[xuids[i]].name;
                }
            }
        }
    }
    return _playerNameCache[xuid] || xuid;
}

function getXuidByUid(uid) {
    var now = Date.now();
    if (now - _uidToXuidCacheTime > UID_TO_XUID_CACHE_TTL) {
        _uidToXuidCache = {};
        _uidToXuidCacheTime = now;
        var pd = getPlayerData();
        if (pd && pd.players) {
            var xuids = Object.keys(pd.players);
            for (var i = 0; i < xuids.length; i++) {
                var playerUid = pd.players[xuids[i]].uid;
                if (playerUid !== undefined) {
                    _uidToXuidCache[String(playerUid)] = xuids[i];
                }
            }
        }
    }
    return _uidToXuidCache[String(uid)] || null;
}

function getPlayerNameByUid(uid) {
    var xuid = getXuidByUid(uid);
    if (xuid) {
        return getPlayerName(xuid);
    }
    return String(uid);
}

function createV1Routes(webConfig) {
    var router = express.Router();
    var auth = requireAuth(webConfig);
    var adminAuth = requireAdmin(webConfig);

    router.post('/auth/login', function(req, res) {
        var uid = req.body.uid;
        var password = req.body.password;
        var captchaId = req.body.captchaId;
        var captchaCode = req.body.captchaCode;

        if (!uid || !password) {
            return res.json({ code: 400, msg: 'UID和密码不能为空' });
        }

        if (!captchaId || !captchaCode) {
            return res.json({ code: 400, msg: '验证码不能为空' });
        }

        if (!database.verifyCaptcha(captchaId, captchaCode)) {
            return res.json({ code: 400, msg: '验证码错误或已过期' });
        }

        if (!database.verifyPassword(String(uid), password)) {
            return res.json({ code: 401, msg: 'UID或密码错误' });
        }

        var tokens = issueTokenPair(uid, webConfig);

        setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshExpiresAt - Date.now());

        res.json({
            code: 200,
            msg: '登录成功',
            data: {
                token: tokens.accessToken,
                uid: String(uid),
                role: database.isAdmin(String(uid)) ? 'admin' : 'user'
            }
        });
    });

    router.post('/auth/refresh', function(req, res) {
        var cookies = parseCookies(req);
        var refreshToken = cookies.refresh_token;

        if (!refreshToken) {
            return res.status(401).json({ code: 401, msg: '缺少 Refresh Token' });
        }

        jwt.verify(refreshToken, getRefreshSecret(webConfig), function(err, decoded) {
            if (err) {
                clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: 'Refresh Token 无效或已过期' });
            }

            if (decoded.type !== 'refresh') {
                clearRefreshTokenCookie(res);
                return res.status(403).json({ code: 403, msg: '无效的 Token 类型' });
            }

            var storedToken = database.findRefreshToken(decoded.jti);

            if (!storedToken) {
                clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: 'Refresh Token 不存在' });
            }

            if (storedToken.isRevoked) {
                database.revokeFamilyTokens(storedToken.familyId);
                clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: '检测到重放攻击，该登录链路所有 Token 已作废' });
            }

            if (storedToken.expiresAt < Date.now()) {
                clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: 'Refresh Token 已过期' });
            }

            database.revokeRefreshToken(decoded.jti);

            var newTokens = issueTokenPair(decoded.uid, webConfig, storedToken.familyId);

            setRefreshTokenCookie(res, newTokens.refreshToken, newTokens.refreshExpiresAt - Date.now());

            res.json({
                code: 200,
                msg: '续签成功',
                data: {
                    token: newTokens.accessToken,
                    uid: String(decoded.uid),
                    role: database.isAdmin(String(decoded.uid)) ? 'admin' : 'user'
                }
            });
        });
    });

    router.post('/auth/logout', function(req, res) {
        var authHeader = req.headers['authorization'];
        var accessToken = (authHeader && authHeader.split(' ')[1]) || req.query.token;

        if (accessToken) {
            try {
                var decoded = jwt.decode(accessToken);
                if (decoded && decoded.jti && decoded.exp) {
                    database.blacklistAccessToken(decoded.jti, decoded.exp * 1000);
                }
            } catch (e) {}
        }

        var cookies = parseCookies(req);
        var refreshToken = cookies.refresh_token;

        if (refreshToken) {
            try {
                var refreshDecoded = jwt.decode(refreshToken);
                if (refreshDecoded && refreshDecoded.jti) {
                    database.revokeRefreshToken(refreshDecoded.jti);
                }
            } catch (e) {}
        }

        clearRefreshTokenCookie(res);

        res.json({ code: 200, msg: '已退出登录' });
    });

    router.get('/auth/verify', auth, function(req, res) {
        res.json({
            code: 200,
            msg: 'Token 有效',
            data: {
                uid: req.user.uid,
                role: req.user.role,
                exp: req.user.exp
            }
        });
    });

    router.get('/captcha', function(req, res) {
        var captcha = svgCaptcha.create({
            size: 4,
            ignoreChars: 'o0OlI1i',
            noise: 3,
            color: true,
            background: '#f0f0f0',
            width: 120,
            height: 40,
            fontSize: 36
        });

        var captchaId = database.generateCaptcha(captcha.text);

        res.json({
            code: 200,
            data: {
                captchaId: captchaId,
                svg: captcha.data
            }
        });
    });

    router.get('/users/me', auth, function(req, res) {
        var uid = req.user.uid;
        res.json({
            code: 200,
            data: {
                uid: uid,
                role: req.user.role,
                isAdmin: database.isAdmin(uid)
            }
        });
    });

    router.get('/players/online', adminAuth, function(req, res) {
        try {
            var onlinePlayers = mc.getOnlinePlayers();
            var players = onlinePlayers.map(function(p) {
                var balance = 0;
                try { balance = money.get(p.xuid) || 0; } catch (e) {}

                var ip = '';
                var ping = 0;
                var os = '';
                try {
                    var device = p.getDevice();
                    if (device) {
                        ip = device.ip || '';
                        ping = device.avgPing || 0;
                        os = device.os || '';
                    }
                } catch (e) {}

                var lastIp = '';
                try {
                    var pd = getPlayerData();
                    if (pd && pd.players && pd.players[p.xuid]) {
                        lastIp = pd.players[p.xuid].lastIp || '';
                    }
                } catch (e) {}

                return {
                    name: p.name,
                    realName: p.realName || p.name,
                    xuid: p.xuid,
                    uuid: p.uuid || '',
                    ip: ip,
                    lastIp: lastIp,
                    dimension: p.dimension || 0,
                    position: p.pos || null,
                    balance: balance,
                    gameMode: p.gameMode || 0,
                    ping: ping,
                    os: os
                };
            });

            res.json({ code: 200, data: { players: players, count: players.length } });
        } catch (e) {
            res.json({ code: 500, msg: '获取在线玩家失败: ' + e.message });
        }
    });

    router.post('/players/kick', adminAuth, function(req, res) {
        var xuid = req.body.xuid;
        var reason = req.body.reason || '';

        if (!xuid) {
            return res.json({ code: 400, msg: '缺少xuid参数' });
        }

        try {
            var player = mc.getPlayer(xuid);
            if (!player) {
                return res.json({ code: 404, msg: '玩家不在线' });
            }

            var kickReason = reason || '被管理员踢出';
            var playerName = player.name;
            player.kick(kickReason);

            adminLog.log(req.user.uid, '踢出玩家', playerName + '(' + xuid + ')', '原因: ' + kickReason);

            res.json({ code: 200, msg: '已踢出玩家 ' + playerName });
        } catch (e) {
            res.json({ code: 500, msg: '踢出玩家失败: ' + e.message });
        }
    });

    router.post('/players/money', adminAuth, function(req, res) {
        var xuid = req.body.xuid;
        var action = req.body.action;
        var amount = req.body.amount;

        if (!xuid || !action || amount === undefined) {
            return res.json({ code: 400, msg: '缺少必要参数 (xuid, action, amount)' });
        }

        var intAmount = Math.floor(Number(amount));
        if (isNaN(intAmount) || intAmount <= 0) {
            return res.json({ code: 400, msg: '金额必须为正整数' });
        }

        try {
            if (typeof money === 'undefined' || money === null) {
                return res.json({ code: 500, msg: '经济系统未加载' });
            }

            var beforeBalance = money.get(xuid) || 0;
            var success = false;

            if (action === 'add') {
                success = money.add(xuid, intAmount);
            } else if (action === 'reduce') {
                success = money.reduce(xuid, intAmount);
            } else if (action === 'set') {
                var currentBalance = money.get(xuid) || 0;
                if (intAmount >= currentBalance) {
                    success = money.add(xuid, intAmount - currentBalance);
                } else {
                    success = money.reduce(xuid, currentBalance - intAmount);
                }
            } else {
                return res.json({ code: 400, msg: '无效操作，支持: add, reduce, set' });
            }

            if (success) {
                var afterBalance = money.get(xuid) || 0;
                var playerName = getPlayerName(xuid);

                var actionNames = { add: '增加', reduce: '减少', set: '设置' };
                adminLog.log(req.user.uid, '经济操作', playerName + '(' + xuid + ')',
                    actionNames[action] + ' ' + intAmount + ' (余额: ' + beforeBalance + ' -> ' + afterBalance + ')');

                try {
                    var targetPlayer = mc.getPlayer(xuid);
                    if (targetPlayer) {
                        var diff = afterBalance - beforeBalance;
                        var sign = diff >= 0 ? '+' : '';
                        var currencyName = (typeof getCurrencyName === 'function') ? getCurrencyName() : '星茜';
                        var sourceMap = { add: '管理员增加', reduce: '管理员减少', set: '管理员设置' };
                        targetPlayer.sendToast(sourceMap[action] || '管理员操作', sign + diff + currencyName);
                    }
                } catch (e) {}

                res.json({
                    code: 200,
                    msg: '操作成功',
                    data: {
                        xuid: xuid,
                        name: playerName,
                        action: action,
                        amount: intAmount,
                        before: beforeBalance,
                        after: afterBalance
                    }
                });
            } else {
                res.json({ code: 500, msg: '经济操作失败，余额可能不足' });
            }
        } catch (e) {
            res.json({ code: 500, msg: '经济操作失败: ' + e.message });
        }
    });

    router.post('/players/popup', adminAuth, function(req, res) {
        var xuid = req.body.xuid;
        var content = req.body.content;

        if (!xuid) {
            return res.json({ code: 400, msg: '缺少xuid参数' });
        }

        if (!content || !content.trim()) {
            return res.json({ code: 400, msg: '消息内容不能为空' });
        }

        if (content.length > 1000) {
            return res.json({ code: 400, msg: '消息内容不能超过1000字符' });
        }

        try {
            var player = mc.getPlayer(xuid);
            if (!player) {
                return res.json({ code: 404, msg: '玩家不在线' });
            }

            var playerName = player.name;

            var form = mc.newSimpleForm();
            form.setTitle('管理员远程消息');
            form.setContent(content.trim());
            form.addButton('关闭');
            player.sendForm(form, function() {});

            adminLog.log(req.user.uid, '发送弹窗', playerName + '(' + xuid + ')', '内容: ' + content.trim());

            res.json({ code: 200, msg: '弹窗已发送给 ' + playerName });
        } catch (e) {
            res.json({ code: 500, msg: '发送弹窗失败: ' + e.message });
        }
    });

    router.get('/players', adminAuth, function(req, res) {
        try {
            var playerData = getPlayerData();
            if (!playerData || !playerData.players) {
                return res.json({ code: 500, msg: '无法读取玩家数据' });
            }

            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 20;
            var search = (req.query.search || '').trim().toLowerCase();

            var playerList = [];
            var players = playerData.players;

            Object.keys(players).forEach(function(xuid) {
                var p = players[xuid];
                var matchSearch = !search ||
                    (p.name && p.name.toLowerCase().indexOf(search) !== -1) ||
                    (String(p.uid) && String(p.uid).indexOf(search) !== -1) ||
                    xuid.toLowerCase().indexOf(search) !== -1;

                if (matchSearch) {
                    var balance = 0;
                    try { balance = money.get(xuid) || 0; } catch (e) {}

                    var isOnline = false;
                    try { isOnline = !!mc.getPlayer(xuid); } catch (e) {}

                    playerList.push({
                        uid: p.uid,
                        name: p.name || '',
                        xuid: xuid,
                        registerTime: p.registerTime || '',
                        balance: balance,
                        isOnline: isOnline,
                        playTime: (p.count && p.count.playTime) || 0,
                        vipExpire: (p.vipdata && p.vipdata.expireTime) || 0,
                        lastIp: p.lastIp || '',
                        platform: p.platform || ''
                    });
                }
            });

            playerList.sort(function(a, b) { return a.uid - b.uid; });

            var total = playerList.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var end = start + pageSize;
            var pagedPlayers = playerList.slice(start, end);

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取玩家列表失败: ' + e.message });
        }
    });

    router.get('/players/rank/uid', adminAuth, function(req, res) {
        try {
            var playerData = getPlayerData();
            if (!playerData || !playerData.players) {
                return res.json({ code: 500, msg: '无法读取玩家数据' });
            }

            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 20;
            var order = (req.query.order || 'asc').toLowerCase();

            var playerList = [];
            var players = playerData.players;

            Object.keys(players).forEach(function(xuid) {
                var p = players[xuid];
                var balance = 0;
                try { balance = money.get(xuid) || 0; } catch (e) {}

                playerList.push({
                    uid: p.uid,
                    name: p.name || '',
                    xuid: xuid,
                    registerTime: p.registerTime || '',
                    balance: balance,
                    playTime: (p.count && p.count.playTime) || 0
                });
            });

            if (order === 'desc') {
                playerList.sort(function(a, b) { return b.uid - a.uid; });
            } else {
                playerList.sort(function(a, b) { return a.uid - b.uid; });
            }

            var total = playerList.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var pagedPlayers = playerList.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    sort: { field: 'uid', order: order },
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取UID排行失败: ' + e.message });
        }
    });

    router.get('/players/rank/playtime', adminAuth, function(req, res) {
        try {
            var playerData = getPlayerData();
            if (!playerData || !playerData.players) {
                return res.json({ code: 500, msg: '无法读取玩家数据' });
            }

            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 20;
            var order = (req.query.order || 'desc').toLowerCase();

            var playerList = [];
            var players = playerData.players;

            Object.keys(players).forEach(function(xuid) {
                var p = players[xuid];
                var balance = 0;
                try { balance = money.get(xuid) || 0; } catch (e) {}

                playerList.push({
                    uid: p.uid,
                    name: p.name || '',
                    xuid: xuid,
                    playTime: (p.count && p.count.playTime) || 0,
                    registerTime: p.registerTime || '',
                    balance: balance
                });
            });

            if (order === 'asc') {
                playerList.sort(function(a, b) { return a.playTime - b.playTime; });
            } else {
                playerList.sort(function(a, b) { return b.playTime - a.playTime; });
            }

            var total = playerList.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var pagedPlayers = playerList.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    sort: { field: 'playTime', order: order },
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取在线时间排行失败: ' + e.message });
        }
    });

    router.get('/players/rank/balance', adminAuth, function(req, res) {
        try {
            var playerData = getPlayerData();
            if (!playerData || !playerData.players) {
                return res.json({ code: 500, msg: '无法读取玩家数据' });
            }

            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 20;
            var order = (req.query.order || 'desc').toLowerCase();

            var playerList = [];
            var players = playerData.players;

            Object.keys(players).forEach(function(xuid) {
                var p = players[xuid];
                var balance = 0;
                try { balance = money.get(xuid) || 0; } catch (e) {}

                playerList.push({
                    uid: p.uid,
                    name: p.name || '',
                    xuid: xuid,
                    balance: balance,
                    playTime: (p.count && p.count.playTime) || 0,
                    registerTime: p.registerTime || ''
                });
            });

            if (order === 'asc') {
                playerList.sort(function(a, b) { return a.balance - b.balance; });
            } else {
                playerList.sort(function(a, b) { return b.balance - a.balance; });
            }

            var total = playerList.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var pagedPlayers = playerList.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    players: pagedPlayers,
                    sort: { field: 'balance', order: order },
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取余额排行失败: ' + e.message });
        }
    });

    router.get('/players/:xuid', adminAuth, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var playerData = getPlayerData();

            if (!playerData || !playerData.players || !playerData.players[xuid]) {
                return res.json({ code: 404, msg: '玩家不存在' });
            }

            var pData = playerData.players[xuid];
            var balance = 0;
            try { balance = money.get(xuid) || 0; } catch (e) {}

            var isOnline = false;
            var onlineInfo = null;
            try {
                var onlinePlayer = mc.getPlayer(xuid);
                if (onlinePlayer) {
                    isOnline = true;
                    var deviceIp = '';
                    var devicePing = 0;
                    var deviceOs = '';
                    try {
                        var device = onlinePlayer.getDevice();
                        if (device) {
                            deviceIp = device.ip || '';
                            devicePing = device.avgPing || 0;
                            deviceOs = device.os || '';
                        }
                    } catch (e) {}
                    onlineInfo = {
                        ip: deviceIp,
                        dimension: onlinePlayer.dimension || 0,
                        position: onlinePlayer.pos || null,
                        gameMode: onlinePlayer.gameMode || 0,
                        ping: devicePing,
                        os: deviceOs
                    };
                }
            } catch (e) {}

            res.json({
                code: 200,
                data: {
                    uid: pData.uid,
                    name: pData.name || '',
                    xuid: xuid,
                    uuid: pData.uuid || '',
                    registerTime: pData.registerTime || '',
                    balance: balance,
                    isOnline: isOnline,
                    onlineInfo: onlineInfo,
                    lastIp: pData.lastIp || '',
                    platform: pData.platform || '',
                    playerData: pData
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取玩家详情失败: ' + e.message });
        }
    });

    router.put('/players/:xuid/gamemode', adminAuth, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var mode = req.body.mode;

            var MODE_MAP = {
                'survival': { cmd: 'survival', name: '生存', id: 0 },
                's': { cmd: 'survival', name: '生存', id: 0 },
                '0': { cmd: 'survival', name: '生存', id: 0 },
                'creative': { cmd: 'creative', name: '创造', id: 1 },
                'c': { cmd: 'creative', name: '创造', id: 1 },
                '1': { cmd: 'creative', name: '创造', id: 1 },
                'adventure': { cmd: 'adventure', name: '冒险', id: 2 },
                'a': { cmd: 'adventure', name: '冒险', id: 2 },
                '2': { cmd: 'adventure', name: '冒险', id: 2 },
                'spectator': { cmd: 'spectator', name: '旁观', id: 6 },
                'sp': { cmd: 'spectator', name: '旁观', id: 6 },
                '6': { cmd: 'spectator', name: '旁观', id: 6 }
            };

            var modeStr = String(mode).toLowerCase();
            var modeInfo = MODE_MAP[modeStr];
            if (!modeInfo) {
                return res.json({ code: 400, msg: '无效的游戏模式，可选值: survival(生存), creative(创造), adventure(冒险), spectator(旁观)' });
            }

            var player = mc.getPlayer(xuid);
            if (!player) {
                return res.json({ code: 404, msg: '玩家不在线' });
            }

            var playerName = player.realName || player.name;
            var oldMode = player.gameMode;
            var MODE_NAMES = { 0: '生存', 1: '创造', 2: '冒险', 6: '旁观' };
            var oldModeName = MODE_NAMES[oldMode] || '未知';

            var cmdResult = mc.runcmd('gamemode ' + modeInfo.cmd + ' "' + playerName + '"');
            if (!cmdResult) {
                return res.json({ code: 500, msg: '修改游戏模式失败' });
            }

            adminLog.log(req.user.uid, '修改游戏模式', playerName + '(' + xuid + ')',
                oldModeName + '(' + oldMode + ') → ' + modeInfo.name + '(' + modeInfo.id + ')');

            res.json({
                code: 200,
                msg: '游戏模式修改成功',
                data: {
                    name: playerName,
                    xuid: xuid,
                    oldMode: oldMode,
                    oldModeName: oldModeName,
                    newMode: modeInfo.id,
                    newModeName: modeInfo.name
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '修改游戏模式失败: ' + e.message });
        }
    });

    router.get('/system/stats', adminAuth, function(req, res) {
        try {
            var stats = systemMonitor.getSystemStats();
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.json({ code: 500, msg: '获取系统信息失败: ' + e.message });
        }
    });

    router.get('/currency-name', adminAuth, function(req, res) {
        res.json({ code: 200, data: { name: getCurrencyName() } });
    });

    router.get('/item-info', adminAuth, function(req, res) {
        var itemId = (req.query.id || '').trim();
        if (!itemId) return res.json({ code: 400, msg: '缺少id参数' });
        var shortId = itemId.replace(/^minecraft:/, '');
        var name = getItemName(shortId);
        var image = getItemTexture(shortId);
        res.json({ code: 200, data: { id: itemId, name: name, image: image } });
    });

    router.get('/tps', adminAuth, function(req, res) {
        try {
            var data = serverStats.getTps();
            res.json({ code: 200, data: data });
        } catch (e) {
            res.json({ code: 500, msg: '获取TPS失败: ' + e.message });
        }
    });

    router.get('/allmoney', adminAuth, function(req, res) {
        try {
            var data = serverStats.getAllMoney();
            res.json({ code: 200, data: data });
        } catch (e) {
            res.json({ code: 500, msg: '获取全服余额失败: ' + e.message });
        }
    });

    router.get('/economy/rank', adminAuth, function(req, res) {
        try {
            var data = serverStats.getEconomyRank();
            res.json({ code: 200, data: data });
        } catch (e) {
            res.json({ code: 500, msg: '获取经济排行失败: ' + e.message });
        }
    });

    var CDK_DATA_PATH = pathModule.join(__dirname, '..', 'data', 'cdkdata.json');

    function loadCdkData() {
        try {
            if (fs.existsSync(CDK_DATA_PATH)) {
                return JSON.parse(fs.readFileSync(CDK_DATA_PATH, 'utf-8'));
            }
            return { codes: {} };
        } catch (e) {
            return { codes: {} };
        }
    }

    function saveCdkData(data) {
        fs.writeFileSync(CDK_DATA_PATH, JSON.stringify(data, null, '\t'), 'utf-8');
    }

    router.get('/cdk/list', adminAuth, function(req, res) {
        try {
            var data = loadCdkData();
            var list = [];
            Object.keys(data.codes || {}).forEach(function(code) {
                var cdk = data.codes[code];
                var usedCount = cdk.usedBy ? Object.keys(cdk.usedBy).length : 0;
                var item = {
                    code: code,
                    maxUses: cdk.maxUses,
                    usedCount: usedCount,
                    rewards: cdk.rewards || []
                };
                if (cdk.type && !cdk.rewards) {
                    var legacy = { type: cdk.type };
                    if (cdk.type === 'item') { legacy.itemId = cdk.itemId; legacy.itemName = cdk.itemName; legacy.count = cdk.count; }
                    else if (cdk.type === 'snbt') { legacy.snbt = cdk.snbt; legacy.itemName = cdk.itemName; }
                    else if (cdk.type === 'money') { legacy.amount = cdk.amount; }
                    item.rewards = [legacy];
                }
                list.push(item);
            });
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取CDK列表失败: ' + e.message });
        }
    });

    router.post('/cdk/add', adminAuth, function(req, res) {
        try {
            var body = req.body;
            if (!body.code) {
                return res.json({ code: 400, msg: '缺少必要参数 code' });
            }
            var data = loadCdkData();
            if (data.codes[body.code]) {
                return res.json({ code: 400, msg: '兑换码已存在' });
            }
            var cdk = {
                maxUses: body.maxUses || 0,
                usedBy: {},
                rewards: []
            };
            if (body.rewards && Array.isArray(body.rewards)) {
                for (var i = 0; i < body.rewards.length; i++) {
                    var r = body.rewards[i];
                    if (!r.type) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 type' });
                    if (r.type === 'item') {
                        if (!r.itemId) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 itemId' });
                        cdk.rewards.push({ type: 'item', itemId: r.itemId, itemName: r.itemName || r.itemId, count: r.count || 1 });
                    } else if (r.type === 'snbt') {
                        if (!r.snbt) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 snbt' });
                        cdk.rewards.push({ type: 'snbt', snbt: r.snbt, itemName: r.itemName || 'SNBT物品' });
                    } else if (r.type === 'money') {
                        if (!r.amount) return res.json({ code: 400, msg: '第' + (i + 1) + '个附件缺少 amount' });
                        cdk.rewards.push({ type: 'money', amount: Number(r.amount) });
                    } else {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个附件类型无效，支持 item/snbt/money' });
                    }
                }
            } else if (body.type) {
                if (body.type === 'item') {
                    if (!body.itemId) return res.json({ code: 400, msg: '物品类型需要 itemId' });
                    cdk.rewards.push({ type: 'item', itemId: body.itemId, itemName: body.itemName || body.itemId, count: body.count || 1 });
                } else if (body.type === 'snbt') {
                    if (!body.snbt) return res.json({ code: 400, msg: 'SNBT类型需要 snbt' });
                    cdk.rewards.push({ type: 'snbt', snbt: body.snbt, itemName: body.itemName || 'SNBT物品' });
                } else if (body.type === 'money') {
                    if (!body.amount) return res.json({ code: 400, msg: '经济类型需要 amount' });
                    cdk.rewards.push({ type: 'money', amount: Number(body.amount) });
                } else {
                    return res.json({ code: 400, msg: '无效的CDK类型，支持 item/snbt/money' });
                }
            } else {
                return res.json({ code: 400, msg: '缺少 rewards 数组或 type 字段' });
            }
            data.codes[body.code] = cdk;
            saveCdkData(data);
            triggerReload('cdk');
            res.json({ code: 200, msg: '添加成功' });
        } catch (e) {
            res.json({ code: 500, msg: '添加CDK失败: ' + e.message });
        }
    });

    router.post('/cdk/delete', adminAuth, function(req, res) {
        try {
            var body = req.body;
            if (!body.code) return res.json({ code: 400, msg: '缺少兑换码' });
            var data = loadCdkData();
            if (!data.codes[body.code]) return res.json({ code: 404, msg: '兑换码不存在' });
            delete data.codes[body.code];
            saveCdkData(data);
            triggerReload('cdk');
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除CDK失败: ' + e.message });
        }
    });

    router.post('/cdk/modify', adminAuth, function(req, res) {
        try {
            var body = req.body;
            if (!body.code) return res.json({ code: 400, msg: '缺少兑换码' });
            var data = loadCdkData();
            if (!data.codes[body.code]) return res.json({ code: 404, msg: '兑换码不存在' });
            var cdk = data.codes[body.code];
            if (body.maxUses !== undefined) cdk.maxUses = Number(body.maxUses);
            if (body.rewards && Array.isArray(body.rewards)) {
                var newRewards = [];
                for (var i = 0; i < body.rewards.length; i++) {
                    var r = body.rewards[i];
                    if (!r.type) continue;
                    if (r.type === 'item') {
                        newRewards.push({ type: 'item', itemId: r.itemId || '', itemName: r.itemName || r.itemId || '', count: r.count || 1 });
                    } else if (r.type === 'snbt') {
                        newRewards.push({ type: 'snbt', snbt: r.snbt || '', itemName: r.itemName || 'SNBT物品' });
                    } else if (r.type === 'money') {
                        newRewards.push({ type: 'money', amount: Number(r.amount) || 0 });
                    }
                }
                cdk.rewards = newRewards;
                delete cdk.type;
                delete cdk.itemId;
                delete cdk.itemName;
                delete cdk.count;
                delete cdk.snbt;
                delete cdk.amount;
            }
            saveCdkData(data);
            triggerReload('cdk');
            res.json({ code: 200, msg: '修改成功' });
        } catch (e) {
            res.json({ code: 500, msg: '修改CDK失败: ' + e.message });
        }
    });

    var ALLOWLIST_PATH = pathModule.join(__dirname, '..', '..', '..', 'allowlist.json');

    function readAllowlist() {
        try {
            if (fs.existsSync(ALLOWLIST_PATH)) {
                var content = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
                var list = JSON.parse(content);
                if (!Array.isArray(list)) return [];
                return list;
            }
            return [];
        } catch (e) {
            console.error('[Web] 读取白名单失败:', e.message);
            return [];
        }
    }

    function writeAllowlist(list) {
        try {
            fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(list, null, 2), 'utf-8');
            return true;
        } catch (e) {
            console.error('[Web] 写入白名单失败:', e.message);
            return false;
        }
    }

    router.get('/allowlist', adminAuth, function(req, res) {
        try {
            var list = readAllowlist();
            var search = (req.query.search || '').trim().toLowerCase();
            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 20;

            var filtered = list;
            if (search) {
                filtered = list.filter(function(item) {
                    return (item.name && item.name.toLowerCase().indexOf(search) !== -1) ||
                           (item.xuid && item.xuid.toLowerCase().indexOf(search) !== -1);
                });
            }

            var total = filtered.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var paged = filtered.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    list: paged.map(function(item) {
                        return {
                            name: item.name || '',
                            xuid: item.xuid || '',
                            ignoresPlayerLimit: item.ignoresPlayerLimit || false
                        };
                    }),
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取白名单失败: ' + e.message });
        }
    });

    router.post('/allowlist', adminAuth, function(req, res) {
        try {
            var name = (req.body.name || '').trim();
            if (!name) {
                return res.json({ code: 400, msg: '玩家名字不能为空' });
            }

            var list = readAllowlist();
            var exists = list.some(function(item) {
                return item.name && item.name.toLowerCase() === name.toLowerCase();
            });

            if (exists) {
                return res.json({ code: 409, msg: '玩家 ' + name + ' 已在白名单中' });
            }

            var cmdResult = mc.runcmd('allowlist add "' + name + '"');
            if (!cmdResult) {
                return res.json({ code: 500, msg: '执行 allowlist add 命令失败' });
            }

            adminLog.log(req.user.uid, '添加白名单', name, '');

            res.json({ code: 200, msg: '已添加 ' + name + ' 到白名单' });
        } catch (e) {
            res.json({ code: 500, msg: '添加白名单失败: ' + e.message });
        }
    });

    router.delete('/allowlist', adminAuth, function(req, res) {
        try {
            var name = (req.body.name || '').trim();
            if (!name) {
                return res.json({ code: 400, msg: '玩家名字不能为空' });
            }

            var list = readAllowlist();
            var found = list.some(function(item) {
                return item.name && item.name.toLowerCase() === name.toLowerCase();
            });

            if (!found) {
                return res.json({ code: 404, msg: '玩家 ' + name + ' 不在白名单中' });
            }

            var cmdResult = mc.runcmd('allowlist remove "' + name + '"');
            if (!cmdResult) {
                return res.json({ code: 500, msg: '执行 allowlist remove 命令失败' });
            }

            adminLog.log(req.user.uid, '删除白名单', name, '');

            res.json({ code: 200, msg: '已从白名单移除 ' + name });
        } catch (e) {
            res.json({ code: 500, msg: '删除白名单失败: ' + e.message });
        }
    });

    router.get('/chat/history', adminAuth, function(req, res) {
        try {
            var limit = parseInt(req.query.limit) || 100;
            if (limit > 500) limit = 500;
            if (limit < 1) limit = 1;

            var before = req.query.before;
            var after = req.query.after;

            var messages = chatHistory;

            if (before) {
                var beforeTime = parseInt(before);
                if (!isNaN(beforeTime)) {
                    messages = messages.filter(function(m) { return m.time < beforeTime; });
                }
            }

            if (after) {
                var afterTime = parseInt(after);
                if (!isNaN(afterTime)) {
                    messages = messages.filter(function(m) { return m.time > afterTime; });
                }
            }

            var result = messages.slice(-limit);
            res.json({ code: 200, data: { messages: result, total: chatHistory.length } });
        } catch (e) {
            res.json({ code: 500, msg: '获取聊天记录失败: ' + e.message });
        }
    });

    router.get('/chat/log', adminAuth, function(req, res) {
        var options = {
            date: req.query.date || '',
            page: parseInt(req.query.page) || 1,
            pageSize: parseInt(req.query.pageSize) || 100,
            sender: req.query.sender || '',
            keyword: req.query.keyword || ''
        };

        chatLog.queryHistory(options).then(function(result) {
            res.json({ code: 200, data: result });
        }).catch(function(e) {
            res.json({ code: 500, msg: '查询聊天记录失败: ' + e.message });
        });
    });

    router.get('/chat/log/dates', adminAuth, function(req, res) {
        try {
            var dates = chatLog.getAvailableDates();
            res.json({ code: 200, data: { dates: dates } });
        } catch (e) {
            res.json({ code: 500, msg: '获取聊天日期列表失败: ' + e.message });
        }
    });

    router.post('/chat/send', adminAuth, function(req, res) {
        var message = req.body.message;

        if (!message || !message.trim()) {
            return res.json({ code: 400, msg: '消息不能为空' });
        }

        if (message.length > 500) {
            return res.json({ code: 400, msg: '消息长度不能超过500字符' });
        }

        try {
            mc.broadcast('[服务器] ' + message.trim());

            var msgObj = {
                time: Date.now(),
                sender: 'Server',
                message: message.trim(),
                type: 'server'
            };

            chatHistory.push(msgObj);

            if (chatHistory.length > MAX_CHAT_HISTORY) {
                chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
            }

            chatLog.writeMessage(msgObj);

            adminLog.log(req.user.uid, '全服广播', '全体玩家', '内容: ' + message.trim());

            res.json({ code: 200, msg: '消息已发送' });
        } catch (e) {
            res.json({ code: 500, msg: '发送消息失败: ' + e.message });
        }
    });

    router.get('/logs', adminAuth, function(req, res) {
        try {
            var date = req.query.date || '';
            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 50;

            var result = adminLog.getLogs(date, page, pageSize);
            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取日志失败: ' + e.message });
        }
    });

    router.get('/logs/dates', adminAuth, function(req, res) {
        try {
            var dates = adminLog.getAvailableDates();
            res.json({ code: 200, data: { dates: dates } });
        } catch (e) {
            res.json({ code: 500, msg: '获取日期列表失败: ' + e.message });
        }
    });

    router.get('/behavior/dates', adminAuth, function(req, res) {
        try {
            var dates = behaviorLog.getAvailableDates();
            res.json({ code: 200, data: { dates: dates } });
        } catch (e) {
            res.json({ code: 500, msg: '获取行为日志日期列表失败: ' + e.message });
        }
    });

    router.get('/behavior/events', adminAuth, function(req, res) {
        try {
            var events = behaviorLog.getEventTypes();
            res.json({ code: 200, data: { events: events } });
        } catch (e) {
            res.json({ code: 500, msg: '获取事件类型列表失败: ' + e.message });
        }
    });

    router.get('/behavior/logs', adminAuth, function(req, res) {
        var options = {
            date: req.query.date || '',
            player: req.query.player || '',
            eventType: req.query.eventType || '',
            page: parseInt(req.query.page) || 1,
            pageSize: parseInt(req.query.pageSize) || 50
        };

        behaviorLog.queryLogs(options).then(function(result) {
            res.json({ code: 200, data: result });
        }).catch(function(e) {
            res.json({ code: 500, msg: '查询行为日志失败: ' + e.message });
        });
    });

    router.get('/items/search', adminAuth, function(req, res) {
        try {
            var keyword = (req.query.keyword || '').trim().toLowerCase();
            if (!keyword) return res.json({ code: 400, msg: '缺少keyword参数' });
            var itemMap = getItemsMap();
            var results = [];
            Object.keys(itemMap).forEach(function(id) {
                var item = itemMap[id];
                var name = (typeof item === 'object') ? (item.name || id) : item;
                if (id.toLowerCase().indexOf(keyword) >= 0 || name.toLowerCase().indexOf(keyword) >= 0) {
                    var texture = (typeof item === 'object') ? (item.texture || '') : '';
                    results.push({ id: 'minecraft:' + id, name: name, image: texture });
                }
            });
            res.json({ code: 200, data: results });
        } catch (e) {
            res.json({ code: 500, msg: '搜索物品失败: ' + e.message });
        }
    });

    router.get('/mails', adminAuth, function(req, res) {
        try {
            var mailData = mailApi.getData();
            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 20;
            var type = req.query.type || '';
            var search = (req.query.search || '').trim().toLowerCase();

            var mailList = mailData.mails.filter(function(m) {
                if (type === 'global' && m.toXuid !== 'all') return false;
                if (type === 'personal' && m.toXuid === 'all') return false;
                if (type === 'scheduled' && !m.scheduledTime) return false;
                if (type === 'normal' && m.scheduledTime) return false;

                if (search) {
                    var matchFrom = (m.fromName || '').toLowerCase().indexOf(search) !== -1;
                    var matchTo = m.toXuid === 'all' ? ('全体').indexOf(search) !== -1 : (m.toXuid || '').toLowerCase().indexOf(search) !== -1;
                    var matchContent = (m.content || '').toLowerCase().indexOf(search) !== -1;
                    var matchToName = false;
                    if (m.toXuid !== 'all') {
                        matchToName = getPlayerName(m.toXuid).toLowerCase().indexOf(search) !== -1;
                    }
                    if (!matchFrom && !matchTo && !matchContent && !matchToName) return false;
                }
                return true;
            });

            mailList.sort(function(a, b) { return b.id - a.id; });

            var total = mailList.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var pagedMails = mailList.slice(start, start + pageSize);

            var result = pagedMails.map(function(m) {
                var toName = m.toXuid === 'all' ? '全体玩家' : getPlayerName(m.toXuid);
                var readCount = 0;
                if (m.toXuid === 'all') {
                    if (m.read && typeof m.read === 'object') {
                        readCount = Object.keys(m.read).length;
                    }
                }

                return {
                    id: m.id,
                    fromName: m.fromName || '未知',
                    fromXuid: m.fromXuid || '',
                    toXuid: m.toXuid,
                    toName: toName,
                    content: m.content,
                    time: m.time,
                    starQian: m.starQian || 0,
                    hasItems: !!(m.items && m.items.length > 0),
                    itemCount: m.items ? m.items.length : 0,
                    items: (m.items || []).map(function(it) {
                        var result = {
                            type: it.type || 'item'
                        };
                        if (result.type === 'snbt') {
                            result.snbt = it.snbt || '';
                        } else {
                            result.id = it.id || '';
                            result.count = it.count || 1;
                            result.name = it.name || getItemName(it.id) || it.id || '';
                        }
                        return result;
                    }),
                    isGlobal: m.toXuid === 'all',
                    isScheduled: !!m.scheduledTime,
                    scheduledTime: m.scheduledTime || null,
                    readCount: readCount,
                    read: m.toXuid === 'all' ? readCount : !!m.read,
                    claimedCount: m.toXuid === 'all' && m.claimed && typeof m.claimed === 'object' ? Object.keys(m.claimed).length : 0
                };
            });

            res.json({
                code: 200,
                data: {
                    mails: result,
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                        total: total,
                        totalPages: totalPages
                    }
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取邮件列表失败: ' + e.message });
        }
    });

    router.get('/mails/:id', adminAuth, function(req, res) {
        try {
            var mailId = parseInt(req.params.id);
            var mail = mailApi.getMailById(mailId);

            if (!mail) {
                return res.json({ code: 404, msg: '邮件不存在' });
            }

            var toName = mail.toXuid === 'all' ? '全体玩家' : getPlayerName(mail.toXuid);

            var readList = [];
            if (mail.toXuid === 'all' && mail.read && typeof mail.read === 'object') {
                Object.keys(mail.read).forEach(function(xuid) {
                    if (mail.read[xuid]) {
                        readList.push({ xuid: xuid, name: getPlayerName(xuid) });
                    }
                });
            }

            var claimedList = [];
            if (mail.toXuid === 'all' && mail.claimed && typeof mail.claimed === 'object') {
                Object.keys(mail.claimed).forEach(function(xuid) {
                    if (mail.claimed[xuid]) {
                        claimedList.push({ xuid: xuid, name: getPlayerName(xuid) });
                    }
                });
            } else if (mail.toXuid !== 'all') {
                claimedList = mail.claimed ? [{ xuid: mail.toXuid, name: toName }] : [];
            }

            res.json({
                code: 200,
                data: {
                    id: mail.id,
                    fromName: mail.fromName || '未知',
                    fromXuid: mail.fromXuid || '',
                    toXuid: mail.toXuid,
                    toName: toName,
                    content: mail.content,
                    time: mail.time,
                    starQian: mail.starQian || 0,
                    items: (mail.items || []).map(function(it) {
                        var result = {
                            type: it.type || 'item'
                        };
                        if (result.type === 'snbt') {
                            result.snbt = it.snbt || '';
                        } else {
                            result.id = it.id || '';
                            result.count = it.count || 1;
                            result.name = it.name || getItemName(it.id) || it.id || '';
                        }
                        return result;
                    }),
                    isGlobal: mail.toXuid === 'all',
                    isScheduled: !!mail.scheduledTime,
                    scheduledTime: mail.scheduledTime || null,
                    read: mail.read,
                    readList: readList,
                    claimed: mail.claimed,
                    claimedList: claimedList
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '获取邮件详情失败: ' + e.message });
        }
    });

    router.post('/mails/send', adminAuth, function(req, res) {
        var toXuid = req.body.toXuid;
        var content = req.body.content;
        var starQian = req.body.starQian || 0;
        var scheduledTime = req.body.scheduledTime || '';
        var mailItems = req.body.items || [];

        if (!content || !content.trim()) {
            return res.json({ code: 400, msg: '邮件内容不能为空' });
        }

        if (content.length > 2000) {
            return res.json({ code: 400, msg: '邮件内容不能超过2000字符' });
        }

        if (!toXuid) {
            return res.json({ code: 400, msg: '缺少收件人参数 (toXuid，全体邮件请传 "all")' });
        }

        var intStarQian = Math.floor(Number(starQian));
        if (isNaN(intStarQian) || intStarQian < 0) {
            return res.json({ code: 400, msg: getCurrencyName() + '奖励必须为非负整数' });
        }

        var validatedItems = [];
        if (Array.isArray(mailItems) && mailItems.length > 0) {
            if (mailItems.length > 10) {
                return res.json({ code: 400, msg: '附件物品不能超过10个' });
            }
            for (var i = 0; i < mailItems.length; i++) {
                var it = mailItems[i];
                var itemType = it.type || 'item';

                if (itemType === 'snbt') {
                    if (!it.snbt || typeof it.snbt !== 'string' || !it.snbt.trim()) {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个物品缺少snbt' });
                    }
                    validatedItems.push({
                        type: 'snbt',
                        snbt: it.snbt.trim()
                    });
                } else {
                    if (!it.id || typeof it.id !== 'string') {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个物品缺少id' });
                    }
                    var count = Math.floor(Number(it.count)) || 1;
                    if (count < 1 || count > 2304) {
                        return res.json({ code: 400, msg: '第' + (i + 1) + '个物品数量无效(1-2304)' });
                    }
                    var itemId = it.id.startsWith('minecraft:') ? it.id : 'minecraft:' + it.id;
                    var itemName = getItemName(it.id) || it.id;
                    var snbtStr = '{"Count":' + count + 'b,"Damage":0s,"Name":"' + itemId + '","WasPickedUp":0b}';
                    validatedItems.push({
                        type: 'item',
                        id: it.id,
                        count: count,
                        name: itemName,
                        snbt: snbtStr
                    });
                }
            }
        }

        if (scheduledTime) {
            if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?$/.test(scheduledTime)) {
                return res.json({ code: 400, msg: '定时时间格式不正确，正确格式：2026.05.12.18.00' });
            }
            var parts = scheduledTime.split('.').map(Number);
            var scheduledDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] || 0, 0);
            if (scheduledDate <= new Date()) {
                return res.json({ code: 400, msg: '定时时间必须晚于当前时间' });
            }
        }

        try {
            if (toXuid !== 'all') {
                var playerData = getPlayerData();
                if (!playerData || !playerData.players || !playerData.players[toXuid]) {
                    return res.json({ code: 404, msg: '目标玩家不存在' });
                }
            }

            var newMail = {
                id: mailApi.getNextId(),
                fromXuid: '',
                fromName: '系统',
                toXuid: toXuid,
                content: content.trim(),
                time: mailApi.formatMailTime(),
                read: false,
                starQian: intStarQian,
                items: validatedItems,
                claimed: toXuid === 'all' ? {} : false
            };

            if (scheduledTime) {
                newMail.scheduledTime = scheduledTime;
            }

            mailApi.addMail(newMail);
            mailApi.incrementNextId();

            if (!scheduledTime) {
                if (toXuid === 'all') {
                    try {
                        var onlinePlayers = mc.getOnlinePlayers();
                        onlinePlayers.forEach(function(p) {
                            try {
                                p.sendToast('§e新邮件提醒', '§a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + getCurrencyName() + '奖励' : ''));
                                p.tell('§e[邮件] §a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + getCurrencyName() + '奖励，请在邮件系统中领取' : '，请在邮件系统中查看'));
                            } catch (e) {}
                        });
                    } catch (e) {}
                } else {
                    try {
                        var targetPlayer = mc.getPlayer(toXuid);
                        if (targetPlayer) {
                            targetPlayer.sendToast('§e新邮件提醒', '§a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + getCurrencyName() + '奖励' : ''));
                            targetPlayer.tell('§e[邮件] §a您收到了一封系统邮件' + (intStarQian > 0 ? '，内含' + getCurrencyName() + '奖励，请在邮件系统中领取' : '，请在邮件系统中查看'));
                        }
                    } catch (e) {}
                }
            }

            var targetDesc = toXuid === 'all' ? '全体玩家' : getPlayerName(toXuid);
            adminLog.log(req.user.uid, '发送邮件', targetDesc, '内容: ' + content.trim().substring(0, 100) + (intStarQian > 0 ? ' ' + getCurrencyName() + ': ' + intStarQian : '') + (scheduledTime ? ' 定时: ' + scheduledTime : ''));

            res.json({
                code: 200,
                msg: scheduledTime ? '定时邮件已设置，将在 ' + scheduledTime + ' 发送' : '邮件已发送给 ' + targetDesc,
                data: {
                    id: newMail.id,
                    toXuid: toXuid,
                    toName: targetDesc
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '发送邮件失败: ' + e.message });
        }
    });

    router.delete('/mails/:id', adminAuth, function(req, res) {
        try {
            var mailId = parseInt(req.params.id);
            var mail = mailApi.getMailById(mailId);

            if (!mail) {
                return res.json({ code: 404, msg: '邮件不存在' });
            }

            var targetDesc = mail.toXuid === 'all' ? '全体玩家' : getPlayerName(mail.toXuid);
            var contentPreview = (mail.content || '').substring(0, 100);

            if (!mailApi.deleteMail(mailId)) {
                return res.json({ code: 500, msg: '保存邮件数据失败' });
            }

            adminLog.log(req.user.uid, '删除邮件', 'ID:' + mailId + ' 目标:' + targetDesc, '内容: ' + contentPreview);

            res.json({ code: 200, msg: '邮件已删除' });
        } catch (e) {
            res.json({ code: 500, msg: '删除邮件失败: ' + e.message });
        }
    });

    router.get('/messages', auth, function(req, res) {
        try {
            var userXuid = getXuidByUid(req.user.uid) || req.user.uid;
            var isAdminUser = database.isAdmin(req.user.uid);
            var options = {
                page: req.query.page,
                pageSize: req.query.pageSize,
                search: req.query.search,
                mood: req.query.mood,
                xuid: req.query.xuid || '',
                includeDeleted: false
            };

            if (isAdminUser) {
                options.includeDeleted = req.query.includeDeleted === 'true';
            } else {
                options.xuid = userXuid;
            }

            var result = messageBoardApi.getMessages(options);

            result.messages = result.messages.map(function(m) {
                var msg = Object.assign({}, m);
                msg.canDelete = isAdminUser || m.xuid === userXuid;
                return msg;
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取留言列表失败: ' + e.message });
        }
    });

    router.get('/messages/all', adminAuth, function(req, res) {
        try {
            var options = {
                page: req.query.page,
                pageSize: req.query.pageSize,
                search: req.query.search,
                mood: req.query.mood,
                xuid: req.query.xuid || '',
                includeDeleted: req.query.includeDeleted === 'true'
            };

            var result = messageBoardApi.getMessages(options);

            result.messages = result.messages.map(function(m) {
                var msg = Object.assign({}, m);
                msg.canDelete = true;
                return msg;
            });

            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取留言列表失败: ' + e.message });
        }
    });

    router.get('/messages/:id', auth, function(req, res) {
        try {
            var msgId = parseInt(req.params.id);
            var msg = messageBoardApi.getMessageById(msgId);

            if (!msg) {
                return res.json({ code: 404, msg: '留言不存在' });
            }

            var userXuid = getXuidByUid(req.user.uid) || req.user.uid;
            if (!database.isAdmin(req.user.uid) && msg.xuid !== userXuid) {
                return res.json({ code: 403, msg: '无权查看此留言' });
            }

            res.json({ code: 200, data: msg });
        } catch (e) {
            res.json({ code: 500, msg: '获取留言详情失败: ' + e.message });
        }
    });

    router.post('/messages', auth, function(req, res) {
        try {
            var content = req.body.content;
            var mood = req.body.mood || '平静';

            if (!content || !content.trim()) {
                return res.json({ code: 400, msg: '留言内容不能为空' });
            }

            if (content.length > 500) {
                return res.json({ code: 400, msg: '留言内容不能超过500字符' });
            }

            var MOOD_OPTIONS = ['开心', '难过', '平静', '兴奋', '生气'];
            if (MOOD_OPTIONS.indexOf(mood) === -1) {
                mood = '平静';
            }

            var xuid = getXuidByUid(req.user.uid) || req.user.uid;
            var playerName = getPlayerNameByUid(req.user.uid);

            var newMsg = {
                id: messageBoardApi.getNextId(),
                xuid: xuid,
                playerName: playerName,
                msg: content.trim(),
                mood: mood,
                time: messageBoardApi.formatTime(),
                client: 'Web',
                isDeleted: false
            };

            messageBoardApi.addMessage(newMsg);

            res.json({
                code: 200,
                msg: '留言发布成功',
                data: { id: newMsg.id }
            });
        } catch (e) {
            res.json({ code: 500, msg: '发布留言失败: ' + e.message });
        }
    });

    router.delete('/messages/:id', auth, function(req, res) {
        try {
            var msgId = parseInt(req.params.id);
            var msg = messageBoardApi.getMessageById(msgId);

            if (!msg) {
                return res.json({ code: 404, msg: '留言不存在' });
            }

            var userXuid = getXuidByUid(req.user.uid) || req.user.uid;
            if (!database.isAdmin(req.user.uid) && msg.xuid !== userXuid) {
                return res.json({ code: 403, msg: '无权删除此留言' });
            }

            if (msg.isDeleted) {
                return res.json({ code: 400, msg: '留言已被删除' });
            }

            if (!messageBoardApi.deleteMessage(msgId)) {
                return res.json({ code: 500, msg: '删除留言失败' });
            }

            if (database.isAdmin(req.user.uid) && msg.xuid !== userXuid) {
                adminLog.log(req.user.uid, '删除留言', 'ID:' + msgId, '作者: ' + msg.playerName + ' 内容: ' + (msg.msg || '').substring(0, 100));
            }

            res.json({ code: 200, msg: '留言已删除' });
        } catch (e) {
            res.json({ code: 500, msg: '删除留言失败: ' + e.message });
        }
    });

    var SPONSORSHIP_PATH = pathModule.join(__dirname, '..', 'data', 'sponsorship.json');

    function loadSponsorship() {
        try {
            if (!fs.existsSync(SPONSORSHIP_PATH)) {
                fs.writeFileSync(SPONSORSHIP_PATH, '[]', 'utf-8');
                return [];
            }
            var content = fs.readFileSync(SPONSORSHIP_PATH, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return [];
        }
    }

    function saveSponsorship(data) {
        fs.writeFileSync(SPONSORSHIP_PATH, JSON.stringify(data, null, 2), 'utf-8');
    }

    router.get('/sponsorship', function(req, res) {
        try {
            var list = loadSponsorship();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取赞助列表失败: ' + e.message });
        }
    });

    router.post('/sponsorship', adminAuth, function(req, res) {
        try {
            var id = req.body.id;
            var amount = req.body.amount;
            var message = req.body.message || '';
            var avatar = req.body.avatar || '';

            if (!id || typeof id !== 'string' || !id.trim()) {
                return res.json({ code: 400, msg: '缺少赞助者ID' });
            }
            if (!amount || typeof amount !== 'string' || !amount.trim()) {
                return res.json({ code: 400, msg: '缺少赞助金额' });
            }

            var list = loadSponsorship();
            var newEntry = {
                id: id.trim(),
                amount: amount.trim(),
                message: message.trim(),
                avatar: avatar.trim()
            };
            list.push(newEntry);
            saveSponsorship(list);

            adminLog.log(req.user.uid, '添加赞助', 'ID:' + newEntry.id + ' 金额:' + newEntry.amount);
            res.json({ code: 200, msg: '添加成功', data: newEntry });
        } catch (e) {
            res.json({ code: 500, msg: '添加赞助失败: ' + e.message });
        }
    });

    router.put('/sponsorship/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var list = loadSponsorship();

            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '赞助记录不存在' });
            }

            var entry = list[idx];
            if (req.body.id !== undefined) entry.id = String(req.body.id).trim();
            if (req.body.amount !== undefined) entry.amount = String(req.body.amount).trim();
            if (req.body.message !== undefined) entry.message = String(req.body.message).trim();
            if (req.body.avatar !== undefined) entry.avatar = String(req.body.avatar).trim();

            saveSponsorship(list);

            adminLog.log(req.user.uid, '修改赞助', '索引:' + idx + ' ID:' + entry.id);
            res.json({ code: 200, msg: '修改成功', data: entry });
        } catch (e) {
            res.json({ code: 500, msg: '修改赞助失败: ' + e.message });
        }
    });

    router.delete('/sponsorship/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var list = loadSponsorship();

            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '赞助记录不存在' });
            }

            var removed = list.splice(idx, 1)[0];
            saveSponsorship(list);

            adminLog.log(req.user.uid, '删除赞助', 'ID:' + removed.id + ' 金额:' + removed.amount);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除赞助失败: ' + e.message });
        }
    });

    var WISH_CONFIG_PATH = pathModule.join(__dirname, '..', 'config.json');

    function loadWishConfig() {
        try {
            var content = fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            var cfg = JSON.parse(content);
            return cfg.wishConfig || {};
        } catch (e) {
            return {};
        }
    }

    function saveWishConfig(wishCfg) {
        try {
            var content = fs.readFileSync(WISH_CONFIG_PATH, 'utf-8');
            var cfg = JSON.parse(content);
            cfg.wishConfig = wishCfg;
            fs.writeFileSync(WISH_CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
            triggerReload('wish');
        } catch (e) {
            throw e;
        }
    }

    router.get('/wish', function(req, res) {
        try {
            var config = loadWishConfig();
            res.json({ code: 200, data: config });
        } catch (e) {
            res.json({ code: 500, msg: '获取祈愿配置失败: ' + e.message });
        }
    });

    router.put('/wish/banner', adminAuth, function(req, res) {
        try {
            var config = loadWishConfig();
            config.banner = req.body.banner || '';
            saveWishConfig(config);
            adminLog.log(req.user.uid, '修改卡池信息', 'Banner已更新');
            res.json({ code: 200, msg: '修改成功', data: { banner: config.banner } });
        } catch (e) {
            res.json({ code: 500, msg: '修改卡池信息失败: ' + e.message });
        }
    });

    router.post('/wish/fourStar', adminAuth, function(req, res) {
        try {
            var name = req.body.name;
            var snbt = req.body.snbt;
            if (!name || !snbt) {
                return res.json({ code: 400, msg: 'name和snbt为必填项' });
            }
            var config = loadWishConfig();
            if (!config.rewards) config.rewards = {};
            if (!config.rewards.fourStar) config.rewards.fourStar = [];
            var item = { name: name, snbt: snbt };
            config.rewards.fourStar.push(item);
            saveWishConfig(config);
            adminLog.log(req.user.uid, '添加四星奖励', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.json({ code: 500, msg: '添加四星奖励失败: ' + e.message });
        }
    });

    router.put('/wish/fourStar/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var config = loadWishConfig();
            var list = (config.rewards && config.rewards.fourStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            config.rewards.fourStar = list;
            saveWishConfig(config);
            adminLog.log(req.user.uid, '修改四星奖励', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.json({ code: 500, msg: '修改四星奖励失败: ' + e.message });
        }
    });

    router.delete('/wish/fourStar/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var config = loadWishConfig();
            var list = (config.rewards && config.rewards.fourStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            var removed = list.splice(idx, 1)[0];
            config.rewards.fourStar = list;
            saveWishConfig(config);
            adminLog.log(req.user.uid, '删除四星奖励', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除四星奖励失败: ' + e.message });
        }
    });

    router.post('/wish/fiveStar', adminAuth, function(req, res) {
        try {
            var name = req.body.name;
            var snbt = req.body.snbt;
            if (!name || !snbt) {
                return res.json({ code: 400, msg: 'name和snbt为必填项' });
            }
            var config = loadWishConfig();
            if (!config.rewards) config.rewards = {};
            if (!config.rewards.fiveStar) config.rewards.fiveStar = [];
            var item = { name: name, snbt: snbt };
            config.rewards.fiveStar.push(item);
            saveWishConfig(config);
            adminLog.log(req.user.uid, '添加五星奖励', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.json({ code: 500, msg: '添加五星奖励失败: ' + e.message });
        }
    });

    router.put('/wish/fiveStar/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var config = loadWishConfig();
            var list = (config.rewards && config.rewards.fiveStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            config.rewards.fiveStar = list;
            saveWishConfig(config);
            adminLog.log(req.user.uid, '修改五星奖励', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.json({ code: 500, msg: '修改五星奖励失败: ' + e.message });
        }
    });

    router.delete('/wish/fiveStar/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var config = loadWishConfig();
            var list = (config.rewards && config.rewards.fiveStar) || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '奖励不存在' });
            }
            var removed = list.splice(idx, 1)[0];
            config.rewards.fiveStar = list;
            saveWishConfig(config);
            adminLog.log(req.user.uid, '删除五星奖励', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除五星奖励失败: ' + e.message });
        }
    });

    router.post('/wish/coreShop', adminAuth, function(req, res) {
        try {
            var name = req.body.name;
            var snbt = req.body.snbt;
            var cost = req.body.cost;
            if (!name || !snbt || cost === undefined) {
                return res.json({ code: 400, msg: 'name、snbt和cost为必填项' });
            }
            var config = loadWishConfig();
            if (!config.coreShop) config.coreShop = [];
            var item = {
                name: name,
                snbt: snbt,
                cost: cost,
                description: req.body.description || '',
                icon: req.body.icon || ''
            };
            config.coreShop.push(item);
            saveWishConfig(config);
            adminLog.log(req.user.uid, '添加星核兑换物品', '名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: item });
        } catch (e) {
            res.json({ code: 500, msg: '添加星核兑换物品失败: ' + e.message });
        }
    });

    router.put('/wish/coreShop/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var config = loadWishConfig();
            var list = config.coreShop || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '兑换物品不存在' });
            }
            if (req.body.name !== undefined) list[idx].name = req.body.name;
            if (req.body.snbt !== undefined) list[idx].snbt = req.body.snbt;
            if (req.body.cost !== undefined) list[idx].cost = req.body.cost;
            if (req.body.description !== undefined) list[idx].description = req.body.description;
            if (req.body.icon !== undefined) list[idx].icon = req.body.icon;
            config.coreShop = list;
            saveWishConfig(config);
            adminLog.log(req.user.uid, '修改星核兑换物品', '索引:' + idx + ' 名称:' + list[idx].name);
            res.json({ code: 200, msg: '修改成功', data: list[idx] });
        } catch (e) {
            res.json({ code: 500, msg: '修改星核兑换物品失败: ' + e.message });
        }
    });

    router.delete('/wish/coreShop/:index', adminAuth, function(req, res) {
        try {
            var idx = parseInt(req.params.index);
            var config = loadWishConfig();
            var list = config.coreShop || [];
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                return res.json({ code: 404, msg: '兑换物品不存在' });
            }
            var removed = list.splice(idx, 1)[0];
            config.coreShop = list;
            saveWishConfig(config);
            adminLog.log(req.user.uid, '删除星核兑换物品', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除星核兑换物品失败: ' + e.message });
        }
    });

    router.put('/wish/threeStar', adminAuth, function(req, res) {
        try {
            var cfg = loadWishConfig();
            if (!cfg.rewards) cfg.rewards = {};
            if (!cfg.rewards.threeStar) cfg.rewards.threeStar = {};
            if (req.body.minDust !== undefined) {
                var min = parseInt(req.body.minDust);
                if (isNaN(min) || min < 0) return res.json({ code: 400, msg: 'minDust必须为非负整数' });
                cfg.rewards.threeStar.minDust = min;
            }
            if (req.body.maxDust !== undefined) {
                var max = parseInt(req.body.maxDust);
                if (isNaN(max) || max < 0) return res.json({ code: 400, msg: 'maxDust必须为非负整数' });
                cfg.rewards.threeStar.maxDust = max;
            }
            if (cfg.rewards.threeStar.minDust > cfg.rewards.threeStar.maxDust) {
                return res.json({ code: 400, msg: 'minDust不能大于maxDust' });
            }
            saveWishConfig(cfg);
            adminLog.log(req.user.uid, '修改三星物品配置', JSON.stringify(cfg.rewards.threeStar));
            res.json({ code: 200, msg: '修改成功', data: cfg.rewards.threeStar });
        } catch (e) {
            res.json({ code: 500, msg: '修改三星物品配置失败: ' + e.message });
        }
    });

    router.put('/wish/rates', adminAuth, function(req, res) {
        try {
            var cfg = loadWishConfig();
            if (!cfg.rates) cfg.rates = {};
            if (req.body.fiveStar !== undefined) {
                var v = parseFloat(req.body.fiveStar);
                if (isNaN(v) || v < 0 || v > 1) return res.json({ code: 400, msg: 'fiveStar概率必须在0-1之间' });
                cfg.rates.fiveStar = v;
            }
            if (req.body.fourStar !== undefined) {
                var v = parseFloat(req.body.fourStar);
                if (isNaN(v) || v < 0 || v > 1) return res.json({ code: 400, msg: 'fourStar概率必须在0-1之间' });
                cfg.rates.fourStar = v;
            }
            if (req.body.fiveStarSoftPity !== undefined) {
                var v = parseInt(req.body.fiveStarSoftPity);
                if (isNaN(v) || v < 1) return res.json({ code: 400, msg: 'fiveStarSoftPity必须为正整数' });
                cfg.rates.fiveStarSoftPity = v;
            }
            if (req.body.fiveStarHardPity !== undefined) {
                var v = parseInt(req.body.fiveStarHardPity);
                if (isNaN(v) || v < 1) return res.json({ code: 400, msg: 'fiveStarHardPity必须为正整数' });
                cfg.rates.fiveStarHardPity = v;
            }
            if (req.body.fourStarGuarantee !== undefined) {
                var v = parseInt(req.body.fourStarGuarantee);
                if (isNaN(v) || v < 1) return res.json({ code: 400, msg: 'fourStarGuarantee必须为正整数' });
                cfg.rates.fourStarGuarantee = v;
            }
            saveWishConfig(cfg);
            adminLog.log(req.user.uid, '修改祈愿概率配置', JSON.stringify(cfg.rates));
            res.json({ code: 200, msg: '修改成功', data: cfg.rates });
        } catch (e) {
            res.json({ code: 500, msg: '修改祈愿概率配置失败: ' + e.message });
        }
    });

    router.put('/wish/cost', adminAuth, function(req, res) {
        try {
            var cfg = loadWishConfig();
            if (!cfg.cost) cfg.cost = {};
            if (req.body.single !== undefined) {
                var v = parseInt(req.body.single);
                if (isNaN(v) || v < 0) return res.json({ code: 400, msg: 'single必须为非负整数' });
                cfg.cost.single = v;
            }
            if (req.body.ten !== undefined) {
                var v = parseInt(req.body.ten);
                if (isNaN(v) || v < 0) return res.json({ code: 400, msg: 'ten必须为非负整数' });
                cfg.cost.ten = v;
            }
            saveWishConfig(cfg);
            adminLog.log(req.user.uid, '修改祈愿花费配置', JSON.stringify(cfg.cost));
            res.json({ code: 200, msg: '修改成功', data: cfg.cost });
        } catch (e) {
            res.json({ code: 500, msg: '修改祈愿花费配置失败: ' + e.message });
        }
    });

    router.put('/wish/names', adminAuth, function(req, res) {
        try {
            var cfg = loadWishConfig();
            if (req.body.dustName !== undefined) {
                if (typeof req.body.dustName !== 'string' || req.body.dustName.trim() === '') {
                    return res.json({ code: 400, msg: 'dustName不能为空' });
                }
                cfg.dustName = req.body.dustName.trim();
            }
            if (req.body.coreName !== undefined) {
                if (typeof req.body.coreName !== 'string' || req.body.coreName.trim() === '') {
                    return res.json({ code: 400, msg: 'coreName不能为空' });
                }
                cfg.coreName = req.body.coreName.trim();
            }
            saveWishConfig(cfg);
            adminLog.log(req.user.uid, '修改祈愿自定义名称', 'dustName:' + cfg.dustName + ' coreName:' + cfg.coreName);
            res.json({ code: 200, msg: '修改成功', data: { dustName: cfg.dustName, coreName: cfg.coreName } });
        } catch (e) {
            res.json({ code: 500, msg: '修改自定义名称失败: ' + e.message });
        }
    });

    router.put('/wish/description', adminAuth, function(req, res) {
        try {
            var cfg = loadWishConfig();
            if (req.body.description !== undefined) {
                cfg.description = req.body.description;
            }
            saveWishConfig(cfg);
            adminLog.log(req.user.uid, '修改祈愿系统说明', 'description已更新');
            res.json({ code: 200, msg: '修改成功', data: { description: cfg.description } });
        } catch (e) {
            res.json({ code: 500, msg: '修改祈愿系统说明失败: ' + e.message });
        }
    });

    var MAIN_CONFIG_PATH = pathModule.join(__dirname, '..', 'config.json');

    router.get('/features', adminAuth, function(req, res) {
        try {
            var content = fs.readFileSync(MAIN_CONFIG_PATH, 'utf-8');
            var cfg = JSON.parse(content);
            var features = {};
            var featureKeys = ['enableRank', 'enableShop', 'enableCdk', 'enableRecycle',
                'enableDustShop', 'enableWish', 'enableBank', 'enableVip',
                'enableFriend', 'enableMessageBoard', 'enableMail', 'enableLevel', 'enableBack'];
            featureKeys.forEach(function(key) {
                features[key] = cfg[key] !== undefined ? cfg[key] : true;
            });
            res.json({ code: 200, data: features });
        } catch (e) {
            res.json({ code: 500, msg: '获取功能开关失败: ' + e.message });
        }
    });

    router.put('/features', adminAuth, function(req, res) {
        try {
            var content = fs.readFileSync(MAIN_CONFIG_PATH, 'utf-8');
            var cfg = JSON.parse(content);
            var featureKeys = ['enableRank', 'enableShop', 'enableCdk', 'enableRecycle',
                'enableDustShop', 'enableWish', 'enableBank', 'enableVip',
                'enableFriend', 'enableMessageBoard', 'enableMail', 'enableLevel', 'enableBack'];
            var updated = {};
            featureKeys.forEach(function(key) {
                if (req.body[key] !== undefined) {
                    cfg[key] = !!req.body[key];
                    updated[key] = cfg[key];
                }
            });
            fs.writeFileSync(MAIN_CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
            triggerReload('config');
            adminLog.log(req.user.uid, '修改功能开关', JSON.stringify(updated));
            res.json({ code: 200, msg: '修改成功', data: updated });
        } catch (e) {
            res.json({ code: 500, msg: '修改功能开关失败: ' + e.message });
        }
    });

    var RECYCLE_PATH = pathModule.join(__dirname, '..', 'data', 'Recycleitems.json');
    var SHOP_DATA_PATH_API = pathModule.join(__dirname, '..', 'data', 'shopdata.json');
    var ITEMS_PATH = pathModule.join(__dirname, '..', 'WEB', 'textures', 'items.json');

    function loadItemsMap() {
        try {
            var content = fs.readFileSync(ITEMS_PATH, 'utf-8');
            var data = JSON.parse(content);
            return data.item || data;
        } catch (e) {
            return {};
        }
    }

    function validateItemId(rawId) {
        var itemsMap = loadItemsMap();
        var cleanId = rawId.replace(/^minecraft:/, '');
        var item = itemsMap[cleanId];
        if (item) {
            var name = (typeof item === 'object') ? (item.name || cleanId) : item;
            var texture = (typeof item === 'object') ? (item.texture || '') : '';
            return { valid: true, fullId: 'minecraft:' + cleanId, name: name, image: texture };
        }
        return { valid: false };
    }

    function loadRecycleConfig() {
        try {
            var content = fs.readFileSync(RECYCLE_PATH, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return { recycleItems: {} };
        }
    }

    function saveRecycleConfig(config) {
        fs.writeFileSync(RECYCLE_PATH, JSON.stringify(config, null, 2), 'utf-8');
        triggerReload('recycle');
    }

    function getRecycleItemInfo(id, recycleItems, itemsMap) {
        var cleanId = id.replace(/^minecraft:/, '');
        var entry = recycleItems[id];
        var name = cleanId;
        var image = '';
        var price = 0;
        if (entry && typeof entry === 'object') {
            name = entry.name || cleanId;
            image = entry.image || '';
            price = entry.price;
        } else if (typeof entry === 'number') {
            price = entry;
            var item = itemsMap[cleanId];
            if (item && typeof item === 'object') {
                name = item.name || cleanId;
                image = item.texture || '';
            } else if (typeof item === 'string') {
                name = item;
            }
        }
        return { id: id, name: name, image: image, price: price };
    }

    router.get('/recycle', adminAuth, function(req, res) {
        try {
            var config = loadRecycleConfig();
            var itemsMap = loadItemsMap();
            var list = [];
            var recycleItems = config.recycleItems || {};
            Object.keys(recycleItems).forEach(function(id) {
                list.push(getRecycleItemInfo(id, recycleItems, itemsMap));
            });
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取回收列表失败: ' + e.message });
        }
    });

    router.post('/recycle', adminAuth, function(req, res) {
        try {
            var rawId = req.body.id;
            var price = req.body.price;
            if (!rawId || price === undefined) {
                return res.json({ code: 400, msg: 'id和price为必填项' });
            }
            var v = validateItemId(rawId);
            if (!v.valid) {
                return res.json({ code: 400, msg: '物品ID无效，不在items列表中' });
            }
            var config = loadRecycleConfig();
            if (!config.recycleItems) config.recycleItems = {};
            config.recycleItems[v.fullId] = { name: v.name, image: v.image, price: price };
            saveRecycleConfig(config);
            adminLog.log(req.user.uid, '添加回收物品', 'ID:' + v.fullId + ' 价格:' + price);
            res.json({ code: 200, msg: '添加成功', data: { id: v.fullId, name: v.name, image: v.image, price: price } });
        } catch (e) {
            res.json({ code: 500, msg: '添加回收物品失败: ' + e.message });
        }
    });

    router.put('/recycle/:id', adminAuth, function(req, res) {
        try {
            var rawId = decodeURIComponent(req.params.id);
            var price = req.body.price;
            if (price === undefined) {
                return res.json({ code: 400, msg: 'price为必填项' });
            }
            var config = loadRecycleConfig();
            if (!config.recycleItems || config.recycleItems[rawId] === undefined) {
                return res.json({ code: 404, msg: '回收物品不存在' });
            }
            var itemsMap = loadItemsMap();
            var info = getRecycleItemInfo(rawId, config.recycleItems, itemsMap);
            config.recycleItems[rawId] = { name: info.name, image: info.image, price: price };
            saveRecycleConfig(config);
            adminLog.log(req.user.uid, '修改回收物品', 'ID:' + rawId + ' 价格:' + price);
            res.json({ code: 200, msg: '修改成功', data: { id: rawId, name: info.name, image: info.image, price: price } });
        } catch (e) {
            res.json({ code: 500, msg: '修改回收物品失败: ' + e.message });
        }
    });

    router.delete('/recycle/:id', adminAuth, function(req, res) {
        try {
            var rawId = decodeURIComponent(req.params.id);
            var config = loadRecycleConfig();
            if (!config.recycleItems || config.recycleItems[rawId] === undefined) {
                return res.json({ code: 404, msg: '回收物品不存在' });
            }
            delete config.recycleItems[rawId];
            saveRecycleConfig(config);
            adminLog.log(req.user.uid, '删除回收物品', 'ID:' + rawId);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除回收物品失败: ' + e.message });
        }
    });

    function loadShopData() {
        try {
            var content = fs.readFileSync(SHOP_DATA_PATH_API, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return { Buy: [], Sell: [] };
        }
    }

    function saveShopData(data) {
        fs.writeFileSync(SHOP_DATA_PATH_API, JSON.stringify(data, null, 2), 'utf-8');
        triggerReload('shop');
    }

    router.get('/shop', adminAuth, function(req, res) {
        try {
            var data = loadShopData();
            var group = req.query.group;
            if (group === 'Buy' || group === 'Sell') {
                res.json({ code: 200, data: data[group] || [] });
            } else {
                res.json({ code: 200, data: data });
            }
        } catch (e) {
            res.json({ code: 500, msg: '获取商店数据失败: ' + e.message });
        }
    });

    router.get('/shop/groups', adminAuth, function(req, res) {
        try {
            var data = loadShopData();
            var group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var groups = (data[group] || []).map(function(g, idx) {
                return { index: idx, name: g.name, image: g.image, itemCount: (g.items || []).length };
            });
            res.json({ code: 200, data: groups });
        } catch (e) {
            res.json({ code: 500, msg: '获取商店分组失败: ' + e.message });
        }
    });

    router.post('/shop/group', adminAuth, function(req, res) {
        try {
            var group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var name = req.body.name;
            var image = req.body.image || '';
            if (!name) {
                return res.json({ code: 400, msg: '分组名称为必填项' });
            }
            var data = loadShopData();
            if (!data[group]) data[group] = [];
            var newGroup = { name: name, image: image, items: [] };
            data[group].push(newGroup);
            saveShopData(data);
            adminLog.log(req.user.uid, '添加商店分组', '大组:' + group + ' 名称:' + name);
            res.json({ code: 200, msg: '添加成功', data: { index: data[group].length - 1, name: name } });
        } catch (e) {
            res.json({ code: 500, msg: '添加商店分组失败: ' + e.message });
        }
    });

    router.put('/shop/group/:groupIdx', adminAuth, function(req, res) {
        try {
            var group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var gIdx = parseInt(req.params.groupIdx);
            var data = loadShopData();
            var list = data[group] || [];
            if (isNaN(gIdx) || gIdx < 0 || gIdx >= list.length) {
                return res.json({ code: 404, msg: '分组不存在' });
            }
            if (req.body.name !== undefined) list[gIdx].name = req.body.name;
            if (req.body.image !== undefined) list[gIdx].image = req.body.image;
            data[group] = list;
            saveShopData(data);
            adminLog.log(req.user.uid, '修改商店分组', '索引:' + gIdx + ' 名称:' + list[gIdx].name);
            res.json({ code: 200, msg: '修改成功', data: { index: gIdx, name: list[gIdx].name } });
        } catch (e) {
            res.json({ code: 500, msg: '修改商店分组失败: ' + e.message });
        }
    });

    router.delete('/shop/group/:groupIdx', adminAuth, function(req, res) {
        try {
            var group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var gIdx = parseInt(req.params.groupIdx);
            var data = loadShopData();
            var list = data[group] || [];
            if (isNaN(gIdx) || gIdx < 0 || gIdx >= list.length) {
                return res.json({ code: 404, msg: '分组不存在' });
            }
            var removed = list.splice(gIdx, 1)[0];
            data[group] = list;
            saveShopData(data);
            adminLog.log(req.user.uid, '删除商店分组', '名称:' + removed.name);
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除商店分组失败: ' + e.message });
        }
    });

    router.get('/shop/items', adminAuth, function(req, res) {
        try {
            var group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var gIdx = parseInt(req.query.groupIdx);
            if (isNaN(gIdx)) {
                return res.json({ code: 400, msg: 'groupIdx参数必填' });
            }
            var data = loadShopData();
            var groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.json({ code: 404, msg: '分组不存在' });
            }
            var items = groups[gIdx].items || [];
            var itemsMap = loadItemsMap();
            var result = items.map(function(item, idx) {
                var cleanId = (item.id || '').replace(/^minecraft:/, '');
                var itemInfo = itemsMap[cleanId] || {};
                var itemName = (typeof itemInfo === 'object') ? (itemInfo.name || cleanId) : itemInfo;
                var itemTexture = (typeof itemInfo === 'object') ? (itemInfo.texture || '') : '';
                return {
                    index: idx,
                    id: item.id || '',
                    name: itemName,
                    image: itemTexture,
                    money: item.money || 0
                };
            });
            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '获取商店物品失败: ' + e.message });
        }
    });

    router.post('/shop/item', adminAuth, function(req, res) {
        try {
            var group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var gIdx = parseInt(req.body.groupIdx);
            if (isNaN(gIdx)) {
                return res.json({ code: 400, msg: 'groupIdx参数必填' });
            }
            var rawId = req.body.id;
            var money = req.body.money;
            if (!rawId || money === undefined) {
                return res.json({ code: 400, msg: 'id和money为必填项' });
            }
            var v = validateItemId(rawId);
            if (!v.valid) {
                return res.json({ code: 400, msg: '物品ID无效，不在items列表中' });
            }
            var data = loadShopData();
            var groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.json({ code: 404, msg: '分组不存在' });
            }
            var newItem = {
                id: v.fullId,
                money: money
            };
            if (!groups[gIdx].items) groups[gIdx].items = [];
            groups[gIdx].items.push(newItem);
            data[group] = groups;
            saveShopData(data);
            adminLog.log(req.user.uid, '添加商店物品', '大组:' + group + ' 分组:' + gIdx + ' ID:' + v.fullId);
            res.json({ code: 200, msg: '添加成功', data: { id: v.fullId, name: v.name, money: money } });
        } catch (e) {
            res.json({ code: 500, msg: '添加商店物品失败: ' + e.message });
        }
    });

    router.put('/shop/item/:itemIdx', adminAuth, function(req, res) {
        try {
            var group = req.body.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var gIdx = parseInt(req.body.groupIdx);
            var iIdx = parseInt(req.params.itemIdx);
            if (isNaN(gIdx) || isNaN(iIdx)) {
                return res.json({ code: 400, msg: 'groupIdx和itemIdx参数必填' });
            }
            var data = loadShopData();
            var groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.json({ code: 404, msg: '分组不存在' });
            }
            var items = groups[gIdx].items || [];
            if (iIdx < 0 || iIdx >= items.length) {
                return res.json({ code: 404, msg: '物品不存在' });
            }
            if (req.body.id !== undefined) {
                var v = validateItemId(req.body.id);
                if (!v.valid) {
                    return res.json({ code: 400, msg: '物品ID无效，不在items列表中' });
                }
                items[iIdx].id = v.fullId;
            }
            if (req.body.money !== undefined) {
                items[iIdx].money = req.body.money;
            }
            groups[gIdx].items = items;
            data[group] = groups;
            saveShopData(data);
            adminLog.log(req.user.uid, '修改商店物品', '大组:' + group + ' 分组:' + gIdx + ' 物品索引:' + iIdx);
            res.json({ code: 200, msg: '修改成功' });
        } catch (e) {
            res.json({ code: 500, msg: '修改商店物品失败: ' + e.message });
        }
    });

    router.delete('/shop/item/:itemIdx', adminAuth, function(req, res) {
        try {
            var group = req.query.group;
            if (!group || (group !== 'Buy' && group !== 'Sell')) {
                return res.json({ code: 400, msg: 'group参数必填，值为Buy或Sell' });
            }
            var gIdx = parseInt(req.query.groupIdx);
            var iIdx = parseInt(req.params.itemIdx);
            if (isNaN(gIdx) || isNaN(iIdx)) {
                return res.json({ code: 400, msg: 'groupIdx参数必填' });
            }
            var data = loadShopData();
            var groups = data[group] || [];
            if (gIdx < 0 || gIdx >= groups.length) {
                return res.json({ code: 404, msg: '分组不存在' });
            }
            var items = groups[gIdx].items || [];
            if (iIdx < 0 || iIdx >= items.length) {
                return res.json({ code: 404, msg: '物品不存在' });
            }
            var removed = items.splice(iIdx, 1)[0];
            groups[gIdx].items = items;
            data[group] = groups;
            saveShopData(data);
            adminLog.log(req.user.uid, '删除商店物品', 'ID:' + (removed.id || ''));
            res.json({ code: 200, msg: '删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除商店物品失败: ' + e.message });
        }
    });

    // ============================== 传送系统管理API ==============================

    var WARPS_DATA_PATH = pathModule.join(__dirname, '..', 'data', 'warps.json');
    var HOMES_DATA_PATH = pathModule.join(__dirname, '..', 'data', 'homes.json');
    var CONFIG_PATH = pathModule.join(__dirname, '..', 'config.json');

    function readJsonFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        } catch (e) {}
        return {};
    }

    function writeJsonFile(filePath, data) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
    }

    function readTeleportConfig() {
        try {
            var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            return cfg.teleport || {};
        } catch (e) {
            return {};
        }
    }

    function writeTeleportConfig(tpCfg) {
        try {
            var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            cfg.teleport = tpCfg;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
            return true;
        } catch (e) {
            return false;
        }
    }

    router.get('/teleport/config', adminAuth, function(req, res) {
        try {
            var tpCfg = readTeleportConfig();
            res.json({ code: 200, data: tpCfg });
        } catch (e) {
            res.json({ code: 500, msg: '获取传送配置失败: ' + e.message });
        }
    });

    router.put('/teleport/config', adminAuth, function(req, res) {
        try {
            var tpCfg = readTeleportConfig();
            var body = req.body;
            var fields = ['enabled', 'enableHome', 'enableWarp', 'enableTpa', 'enableRtp',
                'homeLimit', 'homeCooldown', 'tpaCooldown', 'tpaTimeout', 'tpaCost',
                'warpCost', 'rtpCost', 'rtpCooldown', 'rtpRange', 'rtpMinRange',
                'rtpProtectionRadius', 'rtpMaxAttempts', 'rtpProtectionSeconds'];
            for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                if (body[f] !== undefined) {
                    tpCfg[f] = body[f];
                }
            }
            if (writeTeleportConfig(tpCfg)) {
                res.json({ code: 200, data: tpCfg, msg: '传送配置已更新' });
            } else {
                res.json({ code: 500, msg: '写入配置失败' });
            }
        } catch (e) {
            res.json({ code: 500, msg: '更新传送配置失败: ' + e.message });
        }
    });

    router.get('/teleport/warps', adminAuth, function(req, res) {
        try {
            var warps = readJsonFile(WARPS_DATA_PATH);
            var list = [];
            for (var name in warps) {
                var w = warps[name];
                list.push({
                    name: name,
                    x: w.x,
                    y: w.y,
                    z: w.z,
                    dim: w.dim,
                    cost: w.cost || 0,
                    cdSec: w.cdSec || 0
                });
            }
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取传送点列表失败: ' + e.message });
        }
    });

    router.post('/teleport/warps', adminAuth, function(req, res) {
        try {
            var body = req.body;
            var name = (body.name || '').trim();
            if (!name) return res.json({ code: 400, msg: '传送点名称不能为空' });
            var warps = readJsonFile(WARPS_DATA_PATH);
            if (warps[name]) return res.json({ code: 400, msg: '已存在同名传送点' });
            warps[name] = {
                x: body.x || 0,
                y: body.y || 64,
                z: body.z || 0,
                dim: body.dim || 0,
                cost: body.cost || 0,
                cdSec: body.cdSec || 0
            };
            writeJsonFile(WARPS_DATA_PATH, warps);
            res.json({ code: 200, msg: '传送点添加成功' });
        } catch (e) {
            res.json({ code: 500, msg: '添加传送点失败: ' + e.message });
        }
    });

    router.put('/teleport/warps/:name', adminAuth, function(req, res) {
        try {
            var name = req.params.name;
            var body = req.body;
            var warps = readJsonFile(WARPS_DATA_PATH);
            if (!warps[name]) return res.json({ code: 404, msg: '传送点不存在' });
            if (body.x !== undefined) warps[name].x = body.x;
            if (body.y !== undefined) warps[name].y = body.y;
            if (body.z !== undefined) warps[name].z = body.z;
            if (body.dim !== undefined) warps[name].dim = body.dim;
            if (body.cost !== undefined) warps[name].cost = body.cost;
            if (body.cdSec !== undefined) warps[name].cdSec = body.cdSec;
            writeJsonFile(WARPS_DATA_PATH, warps);
            res.json({ code: 200, msg: '传送点更新成功' });
        } catch (e) {
            res.json({ code: 500, msg: '更新传送点失败: ' + e.message });
        }
    });

    router.delete('/teleport/warps/:name', adminAuth, function(req, res) {
        try {
            var name = req.params.name;
            var warps = readJsonFile(WARPS_DATA_PATH);
            if (!warps[name]) return res.json({ code: 404, msg: '传送点不存在' });
            delete warps[name];
            writeJsonFile(WARPS_DATA_PATH, warps);
            res.json({ code: 200, msg: '传送点删除成功' });
        } catch (e) {
            res.json({ code: 500, msg: '删除传送点失败: ' + e.message });
        }
    });

    router.get('/teleport/homes', adminAuth, function(req, res) {
        try {
            var homes = readJsonFile(HOMES_DATA_PATH);
            var list = [];
            for (var xuid in homes) {
                var playerHomes = homes[xuid];
                for (var i = 0; i < playerHomes.length; i++) {
                    var h = playerHomes[i];
                    list.push({
                        xuid: xuid,
                        name: h.name,
                        x: h.x,
                        y: h.y,
                        z: h.z,
                        dim: h.dim,
                        public: h.public || false,
                        sharedWith: h.sharedWith || []
                    });
                }
            }
            res.json({ code: 200, data: list, total: list.length });
        } catch (e) {
            res.json({ code: 500, msg: '获取家园列表失败: ' + e.message });
        }
    });

    router.delete('/teleport/homes/:xuid/:index', adminAuth, function(req, res) {
        try {
            var xuid = req.params.xuid;
            var index = parseInt(req.params.index);
            var homes = readJsonFile(HOMES_DATA_PATH);
            if (!homes[xuid] || !homes[xuid][index]) {
                return res.json({ code: 404, msg: '家园不存在' });
            }
            var homeName = homes[xuid][index].name;
            homes[xuid].splice(index, 1);
            writeJsonFile(HOMES_DATA_PATH, homes);
            res.json({ code: 200, msg: '家园 ' + homeName + ' 已删除' });
        } catch (e) {
            res.json({ code: 500, msg: '删除家园失败: ' + e.message });
        }
    });

    router.get('/backup/stats', adminAuth, function(req, res) {
        try {
            var stats = backupModule.getBackupStats();
            if (stats.backups) {
                stats.backups.forEach(function(b) {
                    b.downloadUrl = '/api/v1/backup/download/' + encodeURIComponent(b.filename);
                });
            }
            res.json({ code: 200, data: stats });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份统计失败: ' + e.message });
        }
    });

    router.get('/backup/list', adminAuth, function(req, res) {
        try {
            var backups = backupModule.getBackupList();
            backups.forEach(function(b) {
                b.downloadUrl = '/api/v1/backup/download/' + encodeURIComponent(b.filename);
            });
            res.json({ code: 200, data: backups });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份列表失败: ' + e.message });
        }
    });

    router.post('/backup/execute', adminAuth, function(req, res) {
        try {
            if (backupModule.isBackupRunning()) {
                return res.json({ code: 400, msg: '备份正在进行中，请稍后再试' });
            }
            backupModule.executeBackup(function(err, result) {
                if (err) {
                    res.json({ code: 500, msg: err.error || '备份失败' });
                } else {
                    res.json({ code: 200, msg: '备份完成', data: result });
                }
            });
        } catch (e) {
            res.json({ code: 500, msg: '备份失败: ' + e.message });
        }
    });

    router.get('/backup/status', adminAuth, function(req, res) {
        try {
            res.json({ code: 200, data: { isRunning: backupModule.isBackupRunning() } });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份状态失败: ' + e.message });
        }
    });

    router.delete('/backup/:filename', adminAuth, function(req, res) {
        try {
            var filename = req.params.filename;
            var result = backupModule.deleteBackup(filename);
            if (result.success) {
                res.json({ code: 200, msg: '备份已删除' });
            } else {
                res.json({ code: 400, msg: result.error });
            }
        } catch (e) {
            res.json({ code: 500, msg: '删除备份失败: ' + e.message });
        }
    });

    router.get('/backup/download/:filename', adminAuth, function(req, res) {
        try {
            var filename = req.params.filename;
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                return res.json({ code: 400, msg: '非法文件名' });
            }
            if (!filename.endsWith('.7z')) {
                return res.json({ code: 400, msg: '只能下载.7z备份文件' });
            }
            var backupDir = backupModule.getBackupDir();
            var filePath = pathModule.join(backupDir, filename);
            if (!fs.existsSync(filePath)) {
                return res.json({ code: 404, msg: '文件不存在' });
            }
            res.download(filePath, filename);
        } catch (e) {
            res.json({ code: 500, msg: '下载备份失败: ' + e.message });
        }
    });

    router.get('/backup/config', adminAuth, function(req, res) {
        try {
            var cfg = backupModule.getConfig();
            res.json({ code: 200, data: cfg });
        } catch (e) {
            res.json({ code: 500, msg: '获取备份配置失败: ' + e.message });
        }
    });

    router.put('/backup/config', adminAuth, function(req, res) {
        try {
            var cfg = backupModule.getConfig();
            var body = req.body;
            if (typeof body.compressionLevel === 'number') {
                cfg.compressionLevel = Math.max(0, Math.min(9, Math.floor(body.compressionLevel)));
            }
            if (typeof body.interval === 'number') {
                cfg.interval = Math.max(0, body.interval);
            }
            if (typeof body.maxAgeDays === 'number') {
                cfg.maxAgeDays = Math.max(0, body.maxAgeDays);
            }
            if (typeof body.maxCount === 'number') {
                cfg.maxCount = Math.max(0, Math.floor(body.maxCount));
            }

            var MAIN_CONFIG_PATH = pathModule.join(__dirname, '..', 'config.json');
            try {
                var mainCfg = JSON.parse(fs.readFileSync(MAIN_CONFIG_PATH, 'utf-8'));
                mainCfg.backupConfig = cfg;
                fs.writeFileSync(MAIN_CONFIG_PATH, JSON.stringify(mainCfg, null, 4), 'utf-8');
            } catch (e) {
                return res.json({ code: 500, msg: '保存配置文件失败: ' + e.message });
            }

            backupModule.reload(cfg);
            res.json({ code: 200, msg: '备份配置已更新', data: cfg });
        } catch (e) {
            res.json({ code: 500, msg: '更新备份配置失败: ' + e.message });
        }
    });

    router.get('/ban/list', adminAuth, function(req, res) {
        try {
            var list = banModule.apiGetBanList();
            res.json({ code: 200, data: list });
        } catch (e) {
            res.json({ code: 500, msg: '获取封禁列表失败: ' + e.message });
        }
    });

    router.post('/ban', adminAuth, function(req, res) {
        try {
            var identifier = (req.body.identifier || '').trim();
            var reason = (req.body.reason || '').trim() || 'Web管理面板封禁';
            var operator = (req.body.operator || '').trim() || 'Web管理面板';

            if (!identifier) return res.json({ code: 400, msg: '缺少identifier参数' });

            var result = banModule.apiBan(identifier, reason, operator);
            res.json({ code: result.success ? 200 : 400, msg: result.message, data: result.success ? { xuid: result.xuid } : null });
        } catch (e) {
            res.json({ code: 500, msg: '封禁操作失败: ' + e.message });
        }
    });

    router.post('/unban', adminAuth, function(req, res) {
        try {
            var identifier = (req.body.identifier || '').trim();
            if (!identifier) return res.json({ code: 400, msg: '缺少identifier参数' });

            var result = banModule.apiUnban(identifier);
            res.json({ code: result.success ? 200 : 400, msg: result.message });
        } catch (e) {
            res.json({ code: 500, msg: '解封操作失败: ' + e.message });
        }
    });

    router.get('/ban/check', adminAuth, function(req, res) {
        try {
            var xuid = (req.query.xuid || '').trim();
            var ip = (req.query.ip || '').trim();
            if (!xuid) return res.json({ code: 400, msg: '缺少xuid参数' });

            var result = banModule.apiIsBanned(xuid, ip);
            res.json({ code: 200, data: result });
        } catch (e) {
            res.json({ code: 500, msg: '查询封禁状态失败: ' + e.message });
        }
    });

    return router;
}

function startServer(webConfig) {
    var port = webConfig.port || 8080;
    var host = webConfig.host || '0.0.0.0';

    var displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;

    createApp(webConfig);

    server = app.listen(port, host, () => {
        console.log(`[Web] API服务器已启动: http://${displayHost}:${port}`);
        if (webConfig.enableFrontend !== false) {
            console.log(`[Web] 前端页面: http://${displayHost}:${port}`);
        }
    });

    systemMonitor.startPolling(1000);

    setInterval(() => {
        database.cleanExpiredCaptchas();
        database.cleanExpiredRefreshTokens();
        database.cleanExpiredBlacklist();
    }, 60000);
}

function stopServer() {
    systemMonitor.stopPolling();
    if (server) {
        server.close();
        server = null;
        console.log('[Web] 服务器已关闭');
    }
}

function addChatMessage(sender, message) {
    chatHistory.push({
        time: Date.now(),
        sender: sender,
        message: message,
        type: 'player'
    });

    if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
    }
}

var _reloadCallbacks = {};

function onReload(event, callback) {
    if (!_reloadCallbacks[event]) _reloadCallbacks[event] = [];
    _reloadCallbacks[event].push(callback);
}

function triggerReload(event) {
    var cbs = _reloadCallbacks[event] || [];
    cbs.forEach(function(cb) { try { cb(); } catch (e) {} });
}

module.exports = {
    startServer,
    stopServer,
    createApp,
    addChatMessage,
    onReload
};
