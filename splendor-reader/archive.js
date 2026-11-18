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
  const game = await games.getDirectoryHandle(session, { create: true });
  const file = await game.getFileHandle("game.json", { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(JSON.stringify(data));
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
  return { saved: true };
}
