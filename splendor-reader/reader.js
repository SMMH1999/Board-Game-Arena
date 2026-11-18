(() => {
  const key = "__splendorTableReader";
  if (globalThis[key]) return;

  let timer;
  let tableUrl;
  let history = [];
  let previousSignature;
  let journal = createSplendorJournal();

  globalThis[key] = (command) => {
    if (command === "events") {
      if (location.href !== tableUrl) return null;
      if (timer !== undefined) capture();
      return journal.export();
    }
    if (command === "active") return timer !== undefined;
    if (command === "stop") {
      clearInterval(timer);
      timer = undefined;
      return null;
    }

    if (location.href !== tableUrl) {
      clearInterval(timer);
      timer = undefined;
      tableUrl = location.href;
      history = [];
      previousSignature = undefined;
      journal = createSplendorJournal();
    }

    const snapshot = capture();
    if (!snapshot || snapshot.archiveFrameUnavailable) return snapshot;
    timer ??= setInterval(capture, 750);
    return { snapshot, history: history.slice(), events: journal.export() };
  };

  function capture() {
    if (location.href !== tableUrl) {
      clearInterval(timer);
      timer = undefined;
      return null;
    }
    const snapshot = readBoard();
    if (!snapshot || snapshot.archiveFrameUnavailable) return snapshot;
    const { capturedAt, ...state } = snapshot;
    const signature = JSON.stringify(state);
    if (signature !== previousSignature) {
      journal.observe(snapshot);
      history.push(snapshot);
      if (history.length > 150) history.shift();
      previousSignature = signature;
    }
    return snapshot;
  }

  function readBoard() {
    const { protocol, hostname, pathname, search } = location;
    if (protocol !== "https:" ||
        (hostname !== "boardgamearena.com" && !hostname.endsWith(".boardgamearena.com"))) {
      return null;
    }

    const game = new URLSearchParams(search).get("game");
    const isSplendor = game === "splendor" ||
      /^\/splendor\/?$/i.test(pathname) || /\bsplendor\b/i.test(document.title);
    if (!isSplendor) return null;

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

    let board = document.getElementById("game_play_area");
    if ((!board || !isDisplayed(board)) && pathname === "/tutorial" && game === "splendor") {
      const archive = document.querySelector(".bga-archive-frame iframe[title='Archive']");
      if (archive && isDisplayed(archive)) {
        const archiveDocument = archive.contentDocument;
        if (!archiveDocument) return { archiveFrameUnavailable: true };
        board = archiveDocument.getElementById("game_play_area");
      }
    }
    if (!board || !isDisplayed(board)) return null;

    const boardDocument = board.ownerDocument;
    const boardWindow = boardDocument.defaultView;
    const walker = boardDocument.createTreeWalker(board, NodeFilter.SHOW_TEXT);
    const boardRect = board.getBoundingClientRect();
    const text = [];
    const counters = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent.trim();
      if (!value || !isDisplayed(node.parentElement)) continue;
      const range = boardDocument.createRange();
      range.selectNodeContents(node);
      if (Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) {
        text.push(value);
        const rect = range.getBoundingClientRect();
        counters.push({
          text: value,
          elementId: node.parentElement.id || null,
          x: Math.round(rect.left - boardRect.left),
          y: Math.round(rect.top - boardRect.top)
        });
      }
    }

    // Image labels and layout help identify board pieces rendered as graphics.
    // Keep only numeric sprite offsets, with no image URLs or HTML.
    const graphics = [];
    for (const element of board.querySelectorAll("*")) {
      const style = boardWindow.getComputedStyle(element);
      const isImage = element instanceof boardWindow.HTMLImageElement;
      if (!isImage && style.backgroundImage === "none" && !element.matches("[role='img']")) continue;
      if (!isDisplayed(element)) continue;

      const rect = element.getBoundingClientRect();
      graphics.push({
        elementId: element.id || null,
        parentId: element.parentElement?.closest("[id]")?.id || null,
        backgroundSize: style.backgroundImage === "none" ? null : style.backgroundSize,
        label: element.getAttribute("aria-label") || (isImage ? element.alt : "") ||
          element.getAttribute("title") || null,
        x: Math.round(rect.left - boardRect.left),
        y: Math.round(rect.top - boardRect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        backgroundPosition: style.backgroundImage === "none" ? null : style.backgroundPosition
      });
    }

    const panels = Array.from(boardDocument.querySelectorAll("#player_boards [id^='player_board_']"))
      .filter(panel => /^player_board_\d+$/.test(panel.id) && isDisplayed(panel));
    const players = panels.map(panel => {
      const score = panel.querySelector("[id^='player_score_']");
      const scoreText = score && isDisplayed(score) ? score.innerText.trim() : "";
      return {
        id: panel.id.slice("player_board_".length),
        score: /^\d+$/.test(scoreText) ? Number(scoreText) : null
      };
    });
    const active = panels.filter(panel => panel.matches(".active-player, .player-board-active"));
    const activePlayerId = active.length === 1 ? active[0].id.slice("player_board_".length) : null;

    return {
      schemaVersion: 3,
      activePlayerId,
      players,
      game: "splendor",
      capturedAt: new Date().toISOString(),
      text,
      counters,
      graphics
    };
  }
})();
