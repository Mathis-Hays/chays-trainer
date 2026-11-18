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
