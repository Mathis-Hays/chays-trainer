/**
 * domain/repertoire/medals.js
 * ──────────────────────────────────────────────────────────────────────────
 * Vitrine de médailles (atelier « L'envie de revenir », lot 5) : vingt caps, pas plus, en laiton. Une médaille se gagne
 * une fois pour toutes, même si le chiffre qui l'a donnée redescend (série coupée, position oubliée).
 * Clé synchronisée chessTrainer_medals : { [médaille]: date du gain } ; entre deux appareils, la date la plus ancienne l'emporte.
 *   context(extra)        les chiffres lus partout (tous les répertoires, activité, finales, records) ; extra.summary : bilan d'une séance.
 *   list(extra, now)      [{ id, cat, glyph, name, desc, v, goal, at, fresh }] dans l'ordre de la vitrine ; fresh : gagnée depuis FRESH_DAYS.
 *   check(extra, now)     range les médailles nouvellement gagnées et les renvoie (à annoncer).
 *   next(liste)           la prochaine médaille, ce qu'il manque et sa piste (médaillier, chantier « Progrès : qualité et médailles »).
 */

'use strict';

const Medals = (function () {
    const KEY = 'chessTrainer_medals', FRESH_DAYS = 3;
    const CATS = [['mastery', 'Maîtrise'], ['ranks', 'Rangs d’ouverture'], ['habit', 'Régularité'], ['play', 'Exercices'], ['endgames', 'Finales']];

    // of(ctx) : [valeur, but]. Une médaille d'événement (séance parfaite, ligne) vaut 1 quand le bilan le montre.
    const LIST = [
        { id: 'm1',     cat: 'mastery', glyph: '1',   name: 'Première gravure',     desc: 'Une position maîtrisée', unit: 'mastered', of: c => [c.mastered, 1] },
        { id: 'm25',    cat: 'mastery', glyph: '25',  name: 'Vingt-cinq',           desc: '25 positions maîtrisées', unit: 'mastered', of: c => [c.mastered, 25] },
        { id: 'm100',   cat: 'mastery', glyph: '100', name: 'La centaine',          desc: '100 positions maîtrisées', unit: 'mastered', of: c => [c.mastered, 100] },
        { id: 'm250',   cat: 'mastery', glyph: '250', name: 'Bibliothèque',         desc: '250 positions maîtrisées', unit: 'mastered', of: c => [c.mastered, 250] },
        { id: 'line',   cat: 'mastery', glyph: '↦',   name: 'D’un trait',           desc: 'Une ligne complète sans faute',  of: c => [c.linePerfect, 1] },
        { id: 'rank1',  cat: 'ranks',   glyph: 'II',  name: 'Compagnon',            desc: 'Une ouverture au rang de Compagnon', of: c => [c.ranks[1], 1] },
        { id: 'rank2',  cat: 'ranks',   glyph: 'III', name: 'Maître',               desc: 'Une ouverture au rang de Maître', of: c => [c.ranks[2], 1] },
        { id: 'rank2x3', cat: 'ranks',  glyph: '3',   name: 'Trois maîtrises',      desc: 'Trois ouvertures au rang de Maître', unit: 'master', of: c => [c.ranks[2], 3] },
        { id: 's7',     cat: 'habit',   glyph: '7',   name: 'Une semaine',          desc: '7 jours d’affilée', unit: 'streak', of: c => [c.streak, 7] },
        { id: 's30',    cat: 'habit',   glyph: '30',  name: 'Un mois',              desc: '30 jours d’affilée', unit: 'streak', of: c => [c.streak, 30] },
        { id: 's100',   cat: 'habit',   glyph: '100', name: 'Cent jours',           desc: '100 jours d’affilée', unit: 'streak', of: c => [c.streak, 100] },
        { id: 't1000',  cat: 'habit',   glyph: '1000', name: 'Mille révisions',     desc: '1 000 positions révisées', unit: 'tries', of: c => [c.tries, 1000] },
        { id: 'perfect', cat: 'play',   glyph: '10',  name: 'Sans faute',           desc: 'Une séance de 10 positions, toutes du premier coup', of: c => [c.perfect, 1] },
        { id: 'daily7', cat: 'play',    glyph: '7',   name: 'Défis relevés',        desc: '7 défis du jour réussis d’affilée', unit: 'daily', of: c => [c.daily, 7] },
        { id: 'surv20', cat: 'play',    glyph: '20',  name: 'Survivant',            desc: '20 bons coups en Survie', unit: 'survival', of: c => [c.survival, 20] },
        { id: 'timed30', cat: 'play',   glyph: '30',  name: 'Contre la montre',     desc: '30 bons coups au contre-la-montre', unit: 'timed', of: c => [c.timed, 30] },
        { id: 'lucena', cat: 'endgames', glyph: 'L',  name: 'Le pont',              desc: 'La position de Lucena gagnée',   of: c => [c.lucena, 1] },
        { id: 'philidor', cat: 'endgames', glyph: 'P', name: 'Le rempart',          desc: 'La défense Philidor tenue',      of: c => [c.philidor, 1] },
        { id: 'stars30', cat: 'endgames', glyph: '30', name: 'Constellation',       desc: '30 étoiles en finales', unit: 'stars', of: c => [c.stars, 30] },
        { id: 'egall',  cat: 'endgames', glyph: '★',  name: 'Toutes les finales',   desc: 'Chaque finale réussie au moins une fois', unit: 'endgames', of: c => [c.egDone, c.egTotal || 1] }
    ];

    // Ce qu'il reste à faire, dit en mots (« Encore 38 positions maîtrisées ») : [singulier, pluriel].
    const UNITS = { mastered: ['position maîtrisée', 'positions maîtrisées'], master: ['ouverture au rang de Maître', 'ouvertures au rang de Maître'],
        streak: ['jour d’affilée', 'jours d’affilée'], tries: ['position révisée', 'positions révisées'], daily: ['défi réussi d’affilée', 'défis réussis d’affilée'],
        survival: ['bon coup en Survie', 'bons coups en Survie'], timed: ['bon coup au contre-la-montre', 'bons coups au contre-la-montre'],
        stars: ['étoile en finales', 'étoiles en finales'], endgames: ['finale à réussir', 'finales à réussir'] };

    const read = () => { const o = dataStore.getJSON(KEY, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
    const num = k => Number(dataStore.getJSON(k, 0)) || 0;

    function context(extra = {}) {
        const c = { mastered: 0, ranks: [0, 0, 0], streak: 0, tries: 0, daily: 0, survival: num('chessTrainer_survivalRecord'), timed: num('chessTrainer_timedRecord'),
                    lucena: 0, philidor: 0, stars: 0, egDone: 0, egTotal: 0, perfect: 0, linePerfect: 0 };
        loadRepertoireList().forEach(rep => ['w', 'b'].forEach(side => {
            const db = readDBFor(rep, side);
            Object.keys(db).forEach(k => { if (db[k].attempts > 0 && _level(db[k]) === 'mastered') c.mastered++; });
        }));
        const marks = dataStore.getJSON('chessTrainer_openings', {}) || {};
        Object.values(marks).forEach(rep => Object.values(rep || {}).forEach(m => { if (m && m.r >= 1) c.ranks[1]++; if (m && m.r >= 2) c.ranks[2]++; }));
        const act = readActivity();
        if (typeof Habits !== 'undefined') c.streak = Habits.streak(act).n;
        c.tries = Object.values(act).reduce((n, d) => n + ((d && d.a) || 0), 0);
        if (typeof Daily !== 'undefined') c.daily = Daily.streak();
        const eg = dataStore.getJSON('chessTrainer_endgames', {}) || {}, won = id => (eg[id] && eg[id].wins > 0 ? 1 : 0);
        c.lucena = won('rook-lucena');
        c.philidor = won('rook-philidor');
        if (typeof ENDGAME_EXERCISES !== 'undefined') {
            c.egTotal = ENDGAME_EXERCISES.length;
            c.egDone = ENDGAME_EXERCISES.filter(e => won(e.id)).length;
        }
        c.stars = Object.values(eg).reduce((n, p) => n + ((p && p.stars) || 0), 0);
        const s = extra.summary;
        if (s && !['timed', 'survival', 'frame', 'daily'].includes(s.kind) && s.total >= 10 && s.ok === s.total) c.perfect = 1;
        if (s && s.kind === 'line' && s.total && s.ok === s.total && !s.early) c.linePerfect = 1;
        return c;
    }

    function list(extra, now = Date.now()) {
        const got = read(), c = context(extra);
        return LIST.map(m => {
            const [v, goal] = m.of(c), at = Number(got[m.id]) || 0;
            return { id: m.id, cat: m.cat, glyph: m.glyph, name: m.name, desc: m.desc, unit: m.unit || '', v: Math.min(v, goal), goal, at, fresh: at > 0 && now - at < FRESH_DAYS * 864e5 };
        });
    }

    function check(extra, now = Date.now()) {
        const got = read(), fresh = [];
        list(extra, now).forEach(m => { if (!m.at && m.v >= m.goal) { got[m.id] = now; fresh.push(Object.assign(m, { at: now, fresh: true })); } });
        if (fresh.length) dataStore.setJSON(KEY, got);
        return fresh;
    }

    // Prochaine médaille (chantier « Progrès : qualité et médailles », point 8) : parmi celles qui restent et qui se comptent
    // (but > 1, une unité), la plus avancée en part du but, à égalité celle qui demande le moins ; sinon la première qui reste.
    // left : ce qu'il manque ; words : [singulier, pluriel] de l'unité ; track : les médailles de la même piste (catégorie et unité), par but.
    function next(list) {
        const open = list.filter(m => !m.at), counted = open.filter(m => m.goal > 1 && m.unit);
        const pick = counted.slice().sort((a, b) => b.v / b.goal - a.v / a.goal || (a.goal - a.v) - (b.goal - b.v))[0] || open[0];
        if (!pick) return null;
        const track = pick.unit ? list.filter(m => m.cat === pick.cat && m.unit === pick.unit).sort((a, b) => a.goal - b.goal) : [pick];
        return { medal: pick, left: pick.goal - pick.v, words: UNITS[pick.unit] || null, track };
    }

    return { KEY, CATS, FRESH_DAYS, LIST, UNITS, context, list, check, next };
})();
