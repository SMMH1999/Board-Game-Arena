const test = require("node:test");
const assert = require("node:assert/strict");
const spec = require("../strategies/splendor_strategy_codex.json");
globalThis.splendorActiveStrategy = { ...spec, id: spec.spec_id };
require("../classic.js");
require("../race.js");
require("../advice.js");

const { moveOptions, legalDraws } = splendorClassic.transitions(spec.rules);
const zero = { C: 0, S: 0, E: 0, R: 0, O: 0, G: 0 };
const card = (id, bonus, points, cost, reserved = false) =>
  ({ id, level: points >= 4 ? 3 : 1, bonus, points, cost, reserved });
const noble = (id, cost) => ({ id, points: 3, cost });
function state(overrides = {}) {
  return { cards: [], nobles: [], bank: { C: 4, S: 4, E: 4, R: 4, O: 4, G: 5 },
    reserveCount: 0, discounts: zero, tokens: zero, score: 0, cardPoints: 0, buying: 0,
    decks: { 1: 0, 2: 0, 3: 0 }, ...overrides };
}
function advice(s, others = [{ id: "other", reservedCount: 0 }]) {
  const counters = Object.entries(s.bank).map(([color, count]) =>
    ({ elementId: "coincounter_" + color, text: String(count) }));
  counters.push({ elementId: "spl_playerboard_gemcount", text: Object.values(s.tokens).reduce((a,b) => a+b) + "/10" },
    { elementId: "spl_playerreserve_count", text: s.reserveCount + "/3" });
  const players = [{ id: "me", ...s }, ...others.map(p => ({ score: 0, tokens: zero, discounts: zero, ...p }))];
  return splendorAdvice({ localPlayerId: "me", counters, roundOrder: players.map(p => p.id),
    gameState: { cards: s.cards, nobles: s.nobles, players } });
}
function scenario(id, check) {
  assert.ok(spec.acceptance_tests.some(([key]) => key === id));
  test(id, check);
}
scenario("G01", () => {
  const s = state({ cards: [card("x","C",1,{ S:2,E:2 })], discounts: { ...zero,S:1 },
    tokens: { ...zero,E:1,G:1 } });
  assert.equal(splendorClassic.payment(s.cards[0],s).G,2);
  assert.ok(!moveOptions(s).some(m => m.kind === "buy"));
});
scenario("G02", () => {
  for (const supply of [3,4]) {
    const draws = legalDraws({ ...state().bank, S:supply });
    assert.equal(draws.some(d => d.join() === "S,S"), supply === 4);
  }
});
scenario("G03", () => {
  const s = state({ cards:[card("x","S",4,{O:7})], tokens:{ C:2,S:2,E:2,R:2,O:2,G:0 },
    bank:{ C:2,S:2,E:2,R:2,O:2,G:5 } });
  const m = moveOptions(s).find(m => m.kind === "reserve" && m.returned.join() === "R");
  assert.deepEqual([m.state.reserveCount,m.state.tokens.G,m.state.bank.G,m.state.tokens.R,m.state.bank.R],[1,1,4,1,3]);
  assert.equal(m.state.score,0);
  assert.deepEqual(m.state.discounts,zero);
  assert.ok(m.state.cards[0].reserved);
});
scenario("G04", () => {
  const s = state({ cards:[card("x","C",0,{S:3})], discounts:{...zero,C:2,S:4,E:3,O:3},
    nobles:[noble("a",{C:3,S:3,O:3}), noble("b",{C:3,S:3,E:3})] });
  assert.deepEqual(moveOptions(s).filter(m => m.kind === "buy").map(m => m.nobleId), ["a","b"]);
  const buy = moveOptions(s).find(m => m.kind === "buy");
  const take = moveOptions(buy.state).find(m => m.kind === "take");
  assert.deepEqual([buy.state.score,buy.state.nobles.length,take.state.score,take.state.nobles.length],[3,1,6,0]);
});
scenario("G05", () => {
  const seats = [1,2,3,4];
  assert.deepEqual(splendorClassic.responders(seats,2),[3,4]);
  assert.deepEqual(splendorClassic.leaders([9,15,13,16].map((score,i) => ({ id:i+1, score }))).map(p => p.id),[4]);
});
scenario("G06", () => {
  for (const count of [7,8]) {
    const result = splendorClassic.leaders([{id:"A",score:15,cards:count},{id:"B",score:15,cards:8}]);
    assert.deepEqual(result.map(p => p.id),count === 7 ? ["A"] : ["A","B"]);
  }
});
const target = card("target","E",4,{S:7},true);
const bridge = card("bridge","S",0,{O:3});
function race(supply) {
  return state({ score:11, discounts:{...zero,C:1,S:5,O:3}, reserveCount:1,
    bank:{ ...state().bank,S:supply }, cards:[target,bridge] });
}
function turnsToTarget(s, first) {
  let frontier = [first.state];
  for (let turn=2; turn<=3; turn++) {
    const next = frontier.flatMap(moveOptions);
    if (next.some(m => m.kind === "buy" && m.id === "target")) return turn;
    frontier = next.filter(m => m.kind === "take").map(m => m.state);
  }
  return Infinity;
}
for (const [id,supply,turns] of [["P01",4,2],["P02",3,3]]) scenario(id, () => {
  const s = race(supply);
  const moves = moveOptions(s);
  const direct = moves.find(m => m.kind === "take" && (supply === 4 ? m.tokens.join() === "S,S" : m.tokens.includes("S")));
  assert.equal(turnsToTarget(s,direct),turns);
  assert.equal(turnsToTarget(s,moves.find(m => m.kind === "buy" && m.id === "bridge")),3);
  const result = advice(s);
  assert.equal(result.race.projectedWinTurn,turns);
  if (supply === 4) assert.deepEqual(result[result.primary].tokens,["S","S"]);
});
scenario("P03", () => {
  const s = state({discounts:{...zero,C:3,S:2,E:2},nobles:[noble("A",{C:3,S:3,E:3}),noble("B",{C:4,S:4})],
    cards:[card("blue1","S",0,{C:3}),card("green","E",0,{C:3}),card("blue2","S",0,{C:3})]});
  const next = moveOptions(s).find(m => m.kind === "buy" && m.id === "blue1").state;
  const result = advice(next);
  assert.equal(result[result.primary].id,"green");
  assert.equal(result.buy.nobleId,"A");
});
scenario("P04", () => {
  const s = race(4);
  s.cards = [target,card("card_8","C",0,{S:1,E:1,R:1,O:1}),
    card("card_11","S",0,{C:1,E:1,R:1,O:1}),card("card_24","E",0,{C:1,S:1,R:1,O:1}),
    card("card_38","O",0,{C:1,S:1,E:1,R:1})];
  const alternative = moveOptions(s).find(m => m.kind === "take" && m.tokens.join() === "E,R,O");
  assert.equal(moveOptions(alternative.state).filter(m => m.kind === "buy").length,4);
  const result = advice(s);
  assert.deepEqual(result[result.primary].tokens,["S","S"]);
});
scenario("P05", () => {
  for (const reserved of [false,true]) {
    const s = race(4);
    s.cards = [{...target,reserved}];
    s.reserveCount = Number(reserved);
    const result = advice(s);
    assert.equal(result.reserve?.id === "target", !reserved);
  }
});

test("protect a five-point market card the opponent can buy before our next draw", () => {
  const prize = card("prize", "E", 5, { S:7, E:3 });
  const s = state({ cards:[prize], discounts:{...zero,S:4,E:3},tokens:{...zero,S:2} });
  const result = advice(s,[{id:"other",score:10,discounts:{...zero,S:7,E:3},reservedCount:0}]);
  assert.equal(result.primary,"reserve");
  assert.equal(result.reserve.id,"prize");
});

test("color weights follow the mathematical noble and market demand formula", () => {
  const s = state({ cards:[card("target","C",4,{S:7})],
    nobles:[noble("a",{C:3,S:3,E:3}),noble("b",{S:3,R:3,O:3})] });
  const blue = advice(s).race.colorEconomy.find(entry => entry.color === "S");
  assert.equal(blue.nobleNeed, 2 / 3);
  assert.equal(blue.marketNeed, 1 / 12);
  assert.equal(blue.weight, 1 + 0.6 * (2 / 3) + 0.4 / 12);
});

test("cap noble targets at two and drop distant contested nobles", () => {
  const s = state({ nobles: [
    noble("a",{C:3,S:3,E:3}), noble("b",{S:3,R:3,O:3}), noble("c",{C:3,R:3,O:3})
  ] });
  const rivals = Array.from({length:3}, (_, index) => ({ id:"r"+index }));
  assert.deepEqual(advice(s, rivals).race.focusedNobles, []);
  s.discounts = {...zero, C:1,S:1,E:1,R:1,O:1};
  assert.equal(advice(s, rivals).race.focusedNobles.length, 2);
});

test("a rival crossing either phase threshold changes our phase immediately", () => {
  for (const [score, phase] of [[4,"build"],[5,"convert"],[9,"convert"],[10,"finish"],[15,"finish"]]) {
    assert.equal(advice(state(), [{id:"leader",score}]).race.phase, phase);
  }
});

test("a reachable contested tier-three prize can be protected before five points", () => {
  const prize = card("prize", "E", 5, { S:7, E:3 });
  const s = state({ cards:[prize], discounts:{...zero,S:4,E:3}, tokens:{...zero,S:2} });
  const result = advice(s,[{id:"other",discounts:{...zero,S:7,E:3},reservedCount:0}]);
  assert.equal(result.race.phase, "build");
  assert.equal(result.primary, "reserve");
});

test("in conversion a payable tier-three reserve is cashed before a small purchase", () => {
  const s = state({ score:6, reserveCount:1, discounts:{...zero,S:4},
    cards:[card("small","C",1,{S:4}),card("protected","O",4,{S:7},true)],
    tokens:{...zero,S:3} });
  const result = advice(s);
  assert.equal(result.primary, "buy");
  assert.equal(result.buy.id, "protected");
});

test("early tier-three purchase requires six bonuses", () => {
  const s = state({ cards:[card("prize","E",4,{S:1})], tokens:{...zero,S:1} });
  assert.equal(advice(s).buy, null);
  s.discounts = {...zero, C:6};
  assert.equal(advice(s).buy.id, "prize");
});

test("blind reservation is excluded when a face-up reservation scores at least one", () => {
  const s = state({ cards: Array.from({ length: 4 }, (_, index) => card("low" + index, "C", 0, { S: 3 })),
    bank: { ...zero, S: 1, G: 1 } });
  const counters = Object.entries(s.bank).map(([color, count]) =>
    ({ elementId: "coincounter_" + color, text: String(count) }));
  counters.push({ elementId: "drawpile_counter_1", text: "3" },
    { elementId: "spl_playerboard_gemcount", text: "0/10" },
    { elementId: "spl_playerreserve_count", text: "0/3" });
  const result = splendorAdvice({ localPlayerId: "me", counters,
    gameState: { cards: s.cards, nobles: [], players: [{ id: "me", ...s }] } });
  // Each face-up reservation has exactly the gold value, so the threshold blocks blind reserve.
  assert.equal(result.reserve.blind, undefined);
  assert.ok(result.top3.every(move => !move.blind));
  counters.find(counter => counter.elementId === "spl_playerreserve_count").text = "2/3";
  const allowed = splendorAdvice({ localPlayerId: "me", counters,
    gameState: { cards: s.cards, nobles: [], players: [{ id: "me", ...s }] } });
  assert.equal(allowed.reserve.id, "drawpile1");
  assert.equal(allowed.reserve.state.tokens.G, 1);
});
