<div align="center">

# 🌙 NLCE

**LegacyScriptEngine (Node.js) 强大多功能服务器插件**

*现代化、功能丰富的 Minecraft 基岩版服务器管理插件*

[![许可证](https://img.shields.io/badge/许可证-GPL--3.0-blue.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Node.js-339933?logo=node.js\&logoColor=white)](https://nodejs.org/)
[![版本](https://img.shields.io/badge/版本-1.9.9-orange.svg)](https://github.com/LCH0426/NLCE)
[![语言](https://img.shields.io/badge/语言-JavaScript-F7DF1E?logo=javascript\&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

</div>

***

## 介绍

**NLCE**（**N**icole **E**ssential **C**ommunity **E**dition）是一款专为 **LegacyScriptEngine-server-nodejs** 设计的功能全面的多功能插件。使用 **JavaScript** 编写，提供从经济商店到 Web 管理面板等一系列丰富功能。

### 名字来源

**Nicole** 一词来源于魔女尼可（Nicole），因为实在想不到起什么名字了。本插件原属于 **Citlalia 服务器** 自用插件，现在将其开源并设计成社区版供大家使用。

### 项目背景

- **原版**：Citlalia 服务器内部自用版本
- **社区版**：NLCE - 面向广大服务器管理者的开源版本



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
| **留言板**            | 社区留言板，支持发帖、回复与管理                 | ✅ 可用 |
| **家园系统**           | 设置、删除和传送到个人家园点，支持数量限制和冷却时间       | ✅ 可用 |
| **公共传送点**          | 由管理员管理的公共传送点，方便社区快速出行            | ✅ 可用 |
| **互传系统**           | 玩家间传送请求（tpa/tpn/tpy），支持接受/拒绝/取消  | ✅ 可用 |
| **随机传送 (RTP)**     | 在可配置范围内随机传送，含冷却时间和出生点保护          | ✅ 可用 |
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
| **头像系统**           | 通过 QQ、自定义链接或 Citlalia 头像码设置玩家头像  | ✅ 可用 |
| **UID 显示**         | 在动作栏显示玩家 UID                     | ✅ 可用 |
| **IP 检测器**         | 检测并通知玩家的 IPv4/IPv6 连接            | ✅ 可用 |
| **领地系统**          | 玩家可创建和管理私人领地，设置权限和防护            | 🚧 计划中 |
| **Endstone支持**        | Endstone 插件加载器支持                       | ❌ 短期无计划 |
| **i18n 支持**        | 多语言国际化支持                        | ❌ 无计划 |

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
| `/wish`        | 打开祈愿系统    | `enableWish`          |
| `/level`       | 查看冒险等级与奖励 | `enableLevel`         |
| `/xpshop`      | 打开经验商店    | `enableDustShop`      |
| `/dustshop`    | 打开星尘商店    | `enableDustShop`      |
| `/enchantshop` | 打开附魔书商店   | `enableDustShop`      |
| `/settings`    | 打开个人设置    | —                     |
| `/back`        | 返回死亡点     | `enableBack`          |
| `/mail`        | 打开邮件系统    | `enableMail`          |
| `/friend`      | 打开好友系统    | `enableFriend`        |
| `/network`     | 查看网络信息    | —                     |
| `/tpg`         | 打开传送系统主菜单 | `teleport.enabled`    |
| `/home`        | 打开家园系统    | `teleport.enableHome` |
| `/warp`        | 打开公共传送点   | `teleport.enableWarp` |
| `/tpa`         | 传送到玩家     | `teleport.enableTpa`  |
| `/tpn`         | 请玩家传送过来   | `teleport.enableTpa`  |
| `/tpy`         | 双方互传请求    | `teleport.enableTpa`  |
| `/tpcancel`    | 取消传送请求    | `teleport.enableTpa`  |
| `/tpaccept`    | 接受传送请求    | `teleport.enableTpa`  |
| `/tpdeny`      | 拒绝传送请求    | `teleport.enableTpa`  |
| `/rtp`         | 随机传送      | `teleport.enableRtp`  |

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

NLCE 内置基于 Express.js 的网页端管理后台，提供以下功能：

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

## 安装

1. 确保 BDS 服务器已安装 **LegacyScriptEngine-nodejs**
2. 下载最新版本，将 `NLCE` 文件夹放置在服务器的 `plugins/` 目录中
3. 启动服务器 — 插件将自动生成默认配置文件
4. 根据需要修改 `plugins/NLCE/config.json` 以启用/禁用功能

## 配置说明

主配置文件位于 `plugins/NLCE/config.json`，关键配置项如下：

| 配置项                   | 默认值         | 描述          |
| --------------------- | ----------- | ----------- |
| `currencyName`        | `"星茜"`      | 游戏内货币名称     |
| `enableRank`          | `true`      | 启用排行榜系统     |
| `enableShop`          | `true`      | 启用商店系统      |
| `enableCdk`           | `true`      | 启用 CDK 兑换   |
| `enableRecycle`       | `true`      | 启用回收系统      |
| `enableDustShop`      | `true`      | 启用星尘商店与经验商店 |
| `enableWish`          | `true`      | 启用祈愿系统      |
| `enableBank`          | `true`      | 启用银行系统      |
| `enableVip`           | `true`      | 启用 VIP 系统   |
| `enableFriend`        | `true`      | 启用好友系统      |
| `enableMessageBoard`  | `true`      | 启用留言板       |
| `enableMail`          | `true`      | 启用邮件系统      |
| `enableLevel`         | `true`      | 启用冒险等级系统    |
| `enableBack`          | `true`      | 启用死亡点返回     |
| `teleport.enabled`    | `true`      | 启用传送系统      |
| `teleport.enableHome` | `true`      | 启用家园系统      |
| `teleport.enableWarp` | `true`      | 启用公共传送点     |
| `teleport.enableTpa`  | `true`      | 启用互传系统      |
| `teleport.enableRtp`  | `true`      | 启用随机传送      |
| `teleport.homeLimit`  | `10`        | 每位玩家最大家园数   |
| `teleport.tpaCost`    | `0`         | 互传费用        |
| `teleport.rtpRange`   | `5000`      | 随机传送最大范围    |
| `web.enabled`         | `true`      | 启用 Web 管理面板 |
| `web.enableFrontend`  | `true`      | 启用 Web 前端   |
| `web.port`            | `8080`      | Web 面板端口    |
| `web.host`            | `"0.0.0.0"` | Web 面板绑定地址  |

## 项目结构

```
NLCE/
├── index.js              # 插件主入口
├── core/
│   ├── server.js          # Web 服务器与 REST API
│   ├── database.js        # SQLite 数据库管理
│   ├── systemMonitor.js   # 系统资源监控
│   ├── serverStats.js     # 服务器统计（TPS/MSPT）
│   ├── behaviorLog.js     # 玩家行为日志与查询API
│   ├── chatLog.js         # 聊天历史记录
│   ├── adminLog.js        # 管理员操作审计日志
│   ├── mail.js            # 邮件系统模块
│   ├── messageBoard.js    # 留言板模块
│   ├── backup.js          # 自动备份系统
│   ├── wish.js            # 祈愿系统模块
│   ├── friend.js          # 好友与消息系统模块
│   ├── ban.js             # 封禁系统模块
│   ├── teleport.js        # 传送系统模块（home/warp/tpa/rtp）
│   ├── vip.js             # VIP 系统模块
│   ├── cdk.js             # CDK 兑换模块
│   ├── rank.js            # 排行榜模块
│   ├── bank.js            # 银行系统模块
│   ├── pay.js             # 经济与支付模块
│   ├── shop.js            # 商店与回收模块
│   ├── constants.js       # 常量定义
│   └── utils.js           # 工具函数
├── data/
│   └── items.json         # 物品数据注册表
├── WEB/                   # Web 前端资源
├── manifest.json          # LSE 插件清单
├── package.json           # Node.js 依赖声明
└── LICENSE                # GPL-3.0 许可证
```

## 依赖项

### 运行时依赖

| 库/依赖                                                                 | 版本      | 许可证                                                                            | 用途               |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ | ---------------- |
| [express](https://www.npmjs.com/package/express)                     | ^4.21.0 | [MIT](https://github.com/expressjs/express/blob/master/LICENSE)                | Web 服务器框架        |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken)           | ^9.0.2  | [MIT](https://github.com/auth0/node-jsonwebtoken/blob/master/LICENSE)          | JWT 身份认证         |
| [sql.js](https://www.npmjs.com/package/sql.js)                       | ^1.11.0 | [MIT](https://github.com/sql-js/sql.js/blob/master/LICENSE)                    | SQLite 数据库（内存模式） |
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

[⬆ 回到顶部](#-nlce)

</div>
