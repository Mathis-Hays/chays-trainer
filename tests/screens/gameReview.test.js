// Lancer : node tests/screens/gameReview.test.js   — « Analyser une partie » : lecture PGN et détection de la déviation, sans DOM
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const jeq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m || `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);   // objets issus du contexte vm

const store = {};
const ctx = {
    console, renderMoves() {}, renderBoard() {}, clearErrorFx() {}, resetNavCursor() {},
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); },
                 get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; return true; } }
};
vm.createContext(ctx);
ctx.registerActions = () => {};
for (const f of [scriptPath('chessEngine.js'), scriptPath('storage.js'), scriptPath('review.js'), scriptPath('boardLogic.js'), scriptPath('pgn.js'), scriptPath('gameReview.js'), scriptPath('onlineGames.js')])
    vm.runInContext(readVars(f), ctx, { filename: f });
vm.runInContext('saveDB = function () {};', ctx);

// Base d'un répertoire construite en rejouant des lignes UCI : mes coups deviennent des entrées.
function repertoire(color, lines) {
    return vm.runInContext(`(function (color, lines) {
        const db = {};
        lines.forEach(l => _withEngineSnapshot(() => {
            parseFEN(INIT_FEN);
            const path = [];
            l.split(' ').forEach(u => {
                if (turn === color && !db[positionKey()]) db[positionKey()] = { move: u, san: '', attempts: 1, failures: 0 };
                path.push(u); _applyUciRaw(u);
            });
        }));
        return db;
    })`, ctx)(color, lines);
}

const ITA = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3';
const db  = repertoire('w', [ITA, 'e2e4 c7c5 g1f3']);
const sans = pgn => ctx.pgnMainLine(pgn).sans;

const CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[White "moi"]
[Black "lui"]
[Result "1-0"]
[Link "https://www.chess.com/game/live/123"]

1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:57]} 2... Nc6 3. Bc4 Bc5 4. d3 Nf6 5. O-O 1-0`;

t('PGN Chess.com : en-têtes, horloges et numéros « 1... » sont ignorés', () => {
    const g = ctx.pgnMainLine(CHESSCOM);
    jeq(g.sans, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O']);
    assert.strictEqual(g.headers.Link, 'https://www.chess.com/game/live/123');
});

t('mon coup hors répertoire : déviation « me », réponse attendue fournie', () => {
    const r = ctx.detectDeviation(sans(CHESSCOM), 'w', db, {});
    assert.strictEqual(r.moves.length, 9, 'toute la partie reste navigable');
    assert.strictEqual(r.deviation.ply, 6);
    assert.strictEqual(r.deviation.by, 'me');
    assert.strictEqual(r.deviation.expected.uci, 'c2c3');
    assert(db[r.deviation.key], 'la clé désigne l\'entrée à pénaliser');
});

t('coup adverse hors répertoire : nouveauté adverse, rien d\'attendu', () => {
    const r = ctx.detectDeviation(sans('1. e4 e6 2. d4 d5 *'), 'w', db, {});
    jeq([r.deviation.ply, r.deviation.by, r.deviation.endOfLine, r.deviation.known], [1, 'opp', false, false]);
});

t('réponse adverse déjà repérée mais non couverte : known', () => {
    const key = vm.runInContext('_withEngineSnapshot(() => { parseFEN(INIT_FEN); _applyUciRaw("e2e4"); return positionKey(); })', ctx);
    const r = ctx.detectDeviation(sans('1. e4 e6 *'), 'w', db, { [key]: ['e7e6'] });
    assert.strictEqual(r.deviation.known, true);
});

t('au bout de la ligne : endOfLine', () => {
    const r = ctx.detectDeviation(sans('1. e4 c5 2. Nf3 d6 3. d4 *'), 'w', db, {});
    jeq([r.deviation.ply, r.deviation.by, r.deviation.endOfLine], [3, 'opp', true]);
});

t('partie 100 % théorique : pas de déviation', () => {
    const r = ctx.detectDeviation(sans('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *'), 'w', db, {});
    assert.strictEqual(r.deviation, null);
    assert.strictEqual(r.moves.length, 7);
});

t('transposition : un autre ordre de coups reste dans le répertoire', () => {
    // 1. e4 Cc6 2. Cf3 e5 rejoint la position de l'Italienne après 2... Cc6 : 3. Fc4 reste la réponse.
    const dbT = repertoire('w', [ITA, 'e2e4 b8c6 g1f3']);
    const r = ctx.detectDeviation(sans('1. e4 Nc6 2. Nf3 e5 3. Bc4 Bc5 4. c3 *'), 'w', dbT, {});
    assert.strictEqual(r.deviation, null);
    const r2 = ctx.detectDeviation(sans('1. e4 Nc6 2. Nf3 e5 3. Bb5 *'), 'w', dbT, {});
    jeq([r2.deviation.ply, r2.deviation.by, r2.deviation.expected.uci], [4, 'me', 'f1c4']);
});

t('Noirs : mon coup différent est une erreur', () => {
    const dbB = repertoire('b', ['e2e4 c7c5']);
    const r = ctx.detectDeviation(sans('1. e4 e5 *'), 'b', dbB, {});
    jeq([r.deviation.ply, r.deviation.by, r.deviation.expected.uci], [1, 'me', 'c7c5']);
});

t('coup illégal : lecture arrêtée, déviation antérieure conservée', () => {
    const r = ctx.detectDeviation(sans('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Ke5 *'), 'w', db, {});
    jeq([r.moves.length, r.illegal.ply, r.illegal.san, r.deviation.ply], [7, 7, 'Ke5', 6]);
});

// Base modifiable pour reviewGame : { db, opp, save }.
const baseOf = db => ({ db, opp: {}, saved: 0, save() { this.saved++; } });

t('erreur relevée une seule fois par partie (journal), « à vérifier » : rien de compté, en tête de la prochaine révision', () => {
    vm.runInContext('currentRepertoire = "Test"; playerColor = "w";', ctx);
    delete store['chessTrainer_gameLedger'];
    const g = ctx.pgnMainLine(CHESSCOM), b = baseOf(repertoire('w', [ITA]));
    const ledger = {};
    const a = ctx.reviewGame(g, 'w', 'Test', b, ledger);
    jeq([a.kind, a.counted, a.prev], ['mistake', 'counted', null]);
    const again = ctx.reviewGame(g, 'w', 'Test', b, ledger);
    jeq([again.kind, again.counted, !!again.prev], ['mistake', 'already', true]);
    const e = b.db[a.r.deviation.key];
    jeq([e.attempts, e.failures, !!e.prio, e.due <= Date.now()], [1, 0, true, true]);
    const id = 'chess.com/game/live/123';
    jeq(Object.keys(ledger), [id]);
    jeq([ledger[id].src, ledger[id].v['Test|w'].kind, !!ledger[id].counted['Test|w']], ['chesscom', 'mistake', true]);
});

const LICHESS = (moves, date = '2026.10.20', time = '18:00:00') =>
    `[Site "https://lichess.org/AbCdEfGh"]\n[White "moi"]\n[Black "lui"]\n[UTCDate "${date}"]\n[UTCTime "${time}"]\n\n${moves} *`;
t('autre ouverture dès mon premier coup : un choix, rien de compté ; une erreur comptée avant la règle est retirée une fois', () => {
    const g = ctx.pgnMainLine(LICHESS('1. d4 d5 2. c4')), b = baseOf(repertoire('w', [ITA]));
    const start = Object.keys(b.db).find(k => b.db[k].move === 'e2e4'), e = b.db[start];
    Object.assign(e, { attempts: 10, failures: 6, run: 0, relearn: 0, mastery: 0 });
    const id = ctx.gameIdOf(g.headers, g.sans);
    const ledger = { [id]: { src: 'lichess', at: 1, first: 1, last: 1, v: { 'Test|w': { kind: 'mistake', ply: 0, by: 'me', at: 1 } }, counted: { 'Test|w': { at: 1 } } } };
    const r = ctx.reviewGame(g, 'w', 'Test', b, ledger);
    jeq([r.kind, r.counted], ['choice', null]);
    jeq([e.attempts, e.failures, e.relearn, e.step], [9, 5, 0, 0]);
    assert(ledger[id].counted['Test|w'].undone, 'retrait noté au journal');
    ctx.reviewGame(g, 'w', 'Test', b, ledger);
    jeq([e.attempts, e.failures], [9, 5], 'une seule fois');
    const fresh = baseOf(repertoire('w', [ITA])), f = fresh.db[start];
    jeq([ctx.reviewGame(g, 'w', 'Test', fresh, {}).kind, f.attempts, f.failures, !!f.prio], ['choice', 1, 0, false]);
});

t('nettoyage unique : erreurs de premier coup déjà comptées retirées (Noirs : premier coup adverse lu dans l\'archive à la même heure)', () => {
    const w = repertoire('w', [ITA]), b = repertoire('b', ['d2d4 g8f6', 'e2e4 c7c6']);
    const kd4 = Object.keys(b).find(k => b[k].move === 'g8f6'), kw = Object.keys(w).find(k => w[k].move === 'e2e4');
    Object.assign(b[kd4], { attempts: 10, failures: 6, run: 0, mastery: 0 }); Object.assign(w[kw], { attempts: 5, failures: 2 });
    store['openingDB_Test_w'] = JSON.stringify(w); store['openingDB_Test_b'] = JSON.stringify(b);
    const T = 1700000000000, v = (c, ply) => ({ v: { ['Test|' + c]: { kind: 'mistake', ply, by: 'me', at: 1 } }, counted: { ['Test|' + c]: { at: 1 } } });
    store['chessTrainer_gameLedger'] = JSON.stringify({ g1: { src: 'chesscom', at: T, first: 1, last: 1, ...v('b', 1) }, g2: { src: 'pgn', at: 5, first: 1, last: 1, ...v('w', 0) },
        g3: { src: 'chesscom', at: T + 9e6, first: 1, last: 1, ...v('b', 1) } });
    const n = ctx.undoOpeningChoices([{ color: 'b', start: T + 500, sans: ['d4', 'd5'] }]);
    assert.strictEqual(n, 2, 'Noirs retrouvé dans l\'archive, Blancs sans archive ; la troisième partie, absente de l\'archive, attend');
    jeq([JSON.parse(store['openingDB_Test_b'])[kd4].failures, JSON.parse(store['openingDB_Test_w'])[kw].failures], [5, 1]);
    const L = JSON.parse(store['chessTrainer_gameLedger']);
    jeq([!!L.g1.counted['Test|b'].undone, L.g1.v['Test|b'].kind, !!L.g3.counted['Test|b'].undone], [true, 'choice', false]);
    assert.strictEqual(ctx.undoOpeningChoices([{ color: 'b', start: T + 500, sans: ['d4', 'd5'] }]), 0, 'une seule fois');
    delete store['chessTrainer_gameLedger'];
});

t('ancienne signature (reviewedGames) : erreur jamais recomptée', () => {
    const g = ctx.pgnMainLine(CHESSCOM), b = baseOf(repertoire('w', [ITA]));
    store['chessTrainer_reviewedGames'] = JSON.stringify([ctx._gameSignature(g.headers, g.sans, 'w', 'Test')]);
    assert.strictEqual(ctx.reviewGame(g, 'w', 'Test', b, {}).counted, 'already');
    delete store['chessTrainer_reviewedGames'];
});

const PLAYED = Date.UTC(2026, 9, 20, 18, 0, 0);

t('date de la partie : en-têtes Lichess et Chess.com, journée seule, absente', () => {
    assert.strictEqual(ctx.gamePlayedAt({ UTCDate: '2026.10.20', UTCTime: '18:00:00' }), PLAYED);
    assert.strictEqual(ctx.gamePlayedAt({ Date: '2026.10.20' }), Date.UTC(2026, 9, 20));
    assert.strictEqual(ctx.gamePlayedAt({ Date: '????.??.??' }), 0);
});

t('Traitée depuis : nouveauté adverse couverte par une réponse ajoutée après la partie', () => {
    // Répertoire : 1.e4 e5 2.Cf3 … ; dans la partie, 1…c5 (nouveauté), puis 2.Cc3 joué faute de préparation.
    // Après la partie, la réponse 2.Cf3 a été ajoutée contre 1…c5.
    const db = repertoire('w', [ITA, 'e2e4 c7c5 g1f3']);
    const k = Object.keys(db).find(x => db[x].move === 'g1f3' && x.includes('pp1ppppp'));
    Object.keys(db).forEach(x => { db[x].created = PLAYED - 86400000; });
    db[k].created = PLAYED + 3600000;
    db[k].attempts = 0; db[k].failures = 0; db[k].san = 'Nf3';
    const b = baseOf(db), g = ctx.pgnMainLine(LICHESS('1. e4 c5 2. Nc3 Nc6'));
    const res = ctx.reviewGame(g, 'w', 'Test', b, {});
    jeq([res.kind, res.counted, res.ply, res.by, res.answer.san], ['treated', null, 1, 'opp', 'Nf3']);
    assert(db[k].prio > 0, 'réponse jamais réussie : prioritaire');
    jeq([db[k].attempts, db[k].failures], [0, 0]);
    // Réponse antérieure à la partie : le même coup reste une erreur.
    db[k].created = PLAYED - 1;
    jeq(ctx.reviewGame(g, 'w', 'Test2', baseOf(db), {}).kind, 'mistake');
});

t('Traitée depuis : entrées sans date, la déviation notée à la première analyse fait foi', () => {
    const db = repertoire('w', [ITA]);
    const g = ctx.pgnMainLine('[Site "https://lichess.org/ZzZzZzZz"]\n\n1. e4 c5 2. Nc3 Nc6 *');
    const ledger = {};
    jeq(ctx.reviewGame(g, 'w', 'Test', baseOf(db), ledger).kind, 'novelty');
    // Depuis : réponse 2.Cf3 ajoutée (ancienne entrée, sans date de création).
    Object.assign(db, repertoire('w', ['e2e4 c7c5 g1f3']));
    const res = ctx.reviewGame(g, 'w', 'Test', baseOf(db), ledger);
    jeq([res.kind, res.counted, res.ply, !!res.prev], ['treated', null, 1, true]);
});

t('réponse retrouvée : la priorité est levée', () => {
    const e = { move: 'g1f3', san: 'Nf3', attempts: 0, failures: 0, prio: 5, due: 1, interval: 0 };
    vm.runInContext('recordReview', ctx)(e, false);
    assert.strictEqual(e.prio, 5);
    vm.runInContext('recordReview', ctx)(e, true);
    assert.strictEqual(e.prio, undefined);
});

t('parties en ligne : couleur déduite du pseudo, erreurs relevées une fois, autre ouverture classée à part', () => {
    store['openingDB_Test_w'] = JSON.stringify(repertoire('w', [ITA]));
    store['openingDB_Test_b'] = JSON.stringify(repertoire('b', ['e2e4 c7c5']));
    const pgn = `[Site "https://lichess.org/a1"]\n[White "Moi"]\n[Black "x"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 *\n\n`
              + `[Site "https://lichess.org/a2"]\n[White "y"]\n[Black "moi"]\n\n1. e4 c5 2. Nf3 d6 *\n\n`
              + `[Site "https://lichess.org/a3"]\n[White "y"]\n[Black "moi"]\n\n1. e4 e5 *\n\n`
              + `[Site "https://lichess.org/a4"]\n[White "z"]\n[Black "w"]\n\n1. d4 *`;
    const games = ctx.pgnGames(pgn);
    assert.strictEqual(games.length, 4);
    const a = ctx.analyzeOnlineGames(games, 'MOI', 'Test');
    jeq(a.rows.map(r => r.color + ':' + r.kind), ['w:mistake', 'b:novelty', 'b:choice']);
    jeq([a.summary.games, a.summary.mistakes, a.summary.newMistakes, a.summary.skipped], [3, 1, 1, 1]);
    const c5 = Object.values(JSON.parse(store['openingDB_Test_b']))[0];
    jeq([c5.attempts, c5.failures], [1, 0], '1… e5 au lieu de 1… c5 : un choix');
    const again = ctx.analyzeOnlineGames(games, 'moi', 'Test');
    jeq([again.summary.mistakes, again.summary.newMistakes, again.summary.seen], [1, 0, 3]);
});

console.log(`\n${n} tests réussis.`);
