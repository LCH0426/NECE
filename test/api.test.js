/**
 * NECE API 测试模板
 * 测试所有API端点的权限和功能
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:8080/api/v1';
let userToken = '';
let adminToken = '';

// 测试账号配置
const TEST_USER = {
    uid: '10001',      // 普通用户UID
    password: '000000' // 密码
};

const TEST_ADMIN = {
    uid: '10000',      // 管理员UID
    password: '000000' // 密码
};

// 测试结果统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * 发送HTTP请求
 */
async function request(method, path, data, token, noAuth) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + path);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (token && !noAuth) {
            options.headers['Authorization'] = 'Bearer ' + token;
        }

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(body)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: body
                    });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

/**
 * 断言函数
 */
function assert(condition, testName) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ ${testName}`);
    } else {
        failedTests++;
        console.log(`  ✗ ${testName}`);
    }
}

/**
 * 登录获取Token
 */
async function login(uid, password) {
    try {
        // 先获取验证码
        const captchaRes = await request('GET', '/captcha', null, null, true);
        let captchaId = '';
        if (captchaRes.data && captchaRes.data.data && captchaRes.data.data.captchaId) {
            captchaId = captchaRes.data.data.captchaId;
        }
        
        // 登录
        const loginRes = await request('POST', '/auth/login', {
            uid: uid,
            password: password,
            captchaId: captchaId,
            captchaCode: '0000'  // 测试环境验证码
        }, null, true);
        
        if (loginRes.status === 200 && loginRes.data && loginRes.data.data) {
            return loginRes.data.data.token;
        }
        
        console.log(`  登录失败 (${uid}):`, loginRes.data ? loginRes.data.msg : '未知错误');
        return '';
    } catch (error) {
        console.log(`  登录错误 (${uid}):`, error.message);
        return '';
    }
}

/**
 * 测试认证接口
 */
async function testAuth() {
    console.log('\n=== 认证接口测试 ===');

    // GET /auth/verify - 验证Token
    const verify = await request('GET', '/auth/verify', null, userToken);
    assert(verify.status === 200, 'GET /auth/verify - 验证有效Token');

    // GET /users/me - 获取当前用户
    const me = await request('GET', '/users/me', null, userToken);
    assert(me.status === 200, 'GET /users/me - 获取用户信息');
}

/**
 * 测试玩家接口
 */
async function testPlayers() {
    console.log('\n=== 玩家接口测试 ===');

    // 普通用户访问管理员接口应返回403
    const online = await request('GET', '/players/online', null, userToken);
    assert(online.status === 403, 'GET /players/online - 普通用户应被拒绝');

    // 管理员访问应成功
    const adminOnline = await request('GET', '/players/online', null, adminToken);
    assert(adminOnline.status === 200, 'GET /players/online - 管理员应成功');

    // GET /players - 玩家列表
    const players = await request('GET', '/players', null, adminToken);
    assert(players.status === 200, 'GET /players - 获取玩家列表');
}

/**
 * 测试留言板接口
 */
async function testMessageBoard() {
    console.log('\n=== 留言板接口测试 ===');

    // GET /messages - 获取留言列表
    const messages = await request('GET', '/messages', null, userToken);
    assert(messages.status === 200, 'GET /messages - 获取留言列表');

    // GET /messages/my - 获取我的留言
    const myMessages = await request('GET', '/messages/my', null, userToken);
    assert(myMessages.status === 200, 'GET /messages/my - 获取我的留言');

    // POST /messages - 发布留言
    const newMsg = await request('POST', '/messages', {
        content: '测试留言',
        mood: '开心'
    }, userToken);
    assert(newMsg.status === 200, 'POST /messages - 发布留言');

    // GET /messages/:id - 获取留言详情
    if (newMsg.data && newMsg.data.data && newMsg.data.data.id) {
        const msgId = newMsg.data.data.id;
        const detail = await request('GET', `/messages/${msgId}`, null, userToken);
        assert(detail.status === 200, 'GET /messages/:id - 获取留言详情');

        // DELETE /messages/:id - 删除留言
        const del = await request('DELETE', `/messages/${msgId}`, null, userToken);
        assert(del.status === 200, 'DELETE /messages/:id - 删除自己的留言');
    }

    // GET /messages/all - 管理员获取所有留言
    const allMessages = await request('GET', '/messages/all', null, adminToken);
    assert(allMessages.status === 200, 'GET /messages/all - 管理员获取所有留言');

    // 普通用户访问管理员接口应返回403
    const userAll = await request('GET', '/messages/all', null, userToken);
    assert(userAll.status === 403, 'GET /messages/all - 普通用户应被拒绝');
}

/**
 * 测试邮件接口
 */
async function testMail() {
    console.log('\n=== 邮件接口测试 ===');

    // GET /mails - 获取邮件列表
    const mails = await request('GET', '/mails', null, adminToken);
    assert(mails.status === 200, 'GET /mails - 获取邮件列表');
}

/**
 * 测试商店接口
 */
async function testShop() {
    console.log('\n=== 商店接口测试 ===');

    // GET /shop - 获取商店数据
    const shop = await request('GET', '/shop', null, adminToken);
    assert(shop.status === 200, 'GET /shop - 获取商店数据');

    // GET /shop/groups - 获取商店分组
    const groups = await request('GET', '/shop/groups', null, adminToken);
    assert(groups.status === 200, 'GET /shop/groups - 获取商店分组');
}

/**
 * 测试公会接口
 */
async function testGuild() {
    console.log('\n=== 公会接口测试 ===');

    // GET /guild/list - 获取公会列表
    const guildList = await request('GET', '/guild/list', null, userToken);
    assert(guildList.status === 200, 'GET /guild/list - 获取公会列表');

    // GET /guild/my - 获取我的公会
    const myGuild = await request('GET', '/guild/my', null, userToken);
    assert(myGuild.status === 200, 'GET /guild/my - 获取我的公会');

    // GET /admin/guild/list - 管理员获取公会列表
    const adminGuildList = await request('GET', '/admin/guild/list', null, adminToken);
    assert(adminGuildList.status === 200, 'GET /admin/guild/list - 管理员获取公会列表');
}

/**
 * 测试传送接口
 */
async function testTeleport() {
    console.log('\n=== 传送接口测试 ===');

    // GET /teleport/warps - 获取公共传送点
    const warps = await request('GET', '/teleport/warps', null, adminToken);
    assert(warps.status === 200, 'GET /teleport/warps - 获取公共传送点');
}

/**
 * 测试系统管理接口
 */
async function testAdmin() {
    console.log('\n=== 系统管理接口测试 ===');

    // GET /clearlag/config - 获取清理配置
    const clearlagConfig = await request('GET', '/clearlag/config', null, adminToken);
    assert(clearlagConfig.status === 200, 'GET /clearlag/config - 获取清理配置');

    // GET /clearlag/stats - 获取实体统计
    const clearlagStats = await request('GET', '/clearlag/stats', null, adminToken);
    assert(clearlagStats.status === 200, 'GET /clearlag/stats - 获取实体统计');

    // GET /backup/config - 获取备份配置
    const backupConfig = await request('GET', '/backup/config', null, adminToken);
    assert(backupConfig.status === 200, 'GET /backup/config - 获取备份配置');

    // 普通用户访问管理员接口应返回403
    const userClearlag = await request('GET', '/clearlag/config', null, userToken);
    assert(userClearlag.status === 403, 'GET /clearlag/config - 普通用户应被拒绝');
}

/**
 * 主测试函数
 */
async function runTests() {
    console.log('NECE API 测试开始');
    console.log('='.repeat(50));
    console.log(`服务器地址: ${BASE_URL}`);
    
    // 登录获取Token
    console.log('\n=== 登录测试 ===');
    userToken = await login(TEST_USER.uid, TEST_USER.password);
    assert(userToken !== '', '普通用户登录');
    
    adminToken = await login(TEST_ADMIN.uid, TEST_ADMIN.password);
    assert(adminToken !== '', '管理员登录');
    
    if (!userToken && !adminToken) {
        console.log('\n错误: 无法登录，请检查测试账号配置');
        return;
    }

    try {
        if (userToken) await testAuth();
        await testPlayers();
        await testMessageBoard();
        await testMail();
        await testShop();
        await testGuild();
        await testTeleport();
        await testAdmin();
    } catch (error) {
        console.error('测试执行错误:', error.message);
    }

    console.log('\n' + '='.repeat(50));
    console.log(`测试完成: ${passedTests}/${totalTests} 通过`);
    if (failedTests > 0) {
        console.log(`失败: ${failedTests} 个测试`);
    }
    console.log('='.repeat(50));
}

// 运行测试
runTests();
