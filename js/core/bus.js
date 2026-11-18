/**
 * core/bus.js
 * ──────────────────────────────────────────────────────────────────────────
 * Petit bus d'événements synchrone : les données annoncent ce qui a changé, les écrans décident quoi redessiner.
 * Ainsi le stockage et la synchronisation n'ont pas à connaître les écrans.
 *   Bus.on(nom, fn)            abonne fn(données)
 *   Bus.emit(nom, données)     appelle les abonnés, dans l'ordre ; l'erreur de l'un n'arrête pas les autres
 *   Bus.when(nom, fn)          fn(données) une seule fois : tout de suite si l'événement a déjà eu lieu, sinon au premier
 *   Bus.afterIntro(fn, ms?)    tâche lourde du lancement : après la fin de l'intro (« intro:done », tout de suite sans
 *                              écran de lancement), puis ms millisecondes, puis au premier moment libre (requestIdleCallback)
 * Événements : data:changed (clés reçues de la synchro) · data:imported · trash:restored · backup:changed ·
 * sync:status · i18n:lang · ui:refresh · elo:choice (site ou cadence de l'Elo) · app:ready (premier rendu de l'accueil,
 * app.js ; le rideau du lancement l'attend) · intro:done (rideau levé, splash.js) · game:show (couleur : afficher l'écran
 * de jeu, showGameScreen d'app.js ; émis par l'éditeur de position).
 */

'use strict';

const Bus = (function () {
    const subs = {}, fired = {};
    const IDLE_CAP = 2000;                     // un navigateur jamais libre exécute quand même la tâche

    function on(name, fn) { (subs[name] = subs[name] || []).push(fn); }
    function emit(name, data) {
        fired[name] = { data };
        (subs[name] || []).forEach(fn => { try { fn(data); } catch (e) { reportError('événement ' + name, e); } });
    }
    function when(name, fn) {
        if (fired[name]) { fn(fired[name].data); return; }
        let done = false;
        on(name, d => { if (!done) { done = true; fn(d); } });
    }

    // Écran de lancement affiché (classe posée par le script de tête d'index.html) : l'intro n'est pas finie.
    const introShown = () => typeof document !== 'undefined' && !!document.documentElement
        && !!document.documentElement.classList && document.documentElement.classList.contains('splashing');
    function afterIntro(fn, ms = 0) {
        const run = () => { try { fn(); } catch (e) { reportError('tâche après le lancement', e); } };
        const idle = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: IDLE_CAP }) : setTimeout(run, 1));
        const go = () => (ms > 0 ? setTimeout(idle, ms) : idle());
        if (fired['intro:done'] || !introShown()) go();
        else when('intro:done', go);
    }

    return { on, emit, when, afterIntro };
})();
