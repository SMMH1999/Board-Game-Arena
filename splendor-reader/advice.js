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
      Object.values(discounts).some(value => !Number.isInteger(value)) || parseInt(gemCounter.text, 10) > 10 ||
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
    cards.push({ id: graphic.elementId, reserved: graphic.reserved === true, due, payment: Object.values(due).reduce((a, b) => a + b, 0) });
  }

  const missing = (card, tokens) => colors.reduce((sum, color) =>
    sum + Math.max(0, (card.due[color] ?? 0) - tokens[color]), 0);
  const ranked = cards.map(card => ({ ...card, shortfall: missing(card, holdings) }))
    .sort((a, b) => a.shortfall - b.shortfall || a.payment - b.payment);
  const purchases = ranked.filter(card => card.shortfall <= holdings.G);
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

  const targets = ranked.filter(card => card.shortfall > holdings.G).slice(0, 4);
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
        const score = targets.reduce((total, card, index) => total +
          (card.shortfall - missing(card, resulting) + resulting.G - holdings.G) * (4 - index), 0);
        if (!best || score > best.score) best = { tokens, returned, score };
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
  const reserveCard = [...targets, ...ranked].find(card => !card.reserved);
  const blindDecks = [1, 2, 3].filter(level =>
    /^[1-9]\d*$/.test(counters.find(item => item.elementId === `drawpile_counter_${level}`)?.text ?? ""));
  const reserveId = reserveCard?.id ?? (blindDecks.length ? `drawpile${blindDecks[0]}` : null);
  const reserve = canReserve && reserveId && bank.G !== null
    ? { id: reserveId, gold: goldAvailable, returned: goldAvailable ? evaluateTake(["G"]).returned : [] }
    : null;
  return { buy, reservedBuy, take: tokenOptions[0] ?? null, reserve, blindDecks: canReserve && bank.G !== null ? blindDecks : [], bank };
};
