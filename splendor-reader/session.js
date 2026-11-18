globalThis.createSplendorArchive = (session) => {
  const timeline = [];
  const gameLog = [];
  const seenLog = new Set();
  const cards = new Map();
  let lastState;
  let revision = 0;
  let savedRevision = 0;
  let pending;
  let forceAfterPending = false;
  let lastAttempt = 0;
  let status = null;

  function observe(snapshot) {
    const counters = Object.fromEntries(snapshot.counters.filter(item =>
      /^(?:coincounter_[CSEROG]|drawpile_counter_[123]|spl_playerboard_gemcount|spl_playerreserve_count)$/.test(item.elementId ?? "")
    ).map(item => [item.elementId, item.text]));
    const market = [];
    const reserved = [];
    const nobles = [];
    const project = part => [part.parentId, part.elementId, part.backgroundPosition];
    for (const item of snapshot.graphics) {
      const id = item.elementId ?? "";
      if (/^noble_\d+$/.test(id)) nobles.push(id);
      if (!/^card_\d+$/.test(id) || (!item.reserved && !/^row_[123]$/.test(item.parentId ?? ""))) continue;
      if (item.reserved) reserved.push(id);
      else market.push(id);
      if (!cards.has(id)) {
        cards.set(id, {
          level: item.reserved ? null : Number(item.parentId.at(-1)),
          face: item.backgroundPosition,
          symbols: snapshot.graphics.filter(part => part.parentId === id ||
            part.parentId?.startsWith(id + "_")).map(project)
        });
      } else if (!item.reserved && cards.get(id).level === null) {
        cards.get(id).level = Number(item.parentId.at(-1));
      }
    }

    const state = {
      activePlayerId: snapshot.activePlayerId,
      counters, market: market.sort(), reserved: reserved.sort(), nobles: nobles.sort(),
      players: snapshot.players.map(player => ({
        id: player.id, name: player.name, score: player.score,
        pieces: (player.publicPieces ?? []).filter(piece =>
          piece.id || piece.sprite && piece.size !== "auto").map(piece =>
          [piece.id, piece.parentId, piece.label, piece.sprite])
      })),
      finished: /game (?:is )?over|game has ended|end of (?:the )?game/i.test(snapshot.turnText ?? "")
    };
    const changes = Object.fromEntries(Object.entries(state).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(lastState?.[key])));
    if (Object.keys(changes).length) {
      timeline.push({ at: snapshot.capturedAt, ...changes });
      lastState = state;
      revision++;
    }
    for (const event of snapshot.gameLog ?? []) {
      const key = JSON.stringify([event.id, event.text, event.icons]);
      if (seenLog.has(key)) continue;
      seenLog.add(key);
      gameLog.push(event);
      revision++;
    }
  }

  function flush(force = false) {
    if (pending) {
      forceAfterPending ||= force;
      return pending;
    }
    if (savedRevision === revision || (!force && Date.now() - lastAttempt < 10000)) return;
    lastAttempt = Date.now();
    const writingRevision = revision;
    const data = {
      schemaVersion: 2, session, timeline, gameLog, cards: Object.fromEntries(cards),
      result: { finished: lastState.finished, scores: lastState.players.map(({ id, name, score }) => ({ id, name, score })) }
    };
    pending = chrome.runtime.sendMessage({ type: "splendor-save", session, data })
      .then(response => {
        status = response?.saved ? "saved" : response?.reason ?? "error";
        if (response?.saved) savedRevision = writingRevision;
      })
      .catch(() => { status = "error"; })
      .finally(() => {
        pending = undefined;
        const flushAgain = forceAfterPending;
        forceAfterPending = false;
        if (flushAgain && status === "saved" && revision > savedRevision) return flush(true);
      });
    return pending;
  }

  return { observe, flush, status: () => status };
};
