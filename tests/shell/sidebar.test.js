// Lancer : node tests/shell/sidebar.test.js   — rail légendé (à partir de 1 100 px, chantier « Navigation sans repli ») :
// règles CSS, une seule forme en partie et hors partie, préférence sideBar retirée, déplacement de la puce de partie.
const { ROOT, bootApp, mainCss } = require('../_app.js');
const assert = require('assert'), fs = require('fs'), path = require('path');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const home = fs.readFileSync(path.join(ROOT, 'css/home.css'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const i = home.indexOf('BARRE LATÉRALE (à partir de 1 100 px)'), bloc = home.slice(i);

    await t('colonne fixe de 96 px dès 1 100 px, la hauteur de la barre rendue au contenu', () => {
        assert(i > 0);
        assert(/@media \(min-width: 1100px\) \{\s+:root \{ --topnav-h: 0px; --side-w: 96px; \}/.test(bloc), 'rail de 96 px, plus de hauteur réservée');
        assert(/\.topnav \{\s+position: fixed; inset: 0 auto 0 0; width: var\(--side-w\)/.test(bloc));
        assert(/\.app \{ margin-left: var\(--side-w\); width: calc\(100% - var\(--side-w\)\); \}/.test(bloc), 'le contenu commence après la barre');
    });

    await t('chaque onglet montre son icône et son nom, en partie comme hors partie', () => {
        assert(/#topnav-tabs-setup \.topnav-tab, #topnav-tabs-setup\.in-game \.topnav-tab \{\s+flex-direction: column;/.test(bloc), 'icône sur le nom');
        assert(bloc.includes('#topnav-tabs-setup .topnav-tab > span, #topnav-tabs-setup.in-game .topnav-tab > span { position: static;'), 'le nom reste visible en partie');
        assert(!/topnav-tab > span \{ position: absolute; width: 1px/.test(bloc), 'plus de nom caché dans le rail');
        assert(/\.topnav-tab\.active > \.ico \{[^}]*background:/.test(bloc), 'état actif : un fond sous l’icône');
        assert(/\.topnav-tab\.active::after \{ display: none; \}/.test(bloc), 'sans filet latéral');
    });

    await t('plus aucun repli : ni mode étendu, ni bouton, ni volets', () => {
        assert(!/data-side/.test(home), 'aucune règle selon data-side');
        assert(!/240px|side-toggle|\.sb-menu|\.sb-it|\.sb-title/.test(bloc));
        assert(!/data-side|sideBar/.test(html), 'rien dans le script de tête');
    });

    await t('séance guidée : onglets cachés, logo actif (quitter garde le bilan)', () => {
        assert(bloc.includes('html[data-session] #topnav-tabs-setup { display: none; }'));
        assert(!/data-session\][^{]*\.topnav-brand[^{]*\{[^}]*pointer-events: none/.test(bloc), 'le logo n\'est plus bloqué en séance');
    });

    await t('la feuille de la barre latérale passe après les hauteurs de la barre du haut', () => {
        assert(mainCss().includes(':root { --topnav-h: 80px; }') && !home.includes('--topnav-h: 80px'));
        assert(html.indexOf('css/layout.css') < html.indexOf('css/home.css'), 'sinon --topnav-h reviendrait à 80 px');
    });

    // matchMedia simulé : jsdom n'en fournit pas.
    function listener(w, matches) {
        const mq = { matches, cb: null, addEventListener(_, f) { this.cb = f; } };
        w.matchMedia = q => q === '(min-width: 1100px)' ? mq : { matches: false, addEventListener() {} };
        return mq;
    }

    await t('la puce de partie va dans le panneau de jeu, et revient sous 1 100 px', async () => {
        let mq;
        const { dom, errors } = await bootApp({ before: w => { mq = listener(w, true); } });
        const $ = s => dom.window.document.querySelector(s);
        assert.deepStrictEqual(errors, []);
        assert($('#game-meta-slot #game-rep') && $('#game-meta-slot #game-side') && $('#game-meta-slot #stats-back'), 'dans le panneau');
        assert.strictEqual($('#topnav-tabs-game').children.length, 0);
        mq.cb({ matches: false });
        assert($('#topnav-tabs-game #game-rep') && !$('#game-meta-slot').children.length, 'de retour dans la barre');
        mq.cb({ matches: true });
        assert($('#game-meta-slot #game-rep'));
    });

    await t('les quatre onglets de la barre, chacun avec son nom', async () => {
        const { dom } = await bootApp();
        const tabs = [...dom.window.document.querySelectorAll('#topnav-tabs-setup div.topnav-tab')];
        assert.deepStrictEqual(tabs.filter(x => !x.classList.contains('is-offbar')).map(x => x.id.slice(8)), ['play', 'openings', 'endgame', 'stats'], 'Entraînement hors de la barre');
        tabs.forEach(tab => assert.strictEqual(tab.title, tab.querySelector('span').textContent));
    });

    // Démarre l'application avec la barre latérale.
    async function side(storage) {
        const { dom, errors } = await bootApp({ storage, before: w => {
            w.matchMedia = q => ({ matches: q === '(min-width: 1100px)' || q === '(min-width: 1440px)' || q === '(hover: hover)', addEventListener() {} });
            w.scrollTo = () => {};
        } });
        const w = dom.window, doc = w.document;
        return { w, doc, errors, $: s => doc.querySelector(s) };
    }

    await t('rail : le clic change d’onglet, aucun volet ni bouton Replier', async () => {
        const { doc, errors, $ } = await side();
        assert.deepStrictEqual(errors, []);
        assert(!doc.querySelector('.sb-menu, #side-toggle, .side-toggle'), 'ni volet ni bouton');
        assert.strictEqual(doc.defaultView.eval('typeof SideBar.toggle'), 'undefined');
        $('#nav-tab-stats').click();
        assert($('#nav-tab-stats').classList.contains('active'));
        assert(!doc.querySelector('.sb-menu'));
    });

    await t('en partie, la barre reste la même : les mêmes onglets, à la même place', async () => {
        const { w, doc } = await side();
        const avant = [...doc.querySelectorAll('#topnav-tabs-setup > .topnav-tab')].map(x => x.id);
        w.eval('startGame("w")');
        assert(!doc.getElementById('game-screen').classList.contains('hidden'), 'en partie');
        assert(doc.getElementById('topnav-tabs-setup').classList.contains('in-game'));
        assert.deepStrictEqual([...doc.querySelectorAll('#topnav-tabs-setup > .topnav-tab')].map(x => x.id), avant);
        assert(!doc.documentElement.hasAttribute('data-side'));
        doc.getElementById('nav-tab-stats').click();
        assert(doc.getElementById('game-screen').classList.contains('hidden'), 'un onglet fait quitter la partie');
        assert(doc.getElementById('nav-tab-stats').classList.contains('active'));
    });

    await t('préférence sideBar retirée : la valeur stockée est ignorée sans erreur, B ne fait plus rien', async () => {
        for (const v of ['rail', 'wide', 'x']) {
            const { w, doc, errors } = await side({ chessTrainer_settings: JSON.stringify({ sideBar: v }) });
            assert.deepStrictEqual(errors, [], 'lancement sans erreur avec sideBar = ' + v);
            assert(!('sideBar' in w.eval('appSettings')), 'plus de préférence');
            assert(!doc.documentElement.hasAttribute('data-side'));
            assert.strictEqual(typeof w.sideBarMode, 'undefined');
        }
        const { w, doc, errors } = await side();
        doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        assert.deepStrictEqual(errors, []);
        assert(!doc.querySelector('.sb-menu, #side-toggle'));
        w.eval('setPref("thumbHand", "left")');
        assert(!/sideBar/.test(w.localStorage.getItem('chessTrainer_settings') || ''), 'disparaît au prochain enregistrement');
        assert(!/barre latérale/i.test(JSON.stringify(w.eval('KEYBOARD_SHORTCUTS'))), 'plus de touche B dans la liste');
    });

    await t('Paramètres : plus de réglage « Barre latérale »', async () => {
        const { w } = await side();
        assert(!JSON.stringify(w.eval('settingsSearchIndex()')).includes('Barre latérale'));
    });

    await t('séance : data-session suit la séance guidée', async () => {
        const { doc, w } = await side();
        w.eval('gameMode = "training"; trainingState.session = { kind: "due", items: [{}], cur: 0, i: 0 }; try { Suite.refresh(); } catch (e) {}');
        assert(doc.documentElement.hasAttribute('data-session'));
        w.eval('trainingState.session = null; gameMode = "play"; Suite.refresh();');
        assert(!doc.documentElement.hasAttribute('data-session'));
    });

    await t('sous 1 100 px : les onglets restent ce qu’ils étaient', async () => {
        let mq;
        const { dom } = await bootApp({ before: w => { mq = listener(w, true); w.scrollTo = () => {}; } });
        const doc = dom.window.document;
        mq.cb({ matches: false });
        assert(!doc.querySelector('.sb-menu') && !doc.querySelector('#side-toggle'));
        assert(!doc.querySelector('#nav-tab-play').hasAttribute('tabindex'));
        assert.strictEqual(doc.querySelector('#nav-tab-play').nextElementSibling.id, 'nav-tab-openings', 'filets entre onglets intacts');
    });

    console.log(`\n${n} tests passés`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
