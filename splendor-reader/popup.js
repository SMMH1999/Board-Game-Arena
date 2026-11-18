const readButton = document.querySelector("#read");
const saveButton = document.querySelector("#save");
const status = document.querySelector("#status");
const result = document.querySelector("#result");

readButton.addEventListener("click", async () => {
  readButton.disabled = true;
  saveButton.disabled = true;
  result.hidden = true;
  result.textContent = "";
  status.textContent = "در حال خواندن میز…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isBoardGameArena(tab.url)) {
      status.textContent = "تب فعال باید در Board Game Arena باشد.";
      return;
    }

    const [{ result: snapshot }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: readBoard
    });

    if (!snapshot) {
      status.textContent = "میز اسپلندور پیدا نشد. خود میز بازی یا بازپخش را باز کن و پس از بارگذاری دوباره امتحان کن.";
      return;
    }

    result.textContent = JSON.stringify(snapshot, null, 2);
    result.hidden = false;
    saveButton.disabled = false;
    status.textContent = "نمای فعلی میز خوانده شد.";
  } catch {
    status.textContent = "مرورگر نتوانست این تب را بخواند. میز را در تب عادی Chrome باز کن و دوباره امتحان کن.";
  } finally {
    readButton.disabled = false;
  }
});

saveButton.addEventListener("click", () => {
  const blob = new Blob([result.textContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "splendor-snapshot.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function isBoardGameArena(address) {
  const url = new URL(address);
  return url.protocol === "https:" &&
    (url.hostname === "boardgamearena.com" || url.hostname.endsWith(".boardgamearena.com"));
}

// This function is serialized and executed in the tab's isolated world.
function readBoard() {
  const { protocol, hostname, pathname, search } = location;
  if (protocol !== "https:" ||
      (hostname !== "boardgamearena.com" && !hostname.endsWith(".boardgamearena.com"))) {
    return null;
  }

  const board = document.getElementById("game_play_area");
  const game = new URLSearchParams(search).get("game");
  const isSplendor = game === "splendor" ||
    /^\/splendor\/?$/i.test(pathname) || /\bsplendor\b/i.test(document.title);
  if (!board || !isSplendor) return null;

  const excluded = "script, style, template, noscript, input, textarea, select, [contenteditable], [hidden], [inert], [aria-hidden='true'], [role='log']";

  function isDisplayed(element) {
    if (element.closest(excluded) || !element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true
    })) {
      return false;
    }
    return Array.from(element.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
  }

  if (!isDisplayed(board)) return null;

  const walker = document.createTreeWalker(board, NodeFilter.SHOW_TEXT);
  const text = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent.trim();
    if (!value || !isDisplayed(node.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) {
      text.push(value);
    }
  }

  // Image labels and layout help identify board pieces rendered as graphics.
  // Keep only numeric sprite offsets, with no image URLs or HTML.
  const graphics = [];
  const boardRect = board.getBoundingClientRect();
  for (const element of board.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    const isImage = element instanceof HTMLImageElement;
    if (!isImage && style.backgroundImage === "none" && !element.matches("[role='img']")) continue;
    if (!isDisplayed(element)) continue;

    const rect = element.getBoundingClientRect();
    graphics.push({
      label: element.getAttribute("aria-label") || (isImage ? element.alt : "") ||
        element.getAttribute("title") || null,
      x: Math.round(rect.left - boardRect.left),
      y: Math.round(rect.top - boardRect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      backgroundPosition: style.backgroundImage === "none" ? null : style.backgroundPosition
    });
  }

  return {
    schemaVersion: 1,
    game: "splendor",
    capturedAt: new Date().toISOString(),
    text,
    graphics
  };
}
