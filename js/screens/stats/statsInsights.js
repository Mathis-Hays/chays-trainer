/**
 * screens/stats/statsInsights.js
 * ──────────────────────────────────────────────────────────────────────────
 * Statistiques › Parties : filtres communs (période, site, cadence), posés dans la barre de contexte de l'onglet à côté de la
 * couleur, et lus aussi par Ouvertures et par « À faire » ; vues Bilan, Temps, Qualité et Positions.
 * Qualité : Stockfish évalue les parties (GameEval, deux passes, ouvertures en cache) pendant que la vue est ouverte et visible, et
 * en arrière-plan après le lancement (Bus.afterIntro, 20 parties) ; la période affichée d'abord ; les résultats sont gardés.
 * Cartes refaites en novembre 2026 (chantiers « Progrès : niveau et temps » et « Progrès : qualité et médailles ») : écart à l'Elo
 * par mois, mois chargés, force de l'adversaire ; temps à la sortie du répertoire, zeitnot défini, coup 20 en trois situations ;
 * précision en grand chiffre, trois cadrans des phases, fautes par tranche de 10 coups, escalier de la sortie ; terrains et pièges.
 * Choisir un site ou une cadence règle aussi la courbe d'Elo (préférences eloSite, eloSpeed). Calculs : GameInsights, OpeningReport.
 * Période, site et cadence sont retrouvés au prochain lancement (chessTrainer_gameFilters, propre à l'appareil).
 * Chaque carte répond à une question et le dit en une phrase ; une phrase n'apparaît qu'avec assez de parties (GameInsights.MIN).
 */

'use strict';

const StatsInsights = (function () {
    const MIN = GameInsights.MIN, SPEEDS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', classical: 'Classique', daily: 'Par correspondance' };
    const FILTERS_KEY = 'chessTrainer_gameFilters';
    function readFilters() {
        const s = dataStore.getJSON(FILTERS_KEY, null) || {};
        return { period: [0, 3, 6, 12].includes(s.period) ? s.period : 12, site: GameArchive.SITE_NAME[s.site] ? s.site : 'all', speed: SPEEDS[s.speed] ? s.speed : 'all' };
    }
    // Vue 'resume' par défaut (lot 4 « Chays épuré ») : chiffres et trois constats ; « Toutes les analyses » ouvre les vues.
    const st = { ...readFilters(), view: 'resume', paused: false, evalError: '', shown: 0 };
    const saveFilters = () => dataStore.setJSON(FILTERS_KEY, { period: st.period, site: st.site, speed: st.speed });
    const pct = v => `${Math.round(v)} %`;
    const signed = v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;
    const num1 = v => v.toLocaleString(I18n.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const fair = t => t.n >= MIN;
    const delta = d => d === null ? '–' : `<span class="so-delta ${d >= 0 ? 'up' : 'down'}">${fmtDelta(d)}</span>`;
    // Carte d'analyse (audit « Progrès en images », K4) : la question en surtitre, la conclusion chiffrée en titre ;
    // sans conclusion (trop peu de parties), la question reste le titre. « ? » insécable.
    const nbsp = t => String(t).replace(/ ([?!:;])/g, '\u00a0$1');
    // Phrases qui ne concluent pas (ce qui manque, le périmètre) : elles restent sous la question.
    const NOTE = /^(Il faut|Sessions sur|Sur \d|Premier déséquilibre|Structure de pions|Pas encore)/;
    const card = (cls, title, take, inner) => take && NOTE.test(take)
        ? `<div class="so-card ${cls}"><h5>${nbsp(title)}</h5><p class="st-sub">${take}</p>${inner}</div>`
        : take
        ? `<div class="so-card ${cls}"><span class="st-eyebrow">${nbsp(title)}</span><h5${String(take).length > 90 ? ' class="is-long"' : ''}>${nbsp(take)}</h5>${inner}</div>`
        : `<div class="so-card ${cls}"><h5>${nbsp(title)}</h5>${inner}</div>`;
    // État vide d'un graphique : le fantôme pointillé et ce qui manque (audit « Progrès en images »).
    const ghost = text => `<div class="si-ghost"><svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0,44 L40,38 L80,41 L120,30 L160,27 L200,20"/></svg><p class="st-sub">${text}</p></div>`;
    const legend = items => `<div class="so-leg">${items.map(([c, l]) => `<span><i class="${c}"></i>${l}</span>`).join('')}</div>`;
    const tile = (label, value, sub) => `<div><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    const hbar = (label, v, n) => `<div class="si-hbar"><span>${label}</span><span class="si-track"><i style="width:${Math.max(1, Math.min(100, v))}%"></i></span><b>${pct(v)}</b>${n === undefined ? '' : `<small>${n}</small>`}</div>`;

    // ─── FILTRES ─────────────────────────────────────────────────────────────
    function since() {
        if (!st.period) return 0;
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth() - st.period + 1, 1).getTime();
    }
    // anyTime : sans la période (la fiche d'ouverture garde toutes les parties pour les rattacher, et date elle-même).
    const keeper = anyTime => { const from = anyTime ? 0 : since(); return g => g.at >= from && (st.site === 'all' || g.site === st.site) && (st.speed === 'all' || g.speed === st.speed) && (statsColor === 'all' || g.color === statsColor); };
    const keep = (g, anyTime) => keeper(anyTime)(g);

    // Période, site et cadence : dans la barre de contexte des Statistiques (#stats-filters).
    function filtersHTML(games) {
        const sites = [...new Set(games.map(g => g.site))], speeds = Object.keys(SPEEDS).filter(s => games.some(g => g.speed === s));
        // Un choix gardé sans partie correspondante (compte retiré) n'enferme pas sur une page vide, et reste écrit pour le jour où il revient.
        if (!sites.includes(st.site)) st.site = 'all';
        if (!speeds.includes(st.speed)) st.speed = 'all';
        const dd = (value, action, aria, options, cls) => dropdownHTML({ value, action, aria, options, cls: `dd-sm ${cls || ''}` });
        return `<div class="si-bar">
            ${dd(String(st.period), 'statsInPeriod', 'Période', [['3', '3 mois'], ['6', '6 mois'], ['12', '12 mois'], ['0', 'Tout']])}
            ${sites.length > 1 ? dd(st.site, 'statsInSite', 'Site', [['all', 'Tous les sites'], ...sites.map(s => [s, GameArchive.SITE_NAME[s]])]) : ''}
            ${speeds.length > 1 ? dd(st.speed, 'statsInSpeed', 'Cadence', [['all', 'Toutes les cadences'], ...speeds.map(s => [s, SPEEDS[s]])], 'dd-end') : ''}
        </div>`;
    }

    function viewsHTML() {
        if (st.view === 'resume') return '';
        return `<button type="button" class="st-link st-back si-back" data-action="statsInView" data-arg="resume">${ico('chevron-left')}Résumé</button><div class="tr-seg si-views" role="group" aria-label="Vue">${[['bilan', 'Bilan'], ['temps', 'Temps'], ['qualite', 'Qualité'], ['positions', 'Positions'], ['repertoire', 'Répertoire']].map(([v, l]) => `<button type="button" class="tr-seg-btn${st.view === v ? ' active' : ''}" aria-pressed="${st.view === v}" data-action="statsInView" data-arg="${v}">${l}</button>`).join('')}</div>`;
    }

    // ─── GRAPHIQUES ──────────────────────────────────────────────────────────
    const monthName = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { month: 'short' }));
    const monthLong = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { month: 'long' }));
    const svgOf = (W, H, label, g, cls = '') => `<svg class="so-chart${cls ? ' ' + cls : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${g}</svg>`;
    // Barre arrondie de 4 px côté données, ancrée à la ligne de base : verticale (y0 base, y1 bout) ou horizontale (x0 base, x1 bout).
    function vBar(x, y0, y1, w, cls, tip) {
        const top = Math.min(y0, y1), h = Math.abs(y1 - y0), r = Math.min(4, h, w / 2), up = y1 < y0;
        const d = up ? `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`
                     : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
        return `<path class="${cls}" d="${d}"><title>${tip}</title></path>`;
    }
    function hBar(x0, x1, y, h, cls, tip) {
        const len = Math.abs(x1 - x0), r = Math.min(4, len, h / 2);
        const d = x1 >= x0 ? `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`
                           : `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
        return `<path class="${cls}" d="${d}"><title>${tip}</title></path>`;
    }
    const side = v => (v >= 0 ? 'si-up' : 'si-down');
    const big = (label, value, sub, cls) => `<div class="si-big"><small>${label}</small><b class="${cls || ''}">${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;

    // Barres de score sur 0-100 %, avec le score attendu en repère s'il est connu.
    function scoreBars(items) {
        const W = 360, H = 150, L = 4, R = 34, T = 14, B = 22, band = (W - L - R) / items.length, bw = Math.min(34, band * .6), y = v => T + (100 - v) * (H - T - B) / 100;
        let g = [0, 50, 100].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - R + 5}" y="${y(v) + 3}">${v} %</text>`).join('');
        items.forEach(({ label, t }, i) => {
            const x = L + band * i + (band - bw) / 2;
            g += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${label}</text>`;
            if (!t.n) return;
            g += `<g>${vBar(x, y(0), y(t.score), bw, 'so-bar-real', I18n.mark(`${label} · ${t.n} · ${Math.round(t.score)} %${t.expected === null ? '' : ` / ${Math.round(t.expected)} %`}`))}${t.expected === null ? '' : `<line class="so-exp" x1="${x - 3}" x2="${x + bw + 3}" y1="${y(t.expected)}" y2="${y(t.expected)}"/>`}<text class="v" x="${x + bw / 2}" y="${y(t.score) - 4}" text-anchor="middle">${Math.round(t.score)}</text></g>`;
        });
        return svgOf(W, H, 'Score par tranche', g);
    }

    function heatHTML(h) {
        const days = [0, 1, 2, 3, 4, 5, 6].map(d => I18n.mark(new Date(2024, 0, 1 + d).toLocaleDateString(I18n.locale(), { weekday: 'short' })));
        const slots = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24'];
        const color = t => t.n < MIN ? '' : `background:color-mix(in oklab, ${t.score >= 50 ? 'var(--data-up)' : 'var(--data-down)'} ${Math.min(100, Math.abs(t.score - 50) * 6)}%, var(--bg-inset))`;
        const text = c => `${days[c.day]}, ${slots[c.slot]} h`;
        const take = h.best && h.worst ? `Meilleur créneau : ${text(h.best)} (${pct(h.best.t.score)}). Le moins bon : ${text(h.worst)} (${pct(h.worst.t.score)}).` : 'Il faut plus de parties par créneau pour comparer.';
        return card('so-c6', 'Quand jouez-vous le mieux ?', take, `<div class="si-heat" role="img" aria-label="Score par jour et par tranche horaire"><span></span>${slots.map(s => `<span>${s}</span>`).join('')}${h.grid.map((row, d) => `<span class="d">${days[d]}</span>${row.map((t, s) => `<i class="${t.n && t.n < MIN ? 'is-few' : ''}" style="${color(t)}" title="${I18n.mark(`${days[d]}, ${slots[s]} h · ${t.n} · ${t.n ? pct(t.score) : '–'}`)}"></i>`).join('')}`).join('')}</div><div class="si-ramp">Sous 50 % <i></i> Au-dessus <span class="si-few-k"><b aria-hidden="true"></b>moins de ${MIN} parties</span></div>`);
    }

    // Courbe du temps restant ; à la sortie du répertoire, l'avance moyenne en étiquette (chantier « Progrès : niveau et temps », carte 4).
    function clockChart(curve, exitMove, lead) {
        const pts = curve.points, W = 360, H = 170, L = 4, R = 72, T = 10, B = 22, last = pts[pts.length - 1].move, top = Math.max(100, ...pts.map(p => Math.max(p.me, p.opp)));
        const x = m => L + (m - 1) * (W - L - R) / Math.max(1, last - 1), y = v => T + (top - v) * (H - T - B) / top;
        const path = k => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.move).toFixed(1)},${y(p[k]).toFixed(1)}`).join(''), end = pts[pts.length - 1], near = Math.abs(y(end.me) - y(end.opp)) < 14, nudge = near ? 7 : 0, high = end.me >= end.opp;
        let g = [0, 50, 100].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L + 2}" y="${y(v) - 3}">${v} %</text>`).join('');
        const at = exitMove && exitMove <= last ? pts.find(p => p.move === exitMove) : null, roomy = at && x(exitMove) > L + 44;
        if (at) g += `<line class="b si-dash" x1="${x(exitMove)}" x2="${x(exitMove)}" y1="${T}" y2="${H - B}"/>${roomy ? `<text x="${x(exitMove) + 4}" y="${H - B - 4}">Sortie du répertoire</text>` : ''}`;
        g += `<path class="si-line opp" d="${path('opp')}"/><path class="si-line me" d="${path('me')}"/><circle class="si-dot opp" cx="${x(last)}" cy="${y(end.opp)}" r="4"/><circle class="si-dot me" cx="${x(last)}" cy="${y(end.me)}" r="4"/>
            <text class="v" x="${x(last) + 8}" y="${y(end.me) + 3 + (high ? -nudge : nudge)}">Vous</text><text class="v" x="${x(last) + 8}" y="${y(end.opp) + 3 + (high ? nudge : -nudge)}">Adversaire</text>`;
        if (at && lead !== null) {
            // L'étiquette au-dessus des courbes s'il y a la place, sinon en dessous ; « à la sortie » quand la ligne n'a pas sa légende.
            const label = I18n.mark(`${signed(lead)} % ${I18n.t(roomy ? 'ici' : 'à la sortie')}`), pw = roomy ? 66 : 108, px = x(exitMove) + 6, above = Math.min(y(at.me), y(at.opp)) - 22;
            const py = above >= T + 2 ? above : Math.max(y(at.me), y(at.opp)) + 8;
            g += `<line class="si-mark" x1="${x(exitMove)}" x2="${x(exitMove)}" y1="${y(at.me)}" y2="${y(at.opp)}"/><rect class="si-pill" x="${px}" y="${py}" width="${pw}" height="18" rx="9"/><text class="si-pill-t" x="${px + pw / 2}" y="${py + 12.5}" text-anchor="middle">${label}</text>`;
        }
        const step = last > 40 ? 20 : 10;
        for (let m = step; m <= last; m += step) g += `<text x="${x(m)}" y="${H - 6}" text-anchor="middle">${m}</text>`;
        pts.forEach(p => { g += `<rect x="${x(p.move) - 3}" y="${T}" width="6" height="${H - T - B}" fill="transparent"><title>${I18n.mark(`${p.move} · ${Math.round(p.me)} % / ${Math.round(p.opp)} %`)}</title></rect>`; });
        return svgOf(W, H, 'Temps restant par coup', g);
    }

    // ─── BILAN ───────────────────────────────────────────────────────────────
    // Carte 1 : niveau joué moins mon Elo du mois, en barres qui partent de « votre Elo ».
    function aboveChart(a) {
        const ms = a.months, W = 360, H = 150, L = 4, R = 48, T = 16, B = 20, lim = Math.max(50, ...ms.map(m => Math.ceil(Math.abs(m.gap || 0) / 50) * 50)), mid = T + (H - T - B) / 2, k = (H - T - B) / 2 / lim;
        const band = (W - L - R) / ms.length, bw = Math.min(30, band * .56), every = ms.length > 6 ? 2 : 1, lastKnown = ms.filter(m => m.gap !== null).pop();
        let g = `<line class="b" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/><text x="${W - R + 4}" y="${mid + 3}">votre Elo</text>`;
        ms.forEach((m, i) => {
            const x = L + band * i + (band - bw) / 2;
            if ((ms.length - 1 - i) % every === 0) g += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${monthName(m.at)}</text>`;
            if (m.gap === null) return;
            const yv = mid - m.gap * k;
            g += vBar(x, mid, Math.abs(yv - mid) < 1 ? mid - (m.gap >= 0 ? 1 : -1) : yv, bw, side(m.gap), I18n.mark(`${monthLong(m.at)} · ${signed(m.gap)} Elo · ${I18n.t('niveau joué')} ${m.perf} · Elo ${m.me} · ${m.n}`));
            if ((a.best && m.at === a.best.at) || m === lastKnown || ms.length <= 6) g += `<text class="v" x="${x + bw / 2}" y="${m.gap >= 0 ? yv - 4 : yv + 11}" text-anchor="middle">${signed(m.gap)}</text>`;
        });
        return svgOf(W, H, 'Niveau joué moins votre Elo, par mois', g);
    }

    // Carte 6 : écart à l'attendu par force de l'adversaire, en barres qui partent de zéro.
    const GAP_NAMES = ['Bien plus fort', 'Plus fort', 'Même niveau', 'Plus faible', 'Bien plus faible'];
    // Constat de la tranche la plus coûteuse : une phrase entière par tranche (traductions).
    const GAP_TAKES = [(s, e) => `Vous perdez des points contre les adversaires bien plus forts : ${s} au lieu des ${e} attendus.`,
                       (s, e) => `Vous perdez des points contre les adversaires plus forts : ${s} au lieu des ${e} attendus.`,
                       (s, e) => `Vous perdez des points contre les adversaires de votre niveau : ${s} au lieu des ${e} attendus.`,
                       (s, e) => `Vous perdez des points contre les adversaires plus faibles : ${s} au lieu des ${e} attendus.`,
                       (s, e) => `Vous perdez des points contre les adversaires bien plus faibles : ${s} au lieu des ${e} attendus.`];
    const GAP_TIPS = ['+150 Elo ou plus', '+50 à +150 Elo', '±50 Elo', '−50 à −150 Elo', '−150 Elo ou plus'];
    function gapChart(gaps) {
        const W = 360, L = 112, R = 40, rowH = 26, T = 4, H = T + rowH * gaps.length + 2, zero = L + (W - L - R) / 2, lim = Math.max(10, ...gaps.filter(fair).map(t => Math.ceil(Math.abs(t.delta || 0) / 5) * 5)), k = (W - L - R) / 2 / lim;
        let g = `<line class="b" x1="${zero}" x2="${zero}" y1="0" y2="${H}"/>`;
        gaps.forEach((t, i) => {
            const y = T + i * rowH;
            g += `<text class="lab" x="0" y="${y + 14}">${GAP_NAMES[i]}<title>${GAP_TIPS[i]}</title></text>`;
            if (!fair(t) || t.delta === null) { g += `<text x="${zero + 6}" y="${y + 14}">–</text>`; return; }
            const x1 = zero + t.delta * k;
            g += hBar(zero, Math.abs(x1 - zero) < 1 ? zero + (t.delta >= 0 ? 1 : -1) : x1, y + 4, 14, side(t.delta), I18n.mark(`${GAP_NAMES[i]} (${GAP_TIPS[i]}) · ${pct(t.score)} / ${pct(t.expected)} · ${t.n}`));
            g += `<text class="v" x="${t.delta >= 0 ? x1 + 5 : x1 - 5}" y="${y + 15}" text-anchor="${t.delta >= 0 ? 'start' : 'end'}">${I18n.mark(`${signed(t.delta)} %`)}</text>`;
        });
        return svgOf(W, H, 'Écart de score à l’attendu selon la force de l’adversaire', g);
    }

    // Carte 5 : parties par mois, mois chargés en couleur.
    function busyStrip(v) {
        const ms = v.months, W = 360, H = 58, base = 40, band = W / ms.length, bw = Math.min(26, band * .5), maxN = Math.max(1, ...ms.map(m => m.n)), every = ms.length > 6 ? 2 : 1;
        let g = `<line class="b" x1="0" x2="${W}" y1="${base}" y2="${base}"/>`;
        ms.forEach((m, i) => {
            const x = band * i + (band - bw) / 2, busy = v.threshold !== null && m.n >= v.threshold && m.delta !== null;
            if (m.n) g += vBar(x, base, base - Math.max(2, m.n * 34 / maxN), bw, busy ? 'si-busy' : 'si-mid', I18n.mark(`${monthLong(m.at)} · ${m.n}${m.delta === null ? '' : ` · ${signed(m.delta)} Elo`}`));
            if ((ms.length - 1 - i) % every === 0) g += `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${monthName(m.at)}</text>`;
        });
        return svgOf(W, H, 'Parties par mois', g);
    }

    function bilanHTML(games, list) {
        if (list.length < MIN) return '<p class="st-sub">Trop peu de parties avec ces filtres.</p>';
        const s = OpeningReport.summarize(list), months = OpeningReport.months(list, st.period || 12, Date.now()), above = GameInsights.aboveElo(months);
        const gaps = GameInsights.byGap(list), gapTake = gapTakeOf(gaps), aboveTake = aboveTakeOf(above);
        const se = GameInsights.sessions(list), rankNames = ['1re partie', '2e partie', '3e partie', '4e partie', '5e et plus'], afterNames = ['Après 1 défaite', 'Après 2 défaites', 'Après 3 et plus'];
        const first = se.ranks[0], fifth = se.ranks[4];
        const sessionTake = fair(first) && fair(fifth) ? `Votre score passe de ${pct(first.score)} à la première partie à ${pct(fifth.score)} à partir de la cinquième.` : `Sessions sur la période : ${se.count}.`;
        const bars = (names, list2) => names.map((n, i) => fair(list2[i]) ? hbar(n, list2[i].score, list2[i].n) : '').join('');
        const en = GameInsights.ends(list), endRows = [['resign', 'Abandon'], ['mate', 'Mat'], ['time', 'Temps'], ['abandon', 'Forfait'], ['other', 'Autre']];
        const endBars = part => endRows.filter(([k]) => part[k] >= .5).sort((a, b) => part[b[0]] - part[a[0]]).map(([k, l]) => hbar(l, part[k])).join('');
        const scope = eloScope(games), volAll = scope.length ? GameInsights.volume(scope, st.period || 12, Date.now()) : null, vol = volAll && volAll.months.some(m => m.n) ? volAll : null;
        const volTake = vol && vol.high !== null ? (vol.high > vol.low ? `Quand vous jouez beaucoup, vous montez : ${signed(vol.high)} Elo par mois, contre ${signed(vol.low)} les mois calmes.` : `Les mois chargés ne vous font pas monter : ${signed(vol.high)} Elo par mois, contre ${signed(vol.low)} les mois calmes.`) : 'Il faut quatre mois joués au moins pour comparer.';
        const volBig = vol && vol.high !== null ? `<div class="si-duo">${big('Mois chargés', I18n.mark(signed(vol.high)), I18n.mark(`${vol.threshold} ${I18n.t('parties et plus')} · ${_plural(vol.highN, 'mois', 'mois')}`), side(vol.high))}${big('Mois calmes', I18n.mark(signed(vol.low)), I18n.mark(`${I18n.t('moins de')} ${vol.threshold} · ${_plural(vol.lowN, 'mois', 'mois')}`), side(vol.low))}</div>` : '';
        return `${kpisHTML(s)}
            <div class="so-grid">
                ${card('so-c6 si-above', 'Vos mois au-dessus de votre Elo', aboveTake, above.known >= 2 ? `${aboveChart(above)}<p class="si-cap">Niveau joué moins votre Elo moyen du mois (3 parties au moins)</p>` : ghost('Deux mois joués au moins (trois parties chacun) pour comparer.'))}
                ${en.wins.n + en.losses.n ? card('so-c6', 'Comment finissent vos parties ?', en.losses.n && en.wins.n ? `${pct(en.losses.time)} de vos défaites et ${pct(en.wins.time)} de vos gains se jouent au temps.` : '', `<div class="si-two"><div><h6>Gains</h6>${endBars(en.wins)}</div><div><h6>Défaites</h6>${endBars(en.losses)}</div></div>`) : ''}
                ${card('so-c6', 'Savez-vous vous arrêter ?', sessionTake, `${bars(rankNames, se.ranks)}${se.after.some(fair) ? `<p class="si-cap">Juste après des défaites</p>${bars(afterNames, se.after)}` : ''}`)}
                ${heatHTML(GameInsights.heat(list))}
                ${vol ? card('so-c6 si-volume', 'Vos mois chargés vous font-ils monter ?', volTake, `${volBig}${busyStrip(vol)}${vol.threshold !== null ? legend([['si-busy', 'Mois chargés'], ['si-mid', 'Mois calmes']]) : ''}`) : ''}
                ${card('so-c6 si-gaps', 'Face aux plus forts, face aux plus faibles', gapTake, `${gapChart(gaps)}<p class="si-cap">Points de score gagnés ou perdus par rapport à ce que votre Elo prévoit, selon l'adversaire</p>`)}
            </div>`;
    }

    // Chiffres du bilan, aussi en tête du Résumé.
    const kpisHTML = s => `<div class="so-kpis">
                <div class="so-card so-kpi"><span>Score</span><b>${pct(s.score)}</b><small>${_plural(s.n, 'partie')}</small></div>
                <div class="so-card so-kpi"><span>Face à l'attendu</span><b>${delta(s.delta)}</b><small>${s.expected === null ? 'Elo inconnu' : `Attendu : ${pct(s.expected)}`}</small></div>
                <div class="so-card so-kpi"><span>Niveau joué</span><b>${s.perf === null ? '–' : s.perf}</b><small>Elo d'après vos résultats</small></div>
                <div class="so-card so-kpi"><span>Gains</span><b>${s.w}</b><small>${_plural(s.d, 'nulle')} · ${_plural(s.l, 'perte')}</small></div>
            </div>`;
    function gapTakeOf(gaps) {
        const worstI = gaps.map((t, i) => i).filter(i => fair(gaps[i]) && gaps[i].delta !== null).sort((a, b) => gaps[a].delta - gaps[b].delta)[0];
        const worst = worstI === undefined ? null : gaps[worstI];
        return worst && worst.delta < -2 ? GAP_TAKES[worstI](pct(worst.score), pct(worst.expected)) : 'Vous tenez ce que votre Elo prévoit, quel que soit l\'adversaire.';
    }
    const aboveTakeOf = above => above.known >= 2 ? `${above.above} mois sur ${above.known}, vous avez joué mieux que votre classement.${above.best && above.best.gap > 0 ? ` Meilleur : ${monthLong(above.best.at)}, ${signed(above.best.gap)}.` : ''}` : '';

    // ─── RÉSUMÉ (bilan « Chays épuré », lot 4) ───────────────────────────────
    // Les chiffres, puis trois constats déjà écrits par les vues (une phrase chacun, rien de nouveau à lire) ; chacun
    // ouvre sa vue. Le temps passe devant quand il pèse (20 % des défaites ou plus).
    // Le Résumé en formes (audit « Progrès en images ») : score face à l'attendu en jauge à repère, gains / nulles / pertes
    // en une barre, Elo moyen et niveau joué sur une seule échelle, les dix dernières parties en cases.
    function scoreHTML(s, list) {
        const last = list.slice().sort((a, b) => b.at - a.at).slice(0, 10).reverse();
        const wdl = `<div class="si-wdl" role="img" aria-label="${escapeHtml(I18n.mark(`${s.w} gains, ${s.d} nulles, ${s.l} pertes`))}"><i class="w" style="flex:${s.w}"></i><i class="d" style="flex:${s.d}"></i><i class="l" style="flex:${s.l}"></i></div>
            <div class="si-wdl-k"><span><i class="w"></i>${_plural(s.w, 'gain')}</span><span><i class="d"></i>${_plural(s.d, 'nulle')}</span><span><i class="l"></i>${_plural(s.l, 'perte')}</span></div>`;
        const bullet = `<div class="si-bullet" role="img" aria-label="${escapeHtml(I18n.mark(`Score ${pct(s.score)}${s.expected === null ? '' : `, attendu ${pct(s.expected)}`}`))}"><i style="width:${Math.max(1, Math.min(100, s.score))}%"></i>${s.expected === null ? '' : `<b style="left:${Math.min(100, s.expected)}%"></b>`}</div>
            <div class="si-bullet-k"><span>0</span>${s.expected === null ? '' : `<span style="left:${Math.min(100, s.expected)}%">attendu ${pct(s.expected)}</span>`}<span>100 %</span></div>`;
        let scale = '';
        if (s.perf !== null && s.me !== null) {
            const lo = Math.min(s.me, s.perf), hi = Math.max(s.me, s.perf), pad = Math.max(60, (hi - lo) * .2), x = v => 4 + 92 * (v - lo + pad) / (hi - lo + 2 * pad);
            const gap = s.perf - s.me, words = Math.abs(gap) < 15 ? 'vous jouez à votre niveau' : gap > 0 ? `vous jouez ${gap} au-dessus` : `vous jouez ${-gap} en dessous`;
            scale = `<div class="si-scale"><div class="si-scale-h"><span>Votre Elo moyen</span><span>Niveau joué</span></div>
                <div class="si-scale-l" role="img" aria-label="${escapeHtml(I18n.mark(`Elo moyen ${s.me}, niveau joué ${s.perf}`))}"><span style="left:${x(lo)}%;width:${x(hi) - x(lo)}%"></span><i class="me" style="left:${x(s.me)}%"></i><i class="perf" style="left:${x(s.perf)}%"></i></div>
                <div class="si-scale-h"><b>${s.me}</b><span>${words}</span><b>${s.perf}</b></div></div>`;
        }
        const ten = last.length >= 5 ? `<div class="si-last"><span>${I18n.t('Dernières parties')}</span><span class="si-last-c" role="img" aria-label="${escapeHtml(I18n.mark(`${last.filter(g => g.result === 'w').length} gains sur ${last.length}`))}">${last.map(g => `<i class="${g.result}"></i>`).join('')}</span></div>` : '';
        return `<div class="si-sum"><div class="si-sum-h"><b>Score ${pct(s.score)}</b>${s.delta === null ? '' : `${delta(s.delta)}<span class="st-sub">face à l’attendu</span>`}</div>${bullet}${wdl}${scale}${ten}</div>`;
    }
    // Micro-visuels des constats : part des défaites au temps, mois au-dessus de l'Elo, écart selon l'adversaire.
    function factVis(kind, list, en, above, gaps) {
        if (kind === 'time') return `<span class="si-fv"><span class="st-dbar is-share"><i style="width:${Math.round(en.losses.time)}%"></i></span><span class="st-dbar is-share up"><i style="width:${Math.round(en.wins.time)}%"></i></span></span>`;
        if (kind === 'above') {
            const m = above.months.filter(x => x.gap !== null && x.gap !== undefined), lim = Math.max(1, ...m.map(x => Math.abs(x.gap)));
            return `<svg class="si-fv" viewBox="0 0 52 28" aria-hidden="true"><line x1="0" x2="52" y1="14" y2="14"/>${m.slice(-12).map((x, i, a) => `<rect class="${x.gap >= 0 ? 'up' : 'down'}" x="${(i * 52 / a.length).toFixed(1)}" y="${x.gap >= 0 ? (14 - 13 * x.gap / lim).toFixed(1) : 14}" width="${(52 / a.length - 1).toFixed(1)}" height="${Math.max(1, 13 * Math.abs(x.gap) / lim).toFixed(1)}"/>`).join('')}</svg>`;
        }
        const g = gaps.filter(t => t && t.delta !== null), lim = Math.max(1, ...g.map(t => Math.abs(t.delta)));
        return `<svg class="si-fv" viewBox="0 0 52 28" aria-hidden="true"><line x1="26" x2="26" y1="0" y2="28"/>${gaps.map((t, i) => t && t.delta !== null ? `<rect class="${t.delta >= 0 ? 'up' : 'down'}" x="${t.delta >= 0 ? 26 : (26 - 24 * Math.abs(t.delta) / lim).toFixed(1)}" y="${(i * 28 / gaps.length + 1).toFixed(1)}" width="${Math.max(1, 24 * Math.abs(t.delta) / lim).toFixed(1)}" height="${(28 / gaps.length - 2).toFixed(1)}"/>` : '').join('')}</svg>`;
    }

    // ─── RÉSUMÉ (bilan « Chays épuré », lot 4 ; audit « Progrès en images ») ─
    // Les chiffres en formes, puis trois constats déjà écrits par les vues, chacun avec son micro-visuel ; chacun ouvre sa
    // vue. Le temps passe devant quand il pèse (20 % des défaites ou plus). « Toutes les analyses » est la dernière ligne.
    function resumeHTML(list) {
        if (list.length < MIN) return '<p class="st-sub">Trop peu de parties avec ces filtres.</p>';
        const s = OpeningReport.summarize(list), above = GameInsights.aboveElo(OpeningReport.months(list, st.period || 12, Date.now()));
        const en = GameInsights.ends(list), gaps = GameInsights.byGap(list), facts = [];
        const endTake = en.losses.n && en.wins.n ? `${pct(en.losses.time)} de vos défaites et ${pct(en.wins.time)} de vos gains se jouent au temps.` : '';
        if (endTake && en.losses.time >= 20) facts.push(['temps', 'time', 'Comment finissent vos parties ?', endTake]);
        if (above.known >= 2) facts.push(['bilan', 'above', 'Vos mois au-dessus de votre Elo', aboveTakeOf(above)]);
        facts.push(['bilan', 'gap', 'Face aux plus forts, face aux plus faibles', gapTakeOf(gaps)]);
        if (endTake && facts.length < 3 && en.losses.time < 20) facts.push(['bilan', 'time', 'Comment finissent vos parties ?', endTake]);
        return `${scoreHTML(s, list)}<div class="si-facts">${facts.slice(0, 3).map(([v, kind, title, take]) =>
            `<button type="button" class="si-fact" data-action="statsInView" data-arg="${v}">${factVis(kind, list, en, above, gaps)}<b>${take}</b><span>${title}</span>${ico('chevron-right')}</button>`).join('')}
            <button type="button" class="si-fact si-all st-all-row" data-action="statsInView" data-arg="bilan"><b>Toutes les analyses</b>${ico('chevron-right')}</button></div>`;
    }

    // Parties de la courbe d'Elo affichée : site et cadence du niveau choisi.
    function eloScope(games) {
        const level = GameArchive.level();
        return level ? games.filter(g => g.site === level.site && g.speed === level.speed && keep({ ...g, site: st.site === 'all' ? g.site : st.site, speed: st.speed === 'all' ? g.speed : st.speed })) : [];
    }

    function recordsHTML(games) {
        const level = GameArchive.level();
        if (!level) return '';
        const r = GameInsights.records(games.filter(g => g.site === level.site && g.speed === level.speed));
        if (!r) return '';
        const date = I18n.mark(new Date(r.bestAt).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short', year: 'numeric' }));
        return `<div class="sg-tiles si-rec">${tile('Meilleur Elo', r.best, date)}${tile('Plus longue série', r.streak, 'gains d\'affilée')}${tile('Plus forte baisse', r.drop ? `−${r.drop}` : '0', 'depuis un sommet')}</div>`;
    }

    // ─── TEMPS ───────────────────────────────────────────────────────────────
    const duration = s => s >= 60 && s % 60 === 0 ? `${s / 60} min` : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`;
    // « 1 partie sur 3 » quand la part s'y prête, sinon un pourcentage.
    function shareWords(k, n) {
        const r = n ? k / n : 0, d = r ? Math.round(1 / r) : 0;
        return r > 0 && r <= .5 && Math.abs(1 / r - d) < .15 ? `1 partie sur ${d}` : `${pct(100 * r)} de vos parties`;
    }

    // Carte 5 : score avec et sans zeitnot.
    function zeitnotBars(z) {
        const rows = [['Avec zeitnot', z.withIt, 'si-down'], ['Sans zeitnot', z.without, 'si-me']].filter(([, t]) => fair(t)), W = 360, L = 100, R = 44, H = 8 + rows.length * 30, k = (W - L - R) / 100;
        let g = `<line class="g si-dash" x1="${L + 50 * k}" x2="${L + 50 * k}" y1="0" y2="${H - 4}"/><text x="${L + 50 * k}" y="${H + 8}" text-anchor="middle">50 %</text>`;
        rows.forEach(([n, t, cls], i) => { const y = 6 + i * 30; g += `<text class="lab" x="0" y="${y + 12}">${n}</text>${hBar(L, L + Math.max(1, t.score * k), y, 16, cls, I18n.mark(`${n} · ${pct(t.score)} · ${t.n}`))}<text class="v" x="${L + t.score * k + 5}" y="${y + 12}">${pct(t.score)}</text>`; });
        return rows.length ? svgOf(W, H + 10, 'Score avec et sans zeitnot', g) : '';
    }

    // Carte 6 : score selon la pendule au coup 20, en trois situations.
    function sidesChart(s) {
        const rows = [['En retard', s.behind, 'si-down'], ['À égalité', s.even, 'si-neutral'], ['En avance', s.ahead, 'si-me']], W = 360, H = 150, T = 18, B = 34, base = H - B, k = (base - T) / 100, band = W / 3, bw = Math.min(60, band * .44);
        let g = `<line class="b" x1="0" x2="${W}" y1="${base}" y2="${base}"/><line class="g si-dash" x1="0" x2="${W}" y1="${base - 50 * k}" y2="${base - 50 * k}"/><text x="${W}" y="${base - 50 * k - 4}" text-anchor="end">50 %</text>`;
        rows.forEach(([n, t, cls], i) => {
            const x = band * i + (band - bw) / 2;
            g += `<text class="lab" x="${x + bw / 2}" y="${base + 14}" text-anchor="middle">${n}</text><text x="${x + bw / 2}" y="${base + 27}" text-anchor="middle">${_plural(t.n, 'partie')}</text>`;
            if (fair(t)) g += `${vBar(x, base, base - Math.max(1, t.score * k), bw, cls, I18n.mark(`${n} · ${pct(t.score)} · ${t.n}`))}<text class="v" x="${x + bw / 2}" y="${base - t.score * k - 5}" text-anchor="middle">${pct(t.score)}</text>`;
        });
        return svgOf(W, H, 'Score selon votre pendule au coup 20', g);
    }

    function tempsHTML(list, rows) {
        const curve = GameInsights.timeCurve(list);
        if (curve.points.length < 5) return '<p class="st-sub">Pas assez de parties avec horloge pour ces filtres. Les parties par correspondance n\'en ont pas.</p>';
        const exit = GameInsights.exitClock(rows), z = GameInsights.zeitnot(list), sides = GameInsights.leadSides(list), th = GameInsights.thinking(rows), baseS = GameInsights.usualBase(list);
        const exitMove = rows.length ? Math.max(1, Math.round(rows.reduce((a, r) => a + r.a.path.length, 0) / rows.length / 2)) : 0;
        const at20 = curve.points.find(p => p.move === GameInsights.LEAD_MOVE), hasExit = exit.n >= MIN && exit.lead !== null;
        const twenty = !at20 ? '' : Math.abs(at20.me - at20.opp) < 3 ? (hasExit ? `Au coup ${at20.move}, l'écart a fondu.` : `Au coup ${at20.move}, vous êtes à égalité de temps avec vos adversaires.`) : `Au coup ${at20.move}, il vous reste ${pct(at20.me)} de votre temps, contre ${pct(at20.opp)} à vos adversaires.`;
        const lead = hasExit ? I18n.mark(`${Math.abs(Math.round(exit.lead))} %`) : '';
        const exitTime = !hasExit ? '' : exit.lead >= 0 ? `En sortant de votre répertoire, il vous reste ${lead} de temps de plus que l'adversaire.` : `En sortant de votre répertoire, il vous reste ${lead} de temps de moins que l'adversaire.`;
        const timeTake = hasExit && twenty ? I18n.mark(`${I18n.t(exitTime)} ${I18n.t(twenty)}`) : exitTime || twenty;      // deux phrases : chacune traduite
        const zShare = z.games >= MIN ? shareWords(z.withIt.n, z.games) : '';
        const zScore = fair(z.withIt) && fair(z.without), zMany = z.withIt.n > 1, zIn = pct(z.withIt.score), zOut = pct(z.without.score);
        const zTake = !zShare ? '' : !z.withIt.n ? 'Vous ne passez jamais en zeitnot.'
            : zScore ? (zMany ? `${zShare} vous mettent en zeitnot, et vous y marquez ${zIn} contre ${zOut} sinon.` : `${zShare} vous met en zeitnot, et vous y marquez ${zIn} contre ${zOut} sinon.`)
            : zMany ? `${zShare} vous mettent en zeitnot.` : `${zShare} vous met en zeitnot.`;
        const zChip = baseS ? `<div class="si-chip">Zeitnot : moins de <b>10 %</b> du temps de départ, soit <b>${I18n.mark(duration(baseS * GameInsights.ZEITNOT))}</b> en ${I18n.mark(duration(baseS))}</div>` : '';
        const sidesTake = sides.gain === null ? '' : sides.gain >= 0 ? `Avoir plus de temps que l'adversaire au coup 20 vous rapporte ${I18n.mark(signed(sides.gain))} points de score.` : `Avoir plus de temps que l'adversaire au coup 20 ne vous aide pas : ${I18n.mark(signed(sides.gain))} points de score.`;
        return `<div class="so-grid">
            ${card('so-c12 si-cap-w', 'Où dépensez-vous votre temps ?', timeTake, `${legend([['si-key me', 'Vous'], ['si-key opp', 'Adversaire']])}${clockChart(curve, exitMove, hasExit ? exit.lead : null)}<p class="si-cap">Temps restant en % du temps de départ, par numéro de coup${hasExit ? ` ; à la sortie du répertoire, votre avance moyenne (${_plural(exit.n, 'partie')})` : ''}</p>`)}
            ${card('so-c6 si-zeit', 'Manquez-vous de temps à la pendule ?', zTake, `${zChip}${zeitnotBars(z)}`)}
            ${card('so-c6 si-sides', 'L\'avance au coup 20 vous aide-t-elle ?', sidesTake, `${sidesChart(sides)}<p class="si-cap">Score selon votre pendule face à la sienne au coup 20 (écart de 5 % du temps de départ ou plus)</p>`)}
            ${th.n >= MIN ? card('so-c12', 'Réfléchissez-vous quand la préparation s\'arrête ?', `Premier coup hors répertoire : ${num1(th.first)} s, contre ${num1(th.usual)} s ensuite.`, `<div class="sg-tiles">${tile('Premier coup', `${num1(th.first)} s`)}${tile('Coups suivants', `${num1(th.usual)} s`)}${fair(th.thought) ? tile('Score en réfléchissant', pct(th.thought.score), _plural(th.thought.n, 'partie')) : ''}${fair(th.quick) ? tile('Score en jouant vite', pct(th.quick.score), _plural(th.quick.n, 'partie')) : ''}</div>`) : ''}
        </div>`;
    }

    // ─── QUALITÉ ─────────────────────────────────────────────────────────────
    const fmt1 = v => v === null ? '–' : num1(v);
    const pawn = cp => I18n.mark(`${cp >= 0 ? '+' : '−'}${num1(Math.abs(cp) / 100)}`);
    const points = v => I18n.mark(`${num1(Math.abs(v))} ${Math.abs(v) >= 2 ? I18n.t('points') : I18n.t('point')}`);

    function evalBarHTML(games) {
        const left = GameEval.pending(games).length, total = games.filter(g => g.ev || g.sans.length >= 8).length, done = total - left;
        if (!left) return `<p class="st-sub si-eval" id="si-eval">Toutes vos parties sont analysées (Stockfish).</p>`;
        const state = st.evalError ? escapeHtml(st.evalError) : st.paused ? 'En pause.' : GameEval.running() ? 'Analyse en cours' : 'Analyse prête à reprendre';
        return `<div class="si-eval si-eval-line" id="si-eval" role="status"><span class="si-eval-t"><b>Analyse Stockfish</b> · ${state} · ${I18n.mark(`${done} / ${total}`)}</span>
            <span class="si-track" aria-hidden="true"><i style="width:${total ? Math.round(100 * done / total) : 0}%"></i></span>
            <button type="button" class="st-link" data-action="statsInEval">${st.paused ? 'Reprendre' : 'Mettre en pause'}</button>
            <small>Profondeur ${GameEval.FAST}, puis ${GameEval.DEPTH} sur les coups qui coûtent ; la période affichée d'abord, en arrière-plan après le lancement.</small></div>`;
    }

    // Point 2 : grand chiffre, courbe à échelle fixe (60 à 90 %), ruban des adversaires.
    function accuracyChart(months) {
        const pts = months.filter(m => m.accuracy !== null);
        if (pts.length < 2) return ghost('Une tendance demande deux mois analysés.');
        const opp = months.filter(m => m.oppAccuracy !== null), vals = pts.map(p => p.accuracy).concat(opp.map(p => p.oppAccuracy));
        const W = 360, H = 130, L = 4, R = 38, T = 8, B = 18, lo = Math.min(60, Math.floor(Math.min(...vals) / 10) * 10), hi = Math.max(90, Math.ceil(Math.max(...vals) / 10) * 10);
        const x = m => L + months.indexOf(m) * (W - L - R) / Math.max(1, months.length - 1), y = v => T + (hi - Math.max(lo, Math.min(hi, v))) * (H - T - B) / (hi - lo), end = pts[pts.length - 1];
        let g = [lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - R + 4}" y="${y(v) + 3}">${Math.round(v)} %</text>`).join('');
        if (opp.length >= 2) {
            const band = 1.5, upper = opp.map(p => `${x(p).toFixed(1)},${y(p.oppAccuracy + band).toFixed(1)}`), lower = opp.slice().reverse().map(p => `${x(p).toFixed(1)},${y(p.oppAccuracy - band).toFixed(1)}`);
            const mid = opp[Math.floor(opp.length / 2)];
            const below = mid.accuracy === null || mid.accuracy >= mid.oppAccuracy;      // l'étiquette du côté opposé à ma courbe
            g += `<path class="si-ribbon" d="M${upper.join('L')}L${lower.join('L')}Z"><title>Vos adversaires</title></path><text x="${x(mid)}" y="${below ? y(mid.oppAccuracy - band) + 11 : y(mid.oppAccuracy + band) - 4}" text-anchor="middle">adversaires</text>`;
        }
        g += `<path class="si-line acc" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join('')}"/>`;
        g += pts.map(p => `<circle class="si-dot acc" cx="${x(p)}" cy="${y(p.accuracy)}" r="${p === end ? 4.5 : 3}"><title>${I18n.mark(`${monthLong(p.at)} · ${Math.round(p.accuracy)} %${p.oppAccuracy === null ? '' : ` · ${I18n.t('adversaires')} ${Math.round(p.oppAccuracy)} %`} · ${p.n}`)}</title></circle>`).join('');
        g += `<text x="${L}" y="${H - 3}">${monthName(months[0].at)}</text><text x="${W - R}" y="${H - 3}" text-anchor="end">${monthName(months[months.length - 1].at)}</text>`;
        return svgOf(W, H, 'Précision par mois et ruban des adversaires', g);
    }
    function accuracyCard(q, months) {
        const tr = GameQuality.trend(months), title = !tr ? 'Votre précision progresse-t-elle ?' : { up: 'Votre précision monte', down: 'Votre précision baisse', flat: 'Votre précision tient' }[tr.dir];
        const span = tr && tr.change !== null ? Math.max(1, Math.round((tr.at - tr.from) / (30.44 * 864e5))) : 0;
        const now = new Date(), thisMonth = tr && new Date(tr.at).getMonth() === now.getMonth() && new Date(tr.at).getFullYear() === now.getFullYear();
        const when = !tr ? '' : thisMonth ? 'Ce mois-ci' : `En ${monthLong(tr.at)}`;   // sans tendance (trop peu de mois), pas de date
        const take = tr && tr.vsOpp !== null ? (tr.vsOpp >= 0 ? `${when}, vous jouez ${points(tr.vsOpp)} plus juste que vos adversaires.` : `${when}, vous jouez ${points(tr.vsOpp)} moins juste que vos adversaires.`) : `Sur ${I18n.t(_plural(q.games, 'partie analysée', 'parties analysées'))}.`;
        const hero = tr ? `<div class="si-hero"><b>${pct(tr.value)}</b>${tr.change === null ? '' : Math.abs(tr.change) < .5 ? `<span class="so-delta">${I18n.t('stable')}</span>` : `<span class="so-delta ${tr.change >= 0 ? 'up' : 'down'}">${fmtDelta(tr.change, ' pts')}</span><span>${I18n.mark(`${I18n.t('en')} ${_plural(span, 'mois', 'mois')}`)}</span>`}</div>` : '';
        return card('so-c6 si-acc', title, take, `${hero}${accuracyChart(months)}<p class="si-cap">Précision du site quand elle existe, sinon calcul Chays ; ruban : vos adversaires</p>`);
    }

    // Point 3 : trois cadrans, l'arc pour moi, le trait pour l'adversaire, sur 40 à 100 %.
    const PHASES = ['Ouverture', 'Milieu', 'Finale'], PHASE_IN = ['en ouverture', 'au milieu de partie', 'en finale'];
    function dialsChart(d) {
        const W = 360, H = 112, r = 40, cy = 60, lo = 40, hi = 100, ang = v => Math.PI * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo));
        let g = '';
        d.dials.forEach((p, i) => {
            const cx = 60 + i * 120, pt = (v, rr) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))], [x1, y1] = pt(lo, r), [x2, y2] = pt(hi, r);
            g += `<path class="si-dial-track" d="M${x1.toFixed(1)},${y1.toFixed(1)}A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
            if (p.me !== null) {
                const [xa, ya] = pt(p.me, r);
                g += `<path class="si-dial ${p.gap === null || Math.abs(p.gap) < 1 ? 'si-mid' : side(p.gap)}" d="M${x1.toFixed(1)},${y1.toFixed(1)}A${r},${r} 0 0 1 ${xa.toFixed(1)},${ya.toFixed(1)}"><title>${I18n.mark(`${PHASES[i]} · ${Math.round(p.me)} %${p.opp === null ? '' : ` / ${Math.round(p.opp)} %`}`)}</title></path>`;
            }
            if (p.opp !== null) { const [xo, yo] = pt(p.opp, r + 7), [xi, yi] = pt(p.opp, r - 7); g += `<line class="si-needle" x1="${xi.toFixed(1)}" y1="${yi.toFixed(1)}" x2="${xo.toFixed(1)}" y2="${yo.toFixed(1)}"/>`; }
            g += `<text class="si-dial-v" x="${cx}" y="${cy - 6}" text-anchor="middle">${p.me === null ? '–' : Math.round(p.me)}</text><text class="lab" x="${cx}" y="${cy + 14}" text-anchor="middle">${PHASES[i]}</text>`;
            g += `<text x="${cx}" y="${cy + 30}" text-anchor="middle">${p.gap === null ? '' : Math.abs(p.gap) < .5 ? I18n.t('au niveau') : I18n.mark(`${signed(p.gap)} ${I18n.t('vs adv.')}`)}</text>`;
        });
        return svgOf(W, H + 2, 'Précision par phase : vous et vos adversaires', g);
    }

    // Point 4 : erreurs et gaffes pour 10 coups, par tranche de 10 coups ; la courbe d'évaluation en second plan.
    const sliceName = m => (m.to === null ? `${m.from - 1}+` : `${m.from}–${m.to}`);
    function momentsChart(q, top) {
        const ms = q.moments, W = 360, H = 130, T = 16, B = 20, base = H - B, max = Math.max(.5, ...ms.map(m => m.per10 || 0)), k = (base - T) / max, band = W / ms.length, bw = Math.min(36, band * .6);
        let g = `<line class="b" x1="0" x2="${W}" y1="${base}" y2="${base}"/>`;
        ms.forEach((m, i) => {
            const x = band * i + (band - bw) / 2, thin = m.n < GameQuality.MIN_SLICE;
            g += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${sliceName(m)}</text>`;
            if (m.per10 === null) return;
            g += vBar(x, base, base - Math.max(1, m.per10 * k), bw, top && m === top.slice ? 'si-down' : thin ? 'si-mid si-thin' : 'si-mid', I18n.mark(`${I18n.t('Coups')} ${sliceName(m)} · ${num1(m.per10)} · ${m.errors} / ${m.n}`));
            g += `<text class="${top && m === top.slice ? 'v' : ''}" x="${x + bw / 2}" y="${base - m.per10 * k - 4}" text-anchor="middle">${num1(m.per10)}</text>`;
        });
        return svgOf(W, H, 'Erreurs et gaffes pour 10 coups, par tranche de coups', g);
    }
    function evalArea(pts) {
        const W = 360, H = 96, L = 4, R = 36, T = 6, B = 18, last = pts[pts.length - 1].move, lim = Math.max(50, ...pts.map(p => Math.ceil(Math.abs(p.cp) / 50) * 50));
        const x = m => L + (m - 1) * (W - L - R) / Math.max(1, last - 1), y = v => T + (lim - v) * (H - T - B) / (2 * lim), z = y(0);
        const line = pts.map(p => `${x(p.move).toFixed(1)},${y(p.cp).toFixed(1)}`).join('L'), area = `M${x(pts[0].move)},${z}L${line}L${x(last)},${z}Z`;
        // Le moment où l'avantage tourne : la courbe passe sous zéro et y reste trois coups au moins.
        const flip = pts.find((p, i) => i && p.move >= 6 && pts[i - 1].cp >= 0 && p.cp < 0 && pts.slice(i, i + 4).length === 4 && pts.slice(i, i + 4).every(q => q.cp < 0));
        let g = `<defs><clipPath id="si-cu"><rect x="0" y="0" width="${W}" height="${z}"/></clipPath><clipPath id="si-cd"><rect x="0" y="${z}" width="${W}" height="${H}"/></clipPath></defs>
            <path class="si-area up" d="${area}" clip-path="url(#si-cu)"/><path class="si-area down" d="${area}" clip-path="url(#si-cd)"/>
            <line class="b" x1="${L}" x2="${W - R}" y1="${z}" y2="${z}"/><path class="si-line ev" d="M${line}"/><text x="${W - R + 5}" y="${z + 3}">0</text>
            <text x="${W - R + 5}" y="${y(lim) + 8}">${pawn(lim)}</text><text x="${W - R + 5}" y="${y(-lim)}">${pawn(-lim)}</text>`;
        if (flip) g += `<line class="b si-dash" x1="${x(flip.move)}" x2="${x(flip.move)}" y1="${T}" y2="${H - B}"/><text class="v" x="${x(flip.move) + 4}" y="${T + 9}">${I18n.mark(`${I18n.t('coup')} ${flip.move}`)}</text>`;
        for (let m = 10; m <= last; m += 10) g += `<text x="${x(m)}" y="${H - 5}" text-anchor="middle">${m}</text>`;
        pts.forEach(p => { g += `<rect x="${x(p.move) - 4}" y="${T}" width="8" height="${H - T - B}" fill="transparent"><title>${I18n.mark(`${p.move} · ${pawn(p.cp)}`)}</title></rect>`; });
        return { svg: svgOf(W, H, 'Évaluation moyenne de votre point de vue, par coup', g), flip };
    }

    // Point 5 : escalier ; la largeur dit combien de parties, la hauteur le score.
    const EXIT_NAMES = ['Nettement moins bien', 'Un peu moins bien', 'Égal', 'Un peu mieux', 'Nettement mieux'], EXIT_CLS = ['si-down', 'si-down si-soft', 'si-mid', 'si-up si-soft', 'si-up'];
    function stairsChart(ex) {
        const W = 360, H = 150, T = 16, B = 34, base = H - B, k = (base - T) / 100, gap = 2;
        let x = 0, g = `<line class="g si-dash" x1="0" x2="${W}" y1="${base - 50 * k}" y2="${base - 50 * k}"/>`;
        ex.buckets.forEach((t, i) => {
            if (!t.n) return;
            const w = t.n / ex.n * W, bw = Math.max(1, w - gap);
            g += vBar(x + gap / 2, base, base - Math.max(1, t.score * k), bw, EXIT_CLS[i], I18n.mark(`${EXIT_NAMES[i]} · ${_plural(t.n, 'partie')} · ${pct(t.score)}`));
            if (bw >= 26) g += `<text class="v" x="${x + w / 2}" y="${base - t.score * k - 4}" text-anchor="middle">${Math.round(t.score)}</text><text x="${x + w / 2}" y="${base + 13}" text-anchor="middle">${t.n}</text>`;
            x += w;
        });
        g += `<line class="b" x1="0" x2="${W}" y1="${base}" y2="${base}"/><text class="lab" x="0" y="${H - 4}">← ${I18n.t('moins bien sorti')}</text><text class="lab" x="${W}" y="${H - 4}" text-anchor="end">${I18n.t('mieux sorti')} →</text>`;
        return svgOf(W, H, 'Score selon la sortie d’ouverture', g);
    }

    function qualiteHTML(games, list, rows) {
        const bar = evalBarHTML(games), q = GameQuality.quality(list);
        if (q.games < MIN) return `${bar}<p class="st-sub">Les résultats apparaissent dès ${MIN} parties analysées avec ces filtres.</p>`;
        const months = GameQuality.months(list, st.period || 12, Date.now()), ph = GameQuality.phaseGaps(q), top = GameQuality.moment(q), ex = GameQuality.exitSummary(rows);
        const c = q.conversion, r = q.resistance;
        const phaseTitle = ph.worst === null ? 'Au niveau partout' : `Vous perdez pied ${PHASE_IN[ph.worst]}`;
        const phaseTake = ph.worst === null ? 'Vous jouez au moins aussi précisément que vos adversaires dans chaque phase.' : `${PHASES[ph.worst]} : ${points(ph.dials[ph.worst].gap)} sous vos adversaires.`;
        const momentTitle = !top ? 'À quel moment la partie vous échappe-t-elle ?' : top.slice.to === null ? `Vos fautes arrivent après le coup ${top.slice.from - 1}` : `Vos fautes arrivent entre les coups ${top.slice.from} et ${top.slice.to}`;
        const per10 = top ? I18n.mark(num1(top.slice.per10)) : '', more = top && top.ratio !== null && top.ratio >= 1.5 ? `, ${I18n.mark(num1(top.ratio))} fois plus qu'en ouverture.` : '.';
        const momentTake = !top ? 'Il faut plus de coups analysés par tranche pour situer vos fautes.'
            : top.slice.per10 >= 2 ? `${per10} erreurs ou gaffes pour 10 coups${more}` : `${per10} erreur ou gaffe pour 10 coups${more}`;
        const area = q.curve.length >= 5 ? evalArea(q.curve) : null;
        const exitFair = fair(ex.better) && fair(ex.worse) && ex.gain !== null;
        const exitTitle = !exitFair ? 'Votre sortie d\'ouverture décide-t-elle du résultat ?' : ex.gain > 0 ? `Une bonne sortie vaut ${I18n.mark(signed(ex.gain))} points de score` : 'Une bonne sortie ne vous rapporte rien de plus';
        const exitTake = ex.n >= MIN ? `Vous sortez à l'avantage dans ${pct(ex.betterShare)} de vos parties.` : '';
        return `${bar}<div class="so-kpis">
                <div class="so-card so-kpi"><span>Précision</span><b>${pct(q.me.accuracy)}</b><small>Adversaires : ${pct(q.opp.accuracy)}</small></div>
                <div class="so-card so-kpi"><span>Gaffes pour 40 coups</span><b>${fmt1(q.me.blunder)}</b><small>Adversaires : ${fmt1(q.opp.blunder)}</small></div>
                <div class="so-card so-kpi"><span>Erreurs pour 40 coups</span><b>${fmt1(q.me.mistake)}</b><small>Adversaires : ${fmt1(q.opp.mistake)}</small></div>
                <div class="so-card so-kpi"><span>Imprécisions pour 40 coups</span><b>${fmt1(q.me.inaccuracy)}</b><small>Adversaires : ${fmt1(q.opp.inaccuracy)}</small></div>
            </div>
            <div class="so-grid">
                ${accuracyCard(q, months)}
                ${card('so-c6 si-phases', phaseTitle, phaseTake, `${dialsChart(ph)}${legend([['si-key arc', 'Vous, mieux que vos adversaires'], ['si-key arc down', 'Vous, moins bien'], ['si-key needle', 'Vos adversaires']])}`)}
                ${card('so-c6 si-moments', momentTitle, momentTake, `${momentsChart(q, top)}<p class="si-cap">Erreurs et gaffes pour 10 de vos coups, par tranche de 10 coups</p>${area ? `<p class="si-cap si-cap-h">${area.flip ? `L'avantage tourne vers le coup ${area.flip.move}` : 'Évaluation moyenne, de votre point de vue'}</p>${area.svg}` : ''}`)}
                ${ex.n ? card('so-c6 si-exit', exitTitle, exitTake, `${stairsChart(ex)}${legend(EXIT_NAMES.map((n, i) => [`si-sw ${EXIT_CLS[i]}`, n]))}<p class="si-cap">Évaluation au dernier coup de votre répertoire ; largeur : nombre de parties, hauteur : score (pointillé : 50 %)</p>`) : ''}
                ${card('so-c6', 'Transformez-vous vos avantages ?', '', `<div class="sg-tiles">${c.n ? tile('Avantages convertis', pct(c.score), _plural(c.n, 'partie')) : ''}${r.n ? tile('Positions sauvées', pct(r.score), _plural(r.n, 'partie')) : ''}</div>`)}
                ${card('so-c6', 'Voyez-vous les fautes adverses ?', '', `<div class="sg-tiles">${q.chances ? tile('Fautes adverses punies', pct(q.punished), _plural(q.chances, 'occasion')) : ''}${q.errors ? tile('Vos fautes non punies', pct(q.unpunished), _plural(q.errors, 'faute')) : ''}</div>`)}
            </div>`;
    }

    // ─── POSITIONS ───────────────────────────────────────────────────────────
    const STRUCTURES = { 'iqp+': 'Votre pion isolé en d', 'iqp-': 'Pion isolé adverse en d', 'hang+': 'Vos pions pendants', 'hang-': 'Pions pendants adverses', carlsbad: 'Structure de Carlsbad', maroczy: 'Étau de Maroczy', french: 'Chaîne française', kid: 'Chaîne est-indienne', open: 'Centre ouvert' };
    const ENDGAMES = { pawn: ['Finales de pions', 'pions'], rook: ['Finales de tours', 'tours'], queen: ['Finales de Dame', 'dame'], minor: ['Pièces mineures', 'mineures'], rookMinor: ['Tour + pièce', 'tour-piece'] };
    const IMBALANCES = [['exch+', 'Un échange de plus'], ['exch-', 'Un échange de moins'], ['minors+', 'Deux pièces contre une tour'], ['minors-', 'Une tour contre deux pièces'], ['piece+', 'Une pièce de plus'], ['piece-', 'Une pièce de moins'], ['pawn+', 'Un pion de plus'], ['pawn-', 'Un pion de moins'], ['even', 'Égalité matérielle']];
    const CASTLES = { same: 'Roques du même côté', opposite: 'Roques opposés', meNone: 'Vous sans roque', oppNone: 'Adversaire sans roque' };
    // Nom d'un type de « Vos terrains, vos pièges » (GamePositions.terrains), ou '' s'il n'est pas affiché.
    function typeName(id) {
        const [k, v] = id.split(':');
        if (k === 'q') return v === 'off' ? 'Sans dames' : 'Avec dames';
        if (k === 'c') return CASTLES[v] || '';
        if (k === 'st') return STRUCTURES[v] || '';
        if (k === 'eg') return ENDGAMES[v] ? ENDGAMES[v][0] : '';
        if (k === 'imb') { const x = IMBALANCES.find(([key]) => key === v); return x && v !== 'even' ? x[1] : ''; }
        return '';
    }
    // L'écart, dit « vs votre Elo » : votre score moins celui que les Elo prévoient, en % (arbitrage du 12 novembre, K5).
    const vsElo = d => d === null ? '–' : Math.abs(d) < .5 ? I18n.t('comme prévu') : fmtDelta(d);
    const vsEloWords = d => {
        if (d === null) return '';
        if (Math.abs(d) < .5) return 'comme vos Elo le prévoient';
        const pts = I18n.mark(`${Math.abs(Math.round(d))} %`);
        return d >= 0 ? `${pts} de mieux que vos Elo ne le prévoient` : `${pts} de moins que vos Elo ne le prévoient`;
    };
    const saidOf = (label, d) => I18n.pair(I18n.t(label), I18n.t(vsEloWords(d)));
    // Échelle commune aux lignes d'une carte : le plus grand écart, arrondi à 5 points (10 au moins).
    const divLim = ts => Math.max(10, ...ts.filter(t => t && t.delta !== null).map(t => Math.ceil(Math.abs(t.delta) / 5) * 5));
    // Une ligne : nom, parties, barre qui part de « comme prévu », écart ; le score brut en infobulle.
    const posRow = (label, t, extra, lim = divLim([t])) => {
        const w = t.delta === null ? 0 : Math.min(50, Math.abs(t.delta) / lim * 50), tip = I18n.mark(`${I18n.t(label)} · ${pct(t.score)}${t.expected === null ? '' : ` / ${pct(t.expected)}`} · ${_plural(t.n, 'partie')}`);
        return `<div class="si-pos" title="${tip}"><span>${label}</span><small>${t.n}</small><span class="si-div" aria-hidden="true">${t.delta === null ? '' : `<i class="${t.delta >= 0 ? 'up' : 'down'}" style="${t.delta >= 0 ? 'left' : 'right'}:50%;width:${Math.max(.8, w).toFixed(1)}%"></i>`}</span><b class="${t.delta === null ? '' : t.delta >= 0 ? 'up' : 'down'}">${vsElo(t.delta)}</b>${extra || ''}</div>`;
    };
    const head = '<div class="si-pos si-pos-h" aria-hidden="true"><span></span><small>Parties</small><span class="si-div-h"><em>comme prévu</em></span><b>vs votre Elo</b></div>';
    const pair = (a, la, b, lb) => a.delta !== null && b.delta !== null ? I18n.mark(`${saidOf(la, a.delta)}. ${saidOf(lb, b.delta)}.`) : '';

    function terrainsHTML(r) {
        const x = GamePositions.terrains(r, MIN, id => !!typeName(id));
        if (!x.best.length && !x.worst.length) return '';
        const col = (cls, title, items, empty) => `<div class="si-ter ${cls}"><h6>${title}</h6>${items.length ? items.map(y => `<div class="si-ter-i" title="${I18n.mark(`${pct(y.t.score)}${y.t.expected === null ? '' : ` / ${pct(y.t.expected)}`} · ${_plural(y.t.n, 'partie')}`)}"><span>${typeName(y.id)}<small>${_plural(y.t.n, 'partie')}</small></span><b>${vsElo(y.t.delta)}</b></div>`).join('') : `<p class="st-sub">${empty}</p>`}</div>`;
        const best = x.best[0], worst = x.worst[0];
        const take = I18n.mark(`${best ? saidOf(typeName(best.id), best.t.delta) : saidOf(typeName(worst.id), worst.t.delta)}.`);
        return card('so-c12 si-terrains', 'Vos terrains, vos pièges', take, `<div class="si-ters">${col('up', 'Vos terrains', x.best, 'Aucun type de position au-dessus de vos Elo.')}${col('down', 'Vos pièges', x.worst, 'Aucun type de position sous vos Elo.')}</div><p class="si-cap">vs votre Elo : votre score moins celui que vos Elo et ceux de vos adversaires prévoient, en % ; ${MIN} parties au moins</p>`);
    }

    function positionsHTML(list) {
        const r = GamePositions.report(list);
        if (r.games < MIN) return `<p class="st-sub">${GamePositions.running() ? 'Lecture des positions de vos parties…' : 'Trop peu de parties avec ces filtres.'}</p>`;
        const q = r.queens, c = r.castling, known = l => l.filter(x => fair(x.t)).sort((a, b) => (b.t.delta ?? 0) - (a.t.delta ?? 0));
        const st = known(r.structures.filter(x => STRUCTURES[x.key])), eg = known(r.endgames.filter(x => ENDGAMES[x.key])), im = IMBALANCES.map(([k, l]) => ({ l, x: r.imbalances.find(y => y.key === k) })).filter(y => y.x && fair(y.x.t));
        const castleRows = [['same', c.same], ['opposite', c.opposite], ['meNone', c.meNone], ['oppNone', c.oppNone]].filter(([, t]) => fair(t));
        const worstEg = eg[eg.length - 1], top = st[0], low = st[st.length - 1];
        return `<div class="so-grid">
            ${terrainsHTML(r)}
            ${fair(q.off) && fair(q.on) ? card('so-c6', 'Préférez-vous jouer avec ou sans dames ?', pair(q.off, 'Sans dames', q.on, 'Avec dames'), `${head}${posRow('Sans dames', q.off, '', divLim([q.off, q.on]))}${posRow('Avec dames', q.on, '', divLim([q.off, q.on]))}`) : ''}
            ${castleRows.length ? card('so-c6', 'Où êtes-vous à l\'aise pour roquer ?', fair(c.same) && fair(c.opposite) ? pair(c.opposite, 'Roques opposés', c.same, 'Mêmes côtés') : '', `${head}${castleRows.map(([k, t]) => posRow(CASTLES[k], t, '', divLim(castleRows.map(x => x[1])))).join('')}`) : ''}
            ${st.length ? card('so-c6', 'Quelles structures vous réussissent ?', st.length > 1 && top.t.delta !== null ? `La plus rentable : ${STRUCTURES[top.key]} (${vsElo(top.t.delta)}). La moins rentable : ${STRUCTURES[low.key]} (${vsElo(low.t.delta)}).` : 'Structure de pions au coup 15', `${head}${st.map(x => posRow(STRUCTURES[x.key], x.t, '', divLim(st.map(y => y.t)))).join('')}`) : ''}
            ${eg.length ? card('so-c6', 'Quelles finales vous coûtent des points ?', worstEg.t.delta !== null && worstEg.t.delta < 0 ? `La plus coûteuse : ${ENDGAMES[worstEg.key][0]}, ${vsEloWords(worstEg.t.delta)}.` : 'Vous tenez ce que vos Elo prévoient dans chaque type de finale.', `${head}${eg.map(x => posRow(ENDGAMES[x.key][0], x.t, `<button type="button" class="st-link si-go" data-action="statsGoEndgame" data-arg="${ENDGAMES[x.key][1]}">S'entraîner</button>`, divLim(eg.map(y => y.t)))).join('')}`) : ''}
            ${im.length ? card('so-c12', 'Comment jouez-vous les déséquilibres ?', 'Premier déséquilibre matériel tenu au moins trois coups', `${head}${im.map(y => posRow(y.l, y.x.t, '', divLim(im.map(z => z.x.t)))).join('')}`) : ''}
        </div>`;
    }

    // Lance ou poursuit l'analyse : quand la vue Qualité est à l'écran, et en arrière-plan après le lancement (point 1, option D),
    // BG_COUNT parties au plus, tant que l'app est visible et que l'échiquier n'a pas besoin du moteur. La période affichée d'abord (option F).
    const BG_COUNT = 20, BG_DELAY = 6000, BG_RETRY = 60e3, BG_TRIES = 10, REPAINT_EVERY = 5;
    const viewVisible = () => { const el = document.getElementById('si-view'); return !!el && el.offsetParent !== null && !document.hidden; };
    const inView = () => st.view === 'qualite' && viewVisible();
    const boardBusy = () => typeof _gameScreenShown === 'function' && _gameScreenShown();
    const bgOk = () => st.bgLeft > 0 && !document.hidden && !boardBusy();
    const shouldRun = () => !st.paused && (inView() || bgOk());
    const firstOf = () => keeper();
    function refreshView() {
        const el = document.getElementById('si-view'), games = StatsGames.games();
        if (el && games && st.view !== 'repertoire') el.innerHTML = viewHTML(games, StatsGames.analysed());
    }
    function runEval(games) {
        if (!shouldRun() || GameEval.running() || !GameEval.pending(games).length) return;
        st.evalError = '';
        st.shown = 0;
        GameEval.run(games, {
            shouldRun, first: firstOf(),
            onGame: () => {
                if (!inView()) st.bgLeft--;
                const box = document.getElementById('si-eval');
                if (box && viewVisible()) { const fresh = document.createElement('div'); fresh.innerHTML = evalBarHTML(games); box.replaceWith(fresh.firstElementChild); }
            },
            onSaved: done => {
                if (inView()) refreshView();
                if (done - st.shown >= 20) { st.shown = done; Bus.emit('games:evaluated'); }
            }
        }).catch(() => { st.evalError = 'Le moteur ne répond pas. Réessayez plus tard.'; }).then(() => {
            refreshView(); Bus.emit('games:evaluated');
            if (st.bgLeft > 0 && GameEval.pending(games).length) background();
        });
    }
    function pump() {
        const games = StatsGames.games();
        if (games) GamePositions.run(games, () => { if (st.view === 'positions') refreshView(); });
        if (games) runEval(games);
    }
    // Analyse en arrière-plan : reprise plus tard si l'échiquier occupe le moteur ou si l'app est cachée.
    let bgTries = 0;
    async function background() {
        if (st.bgLeft <= 0 || bgTries++ >= BG_TRIES) return;
        if (!bgOk() || GameEval.running()) { setTimeout(background, BG_RETRY); return; }
        await StatsGames.prime();
        const games = StatsGames.games();
        if (games && games.length) runEval(games);
    }
    st.bgLeft = 0;
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') Bus.afterIntro(() => { st.bgLeft = BG_COUNT; background().catch(e => reportError('analyse des parties en arrière-plan', e)); }, BG_DELAY);

    // Contenu de la vue active, hors Répertoire (rendu par StatsGames).
    function viewHTML(games, rows) {
        const list = games.filter(keeper());
        if (st.view === 'positions') return `<div class="si-wrap">${positionsHTML(list)}</div>`;
        if (st.view === 'qualite') return `<div class="si-wrap">${qualiteHTML(games, list, rows.filter(r => keep(r.g)))}</div>`;
        if (st.view === 'temps') return `<div class="si-wrap">${tempsHTML(list, rows.filter(r => keep(r.g)))}</div>`;
        if (st.view === 'resume') return `<div class="si-wrap">${resumeHTML(list)}</div>`;
        const from = since();
        return `${recordsHTML(games.filter(g => g.at >= from))}<div class="si-wrap">${bilanHTML(games, list)}</div>`;
    }

    const repaint = () => StatsGames.repaint();
    registerActions({
        statsInPeriod: p => { st.period = Number(p); saveFilters(); statsRerender(); },
        statsInSite: s => { st.site = s; saveFilters(); if (s !== 'all') setPref('eloSite', s); statsRerender(); },
        statsInSpeed: s => { st.speed = s; saveFilters(); if (s !== 'all') setPref('eloSpeed', s); statsRerender(); },
        statsInView: v => { st.view = v; repaint(); pump(); },
        statsInEval: () => { st.paused = !st.paused; refreshView(); pump(); }
    });

    // show : vue ouverte par un constat « À faire » ; period : mois retenus (0 = tout), lu par la fiche d'ouverture.
    // since : début de la période (0 = tout), lu par la courbe d'Elo.
    // active : filtres des parties écartés de leur valeur par défaut (pastille du bouton « Filtrer » des Ouvertures).
    return { filtersHTML, viewsHTML, viewHTML, keep, pump, since, view: () => st.view, show: v => { st.view = v; }, period: () => st.period,
             active: () => (st.period !== 12) + (st.site !== 'all') + (st.speed !== 'all') };
})();
