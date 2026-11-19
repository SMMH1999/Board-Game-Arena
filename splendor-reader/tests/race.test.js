const assert = require("node:assert/strict");
const test = require("node:test");
require("../classic.js");
globalThis.splendorActiveStrategy = require("../strategies/splendor_strategy_codex.json");
require("../race.js");

const zero = { C: 0, S: 0, E: 0, R: 0, O: 0, G: 0 };
const player = (id, score = 0, tokens = {}, discounts = {}, reservedCount = 0) =>
  ({ id, score, tokens: { ...zero, ...tokens }, discounts: { ...zero, ...discounts }, reservedCount });
const card = (id, level, bonus, points, cost) => ({ id, level, bonus, points, cost });
const noble = (id, cost) => ({ id, cost, points: 3 });

function makeAdvice({ own, rivals, cards, nobles = [], rivalEvents = [], publicRivalReserves = [], roundOrder }) {
  const counters = Object.keys(zero).map(color => ({
    elementId: `coincounter_${color}`, text: color === "G" ? "4" : "5"
  }));
  const held = Object.values(own.tokens).reduce((sum, count) => sum + count, 0);
  counters.push({ elementId: "spl_playerboard_gemcount", text: `${held}/10` });
  counters.push({ elementId: "spl_playerreserve_count", text: `${own.reservedCount}/3` });
  return globalThis.splendorRaceAdvice({
    localPlayerId: own.id, rivalEvents, publicRivalReserves, roundOrder, counters,
    gameState: { cards, nobles, players: [own, ...rivals] }
  });
}

test("a close opening draw supports a reachable discount and the overlapping noble target", () => {
  const reserve = card("card_68", 2, "O", 2, { C: 5 });
  const options = {
    own: player("own"),
    rivals: [player("rival1", 0, { G: 1 }, {}, 1), player("rival2")],
    rivalEvents: [{ playerId: "rival1", action: "reserves" }],
    publicRivalReserves: [{ playerId: "rival1", card: reserve }],
    nobles: [
      noble("noble_1", { E: 4, R: 4 }),
      noble("noble_4", { C: 4, O: 4 }),
      noble("noble_6", { C: 3, S: 3, O: 3 }),
      noble("noble_11", { S: 3, E: 3, O: 3 })
    ],
    cards: [
      card("card_1", 1, "C", 0, { C: 3, S: 1, O: 1 }),
      card("card_15", 1, "S", 0, { E: 2, O: 2 }),
      card("card_18", 1, "E", 0, { S: 2, R: 2 }),
      card("card_21", 1, "E", 0, { C: 1, S: 1, R: 1, O: 2 }),
      card("card_44", 2, "C", 2, { R: 5 }),
      card("card_46", 2, "C", 3, { C: 6 }),
      card("card_47", 2, "S", 1, { S: 2, E: 3, O: 3 }),
      card("card_57", 2, "E", 1, { C: 3, E: 2, R: 3 }),
      card("card_74", 3, "C", 5, { C: 3, O: 7 }),
      card("card_85", 3, "R", 4, { E: 7 }),
      card("card_88", 3, "O", 4, { E: 3, R: 6, O: 3 }),
      card("card_89", 3, "O", 5, { R: 7, O: 3 })
    ]
  };
  const advice = makeAdvice(options);

  assert.equal(advice.primary, "take");
  assert.deepEqual(advice.take.tokens, ["C", "S", "O"]);
  assert.equal(advice.paths[0].id, "card_1");
  assert.equal(advice.paths[0].turns, 2);
  assert.equal(advice.race.nobleTarget.id, "noble_6");
  assert.deepEqual(advice.race.discountGroups, [["O", "S"], ["C", "E"], ["R"]]);
  assert.deepEqual(advice.race.discountPriorities.map(item => item.appearances), [3, 2, 2, 2, 1]);

  const afterNobleIsTaken = makeAdvice({
    ...options, nobles: options.nobles.filter(item => item.id !== "noble_6")
  });
  assert.equal(afterNobleIsTaken.race.nobleTarget.id, "noble_11");
});

test("a purchase that completes a noble still outranks building the opening economy at the end of the round", () => {
  const advice = makeAdvice({
    own: player("own", 11, { C: 2 }, { R: 3, O: 4 }),
    rivals: [player("rival", 13, { R: 2 }, { S: 6, E: 6 })],
    roundOrder: ["rival", "own"],
    nobles: [noble("noble_1", { R: 4, O: 4 })],
    cards: [card("card_1", 1, "R", 1, { C: 1 }), card("card_3", 2, "O", 3, { R: 2 })]
  });

  assert.equal(advice.primary, "buy");
  assert.equal(advice.buy.id, "card_1");
  assert.equal(advice.buy.earnsNoble, true);
  assert.equal(advice.race.ownNextScore, 15);
});

test("an opening without a noble path keeps two reachable purchase options", () => {
  const advice = makeAdvice({
    own: player("own"),
    rivals: [player("rival")],
    cards: [
      card("card_1", 1, "R", 1, { C: 1, S: 1, E: 1 }),
      card("card_2", 1, "C", 0, { C: 1, S: 1, R: 1 })
    ]
  });

  assert.equal(advice.primary, "take");
  assert.equal(new Set(advice.take.tokens).size, 3);
  assert.equal(advice.paths.length, 2);
  assert.deepEqual(advice.race.discountGroups, []);
});

test("bank the points on an affordable reserve before preparing another purchase", () => {
  const advice = makeAdvice({
    own: player("own", 4, { C: 2 }, { O: 1 }, 1),
    rivals: [player("rival", 7)],
    cards: [
      { ...card("card_72", 3, "C", 4, { C: 2, O: 1 }), reserved: true },
      card("card_9", 1, "O", 0, { O: 1 }),
      card("card_76", 3, "S", 5, { E: 4 })
    ]
  });

  assert.equal(advice.primary, "buy");
  assert.equal(advice.buy.id, "card_72");
  assert.equal(advice.race.immediatePoints, 4);
});

test("secure the exposed scoring card before the protected noble-winning purchase", () => {
  const advice = makeAdvice({
    own: player("own", 8, { C: 2 }, { O: 3, C: 4 }, 1),
    rivals: [player("rival", 8)],
    nobles: [noble("noble_4", { C: 4, O: 4 })],
    cards: [
      { ...card("card_65", 2, "O", 1, { C: 5 }), reserved: true },
      card("card_17", 1, "E", 3, { C: 6 })
    ]
  });

  assert.equal(advice.primary, "buy");
  assert.equal(advice.buy.id, "card_17");
  assert.equal(advice.take?.state.score ?? 8, 8);
  assert.equal(advice.race.projectedWinTurn, 3);
});

test("take fewer immediate points if the purchase blocks an opponent's projected winning finish", () => {
  const advice = makeAdvice({
    own: player("own", 11, { C: 1, O: 1 }),
    rivals: [player("rival", 13, { O: 1 })],
    roundOrder: ["own", "rival"],
    cards: [
      card("card_76", 3, "C", 5, { C: 1 }),
      card("card_72", 3, "O", 4, { O: 1 })
    ]
  });

  assert.equal(advice.primary, "buy");
  assert.equal(advice.buy.id, "card_72");
  assert.equal(advice.race.ownNextScore, 15);
});
