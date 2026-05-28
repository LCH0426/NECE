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
 * NLCE Web管理面板服务器
 * Express.js REST API，提供玩家管理、数据查询、系统监控等管理接口
 * 认证方案：短期 Access Token + 长期 HttpOnly Refresh Token (旋转刷新机制)
 * 路由模块化拆分至 core/routes/ 目录，本文件负责核心工具函数和服务器生命周期
 */


const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');
const pathModule = require('path');
const fs = require('fs');
const database = require('./database');
const monitoring = require('./monitoring');
const adminLog = require('./adminLog');
const behaviorLog = require('./behaviorLog');
const chatModule = require('./chat');
const mailApi = require('./mail');
const messageBoard = require('./messageBoard');
const backupModule = require('./backup');
const banModule = require('./ban');

const WEB_DIR = pathModule.join(__dirname, '..', 'WEB');
const ACCESS_TOKEN_EXPIRE = '15m';
const REFRESH_TOKEN_EXPIRE = '7d';

let app = null;
let server = null;
let cleanupTimer = null;
let _playerDataRef = null;  // 内存中的 playerData 对象引用，由 index.js 注入

/** 注入内存中的 playerData 对象引用，使 getPlayerData() 直接返回最新数据 */
function setPlayerDataRef(ref) {
    _playerDataRef = ref;
}

let chatHistory = [];              // 服务端聊天记录缓冲，供 Web 面板实时查看
const MAX_CHAT_HISTORY = 500;

let _itemsCache = null;            // 物品映射表缓存（避免每次请求都读文件）
let _itemsCacheTime = 0;
const ITEMS_CACHE_TTL = 60000;     // 物品缓存有效期 60 秒

let _currencyNameCache = null;     // 货币名称缓存
let _currencyNameCacheTime = 0;
const CURRENCY_CACHE_TTL = 30000;  // 货币缓存有效期 30 秒

/** 读取 config.json 中的货币名称，带 30s 缓存；读取失败时回退为 '星茜' */
function getCurrencyName() {
    const now = Date.now();
    if (_currencyNameCache && now - _currencyNameCacheTime < CURRENCY_CACHE_TTL) return _currencyNameCache;
    try {
        const configPath = pathModule.join(__dirname, '..', 'config.json');
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        _currencyNameCache = config.currencyName || '星茜';
        _currencyNameCacheTime = now;
    } catch (e) {
        _currencyNameCache = '星茜';
        _currencyNameCacheTime = now;
    }
    return _currencyNameCache;
}

/** 读取 WEB/textures/items.json 的物品映射表，带 60s 缓存；返回 { itemId: { name, texture } | string } */
function getItemsMap() {
    const now = Date.now();
    if (_itemsCache && now - _itemsCacheTime < ITEMS_CACHE_TTL) return _itemsCache;
    try {
        const itemsPath = pathModule.join(__dirname, '..', 'WEB', 'textures', 'items.json');
        const content = fs.readFileSync(itemsPath, 'utf-8');
        const itemsData = JSON.parse(content);
        _itemsCache = itemsData.item || itemsData;
        _itemsCacheTime = now;
    } catch (e) {
        _itemsCache = {};
        _itemsCacheTime = now;
    }
    return _itemsCache;
}

/** 强制清除物品缓存，下次 getItemsMap 调用时重新读取文件 */
function invalidateItemsCache() {
    _itemsCache = null;
    _itemsCacheTime = 0;
}

/** @param {string} itemId 物品ID @returns {string} 物品中文名，找不到则返回 itemId 本身 */
function getItemName(itemId) {
    const map = getItemsMap();
    const item = map[itemId];
    if (item && typeof item === 'object') return item.name || itemId;
    if (typeof item === 'string') return item;
    return itemId;
}

/** @param {string} itemId 物品ID @returns {string} 物品贴图路径，找不到则返回空串 */
function getItemTexture(itemId) {
    const map = getItemsMap();
    const item = map[itemId];
    if (item && typeof item === 'object') return item.texture || '';
    return '';
}

/** 解析请求头中的 Cookie 字符串为键值对对象，正确处理值中含 '=' 的情况 */
function parseCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(function(pair) {
        const parts = pair.trim().split('=');
        if (parts.length >= 2) {
            cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
    });
    return cookies;
}

/** 设置 HttpOnly Refresh Token Cookie */
function setRefreshTokenCookie(res, refreshToken, maxAge) {
    const isSecure = false; // 开发环境默认 false，生产部署时应改为 true（需 HTTPS）
    res.setHeader('Set-Cookie', [
        'refresh_token=' + refreshToken,
        'Path=/api/v1',
        'HttpOnly',
        isSecure ? 'Secure' : '',
        'SameSite=Strict',
        'Max-Age=' + Math.floor(maxAge / 1000)
    ].filter(Boolean).join('; '));
}

/** 通过设置 Max-Age=0 立即清除客户端的 Refresh Token Cookie */
function clearRefreshTokenCookie(res) {
    res.setHeader('Set-Cookie', [
        'refresh_token=',
        'Path=/api/v1',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0'
    ].join('; '));
}

/** 生成 16 字节随机 hex 字符串，用作 JWT 的唯一标识 (jti) */
function generateJti() {
    return crypto.randomBytes(16).toString('hex');
}

/** 生成 Refresh Token 家族 ID，用于令牌轮换时追踪同一登录会话 */
function generateFamilyId() {
    return crypto.randomBytes(16).toString('hex');
}

/** 返回 Refresh Token 签名密钥，优先使用独立的 jwtRefreshSecret，否则拼接 '_refresh' 后缀 */
function getRefreshSecret(webConfig) {
    return webConfig.jwtRefreshSecret || (webConfig.jwtSecret + '_refresh');
}

/**
 * 签发 Access + Refresh 令牌对，Refresh Token 使用不同密钥签名并持久化到数据库
 * @param {string} uid 用户ID
 * @param {object} webConfig 配置对象（含 jwtSecret / jwtExpire 等）
 * @param {string} [existingFamilyId] 传入已有 familyId 表示令牌轮换，不传则新建家族
 * @returns {{ accessToken, refreshToken, refreshExpiresAt }}
 */
function issueTokenPair(uid, webConfig, existingFamilyId) {
    const role = database.isAdmin(String(uid)) ? 'admin' : 'user';
    const familyId = existingFamilyId || generateFamilyId(); // 复用 familyId 实现令牌轮换，检测重放攻击
    const accessJti = generateJti();
    const refreshJti = generateJti();

    const accessToken = jwt.sign(
        { uid: String(uid), role: role, jti: accessJti, type: 'access' },
        webConfig.jwtSecret,
        { expiresIn: webConfig.jwtExpire || ACCESS_TOKEN_EXPIRE }
    );

    const refreshToken = jwt.sign(
        { uid: String(uid), role: role, jti: refreshJti, familyId: familyId, type: 'refresh' },
        getRefreshSecret(webConfig),
        { expiresIn: webConfig.jwtRefreshExpire || REFRESH_TOKEN_EXPIRE }
    );

    const decoded = jwt.decode(refreshToken);
    const refreshExpiresAt = decoded.exp * 1000;

    database.saveRefreshToken(String(uid), refreshJti, familyId, refreshExpiresAt);

    return {
        accessToken: accessToken,
        refreshToken: refreshToken,
        refreshExpiresAt: refreshExpiresAt
    };
}

/**
 * 创建并配置 Express 应用，挂载 v1 路由、旧 API 迁移提示、静态前端文件
 * @param {object} webConfig 服务器配置
 * @returns {express.Application}
 */
function createApp(webConfig) {
    app = express();

    app.use(cors({
        origin: true,
        credentials: true
    }));
    app.use(express.json());

    const v1Router = createV1Routes(webConfig);
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

/**
 * 验证请求中的 Access Token（Authorization Header 或 query 参数），检查黑名单和类型
 * @param {object} req Express 请求对象
 * @param {object} webConfig 配置对象
 * @param {function} callback (err, user) 回调，err 含 code/msg/tokenExpired 字段
 */
function verifyAccessToken(req, webConfig, callback) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        return callback({ code: 401, msg: '未登录' });
    }

    jwt.verify(token, webConfig.jwtSecret, function(err, user) {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return callback({ code: 401, msg: 'Access Token 已过期', tokenExpired: true });
            }
            return callback({ code: 403, msg: 'Token 已失效' });
        }

        if (user.type && user.type !== 'access') {
            return callback({ code: 403, msg: '无效的 Token 类型' });
        }

        if (user.jti && database.isAccessTokenBlacklisted(user.jti)) { // 登出/换令牌时旧 jti 会被加入黑名单
            return callback({ code: 403, msg: 'Token 已被吊销' });
        }

        callback(null, user);
    });
}

/** 返回 Express 中间件：要求有效 Access Token，通过后将 user 信息挂载到 req.user */
function requireAuth(webConfig) {
    return function(req, res, next) {
        verifyAccessToken(req, webConfig, function(err, user) {
            if (err) return res.status(err.code).json(err);
            req.user = user;
            next();
        });
    };
}

/** 返回 Express 中间件：要求有效 Access Token 且用户具有管理员权限 */
function requireAdmin(webConfig) {
    return function(req, res, next) {
        verifyAccessToken(req, webConfig, function(err, user) {
            if (err) return res.status(err.code).json(err);
            if (!database.isAdmin(user.uid)) {
                return res.status(403).json({ code: 403, msg: '无管理员权限' });
            }
            req.user = user;
            next();
        });
    };
}

/** 返回内存中的玩家数据，由 index.js 通过 setPlayerDataRef 注入 */
function getPlayerData() {
    if (_playerDataRef) return _playerDataRef;
    return null;
}

let _playerNameCache = {};              // xuid -> playerName 映射缓存
let _playerNameCacheTime = 0;
const PLAYER_NAME_CACHE_TTL = 30000;    // 30 秒后重建缓存
let _uidToXuidCache = {};               // uid -> xuid 反向映射缓存
let _uidToXuidCacheTime = 0;
const UID_TO_XUID_CACHE_TTL = 30000;

/** @param {string} xuid @returns {string} 玩家名，找不到则返回 xuid 本身；缓存 30s */
function getPlayerName(xuid) {
    const now = Date.now();
    if (now - _playerNameCacheTime > PLAYER_NAME_CACHE_TTL) {
        _playerNameCache = {};
        _playerNameCacheTime = now;
        const pd = getPlayerData();
        if (pd && pd.players) {
            const xuids = Object.keys(pd.players);
            for (let i = 0; i < xuids.length; i++) {
                if (pd.players[xuids[i]].name) {
                    _playerNameCache[xuids[i]] = pd.players[xuids[i]].name;
                }
            }
        }
    }
    return _playerNameCache[xuid] || xuid;
}

/** 通过数据库内部 uid 反查对应的 xuid，缓存 30s；找不到返回 null */
function getXuidByUid(uid) {
    const now = Date.now();
    if (now - _uidToXuidCacheTime > UID_TO_XUID_CACHE_TTL) {
        _uidToXuidCache = {};
        _uidToXuidCacheTime = now;
        const pd = getPlayerData();
        if (pd && pd.players) {
            const xuids = Object.keys(pd.players);
            for (let i = 0; i < xuids.length; i++) {
                const playerUid = pd.players[xuids[i]].uid;
                if (playerUid !== undefined) {
                    _uidToXuidCache[String(playerUid)] = xuids[i];
                }
            }
        }
    }
    return _uidToXuidCache[String(uid)] || null;
}

/** uid -> xuid -> playerName 的便捷链式查询，任一环节找不到则返回 uid 字符串 */
function getPlayerNameByUid(uid) {
    const xuid = getXuidByUid(uid);
    if (xuid) {
        return getPlayerName(xuid);
    }
    return String(uid);
}

/**
 * 构造 /api/v1 路由，将所有工具函数和依赖打包成 routeDeps 传递给各子路由模块
 * 子路由在 core/routes/ 目录下按功能域拆分（auth/players/data/mail/content/config/shop/teleport/admin）
 */
function createV1Routes(webConfig) {
    const router = express.Router();
    const auth = requireAuth(webConfig);
    const adminAuth = requireAdmin(webConfig);

    const routeDeps = {
        auth, adminAuth, webConfig, jwt, svgCaptcha,
        database, monitoring, adminLog, behaviorLog,
        chatModule, mailApi, messageBoard,
        backupModule, banModule,
        getPlayerData, getPlayerName, getXuidByUid, getPlayerNameByUid,
        getCurrencyName, getItemsMap, getItemName, getItemTexture, invalidateItemsCache,
        chatHistory, addChatMessage, MAX_CHAT_HISTORY,
        issueTokenPair, setRefreshTokenCookie, clearRefreshTokenCookie,
        parseCookies, getRefreshSecret, triggerReload,
        fs, pathModule,
        mc: mc, money: money
    };

    require('./routes/auth').registerRoutes(router, routeDeps);
    require('./routes/players').registerRoutes(router, routeDeps);
    require('./routes/data').registerRoutes(router, routeDeps);
    require('./routes/mail').registerRoutes(router, routeDeps);
    require('./routes/content').registerRoutes(router, routeDeps);
    require('./routes/config').registerRoutes(router, routeDeps);
    require('./routes/shop').registerRoutes(router, routeDeps);
    require('./routes/teleport').registerRoutes(router, routeDeps);
    require('./routes/admin').registerRoutes(router, routeDeps);

    return router;
}

/**
 * 启动 Web 服务器，开始系统监控轮询，并定时清理过期验证码/令牌/黑名单
 * @param {object} webConfig 含 port / host / enableFrontend 等字段
 */
function startServer(webConfig) {
    const port = webConfig.port || 8080;
    const host = webConfig.host || '0.0.0.0';

    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;

    createApp(webConfig);

    server = app.listen(port, host, () => {
        logger.info('[Web] API服务器已启动: http://' + displayHost + ':' + port);
        if (webConfig.enableFrontend !== false) {
            logger.info('[Web] 前端页面: http://' + displayHost + ':' + port);
        }
    });

    // 按需监控：不再持续轮询，由 /system/stats 端点触发采集
    monitoring.refreshStats().catch(function(e) {});
    monitoring.updateWorldSize().catch(function(e) {});

    // 每 60 秒清理过期数据，防止数据库无限膨胀
    cleanupTimer = setInterval(() => {
        database.cleanExpiredCaptchas();
        database.cleanExpiredRefreshTokens();
        database.cleanExpiredBlacklist();
    }, 60000);
}

/** 停止系统监控轮询并关闭 HTTP 服务器 */
function stopServer() {
    monitoring.stopPolling();
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
    if (worldSizeTimer) { clearInterval(worldSizeTimer); worldSizeTimer = null; }
    if (server) {
        server.close();
        server = null;
        logger.info('[Web] 服务器已关闭');
    }
}

/** 向聊天历史缓冲区追加消息，超过 MAX_CHAT_HISTORY 时自动裁剪头部 */
function addChatMessage(sender, message) {
    chatHistory.push({
        time: Date.now(),
        sender: sender,
        message: message,
        type: 'player'
    });

    if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
    }
}

const _reloadCallbacks = {};           // 事件名 -> 回调数组

/** 注册热重载回调，当 triggerReload 触发对应事件时执行 */
function onReload(event, callback) {
    if (!_reloadCallbacks[event]) _reloadCallbacks[event] = [];
    _reloadCallbacks[event].push(callback);
}

/** 触发指定事件的所有已注册回调，每个回调内部 try/catch 防止单个失败影响其余 */
function triggerReload(event) {
    const cbs = _reloadCallbacks[event] || [];
    cbs.forEach(function(cb) { try { cb(); } catch (e) {} });
}

module.exports = {
    startServer,
    stopServer,
    createApp,
    addChatMessage,
    onReload,
    setPlayerDataRef
};
