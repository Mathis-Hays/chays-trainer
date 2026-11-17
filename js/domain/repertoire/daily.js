/**
 * domain/repertoire/daily.js
 * ──────────────────────────────────────────────────────────────────────────
 * Défi du jour (atelier « L'envie de revenir », lot 3) : chaque jour, une position du répertoire, la même toute la
 * journée, avec sa propre série. Tirage déterministe par date et par répertoire (rien côté serveur), parmi les
 * positions fragiles ou oubliées de préférence.
 *
 * Stockage synchronisé chessTrainer_daily : { 'AAAA-MM-JJ': { r: 1 | 0, k: position, c: 'w' | 'b', rep, at } }.
 * Seul le premier essai du jour compte (fusion : le plus ancien `at` l'emporte) ; 400 jours gardés.
 *
 *   Daily.pick(rows, day, rep)  → { color, key, e } | null   rows : repertoireRows() (positions déjà essayées)
 *   Daily.today(now)            → résultat du jour ou null
 *   Daily.save(rec, now)        → écrit le résultat du jour s'il n'y en a pas encore ; renvoie le résultat gardé
 *   Daily.streak(log, now)      → jours réussis d'affilée, jusqu'à aujourd'hui (aujourd'hui pas encore joué ne casse rien)
 */

'use strict';

const Daily = (function () {
    const KEY = 'chessTrainer_daily', KEEP_DAYS = 400, FORGOTTEN_DAYS = 21;

    // Petit hachage stable (FNV-1a) : le même jour et le même répertoire donnent la même position sur tous les appareils.
    function hash(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return h >>> 0;
    }

    function pick(rows, day, rep) {
        const tried = (rows || []).filter(r => r.e && r.e.attempts > 0);
        if (!tried.length) return null;
        const now = new Date(day + 'T12:00:00').getTime();
        const old = r => !r.e.lastReviewed || now - r.e.lastReviewed > FORGOTTEN_DAYS * 86400000;
        const shaky = tried.filter(r => ['weak', 'fragile', 'progress'].includes(_level(r.e)) || old(r));
        const pool = (shaky.length ? shaky : tried).slice().sort((a, b) => (a.color + a.key < b.color + b.key ? -1 : 1));
        return pool[hash(day + '|' + (rep || '')) % pool.length];
    }

    function read() {
        const o = dataStore.getJSON(KEY, null);
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    }

    const today = (now = Date.now()) => read()[dayStamp(now)] || null;

    function save(rec, now = Date.now()) {
        const log = read(), day = dayStamp(now);
        if (log[day]) return log[day];
        log[day] = { r: rec.ok ? 1 : 0, k: rec.key, c: rec.color, rep: rec.rep || '', at: now };
        const cut = dayStamp(now - KEEP_DAYS * 86400000);
        Object.keys(log).forEach(d => { if (d < cut) delete log[d]; });
        dataStore.setJSON(KEY, log);
        return log[day];
    }

    function streak(log = read(), now = Date.now()) {
        let n = 0, t = new Date(now).setHours(12, 0, 0, 0);     // midi : un changement d'heure ne saute pas de jour
        if (!log[dayStamp(t)]) t -= 86400000;                  // aujourd'hui pas encore joué : on compte jusqu'à hier
        for (;;) {
            const d = log[dayStamp(t)];
            if (!d || !d.r) return n;
            n++;
            t -= 86400000;
        }
    }

    return { KEY, pick, read, today, save, streak };
})();
