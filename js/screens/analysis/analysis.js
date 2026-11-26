/**
 * screens/analysis/analysis.js
 * ──────────────────────────────────────────────────────────────────────────
 * Mode « Analyse » (gameMode 'analysis') : l'échiquier de l'écran de jeu, les deux camps jouables,
 * le moteur Stockfish (engine.js) et un BROUILLON en arbre. Rien n'est écrit dans le répertoire
 * pendant l'exploration ; « Ajouter au répertoire » montre d'abord ce qui sera fusionné.
 *
 *   openAnalysis(path?, displayPly?, back?, fen?) : ouvre l'analyse sur une ligne (coups UCI depuis le début, ou depuis
 *       la position fen : éditeur de position, chantier « Éditeur et photo ») ; par défaut, la ligne de l'écran Jouer
 *       et la position affichée. Depuis une position posée, « Ajouter au répertoire » est remplacé par une note.
 *   Brouillon : arbre { uci, san, kids } depuis la position de départ (analysis.start) ; la ligne affichée est
 *       moveHistory (navigation ◀ ▶ habituelle). Gardé pour la session (sessionStorage) et proposé à
 *       la prochaine ouverture sur le même répertoire et la même couleur. Une seule réponse à moi par position
 *       (comme le répertoire, chantier « L'échiquier de Chays ») : jouer un autre coup à mon trait le remplace dans
 *       le brouillon, sa suite comprise, transpositions comprises (_anInsert, _anUnique) ; seuls les coups adverses
 *       ouvrent des branches.
 *   Répertoire : le titre de la barre d'état et le badge du brouillon disent si la position affichée est encore dans
 *       le répertoire (_anRepState) ; dans l'arbre, les coups hors répertoire sont en pointillé, le premier marqué ;
 *       à mon trait, mon coup enregistré est fléché en laiton.
 *   Lignes du moteur : un clic joue le coup (animé), « + » recopie la variante dans le brouillon.
 *   Marques du brouillon (analysisMarks, fonction pure sur le plan de fusion) : mes coups seulement, nouveau (point),
 *       déjà connu (cercle), conflit gardé (losange ambre, ouvre l'aperçu sur ce conflit), à remplacer (losange rouge).
 *   Évaluation Lichess (cloud-eval) : affichée tout de suite pour une position connue, jusqu'à ce que
 *       le moteur local la dépasse en profondeur.
 *   Fusion (analysisMergePlan, fonction pure) : mon coup créé s'il n'existe pas, identique ignoré, différent =
 *       remplacement (l'ancien part à la corbeille, avec la suite devenue inaccessible si « Avec sa suite » est
 *       cochée), sauf « Remplacer » décoché dans l'aperçu (conflit : mon coup est gardé et la ligne s'arrête) ; les
 *       coups adverses sont notés comme réponses connues.
 */

'use strict';

const ANALYSIS_DRAFT_KEY = 'chessTrainer_analysisDraft';
const CLOUD_EVAL_URL     = 'https://lichess.org/api/cloud-eval';

const analysis = {
    rep: '', color: 'w', tree: { kids: [] }, dirty: false,
    start: null,          // FEN de départ (position posée dans l'éditeur) ; null : position initiale
    running: false, job: null, wait: null, lines: [], fen: '', cloud: null, cloudFen: '',
    back: null,           // retour de Quitter quand l'Analyse vient d'ailleurs (fin d'exercice de l'Entraînement)
    origin: null,         // Jouer quitté pour l'Analyse : { line, ply } (ligne et coup affiché), où Quitter ramène
    paused: false,        // « Arrêter » : calcul suspendu sur la position affichée seulement ; la suivante le relance
    retries: 0,           // nouveaux essais d'un calcul annulé par le moteur (Worker mort, erreur), sur la même position
    bar: null,            // dernière ligne montrée par la barre d'évaluation, gardée le temps du calcul suivant
    merge: null,          // aperçu ouvert : { all, keep: Set(clés où mon coup enregistré est gardé), cascade, focus }
    intro: false,         // consigne d'ouverture gardée en sous-titre jusqu'au premier coup ou déplacement
    merging: false,       // fusion confirmée, écriture en cours (aria-busy)
    lastMerge: null,      // dernière fusion : { added: [clés], opp: [[clé, uci]], noUndo, replacedSans }
    resumed: false,       // brouillon de la session repris à l'ouverture (bandeau jusqu'au premier coup)
    seen: null            // chemins déjà dessinés dans l'arbre : les autres apparaissent en fondu
};

// ─── BROUILLON ────────────────────────────────────────────────────────────────

// Position de départ de l'analyse : la position initiale, ou celle posée dans l'éditeur.
const _anRoot = () => analysis.start ? Chess.fromFen(analysis.start) : Chess.start();
// Demi-coups avant le premier coup du brouillon (1 quand les Noirs ont le trait au départ) : numérotation des coups.
const _anPly0 = () => analysis.start && analysis.start.split(/\s+/)[1] === 'b' ? 1 : 0;

// Ajoute une ligne au brouillon. À mon trait, le coup de la ligne devient la seule réponse de la position, ici et
// partout où elle revient (transposition) : les autres partent avec leur suite. Renvoie les coups remplacés (SAN).
function _anInsert(path) {
    let node = analysis.tree, pos = _anRoot();
    const mine = new Map(), gone = [];
    path.forEach(uci => {
        if (pos.turn === analysis.color) mine.set(Chess.key(pos), uci);
        let kid = node.kids.find(k => k.uci === uci);
        if (!kid) { kid = { uci, san: Chess.san(pos, uci), kids: [] }; node.kids.push(kid); }
        pos = Chess.play(pos, uci);
        node = kid;
    });
    _anUnique(mine, gone);
    return gone;
}

// Un seul coup à moi par position dans tout l'arbre : celui de `mine` (clé → uci) s'il est donné, sinon le premier
// rencontré (brouillon repris d'avant la règle). Les coups retirés vont dans `gone` (SAN).
function _anUnique(mine = new Map(), gone = []) {
    (function walk(node, pos) {
        if (pos.turn === analysis.color && node.kids.length) {
            const k = Chess.key(pos);
            if (!mine.has(k)) mine.set(k, node.kids[0].uci);
            const keep = node.kids.filter(c => c.uci === mine.get(k));
            node.kids.forEach(c => { if (!keep.includes(c)) gone.push(c.san); });
            node.kids = keep;
        }
        node.kids.forEach(c => walk(c, Chess.play(pos, c.uci)));
    })(analysis.tree, _anRoot());
    return gone;
}

// Toutes les lignes complètes du brouillon (de la racine à chaque feuille).
function _anLeaves(node = analysis.tree, path = [], out = []) {
    if (!node.kids.length) { if (path.length) out.push(path); return out; }
    node.kids.forEach(k => _anLeaves(k, path.concat(k.uci), out));
    return out;
}

const _anCount = () => { let n = 0; const walk = nd => nd.kids.forEach(k => { n++; walk(k); }); walk(analysis.tree); return n; };

function _anSaveDraft() {
    try { sessionStorage.setItem(ANALYSIS_DRAFT_KEY, JSON.stringify({ rep: analysis.rep, color: analysis.color, start: analysis.start, tree: analysis.tree, line: _anLine() })); }
    catch (e) { /* stockage de session indisponible : le brouillon vit seulement en mémoire */ }
}
function _anReadDraft() {
    try { return JSON.parse(sessionStorage.getItem(ANALYSIS_DRAFT_KEY) || 'null'); } catch (e) { return null; }
}
function _anClearDraft() { try { sessionStorage.removeItem(ANALYSIS_DRAFT_KEY); } catch (e) { /* rien à effacer */ } }

const _anLine = () => moveHistory.map(m => moveToStr(m.from, m.to, m.promo));

// ─── OUVERTURE / FERMETURE ────────────────────────────────────────────────────

// back : retour proposé par Quitter (Q) à la place de Jouer, par exemple l'exercice suivant de l'Entraînement.
// fen : position de départ (éditeur de position) ; path part alors d'elle.
function openAnalysis(path, displayPly, back, fen) {
    if (gameMode === 'analysis') return;
    analysis.back = typeof back === 'function' ? back : null;
    analysis.start = typeof fen === 'string' && fen && fen.split(/\s+/).slice(0, 4).join(' ') !== INIT_FEN.split(' ').slice(0, 4).join(' ') ? fen : null;
    // Ouverte depuis l'écran Jouer : sa ligne et le coup affiché sont retenus avant que l'Analyse ne remplace moveHistory.
    const gs = document.getElementById('game-screen');
    const fromPlay = !analysis.back && gameMode === 'play' && !!gs && !gs.classList.contains('hidden');
    analysis.origin = fromPlay ? { line: _anLine(), ply: navCursor === -1 ? moveHistory.length - 1 : navCursor === NAV_START ? -1 : navCursor } : null;
    if (!path) { path = _anLine(); displayPly = navCursor === -1 ? path.length - 1 : navCursor === NAV_START ? -1 : navCursor; }
    if (typeof closeToolbarMore === 'function') closeToolbarMore();
    const draft = _anReadDraft();
    analysis.rep = currentRepertoire;
    analysis.color = playerColor;
    analysis.tree = { kids: [] };
    analysis.merge = null;
    analysis.merging = false;
    analysis.lastMerge = null;
    analysis.seen = null;
    // Brouillon de la session sur ce répertoire et cette couleur : repris s'il contient la ligne demandée (ou si elle est vide).
    const resume = draft && draft.rep === analysis.rep && draft.color === analysis.color && (draft.start || null) === analysis.start
        && draft.tree && draft.tree.kids.length;
    if (resume) {
        analysis.tree = draft.tree;
        _anUnique();
        if (!path.length && Array.isArray(draft.line)) { path = draft.line; displayPly = path.length - 1; }
    }
    analysis.dirty = !!resume;
    analysis.resumed = !!resume;
    analysis.intro = true;
    _anInsert(path);
    gameMode = 'analysis';
    loadDB();
    showGameScreen(playerColor);
    loadPositionFromPath(path, { fen: analysis.start });
    if (displayPly !== undefined && displayPly < path.length - 1) navGo(displayPly);
    analysis.running = appSettings.engineAuto;
    analysis.paused = false;
    _anScreenClass(true);
    analysisPositionChanged();
}

// Arrêt du calcul (sortie par le logo ou un onglet : le brouillon reste dans la session).
function stopAnalysis() {
    if (typeof WhatIf !== 'undefined') WhatIf.stop();       // « Et si » (lot 6) : le moteur bridé s'arrête avec l'Analyse
    _anScreenClass(false);
    clearTimeout(analysis.wait);
    if (analysis.job) analysis.job.stop();
    analysis.job = null;
    analysis.lines = [];
    analysis.bar = null;
    analysis.merge = null;
    analysis.merging = false;
}

// Classe de l'écran de jeu en Analyse (place de la barre d'évaluation sur téléphone).
function _anScreenClass(on) {
    const gs = document.getElementById('game-screen');
    if (gs) gs.classList.toggle('is-analysis', on);
}

function quitAnalysis() {
    const back = analysis.back;
    analysis.back = null;
    stopAnalysis();
    if (back) { back(); return; }
    // Retour à Jouer tel qu'on l'a laissé (ligne et coup affiché) ; sans origine (palette, accueil), la ligne analysée.
    // Les deux se lisent AVANT startGame, qui vide moveHistory.
    // Position posée (éditeur) : sa ligne ne part pas du début, Jouer reprend la position initiale.
    const o = analysis.origin, line = o ? o.line.slice() : analysis.start ? [] : _anLine();
    analysis.origin = null;
    analysis.start = null;
    gameMode = 'play';
    startGame(analysis.color);
    loadPositionFromPath(line);
    if (o && o.ply < line.length - 1) navGo(o.ply);
}

function discardAnalysis() {
    const n = _anCount();
    const go = () => { _anClearDraft(); analysis.tree = { kids: [] }; analysis.dirty = false; quitAnalysis(); };
    if (!analysis.dirty || !n) { go(); return; }
    askConfirm(`Abandonner l’analyse ? Le brouillon (${n} coup${n > 1 ? 's' : ''}) sera effacé ; rien n’a été ajouté au répertoire.`, go);
}

// ─── COUPS ────────────────────────────────────────────────────────────────────

// Appelé par executePlayerMove (boardLogic.js) : les deux camps sont libres, rien n'est vérifié.
function analysisMove(from, to, promo) {
    const san = toAlgebraic(from, to, promo), side = turn;
    _commitMove(from, to, promo, null, `Analyse : ${formatSanText(san, turn)}`, 'info', '');
    const gone = _anInsert(_anLine());
    analysis.swap = gone.length ? { san, side, gone, at: _anLine().join(',') } : null;
    analysis.intro = false;
    analysis.dirty = true;
    analysis.lastMerge = null;
    analysis.resumed = false;
    _anSaveDraft();
    analysisPositionChanged();
    if (typeof WhatIf !== 'undefined') WhatIf.afterMove();   // « Et si » : au tour du moteur, il répond
}

function analysisGo(arg) {
    const path = arg ? arg.split(',') : [];
    analysis.intro = false;
    loadPositionFromPath(path, { fen: analysis.start });
    analysisPositionChanged();
}

// Recopie une ligne du moteur dans le brouillon (sans jouer ses coups sur l'échiquier).
function analysisUseLine(i) {
    const l = analysis.lines[Number(i)];
    if (!l) return;
    const base = _displayedPath();
    const gone = _anInsert(base.concat(l.pv.slice(0, 12)));
    analysis.dirty = true;
    analysis.resumed = false;
    analysis.lastMerge = null;
    _anSaveDraft();
    renderAnalysisPanel();
    setStatus('Ligne ajoutée au brouillon', 'info', gone.length
        ? `Elle remplace ${gone.map(x => formatSanText(x, analysis.color)).join(', ')} dans le brouillon : une seule réponse par position.`
        : 'Elle apparaît dans l’arbre de l’analyse ; rien n’est encore au répertoire.');
}

// « Corriger » (crayon, comme dans Jouer et en séance) : retour à la position d'avant mon dernier coup affiché ;
// le prochain coup joué le remplace (dans le brouillon, puis au répertoire par « Ajouter »).
function analysisEditMove() {
    const path = _displayedPath();
    let pos = _anRoot(), last = -1;
    path.forEach((u, i) => { if (pos.turn === analysis.color) last = i; pos = Chess.play(pos, u); });
    if (last < 0) { setStatus('Aucun de vos coups à corriger', 'info', 'Jouez d’abord un coup de votre camp sur l’échiquier.'); return; }
    const before = Chess.replay(path.slice(0, last), analysis.start ? Chess.fromFen(analysis.start) : undefined);
    const san = Chess.san(before, path[last]);
    analysisGo(path.slice(0, last).join(','));
    setStatus(`Corriger ${formatSanText(san, analysis.color)}`, 'new', 'Jouez le coup qui le remplacera : sa suite quitte le brouillon, « Ajouter » l’enregistre au répertoire.');
}

function analysisPlayLine(i) {
    const l = analysis.lines[Number(i)];
    if (!l) return;
    const m = _parseUci(l.pv[0]);
    if (navCursor !== -1) _syncEngineToNavCursor();
    analysisMove(m.from, m.to, m.promo ? m.promo.toUpperCase() : null);
}

// ─── MOTEUR ───────────────────────────────────────────────────────────────────

// Moteur en marche sur la position affichée (ni arrêté ni en pause).
const _anOn = () => analysis.running && !analysis.paused;

// « Arrêter » suspend le calcul de la position affichée (ses lignes restent) ; la position suivante le relance,
// pour que l'évaluation ne manque jamais ailleurs que là où on l'a arrêtée.
function analysisToggleEngine() {
    clearTimeout(analysis.wait);
    analysis.retries = 0;
    if (_anOn()) {
        analysis.paused = true;
        if (analysis.job) { analysis.job.stop(); analysis.job = null; }
        _anPaintEngine();
        return;
    }
    analysis.running = true;
    analysis.paused = false;
    if (analysis.fen && analysis.fen === displayedFen()) { _anLaunch(analysis.fen); _anPaintEngine(); }
    else analysisPositionChanged();
}

function analysisSettingsChanged() {
    if (gameMode === 'analysis') { analysis.fen = ''; analysisPositionChanged(); }
}

const AN_SETTLE_MS = 120, AN_RETRIES = 4, AN_RETRY_SLOW_MS = 10000;

function _anLaunch(fen) {
    if (gameMode !== 'analysis' || !_anOn() || analysis.fen !== fen || analysis.job) return;
    const job = analysis.job = Engine.analyse(fen,
        { multipv: appSettings.engineLines, depth: appSettings.engineDepth, movetime: appSettings.engineTime * 1000 },
        lines => { if (analysis.job === job) { analysis.lines = lines; analysis.retries = 0; _anPaintEngine(); } });
    job.done.then(r => {
        if (analysis.job !== job) return;
        analysis.job = null;
        // Annulé par le moteur lui-même (Worker mort, erreur, rechargement) alors que la position n'a pas changé :
        // le calcul est relancé, de plus en plus tard puis toutes les 10 s ; l'évaluation déjà affichée reste en place.
        if (r && r.cancelled && _anOn() && !document.hidden) {
            const wait = analysis.retries < AN_RETRIES ? 500 * 2 ** analysis.retries : AN_RETRY_SLOW_MS;
            analysis.retries++;
            clearTimeout(analysis.wait);
            analysis.wait = setTimeout(() => _anLaunch(fen), wait);
        }
        _anPaintEngine();
    });
}

// Position affichée changée (coup, navigation, clic dans l'arbre) : calcul relancé, panneau redessiné.
function analysisPositionChanged() {
    if (gameMode !== 'analysis') return;
    const fen = displayedFen();
    if (fen !== analysis.fen) {
        analysis.fen = fen;
        analysis.lines = [];
        analysis.retries = 0;
        analysis.paused = false;
        if (analysis.job) { analysis.job.stop(); analysis.job = null; }
        // L'ancien calcul s'arrête tout de suite ; le nouveau attend que la navigation se pose (touche maintenue).
        clearTimeout(analysis.wait);
        if (analysis.running) analysis.wait = setTimeout(() => _anLaunch(fen), AN_SETTLE_MS);
        _anCloud(fen);
    }
    _anRepStatus();
    renderAnalysisPanel();
}

// Lichess écrit le roque « roi prend sa tour » (e1h1) : converti en coup du roi (e1g1), comme le moteur local.
function _anCastleFix(fen, moves) {
    let pos = Chess.fromFen(fen);
    const out = [];
    for (const u of moves) {
        let m = u;
        const from = squareToIdx(u.slice(0, 2)), to = squareToIdx(u.slice(2, 4));
        const p = pos.board[from], q = pos.board[to];
        if (p && q && p.toUpperCase() === 'K' && q.toUpperCase() === 'R' && (p === 'K') === (q === 'R'))
            m = u.slice(0, 2) + (to % 8 > from % 8 ? 'g' : 'c') + u[1];
        try { pos = Chess.play(pos, m); } catch (e) { break; }
        out.push(m);
    }
    return out;
}

// Évaluation déjà calculée par Lichess (scores du point de vue des Blancs, comme le moteur local).
function _anCloud(fen) {
    analysis.cloud = null;
    analysis.cloudFen = fen;                       // avant tout retour : une réponse tardive d'une autre position est ignorée
    if (!appSettings.cloudEval || (typeof Net !== 'undefined' && !Net.online())) return;
    fetch(`${CLOUD_EVAL_URL}?fen=${encodeURIComponent(fen)}&multiPv=${appSettings.engineLines}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
            if (!d || analysis.cloudFen !== fen || gameMode !== 'analysis') return;
            analysis.cloud = (d.pvs || []).map((p, i) => ({
                multipv: i + 1, depth: d.depth, wdl: null, pv: _anCastleFix(fen, (p.moves || '').split(' ').filter(Boolean)),
                score: p.mate !== undefined ? { mate: p.mate } : { cp: p.cp }
            })).filter(l => l.pv.length);
            _anPaintEngine();
        })
        .catch(() => { /* hors ligne ou position inconnue : le moteur local suffit */ });
}

// Lignes affichées : celles de Lichess tant que le moteur local calcule sans avoir atteint leur profondeur
// (ou sa propre limite) ; ensuite, ou dès qu'il a fini, celles du moteur local.
function _anShownLines() {
    if (typeof WhatIf !== 'undefined' && WhatIf.active()) return { lines: [], cloud: false };   // « Et si » : pas d'évaluation pendant la partie
    const local = analysis.lines, cloud = analysis.cloud;
    if (!cloud || !cloud.length) return { lines: local, cloud: false };
    if (!local.length) return { lines: cloud, cloud: true };
    const target = Math.min(cloud[0].depth, appSettings.engineDepth || Infinity);
    return analysis.job && (local[0].depth || 0) < target ? { lines: cloud, cloud: true } : { lines: local, cloud: false };
}

// Score → texte : « +0,42 », « #3 », ou chances de gain des Blancs.
function _anScore(l) {
    if (!l || !l.score) return '';
    if (l.score.mate !== undefined) return (l.score.mate > 0 ? '#' : '#−') + Math.abs(l.score.mate);
    if (appSettings.engineEval === 'wdl') return `${Math.round(_anWin(l) * 100)} %`;
    const v = l.score.cp / 100;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',');
}

// Chances de gain des Blancs (0 à 1) : WDL du moteur si disponible, sinon formule de Lichess sur les centipions.
function _anWin(l) {
    if (!l || !l.score) return 0.5;
    if (l.score.mate !== undefined) return l.score.mate > 0 ? 1 : 0;
    if (l.wdl) return (l.wdl[0] + l.wdl[1] / 2) / 1000;
    return 1 / (1 + Math.exp(-0.00368208 * l.score.cp));
}

// Variante en notation (numéros de coup compris) depuis la position affichée.
function _anPvText(pv, max = 10, html = false) {
    let pos = Chess.fromFen(analysis.fen), ply = _displayedPath().length + _anPly0(), out = '';
    pv.slice(0, max).forEach((u, i) => {
        const w = pos.turn === 'w';
        if (w) out += `${Math.floor(ply / 2) + 1}. `; else if (i === 0) out += `${Math.floor(ply / 2) + 1}… `;
        try { out += (html ? formatSan : formatSanText)(Chess.san(pos, u), pos.turn) + ' '; pos = Chess.play(pos, u); } catch (e) { return; }
        ply++;
    });
    return out.trim();
}

// Flèches des meilleurs coups (annotations.js), sur la position affichée.
// Flèches : à mon trait, mon coup enregistré en laiton (on voit ce que l'on remplacerait) ; puis les meilleurs coups
// du moteur, sans celui qui recouvrirait la flèche laiton.
function analysisArrowList() {
    if (gameMode !== 'analysis') return [];
    const out = [], mine = _anStoredHere();
    if (mine) out.push({ from: squareToIdx(mine.slice(0, 2)), to: squareToIdx(mine.slice(2, 4)), color: 'gold' });
    if (!appSettings.engineArrows) return out;
    const { lines } = _anShownLines();
    lines.slice(0, appSettings.engineArrows).filter(l => l.pv && l.pv[0] && l.pv[0].slice(0, 4) !== (mine || '').slice(0, 4))
        .forEach((l, i) => out.push({ from: squareToIdx(l.pv[0].slice(0, 2)), to: squareToIdx(l.pv[0].slice(2, 4)), color: i ? 'blue' : 'accent' }));
    return out;
}

// Mon coup enregistré dans la position affichée (UCI), à mon trait et depuis le début seulement.
function _anStoredHere() {
    if (analysis.start || typeof openingDB === 'undefined' || (typeof WhatIf !== 'undefined' && WhatIf.active())) return null;   // « Et si » : rien ne souffle
    const pos = Chess.replay(_displayedPath());
    if (pos.turn !== analysis.color) return null;
    const e = openingDB[Chess.key(pos)];
    return e ? e.move : null;
}

// ─── DANS LE RÉPERTOIRE OU HORS ───────────────────────────────────────────────
// Une ligne est dans le répertoire tant que chacun de mes coups est ma réponse enregistrée et que chaque coup adverse
// est connu (il mène à une position où j'ai une réponse, ou il est repéré dans oppSeen). Fonction pure sur db / opp.
// Renvoie { out: indice du premier coup hors répertoire, ou -1 }.
function analysisRepState(path, color, db, opp = {}) {
    let pos = Chess.start();
    for (let i = 0; i < path.length; i++) {
        const k = Chess.key(pos), uci = path[i];
        if (pos.turn === color) {
            if (!db[k] || db[k].move !== uci) return { out: i };
            pos = Chess.play(pos, uci);
        } else {
            const next = Chess.play(pos, uci);
            if (!db[Chess.key(next)] && !(opp[k] || []).includes(uci)) return { out: i };
            pos = next;
        }
    }
    return { out: -1 };
}

const _anRepState = path => analysisRepState(path, analysis.color, openingDB, typeof oppSeen !== 'undefined' ? oppSeen : {});

// « 6. Fc4 » / « 6… e5 » : numéro et coup d'un demi-coup de la ligne.
function _anPlyText(path, i) {
    const san = _pathToSans(path.slice(0, i + 1))[i], side = i % 2 ? 'b' : 'w', n = Math.floor(i / 2) + 1;
    return `${n}${side === 'w' ? '.' : '…'} ${formatSanText(san, side)}`;
}

// Titre de la barre d'état : dans le répertoire ou hors répertoire depuis tel coup ; en sous-titre, la consigne
// d'ouverture, le coup remplacé dans le brouillon, ou mon coup enregistré ici.
function _anRepStatus() {
    if (gameMode !== 'analysis' || analysis.merge || analysis.start || (typeof WhatIf !== 'undefined' && WhatIf.active())) return;
    const path = _displayedPath(), st = _anRepState(path), mine = _anStoredHere();
    const sw = analysis.swap && analysis.swap.at === path.join(',') ? analysis.swap : null;   // seulement sur le coup joué
    const title = st.out < 0 ? 'Dans le répertoire' : `Hors répertoire depuis ${_anPlyText(path, st.out)}`;
    const detail = analysis.intro ? (analysis.back ? 'Jouez librement : rien n’est enregistré sans « Ajouter au répertoire ». Quitter (Q) reprend l’entraînement.'
                                    : 'Jouez librement les deux camps : rien n’est enregistré tant que vous n’ajoutez pas au répertoire.')
        : sw ? `${formatSanText(sw.san, sw.side)} remplace ${sw.gone.map(x => formatSanText(x, sw.side)).join(', ')} dans le brouillon : une seule réponse par position.`
        : mine && st.out < 0 ? `Votre coup ici : ${formatSanText(Chess.san(Chess.replay(path), mine), analysis.color)} (flèche laiton).`
        : mine ? `Votre coup enregistré ici : ${formatSanText(Chess.san(Chess.replay(path), mine), analysis.color)} (flèche laiton) ; en jouer un autre le remplacera.`
        : st.out >= 0 ? '« Ajouter au répertoire » enregistre vos coups de cette ligne.' : '';
    setStatus(title, st.out < 0 ? 'info' : 'new', detail);
}

// ─── PANNEAU ──────────────────────────────────────────────────────────────────
// Bureau : panneau latéral ; téléphone : tiroir du bas. Deux cartes (moteur, brouillon annoté) ou, pendant la fusion,
// l'aperçu seul : un seul bouton principal visible à la fois.

function renderAnalysisPanel() {
    const box = document.getElementById('analysis-panel');
    if (!box || gameMode !== 'analysis') return;
    box.setAttribute('aria-busy', analysis.merging ? 'true' : 'false');
    if (analysis.merge) {
        box.innerHTML = _anPreviewHTML();
        _anFocusConflict(box);
        Bus.emit('ui:refresh');                                     // l'action du milieu devient la confirmation
        return;
    }
    const wi = typeof WhatIf !== 'undefined' && WhatIf.active();
    box.innerHTML = `${wi ? WhatIf.cardHTML() : '<div class="ab-card ab-engine" id="an-engine"></div>'}${_anDraftHTML()}`;
    _anPaintEngine();
    _anRevealInPanel(box.querySelector('.ab-mv.is-cur'));
    Bus.emit('ui:refresh');                                         // l'action du milieu suit « Ajouter (N) »
}

// Amène un élément à l'écran dans le panneau qui défile, jamais la page : sur téléphone, le brouillon est sous
// l'échiquier (scrollIntoView ferait descendre la page à chaque coup et sortirait l'échiquier de l'écran).
function _anRevealInPanel(el) {
    for (let box = el && el.parentElement; box && box !== document.body; box = box.parentElement) {
        if (!/auto|scroll/.test(getComputedStyle(box).overflowY) || box.scrollHeight <= box.clientHeight) continue;
        const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (r.top < b.top) box.scrollTop -= b.top - r.top;
        else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
        return;
    }
}

// Puces du réseau et des fils : elles mènent à Paramètres › Moteur (le téléchargement du réseau complet se fait là).
function _anChipsHTML() {
    const info = Engine.info(), net = info ? info.net : appSettings.engineNet;
    const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    const multi = info ? info.threads > 1 : isolated;
    const fils = !multi ? 'mono-thread' : info ? `${info.threads} fils` : 'multi-thread';
    const why = multi ? 'Calcul sur plusieurs fils (multi-thread).'
                      : 'Calcul sur un seul fil : ce navigateur n’isole pas la page (Safari, par exemple).';
    return `<button type="button" class="ab-chip is-tap" data-action="analysisEngineSettings" title="Réseau du moteur : Paramètres › Moteur">${net === 'full' ? 'complet' : 'léger'}</button>
        <button type="button" class="ab-chip is-tap ab-threads" data-action="analysisEngineSettings" title="${escapeHtml(why)} Paramètres › Moteur">${fils}</button>`;
}

// État du moteur : [texte, variante de puce, icône].
function _anEngineState(lines, cloud) {
    const st = Engine.status(), depth = lines[0] ? lines[0].depth : 0;
    if (!analysis.running) return ['arrêté', '', ''];
    if (analysis.paused) return [depth && !cloud ? `en pause · prof. ${depth}` : 'en pause', 'is-paused', ''];
    if (st === 'loading') return ['chargement…', '', ''];
    if (!analysis.job && analysis.retries) return ['reprise…', 'is-warn', 'rotate-ccw'];
    if (st === 'error') return ['indisponible', 'is-err', 'alert-triangle'];
    if (!lines.length && _anFinal()) return ['position finale', '', ''];
    if (cloud) return [`Lichess · prof. ${depth}`, 'is-cloud', 'cloud'];
    if (depth) return analysis.job ? [`prof. ${depth}`, 'is-live', ''] : [`prof. ${depth} · terminé`, '', ''];
    return ['calcul…', 'is-live', ''];
}

// Position affichée sans coup légal : « Mat » ou « Pat », sinon chaîne vide.
function _anFinal() {
    if (!analysis.fen || Chess.legalMoves(Chess.fromFen(analysis.fen)).length) return '';
    const path = _displayedPath();
    if (!path.length) { const p = Chess.fromFen(analysis.fen); return PositionSetup.inCheck(p, p.turn) ? 'Mat' : 'Pat'; }
    try { return Chess.san(Chess.replay(path.slice(0, -1), _anRoot()), path[path.length - 1]).endsWith('#') ? 'Mat' : 'Pat'; }
    catch (e) { return 'Pat'; }
}

const _anSkel = n => Array.from({ length: n }, (_, i) =>
    `<div class="ab-skel-row" aria-hidden="true"><i class="ab-skel"></i><i class="ab-skel" style="width:${[80, 66, 72][i % 3]}%"></i></div>`).join('');

function _anPaintEngine() {
    const box = document.getElementById('an-engine');
    if (!box) { _anPaintEvalBar(_anShownLines().lines[0]); return; }
    const st = Engine.status(), info = Engine.info();
    const { lines, cloud } = _anShownLines();
    const [state, kind, icon] = _anEngineState(lines, cloud);
    const name = info ? `Stockfish ${info.version.split('.')[0]}` : 'Stockfish';
    const rows = lines.map((l, i) => `<div class="ab-line">
            <button type="button" class="ab-play" data-action="analysisPlayLine" data-arg="${i}" title="Jouer ${escapeHtml(_anPvText(l.pv, 1))}">
                <b class="ab-score${l.score && (l.score.mate !== undefined ? l.score.mate < 0 : l.score.cp < 0) ? ' is-black' : ''}">${escapeHtml(_anScore(l))}</b>
                <span class="ab-pv">${_anPvText(l.pv, 10, true)}</span></button>
            ${cloud ? '' : `<button type="button" class="ab-use" data-action="analysisUseLine" data-arg="${i}" title="Recopier cette variante dans le brouillon" aria-label="Utiliser cette variante">${ico('plus')}</button>`}
        </div>`).join('');
    const fin = _anFinal();
    const empty = !analysis.running ? '<p class="ab-empty">Moteur arrêté. Lancez-le pour voir les meilleurs coups.</p>'
                : analysis.paused ? '<p class="ab-empty">Calcul en pause sur cette position : « Reprendre » le relance.</p>'
                : st === 'error' ? `<div class="ab-alert"><span>Le moteur n’a pas pu démarrer (${escapeHtml(Engine.error() || 'erreur inconnue')}).</span>
                      <button type="button" class="btn btn-soft ab-btn-sm" data-action="analysisRetryEngine">${ico('rotate-ccw')} Réessayer</button></div>`
                : st === 'loading' ? `<p class="ab-empty">${appSettings.engineNet === 'full' ? 'Chargement du moteur complet…' : 'Chargement du moteur (environ 1,8 Mo la première fois)…'}</p>${_anSkel(3)}`
                : fin ? `<p class="ab-empty ab-final"><b class="ab-score is-black">${fin === 'Mat' ? '#' : '½'}</b>${fin === 'Mat' ? 'Mat' : 'Pat'} : aucun coup à calculer.</p>`
                : _anSkel(Math.max(1, appSettings.engineLines || 1));
    const on = _anOn();
    box.classList.toggle('is-paused', analysis.paused);
    box.classList.toggle('is-stale', !analysis.job && analysis.retries > 0);
    box.innerHTML = `<div class="ab-eng-h">${ico('cpu')}<b class="ab-eng-name">${escapeHtml(name)}</b>${_anChipsHTML()}
            <span class="ab-chip ${kind}" role="status">${icon ? ico(icon) : ''}${escapeHtml(state)}</span>
            <button type="button" class="ab-toggle${on ? ' is-on' : ''}" data-action="analysisToggleEngine" aria-pressed="${on}">${on ? '<i class="ab-sq" aria-hidden="true"></i>' : ico('play')}${on ? 'Arrêter' : analysis.paused ? 'Reprendre' : 'Lancer'}</button></div>
        <div class="ab-lines">${rows}${rows && on && analysis.job && lines.length < (appSettings.engineLines || 1) && !cloud ? _anSkel(1) : ''}${rows ? '' : empty}</div>`;
    _anPaintEvalBar(lines[0]);
    if (typeof renderAnnotations === 'function') renderAnnotations();
}

function _anPaintEvalBar(l) {
    const bar = document.getElementById('eval-bar');
    if (!bar) return;
    // Entre deux positions, la barre garde la dernière évaluation au lieu de se vider à chaque coup.
    if (l && analysis.running) analysis.bar = l;
    else if (_anOn() && Engine.status() !== 'error') l = analysis.bar;
    const has = !!(l && analysis.running) || !!(analysis.cloud && analysis.cloud.length);
    bar.classList.toggle('is-empty', !has);
    const w = has ? _anWin(l) : 0.5;
    bar.style.setProperty('--white', `${(w * 100).toFixed(1)}%`);
    // Chiffre court posé sur la barre (bureau) : « 0,2 », « #3 ».
    const s = has ? _anScore(l) : '';
    bar.dataset.val = /^[+−]?\d/.test(s) && s.includes(',') ? s.replace(/^[+−]/, '').replace(/(,\d)\d$/, '$1') : s.replace('−', '');
    bar.dataset.side = w < 0.5 ? 'b' : 'w';
    bar.title = has ? `Évaluation : ${s}` : '';
    bar.setAttribute('aria-label', bar.title || 'Évaluation indisponible');
}

// ─── BROUILLON ANNOTÉ ─────────────────────────────────────────────────────────

const AN_MARK_LABELS = { new: 'nouveau', same: 'déjà connu', replace: 'remplace', conflict: 'gardé' };
const AN_MARK_HINTS  = { new: 'nouveau coup, ajouté à la fusion', same: 'déjà au répertoire, identique',
                         conflict: 'votre coup enregistré est gardé, ce coup ne sera pas ajouté', replace: 'remplacera votre coup enregistré' };

// Marques du brouillon (fonction pure, sur le plan de fusion) : chemin UCI joint par « , » → 'new' | 'same' |
// 'replace' | 'conflict' (remplacement refusé dans l'aperçu). Seuls mes coups sont marqués : les coups adverses n'ouvrent que des branches. Un coup
// au-delà d'un conflit gardé, ou différent de celui retenu pour sa position, n'est pas fusionné : il n'a pas de marque.
function analysisMarks(lines, color, db, keep = new Set()) {
    const byKey = new Map(analysisMergePlan(lines, color, db, keep).items.map(i => [i.key, i])), marks = {};
    lines.forEach(path => {
        let pos = Chess.start();
        for (let i = 0; i < path.length; i++) {
            if (pos.turn === color) {
                const it = byKey.get(Chess.key(pos));
                if (!it || it.uci !== path[i]) break;
                marks[path.slice(0, i + 1).join(',')] = it.status;
                if (it.status === 'conflict') break;
            }
            pos = Chess.play(pos, path[i]);
        }
    });
    return marks;
}

// Récapitulatif d'un plan : écritures (créations + remplacements), conflits gardés, coups connus, réponses adverses nouvelles.
function analysisPlanSummary(plan, seen = {}) {
    const by = s => plan.items.filter(i => i.status === s).length;
    const fresh = by('new'), replace = by('replace');
    return { writes: fresh + replace, fresh, replace, conflict: by('conflict'), same: by('same'),
             opp: plan.opp.filter(([k, u]) => !(seen[k] || []).includes(u)).length };
}

const _pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Ligne de récapitulatif sous l'arbre : « 3 nouveaux · 1 conflit · 6 connus + 2 réponses adverses ».
function _anFuseHTML(s) {
    const part = (n, mk, one, many, hint) => n ? `<span title="${hint}"><i class="ab-mk is-${mk}" aria-hidden="true"></i>${_pl(n, one, many)}</span>` : '';
    const html = [part(s.fresh, 'new', 'nouveau', 'nouveaux', 'Coups ajoutés'), part(s.replace, 'replace', 'remplacement', 'remplacements', 'Coups qui remplaceront les vôtres'),
                  part(s.conflict, 'conflict', 'gardé', 'gardés', 'Vos coups enregistrés gardés : ces coups ne seront pas ajoutés'), part(s.same, 'same', 'connu', 'connus', 'Déjà au répertoire')].filter(Boolean).join('<span class="ab-sep" aria-hidden="true">·</span>');
    return `<p class="ab-fuse" aria-live="polite">${html || '<span>Aucun de vos coups à ajouter</span>'}${s.opp ? `<span class="ab-fuse-opp">+ ${_pl(s.opp, 'réponse adverse', 'réponses adverses')}</span>` : ''}</p>`;
}

// Bouton principal : « Ajouter au répertoire (N) », N = écritures du plan. Désactivé quand il n'y a ni écriture ni
// conflit à examiner.
function _anAddHTML(s) {
    const empty = !s.writes && !s.conflict;
    const title = empty ? 'Rien à ajouter' : s.writes ? `Voir l’aperçu : ${_pl(s.writes, 'coup', 'coups')} à enregistrer` : `Voir l’aperçu : ${_pl(s.conflict, 'coup gardé', 'coups gardés')}`;
    return `<button type="button" class="btn btn-primary ab-add" data-action="analysisOpenMerge" title="${title}"${empty ? ' disabled' : ''}>${ico('git-merge')}<span>${_anVerb(s)} au répertoire</span>${s.writes ? `<span class="ab-count" aria-label="${_pl(s.writes, 'coup', 'coups')}">${s.writes}</span>` : ''}</button>`;
}

// Verbe des boutons : « Remplacer » quand le plan ne fait que remplacer, sinon « Ajouter ».
const _anVerb = s => s.replace && !s.fresh ? 'Remplacer' : 'Ajouter';

const _anLegendHTML = () => `<div class="ab-legend" aria-hidden="true">${Object.entries(AN_MARK_LABELS).map(([k, v]) => `<span><i class="ab-mk is-${k}"></i>${v}</span>`).join('')}</div>`;

function _anDraftHTML() {
    if (analysis.start) return _anSetupDraftHTML();
    const leaves = _anLeaves(), n = _anCount();
    const marks = analysisMarks(leaves, analysis.color, openingDB);
    const sum = analysisPlanSummary(analysisMergePlan(leaves, analysis.color, openingDB), typeof oppSeen !== 'undefined' ? oppSeen : {});
    const tree = _anTreeHTML(marks, _anOutMap());
    const here = _displayedPath(), st = _anRepState(here);
    const badge = st.out < 0 ? '<span class="vbadge is-brass">Dans le répertoire</span>'
                             : `<span class="vbadge is-muted is-dashed" title="Hors répertoire depuis ${escapeHtml(_anPlyText(here, st.out))}">Hors répertoire · ${escapeHtml(_anPlyText(here, st.out))}</span>`;
    // Les coups déjà dessinés ne repassent pas en fondu.
    const paths = []; (function walk(nd, p) { nd.kids.forEach(k => { const q = p.concat(k.uci); paths.push(q.join(',')); walk(k, q); }); })(analysis.tree, []);
    analysis.seen = new Set(paths);
    return `${_anToastHTML()}<div class="ab-card ab-draft">
        <div class="ab-h"><b>Brouillon</b>${badge}<small>${_pl(n, 'coup', 'coups')}</small>
            ${n ? `<button type="button" class="ab-ghost" data-action="discardAnalysis" title="Effacer le brouillon et revenir à Jouer">${ico('trash')}<span>Abandonner</span></button>` : ''}</div>
        <div class="ab-tree" id="an-moves">${tree}</div>
        ${n ? `${_anFuseHTML(sum)}${_anLegendHTML()}` : '<p class="ab-empty">Jouez les deux camps sur l’échiquier, ou recopiez une ligne du moteur avec « + ».</p>'}
        ${_anAddHTML(sum)}</div>`;
}

// Brouillon d'une position posée (éditeur) : l'arbre seul, sans marques ni fusion ; le répertoire n'accueille que des
// lignes jouées depuis le début. « Modifier la position » rouvre l'éditeur sur la position de départ.
function _anSetupDraftHTML() {
    const n = _anCount();
    analysis.seen = null;
    return `<div class="ab-card ab-draft">
        <div class="ab-h"><b>Brouillon</b><span class="vbadge is-muted is-dashed">position posée</span><small>${_pl(n, 'coup', 'coups')}</small>
            ${n ? `<button type="button" class="ab-ghost" data-action="discardAnalysis" title="Effacer le brouillon">${ico('trash')}<span>Abandonner</span></button>` : ''}</div>
        <div class="ab-tree" id="an-moves">${_anTreeHTML({}, new Map())}</div>
        <p class="ab-empty ab-setup-note">Ligne jouée depuis une position posée : elle ne peut pas rejoindre le répertoire, qui part du début.</p>
        <button type="button" class="btn btn-soft ab-setup-edit" data-action="analysisEditSetup">${ico('pencil')}<span>Modifier la position</span></button></div>`;
}

// Bandeau au-dessus du brouillon : brouillon repris, ou dernière fusion (annulable).
function _anToastHTML() {
    const m = analysis.lastMerge;
    if (m) {
        const n = m.added.length, gone = m.replacedSans || [];
        const text = gone.length ? `${_pl(n, 'coup ajouté', 'coups ajoutés')} · ${gone.map(s => formatSan(s, analysis.color)).join(', ')} ${gone.length > 1 ? 'sont' : 'est'} dans la corbeille`
                                 : `${_pl(n, 'coup ajouté', 'coups ajoutés')} à « ${escapeHtml(analysis.rep)} » · à réviser à la prochaine séance`;
        return `<div class="ab-toast is-ok" role="status">${ico('check')}<span>${text}</span>
            ${m.noUndo ? '<button type="button" class="ab-link" data-action="analysisShowTrash">Corbeille</button>' : '<button type="button" class="ab-link" data-action="analysisUndoMerge">Annuler</button>'}</div>`;
    }
    if (analysis.resumed) return `<div class="ab-toast" role="status">${ico('git-branch')}<span>Brouillon de la session repris · ${_pl(_anCount(), 'coup', 'coups')}</span>
            <button type="button" class="ab-link" data-action="discardAnalysis">Abandonner</button></div>`;
    return '';
}

// Coups du brouillon hors répertoire : chemin joint par « , » → 'exit' (le premier de sa ligne) ou 'out'.
function _anOutMap() {
    const out = new Map(), db = openingDB, opp = typeof oppSeen !== 'undefined' ? oppSeen : {};
    (function walk(node, pos, path, gone) {
        node.kids.forEach(c => {
            const p = path.concat(c.uci), k = Chess.key(pos), next = Chess.play(pos, c.uci);
            const inside = !gone && (pos.turn === analysis.color ? !!db[k] && db[k].move === c.uci
                                                                  : !!db[Chess.key(next)] || (opp[k] || []).includes(c.uci));
            if (!inside) out.set(p.join(','), gone ? 'out' : 'exit');
            walk(c, next, p, gone || !inside);
        });
    })(analysis.tree, Chess.start(), [], false);
    return out;
}

// Arbre du brouillon en notation : ligne principale, branches adverses entre parenthèses ; position affichée surlignée ;
// coups hors répertoire en pointillé (outs : _anOutMap).
function _anTreeHTML(marks = {}, outs = new Map()) {
    const cur = _displayedPath().join(','), out = [];
    function line(node, path, ply, forceNum) {
        let kids = node.kids, first = true;
        while (kids.length) {
            const [main, ...alts] = kids;
            out.push(_anMoveHTML(main, path.concat(main.uci), ply, first || forceNum, cur, marks, outs));
            alts.forEach(a => {
                out.push('<span class="ab-var">(');
                out.push(_anMoveHTML(a, path.concat(a.uci), ply, true, cur, marks, outs));
                line(a, path.concat(a.uci), ply + 1, false);
                out.push(')</span>');
            });
            path = path.concat(main.uci);
            node = main; kids = node.kids; ply++;
            first = false; forceNum = alts.length > 0;
        }
    }
    line(analysis.tree, [], _anPly0(), true);
    return out.join(' ').replace(/\( </g, '(<').replace(/ \)<\/span>/g, ')</span>') || '<span class="ab-empty">Aucun coup</span>';
}

function _anMoveHTML(node, path, ply, num, cur, marks = {}, outs = new Map()) {
    const side = ply % 2 === 0 ? 'w' : 'b', n = Math.floor(ply / 2) + 1;
    const pre = side === 'w' ? `${n}.` : num ? `${n}…` : '';
    const p = path.join(','), mk = marks[p];
    const fresh = analysis.seen && !analysis.seen.has(p);
    const o = outs.get(p);
    const cls = `ab-mv${p === cur ? ' is-cur' : ''}${side === analysis.color ? '' : ' is-opp'}${fresh ? ' is-fresh' : ''}${o ? ' is-out' : ''}${o === 'exit' ? ' is-exit' : ''}`;
    const label = `${pre ? pre + ' ' : ''}${formatSanText(node.san, side)}${mk ? `, ${AN_MARK_HINTS[mk]}` : ''}${o === 'exit' ? ', sortie du répertoire' : ''}`;
    const btn = `<button type="button" class="${cls}" data-action="analysisGo" data-arg="${p}" aria-label="${escapeHtml(label)}"${p === cur ? ' aria-current="true"' : ''}>${pre ? `<span class="ab-n">${pre}</span>` : ''}${formatSan(node.san, side)}${mk && mk !== 'conflict' && mk !== 'replace' ? `<i class="ab-mk is-${mk}" aria-hidden="true"></i>` : ''}</button>`;
    if (mk !== 'conflict' && mk !== 'replace') return btn;
    // Losange (rouge : remplace, ambre : gardé) : un toucher ouvre l'aperçu de fusion sur ce coup.
    const key = Chess.key(Chess.replay(path.slice(0, -1)));
    const what = mk === 'replace' ? 'Remplace votre coup enregistré' : 'Votre coup enregistré est gardé';
    return `<span class="ab-mvw">${btn}<button type="button" class="ab-mk-btn" data-action="analysisOpenConflict" data-arg="${escapeHtml(key)}" title="${what} : voir l’aperçu" aria-label="${what} (${escapeHtml(formatSanText(node.san, side))}) : ouvrir l’aperçu de fusion"><i class="ab-mk is-${mk}" aria-hidden="true"></i></button></span>`;
}

// ─── FUSION DANS LE RÉPERTOIRE ────────────────────────────────────────────────

// Plan de fusion (fonction pure) : lignes = chemins UCI depuis le début ; color = mon camp ; db = base visée.
// keep : Set des positions où mon coup enregistré est gardé (« Remplacer » décoché) ; ailleurs, un coup différent le remplace.
// Renvoie { items: [{ key, uci, san, path, status: 'new' | 'same' | 'conflict' | 'replace', keptSan }], opp: [[clé, uci]] }.
function analysisMergePlan(lines, color, db, keep = new Set()) {
    const items = new Map(), opp = new Map();
    lines.forEach(path => {
        let pos = Chess.start();
        for (let i = 0; i < path.length; i++) {
            const uci = path[i], key = Chess.key(pos);
            if (pos.turn === color) {
                const e = db[key], san = Chess.san(pos, uci);
                const status = !e ? 'new' : e.move === uci ? 'same' : keep.has(key) ? 'conflict' : 'replace';
                if (!items.has(key)) items.set(key, { key, uci, san, path: path.slice(0, i + 1), status, keptSan: e ? e.san : null });
                const planned = items.get(key);
                if (planned.uci !== uci || status === 'conflict') break;     // la suite dépend d'un autre coup que celui retenu
            } else if (!opp.has(key + uci)) opp.set(key + uci, [key, uci]);
            pos = Chess.play(pos, uci);
        }
    });
    return { items: [...items.values()], opp: [...opp.values()] };
}

const _anPlan = () => analysisMergePlan(analysis.merge && !analysis.merge.all ? [_anLine()] : _anLeaves(), analysis.color, openingDB,
                                        analysis.merge ? analysis.merge.keep : new Set());

// Coups du répertoire devenus inaccessibles une fois le plan écrit (suite d'un coup remplacé) : mis à la corbeille avec
// lui seulement si « Avec sa suite » est coché (décoché par défaut : elle peut compter des centaines de coups ; Jouer
// pose la même question).
function _anOrphans(plan) {
    const todo = plan.items.filter(i => i.status === 'new' || i.status === 'replace');
    if (!todo.some(i => i.status === 'replace') || typeof _reachableKeys !== 'function') return [];
    const ctx = { cache: new Map(), roots: null }, before = _reachableKeys(ctx, openingDB), hypo = Object.assign({}, openingDB);
    todo.forEach(i => { hypo[i.key] = Object.assign({}, openingDB[i.key] || {}, { move: i.uci }); });
    const after = _reachableKeys(ctx, hypo), mine = new Set(todo.map(i => i.key));
    return [...before].filter(k => !after.has(k) && !mine.has(k));
}

// Fin d'une ligne en notation (HTML) : « … 6. Fe3 e5 7. Cb3 <b>Fe6</b> », mon coup en gras.
function _anTailHTML(path, keep = 4) {
    const sans = _pathToSans(path), from = Math.max(0, sans.length - keep);
    let out = from ? '… ' : '';
    for (let i = from; i < sans.length; i++) {
        const side = i % 2 ? 'b' : 'w', n = Math.floor(i / 2) + 1;
        if (side === 'w') out += `${n}. `; else if (i === from) out += `${n}… `;
        const san = formatSan(sans[i], side);
        out += (i === sans.length - 1 ? `<b>${san}</b>` : san) + ' ';
    }
    return out.trim();
}

// Aperçu de fusion : rien n'est écrit avant « Ajouter N coups ».
function _anPreviewHTML() {
    const plan = _anPlan(), s = analysisPlanSummary(plan, typeof oppSeen !== 'undefined' ? oppSeen : {}), m = analysis.merge;
    const side = analysis.color === 'w' ? 'Blancs' : 'Noirs';
    const row = it => {
        const kept = it.keptSan ? formatSan(it.keptSan, analysis.color) : '';
        const tag = { new: '<span class="vbadge is-new">nouveau</span>',
                      conflict: `<span class="vbadge is-warn">vous : ${kept}</span>`,
                      replace: `<span class="vbadge is-err">remplace ${kept}</span>` }[it.status];
        const sw = it.status === 'conflict' || it.status === 'replace'
            ? `<label class="ab-switch"><input type="checkbox" role="switch" data-action="analysisToggleReplace" data-arg="${escapeHtml(it.key)}"${it.status === 'replace' ? ' checked' : ''}><span class="ab-sw" aria-hidden="true"></span>Remplacer</label>` : '';
        return `<li class="is-${it.status}${m.focus === it.key ? ' is-focus' : ''}" data-key="${escapeHtml(it.key)}"><i class="ab-mk is-${it.status}" aria-hidden="true"></i>
            <span class="ab-pl-line">${_anTailHTML(it.path)}</span>${tag}${sw}</li>`;
    };
    const rows = plan.items.filter(i => i.status !== 'same');
    const gone = plan.items.filter(i => i.status === 'replace').map(i => formatSan(i.keptSan, analysis.color));
    const orphans = _anOrphans(plan);
    const cell = (n, label, cls = '') => `<div><b class="${cls}">${n}</b><small>${label}</small></div>`;
    const busy = analysis.merging;
    return `<div class="ab-card ab-preview" role="region" aria-label="Aperçu de fusion">
        <div class="ab-pv-h"><div><span class="ab-over">Ajouter au répertoire</span><b>${escapeHtml(analysis.rep)} · ${side}</b></div>
            <button type="button" class="ab-icon" data-action="analysisCloseMerge" aria-label="Fermer l’aperçu" title="Fermer l’aperçu">${ico('x')}</button></div>
        <div class="ab-seg" role="radiogroup" aria-label="Lignes à fusionner">
            <button type="button" role="radio" aria-checked="${!m.all}" class="${m.all ? '' : 'is-on'}" data-action="analysisMergeScope" data-arg="line">Ligne affichée</button>
            <button type="button" role="radio" aria-checked="${m.all}" class="${m.all ? 'is-on' : ''}" data-action="analysisMergeScope" data-arg="all">Toutes les branches</button></div>
        <div class="ab-sum">${cell(s.fresh, _pl(s.fresh, 'nouveau', 'nouveaux').replace(/^\d+ /, ''), 'is-new')}${s.replace ? cell(s.replace, 'remplace', 'is-err') : cell(s.conflict, s.conflict > 1 ? 'gardés' : 'gardé', 'is-warn')}${cell(s.same, s.same > 1 ? 'connus' : 'connu')}${cell(s.opp, s.opp > 1 ? 'adverses' : 'adverse', 'is-muted')}</div>
        <ul class="ab-plan">${rows.map(row).join('') || '<li class="ab-plan-empty">Rien de nouveau : vos coups de ces lignes sont déjà au répertoire.</li>'}</ul>
        <p class="ab-note">${gone.length ? `${ico('trash')}<span>${gone.join(', ')} ira à la corbeille (30 jours).</span>`
                                         : s.conflict ? '<span>Un coup gardé arrête la ligne : recochez « Remplacer » pour l’enregistrer.</span>' : ''}</p>
        ${orphans.length ? `<label class="ab-switch ab-cascade"><input type="checkbox" role="switch" data-action="analysisToggleCascade"${m.cascade ? ' checked' : ''}><span class="ab-sw" aria-hidden="true"></span>Avec sa suite : ${_pl(orphans.length, 'coup qui n’est plus jouable', 'coups qui ne sont plus jouables')}</label>` : ''}
        <div class="ab-actions">
            <button type="button" class="btn" data-action="analysisCloseMerge">Retour</button>
            <button type="button" class="btn btn-primary ab-confirm" id="an-confirm" data-action="analysisConfirmMerge"${s.writes && !busy ? '' : ' disabled'}${busy ? ' aria-busy="true"' : ''}${s.writes ? '' : ' title="Rien à ajouter"'}>${ico('check')}<span>${_anVerb(s)} ${_pl(s.writes, 'coup', 'coups')}</span></button></div></div>`;
}

// Conflit choisi depuis l'arbre : sa ligne est surlignée et son interrupteur reçoit le focus.
function _anFocusConflict(box) {
    const key = analysis.merge && analysis.merge.focus;
    if (!key) return;
    const li = [...box.querySelectorAll('.ab-plan li')].find(l => l.dataset.key === key);
    if (!li) return;
    _anRevealInPanel(li);
    const input = li.querySelector('input');
    if (input) input.focus({ preventScroll: true });
}

function analysisOpenMerge(focus) {
    analysis.merge = { all: true, keep: new Set(), cascade: false, focus: focus || null };
    if (typeof setSheetOpen === 'function') setSheetOpen(true);
    setStatus('Aperçu de fusion', 'new', 'Rien n’est écrit avant la confirmation.');
    renderAnalysisPanel();
}

function analysisCloseMerge() {
    analysis.merge = null;
    if (typeof setSheetOpen === 'function') setSheetOpen(false);
    _anRepStatus();
    renderAnalysisPanel();
}

function analysisConfirmMerge() {
    if (analysis.merging || !analysis.merge) return;
    const plan = _anPlan();
    if (!plan.items.some(i => i.status === 'new' || i.status === 'replace')) return;
    // Fusion en cours : bouton occupé le temps d'une image, puis écriture.
    analysis.merging = true;
    const btn = document.getElementById('an-confirm');
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
    const box = document.getElementById('analysis-panel');
    if (box) box.setAttribute('aria-busy', 'true');
    const orphans = analysis.merge.cascade ? _anOrphans(plan) : [];
    setTimeout(() => { analysis.merging = false; _anWrite(plan, orphans); }, 0);
}

function _anWrite(plan, orphans = []) {
    const added = [], todo = plan.items.filter(i => i.status === 'new' || i.status === 'replace');
    const replacedItems = todo.filter(i => i.status === 'replace'), replaced = replacedItems.map(i => i.key);
    if (replaced.length && !trashEntries(replaced.concat(orphans), 'remplacé depuis l’Analyse')) {
        setStatus('Fusion impossible', 'err', 'La corbeille n’a pas pu accueillir les coups remplacés : rien n’a été modifié.');
        renderAnalysisPanel();
        return;
    }
    orphans.forEach(k => { delete openingDB[k]; });
    todo.forEach(i => { openingDB[i.key] = newEntry(i.uci, i.san, i.path); added.push(i.key); });
    const oppAdded = plan.opp.filter(([k, u]) => recordOppReply(k, u));
    saveDB();
    if (oppAdded.length) saveOpp();
    noteChange(added.length);
    // Un remplacement s'annule depuis la corbeille.
    analysis.lastMerge = { added, opp: oppAdded, noUndo: replaced.length > 0, replacedSans: replacedItems.map(i => i.keptSan) };
    analysis.merge = null;
    analysis.dirty = false;
    analysis.resumed = false;
    _anClearDraft();
    if (typeof setSheetOpen === 'function') setSheetOpen(false);
    setStatus(`${_pl(added.length, 'coup enregistré', 'coups enregistrés')} au répertoire`, 'new',
        'À réviser dès la prochaine séance d’Entraînement.' + (replaced.length ? ` Les coups remplacés${orphans.length ? ' et leur suite' : ''} sont dans la corbeille.` : ''));
    renderAnalysisPanel();
}

function analysisUndoMerge() {
    const m = analysis.lastMerge;
    if (!m) return;
    if (m.noUndo) { setStatus('Annulation impossible ici', 'info', 'Un coup a été remplacé : restaurez-le depuis la corbeille.'); return; }
    m.added.forEach(k => { delete openingDB[k]; });
    m.opp.forEach(([k, u]) => { if (oppSeen[k]) { oppSeen[k] = oppSeen[k].filter(x => x !== u); if (!oppSeen[k].length) delete oppSeen[k]; } });
    saveDB();
    if (m.opp.length) saveOpp();
    analysis.lastMerge = null;
    analysis.dirty = true;
    _anSaveDraft();
    setStatus('Ajout annulé', 'info', 'Le répertoire est revenu à son état précédent ; le brouillon est conservé.');
    renderAnalysisPanel();
}

registerActions({
    analysisGo, analysisUseLine, analysisPlayLine, analysisEditMove, analysisToggleEngine, discardAnalysis, analysisConfirmMerge, analysisUndoMerge,
    analysisCloseMerge,
    analysisOpenMerge: () => analysisOpenMerge(),
    analysisOpenConflict: key => analysisOpenMerge(key),
    analysisMergeScope: arg => { if (analysis.merge) { analysis.merge.all = arg === 'all'; renderAnalysisPanel(); } },
    analysisToggleReplace: key => {
        if (!analysis.merge) return;
        const r = analysis.merge.keep;
        if (r.has(key)) r.delete(key); else r.add(key);
        analysis.merge.focus = key;
        renderAnalysisPanel();
    },
    analysisToggleCascade: () => { if (analysis.merge) { analysis.merge.cascade = !analysis.merge.cascade; renderAnalysisPanel(); } },
    analysisEngineSettings: () => { if (typeof showSettings === 'function') showSettings('moteur'); },
    analysisRetryEngine: () => { if (typeof Engine.reload === 'function') Engine.reload(); analysisSettingsChanged(); },
    analysisShowTrash: () => { if (typeof showTrash === 'function') showTrash(); }
});

if (typeof Engine !== 'undefined') Engine.onStatus(() => { if (gameMode === 'analysis') _anPaintEngine(); });

// Retour au premier plan : le calcul arrêté par la mise en arrière-plan reprend s'il n'avait pas atteint sa limite,
// sans effacer les lignes affichées (elles sont remplacées dès que le moteur parle).
document.addEventListener('visibilitychange', () => {
    if (document.hidden || gameMode !== 'analysis' || !_anOn() || analysis.job) return;
    const l = analysis.lines[0], limit = appSettings.engineDepth || Infinity;
    if (l && l.depth >= limit) return;
    analysis.retries = 0;
    clearTimeout(analysis.wait);
    _anLaunch(analysis.fen);
});

GameModes.register('analysis', {
    playsBothSides: true,
    inputBlocked: () => typeof WhatIf !== 'undefined' && WhatIf.thinking(),   // « Et si » : le moteur joue
    onMove: (from, to, promo) => analysisMove(from, to, promo),      // brouillon : rien n'est vérifié ni enregistré
    onNavigate: () => analysisPositionChanged(),
    engineArrows: () => analysisArrowList(),
    // Barre unique (R3) : au milieu, « Ajouter (N) » du brouillon, puis dans l'aperçu la confirmation. Calculé sur le
    // brouillon, jamais recopié d'un bouton du panneau (il disparaît quand l'aperçu s'ouvre).
    center: () => {
        if (analysis.start || (typeof WhatIf !== 'undefined' && WhatIf.active())) return null;
        const opp = typeof oppSeen !== 'undefined' ? oppSeen : {};
        if (analysis.merge) {
            const s = analysisPlanSummary(_anPlan(), opp);
            return { icon: 'check', label: `${_anVerb(s)} (${s.writes})`, title: s.writes ? `${_anVerb(s)} ${_pl(s.writes, 'coup', 'coups')} au répertoire` : 'Rien à ajouter',
                     disabled: !s.writes || analysis.merging, run: analysisConfirmMerge };
        }
        const s = analysisPlanSummary(analysisMergePlan(_anLeaves(), analysis.color, openingDB), opp);
        return { icon: 'git-merge', label: s.writes ? `${_anVerb(s)} (${s.writes})` : 'Ajouter', soft: true,
                 title: s.writes ? `Voir l’aperçu : ${_pl(s.writes, 'coup', 'coups')} à enregistrer` : 'Rien à ajouter',
                 disabled: !s.writes && !s.conflict, run: () => analysisOpenMerge() };
    }
});
