globalThis.createSplendorReserveTracker = () => {
  let baseline;
  let latest;
  const identified = new Map();
  const purchased = discounts => Object.values(discounts ?? {}).reduce((sum, count) => sum + count, 0);

  function observe(snapshot) {
    const { gameState, move, localPlayerId, turnText } = snapshot;
    if (!gameState || !Number.isInteger(move) || !/must play|your turn|end of (?:the )?game|game over/i.test(turnText)) {
      return latest?.records ?? [];
    }
    if (latest && move !== latest.move) baseline = latest;
    const consecutive = baseline?.move === move - 1;
    const records = (baseline?.records ?? []).filter(record => {
      if (consecutive) return true;
      const player = gameState.players.find(item => item.id === record.playerId);
      return Number.isInteger(player?.reservedCount) && player.reservedCount >= baseline.counts[player.id] &&
        purchased(player.discounts) === purchased(baseline.discounts[player.id]);
    });
    if (consecutive) {
      const market = gameState.cards.filter(card => !card.reserved);
      const before = baseline.market;
      const gone = before.filter(card => !market.some(other => other.id === card.id));
      const added = market.filter(card => !before.some(other => other.id === card.id));
      const actions = gameState.events.filter(event => event.move === move);
      const actor = actions.find(event => event.action === "reserves" || event.action === "buys");
      const rival = gameState.players.find(player => player.id === actor?.playerId && player.id !== localPlayerId);
      const oldCount = baseline.counts[rival?.id];
      if (rival && Number.isInteger(oldCount) && Number.isInteger(rival.reservedCount)) {
        if (actor.action === "reserves" && rival.reservedCount === oldCount + 1 &&
            gone.length === 1 && (added.length === 0 || added.length === 1 && added[0].level === gone[0].level)) {
          // The card was identified while face up in the public market.
          records.push({ playerId: rival.id, card: gone[0], move });
          identified.set(actor.id, gone[0].id);
        }
        if (actor.action === "buys" && actor.source === "market" && gone.length === 1) {
          identified.set(actor.id, gone[0].id);
        }
        if (actor.action === "buys" && actor.source === "reserve" && rival.reservedCount === oldCount - 1) {
          const color = actor.icons.find(icon => icon.kind === "card")?.color;
          const payment = actions.filter(event => event.action === "gives" && event.playerId === rival.id)
            .flatMap(event => event.icons).filter(icon => icon.kind === "token");
          const discounts = baseline.discounts[rival.id];
          const possible = records.filter(record => {
            if (record.playerId !== rival.id || (color && record.card.bonus !== color)) return false;
            if (!payment.length || !discounts || Object.values(discounts).some(value => !Number.isInteger(value))) return true;
            let goldDue = 0;
            for (const gem of ["C", "S", "E", "R", "O"]) {
              const due = Math.max(0, (record.card.cost[gem] ?? 0) - discounts[gem]);
              const paid = payment.filter(icon => icon.color === gem).length;
              if (paid > due) return false;
              goldDue += due - paid;
            }
            return goldDue === payment.filter(icon => icon.color === "G").length;
          });
          if (possible.length === 1 && records.filter(record => record.playerId === rival.id).length === oldCount) {
            identified.set(actor.id, possible[0].card.id);
          }
          for (const record of possible) records.splice(records.indexOf(record), 1);
        }
      }
    }
    for (const player of gameState.players) {
      if (Number.isInteger(player.reservedCount) &&
          records.filter(record => record.playerId === player.id).length > player.reservedCount) {
        for (let index = records.length - 1; index >= 0; index--) {
          if (records[index].playerId === player.id) records.splice(index, 1);
        }
      }
    }
    latest = { move, records, market: gameState.cards.filter(card => !card.reserved),
      counts: Object.fromEntries(gameState.players.map(player => [player.id, player.reservedCount])),
      discounts: Object.fromEntries(gameState.players.map(player => [player.id, player.discounts])) };
    return records;
  }

  return { observe, cardId: event => identified.get(event.id) };
};
