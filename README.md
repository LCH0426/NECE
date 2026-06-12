<div align="center">

# 🌙 NECE

**LegacyScriptEngine (Node.js) 强大多功能服务器插件**

*现代化、功能丰富的 Minecraft 基岩版服务器管理插件*

[![许可证](https://img.shields.io/badge/许可证-GPL--3.0-blue.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Node.js-339933?logo=node.js\&logoColor=white)](https://nodejs.org/)
[![版本](https://img.shields.io/badge/版本-2.0.0-orange.svg)](https://github.com/LCH0426/NECE)
[![语言](https://img.shields.io/badge/语言-JavaScript-F7DF1E?logo=javascript\&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

</div>

***

## 介绍

**NECE**（**N**icole **E**ssential **C**ommunity **E**dition）是一款专为 **LegacyScriptEngine-server-nodejs** 设计的功能全面的多功能插件。使用 **JavaScript** 编写，提供从经济商店到 Web 管理面板等一系列丰富功能。

### 名字来源

**Nicole** 一词来源于魔女尼可（Nicole），因为实在想不到起什么名字了。本插件原属于 **Citlalia 服务器** 自用插件，现在将其开源并设计成社区版供大家使用。

### 项目背景

- **原版**：Citlalia 服务器内部自用版本
- **社区版**：NECE - 面向广大服务器管理者的开源版本



## 功能特性

| 功能                 | 描述                               | 状态   |
| ------------------ | -------------------------------- | ---- |
| **商店系统**           | 分类商品浏览与搜索，支持购买与回收                | ✅ 可用 |
| **经济系统**           | 完整的经济体系，包含余额查询与转账功能              | ✅ 可用 |
| **银行系统**           | 存取款、定期存款及利息计算                    | ✅ 可用 |
| **CDK 兑换**         | 兑换码兑换奖励，支持使用次数追踪与限制              | ✅ 可用 |
| **星尘商店**           | 使用星尘货币购买物品                       | ✅ 可用 |
| **经验商店**           | 使用货币兑换经验值                        | ✅ 可用 |
| **附魔书商店**          | 使用星尘购买附魔书                        | ✅ 可用 |
| **刷怪蛋商店**          | 使用星尘购买刷怪蛋                        | ✅ 可用 |
| **祈愿系统**           | 类似抽卡的祈愿系统，可配置卡池、概率与保底机制          | ✅ 可用 |
| **VIP 系统**         | 限时/永久 VIP，享受商店折扣与专属特权            | ✅ 可用 |
| **冒险等级系统**         | 通过获取经验升级，领取等级奖励                  | ✅ 可用 |
| **属性提升**           | 使用星核提升玩家属性（如最大生命值）               | ✅ 可用 |
| **死亡点返回**          | 传送回死亡地点                          | ✅ 可用 |
| **击杀特效**           | PvP 击杀时触发视觉特效与增益效果               | ✅ 可用 |
| **图腾自动替换**         | 图腾耗尽后自动从背包替换                     | ✅ 可用 |
| **自定义生命值**         | 可配置的最大生命值，支持升级加成                 | ✅ 可用 |
| **好友系统**           | 发送、接受和管理好友请求，查看好友详情              | ✅ 可用 |
| **消息系统**           | 好友与陌生人私信，对话历史，消息通知               | ✅ 可用 |
| **邮件系统**           | 完整的邮件系统，支持全体邮件、个人邮件和定时邮件         | ✅ 可用 |
| **公会系统**           | 创建/解散公会、成员管理、传送点、公会金库、邀请与申请加入   | ✅ 可用 |
| **留言板**            | 社区留言板，支持发帖、回复与管理                 | ✅ 可用 |
| **家园系统**           | 设置、删除和传送到个人家园点，支持数量限制和冷却时间       | ✅ 可用 |
| **公共传送点**          | 由管理员管理的公共传送点，方便社区快速出行            | ✅ 可用 |
| **互传系统**           | 玩家间传送请求，下拉选择玩家和传送方式，支持接受/拒绝/取消 | ✅ 可用 |
| **称号系统**           | 购买和设置称号，聊天前缀展示，管理员可自定义添加        | ✅ 可用 |
| **Web 管理面板**       | 基于 Express.js 的网页端管理后台，使用 JWT 认证 | ✅ 可用 |
| **封禁系统**           | 支持按玩家ID/UID/XUID封禁，IP关联封禁        | ✅ 可用 |
| **排行榜**            | 经济、存款、击杀、死亡、挖掘等多维度排行             | ✅ 可用 |
| **NPC 攻击响应 (NAR)** | 配置玩家与 NPC 交互/攻击时的自定义行为           | ✅ 可用 |
| **聊天系统**           | 自定义聊天格式，支持敏感词过滤与公会标签             | ✅ 可用 |
| **快捷菜单**           | 可自定义的快捷访问菜单，支持物品快捷方式             | ✅ 可用 |
| **TPS/MSPT 监控**    | 实时服务器 TPS 与 MSPT 追踪              | ✅ 可用 |
| **侧边栏显示**          | 动作栏侧边栏展示余额、延迟、TPS、生物群系、时间等       | ✅ 可用 |
| **行为日志**           | 全面记录玩家行为（加入、方块交互、战斗等）            | ✅ 可用 |
| **聊天日志**           | 完整的聊天历史记录，支持按日期查询                | ✅ 可用 |
| **管理日志**           | 网页端管理员操作的审计追踪                    | ✅ 可用 |
| **网络信息**           | 显示 IPv4/IPv6 连接信息                | ✅ 可用 |
| **玩家设置**           | 每位玩家可独立开关偏好（欢迎消息、侧边栏信息、通知等）      | ✅ 可用 |
| **头像系统**           | 通过 QQ、自定义链接设置玩家头像  | ✅ 可用 |
| **UID 显示**         | 在动作栏显示玩家 UID                     | ✅ 可用 |
| **IP 检测器**         | 检测并通知玩家的 IPv4/IPv6 连接            | ✅ 可用 |
| **连锁挖矿**          | 使用镐子/斧子/铲子/锄头时自动连锁破坏同类方块，支持玩家个性化配置 | ✅ 可用 |
| **i18n 支持**        | 多语言国际化支持，玩家可自由选择语言               | ⚠️部分可用 |
| **领地系统**          | 玩家可创建和管理私人领地，设置权限和防护            | 🚧 计划中 |
| **Endstone支持**        | Endstone 插件加载器支持                       | ❌ 短期无计划 |


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
| `/ban <ID/UID/XUID> [原因]` | 封禁玩家（同时封禁IP）   | 游戏管理员    |
| `/unban <ID/UID/XUID>`    | 解封玩家           | 游戏管理员    |
| `/banlist`                | 查看封禁列表         | 游戏管理员    |
| `/passwd`                 | 设置或修改 Web 登录密码 | 玩家 / 控制台 |
| `/backup`                 | 手动执行世界备份       | 游戏管理员    |
| `admin <add\|del> <uid>`  | 管理网页端管理员       | 仅控制台     |
| `ban <ID/UID/XUID> [原因]`  | 控制台封禁玩家        | 仅控制台     |
| `unban <ID/UID/XUID>`     | 控制台解封玩家        | 仅控制台     |
| `banlist`                 | 控制台查看封禁列表      | 仅控制台     |
| `backup`                  | 手动执行世界备份       | 仅控制台     |

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
- **赞助管理** — 管理赞助者记录（仅祈愿模块启用时可用）
- **传送配置** — 修改传送系统参数（冷却、花费、功能开关）

## 安装

1. 确保 BDS 服务器已安装 **LegacyScriptEngine-nodejs**
2. 下载最新版本，将 `NECE` 文件夹放置在服务器的 `plugins/` 目录中
3. 启动服务器 — 插件将自动生成默认配置文件
4. 根据需要修改 `plugins/NECE/config.json` 以启用/禁用功能

## 配置说明

主配置文件位于 `plugins/NECE/config.json`，关键配置项如下：

| 配置项                   | 默认值         | 描述          |
| --------------------- | ----------- | ----------- |
| `language`            | `"zh_CN"`   | 系统默认语言（货币名称从语言文件读取） |
| `shop.enabled`        | `true`      | 启用商店系统      |
| `shop.enableRecycle`  | `true`      | 启用回收系统      |
| `shop.enableXpShop`   | `true`      | 启用经验商店      |
| `rank.enabled`        | `true`      | 启用排行榜系统     |
| `cdk.enabled`         | `true`      | 启用 CDK 兑换   |
| `bank.enabled`        | `true`      | 启用银行系统      |
| `vip.enabled`         | `true`      | 启用 VIP 系统   |
| `friend.enabled`      | `true`      | 启用好友系统      |
| `guild.enabled`       | `true`      | 启用公会系统      |
| `messageBoard.enabled`| `true`      | 启用留言板       |
| `mail.enabled`        | `true`      | 启用邮件系统      |
| `level.enabled`       | `true`      | 启用冒险等级系统    |
| `back.enabled`        | `true`      | 启用死亡点返回     |
| `teleport.enabled`    | `true`      | 启用传送系统      |
| `teleport.enableHome` | `true`      | 启用家园系统      |
| `teleport.enableWarp` | `true`      | 启用公共传送点     |
| `teleport.enableTpa`  | `true`      | 启用互传系统      |
| `titles.defaultTitle` | `"萌新"`     | 玩家默认称号      |
| `titles.shop`         | `[]`        | 可购买称号列表     |
| `chat.enabled`        | `true`      | 启用自定义聊天格式   |
| `chat.format`         | `...`       | 聊天格式模板      |
| `chat.wordFilter`     | `true`      | 启用敏感词过滤     |
| `teleport.enableTpa`  | `true`      | 启用互传系统      |
| `teleport.homeLimit`  | `10`        | 每位玩家最大家园数   |
| `teleport.tpaCost`    | `0`         | 互传费用        |
| `web.enabled`         | `true`      | 启用 Web 管理面板 |
| `web.enableFrontend`  | `true`      | 启用 Web 前端   |
| `web.port`            | `8080`      | Web 面板端口    |
| `web.host`            | `"0.0.0.0"` | Web 面板绑定地址  |
| `web.secureCookie`    | `false`     | HTTPS 时启用 Secure Cookie |

## 国际化 (i18n)

NECE 支持多语言界面，语言文件位于 `lang/` 目录。通过 `config.json` 的 `language` 字段切换语言（默认 `zh_CN`）。

### 已完成国际化的模块

| 模块 | 文件 | 命名空间 | 状态 |
|------|------|----------|------|
| 封禁系统 | `src/ban.js` | `ban.*` | ✅ 已完成 |
| CDK兑换 | `src/cdk.js` | `cdk.*` | ✅ 已完成 |
| 备份系统 | `src/backup.js` | `backup.*` | ✅ 已完成 |
| 实体清理 | `src/clearLag.js` | `clearlag.*` | ✅ 已完成 |
| 留言板 | `src/messageBoard.js` | `mb.*` | ✅ 已完成 |
| 银行系统 | `src/bank.js` | `bank.*` | ✅ 已完成 |
| 公会系统 | `src/guild.js` | `guild.*` | ⏳ 待完成 |
| 邮件系统 | `src/mail.js` | `mail.*` | ⏳ 待完成 |
| 好友系统 | `src/friend.js` | `friend.*` | ⏳ 待完成 |
| 商店系统 | `src/shop.js` | `shop.*` | ⏳ 待完成 |
| 传送系统 | `src/teleport.js` | `teleport.*` | ⏳ 待完成 |
| 祈愿系统 | `src/wish.js` | `wish.*` | ⏳ 待完成 |
| 连锁挖矿 | `src/chain.js` | `chain.*` | ⏳ 待完成 |
| VIP系统 | `src/vip.js` | `vip.*` | ⏳ 待完成 |
| 经济系统 | `src/economy.js` | `economy.*` | ⏳ 待完成 |
| 排行榜 | `src/rank.js` | `rank.*` | ⏳ 待完成 |
| 个人中心 | `src/personalCenter.js` | `pc.*` | ⏳ 待完成 |
| 聊天系统 | `src/chat.js` | `chat.*` | ⏳ 待完成 |
| 侧边栏 | `src/sidebar.js` | `sidebar.*` | ⏳ 待完成 |
| 菜单系统 | `src/menu.js` | `menu.*` | ⏳ 待完成 |
| 个人数据 | `src/playerData.js` | `pd.*` | ⏳ 待完成 |
| 死亡点 | `src/deathPoint.js` | `death.*` | ⏳ 待完成 |
| MOTD | `src/motd.js` | `motd.*` | ⏳ 待完成 |

### 添加新语言

1. 复制 `lang/zh_CN.json` 为新文件（如 `lang/en_US.json`）
2. 翻译所有值（保持键名不变）
3. 在 `config.json` 中设置 `"language": "en_US"`

## 项目结构

```
NECE/
├── index.js              # 插件主入口（模块初始化、事件监听、命令注册）
├── config.json           # 插件配置
├── manifest.json         # LSE 插件清单
├── src/                  # 功能模块
│   ├── constants.js      # 常量定义（路径、默认设置、枚举）
│   ├── utils.js          # 工具函数
│   ├── database.js       # SQLite 数据库管理
│   ├── economy.js        # 经济系统
│   ├── playerData.js     # 玩家数据管理
│   ├── personalCenter.js # 个人中心
│   ├── chat.js           # 聊天系统 + 称号系统
│   ├── sidebar.js        # 侧边栏/actionbar 渲染
│   ├── menu.js           # 菜单系统（主菜单+快捷菜单）
│   ├── teleport.js       # 传送系统（家/地标/TPA/死亡点）
│   ├── shop.js           # 商店与回收
│   ├── bank.js           # 银行系统
│   ├── vip.js            # VIP 会员
│   ├── wish.js           # 祈愿抽卡 + 赞助管理
│   ├── guild.js          # 公会系统
│   ├── monitoring.js     # 系统监控
│   ├── i18n.js           # 国际化模块
│   ├── server.js         # Web 服务器
│   └── routes/           # Web API 路由
│       ├── admin.js      # 系统监控/清理/聊天/称号管理API
│       ├── players.js    # 玩家列表/排行/详情
│       └── ...           # 其他路由模块
├── lang/                 # 语言文件目录
│   └── zh_CN.json        # 简体中文翻译
├── data/                 # 数据文件
├── public/               # Web 面板前端
├── manifest.json         # LSE 插件清单
├── package.json          # Node.js 依赖声明
└── LICENSE                # GPL-3.0 许可证
```

## 依赖项

### 运行时依赖

| 库/依赖                                                                 | 版本      | 许可证                                                                            | 用途               |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ | ---------------- |
| [express](https://www.npmjs.com/package/express)                     | ^4.21.0 | [MIT](https://github.com/expressjs/express/blob/master/LICENSE)                | Web 服务器框架        |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken)           | ^9.0.2  | [MIT](https://github.com/auth0/node-jsonwebtoken/blob/master/LICENSE)          | JWT 身份认证         |
| [sql.js](https://www.npmjs.com/package/sql.js)                       | ^1.11.0 | [MIT](https://github.com/sql-js/sql.js/blob/master/LICENSE)                    | SQLite 数据库（纯 JS/WASM，内存模式+文件持久化） |
| [cors](https://www.npmjs.com/package/cors)                           | ^2.8.5  | [MIT](https://github.com/expressjs/cors/blob/master/LICENSE)                   | 跨域资源共享           |
| [svg-captcha](https://www.npmjs.com/package/svg-captcha)             | ^1.4.0  | [MIT](https://github.com/produck/svg-captcha/blob/1.x/LICENSE.md)              | 验证码生成            |
| [csv-parser](https://www.npmjs.com/package/csv-parser)               | ^3.2.0  | [MIT](https://github.com/mafintosh/csv-parser/blob/master/LICENSE)             | CSV 日志解析         |
| [systeminformation](https://www.npmjs.com/package/systeminformation) | ^5.31.6 | [MIT](https://github.com/sebhildebrandt/systeminformation/blob/master/LICENSE) | 系统监控             |
| [7zip-min](https://www.npmjs.com/package/7zip-min)                   | ^3.0.1  | [MIT](https://github.com/onikienko/7zip-min/blob/master/LICENSE)               | 7zip 压缩（用于备份）    |

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

***

<div align="center">

**Made with ❤️ by LCH0426**

[⬆ 回到顶部](#-nece)

</div>
