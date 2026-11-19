/**
 * sw.js — service worker de Chays Trainer
 * ──────────────────────────────────────────────────────────────────────────
 * Rend l'application utilisable HORS LIGNE (tout est statique, les données sont
 * dans localStorage).
 *   - Code (HTML / JS / CSS / JSON) : cache d'abord, une version par déploiement (CODE_CACHE, nommé
 *     d'après BUILD). Un déploiement change BUILD, donc sw.js : le navigateur, qui revérifie sw.js à
 *     chaque lancement (une seule requête), installe le nouveau service worker, qui range tout le code
 *     de cette version dans un cache neuf, puis attend : ni skipWaiting ni clients.claim (chantier « Accueil et
 *     lancement », novembre 2026), une page déjà ouverte reste servie par sa version jusqu'au bout. Le nouveau
 *     service worker prend la main quand plus aucune page de l'ancien n'est ouverte, ou au lancement suivant : la page
 *     qui s'ouvre et trouve une version en attente lui envoie « take-over » puis se recharge une fois (mobile.js),
 *     sinon un onglet gardé ouvert ou une app installée resteraient sur l'ancienne version (un simple rechargement
 *     ne suffit pas). Les anciens caches ne sont supprimés qu'à ce moment. Code ancien et nouveau ne se mêlent jamais ; la nouvelle version s'ouvre au
 *     lancement suivant (toute première visite : la page n'est servie hors ligne qu'à partir de la suivante). Avant, chaque lancement redemandait les
 *     124 fichiers au réseau (2 à 8 s sur téléphone modeste).
 *     BUILD est écrit au déploiement par la commande de construction de vercel.json (commit). Sans lui
 *     (serveur local, tests) : réseau d'abord, comme avant.
 *   - Images (pièces, textures, logos) : cache d'abord, réseau seulement si absentes. Ne sont rangées d'office
 *     que celles d'index.html et du manifeste ; l'échiquier, le jeu de pièces et la langue choisis sont
 *     ajoutés par la page (message « keep », mobile.js), les autres le sont quand on les choisit.
 *   - Polices Google : cache d'abord, mises en cache à la première visite en ligne.
 *   - Moteur Stockfish (engine/<version>/) : cache à part (ENGINE_CACHE), rempli au premier usage
 *     seulement (il n'alourdit pas l'installation) ; à l'activation, les fichiers d'une autre version
 *     que celle d'engine/manifest.json sont supprimés, y compris le moteur complet téléchargé (unpkg).
 * Si tu modifies un fichier d'image existant, incrémente VERSION pour forcer le rafraîchissement.
 *
 * Liste de mise en cache : construite à l'installation à partir des balises src / href d'index.html
 * (scripts, feuilles de style, logos, icônes), complétée par EXTRA (ressources citées seulement dans le
 * manifeste) et par ON_DEMAND (scripts chargés à la demande, absents d'index.html : lecture d'une image d'échiquier,
 * positionEditor.js ; même liste des deux côtés, tests/app/swCache.test.js). Ajouter un script dans index.html suffit.
 */
const VERSION = 'v23';
const BUILD   = '__BUILD__';
const STAMPED = !BUILD.startsWith('__');
const CACHE   = 'chays-trainer-' + VERSION;                     // images et polices
const CODE_CACHE = 'chays-code-' + (STAMPED ? BUILD : 'local');
const ENGINE_CACHE = 'chays-engine';
const ENGINE_FILE  = /\/engine\/\d+\.\d+\.\d+\//;

const EXTRA = [
    './', 'manifest.json',
    'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/icon-mono-512.png'
];

// Scripts chargés à la demande par la page (PositionEditor.ON_DEMAND) : rangés avec le reste du code, hors ligne dès l'installation.
const ON_DEMAND = ['js/domain/photo/pieceTemplates.js', 'js/domain/photo/boardReader.js'];

// Ressources locales référencées par index.html (les liens externes et les ancres sont ignorés).
async function pageAssets() {
    try {
        const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
        return [...html.matchAll(/\s(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
    } catch (e) { return ['index.html']; }
}

const CODE_PATH = /\.(?:html|js|css|json)$/;
const isCodePath = u => u === './' || CODE_PATH.test(new URL(u, self.location.href).pathname);
// Demandé au serveur, jamais au cache HTTP : une version entière, celle de ce BUILD.
const fresh = u => new Request(new URL(u, self.location.href).href, { cache: 'no-cache' });

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const [code, media, page] = await Promise.all([caches.open(CODE_CACHE), caches.open(CACHE), pageAssets()]);
        const all = [...new Set(EXTRA.concat('index.html', page, ON_DEMAND))];
        // Code : tout ou rien quand la version est datée (sinon un fichier manquant viendrait plus tard d'un autre
        // déploiement) ; l'ancien service worker garde alors la main et l'installation sera retentée.
        const codeDone = Promise.all(all.filter(isCodePath).map(u => code.add(fresh(u)).catch(err => { if (STAMPED) throw err; })));
        const mediaDone = Promise.all(all.filter(u => !isCodePath(u)).map(u => media.add(u).catch(() => {})));   // une image absente n'empêche rien
        await Promise.all([codeDone, mediaDone]);           // puis attente : pas de skipWaiting (voir l'en-tête)
    })());
});

// La page signale l'échiquier, le jeu de pièces et la langue en usage (adresses de même origine) : rangés s'ils manquent.
self.addEventListener('message', e => {
    const d = e.data || {};
    // Au lancement seulement (mobile.js) : la page qui vient de s'ouvrir demande à la version en attente de
    // prendre la main, puis se recharge une fois. Jamais pendant l'usage : une page ouverte n'est pas prise.
    if (d.type === 'take-over') { self.skipWaiting(); return; }
    if (d.type !== 'keep' || !Array.isArray(d.urls)) return;
    const urls = d.urls.filter(u => typeof u === 'string' && new URL(u, self.location.href).origin === self.location.origin).slice(0, 80);
    const job = Promise.all(urls.map(async u => {
        const cache = await caches.open(isCodePath(u) ? CODE_CACHE : CACHE);
        if (!(await cache.match(u))) await cache.add(u).catch(() => {});
    }));
    if (e.waitUntil) e.waitUntil(job);
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => (k.startsWith('chays-trainer-') && k !== CACHE) || (k.startsWith('chays-code-') && k !== CODE_CACHE)).map(k => caches.delete(k))))
            .then(pruneEngine)                                // pas de clients.claim : aucune page ouverte n'est reprise
    );
});

// Moteur : ne garde que les fichiers de la version annoncée par engine/manifest.json.
async function pruneEngine() {
    try {
        const { version } = await (await fetch('engine/manifest.json', { cache: 'no-cache' })).json();
        const cache = await caches.open(ENGINE_CACHE);
        const reqs  = await cache.keys();
        const keep = p => p.includes(`/engine/${version}/`) || p.includes(`/stockfish@${version}/`);      // moteur complet (unpkg) compris
        await Promise.all(reqs.filter(r => !keep(new URL(r.url).pathname)).map(r => cache.delete(r)));
    } catch (e) { /* hors ligne : on réessaiera à la prochaine activation */ }
}

// Polices Google : la feuille (fonts.googleapis.com) et les fichiers (fonts.gstatic.com) ne changent pas.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function isCode(req) {
    if (req.mode === 'navigate') return true;
    return CODE_PATH.test(new URL(req.url).pathname);
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (FONT_HOSTS.includes(url.hostname)) {                    // police Inter : cache d'abord, pour l'avoir hors ligne
        e.respondWith(
            caches.match(req).then(hit => hit || fetch(req).then(res => {
                if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                return res;
            }))
        );
        return;
    }
    if (url.origin !== self.location.origin) return;            // API Chess.com / Lichess / Supabase : on ne s'en mêle pas
    // Paquets de langue à télécharger : ni dans le cache de l'application, ni servis par lui (i18n.js, cache chays-lang).
    if (/\/lang\/(?!en\.json|es\.json|zh-Hans\.json)[^/]+\.json$/.test(url.pathname) && !url.pathname.endsWith('/manifest.json')) return;

    // Moteur : fichiers versionnés, jamais modifiés. Rangés sans le fragment et rendus dans une réponse neuve
    // (sans adresse) : le Worker garde ainsi l'adresse demandée, dont le fragment « #blob:… » qui désigne le
    // .wasm du moteur complet. Une réponse sortie telle quelle du cache imposerait le fragment du premier
    // chargement, une adresse blob: révoquée depuis.
    if (ENGINE_FILE.test(url.pathname)) {
        const key = url.origin + url.pathname + url.search;
        e.respondWith(
            caches.open(ENGINE_CACHE).then(cache => cache.match(key).then(hit => hit || fetch(key).then(res => {
                if (res.ok) cache.put(key, res.clone());
                return res;
            }))).then(res => new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }))
        );
        return;
    }

    if (isCode(req)) {
        const keep = res => { if (res.ok) { const copy = res.clone(); caches.open(CODE_CACHE).then(c => c.put(req, copy)); } return res; };
        const cached = () => caches.open(CODE_CACHE).then(c => c.match(req, { ignoreSearch: true })
            .then(hit => hit || (req.mode === 'navigate' ? c.match('index.html') : undefined)));
        if (!STAMPED) {                                          // serveur local, tests : réseau d'abord
            e.respondWith(fetch(req).then(keep).catch(() => cached()));
            return;
        }
        e.respondWith(cached().then(hit => hit || fetch(req).then(keep)));
        return;
    }

    // Images : cache d'abord, réseau seulement si absentes (une image remplacée change VERSION, donc de cache).
    e.respondWith(
        caches.match(req).then(hit => hit || fetch(req).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        }))
    );
});
