// Lancer : node tests/shell/homeSummary.test.js   — accueil Jouer « Pupitre » (lot 7) : les trois états d'« Aujourd'hui »
// (dues, à jour, vide) ont chacun une seule action pleine, la prévision sur 7 jours reprend reviewPlan, les lignes
// d'« À traiter » portent un badge .vbadge et un bouton « Répondre » qui ouvre Jouer sur la position, l'anneau de
// l'objectif passe par Ring.html. Listes d'« À traiter » : toutes les lignes rendues, défilement au-delà de 5 ; un redessin
// à l'identique ne réécrit aucun bloc (patchHTML). Charge index.html entier dans jsdom, comme boot.test.js.
const { bootApp } = require('../_app.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ROOT = path.join(__dirname, '..', '..');

async function boot() {
    const { dom, errors } = await bootApp();
    const d = dom.window.document;
    return { w: dom.window, errors, $: s => d.querySelector(s), $$: s => [...d.querySelectorAll(s)] };
}

// Base du répertoire actif : une réponse des Blancs (1. e4) et une des Noirs (1. e4 c5), échéances en jours.
const seed = (w, dueW, dueB) => w.eval(`(() => {
    const day = 86400000, now = Date.now(), put = (c, path, move, san, due) => {
        const db = {}, e = newEntry(move, san, path); e.due = now + due * day; e.attempts = 1;
        db[Chess.key(Chess.replay(path.slice(0, -1)))] = e;
        dataStore.set(dbKeyFor(currentRepertoire, c), JSON.stringify(db));
    };
    put('w', ['e2e4'], 'e2e4', 'e4', ${dueW});
    put('b', ['e2e4', 'c7c5'], 'c7c5', 'c5', ${dueB});
    loadDB(); renderHomeSummary();
})()`);

(async () => {
    const { w, errors, $, $$ } = await boot();
    const primaries = () => $$('#home-tab-play .btn-primary');

    await t('répertoire vide : choix de la couleur, une seule action pleine qui suit la carte choisie', () => {
        w.eval('renderHomeSummary()');
        assert($('#hp-grid').classList.contains('is-empty'));
        assert.strictEqual(primaries().length, 1);
        const cta = primaries()[0];
        assert.strictEqual(cta.dataset.action, 'homeAddLine');
        assert.strictEqual(cta.dataset.arg, 'w');
        assert.strictEqual($$('#hp-today .hp-pick').length, 2);
        $('#hp-today .hp-pick[data-arg="b"]').click();
        assert.strictEqual(cta.dataset.arg, 'b');
        assert.strictEqual(cta.textContent.trim(), 'Commencer avec les Noirs');
        assert.strictEqual($('#hp-today .hp-pick[data-arg="b"]').getAttribute('aria-pressed'), 'true');
        assert.strictEqual($('#hp-today .hp-pick[data-arg="w"]').getAttribute('aria-pressed'), 'false');
        assert($('#hp-today .hp-start').classList.contains('edge-card'));
    });

    await t('révisions dues : chiffre, anneau, position la plus en retard, une seule action « Commencer » → startDailyReview', () => {
        seed(w, -3, -1);
        assert(!$('#hp-grid').classList.contains('is-empty'));
        assert.strictEqual(primaries().length, 1);
        const cta = primaries()[0];
        assert.strictEqual(cta.dataset.action, 'homeGo');
        assert.strictEqual(cta.dataset.arg, 'due');
        assert.strictEqual(cta.textContent.trim(), 'Commencer');
        assert(/^2\s+positions/.test($('#hp-today .hp-title').textContent.trim()));
        assert($('#hp-today .hp-over'), 'surtitre');
        assert($('#hp-today .ring.hp-goal[role="img"]'), 'anneau commun');
        assert($('#hp-today .hp-focus .st-mini'), 'mini-échiquier de la position la plus en retard');
        assert(/3 j/.test($('#hp-today .hp-focus-over').textContent), 'retard affiché');
        assert($('#hp-today .hp-focus-line').innerHTML.includes('Position de départ'), 'fin de ligne avant mon coup');
        assert(!$('#hp-today .hp-fc'), 'pas de prévision quand des positions sont dues');
        assert($('#hp-today .hp-link[data-action="homeExercises"]'), '« Autres exercices » en lien');
        w.__rev = 0; w.eval('startDailyReview = () => { window.__rev++; }');
        cta.click();
        assert.strictEqual(w.__rev, 1);
    });

    await t('plan du jour : erreurs, révisions, réponses après les parties, une finale ; « Commencer » prend la première qui reste', () => {
        seed(w, -3, -1);
        const ids = () => $$('#hp-today .hp-step').map(b => b.dataset.arg + (b.classList.contains('is-done') ? '✓' : ''));
        assert.deepStrictEqual(ids(), ['due', 'endgame'], 'sans bilan ni nouveauté');
        const due = $('#hp-today .hp-step[data-arg="due"]');
        assert.strictEqual(due.querySelector('.hp-step-n').textContent, '2');
        // Erreurs du dernier bilan : en tête, et « Commencer » les prend d'abord.
        w.eval(`trainingState.lastSummary = { kind: 'due', rows: [{ ok: false, color: 'w', key: 'k1' }, { ok: true }] }; renderHomeSummary()`);
        assert.deepStrictEqual(ids(), ['retry', 'due', 'endgame']);
        assert.strictEqual(primaries()[0].dataset.arg, 'retry');
        w.__retry = 0; w.eval(`const __r = UI_ACTIONS.trainingRetry; UI_ACTIONS.trainingRetry = () => { window.__retry++; }`);
        primaries()[0].click();
        assert.strictEqual(w.__retry, 1, '« Commencer » : les erreurs d\'abord');
        w.eval(`trainingState.lastSummary = null`);
        // À jour : révisions cochées, « Commencer » passe à la finale à suivre.
        seed(w, 2, 4);
        assert.deepStrictEqual(ids(), ['due✓', 'endgame']);
        assert(/À jour/.test($('#hp-today .hp-step[data-arg="due"] small').textContent));
        assert.strictEqual(primaries()[0].dataset.action, 'homeGo');
        assert.strictEqual(primaries()[0].dataset.arg, 'endgame');
        w.__eg = null; w.eval(`startEndgame = id => { window.__eg = id; }`);
        $('#hp-today .hp-step[data-arg="endgame"]').click();
        assert.strictEqual(w.__eg, w.eval('_egNext(readEndgameProgress()).id'), 'la ligne lance sa propre étape');
        // Finale réussie aujourd'hui : tout est fait, l'action redevient « Ajouter une ligne ».
        w.eval(`(() => { const p = {}; p[_egNext({}).id] = { tries: 1, wins: 1, perfect: true, best: 0, last: Date.now() };
            dataStore.setJSON(ENDGAME_PROGRESS_KEY, p); renderHomeSummary(); })()`);
        assert.deepStrictEqual(ids(), ['due✓', 'endgame✓']);
        assert.strictEqual(primaries()[0].dataset.action, 'homeAddLine');
        w.eval(`dataStore.setJSON(ENDGAME_PROGRESS_KEY, {}); renderHomeSummary()`);
    });

    await t('« Autres exercices » ouvre l\'onglet Entraînement sans lancer de séance', () => {
        seed(w, -3, -1);
        $('#hp-today .hp-link[data-action="homeExercises"]').click();
        assert(!$('#home-tab-training').classList.contains('hidden'));
        assert.strictEqual(w.eval('gameMode'), 'play');
        w.eval("switchHomeTab('play')");
    });

    await t('tout fait : une seule action « Ajouter une ligne » dans la couleur la moins fournie, prévision = programme des révisions (reviewPlan)', () => {
        seed(w, 1, 3);
        w.eval(`(() => { const p = {}; p[_egNext({}).id] = { tries: 1, wins: 1, perfect: true, best: 0, last: Date.now() }; dataStore.setJSON(ENDGAME_PROGRESS_KEY, p); })()`);
        // Une deuxième position aux Blancs : les Noirs deviennent la couleur la moins fournie.
        w.eval(`(() => { const db = readDBFor(currentRepertoire, 'w'), e = newEntry('g1f3', 'Nf3', ['e2e4', 'e7e5', 'g1f3']);
            e.due = Date.now() + 5 * 86400000; db[Chess.key(Chess.replay(['e2e4', 'e7e5']))] = e;
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db)); renderHomeSummary(); })()`);
        assert.strictEqual(primaries().length, 1);
        const cta = primaries()[0];
        assert.strictEqual(cta.dataset.action, 'homeAddLine');
        assert.strictEqual(cta.dataset.arg, 'b');
        assert(/Ajouter une ligne aux Noirs/.test(cta.textContent));
        assert($('#hp-today .hp-day').classList.contains('is-done'));
        const shown = $$('#hp-today .hp-fc .hp-fc-n').map(b => Number(b.textContent));
        const expected = JSON.parse(w.eval(`JSON.stringify(reviewPlan(currentRepertoire).forecast(null, 7))`));
        assert.strictEqual(shown.length, 7);
        assert.deepStrictEqual(shown, expected);
        assert.strictEqual(expected.reduce((a, b) => a + b, 0), 3, 'les trois positions tombent dans les 7 jours');
        assert.strictEqual($$('#hp-today .hp-fc li').length, 7);
    });

    await t('_homeGoalHTML délègue à Ring.html (aria-label conservé, classe hp-goal)', () => {
        w.eval('window.__ringArgs = null; const __orig = Ring.html; Ring.html = o => { window.__ringArgs = o; return __orig(o); }; window.__goal = _homeGoalHTML(3, 10); Ring.html = __orig;');
        const args = w.__ringArgs;
        assert(args, 'Ring.html appelé');
        assert.strictEqual(args.value, 3);
        assert.strictEqual(args.max, 10);
        assert.strictEqual(args.cls, 'hp-goal');
        assert(w.__goal.includes('aria-label="Objectif du jour : 3 sur 10 positions"'));
        assert(/class="ring hp-goal"/.test(w.__goal));
        assert(/class="ring is-done hp-goal"/.test(w.eval('_homeGoalHTML(12, 10)')), 'objectif atteint');
        assert(w.eval('_homeGoalHTML(12, 10)').includes('10 sur 10 positions'));
    });

    await t('À traiter : badge .vbadge et « Répondre » qui ouvre Jouer sur la position, sans rien compter', () => {
        w.eval(`(() => { const l = {}; l['lichess:abc'] = { src: 'lichess', at: Date.now(), first: Date.now(), last: Date.now(), vs: 'ondine_77',
            v: { [currentRepertoire + '|w']: { kind: 'novelty', ply: 1, at: Date.now(), path: ['e2e4', 'c7c6'] } }, counted: {} };
            dataStore.setJSON(GAME_LEDGER_KEY, l); renderHomeSummary(); })()`);
        const row = $('#hp-news .hp-row');
        assert(row, 'une ligne');
        const badge = row.querySelector('.vbadge');
        assert(badge && badge.classList.contains('is-warn') && badge.textContent === 'Nouveauté');
        assert(!row.querySelector('.hp-kind'), 'plus de .hp-kind');
        const btn = row.querySelector('button.btn.btn-soft.hp-answer');
        assert(btn && btn.textContent.trim() === 'Répondre');
        assert.strictEqual(primaries().length, 1, '« Répondre » n\'est pas une action pleine');
        const before = w.eval(`JSON.stringify(readDBFor(currentRepertoire, 'w'))`);
        btn.click();
        assert.strictEqual(w.eval('gameMode'), 'play');
        assert.strictEqual(w.eval('playerColor'), 'w');
        assert.strictEqual(w.eval(`Chess.key(Chess.replay(moveHistory.map(m => moveToStr(m.from, m.to, m.promo))))`),
                           w.eval(`Chess.key(Chess.replay(['e2e4', 'c7c6']))`), 'position de la nouveauté');
        assert.strictEqual(w.eval(`JSON.stringify(readDBFor(currentRepertoire, 'w'))`), before, 'Jouer ne compte rien');
        w.eval('goHome()');
    });

    await t('vue Parties : badge par verdict, « Répondre » seulement pour une partie encore à traiter', () => {
        w.eval(`(() => { const l = dataStore.getJSON(GAME_LEDGER_KEY, {}); l['chesscom:x'] = { src: 'chesscom', at: Date.now() - 1000, first: 1, last: 1, vs: 'Kassim',
            v: { [currentRepertoire + '|b']: { kind: 'theory', ply: 2, at: 1, path: ['e2e4', 'c7c5'] } }, counted: {} };
            dataStore.setJSON(GAME_LEDGER_KEY, l); })()`);
        $('#hp-news [data-action="homePane"][data-arg="games"]').click();
        const rows = $$('#hp-news .hp-row');
        assert.strictEqual(rows.length, 2);
        const byVs = vs => rows.find(r => r.textContent.includes(vs));
        assert(byVs('Kassim').querySelector('.vbadge.is-ok'));
        assert(!byVs('Kassim').querySelector('.hp-answer'), 'partie théorique : rien à répondre');
        assert(byVs('ondine_77').querySelector('.vbadge.is-warn'));
        byVs('ondine_77').querySelector('.hp-answer').click();
        assert.strictEqual(w.eval('gameMode'), 'play');
        assert.strictEqual(w.eval('moveHistory.length'), 2);
        w.eval('goHome()');
    });

    await t('À traiter, 12 nouveautés : toutes rendues, la liste défile au-delà de 5 (repère « 1–5 · 12 »), « Répondre » sur la 9e ouvre la 9e', () => {
        w.eval(`window.__ledgerKeep = dataStore.getJSON(GAME_LEDGER_KEY, {});
            window.__nov = ['a7a6', 'a7a5', 'b7b6', 'b7b5', 'c7c6', 'c7c5', 'd7d6', 'd7d5', 'e7e6', 'e7e5', 'f7f6', 'f7f5', 'g7g6', 'g7g5', 'h7h6', 'h7h5', 'g8f6', 'b8c6']
                .filter(m => !readDBFor(currentRepertoire, 'w')[Chess.key(Chess.replay(['e2e4', m]))]).slice(0, 12);
            (() => { const l = {}, now = Date.now();
                __nov.forEach((m, i) => { l['lichess:n' + i] = { src: 'lichess', at: now - i * 1000, first: now - i * 1000, last: now - i * 1000, vs: 'adv' + i,
                    v: { [currentRepertoire + '|w']: { kind: 'novelty', ply: 1, at: now - i * 1000, path: ['e2e4', m] } }, counted: {} }; });
                dataStore.setJSON(GAME_LEDGER_KEY, l); })()`);
        $('#hp-news [data-action="homePane"][data-arg="news"]').click();
        const list = $('#hp-news .hp-list');
        assert.strictEqual(list.querySelectorAll('.hp-row').length, 12, 'toutes les lignes rendues');
        assert(list.classList.contains('is-scroll') && list.getAttribute('tabindex') === '0', 'liste défilante, au clavier aussi');
        assert(!$('#hp-news .hp-more'), 'plus de « et N de plus »');
        const cue = $('#hp-news .hp-cue');
        assert(cue && /1–5/.test(cue.textContent) && /12/.test(cue.textContent), 'repère sous la liste');
        const css = fs.readFileSync(path.join(ROOT, 'css/home.css'), 'utf8');
        assert(/\.hp-list\.is-scroll \{ max-height: var\(--hp-five, calc\(5 \* 64px\)\); overflow-y: auto; overscroll-behavior: contain; scroll-snap-type: y proximity;/.test(css), '5 lignes de 64 px, défilement dans la carte');
        assert(/\.hp-list\.is-scroll \.hp-row \{ scroll-snap-align: start;/.test(css) && /\.hp-list\.is-scroll\.at-end \{ -webkit-mask-image: none; mask-image: none; \}/.test(css), 'arrêt par ligne, fondu retiré en fin de liste');
        list.querySelectorAll('.hp-answer')[8].click();
        assert.strictEqual(w.eval('gameMode'), 'play');
        assert.strictEqual(w.eval(`Chess.key(Chess.replay(moveHistory.map(m => moveToStr(m.from, m.to, m.promo))))`),
                           w.eval(`Chess.key(Chess.replay(['e2e4', __nov[8]]))`), 'la 9e position');
        w.eval('goHome()');
        $('#hp-news [data-action="homePane"][data-arg="games"]').click();
        const games = $$('#hp-news .hp-row');
        assert.strictEqual(games.length, 12, 'vue Parties : toutes rendues aussi');
        games[10].querySelector('.hp-answer').click();
        assert.strictEqual(w.eval(`Chess.key(Chess.replay(moveHistory.map(m => moveToStr(m.from, m.to, m.promo))))`),
                           w.eval(`Chess.key(Chess.replay(['e2e4', __nov[10]]))`), 'vue Parties : la 11e partie');
        w.eval('goHome()');
        $('#hp-news [data-action="homePane"][data-arg="news"]').click();
        w.eval(`dataStore.setJSON(GAME_LEDGER_KEY, __ledgerKeep); renderHomeSummary()`);
        assert(!$('#hp-news .hp-list').classList.contains('is-scroll') && !$('#hp-news .hp-cue'), '5 lignes ou moins : ni défilement ni repère');
    });

    await t('redessin évité : parties relues, archive croisée, pseudo ou synchro sans changement ne réécrivent aucun bloc', () => {
        seed(w, -1, 2);
        const day = $('#hp-today').firstElementChild, inbox = $('#hp-news').firstElementChild, art = $('#home-art-w').firstElementChild;
        w.eval(`renderHomeSummary(); Bus.emit('games:analysed'); Bus.emit('games:reviewed', { games: 0 }); applySyncedPrefs()`);
        assert.strictEqual($('#hp-today').firstElementChild, day, 'Aujourd’hui gardé tel quel');
        assert.strictEqual($('#hp-news').firstElementChild, inbox, 'À traiter gardé tel quel');
        assert.strictEqual($('#home-art-w').firstElementChild, art, 'Jouer gardé tel quel');
        w.eval(`appSettings.pseudo = 'Zoé'; renderHomeSummary()`);
        assert.notStrictEqual($('#hp-today').firstElementChild, day, 'un changement réécrit le bloc');
        assert(/Zoé/.test($('#hp-today .hp-over').textContent));
        assert.strictEqual($('#hp-news').firstElementChild, inbox, 'À traiter inchangé, toujours gardé');
        w.eval(`appSettings.pseudo = ''; renderHomeSummary()`);
    });

    await t('plafond du jour (chantier « Révision du jour ») : « Bon retour », l\'objectif seulement, jauge du retard, puis « Encore »', () => {
        w.eval(`(() => {
            const day = 86400000, now = Date.now(), db = {};
            const p = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4 b1c3 f6e4 e1g1 e4c3 b2c3 b4c3 d1b3 d7d5 c4d5 e8g8'.split(' ');
            for (let k = 0; k < p.length; k += 2) {
                const path = p.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1)), e = newEntry(path[k], Chess.san(pos, path[k]), path);
                e.due = now - 2 * day; e.attempts = 2;
                db[Chess.key(pos)] = e;
            }
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
            dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
            appSettings.dailyGoal = 15;
            dataStore.setJSON('chessTrainer_activity', { [dayStamp(now)]: { a: 10, f: 0 }, [dayStamp(now - 5 * day)]: { a: 4, f: 0 } });
            trainingState.lastSummary = null;
            loadDB(); renderHomeSummary();
        })()`);
        assert(/^Bon retour/.test($('#hp-today .hp-over').textContent.trim()), $('#hp-today .hp-over').textContent);
        assert(/^5\s+positions\s*pour reprendre la main/.test($('#hp-today .hp-title').textContent.trim()), $('#hp-today .hp-title').textContent);
        assert(/les plus importantes d’abord/.test($('#hp-today .hp-sub').textContent));
        assert(/Retard : 6 en attente/.test($('#hp-today .rv-gauge').textContent), 'jauge : 11 dues, 5 places');
        assert(/à jour vers/.test($('#hp-today .rv-gauge').textContent));
        assert.strictEqual($('#hp-today .hp-step[data-arg="due"] .hp-step-n').textContent, '5');
        assert(/6 en attente/.test($('#hp-today .hp-step[data-arg="due"]').textContent), 'le plan du jour dit le retard');
        assert.strictEqual($$('#hp-today .hp-pace-opt').length, 3, 'rythme du jour : Léger, Normal, Soutenu');
        assert.strictEqual($('#hp-today .hp-pace-opt.is-on').dataset.arg, '15');
        w.eval(`startTrainingExercise('due')`);
        assert.strictEqual(w.eval('trainingState.session.items.length'), 5, 'la séance ne prend que l\'objectif restant');
        w.eval('quitTraining()');
        w.eval(`dataStore.setJSON('chessTrainer_activity', { [dayStamp(Date.now())]: { a: 15, f: 0 } }); renderHomeSummary()`);
        assert(/Objectif du jour\s*atteint/.test($('#hp-today .hp-title').textContent), 'objectif atteint');
        assert($('#hp-today .hp-step[data-arg="due"]').classList.contains('is-done'));
        assert($('#hp-today .hp-link[data-action="trainingMore"]'), '« Encore » proposé, jamais imposé');
        w.eval('window.__spy = startDailyReview; startDailyReview = n => { window.__more = n; }; UI_ACTIONS.trainingMore(); startDailyReview = window.__spy');
        assert.strictEqual(w.eval('window.__more'), 15, '« Encore 15 » : l\'objectif une fois de plus');
        w.eval(`startTrainingExercise('due', 15)`);
        assert.strictEqual(w.eval('trainingState.session.items.length'), 11, '« Encore 15 » : tout ce qui attend (11)');
        w.eval('quitTraining()');
        w.eval(`UI_ACTIONS.homePace('60')`);
        assert.strictEqual(w.eval('appSettings.dailyGoal'), 60, 'Soutenu choisi sur place');
        w.eval(`appSettings.dailyGoal = 30; dataStore.setJSON('chessTrainer_activity', {}); renderHomeSummary()`);
    });

    await t('série avec joker : pastille laiton dans le surtitre, libre ou utilisée', () => {
        const day = 864e5;
        w.eval(`dataStore.setJSON('chessTrainer_activity', { [dayStamp(Date.now())]: { a: 3, f: 0 }, [dayStamp(Date.now() - 2 * ${day})]: { a: 3, f: 0 } }); renderHomeSummary()`);
        assert(/2\s+jours d'affilée/.test($('#hp-today .hp-over').textContent), $('#hp-today .hp-over').textContent);
        assert($('#hp-today .hp-joker'), 'pastille du joker');
    });

    await t('défi du jour : une position du répertoire avant le plan, la même toute la journée ; faite, son résultat sans action', () => {
        seed(w, 3, 3);
        w.eval(`dataStore.remove('chessTrainer_daily'); renderHomeSummary()`);
        const card = $('#hp-today .hp-daily');
        assert(card && card.nextElementSibling.classList.contains('hp-steps'), 'juste avant le plan du jour');
        assert(card.querySelector('.st-mini'), 'mini-échiquier');
        const arg = card.dataset.arg;
        w.eval('renderHomeSummary()');
        assert.strictEqual($('#hp-today .hp-daily').dataset.arg, arg, 'même position au second rendu');
        let started = null;
        w.startDailyChallenge = (c, k) => { started = c + ':' + k; };
        $('#hp-today .hp-daily').click();
        assert.strictEqual(started, arg, 'lance la position du défi');
        const i = arg.indexOf(':');
        w.eval(`Daily.save({ ok: true, color: ${JSON.stringify(arg.slice(0, i))}, key: ${JSON.stringify(arg.slice(i + 1))}, rep: currentRepertoire }); renderHomeSummary()`);
        const done = $('#hp-today .hp-daily');
        assert(done.classList.contains('is-done') && /Réussi/.test(done.textContent));
        started = null;
        done.click();
        assert.strictEqual(started, null, 'un seul essai compté par jour');
        assert(/1 jour d’affilée/.test(done.textContent), done.textContent);
        w.eval(`dataStore.remove('chessTrainer_daily')`);
    });

    await t('aucune erreur JS', () => { assert.deepStrictEqual(errors, []); });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
