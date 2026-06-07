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
 * NECE 菜单系统（合并自 menu + quickMenu）
 * - 主菜单：右键钟表打开，支持多级页面导航
 * - 快捷菜单：右键指南针打开，每个玩家可自定义最多5个快捷入口
 *
 * 主菜单配置（config.json 的 menu 节）：
 *   { "main": { "title", "content", "items": [{ name, img, comm, opcomm, from, opfrom, type }] } }
 *
 * 快捷菜单配置（config.json 的 quickMenu 节）：
 *   { "items": [{ name, img, comm }] }
 *   玩家选择存储在 playerData.players[xuid].quickmenu.slots
 */

let _deps = {};
let menuConfig = {};
let quickMenuConfig = { items: [] };
let clockCooldown = {};
let compassCooldown = {};

function init(deps) {
    _deps = deps;
}

/** 从配置加载菜单数据，替换货币名占位符 */
function loadConfig() {
    // 主菜单
    menuConfig = _deps.config.get("menu", {});
    const cn = _deps.getCurrencyName();
    for (var key in menuConfig) {
        if (!menuConfig.hasOwnProperty(key)) continue;
        var menu = menuConfig[key];
        if (menu.title) menu.title = menu.title.replace(/星茜/g, cn);
        if (menu.content) menu.content = menu.content.replace(/星茜/g, cn);
        if (menu.items) {
            menu.items.forEach(function(item) {
                if (item.name) item.name = item.name.replace(/星茜/g, cn);
            });
        }
    }
    // 快捷菜单
    quickMenuConfig = _deps.config.get("quickMenu", { items: [] });
    (quickMenuConfig.items || []).forEach(function(btn) {
        if (btn.name) btn.name = btn.name.replace(/星茜/g, cn);
    });
}

// ============ 主菜单（钟表触发） ============

/** 判断玩家是否有OP权限 */
function isOp(player) {
    try { return player.isOP(); } catch (e) { return false; }
}

/**
 * 显示指定菜单页面
 * @param {Player} player
 * @param {string} menuId - 菜单ID
 * @param {string[]} history - 导航历史栈
 */
function showMenu(player, menuId, history) {
    var menu = menuConfig[menuId];
    if (!menu) {
        player.tell("§e[菜单] §c菜单不存在: " + menuId);
        return;
    }

    if (!history) history = [];

    var fm = mc.newSimpleForm();
    fm.setTitle(menu.title || menuId);
    if (menu.content) fm.setContent(menu.content);

    var items = menu.items || [];
    items.forEach(function(item) {
        fm.addButton(item.name || "???", item.img || "");
    });

    player.sendForm(fm, function(p, id) {
        if (id === null || id === undefined) return;
        if (id < 0 || id >= items.length) return;

        var item = items[id];
        handleItemClick(p, item, menuId, history);
    });
}

/**
 * 处理按钮点击
 * 优先级：type > opfrom/from > opcomm/comm
 */
function handleItemClick(player, item, currentMenuId, history) {
    if (item.type === "back") {
        if (history.length > 0) {
            var prev = history.pop();
            showMenu(player, prev, history);
        } else if (item.from) {
            showMenu(player, item.from, []);
        }
        return;
    }
    if (item.type === "close") {
        return;
    }

    var target = item.from;
    if (item.opfrom && isOp(player)) {
        target = item.opfrom;
    }
    if (target) {
        var newHistory = history.slice();
        newHistory.push(currentMenuId);
        showMenu(player, target, newHistory);
        return;
    }

    var cmd = item.comm || "";
    if (item.opcomm && isOp(player)) {
        cmd = item.opcomm;
    }
    if (cmd) {
        player.runcmd(cmd);
    }
}

/** 显示主菜单 */
function showMainMenu(player) {
    showMenu(player, "main", []);
}

/** 注册右键钟表监听 */
function registerClockListener() {
    mc.listen("onUseItem", function(player, item) {
        if (!item || item.type !== "minecraft:clock") return;
        if (!_deps.config.get("menu.enabled", false)) return;

        var xuid = player.xuid;
        var now = Date.now();
        if (now - (clockCooldown[xuid] || 0) < 1000) return false;
        clockCooldown[xuid] = now;

        showMainMenu(player);
        return false;
    });

    mc.listen("onLeft", function(player) {
        delete clockCooldown[player.xuid];
    });
}

// ============ 快捷菜单（指南针触发） ============

/**
 * 获取玩家的快捷菜单配置，首次访问时自动初始化为空槽位
 * @param {string} xuid - 玩家XUID
 * @returns {{ slots: number[] }}
 */
function getPlayerQuickMenu(xuid) {
    let p = _deps.getPlayerData().players[xuid];
    if (!p) return { slots: [] };
    if (!p.quickmenu) {
        p.quickmenu = { slots: [] };
    }
    return p.quickmenu;
}

/**
 * 更新玩家的快捷菜单槽位并保存
 * @param {string} xuid - 玩家XUID
 * @param {number[]} slots - 新的槽位索引数组
 */
function setPlayerQuickMenu(xuid, slots) {
    const p = _deps.getPlayerData().players[xuid];
    if (!p) return;
    if (!p.quickmenu) {
        p.quickmenu = { slots: [] };
    }
    p.quickmenu.slots = slots;
    _deps.savePlayerData();
}

/** 显示快捷菜单表单 */
function showQuickMenu(player) {
    let xuid = player.xuid;
    let playerMenu = getPlayerQuickMenu(xuid);
    let gui = mc.newSimpleForm();
    gui.setTitle("§l§a快捷菜单");

    if (!playerMenu.slots || playerMenu.slots.length === 0) {
        gui.setContent("§e您还没有设置快捷菜单\n§a请点击下方按钮进行设置");
    } else {
        gui.setContent("§a点击按钮快速执行命令");
        playerMenu.slots.forEach(function(slotIndex) {
            let item = quickMenuConfig.items[slotIndex];
            if (item) {
                gui.addButton(item.name, item.img);
            }
        });
    }

    gui.addButton("§e§l修改快捷菜单", "textures/ui/icon_setting");

    player.sendForm(gui, function(p, id) {
        if (id === null || id === undefined) return;

        const slots = playerMenu.slots || [];
        if (id < slots.length) {
            const slotIndex = slots[id];
            const item = quickMenuConfig.items[slotIndex];
            if (item) {
                p.runcmd(item.comm);
            }
        } else {
            showEditQuickMenu(p);
        }
    });
}

/** 显示编辑快捷菜单的自定义表单 */
function showEditQuickMenu(player) {
    let xuid = player.xuid;
    const playerMenu = getPlayerQuickMenu(xuid);
    const currentSlots = playerMenu.slots || [];

    const gui = mc.newCustomForm();
    gui.setTitle("§l§e编辑快捷菜单");
    gui.addLabel("§a请选择最多5个快捷功能（重复选择会忽略）：");

    const options = quickMenuConfig.items.map(function(item) { return item.name; });
    options.unshift("§c不选择");

    for (let i = 0; i < 5; i++) {
        const defaultIndex = currentSlots[i] !== undefined ? currentSlots[i] + 1 : 0;
        gui.addDropdown("快捷入口 " + (i + 1), options, Math.min(defaultIndex, options.length - 1));
    }

    gui.addLabel("§e提示：选择后会覆盖之前的设置");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined) {
            showQuickMenu(p);
            return;
        }

        const newSlots = [];
        const selectedSet = {};

        for (let i = 1; i <= 5; i++) {
            const selectedIndex = data[i];
            if (selectedIndex > 0 && !selectedSet[selectedIndex]) {
                selectedSet[selectedIndex] = true;
                newSlots.push(selectedIndex - 1);
            }
        }

        setPlayerQuickMenu(p.xuid, newSlots);
        p.tell("§e[菜单] §a快捷菜单已更新！共设置 " + newSlots.length + " 个快捷入口");
        showQuickMenu(p);
    });
}

/** 注册 qcd/qmenu 命令 */
function registerCommands(registerPlayerCommand) {
    registerPlayerCommand("qcd", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
    registerPlayerCommand("qmenu", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
}

/** 注册指南针右键监听 */
function registerCompassListener() {
    mc.listen("onUseItemOn", function(player, item) {
        if (item && item.type === "minecraft:compass") {
            const xuid = player.xuid;
            const now = Date.now();
            if (now - (compassCooldown[xuid] || 0) < 1000) {
                return false;
            }
            compassCooldown[xuid] = now;
            showQuickMenu(player);
            return false;
        }
    });

    mc.listen("onLeft", function(player) {
        delete compassCooldown[player.xuid];
    });
}

module.exports = {
    init: init,
    loadConfig: loadConfig,
    showMainMenu: showMainMenu,
    showMenu: showMenu,
    showQuickMenu: showQuickMenu,
    registerClockListener: registerClockListener,
    registerCommands: registerCommands,
    registerCompassListener: registerCompassListener
};
