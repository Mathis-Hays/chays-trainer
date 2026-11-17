/**
 * screens/training/clubMatch.js
 * ──────────────────────────────────────────────────────────────────────────
 * Adversaire du club (atelier « L'envie de revenir », lot 6) : une séance de l'Entraînement (kind 'club') où je joue
 * ma ligne depuis le début contre un adversaire qui choisit les coups réellement joués à mon niveau, jusqu'à sortir
 * du répertoire. Chaque coup compte comme une révision ; la première erreur arrête la partie.
 * Coups adverses, dans l'ordre : explorateur Lichess à mes tranches d'Elo (fetchExplorer, jeton requis), sinon mes
 * propres parties (_freqTable, 3 au moins), sinon les branches de mon répertoire (_pickOppContinuation).
 * Tirage pondéré par le nombre de parties ; les coups joués moins de MIN_SHARE du temps sont écartés.
 * Fin : erreur, coup adverse sans réponse (noté dans oppSeen : il apparaît en ambre dans l'explorateur des Ouvertures,
 * « Ajouter une réponse » au bilan), ou plus aucun coup adverse connu. Score : coups trouvés du premier coup.
 */

'use strict';

const ClubMatch = (function () {
    const MIN_SHARE = 0.02, END_MS = 1800;
    const SOURCE = { lichess: 'à votre niveau sur Lichess', games: 'dans vos parties', repertoire: 'une branche de votre répertoire' };

    const elo = () => { const l = typeof GameArchive !== 'undefined' ? GameArchive.level() : null; return l ? l.r : null; };
    const hasToken = () => typeof explorerToken === 'function' && !!explorerToken();

    function start(color) {
        return startSession({ kind: 'club', label: 'Adversaire du club', line: { color, path: [], name: 'Adversaire du club' }, colors: [color] });
    }

    // Premier coup de la séance (appelé par _nextSessionDrill) ; false si le répertoire ne part pas du début.
    function begin() {
        const S = trainingState.session;
        S.club = { color: playerColor, elo: elo(), source: null, end: null, exit: null };
        trainingState.reason = 'Adversaire du club';
        trainingState.seq = { len: TRAIN_SEQ_END, done: 0, assisted: false };
        trainingState.solutionFor = null;
        trainingState.busy = true;
        resetNavCursor();
        loadPositionFromPath([]);
        trainingState.current = trainingState.lastKey = positionKey();
        if (playerColor === 'w') {
            if (!openingDB[trainingState.current]) return false;
            _later(_drillReady, 300);
            return true;
        }
        setStatus('Adversaire du club', 'info', 'Il ouvre la partie…');
        next([]);
        return true;
    }

    // Coups adverses connus dans la position (adversaire au trait) : [[uci, parties]] et leur source.
    async function candidates(line) {
        const pos = Chess.replay(line), key = Chess.key(pos), legal = new Set(Chess.legalMoves(pos));
        const keep = list => (list || []).filter(([u, n]) => legal.has(u) && n > 0);
        if (hasToken() && typeof fetchExplorer === 'function') {
            try { const m = keep(await fetchExplorer(key)); if (m.length) return { key, moves: m, source: 'lichess' }; } catch (e) { /* hors ligne, jeton refusé : on passe à la suite */ }
        }
        const own = typeof _freqTable === 'function' ? _freqTable(playerColor)[key] : null, mine = keep(own ? Object.entries(own) : []);
        if (mine.reduce((s, m) => s + m[1], 0) >= 3) return { key, moves: mine, source: 'games' };
        const u = _pickOppContinuation(line);
        return { key, moves: u ? [[u, 1]] : [], source: 'repertoire' };
    }

    // Tirage pondéré, sans les coups trop rares. rnd : pour les tests.
    function choose(moves, rnd = Math.random) {
        const total = moves.reduce((s, m) => s + m[1], 0);
        const list = moves.filter(m => m[1] / total >= MIN_SHARE);
        if (!list.length) return null;
        let r = rnd() * list.reduce((s, m) => s + m[1], 0);
        for (const m of list) { r -= m[1]; if (r <= 0) return { uci: m[0], share: m[1] / total }; }
        const last = list[list.length - 1];
        return { uci: last[0], share: last[1] / total };
    }

    async function next(line) {
        const S = trainingState.session;
        trainingState.busy = true;
        const c = await candidates(line);
        if (trainingState.session !== S || gameMode !== 'training') return;
        const pick = c.moves.length ? choose(c.moves) : null;
        if (!pick) { finish('prep'); return; }
        S.club.source = c.source;
        play(Object.assign(pick, { source: c.source, key: c.key }), line);
    }

    const shareText = p => p.source === 'repertoire' ? SOURCE.repertoire : `joué ${Math.round(100 * p.share)} % du temps ${SOURCE[p.source]}`;

    function play(p, line) {
        const S = trainingState.session;
        _later(() => {
            if (trainingState.session !== S) return;
            const m = _parseUci(p.uci), san = formatSanText(toAlgebraic(m.from, m.to, m.promo), turn);
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
                setStatus(`Adversaire : ${san}`, 'info', `${shareText(p)} · à vous de jouer`);
                return;
            }
            // Sortie du répertoire : le coup est noté comme réponse adverse connue (ambre dans l'explorateur).
            if (recordOppReply(p.key, p.uci)) saveOpp();
            S.club.exit = { san, share: p.share, source: p.source, path: line.concat(p.uci), ply: line.length + 1 };
            finish('hole', `${san} · ${shareText(p)} · Pas de réponse dans votre répertoire`);
        }, opponentDelay(TRAIN_STEP_MS));
    }

    // why : 'mistake' | 'hole' | 'prep'.
    function finish(why, detail) {
        const S = trainingState.session;
        if (!S || S.club.end) return;
        S.club.end = why;
        trainingState.busy = true;
        if (why === 'hole') setStatus('Sortie du répertoire', 'ok', detail);
        if (why === 'prep') setStatus('Fin de votre préparation', 'ok', 'Plus aucun coup adverse connu ici.');
        _later(() => { if (trainingState.session === S) _endSession(); }, why === 'mistake' ? END_MS + 600 : END_MS);
    }

    const stopText = entry => `La partie s’arrête ici · Votre coup du répertoire : ${formatSanText(entry.san, playerColor)}`;

    // Bilan : profondeur, adversaire, sortie et « Ajouter une réponse ».
    function summaryHTML(s) {
        const c = s.club;
        if (!c) return '';
        const lvl = c.elo ? `à ~${c.elo} Elo` : 'à votre niveau';
        const src = c.source === 'lichess' ? `Coups des joueurs de Lichess ${lvl}` : c.source === 'games' ? 'Coups de vos adversaires réels' : 'Branches de votre répertoire';
        const end = c.end === 'mistake' ? 'Arrêtée sur une erreur' : c.end === 'prep' ? 'Fin de votre préparation' : c.end === 'hole' ? 'Sortie du répertoire' : 'Partie interrompue';
        const exit = c.exit ? `<div class="trr-club-exit"><span>${escapeHtml(c.exit.san)} · ${escapeHtml(shareText(c.exit))} · Sans réponse</span>
            <button type="button" class="btn btn-soft" data-action="trainingClubAdd">${ico('plus')}Ajouter une réponse</button></div>` : '';
        return `<div class="trr-club"><span class="st-eyebrow">${escapeHtml(end)}</span><b>${_plural(s.ok, 'coup trouvé', 'coups trouvés')} du premier coup</b><small>${escapeHtml(src)}${!hasToken() && c.source !== 'lichess' ? ' · Paramètres › Jeu : jeton Lichess pour jouer contre les coups de Lichess' : ''}</small>${exit}</div>`;
    }

    registerActions({
        trainingClubAdd: () => {
            const s = trainingState.lastSummary, c = s && s.club;
            if (!c || !c.exit) return;
            playerColor = c.color;
            openAnalysis(c.exit.path.slice(), c.exit.path.length - 1, _trBackToTraining);
        }
    });

    return { MIN_SHARE, start, begin, next, choose, candidates, finish, stopText, summaryHTML, hasToken, elo };
})();
