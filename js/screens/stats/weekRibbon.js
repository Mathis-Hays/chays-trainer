/**
 * screens/stats/weekRibbon.js
 * ──────────────────────────────────────────────────────────────────────────
 * Ruban de la semaine, partagé par Aujourd'hui et Progrès (audit « Progrès en images », K7 et K8) :
 *   week(act, now)            la semaine en cours, lundi → dimanche (Habits.week) : fait, joker, manqué, aujourd'hui, à venir.
 *   span(fc, now, act, opts)  le ruban prolongé : six jours passés, puis les 7 prochains avec leur nombre de révisions
 *                             (programme du répertoire, reviewPlan.forecast). opts.held : révisions en retard, posées en
 *                             pile hachurée au-dessus d'aujourd'hui (« +511 ») ; opts.title, opts.cls : en-tête et classe ;
 *                             opts.bare : sans en-tête (Progrès pose le sien).
 * Une seule écriture : la case d'un jour se dessine pareil partout (.hp-wk, components.css).
 */

'use strict';

const WeekRibbon = (function () {
    const STATE = { done: 'fait', joker: 'joker', missed: 'manqué', today: 'à faire', future: 'à venir' };
    const name = t => new Date(t).toLocaleDateString(I18n.locale(), { weekday: 'long' });
    const letter = t => new Date(t).toLocaleDateString(I18n.locale(), { weekday: 'narrow' });
    const tip = (t, state) => I18n.pair(name(t), I18n.t(STATE[state]));
    const played = (act, t) => { const d = act[dayStamp(t)]; return !!d && ((d.a || 0) > 0 || (d.p || 0) > 0); };

    function week(act, now = Date.now()) {
        const days = Habits.week(act, now), done = days.filter(d => d.state === 'done').length, past = days.filter(d => d.state !== 'future').length;
        const label = I18n.pair(I18n.t('Jours actifs cette semaine'), `${done} / ${past}`);
        return `<span class="hp-week" role="img" aria-label="${escapeHtml(label)}">${days.map(d =>
            `<span class="hp-wk is-${d.state}" title="${escapeHtml(tip(d.t, d.state))}"><i></i><span>${escapeHtml(I18n.mark(letter(d.t)))}</span></span>`).join('')}</span>`;
    }

    function span(fc, now, act = {}, opts = {}) {
        const d0 = new Date(now), at = i => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime();
        const past = [-6, -5, -4, -3, -2, -1].map(i => { const t = at(i), on = played(act, t);
            return `<li class="hp-wk is-${on ? 'done' : 'missed'}" aria-label="${escapeHtml(tip(t, on ? 'done' : 'missed'))}"><b></b><i></i><span aria-hidden="true">${escapeHtml(I18n.mark(letter(t)))}</span></li>`; }).join('');
        const day = i => i === 0 ? I18n.t('aujourd’hui') : new Date(at(i)).toLocaleDateString(I18n.locale(), { weekday: 'long' });
        const held = opts.held || 0;
        const title = opts.title || 'Deux semaines';
        const total = fc.reduce((a, b) => a + b, 0);
        const head = opts.bare ? '' : `<div class="hp-h"><h3>${title}</h3><span class="hp-n">${total}</span></div>`;
        return `<div class="${opts.bare ? 'hp-ribbon' : 'hp-plan hp-fc-wrap'} ${opts.cls || ''}">${head}
            <div class="hp-span"><ol class="hp-past" aria-label="${I18n.t('Six derniers jours')}">${past}</ol>
            <ol class="hp-fc" aria-label="${I18n.t('Révisions prévues sur les 7 prochains jours')}">${fc.map((v, i) => {
                const late = i === 0 && held ? `<em class="hp-held" aria-hidden="true">+${held}</em>` : '';
                const lbl = `${day(i)} : ${v} ${v > 1 ? 'positions' : 'position'}${i === 0 && held ? `, ${held} en retard` : ''}`;
                return `<li class="hp-wk is-${i === 0 ? (played(act, now) ? 'done' : 'today') : 'future'}${late ? ' has-held' : ''}" aria-label="${escapeHtml(I18n.mark(lbl))}">${late}<b class="hp-fc-n">${v}</b>`
                    + `<i></i><span aria-hidden="true">${escapeHtml(I18n.mark(letter(at(i))))}</span></li>`; }).join('')}</ol></div>
            ${held ? `<p class="hp-held-note"><i aria-hidden="true"></i><b>${held}</b><span>${opts.catchUp ? `en attente · à jour vers ${opts.catchUp}` : 'en attente, au-delà de l’objectif du jour'}</span></p>` : ''}</div>`;
    }

    return { week, span, tip, letter };
})();
