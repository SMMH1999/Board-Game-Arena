globalThis.forecastSplendorRound = ({ rivals, previousOrder, cards, bank, holdings, locked, events, colors, legalDraws }) => {
  const order = [...new Set(previousOrder)].map(id => rivals.find(player => player.id === id)).filter(Boolean);
  for (const rival of rivals) if (!order.includes(rival)) order.push(rival);
  let scenarios = [{ cards, bank, weight: 1 }];

  for (const rival of order) {
    const recent = events.filter(event => event.playerId === rival.id);
    const preferences = Object.fromEntries(colors.map(color => [color, recent.filter(event =>
      event.action === "gets" && event.icons.some(icon => icon.kind === "token" && icon.color === color)).length]));
    scenarios = scenarios.flatMap(state => {
      const options = [];
      const reserving = recent.some(event => event.action === "reserves");
      for (const card of state.cards) {
        if (card.reserved || card.id === locked || !card.cost) continue;
        const costs = Object.entries(card.cost);
        if (!Number.isInteger(rival.tokens.G) || !costs.every(([color]) =>
          Number.isInteger(rival.tokens[color]) && Number.isInteger(rival.discounts[color]))) continue;
        const payment = {};
        let gold = 0;
        let deficit = 0;
        for (const [color, cost] of costs) {
          const due = Math.max(0, cost - rival.discounts[color]);
          payment[color] = Math.min(due, rival.tokens[color]);
          gold += due - payment[color];
          deficit += due;
        }
        if (gold <= rival.tokens.G) {
          payment.G = gold;
          options.push({ card: card.id, payment, score: 2 + card.points * (rival.score >= 12 ? 2 : 0.8) - 0.12 * deficit });
        } else if (reserving && card.points >= 2 && gold - rival.tokens.G <= 2) {
          // Opponent reserve capacity is unknown. Treat this as a risk scenario.
          options.push({ card: card.id, payment: state.bank.G > 0 ? { G: -1 } : {}, score: 0.75 + 0.2 * card.points });
        }
      }
      options.sort((a, b) => b.score - a.score);
      const draws = legalDraws(state.bank).map(tokens => ({
        tokens, score: 1 + tokens.reduce((sum, color) => sum + preferences[color] * 0.08, 0) +
          (tokens.length === 3 ? 0.2 : 0)
      })).sort((a, b) => b.score - a.score);
      const rivalTotal = [...colors, "G"].reduce((sum, color) => sum + (rival.tokens[color] ?? 0), 0);
      // Unknown returns at the token cap are represented by the unchanged-bank branch.
      const choices = [...options.slice(0, 2), ...draws.filter(draw => draw.tokens.length + rivalTotal <= 10).slice(0, 2),
        { score: 1 }];
      const scale = choices.reduce((sum, move) => sum + move.score, 0);
      return choices.map(choice => {
        const supply = { ...state.bank };
        for (const color of choice.tokens ?? []) supply[color]--;
        for (const [color, paid] of Object.entries(choice.payment ?? {})) {
          if (supply[color] !== null) supply[color] += paid;
        }
        return { cards: choice.card ? state.cards.filter(card => card.id !== choice.card) : state.cards,
          bank: supply, weight: state.weight * choice.score / scale };
      });
    }).sort((a, b) => b.weight - a.weight).slice(0, 8);
  }

  const quickness = (card, supply) => {
    const short = colors.map(color => Math.max(0, (card.due[color] ?? 0) - holdings[color]));
    const deficit = Math.max(0, short.reduce((sum, count) => sum + count, 0) - holdings.G);
    if (card.payment > 10) return 0;
    if (!deficit) return card.value;
    const feasible = colors.reduce((sum, color, index) =>
      sum + Math.max(0, short[index] - (supply[color] ?? short[index])), 0) <= holdings.G;
    return card.value / (1 + deficit * 0.7 + (feasible ? 0 : 2));
  };
  const weight = scenarios.reduce((sum, state) => sum + state.weight, 0);
  const paths = cards.map(card => {
    const survives = scenarios.filter(state => state.cards.includes(card));
    const score = survives.reduce((sum, state) => sum + state.weight * quickness(card, state.bank), 0) / weight;
    return { id: card.id, score, risk: Math.max(0, 1 - survives.reduce((sum, state) => sum + state.weight, 0) / weight) };
  }).sort((a, b) => b.score - a.score);
  return { depth: order.length, paths };
};

// Public-information forecasts for the current board. The scores rank moves without claiming probabilities.
globalThis.predictSplendorRivals = (snapshot, events, rules) => {
  const game = snapshot.gameState;
  if (!game || !rules || !snapshot.localPlayerId) return [];
  const colors = ["C", "S", "E", "R", "O", "G"];
  const bank = Object.fromEntries(colors.map(color => {
    const counter = snapshot.counters.find(item => item.elementId === "coincounter_" + color);
    return [color, /^\d+$/.test(counter?.text ?? "") ? Number(counter.text) : null];
  }));
  if (Object.values(bank).some(value => value === null)) return [];

  const { moveOptions } = splendorClassic.transitions(rules);
  const payment = splendorClassic.payment;
  return game.players.flatMap(player => {
    if (player.id === snapshot.localPlayerId || !Number.isInteger(player.score) ||
        !colors.every(color => Number.isInteger(player.tokens?.[color]) &&
          (color === "G" || Number.isInteger(player.discounts?.[color])))) return [];
    const history = events.filter(event => event.playerId === player.id).slice(-24);
    const cards = [...game.cards.filter(card => !card.reserved),
      ...snapshot.publicRivalReserves.filter(record => record.playerId === player.id)
        .map(record => ({ ...record.card, reserved: true }))];
    const state = { ...player, cards, bank, nobles: game.nobles, decks: {}, buying: 0, cardPoints: 0,
      reserveCount: player.reservedCount ?? rules.reservation_limit };
    const gap = (card, position) => Math.max(0, payment(card, position).G - position.tokens.G);
    const reserveHabit = history.filter(event => event.action === "reserves").length;
    let best;
    let bestScore = -Infinity;
    for (const move of moveOptions(state)) {
      const card = cards.find(item => item.id === move.id);
      let score = (move.state.score - player.score) * 2;
      if (move.kind === "buy") {
        const nobleProgress = game.nobles.reduce((best, noble) => {
          if (!(noble.cost[card.bonus] > player.discounts[card.bonus])) return best;
          const remaining = Object.entries(noble.cost).reduce((sum, [color, cost]) =>
            sum + Math.max(0, cost - move.state.discounts[color]), 0);
          return Math.max(best, remaining ? noble.points / (1 + remaining) : 0);
        }, 0);
        const nextPurchase = cards.reduce((best, target) => {
          if (target.id === card.id || !(target.cost[card.bonus] > player.discounts[card.bonus])) return best;
          const value = (target.points + 1) * (target.reserved ? 1 : 0.45) / (1 + gap(target, move.state));
          return Math.max(best, value);
        }, 0);
        score += 2 + nobleProgress + nextPurchase + (card.reserved ? 0.4 : 0);
      }
      if (move.kind === "reserve") {
        score += (card.points + 1) / (2 + gap(card, move.state)) + (move.gold ? 0.55 : 0) +
          Math.min(0.6, reserveHabit * 0.15);
      }
      if (move.kind === "take") {
        score += Math.max(0, ...cards.map(goal =>
          (gap(goal, state) - gap(goal, move.state)) * (1 + goal.points * 0.22) / (1 + gap(goal, move.state))));
        score += move.tokens.reduce((sum, color) => sum + history.filter(event => event.action === "gets" &&
          event.icons.some(icon => icon.kind === "token" && icon.color === color)).length * 0.025, 0);
        score -= move.returned.length * 0.25;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { playerId: player.id, kind: move.kind, cardId: card?.id ?? null,
          source: card?.reserved ? "reserve" : card ? "market" : null,
          tokens: move.kind === "take" ? move.tokens : [], points: move.state.score - player.score };
      }
    }
    return best ? [best] : [];
  });
};
