// Lancer : node tests/screens/settingsEssential.test.js   — Paramètres « Essentiel » (bilan « Chays épuré », lot 6) :
// la fenêtre s'ouvre sur huit réglages repris des rubriques, les autres suivent sous « Tous les réglages » ; un réglage
// d'Essentiel agit comme dans sa rubrique ; la recherche et la palette ne montrent pas de doublons.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const search = (w, q) => {
    const el = w.document.querySelector('#settings-overlay [data-pn="search"]');
    el.value = q;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
};

(async () => {
    const { dom, errors } = await bootApp({ before(w) { w.Element.prototype.scrollIntoView = function () {}; } });
    const w = dom.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];

    await t('ouverture : Essentiel d\'abord, puis « Tous les réglages »', () => {
        w.showSettings();
        const on = $('#settings-overlay .pn-nav button.is-on');
        assert.strictEqual(on.dataset.key, 'essentiel');
        const sep = $('#settings-overlay .pn-nav .pn-nav-sep');
        assert(sep && /Tous les réglages/.test(sep.textContent));
        assert.strictEqual(sep.nextElementSibling.dataset.key, 'apparence', 'les autres rubriques suivent l\'intertitre');
    });

    await t('huit réglages : mode, échiquier, pièces, objectif, sons, langue, sauvegarde, compte', () => {
        const prefs = $$('#settings-overlay .pn-content [data-pref]').map(r => r.dataset.pref);
        ['theme', 'boardTheme', 'pieceSet', 'dailyGoal', 'sound', 'lang'].forEach(p => assert(prefs.includes(p), p));
        assert(!prefs.includes('engineNet') && !prefs.includes('blindfold'), 'rien d\'avancé');
        assert($('#settings-overlay .pn-content [data-key="goSection"][data-v="donnees"]'), 'sauvegarde');
        assert($('#settings-overlay .pn-content [data-key="openAccount"]'), 'compte');
    });

    await t('un réglage d\'Essentiel agit comme dans sa rubrique', () => {
        $('#settings-overlay .pn-content [data-pn="seg"][data-key="dailyGoal"][data-v="60"]').click();
        assert.strictEqual(w.eval('appSettings.dailyGoal'), 60);
        $('#settings-overlay .pn-content [data-key="goSection"]').click();
        assert.strictEqual($('#settings-overlay .pn-nav button.is-on').dataset.key, 'donnees', 'la sauvegarde mène à sa rubrique');
        w.eval('appSettings.dailyGoal = 30');
    });

    await t('recherche et palette : pas de doublon venu d\'Essentiel', () => {
        w.showSettings();
        search(w, 'objectif');
        const hits = $$('#settings-overlay .pn-content [data-pref="dailyGoal"]');
        assert.strictEqual(hits.length, 1, 'un seul résultat');
        assert(!w.eval('settingsSearchIndex()').some(x => /^set:essentiel/.test(x.id)));
        search(w, '');
        w.closeSettings();
    });

    await t('aucune erreur de script', () => assert.deepStrictEqual(errors, []));
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
