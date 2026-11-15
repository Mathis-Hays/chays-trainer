// Lancer : node tests/domain/masteryLog.test.js   — historique de maîtrise (atelier « Ouvertures et Progrès », lot 3) :
// un relevé par répertoire et par jour, réécrit seulement s'il change, sommé par couleur, suivi au renommage, à la corbeille
// et à la restauration. Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window, ev = s => w.eval(s);
    const DAY = 864e5, NOW = Date.UTC(2026, 10, 15, 12);
    // Répertoire « Test » : aux Blancs une maîtrisée et une à retravailler, une jamais essayée ; aux Noirs une à confirmer.
    ev(`(() => {
        addRepertoire('Test');
        const k = p => Chess.key(Chess.replay(p));
        dataStore.set(dbKeyFor('Test', 'w'), JSON.stringify({
            [k([])]: { move: 'e2e4', san: 'e4', attempts: 6, failures: 0 },
            [k(['e2e4', 'e7e5'])]: { move: 'g1f3', san: 'Nf3', attempts: 5, failures: 4, mastery: 10 },
            [k(['e2e4', 'c7c5'])]: { move: 'g1f3', san: 'Nf3', attempts: 0, failures: 0 } }));
        dataStore.set(dbKeyFor('Test', 'b'), JSON.stringify({ [k(['e2e4'])]: { move: 'c7c5', san: 'c5', attempts: 1, failures: 0 } }));
    })()`);
    const log = () => JSON.parse(ev(`dataStore.get(MasteryLog.KEY) || '{}'`));

    await t('relevé du jour : positions essayées par niveau et par couleur ; rien de réécrit si rien ne change', () => {
        assert.strictEqual(ev(`MasteryLog.record('Test', ${NOW})`), true);
        const r = log()['Test|2026-11-15'];
        assert.deepStrictEqual([r.w, r.b], [[1, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1]]);
        assert.strictEqual(r.at, NOW);
        assert.strictEqual(ev(`MasteryLog.record('Test', ${NOW + 3600e3})`), false, 'même état : pas de nouvelle écriture');
        assert.strictEqual(ev(`MasteryLog.record('Vide', ${NOW})`), false, 'rien de travaillé : pas de relevé');
    });

    await t('série : couleurs sommées, jours dans l\'ordre, hors période exclus, vieux relevés purgés', () => {
        ev(`MasteryLog.put('Test', { '2026-11-01': { w: [2,0,0,0,0,0], b: [0,0,0,0,0,0], at: 1 }, '2025-01-01': { w: [9,0,0,0,0,0], b: [0,0,0,0,0,0], at: 1 } })`);
        const s = JSON.parse(ev(`JSON.stringify(MasteryLog.series('Test', ['w', 'b'], 30, ${NOW}))`));
        assert.deepStrictEqual(s.map(x => x.day), ['2026-11-01', '2026-11-15']);
        assert.deepStrictEqual(s[1].counts, [1, 0, 0, 0, 1, 1]);
        assert.deepStrictEqual(JSON.parse(ev(`JSON.stringify(MasteryLog.series('Test', ['b'], 30, ${NOW}))`))[1].counts, [0, 0, 0, 0, 0, 1]);
        ev(`dataStore.set(dbKeyFor('Test', 'b'), '{}'); MasteryLog.record('Test', ${NOW + DAY})`);
        assert(!log()['Test|2025-01-01'], 'au-delà de 400 jours : purgé');
        assert(log()['Test|2026-11-16'], 'nouveau jour');
    });

    await t('renommage, corbeille et restauration emportent l\'historique', () => {
        ev(`renameRepertoire('Test', 'Essai')`);
        assert(!Object.keys(log()).some(k => k.startsWith('Test|')));
        assert.strictEqual(Object.keys(log()).filter(k => k.startsWith('Essai|')).length, 3);
        assert.strictEqual(ev(`deleteRepertoire('Essai')`), true);
        assert(!Object.keys(log()).some(k => k.startsWith('Essai|')), 'supprimé avec le répertoire');
        const id = ev(`loadTrash().find(it => it.type === 'repertoire' && it.rep === 'Essai').id`);
        assert(ev(`restoreTrashItem(${JSON.stringify(id)}).ok`));
        assert.strictEqual(Object.keys(log()).filter(k => k.startsWith('Essai|')).length, 3, 'rendu à la restauration');
    });

    await t('Progrès relève le jour en s\'affichant', () => {
        ev(`dataStore.remove(MasteryLog.KEY); currentRepertoire = 'Essai'; switchHomeTab('stats'); initStats()`);
        assert(log()[`Essai|${ev('MasteryLog.dayOf(Date.now())')}`]);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
