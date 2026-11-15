/**
 * domain/games/openingExplorer.js
 * ──────────────────────────────────────────────────────────────────────────
 * Explorateur de la fiche d'ouverture (atelier « Ouvertures et Progrès », lot 2), pur : ni écran ni stockage.
 *   node({ path, side, db, opp, rows })   la position au bout de path (UCI depuis le départ), vue de mon répertoire et de mes parties :
 *     turn 'me'  : mine = ma réponse enregistrée { uci, san, key, entry, n } ou null (n : parties qui l'ont jouée ici).
 *     turn 'opp' : replies = les coups adverses connus, du plus joué au moins joué :
 *                  { uci, san, key, n, t, answered, answer, seen } ; answered : une réponse m'attend après ce coup (transpositions comprises) ;
 *                  seen : repéré (oppSeen) ; un coup joué ou repéré sans réponse est un trou de la ligne.
 *     games : parties passées par cette position (OpeningReport.summarize).
 *   holes(node) : nombre de coups adverses joués ou repérés ici sans réponse.
 * Une ligne de partie : { g, a: { path } } (StatsGames.analysed) ; a.path s'arrête au premier coup hors répertoire (compris s'il est adverse).
 * db : base d'un répertoire et d'une couleur (readDBFor) ; opp : coups adverses repérés { clé: [uci] } (readOppFor).
 */

'use strict';

const OpeningExplorer = (function () {
    const startsWith = (p, pre) => p.length >= pre.length && pre.every((u, i) => p[i] === u);

    function node({ path, side, db, opp = {}, rows = [] }) {
        const pos = Chess.replay(path), key = Chess.key(pos), turn = pos.turn === side ? 'me' : 'opp';
        const through = rows.filter(r => startsWith(r.a.path, path));
        const next = new Map();                                      // coup suivant dans mes parties → parties
        through.forEach(r => {
            const u = r.a.path[path.length];
            if (!u) return;
            if (!next.has(u)) next.set(u, []);
            next.get(u).push(r.g);
        });
        const out = { path, key, turn, games: OpeningReport.summarize(through.map(r => r.g)), mine: null, replies: [] };
        if (turn === 'me') {
            const e = db[key];
            if (e) out.mine = { uci: e.move, san: e.san, key, entry: e, n: (next.get(e.move) || []).length };
            return out;
        }
        const legal = Chess.legalMoves(pos), seen = new Set(opp[key] || []), cands = new Set();
        legal.forEach(u => {
            if (next.has(u) || seen.has(u) || db[Chess.key(Chess.play(pos, u))]) cands.add(u);
        });
        out.replies = [...cands].map(u => {
            const k = Chess.key(Chess.play(pos, u)), games = next.get(u) || [], answer = db[k] || null;
            return { uci: u, san: Chess.san(pos, u), key: k, n: games.length, t: OpeningReport.summarize(games), answered: !!answer, answer, seen: seen.has(u) };
        }).sort((a, b) => b.n - a.n || (a.answered === b.answered ? 0 : a.answered ? 1 : -1) || a.san.localeCompare(b.san));
        return out;
    }

    const holes = nd => nd.replies.filter(r => !r.answered).length;

    return { node, holes };
})();
