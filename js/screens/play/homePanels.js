/**
 * screens/play/homePanels.js
 * ──────────────────────────────────────────────────────────────────────────
 * Bloc « À traiter » de l'accueil Jouer (css/home.css), à côté de « Aujourd'hui » et « Jouer » (app.js). Deux vues :
 *   « Nouveautés »  parties du journal (chessTrainer_gameLedger) arrêtées sur une nouveauté adverse ou une position
 *                   sans réponse, pour le répertoire actif, tant que la réponse n'est pas enregistrée. Chaque ligne
 *                   montre la position à traiter ; « Répondre » ouvre Jouer dessus.
 *   « Parties »     les parties analysées le plus récemment et leur verdict (.vbadge) pour le répertoire actif ;
 *                   « Répondre » sur celles qui attendent encore une réponse.
 * La vue par défaut est « Nouveautés » ; sans nouveauté ni partie, un état vide renvoie vers l'analyse des parties.
 * Listes (chantier « Accueil et lancement », novembre 2026) : toutes les lignes sont rendues (au plus LIST_CAP) ; la
 * liste montre LIST_SHOWN lignes et défile dans la carte (css/home.css, « À traiter : défilement »), arrêt par ligne,
 * fondu en bas tant qu'il reste des lignes, repère « 1–5 · N » sous la liste. `shown` / `shownGames` contiennent
 * toutes les lignes rendues : « Répondre » vise la bonne, même au-delà de la cinquième.
 * Redessin : un bloc n'est réécrit que si son HTML change (patchHTML) ; une liste réécrite garde son défilement.
 * Suggestion unique « Essayer Noyer + Maestro » pour une installation antérieure restée sur Sauge + Merida
 * (chessTrainer_looksTip, propre à l'appareil : 'tried' ou 'no' ; il n'existe pas de notification générique).
 */

'use strict';

const HomePanels = (function () {
    const LIST_SHOWN = 5, LIST_CAP = 50;              // lignes visibles sans défiler ; lignes rendues au plus
    const KINDS = { theory: ['Théorique', 'ok'], mistake: ['Erreur', 'err'], out: ['Hors répertoire', 'info'],
                    novelty: ['Nouveauté', 'warn'], treated: ['Traitée depuis', 'new'], missing: ['Sans réponse', 'warn'] };   // sans réponse : ambre, comme l'explorateur (C3)
    const date = t => (t ? new Date(t).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short' }) : '');
    const srcName = id => ({ lichess: 'Partie Lichess', chesscom: 'Partie Chess.com' }[_gameSrc(id)] || 'PGN collé');
    let shown = [], shownGames = [];                  // lignes à traiter affichées (clic : index)

    // Fin de ligne : toute la ligne jusqu'à 6 demi-coups, sinon les derniers à partir d'un coup blanc (« … 7. Cf3 Cc6 8. Fb5 »),
    // une seule ellipse. Le dernier coup (celui de l'adversaire qui demande une réponse) est surligné : il ressort sans couleur seule.
    function lineTail(sans) {                       // HTML : figurines du jeu actif
        const from = sans.length <= 6 ? 0 : (sans.length - 4) - ((sans.length - 4) % 2);
        return (from ? '… ' : '') + sans.slice(from).map((san, k) => {
            const i = from + k, n = Math.floor(i / 2) + 1;
            const txt = (i % 2 === 0 ? `${n}. ` : k === 0 ? `${n}… ` : '') + formatSan(san, i % 2 ? 'b' : 'w');
            return i === sans.length - 1 ? `<mark class="hp-move-new">${txt}</mark>` : txt;
        }).join(' ');
    }

    // Nouveautés du répertoire actif encore sans réponse : { id, color, path, at, vs, kind }.
    function novelties() {
        const ledger = readLedger(), out = [];
        ['w', 'b'].forEach(color => {
            const db = readDBFor(currentRepertoire, color), scope = currentRepertoire + '|' + color;
            Object.keys(ledger).forEach(id => {
                const g = ledger[id], v = g.v && g.v[scope];
                if (!v || !Array.isArray(v.path) || !['novelty', 'out'].includes(v.kind)) return;
                let key;
                try { key = Chess.key(Chess.replay(v.path)); } catch (e) { return; }
                if (!db[key]) out.push({ id, color, path: v.path, at: g.at || v.at, vs: g.vs, kind: v.kind });
            });
        });
        return out.sort((a, b) => b.at - a.at);
    }

    let pane = 'news';                               // 'news' | 'games'

    // Vignette : la position à traiter (après la ligne), de mon côté, le dernier coup fléché.
    const thumb = (color, path) => typeof _miniBoardHTML === 'function' ? _miniBoardHTML({ side: color, path, k: INIT_FEN }, true, { arrow: true, label: 'Position à traiter, dernier coup fléché' }) : '';

    // Une ligne : vignette, texte, badge de verdict (.vbadge) et, s'il y a une réponse à jouer, « Répondre ».
    const BADGE = { ok: 'is-ok', err: 'is-err', info: 'is-muted', warn: 'is-warn', new: 'is-accent' };
    function row(thumbHTML, txt, kind, answer) {
        const [label, cls] = KINDS[kind] || ['', ''];
        return `<div class="hp-row${answer ? '' : ' is-static'}">
                <span class="hp-thumb">${thumbHTML}</span><span class="hp-row-txt">${txt}</span>
                <span class="hp-row-end">${label ? `<span class="vbadge ${BADGE[cls]}">${label}</span>` : ''}${answer || ''}</span></div>`;
    }
    const answerBtn = (action, i) => `<button type="button" class="btn btn-soft hp-answer" data-action="${action}" data-arg="${i}">Répondre</button>`;

    function newsRows() {
        const list = novelties();
        shown = list.slice(0, LIST_CAP);
        if (!list.length) return `<div class="hp-empty">${ico('check')}<b>Aucune nouveauté en attente</b>
            <button type="button" class="st-link" data-action="homeGames">Analyser mes parties</button></div>`;
        return shown.map((x, i) => row(thumb(x.color, x.path),
            `<b>${lineTail(_pathToSans(x.path))}</b><small>${escapeHtml(x.vs ? 'contre ' + x.vs : srcName(x.id))}${x.at ? ' · ' + date(x.at) : ''}</small>`,
            x.kind === 'novelty' ? 'novelty' : 'missing', answerBtn('homeNovelty', i))).join('');
    }

    // Parties : « Répondre » seulement sur celles qui attendent encore une réponse (les mêmes que les Nouveautés).
    function gameRows() {
        const ledger = readLedger(), todo = novelties();
        const ids = Object.keys(ledger).filter(id => ['w', 'b'].some(c => ledger[id].v && ledger[id].v[currentRepertoire + '|' + c]))
            .sort((a, b) => (ledger[b].last || 0) - (ledger[a].last || 0)).slice(0, LIST_CAP);
        shownGames = [];
        if (!ids.length) return `<div class="hp-empty">${ico('flame')}<b>Aucune partie analysée</b>
            <button type="button" class="st-link" data-action="homeGames">Analyser mes parties</button></div>`;
        return ids.map(id => {
            const g = ledger[id], c = ['w', 'b'].find(k => g.v[currentRepertoire + '|' + k]), v = g.v[currentRepertoire + '|' + c];
            const open = todo.find(x => x.id === id && x.color === c);
            if (open) shownGames.push(open);
            return row(Array.isArray(v.path) ? thumb(c, v.path) : '',
                `<b>${escapeHtml(g.vs ? 'contre ' + g.vs : srcName(id))}</b><small>${c === 'w' ? 'Blancs' : 'Noirs'} · ${date(g.at || g.last)}</small>`,
                v.kind, open ? answerBtn('homeGameAnswer', shownGames.length - 1) : '');
        }).join('');
    }

    // Liste défilante au-delà de LIST_SHOWN lignes : focalisable (flèches du clavier), repère « 1–5 · N » dessous.
    function inboxHTML() {
        const n = novelties().length;
        const tab = (id, label) => `<button type="button" role="tab" aria-selected="${pane === id}" data-action="homePane" data-arg="${id}">${label}</button>`;
        const rows = pane === 'news' ? newsRows() : gameRows();
        const total = (rows.match(/class="hp-row[ "]/g) || []).length, more = total > LIST_SHOWN;
        const label = pane === 'news' ? 'Nouveautés' : 'Parties';
        return `<div class="hp-h"><h2>À traiter</h2>${n ? `<span class="count">${n}</span>` : ''}
                <div class="hp-tabs" role="tablist" aria-label="À traiter">${tab('news', 'Nouveautés')}${tab('games', 'Parties')}</div></div>
            <div class="hp-list${more ? ' is-scroll' : ''}"${more ? ` tabindex="0" role="region" aria-label="${label} : ${total} lignes, liste défilante"` : ''}>${rows}</div>`
            + (more ? `<p class="hp-cue" aria-hidden="true"><span class="hp-cue-at">1–${LIST_SHOWN}</span><span class="hp-cue-bar"><i style="width:${Math.round(LIST_SHOWN / total * 100)}%"></i></span><span>${total}</span></p>` : '');
    }

    // Hauteur de 5 lignes, mesurée (une ligne fait 64 px à l'ordinateur, davantage sur téléphone où le badge passe dessous).
    function fitFive(list) {
        const rows = list ? list.querySelectorAll('.hp-row') : [];
        if (rows.length <= LIST_SHOWN) return;
        const h = rows[LIST_SHOWN].offsetTop - rows[0].offsetTop;
        if (h > 0) list.style.setProperty('--hp-five', h + 'px');
    }

    // Repère et fondu de la liste défilante, à chaque défilement (écouteur posé une fois, en capture, sur #hp-news).
    function syncCue(list) {
        const box = list && list.closest('#hp-news'), cue = box && box.querySelector('.hp-cue');
        if (!list || !list.classList.contains('is-scroll')) return;
        if (!list.style.getPropertyValue('--hp-five')) fitFive(list);               // liste dessinée cachée : mesurée au premier défilement
        const rows = list.querySelectorAll('.hp-row'), total = rows.length, h = rows[0] ? rows[0].offsetHeight : 0;
        const first = h ? Math.min(total, Math.round(list.scrollTop / h) + 1) : 1, last = Math.min(total, first + LIST_SHOWN - 1);
        list.classList.toggle('at-end', list.scrollTop + list.clientHeight >= list.scrollHeight - 2);
        if (!cue) return;
        cue.querySelector('.hp-cue-at').textContent = `${first}–${last}`;
        cue.querySelector('.hp-cue-bar i').style.width = Math.round(last / total * 100) + '%';
    }

    // ─── Suggestion Noyer + Maestro ───────────────────────────────────────────
    const TIP_KEY = 'chessTrainer_looksTip';
    let tipUndo = null;                               // choix d'avant l'essai, le temps de pouvoir revenir en arrière
    function tipHTML() {
        if (tipUndo) return `<div class="looks-tip" role="status"><span><b>Noyer + Maestro appliqués.</b> Tout se règle dans Paramètres › Apparence.</span>
            <span class="looks-tip-acts"><button type="button" class="st-link" data-action="looksTip" data-arg="undo">Revenir à l'ancien</button><button type="button" class="st-link" data-action="looksTip" data-arg="close">OK</button></span></div>`;
        if (dataStore.get(TIP_KEY) !== null || dataStore.get('chessTrainer_looksDefaults') === null
            || appSettings.boardTheme !== 'tournament' || appSettings.pieceSet !== 'merida') return '';
        return `<div class="looks-tip" role="note"><span class="looks-tip-sw" aria-hidden="true"></span>
            <span><b>Nouvelle apparence</b> L'échiquier Noyer et les pièces Maestro sont les nouveaux défauts. Les essayer ?</span>
            <span class="looks-tip-acts"><button type="button" class="btn btn-soft" data-action="looksTip" data-arg="try">Essayer</button><button type="button" class="st-link" data-action="looksTip" data-arg="no">Non merci</button></span></div>`;
    }
    function looksTip(arg) {
        if (arg === 'try') {
            tipUndo = { boardTheme: appSettings.boardTheme, pieceSet: appSettings.pieceSet };
            dataStore.set(TIP_KEY, 'tried');
            setPref('boardTheme', 'walnut');
            setPref('pieceSet', 'maestro');
        } else if (arg === 'undo' && tipUndo) {
            setPref('boardTheme', tipUndo.boardTheme);
            setPref('pieceSet', tipUndo.pieceSet);
            tipUndo = null;
        } else {
            if (arg === 'no') dataStore.set(TIP_KEY, 'no');
            tipUndo = null;
        }
        render();
    }

    let listening = false;
    function render() {
        patchHTML(document.getElementById('looks-tip'), tipHTML());
        const box = document.getElementById('hp-news');
        if (!box) return;
        const old = box.querySelector('.hp-list'), top = old ? old.scrollTop : 0, was = box.dataset.pane;
        if (patchHTML(box, inboxHTML())) {
            const list = box.querySelector('.hp-list');
            if (list && top && was === pane) list.scrollTop = top;           // même vue : la liste reste où on l'avait laissée
            box.dataset.pane = pane;
            fitFive(list);
            syncCue(list);
        }
        if (!listening) {
            listening = true;
            box.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('hp-list')) syncCue(e.target); }, { capture: true, passive: true });
            window.addEventListener('resize', () => { const l = box.querySelector('.hp-list.is-scroll'); if (l) { fitFive(l); syncCue(l); } }, { passive: true });
        }
    }

    // « Répondre » : Jouer sur la position à traiter (rien n'est compté en Jouer).
    function openNovelty(i, list = shown) {
        const x = list[Number(i)];
        if (!x) return;
        startGame(x.color);
        loadPositionFromPath(x.path);
        setStatus('Nouveauté à traiter', 'new', x.kind === 'novelty' ? 'Votre répertoire ne couvre pas ce coup : jouez votre réponse pour l\'enregistrer.'
                                                                    : 'Aucune réponse enregistrée ici : jouez votre coup pour l\'enregistrer.');
    }

    registerActions({ homeNovelty: i => openNovelty(i), homeGameAnswer: i => openNovelty(i, shownGames), homeGames: () => showGameReview(), homePane: p => { pane = p; render(); }, looksTip });
    return { render, novelties };
})();
