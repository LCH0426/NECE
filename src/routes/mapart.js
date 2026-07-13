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
 * NECE 地图画上传路由
 * 提供地图画图片的上传、查看、删除功能
 * 可选集成 CustomGetMap 插件 API
 */

var multer = require('multer');
var path = require('path');
var crypto = require('crypto');

// 地图画存储目录（与 CustomGetMap 插件共享）
var MAPART_DIR = path.join(__dirname, '..', '..', '..', 'CustomGetMap', '.img');

// 允许的 MIME 类型
var ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// 允许的文件扩展名
var ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// 文件名最大长度
var MAX_FILENAME_LEN = 50;

// 单文件最大大小 10MB
var MAX_FILE_SIZE = 10 * 1024 * 1024;

// 每个玩家的图片库容量 20MB
var PLAYER_STORAGE_LIMIT = 20 * 1024 * 1024;

// 最大分辨率限制（宽或高不超过1920）
var MAX_DIMENSION = 1920;

// 文件魔数校验
var MAGIC_BYTES = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46]
};

// CustomGetMap API 引用（懒加载）
var _cusgetmap = null;
var _cusgetmapChecked = false;

function getCusGetMap() {
    if (_cusgetmapChecked) return _cusgetmap;
    _cusgetmapChecked = true;
    try {
        if (typeof ll !== 'undefined' && ll.hasExported && ll.hasExported("CustomGetMap", "add_player_upimg")) {
            _cusgetmap = {
                add: ll.import('CustomGetMap', 'add_player_upimg'),
                del: ll.import('CustomGetMap', 'del_player_upimg'),
                get: ll.import('CustomGetMap', 'get_player_upimg')
            };
        }
    } catch (e) {}
    return _cusgetmap;
}

/** 确保存储目录存在 */
function ensureMapartDir(fs) {
    if (!fs.existsSync(MAPART_DIR)) {
        fs.mkdirSync(MAPART_DIR, { recursive: true });
    }
}

/** 消毒文件名：仅保留字母数字下划线短横线 */
function sanitizeFilename(name) {
    var ext = path.extname(name).toLowerCase();
    var base = path.basename(name, ext);
    // 移除非安全字符
    base = base.replace(/[^a-zA-Z0-9_\-一-龥]/g, '_');
    // 限制长度
    if (base.length > MAX_FILENAME_LEN) base = base.substring(0, MAX_FILENAME_LEN);
    // 空名则用随机名
    if (!base) base = 'img';
    return base + ext;
}

/** 校验文件魔数 */
function validateMagicBytes(buffer, mimetype) {
    var magic = MAGIC_BYTES[mimetype];
    if (!magic || buffer.length < magic.length) return false;
    for (var i = 0; i < magic.length; i++) {
        if (buffer[i] !== magic[i]) return false;
    }
    return true;
}

/** 从图片 buffer 中读取宽高，返回 {w, h} 或 null */
function getImageDimensions(buffer, mimetype) {
    try {
        if (mimetype === 'image/png' && buffer.length > 24) {
            var w = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
            var h = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
            return { w: w, h: h };
        }
        if (mimetype === 'image/jpeg') {
            var i = 2;
            while (i < buffer.length - 1) {
                if (buffer[i] !== 0xFF) break;
                var marker = buffer[i + 1];
                if (marker === 0xC0 || marker === 0xC2) {
                    var h = (buffer[i + 5] << 8) | buffer[i + 6];
                    var w = (buffer[i + 7] << 8) | buffer[i + 8];
                    return { w: w, h: h };
                }
                var len = (buffer[i + 2] << 8) | buffer[i + 3];
                i += 2 + len;
            }
        }
        if (mimetype === 'image/webp' && buffer.length > 30 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38) {
                var w = ((buffer[26] | (buffer[27] << 8) | (buffer[28] << 16)) & 0x3FFF) + 1;
                var h = ((buffer[28] >> 2) | (buffer[29] << 6) | ((buffer[30] & 0xF) << 14)) + 1;
                return { w: w, h: h };
            }
        }
    } catch (e) {}
    return null;
}

/** 获取唯一文件名 */
function getUniqueFilename(fs, filename) {
    var ext = path.extname(filename).toLowerCase();
    var base = path.basename(filename, ext);
    var finalName = filename;
    var counter = 1;
    while (fs.existsSync(path.join(MAPART_DIR, finalName))) {
        finalName = base + '_' + counter + ext;
        counter++;
    }
    return finalName;
}

function registerRoutes(router, d) {

    var fs = d.fs;

    // multer 配置：内存存储，便于校验魔数
    var upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: MAX_FILE_SIZE, files: 1 }
    });

    // 上传频率限制（每用户每分钟 5 次）
    var uploadCounts = {};
    setInterval(function() { uploadCounts = {}; }, 60000);

    function uploadRateLimit(req, res, next) {
        var uid = req.user.uid;
        if (!uploadCounts[uid]) uploadCounts[uid] = 0;
        if (uploadCounts[uid] >= 5) {
            return res.status(429).json({ code: 429, msg: '上传过于频繁，请稍后再试' });
        }
        uploadCounts[uid]++;
        next();
    }

    /**
     * POST /mapart/upload
     * 上传地图画图片
     */
    router.post('/mapart/upload', d.auth, uploadRateLimit, upload.single('file'), function(req, res) {
        try {
            ensureMapartDir(fs);

            var file = req.file;
            var customName = req.body.name || '';

            if (!file) {
                return res.status(400).json({ code: 400, msg: '未选择文件' });
            }

            // MIME 类型校验
            if (ALLOWED_MIMES.indexOf(file.mimetype) === -1) {
                return res.status(400).json({ code: 400, msg: '仅支持 JPG/PNG/WebP 格式图片' });
            }

            // 文件扩展名校验
            var ext = path.extname(file.originalname).toLowerCase();
            if (ALLOWED_EXTS.indexOf(ext) === -1) {
                return res.status(400).json({ code: 400, msg: '文件扩展名不合法' });
            }

            // 文件魔数校验
            if (!validateMagicBytes(file.buffer, file.mimetype)) {
                return res.status(400).json({ code: 400, msg: '文件内容与扩展名不匹配' });
            }

            // 分辨率校验
            var dims = getImageDimensions(file.buffer, file.mimetype);
            if (dims) {
                if (dims.w > MAX_DIMENSION || dims.h > MAX_DIMENSION) {
                    return res.status(400).json({ code: 400, msg: '图片分辨率超限，最大支持 ' + MAX_DIMENSION + 'x' + MAX_DIMENSION + '，当前 ' + dims.w + 'x' + dims.h });
                }
            }

            // 容量检查
            var uid = req.user.uid;
            var currentSize = d.database.getMapartTotalSize(uid);
            if (currentSize + file.size > PLAYER_STORAGE_LIMIT) {
                var usedMB = (currentSize / 1024 / 1024).toFixed(2);
                var limitMB = (PLAYER_STORAGE_LIMIT / 1024 / 1024).toFixed(0);
                return res.status(400).json({ code: 400, msg: '图片库容量不足，已用 ' + usedMB + 'MB / ' + limitMB + 'MB' });
            }

            // 文件名消毒
            var safeName;
            if (customName) {
                safeName = sanitizeFilename(customName);
                if (!path.extname(safeName)) {
                    safeName += ext;
                }
            } else {
                safeName = sanitizeFilename(file.originalname);
            }

            // 生成唯一文件名
            var finalName = getUniqueFilename(fs, safeName);
            var filePath = path.join(MAPART_DIR, finalName);

            // 双重路径安全检查
            var resolvedPath = path.resolve(filePath);
            if (resolvedPath.indexOf(path.resolve(MAPART_DIR)) !== 0) {
                return res.status(400).json({ code: 400, msg: '文件路径不合法' });
            }

            // 写入文件
            fs.writeFileSync(filePath, file.buffer);

            // 写入数据库
            var uid = req.user.uid;
            var imageId = d.database.addMapartImage(uid, finalName, file.originalname, file.size);

            // 集成 CustomGetMap（需要玩家名）
            var cgm = getCusGetMap();
            if (cgm) {
                try {
                    var xuid = d.getXuidByUid(uid);
                    var playerName = xuid ? d.getPlayerName(xuid) : null;
                    console.log('[MapArt] CustomGetMap调用: uid=' + uid + ', xuid=' + xuid + ', playerName=' + playerName + ', filename=' + finalName);
                    if (playerName) {
                        var result = cgm.add(playerName, finalName);
                        console.log('[MapArt] CustomGetMap.add结果:', JSON.stringify(result));
                    }
                } catch (e) {
                    console.log('[MapArt] CustomGetMap异常:', e.message);
                }
            } else {
                console.log('[MapArt] CustomGetMap未加载');
            }

            res.json({
                code: 200,
                msg: '上传成功',
                data: { id: imageId, filename: finalName, size: file.size }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '上传失败: ' + e.message });
        }
    });

    /**
     * GET /mapart/quota
     * 获取当前用户的图片库容量信息
     */
    router.get('/mapart/quota', d.auth, function(req, res) {
        try {
            var uid = req.user.uid;
            var used = d.database.getMapartTotalSize(uid);
            res.json({
                code: 200,
                data: {
                    used: used,
                    limit: PLAYER_STORAGE_LIMIT,
                    usedMB: (used / 1024 / 1024).toFixed(2),
                    limitMB: (PLAYER_STORAGE_LIMIT / 1024 / 1024).toFixed(0)
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取容量信息失败' });
        }
    });

    /**
     * GET /mapart/list
     * 获取当前用户已上传的地图画列表
     */
    router.get('/mapart/list', d.auth, function(req, res) {
        try {
            var uid = req.user.uid;
            var images = d.database.getMapartImages(uid);

            res.json({
                code: 200,
                data: images
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取列表失败' });
        }
    });

    /**
     * GET /mapart/admin/list
     * 获取所有玩家的地图画列表（管理员专用）
     * 支持分页和按用户筛选
     */
    router.get('/mapart/admin/list', d.adminAuth, function(req, res) {
        try {
            var allImages = d.database.getAllMapartImages();
            var filterUid = req.query.uid || '';

            // 按用户筛选
            if (filterUid) {
                allImages = allImages.filter(function(img) { return img.uid === filterUid; });
            }

            // 分页
            var page = parseInt(req.query.page) || 1;
            var pageSize = parseInt(req.query.pageSize) || 50;
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 10;
            if (pageSize > 200) pageSize = 200;

            var total = allImages.length;
            var totalPages = Math.ceil(total / pageSize);
            var start = (page - 1) * pageSize;
            var items = allImages.slice(start, start + pageSize);

            res.json({
                code: 200,
                data: {
                    items: items,
                    total: total,
                    page: page,
                    pageSize: pageSize,
                    totalPages: totalPages
                }
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取列表失败' });
        }
    });

    /**
     * POST /mapart/delete
     * 删除指定地图画
     * 自己可以删除自己的，管理员可以删除所有人的
     */
    router.post('/mapart/delete', d.auth, function(req, res) {
        try {
            var uid = req.user.uid;
            var imageId = parseInt(req.body.id);
            if (isNaN(imageId)) {
                return res.status(400).json({ code: 400, msg: '参数错误' });
            }

            var imageInfo = d.database.getMapartImageById(imageId);
            if (!imageInfo) {
                return res.status(404).json({ code: 404, msg: '图片不存在' });
            }

            var isAdmin = d.database.isAdmin(uid);
            if (imageInfo.uid !== uid && !isAdmin) {
                return res.status(403).json({ code: 403, msg: '无权删除' });
            }

            // 管理员删除时需要指定图片所属用户，否则用图片记录中的 uid
            var targetUid = isAdmin ? imageInfo.uid : uid;
            d.database.deleteMapartImage(targetUid, imageId);

            // 删除物理文件
            var filename = imageInfo.filename;
            var filePath = path.join(MAPART_DIR, filename);
            var resolvedPath = path.resolve(filePath);
            if (resolvedPath.indexOf(path.resolve(MAPART_DIR)) === 0 && fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }

            // 集成 CustomGetMap（需要玩家名）
            var cgm = getCusGetMap();
            if (cgm) {
                try {
                    var xuid = d.getXuidByUid(targetUid);
                    if (xuid) {
                        var playerName = d.getPlayerName(xuid);
                        if (playerName) {
                            cgm.del(playerName, filename, false);
                        }
                    }
                } catch (e) {}
            }

            res.json({
                code: 200,
                msg: '删除成功'
            });
        } catch (e) {
            res.status(500).json({ code: 500, msg: '删除失败' });
        }
    });

    /**
     * GET /mapart/image/:id
     * 获取地图画图片（需认证）
     * 自己可以查看自己的，管理员可以查看所有人的
     */
    router.get('/mapart/image/:id', d.auth, function(req, res) {
        try {
            var imageId = parseInt(req.params.id);
            if (isNaN(imageId)) {
                return res.status(400).json({ code: 400, msg: '参数错误' });
            }

            var imageInfo = d.database.getMapartImageById(imageId);
            if (!imageInfo) {
                return res.status(404).json({ code: 404, msg: '图片不存在' });
            }

            var uid = req.user.uid;
            var isAdmin = d.database.isAdmin(uid);
            if (imageInfo.uid !== uid && !isAdmin) {
                return res.status(403).json({ code: 403, msg: '无权访问' });
            }

            var filename = path.basename(imageInfo.filename);
            var filePath = path.join(MAPART_DIR, filename);
            var resolvedPath = path.resolve(filePath);

            if (resolvedPath.indexOf(path.resolve(MAPART_DIR)) !== 0) {
                return res.status(403).json({ code: 403, msg: '禁止访问' });
            }

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ code: 404, msg: '图片文件不存在' });
            }

            var ext = path.extname(filename).toLowerCase();
            var mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
            var contentType = mimeTypes[ext] || 'application/octet-stream';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.sendFile(resolvedPath);
        } catch (e) {
            res.status(500).json({ code: 500, msg: '获取图片失败' });
        }
    });
}

module.exports = { registerRoutes: registerRoutes };
