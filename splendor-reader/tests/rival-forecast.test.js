const assert = require("node:assert/strict");
const test = require("node:test");
require("../classic.js");
require("../forecast.js");
require("../reserve-tracker.js");
const { rules } = require("../strategies/splendor_strategy_codex.json");

test("a face-up reservation is remembered, forecast as a purchase and removed upon purchase", () => {
  const tracker = createSplendorReserveTracker();
  const card = { id: "card_1", level: 3, bonus: "R", points: 4, cost: { C: 1 } };
  const tokens = { C: 1, S: 0, E: 0, R: 0, O: 0, G: 0 };
  const discounts = { ...tokens, C: 0 };
  const player = { id: "rival", tokens, discounts, score: 11, reservedCount: 0 };
  const purchase = { id: "buy", playerId: "rival", action: "buys", source: "reserve", move: 3, icons: [] };
  const reserve = { id: "reserve", playerId: "rival", action: "reserves", move: 2, icons: [] };
  function snapshot(move, cards, rival, events) {
    return { move, localPlayerId: "me", turnText: "Rival must play",
      counters: Object.keys(tokens).map(color => ({ elementId: "coincounter_" + color, text: "3" })),
      gameState: { cards, players: [rival], events, nobles: [] } };
  }
  tracker.observe(snapshot(1, [card], player, []));
  const afterReserve = snapshot(2, [], { ...player, reservedCount: 1 }, [reserve]);
  afterReserve.publicRivalReserves = tracker.observe(afterReserve);
  assert.equal(tracker.cardId(reserve), card.id);
  const [prediction] = predictSplendorRivals(afterReserve, [reserve], rules);
  assert.equal(prediction.kind, "buy");
  assert.equal(prediction.cardId, card.id);
  assert.equal(prediction.source, "reserve");
  const afterPurchase = snapshot(3, [], { ...player, score: 15 }, [purchase]);
  assert.deepEqual(tracker.observe(afterPurchase), []);
  assert.equal(tracker.cardId(purchase), card.id);
});
