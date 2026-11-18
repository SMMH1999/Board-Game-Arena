const readButton = document.querySelector("#read");
const stopButton = document.querySelector("#stop");
const eventsButton = document.querySelector("#events");
let events;
const saveButton = document.querySelector("#save");
const status = document.querySelector("#status");
const result = document.querySelector("#result");

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isBoardGameArena(tab.url)) return;
    const [{ result: installed }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Boolean(globalThis.__splendorTableReader?.("active"))
    });
    if (installed) stopButton.disabled = false;
  } catch {
    // The active tab may have changed while the popup was opening.
  }
})();

readButton.addEventListener("click", readTable);

async function readTable() {
  readButton.disabled = true;
  saveButton.disabled = true;
  eventsButton.disabled = true;
  result.hidden = true;
  result.textContent = "";
  status.textContent = "در حال خواندن میز…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isBoardGameArena(tab.url)) {
      status.textContent = "تب فعال باید در Board Game Arena باشد.";
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["journal.js", "advice.js", "turn.js", "guide.js", "panel.js", "session.js", "table.js", "reader.js"]
    });
    const [{ result: session }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: () => globalThis.__splendorTableReader("read")
    });

    if (!session) {
      status.textContent = "میز اسپلندور پیدا نشد. خود میز بازی یا بازپخش را باز کن و پس از بارگذاری دوباره امتحان کن.";
      return;
    }

    if (session.tableLoading) {
      status.textContent = "در انتظار بارگذاری میز. راهنما با ظاهر شدن میز باز می‌شود.";
      stopButton.disabled = false;
      return;
    }
    if (session.archiveFrameUnavailable) {
      status.textContent = "مرورگر اجازهٔ خواندن قاب بازی را نداد. افزونه به دسترسی همین تب محدود است.";
      return;
    }

    const { events: eventLog, ...boardSession } = session;
    events = eventLog;
    const changes = summarizeChanges(boardSession.history);
    result.textContent = JSON.stringify({ ...boardSession, changes }, null, 2);
    eventsButton.disabled = false;
    result.hidden = false;
    saveButton.disabled = false;
    readButton.textContent = "خواندن مجدد میز";
    stopButton.disabled = false;
    status.textContent = `ثبت فعال است · ${session.history.length} وضعیت ثبت‌شده. ${events.rounds.filter(round => round.complete).length} دور کامل ثبت شده.`;
  } catch {
    status.textContent = "مرورگر نتوانست این تب را بخواند. میز را در تب عادی Chrome باز کن و دوباره امتحان کن.";
  } finally {
    readButton.disabled = false;
  }
}

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { globalThis.__splendorTableReader?.("stop"); }
    });
    readButton.textContent = "خواندن میز";
    status.textContent = "ثبت متوقف شد.";
  } catch {
    stopButton.disabled = false;
    status.textContent = "توقف ثبت از این پنجره ممکن نبود.";
  }
});

saveButton.addEventListener("click", () => download(result.textContent, "splendor-snapshot.json"));
eventsButton.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: eventLog }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.__splendorTableReader?.("events")
    });
    if (!eventLog) throw new Error("Event log unavailable");
    download(JSON.stringify(eventLog), "splendor-events.json");
  } catch {
    status.textContent = "تاریخچهٔ این میز برای ذخیره در دسترس نیست.";
  }
});

function download(content, filename) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isBoardGameArena(address) {
  const url = new URL(address);
  return url.protocol === "https:" &&
    (url.hostname === "boardgamearena.com" || url.hostname.endsWith(".boardgamearena.com"));
}

function summarizeChanges(history) {
  return history.slice(1).map((after, index) => {
    const before = history[index];
    const countTexts = (snapshot) => {
      const counts = new Map();
      for (const value of snapshot.text) counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    };
    const oldTexts = countTexts(before);
    const newTexts = countTexts(after);
    const textChanges = [];
    for (const value of new Set([...oldTexts.keys(), ...newTexts.keys()])) {
      const delta = (newTexts.get(value) ?? 0) - (oldTexts.get(value) ?? 0);
      if (delta) textChanges.push({ value, delta });
    }
    return {
      capturedAt: after.capturedAt,
      textChanges,
      graphicCountDelta: after.graphics.length - before.graphics.length
    };
  });
}

readTable();
