importScripts("directory.js");

chrome.runtime.onInstalled.addListener(() => {
  splendorDirectory().then(handle => {
    if (!handle) return chrome.runtime.openOptionsPage();
  }).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== "splendor-save" || !sender.tab ||
      !/^[a-zA-Z0-9-]+$/.test(message.session) ||
      !sender.url || !/^https:\/\/(?:[\w-]+\.)*boardgamearena\.com\//.test(sender.url)) return;
  save(message.session, message.data).then(
    result => respond(result),
    error => respond({ saved: false, reason: error.name })
  );
  return true;
});

async function save(session, data) {
  const folder = await splendorDirectory();
  if (!folder || await folder.queryPermission({ mode: "readwrite" }) !== "granted") {
    return { saved: false, reason: "folder-required" };
  }

  const games = await folder.getDirectoryHandle("games", { create: true });
  const outcome = data.result?.finished ? data.result.outcome : "in_progress";
  const group = { win: "wins", loss: "losses", in_progress: "in-progress", draw: "unclassified", unknown: "unclassified" };
  const destination = Object.hasOwn(group, outcome) ? group[outcome] : "unclassified";
  const category = await games.getDirectoryHandle(destination, { create: true });
  const game = await category.getDirectoryHandle(session, { create: true });
  const file = await game.getFileHandle("game.json", { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(JSON.stringify(data));
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
  if (data.result?.finished) {
    for (const previous of new Set(Object.values(group))) {
      if (previous !== destination) await removePreviousArchive(games, previous, session);
    }
  }
  return { saved: true };
}


async function removePreviousArchive(games, previous, session) {
  try {
    const parent = await games.getDirectoryHandle(previous);
    const game = await parent.getDirectoryHandle(session);
    const file = await game.getFileHandle("game.json");
    const existing = await (await file.getFile()).text();
    let data;
    try {
      data = JSON.parse(existing);
    } catch {
      return;
    }
    if (data?.session !== session || !Array.isArray(data.timeline)) return;
    await game.removeEntry("game.json");
    try {
      await parent.removeEntry(session);
    } catch (error) {
      if (error.name !== "InvalidModificationError") throw error;
    }
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }
}
