(() => {
  const key = "__splendorTableReader";
  if (globalThis[key]) return;

  let timer;
  let tableUrl;
  let history = [];
  let previousSignature;
  let journal = createSplendorJournal();
  let overlay;

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
      overlay?.host.remove();
      overlay = undefined;
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
    renderOverlay(snapshot);
    return { snapshot, history: history.slice(), events: journal.export() };
  };

  function capture() {
    if (location.href !== tableUrl) {
      clearInterval(timer);
      timer = undefined;
      overlay?.host.remove();
      overlay = undefined;
      return null;
    }
    const snapshot = readBoard();
    if (!snapshot || snapshot.archiveFrameUnavailable) {
      if (overlay) overlay.message.textContent = "میز در دسترس نیست.";
      previousSignature = undefined;
      return snapshot;
    }
    const { capturedAt, ...state } = snapshot;
    const signature = JSON.stringify(state, (key, value) => key === "x" || key === "y" ? undefined : value);
    if (signature !== previousSignature) {
      journal.observe(snapshot);
      history.push(snapshot);
      if (history.length > 150) history.shift();
      previousSignature = signature;
      renderOverlay(snapshot);
    }
    return snapshot;
  }

  function renderOverlay(snapshot) {
    if (!overlay) {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647";
      const shadow = host.attachShadow({ mode: "closed" });
      const panel = document.createElement("section");
      panel.dir = "rtl";
      panel.style.cssText = "background:#17232c;color:white;padding:12px;border-radius:8px;width:235px;font:14px/1.6 system-ui;box-shadow:0 2px 10px #0005";
      const title = document.createElement("strong");
      title.textContent = "پیشنهاد اسپلندور";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "بستن";
      close.style.cssText = "float:left;margin-right:8px";
      close.addEventListener("click", () => globalThis[key]("stop"));
      const message = document.createElement("div");
      message.setAttribute("role", "status");
      panel.append(title, close, message);
      shadow.append(panel);
      document.body.append(host);
      overlay = { host, message };
    }

    if (!snapshot.activePlayerId || !snapshot.localPlayerId) {
      overlay.message.textContent = "ثبت فعال است؛ بازیکن صاحب نوبت هنوز مشخص نیست.";
      return;
    }
    if (snapshot.activePlayerId !== snapshot.localPlayerId) {
      overlay.message.textContent = "ثبت فعال است؛ منتظر نوبت شما.";
      return;
    }
    const suggestion = splendorAdvice(snapshot);
    const suggestedCard = snapshot.graphics.find(item => item.elementId === suggestion?.id);
    const position = suggestedCard ? snapshot.graphics.filter(item =>
      item.parentId === suggestedCard.parentId && /^card_\d+$/.test(item.elementId ?? "") &&
      item.x < suggestedCard.x).length + 1 : null;
    overlay.message.textContent = suggestion
      ? `پیشنهاد خرید: ردیف سطح ${suggestedCard.parentId.at(-1)}، کارت ${position} از چپ · هزینه: ${suggestion.payment} ژتون`
      : "خرید قابل‌تأییدی برای پیشنهاد پیدا نشد.";
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
    const itemIds = new Set(graphics.map(item => /^player_items_(\d+)_[CSERO]$/.exec(item.parentId ?? "")?.[1]).filter(Boolean));
    const localPlayerId = itemIds.size === 1 ? [...itemIds][0] : null;
    const title = boardDocument.getElementById("pagemaintitletext");
    const turnText = title && isDisplayed(title) ? title.innerText.trim() : "";
    const named = panels.filter(panel => {
      const name = panel.querySelector(".player-name");
      return name && isDisplayed(name) && name.innerText.trim() &&
        turnText.startsWith(name.innerText.trim() + " ");
    });
    const yourTurn = /^(?:you must\b|your turn\b|it's your turn\b)/i.test(turnText);
    const activePlayerId = (yourTurn ? localPlayerId : null) ??
      (active.length === 1 ? active[0].id.slice(13) : null) ??
      (named.length === 1 ? named[0].id.slice(13) : null);

    return {
      schemaVersion: 3,
      activePlayerId,
      localPlayerId,
      turnText,
      players,
      game: "splendor",
      capturedAt: new Date().toISOString(),
      text,
      counters,
      graphics
    };
  }
})();
