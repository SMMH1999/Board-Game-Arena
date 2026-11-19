globalThis.splendorRaceAdvice = (snapshot, preferredTarget = null, deferredBuy = null, previousNobles = [], preferredColors = []) => {
  const colors = ["C", "S", "E", "R", "O"];
  const { rules, tuning } = splendorActiveStrategy;
  const { cardPointPremium } = tuning;
  const finish = rules.finish.trigger_points;
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
  const handCounter = counts.spl_playerboard_gemcount;
  const supply = rules.setup_by_player_count[players.length]?.tokens_per_color;
  const verifiedSupply = handCounter == null && supply && players.every(validStock) && gems.every(color =>
    bank[color] + players.reduce((sum, player) => sum + player.tokens[color], 0) ===
      (color === "G" ? rules.gold_total : supply));
  if (gems.some(color => bank[color] === null) || !validStock(own) || !integer(own.score) || total(own.tokens) > 10 ||
      (!verifiedSupply && handCounter !== `${total(own.tokens)}/10`)) {
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
    decks: Object.fromEntries([1, 2, 3].map(level => [level, Number(counts[`drawpile_counter_${level}`] ?? 0)])),
    cards, nobles, bank, reserveCount, tokens: own.tokens, discounts: own.discounts,
    score: own.score, cardPoints: 0, buying: 0
  };
  const developmentCount = player => colors.reduce((sum, color) => sum + player.discounts[color], 0);
  const openedRound = snapshot.roundOrder;
  const orderKnown = Array.isArray(openedRound) && openedRound.length === players.length &&
    new Set(openedRound).size === players.length && players.every(player => openedRound.includes(player.id));
  const finishRivals = orderKnown
    ? rivals.filter(rival => splendorClassic.responders(openedRound, own.id).includes(rival.id))
    : rivals;

  const eligible = (noble, discounts) =>
    Object.entries(noble.cost).every(([color, count]) => discounts[color] >= count);

  const payment = splendorClassic.payment;

  const publicReserves = snapshot.publicRivalReserves ?? [];
  function rivalCeiling(rival, state) {
    let extra = validStock(rival) ? Math.max(0, ...state.nobles.filter(n => eligible(n, rival.discounts)).map(n => n.points)) : 0;
    let bought = false;
    if (validStock(rival)) {
      const known = publicReserves.filter(record => record.playerId === rival.id).map(record => record.card);
      for (const card of [...state.cards.filter(card => !card.reserved), ...known]) {
        if (payment(card, rival).G > rival.tokens.G) continue;
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

  const rivalStartsEnd = rivals.some(rival => rival.score >= finish);
  const rivalThreat = Math.max(0, ...rivals.map(rival => rivalCeiling(rival, initial).score));
  const target = Math.max(finish, rivalThreat);
  const pressure = rivalThreat >= finish ? 1 : 0.65;

  const { moveOptions, legalDraws, applyTokens } = splendorClassic.transitions(rules);
  function challengers(card) {
    if (card.reserved) return [];
    return rivals.filter(rival => validStock(rival) && (payment(card, rival).G <= rival.tokens.G ||
      (Number.isInteger(rival.reservedCount) && rival.reservedCount < rules.reservation_limit)));
  }
  const contest = new Map(cards.map(card => [card.id, challengers(card)]));
  const contested = new Set(cards.filter(card => contest.get(card.id).length).map(card => card.id));
  const nobleDistance = (noble, discounts) => Object.entries(noble.cost).reduce((sum, [color, count]) =>
    sum + Math.max(0, count - discounts[color]), 0);
  const isThreeColorNoble = noble => {
    const costs = Object.values(noble.cost);
    return costs.length === 3 && costs.every(count => count === 3);
  };
  const nobleCategory = noble => isThreeColorNoble(noble) ? 1.38 : 1;

  const demand = new Map(cards.map(card => [card.id, rivals.reduce((sum, rival) => {
    if (!validStock(rival) || card.reserved) return sum;
    const predicted = snapshot.rivalForecasts?.some(move => move.playerId === rival.id && move.cardId === card.id && move.source === "market");
    const gap = Math.max(0, payment(card, rival).G - rival.tokens.G);
    return sum + (predicted ? 0.5 : 0) + (gap === 0 ? 1 : rival.reservedCount !== 3 ? 1 / (1 + gap) : 0);
  }, 0)]));
  function protection(move) {
    if (move.kind !== "reserve") return 0;
    const card = cards.find(c => c.id === move.id);
    if (card?.level !== 3 || !card.points) return 0;
    const paid = payment(card, move.state);
    const gap = Math.max(0, paid.G - move.state.tokens.G);
    const cost = Object.values(paid).reduce((a,b) => a+b, 0);
    const shortage = colors.reduce((sum, c) => sum + Math.max(0,
      (card.cost[c] ?? 0) - move.state.discounts[c] - move.state.tokens[c] - move.state.bank[c]), 0);
    if (cost > 10 || shortage > move.state.tokens.G) return 0;
    return card.points * (card.points === 5 ? 1.4 : 1) * (0.3 + demand.get(card.id)) /
      (1 + gap * 0.55 + cost * 0.1 + initial.reserveCount);
  }

  function noblePriorities(state) {
    const priorities = Object.fromEntries(colors.map(color =>
      [color, { color, appearances: 0, neededFor: 0, threeColorNeededFor: 0, closeness: 0 }]));
    for (const noble of focused(state)) {
      const rivalCanClaim = rivals.some(rival => validStock(rival) && nobleDistance(noble, rival.discounts) <= 1);
      const value = (rivalCanClaim ? 0.65 : 1) * nobleCategory(noble) * noble.points / (2 + nobleDistance(noble, state.discounts));
      for (const [color, count] of Object.entries(noble.cost)) {
        if (!priorities[color] || count <= 0) continue;
        const priority = priorities[color];
        priority.appearances++;
        if (state.discounts[color] < count) {
          priority.neededFor++;
          if (isThreeColorNoble(noble)) priority.threeColorNeededFor++;
          priority.closeness += value;
        }
      }
    }
    return Object.values(priorities).filter(priority => priority.appearances > 0)
      .sort((a, b) => b.appearances - a.appearances || b.neededFor - a.neededFor || b.closeness - a.closeness);
  }

  // Rank permanent bonuses for this turn. Each card counts once per unpaid color.
  const colorEconomy = colors.map(color => {

    let marketNeed = 0;
    for (const card of cards) {
      if (!(card.cost[color] > own.discounts[color])) continue;
      const gap = Math.max(0, payment(card, own).G - own.tokens.G);
      const exposure = card.reserved ? 0 : demand.get(card.id);
      marketNeed += (1 + card.points / 5) * (card.reserved ? 2 : 1) /
        ((1 + gap / 3) * (1 + exposure / 2));
    }
    return { color, nobleNeed: 0, marketNeed, weight: 0 };
  });
  const alignment = noble => colorEconomy.reduce((sum, entry) =>
    sum + (noble.cost[entry.color] > own.discounts[entry.color] ? entry.marketNeed : 0), 0);
  const focusOrder = [...nobles].sort((a, b) =>
    Number(previousNobles.includes(b.id)) - Number(previousNobles.includes(a.id)) ||
    Number(isThreeColorNoble(b)) - Number(isThreeColorNoble(a)) ||
    nobleDistance(a, own.discounts) - nobleDistance(b, own.discounts) || alignment(b) - alignment(a));
  const targetCount = players.length === 4 ? 3 : 2;
  const focused = state => focusOrder.filter(n => state.nobles.includes(n)).slice(0, targetCount);
  for (const entry of colorEconomy) {
    entry.nobleNeed = focused(initial).filter(n => n.cost[entry.color] > own.discounts[entry.color]).length;
  }
  for (const [metric, share] of [["nobleNeed", tuning.nobleColorWeight], ["marketNeed", tuning.marketColorWeight]]) {
    const ranked = colorEconomy.filter(entry => entry[metric] > 0)
      .sort((a, b) => b[metric] - a[metric] ||
        b.marketNeed - a.marketNeed || b.nobleNeed - a.nobleNeed).slice(0, 3);
    for (const entry of ranked) entry.weight += share * entry[metric] / ranked[0][metric];
  }
  const recommendedColors = colorEconomy.filter(entry => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight).slice(0, 3).map(entry => entry.color);
  for (const entry of colorEconomy) {
    if (preferredColors.includes(entry.color)) entry.weight += 0.5;
  }
  const colorWeight = Object.fromEntries(colorEconomy.map(entry => [entry.color, entry.weight]));
  const initialDistances = new Map(initial.nobles.map(noble => [noble, nobleDistance(noble, initial.discounts)]));
  const nobleProgress = state => focused(state).reduce((sum, noble) => {
    const remaining = nobleDistance(noble, state.discounts);
    const steps = initialDistances.get(noble) - remaining;
    // A useful discount advances every still-available noble that needs it.
    return sum + steps * (0.12 + nobleCategory(noble) * noble.points / (2 + remaining));
  }, 0);

  // Every token/return variant of a position shares the same market and permanent bonuses.
  const marketFeatures = new WeakMap();
  function features(state) {
    let byDiscounts = marketFeatures.get(state.cards);
    if (!byDiscounts) {
      byDiscounts = new WeakMap();
      marketFeatures.set(state.cards, byDiscounts);
    }
    let byNobles = byDiscounts.get(state.discounts);
    if (!byNobles) {
      byNobles = new WeakMap();
      byDiscounts.set(state.discounts, byNobles);
    }
    if (byNobles.has(state.nobles)) return byNobles.get(state.nobles);
    const priorities = Object.fromEntries(noblePriorities(state).map(priority => [priority.color, priority]));
    const values = state.cards.map(card => {
      const nextDiscounts = { ...state.discounts, [card.bonus]: state.discounts[card.bonus] + 1 };
      const points = card.points + Math.max(0, ...state.nobles.filter(noble =>
        eligible(noble, nextDiscounts)).map(noble => noble.points));
      const unlocks = state.cards.filter(other => other.id !== card.id &&
        (other.cost[card.bonus] ?? 0) > state.discounts[card.bonus]);
      const progress = unlocks.reduce((sum, other) => sum + (other.points ? 1 : 0.35), 0);
      const priority = priorities[card.bonus];
      const nobleValue = colorWeight[card.bonus] * 0.45 + (priority?.neededFor
        ? priority.neededFor * 0.22 + priority.appearances * 0.05 + priority.closeness * 0.95
        : 0);
      const net = colors.map(color => Math.max(0, (card.cost[color] ?? 0) - state.discounts[color]));
      return { card, points, progress, nobleValue, net, netTotal: net.reduce((sum, v) => sum + v, 0) };
    });
    byNobles.set(state.nobles, values);
    return values;
  }

  function routes(state) {
    return features(state).map(({ card, points, progress, nobleValue, net, netTotal }) => {
      let missing = 0, shortage = 0, distinct = 0, pair = 0, colorBound = 0;
      for (const [index, color] of colors.entries()) {
        const gap = Math.max(0, net[index] - state.tokens[color]);
        missing += gap;
        shortage += Math.max(0, gap - state.bank[color]);
        if (gap && state.bank[color] > 0) distinct++;
        if (state.bank[color] >= 4) pair = Math.max(pair, Math.min(2, gap));
        colorBound = Math.max(colorBound, Math.ceil((gap - state.tokens.G) / (state.bank[color] >= 4 ? 2 : 1)));
      }
      const deficit = Math.max(0, missing - state.tokens.G);
      const oneDraw = netTotal <= rules.hand_token_limit_at_end && deficit <= Math.max(Math.min(3, distinct), pair);
      const turns = deficit === 0 ? 1 : oneDraw ? 2 : 1 + Math.max(2, Math.ceil(deficit / 3), colorBound);
      const exposed = !card.reserved && contested.has(card.id);
      const risk = exposed ? demand.get(card.id) / rivals.length : 0;
      const score = (points * pressure + card.points * cardPointPremium +
        Math.min(progress, 4) * (1.2 - pressure) + nobleValue + 0.35) /
        (turns + 0.5 * deficit + Math.max(0, shortage - state.tokens.G) * 0.8 + risk * 0.7);
      return { id: card.id, score, risk, turns, estimated: turns > 2 };
    }).sort((a, b) => b.score - a.score || Number(b.id === preferredTarget) - Number(a.id === preferredTarget));
  }

  function finishAtRisk(state) {
    // A projected final score can be challenged by the rivals with turns still to play.
    const ourCount = developmentCount(state);
    const threats = rivals.map(rival => finishRivals.includes(rival) ? rivalCeiling(rival, state) : {
      score: rival.score ?? 0,
      cards: validStock(rival) ? developmentCount(rival) : null
    });
    const projected = { score: state.score, cards: ourCount };
    return !splendorClassic.leaders([projected, ...threats]).includes(projected);
  }

  function endValue(state, depth) {
    return (finishAtRisk(state) ? 8 : 36) - depth * 3 + (state.score - target) * 0.8;
  }

  function evaluate(move, depth) {
    const state = move.state;
    const end = state.score >= finish || rivalStartsEnd;
    if (end) return endValue(state, depth);
    const paths = routes(state);
    const life = Math.max(0, 4 - depth);
    const score = (state.score - own.score) * (1.1 + pressure) +
      state.cardPoints * cardPointPremium + state.buying * life * 0.15;
    const options = (paths[0]?.score ?? 0) + (paths[1]?.score ?? 0) * tuning.fallbackWeight;
    const slack = colors.filter(color => state.tokens[color] > 0).length * 0.07 -
      Math.max(0, total(state.tokens) - 8) * 0.12;
    const delay = move.kind === "take" ? move.returned.length * 0.09 : 0;
    const economyGain = colorEconomy.reduce((sum, entry) => sum + entry.weight *
      Math.min(1, state.discounts[entry.color] - own.discounts[entry.color]), 0);
    return economyGain * life / 3 + protection(move) + score + options + slack - delay + nobleProgress(state) * (rivalThreat >= finish ? 0.45 : 1);
  }

  // A shallow, bounded beam evaluates real payments, gold, reserve slots and returns.
  const rank = (moves, depth, limit) => moves.map(move => ({ ...move, value: evaluate(move, depth) }))
    .sort((a, b) => b.value - a.value).slice(0, limit);
  const roots = rank(moveOptions(initial), 1, Infinity);
  const candidates = [
    ...roots.filter(move => move.kind === "buy"),
    ...["take", "reserve"].flatMap(kind => roots.filter(move => move.kind === kind).slice(0, 6))
  ];
  function bestContinuation(root, blockedId = null) {
    const starting = blockedId ? { ...root, state: {
      ...root.state, cards: root.state.cards.filter(card => card.id !== blockedId)
    } } : root;
    let frontier = [starting];
    let best = blockedId ? evaluate(starting, 1) : root.value;
    let winTurn = root.state.score >= finish && !finishAtRisk(root.state) ? 1 : Infinity;
    let followup;
    for (let depth = 2; depth <= 3 && frontier.length; depth++) {
      frontier = rank(frontier.flatMap(move => {
        if (move.state.score >= finish || rivalStartsEnd) return [];
        if (rivalThreat >= finish && (depth > 2 ||
            finishRivals.some(rival => rivalCeiling(rival, move.state).score >= finish))) return [];
        // Charge the continuation for relying on a market card that rivals can buy now.
        return moveOptions(move.state).map(next => ({
          ...next, followup: move.followup ?? (next.kind === "buy" ? next.id : null),
          exposure: (move.exposure ?? 0) +
            Number(next.kind === "buy" && !next.reserved && contested.has(next.id)) * 1.15
        }));
      }), depth, 4);
      for (const move of frontier) {
        const finishTurn = move.state.score >= finish && !finishAtRisk(move.state) ? depth : Infinity;
        const latePenalty = (depth - 1) * (rivalThreat >= finish ? 4 : 0.75);
        const value = move.value - latePenalty - (move.exposure ?? 0);
        if (finishTurn < winTurn || (finishTurn === winTurn && value > best)) {
          winTurn = finishTurn;
          best = value;
          followup = move.followup;
        }
      }
    }
    // In a duel, closing an immediately useful pair affects the sole responder.
    const pairDenial = rivals.length === 1 && root.kind === "take" && validStock(rivals[0]) &&
      colors.some(color => initial.bank[color] >= 4 && root.state.bank[color] < 4 &&
        cards.some(card => !card.reserved && card.points > 0 &&
          (card.cost[color] ?? 0) - rivals[0].discounts[color] - rivals[0].tokens[color] >= 2));
    const freesCapacity = root.kind === "buy" ? (total(initial.tokens) - total(root.state.tokens)) : 0;
    const fullBankAdjustment = total(initial.tokens) >= 9
      ? Math.min(freesCapacity, 5) * 0.22 - (root.kind === "take" ? root.returned.length * 0.25 : 0)
      : 0;
    const reservationCost = root.kind === "reserve" ? (0.45 + initial.reserveCount * 0.25 +
      (followup ? 0 : 1)) : 0;
    const earlyPurchase = root.kind === "buy"
      ? 0.45 + (root.earnsNoble ? 0.65 : 0) + (root.reserved ? 0.35 : 0) + (root.id === deferredBuy ? 0.9 : 0)
      : 0;
    return { ...root, followup, winTurn, score: best + 0.26 * root.value + (root.state.score - own.score) * 0.8 + fullBankAdjustment + earlyPurchase - reservationCost + protection(root) + (pairDenial ? 0.12 : 0) };
  }
  function roundPriority(state) {
    const visibleEnd = rivalStartsEnd || state.score >= finish ||
      (orderKnown && finishRivals.some(rival => rivalCeiling(rival, state).score >= finish));
    if (!visibleEnd) return 1;
    return finishAtRisk(state) ? 0 : 2;
  }

  const removalScenarios = new Map();
  const moves = candidates.map(root => {
    const line = bestContinuation(root);
    const risk = line.followup && contested.has(line.followup) &&
      root.state.cards.some(card => card.id === line.followup && !card.reserved);
    if (!risk) return line;
    removalScenarios.set(line.followup, contest.get(line.followup).map(r => r.id));
    const alternative = bestContinuation(root, line.followup);
    return { ...line, winTurn: Math.max(line.winTurn, alternative.winTurn), fallback: alternative.followup,
      score: line.score - Math.max(0, line.score - alternative.score) * Math.min(0.9, tuning.removalWeight + contest.get(line.followup).length * 0.08) };
  })
    .map(move => ({ ...move, roundPriority: roundPriority(move.state),
      immediatePoints: move.state.score - own.score }))
    // Prefer a surviving finish, then compare realized points and continuation quality.
    .sort((a, b) => b.roundPriority - a.roundPriority || a.winTurn - b.winTurn || b.score - a.score || b.immediatePoints - a.immediatePoints);
  const coverageOrder = noblePriorities(initial);
  const strategicOrder = coverageOrder.filter(priority => priority.neededFor > 0)
    .sort((a, b) => b.threeColorNeededFor - a.threeColorNeededFor || b.neededFor - a.neededFor ||
      b.closeness - a.closeness || colors.indexOf(a.color) - colors.indexOf(b.color));
  const discountGroups = [];
  let previousGroupWeight;
  for (const priority of strategicOrder) {
    if (previousGroupWeight !== priority.threeColorNeededFor) {
      discountGroups.push([]);
      previousGroupWeight = priority.threeColorNeededFor;
    }
    discountGroups.at(-1).push(priority.color);
  }
  const discountRank = new Map(strategicOrder.map((priority, index) => [priority.color, index]));

  // Preserve economic ranking and resolve close opening draws using reachable discount cards.
  const opening = !rivalStartsEnd && rivalThreat < finish && developmentCount(own) < 2 && own.score <= 1;
  function openingOptions(state) {
    const nextStocks = legalDraws(state.bank).flatMap(take => applyTokens(state, take));
    return state.cards.filter(card => discountRank.has(card.bonus)).flatMap(card => {
      const payable = tokens => payment(card, { discounts: state.discounts, tokens }).G <= tokens.G;
      const turns = payable(state.tokens) ? 1 : nextStocks.some(({ tokens }) => payable(tokens)) ? 2 : null;
      return turns ? [{ id: card.id, rank: discountRank.get(card.bonus), turns }] : [];
    }).sort((a, b) => a.turns - b.turns || a.rank - b.rank);
  }
  let top = moves[0];
  if (opening && top?.kind === "take" && strategicOrder.length) {
    const openingTolerance = 0.08;
    const tied = moves.filter(move => move.kind === "take" && move.roundPriority === top.roundPriority &&
      move.winTurn === top.winTurn && top.score - move.score <= openingTolerance)
      .map(move => ({ move, target: openingOptions(move.state)[0] }));
    tied.sort((a, b) => (a.target?.turns ?? 3) - (b.target?.turns ?? 3) ||
      (a.target?.rank ?? colors.length) - (b.target?.rank ?? colors.length) ||
      b.move.score - a.move.score);
    top = tied[0].move;
  }
  const buy = moves.find(move => move.kind === "buy") ?? null;
  const take = top?.kind === "take" ? top : moves.find(move => move.kind === "take") ?? null;
  const reserve = moves.find(move => move.kind === "reserve" && move.score >= top.score - 1.5) ?? null;
  const reservedBuy = moves.find(move => move.kind === "buy" && move.reserved) ??
    roots.find(move => move.kind === "buy" && move.reserved) ?? null;
  const paths = top && top.state.score < finish && !rivalStartsEnd ? routes(top.state) : [];
  const openingPath = opening && top?.kind === "take" && !top.followup ? openingOptions(top.state)[0] : null;
  const chosenPath = paths.findIndex(path => path.id === (top?.followup ?? openingPath?.id));
  if (chosenPath > 0) paths.unshift(...paths.splice(chosenPath, 1));
  if (openingPath && paths[0]?.id === openingPath.id) paths[0].turns = openingPath.turns;
  const fallbackIndex = paths.findIndex(path => path.id === top?.fallback);
  if (fallbackIndex > 1) paths.splice(1, 0, ...paths.splice(fallbackIndex, 1));
  const discountPriorities = coverageOrder.map(({ color, appearances, neededFor, threeColorNeededFor }) =>
    ({ color, appearances, neededFor, threeColorNeededFor }));

  const routeColor = cards.find(card => card.id === (top?.kind === "buy" ? top.id : paths[0]?.id))?.bonus;
  const nobleTarget = focused(initial).map(noble => {
    const needs = Object.fromEntries(Object.entries(noble.cost).flatMap(([color, count]) => {
      const missing = count - own.discounts[color];
      return missing > 0 ? [[color, missing]] : [];
    }));
    const needColors = Object.keys(needs);
    const distance = Object.values(needs).reduce((sum, count) => sum + count, 0);
    const missingColors = needColors.filter(color => !cards.some(card => card.bonus === color)).length;
    const overlap = coverageOrder.reduce((sum, priority) => needs[priority.color] ?
      sum + priority.threeColorNeededFor + priority.neededFor * 0.25 : sum, 0);
    const relevance = needs[routeColor] ? 1.08 : 1;
    const priority = nobleCategory(noble) * noble.points * relevance * (1 + overlap * 0.03) /
      (2 + distance + missingColors);
    return { id: noble.id, needs, distance, missingColors, priority };
  }).filter(noble => noble.distance > 0).sort((a, b) =>
    Number(b.distance === 1) - Number(a.distance === 1) || b.priority - a.priority || a.distance - b.distance)[0] ?? null;
  return { primary: top?.kind ?? null, buy, take, reserve, reservedBuy,
    paths: paths.slice(0, 2), bank, forecastDepth: rivals.length,
    race: { colorEconomy, recommendedColors, preferredColors, focusedNobles: focused(initial).map(n => n.id), removalScenarios: Array.from(removalScenarios, ([target, rivals]) => ({ target, rivals })), target, rivalThreat, orderKnown, nobleTarget, discountPriorities, discountGroups,
      removedTarget: publicReserves.find(record => record.card.id === preferredTarget)?.card.id ?? null,
      finishing: Boolean(top && top.state.score >= finish),
      projectedWinTurn: Number.isFinite(top?.winTurn) ? top.winTurn : null, responders: finishRivals.map(r => r.id),
      immediatePoints: top?.immediatePoints ?? 0, ownNextScore: top?.state.score ?? own.score } };
};
