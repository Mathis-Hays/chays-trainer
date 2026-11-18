// Lancer : node tests/screens/trainScored.test.js   — chantier « Révision du jour » : seules les séances de révision
// (TRAIN_SCORED) notent dans le répertoire ; les autres modes gardent leurs propres comptes. Sans DOM (training.js en vm).
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {}, reviews = [], logs = [];
const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    playSound() {}, setStatusAction() {}, setStatus() {}, saveDB() {}, revealSolution() {}, noteMistake() {},
    dataStore: { getJSON: (k, d) => (k in store ? store[k] : d), setJSON: (k, v) => { store[k] = v; },
                 get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } },
    currentRepertoire: 'Général', gameMode: 'training', playerColor: 'w', turn: 'w',
    appSettings: { freeMaxPlies: 0, freeSeqLen: 1, freeFromStart: 0 },
    readDBFor: () => ({}), _level: () => 'fragile', masteryOf: () => 50, hintLevel: () => 0, runOf: e => e.run || 0,
    formatSanText: s => s, RELEARN_DAYS: [1, 3, 7], dueInLabel: () => 'demain', STATS_LEVELS: { fragile: { one: 'Fragile' } },
    positionKey: () => 'k', openingDB: {},
    recordReview: (e, ok, help) => { reviews.push({ ok, help }); e.due = 1; e.mastery = ok ? 70 : 20; },
    ClubMatch: { stopText: () => '', finish() {}, next() {} },
    logActivity: (ok, played) => logs.push(!!played)
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(scriptPath('modes.js'), 'utf8'), ctx);
const f = scriptPath('training.js');
vm.runInContext(readVars(f), ctx, { filename: f });
// L'échiquier n'existe pas ici : coups refusés ou joués sans écran.
Object.assign(ctx, { _rejectMove() {}, _commitMove() {}, _renderSessionBar() {}, _continueSequence() {}, trainingBackToLive() {} });
const { trainingState } = ctx;

const entry = () => ({ move: 'e2e4', san: 'e4', attempts: 4, failures: 1, interval: 3, due: 5, relearn: 1, mastery: 50, run: 2 });
const session = kind => {
    trainingState.session = kind === null ? null : {
        kind, label: kind, items: [{ color: 'w', key: 'k', res: null, second: false }], i: 0, cur: 0, results: new Map(),
        line: kind === 'line' || kind === 'club' ? { color: 'w', path: [], name: 'x' } : null, colors: ['w'], started: Date.now(),
        end: kind === 'timed' ? Date.now() + 60000 : 0, score: 0, lives: kind === 'survival' ? 3 : 0
    };
    trainingState.keyErred = false; trainingState.solutionFor = null; trainingState.busy = false;
    trainingState.drill = {}; trainingState.seq = { len: 1, done: 0, assisted: false };
};
const play = (kind, good) => {
    session(kind);
    const e = entry();
    ctx.openingDB = { k: e };
    reviews.length = 0;
    ctx.answerTrainingMove(e, 12, 28, null, good ? 'e2e4' : 'd2d4');
    return e;
};
const untouched = (e, why) => {
    const ref = entry();
    ['attempts', 'failures', 'due', 'relearn', 'mastery', 'run', 'interval'].forEach(k => assert.strictEqual(e[k], ref[k], `${why} : ${k} inchangé`));
    assert.strictEqual(reviews.length, 0, `${why} : recordReview jamais appelé`);
};

t('TRAIN_SCORED : exactement les séances de révision', () => {
    assert.deepStrictEqual([...ctx.TRAIN_SCORED].sort(), ['due', 'line', 'relearn', 'review', 'unsure', 'weak']);
});

['due', 'review', 'relearn', 'weak', 'unsure', 'line'].forEach(kind => t(`révision « ${kind} » : erreur et réussite notées`, () => {
    const ko = play(kind, false);
    assert.strictEqual(ko.attempts, 5); assert.strictEqual(ko.failures, 2); assert.strictEqual(reviews[0].ok, false);
    const ok = play(kind, true);
    assert.strictEqual(ok.attempts, 5); assert.strictEqual(ok.failures, 1); assert.strictEqual(reviews[0].ok, true);
}));

['timed', 'survival', 'daily', 'club', 'retry', 'frame'].forEach(kind => t(`« ${kind} » : ni erreur ni réussite écrites dans l'entrée`, () => {
    untouched(play(kind, false), `${kind}, erreur`);
    untouched(play(kind, true), `${kind}, réussite`);
}));

t('mode libre (sans séance) : rien n\'est noté', () => {
    untouched(play(null, false), 'libre, erreur');
    untouched(play(null, true), 'libre, réussite');
});

t('hors révision : une trace de passage pour la série de jours (logActivity(…, true)), une seule par passage ; en révision, aucune', () => {
    ['timed', 'survival', 'daily', 'club', 'retry', 'frame', null].forEach(kind => {
        logs.length = 0; play(kind, false);
        assert.deepStrictEqual([...logs], [true], `${kind}, erreur`);
        ctx.answerTrainingMove(ctx.openingDB.k, 12, 28, null, 'e2e4');     // réussite après l'erreur : rien de plus
        assert.deepStrictEqual([...logs], [true], `${kind}, une seule trace`);
        logs.length = 0; play(kind, true);
        assert.deepStrictEqual([...logs], [true], `${kind}, réussite`);
    });
    logs.length = 0; play('due', false); play('due', true);
    assert.deepStrictEqual([...logs], [], 'révision : recordReview s\'en charge (stub ici), pas de trace hors révision');
});

t('les comptes propres restent : vies de la Survie, temps du contre-la-montre, score des records', () => {
    play('survival', false);
    assert.strictEqual(trainingState.session.lives, 2, 'une vie perdue');
    session('timed');
    const end = trainingState.session.end, e = entry();
    ctx.answerTrainingMove(e, 12, 28, null, 'd2d4');
    assert(trainingState.session.end < end, 'pénalité de temps');
    play('survival', true);
    assert.strictEqual(trainingState.session.score, 1, 'bon coup compté au score');
    assert.strictEqual(trainingState.session.results.get('k').ok, true, 'le bilan (et le défi du jour) garde son verdict');
});

t('deuxième passage d\'une révision : rien n\'est noté', () => {
    session('due');
    trainingState.session.items[0].second = true;
    const e = entry(); ctx.openingDB = { k: e }; reviews.length = 0;
    ctx.answerTrainingMove(e, 12, 28, null, 'd2d4');
    untouched(e, 'deuxième passage');
});

t('solution dévoilée : une erreur en révision, rien ailleurs ; le coût annoncé suit', () => {
    const reveal = kind => { session(kind); const e = entry(); ctx.openingDB = { k: e }; reviews.length = 0; ctx.showTrainingSolution(); return e; };
    const due = reveal('due');
    assert.strictEqual(due.failures, 2); assert.strictEqual(reviews.length, 1);
    ['timed', 'survival', 'daily', 'club', 'retry', 'frame', null].forEach(kind => untouched(reveal(kind), `solution, ${kind}`));
    const cost = () => vm.runInContext("GameModes.current().solutionCost() + GameModes.current().hintCost(1)", ctx);
    session('weak');
    assert(/erreur/.test(cost()) && /réduit/.test(cost()), 'révision : indice et solution ont un coût annoncé');
    session('survival');
    assert.strictEqual(cost(), '', 'Survie : rien n\'est annoncé');
});

console.log(`\n${n} tests réussis.`);
