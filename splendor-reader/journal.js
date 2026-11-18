globalThis.createSplendorJournal = () => {
  const rounds = [];
  const unassigned = [];
  let round;
  let turn;
  let anchor;

  function openRound(snapshot) {
    round = { number: rounds.length + 1, complete: false, hasGap: false, before: snapshot, after: snapshot, turns: [] };
    rounds.push(round);
  }

  function openTurn(snapshot) {
    turn = {
      playerId: snapshot.activePlayerId,
      before: snapshot,
      after: snapshot,
      observations: [],
      complete: false
    };
    round.turns.push(turn);
  }

  function observe(snapshot) {
    const id = snapshot.activePlayerId;
    if (!id) {
      if (round) round.hasGap = true;
      if (turn) turn.hasGap = true;
      recordUnassigned(snapshot);
      return;
    }

    if (!round) {
      anchor = id;
      openRound(snapshot);
      openTurn(snapshot);
      return;
    }

    if (turn.playerId === id) {
      recordChanges(turn, snapshot);
      round.after = snapshot;
      return;
    }

    recordChanges(turn, snapshot);
    turn.complete = !turn.hasGap;
    round.after = snapshot;
    if (id === anchor) {
      const roster = snapshot.players.map(player => player.id);
      const observed = round.turns.map(entry => entry.playerId);
      round.complete = !round.hasGap && roster.length >= 2 &&
        roster.length === observed.length && roster.every(player => observed.includes(player));
      openRound(snapshot);
    }
    openTurn(snapshot);
  }

  function recordUnassigned(snapshot) {
    if (!unassigned.length || unassigned.at(-1).closed) {
      unassigned.push({ before: snapshot, after: snapshot, observations: [] });
    }
    recordChanges(unassigned.at(-1), snapshot);
  }

  function recordChanges(entry, snapshot) {
    const fields = ["text", "counters", "graphics", "players"];
    const changes = {};
    for (const field of fields) {
      if (JSON.stringify(entry.after[field]) !== JSON.stringify(snapshot[field])) {
        changes[field] = snapshot[field];
      }
    }
    if (Object.keys(changes).length) entry.observations.push({ at: snapshot.capturedAt, changes });
    entry.after = snapshot;
    if (snapshot.activePlayerId && unassigned.length) unassigned.at(-1).closed = true;
  }

  return { observe, export: () => ({ schemaVersion: 1, rounds, unassigned }) };
};
