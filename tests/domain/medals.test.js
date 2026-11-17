// Lancer : node tests/domain/medals.test.js   — atelier « L'envie de revenir », lot 5 : vitrine de médailles (Medals)
// et la semaine en une carte (WeekCard). Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window, ev = s => w.eval(s), J = s => JSON.parse(ev(`JSON.stringify(${s})`));
    const got = () => JSON.parse(ev(`dataStore.get(Medals.KEY) || '{}'`));
    const DAY = 864e5;

    await t('une vingtaine de médailles, chacune dans une catégorie de la vitrine', () => {
        const list = J('Medals.list({})');
        assert.strictEqual(list.length, 20);
        const cats = J('Medals.CATS.map(c => c[0])');
        list.forEach(m => assert(cats.includes(m.cat) && m.name && m.desc && m.glyph, m.id));
        assert.strictEqual(new Set(list.map(m => m.id)).size, 20);
    });

    await t('gagnée une fois pour toutes : rangée avec sa date, annoncée une seule fois, gardée si le chiffre redescend', () => {
        ev(`dataStore.remove(Medals.KEY); dataStore.setJSON('chessTrainer_timedRecord', 31)`);
        const fresh = J('Medals.check({}, 1000)').map(m => m.id);
        assert(fresh.includes('timed30'));
        assert.strictEqual(got().timed30, 1000);
        assert(!J('Medals.check({}, 2000)').some(m => m.id === 'timed30'), 'pas deux fois');
        ev(`dataStore.setJSON('chessTrainer_timedRecord', 3)`);
        assert(J('Medals.list({}, 2000)').find(m => m.id === 'timed30').at === 1000, 'reste gagnée');
    });

    await t('médailles d\'événement : séance de 10 sans faute, ligne complète sans faute (pas en contre-la-montre)', () => {
        const ids = s => J(`Medals.check({ summary: ${JSON.stringify(s)} })`).map(m => m.id);
        assert(!ids({ kind: 'timed', total: 12, ok: 12 }).includes('perfect'));
        assert(!ids({ kind: 'due', total: 9, ok: 9 }).includes('perfect'), 'moins de 10');
        assert(ids({ kind: 'due', total: 10, ok: 10 }).includes('perfect'));
        assert(ids({ kind: 'line', total: 4, ok: 4 }).includes('line'));
    });

    await t('finales : Lucena gagnée, étoiles comptées ; nouvelle trois jours dans la vitrine', () => {
        const now = Date.now();
        ev(`dataStore.setJSON('chessTrainer_endgames', { 'rook-lucena': { tries: 1, wins: 1, perfect: true, best: 9, last: 1, stars: 3 } })`);
        assert(J(`Medals.check({}, ${now})`).some(m => m.id === 'lucena'));
        const l = J(`Medals.list({}, ${now + DAY})`);
        assert(l.find(m => m.id === 'lucena').fresh);
        assert(!J(`Medals.list({}, ${now + 4 * DAY})`).find(m => m.id === 'lucena').fresh);
        assert.strictEqual(l.find(m => m.id === 'stars30').v, 3);
    });

    await t('Progrès : onglet Médailles, gagnées en laiton, les autres avec leur avancée', () => {
        ev(`(() => { addRepertoire('M'); const k = Chess.key(Chess.replay([])); dataStore.set(dbKeyFor('M', 'w'), JSON.stringify({ [k]: { move: 'e2e4', san: 'e4', attempts: 6, failures: 0, path: ['e2e4'], ply: 1 } })); currentRepertoire = 'M'; })()`);
        ev(`switchHomeTab('stats'); statsPane = 'medals'; initStats()`);
        const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
        assert(/\d+\/20/.test($('#st-tab-n-medals').textContent));
        assert.strictEqual($$('.st-medals .md').length, 20);
        assert(w.document.getElementById('stats-body').classList.contains('pane-medals'));
        assert($('.md.is-on .md-coin') && $('.md:not(.is-on) .md-bar'));
        assert(got().m1, 'une position maîtrisée : la première médaille, rangée à l\'affichage');
    });

    await t('semaine montrée : la semaine en cours le dimanche, sinon la précédente', () => {
        const sun = new Date(2026, 10, 15, 12).getTime(), mon = new Date(2026, 10, 16, 12).getTime();
        assert.strictEqual(ev(`WeekCard.shown(${sun})`), new Date(2026, 10, 9).getTime());
        assert.strictEqual(ev(`WeekCard.shown(${mon})`), new Date(2026, 10, 9).getTime());
        assert.strictEqual(ev(`WeekCard.shown(${new Date(2026, 10, 22, 9).getTime()})`), new Date(2026, 10, 16).getTime());
    });

    await t('semaine : essais par jour, réussite, positions sues d\'après l\'historique, temps estimé ; une phrase sans reproche', () => {
        const from = new Date(2026, 10, 9).getTime();
        const act = { '2026-11-09': { a: 10, f: 1 }, '2026-11-11': { a: 20, f: 2 }, '2026-11-15': { a: 10, f: 1 }, '2026-11-03': { a: 5, f: 0 } };
        ev(`MasteryLog.put('S', { '2026-11-01': { w: [5,0,0,2,1,0], b: [0,0,0,0,0,0], at: 1 }, '2026-11-14': { w: [1,0,0,4,6,0], b: [0,0,0,0,0,0], at: 2 } })`);
        const wk = J(`WeekCard.week(${JSON.stringify(act)}, 'S', ${from})`);
        assert.deepStrictEqual(wk.days, [10, 0, 20, 0, 0, 0, 10]);
        assert.strictEqual(wk.tries, 40); assert.strictEqual(wk.rate, 90); assert.strictEqual(wk.active, 3);
        assert.strictEqual(wk.sure, 7, '3 sues avant, 10 à la fin');
        assert.strictEqual(wk.minutes, 20);
        assert.strictEqual(ev(`WeekCard.line(${JSON.stringify(wk)}, null)`), '7 positions de plus sont sues.');
        assert.strictEqual(ev(`WeekCard.line({ tries: 0 }, null)`), 'Semaine au repos : tout reprend quand vous voulez.');
        assert.strictEqual(ev(`WeekCard.line({ tries: 30, sure: 0, rate: 70, active: 2 }, { tries: 20 })`), 'Plus active que la semaine d’avant.');
    });

    await t('Progrès : la carte de la semaine dans Maîtrise, les semaines d\'avant repliées', () => {
        ev(`(() => { const a = readActivity(); const d = new Date(); d.setDate(d.getDate() - 8); a[dayStamp(d.getTime())] = { a: 12, f: 2 }; dataStore.setJSON('chessTrainer_activity', a); })()`);
        ev(`statsPane = 'overview'; initStats()`);
        const card = w.document.querySelector('.st-week[data-pane="overview"]');
        assert(card && card.querySelector('.st-wk-line') && card.querySelectorAll('.st-wk-days > div').length === 7);
        assert.strictEqual(card.querySelectorAll('.st-wk-hist li').length, 8);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
