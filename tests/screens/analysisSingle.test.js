// Lancer : node tests/screens/analysisSingle.test.js   — chantier « L'échiquier de Chays », suite (26 novembre 2026) :
// dans l'Analyse, une seule réponse à moi par position (jouer un autre coup remplace le mien, dans le brouillon puis au
// répertoire ; coups devenus orphelins : la question de Jouer, corbeille ou gardés), bouton du milieu qui confirme dans l'aperçu, « Dans le répertoire » /
// « Hors répertoire depuis… », flèche laiton de mon coup, « Corriger » au crayon et « Poser » à la palette.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

(async () => {
    const { w, errors } = await bootApp({ before(win) { win.scrollTo = () => {}; } });
    const run = s => w.eval(s);
    const $ = s => w.document.querySelector(s);
    const title = () => ($('#status-bar .status-title') || {}).textContent;
    const play = u => run(`executePlayerMove(squareToIdx('${u.slice(0, 2)}'), squareToIdx('${u.slice(2, 4)}'), null)`);
    const center = () => JSON.parse(run('JSON.stringify((c => c && { label: c.label, disabled: !!c.disabled })(GameModes.current().center()))'));
    const k = p => run(`Chess.key(Chess.replay(${JSON.stringify(p)}))`);

    // Répertoire des Blancs : 1. e4 e5 2. Cf3 Cc6 3. Fb5.
    run(`(() => {
        const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'], db = {};
        [0, 2, 4].forEach(i => { const pos = Chess.replay(line.slice(0, i)); db[Chess.key(pos)] = newEntry(line[i], Chess.san(pos, line[i]), line.slice(0, i + 1)); });
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
        sessionStorage.clear();
        startGame('w');
    })()`);

    await t('ouverte sur ma ligne : « Dans le répertoire », flèche laiton de mon coup à mon trait', async () => {
        run(`openAnalysis(['e2e4', 'e7e5', 'g1f3'], 1)`);
        assert.strictEqual(title(), 'Dans le répertoire');
        assert.match($('#analysis-panel .ab-h').textContent, /Dans le répertoire/);
        const gold = JSON.parse(run('JSON.stringify(analysisArrowList().filter(a => a.color === "gold"))'));
        assert.strictEqual(gold.length, 1, 'mon coup Cf3 fléché');
        assert.strictEqual(gold[0].from, run(`squareToIdx('g1')`));
    });

    await t('un autre coup à mon trait remplace le mien dans le brouillon : pas de variante, sortie marquée', async () => {
        run(`analysisGo('e2e4,e7e5')`);
        play('f1c4');
        const tree = JSON.parse(run('JSON.stringify(analysis.tree)'));
        const afterE5 = tree.kids[0].kids[0].kids.map(x => x.uci);
        assert.deepStrictEqual(afterE5, ['f1c4'], 'Cf3 quitte le brouillon');
        assert.strictEqual(title(), 'Hors répertoire depuis 2. Fc4');
        assert.match($('#status-bar .status-detail').textContent, /remplace Cf3/);
        assert($('#analysis-panel .ab-mv.is-exit'), 'premier coup hors répertoire marqué');
        assert($('#analysis-panel .ab-mk.is-replace'), 'losange « remplace »');
        assert.deepStrictEqual(center(), { label: 'Remplacer (1)', disabled: false });
    });

    await t('coups adverses : les branches restent possibles', async () => {
        run(`analysisGo('e2e4')`);
        play('c7c5');
        const kids = JSON.parse(run('JSON.stringify(analysis.tree.kids[0].kids.map(x => x.uci))'));
        assert.deepStrictEqual(kids.sort(), ['c7c5', 'e7e5']);
        run(`analysisGo('e2e4,e7e5,f1c4')`);
    });

    await t('aperçu : le bouton du milieu confirme ; l\'ancien coup et sa suite vont à la corbeille', async () => {
        run('analysisOpenMerge()');
        await tick();
        assert.deepStrictEqual(center(), { label: 'Remplacer (1)', disabled: false }, 'la confirmation, pas l\'ancien « Ajouter »');
        assert.strictEqual($('#btn-act').hidden, false);
        // Annuler : rien n'est écrit ; « Remplacer ce coup seulement » : la suite est gardée ; « Supprimer aussi » : corbeille.
        run(`window.__choice = null; window.askConfirmChoice = (msg, labels, cascade, solo) => { window.__asked = { msg, labels }; window.__choice && (window.__choice === 'cascade' ? cascade : solo)(); }`);
        $('#btn-act').click();
        await tick();
        assert.match(run('__asked.msg'), /remplacement de ce coup rendra 1 coup/);
        assert.deepStrictEqual(JSON.parse(run('JSON.stringify(__asked.labels)')), { cascade: 'Supprimer aussi les 1 coup(s) orphelin(s)', solo: 'Remplacer ce coup seulement' });
        assert(run('!!analysis.merge'), 'Annuler : aperçu toujours ouvert');
        assert.strictEqual(run(`openingDB['${k(['e2e4', 'e7e5'])}'].move`), 'g1f3', 'Annuler : rien n\'est écrit');
        run(`window.__choice = 'cascade'`);
        $('#btn-act').click();
        await tick();
        assert.strictEqual(run('analysis.merge'), null, 'aperçu fermé');
        assert.strictEqual(run(`openingDB['${k(['e2e4', 'e7e5'])}'].move`), 'f1c4', 'Fc4 remplace Cf3');
        assert.strictEqual(run(`openingDB['${k(['e2e4', 'e7e5', 'g1f3', 'b8c6'])}']`), undefined, 'Fb5, devenu injouable, part aussi');
        assert.strictEqual(title(), '1 coup enregistré au répertoire');
    });

    await t('« Corriger » au crayon : retour avant mon dernier coup ; « Poser » à la palette', async () => {
        run(`analysisGo('e2e4,e7e5,f1c4')`);
        run('analysisEditMove()');
        assert.deepStrictEqual(JSON.parse(run('JSON.stringify(_displayedPath())')), ['e2e4', 'e7e5']);
        assert.strictEqual(title(), 'Corriger Fc4');
        const tools = [...w.document.querySelectorAll('.controls-tools[data-modes="analysis"] .btn')];
        const ico = label => { const b = tools.find(x => x.textContent.trim() === label); return b && b.querySelector('use').getAttribute('href'); };
        assert.strictEqual(ico('Corriger'), '#i-pencil');
        assert.strictEqual(ico('Poser'), '#i-palette');
    });

    await t('brouillon repris d\'avant la règle : un seul coup à moi par position', async () => {
        run(`analysis.tree = { kids: [{ uci: 'e2e4', san: 'e4', kids: [{ uci: 'e7e5', san: 'e5', kids: [
                { uci: 'g1f3', san: 'Nf3', kids: [] }, { uci: 'f1c4', san: 'Bc4', kids: [] }] }] }, { uci: 'd2d4', san: 'd4', kids: [] }] }`);
        const gone = JSON.parse(run('JSON.stringify(_anUnique())'));
        assert.deepStrictEqual(gone.sort(), ['Bc4', 'd4']);
        run('quitAnalysis()');
        assert.deepStrictEqual(errors, []);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e); process.exit(1); });
