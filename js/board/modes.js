/**
 * board/modes.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fiche de chaque mode de l'échiquier : ce qui diffère d'un mode à l'autre pour un coup, un clic, l'indice ou la navigation.
 * Jouer et l'aperçu sont décrits ici ; Entraînement, Finales et Analyse s'enregistrent depuis leur écran.
 *   inputBlocked()      l'échiquier ignore clics et glissés (aperçu, cinématique)
 *   backToLive()        true si toucher l'échiquier a seulement ramené au présent
 *   navBlocked()        ◀ ▶ gelés
 *   playsBothSides      les deux camps passent par onMove
 *   onMove(de, à, promo)  le coup est confié au mode (sinon : règle de Jouer)
 *   onHint(), onSolution()  indice et solution confiés au mode
 *   sessionCursor       séance : la navigation ne tronque rien, l'indice porte sur le présent
 *   movesLocked         barre de coups et flèches ← → inactives
 *   hintToSolution      un deuxième appui sur Indice montre la solution
 *   hintNote, pieceNote, solutionNote, hintCost(palier), solutionCost()  compléments de texte (indice en trois paliers)
 *   navBlockedNote      infobulle de ◀ ▶ grisés pendant navBlocked()
 *   idleAction()        action de la barre d'état quand rien d'autre ne l'occupe (Entraînement en Focus : l'Indice)
 *   onNavigate()        la position affichée a changé
 *   engineArrows()      flèches ajoutées par le moteur
 *   onSquare(case)      un clic sur une case est confié au mode, sans règle de coup (éditeur de position)
 *   onDrop(de, à)       une pièce glissée est confiée au mode, de n'importe quel camp ; à = null hors de l'échiquier
 *   squareClass(case)   classe ajoutée à la case (éditeur : case douteuse d'une image, .ed-doubt)
 *   dockCenter()        centre du dock sur téléphone : { icon, label, title, tone?, target (bouton touché) | run }
 */

'use strict';

const GameModes = (function () {
    const NO = () => false;
    const DEFAULTS = { inputBlocked: NO, backToLive: NO, navBlocked: NO, playsBothSides: false, sessionCursor: false, movesLocked: false, hintToSolution: false,
                       hintNote: '', pieceNote: '', solutionNote: '', hintCost: () => '', solutionCost: () => '', navBlockedNote: '', idleAction: () => null,
                       onSquare: null, onDrop: null, squareClass: () => '', dockCenter: null };
    const table = {};
    const register = (name, hooks) => { table[name] = Object.assign({}, DEFAULTS, hooks); };

    register('play', { hintToSolution: true, hintNote: ' — Jouer ne compte rien' });
    register('preview', { inputBlocked: () => true });

    return { register, current: () => table[gameMode] || table.play };
})();
