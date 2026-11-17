// Lancer : node tests/core/engrave.test.js   — le trait gravé et sa gravure progressive (Engrave.depth, atelier « L'envie de revenir », lot 2)
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console };
vm.createContext(ctx);
const f = scriptPath('engrave.js');
vm.runInContext(readVars(f), ctx, { filename: f });
const { Engrave } = ctx;
const tier = html => (html.match(/class="engrave-depth is-(\w+)"/) || [])[1];

t('trois paliers selon le score : rayé sous 50, creusé de 50 à 84, plein à partir de 85', () => {
    assert.strictEqual(tier(Engrave.depth(0)), 'scratch');
    assert.strictEqual(tier(Engrave.depth(49)), 'scratch');
    assert.strictEqual(tier(Engrave.depth(50)), 'cut');
    assert.strictEqual(tier(Engrave.depth(84)), 'cut');
    assert.strictEqual(tier(Engrave.depth(85)), 'deep');
});

t('doré dès que la position est Maîtrisée, quel que soit le score', () => {
    assert.strictEqual(tier(Engrave.depth(40, true)), 'gold');
});

t('--d suit le score, borné de 0 à 1 ; score illisible : 0', () => {
    assert.match(Engrave.depth(72), /--d:0\.72/);
    assert.match(Engrave.depth(140), /--d:1\.00/);
    assert.match(Engrave.depth(-3), /--d:0\.00/);
    assert.match(Engrave.depth('x'), /--d:0\.00/);
});

t('décoratif par défaut ; avec un libellé, une image nommée et échappée', () => {
    assert.match(Engrave.depth(60), /aria-hidden="true"/);
    const s = Engrave.depth(60, false, 'Maîtrise "60" <sur 100>');
    assert.match(s, /role="img" aria-label="Maîtrise &quot;60&quot; &lt;sur 100&gt;"/);
});

console.log(`\n${n} tests réussis.`);
