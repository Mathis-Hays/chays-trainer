/**
 * domain/repertoire/levels.js
 * ──────────────────────────────────────────────────────────────────────────
 * Niveaux de maîtrise d'une position, partagés par les Statistiques, l'Entraînement et l'arbre.
 */

'use strict';

const STATS_CONFIRM_TRIES = 3;

// Paliers (chantier « Erreurs et niveaux », 25 novembre 2026, système C) : le niveau suit le palier (stepOf, review.js).
// Une réussite monte d'un palier, une erreur en fait descendre un, deux erreurs d'affilée renvoient en découverte.
// Mêmes six cases et mêmes couleurs qu'avant : l'historique et les médailles ne changent pas de format.
//   weak : palier 0 après avoir déjà été retrouvée (ratée deux fois d'affilée : à réapprendre) ;
//   unsure : palier 0 sans jamais avoir été retrouvée de mémoire (« À découvrir », gris, à part des trois états) ;
//   fragile / progress : paliers 1 et 2 ; solid : 3 et 4 ; mastered : 5 et plus.
const STATS_SOLID_RUN    = 3;

const STATS_MASTERED_RUN = 5;

// Du plus fragile au plus sûr (ordre des barres, des filtres et des listes).
const STATS_LEVELS = {
    weak:     { label: 'À réapprendre',  one: 'À réapprendre',  rule: 'ratée deux fois d’affilée' },
    fragile:  { label: 'Palier 1',       one: 'Palier 1',       rule: 'retrouvée une fois, revue le lendemain' },
    progress: { label: 'Palier 2',       one: 'Palier 2',       rule: 'revue dans 3 jours' },
    solid:    { label: 'Solides',        one: 'Solide',         rule: `paliers ${STATS_SOLID_RUN} et ${STATS_MASTERED_RUN - 1} (7 et 16 jours)` },
    unsure:   { label: 'À découvrir',    one: 'À découvrir',    rule: 'jamais retrouvée de mémoire' },
    mastered: { label: 'Maîtrisées',     one: 'Maîtrisée',      rule: `palier ${STATS_MASTERED_RUN} et plus (35 jours et plus)` }
};

const STATS_LEVEL_ORDER = Object.keys(STATS_LEVELS);

function _level(e) {
    const step = stepOf(e);
    if (!step) return (e.attempts || 0) - (e.failures || 0) > 0 ? 'weak' : 'unsure';
    if (step === 1) return 'fragile';
    if (step === 2) return 'progress';
    return step < STATS_MASTERED_RUN ? 'solid' : 'mastered';
}

// ─── TROIS ÉTATS À L'ÉCRAN (bilan « Chays épuré », lot 3) ──────────────────────
// Les six cases restent dans le moteur, l'historique et les médailles ; l'écran n'en montre que trois, plus
// « À découvrir » à part (case unsure, et les positions jamais essayées). mark : la case dont le groupe reprend la couleur et la forme (.lv-mark, --lv-*).
const LEVEL_GROUPS = {
    learn: { label: 'À apprendre', one: 'À apprendre', rule: 'ratée deux fois d’affilée : à réapprendre', levels: ['weak'], mark: 'weak' },
    doing: { label: 'En cours',    one: 'En cours',    rule: 'paliers 1 et 2 (revue dans 1 ou 3 jours)', levels: ['fragile', 'progress'], mark: 'progress' },
    known: { label: 'Sues',        one: 'Sue',         rule: `palier ${STATS_SOLID_RUN} et plus (7 jours et plus)`, levels: ['solid', 'mastered'], mark: 'mastered' }
};
const LEVEL_GROUP_ORDER = Object.keys(LEVEL_GROUPS);

// Groupe d'une case ('unsure' reste 'unsure').
function levelGroup(lv) {
    return LEVEL_GROUP_ORDER.find(g => LEVEL_GROUPS[g].levels.includes(lv)) || lv;
}

// Fiche affichée d'un groupe, d'une case (rangée dans son groupe) ou de « À découvrir ».
function levelInfo(key) {
    return LEVEL_GROUPS[key] || LEVEL_GROUPS[levelGroup(key)] || STATS_LEVELS[key];
}

// Un filtre (« all », un groupe ou une case) laisse-t-il passer cette case ?
const levelMatches = (lv, f) => f === 'all' || lv === f || levelGroup(lv) === f;

// Comptes par groupe à partir des comptes par case : { learn, doing, known, unsure }.
function groupCounts(counts) {
    const out = { unsure: counts.unsure || 0 };
    LEVEL_GROUP_ORDER.forEach(g => { out[g] = LEVEL_GROUPS[g].levels.reduce((n, l) => n + (counts[l] || 0), 0); });
    return out;
}

// Seul calcul de la maîtrise affichée : part des positions sues (Solides et Maîtrisées) parmi les positions essayées,
// « À découvrir » essayées comprises. counts : { case: nombre }, ou un tableau dans l'ordre de MasteryLog.ORDER (order).
function knownPct(counts, order) {
    const c = Array.isArray(counts) ? Object.fromEntries(order.map((l, i) => [l, counts[i]])) : counts;
    const tried = STATS_LEVEL_ORDER.reduce((n, l) => n + (c[l] || 0), 0);
    return tried ? Math.round(100 * ((c.solid || 0) + (c.mastered || 0)) / tried) : 0;
}

// « À reprendre » (listes de Progrès, exercice de l'Entraînement) : à réapprendre, ou rattrapage en attente après une
// erreur. row : { lv, e }.
const reworkOf = row => row.lv === 'weak' || Number.isInteger(row.e.relearn);

// Case dont une position reprend la couleur et la forme à l'écran : celle de son groupe ('unsure' reste 'unsure').
const levelMark = lv => (LEVEL_GROUPS[levelGroup(lv)] || {}).mark || lv;
