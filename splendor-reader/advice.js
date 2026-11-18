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
  if (!localPlayerId || !/^\d+\/10$/.test(gemCounter?.text ?? "") ||
      Object.values(holdings).some(value => !Number.isInteger(value)) ||
      Object.values(discounts).some(value => !Number.isInteger(value)) ||
      Object.values(holdings).reduce((sum, value) => sum + value, 0) !== parseInt(gemCounter.text, 10)) {
    return null;
  }

  const cards = [];
  for (const graphic of graphics) {
    if (!/^card_\d+$/.test(graphic.elementId ?? "") || !/^row_[123]$/.test(graphic.parentId ?? "")) continue;
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
    cards.push({ id: graphic.elementId, due, payment: Object.values(due).reduce((a, b) => a + b, 0) });
  }

  const missing = (card, tokens) => colors.reduce((sum, color) =>
    sum + Math.max(0, (card.due[color] ?? 0) - tokens[color]), 0);
  const ranked = cards.map(card => ({ ...card, shortfall: missing(card, holdings) }))
    .sort((a, b) => a.shortfall - b.shortfall || a.payment - b.payment);
  const buy = ranked.find(card => card.shortfall <= holdings.G) ?? null;
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
      if (selected.length === count && count <= capacity) takes.push(selected);
    }
    if (capacity >= 2) {
      for (const color of available) if (bank[color] >= 4) takes.push([color, color]);
    }
  }

  const targets = ranked.filter(card => card.shortfall > holdings.G).slice(0, 4);
  const tokenOptions = takes.map(tokens => {
    const resulting = { ...holdings };
    for (const color of tokens) resulting[color]++;
    const gains = targets.map(card => card.shortfall - missing(card, resulting));
    return {
      tokens,
      score: gains.reduce((score, gain, index) => score + gain * (4 - index), 0)
    };
  });
  tokenOptions.sort((a, b) => b.score - a.score || b.tokens.length - a.tokens.length);

  const reserveText = counters.find(item => item.elementId === "spl_playerreserve_count")?.text ?? "";
  const canReserve = /^[0-2]\/3$/.test(reserveText);
  const goldAvailable = bank.G > 0;
  const reserveCard = targets[0] ?? buy;
  const reserve = canReserve && reserveCard && bank.G !== null && (!goldAvailable || capacity > 0)
    ? { id: reserveCard.id, gold: goldAvailable }
    : null;
  return { buy, take: tokenOptions[0] ?? null, reserve };
};
