globalThis.splendorAdvice = (snapshot) => {
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
  const gemCounter = counters.find(item => item.elementId === "spl_playerboard_gemcount");
  if (!localPlayerId || !/^\d+\/10$/.test(gemCounter?.text ?? "") || parseInt(gemCounter.text, 10) > 10 ||
      Object.values(holdings).some(value => !Number.isInteger(value)) ||
      Object.values(discounts).some(value => !Number.isInteger(value)) ||
      Object.values(holdings).reduce((sum, value) => sum + value, 0) !== parseInt(gemCounter.text, 10)) {
    return null;
  }

  const cards = [];
  for (const graphic of graphics) {
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

  const nobles = graphics.filter(item => /^noble_\d+$/.test(item.elementId ?? "") && item.parentId === "noblesbar")
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
  const ranked = cards.map(card => {
    const progress = nobles.filter(noble => noble.missingColors.includes(card.bonus))
      .sort((a, b) => a.distance - b.distance);
    const earnsNoble = progress.some(noble => noble.distance === 1);
    const nobleValue = progress.reduce((sum, noble, index) =>
      sum + (noble.distance > 1 ? (2.2 / noble.distance) / (1 + index * 0.55) : 0), 0);
    const unlocks = cards.filter(other => other.id !== card.id && other.due[card.bonus] > 0).length;
    const immediate = (card.points ?? 0) + (earnsNoble ? 3 : 0);
    const value = immediate * (late ? 2.1 : 1.25) +
      (late ? 0.45 : 1) * (nobleValue + Math.min(unlocks, 5) * 0.18) + 0.7;
    const shortfall = missing(card, holdings);
    const deficit = Math.max(0, shortfall - holdings.G);
    return { ...card, immediate, earnsNoble, shortfall, deficit, value,
      triggersEnd: ownScore + immediate >= Math.max(15, rivalScore) && immediate > 0,
      efficiency: value / (1 + deficit * 0.55 + card.payment * 0.075) };
  }).sort((a, b) => b.efficiency - a.efficiency || a.payment - b.payment);
  const purchases = ranked.filter(card => card.deficit === 0)
    .sort((a, b) => Number(b.triggersEnd) - Number(a.triggersEnd) ||
      (b.value - 0.13 * b.payment - 0.2 * b.shortfall) -
      (a.value - 0.13 * a.payment - 0.2 * a.shortfall));
  const buy = purchases[0] ?? null;
  const reservedBuy = purchases.find(card => card.reserved) ?? null;
  const bank = Object.fromEntries([...colors, "G"].map(color => {
    const value = counters.find(item => item.elementId === `coincounter_${color}`)?.text;
    return [color, /^\d+$/.test(value ?? "") ? Number(value) : null];
  }));
  const available = colors.filter(color => bank[color] > 0);
  const capacity = 10 - parseInt(gemCounter.text, 10);
  const takes = [];
  if (colors.every(color => bank[color] !== null)) {
    const count = Math.min(available.length, 3);
    for (let mask = 1; mask < 2 ** available.length; mask++) {
      const selected = available.filter((_, i) => mask & (1 << i));
      if (selected.length === count) takes.push(selected);
    }
    {
      for (const color of available) if (bank[color] >= 4) takes.push([color, color]);
    }
  }

  const targets = ranked.filter(card => card.deficit > 0).slice(0, 6);
  const tokenOptions = takes.map(tokens => evaluateTake(tokens));
  tokenOptions.sort((a, b) => b.score - a.score || b.tokens.length - a.tokens.length);

  function evaluateTake(tokens) {
    const resulting = { ...holdings };
    for (const color of tokens) resulting[color]++;
    const returnCount = Math.max(0, tokens.length - capacity);
    let best;
    const allColors = [...colors, "G"];
    function chooseReturns(start, returned) {
      if (returned.length === returnCount) {
        const paths = targets.map(card => {
          const remaining = Math.max(0, missing(card, resulting) - resulting.G);
          const gain = card.deficit - remaining;
          return { id: card.id, score: gain <= 0 ? 0 :
            card.value * (gain / card.deficit) / (1 + remaining * 0.6) };
        }).sort((a, b) => b.score - a.score);
        const score = (paths[0]?.score ?? 0) + (paths[1]?.score ?? 0) * 0.35;
        if (!best || score > best.score) best = { tokens, returned, score, target: paths[0]?.score ? paths[0].id : null };
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
  const canReserve = /^[0-2]\/3$/.test(reserveText);
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
      (synergy ? 0.2 : 0) - (sharedDemand ? 0.25 : 0) - (scarce ? 0.35 : 0) -
      (card.deficit === 0 ? 0.6 : 0);
    return { id: card.id, score, gold: goldAvailable };
  }).sort((a, b) => b.score - a.score);
  const reserveCard = reservations[0];
  const blindDecks = [1, 2, 3].filter(level =>
    /^[1-9]\d*$/.test(counters.find(item => item.elementId === `drawpile_counter_${level}`)?.text ?? ""));
  const reserveId = reserveCard?.id ?? (blindDecks.length ? `drawpile${blindDecks[0]}` : null);
  const reserve = canReserve && reserveId && bank.G !== null
    ? { id: reserveId, score: reserveCard?.score ?? 0, gold: goldAvailable, returned: goldAvailable ? evaluateTake(["G"]).returned : [] }
    : null;
  const take = tokenOptions[0] ?? null;
  const bestBuyScore = buy ? buy.value - buy.payment * 0.13 - buy.shortfall * 0.2 : -Infinity;
  const primary = buy?.triggersEnd || (buy && bestBuyScore >= Math.max(take?.score ?? 0, reserve?.score ?? 0))
    ? "buy" : take && (!reserve || take.score >= reserve.score) ? "take" : reserve ? "reserve" : buy ? "buy" : null;
  return { primary, buy, reservedBuy, take, reserve, blindDecks: canReserve && bank.G !== null ? blindDecks : [], bank };
};
