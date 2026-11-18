/**
 * domain/games/gameEval.js
 * ──────────────────────────────────────────────────────────────────────────
 * Évalue les parties sans évaluations (toutes celles de Chess.com, les parties Lichess non analysées) avec Stockfish, coup par coup.
 *   GameEval.pending(parties, d'abord?)   parties à évaluer : celles qui passent d'abord(partie) en tête (la période affichée),
 *                                         puis Chess.com, les plus récentes en tête.
 *   GameEval.run(parties, { shouldRun, first, onGame, onSaved })   une seule exécution à la fois ; s'arrête dès que shouldRun()
 *                                         est faux ou que le moteur est repris par un autre calcul.
 *   GameEval.divide(pièces)     limites [milieu, finale] d'une partie d'après le nombre de pièces (hors rois et pions) après chaque demi-coup.
 *   GameEval.refineList(ev, profond)      demi-coups à recalculer en profondeur : les deux positions de chaque coup qui coûte.
 * Deux passes (chantier « Progrès : qualité et médailles », point 1, option B) : profondeur FAST partout, puis DEPTH seulement
 *   autour des coups dont la perte atteint REFINE points de pourcentage de gain (une imprécision), jusqu'à ce que plus rien ne change.
 * Ouverture (option C) : les MAX_PLY premiers demi-coups viennent du cache durable (EvalCache), sinon du nuage de Lichess
 *   (requêtes enchaînées pendant que le moteur calcule, jusqu'à la première position absente), sinon du moteur ; rangés pour les parties suivantes.
 * Résultat écrit sur la partie : ev (centipions du point de vue des Blancs, mat : ±(MATE − n), comme Lichess), div, evBy ; illisible : evFail.
 * Les résultats sont gardés par lots dans l'archive ; une position déjà vue dans la session n'est pas recalculée.
 */

'use strict';

const GameEval = (function () {
    const FAST = 8, DEPTH = 12, FAST_MS = 100, MAX_MS = 200, REFINE = 5, ROUNDS = 3, MIN_PLIES = 8, SAVE_EVERY = 5, MIDDLE_PIECES = 10, END_PIECES = 6, MIDDLE_PLY = 24, CACHE_MAX = 20000, START = 20;
    const cache = new Map();             // clé de position → { cp, d }, pour la session
    let running = false;

    const pending = (games, first) => games.filter(g => !g.ev && !g.evFail && g.sans.length >= MIN_PLIES)
        .sort((a, b) => (first ? (first(a) ? 0 : 1) - (first(b) ? 0 : 1) : 0) || (a.site === 'chesscom' ? 0 : 1) - (b.site === 'chesscom' ? 0 : 1) || b.at - a.at);

    function divide(pieces) {
        let middle = 0, end = 0;
        pieces.forEach((n, i) => {
            const ply = i + 1;
            if (!middle && (n <= MIDDLE_PIECES || ply >= MIDDLE_PLY)) middle = ply;
            if (!end && n <= END_PIECES) end = ply;
        });
        return [middle, end];
    }
    const piecesOf = fen => (fen.split(' ')[0].match(/[nbrqNBRQ]/g) || []).length;
    const clean = san => String(san).replace(/[+#!?]/g, '');
    const keyOf = (pos, fen) => (typeof Chess.key === 'function' ? Chess.key(pos) : fen.split(' ').slice(0, 4).join(' '));

    // Positions d'une partie, ou null si un coup est illisible.
    function positions(sans) {
        const out = [];
        let pos = Chess.start();
        for (const san of sans) {
            const want = clean(san), uci = Chess.legalMoves(pos).find(u => clean(Chess.san(pos, u)) === want);
            if (!uci) return null;
            pos = Chess.play(pos, uci);
            out.push(pos);
        }
        return out;
    }

    const toCp = line => { const s = line && line.score; if (!s) return null; return Number.isFinite(s.mate) ? (s.mate > 0 ? GameArchive.MATE - s.mate : -GameArchive.MATE - s.mate) : s.cp; };
    const remember = (key, v) => { if (cache.size >= CACHE_MAX) cache.clear(); cache.set(key, v); };

    // Évaluation d'une position par le moteur à cette profondeur ; null si le calcul a été annulé.
    async function engineEval(fen, depth) {
        const r = await Engine.analyse(fen, { multipv: 1, depth, movetime: depth >= DEPTH ? MAX_MS : FAST_MS }).done;
        if (r.cancelled) return null;
        const cp = toCp(r.lines && r.lines[0]);
        return cp === null || cp === undefined ? null : cp;
    }

    // Valeur la plus profonde connue d'une position (session, puis cache durable de l'ouverture).
    function known(key, ply) {
        const a = cache.get(key), b = ply <= EvalCache.MAX_PLY ? EvalCache.get(key) : null;
        return a && b ? (a.d >= b.d ? a : b) : a || b || null;
    }

    // Valeur la plus profonde connue d'une position (session, cache durable de l'ouverture), sinon le moteur à cette profondeur.
    async function evalAt(item, depth) {
        const have = known(item.key, item.ply);
        if (have && have.d >= depth) return have;
        const cp = await engineEval(item.fen, depth);
        if (cp === null) return null;
        const v = { cp, d: depth };
        remember(item.key, v);
        if (item.ply <= EvalCache.MAX_PLY) EvalCache.put(item.key, cp, depth);
        return v;
    }

    // Nuage de Lichess pour l'ouverture, une requête après l'autre pendant que le moteur calcule : les positions déjà
    // connues en profondeur sont sautées, la première absente arrête la chaîne (la suite est hors du livre du nuage).
    async function cloudChain(items, shouldRun) {
        for (const it of items) {
            if (it.ply > EvalCache.MAX_PLY || !shouldRun()) return;
            const have = known(it.key, it.ply);
            if (have && have.d >= DEPTH) continue;
            if (await EvalCache.cloud(it.fen, it.key) === null) return;
        }
    }

    // Demi-coups dont l'évaluation doit être reprise en profondeur : avant et après chaque coup qui perd REFINE points de gain ou plus.
    function refineList(ev, deep) {
        const out = new Set();
        for (let i = 0; i < ev.length; i++) {
            const sign = i % 2 === 0 ? 1 : -1, before = (i ? ev[i - 1] : START) * sign, after = ev[i] * sign;
            if (GameQuality.win(before) - GameQuality.win(after) < REFINE) continue;
            if (i && !deep[i - 1]) out.add(i - 1);
            if (!deep[i]) out.add(i);
        }
        return [...out].sort((a, b) => a - b);
    }

    // Valeur de la position finale, sans moteur : mat pour celui qui vient de jouer, pat nul.
    function finalValue(pos, ply, end) {
        if (Chess.legalMoves(pos).length) return null;
        if (end === 'stalemate') return 0;
        return ply % 2 === 0 ? GameArchive.MATE : -GameArchive.MATE;
    }

    // 'stop' : arrêt demandé ; 'fail' : partie illisible ; true : partie évaluée.
    async function evalGame(g, shouldRun) {
        const list = positions(g.sans);
        if (!list) return 'fail';
        const items = list.map((pos, i) => { const fen = Chess.fen(pos); return { pos, fen, key: keyOf(pos, fen), ply: i + 1 }; });
        const ev = [], deep = [], pieces = items.map(it => piecesOf(it.fen));
        const chain = cloudChain(items, shouldRun);
        // Première passe : profondeur FAST (ou mieux, si déjà connue).
        for (let i = 0; i < items.length; i++) {
            if (!shouldRun()) return 'stop';
            const end = i === items.length - 1 ? finalValue(items[i].pos, i, g.end) : null;
            if (end !== null) { ev.push(end); deep.push(true); continue; }
            const v = await evalAt(items[i], FAST);
            if (v === null) return 'stop';
            ev.push(v.cp);
            deep.push(v.d >= DEPTH);
        }
        // Valeurs du nuage arrivées pendant la première passe : elles remplacent celles du moteur.
        await chain;
        items.forEach((it, i) => { const v = deep[i] ? null : known(it.key, it.ply); if (v && v.d >= DEPTH) { ev[i] = v.cp; deep[i] = true; } });
        // Seconde passe : profondeur DEPTH autour des coups qui coûtent.
        for (let round = 0; round < ROUNDS; round++) {
            const todo = refineList(ev, deep);
            if (!todo.length) break;
            for (const i of todo) {
                if (!shouldRun()) return 'stop';
                const v = await evalAt(items[i], DEPTH);
                if (v === null) return 'stop';
                ev[i] = v.cp;
                deep[i] = true;
            }
        }
        g.ev = ev;
        g.evBy = `sf${FAST}+${DEPTH}`;
        if (!g.div) g.div = divide(pieces);
        return true;
    }

    async function run(games, { shouldRun, first, onGame = () => {}, onSaved = () => {} }) {
        if (running) return;
        running = true;
        EvalCache.resume();
        const queue = pending(games, first);
        let batch = [], done = 0;
        const flush = async () => { await EvalCache.flush(); if (!batch.length) return; const out = batch; batch = []; await GameArchive.saveDerived(out); onSaved(done); };
        try {
            await EvalCache.ready();
            for (const g of queue) {
                if (!shouldRun()) break;
                const res = await evalGame(g, shouldRun);
                if (res === 'stop') break;
                if (res === 'fail') g.evFail = true;
                batch.push(g);
                done++;
                onGame(done, queue.length);
                if (batch.length >= SAVE_EVERY) await flush();
            }
            await flush();
        } finally { running = false; }
    }

    return { FAST, DEPTH, REFINE, pending, divide, refineList, run, running: () => running, _clear: () => cache.clear() };
})();
