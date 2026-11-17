/**
 * screens/analysis/whatIf.js
 * ──────────────────────────────────────────────────────────────────────────
 * « Et si » sur mes parties (atelier « L'envie de revenir », lot 6) : depuis une ligne coûteuse de Statistiques › Parties
 * où j'ai quitté le répertoire, l'Analyse s'ouvre après le coup du répertoire et le moteur joue l'adversaire, bridé à
 * mon niveau (GameArchive.level, 1500 sans partie classée). L'évaluation reste cachée tant que l'on joue ; « Revoir avec
 * le moteur » rend l'Analyse habituelle sur la partie jouée. Rien n'est écrit dans le répertoire : la position de la
 * déviation est déjà comptée en erreur à la relecture des parties, donc déjà dans la révision.
 * Force : profondeur et choix parmi les 4 meilleurs coups, pondérés par exp(écart / température) ; plus l'Elo est bas,
 * moins la recherche est profonde et plus la température est haute (strength).
 */

'use strict';

const WhatIf = (function () {
    const st = { on: false, color: 'w', elo: 1500, job: null, from: 0, over: '' };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function strength(elo) {
        return { depth: clamp(Math.round(elo / 200) - 3, 2, 12), temp: clamp((2600 - elo) / 8, 15, 200) };
    }

    // Score d'une ligne du point de vue du camp au trait (le moteur parle pour les Blancs).
    const forMover = (l, white) => {
        const s = l.score || {}, v = s.mate !== undefined ? Math.sign(s.mate) * (10000 - 10 * Math.abs(s.mate)) : (s.cp || 0);
        return white ? v : -v;
    };

    // Coup choisi parmi les lignes du moteur ; rnd pour les tests.
    function pick(lines, white, elo, rnd = Math.random) {
        const ok = (lines || []).filter(l => l && l.pv && l.pv.length);
        if (!ok.length) return null;
        const { temp } = strength(elo), best = Math.max(...ok.map(l => forMover(l, white)));
        const w = ok.map(l => Math.exp((forMover(l, white) - best) / temp));
        let r = rnd() * w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < ok.length; i++) { r -= w[i]; if (r <= 0) return ok[i].pv[0]; }
        return ok[ok.length - 1].pv[0];
    }

    function start({ path, color, elo, back }) {
        st.color = color; st.elo = elo || 1500; st.from = path.length; st.over = '';
        playerColor = color;
        openAnalysis(path.slice(), path.length - 1, back);
        st.on = true;
        analysis.running = false;
        if (analysis.job) { analysis.job.stop(); analysis.job = null; }
        clearTimeout(analysis.wait);
        setStatus('Et si…', 'info', `Vous jouez le coup du répertoire ; le moteur répond à ~${st.elo} Elo.`);
        renderAnalysisPanel();
        if (turn !== color) reply();
    }

    function reply() {
        if (!st.on || st.job) return;
        const fen = displayedFen(), pos = Chess.fromFen(fen);
        if (!Chess.legalMoves(pos).length) { st.over = 'Partie terminée'; renderAnalysisPanel(); return; }
        const { depth } = strength(st.elo);
        let last = [];
        const job = st.job = Engine.analyse(fen, { multipv: 4, depth, movetime: 1500 }, lines => { last = lines; });
        renderAnalysisPanel();
        job.done.then(() => {
            if (st.job !== job) return;
            st.job = null;
            if (!st.on || gameMode !== 'analysis' || displayedFen() !== fen) { renderAnalysisPanel(); return; }
            const u = pick(last, pos.turn === 'w', st.elo);
            if (!u) { st.over = 'Le moteur ne répond pas'; renderAnalysisPanel(); return; }
            const m = _parseUci(u);
            animateNextMove(m.from, m.to);
            analysisMove(m.from, m.to, m.promo ? m.promo.toUpperCase() : null);
        });
    }

    // Appelé par analysisMove : au tour du moteur, il répond.
    function afterMove() {
        if (!st.on) return;
        if (turn !== st.color) reply();
        else if (!Chess.legalMoves(Chess.fromFen(displayedFen())).length) st.over = 'Partie terminée';
    }

    function stop() {
        st.on = false;
        if (st.job) { st.job.stop(); st.job = null; }
    }

    // « Revoir avec le moteur » : l'Analyse habituelle, évaluation comprise, sur la partie jouée.
    function release() {
        stop();
        analysis.running = true;
        analysis.paused = false;
        analysis.fen = '';
        analysisPositionChanged();
    }

    function cardHTML() {
        if (!st.on) return '';
        const plies = Math.max(0, _anLine().length - st.from);
        const state = st.over || (st.job ? 'Le moteur réfléchit…' : turn === st.color ? 'À vous de jouer' : '');
        return `<div class="ab-card wi-card"><span class="st-eyebrow">Et si…</span>
            <b>Contre le moteur bridé à ~${st.elo} Elo</b>
            <small>${escapeHtml(state)}${plies ? ` · ${_plural(plies, 'demi-coup joué', 'demi-coups joués')} depuis votre partie` : ''}</small>
            <button type="button" class="btn btn-soft" data-action="whatIfRelease">${ico('cpu')}Revoir avec le moteur</button></div>`;
    }

    registerActions({ whatIfRelease: release });

    return { strength, pick, start, afterMove, stop, release, cardHTML, active: () => st.on, thinking: () => st.on && !!st.job };
})();
