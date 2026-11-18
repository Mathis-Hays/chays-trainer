/**
 * domain/repertoire/habits.js
 * ──────────────────────────────────────────────────────────────────────────
 * Habitudes de travail, lues dans le journal d'activité (chessTrainer_activity, synchronisé) : rien n'est stocké en plus.
 * Atelier « L'envie de revenir », lot 1 (16 novembre 2026).
 *   streak(act, now)                série de jours actifs, avec un joker par semaine (lundi → dimanche) :
 *                                   un jour manqué seul ne casse pas la série ; deux de suite, ou deux la même semaine, si.
 *   comeback(act, now)              retour après HABITS_AWAY_DAYS jours sans essai (« Bon retour ») ; la part du jour est
 *                                   celle du plafond commun (reviewPlan, objectif quotidien), rien n'est effacé ni décalé.
 */

'use strict';

const Habits = (function () {
    const AWAY_DAYS = 3;          // jours depuis le dernier essai à partir desquels on parle de retour
    const SPREAD_DAYS = 7;        // le retard est réparti sur la semaine qui suit le retour

    // Jours du calendrier (robuste aux changements d'heure) : minuit du jour de t, décalé de n jours.
    const day = (t, n = 0) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
    // Jour actif : une révision notée (a) ou un passage hors révision (p : Survie, défi du jour…), décision du 18 novembre 2026.
    const played = d => !!d && ((d.a || 0) > 0 || (d.p || 0) > 0);
    const active = (act, t) => played(act[dayStamp(t)]);
    const weekOf = t => dayStamp(day(t, -((new Date(t).getDay() + 6) % 7)));      // lundi de la semaine
    const between = (a, b) => Math.round((day(b) - day(a)) / DAY_MS);              // jours de a à b

    // Série : jours actifs consécutifs jusqu'à aujourd'hui (ou hier, tant qu'aujourd'hui n'a pas d'essai).
    // { n : jours actifs, jokers : jours couverts (AAAA-MM-JJ, du plus récent au plus ancien), jokerFree : joker de la semaine encore libre }
    function streak(act, now = Date.now()) {
        const today = day(now), used = new Set(), jokers = [];
        let t = active(act, today) ? today : day(today, -1), n = 0;
        for (let guard = 0; guard < 800; guard++) {
            if (active(act, t)) { n++; t = day(t, -1); continue; }
            // Jour manqué : couvert s'il est seul (la veille est active), si la semaine n'a pas déjà servi,
            // et s'il prolonge une série (ou s'il est hier, aujourd'hui restant à jouer).
            const head = n > 0 || t === day(today, -1);
            if (head && active(act, day(t, -1)) && !used.has(weekOf(t))) {
                used.add(weekOf(t));
                jokers.push(dayStamp(t));
                t = day(t, -1);
                continue;
            }
            break;
        }
        if (!n) return { n: 0, jokers: [], jokerFree: true };
        return { n, jokers, jokerFree: !used.has(weekOf(today)) };
    }

    // Dernier jour actif strictement avant t (minuit), ou null.
    function lastActiveBefore(act, t) {
        const keys = Object.keys(act).filter(k => played(act[k]) && k < dayStamp(t)).sort();
        if (!keys.length) return null;
        const [y, m, d] = keys[keys.length - 1].split('-').map(Number);
        return new Date(y, m - 1, d).getTime();
    }

    // Jour du retour dans la semaine écoulée (aujourd'hui compris, même sans essai encore), ou null.
    function returnDay(act, now) {
        const today = day(now);
        for (let i = 0; i < SPREAD_DAYS; i++) {
            const t = day(today, -i);
            if (i > 0 && !active(act, t)) continue;
            const prev = lastActiveBefore(act, t);
            if (prev !== null && between(prev, t) >= AWAY_DAYS) return { t, away: between(prev, t) };
        }
        return null;
    }

    // Retour : le jour actif (ou aujourd'hui) qui suit AWAY_DAYS jours au moins sans essai, dans la semaine écoulée.
    // null sinon ; { first : c'est aujourd'hui, away : jours d'absence, daysLeft : jours restants de la semaine du retour }.
    // Depuis le chantier « Révision du jour » (novembre 2026), le plafond du jour (reviewPlan, objectif quotidien) répartit
    // le retard : la reprise ne calcule plus sa propre part, elle ne sert plus qu'au titre « Bon retour ».
    function comeback(act, now = Date.now()) {
        const r = returnDay(act, now);
        if (!r) return null;
        const today = day(now);
        return { first: r.t === today, away: r.away, daysLeft: Math.max(1, SPREAD_DAYS - between(r.t, today)) };
    }

    return { streak, comeback, AWAY_DAYS, SPREAD_DAYS };
})();
