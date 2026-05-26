<div align="center">

# 🌙 NLCE

**A powerful multi-functional plugin for LegacyScriptEngine (Node.js)**

*A modern, feature-rich server management plugin for Minecraft Bedrock Dedicated Server*

[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/version-1.9.9-orange.svg)](https://github.com/LCH0426/NLCE)
[![Language](https://img.shields.io/badge/language-JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

[English](#introduction) · [中文](README.zh_CN.md)

</div>

---

## Introduction

**NLCE** (codename: *Robin*) is a comprehensive multi-functional plugin designed for **LegacyScriptEngine-server-nodejs**. Written in **JavaScript**, it provides a wide range of features — from economy and shop systems to a web-based admin panel.

## Features

### 🏪 Economy & Trading
- **Shop System** — Categorized item browsing and search, with buy and sell support
- **Economy System** — Complete economy with balance queries and transfers
- **Bank System** — Deposits, withdrawals, fixed-term deposits, and interest calculation
- **CDK Redemption** — Redeem codes for rewards, with usage tracking and limits
- **Dust Shop** — Purchase items using stardust currency
- **XP Shop** — Exchange currency for experience points
- **Enchant Book Shop** — Purchase enchanted books with stardust
- **Spawn Egg Shop** — Purchase spawn eggs with stardust

### 🎮 Gameplay
- **Wish System** — Gacha-style wish system with configurable pools, rates, and pity mechanics
- **VIP System** — Time-based or permanent VIP with shop discounts and exclusive perks
- **Adventure Level System** — Level up by gaining experience and claim level rewards
- **Attribute Upgrade** — Upgrade player attributes (e.g., max health) using stardust cores
- **Death Point Return** — Teleport back to death locations
- **Kill Effects** — Visual effects and buffs triggered on PvP kills
- **Totem Auto-Replace** — Automatically replace consumed totems from inventory
- **Custom Health** — Configurable max health with upgradeable bonuses

### 🤝 Social
- **Friend System** — Send, accept, and manage friend requests; view friend details
- **Message System** — Private messaging with friends and strangers, conversation history, notifications (integrated into friend system)
- **Mail System** — Full mail system with global, individual, and scheduled mail delivery (admin)
- **Message Board** — Community message board with posting, replying, and management

### 🌍 Teleportation
- **Home System** — Set, delete, and teleport to personal home points with configurable limits and cooldowns
- **Warp System** — Public teleport points managed by admins for community fast travel
- **Tpa System** — Player-to-player teleport requests (tpa/tpn/tpy) with accept/deny/cancel, cooldowns, and optional fees
- **Random Teleport (RTP)** — Random teleportation within configurable range, with cooldown and spawn protection

### ⚙️ Server Management
- **Web Admin Panel** — Feature-rich web dashboard built on Express.js with JWT authentication, frontend modified from [shadcn-vue-admin](https://github.com/Whbbit1999/shadcn-vue-admin)
- **Ban System** — Ban/unban players by ID/UID/XUID, with IP association and console/in-game management
- **Rankings** — Multi-dimensional leaderboards for economy, deposits, kills, deaths, and mining
- **NPC Action Response (NAR)** — Configure custom actions when players interact with/attack NPCs
- **Chat System** — Customizable chat format with bad word filter and guild tag support
- **Quick Menu** — Customizable quick-access menu with item shortcuts

### 📊 Monitoring & Logging
- **TPS/MSPT Monitor** — Real-time server TPS and MSPT tracking
- **Sidebar Display** — Actionbar sidebar showing balance, ping, TPS, biome, time, and more
- **Behavior Log** — Comprehensive logging of player actions (joins, block interactions, combat, etc.)
- **Chat Log** — Full chat history logging with date-based querying
- **Admin Log** — Audit trail for admin actions via the web panel
- **Network Info** — Display IPv4/IPv6 connection information

### 🎨 Customization
- **Player Settings** — Per-player toggleable preferences (welcome messages, sidebar info, notifications, etc.)
- **Avatar System** — Set player avatars via QQ, custom URLs, or Citlalia codes
- **UID Display** — Show player UID on the actionbar
- **IP Detector** — Detect and notify players about IPv4/IPv6 connections

## Commands

### Player Commands

| Command | Description | Config Toggle |
|---------|-------------|---------------|
| `/shop` | Open the shop system | `enableShop` |
| `/rank` | View leaderboards | `enableRank` |
| `/cdk` | Redeem a CDK code | `enableCdk` |
| `/pay` | Open the economy menu | — |
| `/mb` | Open the message board | `enableMessageBoard` |
| `/vip` | Open the VIP menu | `enableVip` |
| `/bank` | Open the banking system | `enableBank` |
| `/wish` | Open the wish system | `enableWish` |
| `/level` | View adventure level & rewards | `enableLevel` |
| `/xpshop` | Open the experience shop | `enableDustShop` |
| `/dustshop` | Open the stardust shop | `enableDustShop` |
| `/enchantshop` | Open the enchantment book shop | `enableDustShop` |
| `/settings` | Open personal settings | — |
| `/back` | Return to death point | `enableBack` |
| `/mail` | Open the mail system | `enableMail` |
| `/friend` | Open the friend system | `enableFriend` |
| `/network` | View network information | — |
| `/tpg` | Open teleport main menu | `teleport.enabled` |
| `/home` | Open home system | `teleport.enableHome` |
| `/warp` | Open public warp points | `teleport.enableWarp` |
| `/tpa` | Request teleport to a player | `teleport.enableTpa` |
| `/tpn` | Request a player to teleport to you | `teleport.enableTpa` |
| `/tpy` | Mutual teleport request | `teleport.enableTpa` |
| `/tpcancel` | Cancel teleport request | `teleport.enableTpa` |
| `/tpaccept` | Accept teleport request | `teleport.enableTpa` |
| `/tpdeny` | Deny teleport request | `teleport.enableTpa` |
| `/rtp` | Random teleport | `teleport.enableRtp` |

### Admin Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/ban <ID/UID/XUID> [reason]` | Ban a player (and their IP) | Game Masters |
| `/unban <ID/UID/XUID>` | Unban a player | Game Masters |
| `/banlist` | View ban list | Game Masters |
| `/passwd` | Set or change web login password | Player / Console |
| `/backup` | Manually trigger world backup | Game Masters |
| `admin <add\|del> <uid>` | Manage web panel administrators | Console only |
| `ban <ID/UID/XUID> [reason]` | Ban a player via console | Console only |
| `unban <ID/UID/XUID>` | Unban a player via console | Console only |
| `banlist` | View ban list via console | Console only |
| `backup` | Manually trigger world backup | Console only |

## Web Admin Panel

NLCE includes a built-in web administration panel powered by Express.js, providing:

- **Authentication** — JWT-based login system with captcha verification
- **Player Management** — View online players, kick players, modify balances, change gamemode
- **Economy Management** — View total economy, balance rankings, currency settings
- **CDK Management** — Create, modify, and delete CDK codes
- **Allowlist Management** — Add, remove, and view allowlist entries
- **Mail Management** — Send global/individual mail, manage scheduled mail
- **Chat Monitoring** — View real-time and historical chat logs
- **Behavior Logs** — View player behavior logs with date filtering
- **System Monitoring** — CPU, memory, TPS, MSPT, and server statistics
- **Message Board** — View and manage community messages
- **Ban Management** — Ban/unban players, view ban list, support by ID/UID/XUID

## Installation

1. Ensure **LegacyScriptEngine-nodejs** is installed on your BDS server
2. Download the latest release and place the `NLCE` folder in your server's `plugins/` directory
3. Start the server — the plugin will auto-generate default configuration files
4. Configure `plugins/NLCE/config.json` to enable/disable features as needed

## Configuration

The main configuration file is located at `plugins/NLCE/config.json`. Key settings include:

| Setting | Default | Description |
|---------|---------|-------------|
| `currencyName` | `"星茜"` | Name of the in-game currency |
| `enableRank` | `true` | Enable leaderboard system |
| `enableShop` | `true` | Enable shop system |
| `enableCdk` | `true` | Enable CDK redemption |
| `enableRecycle` | `true` | Enable recycle system |
| `enableDustShop` | `true` | Enable stardust shop & XP shop |
| `enableWish` | `true` | Enable wish system |
| `enableBank` | `true` | Enable banking system |
| `enableVip` | `true` | Enable VIP system |
| `enableFriend` | `true` | Enable friend system |
| `enableMessageBoard` | `true` | Enable message board |
| `enableMail` | `true` | Enable mail system |
| `enableLevel` | `true` | Enable adventure level system |
| `enableBack` | `true` | Enable death point return |
| `teleport.enabled` | `true` | Enable teleport system |
| `teleport.enableHome` | `true` | Enable home system |
| `teleport.enableWarp` | `true` | Enable warp system |
| `teleport.enableTpa` | `true` | Enable tpa system |
| `teleport.enableRtp` | `true` | Enable random teleport |
| `teleport.homeLimit` | `10` | Max homes per player |
| `teleport.tpaCost` | `0` | Cost per tpa request |
| `teleport.rtpRange` | `5000` | RTP max range |
| `web.enabled` | `true` | Enable web admin panel |
| `web.enableFrontend` | `true` | Enable web frontend |
| `web.port` | `8080` | Web panel port |
| `web.host` | `"0.0.0.0"` | Web panel bind address |

## Project Structure

```
NLCE/
├── index.js              # Main plugin entry point
├── core/
│   ├── server.js          # Web server & REST API
│   ├── database.js        # SQLite database management
│   ├── systemMonitor.js   # System resource monitoring
│   ├── serverStats.js     # Server statistics (TPS/MSPT)
│   ├── behaviorLog.js     # Player behavior logging & query API
│   ├── chatLog.js         # Chat history logging
│   ├── adminLog.js        # Admin action audit log
│   ├── mail.js            # Mail system module
│   ├── messageBoard.js    # Message board module
│   ├── backup.js          # Auto backup system
│   ├── wish.js            # Wish system module
│   ├── friend.js          # Friend & message system module
│   ├── ban.js             # Ban system module
│   ├── teleport.js        # Teleport system module (home/warp/tpa/rtp)
│   ├── vip.js             # VIP system module
│   ├── cdk.js             # CDK redemption module
│   ├── rank.js            # Leaderboard module
│   ├── bank.js            # Bank system module
│   ├── pay.js             # Economy & payment module
│   ├── shop.js            # Shop & recycle module
│   ├── constants.js       # Constants definitions
│   └── utils.js           # Utility functions
├── data/
│   └── items.json         # Item data registry
├── WEB/                   # Web frontend assets
├── manifest.json          # LSE plugin manifest
├── package.json           # Node.js dependencies
└── LICENSE                # GPL-3.0 License
```

## Dependencies

### Runtime Dependencies
- [express](https://www.npmjs.com/package/express) — Web server framework
- [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) — JWT authentication
- [sql.js](https://www.npmjs.com/package/sql.js) — SQLite database (in-memory)
- [cors](https://www.npmjs.com/package/cors) — Cross-origin resource sharing
- [svg-captcha](https://www.npmjs.com/package/svg-captcha) — Captcha generation
- [csv-parser](https://www.npmjs.com/package/csv-parser) — CSV log parsing
- [systeminformation](https://www.npmjs.com/package/systeminformation) — System monitoring
- [7zip-min](https://www.npmjs.com/package/7zip-min) — 7zip compression for backups

### Frontend
- Web admin panel frontend modified from [shadcn-vue-admin](https://github.com/Whbbit1999/shadcn-vue-admin) by [@Whbbit1999](https://github.com/Whbbit1999)

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

Copyright (C) 2026 LCH0426

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License v3.0** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.en.html) for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

---

<div align="center">

**Made with ❤️ by LCH0426**

[⬆ Back to Top](#-nlce)

</div>
