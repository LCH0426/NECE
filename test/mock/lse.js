/**
 * LSE (LegacyScriptEngine) 全局对象 Mock
 * 模拟 mc、money、logger、FloatPos、PermType 等 LSE 运行时全局对象
 */

// ============ Logger Mock ============
const logger = {
    _logs: [],
    info(...args) { this._logs.push({ level: 'info', args, time: Date.now() }); },
    warn(...args) { this._logs.push({ level: 'warn', args, time: Date.now() }); },
    error(...args) { this._logs.push({ level: 'error', args, time: Date.now() }); },
    clear() { this._logs = []; },
    getLogs(level) { return level ? this._logs.filter(l => l.level === level) : this._logs; }
};

// ============ Money Mock ============
const money = {
    _balances: {},
    get(xuid) { return this._balances[String(xuid)] || 0; },
    add(xuid, amount) {
        var k = String(xuid);
        this._balances[k] = (this._balances[k] || 0) + amount;
        return true;
    },
    reduce(xuid, amount) {
        var k = String(xuid);
        var cur = this._balances[k] || 0;
        if (cur < amount) return false;
        this._balances[k] = cur - amount;
        return true;
    },
    set(xuid, amount) { this._balances[String(xuid)] = amount; },
    clear() { this._balances = {}; }
};

// ============ Mock Player ============
function createMockPlayer(xuid, name) {
    return {
        xuid: String(xuid),
        name: name || ('Player_' + xuid),
        uuid: 'uuid-' + xuid,
        realName: name || ('Player_' + xuid),
        pos: { x: 100, y: 64, z: 200, dim: 0, dimid: 0 },
        permLevel: 0,
        isOP() { return this.permLevel >= 1; },
        isSimulatedPlayer() { return false; },
        tell(msg, type) { logger.info('[Tell->' + this.name + '] ' + msg); },
        sendToast(title, msg) { logger.info('[Toast->' + this.name + '] ' + title + ': ' + msg); },
        teleport(pos) { logger.info('[Teleport] ' + this.name + ' -> ' + JSON.stringify(pos)); },
        runcmd(cmd) { logger.info('[Cmd] ' + this.name + ': /' + cmd); },
        getDevice() { return { os: 'Win32', ip: '127.0.0.1', avgPing: 32 }; },
        getInventory() {
            return {
                size: 36,
                getAllItems() { return []; },
                getItem(i) { return null; }
            };
        },
        addEffect() {},
        setHealth() {},
        getMaxHealth() { return 20; },
        kick(reason) { logger.info('[Kick] ' + this.name + ': ' + reason); },
        sendForm(form, callback) { logger.info('[Form] ' + this.name + ' received form'); },
        sendModalForm(title, content, btn1, btn2, callback) { logger.info('[ModalForm] ' + this.name + ': ' + title); }
    };
}

// ============ MC Mock ============
const _mockPlayers = new Map();
const _listeners = {};
const _broadcasts = [];
const _commands = [];

const mc = {
    listen(event, callback) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(callback);
    },
    getPlayer(xuidOrName) {
        if (typeof xuidOrName === 'string') {
            for (var p of _mockPlayers.values()) {
                if (p.xuid === xuidOrName || p.name === xuidOrName) return p;
            }
        }
        return null;
    },
    getOnlinePlayers() {
        return Array.from(_mockPlayers.values());
    },
    broadcast(msg) {
        _broadcasts.push(msg);
    },
    newSimpleForm() {
        var form = { _type: 'simple', _title: '', _content: '', _buttons: [] };
        form.setTitle = function(t) { form._title = t; return form; };
        form.setContent = function(c) { form._content = c; return form; };
        form.addButton = function(text, img) { form._buttons.push({ text: text, img: img }); return form; };
        return form;
    },
    newCustomForm() {
        var form = { _type: 'custom', _title: '', _elements: [] };
        form.setTitle = function(t) { form._title = t; return form; };
        form.addLabel = function(text) { form._elements.push({ type: 'label', text: text }); return form; };
        form.addDropdown = function(name, options, def) { form._elements.push({ type: 'dropdown', name: name, options: options, def: def }); return form; };
        form.addInput = function(name, placeholder, def) { form._elements.push({ type: 'input', name: name, placeholder: placeholder, def: def }); return form; };
        form.addSwitch = function(name, def) { form._elements.push({ type: 'switch', name: name, def: def }); return form; };
        form.addSlider = function(name, min, max, step, def) { form._elements.push({ type: 'slider', name: name, min: min, max: max, step: step, def: def }); return form; };
        return form;
    },
    newCommand(name, desc, perm) {
        var cmd = { _name: name, _desc: desc, _perm: perm, _overloads: [], _callback: null };
        cmd.mandatory = function() { return cmd; };
        cmd.optional = function() { return cmd; };
        cmd.overload = function(args) { cmd._overloads.push(args); return cmd; };
        cmd.setCallback = function(cb) { cmd._callback = cb; return cmd; };
        cmd.setup = function() { _commands.push(cmd); };
        return cmd;
    },
    regConsoleCmd(name, desc, callback) {
        _commands.push({ _name: name, _desc: desc, _console: true, _callback: callback });
    },
    runcmdEx(cmd) { return { success: true, output: '' }; },
    getBDSVersion() { return '1.21.0.0'; },
    getServerProtocolVersion() { return 685; },
    newIntPos(x, y, z, dim) { return { x: x, y: y, z: z, dim: dim, type: 'IntPos' }; },
    newFloatPos(x, y, z, dim) { return { x: x, y: y, z: z, dim: dim, type: 'FloatPos' }; },
    // 测试辅助
    _mockPlayers: _mockPlayers,
    _listeners: _listeners,
    _broadcasts: _broadcasts,
    _commands: _commands,
    _clearAll() {
        _mockPlayers.clear();
        for (var k in _listeners) delete _listeners[k];
        _broadcasts.length = 0;
        _commands.length = 0;
    }
};

// ============ FloatPos Mock ============
function FloatPos(x, y, z, dim) {
    return { x: x, y: y, z: z, dim: dim, type: 'FloatPos' };
}

// ============ IntPos Mock ============
function IntPos(x, y, z, dim) {
    return { x: x, y: y, z: z, dim: dim, type: 'IntPos' };
}

// ============ PermType Mock ============
const PermType = {
    Any: 0,
    GameMasters: 1,
    Console: 2
};

// ============ ParamType Mock ============
const ParamType = {
    Int: 0,
    Float: 1,
    Bool: 2,
    String: 3,
    RawText: 4,
    Message: 5,
    JsonValue: 6,
    Actor: 7,
    Player: 8,
    BlockPos: 9,
    Vec3: 10,
    RawText_11970: 11
};

// ============ System Mock ============
const system = {
    getTimeStr() { return new Date().toLocaleString(); }
};

// ============ LL Mock ============
const ll = {
    registerPlugin() {},
    money: money
};

// ============ 注入全局对象 ============
function injectGlobals() {
    global.mc = mc;
    global.money = money;
    global.logger = logger;
    global.FloatPos = FloatPos;
    global.IntPos = IntPos;
    global.PermType = PermType;
    global.ParamType = ParamType;
    global.system = system;
    global.ll = ll;
}

function clearGlobals() {
    delete global.mc;
    delete global.money;
    delete global.logger;
    delete global.FloatPos;
    delete global.IntPos;
    delete global.PermType;
    delete global.ParamType;
    delete global.system;
    delete global.ll;
}

module.exports = {
    mc, money, logger, FloatPos, IntPos, PermType, ParamType, system, ll,
    createMockPlayer,
    injectGlobals, clearGlobals
};
