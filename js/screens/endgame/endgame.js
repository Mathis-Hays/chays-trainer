/**
 * screens/endgame/endgame.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Finales : exercices de finales théoriques avec réponse automatique de l'adversaire.
 *
 *   1. EG                noyau pur (règles, recherche, base KPK exacte)   → egCore.js
 *   2. ENDGAME_EXERCISES catalogue : FEN + objectif + théorie              → egExercises.js
 *      EndgameJudge / EndgameOpponent : juge commun et adversaire calculé  → egJudge.js, egOpponent.js
 *   3. progression       stockage « chessTrainer_endgames »               (ce fichier)
 *   4. initEndgame()     écran d'accueil (appelé par switchHomeTab('endgame'))
 *   5. startEndgame(id)  séance : jugement du coup, réponse de l'adversaire, indices, retenter
 *
 * S'appuie sur l'écran de jeu existant (gameMode = 'endgame').
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  3. PROGRESSION (localStorage)
// ═══════════════════════════════════════════════════════════════════════════
const ENDGAME_PROGRESS_KEY = 'chessTrainer_endgames';

function readEndgameProgress() {
    const o = dataStore.getJSON(ENDGAME_PROGRESS_KEY, null);
    return o && typeof o === 'object' ? o : {};
}
function _egSaveProgress(p) { dataStore.setJSON(ENDGAME_PROGRESS_KEY, p); }

function _egBump(id, fn) {
    const p = readEndgameProgress();
    const cur = p[id] || { tries: 0, wins: 0, perfect: false, best: 0, last: 0 };
    fn(cur);
    cur.last = Date.now();
    p[id] = cur;
    _egSaveProgress(p);
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. ÉCRAN D'ACCUEIL « FINALES » (bibliothèque)
// ═══════════════════════════════════════════════════════════════════════════
// Objectif (audit « Finales en images ») : le mot et sa notation de résultat, celle des feuilles de partie.
const EG_GOALS = { mate: 'Mater', win: 'Gagner', draw: 'Tenir la nulle' };
const _egGoalSign = ex => ex.goal === 'mate' ? '#' : ex.goal === 'draw' ? '½' : ex.player === 'b' ? '0-1' : '1-0';

// Catalogue dans l'ordre des catégories, puis du fichier : ordre de « À suivre » et des sections.
const _egCatalogue = () => ENDGAME_CATEGORIES.flatMap(c => ENDGAME_EXERCISES.filter(e => e.cat === c.id));

const _egWon = (prog, e) => !!(prog[e.id] && prog[e.id].wins > 0);
const _egNext = prog => _egCatalogue().find(e => !_egWon(prog, e)) || null;

// État d'un exercice d'après la progression : 'perfect' | 'done' | 'tried' | 'todo'.
function _egState(prog, e) {
    const p = prog[e.id];
    return p && p.wins > 0 ? (p.perfect ? 'perfect' : 'done') : p && p.tries ? 'tried' : 'todo';
}
const _egTries = n => `${n} essai${n > 1 ? 's' : ''}`;

// Roi du jeu de pièces actif (comme ColorScope) ; data-glyph le fait redessiner au changement de jeu.
function _egKing(side) {
    const p = side === 'b' ? 'k' : 'K';
    return `<span class="glyph eg-king" data-glyph="${p}" aria-hidden="true">${(typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || ''}</span>`;
}
// Difficulté en crans noyer, toujours sous le titre (une place, un sens : les étoiles sont à droite).
const _egLevelHTML = n => `<span class="eg-crans" role="img" aria-label="Difficulté ${n} sur 5" title="Difficulté ${n} sur 5">${[1, 2, 3, 4, 5].map(i => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;
// Objectif : jeton de notation (#, 1-0, 0-1, ½) puis le mot, lu seul par les lecteurs d'écran.
const _egGoalHTML = ex => `<span class="eg-goal"><span class="eg-goal-tok is-${ex.goal}" aria-hidden="true">${_egGoalSign(ex)}</span>${EG_GOALS[ex.goal]}</span>`;
const _egSideHTML = ex => `<span class="eg-side">${_egKing(ex.player)}${EG_SIDE[ex.player]}</span>`;

// Limite de l'exercice, verbe d'abord : « En 20 coups », « Tenir 12 coups », « Conclure en 12 coups ».
const _egBudgetText = ex => ex.maxMoves ? `En ${ex.maxMoves} coups` : ex.hold ? `Tenir ${ex.hold} coups` : ex.keep ? `Conclure en ${ex.keep} coups` : '';
const _egBudgetN = ex => ex.maxMoves || ex.hold || ex.keep || 0;

// État à droite d'une ligne : toujours les étoiles (vides tant que l'exercice n'est pas réussi), les essais dessous.
function _egStateHTML(prog, ex) {
    const st = _egState(prog, ex), p = prog[ex.id];
    const n = st === 'perfect' || st === 'done' ? Math.max(1, (p && p.stars) || 0) : 0;
    return _egStarsHTML(n, n ? '' : 'is-none') + (st === 'tried' ? `<span class="eg-tries">${_egTries(p.tries)}</span>` : '');
}

// Étoiles d'une finale (EG.stars) : trois cases, les gagnées en laiton ; « is-none » : pas encore réussie.
function _egStarsHTML(n, cls = '') {
    const label = n ? `${n} étoile${n > 1 ? 's' : ''} sur 3` : 'Pas encore réussie';
    return `<span class="eg-stars${cls ? ' ' + cls : ''}" role="img" aria-label="${label}" title="${label}">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}
const _egStarSum = (prog, list) => list.reduce((t, e) => t + ((prog[e.id] && prog[e.id].stars) || 0), 0);

// Règle de cases d'une catégorie (même forme que l'objectif du jour de l'accueil) : une case par exercice, cerclée
// une fois tentée, teintée par ses étoiles une fois réussie ; un trait sous l'exercice à suivre.
function _egRulerHTML(prog, list, cur) {
    const won = list.filter(e => _egWon(prog, e)).length, sn = _egStarSum(prog, list);
    const label = `${won} réussie${won > 1 ? 's' : ''} sur ${list.length}, ${sn} étoile${sn > 1 ? 's' : ''} sur ${3 * list.length}`;
    return `<span class="eg-ruler" role="img" aria-label="${label}">${list.map(e => {
        const st = _egState(prog, e), s = (prog[e.id] && prog[e.id].stars) || 1;
        return `<i class="${st === 'perfect' || st === 'done' ? 's' + s : st === 'tried' ? 't' : ''}${e.id === cur ? ' cur' : ''}"></i>`;
    }).join('')}</span>`;
}

// Origine du jugement, annoncée avant la séance d'après le catalogue (le juge la confirme au premier verdict).
const _egMen = fen => fen.split(' ')[0].replace(/[\d/]/g, '');
function _egExpectedSource(ex) {
    if (ex.kind) return 'local';
    const men = _egMen(ex.fen);
    if (['Kkp', 'KPk'].includes(men.split('').sort().join(''))) return 'kpk';
    return men.length <= EndgameJudge.MAX_PIECES ? 'syzygy' : 'engine';
}

// Pastille d'origine du jugement. Syzygy hors ligne : la réponse vient forcément du cache (« Réponse gardée »).
function _egSourceBadge(source, exact) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (source === 'syzygy') return offline ? `<span class="vbadge is-muted eg-src">${ico('database')}Réponse gardée · exact</span>`
                                            : `<span class="vbadge is-muted eg-src">${ico('cloud')}Tables Syzygy · exact</span>`;
    if (source === 'engine' || exact === false) return `<span class="vbadge is-muted is-dashed eg-src">${ico('cpu')}Moteur · verdict estimé</span>`;
    return `<span class="vbadge is-muted eg-src">${ico('check')}Calcul exact</span>`;
}

// Miniature ; crop : vue rapprochée sur les pièces (lignes, cartes, « Suivant »), l'échiquier entier dans l'aperçu.
function _egMini(ex, cls, crop) {
    return typeof _miniBoardHTML === 'function' ? _miniBoardHTML({ side: ex.player, k: ex.fen }, false, { cls, label: ex.title, crop: !!crop }) : '';
}

// Jauge du budget de coups : un cran par coup, la même qu'en séance.
const _egBudgetMeterHTML = ex => { const n = _egBudgetN(ex); return n ? `<span class="eg-budget"><span class="eg-ticks" style="--n:${n}" aria-hidden="true">${'<i></i>'.repeat(n)}</span><span class="eg-budget-l">${escapeHtml(_egBudgetText(ex))}</span></span>` : ''; };

// Filtre (légende qui filtre, en tête) : 'all' | 'todo' (jamais tenté) | 'tried' (commencé) | 'done' (réussi).
let egFilter = 'all';
const EG_FILTERS = [['all', 'Toutes', ''], ['todo', 'À faire', ''], ['tried', 'Commencées', 't'], ['done', 'Réussies', 's3']];
// Exercice choisi pour l'aperçu de la colonne de droite (bureau) ; null : « À suivre ».
let egSel = null;
// Téléphone (Ergonomie, lot 5) : catégories ouvertes ; null : seule celle de l'exercice à suivre ou choisi.
let egOpen = null;

const _egKind = (prog, e) => _egWon(prog, e) ? 'done' : _egState(prog, e) === 'tried' ? 'tried' : 'todo';
const _egShown = (prog, e) => egFilter === 'all' || _egKind(prog, e) === egFilter;

function _egVisible(prog) {
    return ENDGAME_EXERCISES.filter(e => _egShown(prog, e));
}

// Exercice au hasard parmi ceux qui sont affichés, en privilégiant ceux qui ne sont pas encore réussis sans faute.
function startRandomEndgame() {
    const prog = readEndgameProgress(), list = _egVisible(prog);
    if (!list.length) return;
    const fresh = list.filter(e => !(prog[e.id] && prog[e.id].perfect));
    const pool = fresh.length ? fresh : list;
    startEndgame(pool[Math.floor(Math.random() * pool.length)].id);
}

// Carte d'aperçu (Velours sombre) : « À suivre » par défaut, l'exercice choisi sinon. Son « Commencer » est la
// seule action pleine de l'écran. mode 'sheet' : même contenu dans le panneau du bas (téléphone).
function _egPreviewHTML(ex, prog, mode) {
    const cat = ENDGAME_CATEGORIES.find(c => c.id === ex.cat), p = prog[ex.id], st = _egState(prog, ex);
    const isNext = (_egNext(prog) || {}).id === ex.id;
    const tag = mode === 'sheet' ? 'Aperçu' : isNext ? 'À suivre' : 'Choisi';
    const won = st === 'perfect' || st === 'done';
    const progress = won ? _egStarsHTML(Math.max(1, p.stars || 0)) : st === 'tried' ? `<span class="eg-pv-prog">${_egTries(p.tries)}, pas encore réussie</span>` : '';
    const plan = (ex.plan || ex.tips || []).length, src = _egExpectedSource(ex);
    // L'origine du jugement ne s'annonce que quand le verdict sera estimé (moteur) ; les tables et les calculs exacts se taisent.
    const facts = (plan ? `<li>${ico('lightbulb')}${plan} étape${plan > 1 ? 's' : ''} de plan en indice</li>` : '') + (src === 'engine' ? `<li>${_egSourceBadge(src, false)}</li>` : '');
    return `<section class="vel-card vel-dark eg-pv${mode === 'sheet' ? ' is-sheet' : ' edge-card'}" aria-label="${escapeHtml(`${tag} : ${ex.title}`)}">
        <span class="st-eyebrow">${escapeHtml(tag)} · ${escapeHtml(cat ? cat.label : '')}</span>
        <div class="eg-pv-row">
            ${_egMini(ex, 'eg-pos')}
            <div class="eg-pv-txt">
                <h3 class="eg-pv-title">${escapeHtml(ex.title)}</h3>
                <div class="eg-pv-meta">${_egGoalHTML(ex)}${_egSideHTML(ex)}${_egLevelHTML(ex.level)}${progress}</div>
                ${_egBudgetMeterHTML(ex)}
            </div>
        </div>
        ${facts ? `<ul class="eg-pv-facts">${facts}</ul>` : ''}
        <button type="button" class="btn btn-primary eg-go" data-action="startEndgame" data-arg="${escapeHtml(ex.id)}">Commencer ${ico('play')}</button>
    </section>`;
}

function _egDoneHTML(prog) {
    const all = ENDGAME_EXERCISES, three = all.filter(e => (prog[e.id] && prog[e.id].stars) === 3).length;
    return `<section class="vel-card vel-dark eg-pv edge-card" aria-label="Parcours terminé">
        <span class="st-eyebrow">Parcours terminé</span>
        <h3 class="eg-pv-title">Tout est réussi</h3>
        <span class="eg-pv-meta">${three} sur ${all.length} à trois étoiles. Rejouez au hasard pour garder la main.</span>
        <button type="button" class="btn btn-primary eg-go" data-action="egRandom">${ico('shuffle')} Au hasard</button>
    </section>`;
}

// Bibliothèque :
//   - colonne de l'aperçu (en tête sur téléphone, à droite sur bureau) : « À suivre » ou l'exercice choisi ;
//   - puces de catégorie à anneau (réussis / total) qui font défiler jusqu'à la section ;
//   - une section par catégorie : lignes bord à bord sur téléphone, grille de cartes à partir de 720 px.
// Une ligne ou une carte ouvre l'aperçu (panneau du bas sous 920 px) : elle ne lance rien.
function initEndgame() {
    const panel = document.getElementById('endgame-panel');
    if (!panel) return;
    const prog = readEndgameProgress();
    const all = ENDGAME_EXERCISES, N = all.length;
    const done = all.filter(e => _egWon(prog, e)).length;
    const counts = { all: N, done, tried: all.filter(e => _egKind(prog, e) === 'tried').length };
    counts.todo = N - done - counts.tried;

    // Légende qui filtre (audit « Finales en images ») : la case de la règle sert de pastille, le compte en .count.
    const seg = document.getElementById('endgame-seg');
    if (seg) seg.innerHTML = EG_FILTERS.map(([f, label, cls]) =>
        `<button type="button" class="so-leg-b${egFilter === f ? ' on' : ''}" data-action="egFilter" data-arg="${f}" aria-pressed="${egFilter === f}" aria-label="${label} : ${counts[f]}">${f === 'all' ? '' : `<span class="eg-ruler" aria-hidden="true"><i class="${cls}"></i></span>`}${label}<b>${counts[f]}</b></button>`).join('');

    if (egSel && !ENDGAME_BY_ID[egSel]) egSel = null;
    const next = _egNext(prog), shown = egSel ? ENDGAME_BY_ID[egSel] : next;
    const tracks = ENDGAME_CATEGORIES.map(cat => ({ cat, list: _egCatalogue().filter(e => e.cat === cat.id) })).filter(t => t.list.length);
    const visible = tracks.map(t => ({ cat: t.cat, list: t.list.filter(e => _egShown(prog, e)) })).filter(t => t.list.length);
    const currentCat = shown ? shown.cat : '';

    const chips = `<nav class="eg-chips" aria-label="Catégories">${visible.map(({ cat }) => {
        const list = tracks.find(t => t.cat === cat).list, w = list.filter(e => _egWon(prog, e)).length;
        return `<button type="button" class="eg-chip" data-action="egJump" data-arg="${escapeHtml(cat.id)}" aria-current="${cat.id === currentCat}" aria-label="${escapeHtml(`${cat.label} : ${w} sur ${list.length}`)}">${escapeHtml(cat.label)}<span class="count is-muted">${w} / ${list.length}</span></button>`;
    }).join('')}</nav>`;

    const sections = visible.map(({ cat, list }) => {
        const full = tracks.find(t => t.cat === cat).list, w = full.filter(e => _egWon(prog, e)).length;
        const open = egOpen ? egOpen.has(cat.id) : cat.id === currentCat || (!currentCat && cat === visible[0].cat);
        return `<section class="eg-sec${open ? ' is-open' : ''}" id="eg-sec-${escapeHtml(cat.id)}" aria-labelledby="eg-sec-h-${escapeHtml(cat.id)}">
            <div class="eg-sec-h"><h3 id="eg-sec-h-${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</h3>
                <span class="eg-sec-prog">${_egRulerHTML(prog, full, next && next.id)}<span class="count is-muted">${w} / ${full.length}</span></span>
                <button type="button" class="eg-sec-tg" data-action="egToggle" data-arg="${escapeHtml(cat.id)}" aria-expanded="${open}" aria-controls="eg-sec-l-${escapeHtml(cat.id)}" aria-label="${escapeHtml(cat.label)}">${ico('chevron-down')}</button></div>
            <p class="eg-sec-desc">${escapeHtml(cat.desc)}</p>
            <div class="eg-list" id="eg-sec-l-${escapeHtml(cat.id)}">${list.map(ex => `<button type="button" class="eg-card${shown && ex.id === shown.id && egSel ? ' is-sel' : ''}" data-action="egPreview" data-arg="${escapeHtml(ex.id)}" aria-haspopup="dialog">
                ${_egMini(ex, 'eg-pos', true)}
                <span class="eg-card-txt"><b>${escapeHtml(ex.title)}</b>
                    <span class="eg-card-mt">${_egGoalHTML(ex)}${_egKing(ex.player)}<span class="sr-only">${EG_SIDE[ex.player]}</span>${_egLevelHTML(ex.level)}</span></span>
                <span class="eg-card-end">${_egStateHTML(prog, ex)}</span>
            </button>`).join('')}</div>
        </section>`;
    }).join('');

    const EMPTY = { done: ['Aucune finale réussie', `${N} à faire`], tried: ['Aucune finale commencée', 'Les finales tentées sans succès s’affichent ici.'], todo: ['Toutes ont été tentées', `${done} sur ${N} réussies`] };
    const empty = visible.length ? '' : `<div class="eg-empty"><b>${EMPTY[egFilter][0]}</b><span>${EMPTY[egFilter][1]}</span></div>`;
    const preview = shown ? _egPreviewHTML(shown, prog, 'aside') : _egDoneHTML(prog);
    const sum = `<section class="eg-sum" aria-label="Parcours"><span class="st-eyebrow">Parcours</span>
        <div class="eg-sum-big"><b>${done}</b><span>sur ${N} réussie${done > 1 ? 's' : ''} · ${_egStarSum(prog, all)} étoiles</span></div>
        <div class="eg-sum-rows">${tracks.map(({ cat, list }) => `<span class="eg-sum-row"><span>${escapeHtml(cat.label)}</span>${_egRulerHTML(prog, list, next && next.id)}</span>`).join('')}</div></section>`;

    panel.innerHTML = `<div class="egl">
        <aside class="egl-aside"><div id="eg-preview">${preview}</div>${sum}</aside>
        <div class="egl-main">${chips}${sections}${empty}</div>
    </div>`;

    // Précalcule la base KPK pendant que l'utilisateur choisit (≈ 0,25 s).
    const warm = () => { try { EG.buildKpk(); } catch (e) { reportError('finales : préparation de la base roi + pion', e); } };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1500 }); else setTimeout(warm, 400);
}

// ─── Aperçu : colonne de droite (bureau) ou panneau du bas ───────────────────
const _egWide = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(min-width: 920px)').matches;

function previewEndgame(id) {
    if (!ENDGAME_BY_ID[id]) return;
    if (!_egWide()) { _egOpenSheet(id); return; }
    egSel = id;
    const host = document.getElementById('eg-preview');
    if (!host) return;
    host.innerHTML = _egPreviewHTML(ENDGAME_BY_ID[id], readEndgameProgress(), 'aside');
    document.querySelectorAll('#endgame-panel .eg-card').forEach(c => c.classList.toggle('is-sel', c.dataset.arg === id));
    document.querySelectorAll('#endgame-panel .eg-chips .eg-chip').forEach(c => c.setAttribute('aria-current', String(c.dataset.arg === ENDGAME_BY_ID[id].cat)));
}

let _egSheetReturn = null;
function _egOpenSheet(id) {
    _egCloseSheet(false);
    _egSheetReturn = document.activeElement;
    const ex = ENDGAME_BY_ID[id];
    const wrap = document.createElement('div');
    wrap.id = 'eg-sheet';
    wrap.className = 'eg-sheet-wrap';
    wrap.innerHTML = `<div class="eg-sheet-bg" data-action="egCloseSheet"></div>
        <div class="eg-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml('Aperçu : ' + ex.title)}">
            <span class="eg-sheet-grab" aria-hidden="true"></span>
            <button type="button" class="eg-sheet-x" data-action="egCloseSheet" aria-label="Fermer l'aperçu">${ico('x')}</button>
            ${_egPreviewHTML(ex, readEndgameProgress(), 'sheet')}
        </div>`;
    wrap.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); _egCloseSheet(true); return; }
        if (e.key !== 'Tab') return;
        const f = [...wrap.querySelectorAll('button')], i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(wrap);
    const go = wrap.querySelector('.eg-go');
    if (go) go.focus();
}

function _egCloseSheet(restore) {
    const el = document.getElementById('eg-sheet');
    if (el) el.remove();
    if (restore && _egSheetReturn && _egSheetReturn.isConnected) _egSheetReturn.focus();
    _egSheetReturn = null;
}

// Puce de catégorie : défile jusqu'à la section.
// Téléphone : ouvrir ou replier une catégorie, sans redessiner la page.
function toggleEndgameCategory(id) {
    const sec = document.getElementById('eg-sec-' + id);
    if (!sec) return;
    if (!egOpen) egOpen = new Set([...document.querySelectorAll('#endgame-panel .eg-sec.is-open')].map(s => s.id.slice(7)));
    const open = !egOpen.has(id);
    if (open) egOpen.add(id); else egOpen.delete(id);
    sec.classList.toggle('is-open', open);
    const tg = sec.querySelector('.eg-sec-tg');
    if (tg) tg.setAttribute('aria-expanded', String(open));
}

function jumpEndgameCategory(id) {
    const sec = document.getElementById('eg-sec-' + id);
    if (!sec) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    document.querySelectorAll('#endgame-panel .eg-chips .eg-chip').forEach(c => c.setAttribute('aria-current', String(c.dataset.arg === id)));
}


// ─── Outils des finales de tours ──────────────────────────────────────────────
function _egParseUci(u) {
    const sq = n => 'abcdefgh'.indexOf(n[0]) + 8 * (Number(n[1]) - 1);
    return EG.mk(sq(u.slice(0, 2)), sq(u.slice(2, 4)), u[4] ? { q: 5, r: 4, b: 3, n: 2 }[u[4]] : 0);
}

// Défense de Philidor (Noirs) : règles canoniques + garde-fou par recherche (les Blancs ne doivent pas
// pouvoir forcer la promotion en 9 demi-coups). Renvoie null si le coup est correct, sinon le message.
function _egPhilBasic(ns) {                                 // règles + Tour non abandonnée (aucune recherche)
    let pawn = -1, rook = -1;
    for (let i = 0; i < 64; i++) { if (ns.b[i] === 1) pawn = i; if (ns.b[i] === -4) rook = i; }
    if (pawn < 0 || rook < 0) return null;
    if (EG.attacked(ns.b, rook, 1) && !EG.attacked(ns.b, rook, -1)) return 'Votre Tour est en prise : elle serait perdue.';
    const bk = EG.kingSq(ns.b, -1), pr = pawn >> 3;
    if (pr <= 4) {
        if ((rook >> 3) !== 5) return 'Philidor : tant que le pion n\'est pas en 6e, la Tour reste sur la 6e rangée.';
        if ((bk >> 3) < 6) return 'Philidor : gardez le roi noir sur sa dernière rangée (ou la 7e), devant le pion.';
    } else if (pr === 5 && (rook >> 3) !== 0) {
        return 'Le pion est en 6e : la Tour doit passer derrière, sur la 1re rangée, pour donner des échecs par derrière.';
    }
    return null;
}

// Défense de Philidor (Noirs) : règles canoniques, anticipation de la poussée e5-e6, et garde-fou par
// recherche (les Blancs ne doivent pas forcer la promotion en 9 demi-coups). null = coup correct.
// Pion (ou Dame issue de la promotion) éliminé, Blancs au trait : gagnent-ils la Tour noire en la prenant
// sans que la pièce preneuse soit reprise ? (Tour contre Tour, ou Tour reprise par le roi : nulle.)
function _egWinsRook(ns) {
    return EG.legalMoves(ns).some(r => {
        if (ns.b[EG.mTo(r)] !== -4) return false;
        const n2 = EG.make(ns, r);
        return !EG.legalMoves(n2).some(x => EG.mTo(x) === EG.mTo(r));
    });
}

function _egPhilidorCheck(st, m) {
    const ns = EG.make(st, m);
    const pawn = ns.b.indexOf(1);
    if (pawn < 0) {
        // Le pion a été pris, ou vient d'être promu : la nouvelle Dame doit disparaître sur-le-champ,
        // et l'échange qui suit ne doit pas coûter la Tour (ex. …Txe8 Txe8 Rxe8 : nulle).
        if (ns.b.indexOf(5) >= 0) return { msg: 'La nouvelle Dame doit être prise immédiatement, sinon la partie est perdue.' };
        return _egWinsRook(ns) ? { msg: 'Les Blancs prendraient votre Tour sans qu\'elle puisse être reprise.' } : { capture: true };
    }
    const basic = _egPhilBasic(ns);
    if (basic) return { msg: basic };
    if ((pawn >> 3) <= 4 && !EG.inCheck(st) && ns.b.indexOf(-6) !== 60)
        return { msg: 'Philidor : sans échec à parer, le roi reste sur e8 devant le pion ; jouez avec la Tour sur la 6e rangée.' };
    if ((pawn >> 3) === 4) {                                  // les Blancs peuvent-ils pousser, et aurez-vous alors une défense ?
        const push = EG.legalMoves(ns).find(x => EG.mFrom(x) === pawn && EG.mTo(x) === pawn + 8);
        if (push) {
            const n2 = EG.make(ns, push);
            const ok = EG.legalMoves(n2).some(r => {
                const n3 = EG.make(n2, r);
                if (n3.b.indexOf(1) < 0) return n3.b.indexOf(5) < 0 && !_egWinsRook(n3);      // pion éliminé sans perdre la Tour
                return !_egPhilBasic(n3) && !EG.forcesPromotion(n3, 5);
            });
            if (!ok) return { msg: 'Après e6, vous n\'auriez plus de défense : placez la Tour et le roi autrement.' };
        }
    }
    if (EG.forcesPromotion(ns, 7)) return { msg: 'Ce coup perd : les Blancs peuvent forcer la promotion du pion.' };
    return null;
}

// Défense de Vancura (Noirs, pion blanc de la colonne a en 6e, Tour blanche devant lui) : règles canoniques
// + garde-fou par recherche, comme Philidor. null = coup correct.
//   - le roi noir reste dans le coin (g7, h7, g8, h8) : ailleurs, Th8 ! puis Th7+ enfile le roi et la Tour ;
//   - tant que le pion est en 6e, la Tour noire l'attaque de côté depuis la 6e rangée, sauf pour donner échec
//     (quand le roi blanc vient soutenir son pion, les échecs viennent par derrière) ;
//   - le pion en 7e : la Tour passe derrière lui, sur la colonne a.
const _VANCURA_KING = [54, 55, 62, 63];

// Règles seules (aucune recherche) : message, { capture: true }, ou null.
function _egVancuraBasic(st, m) {
    const ns = EG.make(st, m);
    const pawn = ns.b.indexOf(1), rook = ns.b.indexOf(-4);
    if (pawn < 0) {
        if (ns.b.indexOf(5) >= 0) return { msg: 'La nouvelle Dame doit être prise immédiatement, sinon la partie est perdue.' };
        return _egWinsRook(ns) ? { msg: 'Les Blancs prendraient votre Tour sans qu\'elle puisse être reprise.' } : { capture: true };
    }
    if (rook < 0) return { msg: 'Sans Tour, le pion passe : la partie est perdue.' };
    if (ns.b.indexOf(4) < 0) return { capture: true, note: 'La Tour blanche est tombée : nulle au moins !' };
    if (EG.attacked(ns.b, rook, 1) && !EG.attacked(ns.b, rook, -1)) return { msg: 'Votre Tour est en prise : elle serait perdue.' };
    const bk = EG.kingSq(ns.b, -1), pr = pawn >> 3, check = EG.inCheck(ns);
    if (!_VANCURA_KING.includes(bk)) return { msg: 'Vancura : le roi reste dans le coin (g7 ou h7). Ailleurs, Th8 ! puis Th7+ enfile votre roi et votre Tour.' };
    if (EG.mFrom(m) !== EG.kingSq(st.b, -1) && !check) {
        if (pr === 5 && (rook >> 3) !== 5) return { msg: 'Vancura : la Tour attaque le pion de côté, depuis la 6e rangée (ou donne échec).' };
        if (pr === 6 && (rook & 7) !== 0) return { msg: 'Le pion est en 7e : placez la Tour derrière lui, sur la colonne a.' };
    }
    return null;
}

function _egVancuraCheck(st, m) {
    const basic = _egVancuraBasic(st, m);
    if (basic) return basic;
    // Une réponse blanche ne doit pas vous laisser sans aucun coup conforme (Tour coincée loin de la colonne a…).
    const ns = EG.make(st, m);
    const stuck = EG.legalMoves(ns).some(r => {
        const n3 = EG.make(ns, r);
        if (n3.b.indexOf(1) < 0) return false;
        return !EG.legalMoves(n3).some(x => { const b = _egVancuraBasic(n3, x); return !b || b.capture; });
    });
    if (stuck) return { msg: 'Après la réponse des Blancs, vous n\'auriez plus de défense : gardez la Tour loin du roi blanc, prête à revenir sur la colonne a.' };
    if (EG.forcesPromotion(ns, 7)) return { msg: 'Ce coup perd : les Blancs peuvent forcer la promotion du pion.' };
    return null;
}

// Défenses à règles (ex.rules) : les exercices sont jugés par les tables ; les règles servent à expliquer
// une erreur et à donner un conseil quand le coup tient la nulle sans suivre la méthode.
const _EG_RULES = {
    philidor: { check: (st, m) => _egPhilidorCheck(st, m), name: 'la défense de Philidor' },
    vancura:  { check: (st, m) => _egVancuraCheck(st, m),  name: 'la défense de Vancura' }
};

// ═══════════════════════════════════════════════════════════════════════════
//  5. SÉANCE D'EXERCICE
// ═══════════════════════════════════════════════════════════════════════════
const endgameState = {
    ex: null, busy: false, over: false, failed: null, timers: [],
    moves: 0, errors: 0, hints: 0, hintLevel: 0, budget: 0, seen: {}, tried: false,
    token: 0, source: null, exact: true, planStep: 0,
    verdict: null, theory: false, arrows: null                // verdict dégradé [avant, après] (−1, 0, 1) ; théorie dépliée ; flèches du coup refusé
};

// Exercice jugé par le juge commun (tables Syzygy, base KPK ou moteur) : pas de « kind » propre.
const _egJudged = ex => !ex.kind;
const _egFen = () => Chess.fen(Chess.snapshot());
const EG_OPPONENTS = [['max', 'Résistance maximale'], ['human', 'Humain']];

function _egLater(fn, ms) { endgameState.timers.push(setTimeout(fn, ms)); }

function stopEndgame() {
    endgameState.timers.forEach(clearTimeout);
    endgameState.timers = [];
    endgameState.busy = false;
    endgameState.ex   = null;
    endgameState.token++;                                     // un verdict ou une réponse en attente sont ignorés
}

const _egCur  = () => EG.fromGlobals(board, turn);
// Coup de la position affichée, écrit selon la préférence de notation (lettres françaises, anglaises ou figurines).
const _egSan = (from, to, promo) => formatSanText(toAlgebraic(from, to, promo), board[from] && board[from] === board[from].toLowerCase() ? 'b' : 'w');
const _egPromoCode = l => ({ Q: 5, R: 4, B: 3, N: 2 }[String(l).toUpperCase()] || 0);

function startEndgame(id) {
    const ex = ENDGAME_BY_ID[id];
    if (!ex) return;
    _egCloseSheet(false);
    stopEndgame();
    endgameState.ex = ex;
    playerColor = ex.player;
    gameMode    = 'endgame';
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    showGameScreen(ex.player);          // la barre du haut affiche ex.title (renderGameRep)
    _egLoadPosition();
}

function _egLoadPosition() {
    const s = endgameState, ex = s.ex;
    s.timers.forEach(clearTimeout); s.timers = [];
    parseFEN(ex.fen);
    moveHistory = []; lastFrom = -1; lastTo = -1;
    selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
    boardFlipped = appSettings.autoFlip && ex.player === 'b';
    resetNavCursor();
    clearErrorFx();
    s.busy = false; s.over = false; s.failed = null; s.verdict = null; s.theory = false; s.arrows = null;
    s.moves = 0; s.hintLevel = 0; s.seen = {}; s.planStep = 0; s.par = 0; s.stars = 0;
    s.token++;
    _egFindPar(s, ex);
    s.source = _egJudged(ex) ? null : 'local'; s.exact = true;   // mats, KPK, pions : juges locaux exacts
    if (_egJudged(ex)) {
        s.budget = ex.goal === 'win' ? ex.keep || ex.maxMoves : ex.hold;
        const token = s.token;
        EndgameJudge.probe(_egFen()).then(v => {                // verdict de départ : source affichée, cache rempli
            if (token !== s.token || !v) return;
            s.source = v.source; s.exact = v.exact;
            renderEndgameCard();
        }, () => {});
    } else if (ex.kind === 'kpk') {
        const pr = EG.kpkProbe(_egCur());
        s.budget = ex.goal === 'win' ? Math.ceil(pr.dtw / 2) + 3 : ex.hold;
    } else if (ex.kind === 'pawns')    s.budget = ex.goal === 'win' ? ex.maxMoves : ex.hold;
    else s.budget = ex.maxMoves;
    renderMoves();
    renderBoard();
    renderEndgameCard();
    setStatus(`${egObjective(ex)}.`, 'info');
    if (ex.kind === 'pawns') {                                   // précalcul pendant que le joueur réfléchit
        const st = _egCur(), warm = () => { try { EG.pawnValue(st, ex.horizon); } catch (e) { reportError('finales : préparation du calcul', e); } };
        if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 800 }); else setTimeout(warm, 200);
    }
}

function retryEndgame() {
    if (!endgameState.ex) return;
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    _egLoadPosition();
}

function nextEndgame() {
    const ex = endgameState.ex;
    if (!ex) return;
    const i = ENDGAME_EXERCISES.indexOf(ex);
    startEndgame(ENDGAME_EXERCISES[(i + 1) % ENDGAME_EXERCISES.length].id);
}

function setEndgameOpponent(policy) {
    if (!EG_OPPONENTS.some(([id]) => id === policy)) return;
    appSettings.egOpponent = policy;
    saveSettings();
    renderEndgameCard();
}

registerActions({ egFilter: f => { egFilter = f; initEndgame(); }, egRandom: () => startRandomEndgame(), egOpponent: p => setEndgameOpponent(p),
    egToggle: id => toggleEndgameCategory(id),
    egPreview: id => previewEndgame(id), egCloseSheet: () => _egCloseSheet(true), egJump: id => jumpEndgameCategory(id),
    egTheory: () => { endgameState.theory = !endgameState.theory; renderEndgameCard(); },
    startEndgame: id => startEndgame(id), nextEndgame: () => nextEndgame(), retryEndgame: () => retryEndgame(), undoEndgameMove: () => undoEndgameMove() });

// ─── CARTE D'OBJECTIF (panneau de jeu) ────────────────────────────────────────
const EG_OUTCOMES = { 1: 'gain', 0: 'nulle', '-1': 'perte' };
// Résultat (du point de vue du joueur) écrit comme sur une feuille de partie : 1-0, ½, 0-1.
const _egScore = (v, player) => v === 0 ? '½' : (v > 0) === (player === 'w') ? '1-0' : '0-1';

// Jauge (audit « Finales en images ») : dans la marge de l'échiquier, à la place de la barre de séance de
// l'Entraînement (#tr-progress) ; un cran par coup à tenir (hold, keep ou maxMoves ; budget calculé pour KPK),
// le coup fautif en vermillon, les coups d'une finale réussie en laiton. Erreurs et indices écrits seulement s'il y en a.
function _egMeterHTML(s, ex) {
    const n = Math.max(1, s.budget || 1), bad = s.failed && s.moves ? Math.min(s.moves, n) - 1 : -1;
    const ticks = Array.from({ length: n }, (_, i) =>
        `<i${i === bad ? ' class="bad"' : i < s.moves ? ` class="${s.over ? 'ok' : 'on'}"` : ''}></i>`).join('');
    const unit = ex.goal === 'draw' ? 'à tenir' : _egJudged(ex) && ex.keep ? 'pour conclure' : 'au plus';
    const extra = [s.errors ? `<span class="is-err"><b>${s.errors}</b> erreur${s.errors > 1 ? 's' : ''}</span>` : '', s.hints ? `<span><b>${s.hints}</b> indice${s.hints > 1 ? 's' : ''}</span>` : ''].join('');
    return `<div class="eg-ticks" style="--n:${n}" role="progressbar" aria-label="Coups joués" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${Math.min(s.moves, n)}">${ticks}</div>
        <div class="tr-prog-l eg-meter-lg"><span>Coup <b class="tr-prog-n">${s.moves}</b> / ${n} ${unit}</span>${extra ? `<span>${extra}</span>` : ''}</div>`;
}
function _egRenderBar() {
    const el = document.getElementById('tr-progress'), s = endgameState;
    if (!el || gameMode !== 'endgame' || !s.ex) return;
    el.hidden = false;
    el.classList.add('is-eg');
    el.innerHTML = _egMeterHTML(s, s.ex);
}

// Verdict « avant → après » en notation de résultat (½ → 1-0), puis la phrase.
function _egVerdictHTML(v, player) {
    if (!v) return '';
    const [from, to] = v.map(x => EG_OUTCOMES[x]);
    const say = `La ${from} devient une ${to}`;
    return `<div class="eg-verdict" role="img" aria-label="${escapeHtml(`Verdict : ${from} devenue ${to}`)}">
        <span class="eg-vpill is-from">${_egScore(v[0], player)}</span>${ico('chevron-right')}<span class="eg-vpill is-to">${_egScore(v[1], player)}</span><span class="eg-vsay">${say}</span></div>`;
}

// Théorie : repliée pendant la séance (bouton « Théorie »), ouverte d'office à la fin.
function _egTheoryHTML(s, ex) {
    if (!ex.theory) return '';
    const open = s.over || s.theory;
    return `<div class="eg-theory-box">
        ${s.over ? `<span class="eg-theory-h">${ico('book')}Théorie</span>`
                 : `<button type="button" class="eg-theory-btn" data-action="egTheory" aria-expanded="${open}" aria-controls="eg-theory">${ico('book')}Théorie${ico('chevron-down')}</button>`}
        <p class="eg-theory" id="eg-theory"${open ? '' : ' hidden'}>${escapeHtml(ex.theory)}</p>
    </div>`;
}

// Fin : vos coups contre le chemin le plus court (par), une réglette chacun ; les coups de trop en laiton clair.
function _egParHTML(s) {
    const aids = [s.errors ? `${s.errors} erreur${s.errors > 1 ? 's' : ''}` : '', s.hints ? `${s.hints} indice${s.hints > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
    if (!s.par) return aids ? `<p class="eg-star-goal">${escapeHtml(aids)}.</p>` : '';
    const max = Math.max(s.moves, s.par);
    const bar = (n, ghost) => `<span class="eg-par-bar" style="--n:${max}" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? (!ghost && i >= s.par ? 'over' : 'on') : ''}"></i>`).join('')}</span>`;
    return `<div class="eg-par" role="img" aria-label="${escapeHtml(`Vous : ${s.moves} coups ; le plus court : ${s.par}`)}">
        <span class="eg-par-row"><span>Vous</span>${bar(s.moves)}<b class="san">${s.moves}</b></span>
        <span class="eg-par-row"><span>Le plus court</span>${bar(s.par, true)}<b class="san">${s.par}</b></span>
        ${aids ? `<span class="eg-par-aids">${escapeHtml(aids)}</span>` : ''}</div>`;
}

function renderEndgameCard() {
    const el = document.getElementById('endgame-card');
    const s = endgameState, ex = s.ex;
    if (!el || !ex) return;
    _egRenderBar();
    const cat = ENDGAME_CATEGORIES.find(c => c.id === ex.cat);
    // Origine du jugement : seulement quand le verdict est estimé (moteur) ; les tables et les calculs exacts se taisent.
    const src = s.source && (s.source === 'engine' || s.exact === false) ? _egSourceBadge(s.source, s.exact) : '';
    const goal = `<div class="eg-goalrow">${_egGoalHTML(ex)}${_egSideHTML(ex)}${_egLevelHTML(ex.level)}<span class="eg-cat">${escapeHtml(cat ? cat.label : '')}</span></div>`;
    let body;
    if (s.over) {
        const i = ENDGAME_EXERCISES.indexOf(ex), nx = ENDGAME_EXERCISES[(i + 1) % ENDGAME_EXERCISES.length];
        const st = s.stars || 1, gain = st > (s.prevStars || 0) && s.prevStars ? ' · nouveau record' : '';
        const goal3 = st >= 3 ? 'Trois étoiles.' : s.par ? `Troisième étoile : sans faute ni indice, en ${s.par + EG.starsSlack(s.par)} coups au plus.`
            : 'Troisième étoile : sans faute ni indice.';
        body = `<div class="eg-win">${_egStarsHTML(st, 'is-big')}<div><b>Exercice réussi${gain}</b><span>${escapeHtml(ex.title)}</span></div></div>
            ${_egParHTML(s)}<p class="eg-star-goal">${escapeHtml(goal3)}</p>${typeof _medalsWonHTML === 'function' ? _medalsWonHTML(s.medals) : ''}
            ${_egTheoryHTML(s, ex)}
            <div class="eg-nextup">${_egMini(nx, 'eg-pos', true)}<div><small>Suivant</small><b>${escapeHtml(nx.title)}</b></div></div>
            <div class="eg-actions"><button class="btn btn-primary" data-action="nextEndgame">${ico('skip-forward')} Suivant</button><button class="btn" data-action="retryEndgame">${ico('rotate-ccw')} Rejouer</button></div>`;
    } else {
        let failed = '';
        if (s.failed) {
            const undo = s.failed.undoable;
            // Le message est dans la barre d'état ; la carte montre le verdict, la clé des flèches et les actions.
            const key = s.arrows ? `<div class="eg-arrow-key"><span class="is-played">Votre coup</span>${s.arrows.length > 1 ? '<span class="is-best">La méthode</span>' : ''}</div>` : '';
            failed = `${_egVerdictHTML(s.verdict, ex.player)}${key}
                <div class="eg-actions">${undo ? `<button class="btn btn-primary" data-action="undoEndgameMove">${ico('rotate-ccw')} Reprendre ce coup</button>` : ''}<button class="btn${undo ? '' : ' btn-primary'}" data-action="retryEndgame">${ico('rotate-ccw')} Recommencer</button></div>`;
        }
        body = `${goal}${src ? `<div class="eg-srcrow">${src}</div>` : ''}${failed}${_egTheoryHTML(s, ex)}`;
    }
    el.className = 'endgame-card' + (s.over ? ' is-ok' : s.failed ? ' is-err' : '');
    el.innerHTML = body;
    Bus.emit('ui:refresh');                                   // le dock reprend l'action de la carte
}

// ─── FLÈCHES DU COUP REFUSÉ ───────────────────────────────────────────────────
// Votre coup en vermillon (annotation « red ») ; le coup de la méthode en laiton (« gold »), lu dans les tables
// sur la position d'avant (même juge que l'indice) ; sans réponse (hors ligne) : la flèche vermillon seule.
function _egShowArrows(from, to, fenBefore) {
    const s = endgameState, token = s.token;
    s.arrows = [{ from, to, color: 'red' }];
    if (typeof EndgameJudge !== 'undefined') EndgameJudge.probe(fenBefore).then(p => {
        const best = p && p.moves && p.moves[0];
        if (token !== s.token || !s.failed || !s.arrows || !best) return;
        const m = _egParseUci(best.uci);
        if (EG.mFrom(m) === from && EG.mTo(m) === to) return;
        s.arrows = [s.arrows[0], { from: EG.mFrom(m), to: EG.mTo(m), color: 'gold' }];
        renderEndgameCard();
        if (typeof renderAnnotations === 'function') renderAnnotations(false);
    }, () => {});
}

// ─── COUP DU JOUEUR (appelé par executePlayerMove) ────────────────────────────
function _egJudge(ex, st, m) {
    const s = endgameState, n = s.moves + 1;                 // numéro de ce coup
    if (ex.kind === 'mate') {
        const j = EG.judgeMate(st, m);
        if (j.mate)      return { state: 'success', msg: 'Échec et mat ! Bien joué.' };
        if (j.stalemate) return { state: 'fail', undoable: true, verdict: [1, 0], msg: 'Pat ! La partie est nulle : laissez toujours une case libre au roi adverse (hors échec).' };
        if (j.hanging)   return { state: 'fail', undoable: true, verdict: [1, 0], msg: 'Votre pièce est abandonnée : le roi adverse la prend et le gain disparaît.' };
        if (n > ex.maxMoves) return { state: 'fail', undoable: false, msg: `Trop lent : le mat doit tomber en ${ex.maxMoves} coups maximum.` };
        return { state: 'continue' };
    }
    if (ex.kind === 'pawns') return _egJudgePawns(ex, st, m, n);
    const info = EG.kpkAfter(st, m);
    if (ex.goal === 'win') {
        if (!info.win) {
            const why = { capture: 'Le pion est perdu : c\'est nulle.', stalemate: 'Pat ! C\'est nulle (en cas de pat, promouvez plutôt en Tour).',
                          underpromo: 'Promotion en pièce mineure : roi + cavalier ou fou ne peut pas mater, c\'est nulle.',
                          hanging: 'La pièce promue est prise ou le roi adverse est pat : le gain disparaît.' }[info.why]
                      || 'Ce coup laisse échapper le gain : la position est maintenant nulle.';
            return { state: 'fail', undoable: true, verdict: [1, 0], msg: why };
        }
        if (info.promoted || info.mate) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > s.budget) return { state: 'fail', undoable: false, msg: 'Le gain théorique est conservé, mais vous perdez trop de temps : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (info.win) return { state: 'fail', undoable: true, verdict: [0, -1], msg: 'Ce coup perd : le pion va se promouvoir. Il fallait garder la nulle.' };
    if (info.why === 'capture')   return { state: 'success', msg: 'Pion capturé : nulle !' };
    if (info.why === 'stalemate') return { state: 'success', msg: 'Pat : nulle !' };
    if (n >= s.budget) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${s.budget} coups sans céder.` };
    return { state: 'continue' };
}

// Horizon de calcul d'une finale de pions. Exercice de gain : le gain doit tomber dans l'horizon de
// départ, donc l'horizon restant diminue de deux demi-coups par coup joué (calcul plus court, et un
// gain trop lent est refusé). Exercice de nulle : horizon constant.
const _egHorizon = ex => ex.goal === 'win' ? Math.max(3, ex.horizon - 2 * endgameState.moves) : ex.horizon;

// Finales de pions (solveur borné, cf. EG.pawnValue). Gain : le coup doit garder un gain que l'horizon
// restant suffit à prouver. Nulle : seul un coup dont la perte est PROUVÉE est refusé.
function _egJudgePawns(ex, st, m, n) {
    const v = EG.pawnMoveValue(st, m, _egHorizon(ex)), promo = EG.mPromo(m);
    const after = EG.make(st, m), pc = EG.pawnCount(after.b);
    if (ex.goal === 'win') {
        if (v !== 1) return { state: 'fail', undoable: true, verdict: [1, v < 0 ? -1 : 0], msg: promo
            ? 'Cette promotion ne gagne pas : la Dame est prise, ou l\'adversaire promeut aussitôt.'
            : 'Ce coup ne gagne pas, ou trop lentement : cherchez la ligne la plus directe.' };
        if (promo) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > endgameState.budget) return { state: 'fail', undoable: false, msg: 'Le gain est toujours là, mais trop lent : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (v === -1) return { state: 'fail', undoable: true, verdict: [0, -1], msg: 'Ce coup perd : l\'adversaire peut maintenant forcer la promotion de son pion.' };
    if (promo) return { state: 'success', msg: 'Vous promouvez à votre tour : nulle (au moins) !' };
    if (pc.n === 0) return { state: 'success', msg: 'Plus aucun pion : nulle !' };
    if (pc.n === 1 && !pc.pieces && !EG.kpkProbe(after).win && pc.side !== st.stm) return { state: 'success', msg: 'Il ne reste qu\'un pion adverse, et la position est nulle : bien défendu !' };
    if (n >= endgameState.budget) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${endgameState.budget} coups sans céder.` };
    return { state: 'continue' };
}

// Réponse de l'ordinateur en finale de pions.
//   Le joueur doit gagner : défense la plus tenace (nulle si elle existe, sinon la perte la plus lointaine).
//   Le joueur doit annuler : gain s'il existe, sinon le coup qui laisse au joueur le plus de réponses perdantes.
function _egPawnsReply(ex, st) {
    const H = _egHorizon(ex), moves = _egPawnMoves(st);
    if (!moves.length) return null;
    const scored = moves.map(m => ({ m, v: EG.pawnMoveValue(st, m, H) }));
    if (ex.goal === 'win') {
        const hold = scored.filter(x => x.v >= 0);
        if (hold.length) return hold[0].m;
        // Perte la plus lointaine ; à deux demi-coups près, une prise (la défense « naturelle ») est préférée.
        const depth = scored.map(x => ({ m: x.m, d: EG.pawnMoveLossDepth(st, x.m, H), cap: st.b[EG.mTo(x.m)] !== 0 }));
        const maxD = Math.max(...depth.map(x => x.d));
        const near = depth.filter(x => x.d >= maxD - 2);
        return (near.find(x => x.cap) || near.find(x => x.d === maxD)).m;
    }
    const wins = scored.filter(x => x.v === 1);
    if (wins.length) {
        let best = wins[0].m, bestD = Infinity;
        for (const x of wins) { const d = EG.pawnMoveWinDepth(st, x.m, H); if (d < bestD) { bestD = d; best = x.m; } }
        return best;
    }
    let best = scored[0].m, bestScore = -Infinity;
    for (const x of scored) {
        if (x.v < 0) continue;
        const ns = EG.make(st, x.m);
        let traps = 0;
        for (const r of _egPawnMoves(ns)) if (EG.pawnMoveValue(ns, r, H - 1) === -1) traps++;
        const push = Math.abs(st.b[EG.mFrom(x.m)]) === EG.P ? 1 : 0;
        const score = 10 * traps + push;
        if (score > bestScore) { bestScore = score; best = x.m; }
    }
    return best;
}

function answerEndgameMove(from, to, promo) {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    if (_egJudged(ex)) { _egPlayJudged(from, to, promo); return; }
    const st  = _egCur(), fenBefore = _egFen();
    const m   = EG.mk(from, to, promo ? _egPromoCode(promo) : 0);
    const san = _egSan(from, to, promo);                 // avant application : board est encore la position d'origine
    const res = _egJudge(ex, st, m);

    if (!s.tried) { s.tried = true; _egBump(ex.id, p => { p.tries++; }); }
    s.moves++; s.hintLevel = 0;

    if (res.state === 'fail') {
        s.errors++; s.failed = res; s.verdict = res.verdict || null; s.busy = true;
        _egShowArrows(from, to, fenBefore);
        _commitMove(from, to, promo, null, `${san} · ${res.msg}`, 'err');
        playSound('error');
        renderEndgameCard();
        return;
    }
    if (res.state === 'success') {
        _commitMove(from, to, promo, null, `${san} · ${res.msg}`, 'ok');
        _egFinish(res.msg);
        return;
    }
    s.busy = true;
    _commitMove(from, to, promo, null, `${san}`, 'ok');
    renderEndgameCard();
    _egLater(_egAiReply, opponentDelay(550));
}

// ─── EXERCICES JUGÉS (tables Syzygy, base KPK ou moteur) ──────────────────────
// Camp adverse sans pion et sans matériel de mat (roi seul, ou roi + pièce mineure).
function _egCannotWin(st, side) {
    let minor = 0;
    for (let i = 0; i < 64; i++) {
        const v = st.b[i] * side;
        if (v <= 0 || v === EG.K) continue;
        if (v === EG.N || v === EG.B) minor++; else return false;
    }
    return minor <= 1;
}
const _egBare = (st, side) => { for (let i = 0; i < 64; i++) { const v = st.b[i] * side; if (v > 0 && v !== EG.K) return false; } return true; };

// Verdict d'un coup d'exercice jugé. v : { before, after } (juge commun) ou null si aucun verdict n'est disponible.
// st : position avant le coup (état EG), m : coup EG, n : numéro du coup. Pure : testée sans DOM.
function _egJudgedOutcome(ex, st, m, v, n) {
    const res = EndgameJudge.result, me = st.stm, ns = EG.make(st, m);
    const replies = EG.legalMoves(ns);
    const capture = st.b[EG.mTo(m)] !== 0, promo = !!EG.mPromo(m);
    if (v && res(v.after) < res(v.before)) {
        const rule = ex.rules ? _egRules(ex).check(st, m) : null;
        const msg = rule && rule.msg ? rule.msg
                  : ex.goal === 'win' ? (res(v.after) < 0 ? 'Ce coup perd : la position se retourne.' : 'Ce coup laisse échapper le gain : la position est maintenant nulle.')
                  : 'Ce coup perd : l\'adversaire peut maintenant forcer le gain.';
        return { state: 'fail', undoable: true, verdict: [res(v.before), res(v.after)], msg };
    }
    if (!replies.length) {
        if (EG.inCheck(ns)) return { state: 'success', msg: 'Échec et mat ! Bien joué.' };
        if (ex.goal === 'draw') return { state: 'success', msg: 'Pat : nulle !' };
        return { state: 'fail', undoable: true, verdict: [1, 0], msg: 'Pat ! La partie est nulle : laissez toujours une case libre au roi adverse.' };
    }
    const kept = !v || res(v.after) >= (ex.goal === 'win' ? 1 : 0);
    if (ex.goal === 'win') {
        if (kept && _egBare(ns, -me)) return { state: 'success', msg: 'Il ne reste que le roi adverse : le gain est acquis.' };
        if (kept && promo && ex.until !== 'capture') return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (kept && capture && ex.until !== 'promo') return { state: 'success', msg: 'Matériel gagné, gain conservé : la position est gagnée.' };
        if (ex.keep && n >= ex.keep) return { state: 'success', msg: `Gain conservé pendant ${ex.keep} coups : la méthode est acquise.` };
        if (ex.maxMoves && n >= ex.maxMoves) return { state: 'fail', undoable: false, msg: 'Le gain est toujours là, mais trop lent : cherchez la ligne la plus directe.' };
    } else {
        if (_egCannotWin(ns, -me)) return { state: 'success', msg: 'L\'adversaire n\'a plus de quoi gagner : nulle !' };
        if (kept && (capture || promo) && !ns.b.some(x => x === -me * EG.P)) return { state: 'success', msg: 'Le dernier pion adverse est tombé : nulle !' };
        if (n >= ex.hold) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${ex.hold} coups sans céder.` };
    }
    // Coup juste qui s'écarte de la méthode (Philidor, Vancura) : conseil.
    const rule = ex.rules ? _egRules(ex).check(st, m) : null;
    return { state: 'continue', note: rule && rule.msg ? rule.msg : '' };
}

async function _egPlayJudged(from, to, promo) {
    const s = endgameState, ex = s.ex, token = s.token;
    const fen = _egFen(), st = _egCur();
    const m   = EG.mk(from, to, promo ? _egPromoCode(promo) : 0);
    const uci = moveToStr(from, to, promo);
    const san = _egSan(from, to, promo);
    if (!s.tried) { s.tried = true; _egBump(ex.id, p => { p.tries++; }); }
    s.moves++; s.hintLevel = 0; s.busy = true;
    _commitMove(from, to, promo, null, `${san} · vérification…`, 'info');
    renderEndgameCard();
    const v = await EndgameJudge.judgeMove(fen, uci).catch(() => null);
    if (token !== s.token) return;                              // exercice quitté ou recommencé entre-temps
    if (v) { s.source = v.source; s.exact = v.exact; }
    const res = _egJudgedOutcome(ex, st, m, v, s.moves);
    const est = v && !v.exact ? ' (verdict estimé)' : '';
    if (res.state === 'fail') {
        s.errors++; s.failed = res; s.verdict = res.verdict || null;
        _egShowArrows(from, to, fen);
        setStatus(`${san} · ${res.msg}${est}`, 'err');
        playSound('error');
        renderEndgameCard();
        return;
    }
    if (res.state === 'success') { setStatus(`${san} · ${res.msg}`, 'ok'); _egFinish(res.msg); return; }
    setStatus(`${san}${v ? '' : ' · verdict indisponible (hors ligne, moteur absent)'}`, 'ok', res.note ? `Conseil : ${res.note}` : '');
    renderEndgameCard();
    // L'adversaire calcule pendant le délai de réponse.
    const pick = EndgameOpponent.pick(_egFen(), appSettings.egOpponent).catch(() => null);
    _egLater(async () => {
        const p = await pick;
        if (token !== s.token) return;
        if (!p) {
            s.failed = { msg: 'L\'adversaire ne peut pas répondre : connexion et moteur indisponibles. Réessayez plus tard.', undoable: false };
            setStatus('Adversaire indisponible.', 'err');
            renderEndgameCard();
            return;
        }
        _egReplyMove(_egParseUci(p.uci));
    }, opponentDelay(550));
}

// Indice d'un exercice jugé : pièce à jouer, puis une étape du plan, puis le coup exact.
async function _egJudgedHint() {
    const s = endgameState, ex = s.ex, token = s.token;
    s.busy = true;
    const p = await EndgameJudge.probe(_egFen()).catch(() => null);
    if (token !== s.token) return;
    s.busy = false;
    const best = p && p.moves && p.moves[0];
    const plan = ex.plan || ex.tips || [];
    let level = s.hintLevel;
    if (!best && level !== 1) level = plan.length ? 1 : -1;
    if (level === 1 && !plan.length) level = 2;
    if (level < 0) { setStatus('Aucun indice disponible hors ligne pour cette position.', 'info'); return; }
    s.hints++;
    const m = best && _egParseUci(best.uci), from = m != null ? EG.mFrom(m) : -1;
    if (level === 0) setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint', 'Appuyez encore pour une étape du plan.');
    else if (level === 1) { setStatus(`Plan : ${plan[s.planStep % plan.length]}`, 'hint'); s.planStep++; }
    else setStatus(`Solution : ${_egSan(from, EG.mTo(m), EG.promoLetter(m))}`, 'hint');
    s.hintLevel = Math.min(s.hintLevel + 1, 2);
    renderEndgameCard();
}

// ─── RÉPONSE AUTOMATIQUE DE L'ADVERSAIRE ──────────────────────────────────────
function _egAiReply() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.over || s.failed) return;
    const st = _egCur();
    const me = ex.player === 'w' ? 1 : -1;
    let m;
    if (ex.kind === 'mate')       m = EG.searchBest(st, ex.defDepth || 4, me);      // défense du roi seul
    else if (ex.kind === 'pawns') m = _egPawnsReply(ex, st);                         // solveur de finales de pions
    else if (ex.goal === 'win')   m = EG.kpkDefense(st);                            // défense parfaite (base exacte)
    else                          m = EG.kpkTrapAttack(st);                         // attaque qui tend des pièges
    if (m == null) { _egFinish('Partie terminée.'); return; }
    _egReplyMove(m);
}

// Coup de l'adversaire joué sur l'échiquier, puis fin de partie éventuelle (mat, pat, répétition).
function _egReplyMove(m) {
    const s = endgameState, ex = s.ex;
    const from = EG.mFrom(m), to = EG.mTo(m), pr = EG.promoLetter(m);
    const san  = _egSan(from, to, pr);
    _commitMove(from, to, pr, null, `Adversaire : ${san} · à vous.`, 'info');

    // Le joueur est-il maté / pat ? Répétition ?
    const st2 = _egCur(), replies = EG.legalMoves(st2);
    if (!replies.length) {
        if (EG.inCheck(st2)) { s.failed = { msg: 'Vous êtes mat.', undoable: false }; s.busy = true; s.errors++; renderEndgameCard(); setStatus('✗ Vous êtes mat.', 'err'); return; }
        if (ex.goal === 'draw') { _egFinish('Pat : nulle !'); return; }
        s.failed = { msg: 'Pat : la partie est nulle.', undoable: false }; s.busy = true; s.errors++; renderEndgameCard(); setStatus('✗ Pat.', 'err'); return;
    }
    const key = positionKey();
    s.seen[key] = (s.seen[key] || 0) + 1;
    if (ex.goal === 'draw' && s.seen[key] >= 3) { _egFinish('Nulle par répétition de position.'); return; }

    s.busy = false;
    renderEndgameCard();
}

// ─── ÉTOILES : LE CHEMIN LE PLUS COURT ────────────────────────────────────────
// par = coups du joueur sur le chemin le plus court : base KPK (dtw, en demi-coups), sinon distance au mat des tables
// (mats élémentaires, dtm en demi-coups, réseau). Exercices « tenir » ou à durée fixée : pas de par, les étoiles ne
// regardent que les fautes et les indices.
function _egFindPar(s, ex) {
    if (ex.goal === 'draw') return;
    if (ex.kind === 'kpk') { const pr = EG.kpkProbe(_egCur()); if (pr.win) s.par = Math.ceil(pr.dtw / 2); return; }
    if (ex.kind !== 'mate' || typeof EndgameJudge === 'undefined') return;
    const token = s.token;
    EndgameJudge.probe(_egFen()).then(v => {
        if (token !== s.token || !v || !Number.isFinite(v.dtm) || !v.dtm) return;
        s.par = Math.ceil(Math.abs(v.dtm) / 2);
        if (s.over) renderEndgameCard();
    }, () => {});
}

// ─── FIN D'EXERCICE ───────────────────────────────────────────────────────────
function _egFinish(msg) {
    const s = endgameState, ex = s.ex;
    playSound('success');
    s.over = msg; s.busy = true; s.theory = true;
    const perfect = s.errors === 0 && s.hints === 0;
    s.stars = EG.stars({ errors: s.errors, hints: s.hints, moves: s.moves, par: s.par });
    s.prevStars = (readEndgameProgress()[ex.id] || {}).stars || 0;
    _egBump(ex.id, p => {
        p.wins++;
        if (perfect) p.perfect = true;
        if (!p.best || s.moves < p.best) p.best = s.moves;
        if (s.stars > (p.stars || 0)) p.stars = s.stars;                    // la meilleure reste
    });
    s.medals = typeof Medals !== 'undefined' ? Medals.check() : [];      // Lucena, Philidor, étoiles, toutes les finales (lot 5)
    renderEndgameCard();
    setStatus(`✓ ${msg}`, 'ok');
}

// ─── ANNULER UN COUP FAUTIF ───────────────────────────────────────────────────
function undoEndgameMove() {
    const s = endgameState;
    if (!s.failed || !s.failed.undoable || !moveHistory.length) return;
    performUndo();                                           // boardLogic.js : restaure position, trait, surbrillance
    s.moves = Math.max(0, s.moves - 1);
    s.failed = null; s.verdict = null; s.arrows = null; s.busy = false; s.hintLevel = 0;
    renderEndgameCard();
    setStatus('Coup repris : cherchez un autre coup.', 'info');
}

// ─── INDICE (appelé par showHint) ─────────────────────────────────────────────
//   kpk, pions, exercices jugés : 1) type de pièce  2) étape du plan  3) coup exact
//   mate : conseils successifs de la fiche
function endgameHint() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    const st = _egCur();
    s.hints++;

    if (_egJudged(ex)) { _egJudgedHint(); return; }
    if (ex.kind === 'mate') {
        const tip = ex.tips[Math.min(s.hintLevel, ex.tips.length - 1)];
        s.hintLevel++;
        setStatus(`Indice : ${tip}`, 'hint');
        renderEndgameCard();
        return;
    }
    if (ex.kind === 'pawns') {
        const H = _egHorizon(ex), moves = _egPawnMoves(st);
        let good;
        if (ex.goal === 'win') {
            const wins = moves.filter(m => EG.pawnMoveValue(st, m, H) === 1);
            let bestD = Infinity;
            for (const m of wins) { const d = EG.pawnMoveWinDepth(st, m, H); if (d < bestD) { bestD = d; good = m; } }
        } else good = moves.find(m => EG.pawnMoveValue(st, m, H) >= 0);
        if (good == null) { s.hints--; return; }
        const from = EG.mFrom(good), tips = ex.tips || [];
        let level = s.hintLevel;
        if (level === 1 && !tips.length) level = 2;
        if (level === 0)      setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
        else if (level === 1) setStatus(`Indice : ${tips[Math.min(s.moves ? 1 : 0, tips.length - 1)]}`, 'hint');
        else                  setStatus(`Solution : ${_egSan(from, EG.mTo(good), EG.promoLetter(good))}`, 'hint');
        s.hintLevel = Math.min(s.hintLevel + 1, 2);
        renderEndgameCard();
        return;
    }
    let best;
    if (ex.goal === 'win') best = EG.kpkBestAttack(st);
    else {
        const ok = EG.kpkMoves(st).filter(x => !x.info.win);
        best = ok.find(x => x.info.why === 'capture') || ok[0];
    }
    if (!best) { s.hints--; return; }
    const from = EG.mFrom(best.m);
    const tips = ex.tips || [];
    let level = s.hintLevel;
    if (level === 1 && !tips.length) level = 2;
    if (level === 0) {
        setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
    } else if (level === 1) {
        setStatus(`Indice : ${tips[0]}`, 'hint');
    } else {
        setStatus(`Solution : ${_egSan(from, EG.mTo(best.m), EG.promoLetter(best.m))}`, 'hint');
    }
    s.hintLevel = Math.min(s.hintLevel + 1, 2);
    renderEndgameCard();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _egPhilidorCheck, _egVancuraCheck, _egJudgedOutcome };
}

GameModes.register('endgame', {
    inputBlocked: () => endgameState.busy,
    engineArrows: () => (endgameState.failed && endgameState.arrows) || [],
    // Téléphone : après une erreur ou une réussite, le centre du dock porte l'action pleine de la carte (C14).
    dockCenter: () => {
        const b = document.querySelector('#endgame-card .eg-actions .btn-primary');
        if (!b) return null;
        const a = b.dataset.action;
        return { target: b, icon: a === 'nextEndgame' ? 'skip-forward' : 'rotate-ccw', label: a === 'nextEndgame' ? 'Suivant' : a === 'undoEndgameMove' ? 'Reprendre' : 'Recommencer', tone: a === 'nextEndgame' ? '' : 'err', title: b.textContent.trim() };
    },
    movesLocked: true,
    onMove: (from, to, promo) => answerEndgameMove(from, to, promo),
    onHint: () => endgameHint()
});
