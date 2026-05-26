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
 * NLCE 头像系统
 * 玩家头像数据管理、URL生成、头像设置GUI表单
 */

let _getPlayerData = null;
let _savePlayerData = null;
let _showPersonalCenterForm = null;

function init(deps) {
    _getPlayerData = deps.getPlayerData;
    _savePlayerData = deps.savePlayerData;
    _showPersonalCenterForm = deps.showPersonalCenterForm;
}

function getPlayerAvatarData(xuid) {
    let p = _getPlayerData().players[xuid];
    if (!p) return { type: "default", value: "" };
    if (!p.avatar) {
        p.avatar = {
            type: "default",
            value: ""
        };
        _savePlayerData();
    }
    return p.avatar;
}

function getPlayerAvatarUrl(xuid) {
    let avatar = getPlayerAvatarData(xuid);
    switch (avatar.type) {
        case "qq":
            return "http://q1.qlogo.cn/g?b=qq&nk=" + avatar.value + "&s=100";
        case "link":
            return avatar.value;
        case "citlalia":
            return "https://citlalia.cn/img/" + avatar.value;
        default:
            return "textures/ui/icon_steve";
    }
}

function setPlayerAvatar(xuid, type, value) {
    const p = _getPlayerData().players[xuid];
    if (!p) return;
    p.avatar = {
        type: type,
        value: value
    };
    _savePlayerData();
}

function showAvatarSettingsForm(player) {
    const xuid = player.xuid;
    const avatar = getPlayerAvatarData(xuid);

    const gui = mc.newCustomForm();
    gui.setTitle("§l§e个人头像设置");

    let content = "-------------------------\n";
    content += "§a当前头像类型：§f" + getAvatarTypeName(avatar.type) + "\n";
    content += "§a当前头像值：§f" + (avatar.value || "未设置") + "\n";
    content += "-------------------------\n";
    content += "§e请选择头像设置方式并输入对应值：\n";

    gui.addLabel(content);
    gui.addDropdown("头像类型", ["QQ头像", "自定义链接", "Citlalia头像码"],
        avatar.type === "qq" ? 0 : avatar.type === "link" ? 1 : avatar.type === "citlalia" ? 2 : 0);
    gui.addInput("头像值", "QQ号码/图片链接/头像码", avatar.value || "");

    player.sendForm(gui, function(p, data) {
        if (data === null || data === undefined || !Array.isArray(data)) {
            _showPersonalCenterForm(p);
            return;
        }

        let typeIndex = data[1] !== undefined ? data[1] : 0;
        const value = (data[2] || "").trim();

        if (!value) {
            p.tell("§c请输入头像值！");
            showAvatarSettingsForm(p);
            return;
        }

        let type, successMsg;
        if (typeIndex === 0) {
            if (!/^\d+$/.test(value)) {
                p.tell("§c请输入有效的QQ号码（纯数字）！");
                showAvatarSettingsForm(p);
                return;
            }
            type = "qq";
            successMsg = "§aQQ头像设置成功！";
        } else if (typeIndex === 1) {
            if (!value.startsWith("http")) {
                p.tell("§c请输入有效的图片链接（以http开头）！");
                showAvatarSettingsForm(p);
                return;
            }
            type = "link";
            successMsg = "§a自定义链接头像设置成功！";
        } else {
            type = "citlalia";
            successMsg = "§aCitlalia头像码设置成功！";
        }

        setPlayerAvatar(p.xuid, type, value);
        p.tell(successMsg);
        _showPersonalCenterForm(p);
    });
}

function getAvatarTypeName(type) {
    switch (type) {
        case "qq":
            return "QQ头像";
        case "link":
            return "自定义链接";
        case "citlalia":
            return "Citlalia头像码";
        default:
            return "默认头像";
    }
}

module.exports = {
    init: init,
    getPlayerAvatarData: getPlayerAvatarData,
    getPlayerAvatarUrl: getPlayerAvatarUrl,
    setPlayerAvatar: setPlayerAvatar,
    showAvatarSettingsForm: showAvatarSettingsForm,
    getAvatarTypeName: getAvatarTypeName
};
