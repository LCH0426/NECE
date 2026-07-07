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
 * NECE Web管理面板服务器
 * Express.js REST API，提供玩家管理、数据查询、系统监控等管理接口
 * 认证方案：短期 Access Token + 长期 HttpOnly Refresh Token (旋转刷新机制)
 * 路由模块化拆分至 src/routes/ 目录，本文件负责核心工具函数和服务器生命周期
 */


const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const net = require('net');
const http = require('http');
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
const clearLagModule = require('./clearLag');
const banModule = require('./ban');

const WEB_DIR = pathModule.join(__dirname, '..', 'public');
const ACCESS_TOKEN_EXPIRE = '15m';
const REFRESH_TOKEN_EXPIRE = '7d';

// ============ 简易内存限流器 ============
const _allRateLimitStores = [];      // 所有限流器的 store 引用，用于定期清理
let _rateLimitCleanupTimer = null;

/**
 * 创建速率限制器（内存存储）
 * @param {number} windowMs 时间窗口（毫秒）
 * @param {number} maxRequests 窗口内最大请求数
 * @param {number} [maxEntries=10000] 最大存储条目数，防止内存溢出
 */
function createRateLimiter(windowMs, maxRequests, maxEntries) {
    const store = {};  // 每个限流器独立存储，避免不同类型限流共享计数
    _allRateLimitStores.push(store);
    maxEntries = maxEntries || 10000;
    return function(req, res, next) {
        const key = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        let entry = store[key];
        if (!entry || now > entry.resetAt) {
            // 新条目前检查存储上限
            if (!store[key]) {
                const storeSize = Object.keys(store).length;
                if (storeSize >= maxEntries) {
                    // 清理过期条目
                    const keys = Object.keys(store);
                    for (let i = 0; i < keys.length; i++) {
                        if (now > store[keys[i]].resetAt) {
                            delete store[keys[i]];
                        }
                    }
                    // 仍然超限则拒绝
                    if (Object.keys(store).length >= maxEntries) {
                        return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试' });
                    }
                }
            }
            entry = { count: 1, resetAt: now + windowMs };
            store[key] = entry;
        } else {
            entry.count++;
        }
        if (entry.count > maxRequests) {
            return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试' });
        }
        next();
    };
}

// 登录限流：每IP每分钟最多10次
const loginLimiter = createRateLimiter(60000, 10);
// Token续签限流：每IP每分钟最多20次
const refreshLimiter = createRateLimiter(60000, 20);
// 验证码限流：每IP每分钟最多15次
const captchaLimiter = createRateLimiter(60000, 15);
// 备份下载限流：每IP每分钟最多5次
const backupDownloadLimiter = createRateLimiter(60000, 5);
// 全局API限流：每IP每分钟最多300次
const globalApiLimiter = createRateLimiter(60000, 300);
// 配置修改限流：每IP每分钟最多10次
const configLimiter = createRateLimiter(60000, 10);
// 写操作限流：每IP每分钟最多30次
const writeLimiter = createRateLimiter(60000, 30);

// IP验证token消费函数（由index.js注入）
let _consumeIpToken = null;

// 临时下载令牌存储：token -> { filename, createdAt, expiresAt }
const _downloadTokens = new Map();
const DOWNLOAD_TOKEN_TTL = 6 * 3600 * 1000; // 6小时有效期

/** 生成临时下载令牌 */
function generateDownloadToken(filename) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    _downloadTokens.set(token, {
        filename: filename,
        createdAt: now,
        expiresAt: now + DOWNLOAD_TOKEN_TTL
    });
    return token;
}

/** 验证临时下载令牌，返回关联的文件名或null */
function verifyDownloadToken(token) {
    const entry = _downloadTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        _downloadTokens.delete(token);
        return null;
    }
    return entry.filename;
}

/** 消费临时下载令牌（一次性使用后删除） */
function consumeDownloadToken(token) {
    const filename = verifyDownloadToken(token);
    if (filename) {
        _downloadTokens.delete(token);
    }
    return filename;
}

/** 清理过期的临时下载令牌 */
function cleanupDownloadTokens() {
    const now = Date.now();
    for (const [token, entry] of _downloadTokens) {
        if (now > entry.expiresAt) {
            _downloadTokens.delete(token);
        }
    }
}

/**
 * PROXY Protocol v1 解析器
 * PROXY Protocol v1 格式: "PROXY TCP4|TCP6|UNKNOWN src_addr dst_addr src_port dst_port\r\n"
 * PROXY Protocol v2 格式: 0x0D 0x0A 0x0D 0x0A 0x00 0x0D 0x0A 0x51 0x55 0x49 0x54 0x0A + ...
 * @param {Buffer} buf - 数据缓冲区
 * @returns {{ consumed: number, srcAddress: string|null, srcPort: number|null }|null} 解析结果，null 表示数据不完整
 */
function parseProxyProtocol(buf) {
    // PROXY Protocol v2 签名 (12 bytes)
    const V2_SIG = Buffer.from([0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A]);

    // 检测 v2
    if (buf.length >= 12 && buf.slice(0, 12).equals(V2_SIG)) {
        if (buf.length < 16) return null; // 头部不完整
        const verCmd = buf[12];
        const version = (verCmd & 0xF0) >> 4;
        const command = verCmd & 0x0F;
        if (version !== 2) return null;
        const family = buf[13];
        const addrLen = buf.readUInt16BE(14);
        const totalLen = 16 + addrLen;
        if (buf.length < totalLen) return null; // 数据不完整
        if (command === 0) {
            // LOCAL command - 本地连接，不代理
            return { consumed: totalLen, srcAddress: null, srcPort: null };
        }
        if (command !== 1) return null; // PROXY command
        const af = (family & 0xF0) >> 4;
        const proto = family & 0x0F;
        if (proto !== 1) {
            // 非 TCP (STREAM) 协议，跳过
            return { consumed: totalLen, srcAddress: null, srcPort: null };
        }
        let offset = 16;
        if (af === 1) {
            // IPv4: 4+4+2+2 = 12 bytes
            if (addrLen < 12) return null;
            const srcAddr = buf[offset] + '.' + buf[offset+1] + '.' + buf[offset+2] + '.' + buf[offset+3];
            offset += 8; // skip src+dst addr
            const srcPort = buf.readUInt16BE(offset);
            return { consumed: totalLen, srcAddress: srcAddr, srcPort: srcPort };
        } else if (af === 2) {
            // IPv6: 16+16+2+2 = 36 bytes
            if (addrLen < 36) return null;
            const srcAddr = [];
            for (let i = 0; i < 16; i++) {
                srcAddr.push(buf[offset + i].toString(16).padStart(2, '0'));
            }
            const srcAddrStr = srcAddr[0]+srcAddr[1]+':'+srcAddr[2]+srcAddr[3]+':'+srcAddr[4]+srcAddr[5]+':'+srcAddr[6]+srcAddr[7]+':'+srcAddr[8]+srcAddr[9]+':'+srcAddr[10]+srcAddr[11]+':'+srcAddr[12]+srcAddr[13]+':'+srcAddr[14]+srcAddr[15];
            offset += 32; // skip src+dst addr
            const srcPort = buf.readUInt16BE(offset);
            return { consumed: totalLen, srcAddress: srcAddrStr, srcPort: srcPort };
        }
        // UNSPEC 或其他
        return { consumed: totalLen, srcAddress: null, srcPort: null };
    }

    // 检测 v1: 以 "PROXY " 开头
    const V1_PREFIX = 'PROXY ';
    if (buf.length < 6) return null;
    const prefix = buf.slice(0, 6).toString('ascii');
    if (prefix !== V1_PREFIX) {
        // 不是 PROXY protocol，当作普通连接
        return { consumed: 0, srcAddress: null, srcPort: null };
    }
    // 查找 \r\n 结束符
    const crlfIdx = buf.indexOf('\r\n');
    if (crlfIdx === -1) return null; // 数据不完整
    const line = buf.slice(0, crlfIdx).toString('ascii');
    const parts = line.split(' ');
    // PROXY TCP4 src_addr dst_addr src_port dst_port
    if (parts.length < 6) {
        return { consumed: crlfIdx + 2, srcAddress: null, srcPort: null };
    }
    const proto = parts[1];
    if (proto === 'TCP4' || proto === 'TCP6') {
        return {
            consumed: crlfIdx + 2,
            srcAddress: parts[2],
            srcPort: parseInt(parts[4], 10) || null
        };
    }
    // UNKNOWN 或其他
    return { consumed: crlfIdx + 2, srcAddress: null, srcPort: null };
}

/**
 * 创建支持 PROXY Protocol 的 TCP 服务器
 * 在 TCP 层解析 PROXY Protocol 头，提取真实 IP 后将连接转发给 HTTP server
 * @param {http.Server} httpServer - Express 的 HTTP server
 * @param {object} options - 配置选项
 * @param {boolean} options.v2 - 是否同时支持 v2（默认 true，始终支持 v1）
 * @returns {net.Server}
 */
function createProxyProtocolServer(httpServer, options) {
    const tcpServer = net.createServer(function(socket) {
        let buf = Buffer.alloc(0);
        let proxyParsed = false;

        socket.on('data', function onData(chunk) {
            if (proxyParsed) return; // 已解析完毕，后续数据由 HTTP server 处理

            buf = Buffer.concat([buf, chunk]);

            const result = parseProxyProtocol(buf);
            if (result === null) {
                // 数据不完整，等待更多数据
                if (buf.length > 4096) {
                    // 超过 4KB 还没解析出 PROXY protocol，当作普通连接
                    proxyParsed = true;
                    socket.removeListener('data', onData);
                    socket.emit('proxy-protocol', null);
                    httpServer.emit('connection', socket);
                    socket.unshift(buf);
                }
                return;
            }

            proxyParsed = true;
            socket.removeListener('data', onData);

            if (result.srcAddress) {
                // Node.js 的 socket.remoteAddress 是原型链上的 getter，直接赋值无法覆盖
                // 必须用 Object.defineProperty 在实例上定义 own property 来遮蔽原型 getter
                Object.defineProperty(socket, 'remoteAddress', {
                    value: result.srcAddress,
                    writable: true,
                    configurable: true
                });
                if (result.srcPort) {
                    Object.defineProperty(socket, 'remotePort', {
                        value: result.srcPort,
                        writable: true,
                        configurable: true
                    });
                }
            }

            // 消费掉 PROXY protocol 头，剩余数据推回
            if (result.consumed > 0) {
                const remaining = buf.slice(result.consumed);
                if (remaining.length > 0) {
                    socket.unshift(remaining);
                }
            } else {
                // consumed === 0 表示不是 PROXY protocol，原始数据完整推回
                socket.unshift(buf);
            }

            httpServer.emit('connection', socket);
        });

        socket.on('error', function(err) {
            // 忽略 socket 错误，避免未捕获异常
        });
    });

    return tcpServer;
}

/** 定期清理过期的限流记录，防止内存泄漏 */
function startRateLimitCleanup() {
    if (_rateLimitCleanupTimer) clearInterval(_rateLimitCleanupTimer);
    _rateLimitCleanupTimer = setInterval(function() {
        const now = Date.now();
        for (let s = 0; s < _allRateLimitStores.length; s++) {
            const store = _allRateLimitStores[s];
            const keys = Object.keys(store);
            for (let i = 0; i < keys.length; i++) {
                if (now > store[keys[i]].resetAt) {
                    delete store[keys[i]];
                }
            }
        }
        cleanupDownloadTokens();
    }, 120000); // 每2分钟清理一次
}

let app = null;
let server = null;
let cleanupTimer = null;
let _playerDataRef = null;  // 内存中的 playerData 对象引用，由 index.js 注入
let _configRef = null;      // 内存中的 config 对象引用，由 index.js 注入
let _hasWish = false;       // 是否加载了祈愿模块（由 index.js 注入）
let _wishModuleRef = null;  // 祈愿模块引用（由 index.js 注入）
let _writeEconomyLog = null; // 经济日志写入函数（由 index.js 注入）
let _webConfig = null;      // web配置引用（由 startServer 设置）

// 从 manifest.json 读取版本号
let _manifestVersion = 'unknown';
try {
    const _mf = JSON.parse(fs.readFileSync(pathModule.join(__dirname, '..', 'manifest.json'), 'utf-8'));
    _manifestVersion = _mf.version || 'unknown';
} catch (e) {}

/** 注入内存中的 playerData 对象引用，使 getPlayerData() 直接返回最新数据 */
function setPlayerDataRef(ref) {
    _playerDataRef = ref;
}

/** 注入内存中的 config 对象引用，避免从磁盘读取配置 */
function setConfigRef(ref) {
    _configRef = ref;
}

/** 注入祈愿模块加载状态和模块引用，用于版本API标识和赞助路由注册 */
function setHasWish(val, wishModule, economyWriteLog) {
    _hasWish = !!val;
    _wishModuleRef = wishModule || null;
    _writeEconomyLog = economyWriteLog || null;
}

let _economyFunctions = null;
function setEconomyFunctions(funcs) {
    _economyFunctions = funcs || null;
}

/** 注入IP验证token消费函数 */
function setConsumeIpToken(fn) {
    _consumeIpToken = fn;
}

/**
 * 获取错误消息（debug 模式返回详细信息，否则返回通用消息）
 * @param {Error} e - 错误对象
 * @param {string} fallback - 通用错误消息
 * @returns {string}
 */
function getErrorMessage(e, fallback) {
    if ((_configRef && _configRef.get('debug')) || (_webConfig && _webConfig.debugMode)) return fallback + ': ' + e.message;
    return fallback || '服务器内部错误';
}

let chatHistory = [];              // 服务端聊天记录缓冲，供 Web 面板实时查看
const MAX_CHAT_HISTORY = 500;

let _itemsCache = null;            // 物品映射表缓存（避免每次请求都读文件）
let _itemsCacheTime = 0;
const ITEMS_CACHE_TTL = 60000;     // 物品缓存有效期 60 秒

let _currencyNameCache = null;     // 货币名称缓存（仅配置重载时更新）

/** 获取货币名称，从语言文件的 _meta.currencyName 读取 */
function getCurrencyName() {
    if (_currencyNameCache !== null) return _currencyNameCache;
    try {
        const lang = _configRef ? _configRef.get('language') || 'zh_CN' : 'zh_CN';
        const langPath = pathModule.join(__dirname, '..', 'lang', lang + '.json');
        const content = fs.readFileSync(langPath, 'utf-8');
        const langData = JSON.parse(content);
        if (langData && langData._meta && langData._meta.currencyName) {
            _currencyNameCache = langData._meta.currencyName;
        } else {
            _currencyNameCache = '星茜';
        }
    } catch (e) {
        _currencyNameCache = '星茜';
    }
    return _currencyNameCache;
}

/** 重置货币名称缓存 */
function invalidateCurrencyNameCache() {
    _currencyNameCache = null;
}

/** 读取 public/textures/items.json 的物品映射表，带 60s 缓存；返回 { itemId: { name, texture } | string } */
function getItemsMap() {
    const now = Date.now();
    if (_itemsCache && now - _itemsCacheTime < ITEMS_CACHE_TTL) return _itemsCache;
    try {
        const itemsPath = pathModule.join(__dirname, '..', 'public', 'textures', 'items.json');
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

/** 设置 HttpOnly Refresh Token Cookie（使用 append 避免覆盖同响应中的其它 Cookie） */
function setRefreshTokenCookie(res, refreshToken, maxAge) {
    const isSecure = _webConfig && _webConfig.secureCookie === true;
    res.append('Set-Cookie', [
        'refresh_token=' + refreshToken,
        'Path=/api/v1',
        'HttpOnly',
        isSecure ? 'Secure' : '',
        'SameSite=Strict',
        'Max-Age=' + Math.floor(maxAge / 1000)
    ].filter(Boolean).join('; '));
}

/** 设置 HttpOnly Access Token Cookie（用于文件下载等无法携带 Authorization Header 的场景） */
function setAccessTokenCookie(res, accessToken, maxAge) {
    const isSecure = _webConfig && _webConfig.secureCookie === true;
    res.append('Set-Cookie', [
        'auth_token=' + accessToken,
        'Path=/api/v1',
        'HttpOnly',
        isSecure ? 'Secure' : '',
        'SameSite=Strict',
        'Max-Age=' + Math.floor(maxAge / 1000)
    ].filter(Boolean).join('; '));
}

/** 通过设置 Max-Age=0 立即清除客户端的 Access Token Cookie */
function clearAccessTokenCookie(res) {
    res.append('Set-Cookie', [
        'auth_token=',
        'Path=/api/v1',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0'
    ].join('; '));
}

/** 通过设置 Max-Age=0 立即清除客户端的 Refresh Token Cookie */
function clearRefreshTokenCookie(res) {
    res.append('Set-Cookie', [
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
    // 反向代理支持：启用后 Express 从 X-Forwarded-For 头读取真实客户端 IP
    if (webConfig.trustProxy) {
        app.set('trust proxy', true);
    }

    // 禁用 X-Powered-By 头
    app.disable('x-powered-by');

    // 安全响应头
    app.use(function(req, res, next) {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        if (webConfig.secureCookie) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        next();
    });

    // CORS 白名单模式
    var corsOrigin = webConfig.corsOrigin;
    if (corsOrigin && corsOrigin.length > 0) {
        var allowed = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
        app.use(cors({
            origin: function(origin, callback) {
                if (!origin) return callback(null, true);
                if (allowed.indexOf(origin) !== -1) callback(null, true);
                else callback(new Error('CORS not allowed'));
            },
            credentials: true
        }));
    } else {
        app.use(cors({ origin: false }));
    }

    // JSON 解析错误处理（防止堆栈泄露）
    app.use(express.json({ limit: '1mb' }));
    app.use(function(err, req, res, next) {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ code: 400, msg: '请求格式错误' });
        }
        if (err.message === 'CORS not allowed') {
            return res.status(403).json({ code: 403, msg: '跨域请求被拒绝' });
        }
        next(err);
    });

    // Debug 模式下打印 HTTP 请求日志
    if ((webConfig.debugMode !== undefined ? webConfig.debugMode : (_configRef && _configRef.get('debug')))) {
        app.use(function(req, res, next) {
            const start = Date.now();
            res.on('finish', function() {
                const duration = Date.now() - start;
                const ip = req.ip || req.connection.remoteAddress;
                logger.info('[HTTP] ' + req.method + ' ' + req.originalUrl + ' ' + res.statusCode + ' ' + duration + 'ms ' + ip);
            });
            next();
        });
    }

    const v1Router = createV1Routes(webConfig);
    app.use('/api/v1', globalApiLimiter, v1Router);

    app.use('/api/auth/login', function(req, res) {
        res.status(410).json({ code: 410, msg: 'API已迁移，请使用 /api/v1/auth/login' });
    });
    app.use('/api/admin', function(req, res) {
        res.status(410).json({ code: 410, msg: 'API已迁移，请使用 /api/v1/ 前缀' });
    });

    // API 404 处理（不泄露路径）
    app.use('/api', function(req, res) {
        res.status(404).json({ code: 404, msg: '接口不存在' });
    });

    if (webConfig.enableFrontend !== false) {
        // 静态资源不套用 API 限流，避免加载前端资源（CSS/JS/图片）时触发 429
        app.use(express.static(WEB_DIR));
        app.get(/^\/(?!api).*/, function(req, res) {
            res.sendFile(pathModule.join(WEB_DIR, 'index.html'));
        });
    }

    // 全局错误处理（不泄露路径和堆栈）
    app.use(function(err, req, res, next) {
        logger.error('[HTTP] ' + req.method + ' ' + req.originalUrl + ' ' + (err.message || err));
        res.status(500).json({ code: 500, msg: '服务器内部错误' });
    });

    return app;
}

/**
 * 验证请求中的 Access Token（Authorization Header 或 auth_token Cookie），检查黑名单和类型
 * @param {object} req Express 请求对象
 * @param {object} webConfig 配置对象
 * @param {function} callback (err, user) 回调，err 含 code/msg/tokenExpired 字段
 */
function verifyAccessToken(req, webConfig, callback) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // Authorization Header 未携带时，回退到 auth_token Cookie
    if (!token) {
        const cookies = parseCookies(req);
        token = cookies.auth_token || null;
    }

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

        // 检查该用户是否因重放攻击被全局吊销
        if (user.uid && database.isUserTokenRevoked && database.isUserTokenRevoked(user.uid)) {
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
 * 子路由在 src/routes/ 目录下按功能域拆分（auth/players/data/mail/content/config/shop/teleport/admin）
 */
function createV1Routes(webConfig) {
    const router = express.Router();
    const auth = requireAuth(webConfig);
    const adminAuth = requireAdmin(webConfig);

    const routeDeps = {
        auth, adminAuth, webConfig, jwt, svgCaptcha,
        database, monitoring, adminLog, behaviorLog,
        chatModule, mailApi, messageBoard, writeEconomyLog: _writeEconomyLog,
        backupModule, banModule, clearLagModule,
        getPlayerData, getPlayerName, getXuidByUid, getPlayerNameByUid,
        getCurrencyName, getItemsMap, getItemName, getItemTexture, invalidateItemsCache,
        chatHistory, addChatMessage, MAX_CHAT_HISTORY,
        issueTokenPair, setRefreshTokenCookie, clearRefreshTokenCookie, setAccessTokenCookie, clearAccessTokenCookie,
        parseCookies, getRefreshSecret, getJwtSecret: function() { return _webConfig ? _webConfig.jwtSecret : ''; },
        triggerReload,
        fs, pathModule,
        mc: mc, money: money,
        economyFunctions: _economyFunctions,
        getErrorMessage: getErrorMessage,
        loginLimiter, refreshLimiter, captchaLimiter, backupDownloadLimiter, configLimiter, writeLimiter,
        hasWish: _hasWish,
        generateDownloadToken, consumeDownloadToken,
        consumeIpToken: _consumeIpToken,
        getConfig: function() { return _configRef; }
    };

    // 版本信息接口
    router.get('/version', function(req, res) {
        try {
            var serverVersion = mc.getBDSVersion();
            var protocol = mc.getServerProtocolVersion();
            res.json({
                code: 200,
                data: {
                    version: _manifestVersion,
                    serverVersion: serverVersion,
                    protocol: protocol,
                    type: _hasWish ? 'NEPE' : 'NECE'
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取版本信息失败: ' + e.message });
        }
    });

    require('./routes/auth').registerRoutes(router, routeDeps);
    require('./routes/players').registerRoutes(router, routeDeps);
    require('./routes/data').registerRoutes(router, routeDeps);
    require('./routes/mail').registerRoutes(router, routeDeps);
    require('./routes/content').registerRoutes(router, routeDeps);
    require('./routes/config').registerRoutes(router, routeDeps);
    require('./routes/shop').registerRoutes(router, routeDeps);
    require('./routes/guild').registerRoutes(router, routeDeps);
    require('./routes/admin').registerRoutes(router, routeDeps);

    // 赞助管理API由 wish 模块提供，仅在模块存在时注册
    if (_wishModuleRef && _wishModuleRef.registerApiRoutes) {
        _wishModuleRef.registerApiRoutes(router, routeDeps);
    }

    return router;
}

/**
 * 启动 Web 服务器，开始系统监控轮询，并定时清理过期验证码/令牌/黑名单
 * @param {object} webConfig 含 port / host / enableFrontend 等字段
 */
function startServer(webConfig) {
    _webConfig = webConfig;
    const port = webConfig.port || 8080;
    const host = webConfig.host || '0.0.0.0';

    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;

    createApp(webConfig);

    if (webConfig.proxyProtocol) {
        // PROXY Protocol 模式：创建 TCP 服务器解析 PROXY Protocol 头，转发给 HTTP server
        const httpServer = http.createServer(app);
        const tcpServer = createProxyProtocolServer(httpServer, { v2: true });
        server = tcpServer;
        tcpServer.listen(port, host, () => {
            logger.info('[Web] API服务器已启动 (PROXY Protocol v1/v2): http://' + displayHost + ':' + port);
            if (webConfig.enableFrontend !== false) {
                logger.info('[Web] 前端页面: http://' + displayHost + ':' + port);
            }
        });
        // 保存 httpServer 引用，用于关闭
        server._httpServer = httpServer;
    } else {
        server = app.listen(port, host, () => {
            logger.info('[Web] API服务器已启动: http://' + displayHost + ':' + port);
            if (webConfig.enableFrontend !== false) {
                logger.info('[Web] 前端页面: http://' + displayHost + ':' + port);
            }
        });
    }

    // 按需监控：由 /system/stats 端点触发采集
    monitoring.refreshStats();
    monitoring.updateWorldSize().catch(function(e) {});

    // 启动限流记录定期清理
    startRateLimitCleanup();

    // 每 60 秒清理过期数据
    cleanupTimer = setInterval(() => {
        database.cleanExpiredData();
    }, 60000);
}

/** 停止系统监控轮询并关闭 HTTP 服务器 */
function stopServer() {
    monitoring.stopPolling();
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
    if (_rateLimitCleanupTimer) { clearInterval(_rateLimitCleanupTimer); _rateLimitCleanupTimer = null; }
    if (server) {
        if (server._httpServer) {
            server._httpServer.close();
        }
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

// 配置重载时清除货币名称缓存
onReload('config', invalidateCurrencyNameCache);

/** 触发指定事件的所有已注册回调，每个回调内部 try/catch 防止单个失败影响其余 */
function triggerReload(event) {
    const cbs = _reloadCallbacks[event] || [];
    cbs.forEach(function(cb) { try { cb(); } catch (e) { logger.error('[Web] 热重载回调失败[' + event + ']: ' + e.message); } });
}

module.exports = {
    startServer,
    stopServer,
    createApp,
    addChatMessage,
    onReload,
    setPlayerDataRef,
    setConfigRef,
    setHasWish,
    setEconomyFunctions,
    setConsumeIpToken
};
