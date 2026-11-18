/**
 * screens/stats/statsOpenings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Onglet Ouvertures (refonte « Chays sans détour », lot 3 ; avant : Statistiques › Ouvertures) : la liste « miroir » et une seule fiche,
 * quelle que soit la taille du répertoire. La fiche porte « Réviser » (startOpeningReview), l'arbre des coups appris et « Échiquier libre ».
 *   Index (atelier « Ouvertures et Progrès », lot 1 ; « Vitrine » du chantier « Ouvertures repensées ») : toutes les ouvertures
 *     du classement en tuiles (miniature et sceau du rang, nom, une phrase d'état, écart en Elo), en lignes de 60 px quand la fiche
 *     est à côté ; ou la carte maîtrise × résultats (segment Liste / Carte) ; la barre de niveaux du haut filtre. Toucher ouvre
 *     la fiche : à côté dès 980 px, à la place de l'index en dessous (« ‹ Ouvertures » y ramène, st.open).
 *   Sélecteur (« Toutes les ouvertures ») : recherche par nom ou par coups, « À travailler d'abord », familles, carte maîtrise × résultats.
 *     Fenêtre posée sous <body> : dans l'onglet, une requête de conteneur capterait le position: fixed du tiroir de téléphone.
 *   Fiche (« Vitrine ») : un en-tête (position, rang, une phrase, « Réviser » seule action pleine), puis trois onglets (st.tab) :
 *     Ligne (Vos oublis en partie, explorateur coup par coup OpeningExplorer), En partie (Votre niveau dans cette ouverture en Elo
 *     et Mois par mois, Jusqu'où va votre préparation), Mes coups (du plus fragile au plus sûr, 5 puis le reste à la demande).
 * Le rattachement d'une partie : la position la plus avancée de mon répertoire qu'elle a atteinte (les transpositions comptent).
 * Sans position enregistrée, la partie rejoint son ouverture nommée (« Hors répertoire »). Calculs : OpeningReport.
 * Seules les positions déjà travaillées forment les groupes, comme l'Entraînement (_assignOpenings).
 * Période, site et cadence : ceux de la barre de contexte (StatsInsights).
 */

'use strict';

const StatsOpenings = (function () {
    const ROWS = 5, AFTER_PLIES = 4, PRIORITY = 3, MIN_OUT = 2, MIN_MAP = 3, SWAPS = 3, MIN_DIAG = 5;
    const LOSING = -3, SURE = 80, EVEN_ELO = 15;                  // « Perd des points » dès −3 pt ; « Sue » dès 80 / 100 ; ±15 Elo : à mon niveau
    const OTHER = 'Autres positions';
    const st = { ctx: null, scope: '', cur: null, picked: false, open: false, view: 'list', mode: 'list', tab: 'line', q: '', active: -1, all: new Set(), cursor: new Map(), list: [], reached: new Map() };

    const pct = v => `${Math.round(v)} %`;
    const num1 = v => Math.abs(v).toLocaleString(I18n.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const slot = () => document.getElementById('stats-lines');
    const evalText = cp => I18n.mark(`${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toLocaleString(I18n.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const share = (g, l) => g.all.length ? g.counts[l] / g.all.length : 0;
    const lostOf = g => g.stats.n >= MIN_MAP && g.stats.lost > 0 ? g.stats.lost : 0;
    const fairDelta = t => t.n >= MIN_MAP ? t.delta : null;                      // sur une ou deux parties, l'écart ne veut rien dire

    const DIAG = {
        learn: ['À apprendre', (m, lost) => `Maîtrise de ${m} sur 100, et ${lost} points de moins que prévu. Apprendre ses positions fragiles est le gain le plus direct.`],
        replace: ['À remplacer ?', (m, lost, ev) => `Vous la connaissez (${m} sur 100), mais vous sortez de l'ouverture à ${ev} et perdez ${lost} points. La ligne elle-même mérite un examen.`],
        through: ['À jouer en entier', (m, lost, ev) => `L'ouverture se passe bien (${ev} à la sortie), puis ${lost} points partent. Le travail est dans le milieu de partie typique.`],
        losing: ['Sue mais perdante', (m, lost) => `Vous la connaissez (${m} sur 100), mais elle rapporte ${lost} points de moins que prévu. Regardez où les parties tournent après l'ouverture.`],
        consolidate: ['À consolider', m => `Elle rapporte plus que prévu sans être bien sue (${m} sur 100). Ces points restent fragiles face à de meilleurs joueurs.`],
        keep: ['À garder', () => 'Bien sue et rentable. Une révision régulière suffit.']
    };

    // ─── DONNÉES ─────────────────────────────────────────────────────────────
    const monthSpan = () => StatsInsights.period() || 12;          // « Tout » : l'évolution garde douze mois
    function since() { const p = StatsInsights.period(); if (!p) return 0; const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - p + 1, 1).getTime(); }

    function build() {
        const { rows, rp } = st.ctx, map = new Map(), owner = new Map(rows.map(r => [r.side + '|' + r.k, r])), from = since();
        const group = (key, side, name, html, path) => {
            if (!map.has(key)) map.set(key, { key, side, name, html, path, all: [], items: [], games: [], recent: [] });
            return map.get(key);
        };
        rows.forEach(r => group(r.gKey, r.side, r.gName, r.gHtml, r.gPath).all.push(r));
        st.reached = new Map();
        StatsGames.analysed().filter(x => StatsInsights.keep(x.g, true)).forEach(x => {
            const leftAtOnce = x.a.dev && x.a.dev.by === 'me' && x.a.mine.length === 1;     // quitté dès mon premier coup : une autre ouverture
            const home = leftAtOnce ? null : x.a.mine.slice().reverse().map(k => owner.get(x.g.color + '|' + k)).find(Boolean);
            const name = x.a.op ? x.a.op.name : OTHER;
            const gr = home ? map.get(home.gKey) : group(`${x.g.color}|${name}`, x.g.color, name, escapeHtml(name), x.a.op ? x.a.op.path : []);
            gr.games.push(x);
            if (x.g.at < from) return;
            gr.recent.push(x);
            x.a.mine.forEach(k => { const id = x.g.color + '|' + k; if (!st.reached.has(id)) st.reached.set(id, []); st.reached.get(id).push(x.g); });
        });
        // Rangs (atelier « L'envie de revenir », lot 4) : rangés sans fête ici ; la promotion se fête au bilan de séance.
        if (typeof OpeningMarks !== 'undefined') OpeningMarks.update(currentRepertoire, rows);
        map.forEach(g => {
            g.rank = g.all.length && g.path.length && typeof OpeningMarks !== 'undefined' ? OpeningMarks.rank(currentRepertoire, g.key) : null;
            g.counts = _countLevels(g.all);
            g.items = g.all.filter(r => statsFilter === 'all' || r.lv === statsFilter);
            g.due = g.all.filter(r => rp.today(r.side, r.k)).length;
            g.mastery = g.all.length ? Math.round(g.all.reduce((s, r) => s + masteryOf(r.e), 0) / g.all.length) : null;
            g.stats = OpeningReport.summarize(g.recent.map(x => x.g));
            // Verdict de l'index : celui de la fiche, seulement avec assez de parties (sinon la maîtrise).
            g.diag = g.all.length && g.stats.n >= MIN_DIAG
                ? OpeningReport.diagnose(g.stats.n, g.stats.delta, g.mastery, OpeningReport.detail(g.recent, g.path.length).exitEval) : null;
        });
        st.list = [...map.values()].filter(g => statsFilter === 'all' ? g.all.length || g.stats.n >= MIN_OUT : g.items.length).sort((a, b) =>
            lostOf(b) - lostOf(a) || share(b, 'weak') - share(a, 'weak') || share(b, 'fragile') - share(a, 'fragile') || share(b, 'progress') - share(a, 'progress') || b.all.length - a.all.length || b.stats.n - a.stats.n);
        // Tant que rien n'a été choisi, la fiche suit le classement : les parties arrivent après le premier rendu.
        if (!st.picked || !st.list.some(g => g.key === st.cur)) st.cur = st.list.length ? st.list[0].key : null;
    }
    const current = () => st.list.find(g => g.key === st.cur) || null;

    // ─── PETITS ÉLÉMENTS ─────────────────────────────────────────────────────
    const wdlBar = t => t.n ? `<span class="so-wdl" role="img" aria-label="${I18n.mark(`${t.w} / ${t.d} / ${t.l}`)}">${[['w', t.w], ['d', t.d], ['l', t.l]].filter(([, n]) => n).map(([k, n]) => `<i class="sg-${k}" style="flex:${n}"></i>`).join('')}</span>` : '';
    const sideDot = s => `<span class="so-dot ${s}" aria-hidden="true"></span>`;
    const metaOf = g => g.all.length ? `${_plural(g.stats.n, 'partie')} · maîtrise ${g.mastery} / 100` : `${_plural(g.stats.n, 'partie')} · hors répertoire`;

    // Score face à l'attendu, dit en Elo (chantier « Ouvertures repensées », point 3) : le niveau joué dans l'ouverture
    // et son écart à mon Elo moyen des mêmes parties (OpeningReport.summarize : perf, me, gap ; 3 parties classées au moins).
    const elo = v => I18n.mark(Math.round(v).toLocaleString(I18n.locale()));
    const eloSigned = v => I18n.mark(`${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString(I18n.locale())} Elo`);
    const eloTag = t => t.gap === null ? '' : `<small class="so-elo ${t.gap >= 0 ? 'up' : 'down'}">${eloSigned(t.gap)}</small>`;
    function eloSentence(t) {
        if (t.perf === null) return '';
        const n = Math.abs(t.gap);
        return n < EVEN_ELO ? `Vous y jouez comme un ${elo(t.perf)}, à votre niveau.`
            : t.gap < 0 ? `Vous y jouez comme un ${elo(t.perf)}, ${elo(n)} sous votre Elo.`
            : `Vous y jouez comme un ${elo(t.perf)}, ${elo(n)} au-dessus de votre Elo.`;
    }

    // Une phrase d'état par ouverture (index « Vitrine ») : à la place du verdict, de la maîtrise et de l'écart.
    function stateOf(g) {
        if (!g.all.length) return ['dim', 'Hors répertoire'];
        const d = fairDelta(g.stats), weak = g.counts.weak + g.counts.fragile;
        if (d !== null && d <= LOSING) return ['loss', 'Perd des points'];
        if (weak) return ['weak', _plural(weak, 'coup à revoir', 'coups à revoir')];
        if (g.due) return ['dim', `${g.due} à réviser`];
        if (g.mastery >= SURE) return ['sure', 'Sue · à jour'];
        return ['dim', 'À jour'];
    }

    // Petit échiquier avec flèches (oublis) : l'échiquier de _miniBoardHTML, un calque SVG de 8 × 8 cases par-dessus.
    function arrowsBoard(side, path, arrows, label) {
        const at = sq => { const f = sq.charCodeAt(0) - 97, r = Number(sq[1]) - 1; return side === 'w' ? [f + .5, 7.5 - r] : [7.5 - f, r + .5]; };
        const svg = arrows.filter(([u]) => /^[a-h][1-8][a-h][1-8]/.test(u || '')).map(([u, cls]) => {
            const [x1, y1] = at(u.slice(0, 2)), [x2, y2] = at(u.slice(2, 4)), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
            const ex = x2 - ux * .5, ey = y2 - uy * .5, px = -uy * .36, py = ux * .36, f = v => v.toFixed(2);
            const shaft = `x1="${f(x1)}" y1="${f(y1)}" x2="${f(ex)}" y2="${f(ey)}"`, head = `points="${f(x2)},${f(y2)} ${f(ex + px)},${f(ey + py)} ${f(ex - px)},${f(ey - py)}"`;
            return `<g class="${cls}"><line class="halo" ${shaft}/><polygon class="halo" ${head}/><line ${shaft}/><polygon ${head}/></g>`;
        }).join('');
        return `<span class="so-ar">${_miniBoardHTML({ side, path }, true, { label })}<svg class="so-ar-svg" viewBox="0 0 8 8" aria-hidden="true">${svg}</svg></span>`;
    }

    // ─── FICHE : EN-TÊTE ─────────────────────────────────────────────────────
    // Une position, un rang, une phrase et une seule action pleine (direction « Vitrine »).
    function headHTML(g) {
        const s = g.stats, exit = s.n ? OpeningReport.detail(g.recent, g.path.length).exitEval : null, id = OpeningReport.diagnose(s.n, s.delta, g.mastery, exit), d = id && DIAG[id];
        const text = !g.all.length ? 'Hors de votre répertoire : aucune position travaillée pour cette ouverture.'
            : !s.n ? 'Aucune de vos parties récentes ne passe par cette ouverture.'
            : !d ? `Trop peu de parties pour juger (${s.n}).` : d[1](g.mastery, num1(s.lost), exit === null ? '' : evalText(exit));
        const say = eloSentence(s);
        return `<div class="so-head vel-card vel-dark${g.all.length ? ' has-rep' : ''}">
            <div class="so-head-top">
                ${g.path.length ? `<div class="so-board">${_miniBoardHTML({ side: g.side, path: g.path }, true, { label: g.name })}</div>` : ''}
                <div class="so-head-id">
                    <span class="st-eyebrow">${g.side === 'w' ? 'Blancs' : 'Noirs'}${g.all.length ? ` · ${_plural(g.all.length, 'position')}` : ''}</span>
                    <h4 class="so-name">${g.html}</h4>
                    ${g.path.length && g.name !== _movesLabel(g.path) ? `<small class="so-moves">${_movesLabel(g.path, true)}</small>` : ''}
                    ${d || g.rank !== null ? `<div class="so-tags">${g.rank !== null ? _opRankHTML(g.rank) : ''}${d ? `<span class="so-diag">${d[0]}</span>` : ''}</div>` : ''}
                </div>
            </div>
            <p class="so-say">${say ? `<b>${say}</b> ` : ''}${text}</p>
            ${rankHTML(g)}${ideaHTML(g)}
            ${reviewHTML(g)}
        </div>`;
    }

    // Rang (atelier « L'envie de revenir », lot 4) : ce qui manque pour le suivant, et une barre.
    function rankHTML(g) {
        if (g.rank === null) return '';
        const p = OpeningMarks.progress(OpeningMarks.statsOf(g.all), g.rank), name = OpeningMarks.RANKS;
        if (!p) return `<div class="so-rank is-top"><span>Maître de cette ouverture : elle le reste tant qu’elle est révisée.</span></div>`;
        return `<div class="so-rank"><div class="so-rank-h"><span>Vers ${name[p.to]}</span><b>${p.pct} %</b></div>
            <span class="so-rank-track" role="img" aria-label="${p.pct} %"><i style="width:${p.pct}%"></i></span>
            ${p.need.length ? `<small>${p.need.map(escapeHtml).join(' · ')}</small>` : ''}</div>`;
    }

    // L'idée de la ligne (lot 4) : la phrase du joueur, celle de la famille, sinon une suggestion à garder ou réécrire.
    function ideaHTML(g) {
        if (!g.all.length || !g.path.length || typeof OpeningMarks === 'undefined') return '';
        const v = OpeningMarks.idea(currentRepertoire, g.side, g.name), arg = escapeHtml(g.key);
        if (!v) return `<button type="button" class="hp-link so-idea-add" data-action="opIdea" data-arg="${arg}">${ico('plus')}Écrire l’idée de la ligne</button>`;
        const head = !v.own ? 'Idée suggérée' : v.from ? `Idée de la famille ${v.from}` : 'L’idée de la ligne';
        return `<div class="so-idea${v.own ? '' : ' is-suggested'}"><span class="so-idea-h">${escapeHtml(head)}</span>
            <p${v.own ? ' translate="no"' : ''}>${escapeHtml(v.text)}</p>
            <div class="so-idea-acts">${v.own ? '' : `<button type="button" class="hp-link" data-action="opIdeaKeep" data-arg="${arg}">${ico('check')}Garder</button>`}
            <button type="button" class="hp-link" data-action="opIdea" data-arg="${arg}">${ico('pencil')}${v.own && !v.from ? 'Modifier' : 'Écrire la mienne'}</button></div></div>`;
    }

    // Réviser l'ouverture (lot 3) : une action pleine qui lance la séance (les positions dues, sinon les plus
    // fragiles, sinon la ligne entière), et trois variantes en puces ; « Échiquier libre » ouvre l'Analyse ici.
    function reviewHTML(g) {
        if (!g.all.length) return g.path.length ? `<div class="so-acts"><button type="button" class="hp-link so-free" data-action="opFree" data-arg="${escapeHtml(g.key)}">${ico('cpu')}Échiquier libre</button></div>` : '';
        const weak = g.counts.weak + g.counts.fragile, unsure = g.counts[STATS_STATE];
        const main = g.due ? 'due' : weak ? 'weak' : g.path.length ? 'line' : 'unsure';
        const chip = (kind, label, n) => kind === main ? '' : `<button type="button" class="so-chip" data-action="opReview" data-arg="${escapeHtml(kind + ':' + g.key)}"${n === 0 ? ' disabled' : ''}>${label}${n ? ` <b>${n}</b>` : ''}</button>`;
        const label = { due: `Réviser · ${g.due}`, weak: 'Réviser les points faibles', line: 'Réviser la ligne entière', unsure: 'Confirmer les nouvelles' }[main];
        return `<div class="so-review">
            <button type="button" class="btn btn-primary so-go" data-action="opReview" data-arg="${escapeHtml(main + ':' + g.key)}">${ico('play')}<span>${label}</span></button>
            <div class="so-chips">${chip('weak', 'Points faibles', weak)}${g.path.length ? chip('line', 'Ligne entière') : ''}${chip('unsure', 'À confirmer', unsure)}
                ${g.path.length ? `<button type="button" class="so-chip is-free" data-action="opFree" data-arg="${escapeHtml(g.key)}">${ico('cpu')}Échiquier libre</button>` : ''}</div>
            <span class="so-due">${g.due ? `${g.due} à réviser sur ${g.all.length}` : 'À jour'}</span>
        </div>`;
    }

    // ─── FICHE : ONGLETS ─────────────────────────────────────────────────────
    // Trois onglets (direction « Vitrine ») : Ligne (oublis, explorateur), En partie (niveau, mois, préparation), Mes coups.
    // Les trois panneaux sont rendus ; changer d'onglet ne fait que basculer hidden (opTab), sans repeindre.
    const TABS = [['line', 'Ligne'], ['games', 'En partie'], ['moves', 'Mes coups']];
    function tabsHTML(g) {
        const count = { line: 0, games: g.stats.n, moves: g.items.length };
        return `<div class="tr-seg so-tabs" role="tablist" aria-label="Sections de la fiche">${TABS.map(([id, label]) => {
            const on = st.tab === id;
            return `<button type="button" class="tr-seg-btn${on ? ' active' : ''}" role="tab" id="so-t-${id}" aria-selected="${on}" aria-controls="so-p-${id}" tabindex="${on ? 0 : -1}" data-action="opTab" data-arg="${id}">${label}${count[id] ? ` <b>${count[id]}</b>` : ''}</button>`;
        }).join('')}</div>`;
    }
    const paneHTML = (id, html) => `<div class="so-pane" id="so-p-${id}" role="tabpanel" aria-labelledby="so-t-${id}" data-tab="${id}"${st.tab === id ? '' : ' hidden'}>${html}</div>`;

    function setTab(id) {
        if (!TABS.some(([t]) => t === id)) return;
        st.tab = id;
        const s = slot();
        if (!s) return;
        s.querySelectorAll('.so-tabs [role="tab"]').forEach(b => { const on = b.dataset.arg === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
        s.querySelectorAll('.so-pane').forEach(p => { p.hidden = p.dataset.tab !== id; });
    }

    // Ligne › Vos oublis en partie (ex « Coups joués à la place ») : la position, deux flèches (joué / prévu) et « Réviser ce coup ».
    function slipsHTML(g) {
        if (!g.stats.n) return '';
        const db = readDBFor(currentRepertoire, g.side), list = OpeningReport.detail(g.recent, g.path.length).swaps.slice(0, SWAPS);
        if (!list.length) return '';
        return `<div class="so-card so-slips"><h5>Vos oublis en partie</h5>
            <div class="so-slip-list">${list.map(x => {
                const arg = escapeHtml(g.side + ':' + x.key), own = !!db[x.key], played = _moveLabel({ ply: x.ply, san: x.played }, false, true), planned = _moveLabel({ ply: x.ply, san: x.expected }, false, true);
                return `<div class="so-swap">
                    <button type="button" class="so-slip-b" data-action="statsPreview" data-arg="${arg}" data-origin="${escapeHtml(g.name)}" title="Voir la position" aria-label="Voir la position">${arrowsBoard(g.side, x.path || [], [[x.playedUci, 'is-played'], [x.expectedUci, 'is-planned']], 'Position de l’oubli')}</button>
                    <div class="so-slip-t">
                        <span class="so-slip-h">Coup ${Math.ceil(x.ply / 2)} · ${_plural(x.n, 'partie')} · ${pct(x.t.score)}</span>
                        <span class="so-slip-mv is-played"><i aria-hidden="true"></i><span class="so-mv">${played}</span><small>joué</small></span>
                        <span class="so-slip-mv is-planned"><i aria-hidden="true"></i><span class="so-mv">${planned}</span><small>prévu</small></span>
                        ${own ? `<button type="button" class="btn btn-soft so-slip-go" data-action="opReviewMove" data-arg="${arg}">${ico('play')}Réviser ce coup</button>` : ''}
                    </div></div>`;
            }).join('')}</div></div>`;
    }

    // Explorateur (atelier « Ouvertures et Progrès », lot 2) : la ligne se parcourt coup par coup depuis la position de l'ouverture.
    // À mon trait, ma réponse et son niveau ; au trait adverse, les coups connus (répertoire, parties de la période, repérés),
    // et en ambre ceux qui n'ont pas de réponse, avec « Ajouter une réponse » (Analyse sur la position). OpeningExplorer calcule.
    // Il couvre aussi l'ancienne carte « Réponses adverses », retirée (chantier « Ouvertures repensées »).
    const X_REPLIES = 8;
    function explorerHTML(g) {
        if (!g.all.length || !g.path.length) return '';
        const path = st.cursor.get(g.key) || g.path;
        let nd, sans;
        try {
            nd = OpeningExplorer.node({ path, side: g.side, db: readDBFor(currentRepertoire, g.side), opp: readOppFor(currentRepertoire, g.side), rows: g.recent });
            sans = _pathToSans(path);
        } catch (e) { return ''; }
        const arg = p => escapeHtml(p.join(' ')), pct0 = v => `${Math.round(v)} %`;
        const crumbs = sans.map((s, i) => {
            const w = i % 2 === 0, last = i === sans.length - 1;
            return `${w ? `<span class="so-x-num">${i / 2 + 1}.</span>` : ''}<button type="button" class="so-x-mv${last ? ' on' : ''}" data-action="opExplore" data-arg="${arg(path.slice(0, i + 1))}"${last ? ' aria-current="step"' : ''}>${formatSan(s, w ? 'w' : 'b')}</button>`;
        }).join('');
        const ply = path.length + 1, moved = path.length !== g.path.length || path.some((u, i) => u !== g.path[i]);
        const add = p => `<button type="button" class="so-x-add" data-action="opAdd" data-arg="${arg(p)}">${ico('plus')}Ajouter une réponse</button>`;
        let body;
        if (nd.turn === 'me') {
            const m = nd.mine;
            if (!m) body = `<div class="so-x-h">Votre coup</div><div class="so-x-row is-hole"><span class="so-x-san">${_moveLabel({ ply, san: '?' }, true, true)}</span><span class="so-x-info">Pas de réponse enregistrée ici</span>${add(path)}</div>`;
            else {
                const lv = _level(m.entry), score = Math.round(masteryOf(m.entry));
                body = `<div class="so-x-h">Votre coup</div><div class="so-x-line">
                    <button type="button" class="so-x-row is-mine" data-action="opExplore" data-arg="${arg(path.concat(m.uci))}">
                        <span class="so-x-san">${_moveLabel({ ply, san: m.san }, false, true)}</span>
                        <span class="so-x-mid"><span class="so-x-bar lv-${lv}"><i style="width:${Math.max(3, score)}%"></i></span><span class="so-x-info">${_lvEngrave(m.entry)}${score} / 100${m.n ? ` · ${_plural(m.n, 'partie')}` : ''}</span></span>
                        <span class="so-x-lv">${_lvMark(lv)}${STATS_LEVELS[lv].one}</span></button>
                    <button type="button" class="st-ibtn" data-action="statsPreview" data-arg="${escapeHtml(g.side + ':' + m.key)}" data-origin="${escapeHtml(g.name)}" title="Voir la position" aria-label="Voir la position">${ico('eye')}</button></div>`;
            }
        } else if (!nd.replies.length) {
            body = `<div class="so-x-h">Réponses adverses</div><p class="so-x-none">Aucun coup adverse connu ici : ni dans le répertoire, ni dans vos parties.</p>`;
        } else {
            const top = Math.max(1, ...nd.replies.map(r => r.n)), shown = nd.replies.slice(0, X_REPLIES);
            body = `<div class="so-x-h">Réponses adverses${nd.games.n ? ` · ${_plural(nd.games.n, 'partie')} ici` : ''}</div>` + shown.map(r => {
                const label = _moveLabel({ ply, san: r.san }, false, true), info = r.n ? `${_plural(r.n, 'partie')} · ${pct0(r.t.score)}` : r.seen ? 'Repéré' : 'Dans le répertoire';
                if (!r.answered) return `<div class="so-x-row is-hole"><span class="so-x-san">${label}</span><span class="so-x-info">${r.n ? `Joué ${r.n} fois contre vous` : 'Repéré'} · sans réponse</span>${add(path.concat(r.uci))}</div>`;
                const lv = _level(r.answer);
                return `<button type="button" class="so-x-row" data-action="opExplore" data-arg="${arg(path.concat(r.uci))}">
                    <span class="so-x-san">${label}</span>
                    <span class="so-x-mid">${r.n ? `<span class="so-x-bar is-share"><i style="width:${Math.max(4, 100 * r.n / top)}%"></i></span>` : ''}<span class="so-x-info">${info}</span></span>
                    <span class="so-x-lv" title="Votre réponse : ${escapeHtml(formatSanText(r.answer.san, g.side))}">${_lvMark(lv)}${formatSan(r.answer.san, g.side)}</span></button>`;
            }).join('') + (nd.replies.length > shown.length ? `<p class="so-x-none">${_plural(nd.replies.length - shown.length, 'autre coup', 'autres coups')}</p>` : '');
        }
        const cov = g.stats.n ? OpeningReport.detail(g.recent, g.path.length).coverage : null;
        return `<div class="so-card so-x">
            <div class="so-x-top"><h5>Explorateur</h5>${cov === null ? '' : `<span class="so-x-cov" title="Part de vos parties où le coup adverse avait une réponse dans le répertoire"><b>${pct0(cov)}</b> couverture</span>`}</div>
            <div class="so-x-grid">
                <div class="so-x-board">${_miniBoardHTML({ side: g.side, path }, true, { label: 'Position explorée' })}</div>
                <div class="so-x-side">
                    <div class="so-x-crumbs">${crumbs}${moved ? `<button type="button" class="hp-link so-x-reset" data-action="opExplore" data-arg="${arg(g.path)}">Revenir au début</button>` : ''}</div>
                    <div class="so-x-moves">${body}</div>
                </div>
            </div></div>`;
    }

    function paintExplorer() {
        const el = slot() && slot().querySelector('.so-x'), g = current();
        if (!el || !g) { paint(); return; }
        el.outerHTML = explorerHTML(g);
        const on = slot().querySelector('.so-x .so-x-mv.on');
        if (on && on.focus) on.focus({ preventScroll: true });
    }

    // En partie › Votre niveau dans cette ouverture (ex « Score face à l'attendu » et « Niveau joué », fusionnés) :
    // le niveau joué en Elo face au mien, puis la bande « Mois par mois » (ex « Score par mois »).
    function levelHTML(g) {
        const s = g.stats;
        let big, scale = '';
        if (s.perf !== null) {
            const n = Math.abs(s.gap), cls = n < EVEN_ELO ? 'even' : s.gap < 0 ? 'down' : 'up';
            const word = cls === 'even' ? 'à votre niveau' : cls === 'down' ? `${elo(n)} sous votre Elo` : `${elo(n)} au-dessus de votre Elo`;
            big = `<div class="so-lv-big"><b>${elo(s.perf)}</b><span class="so-lv-gap ${cls}">${cls === 'even' ? '' : `<i aria-hidden="true">${cls === 'down' ? '▼' : '▲'}</i>`}${word}</span></div>`;
            const lo = Math.floor((Math.min(s.perf, s.me) - 60) / 100) * 100, hi = Math.ceil((Math.max(s.perf, s.me) + 60) / 100) * 100;
            const W = 300, x = v => 10 + (v - lo) * (W - 20) / (hi - lo), a = x(s.perf), b = x(s.me);
            scale = `<svg class="so-lv-scale ${cls}" viewBox="0 0 ${W} 44" role="img" aria-label="${I18n.mark(`${s.perf} / ${s.me}`)}">
                <line class="track" x1="10" y1="22" x2="${W - 10}" y2="22"/><line class="span" x1="${Math.min(a, b)}" y1="22" x2="${Math.max(a, b)}" y2="22"/>
                <circle class="here" cx="${a}" cy="22" r="6"/><rect class="you" x="${b - 3}" y="12" width="6" height="20" rx="2"/>
                <text x="${a}" y="42" text-anchor="middle">ici ${I18n.mark(String(s.perf))}</text><text x="${b}" y="8" text-anchor="middle">vous ${I18n.mark(String(s.me))}</text>
                <text class="end" x="10" y="42">${I18n.mark(String(lo))}</text><text class="end" x="${W - 10}" y="42" text-anchor="end">${I18n.mark(String(hi))}</text></svg>`;
        } else big = `<div class="so-lv-big"><b>${pct(s.score)}</b><span class="so-lv-gap">des points</span></div><p class="st-sub">Le niveau en Elo demande ${MIN_MAP} parties classées.</p>`;
        return `<div class="so-card so-lv"><h5>Votre niveau dans cette ouverture</h5>${big}${scale}
            <div class="so-lv-sub"><span>${_plural(s.n, 'partie')} · ${pct(s.score)} des points</span>${wdlBar(s)}</div>
            ${monthsHTML(g)}</div>`;
    }

    // Mois par mois : une case par mois, au-dessus (vert) ou sous (rouge) le score attendu à mon Elo, vide sans partie.
    function monthsHTML(g) {
        const list = OpeningReport.months(g.recent.map(x => x.g), monthSpan(), Date.now()), fmt = new Intl.DateTimeFormat(I18n.locale(), { month: 'short' });
        const name = t => fmt.format(new Date(t)), every = list.length > 6 ? 3 : 1;
        const above = list.filter(m => m.delta !== null && m.delta >= 0).length, judged = list.filter(m => m.delta !== null).length;
        const cells = list.map(m => {
            const cls = !m.n ? 'none' : m.delta === null ? 'flat' : m.delta >= 0 ? 'up' : 'down';
            const tip = `${name(m.at)} · ${_plural(m.n, 'partie')}${m.perf !== null ? ` · niveau ${m.perf}` : m.n ? ` · ${pct(m.score)}` : ''}`;
            return `<i class="${cls}" title="${escapeHtml(I18n.mark(tip))}"></i>`;
        }).join('');
        const ticks = list.map((m, i) => `<small>${(list.length - 1 - i) % every === 0 ? I18n.mark(name(m.at)) : ''}</small>`).join('');
        return `<div class="so-months-h"><span>Mois par mois</span>${judged ? `<small>${above} sur ${judged} au-dessus de votre niveau</small>` : ''}</div>
            <div class="so-months" style="--n:${list.length}" role="img" aria-label="Mois par mois">${cells}${ticks}</div>`;
    }

    // En partie › Jusqu'où va votre préparation (ex « Où le répertoire s'arrête », absorbe « Votre préparation ») :
    // une règle de coups, un point par partie sortie du répertoire (plein : mon oubli ; cerclé d'ambre : coup imprévu).
    const RULER_DOTS = 5;
    function prepHTML(g) {
        const r = OpeningReport.detail(g.recent, g.path.length), hist = r.hist, keys = Object.keys(hist).map(Number);
        const fact = (l, v) => `<div class="so-fact"><span>${l}</span><b>${v}</b></div>`;
        let ruler = '<p class="st-sub so-none">Aucune sortie du répertoire dans vos parties de la période.</p>';
        if (keys.length) {
            const lo = Math.max(1, Math.min(...keys) - 1), hi = Math.min(lo + 15, Math.max(lo + 7, Math.max(...keys) + 1)), cols = [];
            for (let m = lo; m <= hi; m++) {
                const d = hist[m] || { me: 0, gap: 0 }, total = d.me + d.gap, dots = [];
                for (let i = 0; i < Math.min(d.me, RULER_DOTS); i++) dots.push('<i class="me"></i>');
                for (let i = 0; i < Math.min(d.gap, RULER_DOTS - dots.length); i++) dots.push('<i class="gap"></i>');
                const more = total > dots.length ? `<b>+${total - dots.length}</b>` : '';
                const tip = total ? `Coup ${m} · ${_plural(d.me, 'oubli')} · ${_plural(d.gap, 'coup imprévu', 'coups imprévus')}` : `Coup ${m}`;
                cols.push(`<div title="${escapeHtml(tip)}">${dots.join('')}${more}</div>`);
            }
            const labels = [];
            for (let m = lo; m <= hi; m++) labels.push(m === r.exitMove ? `<b>${m}</b>` : `<span>${(m - lo) % (hi - lo > 11 ? 2 : 1) === 0 ? m : ''}</span>`);
            ruler = `<div class="so-ruler" style="--n:${hi - lo + 1}" role="img" aria-label="Sorties du répertoire par numéro de coup">${cols.join('')}</div>
                <div class="so-ruler-l" style="--n:${hi - lo + 1}" aria-hidden="true">${labels.join('')}</div>
                <div class="so-leg"><span><i class="so-dot-me"></i>Vous avez oublié</span><span><i class="so-dot-gap"></i>Coup imprévu</span><span>Sortie moyenne : coup ${r.exitMove}</span></div>`;
        }
        return `<div class="so-card so-prep"><h5>Jusqu’où va votre préparation</h5>${ruler}
            <div class="so-facts">
                ${fact('Répertoire suivi', pct(r.followed))}
                ${fact('Score en le suivant', r.kept.n ? pct(r.kept.score) : '–')}
                ${fact('Score en le quittant', r.left.n ? pct(r.left.score) : '–')}
                ${fact('Réponses couvertes', pct(r.coverage))}
                ${r.exitEval === null ? '' : fact('Évaluation à la sortie', evalText(r.exitEval))}
                ${r.exitGood.n >= 3 ? fact('Score après une bonne sortie', pct(r.exitGood.score)) : ''}
                ${r.exitBad.n >= 3 ? fact('Score après une mauvaise sortie', pct(r.exitBad.score)) : ''}
                ${r.exitClock === null ? '' : fact('Avance à l\'horloge', `${r.exitClock >= 0 ? '+' : '−'}${Math.abs(Math.round(r.exitClock))} %`)}
            </div></div>`;
    }

    function gamesHTML(g) {
        if (!g.stats.n) {
            const none = !StatsGames.analysed().length;
            return `<p class="st-sub so-empty">${none ? (StatsGames.pending() ? 'Comparaison avec vos parties…' : "Reliez un compte dans l'onglet Parties pour voir vos résultats réels.") : 'Aucune partie sur cette période.'}</p>`;
        }
        return `${levelHTML(g)}${prepHTML(g)}`;
    }

    // Derniers coups avant ma réponse : sans eux, « 4… e6 » ne dit pas de quelle position il s'agit.
    function afterHTML(path) {
        if (!path || path.length < 2) return 'Premier coup de la partie';
        try {
            const sans = _pathToSans(path.slice(0, -1)), from = Math.max(0, sans.length - AFTER_PLIES);
            const line = sans.slice(from).map((s, k) => {
                const i = from + k, n = Math.floor(i / 2) + 1, w = i % 2 === 0;
                return `${w ? `${n}. ` : k ? '' : `${n}… `}${formatSan(s, w ? 'w' : 'b')}`;
            }).join(' ');
            return `Après <span class="so-line">${from ? '… ' : ''}${line}</span>`;
        } catch (e) { return ''; }
    }

    // Mes coups, du plus fragile au plus sûr (ex « Vos coups à connaître », allégée) : miniature, coup, niveau, un bouton.
    // Parties, maîtrise et prochaine révision sont dans l'aperçu (toucher la miniature).
    function positionsHTML(g) {
        if (!g.all.length) return '';
        const items = g.items.slice().sort(_byWorst), shown = st.all.has(g.key) ? items : items.slice(0, ROWS);
        const rows = shown.map(r => {
            const label = escapeHtml(_moveLabel(r.e));
            return `<div class="st-row so-my lv-${r.lv}">
                <button type="button" class="so-my-b" data-action="statsPreview" data-arg="${_statsArg(r)}" data-origin="${escapeHtml(g.name)}" aria-label="Voir ${label}">${_miniBoardHTML(r.path ? { side: r.side, path: r.path } : r, false)}</button>
                <span class="st-move">${_moveLabel(r.e, false, true)}<small class="so-after">${afterHTML(r.e.path)}</small></span>
                <span class="st-lvl">${_lvMark(r.lv)}${STATS_LEVELS[r.lv].one}</span>
                <button type="button" class="st-ibtn pri" data-action="statsTrain" data-arg="${_statsArg(r)}" title="S'entraîner sur cette position (compte comme un essai)" aria-label="S'entraîner sur ${label}">${ico('play')}</button>
            </div>`;
        }).join('');
        const more = items.length > ROWS ? `<button type="button" class="st-more" data-action="statsOpMore" data-arg="${escapeHtml(g.key)}" aria-expanded="${items.length === shown.length}">${items.length === shown.length ? 'Réduire' : `Afficher les ${items.length - shown.length} autres coups`}</button>` : '';
        return `<div class="so-card so-pos"><h5>Mes coups, du plus fragile au plus sûr</h5><p class="st-sub">${_plural(items.length, 'coup')}</p>
            ${levelBarHTML(g.counts)}
            <div class="st-rows">${rows}${more}</div></div>`;
    }

    // Filtre de niveau (lot 1) : la barre de niveaux elle-même, « À confirmer » à part (hors des barres), une ligne de rappel.
    function filterHTML() {
        const { counts } = st.ctx, on = statsFilter, u = counts[STATS_STATE];
        const total = STATS_MASTERY_LEVELS.reduce((n, l) => n + counts[l], 0);
        return `<div class="so-fbar">
            <div class="so-fbar-row">${levelBarHTML(counts, 'so-fbar-bar', { buttons: true, active: on, action: 'statsFilter' })}
                ${u ? `<button type="button" class="so-unsure${on === STATS_STATE ? ' on' : ''}" data-action="statsFilter" data-arg="${STATS_STATE}" aria-pressed="${on === STATS_STATE}">${_lvMark(STATS_STATE)}${STATS_LEVELS[STATS_STATE].label} <b>${u}</b></button>` : ''}</div>
            <div class="so-fbar-leg">${on === 'all' ? `<span>Tous les niveaux</span><span>${_plural(total, 'position')}</span>`
                : `<span>${_lvMark(on)}${STATS_LEVELS[on].label} · ${counts[on]}</span><button type="button" class="hp-link" data-action="statsFilter" data-arg="all">Tout afficher</button>`}</div>
        </div>`;
    }

    function indexHTML() {
        const seg = ['list', 'Liste', 'map', 'Carte'], btn = i => `<button type="button" class="tr-seg-btn${st.view === seg[i] ? ' active' : ''}" data-action="statsOpView" data-arg="${seg[i]}" aria-pressed="${st.view === seg[i]}">${seg[i + 1]}</button>`;
        const body = !st.list.length ? '<div class="empty-tab">Aucune position à ce niveau.</div>'
            : st.view === 'map' ? `<div class="so-ix-map">${mapHTML(st.list)}</div>` : mirrorHTML();
        return `<div class="so-index">
            <div class="so-ix-head"><h3>${_plural(st.list.length, 'ouverture')}</h3><div class="tr-seg" role="group" aria-label="Affichage">${btn(0)}${btn(2)}</div></div>
            ${filterHTML()}${body}</div>`;
    }

    function ficheHTML(g) {
        if (!g.all.length) return `${headHTML(g)}${gamesHTML(g)}`;
        return `${headHTML(g)}${tabsHTML(g)}
            ${paneHTML('line', `${slipsHTML(g)}${explorerHTML(g)}`)}
            ${paneHTML('games', gamesHTML(g))}
            ${paneHTML('moves', positionsHTML(g))}`;
    }

    function inner() {
        const g = current();
        if (!g) return `<div class="so-layout">${indexHTML()}</div>`;
        const meta = `${g.side === 'w' ? 'Blancs' : 'Noirs'} · ${metaOf(g)}`;
        return `<div class="so-layout${st.open ? ' is-open' : ''}">${indexHTML()}<div class="so-wrap">
            <div class="so-bar">
                <button type="button" class="so-back" data-action="opBack">${ico('chevron-left')}<span>Ouvertures</span></button>
                <button type="button" class="so-trigger" id="so-trigger" data-action="statsOpOpen" aria-haspopup="dialog" aria-expanded="false">${sideDot(g.side)}<span class="so-txt"><b>${g.html}</b><small>${meta}</small></span>${ico('chevron-down')}</button>
                <button type="button" class="so-step" data-action="statsOpStep" data-arg="-1" title="Précédente à travailler" aria-label="Précédente à travailler">${ico('chevron-left')}</button>
                <button type="button" class="so-step" data-action="statsOpStep" data-arg="1" title="Suivante à travailler" aria-label="Suivante à travailler">${ico('chevron-right')}</button>
            </div>
            <div class="so-fiche">${ficheHTML(g)}</div>
        </div></div>`;
    }

    // ─── INDEX « VITRINE » ───────────────────────────────────────────────────
    // Toutes les ouvertures dans l'ordre du classement (points perdus, puis fragilité). Une même carte : en tuile
    // (miniature, sceau du rang, nom, une phrase d'état) quand l'index est seul ; en ligne de 60 px quand la fiche est à côté.
    function mirrorHTML() {
        const row = g => {
            const [cls, text] = stateOf(g), gap = g.stats.gap;
            const label = `${g.name}${g.rank !== null ? ` · ${OpeningMarks.RANKS[g.rank]}` : ''} · ${text}${gap === null ? '' : ` · ${eloSigned(gap)}`}`;
            const board = g.path.length ? _miniBoardHTML({ side: g.side, path: g.path }, true, { label: g.name }) : `<span class="so-mr-none">${sideDot(g.side)}</span>`;
            return `<button type="button" class="so-mr${g.key === st.cur ? ' on' : ''}" data-action="statsOpPick" data-arg="${escapeHtml(g.key)}" aria-pressed="${g.key === st.cur}" aria-label="${escapeHtml(label)}">
                <span class="so-mr-b">${board}${g.rank !== null ? _opRankHTML(g.rank, 'so-seal') : ''}</span>
                <span class="so-mr-n"><b class="so-mr-t">${statsColor === 'all' ? sideDot(g.side) : ''}<span>${g.html}</span></b>
                    <span class="so-mr-s"><span class="so-mr-st is-${cls}">${text}</span>${eloTag(g.stats)}</span>
                    ${g.all.length ? levelBarHTML(g.counts, 'so-mr-bar') : ''}</span></button>`;
        };
        return `<div class="so-mirror">${st.list.map(row).join('')}</div>`;
    }

    // Progrès (constat « À faire ») : le classement sans la fiche.
    function prime(ctx) {
        st.ctx = ctx;
        const scope = currentRepertoire + '|' + statsColor;
        if (scope !== st.scope) { st.scope = scope; st.cur = null; st.picked = false; st.all = new Set(); st.cursor = new Map(); }
    }

    function sectionHTML(ctx) {
        st.ctx = ctx;
        const scope = currentRepertoire + '|' + statsColor;
        if (scope !== st.scope) { st.scope = scope; st.cur = null; st.picked = false; st.open = false; st.all = new Set(); st.cursor = new Map(); }
        build();
        return `<section class="st-sec st-card st-card-flush edge-card" id="stats-lines" data-pane="openings">${inner()}</section>`;
    }

    function paint() {
        const s = slot();
        if (!s || !st.ctx) return;
        build();
        s.innerHTML = inner();
        if (pickerEl()) renderPicker();
    }

    // ─── SÉLECTEUR ───────────────────────────────────────────────────────────
    const pickerEl = () => document.getElementById('so-picker');
    const optHTML = g => `<button type="button" class="so-opt" role="option" tabindex="-1" aria-selected="${g.key === st.cur}" data-action="statsOpPick" data-arg="${escapeHtml(g.key)}">${sideDot(g.side)}<span class="so-txt"><b>${g.html}</b><small>${metaOf(g)}</small></span>${wdlBar(g.stats)}${eloTag(g.stats)}</button>`;
    const searchable = g => { let moves = ''; try { moves = `${_movesLabel(g.path)} ${_pathToSans(g.path).join(' ')}`; } catch (e) { /* chemin illisible */ } return norm(`${g.name} ${I18n.t(g.name)} ${moves}`); };

    function mapHTML(list) {
        const pts = list.filter(g => g.stats.n >= MIN_MAP && g.stats.delta !== null && g.mastery !== null);
        if (!pts.length) return `<p class="so-none">Il faut au moins ${MIN_MAP} parties dans une ouverture travaillée pour la placer sur la carte.</p>`;
        const lim = Math.min(40, Math.max(15, Math.ceil(Math.max(...pts.map(g => Math.abs(g.stats.delta))) / 5) * 5));
        const W = 340, H = 300, L = 30, R = 8, T = 12, B = 30, x = v => L + v * (W - L - R) / 100, y = v => T + (lim - Math.max(-lim, Math.min(lim, v))) * (H - T - B) / (2 * lim);
        let g = [-lim, 0, lim].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`).join('');
        g += [0, OpeningReport.KNOWN, 100].map(v => `<line class="${v === OpeningReport.KNOWN ? 'b' : 'g'}" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}"/><text x="${x(v)}" y="${H - B + 13}" text-anchor="middle">${v}</text>`).join('');
        g += `<text class="q" x="${x(1)}" y="${T + 10}">À consolider</text><text class="q" x="${x(99)}" y="${T + 10}" text-anchor="end">À garder</text><text class="q" x="${x(1)}" y="${H - B - 5}">À apprendre</text><text class="q" x="${x(99)}" y="${H - B - 5}" text-anchor="end">Sue mais perdante</text>
            <text x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">Maîtrise à l'entraînement</text><text transform="translate(9 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Points face à l'attendu</text>`;
        pts.slice().sort((a, b) => b.stats.n - a.stats.n).forEach(o => {
            const r = 4 + Math.min(10, Math.sqrt(o.stats.n) * .8), cx = x(o.mastery), cy = y(o.stats.delta);
            const label = `${o.name} · ${o.mastery} / 100 · ${o.stats.delta >= 0 ? '+' : '−'}${num1(o.stats.delta)} %`;
            g += `<g class="so-point${o.key === st.cur ? ' sel' : ''}" tabindex="0" role="button" data-action="statsOpPick" data-arg="${escapeHtml(o.key)}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title><circle cx="${cx}" cy="${cy}" r="${Math.max(r, 12)}" fill="transparent"/><circle class="m ${o.stats.delta >= 0 ? 'up' : 'down'}" cx="${cx}" cy="${cy}" r="${r}"/></g>`;
        });
        return `<svg class="so-chart so-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carte des ouvertures, maîtrise et résultats">${g}</svg>`;
    }

    function listHTML(list) {
        const q = norm(st.q.trim());
        if (q) {
            const hits = list.filter(g => searchable(g).includes(q));
            return hits.length ? hits.map(optHTML).join('') : `<p class="so-none">Aucune ouverture ne correspond. Essayez un nom ou un coup.</p>`;
        }
        const head = t => `<div class="so-group">${t}</div>`, rep = list.filter(g => g.all.length), out = list.filter(g => !g.all.length), fam = new Map();
        rep.forEach(g => { const k = `${g.side === 'w' ? 'Blancs' : 'Noirs'} · ${g.name.split(' · ')[0]}`; if (!fam.has(k)) fam.set(k, []); fam.get(k).push(g); });
        return `${list.length > PRIORITY + 2 ? head("À travailler d'abord") + list.slice(0, PRIORITY).map(optHTML).join('') : ''}
            ${[...fam.keys()].sort((a, b) => a.localeCompare(b, I18n.locale())).map(k => head(k) + fam.get(k).map(optHTML).join('')).join('')}
            ${out.length ? head('Hors répertoire') + out.map(optHTML).join('') : ''}`;
    }

    function renderPicker() {
        const box = pickerEl();
        if (!box) return;
        box.querySelectorAll('[data-action="statsOpMode"]').forEach(b => { const on = b.dataset.arg === st.mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
        box.querySelector('.so-p-search').hidden = st.mode === 'map';
        box.querySelector('.so-p-body').innerHTML = st.mode === 'map' ? mapHTML(st.list) : listHTML(st.list);
        st.active = -1;
    }

    function place() {
        const box = pickerEl(), t = document.getElementById('so-trigger');
        if (!box || !t) return;
        const r = t.getBoundingClientRect();
        box.style.setProperty('--so-top', `${Math.round(r.bottom + 6)}px`);
        box.style.setProperty('--so-left', `${Math.round(r.left)}px`);
    }

    function open() {
        if (pickerEl()) { close(); return; }
        const back = document.createElement('div'), box = document.createElement('div');
        back.id = 'so-backdrop';
        back.addEventListener('click', () => close());
        box.id = 'so-picker';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Choisir une ouverture');
        box.innerHTML = `<span class="so-grab" aria-hidden="true"></span><div class="so-p-head">
            <input class="so-p-search online-input" type="search" placeholder="Nom ou coups : Najdorf, Cf3…" aria-label="Chercher une ouverture" autocomplete="off" spellcheck="false">
            <div class="tr-seg" role="group" aria-label="Affichage"><button type="button" class="tr-seg-btn" data-action="statsOpMode" data-arg="list">Liste</button><button type="button" class="tr-seg-btn" data-action="statsOpMode" data-arg="map">Carte</button></div>
        </div><div class="so-p-body" role="listbox" aria-label="Ouvertures"></div>`;
        document.body.append(back, box);
        st.q = '';
        const input = box.querySelector('.so-p-search');
        input.addEventListener('input', () => { st.q = input.value; renderPicker(); });
        box.addEventListener('keydown', onKey);
        box.addEventListener('focusout', e => { if (e.relatedTarget && !box.contains(e.relatedTarget)) close(); });
        renderPicker();
        place();
        window.addEventListener('scroll', place, true);
        const t = document.getElementById('so-trigger');
        if (t) t.setAttribute('aria-expanded', 'true');
        if (st.mode === 'list' && !matchMedia('(pointer: coarse)').matches) input.focus();
    }

    function close(focus = true) {
        const box = pickerEl();
        if (!box) return;
        box.remove();
        document.getElementById('so-backdrop').remove();
        window.removeEventListener('scroll', place, true);
        const t = document.getElementById('so-trigger');
        if (t) { t.setAttribute('aria-expanded', 'false'); if (focus) t.focus(); }
    }

    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        const point = e.target.closest('.so-point');
        if (point && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(point.dataset.arg); return; }
        if (!e.target.matches('.so-p-search') && !e.target.matches('.so-opt')) return;
        const box = pickerEl(), opts = [...box.querySelectorAll('.so-opt')];
        if (!opts.length) return;
        if (e.key === 'Enter') { e.preventDefault(); pick((opts[st.active] || opts[0]).dataset.arg); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        st.active = (st.active + (e.key === 'ArrowDown' ? 1 : (st.active < 0 ? 0 : -1)) + opts.length) % opts.length;
        opts.forEach((o, i) => o.classList.toggle('active', i === st.active));
        opts[st.active].scrollIntoView({ block: 'nearest' });
    }

    function pick(key) {
        const fromList = !pickerEl();
        st.cur = key; st.picked = true; st.open = true; paint(); close();
        // Depuis l'index, sur une seule colonne : la fiche prend sa place, on remonte en haut.
        if (fromList && single()) window.scrollTo({ top: 0 });
    }
    const single = () => { const lay = slot() && slot().querySelector('.so-layout'); return !!lay && getComputedStyle(lay).gridTemplateColumns.split(' ').length < 2; };

    // Ouverture qui coûte le plus de points sur la période (constat « À faire ») : écart à l'attendu d'au moins 3 points.
    function topLoss() {
        if (!st.ctx) return null;
        build();
        const g = st.list.filter(x => x.stats.n >= MIN_MAP && x.stats.delta !== null && x.stats.delta <= -3).sort((a, b) => lostOf(b) - lostOf(a))[0];
        return g ? { key: g.key, html: g.html, delta: g.stats.delta } : null;
    }
    function step(dir) {
        const i = st.list.findIndex(g => g.key === st.cur);
        if (i < 0) return;
        st.cur = st.list[(i + dir + st.list.length) % st.list.length].key;
        st.picked = true;
        paint();
    }

    registerActions({
        statsOpOpen: open,
        statsOpPick: pick,
        statsOpMode: m => { st.mode = m; renderPicker(); },
        statsOpView: v => { st.view = v; paint(); },
        opIdea: k => {
            const g = st.list.find(x => x.key === k);
            if (!g) return;
            const v = OpeningMarks.idea(currentRepertoire, g.side, g.name);
            askText({ title: `L’idée de la ligne · ${g.name}`, value: v && v.own && !v.from ? v.text : '', placeholder: v ? v.text : 'ex : pousser c5 et attaquer d4',
                      ok: 'Enregistrer', allowEmpty: true, max: OpeningMarks.IDEA_MAX }, t => { OpeningMarks.setIdea(currentRepertoire, k, t); paint(); });
        },
        opIdeaKeep: k => {
            const g = st.list.find(x => x.key === k), v = g && OpeningMarks.idea(currentRepertoire, g.side, g.name);
            if (v) { OpeningMarks.setIdea(currentRepertoire, k, I18n.t(v.text)); paint(); }
        },
        opTab: setTab,
        opReviewMove: arg => { const { side, key } = _parseStatsArg(arg); startReviewQueue([{ color: side, key }], 'openings'); },
        opBack: () => { st.open = false; paint(); window.scrollTo({ top: 0 }); },
        statsOpStep: d => step(Number(d)),
        opReview: arg => {
            const i = arg.indexOf(':'), kind = arg.slice(0, i), g = st.list.find(x => x.key === arg.slice(i + 1));
            if (g) startOpeningReview({ color: g.side, opening: { key: g.key, name: g.name }, path: g.path, kind });
        },
        opFree: k => { const g = st.list.find(x => x.key === k); if (!g) return; playerColor = g.side; openAnalysis(g.path.slice(), g.path.length - 1, statsBackToOpenings); },
        opExplore: p => { if (!st.cur) return; st.cursor.set(st.cur, p ? p.split(' ') : []); paintExplorer(); },
        opAdd: p => { const g = current(); if (!g) return; const path = p.split(' '); playerColor = g.side; openAnalysis(path, path.length - 1, statsBackToOpenings); },
        statsOpMore: k => {
            const closing = st.all.delete(k);
            if (!closing) st.all.add(k);
            paint();
            const card = closing && slot().querySelector('.so-pos');          // replié : la carte reste à l'écran
            if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
        }
    });
    Bus.on('games:analysed', paint);
    Bus.on('games:evaluated', paint);
    // Points de la carte de l'index : Entrée ou Espace comme un clic (ceux du sélecteur passent par onKey).
    // Onglets de la fiche : flèches gauche et droite d'un onglet à l'autre.
    document.addEventListener('keydown', e => {
        const point = e.target.closest && e.target.closest('#stats-lines .so-point');
        if (point && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(point.dataset.arg); return; }
        const tab = e.target.closest && e.target.closest('#stats-lines .so-tabs [role="tab"]');
        if (!tab || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const i = TABS.findIndex(([t]) => t === tab.dataset.arg), next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
        setTab(next);
        const b = document.getElementById('so-t-' + next);
        if (b) b.focus();
    });

    return { sectionHTML, prime, reset: () => { st.cur = null; st.picked = false; st.open = false; }, close, topLoss, count: () => st.list.length,
             show: key => { st.cur = key; st.picked = true; st.open = true; } };
})();
