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
 * NECE i18n 模块
 * 加载 JSON 语言文件，提供翻译函数
 */

var fs = require('fs');
var path = require('path');

var _langDir = path.join(__dirname, '..', 'lang');
var _cache = {};
var DEFAULT_LOCALE = 'zh_CN';

/**
 * 加载指定语言文件
 * @param {string} locale - 语言代码，如 zh_CN
 * @returns {object} 语言数据
 */
function loadLocale(locale) {
    if (_cache[locale]) return _cache[locale];
    var filePath = path.join(_langDir, locale + '.json');
    try {
        var data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        _cache[locale] = data;
        return data;
    } catch (e) {
        if (locale !== DEFAULT_LOCALE) {
            return loadLocale(DEFAULT_LOCALE);
        }
        return {};
    }
}

/**
 * 获取嵌套对象的值
 * @param {object} obj - 对象
 * @param {string} key - 点分隔的 key，如 "bank.title"
 * @returns {string|undefined}
 */
function getNestedValue(obj, key) {
    var keys = key.split('.');
    var current = obj;
    for (var i = 0; i < keys.length; i++) {
        if (current === undefined || current === null) return undefined;
        current = current[keys[i]];
    }
    return current;
}

/**
 * 翻译函数
 * @param {string} locale - 语言代码
 * @param {string} key - 翻译 key，如 "bank.title"
 * @param {...any} args - 替换参数，对应 {0} {1} 等占位符
 * @returns {string} 翻译后的文本
 */
function t(locale, key) {
    var langData = loadLocale(locale || DEFAULT_LOCALE);
    var value = getNestedValue(langData, key);
    if (value === undefined) {
        // 回退到默认语言
        if (locale !== DEFAULT_LOCALE) {
            var defaultData = loadLocale(DEFAULT_LOCALE);
            value = getNestedValue(defaultData, key);
        }
        if (value === undefined) return key;
    }
    // 替换占位符 {0} {1} 等（使用全局替换，支持同一占位符多次出现）
    for (var i = 2; i < arguments.length; i++) {
        value = value.split('{' + (i - 2) + '}').join(arguments[i]);
    }
    return value;
}

/**
 * 获取支持的语言列表
 * @returns {string[]} 语言代码数组
 */
function getSupportedLocales() {
    try {
        var files = fs.readdirSync(_langDir);
        var locales = [];
        for (var i = 0; i < files.length; i++) {
            if (files[i].endsWith('.json')) {
                locales.push(files[i].replace('.json', ''));
            }
        }
        return locales;
    } catch (e) {
        return [DEFAULT_LOCALE];
    }
}

module.exports = {
    t: t,
    loadLocale: loadLocale,
    getSupportedLocales: getSupportedLocales,
    DEFAULT_LOCALE: DEFAULT_LOCALE
};
