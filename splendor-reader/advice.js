globalThis.splendorAdvice = (snapshot, preferredTarget = null, deferredBuy = null) => {
  if (snapshot.gameState) {
    const advice = splendorRaceAdvice(snapshot, preferredTarget, deferredBuy);
    return { ...advice, strategyId: splendorActiveStrategy.id + "@" + splendorActiveStrategy.version, mode: splendorActiveStrategy.mode };
  }
  const { graphics, counters, localPlayerId } = snapshot;
  const colors = ["C", "S", "E", "R", "O"];
  const spriteNumber = (graphic) => {
    const match = /^(?:0(?:px|%)|-(\d+)%) -200%$/.exec(graphic?.backgroundPosition ?? "");
    return match ? Number(match[1] ?? 0) / 100 : null;
  };
  const byParent = new Map();
  for (const graphic of graphics) {
    if (!byParent.has(graphic.parentId)) byParent.set(graphic.parentId, []);
    byParent.get(graphic.parentId).push(graphic);
  }
  function numberAt(parent, absent, offset = 0) {
    const entries = (byParent.get(parent) ?? []).filter(item =>
      item.backgroundSize === "1000% 300%" && spriteNumber(item) !== null);
    if (!entries.length) return absent;
    return entries.length === 1 ? spriteNumber(entries[0]) + offset : null;
  }

  const holdings = {};
  const discounts = {};
  for (const color of [...colors, "G"]) {
    holdings[color] = numberAt(`player_gems_${localPlayerId}_${color}`, 0, 1);
    if (color !== "G") {
      const holder = `player_cards_${localPlayerId}_${color}`;
      discounts[color] = numberAt(holder, graphics.some(item => item.elementId === holder) ? 0 : null);
    }
  }
  const observed = snapshot.gameState;
  const own = observed?.players.find(player => player.id === localPlayerId);
  if (own) {
    Object.assign(holdings, own.tokens);
    Object.assign(discounts, own.discounts);
  }
  const gemCounter = counters.find(item => item.elementId === "spl_playerboard_gemcount");
  if (!localPlayerId || !/^\d+\/10$/.test(gemCounter?.text ?? "") || parseInt(gemCounter.text, 10) > 10 ||
      Object.values(holdings).some(value => !Number.isInteger(value)) ||
      Object.values(discounts).some(value => !Number.isInteger(value)) ||
      Object.values(holdings).reduce((sum, value) => sum + value, 0) !== parseInt(gemCounter.text, 10)) {
    return null;
  }

  const cards = observed ? observed.cards.map(card => {
    const due = Object.fromEntries(Object.entries(card.cost).map(([color, cost]) =>
      [color, Math.max(0, cost - discounts[color])]));
    return { ...card, due, payment: Object.values(due).reduce((sum, amount) => sum + amount, 0) };
  }) : [];
  for (const graphic of observed ? [] : graphics) {
    if (!/^card_\d+$/.test(graphic.elementId ?? "") || !(/^row_[123]$/.test(graphic.parentId ?? "") || graphic.reserved === true)) continue;
    const prices = (byParent.get(graphic.elementId) ?? []).filter(item =>
      colors.some(color => item.elementId === `${graphic.elementId}_${color}`));
    if (!prices.length) continue;
    const due = {};
    for (const price of prices) {
      const cost = numberAt(price.elementId, null, 1);
      if (Number.isInteger(cost) && cost >= 1 && cost <= 7) {
        const color = price.elementId.at(-1);
        due[color] = Math.max(0, cost - discounts[color]);
      }
    }
    if (Object.keys(due).length !== prices.length) continue;
    const parts = byParent.get(graphic.elementId) ?? [];
    const bonusGlyph = parts.find(part => part.backgroundSize === "500% 100%" && / 0(?:%|px)$/.test(part.backgroundPosition ?? ""));
    const bonusOffset = /^(?:0(?:px|%)|-(\d+)%) /.exec(bonusGlyph?.backgroundPosition ?? "");
    const bonus = bonusOffset ? ["O", "C", "S", "E", "R"][Number(bonusOffset[1] ?? 0) / 100] ?? null : null;
    const points = numberAt(graphic.elementId, bonus ? 0 : null, 1);
    cards.push({
      id: graphic.elementId, reserved: graphic.reserved === true, bonus, points,
      due, payment: Object.values(due).reduce((a, b) => a + b, 0)
    });
  }

  const nobles = observed ? observed.nobles.map(noble => ({
    points: noble.points,
    distance: Object.entries(noble.cost).reduce((sum, [color, cost]) => sum + Math.max(0, cost - discounts[color]), 0),
    missingColors: Object.keys(noble.cost).filter(color => discounts[color] < noble.cost[color])
  })) : graphics.filter(item => /^noble_\d+$/.test(item.elementId ?? "") && item.parentId === "noblesbar")
    .flatMap(item => {
      const requirements = (byParent.get(item.elementId) ?? []).flatMap(part => {
        const color = colors.find(key => part.elementId === `${item.elementId}_${key}`);
        return color ? [[color, numberAt(part.elementId, null, 1)]] : [];
      });
      const valid = (requirements.length === 2 && requirements.every(([, count]) => count === 4)) ||
        (requirements.length === 3 && requirements.every(([, count]) => count === 3));
      return valid ? [{ id: item.elementId, distance: requirements.reduce((sum, [color, count]) =>
        sum + Math.max(0, count - discounts[color]), 0),
        missingColors: requirements.filter(([color, count]) => discounts[color] < count).map(([color]) => color) }] : [];
    });

  const missing = (card, tokens) => colors.reduce((sum, color) =>
    sum + Math.max(0, (card.due[color] ?? 0) - tokens[color]), 0);
  const players = snapshot.players ?? [];
  const ownScore = players.find(player => player.id === localPlayerId)?.score ?? 0;
  const rivalScore = Math.max(0, ...players.filter(player => player.id !== localPlayerId).map(player => player.score ?? 0));
  const late = Math.max(ownScore, rivalScore) >= 12;
  const rivals = observed?.players.filter(player => player.id !== localPlayerId) ?? [];
  const recent = (snapshot.rivalEvents ?? observed?.events ?? []).slice(-36);
  const demand = Object.fromEntries(colors.map(color => [color, recent.filter(event =>
    event.playerId !== localPlayerId && event.action === "gets" &&
    event.icons.some(icon => icon.kind === "token" && icon.color === color)).length]));
  const ranked = cards.map(card => {
    const progress = nobles.filter(noble => noble.missingColors.includes(card.bonus))
      .sort((a, b) => a.distance - b.distance);
    const earnsNoble = progress.some(noble => noble.distance === 1);
    const nobleValue = progress.reduce((sum, noble, index) =>
      sum + (noble.distance > 1 ? (2.2 / noble.distance) / (1 + index * 0.55) : 0), 0);
    const unlocks = cards.filter(other => other.id !== card.id && other.due[card.bonus] > 0).length;
    const noblePoints = Math.max(0, ...progress.filter(noble => noble.distance === 1).map(noble => noble.points ?? 3));
    const immediate = (card.points ?? 0) + noblePoints;
    const value = immediate * (late ? 2.1 : 1.25) +
      (late ? 0.45 : 1) * (nobleValue + Math.min(unlocks, 5) * 0.18) + 0.7;
    const shortfall = missing(card, holdings);
    const deficit = Math.max(0, shortfall - holdings.G);
    const contested = card.reserved || !card.cost ? 0 : rivals.filter(rival => {
      const costs = Object.entries(card.cost);
      if (!Number.isInteger(rival.tokens.G) || !costs.every(([color]) =>
        Number.isInteger(rival.tokens[color]) && Number.isInteger(rival.discounts[color]))) return false;
      const missing = costs.reduce((sum, [color, cost]) =>
        sum + Math.max(0, cost - rival.discounts[color] - rival.tokens[color]), 0);
      return missing <= rival.tokens.G;
    }).length;
    return { ...card, immediate, earnsNoble, shortfall, deficit, value, contested,
      triggersEnd: ownScore + immediate >= Math.max(15, rivalScore) && immediate > 0,
      efficiency: value / (1 + deficit * 0.55 + card.payment * 0.075) };
  }).sort((a, b) => b.efficiency - a.efficiency || a.payment - b.payment);
  const purchases = ranked.filter(card => card.deficit === 0)
    .sort((a, b) => Number(b.triggersEnd) - Number(a.triggersEnd) ||
      (b.value - 0.13 * b.payment - 0.2 * b.shortfall) -
      (a.value - 0.13 * a.payment - 0.2 * a.shortfall));
  const reservedBuy = purchases.find(card => card.reserved) ?? null;
  const bank = Object.fromEntries([...colors, "G"].map(color => {
    const value = counters.find(item => item.elementId === `coincounter_${color}`)?.text;
    return [color, /^\d+$/.test(value ?? "") ? Number(value) : null];
  }));
  const inventory = parseInt(gemCounter.text, 10);
  const capacity = 10 - inventory;
  const tempo = { buy: 1.35, three: 0.65, two: -0.35, reserveGold: -0.55, reserve: -0.95, exchange: -1.25 };
  const allColors = [...colors, "G"];
  const forecast = (tokens, supply, targets = ranked, locked = null) => forecastSplendorRound({
    rivals, previousOrder: snapshot.rivalOrder ?? [], cards: targets, bank: supply, holdings: tokens,
    locked, events: recent, colors, legalDraws
  });
  const pathScore = projection => (projection.paths[0]?.score ?? 0) + (projection.paths[1]?.score ?? 0) * 0.3;
  const base = pathScore(forecast(holdings, bank));
  const supplyAfter = tokens => Object.fromEntries(allColors.map(color => [
    color, bank[color] === null ? null : bank[color] + holdings[color] - tokens[color]
  ]));

  function legalDraws(supply) {
    if (colors.some(color => supply[color] === null)) return [];
    const available = colors.filter(color => supply[color] > 0);
    const count = Math.min(available.length, 3);
    const draws = available.filter(color => supply[color] >= 4).map(color => [color, color]);
    for (let mask = 1; mask < 2 ** available.length; mask++) {
      const selected = available.filter((_, index) => mask & (1 << index));
      if (selected.length === count) draws.push(selected);
    }
    return draws;
  }
  const takes = legalDraws(bank);

  const targets = ranked.filter(card => card.deficit > 0).slice(0, 6);
  const tokenOptions = takes.map(evaluateTake).filter(option => option?.score > 0);
  for (const option of tokenOptions) {
    const projection = forecast(option.resulting, supplyAfter(option.resulting));
    const target = projection.paths.find(path => path.id === option.target);
    const diversity = colors.filter(color => option.resulting[color] > 0).length -
      colors.filter(color => holdings[color] > 0).length;
    const priority = option.returned.length ? tempo.exchange :
      option.tokens.length === 3 ? tempo.three : tempo.two;
    option.score += priority + diversity * 0.13 + (pathScore(projection) - base) * 0.55 -
      (target?.risk ?? 0) * 0.65 - Math.max(0, inventory + option.tokens.length - 7) * 0.12;
    option.plan = projection.paths.filter(path => path.score > 0);
  }
  tokenOptions.sort((a, b) => b.score - a.score || b.tokens.length - a.tokens.length);

  function evaluateTake(tokens) {
    const resulting = { ...holdings };
    for (const color of tokens) resulting[color]++;
    const returnCount = Math.max(0, tokens.length - capacity);
    let best;
    function chooseReturns(start, returned) {
      if (returned.length === returnCount) {
        if (allColors.every(color => resulting[color] === holdings[color])) return;
        const nextBank = Object.fromEntries(colors.map(color => [color, bank[color] === null ? null :
          bank[color] + holdings[color] - resulting[color]]));
        const nextDraws = legalDraws(nextBank);
        const paths = targets.map(card => {
          const remaining = Math.max(0, missing(card, resulting) - resulting.G);
          const gain = card.deficit - remaining;
          // Only credit a second draw when the bank and token limit permit the finishing colors.
          const finishable = remaining > 0 && nextDraws.some(draw => {
            const withDraw = { ...resulting };
            for (const color of draw) withDraw[color]++;
            const payment = Object.values(card.due).reduce((sum, due) => sum + due, 0);
            return payment <= 10 && missing(card, withDraw) <= resulting.G;
          });
          return { id: card.id, score: gain <= 0 ? 0 :
            card.value * (gain / card.deficit) /
              (1 + remaining * 0.6 + card.contested * 0.45) * (finishable ? 1.15 : 1) };
        }).sort((a, b) => b.score - a.score);
        const target = targets.find(card => card.id === paths[0]?.id);
        const exposed = colors.filter(color => demand[color] > 0 && target?.due[color] > resulting[color]);
        const risk = exposed.filter(color => bank[color] !== null && bank[color] <= 2);
        const score = (paths[0]?.score ?? 0) + (paths[1]?.score ?? 0) * 0.35 - risk.length * 0.12;
        if (!paths[0]?.score && !tokens.includes("G")) return;
        if (!best || score > best.score) best = {
          tokens, returned, score, risk, resulting: { ...resulting }, target: paths[0]?.score ? paths[0].id : null,
          targetContested: paths[0]?.score ? target?.contested ?? 0 : 0
        };
        return;
      }
      for (let index = start; index < allColors.length; index++) {
        const color = allColors[index];
        if (resulting[color] <= 0) continue;
        resulting[color]--;
        chooseReturns(index, [...returned, color]);
        resulting[color]++;
      }
    }
    chooseReturns(0, []);
    return best;
  }

  const reserveText = counters.find(item => item.elementId === "spl_playerreserve_count")?.text ?? "";
  const canReserve = /^[0-2]\/3$/.test(reserveText) && (!observed || observed.cards.filter(card => card.reserved).length < 3);
  const goldAvailable = bank.G > 0;
  const reservations = ranked.filter(card => !card.reserved).map(card => {
    const goldGain = goldAvailable && capacity > 0 && card.deficit > 0 ? 1 : 0;
    const colorsNeeded = Object.keys(card.due).filter(color => card.due[color] > holdings[color]);
    const occupied = reserveText[0] === "2" ? 0.6 : reserveText[0] === "1" ? 0.25 : 0;
    const waiting = Math.max(0, card.deficit - goldGain);
    const paired = ranked.filter(other => other.reserved);
    const sharedDemand = colorsNeeded.length === 1 && paired.some(other =>
      other.due[colorsNeeded[0]] > holdings[colorsNeeded[0]]);
    const synergy = paired.some(other => other.deficit === 0 && card.due[other.bonus] > 0);
    const scarce = waiting > 0 && colorsNeeded.some(color => bank[color] === 0);
    const score = card.value / (1.8 + waiting * 0.6 + card.payment * 0.09 + occupied) +
      (colorsNeeded.length === 1 && waiting <= 3 ? 0.25 : 0) +
      (synergy ? 0.2 : 0) + Math.min(card.contested, 2) * 0.18 - (sharedDemand ? 0.25 : 0) - (scarce ? 0.35 : 0) -
      (card.deficit === 0 ? 0.6 : 0);
    return { id: card.id, score, gold: goldAvailable, card };

  }).sort((a, b) => b.score - a.score);
  const gold = goldAvailable ? evaluateTake(["G"]) : null;
  const reserveTokens = gold?.resulting ?? holdings;
  const reserveReturns = gold?.returned ?? (goldAvailable && capacity === 0 ? ["G"] : []);
  const reserveChoices = canReserve ? reservations.slice(0, 6).map(option => {
    const projection = forecast(reserveTokens, supplyAfter(reserveTokens), ranked, option.id);
    const target = projection.paths.find(path => path.id === option.id);
    return {
      ...option, plan: projection.paths, returned: reserveReturns,
      score: option.score + (goldAvailable ? tempo.reserveGold : tempo.reserve) +
        (target?.score ?? 0) * 0.24 - reserveReturns.length * 0.55 -
        Math.max(0, inventory - 7) * 0.23
    };
  }).sort((a, b) => b.score - a.score) : [];
  const reserveCard = reserveChoices[0];
  const blindDecks = [1, 2, 3].filter(level =>
    /^[1-9]\d*$/.test(counters.find(item => item.elementId === `drawpile_counter_${level}`)?.text ?? ""));
  const reserveId = reserveCard?.id ?? (blindDecks.length ? `drawpile${blindDecks[0]}` : null);
  const reserve = canReserve && reserveId && bank.G !== null
    ? reserveCard ?? { id: reserveId, score: goldAvailable ? tempo.reserveGold : tempo.reserve,
      gold: goldAvailable, returned: reserveReturns, plan: [] }
    : null;

  const buys = purchases.slice(0, 6).map(card => {
    const remaining = { ...holdings };
    for (const color of colors) remaining[color] = Math.max(0, remaining[color] - (card.due[color] ?? 0));
    remaining.G -= card.shortfall;
    const nextCards = ranked.filter(other => other.id !== card.id).map(other => {
      if (!card.bonus || !other.due[card.bonus]) return other;
      return { ...other, due: { ...other.due, [card.bonus]: other.due[card.bonus] - 1 }, payment: other.payment - 1 };
    });
    const projection = forecast(remaining, supplyAfter(remaining), nextCards);
    return {
      ...card, plan: projection.paths,
      score: card.value - 0.12 * card.payment - 0.18 * card.shortfall + tempo.buy +
        Math.min(card.payment, inventory) * (inventory >= 8 ? 0.30 : 0.15) +
        (pathScore(projection) - base) * 0.20
    };
  }).sort((a, b) => Number(b.triggersEnd) - Number(a.triggersEnd) || b.score - a.score);
  const buy = buys[0] ?? null;
  const take = tokenOptions.find(option => option.score > 0) ??
    (!buy && !reserve ? tokenOptions[0] ?? null : null);
  const moves = [["buy", buy], ["take", take], ["reserve", reserve]].filter(([, move]) => move);
  moves.sort((a, b) => Number(Boolean(b[1].triggersEnd)) - Number(Boolean(a[1].triggersEnd)) ||
    b[1].score - a[1].score ||
    Number(b[1].plan[0]?.id === preferredTarget) - Number(a[1].plan[0]?.id === preferredTarget));
  const [primary, chosen] = moves[0] ?? [null, null];
  const paths = chosen?.plan.filter(path => path.score > 0) ?? [];
  if (paths[0]?.id !== preferredTarget && paths[1]?.id === preferredTarget && paths[1].score === paths[0].score) {
    [paths[0], paths[1]] = [paths[1], paths[0]];
  }
  return { strategyId: "legacy-sprite", primary, buy, reservedBuy, take, reserve, paths: paths.slice(0, 2),
    forecastDepth: rivals.length, blindDecks: canReserve && bank.G !== null ? blindDecks : [], bank };
};
