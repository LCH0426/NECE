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
 * NLCE 常量定义与路径配置
 * 集中管理所有文件路径、默认设置、枚举值等全局常量
 */


/** 所有数据文件路径配置（JSON 数据、日志目录、配置文件等） */
const PATHS = {
    CONFIG: "plugins/NLCE/config.json",
    PLAYER_DATA: "plugins/NLCE/data/playerdata.json",
    PLAYER_SETTINGS: "plugins/NLCE/data/PlayerSettings.json",
    SHOP_DATA: "plugins/NLCE/data/shopdata.json",
    CDK_DATA: "plugins/NLCE/data/cdkdata.json",
    RECYCLE_DATA: "plugins/NLCE/data/Recycleitems.json",
    RECYCLE_LOG_DIR: "plugins/NLCE/logs/rc",
    MESSAGEBOARD_DATA: "plugins/NLCE/data/MessageBoardData.json",
    WISH_DATA: "plugins/NLCE/data/WishData.json",
    WISH_CONFIG: "plugins/NLCE/data/WishConfig.json",
    ENCHANT_BOOK_SHOP: "plugins/NLCE/data/EnchantBookShop.json",
    SPAWN_EGG_SHOP: "plugins/NLCE/data/SpawnEggShop.json",
    WISH_HISTORY_LOG_DIR: "plugins/NLCE/logs/wish",
    DEATH_POINT_DATA: "plugins/NLCE/data/DeathPointData.json",
    FRIEND_DATA: "plugins/NLCE/data/FriendData.json",
    MESSAGE_DATA: "plugins/NLCE/data/MessageData.json",
    MAIL_DATA: "plugins/NLCE/data/MailData.json",
    QUICK_MENU_CONFIG: "plugins/NLCE/data/QuickMenuConfig.json",
    NAR_CONFIG: "plugins/NLCE/data/NARConfig.json",
    ITEMS_DATA: "plugins/NLCE/data/items.json",
    TPS_DATA: "plugins/NLCE/data/tps.json",
    HOMES_DATA: "plugins/NLCE/data/homes.json",
    WARPS_DATA: "plugins/NLCE/data/warps.json",
    CHAT_CFG: "./plugins/NLCE/data/ChatConfig.json",
    BAD_WORDS: "./plugins/NLCE/data/fuckbad.json",
    BAN_DATA: "plugins/NLCE/data/BanData.json",
    DEBUG_DISMISSED: "plugins/NLCE/data/debug_dismissed.json"
};

/** IPv4 用户进服时的 IPv6 提示消息 */
const IPV4_MESSAGE = "§a本服务器已接入IPv6网络，访问 §rhttps://citlalia.cn/v6 §a来了解如何启用";
/** IPv6 用户进服时的确认消息 */
const IPV6_MESSAGE = "§a您正在使用IPv6网络访问本服务器";

/** 玩家可选的心情状态 */
const MOOD_OPTIONS = ['开心', '难过', '平静', '兴奋', '生气'];

/** Minecraft 生物群系英文 ID 到中文名称的映射 */
const BIOME_NAMES = {
    "ocean": "海洋",
    "plains": "平原",
    "desert": "沙漠",
    "extreme_hills": "风袭丘陵",
    "forest": "森林",
    "taiga": "针叶林",
    "swampland": "沼泽",
    "river": "河流",
    "hell": "下界荒地",
    "the_end": "末地",
    "legacy_frozen_ocean": "冻洋（旧版）",
    "frozen_river": "冻河",
    "ice_plains": "雪原",
    "ice_mountains": "雪山",
    "mushroom_island": "蘑菇岛",
    "mushroom_island_shore": "蘑菇岛岸",
    "beach": "沙滩",
    "desert_hills": "沙漠丘陵",
    "forest_hills": "繁茂的丘陵",
    "taiga_hills": "针叶林丘陵",
    "extreme_hills_edge": "山地边缘",
    "jungle": "丛林",
    "jungle_hills": "丛林丘陵",
    "jungle_edge": "稀疏丛林",
    "deep_ocean": "深海",
    "stone_beach": "石岸",
    "cold_beach": "积雪沙滩",
    "birch_forest": "桦木森林",
    "birch_forest_hills": "桦木森林丘陵",
    "roofed_forest": "黑森林",
    "cold_taiga": "积雪针叶林",
    "cold_taiga_hills": "积雪的针叶林丘陵",
    "mega_taiga": "原始松木针叶林",
    "mega_taiga_hills": "巨型针叶林丘陵",
    "extreme_hills_plus_trees": "风袭森林",
    "savanna": "热带草原",
    "savanna_plateau": "热带高原",
    "mesa": "恶地",
    "mesa_plateau_stone": "繁茂的恶地高原",
    "mesa_plateau": "恶地高原",
    "warm_ocean": "暖水海洋",
    "deep_warm_ocean": "暖水深海",
    "lukewarm_ocean": "温水海洋",
    "deep_lukewarm_ocean": "温水深海",
    "cold_ocean": "冷水海洋",
    "deep_cold_ocean": "冷水深海",
    "frozen_ocean": "冻洋",
    "deep_frozen_ocean": "冰冻深海",
    "bamboo_jungle": "竹林",
    "bamboo_jungle_hills": "竹林丘陵",
    "sunflower_plains": "向日葵平原",
    "desert_mutated": "沙漠湖泊",
    "extreme_hills_mutated": "风袭沙砾丘陵",
    "flower_forest": "繁花森林",
    "taiga_mutated": "针叶林山地",
    "swampland_mutated": "沼泽丘陵",
    "ice_plains_spikes": "冰刺之地",
    "jungle_mutated": "丛林变种",
    "jungle_edge_mutated": "丛林边缘变种",
    "birch_forest_mutated": "原始桦木森林",
    "birch_forest_hills_mutated": "高大桦木丘陵",
    "roofed_forest_mutated": "黑森林丘陵",
    "cold_taiga_mutated": "积雪的针叶林山地",
    "redwood_taiga_mutated": "原始云杉针叶林",
    "redwood_taiga_hills_mutated": "巨型云杉针叶林丘陵",
    "extreme_hills_plus_trees_mutated": "沙砾山地+",
    "savanna_mutated": "风袭热带草原",
    "savanna_plateau_mutated": "破碎的热带高原",
    "mesa_bryce": "风蚀恶地",
    "mesa_plateau_stone_mutated": "繁茂的恶地高原变种",
    "mesa_plateau_mutated": "恶地高原变种",
    "soulsand_valley": "灵魂沙峡谷",
    "crimson_forest": "绯红森林",
    "warped_forest": "诡异森林",
    "basalt_deltas": "玄武岩三角洲",
    "jagged_peaks": "尖峭山峰",
    "frozen_peaks": "冰封山峰",
    "snowy_slopes": "积雪山坡",
    "grove": "雪林",
    "meadow": "草甸",
    "lush_caves": "繁茂洞穴",
    "dripstone_caves": "溶洞",
    "stony_peaks": "裸岩山峰",
    "deep_dark": "深暗之域",
    "mangrove_swamp": "红树林沼泽",
    "cherry_grove": "樱花树林",
    "pale_garden": "苍白之园"
};

/** actionbar 侧边栏各显示项对应的玩家设置 key */
const SIDEBAR_SETTING_KEYS = [
    'enableActionbarPing', 'enableActionbarMoney', 'enableActionbarTime',
    'enableActionbarTps', 'enableActionbarSpeed', 'enableActionbarBiome'
];

/** 侧边栏信息缓存有效期（毫秒），避免每帧重新计算 */
const SIDEBAR_CACHE_TTL = 5000;
/** 余额缓存有效期（毫秒），余额变化频率低可适当延长 */
const SIDEBAR_MONEY_CACHE_TTL = 3000;

/** 击杀特效附带的药水效果参数 */
const KillEffectConfig = {
    RESISTANCE: {
        id: 11,
        baseDuration: 80,
        level: 4
    },
    FIRE_RESISTANCE: {
        id: 12,
        duration: 80
    }
};

/** 玩家设置的默认值，新玩家注册时以此为初始配置 */
const DEFAULT_PLAYER_SETTINGS = {
    enableWelcome: true,
    enableActionbar: true,
    enableIpDetector: true,
    enableActionbarPing: true,
    enableActionbarMoney: true,
    enableActionbarTime: false,
    enableActionbarTps: true,
    enableActionbarSpeed: false,
    enableActionbarBiome: false,
    enableBankNotice: true,
    enableTotemReplace: true,
    enableDeathTeleportPopup: true,
    enableGiveClock: true,
    enableGiveCompass: true,
    allowFriendRequests: true,
    acceptStrangerMessages: true,
    enableMessageNotification: true,
    enableFriendRequestNotification: true,
    enableMailNotification: true,
    enableTpaRejectMode: false
};

/** 设置界面表单描述：type=label 为分组标题，type 未指定为可切换的布尔设置项 */
const PLAYER_SETTINGS_SCHEMA = [
    { type: 'label', text: '§b进服提醒' },
    { key: 'enableWelcome', label: '§e入服欢迎' },
    { key: 'enableActionbar', label: '§e右下角显示UID' },
    { key: 'enableIpDetector', label: '§e进服显示网络协议信息' },
    { type: 'label', text: '§b侧边栏显示' },
    { key: 'enableActionbarMoney', label: '§e侧边栏显示§e余额' },
    { key: 'enableActionbarPing', label: '§e侧边栏显示延迟' },
    { key: 'enableActionbarTps', label: '§e侧边栏显示TPS' },
    { key: 'enableActionbarSpeed', label: '§e侧边栏显示移动速度' },
    { key: 'enableActionbarBiome', label: '§e侧边栏显示群系' },
    { key: 'enableActionbarTime', label: '§e侧边栏显示时间' },
    { type: 'label', text: '§b入服物品' },
    { key: 'enableGiveClock', label: '§e入服给钟（菜单）' },
    { key: 'enableGiveCompass', label: '§e入服给指南针（快捷菜单）' },
    { type: 'label', text: '§b杂项' },
    { key: 'enableBankNotice', label: '§e定期存款到期通知' },
    { key: 'enableTotemReplace', label: '§e不死图腾自动替换' },
    { key: 'enableDeathTeleportPopup', label: '§e死亡后传送弹窗' },
    { type: 'label', text: '§b好友与消息设置' },
    { key: 'allowFriendRequests', label: '§e允许添加我为好友' },
    { key: 'acceptStrangerMessages', label: '§e接受陌生人私信' },
    { key: 'enableMessageNotification', label: '§e新私信提醒' },
    { key: 'enableFriendRequestNotification', label: '§e好友请求提醒' },
    { key: 'enableMailNotification', label: '§e新邮件提醒' },
    { type: 'label', text: '§b传送设置' },
    { key: 'enableTpaRejectMode', label: '§c拒绝所有传送请求' }
];

/** 附魔书商店默认配置：附魔ID -> { 中文名, 最大等级, 每级花费 } */
const DEFAULT_ENCHANT_BOOK_CONFIG = {
    enchantments: {
        "0": { name: "保护", max_lv: 4, cost_per_level: 100 },
        "1": { name: "火焰保护", max_lv: 4, cost_per_level: 150 },
        "2": { name: "摔落缓冲", max_lv: 4, cost_per_level: 100 },
        "3": { name: "爆炸保护", max_lv: 4, cost_per_level: 150 },
        "4": { name: "弹射物保护", max_lv: 4, cost_per_level: 150 },
        "5": { name: "荆棘", max_lv: 3, cost_per_level: 200 },
        "6": { name: "水下呼吸", max_lv: 3, cost_per_level: 200 },
        "7": { name: "深海探索者", max_lv: 3, cost_per_level: 200 },
        "8": { name: "水下速掘", max_lv: 3, cost_per_level: 200 },
        "9": { name: "锋利", max_lv: 5, cost_per_level: 250 },
        "10": { name: "亡灵杀手", max_lv: 5, cost_per_level: 300 },
        "11": { name: "节肢杀手", max_lv: 5, cost_per_level: 250 },
        "12": { name: "击退", max_lv: 2, cost_per_level: 150 },
        "13": { name: "火焰附加", max_lv: 2, cost_per_level: 200 },
        "14": { name: "抢夺", max_lv: 3, cost_per_level: 200 },
        "15": { name: "效率", max_lv: 5, cost_per_level: 200 },
        "16": { name: "精准采集", max_lv: 1, cost_per_level: 500 },
        "17": { name: "耐久", max_lv: 3, cost_per_level: 150 },
        "18": { name: "时运", max_lv: 3, cost_per_level: 300 },
        "19": { name: "力量", max_lv: 5, cost_per_level: 250 },
        "20": { name: "冲击", max_lv: 2, cost_per_level: 200 },
        "21": { name: "火矢", max_lv: 1, cost_per_level: 400 },
        "22": { name: "无限", max_lv: 1, cost_per_level: 1000 },
        "23": { name: "海之眷顾", max_lv: 3, cost_per_level: 300 },
        "24": { name: "饵钓", max_lv: 3, cost_per_level: 200 },
        "25": { name: "冰霜行者", max_lv: 2, cost_per_level: 400 },
        "26": { name: "经验修补", max_lv: 1, cost_per_level: 800 },
        "27": { name: "绑定诅咒", max_lv: 1, cost_per_level: 800 },
        "28": { name: "消失诅咒", max_lv: 1, cost_per_level: 800 },
        "29": { name: "穿刺", max_lv: 5, cost_per_level: 250 },
        "30": { name: "激流", max_lv: 3, cost_per_level: 200 },
        "31": { name: "忠诚", max_lv: 3, cost_per_level: 200 },
        "32": { name: "引雷", max_lv: 1, cost_per_level: 1000 },
        "33": { name: "多重射击", max_lv: 3, cost_per_level: 300 },
        "34": { name: "穿透", max_lv: 4, cost_per_level: 200 },
        "35": { name: "快速装填", max_lv: 3, cost_per_level: 200 },
        "36": { name: "灵魂疾行", max_lv: 3, cost_per_level: 300 },
        "37": { name: "迅捷潜行", max_lv: 3, cost_per_level: 200 },
        "38": { name: "风爆", max_lv: 3, cost_per_level: 300 },
        "39": { name: "致密", max_lv: 3, cost_per_level: 300 },
        "40": { name: "破甲", max_lv: 3, cost_per_level: 300 },
        "41": { name: "突进", max_lv: 3, cost_per_level: 300 }
    }
};

/** 每级升级所需经验值阶梯，索引为等级（从第1级开始） */
const LEVEL_EXP_STEPS = [
    375, 500, 625, 725, 850, 950, 1075, 1200, 1300, 1425,
    1525, 1650, 1775, 1875, 2000, 2375, 2500, 2625, 2775, 2825,
    3425, 3725, 4000, 4300, 4575, 4875, 5150, 5450, 5725, 6025,
    6300, 6600, 6900, 7175, 7475, 7750, 8050, 9050, 10550, 11525,
    12450, 13450, 14400, 15350, 16325, 17275, 18250, 19200, 26400, 28800,
    31200, 33600, 36000, 232350, 258950, 285750, 312825, 340125
];

module.exports = {
    PATHS,
    IPV4_MESSAGE,
    IPV6_MESSAGE,
    MOOD_OPTIONS,
    BIOME_NAMES,
    SIDEBAR_SETTING_KEYS,
    SIDEBAR_CACHE_TTL,
    SIDEBAR_MONEY_CACHE_TTL,
    KillEffectConfig,
    DEFAULT_PLAYER_SETTINGS,
    PLAYER_SETTINGS_SCHEMA,
    DEFAULT_ENCHANT_BOOK_CONFIG,
    LEVEL_EXP_STEPS
};
