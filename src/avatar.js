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
 * NECE 头像系统模块
 * 支持三种头像来源：QQ头像（通过QQ号）、自定义图片链接、Citlalia图床
 * 头像数据存储在 playerData.avatar 中 { type: "default"|"qq"|"link"|"citlalia", value: string }
 */

let _getPlayerData = null;
let _savePlayerData = null;
let _showPersonalCenterForm = null;  // 返回个人中心的回调，由 personalCenter 模块注入

/**
 * 初始化头像模块
 * @param {object} deps - 依赖对象（getPlayerData, savePlayerData, showPersonalCenterForm）
 */
function init(deps) {
	_getPlayerData = deps.getPlayerData;
	_savePlayerData = deps.savePlayerData;
	_showPersonalCenterForm = deps.showPersonalCenterForm;
}

/**
 * 获取玩家头像数据，首次访问时自动初始化为默认头像
 * @param {string} xuid - 玩家XUID
 * @returns {{ type: string, value: string }} 头像数据对象
 */
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

/**
 * 根据头像类型生成完整的图片URL
 * @param {string} xuid - 玩家XUID
 * @returns {string} 头像URL或内置纹理路径
 */
function getPlayerAvatarUrl(xuid) {
	let avatar = getPlayerAvatarData(xuid);
	switch (avatar.type) {
		case "qq":
			// QQ头像API，s=100表示100px尺寸
			return "http://q1.qlogo.cn/g?b=qq&nk=" + avatar.value + "&s=100";
		case "link":
			return avatar.value;
		case "citlalia":
			return "https://citlalia.cn/img/" + avatar.value;
		default:
			// 默认使用Steve皮肤图标
			return "textures/ui/icon_steve";
	}
}

/**
 * 设置玩家头像类型和值
 * @param {string} xuid - 玩家XUID
 * @param {string} type - 头像类型（qq/link/citlalia）
 * @param {string} value - 头像值（QQ号/URL/图床ID）
 */
function setPlayerAvatar(xuid, type, value) {
	const p = _getPlayerData().players[xuid];
	if (!p) return;
	p.avatar = {
		type: type,
		value: value
	};
	_savePlayerData();
}

/**
 * 显示头像设置自定义表单，包含类型选择下拉框和值输入框
 * @param {Player} player - 玩家
 */
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
	// 下拉框默认选中项根据当前头像类型决定
	gui.addDropdown("头像类型", ["QQ头像", "自定义链接", "Citlalia头像码"],
		avatar.type === "qq" ? 0 : avatar.type === "link" ? 1 : avatar.type === "citlalia" ? 2 : 0);
	gui.addInput("头像值", "QQ号码/图片链接/头像码", avatar.value || "");

	player.sendForm(gui, function(p, data) {
		if (data == null || data === undefined || !Array.isArray(data)) {
			_showPersonalCenterForm(p);
			return;
		}

		let typeIndex = data[1] !== undefined ? data[1] : 0;
		const value = (data[2] || "").trim();

		if (!value) {
			p.tell("§e[头像] §c请输入头像值！");
			showAvatarSettingsForm(p);
			return;
		}

		let type, successMsg;
		if (typeIndex === 0) {
			// QQ头像：校验输入必须为纯数字
			if (!/^\d+$/.test(value)) {
				p.tell("§e[头像] §c请输入有效的QQ号码（纯数字）！");
				showAvatarSettingsForm(p);
				return;
			}
			type = "qq";
			successMsg = "§e[头像] §aQQ头像设置成功！";
		} else if (typeIndex === 1) {
			// 自定义链接：校验必须以http开头
			if (!value.startsWith("http")) {
				p.tell("§e[头像] §c请输入有效的图片链接（以http开头）！");
				showAvatarSettingsForm(p);
				return;
			}
			type = "link";
			successMsg = "§e[头像] §a自定义链接头像设置成功！";
		} else {
			type = "citlalia";
			successMsg = "§aCitlalia头像码设置成功！";
		}

		setPlayerAvatar(p.xuid, type, value);
		p.tell(successMsg);
		_showPersonalCenterForm(p);
	});
}

/**
 * 将头像类型标识符转换为中文显示名称
 * @param {string} type - 头像类型标识
 * @returns {string} 中文名称
 */
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
