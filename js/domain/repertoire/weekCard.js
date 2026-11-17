/**
 * domain/repertoire/weekCard.js
 * ──────────────────────────────────────────────────────────────────────────
 * La semaine en une carte (atelier « L'envie de revenir », lot 5) : le résumé d'une semaine du lundi au dimanche,
 * calculé à la demande, rien de stocké. Lu dans chessTrainer_activity (essais, erreurs, tous répertoires) et dans
 * l'historique de maîtrise du répertoire (MasteryLog : positions sues = Solides + Maîtrisées).
 *   shown(now)                 lundi de la semaine à montrer : la semaine en cours le dimanche, sinon la précédente.
 *   week(act, rép, lundi)      { from, days: [7 essais], tries, errors, active, rate, sure (écart de positions sues ou null), minutes }
 *   line(sem, avant)           une phrase de conclusion, jamais un reproche.
 *   history(act, rép, now, n)  les n semaines d'avant celle montrée, de la plus récente à la plus ancienne (semaines vides comprises).
 */

'use strict';

const WeekCard = (function () {
    const SECONDS = 30;                                      // durée estimée d'une position (comme l'Entraînement)
    const day = (t, n = 0) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
    const monday = t => day(t, -((new Date(t).getDay() + 6) % 7));

    const shown = (now = Date.now()) => new Date(now).getDay() === 0 ? monday(now) : day(monday(now), -7);

    // Positions sues à la fin d'un jour : dernier relevé de l'historique jusqu'à ce jour compris (null avant tout relevé).
    function sureAt(log, t) {
        const stamp = dayStamp(t);
        let best = null;
        log.forEach(r => { if (r.day <= stamp) best = r; });
        return best ? best.counts[3] + best.counts[4] : null;
    }

    function week(act, rep, from) {
        const days = Array.from({ length: 7 }, (_, i) => (act[dayStamp(day(from, i))] || {}));
        const tries = days.reduce((n, d) => n + (d.a || 0), 0), errors = days.reduce((n, d) => n + (d.f || 0), 0);
        let sure = null;
        if (rep && typeof MasteryLog !== 'undefined') {
            const log = MasteryLog.series(rep, ['w', 'b'], 400, day(from, 7)), before = sureAt(log, day(from, -1)), after = sureAt(log, day(from, 6));
            const firstIn = log.find(r => r.day >= dayStamp(from) && r.day <= dayStamp(day(from, 6)));
            const base = before !== null ? before : firstIn ? firstIn.counts[3] + firstIn.counts[4] : null;
            if (after !== null && base !== null) sure = after - base;
        }
        return { from, days: days.map(d => d.a || 0), tries, errors, active: days.filter(d => d.a).length,
                 rate: tries ? Math.round(100 * (tries - errors) / tries) : null, sure, minutes: Math.round(tries * SECONDS / 60) };
    }

    function line(w, prev) {
        if (!w.tries) return 'Semaine au repos : tout reprend quand vous voulez.';
        if (w.sure >= 5) return `${w.sure} positions de plus sont sues.`;
        if (prev && prev.tries && w.tries >= prev.tries * 1.2) return 'Plus active que la semaine d’avant.';
        if (w.rate >= 90) return 'Presque tout du premier coup.';
        if (w.active >= 5) return `Une semaine régulière : ${w.active} jours actifs.`;
        return 'Chaque séance compte : la suivante consolide celle-ci.';
    }

    function history(act, rep, now = Date.now(), n = 8) {
        const start = shown(now);
        return Array.from({ length: n }, (_, i) => week(act, rep, day(start, -7 * (i + 1))));
    }

    return { shown, week, line, history, monday };
})();
