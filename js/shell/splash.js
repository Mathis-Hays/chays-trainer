/**
 * shell/splash.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sortie de l'écran de lancement (#splash, index.html ; animation : css/splash.css).
 * L'animation démarre seule au premier affichage (classe « splashing » posée dans le <head>) ;
 * ce script décide seulement QUAND sortir :
 *   - « la plume » (première ouverture sur l'appareil) : pas avant la fin de la suspension (animation spHold de
 *     l'overlay, 1,2 s), pour que le tracé ne soit pas coupé ; un toucher, un clic ou une touche l'écourte ;
 *     ouverture courte (html.splash-quick) : aucune suspension, la sortie part dès que l'app est prête ;
 *   - pas avant que l'application soit prête : DOMContentLoaded (pièces, onglet ?tab=), le signal « app:ready »
 *     (Bus, émis par app.js après le premier rendu de l'accueil : le rideau se lève sur une page finie, plafonné à
 *     3 s si le démarrage a échoué), puis chargement complet et polices (Inter, Fraunces, IBM Plex Mono), plafonnés
 *     à 2,6 s ; l'ouverture courte attend tout cela, mais jamais de suspension ;
 *   - quoi qu'il arrive au plus tard à 4,5 s : un réseau lent ne bloque jamais l'accès.
 * Fin (splash retiré) : Bus.emit('intro:done') ; les tâches lourdes du lancement l'attendent (Bus.afterIntro : parties
 * relues, archive, synchronisation). Sans écran de lancement, le signal part tout de suite.
 * Sortie : atterrissage (js/shell/introTimeline.js, 0,7 s : temps × 0,5 ; 0,35 s, × 0,25, pour l'ouverture courte) — la pièce et la signature volent jusqu'à
 * la barre du haut et les blocs de l'accueil montent en cascade (barres jamais animées). Mouvement réduit ou barre introuvable : fondu de 0,45 s.
 * Pendant la sortie, <html class="splash-out"> : la barre système reprend la couleur du thème
 * (themeColor.js). Onglet en arrière-plan (horloge des animations suspendue) : retrait par minuteur.
 */

'use strict';

(function () {
    const root = document.documentElement;
    const introDone = () => { if (typeof Bus !== 'undefined') Bus.emit('intro:done'); };
    if (!root.classList.contains('splashing')) { introDone(); return; }
    const splash = document.getElementById('splash');

    const READY_CAP = 2600;                       // ms depuis le début de la navigation
    const APP_CAP   = 3000;                       // garde : app:ready jamais reçu (erreur au démarrage)
    const MAX_SHOWN = 4500;
    const EXIT_MS   = 450;
    const QUICK     = root.classList.contains('splash-quick');
    const SPEED     = QUICK ? .25 : .5;              // atterrissage resserré (novembre 2026) : 0,35 s à l'ouverture courte
    const LAND_MS   = 1400 * SPEED;
    const until = ms => new Promise(r => setTimeout(r, Math.max(0, ms - performance.now())));
    const cssAnim = name => splash.getAnimations().find(a => a.animationName === name);

    let left = false, done = false;

    function finish() {
        if (done) return;
        done = true;
        root.classList.remove('splashing', 'splash-out');
        splash.remove();                                      // le vrai logo apparaît sous la copie volante
        if (typeof IntroTimeline !== 'undefined') IntroTimeline.release();
        introDone();
    }

    function leave() {
        if (left) return;
        left = true;
        root.classList.add('splash-out');
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const flight = !reduce && typeof IntroTimeline !== 'undefined' ? IntroTimeline.land(splash, SPEED) : null;
        if (flight) {
            flight.then(finish, finish);
            setTimeout(finish, LAND_MS + 400);
            return;
        }
        splash.classList.add('is-leaving');
        const exit = cssAnim('spExit');
        if (exit) exit.finished.then(finish, finish);
        setTimeout(finish, EXIT_MS + 250);
    }

    if (!splash) { root.classList.remove('splashing'); introDone(); return; }

    const hold = cssAnim('spHold');
    const skip = new Promise(r => ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, r, { once: true, capture: true })));
    const held = QUICK ? Promise.resolve() : Promise.race([hold ? hold.finished.catch(() => {}) : Promise.resolve(), skip]);

    const domReady = new Promise(r => {
        if (document.readyState !== 'loading') r();
        else document.addEventListener('DOMContentLoaded', () => setTimeout(r, 0), { once: true });   // après les autres gestionnaires
    });
    const loaded = new Promise(r => {
        if (document.readyState === 'complete') r();
        else window.addEventListener('load', r, { once: true });
    });
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => {}) : Promise.resolve();
    // Accueil dessiné (app.js) : Bus.when répond tout de suite si le signal est déjà parti.
    const appReady = typeof Bus !== 'undefined' ? new Promise(r => Bus.when('app:ready', r)) : Promise.resolve();
    const ready = domReady.then(() => Promise.all([
        Promise.race([appReady, until(APP_CAP)]),
        Promise.race([Promise.all([loaded, fonts]), until(READY_CAP)])
    ]));

    // Image suivante, ou 150 ms au plus : une page en arrière-plan (rAF suspendu) ne garde pas le rideau jusqu'à 4,5 s.
    Promise.all([held, ready]).then(() => { requestAnimationFrame(leave); setTimeout(leave, 150); });
    until(MAX_SHOWN).then(leave);
})();
