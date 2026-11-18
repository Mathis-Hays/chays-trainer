/**
 * core/colorScope.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sélecteur de couleur commun (Statistiques, Entraînement, Analyser mes parties, import PGN).
 *
 *   ColorScope.render(host, { options, value, onChange, label?, size?, locked?, lockedHint? })
 *     options : sous-ensemble ordonné de 'w', 'b', 'all' (ou 'mix') ; value : option choisie.
 *     onChange(valeur) n'est appelé que si le choix change.
 *     size 'sm' : version de la barre du haut (plus basse ; libellés masqués sur téléphone, cf. .cs-sm).
 *     locked : couleur imposée (séance guidée, finale…) ; le choix reste affiché mais ne change plus,
 *              lockedHint l'explique en infobulle.
 *
 * Un groupe de boutons radio (role="radiogroup") avec un curseur qui glisse sous l'option choisie ;
 * chaque option porte le roi du jeu de pièces actif (les deux rois pour « Les deux »).
 * Rendu une seconde fois sur le même hôte avec les mêmes options, le composant est mis à jour sur place :
 * le curseur glisse au lieu de réapparaître. Flèches, Origine et Fin au clavier, seulement si le focus vient du clavier :
 * après un clic, ← → restent à la navigation dans les coups (chantier « Échiquier et séance »).
 */

'use strict';

const ColorScope = (function () {
    const LABELS = { w: 'Blancs', b: 'Noirs', all: 'Les deux', mix: 'Les deux' };
    const king = p => `<span class="glyph" data-glyph="${p}">${(typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || ''}</span>`;
    const icon = o => o === 'w' ? king('K') : o === 'b' ? king('k') : `<span class="cs-both">${king('K')}${king('k')}</span>`;

    function paint(root, value) {
        const opts = root._cs.options, i = Math.max(0, opts.indexOf(value));
        root._cs.value = opts[i];
        root.style.setProperty('--i', i);
        root.querySelectorAll('.cs-opt').forEach((b, k) => {
            b.setAttribute('aria-checked', String(k === i));
            b.tabIndex = k === i ? 0 : -1;
        });
    }

    function pick(root, k, focus) {
        if (root._cs.locked) return;
        const opts = root._cs.options, v = opts[(k + opts.length) % opts.length];
        const changed = v !== root._cs.value;
        paint(root, v);
        if (focus) root.querySelector(`.cs-opt[data-v="${v}"]`).focus();
        if (changed && root._cs.onChange) root._cs.onChange(v);
    }

    function render(host, { options, value, onChange, label = 'Couleur', size, locked = false, lockedHint = '' }) {
        if (!host) return;
        let root = host.firstElementChild;
        if (!root || !root._cs || root._cs.options.join() !== options.join()) {
            host.innerHTML = `<div class="cs" role="radiogroup" aria-label="${escapeHtml(label)}" style="--n:${options.length}">
                <span class="cs-thumb" aria-hidden="true"></span>
                ${options.map(o => `<button type="button" class="cs-opt" role="radio" data-v="${o}" title="${LABELS[o]}">${icon(o)}<span class="cs-l">${LABELS[o]}</span></button>`).join('')}
            </div>`;
            root = host.firstElementChild;
            root._cs = { options: options.slice() };
            root.addEventListener('click', e => {
                const b = e.target.closest('.cs-opt');
                if (b) pick(root, root._cs.options.indexOf(b.dataset.v), false);
            });
            // Focus donné par un clic ou un toucher : les flèches ne sont pas lues (elles changeraient de camp et relanceraient la partie).
            root.addEventListener('pointerdown', () => { root._cs.mouse = true; });
            root.addEventListener('focusout', e => { if (!root.contains(e.relatedTarget)) root._cs.mouse = false; });
            root.addEventListener('keydown', e => {
                if (e.key === 'Tab') { root._cs.mouse = false; return; }
                if (root._cs.mouse) return;
                const i = root._cs.options.indexOf(root._cs.value);
                const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: root._cs.options.length - 1 }[e.key];
                if (to === undefined) return;
                e.preventDefault();
                e.stopPropagation();                         // la navigation dans les coups ne joue pas en plus
                pick(root, to, true);
            });
        }
        root._cs.onChange = onChange;
        root._cs.locked = !!locked;
        root.classList.toggle('cs-sm', size === 'sm');
        root.classList.toggle('cs-locked', !!locked);
        if (locked) { root.setAttribute('aria-disabled', 'true'); root.title = lockedHint; }
        else { root.removeAttribute('aria-disabled'); root.removeAttribute('title'); }
        paint(root, value);
    }

    return { render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { ColorScope };
