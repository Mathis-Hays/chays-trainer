// Lancer : node tests/screens/positionEditor.test.js   — chantier « Éditeur et photo » : position posée (PositionSetup :
// FEN, roques et prise en passant déduits, validation), Analyse depuis une FEN, éditeur « Pinceau » (pinceau, gomme,
// déplacer, glisser, roques), allers-retours Analyse ↔ éditeur, « Jouer contre le moteur » (WhatIf), FEN collée.
// Rien n'est écrit dans le répertoire. Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));

(async () => {
    const { w, errors } = await bootApp({ before(win) { win.scrollTo = () => {}; } });
    const run = s => w.eval(s);
    const json = s => JSON.parse(run(`JSON.stringify(${s})`));
    const $ = s => w.document.querySelector(s);
    const sq = name => run(`squareToIdx('${name}')`);
    const repBefore = run('JSON.stringify(openingDB)');

    // ─── POSITIONSETUP ────────────────────────────────────────────────────────
    await t('FEN : lecture tolérante, écriture, refus des FEN fausses', async () => {
        assert.strictEqual(run(`PositionSetup.fen(PositionSetup.parse(INIT_FEN))`), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        assert.strictEqual(run(`PositionSetup.fen(PositionSetup.parse('8/8/8/4k3/8/8/8/4K3'))`), '8/8/8/4k3/8/8/8/4K3 w - - 0 1', 'champs absents');
        ['', 'n\'importe quoi', '8/8/8/8/8/8/8 w - -', '9/8/8/8/8/8/8/8 w', '8/8/8/8/8/8/8/7 w', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w', '8/8/8/8/8/8/8/8 x']
            .forEach(f => assert.strictEqual(run(`PositionSetup.parse(${JSON.stringify(f)})`), null, f));
    });

    await t('roques et prise en passant déduits des pièces', async () => {
        assert.deepStrictEqual(json(`PositionSetup.castlingAvailable(PositionSetup.start().board)`), { K: true, Q: true, k: true, q: true });
        // Roi blanc déplacé en f1, tour noire de a8 absente : seuls O-O et O-O-O noirs… moins la grande.
        const p = json(`PositionSetup.normalize(PositionSetup.parse('1nbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1KNR w KQkq - 0 1'))`);
        assert.deepStrictEqual(p.castling, { K: false, Q: false, k: true, q: false });
        // Prise en passant : d7-d5 vient d'être joué, pion blanc en e5 → d6 seulement.
        const f = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
        assert.deepStrictEqual(json(`PositionSetup.epCandidates(PositionSetup.parse('${f}').board, 'w')`), [sq('d6')]);
        assert.strictEqual(run(`PositionSetup.normalize(PositionSetup.parse('${f}')).ep`), sq('d6'));
        assert.strictEqual(run(`PositionSetup.normalize(PositionSetup.parse('${f.replace(' w ', ' b ')}')).ep`), -1, 'les Noirs au trait : rien à prendre');
        assert.deepStrictEqual(json(`PositionSetup.epCandidates(PositionSetup.parse('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w').board, 'w')`), [], 'pas de pion à côté');
    });

    await t('validation : rois, pions sur la 1re ou la 8e rangée, échec du camp qui n\'a pas le trait', async () => {
        const v = f => json(`PositionSetup.validate(PositionSetup.parse(${JSON.stringify(f)}))`);
        assert.deepStrictEqual(v(INIT()), { ok: true, errors: [] });
        assert.deepStrictEqual(v('8/8/8/8/8/8/8/4K3 w - - 0 1').errors, ['Il manque le roi noir']);
        assert.deepStrictEqual(v('8/8/8/8/8/8/8/8 w').errors, ['Il manque le roi blanc', 'Il manque le roi noir']);
        assert.deepStrictEqual(v('4k3/8/8/8/8/8/8/3KK3 w').errors, ['Un seul roi blanc par camp']);
        assert.deepStrictEqual(v('3Pk3/8/8/8/8/8/8/4K3 w').errors, ['Pion sur la 8e rangée']);
        assert.deepStrictEqual(v('4k3/8/8/8/8/8/8/p3K3 w').errors, ['Pion sur la 1re rangée']);
        assert.deepStrictEqual(v('4k2R/8/8/8/8/8/8/4K3 w').errors, ['Le camp qui n’a pas le trait est en échec']);
        assert.strictEqual(v('4k2R/8/8/8/8/8/8/4K3 b').ok, true, 'échec au camp qui a le trait : permis');
        assert.strictEqual(v('8/8/8/8/8/8/8/3kK3 w').ok, false, 'rois collés');
        assert.strictEqual(run('Chess.fen(Chess.snapshot())'), run('displayedFen()'), 'l\'état affiché n\'a pas bougé');
    });
    function INIT() { return run('INIT_FEN'); }

    // ─── ANALYSE DEPUIS UNE FEN ───────────────────────────────────────────────
    const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3';
    await t('Analyse depuis une FEN : racine, coups, numérotation, navigation, pas d\'ajout au répertoire', async () => {
        run(`startGame('w'); openAnalysis([], -1, null, ${JSON.stringify(FEN)})`);
        assert.strictEqual(run('gameMode'), 'analysis');
        assert.strictEqual(run('analysis.start'), FEN);
        assert.strictEqual(run('displayedFen()').split(' ').slice(0, 4).join(' '), FEN.split(' ').slice(0, 4).join(' '));
        run(`executePlayerMove(squareToIdx('g8'), squareToIdx('f6'), null)`);       // 3… Cf6 (Noirs au trait)
        run(`executePlayerMove(squareToIdx('b1'), squareToIdx('c3'), null)`);
        assert.deepStrictEqual(json('_anLine()'), ['g8f6', 'b1c3']);
        assert.deepStrictEqual(json('analysis.tree.kids.map(k => k.san)'), ['Nf6'], 'brouillon depuis la position posée');
        const tree = $('#an-moves').textContent.replace(/\s+/g, ' ').trim();
        assert(/^1… ?/.test(tree), `numérotation : le premier coup est noir (${tree})`);
        assert(!$('#analysis-panel .ab-add'), '« Ajouter au répertoire » remplacé');
        assert(/position posée/.test($('#analysis-panel').textContent));
        run('navGo(-1)');
        assert.strictEqual(run('displayedFen()').split(' ')[0], FEN.split(' ')[0], 'retour au départ posé');
        assert.strictEqual(run('_anFinal()'), '');
        assert.strictEqual(run('JSON.stringify(openingDB)'), repBefore, 'rien n\'est écrit');
    });

    await t('Analyse : position posée sans coup légal, mat ou pat', async () => {
        run(`quitAnalysis(); openAnalysis([], -1, null, '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')`);
        assert.strictEqual(run('_anFinal()'), 'Mat');
        run(`quitAnalysis(); openAnalysis([], -1, null, '7k/8/6QK/8/8/8/8/8 b - - 0 1')`);
        assert.strictEqual(run('_anFinal()'), 'Pat');
    });

    await t('Quitter une Analyse posée sans retour : Jouer reprend la position initiale ; le brouillon normal n\'est pas mêlé', async () => {
        run('quitAnalysis()');
        assert.strictEqual(run('gameMode'), 'play');
        assert.strictEqual(run('moveHistory.length'), 0);
        assert.strictEqual(run('displayedFen()'), run('Chess.fen(Chess.start())'));
        assert.strictEqual(run('analysis.start'), null);
        run('openAnalysis([])');
        assert.strictEqual(run('analysis.start'), null);
        assert.strictEqual(run('displayedFen()'), run('Chess.fen(Chess.start())'));
    });

    // ─── ÉDITEUR ──────────────────────────────────────────────────────────────
    await t('éditeur depuis l\'Analyse : palette de 8 boutons, panneau, la position affichée', async () => {
        run(`analysisGo('e2e4,e7e5')`);
        run('PositionEditor.fromAnalysis()');
        assert.strictEqual(run('gameMode'), 'editor');
        assert.strictEqual($('#ed-palette').querySelectorAll('button').length, 8);
        assert.notStrictEqual($('#ed-palette').style.display, 'none');
        assert.strictEqual($('#analysis-panel').style.display, 'none');
        assert($('#editor-panel .ed-analyse'));
        assert.strictEqual($('#ed-fen').value, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
        assert(/Position valide/.test($('.ed-check').textContent));
    });

    await t('pinceau : poser, la même pièce retire (gomme), déplacer, glisser hors de l\'échiquier', async () => {
        const at = name => run(`board[squareToIdx('${name}')]`);
        run(`UI_ACTIONS.edBrush('Q'); handleClick(squareToIdx('d4'))`);
        assert.strictEqual(at('d4'), 'Q');
        run(`handleClick(squareToIdx('d4'))`);
        assert.strictEqual(at('d4'), '', 'gomme');
        run(`UI_ACTIONS.edColor(); UI_ACTIONS.edBrush('N'); handleClick(squareToIdx('d4'))`);
        assert.strictEqual(at('d4'), 'n', 'pinceau noir');
        run(`UI_ACTIONS.edBrush('move'); handleClick(squareToIdx('d4')); handleClick(squareToIdx('d5'))`);
        assert.strictEqual(at('d4'), ''); assert.strictEqual(at('d5'), 'n', 'déplacée');
        run(`GameModes.current().onDrop(squareToIdx('d5'), null)`);
        assert.strictEqual(at('d5'), '', 'glissée hors de l\'échiquier : retirée');
        assert.strictEqual(run('JSON.stringify(openingDB)'), repBefore);
    });

    await t('roques : décochés quand la tour part, recochés quand elle revient ; cases à cocher modifiables', async () => {
        const cr = () => json('PositionEditor.state().pos.castling');
        run(`handleClick(squareToIdx('h1')); handleClick(squareToIdx('h3'))`);
        assert.deepStrictEqual(cr(), { K: false, Q: true, k: true, q: true });
        assert($('#editor-panel input[data-arg="K"]').disabled);
        run(`handleClick(squareToIdx('h3')); handleClick(squareToIdx('h1'))`);
        assert.strictEqual(cr().K, true, 'possible de nouveau : proposé coché');
        $('#editor-panel input[data-arg="q"]').click();
        assert.strictEqual(cr().q, false);
        assert(/ KQk /.test($('#ed-fen').value));
        run(`UI_ACTIONS.edTurn('b')`);
        assert(/ b KQk /.test($('#ed-fen').value));
        run(`UI_ACTIONS.edClear()`);
        assert(/Il manque le roi blanc/.test($('.ed-check').textContent));
        assert($('#editor-panel .ed-analyse').disabled, 'Analyser désactivé tant que la position est impossible');
        run(`UI_ACTIONS.edStart()`);
        assert.strictEqual($('#ed-fen').value, run('INIT_FEN'));
    });

    await t('champ FEN : une FEN valide s\'applique en tapant, une fausse est signalée', async () => {
        const f = $('#ed-fen');
        f.value = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1';
        f.dispatchEvent(new w.Event('input', { bubbles: true }));
        assert.strictEqual(run(`board[squareToIdx('e2')]`), 'P');
        assert.strictEqual(run('turn'), 'b');
        assert.strictEqual($('#ed-fen').value, '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', 'le texte saisi reste tel quel');
        const g = $('#ed-fen');
        g.value = '4k3/8/8/8/8 b';
        g.dispatchEvent(new w.Event('input', { bubbles: true }));
        assert(g.classList.contains('is-bad'));
        assert.strictEqual(run(`board[squareToIdx('e2')]`), 'P', 'la position reste');
    });

    await t('Analyser → Analyse depuis la position ; Quitter → éditeur ; Quitter → Analyse d\'origine', async () => {
        run(`UI_ACTIONS.edStart(); handleClick(squareToIdx('e2')); handleClick(squareToIdx('e4')); UI_ACTIONS.edTurn('b')`);
        const f = $('#ed-fen').value;
        $('#editor-panel .ed-analyse').click();
        assert.strictEqual(run('gameMode'), 'analysis');
        assert.strictEqual(run('analysis.start'), f);
        run('quitAnalysis()');
        assert.strictEqual(run('gameMode'), 'editor', 'retour à l\'éditeur');
        assert.strictEqual($('#ed-fen').value, f);
        run('PositionEditor.quit()');
        assert.strictEqual(run('gameMode'), 'analysis');
        assert.strictEqual(run('analysis.start'), null, 'Analyse d\'origine, depuis le début');
        assert.deepStrictEqual(json('_anLine()'), ['e2e4', 'e7e5'], 'sur la même ligne');
    });

    await t('« Jouer contre le moteur » : WhatIf depuis la position posée, le moteur répond au camp qui n\'a pas le trait', async () => {

        w.__calls = 0; run('Engine.analyse = () => { __calls++; return { stop() {}, done: new Promise(() => {}) }; }');
        run(`PositionEditor.open('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')`);
        $('#editor-panel .ed-play').click();
        assert.strictEqual(run('gameMode'), 'analysis');
        assert.strictEqual(run('WhatIf.active()'), true);
        assert.strictEqual(run('analysis.start'), '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
        assert.strictEqual(w.__calls, 0, 'les Blancs au trait : à vous de jouer');
        run(`executePlayerMove(squareToIdx('e2'), squareToIdx('e4'), null)`);
        assert.strictEqual(w.__calls, 1, 'puis le moteur répond');
        assert(/position posée/.test($('.wi-card').textContent));
        run('quitAnalysis()');
        assert.strictEqual(run('gameMode'), 'editor');
        assert.strictEqual(run('WhatIf.active()'), false);
    });

    await t('FEN collée dans l\'Analyse : l\'éditeur s\'ouvre sur elle', async () => {
        run('PositionEditor.quit()');
        assert.strictEqual(run('gameMode'), 'analysis');
        const e = new w.Event('paste', { bubbles: true, cancelable: true });
        e.clipboardData = { items: [], getData: () => '8/8/8/4k3/8/8/8/4K2R w K - 0 1' };
        w.document.body.dispatchEvent(e);
        assert.strictEqual(run('gameMode'), 'editor');
        assert.strictEqual($('#ed-fen').value, '8/8/8/4k3/8/8/8/4K2R w K - 0 1');
        assert(e.defaultPrevented);
    });

    await t('case douteuse d\'une image : en ambre, effacée dès qu\'on la corrige', async () => {
        run(`PositionEditor.open(INIT_FEN, { doubt: [squareToIdx('d1'), squareToIdx('e8')] })`);
        assert.strictEqual(w.document.querySelectorAll('#board .sq.ed-doubt').length, 2);
        assert(/2 cases à vérifier/.test($('.ed-check').textContent));
        run(`UI_ACTIONS.edColor(); UI_ACTIONS.edBrush('K'); handleClick(squareToIdx('d1'))`);
        assert.strictEqual(w.document.querySelectorAll('#board .sq.ed-doubt').length, 1);
        run('PositionEditor.quit()');
    });

    await t('rien d\'écrit dans le répertoire, aucune erreur', async () => {
        assert.strictEqual(run('JSON.stringify(openingDB)'), repBefore);
        await tick();
        assert.deepStrictEqual(errors, []);
    });
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
