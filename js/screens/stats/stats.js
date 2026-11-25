/**
 * screens/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques : agir d'abord, comprendre ensuite (refonte de novembre 2026).
 * Les Statistiques observent, l'Entraînement agit : les boutons d'action ouvrent l'exercice d'Entraînement
 * correspondant, déjà filtré (openTrainingFrom, trainingUI.js), sans lancer de séance.
 *   « À faire » : trois constats au plus. Aujourd'hui (révisions dues ; seule action pleine de la page : Révision
 *      du jour, Points faibles quand tout est à jour), l'ouverture qui coûte le plus de points, ce que disent les parties.
 *   Bande « série + médailles » (lot 4 « Chays épuré », _bandHTML) qui ouvre Régularité et Médailles, puis deux onglets
 *   (Répertoire = overview, Parties = games ; les numéros ci-dessous sont l'ancien découpage, gardé pour le contenu) :
 *   1. Maîtrise : part des positions maîtrisées, sa courbe dans le temps (MasteryLog, atelier lot 4 ; la barre tant
 *      qu'il n'y a qu'un relevé) et la légende qui filtre ; retard à part puis prévision sur 7 jours, constats des parties ;
 *      points faibles en cartes « Trouver le coup » (la carte ouvre l'aperçu).
 *      « À confirmer » (trop peu d'essais) est un état à part, hors des barres de niveaux.
 *   2. Ouvertures : liste « miroir » (préparation à gauche, écart à l'attendu à droite) et une seule fiche
 *      (statsOpenings.js) ; chaque position s'affiche en aperçu ou se travaille seule (▶, seule action qui lance
 *      une révision) ; « Réviser cette ouverture » ouvre la Révision du jour filtrée sur elle.
 *   3. Parties : Elo, Bilan, Temps, Qualité, Positions, Répertoire (statsGames.js, statsInsights.js).
 *   4. Régularité, tous répertoires : série, calendrier (12 semaines, grille fluide), réussite par semaine.
 * Une seule barre de filtres, collante : répertoire et couleur ; période, site et cadence sur Ouvertures et Parties.
 *
 * Six niveaux, utilisés partout (Statistiques, Entraînement, arbre du répertoire) ; échelle E3 (_level, levels.js),
 * d'après la série de réussites d'affilée run (runOf, review.js) :
 *   à confirmer     aucune erreur, moins de STATS_CONFIRM_TRIES essais
 *   à retravailler  dernier essai raté (run 0)
 *   fragile         1 réussite d'affilée
 *   en progrès      2
 *   solide          3 ou 4
 *   maîtrisée       5 ou plus (STATS_MASTERED_RUN)
 */

'use strict';

const STATS_WEAK_CARDS    = 4;      // cartes « Trouver le coup » de Progrès (deux par ligne sur téléphone)
const STATS_DAYS          = 30;
const STATS_HEAT_WEEKS    = 12;     // calendrier : une colonne par semaine, de largeur partagée
const STATS_WEAK_PAGE     = 30;     // « Points faibles › Tout voir » : positions montrées avant « Afficher les autres »
const STATS_FORECAST_DAYS = 7;
const STATS_TREND_WEEKS   = 8;

// « À confirmer » est un état (trop peu d'essais pour juger), pas un niveau de maîtrise : il reste hors des barres.
const STATS_STATE = 'unsure';
const STATS_MASTERY_LEVELS = STATS_LEVEL_ORDER.filter(l => l !== STATS_STATE);

let statsColor  = 'all';     // 'w' | 'b' | 'all' ; « Les deux » à chaque lancement
let statsFilter = 'all';     // 'all', un état (learn, doing, known, levels.js) ou 'unsure'
let statsPane   = 'overview'; // vue : onglets 'overview' (Répertoire) | 'games' (Parties) ; par la bande : 'regularity' | 'medals'
let statsWeak   = null;      // vue complète « Points faibles » : { shown, y } (y : défilement de la page quittée), sinon null

// Repère de niveau : couleur ET forme (lisible sans distinguer les couleurs), cf. .lv-mark.
// Lot 3 « Chays épuré » : une position prend le repère de son état (À apprendre, En cours, Sue).
const _lvMark = l => `<i class="lv-mark lv-${levelMark(l)}" aria-hidden="true"></i>`;
// Rang d'une ouverture (atelier « L'envie de revenir », lot 4, OpeningMarks) : trois chevrons, autant de pleins que le rang + 1.
function _opRankHTML(r, cls = '') {
    const name = OpeningMarks.RANKS[r];
    return `<span class="op-rank is-r${r}${cls ? ' ' + cls : ''}" title="Rang : ${name}"><span class="op-rank-m" aria-hidden="true">${[0, 1, 2].map(i => `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span><span class="op-rank-t">${name}</span></span>`;
}
// Gravure progressive (atelier « L'envie de revenir », lot 2) : le trait gravé dont la profondeur suit la maîtrise, doré une fois Maîtrisée.
// À confirmer : jamais plus que rayé, tant que les essais manquent.
function _lvEngrave(e) {
    if (typeof Engrave === 'undefined') return '';
    const lv = _level(e), m = masteryOf(e);
    return Engrave.depth(lv === 'unsure' ? Math.min(m, 49) : m, lv === 'mastered');
}

const _lvPair = (l, n) => I18n.pair(I18n.t(levelInfo(l).label), n);
// Repère d'un groupe (lot 3 « Chays épuré ») : la couleur et la forme de sa case représentative.
const _lvgMark = g => _lvMark(LEVEL_GROUPS[g] ? LEVEL_GROUPS[g].mark : g);
// Nombre de positions d'un filtre (groupe, case ou « À confirmer ») dans des comptes par case.
const _filterCount = (counts, f) => f === 'all' ? 0 : LEVEL_GROUPS[f] ? groupCounts(counts)[f] : counts[f] || 0;

// Barre de répartition en trois états (À apprendre, En cours, Sues) ; counts : { case: nombre }. opts.buttons : un
// bouton par segment, qui filtre la liste comme la légende (statsLegend, ou opts.action) ; opts.active : filtre en
// cours. Sans opts, des <i> décoratifs. opts.legend (accueil, audit « Aujourd’hui en images ») : la barre posée sur une
// plaque claire (.lv-plate, mêmes couleurs sur toute carte et en sombre) et suivie de sa légende écrite, repère de forme
// compris (« 74 à apprendre · 134 en cours · 93 sues ») : le sens ne passe plus par la couleur seule ni par un survol.
function levelBarHTML(counts, cls, opts) {
    const gc = groupCounts(counts), gs = LEVEL_GROUP_ORDER.filter(g => gc[g]);
    if (opts && opts.legend) {
        const lower = t => t.toLocaleLowerCase('fr');            // « 74 à apprendre » : une phrase française, traduite à l'affichage
        return `<span class="lv-plate ${cls || ''}"><span class="lv-bar" aria-hidden="true">${gs
            .map(g => `<i class="lv-${LEVEL_GROUPS[g].mark}" style="flex:${gc[g]}"></i>`).join('')}</span>`
            + `<span class="lv-legend">${gs.map(g => `<span>${_lvgMark(g)}${gc[g]} ${escapeHtml(lower(LEVEL_GROUPS[g].label))}</span>`).join('')}</span></span>`;
    }
    // opts.plate (audit « Progrès en images », K9) : la barre sur sa plaque, « À confirmer » hachuré à la suite, et la
    // légende en boutons qui filtrent (statsLegend) : chaque nombre à côté de son nom, la forme en plus de la couleur.
    if (opts && opts.plate) {
        const lower = t => t.toLocaleLowerCase('fr'), un = counts[STATS_STATE] || 0;
        const on = opts.active && opts.active !== 'all' ? (opts.active === STATS_STATE ? STATS_STATE : levelGroup(opts.active)) : '';
        const n = g => g === STATS_STATE ? un : gc[g] || 0;
        const legend = LEVEL_GROUP_ORDER.concat(STATS_STATE);          // la légende garde ses quatre places, vides éteintes
        const label = g => g === STATS_STATE ? levelInfo(g).label : LEVEL_GROUPS[g].label;
        // La barre filtre comme la légende (lot 7) ; « À confirmer » y est hachuré, hors des boutons.
        const hatch = un ? `<i class="lv-unsure is-hatch" style="flex:${un}" aria-hidden="true"></i>` : '';
        const bar = levelBarHTML(counts, 'st-mbar', { buttons: true, active: opts.active, action: opts.action }).replace(/<\/span>$/, `${hatch}</span>`);
        return `<div class="lv-plate st-plate ${cls || ''}">${bar}`
            + `<span class="lv-legend st-legend" role="group" aria-label="Filtrer la liste par niveau">${legend.map(g => `<button type="button" class="st-lg${on === g ? ' active' : ''}" data-action="${opts.action || 'statsLegend'}" data-arg="${g}" aria-pressed="${on === g}"${n(g) ? '' : ' disabled'} title="${I18n.pair(I18n.t(levelInfo(g).one), I18n.t(levelInfo(g).rule))}">${_lvgMark(g)}<span>${n(g)} ${escapeHtml(lower(label(g)))}</span>${opts.deltas ? opts.deltas(g) : ''}</button>`).join('')}</span></div>`;
    }
    if (!opts || !opts.buttons) return `<span class="lv-bar ${cls || ''}" aria-hidden="true">${gs
        .map(g => `<i class="lv-${LEVEL_GROUPS[g].mark}" style="flex:${gc[g]}" title="${_lvPair(g, gc[g])}"></i>`).join('')}</span>`;
    const on = opts.active && opts.active !== 'all' ? levelGroup(opts.active) : '';
    return `<span class="lv-bar lv-bar-btn${on ? ' has-on' : ''} ${cls || ''}" role="group" aria-label="Filtrer la liste par niveau">${gs.map(g =>
        `<button type="button" class="lv-${LEVEL_GROUPS[g].mark}${on === g ? ' on' : ''}" style="flex:${gc[g]}" data-action="${opts.action || 'statsLegend'}" data-arg="${g}" aria-pressed="${on === g}" title="${_lvPair(g, gc[g])}" aria-label="${I18n.mark(`${I18n.t(LEVEL_GROUPS[g].label)}, ${gc[g]}`)}"></button>`).join('')}</span>`;
}

// Échelle des réussites d'affilée (audit « Progrès en images ») : une marche par niveau (run 0, 1, 2, 3–4, 5 et plus),
// le nombre de positions au-dessus, les trois états dessous ; « À confirmer » reste à part, dit en une phrase.
function _ladderHTML(counts) {
    const steps = [['weak', '0'], ['fragile', '1'], ['progress', '2'], ['solid', `${STATS_SOLID_RUN}–${STATS_MASTERED_RUN - 1}`], ['mastered', `${STATS_MASTERED_RUN} +`]];
    const max = Math.max(1, ...steps.map(([l]) => counts[l] || 0));
    const label = steps.map(([l, k]) => `${k} : ${counts[l] || 0}`).join(', ');
    return `<div class="st-ladder-w"><div class="st-ladder" role="img" aria-label="${escapeHtml(I18n.pair(I18n.t('Positions par réussites d’affilée'), label))}">${steps.map(([l, k]) =>
        `<div class="lv-${l}"><b>${counts[l] || 0}</b><i style="height:${Math.round(6 + 42 * (counts[l] || 0) / max)}px"></i><span>${k}</span></div>`).join('')}</div>
        <div class="st-ladder-g" aria-hidden="true">${LEVEL_GROUP_ORDER.map(g => `<span class="g-${g}">${escapeHtml(LEVEL_GROUPS[g].label)}</span>`).join('')}</div>
        <p class="st-sub"><span>Réussites d’affilée depuis la dernière erreur.</span>${counts[STATS_STATE] ? ` <span>Les positions à confirmer (moins de trois essais) restent à part.</span>` : ''}</p></div>`;
}

const _plural = (n, one, many) => `${n} ${n > 1 ? many || one + 's' : one}`;
const _sideName = c => ({ w: 'Blancs', b: 'Noirs', all: 'Blancs et Noirs' })[c];

// Repère du coup : « 4. e4 » (Blancs) ou « 4… e5 » (Noirs) ; masked : « 4. ? ». html : figurines dessinées.
function _moveLabel(e, masked, html) {
    const fmt = html ? formatSan : formatSanText;
    if (!e.ply) return masked ? '?' : fmt(e.san);
    const n = Math.ceil(e.ply / 2), w = e.ply % 2 === 1, san = masked ? '?' : fmt(e.san, w ? 'w' : 'b');
    // HTML : le numéro en gris (.mv-n, audit « Ouvertures en images », O4 : notation en Mono avec .san).
    const num = html ? `<span class="mv-n">${n}${w ? '.' : '…'}</span>` : `${n}${w ? '.' : '…'}`;
    return `${num} ${san}`;
}

// ─── POSITIONS ET OUVERTURES ──────────────────────────────────────────────────

function _statsRows() {
    repairPaths(currentRepertoire);                             // sans chemin, une position ne se range dans aucune ouverture
    const rows = [];
    (statsColor === 'all' ? ['w', 'b'] : [statsColor]).forEach(side => {
        const db = readDBFor(currentRepertoire, side);
        Object.keys(db).forEach(k => {
            const e = db[k];
            if (e.attempts > 0) rows.push({ k, e, side, lv: _level(e), path: e.path && e.path.length ? e.path : null });
        });
    });
    return rows;
}

// Plus fragiles d'abord : niveau, taux d'erreur, nombre d'essais, ordre du coup.
const _rate = r => 1 - masteryOf(r.e) / 100;
const _byWorst = (a, b) => STATS_LEVEL_ORDER.indexOf(a.lv) - STATS_LEVEL_ORDER.indexOf(b.lv)
    || _rate(b) - _rate(a) || b.e.attempts - a.e.attempts || (a.e.ply || 0) - (b.e.ply || 0);

function _countLevels(list) {
    const c = {};
    STATS_LEVEL_ORDER.forEach(l => { c[l] = 0; });
    list.forEach(r => { c[r.lv]++; });
    return c;
}

// ─── ÉCHIQUIER MINIATURE ──────────────────────────────────────────────────────

// Cadre carré qui contient toutes les pièces (4 cases de côté au moins) ; 7 ou 8 : l'échiquier entier.
function _miniCropBox(cells) {
    let a = 8, b = -1, c = 8, d = -1;
    cells.forEach((p, sq) => { if (!p) return; const f = sq % 8, rk = Math.floor(sq / 8); a = Math.min(a, f); b = Math.max(b, f); c = Math.min(c, rk); d = Math.max(d, rk); });
    if (b < 0) return { f0: 0, r0: 0, n: 8 };
    let n = Math.max(b - a + 1, d - c + 1, 4);
    if (n >= 7) return { f0: 0, r0: 0, n: 8 };
    const clamp = (v) => Math.min(Math.max(0, v), 8 - n);
    return { f0: clamp(Math.round((a + b + 1) / 2 - n / 2)), r0: clamp(Math.round((c + d + 1) / 2 - n / 2)), n };
}

// Position AVANT mon coup (after : APRÈS tout le chemin), orientée de mon côté ; le dernier coup est surligné.
// r = { side: 'w'|'b', path?: [uci…], k?: FEN } ; sans path, la FEN r.k est lue.
// opts = { cls?, label? } : classe ajoutée à .st-mini, libellé lu par les lecteurs d'écran.
function _miniBoardHTML(r, after, opts = {}) {
    let cells = null, last = [];
    _withEngineSnapshot(() => {
        try {
            parseFEN(INIT_FEN);
            if (r.path) {
                const before = after ? r.path : r.path.slice(0, -1);
                before.forEach(u => _applyUciRaw(u));
                const lm = before[before.length - 1];
                if (lm) last = [squareToIdx(lm.slice(0, 2)), squareToIdx(lm.slice(2, 4))];
            } else parseFEN(r.k);
            cells = board.slice();
        } catch (err) { cells = null; }
    });
    if (!cells) return '';
    // opts.crop (audit « Finales en images ») : vue rapprochée sur la zone des pièces, de 4 à 6 cases de côté ;
    // une position plus étalée garde l'échiquier entier. La case du coin bas gauche est écrite (data-at).
    const box = opts.crop ? _miniCropBox(cells) : { f0: 0, r0: 0, n: 8 };
    const n = box.n;
    let html = '';
    for (let i = 0; i < n * n; i++) {
        const row = Math.floor(i / n), col = i % n;
        const f = r.side === 'w' ? box.f0 + col : box.f0 + n - 1 - col, rk = r.side === 'w' ? box.r0 + n - 1 - row : box.r0 + row;
        const sq = rk * 8 + f;
        const dark = (rk + f) % 2 === 0;
        const p = cells[sq];
        html += `<span class="${dark ? 'd' : 'l'}${last.includes(sq) ? ' hl' : ''}">${p && PIECE_SVG[p] ? PIECE_SVG[p] : ''}</span>`;
    }
    const sqName = (f, rk) => 'abcdefgh'[f] + (rk + 1);
    const at = n < 8 ? (r.side === 'w' ? sqName(box.f0, box.r0) : sqName(box.f0 + n - 1, box.r0 + n - 1)) : '';
    const cls = (opts.cls ? ' ' + escapeHtml(opts.cls) : '') + (n < 8 ? ' is-crop' : '');
    const label = escapeHtml((opts.label || (after ? 'Position' : 'Position avant votre coup'))
        + (n < 8 ? `, vue rapprochée de ${sqName(box.f0, box.r0)} à ${sqName(box.f0 + n - 1, box.r0 + n - 1)}` : ''));
    if (n < 8) return `<div class="st-mini${cls}" role="img" aria-label="${label}" style="--n:${n}" data-at="${at}">${html}</div>`;
    // opts.arrow : flèche laiton du dernier coup (À traiter : le coup adverse qui demande une réponse), au-dessus des cases.
    if (opts.arrow && last.length === 2) {
        const at = sq => r.side === 'w' ? [sq % 8 + .5, 7 - Math.floor(sq / 8) + .5] : [7 - sq % 8 + .5, Math.floor(sq / 8) + .5];
        const [[ax, ay], [bx, by]] = last.map(at), L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
        const hx = bx - ux * .5, hy = by - uy * .5, f = n => n.toFixed(2);
        html += `<svg class="st-mini-arrow" viewBox="0 0 8 8" aria-hidden="true"><line x1="${f(ax)}" y1="${f(ay)}" x2="${f(hx)}" y2="${f(hy)}"/>`
            + `<polygon points="${f(bx)},${f(by)} ${f(hx - uy * .4)},${f(hy + ux * .4)} ${f(hx + uy * .4)},${f(hy - ux * .4)}"/></svg>`;
    }
    // opts.arrows (audit « Progrès en images ») : [[uci, 'bad' | 'good']] : votre coup en vermillon, celui du répertoire en
    // laiton, même code que les Finales et les oublis de la fiche d'ouverture.
    if (opts.arrows && opts.arrows.length) {
        const at = sq => r.side === 'w' ? [sq % 8 + .5, 7 - Math.floor(sq / 8) + .5] : [7 - sq % 8 + .5, Math.floor(sq / 8) + .5], f = n => n.toFixed(2);
        html += `<svg class="st-mini-arrow" viewBox="0 0 8 8" aria-hidden="true">${opts.arrows.filter(([u]) => u).map(([u, k]) => {
            const [[ax, ay], [bx, by]] = [squareToIdx(u.slice(0, 2)), squareToIdx(u.slice(2, 4))].map(at), L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
            const hx = bx - ux * .5, hy = by - uy * .5;
            return `<g class="is-${k}"><line x1="${f(ax)}" y1="${f(ay)}" x2="${f(hx)}" y2="${f(hy)}"/><polygon points="${f(bx)},${f(by)} ${f(hx - uy * .4)},${f(hy + ux * .4)} ${f(hx + uy * .4)},${f(hy - ux * .4)}"/></g>`;
        }).join('')}</svg>`;
    }
    return `<div class="st-mini${cls}" role="img" aria-label="${label}">${html}</div>`;
}

// ─── RÉGULARITÉ (tous répertoires) ────────────────────────────────────────────

// Jours consécutifs avec au moins un essai, en remontant depuis aujourd'hui (ou hier si rien aujourd'hui).
// Série de jours actifs, joker de la semaine compris (Habits.streak, atelier « L'envie de revenir », lot 1).
function _streak(act) {
    return Habits.streak(act).n;
}

// Jour à minuit, décalé de `days` jours (jours du calendrier : robuste aux changements d'heure).
const _dayStart = (t, days) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (days || 0)).getTime(); };

function _regularityHTML() {
    const act = readActivity(), now = Date.now(), today = _dayStart(now);
    const dayAt = t => act[dayStamp(t)] || { a: 0, f: 0 };
    let active = 0;
    for (let i = 0; i < STATS_DAYS; i++) if (dayAt(_dayStart(today, -i)).a) active++;
    const st = Habits.streak(act, now), streak = st.n, jokers = new Set(st.jokers);

    // Calendrier : STATS_HEAT_WEEKS semaines du lundi au dimanche, la semaine en cours en dernier.
    const monday = _dayStart(today, -((new Date(today).getDay() + 6) % 7));
    const first  = _dayStart(monday, -7 * (STATS_HEAT_WEEKS - 1));
    const fmt = t => new Date(t).toLocaleDateString(I18n.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    // Une colonne par semaine (lundi en haut), précédée des initiales des jours.
    let heat = [0, 1, 2, 3, 4, 5, 6].map(d => `<span class="st-heat-d" translate="no">${new Date(2024, 0, 1 + d).toLocaleDateString(I18n.locale(), { weekday: 'narrow' }).toUpperCase()}</span>`).join('');
    for (let w = 0; w < STATS_HEAT_WEEKS; w++) {
        for (let d = 0; d < 7; d++) {
            const t = _dayStart(first, w * 7 + d), a = dayAt(t).a;
            const joker = jokers.has(dayStamp(t));
            const cls = t > today ? 'future' : joker ? 'joker' : !a ? '' : a < 10 ? 'h1' : a < 25 ? 'h2' : 'h3';
            heat += `<i class="${cls}${t === today ? ' today' : ''}" title="${t > today ? '' : I18n.pair(fmt(t), joker ? 'joker : la série continue' : I18n.t(_plural(a, 'essai')))}"></i>`;
        }
    }

    // Réussite par semaine (semaines sans essai : pas de point).
    const weeks = [];
    for (let w = STATS_TREND_WEEKS - 1; w >= 0; w--) {
        let a = 0, f = 0;
        for (let d = 0; d < 7; d++) { const x = dayAt(_dayStart(monday, -7 * w + d)); a += x.a; f += x.f; }
        weeks.push(a ? Math.round(100 * (a - f) / a) : null);
    }
    const pts = weeks.map((v, i) => ({ v, i })).filter(p => p.v !== null);
    let chart = '';
    if (pts.length >= 2) {
        const W = 260, H = 96, pl = 4, pr = 30, pt = 16, pb = 18;
        const lo = Math.max(0, Math.floor((Math.min(...pts.map(p => p.v)) - 5) / 10) * 10);
        const hi = Math.min(100, Math.max(lo + 20, Math.ceil((Math.max(...pts.map(p => p.v)) + 2) / 10) * 10));
        const x = i => pl + i * (W - pl - pr) / (STATS_TREND_WEEKS - 1), y = v => pt + (hi - v) * (H - pt - pb) / (hi - lo);
        const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
        const end = pts[pts.length - 1];
        const area = `${line}L${x(end.i).toFixed(1)},${H - pb}L${x(pts[0].i).toFixed(1)},${H - pb}Z`;
        const grid = [lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${W - pr + 4}" y="${y(v) + 3}">${Math.round(v)} %</text>`).join('');
        const startLbl = I18n.mark(new Date(_dayStart(monday, -7 * (STATS_TREND_WEEKS - 1))).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short' }));
        chart = `<div class="st-trend"><span class="st-sub st-trend-h"><span>Réussite par semaine</span><b>${end.v} % cette semaine</b></span>
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Réussite par semaine sur ${STATS_TREND_WEEKS} semaines, ${end.v} % cette semaine">
              ${grid}<path class="ar" d="${area}"/><path class="ln" d="${line}"/>
              ${pts.map(p => `<circle class="pt${p === end ? ' end' : ''}" cx="${x(p.i)}" cy="${y(p.v)}" r="${p === end ? 3.5 : 2.5}"/>`).join('')}
              <text class="ax" x="${x(0)}" y="${H - 4}">${startLbl}</text><text class="ax" x="${x(STATS_TREND_WEEKS - 1)}" y="${H - 4}" text-anchor="end">cette sem.</text>
            </svg></div>`;
    }

    // Positions sues par couleur (répertoire actif), même calcul que partout (knownPct).
    const bySide = ['w', 'b'].map(c => {
        const list = Object.values(readDBFor(currentRepertoire, c)).filter(e => e.attempts > 0);
        if (!list.length) return '';
        const byLv = {}; list.forEach(e => { const l = _level(e); byLv[l] = (byLv[l] || 0) + 1; });
        const pct = knownPct(byLv);                                   // seul calcul de la maîtrise affichée (levels.js)
        return `<div class="st-cmp"><span>${c === 'w' ? 'Blancs' : 'Noirs'}</span><span class="st-cmp-bar"><i style="width:${pct}%"></i></span><b>${pct} %</b></div>`;
    }).join('');

    // Deux groupes : l'assiduité (série, calendrier), puis la qualité (réussite, maîtrise par couleur) ; côte à côte sur ordinateur.
    return `<div class="st-reg-a">
        <div class="st-reg-kpis">${streak ? `<div><b>${_plural(streak, 'jour')}</b><span>d'affilée</span><small class="st-joker">${st.jokerFree ? 'Joker libre cette semaine' : 'Joker utilisé cette semaine'}</small></div>` : ''}<div><b>${active} / ${STATS_DAYS}</b><span>jours actifs</span></div></div>
        <div class="st-heat" style="--weeks:${STATS_HEAT_WEEKS}" role="img" aria-label="Essais par jour sur ${STATS_HEAT_WEEKS} semaines">${heat}</div>
        <div class="st-heat-leg">Peu <i></i><i class="h1"></i><i class="h2"></i><i class="h3"></i> Beaucoup</div></div>
        <div class="st-reg-b">${chart}
        ${bySide ? `<div class="st-cmps"><span class="st-sub">Positions sues par couleur · ${escapeHtml(currentRepertoire)}</span>${bySide}</div>` : ''}</div>`;
}

// ─── COURBE DE MAÎTRISE (atelier « Ouvertures et Progrès », lot 4) ─────────────
// Aires empilées sur 12 semaines, du plus sûr (en bas) au plus fragile (en haut), lues dans l'historique
// MasteryLog (un relevé par jour d'utilisation). « À confirmer » reste hors de l'empilement, comme hors des barres.
const STATS_CURVE_DAYS = 84;
const _logDay = d => { const [y, m, j] = d.split('-').map(Number); return new Date(y, m - 1, j).getTime(); };

// Série de la portée affichée ; le relevé du jour vient d'être écrit par initStats. Moins de deux jours : pas de courbe.
function _masterySeries(now) {
    const sides = statsColor === 'all' ? ['w', 'b'] : [statsColor];
    const s = MasteryLog.series(currentRepertoire, sides, STATS_CURVE_DAYS, now);
    return s.length >= 2 ? s : null;
}

// Part maîtrisée d'un relevé (À confirmer compris dans le total, comme le grand chiffre).
const _knownPctOf = c => knownPct(c, MasteryLog.ORDER);

// Les états bougent-ils ? Un groupe qui varie d'au moins 5 % du total sur la période (sinon trois aires plates :
// un rectangle qui ne dit rien ; la phrase « stable depuis… » suffit).
function _masteryMoves(series) {
    const ORDER = MasteryLog.ORDER, at = (c, g) => LEVEL_GROUPS[g].levels.reduce((n, l) => n + c[ORDER.indexOf(l)], 0);
    const tot = Math.max(1, ...series.map(x => x.counts.reduce((a, b) => a + b, 0)));
    return LEVEL_GROUP_ORDER.some(g => { const v = series.map(x => at(x.counts, g)); return Math.max(...v) - Math.min(...v) >= .05 * tot; });
}

function _masteryCurveHTML(series, now) {
    const W = 520, H = 170, P = { l: 30, r: 6, t: 8, b: 20 };
    // Trois couches (lot 3 « Chays épuré ») : Sues en bas, En cours, À apprendre en haut.
    const ORDER = MasteryLog.ORDER, stack = ['known', 'doing', 'learn'];
    const at = (p, g) => LEVEL_GROUPS[g].levels.reduce((n, l) => n + p.c[ORDER.indexOf(l)], 0);
    const t0 = _logDay(series[0].day), t1 = _dayStart(now), span = Math.max(1, t1 - t0);
    const pts = series.map(x => ({ t: _logDay(x.day), c: x.counts }));
    const total = p => stack.reduce((n, g) => n + at(p, g), 0);
    const max = Math.max(1, ...pts.map(total));
    const step = max <= 10 ? 5 : max <= 50 ? 10 : max <= 200 ? 50 : max <= 500 ? 100 : 250;
    const top = Math.ceil(max / step) * step;
    const X = t => P.l + (t - t0) / span * (W - P.l - P.r), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    let grid = '';
    for (let v = 0; v <= top; v += top / 2) grid += `<line class="g" x1="${P.l}" x2="${W - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${P.l - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`;
    const base = pts.map(() => 0);
    const areas = stack.map(g => {
        const lo = base.slice(), hi = pts.map((p, k) => lo[k] + at(p, g));
        let d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(hi[k]).toFixed(1)}`).join('');
        for (let k = pts.length - 1; k >= 0; k--) d += `L${X(pts[k].t).toFixed(1)},${Y(lo[k]).toFixed(1)}`;
        hi.forEach((v, k) => { base[k] = v; });
        return `<path class="lv-${LEVEL_GROUPS[g].mark}" d="${d}Z"/>`;
    }).join('');
    const fmt = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short' }));
    const last = pts[pts.length - 1], m = at(last, 'known');
    return `<div class="st-curve"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${I18n.pair(I18n.t('Positions par état'), `${fmt(t0)} → ${fmt(last.t)}`)}">
        ${grid}${areas}<circle class="end" cx="${X(last.t).toFixed(1)}" cy="${Y(m).toFixed(1)}" r="3.5"/>
        <text class="ax" x="${P.l}" y="${H - 5}">${fmt(t0)}</text><text class="ax" x="${W - P.r}" y="${H - 5}" text-anchor="end">${I18n.t('aujourd\'hui')}</text>
    </svg></div>`;
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

// Barre de contexte : répertoire et couleur ; période, site et cadence s'y ajoutent sur les onglets qui lisent
// des parties (Ouvertures, Parties). Une seule barre de filtres pour toute la page.
function _renderStatsScope() {
    ColorScope.render(document.getElementById('stats-color'), { options: ['w', 'b', 'all'], value: statsColor, onChange: setStatsColor });
    const rep = document.getElementById('stats-rep');
    if (rep) rep.innerHTML = repertoireDropdownHTML('statsRep');
    _renderStatsFilters();
}

let _statsBare = false;           // page sans essai : la section Parties est visible sans onglet

function _renderStatsFilters() {
    const box = document.getElementById('stats-filters');
    if (!box) return;
    const games = StatsGames.games();
    const show = !statsWeak && !!(games && games.length) && (_statsBare || statsPane === 'games');
    box.innerHTML = show ? StatsInsights.filtersHTML(games) : '';
    box.hidden = !show;
}

const _statsArg = r => escapeHtml(r.side + ':' + r.k);
const _gamesSection = () => `<section class="st-sec st-card edge-card" id="stats-games" data-pane="games">${StatsGames.content()}</section>`;

// Écart à l'attendu en barre divergente autour de zéro (±20 points pleine largeur) ; null : pas assez de parties.
function statsDeltaBar(d) {
    if (d === null || d === undefined) return '<span class="st-dbar is-none" aria-hidden="true"></span>';
    const w = Math.max(3, Math.min(Math.abs(d), 20) / 20 * 50);
    return `<span class="st-dbar ${d >= 0 ? 'up' : 'down'}" aria-hidden="true"><i style="${d >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>`;
}
// Écart de score à l'attendu, en points de pourcentage, écrit « % » partout (arbitrage du 12 novembre 2026).
const _signedPct = d => fmtDelta(d);

// Crans des essais (audit « Progrès en images », K10) : à la place du score 0 à 100, réservé au tri.
function _triesHTML(e) {
    const n = Math.min(e.attempts, 10), x = Math.min(e.failures, n);
    return `<span class="st-tries" role="img" aria-label="${escapeHtml(I18n.mark(`${e.failures} ${e.failures > 1 ? 'erreurs' : 'erreur'} sur ${_plural(e.attempts, 'essai')}`))}">${Array.from({ length: n }, (_, i) => `<i${i >= n - x ? ' class="x"' : ''}></i>`).join('')}</span>`;
}

// Une position fragile : miniature, coup masqué, ouverture, essais ; la ligne entière ouvre l'aperçu.
function _weakRowHTML(r) {
    const mv = r.e.ply ? _moveLabel(r.e, true) : 'Coup à retrouver', from = (r.side === 'w' ? 'Blancs · ' : 'Noirs · ');
    return `
                <button type="button" class="st-wrow lv-${r.lv}" data-action="statsPreview" data-arg="${_statsArg(r)}" data-origin="weak" aria-label="Voir la position ${escapeHtml(mv)}, ${escapeHtml(from + r.gName)}">
                    ${_miniBoardHTML(r, false, { cls: 'st-wmini' })}
                    <span class="st-wrow-txt"><b>${escapeHtml(mv)}</b><small>${statsColor === 'all' ? from : ''}${r.gHtml}</small></span>
                    <span class="st-errs">${_triesHTML(r.e)}${ico('chevron-right')}</span>
                </button>`;
}

// Carte de Progrès (lot 4 ; audit « Progrès en images ») : la position avant mon coup avec la flèche du dernier coup
// adverse (comme À traiter), le numéro du coup (« 2… ? »), les crans des essais et l'ouverture ; la carte ouvre l'aperçu.
function _weakCardHTML(r) {
    const who = r.side === 'w' ? 'Blancs' : 'Noirs';
    const num = r.e.ply ? `${Math.ceil(r.e.ply / 2)}${r.e.ply % 2 ? '.' : '…'}` : '';
    return `
                <button type="button" class="st-wcard lv-${r.lv}" data-action="statsPreview" data-arg="${_statsArg(r)}" data-origin="weak" aria-label="${escapeHtml(I18n.mark(`Trouver le coup des ${who}${num ? `, coup ${num}` : ''} · ${r.gName || ''}`))}">
                    ${_miniBoardHTML(r, false, { cls: 'st-wcard-b', arrow: true, label: `Position avant le coup des ${who}` })}
                    <span class="st-wcard-s"><span class="san">${num ? `<span class="mv-n">${num}</span> ` : ''}?</span>${_triesHTML(r.e)}</span>
                    <b class="st-wcard-q">${r.gHtml}</b>
                </button>`;
}

// « Points faibles › Tout voir » : toutes les positions à retravailler ou fragiles, les plus fragiles d'abord.
function _renderWeakList(body, rows, weakN, relearnN) {
    const all = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort((a, b) => _rate(b) - _rate(a) || b.e.attempts - a.e.attempts);
    const shown = all.slice(0, statsWeak.shown), rest = all.length - shown.length;
    body.className = 'st-body';
    body.innerHTML = `<div class="st-main"><section class="st-sec st-card st-weak edge-card" id="stats-weak-all">
        <button type="button" class="st-link st-back" data-action="statsWeakBack">${ico('chevron-left')}Progrès</button>
        <div class="st-h"><h3>À reprendre</h3><span class="count is-learn">${weakN}</span>${relearnN ? `<span class="st-sub">dont ${relearnN} ratée${relearnN > 1 ? 's' : ''} récemment</span>` : ''}</div>
        <div class="st-wlist">${shown.map(_weakRowHTML).join('')}</div>
        ${rest ? `<button type="button" class="st-more" data-action="statsWeakMore">Afficher les ${rest} autres positions</button>` : ''}
    </section></div>`;
    _renderStatsFilters();
    Bus.emit('ui:refresh');
}

// ─── À FAIRE ──────────────────────────────────────────────────────────────────
// Deux constats au plus, chacun avec son lien : l'ouverture qui coûte le plus de points, ce que disent les parties.
// Une carte sans assez de parties n'existe pas. Plus de carte du jour (lot 2 : elle est dans « Aujourd’hui »).

// Une ligne par constat (audit « Progrès en images », K12) : vignette, phrase, sous-ligne, barre, chevron ; la ligne
// entière ouvre l'onglet ou la vue. La barre reste visible à toutes les largeurs (K15).
const _todoCard = (thumb, claim, sub, ev, go) => `<button type="button" class="st-todo-card${/^games\|repertoire/.test(go) ? ' is-gain' : ''}" data-action="statsTodoGo" data-arg="${escapeHtml(go)}">
        <span class="st-todo-th">${thumb}</span><span class="st-todo-t"><span class="st-claim">${claim}</span><small>${sub}</small>${ev}</span>${ico('chevron-right')}</button>`;

function _todoOpeningCard() {
    const o = StatsOpenings.topLoss();
    if (!o) return '';
    const side = o.side || o.key.split('|')[0], board = o.path && o.path.length ? _miniBoardHTML({ side, path: o.path }, true, { label: o.name || '' }) : `<span class="st-todo-ic">${ico('book')}</span>`;
    return _todoCard(board, `${o.html} <em>${_signedPct(o.delta)}</em>`, side === 'w' ? 'Avec les Blancs' : 'Avec les Noirs', statsDeltaBar(o.delta), 'openings|' + o.key);
}

function _todoGamesCard() {
    const games = StatsGames.games(), MIN = GameInsights.MIN;
    if (!games || !games.length) return '';
    const list = games.filter(g => StatsInsights.keep(g));
    if (list.length < MIN) return '';
    const en = GameInsights.ends(list);
    if (en.losses.n >= MIN && en.losses.time >= 20) {
        const v = Math.round(en.losses.time);
        return _todoCard(`<span class="st-todo-ic">${ico('rotate-ccw')}</span>`, `<em>${v} %</em> de vos défaites se jouent au temps`, 'Fins de partie',
            `<span class="st-dbar is-share" aria-hidden="true"><i style="width:${v}%"></i></span>`, 'games|temps');
    }
    const s = OpeningReport.summarize(list);
    if (s.delta !== null && s.delta <= -3) return _todoCard(`<span class="st-todo-ic">${ico('swords')}</span>`, `Score <em>${_signedPct(s.delta)}</em> face à l'attendu`, _plural(s.n, 'partie'), statsDeltaBar(s.delta), 'games|bilan');
    return '';
}

// Ce que le répertoire rapporte (atelier « L'envie de revenir », lot 4 ; quitté Aujourd'hui au lot 1 « Chays épuré ») :
// seulement quand le suivre fait gagner au moins 1 % face à l'attendu (OpeningReport.payoff), jamais de reproche.
function _todoPayoffCard() {
    if (typeof OpeningReport === 'undefined' || typeof StatsGames === 'undefined') return '';
    const rows = StatsGames.analysed();
    if (!rows || !rows.length) return '';
    const p = OpeningReport.payoff(rows, Date.now()), gain = p.gain === null ? 0 : Math.round(p.gain);
    if (gain < 1) return '';
    return _todoCard(`<span class="st-todo-ic">${ico('book')}</span>`, `Le suivre vous fait marquer <em>${fmtDelta(gain)}</em>`,
        'Suivi contre quitté, sur un an', statsDeltaBar(Math.min(gain, 20)), 'games|repertoire');
}

function _paintTodo() {
    const box = document.getElementById('stats-todo');
    if (!box) return;
    const cards = [_todoOpeningCard(), _todoGamesCard(), _todoPayoffCard()].filter(Boolean);
    box.className = `st-todo st-card edge-card n-${cards.length}`;
    box.innerHTML = cards.length ? `<div class="st-h"><h3>À regarder</h3><span class="count">${cards.length}</span></div><div class="st-todo-rows">${cards.join('')}</div>` : '';
}

// ─── ONGLETS ──────────────────────────────────────────────────────────────────
// Maîtrise, Ouvertures, Parties, Régularité, à toutes les largeurs : chaque chiffre garde sa place.
// Le compteur d'un onglet dit la taille de ce qu'il contient ; ceux qui dépendent des parties suivent leur arrivée.
// ─── LA SEMAINE EN UNE CARTE (atelier « L'envie de revenir », lot 5, WeekCard) ──
// La semaine en cours le dimanche, sinon la précédente ; comparée à celle d'avant ; une phrase ; les huit d'avant repliées.
function _weekCardHTML(now) {
    if (typeof WeekCard === 'undefined') return '';
    const act = readActivity(), from = WeekCard.shown(now), w = WeekCard.week(act, currentRepertoire, from);
    const hist = WeekCard.history(act, currentRepertoire, now, 8), prev = hist[0], sunday = new Date(now).getDay() === 0;
    if (!w.tries && !hist.some(h => h.tries)) return '';
    // Semaine au repos : une ligne calme, jamais quatre zéros (audit « Progrès en images »).
    if (!w.tries) return `<p class="st-week st-rest" data-pane="regularity"><span>${escapeHtml(WeekCard.line(w, prev))}</span></p>`;
    const span = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short' }));
    const range = f => I18n.mark(`${span(f)} – ${span(_dayStart(f, 6))}`);
    const top = Math.max(1, ...w.days);
    const bars = w.days.map((a, i) => `<div title="${I18n.mark(`${new Date(_dayStart(from, i)).toLocaleDateString(I18n.locale(), { weekday: 'long' })} · ${a}`)}"><i style="height:${a ? 6 + Math.round(42 * a / top) : 2}px"${a ? '' : ' class="zero"'}></i><span>${new Date(_dayStart(from, i)).toLocaleDateString(I18n.locale(), { weekday: 'narrow' })}</span></div>`).join('');
    const diff = prev.tries ? w.tries - prev.tries : null;
    const kpi = (label, v, sub) => `<div class="st-wk-kpi kpi"><span>${label}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const sure = w.sure === null ? '–' : fmtDelta(w.sure, '');
    const row = h => `<li><span>${range(h.from)}</span><b>${_plural(h.tries, 'position')}</b><small>${h.sure === null ? '' : I18n.mark(`${h.sure > 0 ? '+' : h.sure < 0 ? '−' : ''}${Math.abs(h.sure)}`)}</small></li>`;
    return `<section class="st-sec st-card st-week edge-card" data-pane="regularity">
        <div class="st-h"><h3>${sunday ? 'Votre semaine' : 'La semaine dernière'}</h3><span class="st-sub">${range(from)}</span></div>
        <div class="st-wk">
            <div class="st-wk-days" role="img" aria-label="${I18n.pair(I18n.t('Positions révisées'), String(w.tries))}">${bars}</div>
            <div class="st-wk-kpis">
                ${kpi('Positions révisées', w.tries, diff === null ? '' : I18n.mark(`${fmtDelta(diff, '')} ${I18n.t('par rapport à la semaine d’avant')}`))}
                ${kpi('Du premier coup', w.rate === null ? '–' : `${w.rate} %`)}
                ${kpi('Positions sues', sure, 'Solides et maîtrisées')}
                ${kpi('Temps', w.minutes ? `≈ ${w.minutes} min` : '–', _plural(w.active, 'jour actif', 'jours actifs'))}
            </div>
        </div>
        <p class="st-wk-line">${escapeHtml(WeekCard.line(w, prev))}</p>
        <details class="st-wk-hist"><summary>Semaines précédentes</summary><ol>${hist.map(row).join('')}</ol></details>
    </section>`;
}

// Médailles tout juste gagnées (bilan de séance, fin de finale) : la pièce frappée une fois, son nom, ce qu'elle dit.
function _medalsWonHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="md-won">${list.map(m => `<div class="md-won-i"><span class="md-coin" translate="no" aria-hidden="true">${escapeHtml(m.glyph)}</span>
        <span><span class="st-eyebrow">Médaille</span><b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.desc)}</small></span></div>`).join('')}</div>`;
}

// ─── VITRINE DE MÉDAILLES (lot 5, Medals) ──────────────────────────────────────
// Médaillier en laiton (chantier « Progrès : qualité et médailles », point 8, direction A) : les gagnées frappées, avec leur
// date (« Nouvelle » trois jours) ; les autres en creux, l'avancée en anneau autour de la pièce. En tête, « Prochaine médaille »
// (Medals.next) : la pièce, ce qu'il manque, et la piste de sa catégorie (étapes de la même unité).
function _medalCoinSVG(m, size = 60) {
    const c = size / 2, r = c - 5, C = 2 * Math.PI * r, p = m.goal ? Math.min(1, m.v / m.goal) : 0, g = escapeHtml(m.glyph), fs = (m.glyph.length > 2 ? .26 : m.glyph.length > 1 ? .32 : .38) * size;
    if (m.at) return `<svg class="md-medal is-on" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="md-face" cx="${c}" cy="${c}" r="${r + 2}"/><circle class="md-rim" cx="${c}" cy="${c}" r="${r - 2.5}"/><circle class="md-grain" cx="${c}" cy="${c}" r="${r - 6}"/><text class="md-g" x="${c}" y="${c}" dy=".35em" text-anchor="middle" font-size="${fs.toFixed(1)}" translate="no">${g}</text></svg>`;
    return `<svg class="md-medal" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="md-ring" cx="${c}" cy="${c}" r="${r}"/>${p > 0 ? `<circle class="md-prog" cx="${c}" cy="${c}" r="${r}" stroke-dasharray="${(p * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` : ''}<circle class="md-hollow" cx="${c}" cy="${c}" r="${r - 7}"/><text class="md-g" x="${c}" y="${c}" dy=".35em" text-anchor="middle" font-size="${(fs * .9).toFixed(1)}" translate="no">${g}</text></svg>`;
}

// Piste de la prochaine médaille : une étape par médaille de la même unité, le trait de laiton avance jusqu'à la valeur actuelle.
function _medalTrackSVG(nx) {
    const steps = nx.track, W = 260, H = 44, L = 14, R = 26, x = i => steps.length < 2 ? W / 2 : L + i * (W - L - R) / (steps.length - 1), v = nx.medal.v;
    let last = -1;
    const won = s => !!s.at || s.v >= s.goal;          // une médaille gagnée le reste, même si le chiffre redescend
    steps.forEach((s, i) => { if (won(s)) last = i; });
    const nextI = steps.indexOf(nx.medal), prevGoal = last >= 0 ? steps[last].goal : 0, frac = nextI > last && steps[nextI].goal > prevGoal ? (v - prevGoal) / (steps[nextI].goal - prevGoal) : 0;
    const px = last < 0 ? L + frac * (x(nextI) - L) : x(last) + Math.max(0, Math.min(1, frac)) * (x(nextI) - x(last));
    let g = `<line class="md-tr-base" x1="${L}" x2="${W - R}" y1="14" y2="14"/><line class="md-tr-on" x1="${L}" x2="${px.toFixed(1)}" y1="14" y2="14"/>`;
    steps.forEach((s, i) => {
        const on = won(s), cur = s === nx.medal;
        g += `<circle class="md-tr-dot${on ? ' on' : ''}${cur ? ' cur' : ''}" cx="${x(i)}" cy="14" r="${cur ? 9 : 7}"/><text class="md-tr-t${on ? ' on' : ''}" x="${x(i)}" y="14" dy=".35em" text-anchor="middle">${escapeHtml(String(s.goal))}</text>`;
        if (cur) g += `<text class="md-tr-v" x="${x(i)}" y="38" text-anchor="middle">${I18n.mark(`${s.v} / ${s.goal}`)}</text>`;
    });
    return `<svg class="md-track" viewBox="0 0 ${W} ${H}" role="img" aria-label="${I18n.mark(`${v} / ${nx.medal.goal}`)}">${g}</svg>`;
}

function _medalsHTML(now) {
    if (typeof Medals === 'undefined') return '';
    const list = Medals.list({}, now), got = list.filter(m => m.at).length, nx = Medals.next(list);
    const day = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short', year: 'numeric' }));
    const one = m => `<li class="md${m.at ? ' is-on' : ''}${m.fresh ? ' is-new' : ''}" title="${escapeHtml(m.desc)}">
        ${_medalCoinSVG(m)}
        <span class="md-t"><b>${escapeHtml(m.name)}</b>
        ${m.at ? `<em>${m.fresh ? `${I18n.t('Nouvelle')} · ` : ''}${day(m.at)}</em>` : `<em>${I18n.mark(`${m.v} / ${m.goal}`)}</em>`}<small>${escapeHtml(m.desc)}</small></span></li>`;
    const left = nx && nx.words ? `Encore ${_plural(nx.left, nx.words[0], nx.words[1])}` : nx ? escapeHtml(nx.medal.desc) : '';
    const next = nx ? `<div class="md-next">${_medalCoinSVG(nx.medal, 64)}<span class="md-next-t"><span class="st-eyebrow">Prochaine médaille</span><b>${escapeHtml(nx.medal.name)}</b><small>${left}</small></span>${nx.track.length > 1 ? _medalTrackSVG(nx) : ''}</div>` : '';
    return `<section class="st-sec st-card st-medals edge-card" data-pane="medals">
        <div class="st-h"><h3>${got > 1 ? `${got} médailles sur ${list.length}` : `${got} médaille sur ${list.length}`}</h3><span class="st-sub">Vitrine</span></div>
        ${next}
        ${Medals.CATS.map(([c, label]) => `<div class="md-cat"><span class="st-eyebrow">${label}</span><ul class="md-grid">${list.filter(m => m.cat === c).map(one).join('')}</ul></div>`).join('')}
    </section>`;
}

function _activeDays() {
    const act = readActivity(), today = _dayStart(Date.now());
    let n = 0;
    for (let i = 0; i < STATS_DAYS; i++) if ((act[dayStamp(_dayStart(today, -i))] || {}).a) n++;
    return n;
}

function _tabCounts(rows) {
    const games = StatsGames.games();
    const medals = typeof Medals !== 'undefined' ? Medals.list({}) : [];
    return { medals: `${medals.filter(m => m.at).length}/${medals.length}`, overview: rows.length, openings: StatsOpenings.count(), games: games && games.length ? games.length : '', regularity: `${_activeDays()}/${STATS_DAYS}` };
}

// ─── BANDE : SÉRIE ET MÉDAILLES (bilan « Chays épuré », lot 4) ─────────────────
// Régularité et Médailles ne sont plus des onglets : une bande en tête de Progrès les résume et les ouvre ; la vue
// ouverte a un retour « ‹ Progrès » à la place des onglets.
const STATS_BAND_PANES = ['regularity', 'medals'];
function _bandHTML(hasAct, now) {
    const items = [];
    if (hasAct && typeof Habits !== 'undefined') {
        const act = readActivity(), st = Habits.streak(act, now), days = _activeDays();
        const head = st.n > 1 ? `<b>${st.n} jours d’affilée</b>` : `<b><span class="mono">${days} / ${STATS_DAYS}</span> <span>jours actifs</span></b>`;
        items.push(`<button type="button" class="st-band-i" data-action="statsPane" data-arg="regularity">
            <span class="st-band-t">${head}<span class="st-band-wk">${WeekRibbon.week(act, now)}<small>Régularité</small></span></span>${ico('chevron-right')}</button>`);
    }
    if (typeof Medals !== 'undefined') {
        const list = Medals.list({}, now), got = list.filter(m => m.at).length, nx = Medals.next(list);
        const left = nx && nx.words ? `Encore ${_plural(nx.left, nx.words[0], nx.words[1])}` : '';
        items.push(`<button type="button" class="st-band-i has-coin" data-action="statsPane" data-arg="medals">
            <span class="st-band-ic is-brass">${nx ? _medalCoinSVG(nx.medal, 34) : ico('shield-check')}</span>
            <span class="st-band-t"><b>${got > 1 ? `${got} médailles sur ${list.length}` : `${got} médaille sur ${list.length}`}</b>${nx ? `<small><span>${escapeHtml(nx.medal.name)}</span>${left ? `<span> · </span><span>${left}</span>` : ''}</small>` : ''}</span>${ico('chevron-right')}</button>`);
    }
    return items.length ? `<div class="st-band" role="group" aria-label="Régularité et médailles">${items.join('')}</div>` : '';
}

// Ce que compte chaque compteur d'onglet, dit en infobulle.
const STATS_TAB_UNITS = { medals: 'Médailles gagnées', overview: 'Positions du répertoire', openings: 'Ouvertures', games: 'Parties archivées', regularity: 'Jours actifs sur les 30 derniers' };
function _tabsHTML(tabs, counts) {
    return `<div class="st-tabs" id="stats-tabs" role="tablist" aria-label="Vues">${tabs.map(([p, l]) =>
        `<button type="button" role="tab" class="st-tab" aria-selected="${statsPane === p}" data-action="statsPane" data-arg="${p}">${l}<span class="count st-tab-n" id="st-tab-n-${p}" title="${STATS_TAB_UNITS[p]}">${counts[p]}</span></button>`).join('')}</div>`;
}

// Appelé quand les parties arrivent ou sont croisées avec le répertoire : filtres, constats et compteurs.
function statsSyncChrome() {
    if (!document.getElementById('stats-body')) return;
    _renderStatsFilters();
    _paintTodo();
    const games = StatsGames.games(), set = (p, v) => { const el = document.getElementById('st-tab-n-' + p); if (el) el.textContent = v; };
    set('games', games && games.length ? games.length : '');
    set('openings', StatsOpenings.count());
}
Bus.on('games:analysed', statsSyncChrome);

function initStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;
    MasteryLog.record(currentRepertoire);                     // historique de maîtrise : relevé du jour (atelier, lot 3)
    if (typeof Medals !== 'undefined') Medals.check();       // médailles déjà méritées (lot 5) : rangées, « Nouvelle » dans la vitrine

    const rows = _statsRows();
    const hasAct = Object.keys(readActivity()).length > 0;
    const reg = hasAct ? `<section class="st-sec st-card edge-card st-regcard" data-pane="regularity"><div class="st-h"><h3>Régularité</h3><span class="st-sub">tous répertoires</span></div><div class="st-reg">${_regularityHTML()}</div></section>` : '';

    // États vides : aucun essai dans la portée (l'Entraînement les fera apparaître ; Jouer ne compte rien),
    // ou aucune position enregistrée (Ajouter une ligne, vers Jouer). Sans onglet : tout ce qui existe s'affiche.
    if (!rows.length) {
        _statsBare = true;
        _renderStatsScope();
        const sides = statsColor === 'all' ? ['w', 'b'] : [statsColor];
        const stored = sides.reduce((n, side) => n + Object.keys(readDBFor(currentRepertoire, side)).length, 0);
        const side = statsColor === 'all' ? '' : ` avec les ${_sideName(statsColor)}`;
        const empty = stored ? {
            icon: 'bar-chart', title: `Aucun essai pour « ${escapeHtml(currentRepertoire)} »`,
            sub: `${_plural(stored, 'position enregistrée', 'positions enregistrées')}${side}, aucune encore révisée.`,
            btn: `<button type="button" class="btn btn-primary" data-action="statsGoTraining" data-arg="due">Ouvrir l'Entraînement ${ico('chevron-right')}</button>`
        } : {
            icon: 'plus', title: 'Répertoire vide',
            sub: `${statsColor === 'all' ? 'Les Blancs et les Noirs n\'ont' : `Les ${_sideName(statsColor)} n'ont`} aucune position dans « ${escapeHtml(currentRepertoire)} ».`,
            btn: `<button type="button" class="btn btn-primary" data-action="statsAddLine">${ico('plus')}Ajouter une ligne</button>`
        };
        body.className = 'st-body';
        body.innerHTML = `<div class="st-main"><section class="st-card st-empty edge-card"><span class="st-empty-i">${ico(empty.icon)}</span>
            <b>${empty.title}</b><span>${empty.sub}</span>${empty.btn}</section>${_gamesSection()}${reg}</div>`;
        StatsGames.mount();
        return;
    }
    _statsBare = false;

    const now = Date.now();
    const counts = _countLevels(rows);
    if (statsFilter !== 'all' && !_filterCount(counts, statsFilter)) statsFilter = 'all';     // le filtre actif s'est vidé

    // Programme des révisions (reviewPlan), pour la prévision. La carte du jour et son action ont rejoint
    // « Aujourd’hui » (refonte « Chays sans détour », lot 2) : Progrès observe, sans bouton « réviser ».
    const rp = reviewPlan(currentRepertoire, now), inScope = c => statsColor === 'all' || c === statsColor;

    // Prévision : un total par jour, sans détail par niveau, jamais plus que l'objectif du jour (chantier « Révision du
    // jour »). Le retard (révisions échues qui attendent au-delà de l'objectif, plan.held) est à part, avec son propre chiffre.
    const late = rp.held(inScope), fc = rp.forecast(inScope, STATS_FORECAST_DAYS), cu = late ? rp.catchUp() : null;
    // Ruban prolongé de l'accueil (audit « Progrès en images », K8) : six jours passés, les 7 prochains, et le retard en
    // pile hachurée au-dessus d'aujourd'hui, avec sa date de rattrapage en légende.
    const forecastCard = `
        <div class="st-card st-fcard edge-card">
            <div class="st-h"><h3>${STATS_FORECAST_DAYS} prochains jours</h3><span class="count">${fc.reduce((a, b) => a + b, 0)}</span></div>
            ${WeekRibbon.span(fc, now, readActivity(), { bare: true, held: late, catchUp: cu ? escapeHtml(catchUpLabel(cu, now)) : '' })}
        </div>`;

    // ── Maîtrise ── le grand chiffre, la barre légendée qui filtre (K9), la courbe seulement quand les états bougent,
    // l'échelle des réussites d'affilée, puis la réussite en pied. Carte sur la surface du thème (K1).
    const totA = rows.reduce((s, r) => s + r.e.attempts, 0), totF = rows.reduce((s, r) => s + r.e.failures, 0);
    const mastery = knownPct(counts), gcount = groupCounts(counts);
    const series = _masterySeries(now), first = series && series[0].counts;
    const gain = series ? Math.round(mastery - _knownPctOf(first)) : 0;
    const firstG = series ? groupCounts(Object.fromEntries(MasteryLog.ORDER.map((l, i) => [l, first[i]]))) : null;
    const lvDelta = g => {
        if (!series || g === STATS_STATE) return '';
        const d = gcount[g] - firstG[g], good = g === 'learn' ? d < 0 : d > 0;
        return d ? `<small class="st-lg-d${good ? ' up' : ''}">${fmtDelta(d, '')}</small>` : '';
    };
    const since = series ? I18n.mark(new Date(_logDay(series[0].day)).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'long' })) : '';
    const moving = series && _masteryMoves(series);
    const masteryCard = `
        <div class="st-card st-mastery edge-card">
            <span class="st-eyebrow">Maîtrise · ${_plural(rows.length, 'position')}</span>
            <div class="st-big"><b>${mastery} %</b><span>sues</span>${series ? (gain ? `<em class="st-gain ${gain > 0 ? 'up' : 'down'}">${fmtDelta(gain)}</em><small class="st-since">depuis le ${since}</small>` : `<small class="st-since">stable depuis le ${since}</small>`) : ''}</div>
            ${levelBarHTML(counts, '', { plate: true, active: statsFilter, deltas: lvDelta })}
            ${moving ? _masteryCurveHTML(series, now) : series ? '' : `<span class="st-curve-note">La courbe commence avec ce relevé : un point par jour d'utilisation.</span>`}
            ${_ladderHTML(counts)}
            <span class="st-foot">Réussite : ${Math.round(100 * (totA - totF) / totA)} % sur ${_plural(totA, 'essai')}</span>
        </div>`;

    // ── Points faibles ── la ligne entière ouvre l'aperçu (où « S'entraîner » reste) ; Progrès n'a plus de bouton d'exercice (lot 5).
    const weakest = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort((a, b) => _rate(b) - _rate(a) || b.e.attempts - a.e.attempts).slice(0, STATS_WEAK_CARDS);
    _assignOpenings(rows);
    const weakN = counts.weak + counts.fragile, relearnN = rows.filter(r => Number.isInteger(r.e.relearn)).length;
    if (statsWeak) {
        if (weakN) { _renderStatsScope(); _renderWeakList(body, rows, weakN, relearnN); return; }
        statsWeak = null;                                       // plus rien à montrer : retour à la page
    }
    const weakHTML = !weakest.length ? '' : `
        <section class="st-sec st-card st-weak edge-card">
            <div class="st-h"><h3>À reprendre</h3><span class="count is-learn">${weakN}</span>${weakN > weakest.length ? `<button type="button" class="st-link" data-action="statsWeakAll">Tout voir</button>` : ''}${relearnN ? `<span class="st-sub st-h-sub">dont ${relearnN} ratée${relearnN > 1 ? 's' : ''} récemment</span>` : ''}</div>
            <div class="st-wcards">${weakest.map(_weakCardHTML).join('')}</div>
            <p class="st-sub">Flèche : le dernier coup adverse. Crans : vos derniers essais, les ratés en vermillon.</p>
        </section>`;

    // ── Par ouverture ── la fiche vit dans l'onglet Ouvertures (lot 3) ; ici, seulement de quoi nourrir le constat « À faire ».
    StatsOpenings.prime({ rows, counts, rp });

    // Deux onglets (lot 4 « Chays épuré ») : Répertoire et Parties ; Régularité et Médailles s'ouvrent par la bande.
    const tabs = [['overview', 'Répertoire'], ['games', 'Parties']];
    if (!tabs.some(([p]) => p === statsPane) && !(STATS_BAND_PANES.includes(statsPane) && (statsPane !== 'regularity' || reg))) statsPane = 'overview';
    const inBand = STATS_BAND_PANES.includes(statsPane);
    const head = inBand ? `<div class="st-tabs st-tabs-back"><button type="button" class="st-link st-back" data-action="statsPane" data-arg="overview">${ico('chevron-left')}Progrès</button></div>`
        : `${_bandHTML(hasAct, now)}${_tabsHTML(tabs, _tabCounts(rows))}`;
    _renderStatsScope();

    body.className = 'st-body pane-' + statsPane;
    body.innerHTML = `
        ${head}
        <div class="st-main">
            <section class="st-now" data-pane="overview">${masteryCard}<div class="st-side">${forecastCard}
                <section class="st-todo" id="stats-todo" aria-label="À faire"></section></div></section>
            <div class="st-weak-wrap" data-pane="overview">${weakHTML}</div>
            ${_gamesSection()}
            ${reg}
            ${_weekCardHTML(now)}
            ${_medalsHTML(now)}
        </div>`;
    _paintTodo();
    StatsGames.mount();
    Bus.emit('ui:refresh');             // téléphone : le centre du dock porte l'action de la page
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

function setStatsColor(c) {
    statsColor = c;
    statsFilter = 'all';
    initStats();
}

// Onglet Ouvertures : la puce du répertoire et le retour depuis l'Analyse passent par ici (liens déjà tolérés vers la coquille).
const statsRepHTML = () => repertoireDropdownHTML('statsRep');
const statsBackToOpenings = () => goHome('openings');
const statsBackToProgress = () => goHome('stats');       // « Et si » (lot 6) : Quitter revient à Progrès

// Progrès et Ouvertures partagent couleur, filtre de niveau et filtres des parties : les deux suivent.
function statsRerender() {
    initStats();
    if (typeof OpeningsTab !== 'undefined') OpeningsTab.refresh();
}

function _parseStatsArg(arg) {
    const i = arg.indexOf(':');
    return { side: arg.slice(0, i), key: arg.slice(i + 1) };
}

// Les Statistiques observent, l'Entraînement agit : les boutons d'action ouvrent l'exercice correspondant,
// déjà filtré (couleur, et ouverture pour « Réviser cette ouverture »). arg : 'due' | 'weak' | 'due:<ouverture>'.
function statsGoTraining(arg) {
    const i = arg.indexOf(':');
    if (i < 0) { openTrainingFrom({ color: statsColor, focus: arg }); return; }
    const key = arg.slice(i + 1), side = key.slice(0, key.indexOf('|'));
    openTrainingFrom({ color: side, opening: { key, name: key.slice(key.indexOf('|') + 1) }, focus: arg.slice(0, i) });
}

registerActions({
    statsColor: c => setStatsColor(c),
    statsRep: name => { if (name !== currentRepertoire) selectRepertoire(name); },
    statsFilter: f => { statsFilter = (f !== 'all' && statsFilter === f) ? 'all' : f; statsRerender(); },
    // Légende de la maîtrise : le niveau filtre les coups des fiches d'ouverture, dans l'onglet Ouvertures (lot 3).
    statsLegend: f => {
        statsFilter = statsFilter === f ? 'all' : f;
        StatsOpenings.reset();                                      // la première ouverture concernée s'ouvre
        initStats();
        if (statsFilter === 'all') return;
        switchHomeTab('openings');
        window.scrollTo({ top: 0 });
    },
    statsWeakAll: () => { statsWeak = { shown: STATS_WEAK_PAGE, y: window.scrollY || 0 }; initStats(); window.scrollTo({ top: 0 }); },
    statsWeakMore: () => { statsWeak.shown += STATS_WEAK_PAGE; initStats(); },
    statsWeakBack: () => { const y = statsWeak ? statsWeak.y : 0; statsWeak = null; initStats(); window.scrollTo({ top: y }); },
    statsPane: p => { statsPane = p; initStats(); window.scrollTo({ top: 0 }); },
    // Action d'un constat « À faire » : 'openings|<clé de l'ouverture>' ou 'games|<vue>'.
    statsTodoGo: arg => {
        const i = arg.indexOf('|'), pane = arg.slice(0, i), what = arg.slice(i + 1);
        if (pane === 'openings') { StatsOpenings.show(what); switchHomeTab('openings'); window.scrollTo({ top: 0 }); return; }
        StatsInsights.show(what);
        statsPane = pane;
        initStats();
        window.scrollTo({ top: 0 });
    },
    statsAddLine: () => startGame(statsColor === 'b' ? 'b' : 'w'),    // répertoire vide : Jouer, où mon coup s'enregistre
    statsGoTraining: arg => statsGoTraining(arg),
    statsGoEndgame: cat => { switchHomeTab('endgame'); requestAnimationFrame(() => jumpEndgameCategory(cat)); },
    statsTrain: arg => { const { side, key } = _parseStatsArg(arg); startReviewQueue([{ color: side, key }], 'stats'); },
    statsPreview: (arg, el) => { const { side, key } = _parseStatsArg(arg); openStatsPreview(side, key, el && el.dataset.origin); }
});

// Aperçu en lecture seule de la position AVANT mon coup ; le coup attendu reste masqué.
// origin : 'weak' (liste « Points faibles ») ou le nom de l'ouverture d'où l'on vient ; avec le défilement,
// il sert au bouton de retour (statsBack), qui rouvre la même liste au même endroit.
let statsPreviewTarget = null;
function openStatsPreview(side, key, origin) {
    const e = readDBFor(currentRepertoire, side)[key];
    if (!e) return;
    const from = typeof OpeningsTab !== 'undefined' && OpeningsTab.visible() ? 'openings' : 'stats';
    statsPreviewTarget = { color: side, key, origin: origin || '', scrollY: window.scrollY || 0, from };
    _renderStatsBack(_level(e), origin);
    _renderPreviewFacts(e);
    playerColor = side;
    gameMode    = 'preview';
    showGameScreen(side);
    if (e.path) {
        loadPositionFromPath(e.path.slice(0, -1));
    } else {
        loadPositionFromPath([]);
        parseFEN(key);
        renderBoard();
    }
    setStatus(`Aperçu · ${_moveLabel(e, true)}`, 'info', `${levelInfo(_level(e)).one} · maîtrise ${Math.round(masteryOf(e))} / 100 (${e.failures} err. / ${e.attempts})`);
}

// Trois faits sous la barre d'état (niveau, erreurs, prochaine révision), dans le panneau latéral : montrés
// sur ordinateur seulement (css/screens.css), le détail de la barre d'état suffit sur téléphone. L'élément est
// créé à la première ouverture, avec data-modes="preview" : applyModeUI le cache dans les autres modes.
function _renderPreviewFacts(e) {
    let box = document.getElementById('stats-facts');
    const bar = document.getElementById('status-bar');
    if (!box) {
        if (!bar) return;
        box = document.createElement('div');
        box.id = 'stats-facts';
        box.className = 'st-facts';
        box.dataset.modes = 'preview';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'Cette position');
        bar.after(box);
    }
    const lv = _level(e), d = isDue(e, Date.now());
    box.innerHTML = `<div class="lv-${levelMark(lv)}"><span>État</span><b>${_lvMark(lv)}${levelInfo(lv).one}</b></div>
        <div title="${e.failures} err. / ${e.attempts}"><span>Maîtrise</span><b class="st-n">${Math.round(masteryOf(e))} / 100</b></div>
        ${Number.isInteger(e.relearn) ? `<div><span>À reprendre</span><b class="st-n">${e.relearn} / ${RELEARN_DAYS.length}</b></div>` : ''}
        <div><span>Révision</span><b${d ? ' class="on"' : ''}>${d ? 'Aujourd’hui' : dueInLabel(dueOf(e))}</b></div>`;
}

// Barre du haut pendant l'aperçu : « ‹ Statistiques », puis la catégorie de la position en puce (marque + niveau)
// et la liste quittée (Points faibles ou nom de l'ouverture).
function _renderStatsBack(lv, origin) {
    const btn = document.getElementById('stats-back'), cat = document.getElementById('stats-cat');
    if (!btn || !cat) return;
    const where = origin === 'weak' ? 'À reprendre' : origin || '';
    const label = `Retour à Progrès${where ? ' · ' + where : ''}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    cat.innerHTML = `<span class="lv-chip lv-${levelMark(lv)}">${_lvMark(lv)}${levelInfo(lv).one}</span>${where ? `<span class="tp-origin">· ${escapeHtml(where)}</span>` : ''}`;
}

// Une ligne de partie à travailler : ouverte dans Jouer, où la réponse s'enregistre.
function statsOpenLine(color, path) { startGame(color); loadPositionFromPath(path); }

// Quitter l'onglet referme la liste « Tout voir » ; l'aperçu d'une position, lui, y revient (statsBack).
function closeStatsWeak() { statsWeak = null; }

function statsBack() {
    const y = statsPreviewTarget ? statsPreviewTarget.scrollY : 0;
    goHome(statsPreviewTarget && statsPreviewTarget.from === 'openings' ? 'openings' : 'stats');
    requestAnimationFrame(() => window.scrollTo({ top: y }));
}

// Bouton « S'entraîner » de l'aperçu.
function trainStatsPreview() {
    if (statsPreviewTarget) startReviewQueue([statsPreviewTarget], 'stats');
}
