/**
 * shell/sidebar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rail légendé (à partir de 1 100 px, section « BARRE LATÉRALE » de css/home.css, chantier « Navigation sans repli »).
 * La colonne est faite en CSS : une seule forme, 96 px, icône et nom de chaque onglet, en partie comme ailleurs.
 * Plus de mode étendu, de bouton Replier ni de sous-menus : les sous-rubriques vivent dans les pages
 * (onglets de Progrès, catégories des Finales, barre de contexte d'Aujourd'hui, index des Ouvertures).
 * Ce module ne fait que ce que le CSS ne peut pas faire seul : la puce du répertoire, la couleur
 * et le retour de l'aperçu (`.topnav-meta`) vont en tête du panneau de jeu.
 */

'use strict';

const SideBar = (() => {
    const MQ = '(min-width: 1100px)';

    // Rail : `.topnav-meta` passe dans #game-meta-slot ; en dessous, elle revient dans la barre du haut.
    function place(side) {
        const meta = document.getElementById('topnav-tabs-game');
        const slot = document.getElementById('game-meta-slot');
        if (!meta || !slot) return;
        const from = side ? meta : slot, to = side ? slot : meta;
        [...from.children].forEach(el => to.appendChild(el));
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = matchMedia(MQ);
        place(mq.matches);
        if (mq.addEventListener) mq.addEventListener('change', e => place(e.matches));
    }

    return { place };
})();
