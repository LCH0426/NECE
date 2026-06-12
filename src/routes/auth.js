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
 * NECE Web路由 - 认证
 * 处理登录、登出、Token续签、验证码、用户信息等认证相关路由
 * 使用双Token机制（Access Token + Refresh Token），Refresh Token通过HttpOnly Cookie传递
 */

function registerRoutes(router, d) {

    // 用户登录：验证验证码、密码，签发Access/Refresh Token对
    router.post('/auth/login', d.loginLimiter, function(req, res) {
        let uid = req.body.uid;
        const password = req.body.password;
        let captchaId = req.body.captchaId;
        const captchaCode = req.body.captchaCode;

        if (!uid || !password) {
            return res.status(400).json({ code: 400, msg: 'UID和密码不能为空' });
        }

        if (!captchaId || !captchaCode) {
            return res.status(400).json({ code: 400, msg: '验证码不能为空' });
        }

        // 验证码校验（绑定 IP）
        if (!d.database.verifyCaptcha(captchaId, captchaCode, req.ip)) {
            return res.status(400).json({ code: 400, msg: '验证码错误或已过期' });
        }

        if (!d.database.verifyPassword(String(uid), password)) {
            return res.status(401).json({ code: 401, msg: 'UID或密码错误' });
        }

        // 签发Token对，Refresh Token通过Cookie下发
        const tokens = d.issueTokenPair(uid, d.webConfig);

        d.setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshExpiresAt - Date.now());

        res.json({
            code: 200,
            msg: '登录成功',
            data: {
                token: tokens.accessToken,
                uid: String(uid),
                role: d.database.isAdmin(String(uid)) ? 'admin' : 'user'
            }
        });
    });

    // Token续签
    router.post('/auth/refresh', d.refreshLimiter, function(req, res) {
        let cookies = d.parseCookies(req);
        let refreshToken = cookies.refresh_token;

        if (!refreshToken) {
            return res.status(401).json({ code: 401, msg: '缺少 Refresh Token' });
        }

        d.jwt.verify(refreshToken, d.getRefreshSecret(d.webConfig), function(err, decoded) {
            if (err) {
                d.clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: 'Refresh Token 无效或已过期' });
            }

            if (decoded.type !== 'refresh') {
                d.clearRefreshTokenCookie(res);
                return res.status(403).json({ code: 403, msg: '无效的 Token 类型' });
            }

            // 查找数据库中存储的Token记录
            const storedToken = d.database.findRefreshToken(decoded.jti);

            if (!storedToken) {
                d.clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: 'Refresh Token 不存在' });
            }

            // 检测重放攻击：已被撤销的Token再次使用时，作废整个Token家族
            if (storedToken.isRevoked) {
                d.database.revokeFamilyTokens(storedToken.familyId);
                d.clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: '检测到重放攻击，该登录链路所有 Token 已作废' });
            }

            if (storedToken.expiresAt < Date.now()) {
                d.clearRefreshTokenCookie(res);
                return res.status(401).json({ code: 401, msg: 'Refresh Token 已过期' });
            }

            // 旋转刷新：撤销当前Refresh Token，签发同家族的新Token对
            d.database.revokeRefreshToken(decoded.jti);

            const newTokens = d.issueTokenPair(decoded.uid, d.webConfig, storedToken.familyId);

            d.setRefreshTokenCookie(res, newTokens.refreshToken, newTokens.refreshExpiresAt - Date.now());

            res.json({
                code: 200,
                msg: '续签成功',
                data: {
                    token: newTokens.accessToken,
                    uid: String(decoded.uid),
                    role: d.database.isAdmin(String(decoded.uid)) ? 'admin' : 'user'
                }
            });
        });
    });

    // 退出登录：将Access Token加入黑名单，撤销Refresh Token，清除Cookie
    router.post('/auth/logout', function(req, res) {
        const authHeader = req.headers['authorization'];
        const accessToken = authHeader && authHeader.split(' ')[1];

        // 将Access Token加入黑名单
        if (accessToken) {
            try {
                // 用 verify 验证签名，防止伪造 jti 黑名单他人 token
                const decoded = d.jwt.verify(accessToken, d.getJwtSecret(), { ignoreExpiration: true });
                if (decoded && decoded.jti && decoded.exp) {
                    d.database.blacklistAccessToken(decoded.jti, decoded.exp * 1000);
                }
            } catch (e) { /* token签名无效或格式错误，跳过黑名单 */ }
        }

        const cookies = d.parseCookies(req);
        const refreshToken = cookies.refresh_token;

        // 撤销Refresh Token
        if (refreshToken) {
            try {
                const refreshDecoded = d.jwt.decode(refreshToken);
                if (refreshDecoded && refreshDecoded.jti) {
                    d.database.revokeRefreshToken(refreshDecoded.jti);
                }
            } catch (e) { /* token格式错误，跳过撤销 */ }
        }

        d.clearRefreshTokenCookie(res);

        res.json({ code: 200, msg: '已退出登录' });
    });

    // 验证当前Token是否有效
    router.get('/auth/verify', d.auth, function(req, res) {
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

    // 生成SVG验证码图片，验证码文本存储在数据库中供后续校验
    router.get('/captcha', d.captchaLimiter, function(req, res) {
        const captcha = d.svgCaptcha.create({
            size: 4,
            ignoreChars: 'o0OlI1i', // 排除易混淆字符
            noise: 3,
            color: true,
            background: '#f0f0f0',
            width: 120,
            height: 40,
            fontSize: 36
        });

        const captchaId = d.database.generateCaptcha(captcha.text, req.ip);

        res.json({
            code: 200,
            data: {
                captchaId: captchaId,
                svg: captcha.data
            }
        });
    });

    // 获取当前登录用户的基本信息
    router.get('/users/me', d.auth, function(req, res) {
        const uid = req.user.uid;
        res.json({
            code: 200,
            data: {
                uid: uid,
                role: req.user.role,
                isAdmin: d.database.isAdmin(uid)
            }
        });
    });
}

module.exports = { registerRoutes };
