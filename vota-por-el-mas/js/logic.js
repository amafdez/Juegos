// Lógica pura del juego (sin DOM ni Firebase), para poder probarla aparte.

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;
export const ROUND_OPTIONS = [5, 10, 15, 20, 30];
export const MODES = [
  { id: "2", label: "2 personas" },
  { id: "4", label: "4 personas" },
  { id: "mix", label: "Mezcla" },
];

// Firebase devuelve objetos con llaves 0,1,2 donde guardamos arreglos.
export const toArr = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CODE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"; // sin I, O, Q para no confundir
export function makeCode(rng = Math.random) {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)];
  return c;
}

export function normalizeCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

export function cleanName(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 14);
}

// ---------- Preguntas ----------

/**
 * Elige `rounds` preguntas de las categorías pedidas, sin repetir las ya jugadas (`seen`).
 * Reparte entre categorías de forma pareja. Si no alcanzan las nuevas, reinicia
 * el historial de esas categorías y devuelve cuáles reinició en `resetCats`.
 */
export function pickQuestions({ bank, cats, rounds, seen = {}, rng = Math.random }) {
  const inCats = bank.filter((q) => cats.includes(q.cat));
  let resetCats = [];
  let fresh = inCats.filter((q) => !seen[q.id]);
  if (fresh.length < rounds) {
    resetCats = [...cats];
    fresh = inCats;
  }
  const pools = {};
  for (const c of cats) pools[c] = shuffle(fresh.filter((q) => q.cat === c), rng);

  const picked = [];
  let order = shuffle(cats, rng);
  let i = 0;
  while (picked.length < rounds) {
    const available = order.filter((c) => pools[c].length);
    if (!available.length) break;
    const c = available[i % available.length];
    picked.push(pools[c].pop());
    i++;
  }
  return { picked: shuffle(picked, rng), resetCats };
}

// ---------- Parejas / candidatos ----------

function candidatesPerRound(mode, nPlayers, rng) {
  const hi = Math.min(4, nPlayers);
  if (mode === "2") return Math.min(2, nPlayers);
  if (mode === "4") return hi;
  return rng() < 0.5 ? Math.min(2, nPlayers) : hi;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function combos(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function allSubsets(list, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) return out.push([...acc]);
    for (let i = start; i < list.length; i++) {
      acc.push(list[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

/**
 * Para cada ronda elige quiénes son las candidatas y si es pública o privada.
 * Reparte las apariciones de forma pareja y evita repetir las mismas parejas
 * (y el mismo grupo dos rondas seguidas) mientras se pueda.
 */
export function planRounds({ playerIds, rounds, mode, rng = Math.random }) {
  const n = playerIds.length;
  const appear = Object.fromEntries(playerIds.map((p) => [p, 0]));
  const pairs = {};
  const plan = [];
  let prev = "";

  for (let r = 0; r < rounds; r++) {
    const k = candidatesPerRound(mode, n, rng);
    let best = null;
    let bestScore = Infinity;
    const candidates = combos(n, k) <= 800 ? allSubsets(playerIds, k) : Array.from({ length: 300 }, () => shuffle(playerIds, rng).slice(0, k));
    for (const subset of candidates) {
      let score = rng() * 0.5;
      for (const p of subset) score += appear[p] * 4;
      for (let i = 0; i < subset.length; i++)
        for (let j = i + 1; j < subset.length; j++) score += (pairs[pairKey(subset[i], subset[j])] || 0) * 10;
      if ([...subset].sort().join() === prev) score += 1000;
      if (score < bestScore) {
        bestScore = score;
        best = subset;
      }
    }
    for (const p of best) appear[p]++;
    for (let i = 0; i < best.length; i++)
      for (let j = i + 1; j < best.length; j++) pairs[pairKey(best[i], best[j])] = (pairs[pairKey(best[i], best[j])] || 0) + 1;
    prev = [...best].sort().join();
    plan.push({ cand: best });
  }

  // público / privado al azar, sin tres seguidas del mismo tipo
  const pub = [];
  for (let i = 0; i < rounds; i++) {
    let v = rng() < 0.5;
    if (i >= 2 && pub[i - 1] === pub[i - 2] && pub[i - 1] === v) v = !v;
    pub.push(v);
  }
  return plan.map((p, i) => ({ ...p, public: pub[i] }));
}

// ---------- Conteo ----------

/** votes: { voterId: candidateId }. Solo cuentan los votos a candidatas de la ronda. */
export function tallyRound(cand, votes = {}) {
  const counts = Object.fromEntries(cand.map((c) => [c, 0]));
  const voters = Object.fromEntries(cand.map((c) => [c, []]));
  for (const [voter, choice] of Object.entries(votes || {})) {
    if (choice in counts) {
      counts[choice]++;
      voters[choice].push(voter);
    }
  }
  const max = Math.max(0, ...Object.values(counts));
  const winners = max > 0 ? cand.filter((c) => counts[c] === max) : [];
  return { counts, voters, winners, max };
}

/** Ranking final por votos recibidos, luego rondas ganadas, luego nombre. */
export function finalStats({ rounds, votesByRound, players }) {
  const stats = Object.fromEntries(
    Object.keys(players).map((id) => [id, { id, name: players[id].name, received: 0, wins: 0, appearances: 0 }])
  );
  rounds.forEach((r, i) => {
    const t = tallyRound(r.cand, votesByRound[i]);
    for (const c of r.cand) {
      if (!stats[c]) continue;
      stats[c].appearances++;
      stats[c].received += t.counts[c];
    }
    for (const w of t.winners) if (stats[w]) stats[w].wins++;
  });
  const ranking = Object.values(stats).sort(
    (a, b) => b.received - a.received || b.wins - a.wins || a.name.localeCompare(b.name, "es")
  );
  const top = ranking[0];
  const leaders = top ? ranking.filter((s) => s.received === top.received && s.wins === top.wins) : [];
  return { ranking, leaders };
}

// ---------- Tiempo por ronda ----------

export const TIME_OPTIONS = [10, 15, 20, 30, 0]; // 0 = sin tiempo
export const DEFAULT_SECONDS = 15;
export const secondsLeft = (deadline, now) => Math.max(0, Math.ceil((deadline - now) / 1000));
export const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
