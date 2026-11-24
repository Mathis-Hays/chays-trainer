// Lancer : node tests/screens/endgameLibrary.test.js   — Finales « Bibliothèque » (lot 7) : « À suivre », puces de catégorie,
// aperçu sans lancement, jauge de séance, verdict « avant → après », origine du jugement, théorie repliée.
// Charge index.html entier dans jsdom, comme boot.test.js ; aucun réseau (juge commun simulé).
const { bootApp } = require('../_app.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ROOT = path.join(__dirname, '..', '..');

// Progression simulée (chessTrainer_endgames) : deux mats réussis (dont un sans faute), un en cours, deux finales de pions réussies.
const PROGRESS = {
    kqk: { tries: 1, wins: 1, perfect: true, best: 9, last: 1 },
    krk: { tries: 2, wins: 1, perfect: false, best: 14, last: 1 },
    kbnk: { tries: 3, wins: 0, perfect: false, best: 0, last: 1 },
    'kpk-carre': { tries: 1, wins: 1, perfect: true, best: 5, last: 1 },
    'rook-lucena': { tries: 1, wins: 1, perfect: false, best: 8, last: 1 }
};

let wide = false;                                   // largeur simulée : ≥ 920 px (colonne d'aperçu) ou non (panneau du bas)
async function boot() {
    const { dom, errors } = await bootApp({ before(w) {
        w.Element.prototype.scrollIntoView = function () { w.__scrolled = this.id; };
        w.localStorage.setItem('chessTrainer_endgames', JSON.stringify(PROGRESS));
        w.matchMedia = q => ({ matches: wide && /min-width: 920px/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    } });
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s), $$: s => [...dom.window.document.querySelectorAll(s)] };
}

(async () => {
    const { w, errors, $, $$ } = await boot();
    // Juge commun simulé : verdict « nulle » exact, sans réseau ni moteur.
    w.eval(`EndgameJudge.probe = () => Promise.resolve({ wdl: 0, source: 'syzygy', exact: true, moves: [] });
            EndgameJudge.judgeMove = () => Promise.resolve({ before: 0, after: 0, source: 'syzygy', exact: true });`);
    w.eval(`switchHomeTab('endgame')`);

    await t('« À suivre » est le premier exercice non réussi du catalogue ; l\'accueil a exactement un .btn-primary', () => {
        const expected = w.eval(`ENDGAME_CATEGORIES.flatMap(c => ENDGAME_EXERCISES.filter(e => e.cat === c.id)).find(e => !(${JSON.stringify(PROGRESS)}[e.id] || {}).wins).id`);
        assert.strictEqual(expected, 'krrk');
        const go = $('#eg-preview .eg-go');
        assert.strictEqual(go.dataset.action, 'startEndgame');
        assert.strictEqual(go.dataset.arg, expected);
        assert(/À suivre/.test($('#eg-preview .st-eyebrow').textContent));
        assert($('#eg-preview .st-mini'), 'mini-position de « À suivre »');
        assert.strictEqual($$('#home-tab-endgame .btn-primary').length, 1);
    });

    await t('puces de catégorie (.count) : réussis / total exacts par catégorie, et saut vers la section', () => {
        const chips = $$('#endgame-panel .eg-chips .eg-chip');
        const cats = w.eval('ENDGAME_CATEGORIES.map(c => [c.id, c.label, ENDGAME_EXERCISES.filter(e => e.cat === c.id).length])');
        assert.strictEqual(chips.length, cats.length);
        const won = { mats: 2, pions: 1, tours: 1 };
        cats.forEach(([id, label, total], i) => {
            assert.strictEqual(chips[i].dataset.action, 'egJump');
            assert.strictEqual(chips[i].dataset.arg, id);
            assert.strictEqual(chips[i].getAttribute('aria-label'), `${label} : ${won[id] || 0} sur ${total}`);
            assert.strictEqual(chips[i].querySelector('.count').textContent, `${won[id] || 0} / ${total}`);
        });
        assert.strictEqual(chips[0].getAttribute('aria-current'), 'true', 'catégorie de « À suivre »');
        chips[2].click();
        assert.strictEqual(w.__scrolled, 'eg-sec-tours');
        assert.strictEqual(chips[2].getAttribute('aria-current'), 'true');
    });

    await t('une place, un sens : étoiles toujours à droite, essais dessous, difficulté en crans sous le titre', () => {
        const end = id => $(`.eg-card[data-arg="${id}"] .eg-card-end`);
        // Sans étoiles enregistrées (progression d'avant le lot 3), une réussite compte une étoile.
        assert.strictEqual(end('kqk').querySelector('.eg-stars').getAttribute('aria-label'), '1 étoile sur 3');
        assert.strictEqual(end('kbnk').querySelector('.eg-stars.is-none').getAttribute('aria-label'), 'Pas encore réussie');
        assert.strictEqual(end('kbnk').querySelector('.eg-tries').textContent, '3 essais');
        assert.strictEqual(end('krrk').querySelector('.eg-stars.is-none .on'), null);
        assert(!end('krrk').querySelector('.eg-crans'), 'la difficulté n\'est jamais à droite');
        assert.strictEqual($('.eg-card[data-arg="krrk"] .eg-card-mt .eg-crans').getAttribute('aria-label'), 'Difficulté 1 sur 5');
        // Objectif en notation de résultat, camp par le roi du jeu actif (jamais un glyphe Unicode).
        const row = $('.eg-card[data-arg="kpk-carre-def"]');
        assert.strictEqual(row.querySelector('.eg-goal').textContent, '½Tenir la nulle');
        assert(row.querySelector('.eg-king[data-glyph="k"]'));
        assert(!/[♔♕♖♗♘♙♚♛♜♝♞♟]/.test($('#endgame-panel').textContent));
        assert.deepStrictEqual(['kqk', 'kpk-carre', 'kpk-noir'].map(id => $(`.eg-card[data-arg="${id}"] .eg-goal-tok`).textContent), ['#', '1-0', '0-1']);
        assert(!/Annuler/.test($('#endgame-panel').textContent), 'plus de « Annuler » pour la nulle');
        // Miniatures recadrées sur la zone des pièces dans les lignes, échiquier entier dans l'aperçu.
        assert($('.eg-card[data-arg="kqk"] .st-mini.is-crop[data-at="b1"]'));
        assert(!$('#eg-preview .st-mini.is-crop'));
    });

    await t('règle de cases par catégorie et légende qui filtre', () => {
        const ruler = $('#eg-sec-mats .eg-ruler');
        assert.strictEqual(ruler.querySelectorAll('i').length, 5);
        assert.strictEqual(ruler.getAttribute('aria-label'), '2 réussies sur 5, 0 étoile sur 15');
        assert.deepStrictEqual([...ruler.querySelectorAll('i')].map(i => i.className.trim()), ['s1', 's1', 'cur', '', 't']);
        const leg = $$('#endgame-seg .so-leg-b');
        assert.deepStrictEqual(leg.map(b => b.dataset.arg), ['all', 'todo', 'tried', 'done']);
        assert.deepStrictEqual(leg.map(b => b.querySelector('b').textContent), ['43', '38', '1', '4']);
        leg[2].click();
        assert.deepStrictEqual($$('#endgame-panel .eg-card').map(c => c.dataset.arg), ['kbnk']);
        $('#endgame-seg .so-leg-b[data-arg="all"]').click();
        assert($$('#endgame-panel .eg-card').length > 1);
    });

    await t('un clic sur une ligne ouvre l\'aperçu sans appeler startEndgame (panneau du bas, puis colonne de droite)', () => {
        w.eval('window.__starts = []; window.__start = startEndgame; startEndgame = id => window.__starts.push(id);');
        $('.eg-card[data-arg="rook-philidor"]').click();
        assert.deepStrictEqual(w.eval('window.__starts.length'), 0);
        const sheet = $('#eg-sheet .eg-sheet[role="dialog"]');
        assert(sheet, 'panneau du bas');
        assert.strictEqual(sheet.querySelector('.eg-go').dataset.arg, 'rook-philidor');
        assert.strictEqual(w.document.activeElement, sheet.querySelector('.eg-go'));
        sheet.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert(!$('#eg-sheet'), 'Échap ferme le panneau');

        wide = true;
        $('.eg-card[data-arg="tours-tarrasch"]').click();
        assert(!$('#eg-sheet'));
        assert.strictEqual(w.eval('window.__starts.length'), 0);
        assert.strictEqual($('#eg-preview .eg-go').dataset.arg, 'tours-tarrasch');
        assert(/Choisi/.test($('#eg-preview .st-eyebrow').textContent));
        assert($('.eg-card[data-arg="tours-tarrasch"]').classList.contains('is-sel'));
        assert.strictEqual($$('#home-tab-endgame .btn-primary').length, 1);
        $('#eg-preview .eg-go').click();
        assert.strictEqual(w.eval('JSON.stringify(window.__starts)'), '["tours-tarrasch"]', 'seul « Commencer » lance');
        w.eval('startEndgame = window.__start;');
        wide = false;
    });

    const ticks = () => $$('#tr-progress .eg-ticks i');
    await t('jauge : autant de graduations que hold, keep ou maxMoves', () => {
        for (const id of ['kpk-carre-def', 'tours-tarrasch', 'kqk', 'pions-eloigne', 'rook-philidor']) {
            w.eval(`startEndgame('${id}')`);
            const ex = w.eval(`ENDGAME_BY_ID['${id}']`);
            const want = ex.goal === 'draw' ? ex.hold : ex.keep || ex.maxMoves;
            assert.strictEqual(ticks().length, want, id);
            assert.strictEqual($('#tr-progress .eg-ticks').getAttribute('aria-valuemax'), String(want));
            assert(!$('#tr-progress').hidden, 'jauge dans la marge de l\'échiquier');
        }
    });

    await t('erreur jugée : verdict « ½ → 1-0 », coup fautif en vermillon et fléché, « Reprendre ce coup » seule action pleine', () => {
        w.eval(`startEndgame('kpk-carre-def')`);
        w.eval(`executePlayerMove(squareToIdx('h3'), squareToIdx('h2'))`);       // hors du carré : le pion passe
        const card = $('#endgame-card');
        assert(card.classList.contains('is-err'));
        assert.strictEqual(card.querySelector('.eg-verdict .eg-vpill.is-from').textContent, '½');
        assert.strictEqual(card.querySelector('.eg-verdict .eg-vpill.is-to').textContent, '1-0');
        assert.strictEqual(card.querySelector('.eg-vsay').textContent, 'La nulle devient une perte');
        assert.strictEqual(w.eval('JSON.stringify(GameModes.current().engineArrows().map(a => a.color))'), '["red"]');
        assert.deepStrictEqual(ticks().map(i => i.className), ['bad', '', '', '', '', '']);
        const primaries = card.querySelectorAll('.btn-primary');
        assert.strictEqual(primaries.length, 1);
        assert.strictEqual(primaries[0].dataset.action, 'undoEndgameMove');
        assert(!card.querySelector('.vbadge'), 'calcul exact : aucune pastille d\'origine');
        assert(!card.querySelector('.eg-rule'), 'le message n\'est que dans la barre d\'état');
        primaries[0].click();
        assert.strictEqual(w.eval('GameModes.current().engineArrows().length'), 0, 'coup repris : plus de flèches');
        assert(!$('#endgame-card .eg-verdict'), 'coup annulé : plus de verdict');
        assert.deepStrictEqual(ticks().map(i => i.className), ['', '', '', '', '', '']);
    });

    await t('origine du jugement : silencieuse quand le verdict est exact, annoncée quand il est estimé (tireté)', () => {
        w.eval(`startEndgame('rook-philidor')`);
        const badge = () => $('#endgame-card .eg-src');
        w.eval(`endgameState.source = 'syzygy'; endgameState.exact = true; renderEndgameCard()`);
        assert.strictEqual(badge(), null);
        assert(w.eval(`_egSourceBadge('syzygy', true)`).includes('Tables Syzygy · exact'));
        Object.defineProperty(w.navigator, 'onLine', { get: () => false, configurable: true });
        assert(w.eval(`_egSourceBadge('syzygy', true)`).includes('Réponse gardée · exact'));
        Object.defineProperty(w.navigator, 'onLine', { get: () => true, configurable: true });
        w.eval(`endgameState.source = 'engine'; endgameState.exact = false; renderEndgameCard()`);
        assert.strictEqual(badge().textContent, 'Moteur · verdict estimé');
        assert(badge().classList.contains('is-dashed'));
    });

    await t('théorie repliée pendant la séance, dépliée par « Théorie », ouverte d\'office à la fin', () => {
        w.eval(`startEndgame('rook-philidor')`);
        const btn = $('#endgame-card .eg-theory-btn');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
        assert($('#endgame-card .eg-theory').hidden);
        btn.click();
        assert.strictEqual($('#endgame-card .eg-theory-btn').getAttribute('aria-expanded'), 'true');
        assert(!$('#endgame-card .eg-theory').hidden);
        w.eval(`startEndgame('rook-philidor'); _egFinish('Nulle assurée.')`);
        assert(!$('#endgame-card .eg-theory-btn'));
        assert(!$('#endgame-card .eg-theory').hidden);
        const primaries = $$('#endgame-card .btn-primary');
        assert.deepStrictEqual(primaries.map(b => b.dataset.action), ['nextEndgame']);
        assert(ticks().length === 0 || ticks().every(i => i.className !== 'bad'));
    });

    await t('fin : vos coups contre le plus court (par), coups de trop en laiton ; flèche laiton de la méthode après une erreur', async () => {
        w.eval(`startEndgame('kqk'); endgameState.par = 9; endgameState.moves = 11; endgameState.hints = 1; _egFinish('Échec et mat ! Bien joué.')`);
        const rows = $$('#endgame-card .eg-par-row');
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].querySelectorAll('.eg-par-bar i.over').length, 2);
        assert.strictEqual(rows[1].querySelectorAll('.eg-par-bar i.on').length, 9);
        assert.strictEqual($('#endgame-card .eg-par').getAttribute('aria-label'), 'Vous : 11 coups ; le plus court : 9');
        assert(!$('#endgame-card .eg-kpis'), 'plus de cases Coups / Erreurs / Indices');
        assert(!/Échec et mat/.test($('#endgame-card').textContent), 'le message reste dans la barre d\'état');
        assert($('#endgame-card.is-ok') && $('#tr-progress .eg-ticks i.ok'), 'réussite en laiton');
        // Coup refusé : la méthode, lue dans les tables sur la position d'avant, en flèche laiton.
        w.eval(`EndgameJudge.probe = () => Promise.resolve({ wdl: 0, source: 'kpk', exact: true, moves: [{ uci: 'h3g4' }] })`);
        w.eval(`startEndgame('kpk-carre-def')`);
        w.eval(`executePlayerMove(squareToIdx('h3'), squareToIdx('h2'))`);
        await new Promise(r => setTimeout(r, 0));
        assert.strictEqual(w.eval('JSON.stringify(GameModes.current().engineArrows().map(a => a.color))'), '["red","gold"]');
        assert($('#endgame-card .eg-arrow-key .is-best'));
    });

    await t('endgameSelfTest reste vert (aucune FEN modifiée)', () => {
        const bad = w.eval('endgameSelfTest().filter(r => !r.ok).map(r => r.id)');
        assert.strictEqual(JSON.stringify(bad), '[]');
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
