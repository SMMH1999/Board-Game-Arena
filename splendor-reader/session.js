globalThis.createSplendorArchive = (session) => {
  const timeline = [];
  const actions = new Map();
  const cards = new Map();
  const decisions = new Map();
  let localPlayerId;
  let lastState;
  let lastFingerprint;
  let revision = 0;
  let savedRevision = 0;
  let pending;
  let forceAfterPending = false;
  let lastAttempt = 0;
  let status = null;

  function observe(snapshot) {
    localPlayerId ??= snapshot.localPlayerId;
    const game = snapshot.gameState;
    if (!game) return;
    for (const event of game.events) {
      if (!event.id || actions.has(event.id)) continue;
      actions.set(event.id, event);
      revision++;
    }

    const finished = /game (?:is )?over|game has ended|end of (?:the )?game/i.test(snapshot.turnText ?? "");
    if (!finished && !/must play|your turn/i.test(snapshot.turnText ?? "")) return;

    for (const { id, level, bonus, points, cost } of game.cards) {
      if (!cards.has(id) || (level && !cards.get(id).level)) {
        cards.set(id, { level, bonus, points, cost });
        revision++;
      }
    }
    const counters = Object.fromEntries(snapshot.counters.filter(item =>
      /^(?:coincounter_[CSEROG]|drawpile_counter_[123]|spl_playerreserve_count|spl_playerboard_gemcount)$/.test(item.elementId ?? "")
    ).map(item => [item.elementId, item.text]));
    const state = {
      move: snapshot.move, activePlayerId: snapshot.activePlayerId, finished,
      roundOrder: snapshot.roundOrder ?? null,
      publicRivalReserves: (snapshot.publicRivalReserves ?? []).map(record =>
        ({ playerId: record.playerId, cardId: record.card.id, move: record.move })),
      counters,
      market: game.cards.filter(card => !card.reserved).map(card => card.id).sort(),
      reserved: game.cards.filter(card => card.reserved).map(card => card.id).sort(),
      nobles: game.nobles, players: game.players
    };
    const fingerprint = JSON.stringify(state);
    if (fingerprint === lastFingerprint) return;
    const checkpoint = { at: snapshot.capturedAt, ...state };
    if (state.move !== null && lastState?.move === state.move) timeline[timeline.length - 1] = checkpoint;
    else timeline.push(checkpoint);
    lastState = state;
    lastFingerprint = fingerprint;
    revision++;
  }

  function recordDecision(snapshot, advice) {
    if (snapshot.move == null) return;
    const choice = advice[advice.primary];
    const decision = {
      move: snapshot.move, primary: advice.primary, incomplete: advice.incomplete ?? null,
      selection: choice ? choice.tokens ? { tokens: choice.tokens, returned: choice.returned } : { cardId: choice.id } : null,
      scores: Object.fromEntries(["buy", "take", "reserve"].map(kind => [kind, advice[kind]?.score ?? null])),
      targets: advice.paths.map(path => path.id),
      threat: advice.race ? { visible: advice.race.rivalThreat, hidden: advice.race.hiddenThreat ?? [],
        orderKnown: advice.race.orderKnown, removedTarget: advice.race.removedTarget ?? null } : null
    };
    const prior = decisions.get(snapshot.move);
    if ((prior?.primary && decision.incomplete) || JSON.stringify(prior) === JSON.stringify(decision)) return;
    decisions.set(snapshot.move, decision);
    revision++;
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
      schemaVersion: 4, session, localPlayerId, timeline, decisions: [...decisions.values()], cards: Object.fromEntries(cards),
      actions: [...actions.values()].sort((a, b) => a.move - b.move ||
        a.id.localeCompare(b.id, undefined, { numeric: true })),
      result: lastState ? {
        finished: lastState.finished,
        scores: lastState.players.map(({ id, name, score }) => ({ id, name, score }))
      } : null
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

  return { observe, recordDecision, flush, status: () => status };
};
