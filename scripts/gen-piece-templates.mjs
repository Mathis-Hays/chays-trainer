// Gabarits des jeux de pièces pour la lecture d'une image (js/domain/photo/pieceTemplates.js, chantier « Éditeur et photo »).
// Usage, depuis la racine du projet (Google Chrome installé, rien à installer) :
//   node scripts/gen-piece-templates.mjs
// Chaque pièce des dix jeux visibles (assets/pieces/<jeu>/, « Invisibles » exclu) est dessinée par Chrome sans tête, comme
// l'application la dessine, sur 96 × 96 px, puis réduite à 24 × 24 par moyenne de blocs (couverture exacte). Un octet par
// pixel : luminance sur 4 bits (poids fort), opacité sur 4 bits. 12 × 576 octets par jeu, en base 64.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETS = ['maestro', 'merida', 'staunty', 'chrome', 'california', 'chessnut', 'spatial', 'fantasy', 'minimal-warmth', 'kiwen-suwi'];
const ORDER = 'KQRBNPkqrbnp', S = 24, BIG = 96;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const file = p => `${p === p.toUpperCase() ? 'w' : 'b'}${p.toUpperCase()}`;
const images = {};
SETS.forEach(s => [...ORDER].forEach(p => {
    const svg = fs.readFileSync(path.join(ROOT, 'assets/pieces', s, file(p) + '.svg'));
    images[`${s}/${p}`] = 'data:image/svg+xml;base64,' + svg.toString('base64');
}));

// Page de rendu : chaque SVG dessiné dans un canevas de 96 px, réduit à 24 px (luminance prémultipliée par l'opacité).
const page = `<!doctype html><meta charset="utf-8"><pre id="out">attente</pre><script>
const IMAGES = ${JSON.stringify(images)}, S = ${S}, BIG = ${BIG}, K = BIG / S;
const load = src => new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = src; });
(async () => {
    const out = {};
    const cv = document.createElement('canvas'); cv.width = cv.height = BIG;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    for (const [k, src] of Object.entries(IMAGES)) {
        const im = await load(src);
        ctx.clearRect(0, 0, BIG, BIG);
        ctx.drawImage(im, 0, 0, BIG, BIG);
        const d = ctx.getImageData(0, 0, BIG, BIG).data, bytes = [];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            let a = 0, al = 0;
            for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
                const o = ((y * K + j) * BIG + x * K + i) * 4, al1 = d[o + 3] / 255;
                a += al1; al += al1 * (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]);
            }
            a /= K * K; const l = a > 0.004 ? al / (K * K) / a : 0;
            bytes.push((Math.min(15, Math.round(l / 17)) << 4) | Math.min(15, Math.round(a * 15)));
        }
        const [set] = k.split('/');
        (out[set] = out[set] || []).push(...bytes);
    }
    const b64 = {};
    for (const [s, arr] of Object.entries(out)) b64[s] = btoa(String.fromCharCode(...arr));
    document.getElementById('out').textContent = JSON.stringify(b64);
})().catch(e => { document.getElementById('out').textContent = 'ERREUR ' + e; });
</script>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chays-gabarits-'));
const html = path.join(dir, 'page.html');
fs.writeFileSync(html, page);
const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=20000', '--dump-dom', 'file://' + html],
    { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
fs.rmSync(dir, { recursive: true, force: true });
const m = dom.match(/<pre id="out">([^<]*)<\/pre>/);
if (!m || !m[1].startsWith('{')) throw new Error('rendu impossible : ' + (m ? m[1] : dom.slice(0, 300)));
const sets = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

const body = Object.entries(sets).map(([s, b]) => `        '${s}': '${b}'`).join(',\n');
const out = `/**
 * domain/photo/pieceTemplates.js
 * ──────────────────────────────────────────────────────────────────────────
 * Gabarits des dix jeux de pièces visibles, pour la lecture d'une capture d'écran (BoardReader, boardReader.js).
 * GÉNÉRÉ par scripts/gen-piece-templates.mjs (Chrome sans tête) : ne pas modifier à la main ; relancer après tout
 * changement d'un jeu de pièces. Pièces dans l'ordre ${ORDER}, ${S} × ${S} px chacune, un octet par pixel :
 * luminance sur 4 bits (poids fort, × 17), opacité sur 4 bits (/ 15).
 * Chargé à la demande (pas dans index.html) ; rangé par sw.js à l'installation (ON_DEMAND). « var » : le script
 * chargé plus tard est lu par globalThis.PieceTemplates.
 */

'use strict';

var PieceTemplates = {
    size: ${S},
    order: '${ORDER}',
    sets: {
${body}
    }
};
`;
const dest = path.join(ROOT, 'js/domain/photo/pieceTemplates.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`${path.relative(ROOT, dest)} : ${Object.keys(sets).length} jeux, ${(out.length / 1024).toFixed(1)} Ko`);
