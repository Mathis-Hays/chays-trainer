/**
 * domain/games/evalCache.js
 * ──────────────────────────────────────────────────────────────────────────
 * Évaluations d'ouverture gardées sur l'appareil (chantier « Progrès : qualité et médailles », point 1, option C).
 * Les premiers coups se répètent d'une partie à l'autre : leur évaluation est rangée par positionKey (sans compteurs),
 * pour toutes les parties et tous les lancements suivants.
 *   EvalCache.ready()            charge la base en mémoire (une seule fois) ; sans IndexedDB : mémoire de la session.
 *   EvalCache.get(clé)           { cp, d } ou null (cp du point de vue des Blancs, mat : ±(MATE − n) ; d : profondeur).
 *   EvalCache.put(clé, cp, d)    garde la valeur si elle est plus profonde que celle connue ; écrite au prochain flush().
 *   EvalCache.cloud(fen, clé)    évaluation en nuage de Lichess (/api/cloud-eval) quand elle existe, sinon null.
 *                                Requête sans cookie ni donnée personnelle (la FEN seule) ; hors ligne, refus, lenteur : null, en silence.
 *                                Une réponse 429 (trop de requêtes) ou une erreur réseau coupe le nuage jusqu'au resume() suivant.
 * Seules les positions des MAX_PLY premiers demi-coups sont gardées. Stockage IndexedDB « chays-evals » : recalculable,
 * ni sauvegardé ni synchronisé ; MAX positions au plus.
 */

'use strict';

const EvalCache = (function () {
    const DB = 'chays-evals', STORE = 'pos', MAX_PLY = 24, MAX = 60000, CLOUD_URL = 'https://lichess.org/api/cloud-eval', CLOUD_MS = 2500, CLOUD_DEPTH = 20;
    const mem = new Map(), missed = new Set();
    let dbp = null, loaded = null, dirty = [], cloudOff = false;

    function db() {
        if (dbp) return dbp;
        dbp = new Promise(resolve => {
            try {
                if (typeof indexedDB === 'undefined') { resolve(null); return; }
                const rq = indexedDB.open(DB, 1);
                rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'k' });
                rq.onsuccess = () => resolve(rq.result);
                rq.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
        return dbp;
    }

    function ready() {
        if (loaded) return loaded;
        loaded = (async () => {
            const d = await db();
            if (!d) return;
            const rows = await new Promise(resolve => {
                try {
                    const rq = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
                    rq.onsuccess = () => resolve(rq.result || []);
                    rq.onerror = () => resolve([]);
                } catch (e) { resolve([]); }
            });
            rows.forEach(r => { if (r && typeof r.k === 'string' && Number.isFinite(r.cp)) { const old = mem.get(r.k); if (!old || old.d < r.d) mem.set(r.k, { cp: r.cp, d: r.d || 0 }); } });
        })();
        return loaded;
    }

    const get = k => mem.get(k) || null;

    function put(k, cp, d) {
        if (!k || !Number.isFinite(cp)) return;
        const old = mem.get(k);
        if (old && old.d >= d) return;
        if (!old && mem.size >= MAX) return;
        mem.set(k, { cp, d });
        dirty.push({ k, cp, d, at: Date.now() });
    }

    async function flush() {
        if (!dirty.length) return;
        const rows = dirty;
        dirty = [];
        const d = await db();
        if (!d) return;
        await new Promise(resolve => {
            try {
                const tx = d.transaction(STORE, 'readwrite'), os = tx.objectStore(STORE);
                rows.forEach(r => os.put(r));
                tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
            } catch (e) { resolve(); }
        });
    }

    // ─── NUAGE DE LICHESS ────────────────────────────────────────────────────
    const offline = () => typeof Net !== 'undefined' && !Net.online();
    const MATE = () => (typeof GameArchive !== 'undefined' ? GameArchive.MATE : 10000);

    async function cloud(fen, k) {
        if (cloudOff || missed.has(k) || typeof fetch !== 'function' || offline()) return null;
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctrl ? setTimeout(() => ctrl.abort(), CLOUD_MS) : null;
        try {
            const r = await fetch(`${CLOUD_URL}?fen=${encodeURIComponent(fen)}`, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined });
            if (r.status === 429) { cloudOff = true; return null; }
            if (!r.ok) { missed.add(k); return null; }
            const data = await r.json(), p = data && Array.isArray(data.pvs) ? data.pvs[0] : null;
            if (!p) { missed.add(k); return null; }
            const cp = Number.isFinite(p.mate) ? (p.mate > 0 ? MATE() - p.mate : -MATE() - p.mate) : p.cp;
            if (!Number.isFinite(cp)) { missed.add(k); return null; }
            put(k, cp, Math.max(CLOUD_DEPTH, Number(data.depth) || 0));
            return cp;
        } catch (e) { cloudOff = true; return null; }               // hors ligne, délai dépassé : plus de nuage pour cette fois
        finally { if (timer) clearTimeout(timer); }
    }

    // Nouvelle exécution : le nuage est retenté (la connexion a pu revenir).
    const resume = () => { cloudOff = false; };

    return { MAX_PLY, ready, get, put, flush, cloud, resume, size: () => mem.size, _clear: () => { mem.clear(); missed.clear(); dirty = []; cloudOff = false; } };
})();
