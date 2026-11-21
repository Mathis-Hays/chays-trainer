/**
 * domain/repertoire/levels.js
 * ──────────────────────────────────────────────────────────────────────────
 * Niveaux de maîtrise d'une position, partagés par les Statistiques, l'Entraînement et l'arbre.
 */

'use strict';

const STATS_CONFIRM_TRIES = 3;

// Échelle E3 (chantier « Révision du jour », 18 novembre 2026) : une seule règle, la série de réussites d'affilée
// (runOf, review.js). Chaque réussite monte d'un cran, une erreur fait redescendre tout en bas. Le score sur 100
// ne sert plus qu'au tri de la file du jour. Mêmes six cases et mêmes couleurs : l'historique ne change pas de format.
const STATS_SOLID_RUN    = 3;

const STATS_MASTERED_RUN = 5;

// Du plus fragile au plus sûr (ordre des barres, des filtres et des listes).
const STATS_LEVELS = {
    weak:     { label: 'À retravailler', one: 'À retravailler', rule: 'dernier essai raté' },
    fragile:  { label: 'Fragiles',       one: 'Fragile',        rule: '1 réussite d’affilée depuis la dernière erreur' },
    progress: { label: 'En progrès',     one: 'En progrès',     rule: '2 réussites d’affilée' },
    solid:    { label: 'Solides',        one: 'Solide',         rule: `${STATS_SOLID_RUN} ou ${STATS_MASTERED_RUN - 1} réussites d’affilée` },
    unsure:   { label: 'À confirmer',    one: 'À confirmer',    rule: `moins de ${STATS_CONFIRM_TRIES} essais, sans erreur` },
    mastered: { label: 'Maîtrisées',     one: 'Maîtrisée',      rule: `${STATS_MASTERED_RUN} réussites d’affilée ou plus` }
};

const STATS_LEVEL_ORDER = Object.keys(STATS_LEVELS);

// Sans erreur et moins de 3 essais : À confirmer (aussi sans aucune réussite comptée, essais faits avec la pièce montrée).
function _level(e) {
    const run = runOf(e);
    if (!e.failures && (e.attempts < STATS_CONFIRM_TRIES || !run)) return 'unsure';
    if (!run) return 'weak';
    if (run === 1) return 'fragile';
    if (run === 2) return 'progress';
    return run < STATS_MASTERED_RUN ? 'solid' : 'mastered';
}

// ─── TROIS ÉTATS À L'ÉCRAN (bilan « Chays épuré », lot 3) ──────────────────────
// Les six cases restent dans le moteur, l'historique et les médailles ; l'écran n'en montre que trois, plus
// « À confirmer » à part. mark : la case dont le groupe reprend la couleur et la forme (.lv-mark, --lv-*).
const LEVEL_GROUPS = {
    learn: { label: 'À apprendre', one: 'À apprendre', rule: 'dernier essai raté, ou une seule réussite depuis', levels: ['weak', 'fragile'], mark: 'weak' },
    doing: { label: 'En cours',    one: 'En cours',    rule: '2 réussites d’affilée',                             levels: ['progress'],        mark: 'progress' },
    known: { label: 'Sues',        one: 'Sue',         rule: `${STATS_SOLID_RUN} réussites d’affilée ou plus`,     levels: ['solid', 'mastered'], mark: 'mastered' }
};
const LEVEL_GROUP_ORDER = Object.keys(LEVEL_GROUPS);

// Groupe d'une case ('unsure' reste 'unsure').
function levelGroup(lv) {
    return LEVEL_GROUP_ORDER.find(g => LEVEL_GROUPS[g].levels.includes(lv)) || lv;
}

// Fiche affichée d'un groupe, d'une case (rangée dans son groupe) ou de « À confirmer ».
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
// « À confirmer » compris. counts : { case: nombre }, ou un tableau dans l'ordre de MasteryLog.ORDER (order).
function knownPct(counts, order) {
    const c = Array.isArray(counts) ? Object.fromEntries(order.map((l, i) => [l, counts[i]])) : counts;
    const tried = STATS_LEVEL_ORDER.reduce((n, l) => n + (c[l] || 0), 0);
    return tried ? Math.round(100 * ((c.solid || 0) + (c.mastered || 0)) / tried) : 0;
}

// Case dont une position reprend la couleur et la forme à l'écran : celle de son groupe ('unsure' reste 'unsure').
const levelMark = lv => (LEVEL_GROUPS[levelGroup(lv)] || {}).mark || lv;
