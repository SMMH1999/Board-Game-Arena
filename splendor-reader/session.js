globalThis.createSplendorArchive = (session) => {
  const extensionVersion = chrome.runtime.getManifest().version;
  const timeline = [];
  const actions = new Map();
  const cards = new Map();
  const rivalPredictions = new Map();
  const decisions = new Map();
  const strategyProfiles = new Map();
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
      if (!event.id || (actions.has(event.id) && (!event.cardId || actions.get(event.id).cardId === event.cardId))) continue;
      actions.set(event.id, event);
      revision++;
    }

    const finished = /game (?:is )?over|game has ended|end of (?:the )?game/i.test(snapshot.turnText ?? "");
    if (!finished && !/must play|your turn/i.test(snapshot.turnText ?? "")) return;

    const prediction = snapshot.rivalForecasts?.find(item => item.playerId === snapshot.activePlayerId);
    if (!finished && prediction && Number.isInteger(snapshot.move) && !rivalPredictions.has(snapshot.move)) {
      rivalPredictions.set(snapshot.move, { ...prediction, move: snapshot.move });
      revision++;
    }

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
      ...(finished ? { resultText: snapshot.turnText.trim() } : {}),
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
    return finished;
  }

  function recordDecision(snapshot, advice) {
    if (snapshot.move == null) return;
    const choice = advice[advice.primary];
    const profile = globalThis.splendorActiveStrategy;
    let profileKey;
    if (advice.primary && profile && advice.strategyId === profile.id + "@" + profile.version) {
      profileKey = advice.strategyId + "/" + profile.source + "/" + Object.values(profile.tuning ?? {}).join("-");
      strategyProfiles.set(profileKey, profile);
    }
    const decision = {
      move: snapshot.move, primary: advice.primary, strategyId: advice.strategyId ?? null,
      ...(profileKey ? { strategyProfile: profileKey } : {}),
      preferredColors: advice.preferredColors ?? [],
      colorEconomy: advice.race?.colorEconomy ?? [],
      focusedNobles: advice.race?.focusedNobles ?? [],
      nobleClaim: choice?.nobleId ?? null, projectedWinTurn: advice.race?.projectedWinTurn ?? null,
      incomplete: advice.incomplete ?? null,
      selection: choice ? choice.tokens ? { tokens: choice.tokens, returned: choice.returned } : { cardId: choice.id } : null,
      scores: Object.fromEntries(["buy", "take", "reserve"].map(kind => [kind, advice[kind]?.score ?? null])),
      targets: advice.paths.map(path => path.id),
      discountPriorities: advice.race?.discountPriorities ?? [],
      discountGroups: advice.race?.discountGroups ?? [],
      nobleTarget: advice.race?.nobleTarget?.id ?? null,
      immediatePoints: advice.race?.immediatePoints ?? null,
      threat: advice.race ? { visible: advice.race.rivalThreat,
        orderKnown: advice.race.orderKnown, removedTarget: advice.race.removedTarget ?? null } : null
    };
    const prior = decisions.get(snapshot.move);
    if ((prior?.primary && decision.incomplete) || JSON.stringify(prior) === JSON.stringify(decision)) return;
    decisions.set(snapshot.move, decision);
    revision++;
  }

  function gameResult() {
    if (!lastState) return null;
    const scores = lastState.players.map(({ id, name, score }) => ({ id, name, score }));
    const result = { finished: lastState.finished, scores, outcome: "in_progress", winnerId: null };
    if (!lastState.finished) return result;
    result.outcome = "unknown";
    if (!scores.some(player => player.id === localPlayerId)) return result;

    const heading = lastState.resultText;
    if (/game (?:was )?(?:abandoned|cancelled|canceled)|no winner/i.test(heading)) return result;
    const announcedTie = /\b(?:tie|draw)[.!]?$/i.test(heading) && !/\bwins\b/i.test(heading);
    if (announcedTie) result.outcome = "draw";

    let winner;
    const announced = /^(?:end of (?:the )?game|game (?:is )?over|game has ended)\s*[:–—-]\s*(.+?)\s+wins[.!]?$/i.exec(heading);
    if (announced) {
      const winners = scores.filter(player => player.name?.toLowerCase() === announced[1].trim().toLowerCase());
      if (winners.length === 1) winner = winners[0];
    } else if (scores.length > 1 && scores.every(player => Number.isInteger(player.score))) {
      const high = Math.max(...scores.map(player => player.score));
      const ranked = lastState.players.map(player => {
        const discounts = ["C","S","E","R","O"].map(color => player.discounts?.[color]);
        return { id: player.id, score: player.score, cards: discounts.every(Number.isInteger)
          ? discounts.reduce((sum, count) => sum + count, 0) : null };
      });
      const leaders = splendorClassic.leaders(ranked);
      if (high >= 15 && leaders.length > 1) {
        result.winnerIds = leaders.map(player => player.id);
        result.outcome = result.winnerIds.includes(localPlayerId) ? "win" : "loss";
        return result;
      }
      if (!announcedTie && high >= 15 && leaders.length === 1) winner = leaders[0];
    }
    if (winner) {
      result.winnerId = winner.id;
      result.outcome = winner.id === localPlayerId ? "win" : "loss";
    }
    return result;
  }

  function flush(force = false) {
    if (pending) {
      forceAfterPending ||= force;
      return pending;
    }
    if (savedRevision === revision || (!force && Date.now() - lastAttempt < 10000)) return;
    lastAttempt = Date.now();
    const writingRevision = revision;
    const recordedDecisions = [...decisions.values()];
    const strategiesUsed = [...new Set(recordedDecisions
      .filter(decision => decision.primary && decision.strategyId)
      .map(decision => decision.strategyId))];
    const actualActions = [...actions.values()];
    const rivalForecasts = [...rivalPredictions.values()].map(prediction => {
      const events = actualActions.filter(event => event.playerId === prediction.playerId && event.move === prediction.move + 1);
      const actual = events.find(event => ["buys", "reserves"].includes(event.action)) ??
        events.find(event => event.action === "gets" && event.icons.some(icon => icon.kind === "token" && icon.color !== "G"));
      if (!actual) return { ...prediction, actual: null, matched: null };
      const kind = { buys: "buy", reserves: "reserve", gets: "take" }[actual.action];
      const drawn = actual.icons.filter(icon => icon.kind === "token").map(icon => icon.color);
      const matched = kind !== prediction.kind ? false : kind === "take"
        ? [...drawn].sort().join() === [...prediction.tokens].sort().join()
        : actual.cardId ? actual.cardId === prediction.cardId : null;
      return { ...prediction, actual: { eventId: actual.id, kind, cardId: actual.cardId ?? null }, matched };
    });
    const data = {
      schemaVersion: 4, session, localPlayerId, extensionVersion, strategiesUsed,
      strategyProfiles: Object.fromEntries(strategyProfiles),
      timeline, rivalForecasts, decisions: recordedDecisions, cards: Object.fromEntries(cards),
      actions: [...actions.values()].sort((a, b) => a.move - b.move ||
        a.id.localeCompare(b.id, undefined, { numeric: true })),
      result: gameResult()
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
