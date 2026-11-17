/**
 * screens/training/trainFocus.js
 * ──────────────────────────────────────────────────────────────────────────
 * Mode Focus (atelier « L'envie de revenir », lot 2) : pendant une séance guidée de l'Entraînement, tout disparaît
 * sauf l'échiquier, la consigne (barre d'état, avec son action « Suivant » / « Encore 5 ») et un fin trait de progression.
 *
 *   TrainFocus.active()  → vrai quand l'écran est en Focus (préférence locale trainFocus ET séance en cours)
 *   TrainFocus.toggle()  → bascule la préférence (bouton « Focus », touche Z, bouton de sortie, Échap)
 *   TrainFocus.sync()    → pose ou retire html.train-focus ; appelé au début et à la fin d'une séance et par applyModeUI
 *
 * La préférence est propre à l'appareil : une fois choisie, chaque séance s'ouvre en Focus.
 */

'use strict';

const TrainFocus = (function () {
    const CLS = 'train-focus';

    function active() {
        return !!(appSettings.trainFocus && typeof gameMode !== 'undefined' && gameMode === 'training'
            && typeof trainingState !== 'undefined' && trainingState.session);
    }

    function sync() {
        const on = active(), root = document.documentElement;
        if (root.classList.contains(CLS) === on) return;
        root.classList.toggle(CLS, on);
        document.querySelectorAll('.tr-focus-btn').forEach(b => b.setAttribute('aria-pressed', String(on)));
    }

    function toggle() {
        setPref('trainFocus', !appSettings.trainFocus);
        sync();
    }

    // Échap sort du Focus (avant tout autre usage de la touche pendant la séance).
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && active() && !document.querySelector('.overlay:not(.hidden)')) { e.preventDefault(); toggle(); }
    });

    if (typeof registerActions === 'function') registerActions({ trainFocus: () => toggle() });

    return { active, sync, toggle };
})();
