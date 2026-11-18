/**
 * domain/photo/boardReader.js
 * ──────────────────────────────────────────────────────────────────────────
 * Lecture d'une capture d'écran d'échiquier (chantier « Éditeur et photo ») : JavaScript pur, hors ligne, aucune
 * image ne quitte l'appareil. Chargé à la demande avec ses gabarits (pieceTemplates.js) par l'éditeur de position ;
 * rangé par sw.js à l'installation (ON_DEMAND). « var » : le script chargé plus tard est lu par globalThis.BoardReader.
 *
 *   BoardReader.read({ width, height, data }, templates) → résultat (image RVBA, comme ImageData)
 *     { ok, board: [64] (a1 = 0, pièces « KQRBNP » / « kqrbnp », '' vide), flipped (Noirs en bas), doubt: [cases],
 *       set (jeu reconnu), frame: { x, y, cell } (pixels de l'image), score (netteté de la grille, 0 à 1) }
 *     ok = false : aucune grille 8 × 8 trouvée (reason).
 *
 * Étapes :
 *   1. Cadre : profils des contrastes horizontaux et verticaux ; on cherche la grille de 9 lignes équidistantes qui
 *      les maximise (8 cases × la même largeur dans les deux sens), puis on l'affine au dixième de pixel ; parmi elle et
 *      ses voisines décalées d'une case, on garde celle dont les cases alternent le mieux clair / foncé.
 *   2. 64 cases, chacune ramenée à 24 × 24 par moyenne de surface (image intégrale).
 *   3. Chaque case est comparée à « vide » et aux 12 pièces des dix jeux de l'app, à trois tailles (100, 92, 84 %) :
 *      modèle pixel = opacité × luminance de la pièce + (1 − opacité) × fond, le fond étant ajusté au mieux (cases
 *      surlignées, texturées). Le jeu et la taille qui expliquent le mieux tout l'échiquier sont retenus, puis chaque case
 *      est relue avec eux, décalée d'un pixel au plus.
 *   4. Douteuses : écart faible entre les deux meilleures lectures, ou pièce mal expliquée (jeu inconnu, flèche…).
 *   5. Sens : les Blancs du côté où sont leurs pions et leur roi.
 */

'use strict';

var BoardReader = (function () {
    const SCALES = [1, 0.92, 0.84];
    const DOUBT_RATIO = 0.8;          // deuxième lecture à moins de 25 % de la première : case douteuse
    const DOUBT_FIT = 0.38;           // pièce dont le gabarit laisse plus de 38 % du contraste inexpliqué

    // ─── GABARITS ─────────────────────────────────────────────────────────────
    let _prepared = null, _preparedFrom = null;

    const _b64 = s => {
        if (typeof atob === 'function') { const t = atob(s), out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; }
        return new Uint8Array(Buffer.from(s, 'base64'));
    };

    // Pièce brute (opacité, luminance) → gabarit S × S à l'échelle sc, centré, décalé de (dx, dy) pixels.
    function _scaled(A, L, S, sc) {
        const a = new Float32Array(S * S), al = new Float32Array(S * S), off = S * (1 - sc) / 2;
        const sub = 4;                                         // 4 × 4 points par pixel : couverture assez fine
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            let sa = 0, sal = 0;
            for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
                const u = (x + (i + 0.5) / sub - off) / sc, v = (y + (j + 0.5) / sub - off) / sc;
                if (u < 0 || v < 0 || u >= S || v >= S) continue;
                const k = Math.floor(v) * S + Math.floor(u);
                sa += A[k]; sal += A[k] * L[k];
            }
            a[y * S + x] = sa / (sub * sub); al[y * S + x] = sal / (sub * sub);
        }
        return { a, al };
    }

    // Constantes d'un gabarit pour l'erreur à fond libre : u = 1 − opacité.
    function _stats(t, S) {
        const n = S * S, u = new Float32Array(n);
        let sAL2 = 0, sALu = 0, su2 = 0;
        for (let i = 0; i < n; i++) { u[i] = 1 - t.a[i]; sAL2 += t.al[i] * t.al[i]; sALu += t.al[i] * u[i]; su2 += u[i] * u[i]; }
        return { al: t.al, u, sAL2, sALu, su2 };
    }

    function prepare(raw) {
        if (_prepared && _preparedFrom === raw) return _prepared;
        const S = raw.size, order = raw.order, sets = {};
        Object.entries(raw.sets).forEach(([id, b64]) => {
            const bytes = _b64(b64), pieces = {};
            [...order].forEach((p, k) => {
                const A = new Float32Array(S * S), L = new Float32Array(S * S);
                for (let i = 0; i < S * S; i++) { const v = bytes[k * S * S + i]; L[i] = (v >> 4) * 17; A[i] = (v & 15) / 15; }
                pieces[p] = SCALES.map(sc => _stats(_scaled(A, L, S, sc), S));
            });
            sets[id] = pieces;
        });
        _preparedFrom = raw;
        return (_prepared = { S, order, sets });
    }

    // ─── IMAGE ────────────────────────────────────────────────────────────────
    // Luminance (fond blanc sous les pixels transparents).
    function gray(img) {
        const { width: w, height: h, data } = img, g = new Float32Array(w * h);
        for (let i = 0, o = 0; i < w * h; i++, o += 4) {
            const a = data[o + 3] / 255;
            g[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) * a + 255 * (1 - a);
        }
        return g;
    }

    // Image intégrale (w + 1) × (h + 1) : somme d'un rectangle quelconque, bornes fractionnaires comprises.
    function integral(g, w, h) {
        const W = w + 1, I = new Float64Array(W * (h + 1));
        for (let y = 0; y < h; y++) {
            let row = 0;
            for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
        }
        return I;
    }
    function _at(I, W, H, x, y) {                              // intégrale interpolée au point (x, y), bornée à l'image
        x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
        const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
        const a = I[y0 * W + x0], b = I[y0 * W + x1], c = I[y1 * W + x0], d = I[y1 * W + x1];
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function _boxMean(I, w, h, x0, y0, x1, y1) {
        const W = w + 1, H = h + 1;
        const s = _at(I, W, H, x1, y1) - _at(I, W, H, x0, y1) - _at(I, W, H, x1, y0) + _at(I, W, H, x0, y0);
        return s / Math.max(1e-6, (x1 - x0) * (y1 - y0));
    }

    // Case (x, y, côté cw × ch) ramenée à S × S par moyenne de surface.
    function sampleCell(I, w, h, x, y, cw, ch, S) {
        const out = new Float32Array(S * S), sx = cw / S, sy = ch / S;
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++)
            out[j * S + i] = _boxMean(I, w, h, x + i * sx, y + j * sy, x + (i + 1) * sx, y + (j + 1) * sy);
        return out;
    }

    // ─── CADRE DE L'ÉCHIQUIER ─────────────────────────────────────────────────
    // Réduction à 800 px au plus pour chercher la grille (la lecture des cases se fait en pleine résolution).
    function _shrink(g, w, h, max) {
        const f = Math.min(1, max / Math.max(w, h));
        if (f >= 1) return { g, w, h, f: 1 };
        const W = Math.max(1, Math.round(w * f)), H = Math.max(1, Math.round(h * f)), I = integral(g, w, h), out = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = _boxMean(I, w, h, x / f, y / f, (x + 1) / f, (y + 1) / f);
        return { g: out, w: W, h: H, f: W / w };
    }

    // Profil d'une direction : P[b] = somme des contrastes entre les pixels b − 1 et b (b = frontière), sur une bande.
    function _profile(g, w, h, vertical, from, to) {
        const n = vertical ? h : w, P = new Float64Array(n + 1);
        from = Math.max(0, Math.floor(from)); to = Math.min(vertical ? w : h, Math.ceil(to));
        for (let b = 1; b < n; b++) {
            let s = 0;
            for (let t = from; t < to; t++) {
                const d = vertical ? Math.abs(g[b * w + t] - g[(b - 1) * w + t]) : Math.abs(g[t * w + b] - g[t * w + b - 1]);
                if (d > 6) s += d;                              // le grain d'une texture ne compte pas
            }
            P[b] = s;
        }
        return P;
    }

    const _peak = (P, b) => { const r = Math.round(b); let m = 0; for (let k = r - 1; k <= r + 1; k++) if (k > 0 && k < P.length - 1 && P[k] > m) m = P[k]; return m; };
    const _lin = (P, b) => { if (b <= 0 || b >= P.length - 1) return 0; const k = Math.floor(b), f = b - k; return P[k] * (1 - f) + P[k + 1] * f; };

    // Meilleure grille o + k·p (k = 0..8) d'un profil, p entre pMin et pMax ; affinée au dixième de pixel.
    function _lattice(P, pMin, pMax) {
        const n = P.length - 1;
        pMax = Math.min(pMax, n / 8 + 0.5);
        let best = { s: -1, o: 0, p: 0 };
        for (let p = pMin; p <= pMax; p += 0.25) {
            for (let o = -1; o + 8 * p <= n + 1; o += 1) {
                let s = 0;
                for (let k = 0; k <= 8; k++) s += _peak(P, o + k * p);
                for (let k = 0; k < 8; k++) s -= 0.5 * _peak(P, o + (k + 0.5) * p);   // une ligne au milieu des cases : grille décalée
                if (s > best.s) best = { s, o, p };
            }
        }
        if (best.s <= 0) return null;
        let fine = { s: -1, o: best.o, p: best.p };
        for (let p = best.p - 0.4; p <= best.p + 0.4; p += 0.02) {
            for (let o = best.o - 1.5; o <= best.o + 1.5; o += 0.1) {
                let s = 0;
                for (let k = 0; k <= 8; k++) s += _lin(P, o + k * p);
                if (s > fine.s) fine = { s, o, p };
            }
        }
        // Netteté : lignes de la grille contre le reste du profil sur le même tronçon.
        let lines = 0, all = 0, cnt = 0;
        for (let k = 1; k <= 7; k++) lines += _peak(P, fine.o + k * fine.p);
        for (let b = Math.max(1, Math.round(fine.o)); b <= Math.min(n - 1, Math.round(fine.o + 8 * fine.p)); b++) { all += P[b]; cnt++; }
        const mean = cnt ? all / cnt : 0;
        return { o: fine.o, p: fine.p, sharp: mean > 0 ? (lines / 7) / mean : 0 };
    }

    function findBoard(g, w, h) {
        const sm = _shrink(g, w, h, 800), G = sm.g, W = sm.w, H = sm.h;
        const minP = 10;
        let ry0 = 0, ry1 = H, X = null, Y = null;
        for (let it = 0; it < 3; it++) {
            const px = _profile(G, W, H, false, ry0, ry1);
            X = _lattice(px, Y ? Y.p * 0.94 : minP, Y ? Y.p * 1.06 : W / 8 + 1);
            if (!X) return null;
            const py = _profile(G, W, H, true, X.o, X.o + 8 * X.p);
            Y = _lattice(py, X.p * 0.94, X.p * 1.06);
            if (!Y) return null;
            ry0 = Y.o; ry1 = Y.o + 8 * Y.p;
        }
        // Grille décalée d'une case (bord de l'échiquier peu contrasté, texte de l'interface à côté) : on garde, parmi
        // les décalages d'une case, celle dont les 64 cases alternent le mieux clair / foncé.
        const I = integral(G, W, H);
        let best = null;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x0 = X.o + dx * X.p, y0 = Y.o + dy * Y.p;
            if (x0 < -2 || y0 < -2 || x0 + 8 * X.p > W + 2 || y0 + 8 * Y.p > H + 2) continue;
            const c = _checker(I, W, H, x0, y0, X.p, Y.p) * (dx || dy ? 1 : 1.05);
            if (!best || c > best.c) best = { c, x0, y0 };
        }
        const f = sm.f;
        return { x: best.x0 / f, y: best.y0 / f, cw: X.p / f, ch: Y.p / f, sharp: Math.min(X.sharp, Y.sharp) };
    }

    // Alternance clair / foncé des 64 cases (fond lu dans les coins, que les pièces touchent rarement) : somme des
    // écarts au fond moyen, de signe alterné d'une case à l'autre.
    function _checker(I, w, h, x0, y0, cw, ch) {
        const bg = [];
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const x = x0 + c * cw, y = y0 + r * ch, a = 0.06, b = 0.2;
            const v = [[a, a], [1 - b, a], [a, 1 - b], [1 - b, 1 - b]].map(([u, t]) =>
                _boxMean(I, w, h, x + u * cw, y + t * ch, x + (u + b - a) * cw, y + (t + b - a) * ch)).sort((p, q) => p - q);
            bg.push((v[1] + v[2]) / 2);
        }
        const m = bg.reduce((s, v) => s + v, 0) / 64;
        return Math.abs(bg.reduce((s, v, i) => s + ((((i >> 3) + (i & 7)) % 2) ? -1 : 1) * (v - m), 0));
    }

    // ─── LECTURE DES CASES ────────────────────────────────────────────────────
    // Erreur du gabarit t (décalé de dx, dy) sur la case x, fond ajusté au mieux.
    function _err(x, sx2, t, S, dx, dy) {
        let dAL = 0, dU = 0;
        if (!dx && !dy) {
            for (let i = 0; i < S * S; i++) { dAL += x[i] * t.al[i]; dU += x[i] * t.u[i]; }
            return sx2 - 2 * dAL + t.sAL2 - (dU - t.sALu) * (dU - t.sALu) / t.su2;
        }
        // Gabarit décalé : hors de son cadre, il est transparent (u = 1, al = 0).
        let sAL2 = 0, sALu = 0, su2 = 0;
        for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
            const u0 = xx - dx, v0 = y - dy, xi = x[y * S + xx];
            if (u0 < 0 || v0 < 0 || u0 >= S || v0 >= S) { dU += xi; su2 += 1; continue; }
            const k = v0 * S + u0, al = t.al[k], u = t.u[k];
            dAL += xi * al; dU += xi * u; sAL2 += al * al; sALu += al * u; su2 += u * u;
        }
        return sx2 - 2 * dAL + sAL2 - (dU - sALu) * (dU - sALu) / su2;
    }

    function _cellStats(x) {
        let s = 0, s2 = 0;
        for (let i = 0; i < x.length; i++) { s += x[i]; s2 += x[i] * x[i]; }
        return { s2, empty: s2 - s * s / x.length };
    }

    function classify(cells, T) {
        const S = T.S, order = [...T.order], stats = cells.map(_cellStats);
        // 1. Jeu et taille : ceux qui expliquent le mieux les 64 cases.
        let pick = null;
        Object.entries(T.sets).forEach(([id, pieces]) => SCALES.forEach((sc, si) => {
            let tot = 0;
            cells.forEach((x, c) => {
                let m = stats[c].empty;
                for (const p of order) m = Math.min(m, _err(x, stats[c].s2, pieces[p][si], S, 0, 0));
                tot += m;
            });
            if (!pick || tot < pick.tot) pick = { id, si, tot };
        }));
        // 2. Chaque case relue avec ce jeu, décalée d'un pixel au plus.
        const pieces = T.sets[pick.id];
        const out = cells.map((x, c) => {
            const st = stats[c], errs = { '': st.empty };
            for (const p of order) {
                let m = Infinity;
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.min(m, _err(x, st.s2, pieces[p][pick.si], S, dx, dy));
                errs[p] = Math.max(0, m);
            }
            const ranked = Object.entries(errs).sort((a, b) => a[1] - b[1]);
            const [label, e1] = ranked[0], e2 = ranked[1][1];
            const ratio = e2 > 1e-6 ? e1 / e2 : 0;
            const fit = label && st.empty > 1e-6 ? e1 / st.empty : 0;
            return { label, doubt: ratio > DOUBT_RATIO || fit > DOUBT_FIT, ratio, fit, second: ranked[1][0] };
        });
        return { cells: out, set: pick.id, scale: SCALES[pick.si] };
    }

    // Blancs en bas ? Pions et roi blancs plus bas que les noirs (lignes comptées depuis le haut de l'image).
    function whiteAtBottom(labels) {
        let s = 0;
        labels.forEach((p, i) => {
            if (!p) return;
            const row = Math.floor(i / 8), wgt = p.toUpperCase() === 'P' ? 1 : p.toUpperCase() === 'K' ? 2 : 0.25;
            s += (p === p.toUpperCase() ? 1 : -1) * (row - 3.5) * wgt;
        });
        return s >= 0;
    }

    // ─── LECTURE COMPLÈTE ─────────────────────────────────────────────────────
    function read(img, templates) {
        const T = prepare(templates || globalThis.PieceTemplates);
        const { width: w, height: h } = img, g = gray(img);
        const fr = findBoard(g, w, h);
        if (!fr || fr.cw < 8 || fr.sharp < 1.6) return { ok: false, reason: 'grid', frame: fr };
        const I = integral(g, w, h), cells = [];
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
            cells.push(sampleCell(I, w, h, fr.x + c * fr.cw, fr.y + r * fr.ch, fr.cw, fr.ch, T.S));
        const res = classify(cells, T), labels = res.cells.map(c => c.label);
        const flipped = !whiteAtBottom(labels);
        const board = new Array(64).fill(''), doubt = [];
        res.cells.forEach((c, i) => {
            const r = Math.floor(i / 8), col = i % 8;
            const sq = flipped ? r * 8 + (7 - col) : (7 - r) * 8 + col;
            board[sq] = c.label;
            if (c.doubt) doubt.push(sq);
        });
        return { ok: true, board, flipped, doubt: doubt.sort((a, b) => a - b), set: res.set, scale: res.scale,
                 frame: { x: fr.x, y: fr.y, cell: (fr.cw + fr.ch) / 2 }, score: Math.min(1, fr.sharp / 6) };
    }

    return { read, prepare, findBoard, classify, gray, integral, sampleCell, whiteAtBottom };
})();
