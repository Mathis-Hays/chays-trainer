// Lancer : node tests/domain/habits.test.js   — série avec joker et retour en douceur (Habits, atelier « L'envie de revenir », lot 1)
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

t('retour après 5 jours : 8 positions pour reprendre, le reste gardé', () => {
    const c = Habits.comeback(act([-5]), 72, NOW, 10);
    assert.strictEqual(c.first, true);
    assert.strictEqual(c.away, 5);
    assert.strictEqual(c.left, Habits.COMEBACK_FIRST);
    assert.strictEqual(c.held, 64);
});

t('jour du retour, part déjà faite en partie : il reste la différence ; faite en entier : left = 0', () => {
    assert.strictEqual(Habits.comeback(act([0, -5], 5), 64, NOW, 10).left, 3);
    const done = Habits.comeback(act([0, -5], 8), 64, NOW, 10);
    assert.strictEqual(done.left, 0);
    assert.strictEqual(done.held, 64);
});

t('jours suivants : le retard est réparti sur ce qui reste de la semaine', () => {
    const c = Habits.comeback(act([-1, -2, -6]), 60, NOW, 10);       // retour il y a 2 jours, 5 jours restants
    assert.strictEqual(c.first, false);
    assert.strictEqual(c.daysLeft, 5);
    assert.strictEqual(c.quota, 12);
});

t('pas de retour en douceur : absence courte, premier lancement, retard qui tient dans la part, semaine écoulée', () => {
    assert.strictEqual(Habits.comeback(act([-2]), 72, NOW, 10), null);
    assert.strictEqual(Habits.comeback({}, 72, NOW, 10), null);
    assert.strictEqual(Habits.comeback(act([-5]), 6, NOW, 10), null);
    assert.strictEqual(Habits.comeback(act([-1, -2, -3, -4, -5, -6, -7, -12]), 72, NOW, 10), null);
});

console.log(`\n${n} tests réussis.`);
