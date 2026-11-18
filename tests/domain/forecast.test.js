// Lancer : node tests/domain/forecast.test.js   — programme des révisions (reviewPlan, js/storage.js), sans DOM
const { scriptPath } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, dataStore: { getJSON: (k, d) => d, setJSON() {}, get: () => null, set() {}, remove() {} } };
vm.createContext(ctx);
// Scripts entiers (storage.js, review.js) ; base simulée par répertoire et couleur (readDBFor), objectif quotidien réglable.
['storage.js', 'review.js'].forEach(name => { const f = scriptPath(name); vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f }); });
ctx.__dbs = {}; ctx.appSettings = { dailyGoal: 30 }; ctx.currentRepertoire = 'R';
vm.runInContext('var readDBFor = (rep, c) => (__dbs[rep] && __dbs[rep][c]) || {};', ctx);
const plan = (w, b, goal = 30, at = now) => { ctx.__dbs = { R: { w, b } }; ctx.appSettings.dailyGoal = goal; return ctx.reviewPlan('R', at, { failRate: 0 }); };

const now = new Date(2026, 9, 29, 15, 30).getTime();             // 29 octobre 2026, 15 h 30
const day = (i, h = 9) => new Date(2026, 9, 29 + i, h).getTime(); // jour i, 9 h

t('programme : 30 nouvelles positions s\'étalent à objectif ÷ 5 par jour (6 pour 30), plus de pic du jour', () => {
    const w = {};
    for (let i = 0; i < 30; i++) w['p' + i] = { attempts: 0, failures: 0, due: day(0, 8), created: day(0, 8) + i, ply: i };
    const p = plan(w, {});
    assert.strictEqual(p.forecast(null, 1)[0], 6);
    assert(p.today('w', 'p0') && p.today('w', 'p5') && !p.today('w', 'p6'), 'les plus anciennes d\'abord');
    assert.strictEqual(p.dayOf('w', 'p29'), 4);
    assert.strictEqual(plan(w, {}, 60).forecast(null, 1)[0], 12, 'suit l\'objectif quotidien');
    assert.strictEqual(plan(w, {}, 15).forecast(null, 1)[0], 3);
});

t('programme : révisions à leur échéance, retards aujourd\'hui, réponses « Traitée depuis » en tête des nouvelles', () => {
    const w = { late: { attempts: 3, failures: 0, due: day(-3), interval: 30 }, d2: { attempts: 2, failures: 0, due: day(2), interval: 30 } };
    const b = { a: { attempts: 0, due: 1, created: 1, ply: 1 }, b: { attempts: 0, due: 2, created: 2, ply: 1 }, c: { attempts: 0, due: 3, created: 3, ply: 1, prio: 1 } };
    const p = plan(w, b, 15);                                      // 3 nouvelles par jour
    assert(p.today('w', 'late') && p.today('b', 'c') && p.today('b', 'a'), '« Traitée depuis » passe avant les autres nouvelles');
    assert.deepStrictEqual([...p.forecast(null, 1)], [4], 'retard + 3 nouvelles');
    assert.strictEqual(p.dayOf('w', 'd2'), 2);
    assert.strictEqual(p.dayOf('w', 'inconnue'), Infinity);
    assert.strictEqual(p.next(c => c === 'w'), day(2), 'prochaine révision des Blancs');
    assert.deepStrictEqual([...p.forecast(c => c === 'b', 2)], [3, 0], 'portée : une couleur (chaque position comptée une fois)');
});

// ─── File « À revoir » et score de maîtrise (recordReview) ───────────────────
const note = (e, ok) => { e.attempts++; if (!ok) e.failures++; ctx.recordReview(e, ok); return e; };
const ready = e => { e.due = Date.now() - 1000; return e; };

t('file À revoir : une erreur y fait entrer, trois réussites à l\'échéance en sortent (1, 3, 7 jours)', () => {
    const e = note({ attempts: 5, failures: 0, due: Date.now() - 1000, interval: 30 }, false);
    assert.strictEqual(e.relearn, 0); assert.strictEqual(e.interval, 0);
    assert(e.due - Date.now() <= 10 * 60000 && e.due > Date.now(), 'retour dans 10 min');
    note(ready(e), true); assert.strictEqual(e.relearn, 1); assert.strictEqual(e.interval, 1);
    note(ready(e), true); assert.strictEqual(e.relearn, 2); assert.strictEqual(e.interval, 3);
    note(ready(e), true); assert.strictEqual(e.relearn, undefined, 'sortie de la file'); assert.strictEqual(e.interval, 7);
    note(ready(e), true); assert.strictEqual(e.interval, 17.5, 'ensuite, intervalle normal');
});

t('file À revoir : une réussite avant l\'échéance n\'avance pas, une erreur ramène à zéro', () => {
    const e = note({ attempts: 1, failures: 0, due: Date.now() - 1000 }, false);
    note(e, true); note(e, true); note(e, true);
    assert.strictEqual(e.relearn, 0, 'trois réussites de suite tout de suite après : toujours à 0');
    note(ready(e), true); note(ready(e), true);
    assert.strictEqual(e.relearn, 2);
    note(ready(e), false);
    assert.strictEqual(e.relearn, 0);
});

t('score : une erreur ancienne s\'efface, gain réduit hors échéance, positions anciennes déduites des compteurs', () => {
    const old = { attempts: 10, failures: 8, due: Date.now() - 1000 };
    assert.strictEqual(Math.round(ctx.masteryOf(old)), 20);
    note(old, true);
    assert.strictEqual(old.mastery, 48, 'calculé depuis 8 erreurs sur 10, sans compter ce passage : 20 + 35 % de 80');
    const e = { attempts: 0, failures: 0, due: Date.now() - 1000 };
    note(e, false); assert.strictEqual(e.mastery, 24, 'erreur : il reste 40 %');
    for (let i = 0; i < 6; i++) note(ready(e), true);
    assert(e.mastery >= 85, 'six réussites à l\'échéance : solide, quels que soient les compteurs');
    const s = { attempts: 1, failures: 0, mastery: 50, due: Date.now() + 864e5 };
    note(s, true); assert.strictEqual(s.mastery, 55, 'pas encore due : + 10 % de ce qui manque');
});

console.log(`\n${n} tests réussis.`);
