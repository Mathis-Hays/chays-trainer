/**
 * domain/repertoire/habits.js
 * ──────────────────────────────────────────────────────────────────────────
 * Habitudes de travail, lues dans le journal d'activité (chessTrainer_activity, synchronisé) : rien n'est stocké en plus.
 * Atelier « L'envie de revenir », lot 1 (16 novembre 2026).
 *   streak(act, now)                série de jours actifs, avec un joker par semaine (lundi → dimanche) :
 *                                   un jour manqué seul ne casse pas la série ; deux de suite, ou deux la même semaine, si.
 *   comeback(act, due, now, goal)   retour en douceur : après HABITS_AWAY_DAYS jours sans essai, le retard n'est pas posé
 *                                   d'un bloc ; une première part de HABITS_COMEBACK_FIRST positions, puis le reste réparti
 *                                   sur les HABITS_SPREAD_DAYS jours qui suivent le retour. Rien n'est effacé ni décalé :
 *                                   seul Aujourd'hui limite sa Révision du jour, l'Entraînement garde la file entière.
 */

'use strict';

const Habits = (function () {
    const AWAY_DAYS = 3;          // jours depuis le dernier essai à partir desquels on parle de retour
    const COMEBACK_FIRST = 8;     // positions de la première séance de reprise (et plancher des jours suivants)
    const SPREAD_DAYS = 7;        // le retard est réparti sur la semaine qui suit le retour

    // Jours du calendrier (robuste aux changements d'heure) : minuit du jour de t, décalé de n jours.
    const day = (t, n = 0) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
    const active = (act, t) => !!(act[dayStamp(t)] || {}).a;
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
        const keys = Object.keys(act).filter(k => act[k] && act[k].a > 0 && k < dayStamp(t)).sort();
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

    // Retour en douceur. due : positions de la Révision du jour en ce moment ; goal : objectif quotidien.
    // null quand il n'y a rien à retenir ; sinon { first, away, quota, left, held, daysLeft } :
    //   first : c'est le jour du retour ; left : positions proposées maintenant ; held : les autres, gardées pour la suite.
    function comeback(act, due, now = Date.now(), goal = 10) {
        const r = returnDay(act, now);
        if (!r || !due) return null;
        const today = day(now), done = (act[dayStamp(today)] || { a: 0 }).a;
        const daysLeft = Math.max(1, SPREAD_DAYS - between(r.t, today));
        const first = r.t === today;
        const quota = first ? COMEBACK_FIRST : Math.max(COMEBACK_FIRST, Math.min(goal * 3, Math.ceil((due + done) / daysLeft)));
        const left = Math.max(0, quota - done);
        if (due <= left) return null;                 // tout tient dans la part du jour : séance normale
        return { first, away: r.away, quota, left, held: due - left, daysLeft };
    }

    return { streak, comeback, AWAY_DAYS, COMEBACK_FIRST, SPREAD_DAYS };
})();
