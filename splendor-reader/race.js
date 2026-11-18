globalThis.splendorRaceAdvice = (snapshot, preferredTarget = null, deferredBuy = null) => {
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
      counts.spl_playerboard_gemcount !== `${total(own.tokens)}/10`) {
    return { primary: null, incomplete: "resources", paths: [], bank };
  }

  // Missing face-up pieces on a nonempty tier make the purchase comparison unreliable.
  const incompleteMarket = [1, 2, 3].some(level => {
    const deck = counts[`drawpile_counter_${level}`];
    return /^\d+$/.test(deck ?? "") && Number(deck) > 0 &&
      cards.filter(card => !card.reserved && card.level === level).length < 4;
  });
  if (incompleteMarket) return { primary: null, incomplete: "market", paths: [], bank };

  const reserveText = counts.spl_playerreserve_count ?? "";
  const reserved = cards.filter(card => card.reserved).length;
  const reserveCount = /^\d\/3$/.test(reserveText) ? Math.max(reserved, Number(reserveText[0])) : 3;
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
  const hiddenThreat = rivals.filter(rival => rival.score >= 9 && rival.reservedCount !== 0);
  const pressure = rivalThreat >= 15 || hiddenThreat.length ? 1 : 0.65;

  function moveOptions(state) {
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

    const draws = legalDraws(state.bank);
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
      for (const card of state.cards) {
        const gap = payment(card, state).G - state.tokens.G;
        if (card.reserved || gap <= 0) continue;
        for (const { tokens, returned } of stock) {
          const next = { ...state, tokens, bank: exchangeBank(state, tokens) };
          const goldUnlocks = tokens.G > state.tokens.G && payment(card, next).G <= tokens.G;
          const opensWithOneDraw = contested.has(card.id) && legalDraws(next.bank).some(draw => {
            const after = { ...tokens };
            for (const color of draw) after[color]++;
            return payment(card, { tokens: after, discounts: state.discounts }).G <= after.G &&
              Object.entries(card.cost).reduce((sum, [color, cost]) =>
                sum + Math.max(0, cost - state.discounts[color]), 0) <= 10;
          });
          if (!goldUnlocks && !opensWithOneDraw) continue;
          moves.push({
            kind: "reserve", id: card.id, gold, returned,
            state: { ...next, reserveCount: state.reserveCount + 1,
              cards: state.cards.map(other => other === card ? { ...other, reserved: true } : other) }
          });
        }
      }
    }
    return moves;
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
  function nobleFocus(state) {
    const focus = Object.fromEntries(colors.map(color => [color, 0]));
    for (const noble of state.nobles) {
      const costs = Object.entries(noble.cost);
      const distance = costs.reduce((sum, [color, count]) =>
        sum + Math.max(0, count - state.discounts[color]), 0);
      const category = costs.length === 3 && costs.every(([, count]) => count === 3) ? 1.38 : 1;
      const value = category * noble.points / (2 + distance);
      for (const [color, count] of costs) {
        if (state.discounts[color] < count) focus[color] += value;
      }
    }
    return focus;
  }

  const earlyFocus = nobleFocus(initial);
  const nobleProgress = state => state.nobles.reduce((sum, noble) => {
    const costs = Object.entries(noble.cost);
    const remaining = costs.reduce((missing, [color, count]) =>
      missing + Math.max(0, count - state.discounts[color]), 0);
    const original = costs.reduce((missing, [color, count]) =>
      missing + Math.max(0, count - initial.discounts[color]), 0);
    const category = costs.length === 3 && costs.every(([, count]) => count === 3) ? 1.38 : 1;
    return sum + (original - remaining) * category * noble.points / (2 + remaining);
  }, 0);

  function routes(state) {
    const focus = nobleFocus(state);
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
      const score = (points * pressure + Math.min(progress, 4) * (1.2 - pressure) + (focus[card.bonus] ?? 0) * 0.95 + 0.35) /
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
    return score + options + slack - delay + nobleProgress(state) * (rivalThreat >= 15 ? 0.45 : 1);
  }

  // A shallow, bounded beam evaluates real payments, gold, reserve slots and returns.
  const rank = (moves, depth, limit) => moves.map(move => ({ ...move, value: evaluate(move, depth) }))
    .sort((a, b) => b.value - a.value).slice(0, limit);
  const roots = rank(moveOptions(initial), 1, Infinity);
  const candidates = [
    ...roots.filter(move => move.kind === "buy"),
    ...["take", "reserve"].flatMap(kind => roots.filter(move => move.kind === kind).slice(0, 6))
  ];
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
        const latePenalty = (depth - 1) * (rivalThreat >= 15 ? 4 : hiddenThreat.length ? 1.65 : 0.75);
        const value = move.value - latePenalty - (move.exposure ?? 0);
        if (value > best) {
          best = value;
          followup = move.followup;
        }
      }
    }
    const freesCapacity = root.kind === "buy" ? (total(initial.tokens) - total(root.state.tokens)) : 0;
    const fullBankAdjustment = total(initial.tokens) >= 9
      ? Math.min(freesCapacity, 5) * 0.22 - (root.kind === "take" ? root.returned.length * 0.25 : 0)
      : 0;
    const earlyPurchase = root.kind === "buy"
      ? 0.45 + (root.earnsNoble ? 0.65 : 0) + (root.reserved ? 0.35 : 0) + (root.id === deferredBuy ? 0.9 : 0)
      : 0;
    return { ...root, followup, score: best + 0.26 * root.value + fullBankAdjustment + earlyPurchase };
  }
  const moves = candidates.map(bestContinuation)
    .filter(move => move.kind !== "reserve" || move.followup === move.id)
    .sort((a, b) => b.score - a.score);
  const top = moves[0];
  const buy = moves.find(move => move.kind === "buy") ?? null;
  const take = moves.find(move => move.kind === "take") ?? null;
  const reserve = moves.find(move => move.kind === "reserve" && move.score >= top.score - 1.5) ?? null;
  const reservedBuy = moves.find(move => move.kind === "buy" && move.reserved) ??
    roots.find(move => move.kind === "buy" && move.reserved) ?? null;
  const paths = top && top.state.score < 15 && !rivalStartsEnd ? routes(top.state) : [];
  const chosenPath = paths.findIndex(path => path.id === top?.followup);
  if (chosenPath > 0) paths.unshift(...paths.splice(chosenPath, 1));
  const nobleColors = colors.filter(color => earlyFocus[color] > 0)
    .sort((a, b) => earlyFocus[b] - earlyFocus[a]);
  const focusCutoff = earlyFocus[nobleColors[2]] ?? 0;
  return { primary: top?.kind ?? null, buy, take, reserve, reservedBuy,
    paths: paths.slice(0, 2), bank, blindDecks: [], forecastDepth: 0,
    race: { target, rivalThreat, orderKnown, hiddenThreat: hiddenThreat.map(rival => rival.id), nobleColors: nobleColors.filter(color => earlyFocus[color] + 1e-9 >= focusCutoff), finishing: Boolean(top && top.state.score >= 15),
      ownNextScore: top?.state.score ?? own.score } };
};
