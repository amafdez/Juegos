import test from "node:test";
import assert from "node:assert/strict";
import { BANK, CATEGORIES } from "../js/questions.js";
import { pickQuestions, planRounds, tallyRound, finalStats, makeCode, normalizeCode, cleanName, toArr, secondsLeft, fmtClock } from "../js/logic.js";

test("banco: sin ids ni textos repetidos, todas con formato de pregunta", () => {
  const ids = new Set(BANK.map((q) => q.id));
  const texts = new Set(BANK.map((q) => q.t));
  assert.equal(ids.size, BANK.length, "ids repetidos");
  assert.equal(texts.size, BANK.length, "textos repetidos");
  for (const q of BANK) {
    assert.match(q.t, /^¿Quién .+\?$/, q.t);
    assert.ok(!q.t.includes("!"), `signo de exclamación: ${q.t}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(q.t), `emoji: ${q.t}`);
  }
  for (const c of CATEGORIES) assert.ok(BANK.filter((q) => q.cat === c.id).length >= 85, `pocas en ${c.id}`);
});

test("primos: sin temas sexuales", () => {
  const banned = /sex|enroll|orgasm|nude|beso|bes[ao]|ligar|desnud|erótic|picante|cama\b/i;
  for (const q of BANK.filter((q) => q.cat === "primos")) assert.ok(!banned.test(q.t), q.t);
});

test("pickQuestions: sin repetir ya jugadas y reparte entre categorías", () => {
  const cats = ["chicas", "fiesta", "primos"];
  const { picked, resetCats } = pickQuestions({ bank: BANK, cats, rounds: 30 });
  assert.equal(picked.length, 30);
  assert.equal(new Set(picked.map((q) => q.id)).size, 30);
  assert.deepEqual(resetCats, []);
  const per = Object.fromEntries(cats.map((c) => [c, picked.filter((q) => q.cat === c).length]));
  for (const c of cats) assert.equal(per[c], 10, JSON.stringify(per));
});

test("pickQuestions: varias partidas seguidas no repiten hasta agotar el banco", () => {
  const seen = {};
  const cats = ["fiesta"];
  const total = BANK.filter((q) => q.cat === "fiesta").length;
  let played = 0;
  while (played + 30 <= total) {
    const { picked, resetCats } = pickQuestions({ bank: BANK, cats, rounds: 30, seen });
    assert.deepEqual(resetCats, []);
    for (const q of picked) {
      assert.ok(!seen[q.id], "repetida");
      seen[q.id] = true;
    }
    played += 30;
  }
  const next = pickQuestions({ bank: BANK, cats, rounds: 30, seen });
  assert.deepEqual(next.resetCats, ["fiesta"], "debe reiniciar al agotarse");
  assert.equal(next.picked.length, 30);
});

test("planRounds: tamaños, parejas rotando, balance y público/privado", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  for (const mode of ["2", "4", "mix"]) {
    const plan = planRounds({ playerIds: ids, rounds: 15, mode });
    assert.equal(plan.length, 15);
    const sizes = new Set();
    const appear = Object.fromEntries(ids.map((i) => [i, 0]));
    for (const r of plan) {
      assert.equal(new Set(r.cand).size, r.cand.length, "candidata repetida en la ronda");
      for (const c of r.cand) appear[c]++;
      sizes.add(r.cand.length);
    }
    if (mode === "2") assert.deepEqual([...sizes], [2]);
    if (mode === "4") assert.deepEqual([...sizes], [4]);
    if (mode === "mix") assert.ok(sizes.has(2) && sizes.has(4), "mix debe usar 2 y 4");
    const vals = Object.values(appear);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 3, `desbalance ${JSON.stringify(appear)}`);
    for (let i = 2; i < plan.length; i++)
      assert.ok(!(plan[i].public === plan[i - 1].public && plan[i].public === plan[i - 2].public), "tres seguidas iguales");
    assert.ok(plan.some((r) => r.public) && plan.some((r) => !r.public));
  }
  // la misma pareja no se repite mientras existan otras
  const plan = planRounds({ playerIds: ids, rounds: 15, mode: "2" });
  const seenPairs = new Set();
  plan.slice(0, 15).forEach((r) => seenPairs.add([...r.cand].sort().join("|")));
  assert.equal(seenPairs.size, 15, "con 6 jugadores hay 15 parejas distintas y deben usarse todas");
});

test("planRounds: pocos jugadores", () => {
  const two = planRounds({ playerIds: ["a", "b"], rounds: 5, mode: "4" });
  for (const r of two) assert.deepEqual([...r.cand].sort(), ["a", "b"]);
  const three = planRounds({ playerIds: ["a", "b", "c"], rounds: 6, mode: "4" });
  for (const r of three) assert.equal(r.cand.length, 3);
  const twelve = planRounds({ playerIds: Array.from({ length: 12 }, (_, i) => "p" + i), rounds: 30, mode: "mix" });
  assert.equal(twelve.length, 30);
});

test("tallyRound: conteo, empate, votos a quien no es candidata se ignoran", () => {
  const t = tallyRound(["a", "b"], { x: "a", y: "b", z: "a", w: "zzz" });
  assert.deepEqual(t.counts, { a: 2, b: 1 });
  assert.deepEqual(t.winners, ["a"]);
  assert.deepEqual(t.voters.a.sort(), ["x", "z"]);
  const tie = tallyRound(["a", "b"], { x: "a", y: "b" });
  assert.deepEqual(tie.winners, ["a", "b"]);
  assert.deepEqual(tallyRound(["a", "b"], {}).winners, []);
});

test("finalStats: ranking por votos y rondas ganadas", () => {
  const players = { a: { name: "Ana" }, b: { name: "Bea" }, c: { name: "Cami" } };
  const rounds = [{ cand: ["a", "b"] }, { cand: ["a", "c"] }, { cand: ["b", "c"] }];
  const votes = { 0: { a: "a", b: "a", c: "b" }, 1: { a: "c", b: "c", c: "a" }, 2: { a: "b", b: "b", c: "b" } };
  const { ranking, leaders } = finalStats({ rounds, votesByRound: votes, players });
  assert.deepEqual(
    ranking.map((s) => [s.name, s.received, s.wins]),
    [["Bea", 4, 1], ["Ana", 3, 1], ["Cami", 2, 1]]
  );
  assert.deepEqual(leaders.map((l) => l.name), ["Bea"]);
});

test("utilidades", () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^[A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeCode(" ab-c1d9 "), "ABCD");
  assert.equal(cleanName("   Sofi   Pérez   Muy Larga Nombre "), "Sofi Pérez Muy");
  assert.deepEqual(toArr({ 0: "a", 1: "b" }), ["a", "b"]);
  assert.deepEqual(toArr(null), []);
});

test("temporizador: segundos restantes y formato", () => {
  assert.equal(secondsLeft(15000, 0), 15);
  assert.equal(secondsLeft(15000, 14001), 1);
  assert.equal(secondsLeft(15000, 15000), 0);
  assert.equal(secondsLeft(15000, 20000), 0);
  assert.equal(fmtClock(15), "0:15");
  assert.equal(fmtClock(5), "0:05");
  assert.equal(fmtClock(75), "1:15");
});
