<div align="center">

## 指令列表

### 玩家指令

| 指令             | 描述        | 配置开关                  |
| -------------- | --------- | --------------------- |
| `/shop`        | 打开商店系统    | `enableShop`          |
| `/rank`        | 查看排行榜     | `enableRank`          |
| `/cdk`         | CDK 兑换    | `enableCdk`           |
| `/pay`         | 打开经济系统    | —                     |
| `/mb`          | 打开留言板     | `enableMessageBoard`  |
| `/vip`         | 打开 VIP 菜单 | `enableVip`           |
| `/bank`        | 打开银行系统    | `enableBank`          |
| `/wish`        | 打开祈愿系统    | —                     |
| `/level`       | 查看冒险等级与奖励 | `level.enabled`       |
| `/xpshop`      | 打开经验商店    | `shop.enableXpShop`   |
| `/titles`      | 称号系统       | —                     |
| `/settings`    | 打开个人设置    | —                     |
| `/back`        | 返回死亡点     | `enableBack`          |
| `/mail`        | 打开邮件系统    | `enableMail`          |
| `/friend`      | 打开好友系统    | `enableFriend`        |
| `/network`     | 查看网络信息    | —                     |
| `/tpg`         | 打开传送系统主菜单 | `teleport.enabled`    |
| `/home`        | 打开家园系统    | `teleport.enableHome` |
| `/warp`        | 打开公共传送点   | `teleport.enableWarp` |
| `/tpa`         | 互传系统（选择玩家+方式） | `teleport.enableTpa`  |
| `/tpcancel`    | 取消传送请求    | `teleport.enableTpa`  |
| `/tpaccept`    | 接受传送请求    | `teleport.enableTpa`  |
| `/tpdeny`      | 拒绝传送请求    | `teleport.enableTpa`  |
| `/qcd`         | 打开快捷菜单    | —                     |
| `/qmenu`       | 打开快捷菜单    | —                     |
| `/org`         | 打开公会系统    | `guild.enabled`       |

### 管理员指令

| 指令                        | 描述             | 权限       |
| ------------------------- | -------------- | -------- |
| `/pban <ID/UID/XUID> [原因]` | 封禁玩家（同时封禁IP）   | 游戏管理员    |
| `/punban <ID/UID/XUID>`    | 解封玩家           | 游戏管理员    |
| `/pbanlist`                | 查看封禁列表         | 游戏管理员    |
| `/passwd`                 | 设置或修改 Web 登录密码 | 玩家 / 控制台 |
| `/backup`                 | 手动执行世界备份       | 游戏管理员    |
| `admin <add\|del> <uid>`  | 管理网页端管理员       | 仅控制台     |
| `pban <ID/UID/XUID> [原因]`  | 控制台封禁玩家        | 仅控制台     |
| `punban <ID/UID/XUID>`     | 控制台解封玩家        | 仅控制台     |
| `pbanlist`                 | 控制台查看封禁列表      | 仅控制台     |
| `backup`                  | 手动执行世界备份       | 仅控制台     |
| `freeze [reason]`         | 切换维护模式（踢出所有玩家并阻止加入） | 仅控制台     |

## Web 管理面板

NECE 内置基于 Express.js 的网页端管理后台，提供以下功能：

- **身份认证** — 基于 JWT 的登录系统，支持验证码验证
- **玩家管理** — 查看在线玩家、踢出玩家、修改余额、更改游戏模式
- **经济管理** — 查看经济总量、余额排行、货币设置
- **CDK 管理** — 创建、修改和删除兑换码
- **白名单管理** — 添加、移除和查看白名单
- **邮件管理** — 发送全体/个人邮件，管理定时邮件
- **聊天监控** — 查看实时和历史聊天记录
- **行为日志** — 按日期筛选查看玩家行为日志
- **系统监控** — CPU、内存、TPS、MSPT 及服务器统计
- **留言板管理** — 查看和管理社区留言
- **封禁管理** — 封禁/解封玩家，查看封禁列表，支持按ID/UID/XUID操作
- **公会管理** — 查看/创建/解散公会，管理成员、传送点和资金
- **称号管理** — 查看玩家称号、为玩家添加自定义称号
- **维护模式** — 远程切换维护模式，踢出所有玩家并阻止新玩家加入
- **赞助管理** — 管理赞助者记录（仅祈愿模块启用时可用）
- **传送配置** — 修改传送系统参数（冷却、功能开关）


### 添加新语言

1. 复制 `lang/zh_CN.json` 为新文件（如 `lang/en_US.json`）
2. 翻译所有值（保持键名不变）
3. 在 `config.json` 中设置 `"language": "en_US"`

## 插件 API（供其他 LSE 插件调用）

NECE 通过 `ll.export` 导出以下 API，其他 LSE 插件可通过 `ll.import` 调用。

### 获取玩家数据

```javascript
const neceGetPlayerData = ll.import('NECE_getPlayerData');
// 按 XUID
const data = neceGetPlayerData({ xuid: '123456' });
// 按 UID
const data = neceGetPlayerData({ uid: 10001 });
// 按玩家名
const data = neceGetPlayerData({ name: 'Steve' });
// 返回: 玩家数据对象 或 null
```

### 更新玩家数据

```javascript
const neceUpdatePlayerData = ll.import('NECE_updatePlayerData');
const success = neceUpdatePlayerData({ xuid: '123456' }, { healthBonus: 10 });
// 返回: true / false
```

### 获取在线玩家

```javascript
const neceGetOnlinePlayers = ll.import('NECE_getOnlinePlayers');
const players = neceGetOnlinePlayers();
// 返回: [{ xuid, uid, name }, ...]
```

### 经济操作

```javascript
const neceGetBalance = ll.import('NECE_getBalance');
neceGetBalance('123456'); // 余额

const neceAddBalance = ll.import('NECE_addBalance');
neceAddBalance('123456', 1000, '奖励'); // 增加

const neceReduceBalance = ll.import('NECE_reduceBalance');
neceReduceBalance('123456', 500, '购买'); // 扣除

const neceGetCurrencyName = ll.import('NECE_getCurrencyName');
neceGetCurrencyName(); // "星茜"
```

### 版本信息

```javascript
const neceGetVersion = ll.import('NECE_getVersion');
neceGetVersion(); // { version: '1.0.0', name: 'NECE' }
```

### 签到

```javascript
const neceSignPlayer = ll.import('NECE_signPlayer');

// 通过玩家姓名签到
const result = neceSignPlayer('Steve');
// 通过XUID签到
const result = neceSignPlayer('123456789');

// result: { success, reward, oldBalance, newBalance, consecutive }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | Boolean | 是否成功 |
| `reward` | Number | 签到获得的奖励 |
| `oldBalance` | Number | 原余额 |
| `newBalance` | Number | 现在余额 |
| `consecutive` | Number | 连续签到天数 |

### 获取玩家余额

```javascript
const neceGetPlayerBalance = ll.import('NECE_getPlayerBalance');
neceGetPlayerBalance('123456789'); // 返回: Number
```

### 获取玩家数据

```javascript
const neceGetPlayerInfo = ll.import('NECE_getPlayerInfo');
neceGetPlayerInfo('123456789'); // 返回: Object 或 null
```

### 获取货币名称

```javascript
const neceGetCurrencyName = ll.import('NECE_getCurrencyName');
neceGetCurrencyName(); // 返回: String
```

---

## 依赖项

### 运行时依赖

| 库/依赖                                                                 | 版本      | 许可证                                                                            | 用途               |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ | ---------------- |
| [express](https://www.npmjs.com/package/express)                     | ^4.21.0 | [MIT](https://github.com/expressjs/express/blob/master/LICENSE)                | Web 服务器框架        |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken)           | ^9.0.2  | [MIT](https://github.com/auth0/node-jsonwebtoken/blob/master/LICENSE)          | JWT 身份认证         |
| [cors](https://www.npmjs.com/package/cors)                           | ^2.8.5  | [MIT](https://github.com/expressjs/cors/blob/master/LICENSE)                   | 跨域资源共享           |
| [svg-captcha](https://www.npmjs.com/package/svg-captcha)             | ^1.4.0  | [MIT](https://github.com/produck/svg-captcha/blob/1.x/LICENSE.md)              | 验证码生成            |
| [csv-parser](https://www.npmjs.com/package/csv-parser)               | ^3.2.0  | [MIT](https://github.com/mafintosh/csv-parser/blob/master/LICENSE)             | CSV 日志解析         |
| [7zip-min](https://www.npmjs.com/package/7zip-min)                   | ^3.0.1  | [MIT](https://github.com/onikienko/7zip-min/blob/master/LICENSE)               | 7zip 压缩（用于备份）    |
| [multer](https://www.npmjs.com/package/multer)                       | ^1.4.5  | [MIT](https://github.com/expressjs/multer/blob/master/LICENSE)                 | 文件上传（地图画）       |


### 前端

- Web 管理面板前端修改自 [shadcn-vue-admin](https://github.com/Whbbit1999/shadcn-vue-admin)，作者 [@Whbbit1999](https://github.com/Whbbit1999)

## 灵感来源与致谢

本项目部分功能的设计灵感来源于以下开源项目，在此表示感谢：

| 功能模块 | 灵感来源项目                                                                | 作者                                                  | 许可证     | 说明                |
| ---- | --------------------------------------------------------------------- | --------------------------------------------------- | ------- | ----------------- |
| 商店系统 | [PShop](https://gitee.com/SCFY233/PShop/)                             | [SCFY](https://www.minebbs.com/members/scfy.32484/) | GPL-3.0 | 商店界面交互流程与配置管理设计参考 |
| 行为日志 | [LLSE-BehaviorLog](https://github.com/YQ-LL-Plugins/LLSE-BehaviorLog) | [YQ-LL-Plugins](https://github.com/YQ-LL-Plugins)   | 无       | 日志记录概念与CSV格式设计参考  |

## 参与贡献

欢迎贡献代码！请随时提交 Issue 或 Pull Request。

## 许可证

Copyright (C) 2026 LCH0426

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License v3.0** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.en.html) for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.


