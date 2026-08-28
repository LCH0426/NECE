const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, lse } = require('../helpers/setup');

describe('shop', () => {
    let shop;
    let deps;

    before(() => {
        setupMocks();
        shop = require('../../src/shop');

        // mock 的 custom form 缺少 showXPBuyForm 用到的 addStepSlider，此处补齐
        const origCustom = lse.mc.newCustomForm;
        lse.mc.newCustomForm = function() {
            const f = origCustom.apply(this, arguments);
            f.addStepSlider = function() { return f; };
            return f;
        };

        // 真实注入 init 所需依赖
        deps = {
            getPlayerSetting: function() { return false; },
            getSystemLanguage: function() { return 'zh_CN'; },
            t: function(lang, key) { return key; },
            getCurrencyName: function() { return '星茜'; },
            getPlayerMoney: function() { return 5000; },
            money: { get: function() { return 5000; } },
            getVipInfo: function() { return { hasVip: false }; },
            shopData: {
                Buy: [{ name: '基础物品', items: [{ id: 'minecraft:stone', name: '石头', money: 10 }] }],
                Sell: [{ name: '回收', items: [{ id: 'minecraft:stone', name: '石头', money: 5 }] }]
            },
            recycleConfig: { recycleItems: { 'minecraft:stone': { price: 10, name: '石头' } } },
            playerData: { players: {} },
            savePlayerDataNow: function() {},
            reducePlayerMoney: function() { return true; },
            addPlayerMoney: function() { return true; },
            giveItemById: function() { return true; }
        };
        shop.init(deps);
    });

    after(() => {
        teardownMocks();
    });

    // 构造背包含指定格子的玩家，供回收路径读取真实源码中的背包遍历逻辑
    function playerWithInventory(items, slots) {
        slots = slots || items.length;
        const inv = {
            size: slots,
            getItem: function(i) { return items[i] || null; },
            getAllItems: function() { return items.slice(); },
            refreshItems: function() {},
            setItem: function() {}
        };
        const p = lse.createMockPlayer('10001', 'Buyer');
        p.getInventory = function() { return inv; };
        return p;
    }

    describe('init', () => {
        it('should be exported and callable', () => {
            assert.equal(typeof shop.init, 'function');
        });
    });

    describe('showShopMainForm', () => {
        it('should build a main form with buy/sell/close buttons', () => {
            const p = lse.createMockPlayer('10001', 'Buyer');
            let fm = null;
            p.sendForm = function(f) { fm = f; };
            shop.showShopMainForm(p, deps);
            assert.ok(fm, '应发送表单');
            assert.equal(fm._buttons.length, 3);
            assert.equal(fm._buttons[0].text, 'shop.btn_buy');
            assert.equal(fm._buttons[1].text, 'shop.btn_sell');
            assert.equal(fm._buttons[2].text, 'shop.close');
        });
    });

    describe('showRecycleForm', () => {
        it('should list recyclable items with computed total value', () => {
            const stone = { type: 'minecraft:stone', count: 5, isNull: function() { return false; } };
            const p = playerWithInventory([stone]);
            let fm = null;
            p.sendForm = function(f) { fm = f; };
            shop.showRecycleForm(p, deps.recycleConfig, deps);
            assert.ok(fm, '应构建回收表单');
            assert.equal(fm._buttons.length, 3); // 查看全部 / 确认回收 / 取消
            assert.ok(fm._content.indexOf('石头 ×5') >= 0, '应列出回收物品名与数量');
            assert.ok(fm._content.indexOf('50') >= 0, '总价值 = 5件*10价 = 50 应被计算');
            assert.ok(fm._content.indexOf('星茜') >= 0, '应包含货币名');
        });

        it('should show empty recycle form when nothing recyclable', () => {
            const air = { type: 'minecraft:air', count: 64, isNull: function() { return true; } };
            const p = playerWithInventory([air]);
            let modalShown = false;
            p.sendForm = function() {};
            p.sendModalForm = function() { modalShown = true; };
            shop.showRecycleForm(p, { recycleItems: {} }, deps);
            assert.equal(modalShown, true, '无可回收物品时应弹出空提示框');
        });
    });

    describe('showXPBuyForm', () => {
        it('should build an xp custom form and return true', () => {
            const p = lse.createMockPlayer('10001', 'Buyer');
            p.getLevel = function() { return 5; };
            p.getCurrentExperience = function() { return 10; };
            const spy = lse.mc.newCustomForm;
            let gui = null;
            p.sendForm = function(f) { gui = f; };
            const ret = shop.showXPBuyForm(p, deps);
            assert.equal(ret, true);
            assert.ok(gui, '应构建自定义表单');
            assert.equal(gui._title, 'shop.xp_title');
            assert.ok(gui._elements.length > 0, '应包含信息元素');
        });
    });

    describe('recycle price computed from real inventory traversal', () => {
        it('should accumulate count across multiple slots of the same item', () => {
            const stone = { type: 'minecraft:stone', count: 3, isNull: function() { return false; } };
            const stone2 = { type: 'minecraft:stone', count: 2, isNull: function() { return false; } };
            const p = playerWithInventory([stone, stone2]);
            let fm = null;
            p.sendForm = function(f) { fm = f; };
            // 回收配置中石头单价 3，合计 5 件 -> 15
            shop.showRecycleForm(p, { recycleItems: { 'minecraft:stone': { price: 3, name: '石头' } } }, deps);
            assert.ok(fm._content.indexOf('石头 ×5') >= 0, '相同物品应累加数量');
            assert.ok(fm._content.indexOf('15') >= 0, '总价值 = 5件*3价 = 15 应被计算');
        });
    });
});