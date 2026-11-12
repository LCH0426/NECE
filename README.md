<div align="center">

# NECE (Robin)

NECE is a multi-purpose Minecraft Bedrock Dedicated Server plugin built on LegacyScriptEngine (LSE) Node.js. It provides economy, social, teleport, gameplay and server-management features, ships with an Express.js web admin panel, and exports APIs that other LSE plugins can call via `ll.import`.

**Version 1.1.0**

</div>

## Commands

### Player commands

| Command | Description | Config switch |
| --- | --- | --- |
| `/menu`, `/cd` | Open the main menu | — |
| `/qcd`, `/qmenu` | Open the quick menu | — |
| `/shop` | Shop system | `shop.enabled` |
| `/recycle`, `/rc` | Recycle items | `shop.enableRecycle` |
| `/xpshop` | XP shop | `shop.enableXpShop` |
| `/rank` | Leaderboards | `rank.enabled` |
| `/cdk` | Redeem a CDK | `cdk.enabled` |
| `/pay` | Transfer money | — |
| `/ec` | Economy panel | — |
| `/sign` | Daily check-in | — |
| `/bank` | Bank system | `bank.enabled` |
| `/vip` | VIP menu | `vip.enabled` |
| `/level` | Level rewards | `level.enabled` |
| `/titles` | Title system | — |
| `/settings` | Personal settings | — |
| `/mail` | Mail system | `mail.enabled` |
| `/friend` | Friends system | `friend.enabled` |
| `/mb` | Message board | `messageBoard.enabled` |
| `/network` | Network info | — |
| `/back` | Return to your death point | `back.enabled` |
| `/org` | Guild system | `guild.enabled` |
| `/wish` | Wish system | — |
| `/block [a\|b]` | Chain mining / quick build menu | — |
| `/bp` | Block plan menu | — |
| `/tpg` | Teleport menu | `teleport.enabled` |
| `/home` | Homes | `teleport.enableHome` |
| `/warp` | Public warps | `teleport.enableWarp` |
| `/tpa` | Request a teleport | `teleport.enableTpa` |
| `/tpy` | Accept a teleport request | `teleport.enableTpa` |
| `/tpn` | Deny a teleport request | `teleport.enableTpa` |
| `/rtp` | Random teleport | `teleport.enabled` |
| `/passwd` | Set or change your web password | — |

### Admin commands

| Command | Description | Permission |
| --- | --- | --- |
| `/pban <ID/UID/XUID> [reason]` | Ban a player and their IP | Game masters |
| `/punban <ID/UID/XUID>` | Unban a player | Game masters |
| `/pbanlist` | List banned players | Game masters |
| `/passwd [uid password]` | Set a web password from the console | Console |
| `/backup` | Run a world backup manually | Game masters |
| `/freeze [reason]` | Toggle maintenance mode (kicks everyone, blocks joins) | Console only |
| `/admin <add\|del> <uid\|name>` | Manage web admins | Console only |
| `pban` / `punban` / `pbanlist` | Ban management from the console | Console only |
| `backup` | Run a world backup manually | Console only |
| `debug` | Toggle debug mode | Console only |

## Web Admin Panel

NECE includes a JWT-authenticated Express.js admin panel:

- **Access** — CAPTCHA login and allowlist management
- **Players** — online list, kick, balance changes, game mode, inventory snapshots, titles
- **Economy** — total currency, balance and playtime rankings, CDK management
- **Content** — mail, chat logs, behavior logs, message board
- **Moderation** — ban/unban by ID/UID/XUID, maintenance mode
- **Server** — CPU/memory/TPS/MSPT stats, player-count history, backups, map art, playtime heatmap
- **Guilds** — create/disband, members, teleports, funds

## Acknowledgements

Parts of this project were inspired by these open-source projects:

| Module | Project | Author | License | Notes |
| --- | --- | --- | --- | --- |
| Shop system | [PShop](https://gitee.com/SCFY233/PShop/) | [SCFY](https://www.minebbs.com/members/scfy.32484/) | GPL-3.0 | Shop UI flow and configuration design |
| Behavior log | [LLSE-BehaviorLog](https://github.com/YQ-LL-Plugins/LLSE-BehaviorLog) | [YQ-LL-Plugins](https://github.com/YQ-LL-Plugins) | None | Logging concept and CSV format |

## License

Copyright (C) 2026 LCH0426

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License v3.0** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.en.html) for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
