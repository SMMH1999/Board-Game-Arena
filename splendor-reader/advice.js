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
    const entries = (byParent.get(parent) ?? []).filter(item => spriteNumber(item) !== null);
    if (!entries.length) return absent;
    return entries.length === 1 ? spriteNumber(entries[0]) + offset : null;
  }

  const holdings = {};
  const discounts = {};
  for (const color of [...colors, "G"]) {
    holdings[color] = numberAt(`player_gems_${localPlayerId}_${color}`, 0, 1);
    if (color !== "G") discounts[color] = numberAt(`player_cards_${localPlayerId}_${color}`, null);
  }
  const gemCounter = counters.find(item => item.elementId === "spl_playerboard_gemcount");
  if (!localPlayerId || !/^\d+\/10$/.test(gemCounter?.text ?? "") ||
      Object.values(holdings).some(value => !Number.isInteger(value)) ||
      Object.values(discounts).some(value => !Number.isInteger(value)) ||
      Object.values(holdings).reduce((sum, value) => sum + value, 0) !== parseInt(gemCounter.text, 10)) {
    return null;
  }

  const candidates = [];
  for (const graphic of graphics) {
    if (!/^card_\d+$/.test(graphic.elementId ?? "") || !/^row_[123]$/.test(graphic.parentId ?? "")) continue;
    const prices = (byParent.get(graphic.elementId) ?? []).filter(item =>
      colors.some(color => item.elementId === `${graphic.elementId}_${color}`));
    if (!prices.length) continue;
    let shortfall = 0;
    let payment = 0;
    for (const price of prices) {
      const cost = numberAt(price.elementId, null, 1);
      const color = price.elementId.at(-1);
      if (!Number.isInteger(cost) || cost < 1 || cost > 7) {
        shortfall = Infinity;
        break;
      }
      const due = Math.max(0, cost - discounts[color]);
      payment += due;
      shortfall += Math.max(0, due - holdings[color]);
    }
    if (shortfall <= holdings.G) candidates.push({ id: graphic.elementId, shortfall, payment });
  }

  candidates.sort((a, b) => a.shortfall - b.shortfall || a.payment - b.payment);
  return candidates[0] ?? null;
};
