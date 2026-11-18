globalThis.createSplendorArchive = (session) => {
  let sequence = 0;
  const strategies = chrome.storage.local.get("splendorStrategies").then(data => data.splendorStrategies ?? []).catch(() => []);
  let snapshots = [];
  let pending = Promise.resolve();
  const known = new Map();

  function observe(snapshot) {
    snapshots.push(snapshot);
    const visible = new Set();
    for (const graphic of snapshot.graphics) {
      if (!/^card_\d+$/.test(graphic.elementId ?? "") ||
          (!graphic.reserved && !/^row_[123]$/.test(graphic.parentId ?? ""))) continue;
      visible.add(graphic.elementId);
      const previous = known.get(graphic.elementId);
      known.set(graphic.elementId, {
        id: graphic.elementId,
        level: /^row_[123]$/.test(graphic.parentId ?? "") ? Number(graphic.parentId.at(-1)) : previous?.level ?? null,
        lastLocation: graphic.reserved ? "own-reserve" : "market",
        face: graphic.backgroundPosition,
        details: snapshot.graphics.filter(part => part.parentId === graphic.elementId ||
          part.parentId?.startsWith(graphic.elementId + "_")).map(part => ({
          id: part.elementId, parent: part.parentId, sprite: part.backgroundPosition, size: part.backgroundSize
        }))
      });
    }
    for (const [id, card] of known) if (!visible.has(id)) card.lastLocation = "out-of-view";
  }

  function flush() {
    if (!snapshots.length) return pending;
    const batch = snapshots;
    snapshots = [];
    const id = String(++sequence).padStart(6, "0");
    const latest = batch.at(-1);
    const data = {
      schemaVersion: 1, session, batch: id, snapshots: batch, knownCards: [...known.values()],
      baseDeckSizes: { 1: 40, 2: 30, 3: 20 },
      remainingByLevel: Object.fromEntries([1, 2, 3].map(level => {
        const count = latest.counters.find(item => item.elementId === `drawpile_counter_${level}`)?.text;
        return [level, /^\d+$/.test(count ?? "") ? Number(count) : null];
      })),
      result: /game (?:is )?over|game has ended|end of (?:the )?game/i.test(latest.turnText ?? "")
        ? { status: "finished", scores: latest.players } : { status: "observed", scores: latest.players }
    };
    pending = pending.then(async () => {
      data.strategyNames = (await strategies).map(strategy => strategy.name);
      const response = await chrome.runtime.sendMessage({ type: "splendor-save", session, batch: id, data });
      if (!response?.saved) throw new Error(response?.error ?? "Download unavailable");
    }).catch(error => {
      snapshots = [...batch, ...snapshots];
      console.warn("Splendor archive:", error.message);
    });
    return pending;
  }

  return { observe, flush, size: () => snapshots.length };
};
