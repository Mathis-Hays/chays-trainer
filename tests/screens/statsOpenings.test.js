// Lancer : node tests/screens/statsOpenings.test.js   — onglet Ouvertures (avant : Statistiques › Par ouverture) : une seule fiche, sélecteur (recherche, clavier, carte),
// parties rattachées par position, filtre de niveau. Charge index.html entier dans jsdom.
const { bootApp, ROOT } = require('../_app.js');
const fs = require('fs'), path = require('path');
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
        assert($('#stats-lines .so-diag'));
        assert(!$('#stats-lines .so-kpi'), 'plus de rangée de quatre chiffres');
    });

    await t('score face à l\'attendu dit en Elo : une carte « Votre niveau dans cette ouverture », fusionnée avec « Niveau joué »', () => {
        const perf = Math.round(1500 + 400 * Math.log10((.5 / 7) / (1 - .5 / 7))), digits = v => v.replace(/\D/g, '');
        const card = $('#stats-lines .so-lv');
        assert(card && /Votre niveau dans cette ouverture/.test(card.querySelector('h5').textContent));
        assert.strictEqual(digits(card.querySelector('.so-lv-big b').textContent), String(perf), 'une nulle et six défaites contre des 1500');
        const gap = card.querySelector('.so-lv-gap.down');
        assert(gap && digits(gap.textContent) === String(1500 - perf) && /sous votre Elo/.test(gap.textContent), gap && gap.textContent);
        assert(/7 parties · 7 % des points/.test(card.textContent), card.textContent);
        assert(card.querySelector('.so-lv-scale'), 'la règle « ici » / « vous »');
        assert(/Vous y jouez comme un .+ sous votre Elo/.test($('#stats-lines .so-head .so-say').textContent), "la phrase de l'en-tête le dit aussi");
        const titles = $$('#stats-lines .so-fiche h5').map(h => h.textContent);
        assert(!titles.some(x => /Score face|Niveau joué/.test(x)), titles.join(' | '));
        const tile = $$('#stats-lines .so-mr').find(r => /italienne/i.test(r.textContent));
        assert(/−\d[\d\s ]* Elo/.test(tile.querySelector('.so-elo.down').textContent), "l'index dit l'écart en Elo, plus en %");
        assert(!/ %$/.test(tile.querySelector('.so-elo').textContent));
    });

    await t('sections : dix blocs ramenés à six, en trois onglets (Ligne, En partie, Mes coups)', () => {
        const tabs = $$('#stats-lines .so-tabs [role="tab"]');
        assert.deepStrictEqual(tabs.map(b => b.dataset.arg), ['line', 'games', 'moves']);
        assert.strictEqual($('#stats-lines .so-tabs [aria-selected="true"]').dataset.arg, 'line', 'Ligne par défaut');
        const pane = id => $(`#stats-lines .so-pane[data-tab="${id}"]`), h5 = id => [...pane(id).querySelectorAll('.so-card h5')].map(h => h.textContent);
        assert.deepStrictEqual(h5('line'), ['Vos oublis en partie', 'Explorateur'], 'les oublis juste après l\'en-tête');
        assert.deepStrictEqual(h5('games'), ['Votre niveau dans cette ouverture', 'Jusqu’où va votre préparation']);
        assert.deepStrictEqual(h5('moves'), ['Mes coups, du plus fragile au plus sûr']);
        assert(pane('games').hidden && pane('moves').hidden && !pane('line').hidden);
        const all = $$('#stats-lines .so-fiche h5').map(h => h.textContent).join(' | ');
        assert(!/Score par mois|Où le répertoire s'arrête|Réponses adverses|Coups joués à la place|Vos coups à connaître|Votre préparation$/.test(all), all);
        assert(!$('#stats-lines .so-tr'), 'la carte « Réponses adverses » est supprimée : l\'explorateur la couvre');
        assert(/Mois par mois/.test($('#stats-lines .so-lv .so-months-h').textContent), '« Mois par mois » dans la carte Elo');
        assert($$('#stats-lines .so-lv .so-months i').length === 12, 'douze mois');
        const prep = $('#stats-lines .so-prep');
        assert(prep.querySelector('.so-ruler i.me'), 'règle de coups : un point par oubli');
        assert(/Répertoire suivi/.test(prep.textContent) && /Réponses couvertes/.test(prep.textContent) && /Sortie moyenne : coup \d+/.test(prep.textContent), '« Votre préparation » absorbée');
        const head = $('#stats-lines .so-head'), fiche = head.parentElement;
        assert.strictEqual(fiche.children[1], $('#stats-lines .so-tabs'), 'en-tête, puis les onglets');
        const page = $('#stats-lines .so-fiche').innerHTML;
        tabs[1].click();
        assert(!pane('games').hidden && pane('line').hidden, 'En partie affiché');
        assert.strictEqual($('#stats-lines .so-fiche').innerHTML.replace(/ hidden=""/g, '').replace(/aria-selected="\w+"|tabindex="-?\d"|tr-seg-btn( active)?/g, ''),
            page.replace(/ hidden=""/g, '').replace(/aria-selected="\w+"|tabindex="-?\d"|tr-seg-btn( active)?/g, ''), 'changer d\'onglet ne repeint pas');
        tabs[1].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.strictEqual($('#stats-lines .so-tabs [aria-selected="true"]').dataset.arg, 'moves', 'flèche droite : onglet suivant');
        assert.strictEqual(w.document.activeElement.id, 'so-t-moves');
        w.eval(`UI_ACTIONS.opTab('line')`);
        assert(!pane('line').hidden);
    });

    await t('« Vos oublis en partie » : position, deux flèches (joué / prévu), « Réviser ce coup » lance la révision de cette position', () => {
        const slip = $('#stats-lines .so-slips .so-swap');
        assert(/O-O/.test(slip.textContent) && /joué/.test(slip.textContent) && /c3/.test(slip.querySelector('.so-slip-mv.is-planned').textContent), slip.textContent);
        assert(slip.querySelector('.so-ar-svg .is-played line') && slip.querySelector('.so-ar-svg .is-planned line'), 'deux flèches');
        assert(slip.querySelector('.st-mini'), 'la position');
        const go = slip.querySelector('[data-action="opReviewMove"]');
        assert(go && /Réviser ce coup/.test(go.textContent) && !go.classList.contains('btn-primary'));
        w.eval(`window.__rq = null; window.__srq = startReviewQueue; startReviewQueue = (items, back) => { window.__rq = JSON.stringify([items, back]); }`);
        go.click();
        const [items, back] = JSON.parse(w.eval('window.__rq'));
        w.eval('startReviewQueue = window.__srq');
        assert.strictEqual(back, 'openings', 'la séance revient aux Ouvertures');
        assert.strictEqual(items.length, 1);
        const pos = w.eval(`Chess.key(Chess.replay('e2e4 e7e5 g1f3 b8c6 f1c4 f8c5'.split(' ')))`);
        assert.deepStrictEqual(items[0], { color: 'w', key: pos }, 'la position où 4. c3 était prévu');
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

    await t('Mes coups, allégée : miniature (aperçu), coup, niveau, un bouton ; parties et maîtrise passent dans l\'aperçu', () => {
        const row = $('#stats-lines .so-pos .so-my');
        assert(row.querySelector('.so-my-b .st-mini') && row.querySelector('.so-my-b').dataset.action === 'statsPreview');
        assert(row.querySelector('.st-lvl .lv-mark') && row.querySelector('.st-ibtn.pri[data-action="statsTrain"]'));
        assert(!$('#stats-lines .so-pos .so-games') && !$('#stats-lines .so-pos .st-when') && !$('#stats-lines .so-pos .st-row-hd'), 'six colonnes ramenées à quatre');
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
        assert(rows[0].querySelector('.st-mini') && rows[0].querySelector('.lv-bar') && rows[0].querySelector('.so-elo.down'));
        assert.strictEqual(rows[0].querySelector('.so-mr-st').textContent, 'Perd des points', 'une seule phrase d\'état');
        assert(/coups? à revoir|à réviser|à jour/i.test(rows.find(r => /sicilienne/i.test(r.textContent)).querySelector('.so-mr-st').textContent));
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
        const rows = () => $$('#stats-lines .so-pos .so-my'), more =() => $('#stats-lines .so-pos .st-more');
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

    await t('rang visible quand la fiche est à côté : lignes non tassées, sceau sur la miniature, index collant, « Maître » lisible en sombre', () => {
        const css = fs.readFileSync(path.join(ROOT, 'css/screens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const wide = css.slice(css.indexOf('@container stats (min-width: 980px)'));
        const block = wide.slice(0, wide.indexOf('\n}'));
        const mr = /\n\s*\.so-mr \{([^}]*)\}/.exec(block);
        assert(mr && /flex-shrink:\s*0/.test(mr[1]), 'la colonne qui défile ne tasse plus les lignes');
        assert(/min-height:\s*60px/.test(mr[1]));
        const cis = /contain-intrinsic-size:\s*auto\s+(\d+)px/.exec(mr[1]);
        assert(cis && Number(cis[1]) >= 60, 'taille réservée au moins celle de la ligne');
        assert(/\.st-body \.st-card-flush \{[^}]*overflow:\s*clip/.test(css), 'overflow: clip, sinon position: sticky ne colle pas');
        assert(!/\.st-body \.st-card-flush \{[^}]*overflow:\s*hidden/.test(css));
        const r2 = css.indexOf('.op-rank.is-r2 {'), dark = css.indexOf('[data-theme="dark"] .op-rank.is-r2, .vel-dark .op-rank.is-r2 { color: var(--brand-brass); }');
        assert(r2 > 0 && dark > r2, '« Maître » en sombre : la règle vient après .is-r2');
        const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        const lum = h => { const [r, g, b] = hex(h); return .2126 * r + .7152 * g + .0722 * b; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
        const base = fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8'), v = n => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(base)[1];
        assert(ratio(v('brand-brass'), v('brand-walnut')) >= 4.5, 'laiton clair sur noyer : 4,5:1');
        assert(ratio(v('brand-brass-deep'), v('brand-walnut')) < 4.5, 'le laiton foncé ne passait pas');
        // Le rang est dans la carte de l'index sans dépendre de sa hauteur : un sceau posé sur la miniature.
        const seal = $('#stats-lines .so-mr .so-mr-b .op-rank.so-seal');
        assert(seal, 'sceau sur la miniature');
        assert(/\.so-mr-b \.op-rank\.so-seal \{[^}]*position:\s*absolute/.test(css));
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
