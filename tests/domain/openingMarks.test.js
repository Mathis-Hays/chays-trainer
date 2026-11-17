// Lancer : node tests/domain/openingMarks.test.js   — atelier « L'envie de revenir », lot 4 : rangs d'ouverture (OpeningMarks),
// idée de la ligne, ce que le répertoire rapporte (OpeningReport.payoff). Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window, ev = s => w.eval(s), J = s => JSON.parse(ev(`JSON.stringify(${s})`));
    const marks = () => JSON.parse(ev(`dataStore.get(OpeningMarks.KEY) || '{}'`));
    const S = (n, mastery, weak = 0, unsure = 0) => JSON.stringify({ n, mastery, weak, unsure });

    await t('rang : Apprenti, Compagnon (maîtrise 60, peu de fragiles), Maître (85, aucune fragile ni à confirmer)', () => {
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(1, 95)})`), 2, 'une seule position suffit (troncs communs)');
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(3, 59)})`), 0);
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(4, 70, 1)})`), 1);
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(4, 70, 2)})`), 0, 'la moitié fragile');
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(6, 90)})`), 2);
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(6, 90, 0, 1)})`), 1, 'une position à confirmer retient');
    });

    await t('un Maître qui oublie redescend en douceur : seuil plus bas, un rang à la fois', () => {
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(6, 80, 1)}, 2)`), 2, 'au-dessus du seuil de maintien');
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(6, 30, 4)}, 2)`), 1, 'jamais deux rangs d\'un coup');
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(6, 55)}, 1)`), 1);
        assert.strictEqual(ev(`OpeningMarks.rankOf(${S(6, 45)}, 1)`), 0);
    });

    await t('vers le rang suivant : pourcentage et conditions manquantes ; rien au rang Maître', () => {
        const p = J(`OpeningMarks.progress(${S(2, 30)}, 0)`);
        assert.strictEqual(p.to, 1);
        assert.strictEqual(p.pct, 50);
        assert.deepStrictEqual(p.need, ['maîtrise 60 (30 pour l’instant)']);
        assert.deepStrictEqual(J(`OpeningMarks.progress(${S(6, 90, 0, 1)}, 1)`).need, ['toutes les positions confirmées']);
        assert.strictEqual(J(`OpeningMarks.progress(${S(6, 90)}, 2)`), null);
    });

    // Répertoire « Rangs » : l'Italienne aux Blancs, cinq positions bien sues.
    ev(`(() => {
        addRepertoire('Rangs');
        const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d4', 'e5d4'], db = {};
        for (let i = 0; i < line.length; i += 2) {
            const pos = Chess.replay(line.slice(0, i));
            db[Chess.key(pos)] = { move: line[i], san: Chess.san(pos, line[i]), attempts: 6, failures: 1, mastery: 92, interval: 30, path: line.slice(0, i + 1), ply: i + 1 };
        }
        dataStore.set(dbKeyFor('Rangs', 'w'), JSON.stringify(db));
        currentRepertoire = 'Rangs';
    })()`);

    await t('après une séance : premier calcul rangé sans fête, puis une promotion annoncée au bilan', () => {
        assert.deepStrictEqual(J('_rankPromos()'), [], 'premier calcul : rien à fêter');
        const key = Object.keys(marks().Rangs).find(k => marks().Rangs[k].r === 2);
        assert(key, JSON.stringify(marks().Rangs));
        ev(`(() => { const a = dataStore.getJSON(OpeningMarks.KEY, {}); a.Rangs[${JSON.stringify(key)}].r = 1; dataStore.setJSON(OpeningMarks.KEY, a); })()`);
        const promos = J('_rankPromos()');
        assert.deepStrictEqual(promos.map(p => [p.key, p.from, p.to]), [[key, 1, 2]]);
        const box = w.document.createElement('div');
        box.innerHTML = ev(`_trPromosHTML({ promos: ${JSON.stringify(promos)} })`);
        assert(/Promotion/.test(box.textContent) && /Compagnon → Maître/.test(box.textContent));
        assert(box.querySelector('.op-rank.is-seal.is-r2'));
    });

    await t('onglet Ouvertures : rang dans l\'index et la fiche, idée suggérée à garder ou réécrire', () => {
        ev(`switchHomeTab('openings'); OpeningsTab.init()`);
        const $ = s => w.document.querySelector(s);
        assert($('.so-mr .op-rank.is-r2'), 'rang dans l\'index');
        assert($('.so-head .op-rank.is-r2') && $('.so-rank.is-top'), 'rang dans la fiche');
        const idea = $('.so-idea.is-suggested');
        assert(idea && /Fou c4 contre f7/.test(idea.textContent), 'suggestion de l\'Italienne');
        idea.querySelector('[data-action="opIdeaKeep"]').click();
        const own = $('.so-idea:not(.is-suggested)');
        assert(own && own.querySelector('p').getAttribute('translate') === 'no', 'gardée : devient la mienne');
        assert(/Modifier/.test(own.textContent));
    });

    await t('idée : celle de l\'ouverture, sinon de sa famille, sinon une suggestion ; vide efface ; 160 caractères', () => {
        ev(`OpeningMarks.setIdea('Rangs', 'b|Caro-Kann', 'Fou f5 puis …e6')`);
        assert.deepStrictEqual(J(`OpeningMarks.idea('Rangs', 'b', 'Caro-Kann · Avance')`), { text: 'Fou f5 puis …e6', own: true, from: 'Caro-Kann' });
        ev(`OpeningMarks.setIdea('Rangs', 'b|Caro-Kann', '')`);
        assert.strictEqual(J(`OpeningMarks.idea('Rangs', 'b', 'Caro-Kann · Avance')`).own, false, 'retour à la suggestion');
        assert.strictEqual(J(`OpeningMarks.idea('Rangs', 'w', 'Caro-Kann · Avance')`), null, 'pas de suggestion pour l\'autre camp');
        assert.strictEqual(J(`OpeningMarks.idea('Rangs', 'b', 'Sicilienne Najdorf · Attaque anglaise')`).from, 'Sicilienne Najdorf');
        assert.strictEqual(ev(`OpeningMarks.setIdea('Rangs', 'b|X', 'a'.repeat(300))`).length, 160);
        for (const [k, v] of Object.entries(J('OpeningMarks._suggest'))) assert(v && v.length <= 160, k);
    });

    await t('renommage, corbeille et restauration emportent rangs et idées', () => {
        ev(`renameRepertoire('Rangs', 'Rangs2')`);
        assert(!marks().Rangs && marks().Rangs2);
        assert.strictEqual(ev(`deleteRepertoire('Rangs2')`), true);
        assert(!marks().Rangs2, 'supprimés avec le répertoire');
        const id = ev(`loadTrash().find(it => it.type === 'repertoire' && it.rep === 'Rangs2').id`);
        assert(ev(`restoreTrashItem(${JSON.stringify(id)}).ok`));
        assert(Object.keys(marks().Rangs2).length >= 2, 'rendus à la restauration');
    });

    await t('ce que le répertoire rapporte : écart à l\'attendu suivi − quitté, 5 parties avec Elo de chaque côté, sur un an', () => {
        const now = Date.now();
        const row = (i, res, left, at = now - i * 864e5) => ({ g: { at, result: res, me: 1500, opp: 1500, color: 'w' }, a: { dev: left ? { by: 'me', ply: 6 } : null, path: [] } });
        const kept = Array.from({ length: 6 }, (_, i) => row(i, 'w', false)), left = Array.from({ length: 5 }, (_, i) => row(i, i % 2 ? 'w' : 'l', true));
        const p = J(`OpeningReport.payoff(${JSON.stringify(kept.concat(left))}, ${now})`);
        assert.strictEqual(Math.round(p.gain), 60, 'suivi : +50 (6 victoires), quitté : −10 (2 sur 5)');
        assert.strictEqual(J(`OpeningReport.payoff(${JSON.stringify(kept.concat(left.slice(1)))}, ${now})`).gain, null, 'trop peu de parties quittées');
        const old = left.map(r => row(0, r.g.result, true, now - 400 * 864e5));
        assert.strictEqual(J(`OpeningReport.payoff(${JSON.stringify(kept.concat(old))}, ${now})`).gain, null, 'au-delà d\'un an : ignorées');
    });

    await t('Aujourd\'hui : une phrase seulement quand le répertoire rapporte', () => {
        const now = Date.now();
        const rows = []; for (let i = 0; i < 6; i++) rows.push({ g: { at: now - i * 864e5, result: 'w', me: 1500, opp: 1500, color: 'w' }, a: { dev: null } });
        const lose = []; for (let i = 0; i < 6; i++) lose.push({ g: { at: now - i * 864e5, result: 'l', me: 1500, opp: 1500, color: 'w' }, a: { dev: { by: 'me' } } });
        ev(`currentRepertoire = 'Rangs2'; switchHomeTab('play'); window._a = StatsGames.analysed; StatsGames.analysed = () => ${JSON.stringify(rows.concat(lose))}; renderHomeSummary()`);
        const line = w.document.querySelector('#hp-today .hp-gain');
        assert(line && /\+100 %/.test(line.textContent), line && line.textContent);
        ev(`StatsGames.analysed = () => ${JSON.stringify(rows.map(r => Object.assign({}, r, { a: { dev: { by: 'me' } } })).concat(lose.map(r => Object.assign({}, r, { a: { dev: null } }))))}; renderHomeSummary()`);
        assert(!w.document.querySelector('#hp-today .hp-gain'), 'aucun reproche quand il ne rapporte pas');
        ev(`StatsGames.analysed = window._a; renderHomeSummary()`);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
