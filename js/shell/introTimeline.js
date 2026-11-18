/**
 * shell/introTimeline.js
 * ──────────────────────────────────────────────────────────────────────────
 * Atterrissage de l'écran de lancement : la pièce et la signature du splash rétrécissent et se
 * déplacent jusqu'à leur place exacte dans la barre du haut (FLIP : positions mesurées une fois,
 * une seule transform par élément), leurs couleurs glissent vers celles du thème, le voile s'efface
 * et les blocs [data-stagger] de l'accueil montent en cascade.
 * Uniquement transform, opacity et propriétés de couleur déclarées avec @property (css/splash.css).
 * Barre du haut et barre latérale (onglets, icônes, pilule) : jamais animées, présentes dès que le voile s'efface
 * (chantier « Accueil et lancement », novembre 2026). La cascade est en fill: 'backwards' : rien ne reste figé
 * ni invisible une fois une animation finie, même si l'horloge des animations a été suspendue un moment.
 *
 * API (appelée par splash.js) :
 *   IntroTimeline.land(splash, speed?) → Promise résolue quand tout est en place (true) ou annulée par
 *                                release() (false) — jamais rejetée —, ou null si impossible
 *                                speed : facteur appliqué à tous les temps (0,25 pour l'ouverture courte, splash.js)
 *   IntroTimeline.release()    → annule les animations restantes (après le retrait du splash)
 */

'use strict';

const IntroTimeline = (function () {
    const EASE = {
        flip: 'cubic-bezier(.72, 0, .18, 1)',
        soft: 'cubic-bezier(.4, 0, .2, 1)',
        out:  'cubic-bezier(.16, 1, .3, 1)'
    };
    const T = {                         // ms depuis le début de l'atterrissage
        flipDur: 780, wmLag: 50,        // vol de la pièce, la signature part juste après
        veil: 120, veilDur: 520,        // le fond du splash s'efface
        home: 560, homeStep: 70,        // blocs [data-stagger] de l'onglet affiché
        enterDur: 560
    };
    const COLORS = ['--ct-encre', '--ct-grave', '--ct-laiton'];
    let running = [];

    function anim(el, keyframes, options) {
        const a = el.animate(keyframes, Object.assign({ fill: 'both' }, options));     // vol et voile : dans le splash, retiré ensuite
        running.push(a);
        return a;
    }

    const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    // Inverse la position de départ : translate + scale depuis le coin haut gauche (transform-origin: 0 0).
    // z : facteur de `zoom` hérité (Paramètres › Taille du texte : body { zoom }) ; getBoundingClientRect
    // est en px écran, translate en px CSS zoomés : le déplacement est ramené en px CSS.
    function flip(el, target, options, z) {
        const a = el.getBoundingClientRect();
        if (!shown(target) || !a.width) {               // cible absente (signature masquée) : l'élément s'efface sur place
            return anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12px) scale(.92)' }],
                        Object.assign({}, options, { duration: options.duration * .6 }));
        }
        const b = target.getBoundingClientRect(), s = b.width / a.width;
        return anim(el, [
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${(b.left - a.left) / z}px, ${(b.top - a.top) / z}px) scale(${s})` }
        ], options);
    }

    // Version claire du logo (splash) → couleurs du thème lues sur la cible.
    function recolor(el, target, options) {
        const from = getComputedStyle(el), to = getComputedStyle(target);
        const kf = [{}, {}];
        COLORS.forEach(p => { kf[0][p] = from.getPropertyValue(p).trim(); kf[1][p] = to.getPropertyValue(p).trim(); });
        if (COLORS.some(p => kf[0][p] && kf[0][p] !== kf[1][p])) anim(el, kf, options);
    }

    // Blocs de la page : 'backwards' seulement (invisibles pendant leur délai, rendus au CSS dès la fin).
    function cascade(nodes, delay, step, duration) {
        Array.from(nodes).forEach((n, i) => anim(n,
            [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
            { duration, delay: delay + i * step, easing: EASE.out, fill: 'backwards' }));
    }

    // Vrai logo de la barre : caché le temps du vol (la copie volante se pose dessus), puis rendu au CSS.
    function hideDuring(el, duration) {
        if (el) anim(el, [{ opacity: 0 }, { opacity: 0 }], { duration, fill: 'backwards' });
    }

    function land(splash, speed = 1) {
        const S = {};                                    // temps de cet atterrissage
        Object.keys(T).forEach(k => { S[k] = T[k] * speed; });
        release();
        const stage = splash.querySelector('.sp-stage');
        const piece = splash.querySelector('.sp-piece');
        const wm    = splash.querySelector('.sp-wm');
        const navPiece = document.getElementById('logo-nav');
        const navWm    = document.querySelector('.topnav-wm');
        if (!stage || !piece || !shown(navPiece) || typeof piece.animate !== 'function') return null;

        // Le tracé est terminé : on rend la main au CSS, pour que les couleurs du logo puissent glisser.
        piece.querySelectorAll('[pathLength]').forEach(el => el.getAnimations().forEach(a => a.cancel()));

        const flight = { duration: S.flipDur, easing: EASE.flip };
        const z = splash.getBoundingClientRect().width / splash.offsetWidth || 1;
        flip(piece, navPiece, flight, z);
        hideDuring(navPiece, S.flipDur);
        if (wm) { flip(wm, navWm, Object.assign({}, flight, { delay: S.wmLag }), z); if (shown(navWm)) hideDuring(navWm, S.flipDur + S.wmLag); }
        recolor(stage, navPiece, { duration: S.flipDur, easing: EASE.soft });
        const veil = splash.querySelector('.sp-veil');
        if (veil) anim(veil, [{ opacity: 1 }, { opacity: 0 }], { duration: S.veilDur, delay: S.veil, easing: EASE.soft });
        cascade(document.querySelectorAll('.home-tab:not(.hidden) [data-stagger]'), S.home, S.homeStep, S.enterDur);

        // Une animation annulée rejette `finished` (AbortError) : on le transforme en résultat.
        return Promise.all(running.map(a => a.finished)).then(() => true, () => false);
    }

    function release() {
        running.forEach(a => a.cancel());
        running = [];
    }

    return { land, release, timings: T };
})();
