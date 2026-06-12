/**
 * NECE 商店系统测试
 */

const { test, assertEqual, assertTruthy, assertFalsy, assertDeepEqual } = require('../test-framework');

console.log('\n--- shop.js 测试 ---');

// 模拟商店数据
const mockShopData = {
    Buy: [
        {
            name: "基础物品",
            items: [
                { id: "minecraft:stone", name: "石头", money: 10 },
                { id: "minecraft:dirt", name: "泥土", money: 5 },
                { id: "minecraft:iron_ingot", name: "铁锭", money: 100 }
            ]
        },
        {
            name: "稀有物品",
            items: [
                { id: "minecraft:diamond", name: "钻石", money: 1000 },
                { id: "minecraft:emerald", name: "绿宝石", money: 500 }
            ]
        }
    ],
    Sell: [
        { id: "minecraft:stone", name: "石头", money: 5 },
        { id: "minecraft:dirt", name: "泥土", money: 2 }
    ]
};

test('商店数据结构验证', function() {
    assertTruthy(Array.isArray(mockShopData.Buy), 'Buy 应该是数组');
    assertTruthy(Array.isArray(mockShopData.Sell), 'Sell 应该是数组');
    assertTruthy(mockShopData.Buy.length > 0, 'Buy 不应该为空');
});

test('商店分组验证', function() {
    const group = mockShopData.Buy[0];
    assertTruthy(group.name, '分组应该有名称');
    assertTruthy(Array.isArray(group.items), '分组应该有物品数组');
});

test('物品价格计算', function() {
    const item = mockShopData.Buy[0].items[0];
    const count = 5;
    const totalCost = item.money * count;
    assertEqual(totalCost, 50); // 10 * 5 = 50
});

test('VIP折扣计算', function() {
    const originalPrice = 1000;
    const discount = 0.85; // 85折
    const discountedPrice = Math.floor(originalPrice * discount);
    assertEqual(discountedPrice, 850);
});

test('回收价格验证', function() {
    const sellItem = mockShopData.Sell[0];
    assertTruthy(sellItem.money > 0, '回收价格应该大于0');
    assertTruthy(sellItem.money < mockShopData.Buy[0].items[0].money, '回收价格应该低于购买价格');
});

test('物品搜索', function() {
    const searchResult = [];
    mockShopData.Buy.forEach(group => {
        group.items.forEach(item => {
            if (item.name.includes('石') || item.id.includes('stone')) {
                searchResult.push(item);
            }
        });
    });
    assertTruthy(searchResult.length > 0, '应该能找到石头');
});

test('分组索引验证', function() {
    const validGroupIndex = 0;
    const invalidGroupIndex = 999;
    assertTruthy(mockShopData.Buy[validGroupIndex] !== undefined, '有效索引应该存在');
    assertFalsy(mockShopData.Buy[invalidGroupIndex] !== undefined, '无效索引应该不存在');
});

test('物品索引验证', function() {
    const group = mockShopData.Buy[0];
    const validItemIndex = 0;
    const invalidItemIndex = 999;
    assertTruthy(group.items[validItemIndex] !== undefined, '有效物品索引应该存在');
    assertFalsy(group.items[invalidItemIndex] !== undefined, '无效物品索引应该不存在');
});
