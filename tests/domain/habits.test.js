// Lancer : node tests/domain/habits.test.js   — série avec joker et jour du retour (Habits, atelier « L'envie de revenir », lot 1)
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`const DAY_MS = 86400000;
    function dayStamp(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }`, ctx);
const f = scriptPath('habits.js');
vm.runInContext(readVars(f), ctx, { filename: f });
const { Habits } = ctx;

// Lundi 16 novembre 2026, midi ; jours relatifs (0 = aujourd'hui, -1 = hier…).
const NOW = new Date(2026, 10, 16, 12).getTime();
const day = k => ctx.dayStamp(new Date(2026, 10, 16 + k, 12));
const act = (days, a = 5) => Object.fromEntries(days.map(k => [day(k), { a, f: 0 }]));

t('série sans trou : jours actifs consécutifs, joker de la semaine libre', () => {
    const s = Habits.streak(act([0, -1, -2]), NOW);
    assert.strictEqual(s.n, 3);
    assert.deepStrictEqual([...s.jokers], []);
    assert.strictEqual(s.jokerFree, true);
});

t('un jour manqué seul est couvert par le joker de sa semaine ; il ne compte pas comme jour actif', () => {
    const s = Habits.streak(act([0, -1, -2, -4, -5]), NOW);       // vendredi 13 manqué
    assert.strictEqual(s.n, 5);
    assert.deepStrictEqual([...s.jokers], [day(-3)]);
});

t('deux jours manqués de suite, ou deux la même semaine : la série s\'arrête', () => {
    assert.strictEqual(Habits.streak(act([0, -3, -4]), NOW).n, 1);
    assert.strictEqual(Habits.streak(act([0, -2, -4, -5]), NOW).n, 2);   // dimanche 15 couvert, vendredi 13 même semaine
});

t('aujourd\'hui sans essai ne casse rien ; hier manqué reste couvert tant qu\'aujourd\'hui est à jouer', () => {
    assert.strictEqual(Habits.streak(act([-1, -2]), NOW).n, 2);
    const s = Habits.streak(act([-2, -3]), NOW);
    assert.strictEqual(s.n, 2);
    assert.deepStrictEqual([...s.jokers], [day(-1)]);
});

t('joker de la semaine en cours utilisé : jokerFree faux', () => {
    const wed = new Date(2026, 10, 18, 12).getTime();               // mercredi : lundi actif, mardi manqué
    const s = Habits.streak(act([2, 0, -1]), wed);
    assert.strictEqual(s.n, 3);
    assert.strictEqual(s.jokerFree, false);
});

t('aucune activité : série nulle', () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Habits.streak({}, NOW))), { n: 0, jokers: [], jokerFree: true });
});

t('jour de seule Survie (ou défi du jour, mode libre…) : la série continue, comme un jour de révision', () => {
    const a = act([-1, -2]);
    a[day(0)] = { a: 0, f: 0, p: 4 };                               // aujourd'hui : passages hors révision seulement
    assert.strictEqual(Habits.streak(a, NOW).n, 3);
    const b = act([0, -2]);
    b[day(-1)] = { a: 0, f: 0, p: 1 };
    assert.strictEqual(Habits.streak(b, NOW).n, 3, 'hier en Survie : pas de joker dépensé');
    assert.strictEqual(Habits.streak(b, NOW).jokers.length, 0);
});

// Depuis le chantier « Révision du jour » (novembre 2026), la part du jour vient du plafond commun (reviewPlan) :
// comeback ne dit plus que le retour (titre « Bon retour »), sans part ni retard gardé (tests/domain/dailyPlan.test.js).
t('retour après 5 jours : « Bon retour » aujourd\'hui, sans part propre', () => {
    const c = Habits.comeback(act([-5]), NOW);
    assert.strictEqual(c.first, true);
    assert.strictEqual(c.away, 5);
    assert.strictEqual(c.left, undefined, 'plus de part du jour propre à la reprise');
    assert.strictEqual(Habits.comeback(act([0, -5], 8), NOW).first, true, 'essais déjà faits : toujours le jour du retour');
});

t('jours suivants de la semaine du retour : first faux, jours restants', () => {
    const c = Habits.comeback(act([-1, -2, -6]), NOW);              // retour il y a 2 jours, 5 jours restants
    assert.strictEqual(c.first, false);
    assert.strictEqual(c.daysLeft, 5);
});

t('pas de retour : absence courte, premier lancement, semaine écoulée', () => {
    assert.strictEqual(Habits.comeback(act([-2]), NOW), null);
    assert.strictEqual(Habits.comeback({}, NOW), null);
    assert.strictEqual(Habits.comeback(act([-1, -2, -3, -4, -5, -6, -7, -12]), NOW), null);
});

console.log(`\n${n} tests réussis.`);
