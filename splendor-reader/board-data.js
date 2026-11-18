globalThis.readSplendorBoardData = (board, players, localPlayerId, isDisplayed) => {
  const doc = board.ownerDocument;
  const colors = ["C", "S", "E", "R", "O", "G"];
  const number = (element, absent = null) => {
    if (!element) return absent;
    const symbol = element.matches(".spl_number") ? element : element.querySelector(".spl_number");
    if (!symbol || !isDisplayed(symbol)) return absent;
    if (symbol.matches(".spl_depleted")) return 0;
    const match = /\bspl_number_(\d+)\b/.exec(symbol.className);
    return match ? Number(match[1]) : null;
  };
  const resources = (player, color) => {
    const id = `${player.id}_${color}`;
    const panel = doc.getElementById(`player_board_${player.id}`);
    const holder = panel?.querySelector(`[id="player_cards_${id}"]`);
    const own = player.id === localPlayerId;
    const tokens = own ? board.querySelector(`[id="player_gems_${id}"]`) :
      color === "G" ? panel?.querySelector(".spl_coinpile.type_G") :
      holder?.closest(".spl_ressources")?.querySelector(`.spl_coinpile.type_${color}`);
    const discount = own ? board.querySelector(`[id="player_cards_${id}"]`) : holder;
    return [number(tokens, own || holder || (color === "G" && panel) ? 0 : null),
      color === "G" ? 0 : number(discount, discount ? 0 : null)];
  };
  const observedPlayers = players.map(player => {
    const tokens = {}, discounts = {};
    for (const color of colors) [tokens[color], discounts[color]] = resources(player, color);
    return { ...player, tokens, discounts };
  });

  const readCosts = (element, selector) => {
    const cost = {};
    for (const part of element.querySelectorAll(selector)) {
      if (!isDisplayed(part)) continue;
      const color = /_([CSERO])$/.exec(part.id)?.[1];
      const count = number(part);
      if (!color || !Number.isInteger(count) || count > 7) return null;
      cost[color] = count;
    }
    return Object.keys(cost).length ? cost : null;
  };
  const cards = [];
  for (const element of board.querySelectorAll("#row_1 .spl_card, #row_2 .spl_card, #row_3 .spl_card, #player_reserve .spl_card, #spl_playerreserve .spl_card, #spl_playerreserve_cards .spl_card, #player_reserved_cards .spl_card, #player_reserved .spl_card")) {
    if (!/^card_\d+$/.test(element.id) || !isDisplayed(element)) continue;
    const row = element.closest("#row_1, #row_2, #row_3");
    const header = element.querySelector(".spl_cardheader_gem");
    const bonus = header && /\btype_([CSERO])\b/.exec(header.className)?.[1];
    const cost = readCosts(element, ".spl_cardcost");
    const points = number(element.querySelector(".spl_cardheader_vp"), 0);
    if (cost && bonus && Number.isInteger(points)) {
      cards.push({ id: element.id, level: row ? Number(row.id.at(-1)) : null, reserved: !row, bonus, cost, points });
    }
  }
  const nobles = Array.from(board.querySelectorAll("#noblesbar .spl_noble")).filter(isDisplayed).flatMap(element => {
    const cost = readCosts(element, ".spl_noblecost");
    const points = number(element.querySelector(".spl_noble_vp"));
    return cost && Number.isInteger(points) ? [{ id: element.id, cost, points }] : [];
  });

  const events = Array.from(doc.querySelectorAll("#logs .log[data-move-id]")).filter(isDisplayed).slice(0, 100)
    .flatMap(entry => {
      const actorName = entry.querySelector(".playername")?.innerText.trim();
      const text = entry.innerText.replace(/\s+/g, " ").trim();
      const actor = observedPlayers.find(player => player.name === actorName);
      const action = /^\s*(gets|gives|buys|reserves|claims|scores)\b/i.exec(text.slice(actorName?.length ?? 0))?.[1]?.toLowerCase();
      if (!actor || !action || !/^\d+$/.test(entry.dataset.moveId)) return [];
      const icons = Array.from(entry.querySelectorAll(".spl_log_coin, .spl_log_gem")).flatMap(icon => {
        const color = /\bicon_([CSEROG])\b/.exec(icon.className)?.[1];
        return color ? [{ kind: icon.matches(".spl_log_coin") ? "token" : "card", color }] : [];
      });
      return [{ id: entry.id, move: Number(entry.dataset.moveId), playerId: actor.id, action, icons,
        ...(action === "claims" ? { detail: text.slice(actorName.length).trim() } : {}),
        ...(action === "buys" ? { source: /from hand/i.test(text) ? "reserve" : "market" } : {}) }];
    });
  return { cards, nobles, players: observedPlayers, events };
};
