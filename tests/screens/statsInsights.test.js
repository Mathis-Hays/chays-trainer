// Lancer : node tests/screens/statsInsights.test.js   — Statistiques › Parties : barre de filtres commune, vues Bilan, Temps et Répertoire, horloge de la fiche d'ouverture.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 500) => new Promise(r => setTimeout(r, ms));

const clk = (m, s) => `{[%clk 0:0${m}:${s}]}`;
const PGN = `1. e4 ${clk(2, 58)} 1... e5 ${clk(2, 50)} 2. Nf3 ${clk(2, 56)} 2... Nc6 ${clk(2, 40)} 3. Bc4 ${clk(2, 54)} 3... Bc5 ${clk(2, 30)} 4. c3 ${clk(2, 50)} 4... Nf6 ${clk(2, 20)} 5. d3 ${clk(2, 40)} 5... d6 ${clk(2, 10)} 6. O-O ${clk(2, 30)} 6... O-O ${clk(2, 0)}`;

(async () => {
    const { dom, errors } = await bootApp({ before(w) { w.scrollTo = () => {}; } });
    const w = dom.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
    w.eval(`(() => {
        const line = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3'.split(' '), db = {}, now = Date.now();
        for (let k = 0; k < line.length; k += 2) {
            const path = line.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
            db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: 6, failures: 1, path, ply: path.length, due: now + 864e5, interval: 3, created: 1 };
        }
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        const end = Math.floor(now / 1000);
        const game = i => ({ rules: 'chess', uuid: 'g' + i, end_time: end - i * 7200, time_class: i % 4 ? 'blitz' : 'rapid', time_control: '180', rated: true, url: 'x',
            pgn: '[White "Moi"]\\n\\n' + ${JSON.stringify(PGN)} + ' *',
            white: { username: 'Moi', rating: 1500 + (i % 2 ? 8 : -8), result: i % 2 ? 'win' : 'timeout' }, black: { username: 'Lui', rating: 1500, result: i % 2 ? 'resigned' : 'win' } });
        window.fetch = async url => /archives$/.test(url)
            ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/11'] }) }
            : { status: 200, ok: true, json: async () => ({ games: Array.from({ length: 24 }, (_, i) => game(i)) }) };
        appSettings.chesscomUser = 'Moi';
        statsColor = 'all'; statsFilter = 'all'; statsPane = 'games';
        switchHomeTab('stats'); initStats();
        document.querySelector('#stats-games [data-action="statsGamesSync"]').click();
    })()`);
    await tick();
    // Audit « Progrès en images » (K4) : la question en surtitre, la conclusion en titre ; sans conclusion, la question en titre.
    const sp = t => t.replace(/\u00a0/g, ' ');
    const titles = () => $$('#stats-games .so-card').filter(c => c.querySelector('h5')).map(c => sp((c.querySelector(':scope > .st-eyebrow') || c.querySelector('h5')).textContent));
    const take = sel => { const c = $(sel); return sp((c.querySelector(':scope > .st-eyebrow') ? c.querySelector('h5') : c.querySelector('.st-sub')).textContent); };
    const view = v => $(`#stats-games [data-action="statsInView"][data-arg="${v}"]`).click();
    const pick = (action, value) => w.eval('UI_ACTIONS')[action](value);

    await t('une seule barre de filtres, dans la barre de contexte ; la courbe d\'Elo ne porte plus ses propres sélecteurs', () => {
        assert.strictEqual($$('#home-tab-stats .si-bar').length, 1);
        assert.strictEqual($$('#stats-filters .si-bar .dd').length, 2, 'période et cadence ; un seul site relié');
        assert(!$('#stats-games .sg-site'));
        assert(!$('#stats-filters').hidden);
    });

    await t('filtres : cachés sur Maîtrise, présents dans l’onglet Ouvertures', () => {
        w.eval(`UI_ACTIONS.statsPane('overview')`);
        assert($('#stats-filters').hidden && !$('#stats-filters .si-bar'));
        w.eval(`switchHomeTab('openings')`);
        assert(!$('#op-filters').hidden && $('#op-filters .si-bar'), 'onglet Ouvertures : même barre de filtres');
        w.eval(`switchHomeTab('stats'); UI_ACTIONS.statsPane('games')`);
    });

    await t('Parties s\'ouvre sur le Résumé (Chays épuré, lot 4) : chiffres, trois constats qui ouvrent leur vue, « Toutes les analyses »', () => {
        assert(!$('#stats-games .si-views'), 'pas de segments sur le Résumé');
        // Chiffres en formes (audit « Progrès en images ») : jauge à repère, gains / nulles / pertes, Elo moyen et niveau joué.
        assert($('#stats-games .si-sum .si-bullet') && $('#stats-games .si-sum .si-wdl'), 'jauge et barre G / N / P');
        assert(!$('#stats-games .so-kpi'), 'plus de tuiles sur le Résumé');
        const facts = $$('#stats-games .si-fact:not(.si-all)');
        assert(facts.length >= 2 && facts.length <= 3, 'trois constats au plus');
        assert(facts.every(b => b.dataset.action === 'statsInView'));
        assert(/Comment finissent vos parties/.test(facts[0].textContent), 'défaites au temps : le temps passe devant');
        assert(facts[0].querySelector('.si-fv'), 'chaque constat a son micro-visuel');
        assert(!$('#stats-games .si-rec') && !$('#stats-games .si-heat'), 'les cartes détaillées attendent « Toutes les analyses »');
        $('#stats-games .si-all').click();
        assert($('#stats-games .si-views') && !$('#stats-games .si-views [data-arg="resume"]') && $('#stats-games .si-back[data-arg="resume"]'), 'les vues, et « ‹ Résumé » en retour (K19)');
    });

    await t('Bilan : chiffres, records et cartes attendues', () => {
        assert.strictEqual($$('#stats-games .so-kpi').length, 4);
        assert.strictEqual($('#stats-games .so-kpi b').textContent, '50 %');
        assert.strictEqual($$('#stats-games .si-rec > div').length, 3);
        const list = titles();
        // Ordre du chantier « Progrès : niveau et temps » : où vous en êtes, puis ce qui explique les défaites, enfin les comparaisons fines.
        assert.deepStrictEqual(list.slice(0, 4), ['Vos mois au-dessus de votre Elo', 'Comment finissent vos parties ?', 'Savez-vous vous arrêter ?', 'Quand jouez-vous le mieux ?']);
        assert.strictEqual(list[list.length - 1], 'Face aux plus forts, face aux plus faibles', 'l\'écart à l\'attendu passe en bas');
        assert(/^Vous (perdez des points contre les adversaires|tenez ce que votre Elo prévoit)/.test(take('#stats-games .si-gaps')));
        assert.strictEqual($$('#stats-games .si-gaps .so-chart text.lab').length, 5, 'cinq forces d\'adversaire, en mots');
        assert.strictEqual($$('#stats-games .si-heat i').length, 42);
        assert(/100 % de vos défaites et .* de vos gains se jouent au temps/.test($('#stats-games').textContent), 'défaites toutes au temps');
    });

    await t('cadence : filtre les chiffres et règle la courbe d\'Elo', () => {
        pick('statsInSpeed', 'blitz');
        assert.strictEqual(w.eval('appSettings.eloSpeed'), 'blitz');
        assert(/18 parties/.test($('#stats-games .so-kpi small').textContent), $('#stats-games .so-kpi small').textContent);
        pick('statsInSpeed', 'all');
        assert(/24 parties/.test($('#stats-games .so-kpi small').textContent));
    });

    await t('période, site et cadence : retrouvés au prochain lancement, sans enfermer sur une page vide', async () => {
        pick('statsInPeriod', '6'); pick('statsInSpeed', 'rapid');
        const saved = w.eval(`dataStore.getJSON('chessTrainer_gameFilters')`);
        assert.strictEqual(saved.period, 6); assert.strictEqual(saved.speed, 'rapid'); assert.strictEqual(saved.site, 'all');
        pick('statsInPeriod', '12'); pick('statsInSpeed', 'all');
        const again = await bootApp({ storage: { chessTrainer_gameFilters: JSON.stringify({ period: 3, site: 'lichess', speed: 'blitz' }) }, before(x) { x.scrollTo = () => {}; } });
        const x = again.dom.window, game = (ago, speed) => `StatsInsights.keep({ at: Date.now() - ${ago} * 864e5, site: 'chesscom', speed: '${speed}', color: 'w' })`;
        x.eval(`statsColor = 'all'; StatsInsights.filtersHTML([{ site: 'chesscom', speed: 'blitz' }, { site: 'chesscom', speed: 'rapid' }])`);
        assert(x.eval(game(1, 'blitz')), 'site sans partie : retour à tous les sites');
        assert(!x.eval(game(1, 'rapid')), 'cadence retrouvée');
        assert(!x.eval(game(150, 'blitz')), 'période retrouvée');
        x.close();
    });

    await t('courbe d\'Elo : l\'année figure sur l\'axe', () => {
        const axis = $$('#stats-games .sg-chart text.ax').slice(-2).map(e => e.textContent);
        axis.forEach(l => assert(/\b20\d\d\b/.test(l), l));
    });

    await t('courbe d\'Elo : l\'écart et les points suivent la période de la barre de filtres', async () => {
        const kpi = () => $('#stats-games .st-reg-kpis span').textContent;
        pick('statsInPeriod', '3'); await tick(100);
        assert(/ sur 3 mois$/.test(kpi()), kpi());
        assert.strictEqual(w.eval('StatsInsights.since()') > 0, true);
        pick('statsInPeriod', '0'); await tick(100);
        assert(/ sur tout l'historique$/.test(kpi()), kpi());
        assert.strictEqual(w.eval('StatsInsights.since()'), 0);
        pick('statsInPeriod', '12'); await tick(100);
    });

    await t('couleur de l\'onglet : aucune partie aux Noirs, message clair', () => {
        w.eval(`statsColor = 'b'; StatsGames.repaint()`);
        assert(/Trop peu de parties avec ces filtres/.test($('#stats-games').textContent));
        w.eval(`statsColor = 'all'; StatsGames.repaint()`);
    });

    await t('Temps : horloges, sortie du répertoire, zeitnot et coup 20', () => {
        view('temps');
        const list = titles();
        assert.deepStrictEqual(list, ['Où dépensez-vous votre temps ?', 'Manquez-vous de temps à la pendule ?', 'L\'avance au coup 20 vous aide-t-elle ?'], 'la préparation fusionnée dans la courbe du temps');
        assert(/Zeitnot : moins de 10 % du temps de départ, soit 18 s en 3 min/.test($('#stats-games .si-zeit .si-chip').textContent), 'zeitnot défini en secondes');
        assert(/(partie sur|de vos parties|jamais en zeitnot)/.test(take('#stats-games .si-zeit')));
        assert.deepStrictEqual($$('#stats-games .si-sides text.lab').map(x => x.textContent), ['En retard', 'À égalité', 'En avance']);
        assert($('#stats-games .si-line.me') && $('#stats-games .si-line.opp'));
        assert(!$('#stats-games .so-kpi'), 'pas de chiffres du Bilan ici');
    });

    await t('Qualité : progression de l\'analyse, Chess.com à évaluer, résultats à partir de 5 parties analysées', () => {
        view('qualite');
        assert(/Analyse Stockfish/.test($('#stats-games #si-eval').textContent));
        assert(/0 \/ 24/.test($('#stats-games #si-eval').textContent));
        assert(/dès 5 parties analysées/.test($('#stats-games').textContent));
        w.eval(`StatsGames.games().forEach((g, i) => { g.ev = g.sans.map((_, k) => 20 + (k % 2 ? 0 : -300 * (i % 2))); g.div = [0, 0]; }); StatsGames.repaint()`);
        assert(/Toutes vos parties sont analysées/.test($('#stats-games #si-eval').textContent));
        const list = titles();
        assert(/^Votre précision (monte|baisse|tient|progresse-t-elle \?)$/.test(list[0]), list[0]);
        assert(/^(Vous perdez pied (en ouverture|au milieu de partie|en finale)|Au niveau partout)$/.test(list[1]), list[1]);
        ['Transformez-vous vos avantages ?', 'Voyez-vous les fautes adverses ?'].forEach(x => assert(list.includes(x), x));
        assert.strictEqual($$('#stats-games .si-phases .si-dial-track').length, 3, 'trois cadrans : Ouverture, Milieu, Finale');
        assert.deepStrictEqual($$('#stats-games .si-phases text.lab').map(x => x.textContent), ['Ouverture', 'Milieu', 'Finale']);
        assert($('#stats-games .si-moments .so-chart path'), 'histogramme des fautes');
        assert.strictEqual($$('#stats-games .so-kpi').length, 4);
    });

    await t('Répertoire : l\'ancienne vue, soumise aux mêmes filtres', () => {
        view('repertoire');
        assert(/Répertoire suivi/.test($('#stats-games').textContent));
        assert(/Par famille d'ouverture/.test($('#stats-games').textContent));
        assert(/24 parties/.test($('#stats-games .sg-tiles').textContent));
        view('bilan');
    });

    await t('fiche d\'ouverture : avance à l\'horloge à la sortie du répertoire', () => {
        assert(/Avance à l'horloge/.test($('#stats-lines').textContent));
        const fact = $$('#stats-lines .so-fact').find(f => /Avance/.test(f.textContent));
        assert(/^Avance à l'horloge\+\d+ %$/.test(fact.textContent.trim().replace(/\s+/g, ' ').replace(/horloge /, 'horloge')), fact.textContent);
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
