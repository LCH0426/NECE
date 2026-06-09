/**
 * DataManager Mock — 内存版本，不写磁盘
 * 模拟 index.js 中 DataManager 的 load/save/get/set 行为
 */

class MockDataManager {
    constructor(defaultData) {
        this.data = JSON.parse(JSON.stringify(defaultData || {}));
        this._saveCount = 0;
    }

    load() { return this.data; }

    save(immediate) { this._saveCount++; }

    get(key, defaultValue) {
        if (key === undefined) return this.data;
        var keys = String(key).split('.');
        var cur = this.data;
        for (var i = 0; i < keys.length; i++) {
            if (cur == null || typeof cur !== 'object') return defaultValue !== undefined ? defaultValue : null;
            cur = cur[keys[i]];
        }
        return cur !== undefined ? cur : (defaultValue !== undefined ? defaultValue : null);
    }

    set(key, value) {
        var keys = String(key).split('.');
        var cur = this.data;
        for (var i = 0; i < keys.length - 1; i++) {
            if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys[keys.length - 1]] = value;
        this._saveCount++;
    }

    reset() {
        this._saveCount = 0;
    }
}

module.exports = { MockDataManager };
