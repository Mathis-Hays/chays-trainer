/**
 * domain/chess/positionSetup.js
 * ──────────────────────────────────────────────────────────────────────────
 * Position posée à la main (éditeur de position, chantier « Éditeur et photo ») : lecture et écriture de la FEN, roques
 * et prise en passant déduits des pièces, validation. Fonctions pures ; l'échec se calcule par l'API Chess (jamais sur
 * l'état global affiché).
 *   Une position : { board: [64] (a1 = 0, « KQRBNP » / « kqrbnp », '' vide), turn: 'w' | 'b',
 *                    castling: { K, Q, k, q }, ep: case de prise en passant ou -1 }.
 *   parse(fen) → position ou null · fen(pos) · start() · empty()
 *   castlingAvailable(board) : roques que les pièces permettent (roi et tour sur leurs cases d'origine)
 *   epCandidates(board, turn) : cases où le camp au trait pourrait prendre en passant (pion adverse qui vient d'avancer
 *       de deux cases, cases de départ libres, un pion à côté)
 *   normalize(pos) : roques et prise en passant ramenés à ce que les pièces permettent
 *   validate(pos) → { ok, errors: [texte] } : un roi de chaque camp, aucun pion sur la 1re ou la 8e rangée, le camp qui
 *       n'a pas le trait n'est pas en échec.
 */

'use strict';

const PositionSetup = (function () {

    const empty = () => ({ board: new Array(64).fill(''), turn: 'w', castling: { K: false, Q: false, k: false, q: false }, ep: -1 });

    // FEN tolérante : seul le champ des pièces est exigé (8 rangées de 8 cases) ; trait blanc, roques et prise en passant
    // absents par défaut. Rien n'est corrigé ici (normalize s'en charge).
    function parse(fen) {
        if (typeof fen !== 'string') return null;
        const parts = fen.trim().split(/\s+/), rows = (parts[0] || '').split('/');
        if (rows.length !== 8) return null;
        const pos = empty();
        for (let r = 0; r < 8; r++) {
            let col = 0;
            for (const ch of rows[r]) {
                if (/[1-8]/.test(ch)) col += Number(ch);
                else if (/[KQRBNPkqrbnp]/.test(ch)) { if (col > 7) return null; pos.board[(7 - r) * 8 + col] = ch; col++; }
                else return null;
            }
            if (col !== 8) return null;
        }
        if (parts[1] && !/^[wb]$/.test(parts[1])) return null;
        pos.turn = parts[1] || 'w';
        const cr = parts[2] || '-';
        if (!/^(-|[KQkq]{1,4})$/.test(cr)) return null;
        ['K', 'Q', 'k', 'q'].forEach(k => { pos.castling[k] = cr.includes(k); });
        const ep = parts[3] || '-';
        if (ep !== '-' && !/^[a-h][36]$/.test(ep)) return null;
        pos.ep = ep === '-' ? -1 : squareToIdx(ep);
        return pos;
    }

    function fen(pos) {
        return Chess.fen({ board: pos.board, turn: pos.turn, castling: pos.castling, ep: pos.ep });
    }

    const start = () => parse(INIT_FEN);

    function castlingAvailable(b) {
        return { K: b[4] === 'K' && b[7] === 'R', Q: b[4] === 'K' && b[0] === 'R',
                 k: b[60] === 'k' && b[63] === 'r', q: b[60] === 'k' && b[56] === 'r' };
    }

    function epCandidates(b, turn) {
        const out = [], white = turn === 'w';
        const pawnRank = white ? 4 : 3, mine = white ? 'P' : 'p', theirs = white ? 'p' : 'P';
        const target = white ? 5 : 2, from = white ? 6 : 1;
        for (let c = 0; c < 8; c++) {
            if (b[pawnRank * 8 + c] !== theirs || b[target * 8 + c] || b[from * 8 + c]) continue;
            if ((c > 0 && b[pawnRank * 8 + c - 1] === mine) || (c < 7 && b[pawnRank * 8 + c + 1] === mine)) out.push(target * 8 + c);
        }
        return out;
    }

    function normalize(pos) {
        const av = castlingAvailable(pos.board), castling = {};
        ['K', 'Q', 'k', 'q'].forEach(k => { castling[k] = !!(pos.castling[k] && av[k]); });
        const ep = epCandidates(pos.board, pos.turn).includes(pos.ep) ? pos.ep : -1;
        return { board: pos.board.slice(), turn: pos.turn, castling, ep };
    }

    // Le camp `color` est-il en échec ? (calculé sur une copie, par l'API Chess)
    function inCheck(pos, color) {
        return Chess.isolated(() => {
            Chess.load({ board: pos.board, turn: pos.turn, castling: pos.castling, ep: pos.ep });
            const k = findKing(color);
            return k >= 0 && isSquareAttacked(k, color === 'w' ? 'b' : 'w');
        });
    }

    function validate(pos) {
        const errors = [], count = p => pos.board.filter(x => x === p).length;
        [['K', 'w'], ['k', 'b']].forEach(([k, c]) => {
            const n = count(k);
            if (!n) errors.push(c === 'w' ? 'Il manque le roi blanc' : 'Il manque le roi noir');
            else if (n > 1) errors.push(c === 'w' ? 'Un seul roi blanc par camp' : 'Un seul roi noir par camp');
        });
        for (let c = 0; c < 8; c++) {
            if (/[Pp]/.test(pos.board[c])) { errors.push('Pion sur la 1re rangée'); break; }
        }
        for (let c = 56; c < 64; c++) {
            if (/[Pp]/.test(pos.board[c])) { errors.push('Pion sur la 8e rangée'); break; }
        }
        if (!errors.length && inCheck(pos, pos.turn === 'w' ? 'b' : 'w')) errors.push('Le camp qui n’a pas le trait est en échec');
        return { ok: !errors.length, errors };
    }

    return { parse, fen, start, empty, castlingAvailable, epCandidates, normalize, inCheck, validate };
})();
