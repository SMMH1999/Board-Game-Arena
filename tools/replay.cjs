// Replay only what was known at each recorded local turn.
const fs = require("node:fs");
const spec = require("../splendor-reader/strategies/splendor_strategy_codex.json");
globalThis.splendorActiveStrategy = { ...spec, id: spec.spec_id, source: "bundled" };
require("../splendor-reader/classic.js");
require("../splendor-reader/race.js");
require("../splendor-reader/advice.js");

const [file, localId] = process.argv.slice(2);
if (!file) throw new Error("Usage: node tools/replay.cjs game.json [local-player-id]");
const game = JSON.parse(fs.readFileSync(file, "utf8"));
const localPlayerId = game.localPlayerId ?? localId;
if (!game.timeline.some(turn => turn.players.some(player => player.id === localPlayerId))) {
  throw new Error("Supply the recorded local player's ID for this archive.");
}
let focus = [];
for (const turn of game.timeline) {
  if (turn.finished || turn.activePlayerId !== localPlayerId) continue;
  const cards = [...turn.market, ...turn.reserved].map(id =>
    ({ ...game.cards[id], id, reserved: turn.reserved.includes(id) }));
  const publicRivalReserves = (turn.publicRivalReserves ?? []).filter(r => game.cards[r.cardId])
    .map(r => ({ ...r, card: { ...game.cards[r.cardId], id: r.cardId } }));
  const result = splendorAdvice({
    localPlayerId, rivalEvents: game.actions.filter(event => event.move <= turn.move).slice(-36), roundOrder: turn.roundOrder, publicRivalReserves,
    counters: Object.entries(turn.counters).map(([elementId, text]) => ({ elementId, text })),
    gameState: { cards, nobles: turn.nobles, players: turn.players }
  }, null, null, focus);
  focus = result.race?.focusedNobles ?? focus;
  const selected = result[result.primary];
  console.log(JSON.stringify({ move: turn.move, players: turn.players.length, strategy: result.strategyId,
    action: result.primary, target: selected?.tokens ?? selected?.id, incomplete: result.incomplete }));
}
