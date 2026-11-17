// Lancer : node tests/screens/clubWhatIf.test.js   — atelier « L'envie de revenir », lot 6 : Adversaire du club (ClubMatch,
// séance 'club' de l'Entraînement) et « Et si » sur mes parties (WhatIf, Analyse contre le moteur bridé). Charge index.html entier.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window, ev = s => w.eval(s), J = s => JSON.parse(ev(`JSON.stringify(${s})`));
    const until = async (cond, ms = 8000) => { const end = Date.now() + ms; while (!ev(cond)) { if (Date.now() > end) throw new Error('délai : ' + cond); await sleep(50); } };

    // Répertoire « Club » : l'Italienne aux Blancs ; aux Noirs, seulement 1. e4 e5. Mes parties : 1. d4 contre moi, 10 fois.
    ev(`(() => {
        addRepertoire('Club');
        const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], db = {};
        for (let i = 0; i < line.length; i += 2) {
            const pos = Chess.replay(line.slice(0, i));
            db[Chess.key(pos)] = { move: line[i], san: Chess.san(pos, line[i]), attempts: 2, failures: 0, path: line.slice(0, i + 1), ply: i + 1 };
        }
        dataStore.set(dbKeyFor('Club', 'w'), JSON.stringify(db));
        const p1 = Chess.replay(['e2e4']);
        dataStore.set(dbKeyFor('Club', 'b'), JSON.stringify({ [Chess.key(p1)]: { move: 'e7e5', san: 'e5', attempts: 2, failures: 0, path: ['e2e4', 'e7e5'], ply: 2 } }));
        dataStore.setJSON('chessTrainer_gameFreq', { games: [], w: {}, b: { [Chess.key(Chess.start())]: { d2d4: 10 } } });
        dataStore.remove('chessTrainer_lichessToken');
        appSettings.oppDelay = 'instant';
        currentRepertoire = 'Club';
    })()`);
    const play = async () => {
        for (let i = 0; i < 20 && ev('!!trainingState.session'); i++) {
            await until('!trainingState.session || !trainingState.busy');
            if (!ev('trainingState.session')) break;
            ev(`(() => { const e = openingDB[positionKey()], m = _parseUci(e.move); GameModes.current().onMove(m.from, m.to, m.promo); })()`);
        }
    };

    await t('tirage : pondéré par le nombre de parties, les coups joués moins de 2 % du temps écartés', () => {
        const moves = [['e7e5', 60], ['c7c5', 39], ['a7a6', 1]];
        assert.deepStrictEqual(J(`ClubMatch.choose(${JSON.stringify(moves)}, () => 0)`), { uci: 'e7e5', share: .6 });
        assert.strictEqual(J(`ClubMatch.choose(${JSON.stringify(moves)}, () => .99)`).uci, 'c7c5', 'a6 (1 %) n\'est jamais tiré');
        assert.strictEqual(J(`ClubMatch.choose([], () => 0)`), null);
    });

    await t('sans jeton ni parties : les branches du répertoire, jusqu\'à la fin de la préparation ; chaque coup compte', async () => {
        ev(`switchHomeTab('training'); startTrainingExercise('club')`);
        assert.strictEqual(ev('trainingState.session.kind'), 'club');
        await play();
        await until('!trainingState.session');
        const s = J('trainingState.lastSummary');
        assert.strictEqual(s.kind, 'club');
        assert.strictEqual(s.club.end, 'prep');
        assert.strictEqual(s.club.source, 'repertoire');
        assert.strictEqual(s.ok, 3, 'e4, Cf3, Fc4');
        assert.strictEqual(ev(`readDBFor('Club', 'w')[Chess.key(Chess.start())].attempts`), 3, 'compté comme une révision');
        ev('initTraining()');
        assert(/coups trouvés du premier coup/.test(w.document.querySelector('.trr-club').textContent));
    });

    await t('la première erreur arrête la partie, et compte', async () => {
        ev(`startTrainingExercise('club')`);
        await until('trainingState.session && !trainingState.busy');
        ev(`(() => { const m = _parseUci('d2d4'); GameModes.current().onMove(m.from, m.to, null); })()`);
        await until('!trainingState.session');
        assert.strictEqual(J('trainingState.lastSummary.club.end'), 'mistake');
        assert.strictEqual(ev(`readDBFor('Club', 'w')[Chess.key(Chess.start())].failures`), 1);
    });

    await t('mes parties : 1. d4 sans réponse → sortie du répertoire, coup noté dans oppSeen, « Ajouter une réponse »', async () => {
        ev(`statsColor = 'b'; _trColor = 'b'; ClubMatch.start('b')`);
        await until('!trainingState.session');
        const c = J('trainingState.lastSummary.club');
        assert.strictEqual(c.end, 'hole');
        assert.strictEqual(c.source, 'games');
        assert.strictEqual(c.exit.san, 'd4');
        assert.deepStrictEqual(c.exit.path, ['d2d4']);
        assert.deepStrictEqual(J(`readOppFor('Club', 'b')[Chess.key(Chess.start())]`), ['d2d4']);
        ev(`initTraining()`);
        const add = w.document.querySelector('[data-action="trainingClubAdd"]');
        assert(add, 'bouton au bilan');
        add.click();
        assert.strictEqual(ev('gameMode'), 'analysis');
        assert.deepStrictEqual(J('_anLine()'), ['d2d4']);
        ev('quitAnalysis()');
    });

    await t('« Et si » : force croissante avec l\'Elo ; le meilleur coup tiré en tête, les autres d\'autant plus que l\'Elo est bas', () => {
        const a = J('WhatIf.strength(1000)'), b = J('WhatIf.strength(2200)');
        assert(a.depth < b.depth && a.temp > b.temp);
        const lines = [{ pv: ['e7e5'], score: { cp: -20 } }, { pv: ['a7a5'], score: { cp: 150 } }];   // les Noirs au trait : -20 est le meilleur
        assert.strictEqual(ev(`WhatIf.pick(${JSON.stringify(lines)}, false, 2200, () => .5)`), 'e7e5');
        assert.strictEqual(ev(`WhatIf.pick(${JSON.stringify(lines)}, false, 800, () => .99)`), 'a7a5', 'faible : le second coup reste possible');
        assert.strictEqual(ev(`WhatIf.pick([], true, 1500)`), null);
    });

    await t('« Et si » : l\'Analyse après le coup du répertoire, le moteur répond, sans évaluation ; « Revoir avec le moteur » la rend', async () => {
        ev(`Engine._a = Engine.analyse; Engine.analyse = (fen, o, cb) => { cb([{ pv: ['b8c6'], score: { cp: 0 } }]); return { stop() {}, done: Promise.resolve({}) }; }`);
        ev(`WhatIf.start({ path: ['e2e4', 'e7e5', 'g1f3'], color: 'w', elo: 1500, back: () => goHome('stats') })`);
        await until(`_anLine().length === 4`);
        assert.deepStrictEqual(J('_anLine()'), ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
        const $ = s => w.document.querySelector(s);
        assert($('.wi-card') && !$('#an-engine'), 'carte « Et si » à la place du moteur');
        assert.deepStrictEqual(J('analysisArrowList()'), []);
        ev(`UI_ACTIONS.whatIfRelease()`);
        assert(!ev('WhatIf.active()') && $('#an-engine') && !$('.wi-card'));
        ev(`Engine.analyse = Engine._a; quitAnalysis()`);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
