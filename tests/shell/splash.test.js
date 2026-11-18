// Lancer : node tests/shell/splash.test.js   — écran de lancement : version longue une fois par appareil (« la plume »),
// courte ensuite (« la gravure »). Seuls les scripts en ligne d'index.html tournent (aucune ressource chargée) ;
// requestAnimationFrame et la géométrie SVG sont simulés pour suivre la plume et l'encre.
// Rideau : il attend app:ready (Bus, premier rendu de l'accueil), puis intro:done libère les tâches lourdes (Bus.afterIntro).
const { scriptPath } = require('../_app.js');
const fs = require('fs'), assert = require('assert');
const { JSDOM } = require('jsdom');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const html = fs.readFileSync('index.html', 'utf8');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

function open(storage = {}) {
    const frames = [], anims = [];
    const dom = new JSDOM(html, {
        url: 'https://chays.test/app/', runScripts: 'dangerously',
        beforeParse(w) {
            Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
            w.matchMedia = () => ({ matches: false, addEventListener() {} });
            w.requestAnimationFrame = cb => frames.push(cb);
            w.Element.prototype.animate = function (kf, opt) { anims.push({ el: this, kf, opt }); return { finished: Promise.resolve(), cancel() {} }; };
            w.SVGElement.prototype.getTotalLength = () => 100;
            w.SVGElement.prototype.getPointAtLength = l => ({ x: 200 + l, y: 100 });
            w.SVGElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 140, height: 320, right: 140, bottom: 320 });
        }
    });
    const w = dom.window, start = w.performance.now();
    const frame = ms => { const cbs = frames.splice(0); cbs.forEach(cb => cb(start + ms)); };
    return { w, d: w.document, anims, frame };
}

t('première ouverture sur l\'appareil : version longue, jour noté', () => {
    const { w, d } = open();
    assert(d.documentElement.classList.contains('splashing') && !d.documentElement.classList.contains('splash-quick'));
    assert.strictEqual(w.localStorage.getItem('chessTrainer_splashDay'), today());
});

t('la plume : encre sous les contours, qui monte de la base vers la croix ; le point suit le trait', () => {
    const { d, frame } = open();
    const ink = d.querySelector('.sp-ink'), rect = d.querySelector('#sp-ink-clip rect'), nib = d.querySelector('.sp-nib');
    assert(ink && ink.querySelectorAll('path').length === 3, 'copie des trois parties pleines');
    assert(!ink.querySelector('[id]'), 'pas d\'identifiant en double');
    assert(d.getElementById('piece').classList.contains('sp-outline'), 'contours sans remplissage');
    frame(100);
    assert.strictEqual(+rect.getAttribute('y'), 354, 'encre pas encore montée à 0,1 s');
    assert.strictEqual(nib.style.opacity, '1', 'la plume trace le socle');
    frame(630);
    const y = +rect.getAttribute('y');
    assert(y < 354 && y > 34, 'encre à mi-hauteur à 0,63 s');
    frame(900);
    assert.strictEqual(+rect.getAttribute('y'), 34, 'encre en haut à 0,9 s');
    frame(1050);
    assert.strictEqual(nib.style.opacity, '1', 'la plume écrit la signature');
    frame(1300);
    assert.strictEqual(nib.style.opacity, '0', 'plume rangée après la signature');
});

t('ouvertures suivantes, même un autre jour : version courte, seule la gravure se réécrit en 0,3 s', () => {
    const { d, anims } = open({ chessTrainer_splashDay: '2026-1-1' });
    assert(d.documentElement.classList.contains('splash-quick'));
    assert(!d.querySelector('.sp-ink'), 'pas de tracé complet');
    const grav = anims.filter(a => a.el.id === 'gravure-trait');
    assert(grav.length && grav.every(a => (a.opt.delay || 0) + a.opt.duration <= 300));
    assert.strictEqual(anims.filter(a => a.el.id !== 'gravure-trait').length, 0);
});

t('sortie : la plume après sa suspension de 1,2 s, atterrissage × 0,5 ; courte sans suspension, atterrissage de 0,35 s ; un toucher écourte la plume', () => {
    const splash = fs.readFileSync(scriptPath('splash.js'), 'utf8'), css = fs.readFileSync('css/splash.css', 'utf8');
    assert(/const SPEED\s+= QUICK \? \.25 : \.5;/.test(splash) && /IntroTimeline\.land\(splash, SPEED\)/.test(splash));
    assert(/const held = QUICK \? Promise\.resolve\(\) : Promise\.race\(\[hold \?/.test(splash), 'courte : aucune suspension');
    assert(/\['pointerdown', 'keydown'\]/.test(splash), 'toucher pour passer');
    assert(!/splash-quick \.splash \{ animation-duration/.test(css), 'plus de suspension courte en CSS');
    assert(/\.ct-wm-1 \{ animation: spWrite \.25s linear \.94s both; \}/.test(css), 'signature au rythme de la plume (0,94 → 1,19 s)');
    assert(/animation: spHold 1\.2s linear both;/.test(css), 'suspension de 1,2 s');
    assert(/function land\(splash, speed = 1\)/.test(fs.readFileSync(scriptPath('introTimeline.js'), 'utf8')));
});

t('cascade : barres jamais animées, blocs en fill « backwards » (rien de figé ni d\'invisible après coup), logo caché le temps du vol seulement', () => {
    const intro = fs.readFileSync(scriptPath('introTimeline.js'), 'utf8'), css = fs.readFileSync('css/splash.css', 'utf8');
    assert(!/topnav-tab|topnav-right/.test(intro.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'onglets, pilule et barre latérale hors de la cascade');
    assert(/easing: EASE\.out, fill: 'backwards' \}/.test(intro), 'blocs de l\'accueil : fill backwards');
    assert(/hideDuring\(navPiece, S\.flipDur\)/.test(intro));
    assert(/\.splashing:not\(\.splash-out\) #logo-nav/.test(css) && !/\.splashing #logo-nav/.test(css), 'logo rendu dès la sortie');
});

// Rideau : jsdom réel, scripts bus.js puis splash.js exécutés à la main (sans IntroTimeline : sortie en fondu).
async function curtain(storage, early) {
    const { w, d, frame } = open(storage);
    w.Element.prototype.getAnimations = () => [];
    const run = f => w.eval(fs.readFileSync(scriptPath(f), 'utf8').replace(/^'use strict';$/m, '').replace(/^const (\w+) =/m, 'var $1 ='));
    w.reportError = () => {};
    run('bus.js');
    const log = [];
    w.Bus.on('intro:done', () => log.push('intro:done'));
    w.Bus.afterIntro(() => log.push('tâche lourde'));
    if (early) w.Bus.emit('app:ready');
    run('splash.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    return { w, d, frame, log, wait };
}

(async () => {
    {
        const { w, d, frame, log, wait } = await curtain({ chessTrainer_splashDay: '2026-1-1' });
        assert(d.documentElement.classList.contains('splash-quick'), 'ouverture courte');
        await wait(60); frame(100);
        assert(!d.documentElement.classList.contains('splash-out'), 'courte : le rideau attend app:ready');
        assert.deepStrictEqual(log, [], 'rien de lourd pendant l\'intro');
        w.Bus.emit('app:ready');
        await wait(20); frame(200);
        assert(d.documentElement.classList.contains('splash-out'), 'app:ready reçu : sortie sans suspension');
        await wait(760);
        assert(!d.getElementById('splash') && !d.documentElement.classList.contains('splashing'), 'splash retiré');
        assert.strictEqual(log[0], 'intro:done');
        await wait(30);
        assert.deepStrictEqual(log, ['intro:done', 'tâche lourde'], 'Bus.afterIntro : après la fin de l\'intro');
        n++; console.log('ok  ', 'rideau : attend app:ready (même l\'ouverture courte, sans suspension), puis intro:done libère les tâches lourdes');
    }
    {
        const { d, frame, wait } = await curtain({ chessTrainer_splashDay: '2026-1-1' }, true);   // app:ready parti avant splash.js
        await wait(20); frame(50);
        assert(d.documentElement.classList.contains('splash-out'));
        const src = fs.readFileSync(scriptPath('splash.js'), 'utf8');
        assert(/const APP_CAP\s+= 3000;/.test(src) && /Promise\.race\(\[appReady, until\(APP_CAP\)\]\)/.test(src), 'délai de garde si app:ready ne vient pas');
        assert(/Bus\.emit\('app:ready'\)/.test(fs.readFileSync(scriptPath('app.js'), 'utf8')), 'app.js annonce le premier rendu');
        n++; console.log('ok  ', 'rideau : app:ready déjà émis compte (Bus.when), garde de 3 s');
    }
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });

