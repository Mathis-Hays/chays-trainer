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

// ─── Paliers, rattrapage et découverte (recordReview, chantier « Erreurs et niveaux ») ───────────────
const note = (e, ok, help = 0) => { e.attempts++; if (!ok) e.failures++; ctx.recordReview(e, ok, help); return e; };
const ready = e => { e.due = Date.now() - 1000; return e; };
const tomorrow = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };

t('palier : une erreur fait descendre d\'un seul palier, rattrapage demain ; réussi, le palier est gardé', () => {
    const e = note({ attempts: 5, failures: 0, due: Date.now() - 1000, interval: 30 }, false);
    assert.strictEqual(e.step, 4, 'Maîtrisée (5 essais sans erreur) → palier 4, toujours Solide');
    assert.strictEqual(e.relearn, 0); assert.strictEqual(e.due, tomorrow(), 'revue demain');
    note(ready(e), true);
    assert.strictEqual(e.relearn, undefined, 'rattrapage levé'); assert.strictEqual(e.step, 4, 'palier gardé'); assert.strictEqual(e.interval, 16);
    note(ready(e), true); assert.strictEqual(e.step, 5); assert.strictEqual(e.interval, 35);
    note(ready(e), true); note(ready(e), true); note(ready(e), true);
    assert.strictEqual(e.interval, 180, 'au-delà de 90 jours : 180 au plus');
});

t('palier : deux erreurs d\'affilée renvoient en découverte ; en découverte, un raté ne compte pas', () => {
    const e = note({ attempts: 3, failures: 0, step: 2, due: Date.now() - 1000 }, false);
    assert.strictEqual(e.step, 1);
    note(ready(e), false);
    assert.strictEqual(e.step, 0, 'deuxième erreur d\'affilée : découverte');
    assert(ctx.isDiscovering(e));
    const a = e.attempts, f = e.failures;
    assert.strictEqual(ctx.recordMiss(ready(e)), false, 'raté en découverte : rien de compté');
    assert.strictEqual(e.attempts, a); assert.strictEqual(e.failures, f); assert.strictEqual(e.due, tomorrow());
    note(ready(e), true); assert.strictEqual(e.step, 1, 'retrouvée de mémoire : palier 1'); assert.strictEqual(e.relearn, undefined);
    assert.strictEqual(ctx.recordMiss(ready(e)), true, 'ensuite, une erreur compte');
    assert.strictEqual(e.failures, f + 1); assert.strictEqual(e.step, 1, 'jamais sous le palier 1 après une première erreur');
});

t('palier : une réussite avant l\'échéance monte au plus d\'un palier par jour ; indice 1 garde le palier, indice 2 neutre', () => {
    const e = { attempts: 3, failures: 0, step: 3, due: Date.now() + 5 * 864e5, lastReviewed: Date.now() - 2 * 864e5 };
    note(e, true); assert.strictEqual(e.step, 4, 'premier passage du jour : un palier');
    note(e, true); assert.strictEqual(e.step, 4, 'deuxième le même jour, pas dû : rien de plus');
    const h = note({ attempts: 3, failures: 0, step: 2, due: Date.now() - 1000 }, true, 1);
    assert.strictEqual(h.step, 2, 'indice 1 : palier gardé'); assert.strictEqual(h.interval, 3);
    const p = note({ attempts: 3, failures: 0, step: 2, due: Date.now() - 1000, relearn: 0 }, true, 2);
    assert.strictEqual(p.step, 2); assert.strictEqual(p.relearn, 0, 'indice 2 : rattrapage gardé');
});

t('palier déduit des anciennes entrées, sans rien réécrire', () => {
    assert.strictEqual(ctx.stepOf({ attempts: 26, failures: 0 }), 5, 'jamais ratée, 26 essais : Maîtrisée');
    assert.strictEqual(ctx.stepOf({ attempts: 2, failures: 0 }), 2, 'ancienne « À confirmer » : En cours');
    assert.strictEqual(ctx.stepOf({ attempts: 9, failures: 2, run: 3 }), 3, 'série gardée');
    assert.strictEqual(ctx.stepOf({ attempts: 10, failures: 6, run: 0, relearn: 0, mastery: 0 }), 0, 'moins d\'une réussite sur deux : découverte');
    assert.strictEqual(ctx.stepOf({ attempts: 8, failures: 3, run: 0, mastery: 31 }), 2, 'dernier essai raté, 5 réussites sur 8 : un cran sous Sue');
    assert.strictEqual(ctx.stepOf({ attempts: 0, failures: 0 }), 0);
    assert.strictEqual(ctx.stepOf({ attempts: 9, failures: 9, step: 3 }), 3, 'palier enregistré : il fait foi');
});

t('découverte : une position jamais présentée montre son coup ; présentée, elle revient demain sans rien compter', () => {
    const e = { attempts: 0, failures: 0, due: Date.now() - 1000 };
    assert(ctx.needsShowing(e));
    ctx.presentEntry(e);
    assert(!ctx.needsShowing(e)); assert.strictEqual(e.attempts, 0); assert.strictEqual(e.step, 0); assert.strictEqual(e.due, tomorrow());
});

t('score : une erreur ancienne s\'efface, gain réduit hors échéance, positions anciennes déduites des compteurs', () => {
    const old = { attempts: 10, failures: 8, due: Date.now() - 1000 };
    assert.strictEqual(Math.round(ctx.masteryOf(old)), 20);
    note(old, true);
    assert.strictEqual(old.mastery, 48, 'calculé depuis 8 erreurs sur 10, sans compter ce passage : 20 + 35 % de 80');
    const e = { attempts: 2, failures: 1, step: 2, mastery: 60, due: Date.now() - 1000 };
    note(e, false); assert.strictEqual(e.mastery, 24, 'erreur : il reste 40 %');
    for (let i = 0; i < 6; i++) note(ready(e), true);
    assert(e.mastery >= 85, 'six réussites à l\'échéance : solide, quels que soient les compteurs');
    const s = { attempts: 1, failures: 0, mastery: 50, due: Date.now() + 864e5 };
    note(s, true); assert.strictEqual(s.mastery, 55, 'pas encore due : + 10 % de ce qui manque');
});

console.log(`\n${n} tests réussis.`);
