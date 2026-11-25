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

// Places gardées chaque jour pour des découvertes même quand du retard attend (chantier « Erreurs et niveaux ») :
// 2 à l'objectif Léger, 3 au-delà, dans le plafond.
function _discoverSlots(cap) {
    return cap <= 0 ? 0 : Math.min(cap, reviewGoal() < 30 ? 2 : 3);
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
        x.fresh = needsShowing(x.e) && dueOf(x.e) <= now;   // jamais présentée ; une échéance future explicite est respectée
        x.at = dueOf(x.e);
        x.seen = seenOn ? SP.count(x.color, x.key) : 0;
        x.rank = Number.isInteger(x.e.relearn) ? 0 : x.e.prio ? 1 : !seenOn || x.seen ? 2 : 3;
        x.m = masteryOf(x.e);
        x.day = Infinity;
    });
    const fresh = items.filter(x => x.fresh)
        .sort((a, b) => (b.e.prio ? 1 : 0) - (a.e.prio ? 1 : 0) || (a.e.created || 0) - (b.e.created || 0) || (a.e.ply || 0) - (b.e.ply || 0));
    const failRate = Number.isFinite(opts.failRate) ? opts.failRate : _reviewFailRate(now);
    let miss = 0;
    let sims = items.filter(x => !x.fresh).map(x => ({ x, due: x.at, st: stepOf(x.e), rl: x.e.relearn }));
    const takes = [], heldAt = [];
    let ran = -1, nf = 0, caught = null;
    // Un jour de la simulation : la file (échéances avant la fin du jour), le plafond, puis les nouvelles s'il reste de la place.
    function step(i) {
        const end = start(i + 1), cap = i === 0 ? left : goal;
        const pool = sims.filter(s => s.due < end).sort((a, b) => _reviewImportance(a.x, b.x));
        const keep = pool.length >= cap ? Math.min(_discoverSlots(cap), fresh.length - nf) : 0;   // retard : places de découverte
        const take = pool.slice(0, cap - keep), day = take.map(s => ({ x: s.x, at: Math.max(s.due, start(i)), first: s.x.day === Infinity }));
        heldAt[i] = pool.slice(cap - keep).map(s => s.x);
        take.forEach(s => {
            if (s.x.day === Infinity) s.x.day = i;
            miss += failRate;
            if (miss >= 1) {                                  // erreur attendue : un palier de moins, rattrapage demain
                miss -= 1;
                s.st = Number.isInteger(s.rl) || s.st <= 0 ? 0 : Math.max(1, s.st - 1); s.rl = 0; s.due = start(i + 1); return;
            }
            if (Number.isInteger(s.rl)) { s.rl = undefined; s.st = Math.max(1, s.st); } else s.st++;
            s.due = start(i + stepDays(s.st));
        });
        if (!heldAt[i].length && caught === null) caught = i;
        {
            const room = heldAt[i].length ? keep : Math.min(k, cap - take.length, fresh.length - nf);
            for (let j = 0; j < room; j++) {
                const x = fresh[nf++];
                x.day = i;
                day.push({ x, at: start(i), first: true });
                sims.push({ x, due: start(i + 1), st: 0 });
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

// ─── SÉRIE DE RÉUSSITES (ancienne échelle E3) ───
// run : réussites d'affilée depuis la dernière erreur. Il ne fait plus le niveau (voir PALIERS ci-dessous) : il sert
// seulement à déduire le palier d'une position d'avant le chantier « Erreurs et niveaux ».
// Sans champ run : déduit, sans erreur → les essais, dans l'ancienne file « À revoir » → son étape, sinon d'après le score.
function _runFrom(e) {
    if (!e.failures) return Math.max(0, e.attempts || 0);
    if (Number.isInteger(e.relearn)) return e.relearn;
    const m = masteryOf(e);
    return m < 50 ? 0 : m < 70 ? 1 : m < 85 ? 2 : (e.attempts >= 3 && (e.interval || 0) >= 7 ? 5 : 3);
}

const runOf = e => Number.isInteger(e.run) && e.run >= 0 ? e.run : _runFrom(e);

// ─── PALIERS (chantier « Erreurs et niveaux », 25 novembre 2026, système C « Apprendre, puis entretenir ») ───
// step : 0 = découverte (jamais retrouvée de mémoire, ou ratée deux fois d'affilée), puis un palier par réussite à
// l'échéance (au plus un par jour hors échéance), revue après STEP_DAYS[palier] jours. Une erreur fait descendre d'un
// palier (jamais sous 1) et ouvre un rattrapage (relearn = 0) : revue le lendemain ; réussie, la position garde ce palier ;
// ratée, elle repart en découverte. En découverte, un raté ne compte pas (recordMiss) : on remontre le coup demain.
const STEP_DAYS = [1, 1, 3, 7, 16, 35, 90, 180];

// Rythme des révisions (Paramètres) : Doux allonge les paliers, Intensif les raccourcit (Normal : les jours ci-dessus).
const stepDays = step => Math.max(1, Math.round(STEP_DAYS[Math.min(Math.max(0, step), STEP_DAYS.length - 1)] * reviewGrowth() / REVIEW_GROWTH));

// Palier d'une position d'avant cette règle, lu dans tout son historique (rien n'est réécrit) : jamais ratée → ses
// essais (Sue dès 3, Maîtrisée dès 5, comme avant) ; sinon sa série (5+ : Maîtrisée) ; série à 0 (dernier essai raté) :
// un cran sous ce que dit la part de réussites, découverte si elle est sous la moitié ou jamais réussie.
function _stepFrom(e) {
    const a = e.attempts || 0, f = e.failures || 0, succ = a - f;
    if (!a || succ <= 0) return 0;
    if (!f) return Math.min(5, a);
    const run = runOf(e);
    if (run >= 5) return 5;
    if (run >= 1) return Math.min(4, run);
    const q = succ / a;
    return q >= 0.5 ? (succ >= 3 ? 2 : 1) : 0;
}

const stepOf = e => Number.isInteger(e.step) && e.step >= 0 ? e.step : _stepFrom(e);

// En découverte : ses ratés ne comptent pas.
const isDiscovering = e => stepOf(e) === 0;

// Jamais présentée : ni essai noté ni passage. La séance montre d'abord le coup (presentEntry).
const needsShowing = e => !e.attempts && !e.lastReviewed;

// Début du jour suivant (le rattrapage et la découverte reviennent « demain », pas 24 h plus tard).
function _tomorrow(now) {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

// Présentation d'une position nouvelle : coup montré puis joué ; rien n'est compté, elle revient demain.
function presentEntry(entry, now = Date.now()) {
    entry.lastReviewed = now;
    entry.step = 0;
    entry.interval = 0;
    entry.due = _tomorrow(now);
    logActivity(true);
}

// Un raté en révision : en découverte, il ne compte pas (revue demain, le coup est remontré) ; sinon erreur comptée.
// Renvoie true si une erreur a été comptée.
function recordMiss(entry, now = Date.now()) {
    if (isDiscovering(entry)) {
        entry.step = 0;
        entry.lastReviewed = now;
        entry.interval = 0;
        entry.due = _tomorrow(now);
        logActivity(true);
        return false;
    }
    entry.attempts++;
    entry.failures++;
    recordReview(entry, false);
    return true;
}

// Une note par passage (une seule, cf. answerTrainingMove ; seules les séances de révision notent : TRAIN_SCORED).
// Les compteurs sont mis à jour AVANT l'appel (une erreur passe par recordMiss).
// Réussite : palier + 1 si la position était due ou pas encore notée aujourd'hui ; en rattrapage, le palier est gardé
// et le rattrapage levé ; avec l'indice 1 (type de pièce), le palier est gardé ; revue dans STEP_DAYS[palier] jours.
// help 2 (pièce exacte) : neutre, palier et rattrapage gardés, revue demain.
// Erreur : un palier de moins (au moins 1) et rattrapage demain ; deuxième erreur d'affilée (rattrapage en attente) :
// découverte. La solution passe ici comme une erreur (showTrainingSolution, via recordMiss).
function recordReview(entry, ok, help = 0) {
    const now = Date.now(), d = new Date(now), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const wasDue = isDue(entry, now);
    const before = Number.isInteger(entry.step) && entry.step >= 0 ? entry.step
        : _stepFrom({ ...entry, attempts: entry.attempts - 1, failures: entry.failures - (ok ? 0 : 1) });
    const freshToday = !(entry.lastReviewed >= today), catching = Number.isInteger(entry.relearn);
    entry.mastery = _nextMastery(entry, ok, wasDue, help);
    entry.lastReviewed = now;
    delete entry.run;
    if (ok && help >= 2) {
        entry.step = before;
        entry.due = now + DAY_MS;
        logActivity(true);
        return;
    }
    if (ok) {
        delete entry.prio;                     // réponse « à vérifier » ou « Traitée depuis » retrouvée : priorité levée
        let step = before;
        if (catching) { delete entry.relearn; step = Math.max(1, before); }
        else if (help) step = before;
        else if (wasDue || freshToday) step = before + 1;
        entry.step = step;
        if (step !== before || catching || wasDue || !entry.due) {
            entry.interval = step ? stepDays(step) : 0;
            entry.due = step ? now + entry.interval * DAY_MS : _tomorrow(now);
        }
    } else {
        if (catching || before <= 0) { entry.step = 0; entry.relearn = 0; }
        else { entry.step = Math.max(1, before - 1); entry.relearn = 0; }
        entry.interval = 0;
        entry.due = _tomorrow(now);
    }
    logActivity(ok);
}
