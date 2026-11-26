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
 *   center()            action du milieu de la barre unique à la place de l'Indice : { icon, label, title?, run, disabled?, count? } ou null
 *   liveStatus()        retour au présent (navGo) : le mode remet sa consigne ; true si c'est fait
 */

'use strict';

const GameModes = (function () {
    const NO = () => false;
    const DEFAULTS = { inputBlocked: NO, backToLive: NO, navBlocked: NO, playsBothSides: false, sessionCursor: false, movesLocked: false, hintToSolution: false,
                       hintNote: '', pieceNote: '', solutionNote: '', hintCost: () => '', solutionCost: () => '', navBlockedNote: '', idleAction: () => null,
                       onSquare: null, onDrop: null, squareClass: () => '', dockCenter: null, center: null };
    const table = {};
    const register = (name, hooks) => { table[name] = Object.assign({}, DEFAULTS, hooks); };

    // Jouer (chantier « L'échiquier de Chays », Q6) : toucher l'échiquier en regardant le passé ramène au présent,
    // comme en séance ; « Repartir d'ici » (barre d'état, restartFromHere) crée la variante.
    const backToPresent = () => {
        if (typeof navCursor === 'undefined' || navCursor === -1) return false;
        navGo(moveHistory.length - 1);
        return true;
    };
    register('play', { hintToSolution: true, hintNote: ' — Jouer ne compte rien', backToLive: backToPresent });
    register('preview', { inputBlocked: () => true });

    return { register, current: () => table[gameMode] || table.play };
})();
