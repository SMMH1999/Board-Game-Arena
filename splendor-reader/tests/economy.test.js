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
    const exposed = result.race.removalScenarios;
    assert.equal(exposed.some(line => line.target === "target"), !reserved);
  }
});

test("protect a five-point market card the opponent can buy before our next draw", () => {
  const prize = card("prize", "E", 5, { S:7, E:3 });
  const s = state({ cards:[prize], discounts:{...zero,S:4,E:3},tokens:{...zero,S:2} });
  const result = advice(s,[{id:"other",score:10,discounts:{...zero,S:7,E:3},reservedCount:0}]);
  assert.equal(result.primary,"reserve");
  assert.equal(result.reserve.id,"prize");
});

test("a shared noble color and a payable reserve cost reinforce the same bonus", () => {
  const s = state({cards:[card("target","C",4,{S:7},true)], reserveCount:1,
    nobles:[noble("a",{C:3,S:3,E:3}),noble("b",{S:3,R:3,O:3})]});
  const blue = advice(s).race.colorEconomy.find(entry => entry.color === "S");
  assert.equal(blue.nobleNeed,2);
  assert.equal(blue.weight,1);
  s.discounts = {...zero,S:7};
  assert.equal(advice(s).race.colorEconomy.find(entry => entry.color === "S").weight,0);
});

test("unknown deck tops are excluded and a preferred color adds weight", () => {
  const s = state({ decks: { 1: 36, 2: 26, 3: 16 } });
  assert.ok(moveOptions(s).every(move => move.kind !== "reserve"));
  const counters = Object.entries(s.bank).map(([color, count]) =>
    ({ elementId: "coincounter_" + color, text: String(count) }));
  counters.push({ elementId: "spl_playerboard_gemcount", text: "0/10" });
  const snapshot = { localPlayerId: "me", counters,
    gameState: { cards: [], nobles: [], players: [{ id: "me", ...s }] } };
  const result = splendorAdvice(snapshot, null, null, [], "E");
  assert.equal(result.race.colorEconomy.find(entry => entry.color === "E").weight, 0.5);
  assert.deepEqual(result.race.recommendedColors, []);
});

test("target three nobles in four-player games and two in two- and three-player games", () => {
  for (const count of [2,3,4]) {
    const s = state({ cards: [], nobles: [
      noble("a",{C:3,S:3,E:3}), noble("b",{S:3,R:3,O:3}),
      noble("c",{C:3,R:3,O:3}), noble("d",{C:4,S:4})
    ] });
    const others = Array.from({length:count-1},(_,i)=>({id:"r"+i}));
    const result = advice(s,others);
    assert.equal(result.race.focusedNobles.length, count === 4 ? 3 : 2);
  }
});
