// Lancer : node tests/domain/daily.test.js   — défi du jour (Daily, atelier « L'envie de revenir », lot 3) et étoiles des finales (EG.stars)
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {};
const ctx = {
    console,
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); } },
    _level: e => e.lv
};
vm.createContext(ctx);
vm.runInContext(`function dayStamp(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }`, ctx);
const f = scriptPath('daily.js');
vm.runInContext(readVars(f), ctx, { filename: f });
const { Daily } = ctx;
const { EG } = require('../../' + scriptPath('egCore.js'));

const NOW = new Date(2026, 10, 17, 12).getTime(), DAY = 864e5;
const row = (key, lv, ago = 1, attempts = 3) => ({ color: 'w', key, e: { attempts, lv, lastReviewed: NOW - ago * DAY } });

t('tirage déterministe : même jour et même répertoire, même position, quel que soit l\'ordre des lignes', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => row(k, 'weak'));
    const p = Daily.pick(rows, '2026-11-17', 'G');
    assert.strictEqual(Daily.pick(rows.slice().reverse(), '2026-11-17', 'G').key, p.key);
    const days = new Set(Array.from({ length: 12 }, (_, i) => Daily.pick(rows, `2026-12-${String(i + 1).padStart(2, '0')}`, 'G').key));
    assert(days.size > 1, 'la position change d\'un jour à l\'autre');
});

t('les positions fragiles ou oubliées d\'abord ; jamais une position jamais essayée', () => {
    const rows = [row('sure', 'mastered'), row('sure2', 'solid'), row('fragile', 'fragile'), row('neuve', 'weak', 1, 0)];
    for (let i = 1; i <= 20; i++) assert.strictEqual(Daily.pick(rows, `2026-11-${String(i).padStart(2, '0')}`, 'G').key, 'fragile');
    const old = [row('sure', 'mastered'), row('oubliee', 'mastered', 40)];
    assert.strictEqual(Daily.pick(old, '2026-11-17', 'G').key, 'oubliee');
    assert.strictEqual(Daily.pick([row('x', 'mastered')], '2026-11-17', 'G').key, 'x', 'sinon, n\'importe laquelle');
    assert.strictEqual(Daily.pick([row('neuve', 'weak', 1, 0)], '2026-11-17', 'G'), null);
});

t('seul le premier essai du jour est gardé', () => {
    delete store[Daily.KEY];
    Daily.save({ ok: false, key: 'a', color: 'w', rep: 'G' }, NOW);
    Daily.save({ ok: true, key: 'a', color: 'w', rep: 'G' }, NOW + 1000);
    assert.strictEqual(Daily.today(NOW).r, 0);
});

t('série : jours réussis d\'affilée ; aujourd\'hui pas encore joué ne casse rien, un jour raté ou manqué la coupe', () => {
    const log = {};
    const put = (k, r) => { log[ctx.dayStamp(NOW - k * DAY)] = { r, at: 1 }; };
    put(1, 1); put(2, 1); put(3, 0); put(4, 1);
    assert.strictEqual(Daily.streak(log, NOW), 2);
    put(0, 1);
    assert.strictEqual(Daily.streak(log, NOW), 3);
    put(0, 0);
    assert.strictEqual(Daily.streak(log, NOW), 0);
});

t('400 jours gardés', () => {
    store[Daily.KEY] = JSON.stringify({ '2024-01-01': { r: 1, at: 1 } });
    Daily.save({ ok: true, key: 'a', color: 'w' }, NOW);
    assert.deepStrictEqual(Object.keys(Daily.read()), [ctx.dayStamp(NOW)]);
});

t('étoiles des finales : chemin le plus court connu', () => {
    assert.strictEqual(EG.stars({ moves: 10, par: 10 }), 3);
    assert.strictEqual(EG.stars({ moves: 12, par: 10 }), 3, '15 % de marge (2 coups)');
    assert.strictEqual(EG.stars({ moves: 13, par: 10 }), 2, 'sans faute mais trop long');
    assert.strictEqual(EG.stars({ moves: 10, par: 10, hints: 1 }), 2, 'un indice');
    assert.strictEqual(EG.stars({ moves: 16, par: 10, hints: 1 }), 1, 'un indice et trop long');
    assert.strictEqual(EG.stars({ moves: 10, par: 10, errors: 1, hints: 1 }), 1);
    assert.strictEqual(EG.stars({ moves: 2, par: 1 }), 3, 'au moins un coup de marge');
});

t('étoiles des finales : sans chemin connu, seules les fautes et les indices comptent', () => {
    assert.strictEqual(EG.stars({ moves: 40 }), 3);
    assert.strictEqual(EG.stars({ moves: 40, errors: 1 }), 2);
    assert.strictEqual(EG.stars({ moves: 40, errors: 1, hints: 1 }), 1);
});

console.log(`\n${n} tests réussis.`);
