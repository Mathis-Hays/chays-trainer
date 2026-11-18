// Lancer : node tests/domain/boardReader.test.js   — lecture d'une capture d'échiquier (BoardReader, chantier « Éditeur et photo »).
// Images synthétiques : positions tirées au hasard, dessinées avec les gabarits des dix jeux de l'app agrandis (bilinéaire)
// à des tailles de case variées, sur des échiquiers de couleurs différentes, avec grain, cases surlignées, bruit et une
// interface autour. On mesure le taux de cases justes ; le test exige 99 % et un cadre trouvé à chaque fois.
// La mesure sur de vrais rendus SVG (Chrome) est décrite dans js/screens/CLAUDE.md (« Éditeur de position »).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const { scriptPath } = require('../_app.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { Buffer, console, Math };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(scriptPath('pieceTemplates.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(scriptPath('boardReader.js'), 'utf8'), ctx);
const { BoardReader, PieceTemplates } = ctx;

// ─── GÉNÉRATEUR ───────────────────────────────────────────────────────────────
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const S = PieceTemplates.size, ORDER = PieceTemplates.order;
const raw = {};
Object.entries(PieceTemplates.sets).forEach(([id, b64]) => { raw[id] = Buffer.from(b64, 'base64'); });

// Position plausible de milieu de partie : rois et pions de chaque camp de leur côté (le sens se devine sur eux).
function randomBoard() {
    const b = new Array(64).fill('');
    const ranks = { P: [1, 3], p: [4, 6], K: [0, 1], k: [6, 7] };
    const put = p => { for (;;) { const i = Math.floor(rnd() * 64), r = i >> 3, z = ranks[p]; if (b[i] || (z && (r < z[0] || r > z[1]))) continue; b[i] = p; return; } };
    put('K'); put('k'); for (let i = 0; i < 3; i++) { put('P'); put('p'); }
    const k = 6 + Math.floor(rnd() * 20);
    for (let i = 0; i < k; i++) put('QRBNPPPqrbnppp'[Math.floor(rnd() * 14)]);
    return b;
}

// Pièce du jeu `set` dessinée dans la case (px, py) de côté cell, à l'échelle sc (bilinéaire depuis le gabarit 24 px).
function drawPiece(img, W, set, p, px, py, cell, sc) {
    const k = ORDER.indexOf(p), b = raw[set], size = cell * sc, off = (cell - size) / 2;
    const A = (x, y) => { x = Math.max(0, Math.min(S - 1, x)); y = Math.max(0, Math.min(S - 1, y)); const v = b[k * S * S + y * S + x]; return [(v & 15) / 15, (v >> 4) * 17]; };
    for (let y = Math.floor(py + off); y < Math.ceil(py + off + size); y++) for (let x = Math.floor(px + off); x < Math.ceil(px + off + size); x++) {
        const u = (x + 0.5 - px - off) / size * S - 0.5, v = (y + 0.5 - py - off) / size * S - 0.5;
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        let a = 0, al = 0;
        [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]].forEach(([xx, yy, w]) => {
            const [aa, ll] = A(xx, yy); a += aa * w; al += aa * ll * w;
        });
        if (a <= 0) continue;
        const l = al / a, o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) img[o + c] = img[o + c] * (1 - a) + l * a;
    }
}

const THEMES = [[[240, 217, 181], [181, 136, 99]], [[238, 238, 210], [118, 150, 86]], [[222, 227, 230], [140, 162, 173]], [[232, 220, 200], [120, 90, 70]], [[200, 200, 200], [90, 90, 90]]];

function render({ set, cell, sc, flipped, theme, grain, margin }) {
    const pos = randomBoard(), B = Math.round(cell * 8);
    const W = B + margin * 2 + 120, H = B + margin * 2 + 40, img = new Float32Array(W * H * 4);
    // Interface : fond, panneau, lignes de texte.
    for (let i = 0; i < W * H; i++) { img[i * 4] = 246; img[i * 4 + 1] = 242; img[i * 4 + 2] = 235; img[i * 4 + 3] = 255; }
    for (let y = 10; y < H - 10; y += 14) for (let x = B + margin * 2 + 10; x < W - 10; x++) if (rnd() < 0.5) { const o = (y * W + x) * 4; img[o] = img[o + 1] = img[o + 2] = 60; }
    const [L, D] = THEMES[theme], hl = [Math.floor(rnd() * 64), Math.floor(rnd() * 64)];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const x0 = margin + Math.round(c * cell), x1 = margin + Math.round((c + 1) * cell), y0 = margin + Math.round(r * cell), y1 = margin + Math.round((r + 1) * cell);
        const col = (r + c) % 2 ? D : L, i = r * 8 + c, lit = hl.includes(i);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const o = (y * W + x) * 4, gr = grain ? (Math.sin(x * 0.7 + Math.sin(y * 0.05) * 6) * 6 + (rnd() - 0.5) * 8) : 0;
            for (let k = 0; k < 3; k++) img[o + k] = (lit ? col[k] * 0.6 + [205, 210, 106][k] * 0.4 : col[k]) + gr;
        }
        const sq = flipped ? r * 8 + (7 - c) : (7 - r) * 8 + c;
        if (pos[sq]) drawPiece(img, W, set, pos[sq], margin + c * cell, margin + r * cell, cell, sc);
    }
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < img.length; i++) data[i] = img[i] + (i % 4 === 3 ? 0 : (rnd() - 0.5) * 6);
    return { img: { width: W, height: H, data }, pos };
}

// ─── MESURE ───────────────────────────────────────────────────────────────────
const sets = Object.keys(PieceTemplates.sets);
let good = 0, total = 0, frames = 0, sides = 0, setsOk = 0, doubtWrong = 0, wrong = 0, runs = 0, doubts = 0;
const t0 = Date.now();
sets.forEach((set, si) => [0, 1, 2].forEach(v => {
    const cell = [31, 46.5, 68][v], flipped = (si + v) % 2 === 1;
    const { img, pos } = render({ set, cell, sc: [1, 0.92, 0.88][v], flipped, theme: (si + v) % THEMES.length, grain: v === 1, margin: 14 + v * 9 });
    const r = BoardReader.read(img, PieceTemplates);
    runs++;
    if (!r.ok) { total += 64; return; }
    frames++;
    if (r.flipped === flipped) sides++;
    if (r.set === set) setsOk++;
    doubts += r.doubt.length;
    pos.forEach((p, i) => {
        total++;
        if (r.board[i] === p) good++; else { wrong++; if (r.doubt.includes(i)) doubtWrong++; }
    });
}));
const rate = good / total;
console.log(`     ${runs} images, ${(Date.now() - t0) / runs | 0} ms par image ; cadres ${frames}/${runs}, sens ${sides}/${runs}, jeu ${setsOk}/${runs}`);
console.log(`     cases justes : ${good}/${total} = ${(rate * 100).toFixed(2)} % ; erreurs signalées en ambre : ${doubtWrong}/${wrong} ; cases ambre : ${doubts}`);

t('le cadre est trouvé sur chaque image', () => assert.strictEqual(frames, runs));
t('99 % des cases justes au moins', () => assert(rate >= 0.99, `${(rate * 100).toFixed(2)} %`));
t('le sens de l\'échiquier est deviné', () => assert(sides >= runs - 2, `${sides}/${runs}`));

t('une image sans échiquier est refusée', () => {
    const W = 300, H = 200, data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 40; y < 60; y++) for (let x = 20; x < 280; x++) data[(y * W + x) * 4] = 0;
    assert.strictEqual(BoardReader.read({ width: W, height: H, data }, PieceTemplates).ok, false);
});

t('position de départ, capture recadrée au bord de l\'échiquier, Blancs en bas', () => {
    seed = 3;
    const start = 'rnbqkbnrpppppppp' + ''.padEnd(32, '.') + 'PPPPPPPPRNBQKBNR';
    const pos = new Array(64).fill('');
    [...start].forEach((ch, i) => { if (ch !== '.') pos[(7 - (i >> 3)) * 8 + (i & 7)] = ch; });
    const cell = 50, W = 400, data = new Uint8ClampedArray(W * W * 4);
    const img = new Float32Array(W * W * 4);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const col = (r + c) % 2 ? [181, 136, 99] : [240, 217, 181];
        for (let y = r * cell; y < (r + 1) * cell; y++) for (let x = c * cell; x < (c + 1) * cell; x++) { const o = (y * W + x) * 4; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255; }
        const sq = (7 - r) * 8 + c;
        if (pos[sq]) drawPiece(img, W, 'maestro', pos[sq], c * cell, r * cell, cell, 0.92);
    }
    for (let i = 0; i < img.length; i++) data[i] = img[i];
    const res = BoardReader.read({ width: W, height: W, data }, PieceTemplates);
    assert(res.ok);
    assert.strictEqual(res.flipped, false);
    assert.deepStrictEqual([...res.board], pos);
    assert.strictEqual(res.set, 'maestro');
});

t('les gabarits pèsent moins de 150 Ko', () => {
    assert(fs.statSync(scriptPath('pieceTemplates.js')).size < 150 * 1024);
    assert.strictEqual(sets.length, 10);
});
console.log(`\n${n} tests réussis.`);
