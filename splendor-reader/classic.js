// Rules shared by the live advisor, hypothetical transitions and result classification.
globalThis.splendorClassic = {
  payment(card, player) {
    const paid = { C: 0, S: 0, E: 0, R: 0, O: 0, G: 0 };
    for (const [color, cost] of Object.entries(card.cost)) {
      const due = Math.max(0, cost - player.discounts[color]);
      paid[color] = Math.min(due, player.tokens[color]);
      paid.G += due - paid[color];
    }
    return paid;
  },
  claims(move) {
    const { state } = move;
    const nobles = state.nobles.filter(n => Object.entries(n.cost).every(([c, v]) => state.discounts[c] >= v));
    if (!nobles.length) return [move];
    return nobles.map(noble => ({ ...move, earnsNoble: true, nobleId: noble.id,
      state: { ...state, nobles: state.nobles.filter(n => n.id !== noble.id), score: state.score + noble.points } }));
  },
  responders(order, actor) {
    return order.slice(order.indexOf(actor) + 1);
  },
  leaders(players) {
    const high = Math.max(...players.map(p => p.score));
    const leaders = players.filter(p => p.score === high);
    if (leaders.length === 1) return leaders;
    if (leaders.some(p => !Number.isInteger(p.cards))) return [];
    const fewest = Math.min(...leaders.map(p => p.cards));
    return leaders.filter(p => p.cards === fewest);
  }
};

globalThis.splendorClassic.transitions = rules => {
  const colors = ["C", "S", "E", "R", "O"];
  const gems = [...colors, "G"];
  const total = tokens => gems.reduce((sum, color) => sum + tokens[color], 0);
  const payment = splendorClassic.payment;
  // Replacements have an unknown identity until the page reveals them.
  function afterMarketRemoval(state, card) {
    if (card.reserved || !(state.decks[card.level] > 0)) return state.decks;
    return { ...state.decks, [card.level]: state.decks[card.level] - 1 };
  }

  function moveOptions(state) {
    const moves = [];
    for (const card of state.cards) {
      const paid = payment(card, state);
      if (paid.G > state.tokens.G) continue;
      const discounts = { ...state.discounts, [card.bonus]: state.discounts[card.bonus] + 1 };

      const tokens = Object.fromEntries(gems.map(color => [color, state.tokens[color] - paid[color]]));
      moves.push({
        kind: "buy", id: card.id, reserved: card.reserved, paid,
        state: { ...state, discounts, tokens, bank: exchangeBank(state, tokens),
          decks: afterMarketRemoval(state, card), cards: state.cards.filter(other => other.id !== card.id),
          nobles: state.nobles,
          score: state.score + card.points,
          cardPoints: state.cardPoints + card.points,
          buying: state.buying + 1,
          reserveCount: state.reserveCount - Number(Boolean(card.reserved)) }
      });
    }

    const draws = legalDraws(state.bank);
    const uniqueTakes = new Map();
    for (const take of draws) {
      for (const { tokens, returned } of applyTokens(state, take, true)) {
        const key = gems.map(color => tokens[color]).join(",");
        const move = { kind: "take", tokens: take, returned,
          state: { ...state, tokens, bank: exchangeBank(state, tokens) } };
        if (!uniqueTakes.has(key) || uniqueTakes.get(key).returned.length > returned.length) uniqueTakes.set(key, move);
      }
    }
    moves.push(...uniqueTakes.values());

    if (state.reserveCount < rules.reservation_limit && state.bank.G !== null) {
      const gold = state.bank.G > 0;
      const stock = gold ? applyTokens(state, ["G"], true) : [{ tokens: state.tokens, returned: [] }];
      for (const card of state.cards) {
        if (card.reserved) continue;
        for (const { tokens, returned } of stock) {
          const next = { ...state, tokens, bank: exchangeBank(state, tokens) };
          moves.push({
            kind: "reserve", id: card.id, gold, returned,
            state: { ...next, decks: afterMarketRemoval(state, card), reserveCount: state.reserveCount + 1,
              cards: state.cards.map(other => other === card ? { ...other, reserved: true } : other) }
          });
        }
      }
    }
    return moves.flatMap(splendorClassic.claims);
  }

  function legalDraws(supply) {
    if (colors.some(color => supply[color] === null)) return [];
    const available = colors.filter(color => supply[color] > 0);
    const draws = available.filter(color => supply[color] >= 4).map(color => [color, color]);
    for (let mask = 1; mask < 2 ** available.length; mask++) {
      const selected = available.filter((_, index) => mask & (1 << index));
      if (selected.length === Math.min(3, available.length)) draws.push(selected);
    }
    return draws;
  }

  function exchangeBank(state, tokens) {
    return Object.fromEntries(gems.map(color => [color,
      state.bank[color] === null ? null : state.bank[color] + state.tokens[color] - tokens[color]
    ]));
  }

  function applyTokens(state, drawn, allowUnchanged = false) {
    const tokens = { ...state.tokens };
    for (const color of drawn) tokens[color]++;
    const needed = Math.max(0, total(tokens) - rules.hand_token_limit_at_end);
    const results = [];
    function visit(start, returned) {
      if (returned.length === needed) {
        if (allowUnchanged || gems.some(color => tokens[color] !== state.tokens[color])) {
          results.push({ tokens: { ...tokens }, returned });
        }
        return;
      }
      for (let index = start; index < gems.length; index++) {
        const color = gems[index];
        if (tokens[color] <= 0) continue;
        tokens[color]--;
        visit(index, [...returned, color]);
        tokens[color]++;
      }
    }
    visit(0, []);
    return results;
  }

  return { moveOptions, legalDraws, applyTokens };
};
