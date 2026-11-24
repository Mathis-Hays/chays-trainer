/**
 * shell/app.js
 * ──────────────────────────────────────────────────────────────────────────
 * Point d'entrée de l'application :
 *   - Initialisation au chargement
 *   - Navigation (accueil ↔ jeu, onglets)
 *   - Gestion du thème (dark / light)
 *   - Rendu de la liste des répertoires
 *   - Démarrage et retour à l'accueil
 */

'use strict';

// ─── THÈME ────────────────────────────────────────────────────────────────────

function loadTheme() { applyThemeMode(); }

// Bascule rapide (pilule de la barre du haut) : clair ↔ sombre, quitte le mode « Système ».
function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setThemeMode(dark ? 'light' : 'dark');
}

// ─── SAISIE DE TEXTE (remplace prompt()) ──────────────────────────────────────
// askText({ title, value?, placeholder?, ok?, validate?(texte) → message d'erreur | '' }, onOk(texte))

// ─── RAPPEL DE SAUVEGARDE (toast) ─────────────────────────────────────────────

function exportFromToast() { exportDB(); }          // exportDB() remet le compteur à zéro et ferme le toast

// Préférences reçues d'un autre appareil (synchro) : appSettings est déjà à jour (reloadSyncedPrefs),
// on redessine tout ce qui en dépend.
function applySyncedPrefs() {
    applyBoardTheme();
    applyDisplayPrefs();
    applyPieceSet();
    refreshPieces();
    initTraining();
    initEndgame();
    renderHomeSummary();
    if (typeof refreshNotation === 'function') refreshNotation();
    if (typeof renderAnnotations === 'function') renderAnnotations();
    if (typeof SettingsPanel !== 'undefined' && SettingsPanel.isOpen()) SettingsPanel.refresh();
    if (typeof AccountUI !== 'undefined' && AccountUI.refresh) AccountUI.refresh();
    // Déconnexion demandée depuis un autre appareil (Compte › Synchronisation).
    if (isThisDeviceRevoked() && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
        Auth.signOut();
        touchDevice(true);                 // demande levée localement : une reconnexion ne redéclenchera pas la déconnexion
        if (typeof AccountUI !== 'undefined') AccountUI.notify('Cet appareil a été déconnecté depuis un autre appareil. Vos données restent ici.');
    }
}

// ─── NAVIGATION : ONGLETS D'ACCUEIL ──────────────────────────────────────────

// Onglets de l'accueil (refonte « Chays sans détour », lot 3 : Ouvertures ; Entraînement hors de la barre).
const HOME_TABS = ['play', 'openings', 'endgame', 'stats', 'training'];

function switchHomeTab(tab) {
    // En partie (onglets compacts de la barre du haut, menu « Plus » sur téléphone) : retour à l'accueil sur cet onglet.
    const gs = document.getElementById('game-screen');
    if (gs && !gs.classList.contains('hidden')) { goHome(tab); return; }
    closeRepMenu(); closeAddMenu();
    if (tab !== 'stats') closeStatsWeak();
    const shown = document.querySelector('.home-tab:not(.hidden)');
    HOME_TABS.forEach(t => {
        const tabEl = document.getElementById('home-tab-' + t);
        const navEl = document.getElementById('nav-tab-' + t);
        if (tabEl) tabEl.classList.toggle('hidden', t !== tab);
        if (navEl) navEl.classList.toggle('active', t === tab);
    });
    // Lot 7 « Chays épuré » : un autre onglet s'ouvre en haut (la page est une seule colonne qui défile : sans cela,
    // Ouvertures ou Finales s'ouvraient au milieu de leur liste). Un retour qui garde sa place (aperçu → Progrès)
    // la remet lui-même ensuite.
    if (shown && shown.id !== 'home-tab-' + tab) window.scrollTo(0, 0);
    if (tab === 'stats')    initStats();
    if (tab === 'openings') OpeningsTab.init();
    if (tab === 'training') initTraining();
    if (tab === 'endgame')  initEndgame();
    _enterHomeTab(document.getElementById('home-tab-' + tab), shown);       // après le rendu : jamais de page vide
    if (typeof Dock !== 'undefined') Dock.refresh();     // centre du dock : l'action de la page (téléphone)
}

// Changement d'onglet (identité « Noyer gravé ») : seul le contenu arrive, fondu et montée de 8 px en --dur-2 ;
// les barres ne bougent pas. Rien au premier affichage, sur le même onglet ou en animations réduites. Lot 7
// « Chays épuré » : lancé une fois le contenu dessiné, et depuis une opacité de 0,4 : la page n'est jamais vide.
function _enterHomeTab(el, previous) {
    if (!el || !previous || previous === el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
    el.animate([{ opacity: 0.4, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
               { duration: 220, easing: 'cubic-bezier(.16, 1, .3, 1)' });
}

// ─── RÉPERTOIRES : AFFICHAGE ET SÉLECTION ────────────────────────────────────

const HP_QUICK_MAX = 6;          // pastilles d'autres répertoires dans la barre de Jouer ; les suivants restent dans la liste de la puce

function renderRepertoireList() {
    const html = RepPicker.html('selectRepertoire');      // puce et liste avec recherche (repPicker.js)
    document.querySelectorAll('.repertoire-list').forEach(c => { c.innerHTML = html; });
    // Barre de Jouer : les autres répertoires en pastilles d'initiales (un clic le choisit) ; « Nouveau répertoire » est dans « + Ajouter ».
    const quick = document.getElementById('hp-quick');
    if (quick) quick.innerHTML = loadRepertoireList().filter(n => n !== currentRepertoire).slice(0, HP_QUICK_MAX).map(n =>
        `<button type="button" class="hp-q" data-action="selectRepertoire" data-arg="${escapeHtml(n)}" title="${escapeHtml(n)}" aria-label="Répertoire ${escapeHtml(n)}">${escapeHtml((n.trim()[0] || '?').toUpperCase())}</button>`).join('');
    renderResumeCard();
    renderHomeSummary();
}

// Image d'une couleur (audit « Aujourd’hui en images », novembre 2026) : les ouvertures du jour dans cette couleur, en
// éventail (trois au plus, la plus fournie au milieu) ; aucune due : la première réponse du répertoire (la plus courte,
// puis la plus travaillée), après mon coup ; répertoire vide : la position de départ, de mon côté.
function _homeArtHTML(entries, color, dueRows = []) {
    const groups = dueRows.length ? _homePlan(dueRows).filter(g => g.path && g.path.length).slice(0, 3) : [];
    if (groups.length) {
        const order = groups.length === 3 ? [groups[1], groups[0], groups[2]] : groups;
        // Décoratif : les noms sont dans les puces d'ouverture du jour.
        return `<span class="hp-fan is-${order.length}" aria-hidden="true">${order.map(g =>
            _miniBoardHTML({ side: color, path: g.path, k: INIT_FEN }, true, { label: g.name })).join('')}</span>`;
    }
    const e = entries.filter(x => Array.isArray(x.path) && x.path.length).sort((a, b) => a.path.length - b.path.length || b.attempts - a.attempts)[0];
    return _miniBoardHTML({ side: color, path: e ? e.path : [], k: INIT_FEN }, true);
}

// ─── ACCUEIL : AUJOURD'HUI, JOUER ─────────────────────────────────────────────
// « Aujourd'hui » n'a qu'une action : « Commencer » lance la première étape du plan du jour (_homeSteps) ; tout est
// fait → une nouvelle ligne dans la couleur la moins fournie ; répertoire vide → choisir une couleur. L'objectif du
// jour (anneau) et la série accompagnent l'action qui les fait avancer.

// Positions du répertoire actif groupées par ouverture nommée (même regroupement que les Statistiques).
function _homePlan(list) {
    const rows = list.map(x => ({ side: x.color, k: x.key, e: x.e, path: x.e.path && x.e.path.length ? x.e.path : null }));
    return groupByOpening(rows).sort((a, b) => b.n - a.n);
}

// Règle de cases de l'objectif du jour (positions jouées aujourd'hui, tous répertoires ; audit « Aujourd’hui en images ») :
// une case par position du plafond (15, 30 ou 60), pleine une fois jouée ; visible dès le matin, même forme toute la
// journée, à la place de l'anneau (Ring reste dans Progrès et l'Entraînement). Le libellé « 12 / 30 » est écrit.
function _homeCasesHTML(done, goal) {
    const n = Math.min(done, goal);
    return `<div class="hp-cases${n >= goal ? ' is-done' : ''}" role="img" aria-label="Objectif du jour : ${n} sur ${goal} positions">`
        + `<span class="hp-cases-row" aria-hidden="true">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(goal - n)}</span>`
        + `<span class="hp-cases-n" aria-hidden="true">${n} / ${goal}</span></div>`;
}

// Puces des ouvertures du jour : mini-échiquier de 22 px, nom, nombre (trois au plus, les plus fournies).
function _homeOpsHTML(due) {
    const groups = _homePlan(due).slice(0, 3);
    if (!groups.length) return '';
    return `<ul class="hp-ops" aria-label="Ouvertures du jour">${groups.map(g => `<li class="hp-op" title="${escapeHtml(g.name)}">`
        + (g.path && g.path.length ? _miniBoardHTML({ side: g.side, path: g.path, k: INIT_FEN }, true, { label: g.name }) : '')
        + `<span class="hp-op-name">${g.html}</span><b>${g.n}</b></li>`).join('')}</ul>`;
}

// Joker de la série (Habits.streak) : une pastille laiton au bout du ruban, pleine tant que celui de la semaine est libre.
function _homeJokerHTML(st) {
    const tip = st.jokerFree ? 'Joker de la semaine libre : un jour manqué ne casse pas la série.' : 'Joker de la semaine utilisé : le prochain arrive lundi.';
    return `<span class="hp-joker${st.jokerFree ? '' : ' is-used'}" title="${escapeHtml(tip)}" role="img" aria-label="${escapeHtml(tip)}"></span>`;
}

// Case d'un jour du ruban (Habits.week) : pleine et cochée (fait), laiton (joker), vide (manqué), cerclée (aujourd'hui
// à faire), en pointillés (à venir : la règle des pointillés, emplacement à remplir).
const HP_DAY_STATE = { done: 'fait', joker: 'joker', missed: 'manqué', today: 'à faire', future: 'à venir' };
const _hpDayTip = (t, state) => I18n.pair(_hpDayName(t), I18n.t(HP_DAY_STATE[state]));
const _hpDayLetter = t => new Date(t).toLocaleDateString(I18n.locale(), { weekday: 'narrow' });
const _hpDayName = t => new Date(t).toLocaleDateString(I18n.locale(), { weekday: 'long' });

// Ruban de la semaine (lundi → dimanche) dans le surtitre : série, joker et jours à venir d'un coup d'œil.
function _homeWeekHTML(act, now, st) {
    const days = Habits.week(act, now), done = days.filter(d => d.state === 'done').length, past = days.filter(d => d.state !== 'future').length;
    const label = I18n.pair(I18n.t('Jours actifs cette semaine'), `${done} / ${past}`);
    return `<span class="hp-week" role="img" aria-label="${escapeHtml(label)}">${days.map(d =>
        `<span class="hp-wk is-${d.state}" title="${escapeHtml(_hpDayTip(d.t, d.state))}"><i></i><span>${escapeHtml(I18n.mark(_hpDayLetter(d.t)))}</span></span>`).join('')}</span>`;
}

// Journée faite ou à jour : le ruban prolongé, les six jours passés puis la prévision des 7 prochains (aujourd'hui
// compris, programme du répertoire, reviewPlan) avec le nombre de révisions au-dessus de chaque case.
function _homeForecastHTML(fc, now, act = {}) {
    const d0 = new Date(now), at = i => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime();
    const played = t => { const d = act[dayStamp(t)]; return !!d && ((d.a || 0) > 0 || (d.p || 0) > 0); };
    const past = [-6, -5, -4, -3, -2, -1].map(i => { const t = at(i), on = played(t);
        return `<li class="hp-wk is-${on ? 'done' : 'missed'}" aria-label="${escapeHtml(_hpDayTip(t, on ? 'done' : 'missed'))}"><b></b><i></i><span aria-hidden="true">${escapeHtml(I18n.mark(_hpDayLetter(t)))}</span></li>`; }).join('');
    const day = i => i === 0 ? 'auj.' : new Date(at(i)).toLocaleDateString(I18n.locale(), { weekday: 'short' });
    return `<div class="hp-plan hp-fc-wrap"><div class="hp-h"><h3>Deux semaines</h3><span class="hp-n">${fc.reduce((a, b) => a + b, 0)}</span></div>
        <div class="hp-span"><ol class="hp-past" aria-label="Six derniers jours">${past}</ol>
        <ol class="hp-fc" aria-label="Révisions prévues sur les 7 prochains jours">${fc.map((v, i) =>
            `<li class="hp-wk is-${i === 0 ? (played(now) ? 'done' : 'today') : 'future'}" aria-label="${escapeHtml(day(i))} : ${v} ${v > 1 ? 'positions' : 'position'}"><b class="hp-fc-n">${v}</b>`
            + `<i></i><span aria-hidden="true">${escapeHtml(I18n.mark(_hpDayLetter(at(i))))}</span></li>`).join('')}</ol></div></div>`;
}

// Rythme du jour (objectif quotidien dailyGoal, chantier « Révision du jour ») : Léger, Normal, Soutenu, réglé sur place.
const HOME_PACES = [[15, 'Léger'], [30, 'Normal'], [60, 'Soutenu']];
function _homePaceHTML(goal) {
    return `<div class="hp-pace" role="radiogroup" aria-label="Rythme du jour">${HOME_PACES.map(([n, label]) => {
        const m = Math.max(1, Math.round(n * TRAIN_SECONDS_PER_POSITION / 60));
        return `<button type="button" role="radio" class="hp-pace-opt${n === goal ? ' is-on' : ''}" aria-checked="${n === goal}" data-action="homePace" data-arg="${n}">`
            + `<b>${label}</b><small>${n} · ${m} min</small></button>`;
    }).join('')}</div>`;
}
let _homePaceOpen = false;                        // rythme du jour replié : la durée l'ouvre
registerActions({
    homePace: n => { if (typeof setPref === 'function') setPref('dailyGoal', Number(n)); },
    homePaceShow: () => { _homePaceOpen = !_homePaceOpen; renderHomeSummary(); },
});


function renderHomeSummary() {
    if (typeof Suite !== 'undefined') Suite.refresh();
    const host = document.getElementById('hp-today');
    if (!host) return;
    const now = Date.now(), pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    repairPaths(currentRepertoire);                             // chemins manquants retrouvés (storage.js), une fois
    const rows = repertoireRows();
    const rp = reviewPlan(currentRepertoire, now);              // programme des révisions (storage.js)
    const side = c => rows.filter(r => r.color === c), due = rows.filter(r => rp.today(r.color, r.key));
    document.getElementById('hp-grid').classList.toggle('is-empty', !rows.length);
    ['hp-play', 'hp-news'].forEach(id => document.getElementById(id).classList.add('edge-card'));   // bord à bord sur téléphone

    // Jouer : position, chiffres et maîtrise par couleur.
    document.getElementById('hp-play-n').textContent = pl(rows.length, 'position', 'positions');
    const note = repertoireNote(currentRepertoire), desc = document.getElementById('hp-play-desc');
    desc.hidden = !note;
    desc.textContent = note;
    ['w', 'b'].forEach(c => {
        const list = side(c), dueC = list.filter(r => rp.today(r.color, r.key)), d = dueC.length, counts = {};
        document.getElementById('home-meta-' + c).textContent = !list.length ? 'Aucune position'
            : pl(list.length, 'position', 'positions') + ' · ' + (d ? `${d} à réviser` : 'à jour');
        patchHTML(document.getElementById('home-art-' + c), _homeArtHTML(list.map(r => r.e), c, dueC));
        STATS_LEVEL_ORDER.forEach(l => { counts[l] = 0; });
        list.filter(r => r.e.attempts > 0).forEach(r => { counts[_level(r.e)]++; });
        // Barre posée sur une plaque claire, légendée (mêmes couleurs sur les deux cartes, lue par les lecteurs d'écran).
        patchHTML(document.getElementById('home-bar-' + c), STATS_MASTERY_LEVELS.some(l => counts[l]) ? levelBarHTML(counts, 'hp-bar', { legend: true }) : '');
    });

    // Surtitre : salutation · série (avec son joker, Habits.streak) ; « Bon retour » le jour d'une reprise (Habits.comeback).
    // Le plafond du jour (reviewPlan, objectif du jour) fait le reste : la reprise n'a plus sa propre part.
    const h = new Date().getHours(), name = appSettings.pseudo.trim();
    const act = readActivity(), st = Habits.streak(act, now), today = (act[dayStamp(now)] || { a: 0 }).a, goal = rp.goal;
    const cb = Habits.comeback(act, now);
    const held = rp.held(), cu = held ? rp.catchUp() : null, when = cu ? catchUpLabel(cu, now) : '';
    const evening = h >= 18 || h < 5, word = cb && cb.first ? 'Bon retour' : evening ? 'Bonsoir' : 'Bonjour';
    const hello = name ? `${word}, ${name}` : word;
    // Le ruban de la semaine reste visible même sans série (pas de reproche, les jours à venir en pointillés).
    const head = `<div class="hp-over"><span class="hp-hello">${escapeHtml(hello)}</span><span class="hp-streak-row">${_homeWeekHTML(act, now, st)}`
        + `${st.n ? `<span class="hp-streak">${pl(st.n, 'jour', 'jours')} d'affilée</span>` : ''}${_homeJokerHTML(st)}</span></div>`;

    // Répertoire vide : par quelle couleur commencer (une carte choisie, une seule action pleine).
    if (!rows.length) {
        const pick = c => `<button type="button" class="hp-pick is-${c}" data-action="homePick" data-arg="${c}" aria-pressed="${c === 'w'}">
            ${_miniBoardHTML({ side: c, path: [], k: INIT_FEN }, true, { label: c === 'w' ? 'Blancs' : 'Noirs' })}
            <span><b>${c === 'w' ? 'Blancs' : 'Noirs'}</b><small>${c === 'w' ? '1. ?' : 'contre 1. e4, 1. d4…'}</small></span></button>`;
        patchHTML(host, `<div class="hp-start edge-card">${head}<h2 class="hp-title">Par quelle couleur commencer&nbsp;?</h2>
            <div class="hp-picks">${pick('w')}${pick('b')}</div>
            <div class="hp-ctas"><button type="button" class="btn btn-primary hp-cta" id="hp-start-cta" data-action="homeAddLine" data-arg="w">${ico('play')}<span>Commencer avec les Blancs</span></button></div>
            <div class="hp-alts"><button type="button" class="hp-link" data-action="homeImportPgn">${ico('upload')}Importer un PGN</button>
            <button type="button" class="hp-link" data-action="homeGames">${ico('flame')}Partir de mes parties</button></div></div>`);
        HomePanels.render();
        return;
    }

    const link = (!due.length && held ? `<button type="button" class="hp-link" data-action="trainingMore">${ico('plus')}Encore ${Math.min(rp.goal, held)}</button>` : '')
        + `<button type="button" class="hp-link" data-action="homeExercises">Autres exercices ${ico('chevron-right')}</button>`;
    let title, sub, cta, plan = '', ops = '';
    const steps = _homeSteps(due, rp, now, { held, when }), next = steps.find(x => !x.done);
    _homeStepsNow = steps;
    if (!due.length && held) {
        // Objectif du jour atteint : le reste attend les jours suivants ; « Encore N » est proposé, jamais imposé.
        title = `Objectif du jour <em>atteint</em>.`;
        sub = `${pl(held, 'révision attend', 'révisions attendent')} les jours suivants`;
        plan = _homeForecastHTML(rp.forecast(null, 7), now, act);
    } else if (due.length) {
        // Un nombre, une durée (qui ouvre le rythme du jour), puis les ouvertures concernées.
        const minutes = Math.max(1, Math.round(due.length * TRAIN_SECONDS_PER_POSITION / 60));
        title = `<em>${due.length}</em> ${due.length > 1 ? 'positions' : 'position'}<br>${held && cb && cb.first ? 'pour reprendre la main' : held ? 'pour aujourd’hui' : 'à réviser'}`;
        sub = `<button type="button" class="hp-pace-btn" data-action="homePaceShow" aria-expanded="${_homePaceOpen}">Environ ${minutes} min${ico('chevron-down')}</button>`;
        ops = _homeOpsHTML(due);
    } else {
        const nextAt = rp.next();
        title = `Révisions <em>à jour</em>.`;
        sub = (Number.isFinite(nextAt) ? `Prochaine révision <b>${dueInLabel(nextAt, true)}</b>` : 'Aucune révision prévue') + (today >= goal ? ' · objectif atteint' : '');
        plan = _homeForecastHTML(rp.forecast(null, 7), now, act);
    }
    if (next) {
        // Une seule action : la première étape qui reste ; chaque ligne lance aussi la sienne.
        cta = `<button type="button" class="btn btn-primary hp-cta" data-action="homeGo" data-arg="${next.id}">${ico('play')}<span>Commencer</span></button>${link}`;
    } else {
        // Tout est fait : une nouvelle ligne dans la couleur la moins fournie.
        const c = side('w').length <= side('b').length ? 'w' : 'b';
        cta = `<button type="button" class="btn btn-primary hp-cta" data-action="homeAddLine" data-arg="${c}">${ico('plus')}Ajouter une ligne aux ${c === 'w' ? 'Blancs' : 'Noirs'}</button>${link}`;
    }
    // Lot 1 « Chays épuré » : un seul nombre (le titre) ; l'anneau n'apparaît qu'une fois la journée entamée, le rythme
    // sur demande, le retard reste dans Progrès. Sous l'action : ce qui s'ajoute aux révisions (défi, erreurs, parties, finale).
    const pace = (due.length || held) && _homePaceOpen ? _homePaceHTML(goal) : '';
    // Bloc réécrit seulement si son HTML change (patchHTML) : un redessin à l'identique (parties relues, synchro,
    // pseudo du compte) ne détruit plus la ligne survolée.
    // Règle de cases : dès qu'il y a un objectif à suivre (positions dues, objectif atteint, ou journée entamée).
    const strip = due.length || held || today > 0 ? _homeCasesHTML(today, goal) : '';
    patchHTML(host, `<div class="hp-day edge-card${next ? '' : ' is-done'}">${head}
        <div class="hp-head"><div><h2 class="hp-title">${title}</h2><p class="hp-sub">${sub}</p></div></div>
        ${pace}${ops}${strip}<div class="hp-ctas">${cta}</div>${_homeStepsHTML(steps.filter(x => x.id !== 'due'), _homeDailyHTML(rows, now))}${plan}</div>`);
    HomePanels.render();                         // À traiter : nouveautés des parties, dernières parties
    if (typeof Dock !== 'undefined') Dock.refresh();   // le centre du dock reprend « Commencer », maintenant dessiné
}

// ─── PLAN DU JOUR (refonte « Chays sans détour », lot 2) ──────────────────────
// Les étapes du jour, dans l'ordre où « Commencer » les prend : erreurs de la dernière séance, révisions dues
// (Révision du jour : « À revoir » et « Traitée depuis » en tête), réponses à donner après vos parties, une finale.
// Une étape faite reste affichée, cochée (révisions à jour, finale réussie aujourd'hui) ; une étape sans objet disparaît.
let _homeStepsNow = [];

// late : { held, when } : révisions qui attendent au-delà de l'objectif du jour et date « à jour vers… ».
function _homeSteps(due, rp, now, late = {}) {
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`, out = [];
    const s = trainingState.lastSummary, miss = s && s.kind !== 'timed' ? s.rows.filter(r => !r.ok).length : 0;
    if (miss) out.push({ id: 'retry', icon: 'rotate-ccw', tone: 'err', title: 'Erreurs de la séance', sub: 'À revoir tant qu’elles sont fraîches', n: miss });
    const wait = late.held ? `${late.held} en attente${late.when ? ` · à jour vers ${escapeHtml(late.when)}` : ''}` : '';
    if (!due.length && late.held) {
        out.push({ id: 'due', icon: 'book', title: 'Révisions', sub: `Objectif du jour atteint · <span>${wait}</span>`, html: true, done: true });
    } else if (due.length) {
        const names = _homePlan(due).slice(0, 3).map(g => `<span>${g.html}</span>`).join(', ');
        const back = due.filter(r => Number.isInteger(r.e.relearn) || r.e.prio).length;
        out.push({ id: 'due', icon: 'book', title: 'Révisions', sub: names + (back ? ` · <span>dont ${back} à revoir</span>` : '') + (wait ? ` · <span>${wait}</span>` : ''), n: due.length, html: true });
    } else {
        const at = rp.next();
        out.push({ id: 'due', icon: 'book', title: 'Révisions', sub: Number.isFinite(at) ? `À jour · <span>Prochaine révision ${dueInLabel(at, true)}</span>` : 'À jour', html: true, done: true });
    }
    const news = HomePanels.novelties().length;
    if (news) out.push({ id: 'news', icon: 'swords', title: 'Après vos parties', sub: news > 1 ? 'Des réponses à trouver' : 'Une réponse à trouver', n: news });
    if (typeof readEndgameProgress === 'function' && typeof _egNext === 'function') {
        const prog = readEndgameProgress(), start = new Date(now).setHours(0, 0, 0, 0);
        const won = ENDGAME_EXERCISES.find(e => prog[e.id] && prog[e.id].wins > 0 && prog[e.id].last >= start);
        const ex = _egNext(prog);
        if (won) out.push({ id: 'endgame', icon: 'finish-flag', tone: 'brass', title: 'Une finale', sub: `<span>${escapeHtml(won.title)}</span> · <span>faite aujourd’hui</span>`, html: true, done: true });
        else if (ex) out.push({ id: 'endgame', icon: 'finish-flag', tone: 'brass', title: 'Une finale', sub: ex.title, n: 1, arg: ex.id });
    }
    return out;
}

// ─── DÉFI DU JOUR (atelier « L'envie de revenir », lot 3, Daily) ───────────────
// Une position du répertoire, la même toute la journée, avant le plan du jour. Faite : son résultat, plus d'action.
function _homeDailyHTML(rows, now) {
    if (typeof Daily === 'undefined') return '';
    const done = Daily.today(now), streak = Daily.streak(undefined, now);
    const r = done ? rows.find(x => x.key === done.k && x.color === done.c) : Daily.pick(rows, dayStamp(now), currentRepertoire);
    if (!r) return '';
    const path = r.e.path && r.e.path.length ? r.e.path : null, op = path ? openingNameOf(path) : null;
    const who = r.color === 'w' ? 'Blancs' : 'Noirs';
    // La couleur en pastille (le texte la nomme aussi) : le nom de l'ouverture tient sur téléphone.
    const info = `<span class="hp-dot is-${r.color}" aria-hidden="true"></span>${who} · ${op ? escapeHtml(op.name) : 'position du répertoire'}`
        + (streak ? ` · <span class="hp-daily-streak">${streak} jour${streak > 1 ? 's' : ''} d’affilée</span>` : '');
    const st = !done ? `<span class="hp-step-end"><span class="count is-brass">À relever</span>${ico('chevron-right')}</span>`
        : `<span class="count is-muted">${done.r ? 'Réussi' : 'Un nouveau demain'}</span>`;
    return `<li><button type="button" class="hp-step hp-daily${done ? ' is-done' : ''}" data-action="homeDaily" data-arg="${escapeHtml(r.color + ':' + r.key)}"${done ? ' aria-disabled="true"' : ''}>
        <span class="hp-step-ico is-brass">${ico(done && done.r ? 'check' : 'lightbulb')}</span>
        <span class="hp-step-txt"><b>Défi du jour</b><small>${info}</small></span>${st}</button></li>`;
}

// Lignes sous « Commencer » : le défi du jour (daily, déjà en <li>) puis les étapes autres que les révisions.
function _homeStepsHTML(steps, daily = '') {
    if (!steps.length && !daily) return '';
    return `<ol class="hp-steps" aria-label="Aussi aujourd’hui">${daily}${steps.map(x => `<li><button type="button" class="hp-step${x.done ? ' is-done' : ''}" data-action="homeStep" data-arg="${x.id}"${x.done ? ' aria-disabled="true"' : ''}>
        <span class="hp-step-ico${x.tone ? ' is-' + x.tone : ''}">${ico(x.done ? 'check' : x.icon)}</span>
        <span class="hp-step-txt"><b>${x.title}</b><small>${x.html ? x.sub : escapeHtml(x.sub)}</small></span>
        ${x.done ? '' : `<span class="hp-step-end"><span class="count">${x.n}</span>${ico('chevron-right')}</span>`}</button></li>`).join('')}</ol>`;
}

// Lance une étape du plan : ce que faisaient la capsule Suite, l'onglet Entraînement et les Finales.
function homeRunStep(id) {
    const x = _homeStepsNow.find(s => s.id === id);
    if (!x || x.done) return;
    if (id === 'retry') UI_ACTIONS.trainingRetry(null, null);
    else if (id === 'due') startDailyReview();
    else if (id === 'news') {
        const answer = document.querySelector('#hp-news .hp-answer');
        if (answer) answer.click();
        else { const box = document.getElementById('hp-news'); if (box) box.scrollIntoView({ block: 'start' }); }
    } else if (id === 'endgame') startEndgame(x.arg);
}

// Répertoire vide : la carte choisie donne sa couleur à l'unique action.
function _homePick(c) {
    document.querySelectorAll('#hp-today .hp-pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === c)));
    const cta = document.getElementById('hp-start-cta');
    if (!cta) return;
    cta.dataset.arg = c;
    cta.querySelector('span').textContent = 'Commencer avec les ' + (c === 'w' ? 'Blancs' : 'Noirs');
    if (typeof Dock !== 'undefined') Dock.refresh();
}
registerActions({ homePick: _homePick });

// iOS n'applique :active au toucher qu'en présence d'un écouteur touchstart (retour d'appui, css/feedback.css).
document.addEventListener('touchstart', () => {}, { passive: true });

// Suppression protégée : « Général » est intouchable, confirmation, puis corbeille (30 jours).
function deleteRepertoirePrompt(name) {
    if (name === DEFAULT_REPERTOIRE) { alert('Le répertoire par défaut ne peut pas être supprimé.'); return; }
    const nW = Object.keys(readDBFor(name, 'w')).length;
    const nB = Object.keys(readDBFor(name, 'b')).length;
    askConfirm(`Supprimer le répertoire « ${name} » (${nW} coup(s) Blancs, ${nB} coup(s) Noirs) ? Il sera placé dans la corbeille et restera restaurable pendant 30 jours.`, () => {
        if (!deleteRepertoire(name)) return;
        if (currentRepertoire === name) selectRepertoire(DEFAULT_REPERTOIRE);
        else { renderRepertoireList(); initStats(); initTraining(); }
    });
}

// Description du répertoire actif (menu ⋮, ou toucher la description sous « Jouer ») ; vide = effacée.
function editRepertoireNote() {
    const name = currentRepertoire;
    askText({ title: `Description de « ${name} »`, value: repertoireNote(name), placeholder: 'ex : Najdorf avec les Noirs, Italienne avec les Blancs',
              ok: 'Enregistrer', allowEmpty: true, max: REP_NOTE_MAX }, v => {
        setRepertoireNote(name, v);
        renderRepertoireList();
    });
}
registerActions({ editRepNote: editRepertoireNote });

// ─── MENU « ⋮ » DES RÉPERTOIRES (accueil, onglet Jouer) ──────────────────────
// Regroupe : nouveau répertoire, suppression du répertoire actif, accès à la Corbeille.

function renderRepMenu() {
    const isDefault = currentRepertoire === DEFAULT_REPERTOIRE;
    document.getElementById('rep-menu-del-label').textContent =
        isDefault ? 'Supprimer (« Général » est protégé)' : `Supprimer « ${currentRepertoire} »`;
    document.getElementById('rep-menu-del').disabled = isDefault;
    document.getElementById('rep-menu-rename-label').textContent =
        isDefault ? 'Renommer (« Général » est protégé)' : `Renommer « ${currentRepertoire} »`;
    document.getElementById('rep-menu-rename').disabled = isDefault;
    document.getElementById('rep-menu-note-label').textContent =
        repertoireNote(currentRepertoire) ? 'Modifier la description' : 'Ajouter une description';
    updateTrashBadges();                                  // compteur de la Corbeille
}

function closeRepMenu() {
    const m = document.getElementById('rep-menu'), b = document.getElementById('rep-menu-btn');
    if (m) m.classList.add('hidden');
    if (b) b.setAttribute('aria-expanded', 'false');
}

function toggleRepMenu() {
    const m = document.getElementById('rep-menu'), b = document.getElementById('rep-menu-btn');
    if (!m.classList.contains('hidden')) { closeRepMenu(); return; }
    closeAddMenu();
    renderRepMenu();
    m.classList.remove('hidden');
    b.setAttribute('aria-expanded', 'true');
}

function repMenuAction(action) {
    closeRepMenu();
    if (action === 'new')         createRepertoirePrompt();
    else if (action === 'rename') renameRepertoirePrompt(currentRepertoire);
    else if (action === 'note')   editRepertoireNote();
    else if (action === 'delete') deleteRepertoirePrompt(currentRepertoire);   // confirmation + protection de « Général »
    else if (action === 'trash')  showTrash();
    else if (action === 'data')   showData();
}

// « + Ajouter » (bilan « Chays épuré », lot 2) : ce qui fait entrer des coups ou un répertoire, à la place des
// icônes muettes de la barre (flamme, flèche, puce) ; le ⋮ ne garde que ce qui touche le répertoire affiché.
function closeAddMenu() {
    const m = document.getElementById('add-menu'), b = document.getElementById('add-menu-btn');
    if (m) m.classList.add('hidden');
    if (b) b.setAttribute('aria-expanded', 'false');
}

function toggleAddMenu() {
    const m = document.getElementById('add-menu'), b = document.getElementById('add-menu-btn');
    if (!m.classList.contains('hidden')) { closeAddMenu(); return; }
    closeRepMenu();
    m.classList.remove('hidden');
    b.setAttribute('aria-expanded', 'true');
}

function addMenuAction(action) {
    closeAddMenu();
    if (action === 'games')    UI_ACTIONS.homeGames();
    else if (action === 'pgn') UI_ACTIONS.homeImportPgn();
    else if (action === 'new') createRepertoirePrompt();
}

(function initRepMenuDismiss() {
    document.addEventListener('pointerdown', e => {
        if (!e.target.closest('#rep-menu, #rep-menu-btn')) closeRepMenu();
        if (!e.target.closest('#add-menu, #add-menu-btn')) closeAddMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeRepMenu(); closeAddMenu(); } });
})();

function selectRepertoire(name) {
    currentRepertoire = name;
    renderRepertoireList();
    renderGameRep();
    initStats();
    initTraining();
}

// ─── DÉMARRAGE D'UNE PARTIE ───────────────────────────────────────────────────

// data-modes : visible seulement dans ces modes ; data-modes-not : caché dans ces modes.
function applyModeUI() {
    document.querySelectorAll('[data-modes]').forEach(el => {
        el.style.display = el.dataset.modes.split(',').includes(gameMode) ? '' : 'none';
    });
    document.querySelectorAll('[data-modes-not]').forEach(el => {
        el.style.display = el.dataset.modesNot.split(',').includes(gameMode) ? 'none' : '';
    });
    const gs = document.getElementById('game-screen');
    if (gs) gs.dataset.mode = gameMode;                            // la mise en page sur téléphone en dépend (style.css)
    if (typeof _applySideTab === 'function') _applySideTab();     // l'arbre n'est disponible qu'en mode Jouer
    if (document.getElementById('topnav-tabs-setup').classList.contains('in-game')) _gameTabs(true);     // onglet du mode
    if (typeof Suite !== 'undefined') Suite.refresh();
    if (typeof TrainFocus !== 'undefined') TrainFocus.sync();     // mode Focus : seulement pendant une séance
}

// Affiche l'écran de jeu (commun aux modes jouer / aperçu / entraînement).
function showGameScreen(color) {
    boardFlipped = appSettings.autoFlip && color === 'b';      // Paramètres › Jeu : orienter selon ma couleur

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('setup-screen').classList.add('hidden');
    _gameTabs(true);
    document.getElementById('topnav-tabs-game').style.display  = '';

    const gs = document.getElementById('game-screen');
    gs.style.display = 'flex';
    gs.classList.remove('hidden');
    window.scrollTo({ top: 0 });                         // l'échiquier en haut, quel que soit le défilement de l'écran quitté

    if (typeof _renderSessionBar === 'function') _renderSessionBar();
    renderGameSide();
    renderGameRep();

    applyModeUI();
}

Bus.on('game:show', showGameScreen);         // demandé par un écran sans lien vers la coquille (éditeur de position)

function startGame(color) {
    playerColor = color;
    gameMode    = 'play';
    loadDB();
    showGameScreen(color);
    resetGame();
}

// Badge de couleur de la barre du haut : même répertoire, autre couleur.
// Puce du répertoire de la barre du haut (RepPicker « sm ») : la liste s'ouvre au clic, et choisir un autre
// répertoire relance le mode en cours avec la même couleur. Séance guidée : puce verrouillée. Finales : titre
// de l'exercice (pas de répertoire).
function renderGameRep() {
    const host = document.getElementById('game-rep');
    if (!host) return;
    if (gameMode === 'endgame' && typeof endgameState !== 'undefined' && endgameState.ex) {
        host.innerHTML = `<span class="game-rep-title">${escapeHtml(endgameState.ex.title)}</span>`;
        return;
    }
    const session = gameMode === 'training' && typeof trainingState !== 'undefined' && !!trainingState.session;
    host.innerHTML = RepPicker.html('gameRepertoire', { size: 'sm', locked: session });
}

function switchGameRepertoire(name) {
    const mode = gameMode, color = playerColor, mixed = mode === 'training' && trainingState.mixed;
    selectRepertoire(name);
    if (mode === 'play') startGame(color);
    else if (mode === 'training') {
        startTraining(mixed ? 'mix' : color);
        if (gameMode !== 'training') goHome('training');        // rien à réviser dans ce répertoire : retour à l'Entraînement
    }
    // Analyse : le brouillon reste, « Ajouter au répertoire » visera le nouveau répertoire.
}
registerActions({ gameRepertoire: switchGameRepertoire });

// Capsule de couleur de la barre du haut (ColorScope compact). Jouer : Blancs / Noirs. Entraînement libre :
// Blancs / Noirs / Les deux (mélangés). Couleur imposée (séance guidée, finale, analyse) : capsule verrouillée.
function renderGameSide() {
    const training = gameMode === 'training' && typeof trainingState !== 'undefined';
    const mixed = training && trainingState.mixed;
    const locked = !(gameMode === 'play' || (training && !trainingState.session));
    const hint = training && trainingState.session ? 'Couleur fixée par la séance guidée' : gameMode === 'endgame' ? 'Couleur fixée par l\'exercice' : 'Couleur fixe dans ce mode';
    ColorScope.render(document.getElementById('game-side'), {
        options: training && !locked ? ['w', 'b', 'mix'] : ['w', 'b'], value: mixed ? 'mix' : playerColor,
        size: 'sm', locked, lockedHint: hint, label: 'Couleur jouée', onChange: switchColor
    });
}

function switchColor(to) {
    if (gameMode === 'play') startGame(to);
    else if (gameMode === 'training') {
        if (to === 'mix') startTraining('mix');
        else switchTrainingColor(to);
    }
    renderGameSide();      // couleur refusée (rien à réviser) : la capsule revient sur la couleur jouée
}

// ─── REPRENDRE (dernière partie du mode « Jouer ») ─────────────────────────────
// Répertoire, couleur et ligne jouée sont mémorisés à chaque coup (renderMoves) ; l'accueil propose
// de les retrouver d'un clic. Propre à cet appareil (non synchronisé).

const LAST_PLAY_KEY = 'chessTrainer_lastPlay';

function saveLastPlay() {
    if (gameMode !== 'play' || !moveHistory || !moveHistory.length) return;      // une partie vide n'efface pas la précédente
    dataStore.setJSON(LAST_PLAY_KEY, { rep: currentRepertoire, color: playerColor, path: moveHistory.map(m => moveToStr(m.from, m.to, m.promo)), at: Date.now() });
}

function _readLastPlay() {
    const s = dataStore.getJSON(LAST_PLAY_KEY, null);
    if (!s || !['w', 'b'].includes(s.color) || !Array.isArray(s.path) || !loadRepertoireList().includes(s.rep)) return null;
    return s;
}

// Fin de ligne lisible : « … 4. c3 Cf6 5. d4 » (les 5 derniers demi-coups), en HTML (figurines du jeu actif).
function _lineTail(path) {
    let sans;
    try { sans = _pathToSans(path); } catch (e) { return ''; }
    if (!sans.length) return 'Position de départ';
    const from = Math.max(0, sans.length - 5);
    return (from ? '… ' : '') + sans.slice(from).map((s, k) => {
        const i = from + k, f = formatSan(s, i % 2 ? 'b' : 'w');
        return i % 2 === 0 ? `${i / 2 + 1}. ${f}` : (k === 0 ? `${(i + 1) / 2}... ${f}` : f);
    }).join(' ');
}

function renderResumeCard() {
    const slot = document.getElementById('resume-slot');
    if (!slot) return;
    const s = _readLastPlay();
    slot.innerHTML = !s ? '' : `
        <button class="resume-card" data-action="resumeLastPlay">
          <span class="resume-ico is-board">${_miniBoardHTML({ side: s.color, path: s.path, k: INIT_FEN }, true, { label: 'Position à reprendre' }) || ico('rotate-ccw')}</span>
          <span class="resume-txt"><b>Reprendre</b>
            <small>${escapeHtml(s.rep)} · ${s.color === 'w' ? 'Blancs' : 'Noirs'} · ${_lineTail(s.path)}</small></span>
          <span class="tr-arrow">${ico('chevron-right')}</span>
        </button>`;
}

function resumeLastPlay() {
    const s = _readLastPlay();
    if (!s) { renderResumeCard(); return; }
    if (s.rep !== currentRepertoire) selectRepertoire(s.rep);
    startGame(s.color);
    loadPositionFromPath(s.path);
    setStatus('Partie reprise', 'info', s.path.length ? 'Vous êtes revenu à la position où vous vous étiez arrêté.' : '');
}

// ─── RETOUR À L'ACCUEIL ───────────────────────────────────────────────────────

// Onglets de l'accueil pendant une partie : compacts dans la barre du haut (920 px et plus, css/home.css), cachés
// en dessous (la barre du bas laisserait moins de place à l'échiquier ; le menu « Plus » les reprend). L'onglet
// marqué est celui d'où vient le mode en cours ; un clic revient à l'accueil sur l'onglet choisi (switchHomeTab).
const GAME_MODE_TAB = { training: 'play', endgame: 'endgame', preview: 'stats' };
function _gameTabs(inGame) {
    const bar = document.getElementById('topnav-tabs-setup');
    bar.classList.toggle('in-game', inGame);
    if (!inGame) return;
    const cur = gameMode === 'preview' && statsPreviewTarget && statsPreviewTarget.from === 'openings' ? 'openings' : GAME_MODE_TAB[gameMode] || 'play';
    HOME_TABS.forEach(t => { const el = document.getElementById('nav-tab-' + t); if (el) el.classList.toggle('active', t === cur); });
}

function goHome(tab) {
    closeRepMenu();
    closeAddMenu();
    if (typeof stopTraining === 'function') stopTraining();
    if (typeof abandonSession === 'function') abandonSession();
    if (typeof stopEndgame === 'function') stopEndgame();
    if (gameMode === 'analysis' && typeof stopAnalysis === 'function') stopAnalysis();     // le brouillon reste dans la session
    if (typeof setSheetOpen === 'function') setSheetOpen(false);
    if (typeof closeToolbarMore === 'function') closeToolbarMore();
    gameMode = 'play';
    applyModeUI();
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('data-overlay').classList.add('hidden');
    document.getElementById('promo-overlay').classList.add('hidden');
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.getElementById('setup-screen').style.display = '';
    document.getElementById('setup-screen').classList.remove('hidden');
    _gameTabs(false);
    document.getElementById('topnav-tabs-game').style.display  = 'none';
    switchHomeTab(typeof tab === 'string' ? tab : 'play');
    renderRepertoireList();
}

registerActions({ selectRepertoire, resumeLastPlay, createRepertoire: () => createRepertoirePrompt(), homeImportPgn: () => showPgnImport(),
    homeReview: () => startDailyReview(), homeGo: () => { const x = _homeStepsNow.find(s => !s.done); if (x) homeRunStep(x.id); },
    homeStep: id => homeRunStep(id),
    homeDaily: arg => {
        if (typeof Daily !== 'undefined' && Daily.today()) return;           // un seul essai compté par jour
        const i = String(arg || '').indexOf(':');
        if (i > 0) startDailyChallenge(arg.slice(0, i), arg.slice(i + 1));
    }, homeAddLine: c => startGame(c), homeExercises: () => switchHomeTab('training') });

// ─── INITIALISATION ───────────────────────────────────────────────────────────

(function init() {
    document.getElementById('game-screen').style.display = 'none';
    loadTheme();
    migrateStoredData();                    // clés de position et notations au format actuel (une fois par appareil)
    purgeExpiredTrash();                    // corbeille : purge des éléments de plus de 30 jours
    renderRepertoireList();
    updateTrashBadges();
    Bus.emit('app:ready');                  // accueil dessiné : le rideau du lancement peut se lever (splash.js)
    // Après l'intro (Bus.afterIntro) : filtre « Vu en partie », puis historique de maîtrise (un relevé par jour d'utilisation).
    if (typeof SeenPositions !== 'undefined') Bus.afterIntro(() => SeenPositions.refresh(), 300);
    Bus.afterIntro(() => MasteryLog.record(currentRepertoire), 500);
})();

function createRepertoirePrompt() {
    askText({ title: 'Nouveau répertoire', placeholder: 'ex : Défense Sicilienne', ok: 'Créer',
              validate: n => loadRepertoireList().includes(n) ? 'Ce répertoire existe déjà.' : '' }, name => {
        const clean = addRepertoire(name);
        if (clean) selectRepertoire(clean);
    });
}

function renameRepertoirePrompt(name) {
    if (name === DEFAULT_REPERTOIRE) { alert('Le répertoire par défaut ne peut pas être renommé.'); return; }
    askText({ title: 'Renommer le répertoire', value: name, ok: 'Renommer',
              validate: n => n === name ? 'Choisissez un nom différent.' : loadRepertoireList().includes(n) ? 'Ce nom est déjà utilisé.' : '' }, n => {
        const clean = renameRepertoire(name, n);
        if (clean) selectRepertoire(clean);
    });
}
