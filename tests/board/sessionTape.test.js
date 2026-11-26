// Lancer : node tests/board/sessionTape.test.js   — chantier « L'échiquier de Chays » (26 novembre 2026) :
// ◀ ▶ actifs en pause (B1), action du milieu (R3), pellicule et revue (R7, R8), Rejouer sans compter (R10),
// Corriger depuis la revue (R9, Q1), Mauvais clic (R14), séance gardée au rechargement (R11), Jouer qui ne
// perd plus la ligne (B4, Q6), Finales qui se revoient (R16). Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));

(async () => {
    const { w, errors } = await bootApp({ before(win) { win.scrollTo = () => {}; } });
    const run = s => w.eval(s);
    const $ = s => w.document.querySelector(s);
    const act = () => { const b = $('#status-bar .status-act'); return b ? b.dataset.act : null; };
    const title = () => ($('#status-bar .status-title') || {}).textContent;
    const sq = s => run(`squareToIdx('${s}')`);
    const play = u => run(`executePlayerMove(${sq(u.slice(0, 2))}, ${sq(u.slice(2, 4))}, null)`);

    // Répertoire des Blancs : 1. e4 (e5) 2. Cf3 (Cc6) 3. Fb5. Trois positions, toutes à l'échéance.
    run(`(() => {
        const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'], db = {};
        window.__keys = [];
        [0, 2, 4].forEach(i => {
            const pos = Chess.replay(line.slice(0, i)), e = newEntry(line[i], Chess.san(pos, line[i]), line.slice(0, i + 1));
            e.attempts = 4; e.failures = 0; e.step = 3; e.interval = 7; e.lastReviewed = Date.now() - 8 * 864e5; e.due = Date.now() - 1000;
            db[Chess.key(pos)] = e; __keys.push(Chess.key(pos));
        });
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
        window.askConfirm = (msg, ok) => { window.__asked = msg; ok(); };
        window.askConfirmChoice = (msg, labels, cascade, solo) => { window.__asked = msg; solo(); };   // coups orphelins : garder les autres
        setPref('trainBites', false);
        appSettings.trainNext = 'error';
    })()`);
    const ready = async () => {
        for (let k = 0; k < 60; k++) {
            if (run('trainingState.ctxSkip')) run('trainingState.ctxSkip()');
            if (!run('trainingState.busy')) return;
            await tick(60);
        }
        throw new Error('la main n\'est jamais rendue');
    };
    const start = async () => {
        run(`dataStore.remove('chessTrainer_session'); startSession({ kind: 'review', label: 'Révision', items: __keys.map(key => ({ color: 'w', key })) })`);
        await ready();
    };
    const entry = i => JSON.parse(run(`JSON.stringify(readDBFor(currentRepertoire, 'w')[__keys[${i}]])`));

    await t('fin d\'exercice après une erreur : ◀ ▶ actifs, retour au présent avec « Suivant » (B1, R2)', async () => {
        await start();
        play('d2d4');                                            // faux
        assert.strictEqual(title(), 'Pas le bon coup');
        play('e2e4');
        await tick();
        assert(run('trainingState.pause'), 'arrêt après une erreur');
        assert.strictEqual($('#btn-prev').disabled, false, '◀ actif en pause');
        run('navPrev()');
        assert.strictEqual(run('navCursor'), -2, 'position d\'avant le coup');
        run('navNext()');
        assert.strictEqual(run('navCursor'), -1);
        assert.strictEqual(act(), 'Suivant', 'le message de fin d\'exercice revient');
    });

    await t('action du milieu : « Suivant » à la place de l\'Indice en pause ; Espace le déclenche (R3)', async () => {
        const btn = $('#btn-act');
        assert.strictEqual(btn.hidden, false);
        assert.strictEqual(btn.dataset.act, 'Suivant');
        assert($('.tb-hint').classList.contains('is-swapped'));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        await ready();
        assert.strictEqual(run('trainingState.session.cur'), 1, 'position suivante');
        assert.strictEqual($('#btn-act').hidden, true, 'pendant mon tour : l\'Indice');
    });

    await t('pellicule : la case ratée s\'ouvre en revue, coups fléchés, rien ne joue ni ne compte (R7, R8)', async () => {
        const before = entry(0);
        const cell = $('#tr-progress .tr-tape button[data-arg="0"]');
        assert(cell && cell.classList.contains('ko'), 'case close et ratée, cliquable');
        assert(!$('#tr-progress .tr-tape button[data-arg="1"]'), 'la position en cours ne s\'ouvre pas');
        assert(!$('#tr-progress .tr-tape button[data-arg="3"]'), 'le deuxième passage à venir non plus');
        cell.click();
        assert(run('trainingState.review'), 'revue ouverte');
        assert.strictEqual(run('positionKey()'), run('__keys[0]'), 'position avant ma réponse');
        const arrows = JSON.parse(run('JSON.stringify(_reviewArrows())'));
        assert.deepStrictEqual(arrows.map(a => a.color), ['red', 'gold'], 'coup faux en vermillon, réponse en laiton');
        assert.strictEqual(act(), 'Rejouer');
        assert.strictEqual($('#btn-act').dataset.act, 'Séance');
        run(`handleClick(${sq('e2')}); handleClick(${sq('e4')})`);
        assert.strictEqual(run('moveHistory.length'), 0, 'l\'échiquier de la revue ne joue pas');
        assert.deepStrictEqual(entry(0), before, 'rien n\'est écrit');
    });

    await t('Rejouer : le bon coup est retrouvé, rien n\'est compté (R10)', async () => {
        const before = entry(0);
        run('trainingReplay()');
        play('d2d4');
        assert.strictEqual(title(), 'Pas encore');
        play('e2e4');
        assert.strictEqual(title(), 'Retrouvée');
        assert.deepStrictEqual(entry(0), before);
    });

    await t('Corriger depuis la revue : remplacée après confirmation, deuxième passage retiré, bilan sans elle (R9, Q1)', async () => {
        run('_backToReview(); trainingEditMove()');
        assert.strictEqual(run('trainingState.editing'), run('__keys[0]'));
        play('d2d4');
        assert(run('window.__asked'), 'confirmation demandée');
        const e = entry(0);
        assert.strictEqual(e.move, 'd2d4');
        assert.strictEqual(e.attempts, 0, 'nouvelle réponse en découverte');
        const items = JSON.parse(run('JSON.stringify(trainingState.session.items)'));
        assert(items[0].edited, 'case marquée remplacée');
        assert(items.filter(x => x.second).every(x => x.dropped), 'deuxième passage retiré');
        assert(run('trainingState.session.results.get(__keys[0]).replaced'));
    });

    await t('retour à la séance : la position vivante et sa consigne reviennent', async () => {
        run('trainingCloseReview()');
        assert.strictEqual(run('trainingState.review'), null);
        assert.strictEqual(run('positionKey()'), run('__keys[1]'));
        assert.strictEqual(title(), 'À vous de jouer');
        assert.strictEqual(run('trainingState.busy'), false);
    });

    await t('Mauvais clic : l\'erreur est retirée, la position revient en fin de séance, une fois (R14, Q2)', async () => {
        const before = entry(1);
        play('d2d4');
        assert.strictEqual(act(), 'Mauvais clic');
        assert.notDeepStrictEqual(entry(1), before, 'l\'erreur a été comptée');
        run('trainingMisclick()');
        assert.deepStrictEqual(entry(1), before, 'entrée remise comme avant');
        const items = JSON.parse(run('JSON.stringify(trainingState.session.items)'));
        const last = items[items.length - 1];
        assert(last.again && last.key === run('__keys[1]'), 'renvoyée en fin de séance');
        assert.strictEqual(run('trainingState.misclickUsed'), true);
        run('nextDrill()'); await ready();
        play('d2d4');
        assert.notStrictEqual(act(), 'Mauvais clic', 'une seule fois par séance');
    });

    await t('rechargement : la séance se reprend où elle en était (R11, Q3)', async () => {
        const saved = run('JSON.stringify(savedSession())');
        assert(saved && JSON.parse(saved).left >= 1, 'séance gardée');
        run('_clearSession(); stopTraining()');
        assert(run('resumeSession()'), 'reprise');
        await ready();
        const S = JSON.parse(run('JSON.stringify({ i: trainingState.session.i, items: trainingState.session.items.map(x => !!x.res) })'));
        assert.strictEqual(S.items[0], true, 'les cases closes le restent');
        run('quitTraining()');
        await tick();
        assert.strictEqual(run('savedSession()'), null, 'Quitter oublie la séance');
        assert(run(`dataStore.getJSON('chessTrainer_session', {}).summary`), 'le bilan reste gardé (B8)');
    });

    await t('Jouer : toucher l\'échiquier en revoyant le passé revient au présent, sans rien effacer (B4, Q6)', async () => {
        run(`startGame('w'); loadPositionFromPath(['e2e4', 'e7e5', 'g1f3'])`);
        run('navGo(-1)');
        run(`handleClick(${sq('a5')})`);
        assert.strictEqual(run('moveHistory.length'), 3, 'la ligne est intacte');
        assert.strictEqual(run('navCursor'), -1, 'retour au présent');
        run('navGo(0)');
        assert.strictEqual(act(), 'Repartir d’ici');
        run('restartFromHere()');
        assert.strictEqual(run('moveHistory.length'), 1, 'repartir d\'ici : la suite quitte l\'écran');
    });

    await t('Finales : ◀ ▶ parcourent la finale, toucher l\'échiquier ramène au présent (R16)', async () => {
        run(`startEndgame(ENDGAME_EXERCISES.find(x => x.kind === 'mate').id)`);
        await tick();
        assert.strictEqual($('#btn-prev').style.display, '', '◀ présent en Finales (dock à cinq places, B5)');
        assert.strictEqual(run('GameModes.current().movesLocked'), false);
        run(`moveHistory.length`);
        run(`goHome('endgame')`);
        assert.deepStrictEqual(errors, []);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e); process.exit(1); });
