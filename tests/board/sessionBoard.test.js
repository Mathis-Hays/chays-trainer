// Lancer : node tests/board/sessionBoard.test.js   — chantier « Échiquier et séance » (18 novembre 2026) :
// logo actif en séance, retour de l'Analyse, Indice en trois paliers (et en Focus), interrupteur « Enchaîner »,
// flèches ← → après un clic, ◀ ▶ grisés pendant que la séance est occupée. Charge index.html entier dans jsdom.
const { bootApp, ROOT } = require('../_app.js');
const assert = require('assert'), fs = require('fs'), path = require('path');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 300) => new Promise(r => setTimeout(r, ms));

(async () => {
    const { w, errors } = await bootApp({ before(win) { win.scrollTo = () => {}; } });
    const run = s => w.eval(s);
    const $ = s => w.document.querySelector(s);
    const act = () => { const b = $('#status-bar .status-act'); return b ? b.dataset.act : null; };
    const key = (k, target = w.document) => target.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    const E2 = 12, E4 = 28, G1 = 6, F3 = 21;

    // Répertoire des Blancs : 1. e4 (e5) 2. Cf3. Les deux positions sont à l'échéance, maîtrise 50.
    const seed = () => run(`(() => {
        const line = ['e2e4', 'e7e5', 'g1f3'], db = {};
        [0, 2].forEach(i => {
            const pos = Chess.replay(line.slice(0, i)), e = newEntry(line[i], Chess.san(pos, line[i]), line.slice(0, i + 1));
            e.attempts = 4; e.failures = 1; e.mastery = 50; e.interval = 3; e.lastReviewed = Date.now() - 4 * 864e5; e.due = Date.now() - 1000;
            db[Chess.key(pos)] = e;
        });
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
        window.__start = Chess.key(Chess.start());
        return Object.keys(db);
    })()`);
    const startOne = async (focus = false) => {
        seed();
        run(`setPref('trainFocus', ${focus}); appSettings.trainNext = 'clean'; trainingState.lastSummary = null;
             startSession({ kind: 'review', label: 'Révision', items: [{ color: 'w', key: __start }] })`);
        await tick();
        assert.strictEqual(run('trainingState.busy'), false, 'la main est rendue');
    };

    await t('logo : actif en séance, abandon propre, retour à l\'accueil et message « bilan gardé »', async () => {
        const css = fs.readdirSync(path.join(ROOT, 'css')).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(ROOT, 'css', f), 'utf8')).join('\n');
        assert(!/data-session\][^{]*\.topnav-brand[^{]*\{[^}]*pointer-events: none/.test(css), 'plus de blocage CSS du logo');
        await startOne();
        run(`trainingState.session.results.set(__start, { key: __start, color: 'w', ok: false, lvBefore: 'progress' })`);
        $('.topnav-brand').click();
        assert.strictEqual(run('trainingState.session'), null);
        assert.strictEqual(run('trainingState.lastSummary.early'), true, 'bilan gardé');
        assert(run(`document.getElementById('game-screen').classList.contains('hidden')`), 'accueil');
        assert.strictEqual($('#tr-toast') && $('#tr-toast').textContent, 'Séance arrêtée, bilan gardé');
    });

    await t('Analyse ouverte depuis Jouer : Quitter revient à la ligne et au coup affiché d\'origine', async () => {
        run(`startGame('w'); loadPositionFromPath(['e2e4', 'e7e5', 'g1f3']); navGo(1)`);
        assert.strictEqual(run('navCursor'), 1);
        run('openAnalysis()');
        assert.strictEqual(run('gameMode'), 'analysis');
        run(`navGo(2); executePlayerMove(${57}, ${42}, null)`);          // ... Cc6 joué en Analyse
        run('quitAnalysis()');
        assert.strictEqual(run('gameMode'), 'play');
        assert.deepStrictEqual(JSON.parse(run('JSON.stringify(moveHistory.map(m => moveToStr(m.from, m.to, m.promo)))')), ['e2e4', 'e7e5', 'g1f3']);
        assert.strictEqual(run('navCursor'), 1, 'le coup affiché d\'origine (1… e5)');
        run('goHome()');
    });

    await t('indice en trois paliers : type de pièce, pièce exacte cerclée, puis solution', async () => {
        await startOne();
        run('showHint()');
        assert.strictEqual(run('hintLevel()'), 1);
        assert(/déplacez un Pion/.test($('#status-text .status-title').textContent));
        assert(w.document.querySelectorAll('#board .sq.hl-hint-type').length === 8, 'les huit pions soulignés');
        assert.strictEqual($('.tb-hint').dataset.sol, 'piece');
        run('showHint()');
        assert.strictEqual(run('hintLevel()'), 2);
        assert.strictEqual($('#board .sq.hl-hint-piece').dataset.idx, String(E2), 'la pièce exacte cerclée');
        assert.strictEqual($('.tb-hint').dataset.sol, 'sol', 'le bouton annonce la solution');
        run('showHint()');
        assert.strictEqual(run('trainingState.solutionFor'), run('__start'), 'troisième appui : la solution');
        assert(!$('#board .sq.hl-hint-piece'), 'la solution remplace le cercle');
        run('abandonSession(); goHome()');
    });

    await t('barème : type de pièce palier gardé, pièce exacte neutre (revue demain), sans aide un palier de plus', async () => {
        const play = async (steps) => {
            await startOne();
            for (let i = 0; i < steps; i++) run('showHint()');
            run(`executePlayerMove(${E2}, ${E4}, null)`);
            const e = JSON.parse(run('JSON.stringify(openingDB[__start])'));
            run('trainingState.timers.forEach(clearTimeout); trainingState.timers = []; abandonSession(); goHome()');
            return e;
        };
        const now = Date.now();
        let e = await play(0);
        assert.strictEqual(e.mastery, 68, 'sans aide : 50 → 68');
        assert.strictEqual(e.step, 2, 'palier 1 → 2'); assert.strictEqual(e.interval, 3);
        e = await play(1);
        assert.strictEqual(e.mastery, 60, 'type de pièce : 50 → 60');
        assert.strictEqual(e.step, 1, 'type de pièce : palier gardé'); assert.strictEqual(e.interval, 1);
        e = await play(2);
        assert.strictEqual(e.mastery, 50, 'pièce exacte : score gardé');
        assert.strictEqual(e.interval, 3, 'intervalle inchangé');
        assert(Math.abs(e.due - (now + 864e5)) < 60000, 'revue demain');
        assert(!Number.isInteger(e.relearn), 'pas de rattrapage');
        assert.strictEqual(e.failures, 1, 'aucune erreur comptée');
        e = await play(3);
        assert.strictEqual(e.mastery, 20, 'solution : × 0,4');
        assert.strictEqual(e.relearn, 0, 'rattrapage demain'); assert.strictEqual(e.failures, 2, 'erreur comptée');
    });

    await t('Focus : l\'Indice devient l\'action de la barre d\'état (Indice, Pièce, Solution), Espace reste', async () => {
        await startOne(true);
        assert(w.document.documentElement.classList.contains('train-focus'));
        assert.strictEqual(act(), 'Indice');
        $('#status-bar .status-act').click();
        assert.strictEqual(act(), 'Pièce');
        key(' ');
        assert.strictEqual(run('hintLevel()'), 2, 'Espace avance d\'un palier');
        assert.strictEqual(act(), 'Solution');
        run('TrainFocus.toggle()');
        assert.strictEqual(act(), null, 'hors Focus : la rangée de boutons porte l\'Indice');
        run('TrainFocus.toggle()');
        assert.strictEqual(act(), 'Solution', 'retour en Focus');
        run('setPref("trainFocus", false); abandonSession(); goHome()');
    });

    await t('« Enchaîner » : interrupteur en fin d\'exercice, anneau de décompte, piloté par trainNext', async () => {
        await startOne();
        run(`executePlayerMove(${E2}, ${E4}, null)`);
        let sw = $('#status-bar .status-switch input');
        assert(sw && sw.checked, 'allumé : trainNext « clean » enchaîne une réussite nette');
        assert.strictEqual(act(), 'Rester ici');
        assert($('#status-bar .status-act .act-ring'), 'anneau de décompte');
        run('trainingStay()');
        assert.strictEqual(act(), 'Suivant');
        sw = $('#status-bar .status-switch input');
        sw.checked = false; sw.dispatchEvent(new w.Event('change'));
        assert.strictEqual(run('appSettings.trainNext'), 'wait', 'éteint = toujours attendre');
        assert.strictEqual(act(), 'Suivant');
        assert.strictEqual(run('trainingState.timers.length'), 0, 'éteint : rien ne passe seul');
        sw = $('#status-bar .status-switch input');
        sw.checked = true; sw.dispatchEvent(new w.Event('change'));
        assert.strictEqual(run('appSettings.trainNext'), 'clean', 'allumé = après une réussite nette');
        assert.strictEqual(act(), 'Rester ici', 'allumé à l\'arrêt : le décompte part');
        assert.strictEqual(run('trainingState.timers.length'), 1);
        sw = $('#status-bar .status-switch input');
        assert(sw.checked);
        sw.checked = false; sw.dispatchEvent(new w.Event('change'));
        assert.strictEqual(run('appSettings.trainNext'), 'wait', 'éteint = réglage par défaut');
        assert.strictEqual(run('trainingState.timers.length'), 0, 'le décompte s\'arrête');
        run('trainingState.timers.forEach(clearTimeout); trainingState.timers = []; abandonSession(); goHome()');
    });

    await t('flèches : après un clic sur l\'échiquier, ← → naviguent ; les cases ne gardent que le focus clavier', async () => {
        run(`startGame('w'); loadPositionFromPath(['e2e4', 'e7e5'])`);
        const sq = $(`#board .sq[data-idx="${G1}"]`);
        sq.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        sq.focus();
        assert.notStrictEqual(w.document.activeElement, sq, 'focus de souris retiré');
        key('ArrowLeft', w.document.activeElement);
        assert.strictEqual(run('navCursor'), 0, '← recule d\'un coup');
        key('ArrowRight', w.document.activeElement);
        assert.strictEqual(run('navCursor'), -1);
        await tick(1100);
        const k = $(`#board .sq[data-idx="${G1}"]`);
        k.focus();                                                      // focus clavier (Tab)
        assert.strictEqual(w.document.activeElement, k);
        key('ArrowRight', k);
        assert.strictEqual(w.document.activeElement.dataset.idx, '7', 'le curseur clavier des cases se déplace');
        assert.strictEqual(run('navCursor'), -1, 'sans naviguer dans les coups');
        w.document.activeElement.blur();
        run('goHome()');
    });

    await t('capsule de couleur : touchée à la souris, elle ne lit pas les flèches', async () => {
        const host = w.document.createElement('div');
        w.document.body.append(host);
        const picked = [];
        w.eval('ColorScope').render(host, { options: ['w', 'b', 'all'], value: 'w', onChange: v => picked.push(v) });
        const b = host.querySelector('.cs-opt[data-v="w"]');
        b.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        b.focus();
        key('ArrowRight', b);
        assert.deepStrictEqual(picked, [], 'focus de souris : pas de changement de camp');
        b.blur();
        b.focus();                                                      // retour au clavier
        key('ArrowRight', b);
        assert.deepStrictEqual(picked, ['b']);
        host.remove();
    });

    await t('◀ ▶ grisés pendant que la séance est occupée (mise en situation), avec leur raison', async () => {
        const keys = seed();
        run(`setPref('trainFocus', false); trainingState.lastSummary = null;
             startSession({ kind: 'review', label: 'Révision', items: [{ color: 'w', key: ${JSON.stringify(keys[1])} }] })`);
        const prev = $('#btn-prev');
        assert.strictEqual(run('trainingState.busy'), true, 'mise en situation');
        assert.strictEqual(prev.disabled, true);
        assert(/Patientez/.test(prev.title));
        await tick(4000);
        assert.strictEqual(run('trainingState.busy'), false, 'la main est rendue');
        assert.strictEqual(prev.disabled, false, 'on peut revoir les coups');
        assert(/précédent/.test(prev.title), 'infobulle d\'origine rendue');
        run('abandonSession(); goHome()');
        assert.deepStrictEqual(errors, []);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
