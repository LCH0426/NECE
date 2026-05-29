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
 * NLCE 自定义菜单模块
 * 支持配置多级表单、页面导航、命令执行，右键钟表打开主菜单
 *
 * 配置格式（config.json 的 menuConfig 字段）：
 * {
 *   "main": {
 *     "title": "服务器菜单",
 *     "content": "欢迎！",
 *     "items": [
 *       { "name": "商店", "img": "textures/...", "from": "shop" },
 *       { "name": "回家", "comm": "home" },
 *       { "name": "管理传送", "opcomm": "tpa", "comm": "你没有权限" },
 *       { "name": "返回", "type": "back", "from": "main" },
 *       { "name": "关闭", "type": "close" }
 *     ]
 *   },
 *   "shop": { "title": "商店", "items": [...] }
 * }
 *
 * 每个 item 字段：
 *   name   - 按钮文字（支持 "星茜" 替换为货币名）
 *   img    - 按钮图标路径
 *   comm   - 点击执行的命令
 *   opcomm - OP执行的命令（非OP回退到comm）
 *   from   - 跳转到哪个菜单页面
 *   opfrom - OP跳转的菜单（非OP回退到from）
 *   type   - 特殊类型："back" 返回上一级, "close" 关闭
 */

let _deps = {};
let menuConfig = {};
let clockCooldown = {};

function init(deps) {
    _deps = deps;
}

/** 从配置加载菜单数据，替换货币名占位符 */
function loadConfig() {
    menuConfig = _deps.config.get("menu", {});
    const cn = _deps.getCurrencyName();
    var menus = menuConfig;
    for (var key in menus) {
        if (!menus.hasOwnProperty(key)) continue;
        var menu = menus[key];
        if (menu.title) menu.title = menu.title.replace(/星茜/g, cn);
        if (menu.content) menu.content = menu.content.replace(/星茜/g, cn);
        if (menu.items) {
            menu.items.forEach(function(item) {
                if (item.name) item.name = item.name.replace(/星茜/g, cn);
            });
        }
    }
}

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
    // 特殊类型
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

    // 页面跳转
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

    // 命令执行
    var cmd = item.comm || "";
    if (item.opcomm && isOp(player)) {
        cmd = item.opcomm;
    }
    if (cmd) {
        player.runcmd(cmd);
    }
}

/**
 * 显示主菜单
 * @param {Player} player
 */
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

module.exports = {
    init: init,
    loadConfig: loadConfig,
    showMainMenu: showMainMenu,
    showMenu: showMenu,
    registerClockListener: registerClockListener
};
