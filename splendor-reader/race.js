globalThis.splendorRaceAdvice = (snapshot, preferredTarget = null, _deferredBuy, _previousNobles, preferredColors = []) => {
  const colors = ["C", "S", "E", "R", "O"];
  const { rules, tuning } = splendorActiveStrategy;
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

  const { moveOptions, legalDraws, applyTokens } = splendorClassic.transitions(rules);
  const leader = Math.max(...players.map(p => p.score ?? 0));
  const phase = leader < 5 ? "build" : leader < 10 ? "convert" : "finish";
  const { points, bonus, noble, token, stuck, denial } = tuning.phases[phase];
  const rivalStartsEnd = rivals.some(rival => rival.score >= finish);
  const endgame = leader >= 12 || own.score >= 10;
  const effective = (card, player, color) => Math.max(0, (card.cost[color] ?? 0) - player.discounts[color]);
  const distance = (tile, player) => colors.reduce((sum, color) => sum + effective(tile, player, color), 0);
  const progress = (tile, player) => tile.points *
    (1 - distance(tile, player) / Object.values(tile.cost).reduce((a, b) => a + b, 0)) ** 2;
  const withBonus = (player, color) => ({ ...player,
    discounts: { ...player.discounts, [color]: player.discounts[color] + 1 } });
  const knownRivals = rivals.filter(validStock);
  const payable = (card, player) => payment(card, player).G <= player.tokens.G;
  const nextStocks = new WeakMap();
  function inOneDraw(card, state) {
    if (payable(card, state)) return true;
    if (!nextStocks.has(state)) {
      nextStocks.set(state, legalDraws(state.bank).flatMap(draw => applyTokens(state, draw)));
    }
    return nextStocks.get(state).some(({ tokens }) => payable(card, { ...state, tokens }));
  }
  function estimate(card, state) {
    const gap = Math.max(0, payment(card, state).G - state.tokens.G);
    if (!gap) return 1;
    return inOneDraw(card, state) ? 2 : Math.max(3, Math.ceil(gap / 2.5) + 1);
  }
  function competition(tile, player, opponents) {
    const gap = distance(tile, player);
    return 1 / (1 + opponents.filter(other => distance(tile, other) <= gap).length);
  }
  function targets(state, opponents) {
    const tiles = state.nobles.map(tile => ({
      tile, gap: distance(tile, state), weight: competition(tile, state, opponents)
    })).filter(({ gap, weight }) => gap > 0 && (weight >= 0.34 || gap <= 3))
      .sort((a, b) => a.gap - b.gap || b.weight - a.weight).slice(0, 2);
    const market = state.cards.filter(card => !card.reserved);
    const economy = colors.map(color => {
      const nobleNeed = tiles.reduce((sum, { tile }) => sum +
        (effective(tile, state, color) > 0 ? 1 / Object.keys(tile.cost).length : 0), 0);
      const marketNeed = market.filter(card => effective(card, state, color) > 0).length / 12;
      return { color, nobleNeed, marketNeed, weight: 1 + 0.6 * nobleNeed + 0.4 * marketNeed };
    });
    const demand = new Set(economy.filter(({ nobleNeed, marketNeed }) => nobleNeed > 0 || marketNeed > 0)
      .map(({ color }) => color));
    const value = card => card.points + 0.8 * Number(demand.has(card.bonus)) +
      0.5 * state.nobles.reduce((sum, tile) =>
        sum + progress(tile, withBonus(state, card.bonus)) - progress(tile, state), 0);
    const cost = card => distance(card, state);
    const cards = state.cards.map(card => ({ card, value: value(card), cost: cost(card) }))
      .sort((a, b) => b.value / (b.cost + 1) - a.value / (a.cost + 1)).slice(0, 3);
    const need = Object.fromEntries(colors.map(color => [color,
      cards.reduce((sum, { card }) => sum + effective(card, state, color), 0)]));
    const caps = Object.fromEntries(colors.map(color => [color, Math.max(0,
      ...cards.map(({ card }) => card.cost[color] ?? 0), ...tiles.map(({ tile }) => tile.cost[color] ?? 0))]));
    return { tiles, economy, demand, cards, need, caps, cost, value };
  }
  const plan = targets(initial, knownRivals);
  const elapsed = Math.max(1, (snapshot.move ?? players.length) / players.length);
  const finishTime = player => {
    const index = orderKnown ? openedRound.indexOf(player.id) : -1;
    const turns = index >= 0 && snapshot.move > 0
      ? Math.max(1, Math.floor((snapshot.move + players.length - 2 - index) / players.length)) : elapsed;
    return Math.ceil((finish - player.score) / Math.max(player.score / turns * 1.3, 0.5));
  };
  const rivalTime = Math.min(...rivals.filter(p => integer(p.score)).map(finishTime));
  const ownTime = finishTime(own);
  const denialWeight = ownTime <= rivalTime ? 0 : denial * (rivalTime < ownTime - 1 ? 2 : 1);
  const rivalThreat = Math.max(0, ...rivals.map(rival => rivalCeiling(rival, initial).score));
  const threat = new Map();
  for (const rival of knownRivals) {
    const rivalState = { ...rival, bank, nobles, cards: [
      ...cards.filter(card => !card.reserved),
      ...publicReserves.filter(record => record.playerId === rival.id).map(record => ({ ...record.card, reserved: true }))
    ] };
    const goals = targets(rivalState, [own, ...knownRivals.filter(other => other.id !== rival.id)]);
    for (const card of cards.filter(card => !card.reserved)) {
      const next = withBonus(rival, card.bonus);
      const opensNoble = nobles.some(tile => !eligible(tile, rival.discounts) && eligible(tile, next.discounts));
      const value = (inOneDraw(card, rivalState) ? goals.value(card) * (rival.score >= 10 ? 1.5 : 1) : 0) +
        (opensNoble ? 3 : 0);
      threat.set(card.id, Math.max(value, threat.get(card.id) ?? 0));
    }
  }

  const permitted = (move, state, goals) => {
    if (move.kind === "take" && move.tokens[0] === move.tokens[1]) {
      return goals.need[move.tokens[0]] - state.tokens[move.tokens[0]] >= 2;
    }
    if (move.kind !== "buy" || phase !== "build") return true;
    const card = state.cards.find(item => item.id === move.id);
    return (card.level !== 3 || developmentCount(state) >= 6) &&
      (card.points !== 1 || goals.demand.has(card.bonus) || goals.cost(card) <= 1);
  };
  function handValue(state) {
    return colors.reduce((sum, color) => sum + Math.min(state.tokens[color], plan.need[color]), 0) +
      1.3 * state.tokens.G;
  }
  function stuckValue(state) {
    const liveTargets = state.cards.filter(card => plan.cards.some(entry => entry.card.id === card.id));
    const blocked = total(state.tokens) >= 9 && !liveTargets.some(card => payable(card, state));
    const stalled = state.reserveCount > 1 && !state.cards.some(card => card.reserved && inOneDraw(card, state));
    return 3 * Number(blocked) + (stalled ? 0.7 * (state.reserveCount - 1) : 0);
  }
  const initialStuck = stuckValue(initial);
  function scoreMove(move) {
    const card = cards.find(k => k.id === move.id);
    const next = move.state;
    const blocked = card && !card.reserved ? threat.get(card.id) ?? 0 : 0;
    const returned = move.returned?.length ?? 0;
    const crownPoints = next.score - own.score - (move.kind === "buy" ? card.points : 0);
    const nobleGain = next.nobles.reduce((sum, tile) => sum + competition(tile, initial, knownRivals) *
      (progress(tile, next) - progress(tile, initial)), 0);
    const pressure = stuck * (stuckValue(next) - initialStuck);
    const goldCost = tuning.goldSpent * (move.paid?.G ?? 0);
    let value = points * crownPoints + noble * nobleGain - tuning.overflow * returned - pressure - goldCost;
    if (move.kind === "buy") {
      const improves = initial.discounts[card.bonus] < plan.caps[card.bonus];
      const color = plan.economy.find(entry => entry.color === card.bonus);
      const alternative = plan.cards.find(entry => entry.card.id !== card.id && entry.card.points >= card.points);
      const tempo = alternative && estimate(alternative.card, initial) >= 3 ? 1 : 0;
      return value + points * card.points + (improves ? bonus * color.weight : 0) + denialWeight * blocked + tempo;
    }
    if (move.kind === "reserve") {
      const target = plan.cards.find(entry => entry.card.id === move.id);
      return value + 0.8 * 1.3 * Number(move.gold) +
        (target ? bonus * target.value * 0.6 : 0) + denialWeight * blocked - (reserveCount >= 2 ? 0.7 : 0);
    }
    const scarcity = move.tokens.reduce((sum, color) => sum +
      (bank[color] <= 2 && plan.need[color] > initial.tokens[color] ? 0.1 : 0), 0);
    const pairDenial = move.tokens.length === 2 && move.tokens[0] === move.tokens[1] &&
      next.bank[move.tokens[0]] <= 2 ? 0.3 * denialWeight : 0;
    return value + handValue(next) - handValue(initial) + scarcity + pairDenial;
  }

  const faceUp = moveOptions(initial).filter(move => move.kind !== "take" || move.tokens.length);
  const allowed = faceUp.filter(move => permitted(move, initial, plan));
  const blindAllowed = bank.G > 0 && reserveCount < rules.reservation_limit &&
    total(initial.tokens) <= 6 && Math.max(-Infinity, ...allowed.filter(m => m.kind === "reserve").map(scoreMove)) < 1;
  if (blindAllowed) {
    for (const [level, count] of Object.entries(initial.decks)) {
      if (!(count > 0)) continue;
      const id = "drawpile" + level;
      const { tokens, returned } = applyTokens(initial, ["G"])[0];
      const state = { ...initial, tokens, reserveCount: reserveCount + 1,
        decks: { ...initial.decks, [level]: count - 1 }, bank: { ...bank, G: bank.G - 1 } };
      allowed.unshift(...splendorClassic.claims({ kind: "reserve", id, blind: true, gold: true, returned, state }));
    }
  }
  const options = allowed;
  function roundThreat(state, triggeredByUs) {
    return rivals.map(rival => (!triggeredByUs || finishRivals.includes(rival))
      ? rivalCeiling(rival, state) : { score: rival.score, cards: validStock(rival) ? developmentCount(rival) : null });
  }
  function safeFinish(state) {
    if (state.score < finish) return false;
    const ours = { score: state.score, cards: developmentCount(state) };
    return splendorClassic.leaders([ours, ...roundThreat(state, true)]).includes(ours);
  }
  function stateValue(state) {
    const economyValue = plan.economy.reduce((sum, { color, weight }) =>
      sum + weight * Math.min(state.discounts[color], plan.caps[color]), 0);
    const progressValue = state.nobles.reduce((sum, tile) =>
      sum + competition(tile, state, knownRivals) * progress(tile, state), 0);
    return points * state.score + bonus * economyValue + noble * progressValue +
      token * handValue(state) - stuck * stuckValue(state);
  }
  function finishLine(root) {
    if (safeFinish(root.state)) return { turns: 1, cards: root.state.buying };
    let frontier = [root.state];
    for (let turns = 2; turns <= 3; turns++) {
      const moves = frontier.flatMap(state => {
        if (state.score >= finish || roundThreat(state, false).some(other => other.score >= finish)) return [];
        const goals = targets(state, knownRivals);
        return moveOptions(state).filter(move => permitted(move, state, goals));
      });
      const wins = moves.filter(move => safeFinish(move.state));
      if (wins.length) return { turns, cards: Math.min(...wins.map(move => move.state.buying)) };
      frontier = moves.map(({ state }) => ({ state, value: stateValue(state) }))
        .sort((a, b) => b.value - a.value).slice(0, 6).map(move => move.state);
    }
    return { turns: Infinity, cards: Infinity };
  }
  const rankKind = { buy: 3, reserve: 2, take: 1 };
  const preferredBuy = move => move.kind === "buy" &&
    preferredColors.includes(cards.find(card => card.id === move.id)?.bonus);
  const byScore = (a, b) => b.score - a.score || (a.returned?.length ?? 0) - (b.returned?.length ?? 0) ||
    rankKind[b.kind] - rankKind[a.kind] || Number(preferredBuy(b)) - Number(preferredBuy(a));
  const ranked = options.map(move => ({ ...move, score: scoreMove(move) })).sort(byScore);
  for (const move of ranked) {
    const threats = move.state.score >= finish ? roundThreat(move.state, true) : roundThreat(move.state, false);
    move.loses = threats.some(other => other.score >= finish &&
      (other.score > move.state.score || (other.score === move.state.score &&
        (!integer(other.cards) || other.cards < developmentCount(move.state)))));
    move.wins = safeFinish(move.state);
  }
  const shortlist = ranked.slice(0, 8);
  if (endgame && !rivalStartsEnd) {
    for (const move of shortlist) move.line = finishLine(move);
  }
  ranked.sort((a, b) => {
    if (rivalStartsEnd) return b.state.score - a.state.score ||
      developmentCount(a.state) - developmentCount(b.state) || byScore(a, b);
    return Number(b.wins) - Number(a.wins) || Number(a.loses) - Number(b.loses) ||
      (a.loses && b.loses ? b.state.score - a.state.score : 0) ||
      Number(b.kind === "buy" && b.earnsNoble) - Number(a.kind === "buy" && a.earnsNoble) ||
      ((a.line?.turns ?? Infinity) - (b.line?.turns ?? Infinity)) ||
      ((a.line?.cards ?? Infinity) - (b.line?.cards ?? Infinity)) || byScore(a, b);
  });
  const top = ranked[0];
  const buy = ranked.find(move => move.kind === "buy") ?? null;
  const take = ranked.find(move => move.kind === "take") ?? null;
  const reserve = ranked.find(move => move.kind === "reserve") ?? null;
  const reservedBuy = ranked.find(move => move.kind === "buy" && move.reserved) ?? null;
  const paths = plan.cards.map(({ card, value, cost }) => ({
    id: card.id, score: value / (cost + 1), turns: estimate(card, top?.state ?? initial)
  })).filter(path => path.id !== buy?.id || top?.kind !== "buy");
  const discountPriorities = plan.economy.filter(entry => entry.nobleNeed > 0)
    .map(entry => ({ color: entry.color, appearances: plan.tiles.filter(({ tile }) => tile.cost[entry.color]).length }))
    .sort((a, b) => b.appearances - a.appearances);
  const tile = plan.tiles[0]?.tile;
  const nobleTarget = tile ? { id: tile.id, needs: Object.fromEntries(colors
    .map(color => [color, effective(tile, initial, color)]).filter(([, count]) => count > 0)) } : null;
  const reason = top?.wins ? "برد با احتساب فرصت پاسخ حریف" :
    top?.earnsNoble ? "تکمیل شرط نوبل" : top ? "بالاترین اولویت بر اساس وزن‌های فاز و وضعیت میز" : null;
  return { reason, primary: top?.kind ?? null, buy, take, reserve, reservedBuy, paths: paths.slice(0, 2), bank,
    top3: ranked.slice(0, 3).map(({ state, ...move }) => move),
    race: { phase, preferredColors, colorEconomy: plan.economy, focusedNobles: plan.tiles.map(({ tile }) => tile.id),
      recommendedColors: [...plan.economy].sort((a, b) => b.weight - a.weight).slice(0, 3).map(entry => entry.color),
      discountPriorities, nobleTarget, target: Math.max(finish, rivalThreat), rivalThreat, orderKnown,
      removedTarget: publicReserves.find(record => record.card.id === preferredTarget)?.card.id ?? null,
      finishing: Boolean(top && top.state.score >= finish),
      projectedWinTurn: top?.wins ? 1 : Number.isFinite(top?.line?.turns) ? top.line.turns : null,
      immediatePoints: top ? top.state.score - own.score : 0, ownNextScore: top?.state.score ?? own.score } };
};
