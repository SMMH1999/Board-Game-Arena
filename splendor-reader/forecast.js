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
