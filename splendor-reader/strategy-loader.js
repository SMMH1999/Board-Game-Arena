// Profiles are data. Only the versioned rules and policy implemented by this engine can run.
const strategyFile = "splendor_strategy_codex.json";
async function bundledStrategy() {
  const response = await fetch(chrome.runtime.getURL("strategies/" + strategyFile));
  if (!response.ok) throw new Error("Bundled strategy unavailable");
  return response.json();
}

function compatibleStrategy(definition, bundled) {
  return definition?.spec_id === bundled.spec_id && definition.version === bundled.version &&
    ["rules", "policy"].every(key => JSON.stringify(definition[key]) === JSON.stringify(bundled[key])) &&
    Object.entries(definition.tuning ?? {}).every(([key, value]) =>
      key === "phases" ? JSON.stringify(value) === JSON.stringify(bundled.tuning.phases) :
        Object.hasOwn(bundled.tuning, key) && Number.isFinite(value) && value >= 0);
}

async function archiveStrategy() {
  try {
    const root = await splendorDirectory();
    if (!root || await root.queryPermission({ mode: "read" }) !== "granted") return null;
    const folder = await root.getDirectoryHandle("strategies");
    const file = await (await folder.getFileHandle(strategyFile)).getFile();
    if (file.size <= 100000) return JSON.parse(await file.text());
  } catch {
    // An archive can be offline, read-only or configured without a strategy.
  }
  return null;
}

async function loadSplendorStrategy() {
  const [bundled, archived, settings] = await Promise.all([
    bundledStrategy(), archiveStrategy(), chrome.storage.local.get("splendorStrategies")
  ]);
  const imported = (settings.splendorStrategies ?? []).map(item => item.definition);
  const candidates = [...imported.map(definition => ({ definition, source: "imported" })),
    { definition: archived, source: "archive" }, { definition: bundled, source: "bundled" }];
  const { definition, source } = candidates.find(entry => compatibleStrategy(entry.definition, bundled));
  return { id: bundled.spec_id, version: bundled.version, mode: bundled.mode,
    rules: bundled.rules, policy: bundled.policy, tuning: { ...bundled.tuning, ...definition.tuning }, source };
}
