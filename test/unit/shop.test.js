const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupMocks, teardownMocks, createAndRegisterPlayer, lse } = require('../helpers/setup');

describe('shop', () => {
    before(() => {
        setupMocks();
        createAndRegisterPlayer('10001', 'TestPlayer');
    });

    after(() => {
        teardownMocks();
    });

    describe('module loading', () => {
        it('should export showShopMainForm', () => {
            const shop = require('../../src/shop');
            assert.equal(typeof shop.showShopMainForm, 'function');
        });

        it('should export showRecycleForm', () => {
            const shop = require('../../src/shop');
            assert.equal(typeof shop.showRecycleForm, 'function');
        });

        it('should export showXPBuyForm', () => {
            const shop = require('../../src/shop');
            assert.equal(typeof shop.showXPBuyForm, 'function');
        });
    });
});
