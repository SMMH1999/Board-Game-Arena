globalThis.splendorRaceAdvice = (snapshot, preferredTarget = null) => {
  const colors = ["C", "S", "E", "R", "O"];
  const gems = [...colors, "G"];
  const { cards, nobles, players } = snapshot.gameState;
  const own = players.find(player => player.id === snapshot.localPlayerId);
  const rivals = players.filter(player => player.id !== snapshot.localPlayerId);
  const counts = Object.fromEntries(snapshot.counters.map(counter => [counter.elementId, counter.text]));
  const integer = value => Number.isInteger(value) && value >= 0;
  const total = tokens => gems.reduce((sum, color) => sum + tokens[color], 0);
  const bank = Object.fromEntries(gems.map(color => {
    const count = counts[`coincounter_${color}`];
    return [color, /^\d+$/.test(count ?? "") ? Number(count) : null];
  }));
  const validStock = player => player && gems.every(color => integer(player.tokens?.[color])) &&
    colors.every(color => integer(player.discounts?.[color]));
  if (!validStock(own) || !integer(own.score) || total(own.tokens) > 10 ||
      counts.spl_playerboard_gemcount !== `${total(own.tokens)}/10`) return null;

  const reserveText = counts.spl_playerreserve_count ?? "";
  const reserved = cards.filter(card => card.reserved).length;
  const reserveCount = /^\d\/3$/.test(reserveText) ? Math.max(reserved, Number(reserveText[0])) : 3;
  const blindDecks = reserveCount < 3 && bank.G !== null ? [1, 2, 3].filter(level =>
    /^[1-9]\d*$/.test(counts[`drawpile_counter_${level}`] ?? "")) : [];
  const initial = {
    cards, nobles, bank, reserveCount, tokens: own.tokens, discounts: own.discounts,
    score: own.score, buying: 0
  };
  const developmentCount = player => colors.reduce((sum, color) => sum + player.discounts[color], 0);
  const openedRound = snapshot.roundOrder;
  const orderKnown = Array.isArray(openedRound) && openedRound.length === players.length &&
    new Set(openedRound).size === players.length && players.every(player => openedRound.includes(player.id));
  const finishRivals = orderKnown
    ? rivals.filter(rival => openedRound.indexOf(rival.id) > openedRound.indexOf(own.id))
    : rivals;

  const eligible = (noble, discounts) =>
    Object.entries(noble.cost).every(([color, count]) => discounts[color] >= count);

  function payment(card, player) {
    const paid = Object.fromEntries(gems.map(color => [color, 0]));
    for (const [color, cost] of Object.entries(card.cost)) {
      const due = Math.max(0, cost - player.discounts[color]);
      paid[color] = Math.min(due, player.tokens[color]);
      paid.G += due - paid[color];
    }
    return paid;
  }

  function rivalCeiling(rival, state) {
    let extra = 0;
    let bought = false;
    if (validStock(rival)) {
      for (const card of state.cards) {
        if (card.reserved || payment(card, rival).G > rival.tokens.G) continue;
        const discounts = { ...rival.discounts, [card.bonus]: rival.discounts[card.bonus] + 1 };
        const bonus = Math.max(0, ...state.nobles.filter(noble => eligible(noble, discounts)).map(noble => noble.points));
        if (card.points + bonus > extra) {
          extra = card.points + bonus;
          bought = true;
        }
      }
    }
    return { score: (rival.score ?? 0) + extra, cards: validStock(rival) ? developmentCount(rival) + Number(bought) : null };
  }

  const rivalStartsEnd = rivals.some(rival => rival.score >= 15);
  const rivalThreat = Math.max(0, ...rivals.map(rival => rivalCeiling(rival, initial).score));
  const target = Math.max(15, rivalThreat);
  const pressure = rivalThreat >= 15 ? 1 : 0.65;

  function moveOptions(state, allowBlind = false) {
    const moves = [];
    for (const card of state.cards) {
      const paid = payment(card, state);
      if (paid.G > state.tokens.G) continue;
      const discounts = { ...state.discounts, [card.bonus]: state.discounts[card.bonus] + 1 };
      const reached = state.nobles.filter(noble => eligible(noble, discounts)).sort((a, b) => b.points - a.points)[0];
      const tokens = Object.fromEntries(gems.map(color => [color, state.tokens[color] - paid[color]]));
      moves.push({
        kind: "buy", id: card.id, reserved: card.reserved, earnsNoble: Boolean(reached),
        state: { ...state, discounts, tokens, bank: exchangeBank(state, tokens),
          cards: state.cards.filter(other => other.id !== card.id),
          nobles: state.nobles.filter(noble => noble !== reached),
          score: state.score + card.points + (reached?.points ?? 0),
          buying: state.buying + 1,
          reserveCount: state.reserveCount - Number(card.reserved) }
      });
    }

    const available = colors.filter(color => state.bank[color] > 0);
    const draws = [];
    if (colors.every(color => state.bank[color] !== null)) {
      for (let mask = 1; mask < 2 ** available.length; mask++) {
        const take = available.filter((_, index) => mask & (1 << index));
        if (take.length === Math.min(3, available.length)) draws.push(take);
      }
      for (const color of available) if (state.bank[color] >= 4) draws.push([color, color]);
    }
    const uniqueTakes = new Map();
    const gaps = state.cards.map(card => Math.max(0, payment(card, state).G - state.tokens.G));
    for (const take of draws) {
      for (const { tokens, returned } of applyTokens(state, take)) {
        if (returned.length && !state.cards.some((card, index) =>
          Math.max(0, payment(card, { discounts: state.discounts, tokens }).G - tokens.G) < gaps[index])) continue;
        const key = gems.map(color => tokens[color]).join(",");
        const move = { kind: "take", tokens: take, returned,
          state: { ...state, tokens, bank: exchangeBank(state, tokens) } };
        if (!uniqueTakes.has(key) || uniqueTakes.get(key).returned.length > returned.length) uniqueTakes.set(key, move);
      }
    }
    moves.push(...uniqueTakes.values());

    if (state.reserveCount < 3 && state.bank.G !== null) {
      const gold = state.bank.G > 0;
      const stock = gold ? applyTokens(state, ["G"], true) : [{ tokens: state.tokens, returned: [] }];
      const options = [...state.cards.filter(card => !card.reserved)];
      if (allowBlind) options.push(...blindDecks.map(level => ({ id: `drawpile${level}` })));
      for (const card of options) {
        for (const { tokens, returned } of stock) moves.push({
          kind: "reserve", id: card.id, gold, returned,
          state: { ...state, tokens, bank: exchangeBank(state, tokens), reserveCount: state.reserveCount + 1,
            cards: state.cards.map(other => other === card ? { ...other, reserved: true } : other) }
        });
      }
    }
    return moves;
  }

  function exchangeBank(state, tokens) {
    return Object.fromEntries(gems.map(color => [color,
      state.bank[color] === null ? null : state.bank[color] + state.tokens[color] - tokens[color]
    ]));
  }

  function applyTokens(state, drawn, allowUnchanged = false) {
    const tokens = { ...state.tokens };
    for (const color of drawn) tokens[color]++;
    const needed = Math.max(0, total(tokens) - 10);
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

  const contested = new Set(cards.filter(card => !card.reserved && rivals.some(rival =>
    validStock(rival) && payment(card, rival).G <= rival.tokens.G)).map(card => card.id));
  function routes(state) {
    return state.cards.flatMap(card => {
      const paid = payment(card, state);
      const deficit = Math.max(0, paid.G - state.tokens.G);
      const shortage = colors.reduce((sum, color) => sum + Math.max(0,
        (card.cost[color] ?? 0) - state.discounts[color] - state.tokens[color] -
        (state.bank[color] ?? 0)), 0);
      const nextDiscounts = { ...state.discounts, [card.bonus]: state.discounts[card.bonus] + 1 };
      const points = card.points + Math.max(0, ...state.nobles.filter(noble =>
        eligible(noble, nextDiscounts)).map(noble => noble.points));
      const unlocks = state.cards.filter(other => other.id !== card.id &&
        (other.cost[card.bonus] ?? 0) > state.discounts[card.bonus]);
      const progress = unlocks.reduce((sum, other) => sum + (other.points ? 1 : 0.35), 0);
      const exposed = !card.reserved && contested.has(card.id);
      const risk = exposed ? 1 : 0;
      const turns = 1 + Math.max(Math.ceil(deficit / 3), ...colors.map(color => Math.ceil(Math.max(0,
        (card.cost[color] ?? 0) - state.discounts[color] - state.tokens[color] - state.tokens.G) / 2)));
      const score = (points * pressure + Math.min(progress, 4) * (1.2 - pressure) + 0.35) /
        (turns + 0.5 * deficit + Math.max(0, shortage - state.tokens.G) * 0.8 + risk * 0.7);
      return [{ id: card.id, score, risk, turns }];
    }).sort((a, b) => b.score - a.score || Number(b.id === preferredTarget) - Number(a.id === preferredTarget));
  }

  function endValue(state, depth) {
    // A projected final score can be challenged by the rivals with turns still to play.
    const ourCount = developmentCount(state);
    const threats = rivals.map(rival => finishRivals.includes(rival) ? rivalCeiling(rival, state) : {
      score: rival.score ?? 0,
      cards: validStock(rival) ? developmentCount(rival) : null
    });
    const beaten = threats.some(rival => rival.score > state.score ||
      (rival.score === state.score && (rival.cards === null || rival.cards <= ourCount)));
    return (beaten ? 8 : 36) - depth * 3 + (state.score - target) * 0.8;
  }

  function evaluate(move, depth) {
    const state = move.state;
    const end = state.score >= 15 || rivalStartsEnd;
    if (end) return endValue(state, depth);
    const paths = routes(state);
    const life = Math.max(0, 4 - depth);
    const score = (state.score - own.score) * (1.1 + pressure) + state.buying * life * 0.15;
    const options = (paths[0]?.score ?? 0) + (paths[1]?.score ?? 0) * 0.42;
    const slack = colors.filter(color => state.tokens[color] > 0).length * 0.07 -
      Math.max(0, total(state.tokens) - 8) * 0.12;
    const delay = move.kind === "take" ? move.returned.length * 0.09 : 0;
    return score + options + slack - delay;
  }

  // A shallow, bounded beam evaluates real payments, gold, reserve slots and returns.
  const rank = (moves, depth, limit) => moves.map(move => ({ ...move, value: evaluate(move, depth) }))
    .sort((a, b) => b.value - a.value).slice(0, limit);
  const roots = rank(moveOptions(initial, true), 1, Infinity);
  const candidates = ["buy", "take", "reserve"].flatMap(kind => roots.filter(move => move.kind === kind).slice(0, 6));
  function bestContinuation(root) {
    let frontier = [root];
    let best = root.value;
    let followup;
    for (let depth = 2; depth <= 3 && frontier.length; depth++) {
      frontier = rank(frontier.flatMap(move => {
        if (move.state.score >= 15 || rivalStartsEnd) return [];
        // Charge the continuation for relying on a market card that rivals can buy now.
        return moveOptions(move.state).map(next => ({
          ...next, followup: move.followup ?? (next.kind === "buy" ? next.id : null),
          exposure: (move.exposure ?? 0) +
            Number(next.kind === "buy" && !next.reserved && contested.has(next.id)) * 1.15
        }));
      }), depth, 4);
      for (const move of frontier) {
        const latePenalty = rivalThreat >= 15 ? (depth - 1) * 4 : (depth - 1) * 0.75;
        const value = move.value - latePenalty - (move.exposure ?? 0);
        if (value > best) {
          best = value;
          followup = move.followup;
        }
      }
    }
    const followupCard = cards.find(card => card.id === followup);
    const goldOpensPurchase = followupCard && root.state.tokens.G > initial.tokens.G &&
      payment(followupCard, initial).G > initial.tokens.G &&
      payment(followupCard, root.state).G <= root.state.tokens.G;
    const protectsFollowup = root.id === followup && contested.has(root.id);
    const speculativeReserve = root.kind === "reserve" && !goldOpensPurchase && !protectsFollowup;
    return { ...root, followup, score: best + 0.18 * root.value - (speculativeReserve ? 1.5 : 0) };
  }
  const moves = candidates.map(bestContinuation).sort((a, b) => b.score - a.score);
  const top = moves[0];
  const buy = moves.find(move => move.kind === "buy") ?? null;
  const take = moves.find(move => move.kind === "take") ?? null;
  const reserve = moves.find(move => move.kind === "reserve") ?? null;
  const reservedBuy = moves.find(move => move.kind === "buy" && move.reserved) ??
    roots.find(move => move.kind === "buy" && move.reserved) ?? null;
  const paths = top && top.state.score < 15 && !rivalStartsEnd ? routes(top.state) : [];
  const chosenPath = paths.findIndex(path => path.id === top?.followup);
  if (chosenPath > 0) paths.unshift(...paths.splice(chosenPath, 1));
  return { primary: top?.kind ?? null, buy, take, reserve, reservedBuy,
    paths: paths.slice(0, 2), bank, blindDecks, forecastDepth: 0,
    race: { target, rivalThreat, orderKnown, finishing: Boolean(top && top.state.score >= 15),
      ownNextScore: top?.state.score ?? own.score } };
};
