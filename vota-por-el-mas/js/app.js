import { createStore } from "./store.js";
import { BANK, CATEGORIES } from "./questions.js";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROUND_OPTIONS,
  MODES,
  toArr,
  makeCode,
  normalizeCode,
  cleanName,
  pickQuestions,
  planRounds,
  tallyRound,
  finalStats,
} from "./logic.js";

const root = document.getElementById("app");

let store = null;
let session = null; // { code, pid, name }
let room = null;
let unwatch = null;
let lastKey = "";
let revealTimer = null;
let busy = false;
let homeMsg = "";
let draftName = "";
let draftCode = "";

// ---------- utilidades ----------

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "vars") for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const uid = () => "p" + Math.random().toString(36).slice(2, 10);
const sessionBox = () => (store && store.mode === "demo" ? sessionStorage : localStorage);
const loadSession = () => {
  try {
    return JSON.parse(sessionBox().getItem("vpm-session"));
  } catch {
    return null;
  }
};
const saveSession = (s) => (s ? sessionBox().setItem("vpm-session", JSON.stringify(s)) : sessionBox().removeItem("vpm-session"));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isHost = () => Boolean(room && session && room.hostId === session.pid);
const roomPath = (p = "") => `rooms/${session.code}${p ? "/" + p : ""}`;
const nameOf = (id) => (room && room.players && room.players[id] && room.players[id].name) || "—";
const sortedPlayerIds = (r) =>
  Object.entries(r.players || {})
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
    .map(([id]) => id);

class UserError extends Error {}

function gameView() {
  const g = room.game;
  return {
    phase: g.phase,
    current: Number(g.current || 0),
    order: toArr(g.order),
    rounds: toArr(g.rounds).map((r) => ({ ...r, cand: toArr(r.cand) })),
  };
}
const votesFor = (i) => (room.votes && room.votes[i]) || {};

// ---------- acciones ----------

async function createRoom(name) {
  const pid = uid();
  let code = null;
  for (let i = 0; i < 8 && !code; i++) {
    const c = makeCode();
    if (!(await store.get(`rooms/${c}`))) code = c;
  }
  if (!code) throw new UserError("No pude generar un código. Intenta de nuevo.");
  await store.set(`rooms/${code}`, {
    createdAt: Date.now(),
    hostId: pid,
    status: "lobby",
    settings: { rounds: 10, mode: "mix", cats: ["fiesta"] },
    players: { [pid]: { name, joinedAt: Date.now() } },
  });
  enter({ code, pid, name });
}

async function joinRoom(code, name) {
  const r = await store.get(`rooms/${code}`);
  if (!r) throw new UserError("No encontré esa sala. Revisa el código.");
  const entries = Object.entries(r.players || {});
  const same = entries.find(([, p]) => p.name.toLowerCase() === name.toLowerCase());
  const prev = loadSession();
  let pid;
  if (r.status === "playing") {
    if (!same) throw new UserError("La partida ya empezó. Para volver, entra con el mismo nombre de antes.");
    pid = same[0];
  } else if (same) {
    if (prev && prev.code === code && prev.pid === same[0]) pid = same[0];
    else throw new UserError("Ese nombre ya está en la sala. Usa otro.");
  } else {
    if (entries.length >= MAX_PLAYERS) throw new UserError("La sala está llena.");
    pid = uid();
    await store.set(`rooms/${code}/players/${pid}`, { name, joinedAt: Date.now() });
  }
  enter({ code, pid, name });
}

function enter(s) {
  session = s;
  saveSession(s);
  localStorage.setItem("vpm-name", s.name);
  watchRoom(s.code);
}

function watchRoom(code) {
  if (unwatch) unwatch();
  let first = true;
  unwatch = store.watch(`rooms/${code}`, (val) => {
    room = val;
    if (!session) return;
    if (!val) {
      homeMsg = first ? "Esa sala ya no existe." : "La sala se cerró.";
      leave(false);
      return;
    }
    if (!val.players || !val.players[session.pid]) {
      homeMsg = "Ya no estás en esa sala.";
      leave(false);
      return;
    }
    first = false;
    render();
    hostTick();
  });
}

async function leave(removeSelf) {
  const s = session;
  if (unwatch) unwatch();
  unwatch = null;
  clearTimeout(revealTimer);
  session = null;
  room = null;
  saveSession(null);
  lastKey = "";
  if (s && removeSelf) {
    try {
      await store.remove(`rooms/${s.code}/players/${s.pid}`);
    } catch {
      /* da igual */
    }
  }
  render();
}

async function closeRoom() {
  if (!confirm("Se cierra la sala para todos.")) return;
  const path = roomPath();
  await store.remove(path);
}

const setSetting = (key, value) => store.set(roomPath(`settings/${key}`), value);

function toggleCat(id) {
  const cur = toArr(room.settings.cats);
  const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
  if (next.length) setSetting("cats", next);
}

async function startGame() {
  if (busy) return;
  busy = true;
  render();
  try {
    const ids = sortedPlayerIds(room);
    const s = room.settings;
    const cats = toArr(s.cats).filter((c) => CATEGORIES.some((x) => x.id === c));
    const seen = (await store.get("seen")) || {};
    const { picked, resetCats } = pickQuestions({ bank: BANK, cats, rounds: Number(s.rounds), seen });
    const plan = planRounds({ playerIds: ids, rounds: picked.length, mode: s.mode });
    const rounds = picked.map((q, i) => ({ qid: q.id, cat: q.cat, q: q.t, cand: plan[i].cand, public: plan[i].public }));
    const upd = {
      [roomPath("game")]: { order: ids, rounds, current: 0, phase: "vote" },
      [roomPath("status")]: "playing",
      [roomPath("votes")]: null,
    };
    for (const c of resetCats) for (const k of Object.keys(seen)) if (k.startsWith(c + "-")) upd[`seen/${k}`] = null;
    for (const q of picked) upd[`seen/${q.id}`] = true;
    await store.update(upd);
  } catch (e) {
    console.error(e);
    homeMsg = "No pude empezar la partida. Intenta de nuevo.";
  } finally {
    busy = false;
    render();
  }
}

const castVote = (candId) => {
  const g = gameView();
  if (g.phase !== "vote") return;
  return store.set(roomPath(`votes/${g.current}/${session.pid}`), candId);
};

const showResults = () => store.set(roomPath("game/phase"), "result");

function nextRound() {
  const g = gameView();
  if (g.current + 1 >= g.rounds.length) return store.set(roomPath("game/phase"), "final");
  return store.update({ [roomPath("game/current")]: g.current + 1, [roomPath("game/phase")]: "vote" });
}

const playAgain = () => store.update({ [roomPath("status")]: "lobby", [roomPath("game")]: null, [roomPath("votes")]: null });

// El host muestra los resultados apenas todos votaron.
function hostTick() {
  clearTimeout(revealTimer);
  if (!isHost() || !room || room.status !== "playing" || !room.game) return;
  const g = gameView();
  if (g.phase !== "vote") return;
  const votes = votesFor(g.current);
  if (g.order.length && g.order.every((id) => votes[id])) revealTimer = setTimeout(showResults, 700);
}

// ---------- vistas ----------

const btn = (text, cls, onClick, extra = {}) => h("button", { class: `jg-btn ${cls}`, type: "button", onclick: onClick, ...extra }, text);
const chip = (label, pressed, onClick) =>
  h("button", { class: "vm-chip", type: "button", "aria-pressed": String(Boolean(pressed)), onclick: onClick }, label);
const demoBanner = () =>
  store.mode === "demo"
    ? h("p", { class: "vm-demo" }, "Modo demo: sin Firebase solo funciona entre pestañas de este navegador.")
    : null;
const consumeMsg = () => {
  const m = homeMsg;
  homeMsg = "";
  return m ? h("p", { class: "vm-error", role: "alert" }, m) : null;
};

function homeView() {
  const name = h("input", {
    class: "vm-input",
    id: "name",
    placeholder: "Tu nombre",
    maxlength: "14",
    autocomplete: "off",
    value: draftName,
    "aria-label": "Tu nombre",
  });
  const code = h("input", {
    class: "vm-input vm-input--code",
    id: "code",
    placeholder: "CÓDIGO",
    maxlength: "4",
    autocomplete: "off",
    autocapitalize: "characters",
    value: draftCode,
    "aria-label": "Código de la sala",
  });
  name.addEventListener("input", () => (draftName = name.value));
  code.addEventListener("input", () => {
    code.value = normalizeCode(code.value);
    draftCode = code.value;
  });

  const err = h("p", { class: "vm-error", role: "alert" });
  const fail = (m) => {
    err.textContent = m;
  };
  const run = async (fn) => {
    if (busy) return;
    busy = true;
    fail("");
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof UserError)) console.error(e);
      fail(e instanceof UserError ? e.message : "No pude conectar. Revisa tu internet o firebase-config.js.");
    } finally {
      busy = false;
    }
  };
  const getName = () => {
    const n = cleanName(name.value);
    if (!n) fail("Escribe tu nombre primero.");
    return n;
  };
  const doCreate = () => {
    const n = getName();
    if (n) run(() => createRoom(n));
  };
  const doJoin = () => {
    const n = getName();
    if (!n) return;
    const c = normalizeCode(code.value);
    if (c.length !== 4) return fail("El código tiene 4 letras.");
    run(() => joinRoom(c, n));
  };
  code.addEventListener("keydown", (e) => e.key === "Enter" && doJoin());
  name.addEventListener("keydown", (e) => e.key === "Enter" && (normalizeCode(code.value).length === 4 ? doJoin() : doCreate()));

  const initial = consumeMsg();
  if (initial) err.textContent = initial.textContent;

  return [
    h(
      "div",
      { class: "jg-stack" },
      h("p", { class: "label", style: "color:var(--ink-2)" }, "Juego de grupo"),
      h("h1", { class: "display", style: "margin:0" }, "Vota por el más"),
      h(
        "p",
        { class: "body" },
        "Una pregunta, dos o cuatro nombres y todas votan. Algunas rondas son privadas y otras muestran quién votó por quién. Se sabe recién cuando termina la ronda."
      )
    ),
    demoBanner(),
    h(
      "div",
      { class: "jg-stack" },
      h("label", { class: "vm-field" }, h("span", { class: "label" }, "Tu nombre"), name),
      btn("Crear sala", "jg-btn--pink", doCreate),
      h("p", { class: "caption", style: "color:var(--ink-2)" }, "O entra a una sala con su código."),
      h("label", { class: "vm-field" }, h("span", { class: "label" }, "Código"), code),
      btn("Entrar", "jg-btn--sky", doJoin),
      err
    ),
  ];
}

function playerRows() {
  return h(
    "div",
    { class: "vm-list" },
    sortedPlayerIds(room).map((id) => {
      const tags = [id === room.hostId ? "Host" : null, id === session.pid ? "Tú" : null].filter(Boolean).join(" · ");
      return h("div", { class: "vm-row" }, h("span", {}, nameOf(id)), tags ? h("span", { class: "vm-tag" }, tags) : null);
    })
  );
}

function lobbyView() {
  const s = room.settings;
  const host = isHost();
  const cats = toArr(s.cats);
  const n = Object.keys(room.players || {}).length;
  const modeLabel = (MODES.find((m) => m.id === s.mode) || MODES[2]).label;
  const catNames = CATEGORIES.filter((c) => cats.includes(c.id)).map((c) => c.name);

  const settings = host
    ? h(
        "div",
        { class: "jg-card vm-settings" },
        h("div", { class: "vm-field" }, h("span", { class: "label" }, "Rondas"), h("div", { class: "vm-chips" }, ROUND_OPTIONS.map((r) => chip(String(r), Number(s.rounds) === r, () => setSetting("rounds", r))))),
        h("div", { class: "vm-field" }, h("span", { class: "label" }, "Por ronda"), h("div", { class: "vm-chips" }, MODES.map((m) => chip(m.label, s.mode === m.id, () => setSetting("mode", m.id))))),
        h(
          "div",
          { class: "vm-field" },
          h("span", { class: "label" }, "Categorías"),
          h("div", { class: "vm-chips" }, CATEGORIES.map((c) => chip(c.name, cats.includes(c.id), () => toggleCat(c.id)))),
          h("p", { class: "caption", style: "color:var(--ink-2)" }, "Primos evita temas sexuales. Las otras no.")
        )
      )
    : h(
        "div",
        { class: "jg-card" },
        h("p", { class: "answer" }, `Esperando a que ${nameOf(room.hostId)} empiece.`),
        h("p", { class: "caption", style: "color:var(--ink-2)" }, `${plural(Number(s.rounds), "ronda", "rondas")} · ${modeLabel} · ${catNames.join(", ")}`)
      );

  const canStart = n >= MIN_PLAYERS && cats.length > 0 && !busy;
  return [
    h(
      "div",
      { class: "jg-stack", style: "justify-items:center;text-align:center" },
      h("p", { class: "label", style: "color:var(--ink-2)" }, "Código de la sala"),
      h("p", { class: "mega vm-code", "aria-label": `Código ${session.code.split("").join(" ")}` }, session.code),
      h("p", { class: "caption", style: "color:var(--ink-2)" }, "Compartan este código para entrar.")
    ),
    demoBanner(),
    h("div", { class: "jg-stack" }, h("span", { class: "label" }, `Jugadores · ${n} de ${MAX_PLAYERS}`), playerRows()),
    settings,
    consumeMsg(),
    h(
      "div",
      { class: "jg-stack" },
      host ? btn("Empezar", "jg-btn--pink", startGame, canStart ? {} : { disabled: "" }) : null,
      host && n < MIN_PLAYERS ? h("p", { class: "caption", style: "color:var(--ink-2)" }, "Se necesitan al menos 2 personas.") : null,
      host ? btn("Cerrar sala", "jg-btn--ghost", closeRoom) : btn("Salir", "jg-btn--ghost", () => leave(true))
    ),
  ];
}

function questionBlock(text) {
  return h("div", { class: "jg-q" }, h("p", { class: "question" }, text));
}

function voteView(g) {
  const r = g.rounds[g.current];
  const votes = votesFor(g.current);
  const mine = votes[session.pid];
  const done = g.order.filter((id) => votes[id]).length;
  const pending = g.order.filter((id) => !votes[id]);

  return h(
    "div",
    { class: "vm-play" },
    h(
      "div",
      { class: "jg-screen-head" },
      h("span", { class: "label", style: "color:var(--ink-2)" }, `Ronda ${g.current + 1} de ${g.rounds.length}`),
      h("span", { class: "jg-pill", "aria-live": "polite" }, `${done} de ${g.order.length}`)
    ),
    questionBlock(r.q),
    h(
      "div",
      { class: "jg-vote" + (r.cand.length === 4 ? " is-4" : ""), role: "group", "aria-label": "Elige una persona" },
      r.cand.map((c) =>
        h(
          "button",
          { class: "jg-vote-opt" + (mine === c ? " is-selected" : ""), type: "button", "aria-pressed": String(mine === c), onclick: () => castVote(c) },
          nameOf(c)
        )
      )
    ),
    h(
      "div",
      { class: "vm-foot" },
      mine ? h("p", { class: "caption", style: "color:var(--ink-2)" }, "Voto enviado. Puedes cambiarlo hasta que salgan los resultados.") : h("p", { class: "caption", style: "color:var(--ink-2)" }, "Toca un nombre para votar."),
      isHost() && pending.length && done > 0
        ? h(
            "div",
            { class: "vm-host-note" },
            h("p", { class: "caption", style: "color:var(--ink-2)" }, `Falta: ${pending.map(nameOf).join(", ")}`),
            btn("Mostrar resultados", "jg-btn--outline", showResults)
          )
        : null
    )
  );
}

function resultView(g) {
  const r = g.rounds[g.current];
  const t = tallyRound(r.cand, votesFor(g.current));
  const total = Object.values(t.counts).reduce((a, b) => a + b, 0) || 1;
  const rows = [...r.cand].sort((a, b) => t.counts[b] - t.counts[a]);
  const last = g.current + 1 >= g.rounds.length;

  return h(
    "div",
    { class: "vm-play vm-play--result" },
    h("div", { class: "jg-screen-head" }, h("span", { class: "label", style: "color:var(--ink-2)" }, `Ronda ${g.current + 1} de ${g.rounds.length} · Voto ${r.public ? "público" : "privado"}`)),
    questionBlock(r.q),
    h(
      "div",
      { class: "jg-results vm-results" },
      rows.map((c) => {
        const win = t.winners.includes(c);
        const voters = r.public ? t.voters[c] : [];
        return h(
          "div",
          { class: "jg-result" + (win ? " is-winner" : "") + (voters.length ? " has-voters" : ""), vars: { "--share": Math.round((t.counts[c] / total) * 100) } },
          h("span", { class: "bar" }),
          h("span", { class: "name" }, nameOf(c)),
          win ? h("span", { class: "tag label" }, "Más votado") : h("span"),
          h("span", { class: "count" }, String(t.counts[c])),
          voters.length ? h("span", { class: "voters" }, voters.map((v) => h("span", { class: "vm-tag" }, nameOf(v)))) : null
        );
      })
    ),
    h(
      "div",
      { class: "vm-foot" },
      isHost() ? btn(last ? "Ver podio" : "Siguiente", "jg-btn--sky", nextRound) : h("p", { class: "caption", style: "color:var(--ink-2)" }, `Sigue ${nameOf(room.hostId)}.`)
    )
  );
}

function finalView(g) {
  const players = Object.fromEntries(g.order.map((id) => [id, { name: nameOf(id) }]));
  const votesByRound = Object.fromEntries(g.rounds.map((_, i) => [i, votesFor(i)]));
  const { ranking, leaders } = finalStats({ rounds: g.rounds, votesByRound, players });
  const top = ranking.slice(0, 3);
  const maxVotes = Math.max(1, ...ranking.map((s) => s.received));
  const headline = leaders.length === 1 ? `Más votado: ${leaders[0].name}` : `Empate: ${leaders.map((l) => l.name).join(", ")}`;

  const step = (s, place) =>
    h(
      "div",
      { class: `jg-step jg-step--${place}` },
      h("span", { class: "answer" }, s.name),
      h("span", { class: "caption" }, plural(s.received, "voto", "votos")),
      h("div", { class: "jg-block" }, String(place))
    );
  const podium =
    top.length >= 3
      ? [step(top[1], 2), step(top[0], 1), step(top[2], 3)]
      : [step(top[1], 2), step(top[0], 1)];

  return [
    h("div", { class: "jg-stack" }, h("p", { class: "label", style: "color:var(--ink-2)" }, "Fin de la partida"), h("h1", { class: "display", style: "margin:0" }, headline)),
    h("div", { class: "jg-podium", style: top.length < 3 ? "grid-template-columns:1fr 1fr" : "" }, podium),
    h(
      "div",
      { class: "jg-stack" },
      h("p", { class: "caption", style: "color:var(--ink-2)" }, "Votos recibidos y rondas ganadas."),
      h(
        "div",
        { class: "jg-results" },
        ranking.map((s) =>
          h(
            "div",
            { class: "jg-result" + (leaders.some((l) => l.id === s.id) ? " is-winner" : ""), vars: { "--share": Math.round((s.received / maxVotes) * 100) } },
            h("span", { class: "bar" }),
            h("span", { class: "name" }, s.name),
            h("span", { class: "tag label" }, plural(s.wins, "ronda", "rondas")),
            h("span", { class: "count" }, String(s.received))
          )
        )
      )
    ),
    h(
      "div",
      { class: "jg-stack" },
      isHost() ? btn("Jugar otra vez", "jg-btn--butter", playAgain) : null,
      isHost() ? btn("Cerrar sala", "jg-btn--ghost", closeRoom) : btn("Salir", "jg-btn--ghost", () => leave(false))
    ),
  ];
}

// ---------- render ----------

function buildScreen() {
  if (!session || !room) return { key: "home", kids: homeView(), cls: "" };
  if (room.status === "lobby") return { key: "lobby", kids: lobbyView(), cls: "" };
  if (!room.game) return { key: "wait", kids: [h("p", { class: "body" }, "Cargando partida")], cls: "" };
  const g = gameView();
  if (g.phase === "vote") return { key: `vote-${g.current}`, kids: [voteView(g)], cls: "vm-screen--play" };
  if (g.phase === "result") return { key: `result-${g.current}`, kids: [resultView(g)], cls: "vm-screen--play" };
  return { key: "final", kids: finalView(g), cls: "" };
}

function render() {
  if (!store) return;
  const y = window.scrollY;
  const { key, kids, cls } = buildScreen();
  const fresh = key !== lastKey;
  lastKey = key;
  const main = h("main", { class: `vm-screen ${cls}${fresh ? " jg-in" : ""}` }, kids);
  root.replaceChildren(main);
  if (!fresh) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
}

// ---------- arranque ----------

async function boot() {
  root.replaceChildren(h("main", { class: "vm-screen" }, h("p", { class: "body" }, "Cargando")));
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    root.replaceChildren(h("main", { class: "vm-screen" }, h("p", { class: "vm-error" }, "No pude cargar Firebase. Revisa firebase-config.js y tu internet.")));
    return;
  }
  draftName = localStorage.getItem("vpm-name") || "";
  session = loadSession();
  if (session) watchRoom(session.code);
  else render();
}

boot();
