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
 * NLCE 快捷菜单系统
 * 快捷菜单配置、GUI表单、指南针监听、qcd/qmenu命令
 */

let _deps = {};
let quickMenuConfig = { items: [] };

function init(deps) {
    _deps = deps;
}

function loadConfig() {
    quickMenuConfig = _deps.quickMenuConfigDM.load();
    const cn = _deps.getCurrencyName();
    (quickMenuConfig.items || []).forEach(function(btn) {
        if (btn.name) btn.name = btn.name.replace(/星茜/g, cn);
    });
}

function getPlayerQuickMenu(xuid) {
    let p = _deps.getPlayerData().players[xuid];
    if (!p) return { slots: [] };
    if (!p.quickmenu) {
        p.quickmenu = { slots: [] };
    }
    return p.quickmenu;
}

function setPlayerQuickMenu(xuid, slots) {
    const p = _deps.getPlayerData().players[xuid];
    if (!p) return;
    if (!p.quickmenu) {
        p.quickmenu = { slots: [] };
    }
    p.quickmenu.slots = slots;
    _deps.savePlayerData();
}

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
        p.tell("§a快捷菜单已更新！共设置 " + newSlots.length + " 个快捷入口");
        showQuickMenu(p);
    });
}

function registerCommands(registerPlayerCommand) {
    registerPlayerCommand("qcd", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
    registerPlayerCommand("qmenu", "§a打开快捷菜单", function(pl) { showQuickMenu(pl); });
}

function registerCompassListener() {
    const quickMenuCooldown = {};

    mc.listen("onUseItemOn", function(player, item) {
        if (item && item.type === "minecraft:compass") {
            const xuid = player.xuid;
            const now = Date.now();
            const lastUse = quickMenuCooldown[xuid] || 0;

            if (now - lastUse < 1000) {
                return false;
            }

            quickMenuCooldown[xuid] = now;
            showQuickMenu(player);
            return false;
        }
    });

    mc.listen("onLeft", function(player) {
        delete quickMenuCooldown[player.xuid];
    });
}

module.exports = {
    init: init,
    loadConfig: loadConfig,
    showQuickMenu: showQuickMenu,
    registerCommands: registerCommands,
    registerCompassListener: registerCompassListener
};
