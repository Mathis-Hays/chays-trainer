/**
 * screens/training/training.js
 * ──────────────────────────────────────────────────────────────────────────
 * Moteur de l'Entraînement (l'onglet lui-même est rendu par trainingUI.js).
 *
 * Deux façons de poser les positions :
 *   1. Séance guidée (startSession) : une liste connue d'avance, avec barre de progression et bilan.
 *        due     Révision du jour : positions dont la révision est due
 *        weak    Points faibles : positions à retravailler ou fragiles
 *        unsure  À découvrir : positions jamais retrouvées de mémoire (nouvelles d'abord, coup montré)
 *        review  Liste donnée par l'onglet Statistiques (startReviewQueue)
 *        retry   Erreurs d'une séance précédente
 *        line    Ligne complète : une ouverture jouée du premier coup jusqu'au bout de la variante
 *        timed   Contre-la-montre : TRAIN_TIMED_MS pour enchaîner un maximum de bons coups
 *      Une position ratée au premier essai revient une fois en fin de séance (sauf ligne et chrono) ;
 *      seul le premier essai compte pour le bilan. Seules les séances de révision (TRAIN_SCORED : due, review,
 *      relearn, weak, unsure, line) notent dans le répertoire ; les autres gardent leurs propres comptes.
 *   2. Mode libre (startTraining) : tirage aléatoire pondéré sans fin (cf. _trainingWeight), rien n'est noté.
 *      Ses options (Paramètres › Jeu et entraînement) : profondeur max, départ, nombre de coups à enchaîner.
 *
 * Pour chaque position : l'échiquier se place 3 demi-coups avant, rejoue automatiquement ces trois coups
 * (contexte, touchez l'échiquier pour passer), puis me rend la main.
 *   Une seule note par passage, donnée par le premier coup, en révision seulement (_scores) ; le deuxième passage
 *   d'une séance n'en donne pas. Paliers (chantier « Erreurs et niveaux », review.js) :
 *   - position jamais présentée : son coup est montré, à jouer tel quel (_presentIfNew, presentEntry) ; rien n'est
 *     compté, elle revient demain, de mémoire ;
 *   - succès : attempts + 1, palier + 1 (gardé en rattrapage ou avec l'indice), planning (recordReview) ;
 *   - erreur (recordMiss) : en découverte, rien n'est compté ; sinon attempts + 1, failures + 1, un palier de moins et
 *     rattrapage demain (deux erreurs d'affilée : découverte) ; on réessaie, sans rien compter de plus ;
 *   - indice en trois paliers (showHint, boardLogic.js), barème de recordReview(entry, true, palier) :
 *       type de pièce : réussite sans montée, palier gardé ;
 *       pièce exacte : neutre, palier gardé, revue demain ;
 *       solution (3e appui) : compte comme une erreur (recordMiss), aucune réussite comptée.
 *     La gravure « Maîtrisée » reste réservée au coup trouvé sans aide.
 */

'use strict';

const TRAIN_STEP_MS = 750;
const TRAIN_CONTEXT_PLIES = 4;   // demi-coups rejoués avant que la main soit rendue (refonte « Chays sans détour », lot 4 : la position arrive par sa ligne)

// Afficher la solution compte comme un échec sur la position (attempts + 1, failures + 1), une seule fois.
// Mettre à false pour que la solution ne modifie aucune statistique.
const TRAIN_SOLUTION_PENALTY = true;

const TRAIN_RECORD_KEY   = 'chessTrainer_timedRecord';      // record du contre-la-montre (synchronisé : le plus grand l'emporte)
const TRAIN_SEQ_END      = 999;
const TRAIN_TIMED_MS     = 3 * 60000;
const TRAIN_TIMED_PENALTY_MS = 10000;                       // une erreur au contre-la-montre coûte 10 s
// Survie (atelier « L'envie de revenir », lot 3) : trois vies, du plus sûr au plus fragile, jusqu'à la troisième erreur.
const TRAIN_SURVIVAL_KEY   = 'chessTrainer_survivalRecord';  // record de la Survie (synchronisé : le plus grand l'emporte)
const TRAIN_SURVIVAL_LIVES = 3;
// Séances à score (bilan : score et record, pas d'anneau du premier coup).
const _trScoreKind = k => k === 'timed' || k === 'survival';
// Séances en bouchées (atelier « L'envie de revenir », lot 1, préférence trainBites) : une pause toutes les TRAIN_BITE
// positions, « Encore 5 » pour continuer, Quitter pour garder le bilan ; pas de pause s'il en reste moins de TRAIN_BITE_MIN_LEFT.
const TRAIN_BITE = 5;
const TRAIN_BITE_MIN_LEFT = 3;

const trainingState = {
    busy: false, timers: [], lastKey: null, current: null, ok: 0, reason: '', mixed: false,
    seq: { len: 1, done: 0, assisted: false },
    solutionFor: null,
    session: null,          // séance guidée en cours (cf. startSession)
    lastSummary: null,      // bilan de la dernière séance, affiché par l'onglet Entraînement
    keyErred: false,        // erreur (ou solution) sur la position posée
    presenting: null,       // position en découverte dont le coup est montré (_presentIfNew)
    keyLv: null,            // niveau de la position posée avant le coup (bilan : avant → après)
    combo: 0,               // série en cours de positions réussies du premier coup (séance guidée)
    ctxSkip: null,          // passe la mise en situation en cours
    tick: null,             // minuteur du contre-la-montre
    drill: { erred: false, keys: [], answered: null },   // exercice en cours : erreur ou solution, positions posées, dernière réponse
    bite: false,            // pause entre deux bouchées (_offerBite) : Entrée continue
    pause: null,            // fin d'exercice en attente : { key, status } de la position répondue (Suivant, Analyser, Corriger)
    editing: null,          // « Corriger » : position dont on attend le nouveau coup
    review: null,           // revue d'une position close de la pellicule (trainingReview) : { i, key, color, pre, replay, live }
    missUndo: null,         // « Mauvais clic » (R14) : { key, entry, lives } d'avant l'erreur, le temps de l'offre
    misclickUsed: false     // une seule fois par séance
};

// Séance occupée (mise en situation, réponse adverse) : ◀ ▶ se grisent avec elle (updateNavButtons, fiche navBlocked) ;
// en pause de fin d'exercice ou de bouchée, ils restent actifs (chantier « L'échiquier de Chays », R2, bugs B1 et B2).
(function watchBusy() {
    let busy = trainingState.busy;
    Object.defineProperty(trainingState, 'busy', {
        enumerable: true,
        get: () => busy,
        set(v) {
            const was = busy;
            busy = !!v;
            if (was !== busy && typeof updateNavButtons === 'function' && typeof document !== 'undefined' && document.getElementById) updateNavButtons();
        }
    });
})();

// ─── OPTIONS DU MODE LIBRE (préférences synchronisées, settings.js) ───────────

const _FREE_PREFS = { maxPlies: 'freeMaxPlies', seqLen: 'freeSeqLen', fromStart: 'freeFromStart' };
const trainingSettings = {
    get maxPlies()  { return appSettings.freeMaxPlies; },
    get seqLen()    { return appSettings.freeSeqLen; },
    get fromStart() { return appSettings.freeFromStart; }
};

function setTrainingOption(name, value) {
    const key = _FREE_PREFS[name], v = Number(value);
    if (!key || !SYNCED_PREFS[key].ok(v)) return;
    appSettings[key] = v;
    saveSettings();
    initTraining();
}

// Ancien nom du record du contre-la-montre (chessTrainer.timedRecord) : repris une fois.
(function migrateTimedRecord() {
    const OLD = 'chessTrainer.timedRecord', old = dataStore.get(OLD);
    if (old === null) return;
    if (dataStore.get(TRAIN_RECORD_KEY) === null) dataStore.set(TRAIN_RECORD_KEY, old);
    dataStore.remove(OLD);
})();

function _entryDepth(e) { return e.ply || (e.path && e.path.length) || null; }

// Profondeur max : ne filtre que le mode libre (une séance guidée pose exactement sa liste).
function _isEligible(e) {
    if (trainingState.session || !trainingSettings.maxPlies) return true;
    const d = _entryDepth(e);
    return d !== null && d <= trainingSettings.maxPlies;
}

function _later(fn, ms) { trainingState.timers.push(setTimeout(fn, ms)); }
// ◀ ▶ suivent l'état de la séance (pause, bouchée, revue) ; sans écran de jeu (tests du seul script), rien.
function _navRefresh() { if (typeof updateNavButtons === 'function' && typeof document !== 'undefined' && document.getElementById) updateNavButtons(); }

function stopTraining() {
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingState.busy   = false;
    trainingState.ctxSkip = null;
    trainingState.pause  = null;
    trainingState.bite   = false;
    trainingState.editing = null;
    _syncAfterTools();
    _navRefresh();
}

// ─── VU EN PARTIE ─────────────────────────────────────────────────────────────
// Préférence trainSeen : exercices limités aux positions atteintes dans mes parties (SeenPositions). Ici, le tirage
// du mode libre et du contre-la-montre ; le menu (trainingUI.js) filtre les listes. Jamais la Révision du jour.
// Suspendu sous SeenPositions.MIN positions vues dans la portée (archive vide, appareil neuf).
function trainingSeenOnly(colors) {
    if (!appSettings.trainSeen || typeof SeenPositions === 'undefined' || !SeenPositions.ready()) return false;
    return SeenPositions.countIn(currentRepertoire, colors || ['w', 'b']) >= SeenPositions.MIN;
}
const _seenPick = only => (color, key) => !only || SeenPositions.has(color, key);

// ─── MODE LIBRE ───────────────────────────────────────────────────────────────

// Univers de révision : positions du répertoire respectant la profondeur maximale choisie (et vues en partie).
function _trainingPool() {
    const ok = _seenPick(trainingSeenOnly());
    return Object.keys(openingDB).filter(k => _isEligible(openingDB[k]) && ok(playerColor, k));
}

const _hasPool = (c, ok) => Object.entries(readDBFor(currentRepertoire, c)).some(([k, e]) => _isEligible(e) && ok(c, k));

// Couleur tirée à pile ou face pour l'exercice suivant (mode mélangé) ; null si aucune position.
function _pickTrainingColor(colors) {
    const ok = _seenPick(trainingSeenOnly(colors));
    colors = (colors || ['w', 'b']).filter(c => _hasPool(c, ok));
    return colors.length ? colors[Math.floor(Math.random() * colors.length)] : null;
}

// Changement de couleur depuis le badge de la barre du haut (quitte le mode mélangé).
function switchTrainingColor(color) {
    if (!_hasPool(color, _seenPick(trainingSeenOnly()))) {
        setStatus(`Aucune position ${color === 'w' ? 'Blancs' : 'Noirs'} à réviser dans ce répertoire.`, 'info');
        return;
    }
    startTraining(color);
}

// Mode libre ; color : 'w' | 'b' | 'mix' (Blancs et Noirs mélangés).
function startTraining(color) {
    _clearSession();
    trainingState.mixed = color === 'mix';
    if (trainingState.mixed) color = _pickTrainingColor();
    if (!color) { trainingState.mixed = false; initTraining(); return; }
    playerColor = color;
    gameMode    = 'training';
    loadDB();
    if (!_trainingPool().length) { gameMode = 'play'; initTraining(); return; }
    trainingState.ok = 0;
    trainingState.lastKey = null;
    showGameScreen(color);
    _renderSessionBar();
    nextDrill();
}

// ─── SÉANCE GUIDÉE ────────────────────────────────────────────────────────────

// opts : { kind, label, items: [{ color, key }], returnTab, colors (chrono), line: { color, path, name } }
function startSession(opts) {
    _clearSession();
    const dbs = {};   // une lecture par couleur : relire la base à chaque position coûtait près de 0,5 s sur téléphone
    const db = c => dbs[c] || (dbs[c] = readDBFor(currentRepertoire, c));
    const items = (opts.items || []).filter(it => db(it.color)[it.key]);
    if (opts.kind !== 'timed' && opts.kind !== 'line' && opts.kind !== 'club' && !items.length) return false;
    const S = trainingState.session = {
        kind: opts.kind, label: opts.label, returnTab: opts.returnTab || 'training',
        items: items.map(it => opts.resume ? Object.assign({ res: null, second: false, tries: [], help: 0 }, it)
                                           : ({ color: it.color, key: it.key, res: null, second: false, tries: [], help: 0 })),
        i: 0, cur: -1, results: new Map(), line: opts.line || null, colors: opts.colors || ['w', 'b'],
        started: Date.now(), end: opts.kind === 'timed' ? Date.now() + TRAIN_TIMED_MS : 0, score: 0,
        keep: opts.keep || null,     // bilan à retrouver en fin de séance (un cadre de la pellicule rejoué)
        lives: opts.kind === 'survival' ? TRAIN_SURVIVAL_LIVES : 0
    };
    trainingState.mixed   = false;
    trainingState.ok      = 0;
    trainingState.lastKey = null;
    trainingState.combo   = 0;
    trainingState.review  = null;
    trainingState.misclickUsed = false;
    trainingState.missUndo = null;
    const R = opts.resume;                              // reprise après rechargement (R11) : on repart de la première case ouverte
    if (R) {
        (R.results || []).forEach(r => { if (S.items.some(x => x.key === r.key)) S.results.set(r.key, r); });
        S.score = R.score || 0;
        if (S.kind === 'survival') S.lives = R.lives;
        S.started = R.started || S.started;
        const k = S.items.findIndex(x => !x.res && !x.dropped);
        S.i = k < 0 ? S.items.length : k;
        S.biteAt = S.i;
        trainingState.misclickUsed = !!R.misclickUsed;
    }
    gameMode = 'training';
    playerColor = S.kind === 'line' || S.kind === 'club' ? S.line.color : S.kind === 'timed' ? (_pickTrainingColor(S.colors) || 'w') : S.items[0].color;
    loadDB();
    showGameScreen(playerColor);
    if (S.kind === 'timed') trainingState.tick = setInterval(_timedTick, 250);
    _renderSessionBar();
    nextDrill();
    if (typeof TrainFocus !== 'undefined') TrainFocus.sync();
    _saveSession();
    return true;
}

// Liste donnée par l'onglet Statistiques ; returnTab = onglet rouvert à la fin.
function startReviewQueue(items, returnTab) {
    return startSession({ kind: 'review', label: 'Révision', items, returnTab });
}

function _clearSession() {
    if (trainingState.tick) clearInterval(trainingState.tick);
    trainingState.tick = null;
    trainingState.session = null;
    trainingState.review = null;
    trainingState.missUndo = null;
    if (typeof TrainFocus !== 'undefined') TrainFocus.sync();
}

// Position suivante de la séance (l'élément en cours est clos : réussi, raté ou passé).
function _nextSessionDrill() {
    const S = trainingState.session;
    if (S.cur >= 0) {
        const it = S.items[S.cur];
        if (!it.res) it.res = 'skip';
        S.i = S.cur + 1;
        S.cur = -1;
    }
    if (S.kind === 'timed') {
        if (Date.now() >= S.end) { _endSession(); return; }
        const c = _pickTrainingColor(S.colors);
        if (!c) { _endSession(); return; }
        if (c !== playerColor) { playerColor = c; loadDB(); showGameScreen(c); }
        const key = _pickDrill();
        S.items.push({ color: c, key, res: null, second: false, tries: [], help: 0 });
        S.cur = S.items.length - 1;
        _startDrill(key, 1, { noContext: true });
        return;
    }
    if (S.kind === 'line') {
        if (S.i > 0) { _endSession(); return; }       // une seule partie de la ligne
        S.cur = 0;
        S.items = [];
        if (!_startFullLine()) { setStatus('Aucune ligne enregistrée pour cette ouverture.', 'info'); _later(() => _endSession(), 1200); }
        return;
    }
    if (S.kind === 'club') {                          // Adversaire du club (lot 6) : une partie, clubMatch.js
        if (S.i > 0) { _endSession(); return; }
        S.cur = 0;
        S.items = [];
        if (!ClubMatch.begin()) { setStatus('Aucune réponse enregistrée au premier coup.', 'info'); _later(() => _endSession(), 1200); }
        return;
    }
    if (S.kind === 'survival' && S.lives <= 0) { _endSession(); return; }
    if (_biteDue(S)) { _offerBite(S); return; }
    while (S.i < S.items.length) {
        const it = S.items[S.i];
        if (it.color !== playerColor) { playerColor = it.color; loadDB(); showGameScreen(it.color); }
        if (openingDB[it.key] && !it.dropped) { S.cur = S.i; _startDrill(it.key, 1); return; }
        it.res = 'skip';
        S.i++;
    }
    _endSession();
}

// Fin d'une bouchée : TRAIN_BITE positions closes depuis le début (ou la dernière pause), et assez de suite derrière.
function _biteDue(S) {
    if (!appSettings.trainBites || S.kind === 'timed' || S.kind === 'line' || S.kind === 'club' || S.kind === 'survival') return false;
    return S.i > 0 && S.i % TRAIN_BITE === 0 && S.biteAt !== S.i && S.items.length - S.i >= TRAIN_BITE_MIN_LEFT;
}

// Pause entre deux bouchées : l'échiquier reste sur la dernière position, aucun coup n'est attendu (busy).
function _offerBite(S) {
    S.biteAt = S.i;
    trainingState.busy = true;
    trainingState.bite = true;
    _biteStatus(S);
    _renderSessionBar();
    _navRefresh();
}
function _biteStatus(S) {
    const next = Math.min(TRAIN_BITE, S.items.length - S.i);
    const m = Math.max(1, Math.round(next * (typeof TRAIN_SECONDS_PER_POSITION !== 'undefined' ? TRAIN_SECONDS_PER_POSITION : 30) / 60));
    setStatus(`Bouchée ${S.i / TRAIN_BITE} faite · ${S.i} sur ${S.items.length}`, 'ok', `Encore ${next} ? Environ ${m} min. Quitter garde le bilan.`);
    setStatusAction({ action: `Encore ${next}`, icon: 'play', title: 'Continuer la séance (Entrée)', run: () => nextDrill() });
}

// Résultat du coup joué sur la position posée (première fois seulement : c'est elle que le bilan retient).
function _sessionRecord(key, ok) {
    const S = trainingState.session;
    if (!S) return;
    if (!S.results.has(key)) {
        const e = openingDB[key];
        S.results.set(key, { key, color: playerColor, ok, lvBefore: trainingState.keyLv || (e ? _level(e) : 'unsure') });
        trainingState.combo = ok ? trainingState.combo + 1 : 0;
        if (ok && _trScoreKind(S.kind)) S.score++;
    }
    const it = S.items[S.cur];
    if (it && it.key === key && !it.res) it.res = ok ? 'ok' : 'ko';
    if ((S.kind === 'line' || S.kind === 'club') && !S.items.some(x => x.key === key)) S.items.push({ color: playerColor, key, res: ok ? 'ok' : 'ko', tries: [], help: 0 });
    _saveSession();
}

// Première erreur sur une position de la liste : elle revient une fois en fin de séance.
function _sessionMistake(key) {
    const S = trainingState.session;
    if (!S) return;
    if (S.kind === 'timed') { S.end -= TRAIN_TIMED_PENALTY_MS; _renderSessionBar(); return; }
    if (S.kind === 'survival') { S.lives = Math.max(0, S.lives - 1); _renderSessionBar(); return; }   // pas de second passage
    if (S.kind === 'line' || S.kind === 'club') return;
    const it = S.items[S.cur];
    if (it && it.key === key && !it.second && !S.items.some(x => x.second && x.key === key)) {
        S.items.push({ color: it.color, key, res: null, second: true, tries: [], help: 0 });
        _renderSessionBar();
        return true;                                  // la barre grandit d'une case : le message le dit (B7)
    }
    return false;
}

function _timedTick() {
    const S = trainingState.session;
    if (!S || S.kind !== 'timed' || gameMode !== 'training') { _clearSession(); return; }
    if (Date.now() >= S.end) { stopTraining(); _endSession(); return; }
    _renderSessionBar();
}

// Fin de séance (ou « Quitter » en cours de séance) : bilan, puis retour à l'onglet d'origine.
// stay : l'écran de jeu est quitté par ailleurs (logo, barre du haut) : bilan gardé, aucune navigation.
function _endSession(early, stay) {
    const S = trainingState.session;
    if (!S) return;
    if (typeof MasteryLog !== 'undefined') MasteryLog.record(currentRepertoire);   // historique de maîtrise : l'état après la séance (script chargé seul dans les tests)
    const first = [...S.results.values()];
    const dbs = { w: readDBFor(currentRepertoire, 'w'), b: readDBFor(currentRepertoire, 'b') };
    const rows = first.map(r => {
        const e = dbs[r.color][r.key];
        return { ...r, e, lvAfter: e ? _level(e) : r.lvBefore };
    }).filter(r => r.e);
    let record = 0, newRecord = false;
    if (_trScoreKind(S.kind)) {
        const rk = S.kind === 'survival' ? TRAIN_SURVIVAL_KEY : TRAIN_RECORD_KEY;
        record = Number(dataStore.getJSON(rk, 0)) || 0;
        if (S.score > record) { newRecord = record > 0 || S.score > 0; record = S.score; dataStore.setJSON(rk, record); }
    }
    // Défi du jour : seul le premier essai du jour est gardé (Daily.save).
    let daily = null;
    if (S.kind === 'daily' && rows.length && typeof Daily !== 'undefined') {
        Daily.save({ ok: rows[0].ok, key: rows[0].key, color: rows[0].color, rep: currentRepertoire });
        daily = { ok: Daily.today().r === 1, streak: Daily.streak() };
    }
    const counted = rows.filter(r => !r.replaced);        // une réponse remplacée en cours de séance ne compte plus (Q1)
    const summary = {
        kind: S.kind, label: S.label, line: S.line, early: !!early, minutes: Math.max(1, Math.round((Date.now() - S.started) / 60000)),
        total: counted.length, ok: counted.filter(r => r.ok).length, rows, score: S.score, record, newRecord,
        colors: S.colors, returnTab: S.returnTab, lives: S.lives, promos: _rankPromos(), club: S.club || null
    };
    // Médailles (atelier « L'envie de revenir », lot 5) : après les rangs, pour que « Compagnon » ou « Maître » comptent déjà.
    summary.medals = typeof Medals !== 'undefined' ? Medals.check({ summary }) : [];
    const keep = S.keep, resumable = stay && _TR_RESUMABLE.has(S.kind) && S.items.some(x => !x.res && !x.dropped);
    if (resumable) _saveSession();                     // arrêt par le logo : la séance pourra reprendre (Q3)
    // Le cadre rejoué garde sa trace dans la pellicule : réussi ou non, et son niveau d'après.
    if (keep && summary.promos.length) keep.promos = (keep.promos || []).concat(summary.promos);
    if (keep && summary.medals.length) keep.medals = (keep.medals || []).concat(summary.medals);
    if (keep) rows.forEach(r => { const f = keep.rows.find(x => x.key === r.key && x.color === r.color); if (f) Object.assign(f, { replay: r.ok, lvAfter: r.lvAfter, e: r.e }); });
    _clearSession();
    stopTraining();
    _renderSessionBar();
    const back = summary.returnTab;
    if (back === 'training' && (rows.length || !stay)) trainingState.lastSummary = keep || summary;
    if (!resumable) _forgetLiveSession();
    if (trainingState.lastSummary && !keep) _storeSummary(trainingState.lastSummary);
    if (typeof Suite !== 'undefined') Suite.refresh();
    if (stay) return;
    if (early || !rows.length) { goHome(back); return; }
    playSound('end');
    const promo = summary.promos[0];
    const msg = promo ? `Promotion · ${OpeningMarks.RANKS[promo.to]} · ${promo.name}` : daily ? (daily.ok ? (daily.streak > 1 ? `Défi du jour réussi · ${daily.streak} jours d’affilée` : 'Défi du jour réussi') : 'Défi du jour manqué · un nouveau demain')
        : summary.kind === 'survival' ? (summary.newRecord ? `Nouveau record de survie · ${summary.score}` : `Survie · ${summary.score} bon${summary.score > 1 ? 's' : ''} coup${summary.score > 1 ? 's' : ''}`)
        : summary.kind === 'frame' ? (summary.ok ? 'Position retrouvée' : 'Pas encore : elle revient bientôt')
        : summary.kind === 'club' ? `Adversaire du club · ${summary.ok} coup${summary.ok > 1 ? 's' : ''} trouvé${summary.ok > 1 ? 's' : ''}`
        : summary.kind === 'timed' ? `Temps écoulé · ${summary.score} bon${summary.score > 1 ? 's' : ''} coup${summary.score > 1 ? 's' : ''}`
        : `Séance terminée · ${summary.ok}/${summary.total} du premier coup`;
    setStatus(msg, 'ok', back === 'stats' ? 'Retour aux statistiques…' : 'Bilan de la séance…');
    _later(() => goHome(back), 1600);
}

// Bouton « Quitter » : bilan de ce qui a été joué (séance guidée), puis retour à l'onglet d'origine.
// Écran de jeu quitté sans « Quitter » (logo, pilule du répertoire, Données…) : la séance en cours
// est close, son bilan gardé, pour que le mode libre et le badge de couleur ne la voient plus.
// Le logo reste actif en séance (chantier « Échiquier et séance ») : un court message dit que rien n'est perdu.
function abandonSession() {
    const S = trainingState.session;
    if (!S) return;
    const kept = !!S.results.size;
    if (kept) _endSession(true, true);
    else _clearSession();
    _trToast(kept ? 'Séance arrêtée, bilan gardé' : 'Séance arrêtée');
}

// Message bref en bas de l'écran (classe .toast commune), retiré après 2,6 s.
function _trToast(msg) {
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    let el = document.getElementById('tr-toast');
    if (!el) {
        el = Object.assign(document.createElement('div'), { id: 'tr-toast', className: 'toast tr-toast' });
        el.setAttribute('role', 'status');
    }
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(_trToast.timer);
    _trToast.timer = setTimeout(() => el.remove(), 2600);
}

function quitTraining() {
    const S = trainingState.session;
    if (S && S.results.size) { _endSession(true); return; }
    const back = S ? S.returnTab : 'training';
    _clearSession();
    goHome(back);
}

// Barre au-dessus de l'échiquier : progression de la séance, ou chrono. Barre fine, compteur « 7 / 18 »
// en Plex Mono ; sur ordinateur, elle tient dans la marge du haut (aucune hauteur ajoutée à l'échiquier).
function _renderSessionBar() {
    if (typeof Suite !== 'undefined') Suite.refresh();
    const el = document.getElementById('tr-progress');
    if (!el) return;
    const S = trainingState.session;
    el.hidden = !(S && gameMode === 'training');
    if (el.hidden) { el.innerHTML = ''; return; }
    const okFirst = [...S.results.values()].filter(r => r.ok).length;
    if (S.kind === 'timed') {
        const left = Math.max(0, S.end - Date.now()), s = Math.ceil(left / 1000);
        el.innerHTML = `<div class="tr-prog-bar tr-prog-time" role="img" aria-label="Temps restant"><i style="width:${(100 * left / TRAIN_TIMED_MS).toFixed(1)}%"></i></div>
            <div class="tr-prog-l"><span><b class="tr-prog-n">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b> restantes</span><span><b class="tr-prog-n">${S.score}</b> bon${S.score > 1 ? 's' : ''} coup${S.score > 1 ? 's' : ''}</span></div>`;
        return;
    }
    if (S.kind === 'survival') {
        const hearts = Array.from({ length: TRAIN_SURVIVAL_LIVES }, (_, i) => `<i class="tr-life${i < S.lives ? ' on' : ''}" aria-hidden="true"></i>`).join('');
        const rec = Number(dataStore.getJSON(TRAIN_SURVIVAL_KEY, 0)) || 0;
        el.innerHTML = `<div class="tr-prog-l"><span class="tr-lives" role="img" aria-label="${S.lives} vie${S.lives > 1 ? 's' : ''} sur ${TRAIN_SURVIVAL_LIVES}">${hearts}</span>`
            + `<span><b class="tr-prog-n">${S.score}</b> bon${S.score > 1 ? 's' : ''} coup${S.score > 1 ? 's' : ''}${rec ? ` · record ${rec}` : ''}</span></div>`;
        return;
    }
    if (S.kind === 'club') {
        const elo = S.club && S.club.elo;
        el.innerHTML = `<div class="tr-prog-l"><span>Adversaire du club${elo ? ` · ~${elo} Elo` : ''}</span><span><b class="tr-prog-n">${okFirst}</b> ${okFirst > 1 ? 'coups trouvés' : 'coup trouvé'}</span></div>`;
        return;
    }
    if (S.kind === 'line') {
        el.innerHTML = `<div class="tr-prog-l"><span>Ligne complète · <b>${escapeHtml(S.line.name)}</b></span><span><b class="tr-prog-n">${S.results.size}</b> ${S.results.size > 1 ? 'coups' : 'coup'} · ${okFirst} du premier coup</span></div>`;
        return;
    }
    const n = S.items.length, pos = Math.min(n, S.cur >= 0 ? S.cur + 1 : trainingState.bite ? S.i : S.i + 1);   // pause de bouchée : positions faites
    const again = S.items.filter(x => x.second && !x.res).length, combo = trainingState.combo, bites = !!appSettings.trainBites && n > TRAIN_BITE;
    // Pellicule (R7) : une case par position ; une case close s'ouvre en revue (trainingReview). Ratée en vermillon,
    // avec aide en laiton, remplacée en pointillé, 2ᵉ passage hachuré ; la case revue est soulignée.
    const R = trainingState.review;
    const cellCls = (x, i) => [i === S.cur && !R ? 'cur' : '', x.edited ? 'edit' : x.res === 'ok' ? (x.help ? 'help' : 'ok') : x.res === 'ko' ? 'ko' : x.res === 'skip' ? 'skip' : x.second || x.again ? 'again' : '',
        R && R.i === i ? 'seen' : '', bites && (i + 1) % TRAIN_BITE === 0 && i < n - 1 ? 'bite-end' : ''].filter(Boolean).join(' ');
    const cellName = (x, i) => `Position ${i + 1}${x.second ? ', deuxième passage' : ''} : ${x.edited ? 'réponse remplacée' : x.res === 'ok' ? (x.help ? 'trouvée avec aide' : 'juste') : x.res === 'ko' ? 'ratée' : 'à venir'}`;
    el.innerHTML = `<div class="tr-prog-bar tr-tape${n > 40 ? ' dense' : ''}" role="group" aria-label="${escapeHtml(S.label)} · position ${pos} sur ${n}">${S.items.map((x, i) =>
        _reviewable(S, i) ? `<button type="button" class="${cellCls(x, i)}" data-action="trainingReview" data-arg="${i}" title="${escapeHtml(cellName(x, i))} · revoir" aria-label="${escapeHtml(cellName(x, i))}, revoir"></button>`
        : `<i class="${cellCls(x, i)}" title="${escapeHtml(cellName(x, i))}"></i>`).join('')}</div>
        <div class="tr-prog-l"><span><b class="tr-prog-n">${pos} / ${n}</b> ${escapeHtml(S.label.toLowerCase())}</span><span>${combo >= 3 ? `<b class="tr-combo">×${combo} sans faute</b> · ` : ''}${okFirst} du premier coup${again ? ` · ${again} à revoir à la fin` : ''}</span></div>`;
}

// ─── POIDS DE TIRAGE (répétition espacée, sélection probabiliste continue) ──
//   poids = ( facteur d'échec × facteur d'oubli ) ^ TRAIN_SHARPNESS
//
//   facteur d'échec = PLANCHER_ÉCHEC + erreur relative × volume
//     erreur relative = (échecs + 0,6) / (essais + 2)  → lissée : 3/3 pèse plus que 1/1,
//                                                         100 % de réussite sur beaucoup d'essais → proche de 0
//     volume          = 1 + 0,25 × ln(1 + échecs)        → davantage d'échecs = davantage de poids
//   facteur d'oubli = PLANCHER_ÂGE + (1 − e^(−jours / 3))
//     ≈ 0 juste après un passage, ≈ 0,63 à 3 jours, ≈ 0,9 à 7 jours ; sans lastReviewed : 30 jours.
//   Les deux planchers garantissent un poids toujours strictement positif.

const TRAIN_FAIL_FLOOR  = 0.04;
const TRAIN_AGE_FLOOR   = 0.03;
const TRAIN_TAU_DAYS    = 3;
const TRAIN_UNSEEN_DAYS = 30;
const TRAIN_SHARPNESS   = 1.5;      // > 1 : accentue l'écart entre positions prioritaires et acquises
const TRAIN_NOT_DUE     = 0.25;     // facteur appliqué aux positions dont la révision n'est pas encore due

function _ageDays(e, now) {
    return e.lastReviewed ? Math.max(0, (now - e.lastReviewed) / DAY_MS) : TRAIN_UNSEEN_DAYS;
}

function _failureFactor(e) {
    const err    = 1 - masteryOf(e) / 100;
    const volume = 1 + 0.25 * Math.log(1 + e.failures);
    return TRAIN_FAIL_FLOOR + err * volume;
}

function _forgetFactor(e, now) {
    return TRAIN_AGE_FLOOR + (1 - Math.exp(-_ageDays(e, now) / TRAIN_TAU_DAYS));
}

// freqFactor (moveStats.js) : une position où l'adversaire arrive souvent sort plus souvent (option Paramètres).
function _trainingWeight(e, now) {
    const freq = typeof freqFactor === 'function' ? freqFactor(e, playerColor) : 1;
    return Math.pow(_failureFactor(e) * _forgetFactor(e, now), TRAIN_SHARPNESS) * (isDue(e, now) ? 1 : TRAIN_NOT_DUE) * freq;
}

// Probabilités de sortie : poids normalisés sur l'univers. Si le répertoire compte plusieurs
// positions, celle qui vient de sortir est exclue AVANT normalisation (jamais deux fois de suite).
function _trainingDistribution(excludeKey) {
    const now   = Date.now();
    let items   = _trainingPool().map(k => ({ key: k, w: _trainingWeight(openingDB[k], now) }));
    if (items.length > 1) items = items.filter(x => x.key !== excludeKey);
    const total = items.reduce((sum, x) => sum + x.w, 0);
    items.forEach(x => { x.p = x.w / total; });
    return items;
}

function _pickDrill() {
    const dist = _trainingDistribution(trainingState.lastKey);
    let r = Math.random();
    for (const x of dist) { r -= x.p; if (r <= 0) return x.key; }
    return dist[dist.length - 1].key;
}

// Raison affichée au début de l'exercice.
function _ageLabel(e, now) {
    if (!e.lastReviewed) return 'non revu depuis longtemps';
    const min = (now - e.lastReviewed) / 60000;
    if (min < 60)   return `revu il y a ${Math.max(1, Math.round(min))} min`;
    if (min < 1440) return `revu il y a ${Math.round(min / 60)} h`;
    const d = Math.floor(min / 1440);
    if (d < 14)     return `non revu depuis ${d} jour${d > 1 ? 's' : ''}`;
    const w = Math.floor(d / 7);
    return `non revu depuis ${w} semaine${w > 1 ? 's' : ''}`;
}

// Nom de l'ouverture d'une entrée, dit pendant la mise en situation et sous « À vous de jouer » (lot 4).
function _drillOpening(e) {
    const op = e && e.path && e.path.length && typeof openingNameOf === 'function' ? openingNameOf(e.path) : null;
    return op ? op.name : '';
}

// L'idée de la ligne (atelier « L'envie de revenir », lot 4) : rappelée pendant la mise en situation, après le nom.
function _drillOpeningIdea(e) {
    const name = _drillOpening(e);
    if (!name || typeof OpeningMarks === 'undefined') return name;
    const v = OpeningMarks.idea(currentRepertoire, playerColor, name);
    return v ? `${name} · ${v.text}` : name;
}

// Rangs des ouvertures après une séance (lot 4) : les promotions, à fêter dans le bilan.
function _rankPromos() {
    if (typeof OpeningMarks === 'undefined' || typeof _assignOpenings !== 'function') return [];
    const rows = [];
    ['w', 'b'].forEach(side => {
        const db = readDBFor(currentRepertoire, side);
        Object.keys(db).forEach(k => { const e = db[k]; if (e.attempts > 0) rows.push({ k, e, side, lv: _level(e), path: e.path && e.path.length ? e.path : null }); });
    });
    _assignOpenings(rows);
    return OpeningMarks.update(currentRepertoire, rows);
}

function _drillReason(e) {
    const now = Date.now();
    if (trainingState.session && trainingState.session.items[trainingState.session.cur] && trainingState.session.items[trainingState.session.cur].second)
        return 'Deuxième passage : erreur plus tôt dans la séance';
    if (Number.isInteger(e.relearn)) return isDiscovering(e) ? 'À réapprendre' : 'Rattrapage après une erreur';
    if (e.failures === 0 || !e.attempts) return `Entretien · 100% de réussite · ${_ageLabel(e, now)}`;
    const m = Math.round(masteryOf(e));
    if (m <= 50)                  return `Position critique · maîtrise ${m} / 100`;
    if (_ageDays(e, now) >= 2)    return `À réviser · ${_ageLabel(e, now)}`;
    return `À consolider · maîtrise ${m} / 100 · ${_ageLabel(e, now)}`;
}

// Retrouve la ligne menant à une clé de position en rejouant les chemins des autres entrées
// (la position d'une entrée sans `path` est un ancêtre des entrées plus profondes).
// Renvoie un tableau UCI (peut être vide = position initiale) ou null si introuvable.
function _findPathToKey(key) {
    return _withEngineSnapshot(() => {
        parseFEN(INIT_FEN);
        if (positionKey() === key) return [];
        for (const k of Object.keys(openingDB)) {
            const p = openingDB[k].path;
            if (!p || !p.length) continue;
            parseFEN(INIT_FEN);
            try {
                for (let i = 0; i < p.length; i++) {
                    _applyUciRaw(p[i]);
                    if (positionKey() === key) return p.slice(0, i + 1);
                }
            } catch (_) { /* chemin corrompu : on passe au suivant */ }
        }
        return null;
    });
}

// ─── BOUCLE D'ENTRAÎNEMENT ────────────────────────────────────────────────────

function nextDrill() {
    if (trainingState.review) { trainingCloseReview(); return; }       // en revue, « suivant » ramène d'abord à la séance
    stopTraining();
    if (trainingState.session) { _nextSessionDrill(); return; }
    if (trainingState.mixed) {
        const c = _pickTrainingColor();
        if (c && c !== playerColor) { playerColor = c; loadDB(); showGameScreen(c); }
    }
    if (!_trainingPool().length) { setStatus('Aucune position dans ce répertoire.', 'info'); return; }
    if (trainingSettings.fromStart === 1 && _startFullLine()) return;     // sinon : repli sur une position ciblée

    _startDrill(_pickDrill(), trainingSettings.seqLen);
}

// Pose la position `key` (mise en situation puis main rendue) ; seqLen = coups à enchaîner ;
// opts.noContext : position posée directement (contre-la-montre).
function _startDrill(key, seqLen, opts) {
    const entry = openingDB[key];
    resetNavCursor();                                   // une navigation dans la position précédente ne déborde pas
    trainingState.current     = key;
    trainingState.reason      = _drillReason(entry);
    trainingState.lastKey     = key;
    trainingState.busy        = true;
    trainingState.solutionFor = null;
    trainingState.seq         = { len: seqLen, done: 0, assisted: false };
    trainingState.drill       = { erred: false, keys: [], answered: null };
    trainingState.missUndo    = null;
    _renderSessionBar();

    // Chemin absent ou vide : reconstitution via les autres entrées, puis auto-réparation de l'entrée.
    let fullPath = (entry.path && entry.path.length) ? entry.path : null;
    if (!fullPath) {
        const pre = _findPathToKey(key);
        if (pre) {
            fullPath = pre.concat(entry.move);
            entry.path = fullPath;
            entry.ply  = fullPath.length;
            saveDB();
        }
    }

    if (fullPath && opts && opts.noContext) {
        loadPositionFromPath(fullPath.slice(0, -1), { animateLast: true });   // contre-la-montre : le coup adverse est animé
        _drillReady();
    } else if (fullPath) {
        const n     = fullPath.length - 1;               // coups avant ma réponse
        const start = Math.max(0, n - TRAIN_CONTEXT_PLIES);
        const ctx   = fullPath.slice(start, n);
        loadPositionFromPath(fullPath.slice(0, start));
        setStatus('Mise en situation…', 'info', ctx.length ? _drillOpeningIdea(entry) : trainingState.reason, ctx.length ? {
            action: 'Sauter', title: 'Passer la mise en situation', run: () => { if (trainingState.ctxSkip) trainingState.ctxSkip(); }
        } : null);
        ctx.forEach((u, i) => _later(() => {
            const m = _parseUci(u);
            playBoardMoveSound(m.from, m.to, m.promo);
            animateNextMove(m.from, m.to);
            applyMove(m.from, m.to, m.promo);            // applyMove appelle renderMoves()
            renderBoard();
        }, TRAIN_STEP_MS * (i + 1)));
        _later(_drillReady, TRAIN_STEP_MS * ctx.length + 300);
        trainingState.ctxSkip = () => {                  // touche sur l'échiquier : position posée tout de suite
            stopTraining();
            trainingState.busy = true;
            loadPositionFromPath(fullPath.slice(0, -1));
            _drillReady();
        };
    } else {
        // Dernier recours : aucune ligne connue → position posée directement (historique vide inévitable).
        loadPositionFromPath([]);
        parseFEN(key);
        renderMoves();
        renderBoard();
        _drillReady();
    }
}

// Passer la mise en situation : un appui sur l'échiquier pendant qu'elle se joue.
(function initContextSkip() {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
    boardEl.addEventListener('pointerdown', e => {
        if (gameMode !== 'training' || !trainingState.ctxSkip) return;
        e.stopPropagation();
        e.preventDefault();
        trainingState.ctxSkip();
    }, true);
})();

function _seqLabel() {
    const s = trainingState.seq;
    if (s.len <= 1) return '';
    return ` · coup ${s.done + 1}${s.len < TRAIN_SEQ_END ? '/' + s.len : ''}`;
}

// La main est rendue au joueur sur une nouvelle position.
function _positionPosed() {
    const e = openingDB[positionKey()];
    trainingState.drill.keys.push(positionKey());
    trainingState.keyErred = false;
    trainingState.keyLv = e ? _level(e) : null;
    trainingState.presenting = null;
}

// Découverte (chantier « Erreurs et niveaux ») : en révision, une position jamais présentée montre d'abord son coup,
// à jouer tel quel ; rien n'est compté, elle revient demain, de mémoire (presentEntry, review.js).
function _presentIfNew() {
    const key = positionKey(), e = openingDB[key];
    if (!e || !_scores() || !needsShowing(e)) return false;
    trainingState.presenting = key;
    revealSolution(e);
    setStatus(`Nouveau coup : ${formatSanText(e.san, turn)}`, 'hint', 'Découverte : jouez-le. Rien n’est compté, il reviendra demain, de mémoire.');
    return true;
}

function _drillReady() {
    trainingState.ctxSkip = null;
    const key = trainingState.current;
    if (positionKey() !== key) {
        const entry = openingDB[key];
        if (entry && entry.path && entry.path.length) {
            // Resynchronisation complète ET historique reconstruit (jamais vidé).
            loadPositionFromPath(entry.path.slice(0, -1));
        }
        if (positionKey() !== key) {
            // Sans toucher à moveHistory : on ne force que l'état du moteur.
            const prevHistory = moveHistory;
            parseFEN(key);
            moveHistory = prevHistory;
            selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
        }
        renderMoves();
        renderBoard();
    }
    trainingState.busy = false;
    _positionPosed();
    _renderSessionBar();
    if (!_presentIfNew()) setStatus(`À vous de jouer${_seqLabel()}`, 'info', _readyDetail());
}

// ─── NAVIGATION EN SÉANCE ─────────────────────────────────────────────────────
// ◀ ▶ et les flèches revoient les coups déjà joués (jamais pendant la mise en situation ni un coup adverse :
// trainingState.busy). Toucher l'échiquier, l'Indice ou la Solution ramène d'abord à la position en cours :
// on ne rejoue jamais depuis le passé (en Jouer, cela ouvrirait une nouvelle variante), la séance reste intacte.
// La position cherchée n'est jamais dans l'historique : naviguer ne dévoile pas la réponse.
function trainingBackToLive() {
    if (gameMode !== 'training' || navCursor === -1) return false;
    navGo(moveHistory.length - 1);
    return true;
}
// Retour à la position en cours : la consigne de la séance revient (navGo) ; en pause, le message de fin d'exercice
// et « Suivant » ; en bouchée, « Encore N » ; en revue, la revue ; pendant « Corriger », sa consigne.
function trainingLiveStatus() {
    if (gameMode !== 'training') return false;
    const R = trainingState.review;
    if (R) { _reviewStatus(); return true; }
    if (trainingState.editing) { _editStatus(); return true; }
    if (trainingState.bite && trainingState.session) { _biteStatus(trainingState.session); return true; }
    if (trainingState.pause) {
        const st = trainingState.pause.status;
        if (st) setStatus(st.title, st.type, st.detail);
        _offerNext();
        return true;
    }
    if (trainingState.busy || turn !== playerColor) return false;
    if (trainingState.presenting === positionKey() && _presentIfNew()) return true;
    setStatus(`À vous de jouer${_seqLabel()}`, 'info', _readyDetail());
    return true;
}

// Sous-texte de « À vous de jouer ». En séance, la barre de progression dit déjà où l'on en est :
// seulement l'ouverture (ou le deuxième passage). En mode libre : la raison du tirage et les réussites.
function _readyDetail() {
    const S = trainingState.session;
    if (!S) return [_drillOpening(openingDB[trainingState.current]), trainingState.reason].filter(Boolean).join(' · ')
        + (trainingState.ok ? ` · ${trainingState.ok} réussi${trainingState.ok > 1 ? 's' : ''}` : '');
    const it = S.items[S.cur];
    if (it && it.second) return 'Deuxième passage';
    if (S.kind === 'line') return '';
    return _drillOpening(openingDB[trainingState.current]);
}


// ─── PELLICULE, REVUE, REJOUER (chantier « L'échiquier de Chays », R7 à R10) ──
// Chaque case de la pellicule (#tr-progress) est une position de la séance. Une case close (réussie, ratée, avec aide)
// s'ouvre en revue : la position avant ma réponse, mes coups faux en vermillon, la réponse en laiton, ◀ ▶ libres.
// Rien n'y compte : Rejouer refait la position sans note, Corriger remplace la réponse (Q1, _afterReplace).
// La revue ne montre que des positions closes : jamais une réponse avant d'y avoir répondu.

function _curItem() {
    const S = trainingState.session;
    return S && S.cur >= 0 ? S.items[S.cur] || null : null;
}

function _reviewable(S, i) {
    const it = S && S.items[i];
    if (!it || !it.res || it.res === 'skip' || it.dropped || S.kind === 'timed' && S.end > Date.now()) return false;
    return i !== S.cur || !!trainingState.pause;
}

function _liveSnapshot() {
    return { history: moveHistory.slice(), board: board.slice(), turn, castling: { ...castlingRights }, ep: enPassant, lastFrom, lastTo,
             color: playerColor, busy: trainingState.busy, status: _statusNow(),
             hint: { key: _hintKey, step: _hintStep, sol: _solutionMove, solKey: _solutionKey } };
}

// Ouvre la revue de la case i (pellicule, carnet du bilan). Renvoie true si elle s'ouvre.
function trainingReview(i) {
    const S = trainingState.session;
    i = Number(i);
    if (!S || gameMode !== 'training' || !_reviewable(S, i)) return false;
    if (trainingState.editing && !trainingState.review) return false;                  // « Corriger » en cours : le finir d'abord
    if (trainingState.busy && !trainingState.pause && !trainingState.bite && !trainingState.review) return false;   // animation
    const it = S.items[i];
    _holdChain();
    if (!trainingState.review) trainingState.reviewLive = _liveSnapshot();
    trainingState.editing = null;
    if (it.color !== playerColor) { playerColor = it.color; loadDB(); showGameScreen(it.color); }
    const entry = openingDB[it.key];
    if (!entry || !entry.path || !entry.path.length) {
        _restoreLive();
        setStatus('Position introuvable', 'info', 'Elle n’est plus dans le répertoire.');
        return false;
    }
    trainingState.review = { i, key: it.key, color: it.color, pre: entry.path.slice(0, -1), replay: false };
    resetNavCursor();
    loadPositionFromPath(trainingState.review.pre);
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    _syncAfterTools();
    _navRefresh();
    _renderSessionBar();
    _reviewStatus();
    return true;
}

// Retour à la séance : la position vivante, son état et sa consigne reviennent tels quels.
function _restoreLive() {
    const L = trainingState.reviewLive;
    trainingState.review = null;
    trainingState.reviewLive = null;
    trainingState.editing = null;
    if (!L) return;
    if (L.color !== playerColor) { playerColor = L.color; loadDB(); showGameScreen(L.color); }
    moveHistory = L.history; board = L.board; turn = L.turn; castlingRights = L.castling; enPassant = L.ep; lastFrom = L.lastFrom; lastTo = L.lastTo;
    _hintKey = L.hint.key; _hintStep = L.hint.step; _solutionMove = L.hint.sol; _solutionKey = L.hint.solKey;
    selected = null; legalMoves = []; hintPiece = null;
    if (_solutionMove && _solutionMove.key === positionKey()) { selected = _solutionMove.from; legalMoves = [_solutionMove.to]; }
    navCursor = -1;
    trainingState.busy = L.busy;
    renderMoves();
    renderBoard();
    _navRefresh();
    _syncAfterTools();
    _renderSessionBar();
    if (!trainingLiveStatus() && L.status) setStatus(L.status.title, L.status.type, L.status.detail);
}

function trainingCloseReview() {
    if (trainingState.review) _restoreLive();
}
if (typeof registerActions === 'function') registerActions({ trainingReview: i => trainingReview(i) });

function _reviewStatus(note) {
    const R = trainingState.review;
    if (!R) return;
    if (R.replay) {
        setStatus('Rejouer', 'info', 'Trouvez votre coup. Rien n’est compté.', { action: 'Revue', icon: 'chevron-left', title: 'Revenir à la revue de cette position', run: _backToReview });
        return;
    }
    const S = trainingState.session, it = S && S.items[R.i], e = openingDB[R.key];
    let pos = null;
    try { pos = Chess.replay(R.pre); } catch (er) { /* chemin illisible : sans notation */ }
    const side = R.pre.length % 2 ? 'b' : 'w';
    const sanOf = u => { try { return formatSanText(Chess.san(pos, u), side); } catch (er) { return u; } };
    const tries = it && it.tries && it.tries.length ? `Vous avez joué ${[...new Set(it.tries)].map(sanOf).join(', ')} (vermillon). ` : '';
    const help = !it ? '' : it.help >= 3 ? 'Solution montrée. ' : it.help ? 'Trouvé avec l’indice. ' : !(it.tries && it.tries.length) ? 'Trouvé du premier coup. ' : '';
    const ans = e ? `Réponse : ${formatSanText(e.san, side)} (laiton). ` : '';
    const name = (e && _drillOpening(e)) || `Position ${R.i + 1}`;
    setStatus(`Revue · ${name}`, 'info', note || `${tries}${help}${ans}Rien ne compte ici.`,
        { action: 'Rejouer', icon: 'rotate-ccw', title: 'Rejouer cette position sans rien compter', run: trainingReplay });
}

function _backToReview() {
    const R = trainingState.review;
    if (!R) return;
    R.replay = false;
    trainingState.editing = null;
    resetNavCursor();
    loadPositionFromPath(R.pre);
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    _syncAfterTools();
    _reviewStatus();
}

// Rejouer (R10) : la position se refait, rien n'est compté.
function trainingReplay() {
    const R = trainingState.review;
    if (!R) return;
    R.replay = true;
    trainingState.editing = null;
    resetNavCursor();
    loadPositionFromPath(R.pre);
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    _syncAfterTools();
    _reviewStatus();
}

function _replayPlayed(from, to, promo) {
    const R = trainingState.review, e = R && openingDB[R.key];
    if (!R || !e) return;
    if (moveToStr(from, to, promo) === e.move) {
        R.replay = false;
        _commitMove(from, to, promo, null, 'Retrouvée', 'ok', 'Rien n’est compté.');
        _syncAfterTools();
        setStatusAction({ action: 'Revue', icon: 'chevron-left', title: 'Revoir cette position', run: _backToReview });
        return;
    }
    _rejectMove(to, 'Pas encore', 'Rien n’est compté. Réessayez, ou revenez à la séance.', from);
}

// Flèches de la revue : mes coups faux en vermillon, la réponse en laiton, sur la position avant ma réponse.
function _reviewArrows() {
    const R = trainingState.review;
    if (!R || R.replay || trainingState.editing || navCursor !== -1 || positionKey() !== R.key) return [];
    const S = trainingState.session, it = S && S.items[R.i], e = openingDB[R.key], out = [];
    const arrow = (u, color) => ({ from: squareToIdx(u.slice(0, 2)), to: squareToIdx(u.slice(2, 4)), color });
    if (it) [...new Set(it.tries || [])].forEach(u => out.push(arrow(u, 'red')));
    if (e) out.push(arrow(e.move, 'gold'));
    return out;
}

// Action du milieu de la barre unique (R3) : Indice pendant mon tour (null), sinon ce qui fait avancer.
function _trCenter() {
    if (gameMode !== 'training') return null;
    if (trainingState.review) return { icon: 'corner-up-left', label: 'Séance', title: 'Revenir à la séance (Espace)', run: trainingCloseReview };
    if (trainingState.editing) return { icon: 'x', label: 'Garder', soft: true, title: 'Garder la réponse actuelle', run: trainingEditCancel };
    if (trainingState.bite) return { icon: 'play', label: 'Continuer', title: 'Continuer la séance (Entrée)', run: () => nextDrill() };
    if (trainingState.pause) return { icon: 'skip-forward', label: 'Suivant', title: 'Exercice suivant (Entrée)', run: () => nextDrill() };
    return null;
}

// ─── MAUVAIS CLIC (R14) ───────────────────────────────────────────────────────
// Trois secondes après une première erreur, « Mauvais clic » la retire : l'entrée revient à son état d'avant,
// la position est renvoyée en fin de séance, où elle sera notée sur le premier coup. Une fois par séance (Q2).
const TRAIN_MISCLICK_MS = 3000;

function _offerMisclick() {
    const u = trainingState.missUndo;
    if (!u) return;
    setStatusAction({ action: 'Mauvais clic', icon: 'rotate-ccw', ring: TRAIN_MISCLICK_MS, title: 'Ce n’était pas mon coup : retirer l’erreur (une fois par séance)', run: trainingMisclick });
    _later(() => {
        if (trainingState.missUndo !== u) return;
        trainingState.missUndo = null;
        const b = document.querySelector && document.querySelector('#status-bar .status-act');
        if (b && b.dataset.act === 'Mauvais clic') setStatusAction(null);
    }, TRAIN_MISCLICK_MS);
}

function trainingMisclick() {
    const u = trainingState.missUndo, S = trainingState.session;
    if (!u || !S || trainingState.misclickUsed || gameMode !== 'training') return;
    trainingState.missUndo = null;
    trainingState.misclickUsed = true;
    if (openingDB[u.key]) { openingDB[u.key] = u.entry; saveDB(); }
    if (S.kind === 'survival') S.lives = u.lives;
    trainingState.combo = u.combo;
    S.items.forEach(x => { if (x.key === u.key && x.second && !x.res) { x.dropped = true; x.res = 'skip'; } });
    S.results.delete(u.key);
    const it = _curItem();
    if (it) { it.res = 'skip'; it.misclick = true; }
    S.items.push({ color: it ? it.color : playerColor, key: u.key, res: null, second: false, again: true, tries: [], help: 0 });
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingState.keyErred = false;
    trainingState.drill.erred = false;
    trainingState.busy = true;
    setStatus('Erreur retirée', 'info', 'Cette position revient en fin de séance, où elle sera notée. « Mauvais clic » ne sert qu’une fois par séance.');
    trainingState.pause = { key: u.key, status: _statusNow() };
    _syncAfterTools();
    _navRefresh();
    _renderSessionBar();
    _offerNext();
    _saveSession();
}

// ─── SÉANCE GARDÉE AU RECHARGEMENT (R11, Q3) ──────────────────────────────────
// Clé locale chessTrainer_session (non synchronisée) : la séance en cours (12 h) et le dernier bilan, pour qu'un
// rechargement ou un onglet fermé ne perde rien. Contre-la-montre, ligne complète et Adversaire du club ne se reprennent pas.
const TRAIN_SESSION_KEY = 'chessTrainer_session';
const TRAIN_RESUME_MS = 12 * 3600e3;
const _TR_RESUMABLE = new Set(['due', 'review', 'relearn', 'weak', 'unsure', 'survival', 'daily', 'retry']);

function _saveSession() {
    try {
        const S = trainingState.session, keep = {};
        if (S && _TR_RESUMABLE.has(S.kind) && !S.keep) {
            keep.live = { kind: S.kind, label: S.label, returnTab: S.returnTab, colors: S.colors, rep: currentRepertoire, started: S.started,
                          i: S.i, cur: S.cur, lives: S.lives, score: S.score, biteAt: S.biteAt || 0, misclickUsed: trainingState.misclickUsed,
                          items: S.items.map(x => ({ color: x.color, key: x.key, res: x.res, second: x.second, again: !!x.again, dropped: !!x.dropped, edited: !!x.edited, tries: x.tries || [], help: x.help || 0 })),
                          results: [...S.results.values()], at: Date.now() };
        }
        const prev = dataStore.getJSON(TRAIN_SESSION_KEY, null) || {};
        if (prev.summary) keep.summary = prev.summary;
        if (!keep.live && !keep.summary) { dataStore.remove ? dataStore.remove(TRAIN_SESSION_KEY) : dataStore.setJSON(TRAIN_SESSION_KEY, {}); return; }
        dataStore.setJSON(TRAIN_SESSION_KEY, keep);
    } catch (e) { /* stockage plein ou indisponible : la séance continue sans reprise */ }
}

// Le bilan se garde sans les entrées (relues au chargement : niveaux d'après à jour).
function _summaryForStore(s) {
    return Object.assign({}, s, { rows: (s.rows || []).map(r => Object.assign({}, r, { e: undefined })), rep: s.rep || currentRepertoire, at: s.at || Date.now() });
}

// Séance à reprendre (moins de 12 h, même répertoire), ou null.
function savedSession() {
    const st = dataStore.getJSON(TRAIN_SESSION_KEY, null), L = st && st.live;
    if (!L || Date.now() - L.at > TRAIN_RESUME_MS || L.rep !== currentRepertoire) return null;
    const left = L.items.filter(x => !x.res && !x.dropped).length;
    return left ? Object.assign({ left }, L) : null;
}

function resumeSession() {
    const L = savedSession();
    if (!L) return false;
    const ok = startSession({ kind: L.kind, label: L.label, returnTab: L.returnTab, colors: L.colors, items: L.items, resume: L });
    if (ok) _trToast(`Séance reprise · ${L.items.length - L.left} sur ${L.items.length}`);
    return ok;
}

function _storeSummary(s) {
    try {
        const st = dataStore.getJSON(TRAIN_SESSION_KEY, null) || {};
        st.summary = _summaryForStore(s);
        dataStore.setJSON(TRAIN_SESSION_KEY, st);
    } catch (e) { /* bilan gardé en mémoire seulement */ }
}

function forgetSummary() {
    trainingState.lastSummary = null;
    try {
        const st = dataStore.getJSON(TRAIN_SESSION_KEY, null);
        if (st && st.summary) { delete st.summary; dataStore.setJSON(TRAIN_SESSION_KEY, st); }
    } catch (e) { /* rien à oublier */ }
}

function _forgetLiveSession() {
    try {
        const st = dataStore.getJSON(TRAIN_SESSION_KEY, null);
        if (st && st.live) { delete st.live; dataStore.setJSON(TRAIN_SESSION_KEY, st); }
    } catch (e) { /* rien à oublier */ }
}

// Dernier bilan relu au lancement (B8) : les entrées sont relues pour le niveau d'après.
let _summaryRestored = false;
function _restoreSummary() {
    if (_summaryRestored) return;                      // une fois par lancement
    _summaryRestored = true;
    if (trainingState.lastSummary) return;
    const st = dataStore.getJSON(TRAIN_SESSION_KEY, null), s = st && st.summary;
    if (!s || !Array.isArray(s.rows) || (s.rep && s.rep !== currentRepertoire)) return;
    const dbs = { w: readDBFor(currentRepertoire, 'w'), b: readDBFor(currentRepertoire, 'b') };
    s.rows = s.rows.map(r => Object.assign(r, { e: dbs[r.color] && dbs[r.color][r.key] })).filter(r => r.e);
    trainingState.lastSummary = s;
}

// ─── LIGNE COMPLÈTE (depuis la position initiale) ─────────────────────────────
// Blancs : la main est rendue tout de suite. Noirs : l'ordinateur joue d'abord un coup du répertoire.
// Puis la séquence continue jusqu'à la fin de la variante (cf. _continueSequence).
// Renvoie false si aucune ligne ne part de la position initiale (entrées sans chemin connu).
function _startFullLine() {
    const S = trainingState.session;
    trainingState.reason      = S && S.line ? S.line.name : 'Ligne complète';
    trainingState.seq         = { len: TRAIN_SEQ_END, done: 0, assisted: false };
    trainingState.solutionFor = null;
    trainingState.busy        = true;
    resetNavCursor();
    loadPositionFromPath([]);
    trainingState.current = trainingState.lastKey = positionKey();
    if (playerColor === 'w') {
        if (!openingDB[trainingState.current] || !_isEligible(openingDB[trainingState.current])) return false;
        _later(_drillReady, 300);
        return true;
    }
    const opp = _pickOppContinuation([]);
    if (!opp) return false;
    setStatus('Ligne complète · l\'adversaire commence…', 'info');
    _playOpponentReply(opp);
    return true;
}

// ─── SÉQUENCE : RÉPONSE ADVERSE ENREGISTRÉE ───────────────────────────────────

// Coups adverses UCI qui prolongent la ligne jouée et mènent à une position de mon répertoire
// (une entrée dont le `path` vaut ligne + coup adverse + mon coup). Tirage pondéré : chaque branche
// pèse autant que la position la plus prioritaire qu'elle contient (cf. _trainingWeight), pour
// guider vers ce qui est à réviser. Ligne complète d'une ouverture : seules les entrées qui suivent
// ses coups sont retenues. null = fin de la variante (ou limite de profondeur).
function _pickOppContinuation(line) {
    const n = line.length, valid = new Set(), weight = new Map(), now = Date.now();
    const S = trainingState.session, pre = S && S.kind === 'line' ? S.line.path : null;
    for (const k in openingDB) {
        const e = openingDB[k], p = e.path;
        if (!p || p.length < n + 2 || !_isEligible(e)) continue;
        let match = true;
        for (let i = 0; i < n; i++) if (p[i] !== line[i]) { match = false; break; }
        if (match && pre) for (let i = 0; i < pre.length && i < p.length; i++) if (p[i] !== pre[i]) { match = false; break; }
        if (!match) continue;
        if (p.length === n + 2) valid.add(p[n]);
        weight.set(p[n], Math.max(weight.get(p[n]) || 0, _trainingWeight(e, now)));
    }
    const arr = [...valid];
    if (!arr.length) return null;
    let r = Math.random() * arr.reduce((s, u) => s + weight.get(u), 0);
    for (const u of arr) { r -= weight.get(u); if (r <= 0) return u; }
    return arr[arr.length - 1];
}

// Joue le coup adverse puis rend la main, ou termine l'exercice si la position atteinte n'est pas
// au répertoire.
function _playOpponentReply(opp) {
    _later(() => {
        const m   = _parseUci(opp);
        const san = formatSanText(toAlgebraic(m.from, m.to, m.promo), turn);
        playBoardMoveSound(m.from, m.to, m.promo);
        animateNextMove(m.from, m.to);
        applyMove(m.from, m.to, m.promo);
        selected = null; legalMoves = []; hintPiece = null;
        renderBoard();
        if (openingDB[positionKey()]) {
            trainingState.solutionFor = null;
            trainingState.busy = false;
            _positionPosed();
            _renderSessionBar();
            if (!_presentIfNew()) setStatus(`Adversaire : ${san}`, 'info', `À vous de jouer${_seqLabel()}`);
        } else {
            setStatus('Fin de la variante.', 'ok');
            _finishDrill();
        }
    }, opponentDelay(TRAIN_STEP_MS));
}

// ─── FIN D'EXERCICE ───────────────────────────────────────────────────────────
// Préférence trainNext : 'error' (défaut) enchaîne seul après une réussite nette et s'arrête après une erreur,
// un indice ou la solution ; 'wait' s'arrête toujours ; 'auto' n'arrête jamais. Le contre-la-montre enchaîne toujours.
// À l'arrêt : « Suivant » (barre d'état, Entrée, P, centre du dock), Analyser et Modifier le coup (outils du mode).
const TRAIN_NEXT_MS = 1400;

function _drillSlipped() {
    const d = trainingState.drill;
    return d.erred || trainingState.seq.assisted || (typeof _hintKey !== 'undefined' && _hintKey !== null && d.keys.includes(_hintKey));
}

function _finishDrill() {
    if (!trainingState.seq.assisted) { trainingState.ok++; playSound('success'); }
    const S = trainingState.session;
    if (S && S.kind === 'timed') { _later(nextDrill, 500); return; }
    trainingState.pause = { key: trainingState.drill.answered || trainingState.current, status: _statusNow() };
    _syncAfterTools();
    _navRefresh();
    _afterDrill();
}

// Message affiché dans la barre d'état (titre, détail, type) : rendu au retour au présent (navigation, revue).
function _statusNow() {
    const bar = typeof document !== 'undefined' && document.getElementById ? document.getElementById('status-bar') : null;
    if (!bar) return null;
    const t = bar.querySelector('.status-title'), d = bar.querySelector('.status-detail');
    return { title: t ? t.textContent : '', detail: d ? d.textContent : '', type: bar.dataset.type || 'info' };
}

// Naviguer pendant le décompte de l'enchaînement l'annule, comme « Rester ici » (R2) : on regarde, on ne passe pas.
function _holdChain() {
    if (!trainingState.pause || !trainingState.timers.length) return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
}

// Enchaîne ou attend selon trainNext ; rappelée quand l'interrupteur « Enchaîner » change.
function _afterDrill() {
    const pref = appSettings.trainNext;
    if (pref === 'auto' || (pref === 'error' && !_drillSlipped())) {
        _later(nextDrill, TRAIN_NEXT_MS);
        setStatusAction({ action: 'Rester ici', title: 'Ne pas enchaîner : rester sur cette position', run: trainingStay, ring: TRAIN_NEXT_MS, toggle: _chainToggle() });
        return;
    }
    _offerNext();
}

function _offerNext() {
    setStatusAction({ action: 'Suivant', icon: 'skip-forward', title: 'Exercice suivant (Entrée)', run: () => nextDrill(), toggle: _chainToggle() });
}

// Interrupteur « Enchaîner » de la fin d'exercice (comme la case de Lichess) : allumé = trainNext 'auto',
// éteint = 'error' (défaut). « Toujours attendre » ('wait') reste dans Paramètres › Entraînement › Exercice suivant ;
// l'interrupteur y est éteint. Allumer à l'arrêt lance le décompte ; éteindre l'arrête si une réussite nette ne suffit pas.
function _chainToggle() {
    return { label: 'Enchaîner', on: appSettings.trainNext === 'auto', title: 'Passer seul à l’exercice suivant, même après une erreur ou un indice', run: trainingChain };
}

function trainingChain(on) {
    setPref('trainNext', on ? 'auto' : 'error');
    if (!trainingState.pause || trainingState.editing) return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    _afterDrill();
}

// « Rester ici » : l'enchaînement prévu est annulé, la fin d'exercice attend.
function trainingStay() {
    if (!trainingState.pause) return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    _offerNext();
}

// Outils de fin d'exercice (Analyser, Modifier le coup) : actifs seulement à l'arrêt, hors modification en cours.
function _syncAfterTools() {
    if (typeof document === 'undefined' || !document.querySelectorAll || !document.querySelector) return;
    const R = trainingState.review, inGame = gameMode === 'training' && !trainingState.editing;
    const [analyse, edit] = document.querySelectorAll('.tr-after');
    if (analyse) analyse.disabled = !(inGame && trainingState.pause && !R);
    if (edit) edit.disabled = !(inGame && (trainingState.pause || (R && !R.replay)));
    const skip = document.querySelector('.tr-skip');
    if (skip) skip.disabled = !!(R || trainingState.pause || trainingState.bite);    // en pause, c'est « Suivant » au milieu
}

// Analyser : la ligne jouée s'ouvre dans l'Analyse ; Quitter (Q) revient à l'exercice suivant de la même séance.
function trainingAnalyse() {
    if (!trainingState.pause || gameMode !== 'training') return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingBackToLive();
    const color = playerColor;
    const pause = trainingState.pause, path = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));
    openAnalysis(undefined, undefined, () => {
        gameMode = 'training';
        playerColor = color;
        loadDB();
        showGameScreen(color);
        // Quitter l'Analyse revient à la position analysée, en pause (I6) : « Suivant » mène à la suivante.
        resetNavCursor();
        loadPositionFromPath(path);
        trainingState.busy = true;
        trainingState.pause = pause;
        _syncAfterTools();
        _navRefresh();
        _renderSessionBar();
        trainingLiveStatus();
    });
}

// Modifier le coup : l'échiquier revient avant ma réponse ; le coup joué ensuite la remplace, après confirmation
// (l'ancien part à la corbeille 30 jours, comme « Remplacer » de l'arbre). Rien n'est compté.
function trainingEditMove() {
    const R = trainingState.review, p = R || trainingState.pause, entry = p && openingDB[p.key];
    if (!entry || !entry.path || !entry.path.length || gameMode !== 'training' || (R && R.replay)) return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    resetNavCursor();
    loadPositionFromPath(entry.path.slice(0, -1));
    if (positionKey() !== p.key) { if (R) _reviewStatus(); else _offerNext(); return; }
    trainingState.editing = p.key;
    trainingState.busy = false;
    _syncAfterTools();
    renderBoard();
    _editStatus();
}

function _editStatus() {
    const entry = openingDB[trainingState.editing];
    setStatus('Corriger ma réponse', 'new', entry ? `Jouez le coup qui remplacera ${formatSanText(entry.san, turn)}.` : '',
        { action: 'Annuler', title: 'Garder le coup actuel', run: trainingEditCancel });
}

function trainingEditCancel() {
    const R = trainingState.review, p = R || trainingState.pause, entry = p && openingDB[p.key];
    trainingState.editing = null;
    if (R) { trainingState.busy = false; if (entry) loadPositionFromPath(entry.path.slice(0, -1)); _syncAfterTools(); renderBoard(); _reviewStatus('Réponse gardée.'); return; }
    trainingState.busy = true;
    if (entry) loadPositionFromPath(entry.path);
    _syncAfterTools();
    setStatus('Coup gardé', 'info', entry ? `${formatSanText(entry.san, entry.ply % 2 === 1 ? 'w' : 'b')} reste votre réponse.` : '');
    if (trainingState.pause) trainingState.pause.status = _statusNow();
    _offerNext();
}

function _editPlayed(from, to, promo) {
    const key = trainingState.editing, entry = openingDB[key], mv = moveToStr(from, to, promo);
    if (!entry) { trainingEditCancel(); return; }
    if (mv === entry.move) { trainingEditCancel(); return; }
    const side = turn, san = toAlgebraic(from, to, promo), path = entry.path.slice(0, -1);
    const label = s => formatSanText(s, side);
    confirmDeleteEntry(key, `Remplacer ${label(entry.san)} par ${label(san)} ? L'ancien coup est conservé 30 jours dans la corbeille.`, extra => {
        openingDB[key] = newEntry(mv, san, path.concat(mv));
        saveDB();
        trainingState.editing = null;
        _afterReplace(key);
        const done = `${label(san)} est votre nouvelle réponse ; elle passe en « À découvrir ».${extra ? ` ${extra} coup(s) orphelin(s) mis à la corbeille.` : ''}`;
        if (trainingState.review) {
            trainingState.busy = false;
            loadPositionFromPath(path);
            _syncAfterTools();
            renderBoard();
            _reviewStatus(done);
            return;
        }
        trainingState.busy = true;
        loadPositionFromPath(path.concat(mv));
        _syncAfterTools();
        setStatus('Coup remplacé', 'ok', done);
        if (trainingState.pause) trainingState.pause.status = _statusNow();
        _offerNext();
    });
}

// Réponse remplacée (Q1) : la note de la séance sur l'ancienne réponse est retirée du bilan, son deuxième passage annulé ;
// la nouvelle réponse repart en découverte (newEntry), l'ancienne est à la corbeille avec son historique.
function _afterReplace(key) {
    const S = trainingState.session;
    if (!S) return;
    S.items.forEach(x => {
        if (x.key !== key) return;
        if (x.res) x.edited = true;
        else if (x !== S.items[S.cur]) { x.dropped = true; x.res = 'skip'; }
    });
    const r = S.results.get(key);
    if (r) r.replaced = true;
    _renderSessionBar();
    _saveSession();
}

function _continueSequence() {
    const s = trainingState.seq;
    if (s.done < s.len) {
        const line = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));
        if (trainingState.session && trainingState.session.kind === 'club') { ClubMatch.next(line); return; }
        const opp  = _pickOppContinuation(line);
        if (opp) { _playOpponentReply(opp); return; }
        if (s.len > 1) setStatus('✓ Fin de la variante.', 'ok');
    }
    _finishDrill();
}

// ─── SOLUTION ─────────────────────────────────────────────────────────────────

function showTrainingSolution() {
    if (gameMode !== 'training' || trainingState.busy || trainingState.review || turn !== playerColor) return;
    trainingBackToLive();

    const key   = positionKey();
    const entry = openingDB[key];
    if (!entry) { setStatus('Aucune solution connue pour cette position.', 'info'); return; }

    if (trainingState.solutionFor !== key) {
        trainingState.solutionFor   = key;
        trainingState.seq.assisted  = true;
        trainingState.drill.erred   = true;
        const first = !trainingState.keyErred;
        if (first) _sessionMistake(key);
        trainingState.keyErred = true;
        const cur = _curItem();
        if (cur && cur.key === key) cur.help = 3;
        if (first && !_scores() && !_secondPass()) _logPlayed();
        if (TRAIN_SOLUTION_PENALTY && first && _scores()) {
            recordMiss(entry);                         // en découverte, rien n'est compté
            saveDB();
        }
    }
    revealSolution(entry);
    setStatus(`Solution : ${formatSanText(entry.san, turn)}`, 'hint', 'Jouez-le pour continuer (aucune réussite comptée).');
}

// ─── RÉPONSE DU JOUEUR ────────────────────────────────────────────────────────

// Deuxième passage d'une position ratée plus tôt dans la séance : il sert à retenir, il ne donne pas de note.
function _secondPass() {
    const S = trainingState.session, it = S && S.items[S.cur];
    return !!(it && it.second);
}

// Séances qui notent (chantier « Révision du jour », 18 novembre 2026) : les révisions seules écrivent essais, erreurs,
// planning, série et maîtrise. Mode libre (sans séance), contre-la-montre, Survie, défi du jour, Adversaire du club,
// erreurs de la séance et cadre de la pellicule ne touchent plus l'entrée : leurs records, vies, score et verdict du
// défi (Daily.save) gardent leurs propres comptes. Le deuxième passage d'une séance ne note pas non plus.
const TRAIN_SCORED = new Set(['due', 'review', 'relearn', 'weak', 'unsure', 'line']);
// Un passage hors révision laisse seulement sa trace pour la série de jours (logActivity(…, true) : champ p du journal),
// sans compter dans l'objectif du jour ni dans la file (décision du 18 novembre 2026).
const _logPlayed = () => { if (typeof logActivity === 'function') logActivity(true, true); };
function _scores() {
    const S = trainingState.session;
    return !!S && TRAIN_SCORED.has(S.kind) && !_secondPass();
}

// Ce que le passage a changé : rattrapage réussi, sinon le palier et la prochaine révision.
function _answerDetail(entry, inFile) {
    const step = stepOf(entry), next = step ? `revue ${dueInLabel(entry.due, true)}` : 'revue demain';
    if (inFile && !Number.isInteger(entry.relearn)) return `Rattrapage réussi : palier ${step} gardé · ${next}`;
    return step ? `Palier ${step} · ${next}` : `Découverte · ${next}`;
}

// Appelé par executePlayerMove() en mode entraînement (le coup n'est pas encore appliqué).
// Le premier coup du passage décide : ni les essais suivants ni la réussite finale ne comptent.
// « Le trait gravé » : une position passe à Maîtrisée pendant la séance (réponse comptée, sans erreur).
// Le trait de la marque se grave après le titre de la barre d'état, avec la cloche de laiton (son « master », réglage Exercice réussi).
function _engraveMastered() {
    if (typeof Engrave !== 'undefined') Engrave.play(document.querySelector('#status-text .status-title') || document.getElementById('status-bar'));
    playSound('master');
}

function answerTrainingMove(entry, from, to, promo, movStr) {
    const key      = positionKey();
    const revealed = trainingState.solutionFor === key;
    const second   = _secondPass(), scored = _scores();

    if (entry && trainingState.presenting === key) {     // découverte : le coup montré, à jouer tel quel
        if (movStr !== entry.move) { _rejectMove(to, 'Jouez le coup montré', 'Découverte : rien n’est compté.', from); return; }
        trainingState.presenting = null;
        presentEntry(entry);
        saveDB();
        _sessionRecord(key, true);
        trainingState.drill.answered = key;
        trainingState.busy = true;
        _commitMove(from, to, promo, null, '✓ Coup découvert', 'ok', 'Il reviendra demain : à retrouver de mémoire.');
        _renderSessionBar();
        trainingState.seq.done++;
        _continueSequence();
        return;
    }

    if (entry && movStr === entry.move) {
        let msg = '✓ Bien joué !', detail = second ? 'Deuxième passage : rien de plus n’est compté.' : 'Hors révision : rien n’est noté.', engraved = false;
        const help = typeof hintLevel === 'function' ? hintLevel(key) : 0;     // palier d'indice reçu : 0, 1 (type), 2 (pièce exacte)
        if (revealed) { msg = '✓ Solution jouée'; detail = 'Aucune réussite comptée.'; }
        else if (trainingState.keyErred) { msg = '✓ Bon coup'; detail = 'L’erreur est déjà comptée pour ce passage.'; }
        else if (!scored) { if (!second) _logPlayed(); }
        else {
            const lvBefore = _level(entry), inFile = Number.isInteger(entry.relearn) ? { step: entry.relearn } : null;
            entry.attempts++;
            recordReview(entry, true, help);
            saveDB();
            if (typeof Suite !== 'undefined') Suite.afterAnswer();
            detail = help >= 2 ? 'Avec la pièce montrée : palier gardé, revue demain.'
                : help ? `Avec l’indice : ${_answerDetail(entry, inFile)}` : _answerDetail(entry, inFile);
            if (help) msg = '✓ Trouvé avec l’indice';
            engraved = !help && lvBefore !== 'mastered' && _level(entry) === 'mastered';   // la gravure reste au coup sans aide
            if (engraved) msg = '✓ Maîtrisée';
        }
        const cur = _curItem();
        if (cur && cur.key === key) cur.help = Math.max(cur.help || 0, revealed ? 3 : help);
        _sessionRecord(key, !trainingState.keyErred && !revealed);
        trainingState.drill.answered = key;
        trainingState.busy = true;
        _commitMove(from, to, promo, null, msg, revealed ? 'info' : 'ok', detail);
        if (engraved) _engraveMastered();
        _renderSessionBar();
        trainingState.seq.done++;
        _continueSequence();
    } else if (entry && !revealed) {
        const first = !trainingState.keyErred;
        if (first && !scored && !second) _logPlayed();
        const cur = _curItem();
        if (cur && cur.key === key && movStr) (cur.tries = cur.tries || []).push(movStr);   // la pellicule garde le coup faux (revue)
        const S0 = trainingState.session;
        trainingState.missUndo = first && S0 && !second && !trainingState.misclickUsed && ['due', 'review', 'relearn', 'weak', 'unsure', 'daily', 'survival'].includes(S0.kind)
            ? { key, entry: JSON.parse(JSON.stringify(entry)), lives: S0.lives, combo: trainingState.combo } : null;
        let counted = false;
        if (first && scored) {                         // erreur : comptée une fois, sur la position exacte, en révision seulement
            counted = recordMiss(entry);               // en découverte, rien n'est compté
            saveDB();
            if (typeof Suite !== 'undefined') Suite.afterAnswer();
        }
        let again = false;
        if (first) { trainingState.combo = 0; again = _sessionMistake(key); }
        trainingState.keyErred = true;
        trainingState.drill.erred = true;
        const S = trainingState.session;
        if (S && S.kind === 'club') {                 // Adversaire du club : la première erreur arrête la partie
            _rejectMove(to, '✗ Pas le bon coup', ClubMatch.stopText(entry), from);
            noteMistake(key);
            ClubMatch.finish('mistake');
            return;
        }
        const told = !first ? '' : S && S.kind === 'timed' ? '−10 s. '
            : S && S.kind === 'survival' ? (S.lives > 0 ? `Plus que ${S.lives} vie${S.lives > 1 ? 's' : ''}. ` : 'Troisième erreur : la survie s’arrête après cette position. ')
            : scored ? (counted ? (entry.step === 0 ? 'Deuxième erreur d’affilée : à réapprendre, revue demain. ' : 'Un palier de moins, rattrapage demain. ')
                : 'Découverte : rien n’est compté, elle revient demain. ') : '';
        _rejectMove(to, '✗ Pas le bon coup', `${told}${again ? 'Elle revient en fin de séance. ' : ''}Réessayez, ou appuyez sur Indice.`, from);
        noteMistake(key);
        if (trainingState.missUndo) _offerMisclick();
        _saveSession();
    } else {
        _rejectMove(to, revealed ? "✗ Ce n'est pas le coup de la solution" : '✗ Pas le bon coup', 'Réessayez.', from);
    }
}

GameModes.register('training', {
    inputBlocked: () => { const R = trainingState.review; return R ? !(R.replay || trainingState.editing) : trainingState.busy; },
    navBlocked: () => trainingState.busy && !trainingState.pause && !trainingState.bite && !trainingState.review,   // animation seulement (R2)
    navBlockedNote: 'Patientez : la position se met en place',
    center: () => _trCenter(),
    engineArrows: () => _reviewArrows(),
    onNavigate: () => _holdChain(),
    backToLive: () => trainingBackToLive(),
    sessionCursor: true,
    hintToSolution: true,
    hintNote: ' — palier gardé',
    pieceNote: ' — palier gardé, revue demain',
    solutionNote: ' — compte une erreur',
    hintCost: step => !_scores() ? '' : trainingState.keyErred ? ' L’erreur est déjà comptée.' : step >= 2 ? ' Trouvé ainsi : palier gardé, revue demain.' : ' Trouvé ainsi : palier gardé.',
    idleAction: () => _focusHintAction(),
    solutionCost: () => {
        const e = openingDB[positionKey()];
        return TRAIN_SOLUTION_PENALTY && _scores() && !trainingState.keyErred && !(e && isDiscovering(e)) ? ' Voir la solution compte comme une erreur.' : '';
    },
    onMove: (from, to, promo) => trainingState.editing === positionKey() ? _editPlayed(from, to, promo)
        : trainingState.review ? (trainingState.review.replay ? _replayPlayed(from, to, promo) : null)
        : answerTrainingMove(openingDB[positionKey()], from, to, promo, moveToStr(from, to, promo)),
    onSolution: () => showTrainingSolution(),
    liveStatus: () => trainingLiveStatus()
});

// Mode Focus : la rangée de boutons est cachée (css/game.css), l'Indice devient l'action de la barre d'état
// pendant mon tour (« Indice », « Pièce », puis « Solution »). La touche Espace reste.
function _focusHintAction() {
    if (typeof TrainFocus === 'undefined' || !TrainFocus.active() || gameMode !== 'training') return null;
    if (trainingState.busy || trainingState.pause || trainingState.editing || trainingState.bite || turn !== playerColor || navCursor !== -1) return null;
    const key = positionKey();
    if (!openingDB[key]) return null;
    const step = trainingState.solutionFor === key ? 3 : hintLevel(key);
    if (step >= 3) return null;                              // solution montrée : il reste à la jouer
    return step >= 2 ? { action: 'Solution', icon: 'flame', title: 'Voir la solution (Espace) — compte une erreur', run: () => showHint() }
        : step ? { action: 'Pièce', icon: 'lightbulb', title: 'Montrer la pièce (Espace) — maîtrise gardée, revue demain', run: () => showHint() }
        : { action: 'Indice', icon: 'lightbulb', title: 'Indice (Espace) — gain de maîtrise réduit', run: () => showHint() };
}
