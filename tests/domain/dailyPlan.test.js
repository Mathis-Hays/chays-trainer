// Lancer : node tests/domain/dailyPlan.test.js   — Révision du jour (chantier du 18 novembre 2026) : plafond de l'objectif
// du jour, ordre d'importance, veille, nouvelles en pause, bonus de retard, erreur hors échéance, série run et niveaux E3,
// simulation d'un retard de 650 qui se résorbe. Sans DOM : storage.js, review.js et levels.js dans un contexte vm.
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {};
const ctx = {
    console,
    dataStore: { getJSON: (k, d) => (k in store ? store[k] : d), setJSON: (k, v) => { store[k] = v; },
                 get: k => (k in store ? JSON.stringify(store[k]) : null), set: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } },
    appSettings: { dailyGoal: 30, rhythm: 'std' }, currentRepertoire: 'R'
};
vm.createContext(ctx);
['storage.js', 'review.js', 'levels.js'].forEach(name => { const f = scriptPath(name); vm.runInContext(readVars(f), ctx, { filename: f }); });
// Base simulée (entrées modifiées en place, comme saveDB), horloge réglable.
vm.runInContext('var __dbs = {}; var readDBFor = (rep, c) => (__dbs[rep] && __dbs[rep][c]) || {}; var __now = Date.now(); Date.now = () => __now;', ctx);
const setNow = at => { vm.runInContext(`__now = ${at}`, ctx); };
const setDB = (w, b = {}) => { ctx.__dbs = { R: { w, b } }; };
const DAY = 864e5;
const NOW = new Date(2026, 10, 18, 15).getTime();                   // mercredi 18 novembre 2026, 15 h
const reset = (goal = 30) => { Object.keys(store).forEach(k => delete store[k]); ctx.appSettings.dailyGoal = goal; ctx.SeenPositions = undefined; setNow(NOW); };
const rev = (i, extra = {}) => ({ move: 'e2e4', attempts: 4, failures: 1, mastery: 70, interval: 3, due: NOW - (i + 1) * 3600e3, lastReviewed: NOW - 4 * DAY, ply: 10, ...extra });
const many = (count, f = rev) => Object.fromEntries(Array.from({ length: count }, (_, i) => ['p' + i, f(i)]));

t('plafond : 100 révisions dues, objectif 30 → 30 aujourd\'hui, 70 en attente ; essais du jour déduits ; « Encore 30 »', () => {
    reset();
    setDB(many(100));
    const p = ctx.reviewPlan('R', NOW);
    assert.strictEqual(p.todayList().length, 30);
    assert.strictEqual(p.forecast(null, 1)[0], 30, 'la prévision du jour suit le plafond');
    assert.strictEqual(p.held(), 70);
    assert.strictEqual(p.overdue(), 70, 'overdue = held (Statistiques)');
    store.chessTrainer_activity = { [ctx.dayStamp(NOW)]: { a: 12, f: 2 } };
    assert.strictEqual(ctx.reviewPlan('R', NOW).todayList().length, 18, '12 déjà faites : il en reste 18');
    store.chessTrainer_activity = { [ctx.dayStamp(NOW)]: { a: 40, f: 2 } };
    assert.strictEqual(ctx.reviewPlan('R', NOW).todayList().length, 0, 'objectif dépassé : plus rien');
    assert.strictEqual(ctx.reviewPlan('R', NOW, { left: 30 }).todayList().length, 30, '« Encore 30 »');
    reset(60);
    assert.strictEqual(ctx.reviewPlan('R', NOW).todayList().length, 60, 'Soutenu');
    reset(15);
    assert.strictEqual(ctx.reviewPlan('R', NOW).todayList().length, 15, 'Léger');
    ctx.appSettings.dailyGoal = 10;
    assert.strictEqual(ctx.reviewGoal(), 30, 'valeur hors paliers : 30');
});

t('passage hors révision (Survie, défi du jour…) : trace p pour la série, ni objectif ni file touchés', () => {
    reset();
    setDB(many(100));
    ctx.logActivity(true, true); ctx.logActivity(false, true);
    const d = store.chessTrainer_activity[ctx.dayStamp(NOW)];
    assert.strictEqual(d.p, 2); assert.strictEqual(d.a, 0); assert.strictEqual(d.f, 0);
    assert.strictEqual(ctx.reviewPlan('R', NOW).todayList().length, 30, 'objectif du jour inchangé');
    ctx.logActivity(true);
    assert.strictEqual(store.chessTrainer_activity[ctx.dayStamp(NOW)].a, 1, 'une révision compte toujours');
    assert.strictEqual(store.chessTrainer_activity[ctx.dayStamp(NOW)].p, 2, 'la trace hors révision est gardée');
});

t('ordre d\'importance : À revoir, Traitée depuis, vue en partie (les plus jouées), demi-coup, maîtrise', () => {
    reset();
    const seen = { w: new Map([['s1', 3], ['s9', 9], ['lo', 1], ['hi', 1], ['m1', 1], ['m2', 1]]) };
    ctx.SeenPositions = { MIN: 5, ready: () => true, has: (c, k) => !!(seen[c] && seen[c].has(k)), count: (c, k) => (seen[c] && seen[c].get(k)) || 0 };
    setDB({
        u: rev(0, { ply: 1 }), s1: rev(1, { ply: 6 }), s9: rev(2, { ply: 20 }), lo: rev(3, { ply: 2 }), hi: rev(4, { ply: 8 }),
        m1: rev(5, { ply: 30, mastery: 80 }), m2: rev(6, { ply: 30, mastery: 40 }), pr: rev(7, { prio: 1 }), rl: rev(8, { relearn: 1, ply: 40 })
    });
    const order = ctx.reviewPlan('R', NOW).todayList().map(x => x.key);
    assert.deepStrictEqual([...order], ['rl', 'pr', 's9', 's1', 'lo', 'hi', 'm2', 'm1', 'u']);
});

t('veille : une ligne jamais rencontrée en partie attend que le reste soit à jour ; suspendue sans assez de parties', () => {
    reset(15);
    const w = many(20, i => rev(i, { ply: 2 }));                     // 20 vues en partie, demi-coup 2
    for (let i = 0; i < 10; i++) w['u' + i] = rev(30 + i, { ply: 1 });  // 10 jamais vues, plus courtes
    setDB(w);
    const seen = new Set(Object.keys(w).filter(k => k[0] === 'p'));
    ctx.SeenPositions = { MIN: 5, ready: () => true, has: (c, k) => seen.has(k), count: (c, k) => (seen.has(k) ? 1 : 0) };
    let p = ctx.reviewPlan('R', NOW, { failRate: 0 });
    assert(p.todayList().every(x => x.key[0] === 'p'), 'aujourd\'hui : seulement des positions vues en partie');
    assert.strictEqual(p.held(), 15);
    assert.strictEqual(p.asleep(), 10, 'les 10 jamais vues sont en veille');
    assert.strictEqual(p.dayOf('w', 'u0'), 1, 'elles reviennent quand les vues sont faites');
    seen.clear(); ['p0', 'p1', 'p2', 'p3'].forEach(k => seen.add(k));   // 4 < MIN : pas de veille
    p = ctx.reviewPlan('R', NOW);
    assert.strictEqual(p.asleep(), 0);
    assert(p.todayList().some(x => x.key[0] === 'u'), 'sans assez de parties, l\'ordre ordinaire (demi-coup) reprend');
});

t('nouvelles : en pause tant qu\'une révision attend ; sinon objectif ÷ 5 par jour, dans le plafond', () => {
    reset();
    const fresh = i => ({ move: 'e2e4', attempts: 0, failures: 0, due: NOW - DAY, created: NOW - DAY + i, ply: 3 });
    const w = Object.assign(many(40), Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['n' + i, fresh(i)])));
    setDB(w);
    let p = ctx.reviewPlan('R', NOW);
    assert(p.todayList().every(x => x.key[0] === 'p'), '40 révisions pour 30 places : aucune nouvelle');
    setDB(Object.assign(many(10), Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['n' + i, fresh(i)]))));
    p = ctx.reviewPlan('R', NOW);
    assert.strictEqual(p.todayList().filter(x => x.key[0] === 'n').length, 6, 'à jour : 30 ÷ 5 = 6 nouvelles');
    assert.strictEqual(ctx.newPerDay(), 6);
    setDB(Object.assign(many(27), Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['n' + i, fresh(i)]))));
    assert.strictEqual(ctx.reviewPlan('R', NOW).todayList().length, 30, '27 révisions + 3 nouvelles : jamais plus que l\'objectif');
});

t('date « à jour vers… » : retard de 70 à 30 par jour, et prochaine révision', () => {
    reset();
    setDB(many(70, i => rev(i, { interval: 30 })));                 // de longs intervalles : rien ne revient vite
    const p = ctx.reviewPlan('R', NOW, { failRate: 0 }), cu = p.catchUp();
    assert.strictEqual(cu.days, 2, '30 aujourd\'hui, 30 demain, les 10 dernières après-demain');
    assert.deepStrictEqual([...p.forecast(null, 4)], [30, 30, 10, 0]);
    assert.strictEqual(p.next(), new Date(2026, 10, 19).getTime(), 'la suite attend demain');
    reset();
    setDB({ a: rev(0) });
    assert.strictEqual(ctx.reviewPlan('R', NOW).catchUp().days, 0, 'à jour');
    // Avec des erreurs (une sur deux), la simulation renvoie des positions dans la file « À revoir » : plus long.
    setDB(many(70, i => rev(i, { interval: 30 })));
    assert(ctx.reviewPlan('R', NOW, { failRate: 0.5 }).catchUp().days > 2, 'les erreurs attendues retardent la date');
});

const note = (e, ok, help = 0) => { e.attempts++; if (!ok) e.failures++; ctx.recordReview(e, ok, help); return e; };

t('bonus de retard : intervalle + retard ÷ 2, puis × 2,5 ; à l\'heure, × 2,5 seulement', () => {
    reset();
    const late = note({ move: 'x', attempts: 3, failures: 0, interval: 4, due: NOW - 10 * DAY, lastReviewed: NOW - 14 * DAY }, true);
    assert.strictEqual(late.interval, 22.5, '(4 + 10 ÷ 2) × 2,5');
    const onTime = note({ move: 'x', attempts: 3, failures: 0, interval: 4, due: NOW - 1000, lastReviewed: NOW - 4 * DAY }, true);
    assert.strictEqual(onTime.interval, 10);
    const capped = note({ move: 'x', attempts: 3, failures: 0, interval: 100, due: NOW - 200 * DAY }, true);
    assert.strictEqual(capped.interval, 180, 'plafond de 180 jours');
});

t('erreur hors échéance : file « À revoir », revue demain au plus tard (pas dans 10 minutes) ; à l\'échéance : 10 minutes', () => {
    reset();
    const soon = note({ move: 'x', attempts: 3, failures: 0, interval: 10, due: NOW + 5 * DAY, lastReviewed: NOW - 5 * DAY }, false);
    assert.strictEqual(soon.relearn, 0); assert.strictEqual(soon.interval, 0);
    assert.strictEqual(soon.due, NOW + DAY);
    const tonight = note({ move: 'x', attempts: 3, failures: 0, interval: 1, due: NOW + 3600e3, lastReviewed: NOW - DAY }, false);
    assert.strictEqual(tonight.due, NOW + 3600e3, 'une échéance plus proche est gardée');
    const due = note({ move: 'x', attempts: 3, failures: 0, interval: 10, due: NOW - 1000 }, false);
    assert.strictEqual(due.due, NOW + 10 * 60000);
});

t('série run : réussite à l\'échéance +1, erreur 0, hors échéance au plus +1 par jour, pièce montrée neutre', () => {
    reset();
    const e = note({ move: 'x', attempts: 0, failures: 0, due: NOW - 1000 }, true);
    assert.strictEqual(e.run, 1);
    note(e, true);                                            // pas due, déjà notée aujourd'hui
    assert.strictEqual(e.run, 1);
    setNow(NOW + DAY - 3600e3);                               // le lendemain, avant l'échéance (+1 j) : un cran
    note(e, true);
    assert.strictEqual(e.run, 2);
    setNow(NOW + 3 * DAY); e.due = NOW;                       // due
    note(e, true, 2);
    assert.strictEqual(e.run, 2, 'pièce exacte : série gardée');
    e.due = NOW; note(e, true, 1);
    assert.strictEqual(e.run, 3, 'type de pièce : réussite');
    note(e, false);
    assert.strictEqual(e.run, 0);
    setNow(NOW);
});

t('série run déduite pour les anciennes entrées : sans erreur → essais, dans la file → étape, sinon le score', () => {
    reset();
    assert.strictEqual(ctx.runOf({ attempts: 4, failures: 0 }), 4);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, relearn: 1, mastery: 90 }), 1);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, mastery: 40 }), 0);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, mastery: 60 }), 1);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, mastery: 80 }), 2);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, mastery: 90, interval: 3 }), 3);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, mastery: 90, interval: 8 }), 5);
    assert.strictEqual(ctx.runOf({ attempts: 6, failures: 2, mastery: 10, run: 4 }), 4, 'un run enregistré l\'emporte');
    // Première réussite notée sur une ancienne entrée sans erreur : la déduction ne compte pas ce passage.
    const old = note({ move: 'x', attempts: 2, failures: 0, due: NOW - 1000, lastReviewed: NOW - 3 * DAY, interval: 1 }, true);
    assert.strictEqual(old.run, 3);
    assert.strictEqual(ctx.normalizeEntry({ move: 'x', run: 3 }).run, 3, 'normalizeEntry garde run');
    assert.strictEqual(ctx.normalizeEntry({ move: 'x', run: -1 }).run, undefined);
    assert.strictEqual(ctx.normalizeEntry({ move: 'x', run: 2.5 }).run, undefined);
});

t('niveaux E3 : À confirmer, À retravailler, Fragile, En progrès, Solide (3 ou 4), Maîtrisée (5 et plus)', () => {
    const lv = e => ctx._level(e);
    assert.strictEqual(lv({ attempts: 2, failures: 0, run: 2 }), 'unsure');
    assert.strictEqual(lv({ attempts: 3, failures: 0, run: 0 }), 'unsure', 'sans erreur ni réussite comptée (pièce montrée)');
    assert.strictEqual(lv({ attempts: 5, failures: 1, run: 0 }), 'weak');
    assert.strictEqual(lv({ attempts: 1, failures: 1, run: 0 }), 'weak');
    assert.strictEqual(lv({ attempts: 5, failures: 1, run: 1 }), 'fragile');
    assert.strictEqual(lv({ attempts: 5, failures: 1, run: 2 }), 'progress');
    assert.strictEqual(lv({ attempts: 5, failures: 1, run: 3 }), 'solid');
    assert.strictEqual(lv({ attempts: 9, failures: 1, run: 4 }), 'solid');
    assert.strictEqual(lv({ attempts: 9, failures: 1, run: 5 }), 'mastered');
    assert.strictEqual(lv({ attempts: 3, failures: 0 }), 'solid', 'ancienne entrée sans erreur, 3 essais');
    assert.strictEqual(lv({ attempts: 5, failures: 0 }), 'mastered');
    // La position de l'artefact : ✓ ✓ ✗ ✓ ✓ ✓ → À confirmer, À confirmer, À retravailler, Fragile, En progrès, Solide.
    reset();
    const e = { move: 'x', attempts: 0, failures: 0, due: NOW - 1000 }, seen = [];
    [true, true, false, true, true, true].forEach((ok, i) => { setNow(NOW + i * 30 * DAY); e.due = NOW + i * 30 * DAY - 1000; note(e, ok); seen.push(lv(e)); });
    assert.deepStrictEqual(seen, ['unsure', 'unsure', 'weak', 'fragile', 'progress', 'solid']);
    setNow(NOW);
    assert.deepStrictEqual([...Object.keys(ctx.STATS_LEVELS)], ['weak', 'fragile', 'progress', 'solid', 'unsure', 'mastered'], 'mêmes six cases, même ordre');
});

t('simulation : un retard de 650 se résorbe au rythme Normal (30 par jour, 85 % de réussite, 650 nouvelles en pause), date annoncée juste', () => {
    reset(30);
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const w = {};
    for (let i = 0; i < 650; i++) w['late' + i] = { move: 'x', attempts: 4, failures: 1, mastery: 70, interval: 1 + (i % 20), due: NOW - (1 + i % 60) * DAY, lastReviewed: NOW - (2 + i % 60) * DAY - (1 + i % 20) * DAY, ply: 1 + i % 20 };
    for (let i = 0; i < 200; i++) w['ok' + i] = { move: 'x', attempts: 6, failures: 0, interval: 20 + i % 60, due: NOW + (1 + i % 90) * DAY, lastReviewed: NOW - 10 * DAY, ply: 1 + i % 20 };
    for (let i = 0; i < 650; i++) w['new' + i] = { move: 'x', attempts: 0, failures: 0, due: NOW - DAY, created: i, ply: 5 };
    setDB(w);
    const first = ctx.reviewPlan('R', NOW);
    assert(first.held() >= 600, 'départ : plus de 600 en attente');
    assert(first.catchUp(), 'une date « à jour vers… » existe au rythme Normal');
    let day = 0, newBefore = null;
    for (; day < 200; day++) {
        const at = new Date(2026, 10, 18 + day, 9).getTime();
        setNow(at);
        const p = ctx.reviewPlan('R', at), list = p.todayList();
        assert(list.length <= 30, `jour ${day} : jamais plus que l'objectif`);
        if (p.held() === 0) break;
        if (newBefore === null) assert(!list.some(x => x.key.startsWith('new')), `jour ${day} : nouvelles en pause tant qu'il y a du retard`);
        list.forEach(x => { const e = w[x.key]; note(e, rand() < 0.85); });
    }
    assert(day < 150, `retard résorbé en ${day} jours (moins de 150)`);
    const est = first.catchUp().days;
    assert(Math.abs(est - day) <= day / 4, `date « à jour vers… » annoncée au premier jour (${est}) proche du réel (${day})`);
    console.log(`     (650 en retard : à jour au jour ${day}, estimation du premier jour : ${first.catchUp().days})`);
    setNow(NOW);
});

console.log(`\n${n} tests réussis.`);
