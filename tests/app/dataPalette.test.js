// Lancer : node tests/app/dataPalette.test.js — palette « Noyer, un seul accent » des graphiques (novembre 2026).
// Aucune couleur de donnée bleue ou orange : ni les jetons d'interface (--new, --info, --ok, --err, --warn, --accent,
// --board-accent, dérivé de l'échiquier, donc bleu sur un échiquier bleu), ni une couleur écrite en dur, ni les anciens
// jetons de série. Seules les règles des graphiques sont lues : boutons, alertes et repères de l'interface gardent leurs
// couleurs. Exception voulue : l'ambre des coups adverses imprévus (Ouvertures › préparation, `.so-ruler i.gap`).
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const ROOT = path.join(__dirname, '../..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = walk(path.join(ROOT, 'css')).filter(f => f.endsWith('.css'));

// Classes des graphiques : Statistiques (so-chart, si-*, sg-*), Progrès (st-trend, st-heat, st-fc, st-wk, st-curve,
// st-cmp, st-dbar, st-late), Ouvertures (so-bar, so-point, so-months, so-ruler, so-x-bar, so-elo), Aujourd'hui (hp-fc, hp-gain).
const CHART = /\.(so-chart|so-leg|si-[a-z]+|sg-[wdl]\b|st-trend|st-heat|st-fc|st-wk-days|st-curve|st-cmp-bar|st-dbar|st-late|so-bar|so-point|so-months|so-ruler|so-dot-me|so-x-bar|so-elo|so-delta|so-lv-|hp-fc|hp-gain|rv-gauge-bar > i)/;
const ALLOWED = /\.so-ruler i\.gap|\.so-dot-gap/;
const UI_TOKENS = /var\(--(new|info|ok|err|warn|accent|accent-bright|accent-dim|board-accent|ui-accent)\)/;
const COLOR_PROPS = /^(fill|stroke|background|background-color|color|border|border-color|box-shadow|outline-color)$/;

// Teinte OKLCH d'un #rrggbb, pour repérer un bleu (200-280°) ou un orange saturé (40-90°, chroma ≥ 0,09).
const lin = c => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
function lch(h) {
    const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .808675766 * s;
    return { C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}
const blueOrOrange = h => { const { C, H } = lch(h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h); return (H >= 200 && H <= 280 && C >= .04) || (H >= 40 && H <= 90 && C >= .09); };

t('graphiques : aucun jeton d\'interface (bleu, ambre, accent de l\'échiquier) dans les règles des graphiques', () => {
    const bad = [];
    for (const f of sheets) {
        for (const [, sel, body] of noComments(fs.readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            if (!CHART.test(sel) || ALLOWED.test(sel)) continue;
            for (const decl of body.split(';')) {
                const [prop, ...v] = decl.split(':'), value = v.join(':');
                if (!COLOR_PROPS.test(prop.trim())) continue;
                if (UI_TOKENS.test(value)) bad.push(`${path.basename(f)} ${sel.trim()} { ${decl.trim()} }`);
                for (const [hx] of value.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) if (blueOrOrange(hx)) bad.push(`${path.basename(f)} ${sel.trim()} : ${hx}`);
            }
        }
    }
    assert.strictEqual(bad.join('\n'), '');
});

t('graphiques : les anciens jetons de série n\'existent plus (css/ et js/)', () => {
    const files = [...sheets, ...walk(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))];
    const bad = files.filter(f => /--(you|opp|blue|orange|accent2|series-[a-z0-9]+|chart-[a-z0-9]+)\b/.test(noComments(fs.readFileSync(f, 'utf8'))));
    assert.deepStrictEqual(bad.map(f => path.relative(ROOT, f)), []);
});

t('graphiques : les scripts des Statistiques, Ouvertures et Aujourd\'hui n\'écrivent ni couleur en dur ni jeton d\'interface', () => {
    const files = [...walk(path.join(ROOT, 'js/screens/stats')), ...walk(path.join(ROOT, 'js/screens/openings')), path.join(ROOT, 'js/shell/app.js')].filter(f => f.endsWith('.js'));
    const bad = [];
    for (const f of files) {
        noComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
            const where = `${path.relative(ROOT, f)}:${i + 1}`;
            if (UI_TOKENS.test(line)) bad.push(`${where} ${line.match(UI_TOKENS)[0]}`);
            for (const [hx] of line.matchAll(/['"`(:\s]#[0-9a-f]{6}\b/gi)) if (blueOrOrange(hx.slice(1))) bad.push(`${where} ${hx.slice(1)}`);
            for (const [rgb, r, g, b] of line.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/g)) if (blueOrOrange('#' + [r, g, b].map(x => (+x).toString(16).padStart(2, '0')).join(''))) bad.push(`${where} ${rgb}`);
        });
    }
    assert.strictEqual(bad.join('\n'), '');
});

t('comparaisons : --data-me, --data-them, --data-neutral en clair, en sombre, en oklch() et sur la carte claire', () => {
    const base = noComments(fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8'));
    const block = sel => { const i = base.indexOf(sel); assert(i >= 0, sel); return base.slice(i, base.indexOf('}', i)); };
    const sup = base.slice(base.indexOf('@supports (color: oklch(0% 0 0))'));
    for (const b of [block(':root, [data-theme="light"] {'), block('\n[data-theme="dark"] {')])
        for (const k of ['data-me', 'data-them', 'data-neutral']) {
            const m = new RegExp(`--${k}:\\s*(#[0-9a-f]{6})`, 'i').exec(b);
            assert(m && !blueOrOrange(m[1]), `--${k} : ${m && m[1]}`);
        }
    assert.strictEqual((sup.match(/--data-(me|them|neutral):\s+oklch\(\d/g) || []).length, 6, 'bloc oklch() : trois jetons × deux thèmes');
    // La carte Maîtrise est sur la surface du thème (audit « Progrès en images », K1) : plus de carte claire en sombre.
    const screens = fs.readFileSync(path.join(ROOT, 'css/screens.css'), 'utf8');
    assert(!screens.includes('[data-theme="dark"] .vel-light {'), 'plus de carte claire .vel-light en sombre');
    // L'adversaire ne dépend pas de la seule couleur : courbe en pointillé.
    assert(/\.so-chart \.si-line\.opp \{[^}]*var\(--data-them\)[^}]*stroke-dasharray/.test(screens), 'courbe adverse en pointillé');
});

console.log(`\n${n} tests réussis.`);
