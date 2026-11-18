/**
 * screens/editor/positionEditor.js
 * ──────────────────────────────────────────────────────────────────────────
 * Éditeur de position, disposition « Pinceau » (chantier « Éditeur et photo », gameMode 'editor') : l'échiquier de
 * l'écran de jeu, une palette de 8 boutons (couleur, les 6 pièces, déplacer ; rangée sous l'échiquier sur téléphone,
 * colonne à gauche sur bureau), puis trait, Départ, Vider, Retourner, roques et prise en passant déduits des pièces
 * (modifiables), FEN à coller et copier, validation, « Analyser » et « Jouer contre le moteur » (WhatIf).
 *   Pinceau : une pièce choisie se pose d'un toucher ; la même pièce sur la même case la retire (gomme) ; ✋ déplace
 *   (toucher puis toucher, ou glisser) ; glisser une pièce hors de l'échiquier la retire. Avec ✋, toucher une case en
 *   ambre confirme sa lecture.
 *   Entrée : outil « Poser » de l'Analyse (PositionEditor.fromAnalysis) ; Quitter y ramène, sur la même ligne.
 *   Image : coller (⌘V) dans l'Analyse ou l'éditeur, déposer un fichier, ou « Image » ; la lecture (BoardReader,
 *   gabarits locaux) est chargée à la demande (ON_DEMAND, rangé par sw.js) ; cases douteuses en ambre (.ed-doubt).
 *   Rien n'est écrit : ni répertoire ni préférence.
 */

'use strict';

const PositionEditor = (function () {
    // Fichiers chargés à la demande, dans cet ordre (gabarits puis code) ; sw.js les range à l'installation (ON_DEMAND).
    const ON_DEMAND = ['js/domain/photo/pieceTemplates.js', 'js/domain/photo/boardReader.js'];
    const TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];
    // Nom de chaque pièce, accordé à sa couleur : une phrase entière par pièce (traductions).
    const PIECE_NAMES = { K: ['Roi blanc', 'Roi noir'], Q: ['Dame blanche', 'Dame noire'], R: ['Tour blanche', 'Tour noire'],
                          B: ['Fou blanc', 'Fou noir'], N: ['Cavalier blanc', 'Cavalier noir'], P: ['Pion blanc', 'Pion noir'] };
    const SVG = {
        hand: '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
        image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
        copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
    };
    const svg = k => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>`;

    const st = {
        pos: PositionSetup.start(), brush: 'move', color: 'w', doubt: new Set(),
        av: { K: true, Q: true, k: true, q: true },        // roques permis par les pièces au dernier rendu
        back: null, reading: false, fenBad: false,
        fenText: null                                     // FEN en cours de saisie : gardée telle quelle dans son champ
    };
    let _loading = null;

    const fen = () => PositionSetup.fen(st.pos);
    const side = c => (c === 'w' ? 'Blancs' : 'Noirs');

    // ─── POSITION ─────────────────────────────────────────────────────────────
    // Après chaque changement de pièces : un roque qui devient possible est proposé coché, un roque impossible décoché ;
    // la prise en passant n'est gardée que si elle reste jouable.
    function _settle(pos) {
        const av = PositionSetup.castlingAvailable(pos.board), c = {};
        ['K', 'Q', 'k', 'q'].forEach(k => { c[k] = av[k] && (st.av[k] ? !!pos.castling[k] : true); });
        st.av = av;
        st.pos = PositionSetup.normalize({ board: pos.board, turn: pos.turn, castling: c, ep: pos.ep });
    }

    // Position reçue telle quelle (FEN, image) : ses roques sont respectés, bornés à ce que les pièces permettent.
    function _take(pos) {
        st.av = PositionSetup.castlingAvailable(pos.board);
        st.pos = PositionSetup.normalize(pos);
    }

    function _edit(fn) {
        const b = st.pos.board.slice();
        fn(b);
        _settle({ ...st.pos, board: b });
        selected = null;
        paint();
    }

    function _setSquare(idx, p) {
        st.doubt.delete(idx);
        _edit(b => { b[idx] = p; });
    }

    // ─── ÉCHIQUIER (fiche GameModes) ──────────────────────────────────────────
    function onSquare(idx) {
        const b = st.pos.board;
        if (st.brush === 'move') {
            // Case en ambre touchée : sa lecture est confirmée (l'ambre s'efface), la pièce est prise en main.
            if (selected === null) { const seen = st.doubt.delete(idx); if (b[idx]) selected = idx; renderBoard(); if (seen) paintPanel(); return; }
            if (selected === idx) { selected = null; renderBoard(); return; }
            const from = selected;
            st.doubt.delete(from); st.doubt.delete(idx);
            _edit(bb => { bb[idx] = bb[from]; bb[from] = ''; });
            return;
        }
        const p = st.color === 'w' ? st.brush : st.brush.toLowerCase();
        _setSquare(idx, b[idx] === p ? '' : p);            // la même pièce sur la même case : gomme
    }

    // Glisser : vers une case, la pièce s'y pose ; hors de l'échiquier, elle est retirée.
    function onDrop(from, to) {
        if (to === from) return;
        st.doubt.delete(from);
        if (to !== null) st.doubt.delete(to);
        _edit(b => { if (to !== null) b[to] = b[from]; b[from] = ''; });
    }

    // ─── RENDU ────────────────────────────────────────────────────────────────
    function paint() {
        if (gameMode !== 'editor') return;
        st.fenText = null;
        const keepSel = selected;
        paintPalette();
        paintPanel();                                     // avant l'échiquier : son rendu renouvelle le dock (Analyser)
        loadPositionFromPath([], { fen: fen() });
        if (keepSel !== null && st.pos.board[keepSel]) { selected = keepSel; renderBoard(); }
    }

    function paintPalette() {
        const box = document.getElementById('ed-palette');
        if (!box) return;
        const c = st.color, on = k => st.brush === k;
        box.innerHTML = `<button type="button" class="ed-tool ed-color is-${c}" data-action="edColor" title="Couleur du pinceau : ${side(c)} (toucher pour changer)" aria-label="Couleur du pinceau : ${side(c)}"><i class="ed-swatch" aria-hidden="true"></i></button>
            ${TYPES.map(t => `<button type="button" class="ed-tool ed-piece${on(t) ? ' is-on' : ''}" data-action="edBrush" data-arg="${t}" aria-pressed="${on(t)}" title="${PIECE_NAMES[t][c === 'w' ? 0 : 1]} : touchez une case pour poser la pièce, la même case pour la retirer">${pieceHTML(c === 'w' ? t : t.toLowerCase())}</button>`).join('')}
            <button type="button" class="ed-tool ed-move${on('move') ? ' is-on' : ''}" data-action="edBrush" data-arg="move" aria-pressed="${on('move')}" title="Déplacer : touchez une pièce puis sa nouvelle case, ou glissez-la (hors de l'échiquier : retirée)">${svg('hand')}</button>`;
    }

    function _checkHTML() {
        const v = PositionSetup.validate(st.pos);
        if (v.ok) {
            const n = st.doubt.size;
            const toMove = st.pos.turn === 'w' ? 'Blancs au trait' : 'Noirs au trait';
            return n ? `<p class="ed-check is-warn" role="status">${ico('alert-triangle')}<span>${n > 1 ? `${n} cases à vérifier (en ambre)` : `${n} case à vérifier (en ambre)`} · ${toMove}</span></p>`
                     : `<p class="ed-check is-ok" role="status">${ico('check')}<span>Position valide · ${toMove}</span></p>`;
        }
        return `<p class="ed-check is-err" role="status">${ico('alert-triangle')}<span>${v.errors.map(escapeHtml).join(' · ')}</span></p>`;
    }

    function paintPanel() {
        const box = document.getElementById('editor-panel');
        if (!box) return;
        const p = st.pos, av = st.av, ok = PositionSetup.validate(p).ok;
        const cb = (k, label) => `<label class="ed-cb${av[k] ? '' : ' is-off'}"><input type="checkbox" data-action="edCastle" data-arg="${k}"${p.castling[k] ? ' checked' : ''}${av[k] ? '' : ' disabled'}><span>${label}</span></label>`;
        const eps = PositionSetup.epCandidates(p.board, p.turn);
        const seg = c => `<button type="button" role="radio" aria-checked="${p.turn === c}" class="${p.turn === c ? 'is-on' : ''}" data-action="edTurn" data-arg="${c}">${side(c)}</button>`;
        const focusFen = document.activeElement && document.activeElement.id === 'ed-fen';
        box.innerHTML = `<div class="ab-card ed-card">
            <div class="ed-row ed-turn"><span class="ed-lab">Au trait</span><div class="ab-seg" role="radiogroup" aria-label="Au trait">${seg('w')}${seg('b')}</div></div>
            <div class="ed-row ed-quick">
                <button type="button" class="btn btn-soft" data-action="edStart" title="Position de départ" aria-label="Position de départ">${ico('rotate-ccw')}<span>Départ</span></button>
                <button type="button" class="btn btn-soft" data-action="edClear" title="Retirer toutes les pièces" aria-label="Vider l'échiquier">${ico('trash')}<span>Vider</span></button></div>
            <div class="ed-more">
                <fieldset class="ed-castle"><legend class="ed-lab">Roques possibles</legend>${cb('K', 'O-O blanc')}${cb('Q', 'O-O-O blanc')}${cb('k', 'O-O noir')}${cb('q', 'O-O-O noir')}</fieldset>
                <label class="ed-row ed-ep"><span class="ed-lab">Prise en passant</span>
                    <select data-change="edEp"${eps.length ? '' : ' disabled'}><option value="-1">aucune</option>${eps.map(i => `<option value="${i}"${p.ep === i ? ' selected' : ''}>${squareToName(i)}</option>`).join('')}</select></label>
                <div class="ed-fen"><label class="ed-lab" for="ed-fen">FEN</label>
                    <div class="ed-fen-row"><input id="ed-fen" class="${st.fenBad ? 'is-bad' : ''}" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" translate="no" value="${escapeHtml(st.fenText !== null ? st.fenText : fen())}" aria-describedby="ed-fen-hint">
                    <button type="button" class="ab-icon" data-action="edCopy" title="Copier la FEN" aria-label="Copier la FEN">${svg('copy')}</button></div>
                    <small id="ed-fen-hint">Collez une FEN, une capture d'écran (⌘V) ou déposez une image.</small></div>
                <button type="button" class="btn btn-soft ed-image" data-action="edImage" ${st.reading ? 'aria-busy="true" disabled' : ''}>${svg('image')}<span>${st.reading ? 'Lecture de l’image…' : 'Coller une image'}</span></button>
            </div>
            ${_checkHTML()}
            <div class="ed-actions">
                <button type="button" class="btn ed-play" data-action="edPlay"${ok ? '' : ' disabled'} title="Jouer le camp au trait contre le moteur, bridé à votre niveau">${ico('swords')}<span>Jouer contre le moteur</span></button>
                <button type="button" class="btn btn-primary ed-analyse" data-action="edAnalyse"${ok ? '' : ' disabled'} title="Analyser cette position avec le moteur">${ico('microscope')}<span>Analyser</span></button></div></div>`;
        if (focusFen) { const f = document.getElementById('ed-fen'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    }

    // ─── OUVERTURE / SORTIE ───────────────────────────────────────────────────
    // opts.back : retour de Quitter ; opts.doubt : cases douteuses (image) ; opts.flipped : sens de l'échiquier.
    function open(fenOrPos, opts = {}) {
        const pos = typeof fenOrPos === 'string' ? PositionSetup.parse(fenOrPos) : fenOrPos;
        if (gameMode === 'analysis') {                    // depuis l'Analyse : Quitter y ramène, sur la même ligne
            const back = _analysisReturn();
            stopAnalysis();
            if (!opts.back) opts.back = back;
        }
        if (opts.back) st.back = opts.back;
        _take(pos || PositionSetup.start());
        st.doubt = new Set(opts.doubt || []);
        st.fenBad = false;
        selected = null;
        const flip = opts.flipped !== undefined ? opts.flipped : boardFlipped;
        gameMode = 'editor';
        Bus.emit('game:show', playerColor);              // écran de jeu affiché par la coquille (app.js)
        boardFlipped = !!flip;
        paint();
        setStatus('Poser une position', 'info', opts.note || 'Choisissez une pièce puis touchez des cases ; la même pièce sur la même case la retire.');
    }

    // Retour vers l'Analyse quittée : même départ, même ligne, même coup affiché, même retour.
    function _analysisReturn() {
        const s = { start: analysis.start, line: _anLine(), ply: navCursor === -1 ? moveHistory.length - 1 : navCursor === NAV_START ? -1 : navCursor,
                    back: analysis.back, origin: analysis.origin, color: playerColor, flipped: boardFlipped };
        return () => {
            playerColor = s.color;
            openAnalysis(s.line, s.ply, s.back, s.start);
            analysis.origin = s.origin;
            if (boardFlipped !== s.flipped) flipBoard();
        };
    }

    function fromAnalysis() {
        if (gameMode !== 'analysis') return;
        open(displayedFen());
    }

    function quit() {
        const back = st.back;
        st.back = null;
        selected = null;
        if (back) back();
        else { gameMode = 'play'; openAnalysis([]); }
    }

    // Retour vers l'éditeur depuis l'Analyse ou la partie lancées d'ici : même position, même retour final.
    function _backHere(f, flipped) {
        const back = st.back;
        return () => open(f, { back, flipped });
    }

    function _guard() {
        const v = PositionSetup.validate(st.pos);
        if (!v.ok) { setStatus('Position impossible', 'err', v.errors.join(' · ')); return false; }
        return true;
    }

    function analyse() {
        if (!_guard()) return;
        const f = fen(), flipped = boardFlipped, back = _backHere(f, flipped), color = playerColor;
        gameMode = 'play';
        playerColor = flipped ? 'b' : 'w';
        openAnalysis([], -1, back, f);
        playerColor = color;
        analysis.color = color;
        if (boardFlipped !== flipped) flipBoard();
    }

    function playEngine() {
        if (!_guard()) return;
        const f = fen(), flipped = boardFlipped, back = _backHere(f, flipped);
        const lvl = typeof GameArchive !== 'undefined' && GameArchive.level ? GameArchive.level() : null;
        gameMode = 'play';
        WhatIf.start({ fen: f, path: [], color: st.pos.turn, elo: lvl && lvl.r ? lvl.r : 1500, back });
    }

    // ─── IMAGE ────────────────────────────────────────────────────────────────
    function _script(src) {
        return new Promise((ok, ko) => {
            const s = document.createElement('script');
            s.src = src; s.async = false;
            s.onload = ok; s.onerror = () => ko(new Error('chargement impossible : ' + src));
            document.head.appendChild(s);
        });
    }

    // Lecture chargée à la demande, une seule fois.
    function loadReader() {
        if (globalThis.BoardReader && globalThis.PieceTemplates) return Promise.resolve(globalThis.BoardReader);
        if (!_loading) _loading = ON_DEMAND.reduce((p, src) => p.then(() => _script(src)), Promise.resolve())
            .then(() => globalThis.BoardReader).catch(e => { _loading = null; throw e; });
        return _loading;
    }

    // Image → pixels (1600 px au plus de côté).
    async function _pixels(blob) {
        let src = null, w, h;
        if (typeof globalThis.createImageBitmap === 'function') { src = await globalThis.createImageBitmap(blob); w = src.width; h = src.height; }
        else {
            const url = URL.createObjectURL(blob);
            src = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = url; });
            URL.revokeObjectURL(url); w = src.naturalWidth; h = src.naturalHeight;
        }
        const f = Math.min(1, 1600 / Math.max(w, h)), W = Math.max(1, Math.round(w * f)), H = Math.max(1, Math.round(h * f));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(src, 0, 0, W, H);
        if (src.close) src.close();
        return ctx.getImageData(0, 0, W, H);
    }

    async function readImage(blob) {
        if (!blob || st.reading) return;
        st.reading = true;
        if (gameMode === 'editor') paintPanel();
        setStatus('Lecture de l’image…', 'load', 'Tout se passe sur cet appareil : l’image n’est envoyée nulle part.');
        try {
            const [reader, img] = await Promise.all([loadReader(), _pixels(blob)]);
            await new Promise(r => setTimeout(r, 30));     // la barre d'état s'affiche avant le calcul
            const res = reader.read(img, globalThis.PieceTemplates);
            st.reading = false;
            if (!res.ok) {
                setStatus('Aucun échiquier trouvé dans l’image', 'err', 'Recadrez la capture sur l’échiquier, puis recommencez.');
                if (gameMode === 'editor') paintPanel();
                return;
            }
            const turn = res.flipped ? 'b' : 'w';
            const n = res.doubt.length;
            open({ board: res.board, turn, castling: { K: true, Q: true, k: true, q: true }, ep: -1 }, { doubt: res.doubt, flipped: res.flipped,
                note: n > 1 ? `${n} cases à vérifier, en ambre : touchez-les pour corriger.` : n ? 'Une case à vérifier, en ambre : touchez-la pour corriger.'
                    : 'Vérifiez la position, le trait et les roques.' });
            // Phrases entières, une par cas (traductions).
            const check = turn === 'w' ? ['Vérifiez le trait (Blancs supposés) et les roques.', 'Cases en ambre : touchez-les pour corriger. Vérifiez le trait (Blancs supposés) et les roques.']
                                       : ['Vérifiez le trait (Noirs supposés) et les roques.', 'Cases en ambre : touchez-les pour corriger. Vérifiez le trait (Noirs supposés) et les roques.'];
            setStatus(n > 1 ? `Position lue · ${n} cases à vérifier` : n ? 'Position lue · 1 case à vérifier' : 'Position lue', n ? 'new' : 'ok', check[n ? 1 : 0]);
        } catch (e) {
            st.reading = false;
            setStatus('Lecture impossible', 'err', 'L’image n’a pas pu être lue sur cet appareil.');
            if (gameMode === 'editor') paintPanel();
            if (typeof reportError === 'function') reportError('photo', e);
        }
    }

    function pickImage() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.addEventListener('change', () => { if (input.files && input.files[0]) readImage(input.files[0]); });
        input.click();
    }

    // Coller : une image (capture d'écran) ou une FEN, dans l'Analyse comme dans l'éditeur.
    const _here = () => (gameMode === 'editor' || gameMode === 'analysis') && !document.getElementById('game-screen').classList.contains('hidden');
    function _onPaste(e) {
        if (!_here() || !e.clipboardData) return;
        const file = [...(e.clipboardData.items || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
        if (file) { e.preventDefault(); readImage(file.getAsFile()); return; }
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;   // la FEN se colle dans son champ
        const text = (e.clipboardData.getData('text') || '').trim(), pos = PositionSetup.parse(text);
        if (!pos) return;
        e.preventDefault();
        open(pos, { note: 'FEN collée : vérifiez la position, puis Analyser.' });
    }

    function _onFenInput(e) {
        if (!e.target || e.target.id !== 'ed-fen') return;
        const pos = PositionSetup.parse(e.target.value);
        st.fenBad = !pos;
        st.fenText = e.target.value;
        e.target.classList.toggle('is-bad', !pos);
        if (!pos) return;
        _take(pos);
        st.doubt.clear();
        loadPositionFromPath([], { fen: fen() });
        paintPanel();
    }

    function copyFen() {
        const f = fen();
        const done = () => setStatus('FEN copiée', 'ok', f);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(f).then(done, () => setStatus('Copie impossible', 'err', f));
        else setStatus('FEN', 'info', f);
    }

    // ─── ACTIONS ──────────────────────────────────────────────────────────────
    registerActions({
        edBrush: k => { st.brush = k; selected = null; renderBoard(); paintPalette(); },
        edColor: () => { st.color = st.color === 'w' ? 'b' : 'w'; if (st.brush === 'move') st.brush = 'P'; paintPalette(); },
        edTurn: c => { _settle({ ...st.pos, turn: c }); paint(); },
        edStart: () => { st.doubt.clear(); st.av = { K: false, Q: false, k: false, q: false }; _settle(PositionSetup.start()); paint(); },
        edClear: () => { st.doubt.clear(); _settle({ ...PositionSetup.empty(), turn: st.pos.turn }); paint(); },
        edCastle: k => { const c = { ...st.pos.castling, [k]: !st.pos.castling[k] }; st.pos = PositionSetup.normalize({ ...st.pos, castling: c }); paint(); },
        edEp: (arg, el) => { const v = Number(el ? el.value : arg); st.pos = PositionSetup.normalize({ ...st.pos, ep: v }); paint(); },
        edCopy: copyFen,
        edImage: pickImage,
        edAnalyse: analyse,
        edPlay: playEngine,
        analysisEditSetup: () => { if (gameMode === 'analysis') open(analysis.start || INIT_FEN); }
    });

    document.addEventListener('paste', _onPaste);
    document.addEventListener('input', _onFenInput);
    // Image déposée sur l'écran de jeu (Analyse ou éditeur).
    document.addEventListener('dragover', e => { if (_here() && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', e => {
        if (!_here() || !e.dataTransfer) return;
        const f = [...(e.dataTransfer.files || [])].find(x => /^image\//.test(x.type));
        if (f) { e.preventDefault(); readImage(f); }
    });

    GameModes.register('editor', {
        onSquare,
        onDrop,
        squareClass: idx => (st.doubt.has(idx) ? 'ed-doubt' : ''),
        dockCenter: () => {
            const b = document.querySelector('#editor-panel .ed-analyse');
            return b && !b.disabled ? { icon: 'microscope', label: 'Analyser', target: b, title: b.title }
                                    : { icon: 'alert-triangle', label: 'À corriger', tone: 'warn', title: 'Position impossible', run: _guard };
        }
    });

    return { open, fromAnalysis, quit, readImage, loadReader, paint, ON_DEMAND, state: () => st };
})();
