// Lancer : node tests/screens/statsOpenings.test.js   — onglet Ouvertures (avant : Statistiques › Par ouverture) : une seule fiche, sélecteur (recherche, clavier, carte),
// parties rattachées par position, filtre de niveau. Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));

// Répertoire : Italienne et Sicilienne ouverte aux Blancs (une seule réponse par position), chaque position travaillée. Archive : parties jouées dans chacune.
const ITA = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3', SIC = 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4';
const seedRep = w => w.eval(`(() => {
    const db = {}, now = Date.now();
    ['${ITA}', '${SIC}'].forEach((l, j) => { const p = l.split(' ');
        for (let k = 0; k < p.length; k += 2) {
            const path = p.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
            db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: 6, failures: j ? 0 : 4, path, ply: path.length, due: now - 864e5, interval: 3, created: 1 };
        } });
    dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
    dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
    statsColor = 'all'; statsFilter = 'all'; statsPane = 'openings';
})()`);
const PGN = {
    ita: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6',
    sic: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6',
    left: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6'
};
const seedGames = async (w, games) => {
    w.eval(`(() => {
        const list = ${JSON.stringify(games)}, end = Math.floor(Date.now() / 1000);
        const g = (x, i) => ({ rules: 'chess', uuid: (x.id || 'u') + i, end_time: end - i * 3600, time_class: 'blitz', rated: true, url: 'x', pgn: '[White "Moi"]\\n\\n' + x.pgn + ' *',
            white: { username: 'Moi', rating: 1500, result: x.r === 'w' ? 'win' : x.r === 'd' ? 'agreed' : 'resigned' }, black: { username: 'Lui', rating: 1500, result: x.r === 'w' ? 'resigned' : x.r === 'd' ? 'agreed' : 'win' } });
        window.fetch = async url => /archives$/.test(url)
            ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/11'] }) }
            : { status: 200, ok: true, json: async () => ({ games: list.map(g) }) };
        appSettings.chesscomUser = 'Moi';
        switchHomeTab('stats'); initStats();
        document.querySelector('#stats-games [data-action="statsGamesSync"]').click();
    })()`);
    await tick(500);
};

(async () => {
    const { dom, errors } = await bootApp({ before(w) { w.scrollTo = () => {}; } });
    const w = dom.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
    const names = () => $$('#so-picker .so-opt b').map(b => b.textContent);
    const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    const typed = (v) => { const i = $('#so-picker .so-p-search'); i.value = v; i.dispatchEvent(new w.Event('input', { bubbles: true })); };

    seedRep(w);
    await seedGames(w, [...Array(6).fill({ pgn: PGN.ita, r: 'l' }), { pgn: PGN.left, r: 'd' }, ...Array(4).fill({ pgn: PGN.sic, r: 'w' })]);
    w.eval(`switchHomeTab('openings')`);              // la fiche vit dans l'onglet Ouvertures (refonte, lot 3)

    await t('une seule fiche et aucune liste entière, quel que soit le nombre d\'ouvertures', () => {
        assert.strictEqual($$('#stats-lines .so-fiche').length, 1);
        assert.strictEqual($$('#stats-lines .so-head').length, 1);
        assert(!$('#stats-lines .st-line'));
        assert(!$('#so-picker'), 'sélecteur fermé par défaut');
    });

    await t('s\'ouvre d\'abord sur l\'ouverture qui coûte le plus, avec son diagnostic', () => {
        assert(/italienne/i.test($('#so-trigger b').textContent), $('#so-trigger b').textContent);
        assert.strictEqual($$('#stats-lines .so-kpi').length, 4);
        assert.strictEqual($('#stats-lines .so-kpi b').textContent, '7 %', 'une nulle sur sept parties');
        assert($('#stats-lines .so-diag'));
        assert($('#stats-lines .so-delta.down'));
    });

    await t('Réviser : une seule action pleine qui lance la séance de l\'ouverture, trois variantes en puces', () => {
        assert.strictEqual($$('#home-tab-openings .btn-primary').length, 1);
        const go = $('#stats-lines .so-review .so-go');
        assert(go && /Réviser · \d+/.test(go.textContent), 'positions dues : Réviser · N');
        assert.deepStrictEqual($$('#stats-lines .so-chip[data-action="opReview"]').map(b => b.dataset.arg.split(':')[0]), ['weak', 'line', 'unsure']);
        assert($('#stats-lines .so-chip[data-action="opFree"]'), 'Échiquier libre');
        w.eval(`window.__or = []; window.__sor = startOpeningReview; startOpeningReview = o => window.__or.push(o.color + ' ' + o.kind + ' ' + o.opening.name + ' ' + o.path.length)`);
        go.click();
        $('#stats-lines .so-chip[data-arg^="line:"]').click();
        const got = w.eval('window.__or.join("|")');
        assert(/^w due .*italienne.* \d+\|w line .*italienne/i.test(got), got);
        w.eval(`startOpeningReview = window.__sor`);
        assert.strictEqual($$('#home-tab-stats .btn-primary').length, 0, 'Progrès : toujours aucune action pleine');
    });

    await t('explorateur (modèle) : coups adverses joués, repérés ou du répertoire ; sans réponse d\'abord à égalité ; trous comptés', () => {
        const got = w.eval(`(() => {
            const db = {}, k = p => Chess.key(Chess.replay(p));
            db[k([])] = { move: 'e2e4', san: 'e4' };
            db[k(['e2e4', 'e7e5'])] = { move: 'g1f3', san: 'Nf3' };
            const nd = OpeningExplorer.node({ path: ['e2e4'], side: 'w', db, opp: { [k(['e2e4'])]: ['c7c5'] },
                rows: [{ g: { result: 'l' }, a: { path: ['e2e4', 'd7d5'] } }, { g: { result: 'w' }, a: { path: ['e2e4', 'd7d5'] } }, { g: { result: 'w' }, a: { path: ['d2d4'] } }] });
            const me = OpeningExplorer.node({ path: [], side: 'w', db, rows: [] });
            return JSON.stringify(nd.replies.map(r => [r.san, r.n, r.answered, r.seen])) + '|' + nd.turn + '|' + nd.games.n + '|' + OpeningExplorer.holes(nd) + '|' + me.turn + ' ' + me.mine.san;
        })()`);
        assert.strictEqual(got, '[["d5",2,false,false],["c5",0,false,true],["e5",0,true,false]]|opp|2|2|me e4');
    });

    await t('explorateur : la ligne coup par coup, ma réponse et son niveau, trous en ambre avec « Ajouter une réponse »', () => {
        w.eval(`window.__an = []; window.__oa = openAnalysis; openAnalysis = (p, i) => window.__an.push(p.join(' ') + '@' + i)`);
        assert($('#stats-lines .so-x'), 'explorateur dans la fiche');
        assert(!$('#stats-lines .so-tree-row'), "plus d'arbre en texte");
        assert($('#stats-lines .so-x-cov'), 'couverture affichée avec des parties');
        w.eval(`UI_ACTIONS.opExplore('e2e4 e7e5 g1f3 b8c6 f1c4')`);
        const rows = () => $$('#stats-lines .so-x .so-x-row');
        const bc5 = rows().find(r => /c5/.test(r.textContent) && r.matches('button'));
        assert(bc5, $('#stats-lines .so-x').textContent.replace(/\s+/g, ' '));
        bc5.click();
        const mine = $('#stats-lines .so-x .so-x-row.is-mine');
        assert(mine && /c3/.test(mine.textContent) && mine.querySelector('.lv-mark'), 'à mon trait : ma réponse et son niveau');
        mine.click();
        const hole = rows().find(r => r.classList.contains('is-hole') && /f6/.test(r.textContent));
        assert(hole, 'Cf6 joué en partie, sans réponse : en ambre');
        hole.querySelector('[data-action="opAdd"]').click();
        assert.strictEqual(w.eval('window.__an[0]'), 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6@7', 'Analyse sur la position après le trou');
        const crumbs = $$('#stats-lines .so-x-mv');
        assert.strictEqual(crumbs.length, 7);
        assert.strictEqual($$('#stats-lines .so-x-mv[aria-current]').length, 1);
        crumbs[4].click();
        assert.strictEqual($('#stats-lines .so-x-mv[aria-current]').dataset.arg, 'e2e4 e7e5 g1f3 b8c6 f1c4', 'le fil ramène en arrière');
        w.eval(`openAnalysis = window.__oa`);
    });

    await t('parties rattachées par position, coup joué à la place, positions de la fiche', () => {
        assert(/O-O/.test($('#stats-lines .so-swap').textContent));
        assert($('#stats-lines .st-ibtn.pri'));
        assert($$('#stats-lines .so-games').some(el => /parties/.test(el.textContent)));
    });

    await t('sélecteur : recherche sans accents, par nom ou par coups ; Échap referme et rend le focus', () => {
        $('#so-trigger').click();
        assert($('#so-picker') && $('#so-backdrop'));
        assert.strictEqual($('#so-trigger').getAttribute('aria-expanded'), 'true');
        const all = names().length;
        typed('SÍCIL');
        assert(names().length >= 1 && names().length < all, names().join(','));
        assert(names().every(x => /sicilienne/i.test(x)), names().join(','));
        typed('zzzz');
        assert(/Aucune ouverture/.test($('#so-picker .so-p-body').textContent));
        typed('');
        key($('#so-picker .so-p-search'), 'Escape');
        assert(!$('#so-picker') && !$('#so-backdrop'));
        assert.strictEqual(w.document.activeElement.id, 'so-trigger');
    });

    await t('choisir au clavier change la fiche sans redessiner la page', () => {
        const scopeBar = $('#op-rep').firstElementChild;
        $('#so-trigger').click();
        typed('SÍCIL');
        key($('#so-picker .so-p-search'), 'ArrowDown');
        key($('#so-picker .so-p-search'), 'Enter');
        assert(!$('#so-picker'));
        assert(/sicilienne/i.test($('#so-trigger b').textContent));
        assert.strictEqual($('#op-rep').firstElementChild, scopeBar, 'le reste de la page n\'est pas reconstruit');
    });

    await t('flèches : passe à l\'ouverture suivante à travailler, et revient', () => {
        const a = $('#so-trigger b').textContent;
        $('#stats-lines [data-action="statsOpStep"][data-arg="1"]').click();
        assert.notStrictEqual($('#so-trigger b').textContent, a);
        $('#stats-lines [data-action="statsOpStep"][data-arg="-1"]').click();
        assert.strictEqual($('#so-trigger b').textContent, a);
    });

    await t('carte : un point par ouverture travaillée jouée, toucher ouvre sa fiche', () => {
        $('#so-trigger').click();
        $('#so-picker [data-action="statsOpMode"][data-arg="map"]').click();
        const pts = $$('#so-picker .so-point');
        assert.strictEqual(pts.length, 2);
        const other = pts.find(p => !p.classList.contains('sel'));
        other.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        assert(!$('#so-picker'));
        assert(/italienne/i.test($('#so-trigger b').textContent));
        $('#so-trigger').click();
        $('#so-picker [data-action="statsOpMode"][data-arg="list"]').click();
        key($('#so-picker .so-p-search'), 'Escape');
    });

    await t('période : celle de la barre de contexte, recalcule sans changer d\'ouverture', () => {
        const a = $('#so-trigger b').textContent;
        assert(!$('#stats-lines [data-action="statsOpPeriod"]'), 'plus de période propre à la fiche');
        assert($('#op-filters [data-dd-action="statsInPeriod"]'), 'période dans la barre de contexte');
        w.eval(`UI_ACTIONS.statsInPeriod('3')`);
        assert.strictEqual($('#so-trigger b').textContent, a);
        w.eval(`UI_ACTIONS.statsInPeriod('12')`);
    });

    await t('index : une ligne par ouverture (miniature, niveaux, écart) ; toucher une ligne ouvre sa fiche à sa place', () => {
        w.eval('UI_ACTIONS.opBack()');                                // les tests précédents ont ouvert une fiche
        const rows = $$('#stats-lines .so-mirror .so-mr');
        assert(rows.length >= 2);
        assert(rows[0].classList.contains('on') && /italienne/i.test(rows[0].textContent), 'la plus coûteuse en tête, ouverte');
        assert(rows[0].querySelector('.st-mini') && rows[0].querySelector('.lv-bar') && rows[0].querySelector('.so-mr-r small.down'));
        assert(!$('#stats-lines .so-layout').classList.contains('is-open'), "l'index d'abord");
        const sic = rows.find(r => /sicilienne/i.test(r.textContent));
        sic.click();
        assert(/sicilienne/i.test($('#so-trigger b').textContent));
        assert($('#stats-lines .so-layout').classList.contains('is-open'), "la fiche prend la place de l'index");
        assert($('#stats-lines .so-mr.on') && /sicilienne/i.test($('#stats-lines .so-mr.on').textContent));
        $('#stats-lines [data-action="opBack"]').click();
        assert(!$('#stats-lines .so-layout').classList.contains('is-open'), "« ‹ Ouvertures » ramène à l'index");
        rows[0].dataset.arg && w.eval(`UI_ACTIONS.statsOpPick(${JSON.stringify(rows[0].dataset.arg)})`);
    });

    await t('index : barre de niveaux filtrante et vue Carte', () => {
        const seg = $('#stats-lines .so-fbar-bar button');
        assert(seg, 'barre de niveaux cliquable');
        const lv = seg.dataset.arg;
        seg.click();
        assert.strictEqual(w.eval('statsFilter'), lv);
        assert($('#stats-lines .so-fbar-leg [data-arg="all"]'), '« Tout afficher » pendant le filtre');
        $('#stats-lines .so-fbar-leg [data-arg="all"]').click();
        assert.strictEqual(w.eval('statsFilter'), 'all');
        assert(!$('#stats-lines .stats-chip'), 'plus de puces de niveau');
        $('#stats-lines [data-action="statsOpView"][data-arg="map"]').click();
        assert($('#stats-lines .so-ix-map .so-map') && !$('#stats-lines .so-mirror'));
        $('#stats-lines [data-action="statsOpView"][data-arg="list"]').click();
        assert($('#stats-lines .so-mirror'));
    });

    await t('« À faire » : l\'ouverture qui coûte le plus mène à sa fiche, onglet Ouvertures', () => {
        w.eval(`switchHomeTab('stats'); statsPane = 'overview'; initStats()`);
        const go = $('#stats-todo [data-action="statsTodoGo"][data-arg^="openings|"]');
        assert(go, 'constat d\'ouverture présent');
        assert(/italienne/i.test(go.closest('.st-todo-card').textContent));
        go.click();
        assert(!$('#home-tab-openings').classList.contains('hidden'), 'onglet Ouvertures affiché');
        assert(/italienne/i.test($('#so-trigger b').textContent));
        assert.strictEqual($$('#home-tab-stats .btn-primary').length, 0, 'Progrès : aucune action pleine (refonte, lot 2)');
    });

    await t('filtre de niveau : seules les ouvertures qui en ont restent, ouverture concernée ouverte', () => {
        w.eval(`statsFilter = 'all'; switchHomeTab('stats'); initStats()`);
        $('.st-legend .st-lg[data-arg="mastered"]').click();
        assert.strictEqual(w.eval('statsFilter'), 'mastered');
        assert(/sicilienne/i.test($('#so-trigger b').textContent), $('#so-trigger b').textContent);
        w.eval(`statsFilter = 'all'; initStats()`);
    });

    await t('coups de la fiche : cinq lignes situées par les coups précédents, le reste replié', () => {
        w.eval(`(() => {
            const p = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8 f1e1 a7a6 h2h3 h7h6 b1d2 b7b6 d2f1 c8b7 f1g3 d8d7 a2a4'.split(' '), db = {};
            for (let k = 0; k < p.length; k += 2) { const path = p.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
                db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: 6, failures: 4 - k / 8, path, ply: path.length, due: Date.now() + 864e5, interval: 3, created: 1 }; }
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db)); statsColor = 'all'; statsFilter = 'all'; switchHomeTab('openings');
        })()`);
        $('#so-trigger').click();
        typed('pianissimo');
        key($('#so-picker .so-p-search'), 'ArrowDown');
        key($('#so-picker .so-p-search'), 'Enter');
        const rows = () => $$('#stats-lines .so-pos .st-row:not(.st-row-hd)'), more =() => $('#stats-lines .so-pos .st-more');
        assert.strictEqual(rows().length, 5);
        const total = Number(/^(\d+) coups/.exec($('#stats-lines .so-pos .st-sub').textContent)[1]);
        assert(total > 5);
        assert.strictEqual(more().textContent, `Afficher les ${total - 5} autres coups`);
        assert(rows().some(r => /^Après … \d+/.test(r.querySelector('.so-after').textContent)), 'quatre demi-coups au plus, marqués coupés');
        more().click();
        assert.strictEqual(rows().length, total);
        assert.strictEqual(more().textContent, 'Réduire');
        more().click();
        assert.strictEqual(rows().length, 5);
    });

    await t('partie hors répertoire : fiche sans maîtrise, classée à part', async () => {
        seedRep(w);
        await seedGames(w, Array(3).fill({ id: 'hors', pgn: '1. d4 d5 2. c4', r: 'w' }));
        w.eval(`switchHomeTab('openings')`);
        $('#so-trigger').click();
        assert(/Hors répertoire/.test($('#so-picker .so-p-body').textContent));
        key($('#so-picker .so-p-search'), 'Escape');
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
