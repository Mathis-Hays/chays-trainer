// Lancer : node tests/app/swCache.test.js   — service worker : code en cache d'abord, une version par déploiement.
// sw.js daté (BUILD écrit par la commande de construction de vercel.json) : le code vient de son cache sans requête,
// l'installation est tout ou rien pour le code, l'activation supprime le code des autres versions.
// Non daté (serveur local, tests) : réseau d'abord, comme avant. Message « keep » : images en usage rangées.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const ORIGIN = 'https://chays.test';
const SRC = fs.readFileSync('sw.js', 'utf8');
const HTML = '<script src="js/a.js"></script><link href="css/b.css"><img src="assets/brand/logo.png">';

function load({ build, failing = [] } = {}) {
    const stores = new Map(), fetched = [], listeners = {};
    const key = u => { const s = String(u && u.url ? u.url : u); return new URL(s, ORIGIN + '/').href.split('#')[0]; };
    const cache = () => {
        const m = new Map();
        return {
            m,
            match: async (u, o) => { let k = key(u); if (o && o.ignoreSearch) k = k.split('?')[0]; const r = m.get(k); return r ? r.clone() : undefined; },
            put: async (u, res) => { m.set(key(u), res); },
            add: async u => { const res = await ctx.fetch(u); if (!res.ok) throw new Error('absent'); m.set(key(u), res); },
            keys: async () => [...m.keys()].map(url => ({ url })),
            delete: async u => m.delete(key(u))
        };
    };
    const ctx = {
        self: { location: { origin: ORIGIN, href: ORIGIN + '/sw.js' }, addEventListener: (k, fn) => { listeners[k] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
        caches: {
            open: async k => { if (!stores.has(k)) stores.set(k, cache()); return stores.get(k); },
            keys: async () => [...stores.keys()], delete: async k => stores.delete(k),
            match: async u => { for (const c of stores.values()) { const r = await c.match(u); if (r) return r; } }
        },
        fetch: async u => {
            const url = key(u); fetched.push(url.replace(ORIGIN + '/', ''));
            if (failing.some(f => url.endsWith(f))) return new Response('', { status: 404 });
            if (url.endsWith('engine/manifest.json')) return new Response('{"version":"1.0.0"}', { status: 200 });
            return new Response(url.endsWith('index.html') ? HTML : 'net:' + url, { status: 200 });
        },
        URL, Response, Request, Promise, console
    };
    vm.createContext(ctx);
    vm.runInContext(build ? SRC.replace("'__BUILD__'", `'${build}'`) : SRC, ctx);
    const run = async (kind, ev = {}) => { let p; listeners[kind](Object.assign({ waitUntil: x => { p = x; } }, ev)); await p; };
    const get = (path, mode = 'cors') => { let p = null; listeners.fetch({ request: new Proxy({ method: 'GET', mode, url: ORIGIN + '/' + path }, {}), respondWith: r => { p = r; } }); return p; };
    return { ctx, stores, fetched, run, get };
}

(async () => {
    await t('daté : le code est rangé à l\'installation, puis servi du cache sans aucune requête', async () => {
        const sw = load({ build: 'abc' });
        await sw.run('install');
        assert(sw.stores.has('chays-code-abc'));
        const code = [...sw.stores.get('chays-code-abc').m.keys()].map(k => k.replace(ORIGIN + '/', '')).sort();
        assert.deepStrictEqual(code, ['', 'css/b.css', 'index.html', 'js/a.js', 'js/domain/photo/boardReader.js', 'js/domain/photo/pieceTemplates.js', 'manifest.json']);
        assert(sw.stores.get('chays-trainer-v23').m.has(ORIGIN + '/assets/brand/logo.png'), 'images à part');
        sw.fetched.length = 0;
        assert.strictEqual(await (await sw.get('js/a.js')).text(), 'net:' + ORIGIN + '/js/a.js');
        assert.strictEqual(await (await sw.get('?from=home', 'navigate')).text(), 'net:' + ORIGIN + '/', 'navigation : la page rangée (« ./ »)');
        assert.strictEqual(await (await sw.get('ailleurs/', 'navigate')).text(), HTML, 'autre adresse : index.html du cache');
        assert.deepStrictEqual(sw.fetched, [], 'aucune requête au lancement');
    });
    await t('daté : un fichier de code absent fait échouer l\'installation (l\'ancienne version garde la main)', async () => {
        const sw = load({ build: 'abc', failing: ['css/b.css'] });
        await assert.rejects(sw.run('install'));
    });
    await t('non daté : réseau d\'abord, installation tolérante', async () => {
        const sw = load({ failing: ['css/b.css'] });
        await sw.run('install');
        sw.fetched.length = 0;
        await sw.get('js/a.js');
        assert.deepStrictEqual(sw.fetched, ['js/a.js']);
    });
    await t('activation : le code des autres versions et l\'ancien cache unique sont supprimés', async () => {
        const sw = load({ build: 'new' });
        await sw.ctx.caches.open('chays-code-old'); await sw.ctx.caches.open('chays-trainer-v22');
        await sw.run('install'); await sw.run('activate');
        assert.deepStrictEqual([...sw.stores.keys()].filter(k => k !== 'chays-engine').sort(), ['chays-code-new', 'chays-trainer-v23']);
    });
    await t('message « keep » : les images en usage sont rangées, les adresses étrangères ignorées', async () => {
        const sw = load({ build: 'abc' });
        await sw.run('message', { data: { type: 'keep', urls: ['assets/pieces/maestro/wK.svg', 'assets/boards/walnut.webp', 'https://ailleurs.test/x.png'] } });
        const media = [...sw.stores.get('chays-trainer-v23').m.keys()];
        assert.deepStrictEqual(media.sort(), [ORIGIN + '/assets/boards/walnut.webp', ORIGIN + '/assets/pieces/maestro/wK.svg']);
    });
    await t('scripts chargés à la demande (lecture d\'une image) : mêmes fichiers que l\'éditeur, rangés à l\'installation, servis hors ligne', async () => {
        const { scriptPath } = require('../_app.js');
        const page = fs.readFileSync(scriptPath('positionEditor.js'), 'utf8').match(/const ON_DEMAND = (\[[^\]]*\])/)[1];
        const worker = SRC.match(/const ON_DEMAND = (\[[^\]]*\])/)[1];
        const list = JSON.parse(page.replace(/'/g, '"'));
        assert.deepStrictEqual(JSON.parse(worker.replace(/'/g, '"')), list, 'sw.js et positionEditor.js');
        list.forEach(f => assert(fs.existsSync(f), f + ' existe'));
        assert(!fs.readFileSync('index.html', 'utf8').includes('boardReader.js'), 'pas dans index.html : chargé à la demande');
        const sw = load({ build: 'abc' });
        await sw.run('install');
        sw.fetched.length = 0;
        for (const f of list) assert.strictEqual(await (await sw.get(f)).text(), 'net:' + ORIGIN + '/' + f);
        assert.deepStrictEqual(sw.fetched, [], 'servis du cache, sans réseau');
    });
    await t('une nouvelle version ne prend pas une page déjà ouverte : ni skipWaiting ni clients.claim', async () => {
        const calls = [];
        const sw = load({ build: 'new' });
        sw.ctx.self.skipWaiting = async () => { calls.push('skipWaiting'); };
        sw.ctx.self.clients.claim = async () => { calls.push('claim'); };
        await sw.run('install'); await sw.run('activate');
        assert.deepStrictEqual(calls, []);
        const code = SRC.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
        assert(!/clients\.claim\s*\(/.test(code), 'aucun clients.claim dans sw.js');
        assert.strictEqual((code.match(/skipWaiting\s*\(/g) || []).length, 1, 'skipWaiting seulement sur demande de la page');
    });
    await t('au lancement, la page peut faire prendre la main à la version en attente (« take-over »)', async () => {
        const calls = [];
        const sw = load({ build: 'new' });
        sw.ctx.self.skipWaiting = () => { calls.push('skipWaiting'); };
        await sw.run('message', { data: { type: 'keep', urls: [] } });
        assert.deepStrictEqual(calls, [], '« keep » ne prend pas la main');
        await sw.run('message', { data: { type: 'take-over' } });
        assert.deepStrictEqual(calls, ['skipWaiting']);
        const mobile = fs.readFileSync(require('../_app.js').scriptPath('mobile.js'), 'utf8');
        assert(/type:\s*'take-over'/.test(mobile) && /Date\.now\(\)\s*-\s*opened\s*>\s*6000/.test(mobile), 'mobile.js : demandé au lancement seulement');
        assert(/location\.reload\(\)/.test(mobile) && /reloaded/.test(mobile), 'mobile.js : un seul rechargement');
    });
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
