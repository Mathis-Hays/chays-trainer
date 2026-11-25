/**
 * domain/repertoire/openingMarks.js
 * ──────────────────────────────────────────────────────────────────────────
 * Ce que chaque ouverture du répertoire garde en plus de ses positions (atelier « L'envie de revenir », lot 4) :
 *   le rang (Apprenti, Compagnon, Maître), calculé depuis les positions travaillées du groupe, et l'idée de la ligne,
 *   une phrase écrite par le joueur (ou suggérée pour les ouvertures connues).
 * Une ouverture = un groupe de _assignOpenings (openingNames.js), clé « couleur|nom » (gKey).
 * Clé synchronisée chessTrainer_openings : { [répertoire]: { [couleur|nom]: { r?: 0 | 1 | 2, ra?: date, i?: idée, ia?: date } } }.
 * Entre deux appareils, champ par champ : le rang le plus récent (ra), l'idée la plus récente (ia) (syncModel, 'openings').
 *   statsOf(lignes)            { n, known (% sues, knownPct), weak (à apprendre), unsure } d'un groupe (lignes de _statsRows : e, lv).
 *   rankOf(stats, avant)       0 | 1 | 2 ; une ouverture ne redescend que d'un rang à la fois, sous un seuil plus bas.
 *   progress(stats, rang)      vers le rang suivant : { to, pct, need: [manquantes], conds: [{ id, label, now, ok }] }, null au rang Maître.
 *   update(rép, lignes, now)   recalcule et range les rangs ; renvoie les promotions [{ key, side, name, from, to }].
 *   rank(rép, clé)             rang rangé, ou null.
 *   idea(rép, côté, nom)       { text, own, from } : l'idée du joueur (celle de l'ouverture ou de sa famille), sinon une suggestion.
 *   setIdea(rép, clé, texte)   écrit (texte vide : efface) ; IDEA_MAX caractères.
 *   take / put / rename        suivent la corbeille et le renommage d'un répertoire.
 */

'use strict';

const OpeningMarks = (function () {
    const KEY = 'chessTrainer_openings', IDEA_MAX = 160;
    const RANKS = ['Apprenti', 'Compagnon', 'Maître'];
    // Promotion : il faut tout ; maintien (déjà au rang) : des seuils plus bas, pour qu'un oubli ne fasse pas tout redescendre.
    // Pas de nombre minimal de positions : les troncs communs forment souvent de petits groupes (une ou deux positions).
    // Audit « Ouvertures en images » (O16, 24 novembre 2026) : le rang suit la part des positions sues (knownPct, levels.js,
    // « À découvrir » compris), plus le score caché. Compagnon se garde tant que les positions à apprendre restent sous 40 %.
    const UP = { 1: { n: 1, known: 30, weak: .25 }, 2: { n: 1, known: 80, weak: 0, unsure: 0 } };
    const HOLD = { 1: { known: 0, weak: .4 }, 2: { known: 70, weak: .1 } };

    const read = () => { const o = dataStore.getJSON(KEY, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
    const save = all => dataStore.setJSON(KEY, all);
    const repOf = (all, rep) => (all[rep] && typeof all[rep] === 'object' ? all[rep] : null);

    // ─── RANGS ───────────────────────────────────────────────────────────────
    // known : part des positions sues (Solides et Maîtrisées) parmi les positions essayées, « À découvrir » compris (knownPct).
    // weak : positions à apprendre (à réapprendre : groupe À apprendre, levels.js).
    function statsOf(rows) {
        const n = rows.length;
        return {
            n, known: n ? Math.round(100 * rows.filter(r => r.lv === 'solid' || r.lv === 'mastered').length / n) : 0,
            weak: rows.filter(r => levelGroup(r.lv) === 'learn').length,
            unsure: rows.filter(r => r.lv === 'unsure').length
        };
    }

    const meets = (s, r) => { const u = UP[r]; return s.n >= u.n && s.known >= u.known && s.weak <= u.weak * s.n && (u.unsure === undefined || s.unsure <= u.unsure); };
    const holds = (s, r) => s.known >= HOLD[r].known && s.weak <= Math.max(r === 2 ? 1 : 0, HOLD[r].weak * s.n);

    function rankOf(s, prev = 0) {
        let r = meets(s, 2) ? 2 : meets(s, 1) ? 1 : 0;
        if (prev > r) r = holds(s, prev) ? prev : prev - 1;        // en douceur : un rang à la fois
        return r;
    }

    // Vers le rang suivant : chaque condition avec sa valeur du moment (liste à coches de la fiche, audit O16) ;
    // need garde les seules manquantes. pct : la part sue rapportée au seuil, plafonnée à 99 tant qu'il manque quelque chose.
    function progress(s, rank) {
        if (rank >= 2) return null;
        const u = UP[rank + 1], most = Math.floor(u.weak * s.n), conds = [];
        conds.push({ id: 'known', label: `Au moins ${u.known} % sues`, now: `${s.known} %`, ok: s.known >= u.known });
        conds.push({ id: 'weak', label: most > 1 ? `Au plus ${most} positions à apprendre` : most ? 'Au plus une position à apprendre' : 'Aucune position à apprendre',
                     now: `${s.weak} à apprendre`, ok: s.weak <= u.weak * s.n });
        if (u.unsure !== undefined) conds.push({ id: 'unsure', label: 'Toutes les positions découvertes', now: `${s.unsure} à découvrir`, ok: s.unsure <= u.unsure });
        const need = conds.filter(c => !c.ok).map(c => c.label), pct = Math.round(100 * Math.min(1, s.known / u.known));
        return { to: rank + 1, pct: need.length ? Math.min(99, pct) : 100, need, conds };
    }

    // lignes : celles de _statsRows (les deux couleurs ou une), groupées par _assignOpenings (gKey, gName, side).
    // Seuls les groupes nommés par un chemin comptent (pas « Autres positions »).
    function update(rep, rows, now = Date.now()) {
        const groups = new Map();
        rows.forEach(r => { if (r.gKey && r.gPath && r.gPath.length) { if (!groups.has(r.gKey)) groups.set(r.gKey, { side: r.side, name: r.gName, rows: [] }); groups.get(r.gKey).rows.push(r); } });
        const all = read(), mine = repOf(all, rep) || {}, promos = [];
        let changed = false;
        groups.forEach((g, key) => {
            const cur = mine[key] || {}, prev = Number.isInteger(cur.r) ? cur.r : null, r = rankOf(statsOf(g.rows), prev || 0);
            if (r === prev) return;
            if (prev !== null && r > prev) promos.push({ key, side: g.side, name: g.name, from: prev, to: r });
            mine[key] = Object.assign({}, cur, { r, ra: now });
            changed = true;
        });
        if (changed) { all[rep] = mine; save(all); }
        return promos;
    }

    function rank(rep, key) {
        const m = repOf(read(), rep), v = m && m[key];
        return v && Number.isInteger(v.r) ? v.r : null;
    }

    // ─── IDÉE DE LA LIGNE ────────────────────────────────────────────────────
    // Suggestions pour les ouvertures connues, du point de vue du camp qui les choisit.
    const SUGGEST = {
        'b|Sicilienne': 'Échanger le pion c contre le pion d, puis jouer sur la colonne c et à l’aile dame.',
        'b|Sicilienne Najdorf': '…a6 garde b5 et prépare …e5 ou …e6 ; le contre-jeu vient à l’aile dame avec …b5.',
        'b|Sicilienne Dragon': 'Fou en g7 sur la grande diagonale, tour sur la colonne c, puis …Cc4 ou …b5.',
        'w|Partie espagnole': 'Presser le cavalier c6 qui défend e5, puis bâtir le centre avec c3 et d4.',
        'w|Partie italienne': 'Fou c4 contre f7 et c3 pour préparer d4 : le centre d’abord, l’attaque ensuite.',
        'b|Française': 'Chaîne …e6-d5 : attaquer sa base d4 avec …c5, puis …Cc6 et …Db6.',
        'b|Caro-Kann': 'Sortir le fou c8 avant de jouer …e6, puis libérer le jeu par …c5 ou …e5.',
        'b|Gambit dame refusé': 'Tenir d5 avec …e6, se développer vite, puis libérer le jeu par …c5 ou …e5.',
        'w|Gambit dame': 'Mettre d5 sous pression avec c4 et Cc3, et se développer avant de reprendre c4.',
        'b|Slave': 'Tenir d5 avec …c6 en gardant le fou c8 libre de sortir en f5 ou g4.',
        'b|Semi-slave': '…c6 et …e6 tiennent d5 ; libérer le jeu par …dxc4 et …b5, ou par …e5.',
        'b|Est-indienne': 'Laisser le centre aux Blancs, puis le frapper par …e5 et attaquer au roi avec …f5.',
        'b|Nimzo-indienne': 'Clouer le cavalier c3 pour tenir e4, quitte à céder la paire de fous contre des pions doublés.',
        'b|Grünfeld': 'Laisser les Blancs bâtir le centre, puis le frapper : fou g7, …c5 et …Cc6 contre d4.',
        'b|Pirc': 'Fou en g7, laisser le centre aux Blancs, puis le contester par …e5 ou …c5.',
        'b|Scandinave': 'Prendre e4 tout de suite, ranger la dame en a5 ou d6, puis …c6 et le fou c8 dehors.',
        'b|Hollandaise': '…f5 tient e4 : jouer à l’aile roi et viser …e5 pour libérer le jeu.',
        'b|Défense Petrov': 'Attaquer e4 à son tour ; après Cxe5, chasser le cavalier par …d6 avant de prendre e4.',
        'b|Défense des deux cavaliers': 'Contre-attaquer e4 tout de suite ; contre Cg5, …d5 et le jeu actif compensent.',
        'b|Alekhine': 'Inviter les pions blancs à avancer, puis attaquer leur centre étiré par …d6.',
        'w|Partie écossaise': 'Ouvrir le centre par d4 dès le troisième coup et sortir les pièces vite.',
        'w|Partie viennoise': 'Cc3 garde e4 et prépare f4 : ouvrir la colonne f pour attaquer.',
        'w|Gambit du roi': 'Donner le pion f pour ouvrir la colonne f et prendre le centre par d4.',
        'w|Système de Londres': 'Fou f4 avant e3, triangle c3-d4-e3, puis Fd3, Cbd2 et Ce5.',
        'w|Anglaise': 'Tenir d5 de loin : Cc3, g3 et Fg2, puis avancer à l’aile dame avec b4.',
        'w|Catalane': 'Fou en g2 sur la grande diagonale, et regagner c4 sans se presser.'
    };
    SUGGEST['b|Défense est-indienne'] = SUGGEST['b|Est-indienne'];
    SUGGEST['b|Défense nimzo-indienne'] = SUGGEST['b|Nimzo-indienne'];
    SUGGEST['b|Défense Pirc'] = SUGGEST['b|Pirc'];
    SUGGEST['b|Défense sicilienne'] = SUGGEST['b|Sicilienne'];
    SUGGEST['b|Défense scandinave'] = SUGGEST['b|Scandinave'];
    SUGGEST['b|Défense slave'] = SUGGEST['b|Slave'];
    SUGGEST['w|Partie anglaise'] = SUGGEST['w|Anglaise'];
    SUGGEST['w|Ouverture catalane'] = SUGGEST['w|Catalane'];

    // Du plus précis au plus général : le nom entier, sa famille (avant « · »), puis la famille sans ses derniers mots.
    function lineage(name) {
        const out = [name], fam = String(name).split(' · ')[0];
        if (fam !== name) out.push(fam);
        const words = fam.split(' ');
        for (let i = words.length - 1; i > 0; i--) out.push(words.slice(0, i).join(' '));
        return out;
    }

    function idea(rep, side, name) {
        const m = repOf(read(), rep) || {};
        for (const n of lineage(name)) {
            const v = m[side + '|' + n];
            if (v && typeof v.i === 'string' && v.i) return { text: v.i, own: true, from: n === name ? null : n };
        }
        for (const n of lineage(name)) if (SUGGEST[side + '|' + n]) return { text: SUGGEST[side + '|' + n], own: false, from: n === name ? null : n };
        return null;
    }

    function setIdea(rep, key, text, now = Date.now()) {
        const v = String(text || '').replace(/\s+/g, ' ').trim().slice(0, IDEA_MAX), all = read(), mine = repOf(all, rep) || {};
        const cur = Object.assign({}, mine[key]);
        if (v) cur.i = v; else delete cur.i;
        if (v || cur.ia) cur.ia = now;
        if (!v && !Number.isInteger(cur.r)) delete mine[key]; else mine[key] = cur;
        all[rep] = mine;
        if (!Object.keys(mine).length) delete all[rep];
        save(all);
        return v;
    }

    // ─── RÉPERTOIRE SUPPRIMÉ, RESTAURÉ, RENOMMÉ ─────────────────────────────
    function take(rep) {
        const all = read(), out = repOf(all, rep);
        if (!out) return null;
        delete all[rep];
        save(all);
        return out;
    }
    function put(rep, marks) {
        if (!marks || typeof marks !== 'object' || !Object.keys(marks).length) return;
        const all = read();
        all[rep] = Object.assign({}, repOf(all, rep), marks);
        save(all);
    }
    const rename = (from, to) => put(to, take(from));

    return { KEY, IDEA_MAX, RANKS, UP, statsOf, rankOf, progress, update, rank, idea, setIdea, lineage, take, put, rename, _suggest: SUGGEST };
})();
