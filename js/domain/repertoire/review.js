/**
 * domain/repertoire/review.js
 * ──────────────────────────────────────────────────────────────────────────
 * Répétition espacée : échéances, programme des révisions, score de maîtrise, note d'un passage.
 */

'use strict';

const DAY_MS           = 86400000;

const REVIEW_GROWTH    = 2.5;

// Rythme des révisions (Paramètres › Jeu) : Doux espace davantage les révisions, Intensif les rapproche.
const REVIEW_RHYTHM    = { soft: 3.2, std: REVIEW_GROWTH, intense: 1.8 };

function reviewGrowth() {
    return (typeof appSettings !== 'undefined' && REVIEW_RHYTHM[appSettings.rhythm]) || REVIEW_GROWTH;
}

const REVIEW_MAX_DAYS  = 180;

const REVIEW_RETRY_MS  = 10 * 60000;

// Intervalle (jours) estimé pour une position sans planning : 0 = jamais revue.
function impliedInterval(e) {
    if (!e.lastReviewed || !e.attempts) return 0;
    const rate = e.failures / e.attempts;
    return rate > 0.34 ? 1 : e.failures ? 3 : Math.min(30, 1 + e.attempts);
}

const dueOf = e => e.due || (e.lastReviewed ? e.lastReviewed + impliedInterval(e) * DAY_MS : 0);

const isDue = (e, now = Date.now()) => dueOf(e) <= now;

// ─── OBJECTIF DU JOUR : PLAFOND (chantier « Révision du jour », 18 novembre 2026) ───
// Un seul programme par répertoire (les deux couleurs), lu par l'Entraînement, l'accueil, les Statistiques et
// la puce de répertoire, pour que tous les chiffres concordent. L'objectif du jour (dailyGoal : 15, 30 ou 60) est
// un plafond : la file du jour n'en propose jamais plus, essais déjà faits aujourd'hui déduits.
//   - révisions : positions déjà travaillées (attempts > 0) échues avant la fin du jour, triées par importance
//     (_reviewImportance) ; celles qui dépassent le plafond attendent (« en attente », plan.held) ;
//   - veille : avec assez de parties archivées (SeenPositions.MIN), une position jamais atteinte en partie passe après
//     toutes les autres (hors file « À revoir » et « Traitée depuis ») : elle ne revient que quand le reste est à jour ;
//   - nouvelles : positions jamais révisées, newPerDay() par jour (objectif ÷ 5), en pause tant qu'une révision attend ;
//     « Traitée depuis » (prio) d'abord, puis dans l'ordre d'enregistrement et de la ligne.
// Les jours suivants sont simulés : chaque position prise revient à son prochain intervalle, sauf une sur 1 ÷ (part
// d'erreurs des 30 derniers jours, _reviewFailRate), tirée sans hasard, qui repart dans la file « À revoir » :
// prévision, prochaine révision et date « à jour vers… » (plan.catchUp) en découlent.
const DAILY_GOALS = [15, 30, 60];

const DAILY_GOAL_DEFAULT = 30;

const REVIEW_SIM_DAYS = 400;               // horizon de la simulation (au-delà : « pas à ce rythme »)

function reviewGoal() {
    const g = typeof appSettings !== 'undefined' && appSettings.dailyGoal;
    return DAILY_GOALS.includes(g) ? g : DAILY_GOAL_DEFAULT;
}

function newPerDay() {
    return Math.max(1, Math.round(reviewGoal() / 5));
}

// Positions déjà notées aujourd'hui (journal d'activité) : elles comptent dans le plafond du jour.
function _reviewDoneToday(now) {
    if (typeof readActivity !== 'function' || typeof dayStamp !== 'function') return 0;
    const d = readActivity()[dayStamp(now)];
    return d && Number.isFinite(d.a) ? d.a : 0;
}

// Part d'erreurs des 30 derniers jours (journal d'activité), pour la simulation : 15 % sans assez d'essais (moins de 30).
const REVIEW_FAIL_DEFAULT = 0.15;

function _reviewFailRate(now) {
    if (typeof readActivity !== 'function' || typeof dayStamp !== 'function') return REVIEW_FAIL_DEFAULT;
    const act = readActivity(), from = dayStamp(now - 30 * DAY_MS);
    let a = 0, f = 0;
    Object.keys(act).forEach(k => { if (k >= from && act[k]) { a += act[k].a || 0; f += act[k].f || 0; } });
    return a < 30 ? REVIEW_FAIL_DEFAULT : Math.min(0.5, Math.max(0, f / a));
}

// Ordre d'importance de la file du jour : file « À revoir », « Traitée depuis », vue en partie (les plus jouées
// d'abord), en veille en dernier ; puis demi-coup le plus bas, maîtrise la plus basse, échéance la plus ancienne.
function _reviewImportance(a, b) {
    return a.rank - b.rank || b.seen - a.seen || (a.e.ply || 0) - (b.e.ply || 0) || a.m - b.m || a.at - b.at
        || (a.color + a.key < b.color + b.key ? -1 : a.color + a.key > b.color + b.key ? 1 : 0);
}

// plan.today(couleur, clé) ; plan.todayList(filtre) : la file du jour, dans l'ordre ; plan.dayOf(couleur, clé) : jour
// prévu (0 = aujourd'hui) ; plan.forecast(filtre, jours) : positions proposées chaque jour, chacune comptée une fois, le
// jour où elle passe (les retours simulés après une révision servent à la date « à jour vers… », pas à la prévision) ;
// plan.held(filtre) (= plan.overdue) : révisions échues qui attendent au-delà du plafond ; plan.asleep(filtre) : dont
// en veille ; plan.next(filtre) : instant de la prochaine révision après aujourd'hui (Infinity s'il n'y en a pas) ;
// plan.catchUp() : { days, at } du premier jour sans attente, null au-delà de l'horizon ; plan.goal, plan.left.
// filtre(couleur, clé) facultatif : la portée affichée (une couleur, une ouverture).
// opts.left : nombre de positions à proposer aujourd'hui au lieu de « objectif − déjà fait » (« Encore 30 ») ;
// opts.failRate : part d'erreurs supposée par la simulation (sinon celle des 30 derniers jours).
function reviewPlan(rep = currentRepertoire, now = Date.now(), opts = {}) {
    const d0 = new Date(now), start = i => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime();
    const items = repertoireRows(rep), goal = reviewGoal(), k = newPerDay();
    const left = Number.isFinite(opts.left) ? Math.max(0, opts.left) : Math.max(0, goal - _reviewDoneToday(now));
    const SP = typeof SeenPositions !== 'undefined' && SeenPositions.ready && SeenPositions.ready() ? SeenPositions : null;
    const seenOn = !!SP && items.filter(x => SP.has(x.color, x.key)).length >= SP.MIN;
    items.forEach(x => {
        x.fresh = !x.e.attempts && dueOf(x.e) <= now;   // une échéance future explicite est respectée comme une révision
        x.at = dueOf(x.e);
        x.seen = seenOn ? SP.count(x.color, x.key) : 0;
        x.rank = Number.isInteger(x.e.relearn) ? 0 : x.e.prio ? 1 : !seenOn || x.seen ? 2 : 3;
        x.m = masteryOf(x.e);
        x.day = Infinity;
    });
    const fresh = items.filter(x => x.fresh)
        .sort((a, b) => (b.e.prio ? 1 : 0) - (a.e.prio ? 1 : 0) || (a.e.created || 0) - (b.e.created || 0) || (a.e.ply || 0) - (b.e.ply || 0));
    const growth = reviewGrowth(), failRate = Number.isFinite(opts.failRate) ? opts.failRate : _reviewFailRate(now);
    let miss = 0;
    let sims = items.filter(x => !x.fresh).map(x => ({ x, due: x.at, iv: x.e.interval || impliedInterval(x.e), rl: x.e.relearn }));
    const takes = [], heldAt = [];
    let ran = -1, nf = 0, caught = null;
    // Un jour de la simulation : la file (échéances avant la fin du jour), le plafond, puis les nouvelles s'il reste de la place.
    function step(i) {
        const end = start(i + 1), cap = i === 0 ? left : goal;
        const pool = sims.filter(s => s.due < end).sort((a, b) => _reviewImportance(a.x, b.x));
        const take = pool.slice(0, cap), day = take.map(s => ({ x: s.x, at: Math.max(s.due, start(i)), first: s.x.day === Infinity }));
        heldAt[i] = pool.slice(cap).map(s => s.x);
        take.forEach(s => {
            if (s.x.day === Infinity) s.x.day = i;
            miss += failRate;
            if (miss >= 1) { miss -= 1; s.rl = 0; s.iv = 0; s.due = start(i + 1); return; }   // erreur attendue : file « À revoir »
            if (Number.isInteger(s.rl)) { s.iv = RELEARN_DAYS[s.rl]; s.rl = s.rl + 1 >= RELEARN_DAYS.length ? undefined : s.rl + 1; }
            else s.iv = s.iv ? Math.min(REVIEW_MAX_DAYS, s.iv * growth) : 1;
            s.due = start(i + Math.max(1, Math.round(s.iv)));
        });
        if (!heldAt[i].length) {
            if (caught === null) caught = i;
            const room = Math.min(k, cap - take.length, fresh.length - nf);
            for (let j = 0; j < room; j++) {
                const x = fresh[nf++];
                x.day = i;
                day.push({ x, at: start(i), first: true });
                sims.push({ x, due: start(i + 1), iv: 1 });
            }
        }
        takes[i] = day;
        ran = i;
    }
    const runTo = d => { while (ran < Math.min(d, REVIEW_SIM_DAYS - 1)) step(ran + 1); };
    runTo(0);
    const byId = new Map(items.map(x => [x.color + '|' + x.key, x]));
    const inF = filter => x => !filter || filter(x.color, x.key);
    function dayOf(color, key) {
        const x = byId.get(color + '|' + key);
        if (!x) return Infinity;
        while (x.day === Infinity && ran < REVIEW_SIM_DAYS - 1) runTo(ran + 1);
        return x.day;
    }
    const held = filter => heldAt[0].filter(inF(filter)).length;
    return {
        goal, left,
        dayOf,
        today: (color, key) => { const x = byId.get(color + '|' + key); return !!x && x.day === 0; },
        todayList: filter => takes[0].map(t => t.x).filter(inF(filter)).map(x => ({ color: x.color, key: x.key })),
        forecast(filter, days = 7) {
            runTo(days - 1);
            return Array.from({ length: days }, (_, i) => (takes[i] || []).filter(t => t.first && inF(filter)(t.x)).length);
        },
        held,
        overdue: held,
        asleep: filter => heldAt[0].filter(x => x.rank === 3 && inF(filter)(x)).length,
        next(filter) {
            for (let i = 1; i < REVIEW_SIM_DAYS; i++) {
                runTo(i);
                const t = (takes[i] || []).filter(y => y.first && inF(filter)(y.x));
                if (t.length) return Math.min(...t.map(y => y.at));
                if (ran < i) break;
            }
            return Infinity;
        },
        catchUp() {
            while (caught === null && ran < REVIEW_SIM_DAYS - 1) runTo(ran + 1);
            return caught === null ? null : { days: caught, at: start(caught) };
        }
    };
}

// De 0 à 100, il suit les derniers passages : une erreur ancienne s'efface au fil des réussites, ce que le taux
// cumulé failures / attempts ne permettait pas. Erreur : il reste 40 % du score. Réussite : il gagne 35 % de ce qui
// manque, 10 % seulement si la révision n'était pas due (réussir tout de suite après ne prouve pas grand-chose).
const MASTERY_START     = 60;

const MASTERY_KEEP      = 0.4;

const MASTERY_GAIN_DUE  = 0.35;

const MASTERY_GAIN_SOON = 0.1;

// Indice en trois paliers (chantier « Échiquier et séance », 18 novembre 2026) : réussite après le type de pièce,
// +20 % de ce qui manque à l'échéance (10 % hors échéance, comme sans aide) ; après la pièce exacte, neutre.
const MASTERY_GAIN_HINT = 0.2;

// Sans score enregistré (position d'avant ce système) : déduit des compteurs, les niveaux ne changent donc pas.
const _masteryFrom = (attempts, failures) => attempts > 0 ? 100 * (1 - failures / attempts) : MASTERY_START;

const masteryOf = e => Number.isFinite(e.mastery) ? e.mastery : _masteryFrom(e.attempts, e.failures);

// Appelé après la mise à jour des compteurs : le score d'avant ne doit pas compter ce passage.
function _nextMastery(entry, ok, wasDue, help = 0) {
    const m = Number.isFinite(entry.mastery) ? entry.mastery : _masteryFrom(entry.attempts - 1, entry.failures - (ok ? 0 : 1));
    if (ok && help >= 2) return Math.round(m);
    const gain = !wasDue ? MASTERY_GAIN_SOON : help ? MASTERY_GAIN_HINT : MASTERY_GAIN_DUE;
    return Math.round(ok ? m + gain * (100 - m) : m * MASTERY_KEEP);
}

// ─── SÉRIE DE RÉUSSITES (niveaux E3, chantier « Révision du jour ») ───
// run : réussites d'affilée depuis la dernière erreur ; c'est lui qui fait le niveau (_level, levels.js).
// Sans champ run (position d'avant cette règle) : déduit, sans erreur → les essais, dans la file « À revoir » → son
// étape, sinon d'après le score (sous 50 : 0, sous 70 : 1, sous 85 : 2, au-delà 3, et 5 si l'intervalle atteint 7 jours
// en 3 essais au moins) : les niveaux d'une position déjà ratée ne bougent pas le jour du passage.
function _runFrom(e) {
    if (!e.failures) return Math.max(0, e.attempts || 0);
    if (Number.isInteger(e.relearn)) return e.relearn;
    const m = masteryOf(e);
    return m < 50 ? 0 : m < 70 ? 1 : m < 85 ? 2 : (e.attempts >= 3 && (e.interval || 0) >= 7 ? 5 : 3);
}

const runOf = e => Number.isInteger(e.run) && e.run >= 0 ? e.run : _runFrom(e);

// Bonus de retard : une réussite à l'échéance après N jours de retard part de l'intervalle + N ÷ 2 (comme Anki) :
// une position retrouvée après trois semaines d'oubli ne revient pas aussi vite qu'une position revue à l'heure.
const REVIEW_LATE_BONUS = 0.5;

// Une note par passage (une seule, cf. answerTrainingMove ; seules les séances de révision notent : TRAIN_SCORED).
// File « À revoir » : une erreur y fait entrer ou y ramène à zéro ; seule une réussite à l'échéance avance
// (10 min, puis 1, 3 et 7 jours) ; la troisième fait sortir de la file. Erreur hors échéance (Points faibles, À confirmer,
// Ligne complète) : même file, mais revue demain au plus tard, pas dans 10 minutes (la séance la repasse déjà).
// Série (run) : une erreur la remet à 0 ; une réussite l'allonge d'un cran si la position était due, ou si elle n'avait
// pas encore été notée aujourd'hui (au plus un cran par jour hors échéance).
// help = palier d'indice reçu avant une réussite : 0 aucun, 1 type de pièce (gain réduit, planning normal),
// 2 pièce exacte (neutre : score et série gardés, revue demain, intervalle et file « À revoir » inchangés, priorité gardée).
// La solution ne passe jamais ici en réussite : elle est notée comme une erreur (showTrainingSolution).
function recordReview(entry, ok, help = 0) {
    const now = Date.now(), d = new Date(now), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const wasDue = isDue(entry, now), prev = entry.interval || impliedInterval(entry), dueBefore = dueOf(entry);
    const runBefore = Number.isInteger(entry.run) && entry.run >= 0 ? entry.run
        : _runFrom({ ...entry, attempts: entry.attempts - 1, failures: entry.failures - (ok ? 0 : 1) });
    const freshToday = !(entry.lastReviewed >= today);
    entry.mastery = _nextMastery(entry, ok, wasDue, help);
    entry.lastReviewed = now;
    if (ok && help >= 2) {
        entry.run = runBefore;
        if (!entry.interval && prev) entry.interval = prev;
        entry.due = now + DAY_MS;
        logActivity(true);
        return;
    }
    entry.run = !ok ? 0 : wasDue || freshToday ? runBefore + 1 : runBefore;
    if (ok) delete entry.prio;                 // réponse « Traitée depuis » enfin retrouvée : priorité levée
    if (!ok) {
        entry.interval = 0;
        entry.due = wasDue ? now + REVIEW_RETRY_MS : Math.min(entry.due || Infinity, now + DAY_MS);
        entry.relearn = 0;
    } else if (wasDue && Number.isInteger(entry.relearn)) {
        entry.interval = RELEARN_DAYS[entry.relearn];
        entry.due = now + entry.interval * DAY_MS;
        if (entry.relearn + 1 >= RELEARN_DAYS.length) delete entry.relearn; else entry.relearn++;
    } else if (wasDue) {
        const late = prev && dueBefore > 0 ? Math.max(0, (now - dueBefore) / DAY_MS) : 0;
        const base = prev + late * REVIEW_LATE_BONUS;
        entry.interval = prev ? Math.min(REVIEW_MAX_DAYS, Math.round(base * reviewGrowth() * 10) / 10) : 1;
        entry.due = now + entry.interval * DAY_MS;
    } else if (!entry.due) {                   // révision anticipée d'une ancienne position : son planning devient explicite
        entry.interval = prev;
        entry.due = now + prev * DAY_MS;
    }
    logActivity(ok);
}
