/**
 * domain/repertoire/masteryLog.js
 * ──────────────────────────────────────────────────────────────────────────
 * Historique de maîtrise (atelier « Ouvertures et Progrès », lot 3) : un relevé par répertoire et par jour du nombre de
 * positions travaillées (au moins un essai) à chaque niveau, pour chaque couleur. Clé synchronisée chessTrainer_masteryLog :
 *   { 'répertoire|AAAA-MM-JJ': { w: [weak, fragile, progress, solid, mastered, unsure], b: […], at } }
 * Le relevé du jour est réécrit tant que le jour dure (dernier état), seulement s'il change. Entre deux appareils, pour un
 * même jour, le relevé le plus récent l'emporte (syncModel, même fusion que les préférences). Gardé KEEP_DAYS jours.
 *   record(rép, now)                  relève l'état actuel ; true s'il a écrit.
 *   series(rép, couleurs, jours, now) [{ day, counts: [6] }] du plus ancien au plus récent ; un jour sans relevé est absent.
 *   take(rép) / put(rép, relevés)     retire / remet les relevés d'un répertoire (corbeille) ; rename(ancien, nouveau).
 * Relevé à l'affichage de Progrès, à la fin d'une séance et au lancement.
 */

'use strict';

const MasteryLog = (function () {
    const KEY = 'chessTrainer_masteryLog', KEEP_DAYS = 400;
    const ORDER = ['weak', 'fragile', 'progress', 'solid', 'mastered', 'unsure'];
    const pad = n => String(n).padStart(2, '0');
    const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const read = () => { const o = dataStore.getJSON(KEY, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
    const split = k => { const i = k.lastIndexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
    const valid = v => !!v && ['w', 'b'].every(c => Array.isArray(v[c]) && v[c].length === ORDER.length);
    const empty = c => c.every(n => !n);

    function counts(rep, color) {
        const c = ORDER.map(() => 0), db = readDBFor(rep, color);
        Object.keys(db).forEach(k => { const e = db[k]; if (e.attempts > 0) c[ORDER.indexOf(_level(e))]++; });
        return c;
    }

    function record(rep, now = Date.now()) {
        if (!rep) return false;
        const all = read(), key = `${rep}|${dayOf(now)}`, w = counts(rep, 'w'), b = counts(rep, 'b'), old = all[key];
        if (valid(old) ? JSON.stringify([old.w, old.b]) === JSON.stringify([w, b]) : empty(w) && empty(b)) return false;
        all[key] = { w, b, at: now };
        const limit = dayOf(now - KEEP_DAYS * 864e5);
        Object.keys(all).forEach(k => { if (split(k)[1] < limit) delete all[k]; });
        dataStore.setJSON(KEY, all);
        return true;
    }

    function series(rep, colors, days, now = Date.now()) {
        const all = read(), from = dayOf(now - (days - 1) * 864e5), out = [];
        Object.keys(all).forEach(k => {
            const [r, d] = split(k), v = all[k];
            if (r !== rep || d < from || !valid(v)) return;
            out.push({ day: d, counts: ORDER.map((_, i) => colors.reduce((n, c) => n + (Number(v[c][i]) || 0), 0)) });
        });
        return out.sort((a, b) => (a.day < b.day ? -1 : 1));
    }

    function take(rep) {
        const all = read(), out = {};
        Object.keys(all).forEach(k => { const [r, d] = split(k); if (r === rep) { out[d] = all[k]; delete all[k]; } });
        if (Object.keys(out).length) dataStore.setJSON(KEY, all);
        return out;
    }

    function put(rep, recs) {
        if (!recs || typeof recs !== 'object' || !Object.keys(recs).length) return;
        const all = read();
        Object.keys(recs).forEach(d => { if (valid(recs[d])) all[`${rep}|${d}`] = recs[d]; });
        dataStore.setJSON(KEY, all);
    }

    const rename = (from, to) => put(to, take(from));

    return { KEY, ORDER, dayOf, record, series, take, put, rename };
})();
