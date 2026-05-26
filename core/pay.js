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

const fs = require('fs');
const U = require('./utils');

var pendingTransfersPath = "plugins/NLCE/data/pendingTransfers.json";
var pendingTransfers = {};

function load() {
	try {
		if (fs.existsSync(pendingTransfersPath)) {
			pendingTransfers = JSON.parse(fs.readFileSync(pendingTransfersPath, 'utf-8'));
		} else {
			pendingTransfers = {};
		}
	} catch (e) {
		pendingTransfers = {};
	}
}

function save() {
	try {
		fs.writeFileSync(pendingTransfersPath, JSON.stringify(pendingTransfers, null, '\t'), 'utf-8');
	} catch (e) {
		logger.error("保存待领取转账失败: " + e.message);
	}
}

function writeTransferLog(senderName, targetName, amount, senderBalance, targetBalance) {
	try {
		var logDir = "plugins/NLCE/logs";
		var logPath = logDir + "/shop.log";
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}
		var timeStr = new Date().toLocaleString();
		var entry = timeStr + " | " + senderName + "向" + targetName + "转账" + amount + " 余额" + senderBalance + " 对方余额" + targetBalance + "\n";
		fs.appendFile(logPath, entry, 'utf-8', function(e) {
			if (e) logger.error("写入转账日志失败: " + e.message);
		});
	} catch (e) {
		logger.error("写入转账日志失败: " + e.message);
	}
}

function showMoneyMainForm(player, deps) {
	var fm = mc.newSimpleForm();
	fm.setTitle("经济系统");
	var balance = deps.getPlayerMoney(player);
	fm.setContent("当前余额: " + balance + " " + deps.getCurrencyName());
	fm.addButton("转账", "textures/ui/icon_recipe_equipment");
	fm.addButton("关闭", "textures/ui/cancel");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === 1) return;
		if (id === 0) showTransferTypeForm(p, deps);
	});
}

function showTransferTypeForm(player, deps) {
	var fm = mc.newSimpleForm();
	fm.setTitle("转账");
	fm.setContent("选择转账对象类型");
	fm.addButton("在线玩家", "textures/ui/icon_online");
	fm.addButton("离线玩家", "textures/ui/icon_offline");
	fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null || id === 2) { showMoneyMainForm(p, deps); return; }
		if (id === 0) showTransferOnlineForm(p, deps);
		else if (id === 1) showTransferOfflineForm(p, deps);
	});
}

function showTransferOnlineForm(player, deps) {
	var onlineList = mc.getOnlinePlayers();
	var names = [];
	onlineList.forEach(function(p) {
		if (p.xuid !== player.xuid) {
			names.push(p.realName);
		}
	});
	if (names.length === 0) {
		player.sendModalForm("转账", "当前没有其他在线玩家", "返回", "关闭", function(pl, ok) {
			if (ok === true) showTransferTypeForm(pl, deps);
		});
		return;
	}
	var fm = mc.newCustomForm();
	fm.setTitle("转账给在线玩家");
	fm.addDropdown("选择玩家", names, 0);
	fm.addInput("输入转账金额", "正整数", "");
	player.sendForm(fm, function(p, data) {
		if (data === null) return;
		var targetName = names[data[0]];
		var amountStr = (data[1] || "").trim();
		if (!amountStr || !U.isInteger(amountStr) || Number(amountStr) <= 0) {
			p.tell("请输入有效的转账金额");
			showTransferOnlineForm(p, deps);
			return;
		}
		var amount = Number(amountStr);
		var balance = deps.getPlayerMoney(p);
		if (balance < amount) {
			p.sendModalForm("余额不足", "需要 " + amount + " " + deps.getCurrencyName() + "\n当前余额 " + balance + " " + deps.getCurrencyName(), "返回重新选择", "关闭", function(pl, ok) {
				if (ok === true) showTransferOnlineForm(pl, deps);
			});
			return;
		}
		var target = mc.getPlayer(targetName);
		if (!target) {
			p.sendModalForm("转账失败", "玩家已下线", "返回", "关闭", function(pl, ok) {
				if (ok === true) showTransferTypeForm(pl, deps);
			});
			return;
		}
		p.sendModalForm("确认转账", "转账给 " + targetName + "\n金额 " + amount + " " + deps.getCurrencyName(), "确认转账", "取消", function(pl, ok) {
			if (!ok) return;
			executeTransfer(pl, targetName, target.xuid, amount, deps);
		});
	});
}

function showTransferOfflineForm(player, deps) {
	var fm = mc.newCustomForm();
	fm.setTitle("转账给离线玩家");
	fm.addInput("输入玩家名称或UID", "", "");
	player.sendForm(fm, function(p, data) {
		if (data === null) return;
		var keyword = (data[0] || "").trim();
		if (!keyword) {
			p.tell("请输入搜索内容");
			showTransferOfflineForm(p, deps);
			return;
		}
		var results = [];
		var players = deps.playerData.players || {};
		Object.keys(players).forEach(function(xuid) {
			var info = players[xuid];
			var match = false;
			if (info.name && info.name.toLowerCase().indexOf(keyword.toLowerCase()) >= 0) match = true;
			if (info.uid && info.uid.toString() === keyword) match = true;
			if (match && xuid !== p.xuid) {
				results.push({ xuid: xuid, name: info.name, uid: info.uid });
			}
		});
		showTransferOfflineResultsForm(p, results, keyword, deps);
	});
}

function showTransferOfflineResultsForm(player, results, keyword, deps) {
	var fm = mc.newSimpleForm();
	fm.setTitle("搜索结果");
	if (results.length === 0) {
		fm.setContent("未找到匹配 \"" + keyword + "\" 的玩家");
	} else {
		fm.setContent("找到 " + results.length + " 个匹配结果\n点击选择转账对象");
		results.forEach(function(r) {
			var avatarUrl = deps.getPlayerAvatarUrl(r.xuid);
			fm.addButton(r.name + "\nUID: " + r.uid, avatarUrl);
		});
	}
	fm.addButton("返回", "textures/ui/recap_glyph_desaturated");
	player.sendForm(fm, function(p, id) {
		if (id === null) return;
		if (id >= results.length) {
			showTransferOfflineForm(p, deps);
			return;
		}
		var target = results[id];
		showTransferOfflineAmountForm(p, target, deps);
	});
}

function showTransferOfflineAmountForm(player, target, deps) {
	var fm = mc.newCustomForm();
	fm.setTitle("转账给 " + target.name);
	fm.addLabel("目标: " + target.name + " (UID: " + target.uid + ")");
	fm.addInput("输入转账金额", "正整数", "");
	player.sendForm(fm, function(p, data) {
		if (data === null) return;
		var amountStr = (data[1] || "").trim();
		if (!amountStr || !U.isInteger(amountStr) || Number(amountStr) <= 0) {
			p.tell("请输入有效的转账金额");
			showTransferOfflineAmountForm(p, target, deps);
			return;
		}
		var amount = Number(amountStr);
		var balance = deps.getPlayerMoney(p);
		if (balance < amount) {
			p.sendModalForm("余额不足", "需要 " + amount + " " + deps.getCurrencyName() + "\n当前余额 " + balance + " " + deps.getCurrencyName(), "返回重新选择", "关闭", function(pl, ok) {
				if (ok === true) showTransferOfflineAmountForm(pl, target, deps);
			});
			return;
		}
		p.sendModalForm("确认转账", "转账给 " + target.name + "\n金额 " + amount + " " + deps.getCurrencyName(), "确认转账", "取消", function(pl, ok) {
			if (!ok) return;
			executeTransfer(pl, target.name, target.xuid, amount, deps);
		});
	});
}

function executeTransfer(sender, targetName, targetXuid, amount, deps) {
	deps.reducePlayerMoney(sender, amount, "转账给" + targetName);
	var targetPlayer = mc.getPlayer(targetXuid);
	if (targetPlayer) {
		deps.addPlayerMoney(targetPlayer, amount, "来自" + sender.realName + "的转账");
	} else {
		if (!pendingTransfers[targetXuid]) {
			pendingTransfers[targetXuid] = [];
		}
		pendingTransfers[targetXuid].push({
			from: sender.realName,
			fromXuid: sender.xuid,
			amount: amount,
			time: new Date().toLocaleString()
		});
		save();
		deps.addPlayerMoneyByXuid(targetXuid, amount);
	}
	var senderBalance = deps.getPlayerMoney(sender);
	var targetBalance = deps.getPlayerMoneyByXuid(targetXuid);
	writeTransferLog(sender.realName, targetName, amount, senderBalance, targetBalance);
	sender.tell("转账成功 向" + targetName + "转账" + amount + deps.getCurrencyName() + " 余额" + senderBalance + deps.getCurrencyName());
	sender.sendModalForm("转账成功", "向" + targetName + "转账 " + amount + " " + deps.getCurrencyName() + "\n余额 " + senderBalance + " " + deps.getCurrencyName(), "继续转账", "关闭", function(pl, ok) {
		if (ok === true) showTransferTypeForm(pl, deps);
	});
}

function checkPendingTransfers(player, deps) {
	var xuid = player.xuid;
	if (!pendingTransfers[xuid] || pendingTransfers[xuid].length === 0) return;
	var transfers = pendingTransfers[xuid];
	transfers.forEach(function(t) {
		player.tell("您在离线期间收到了一笔来自" + t.from + "的转账 数额为" + t.amount + deps.getCurrencyName());
		deps.notifyEconomyChange(player, t.amount, "来自" + t.from + "的转账");
	});
	delete pendingTransfers[xuid];
	save();
}

module.exports = {
	load: load,
	showMoneyMainForm: showMoneyMainForm,
	showTransferTypeForm: showTransferTypeForm,
	checkPendingTransfers: checkPendingTransfers
};
