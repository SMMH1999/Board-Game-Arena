(() => {
  const key = "__splendorTableReader";
  if (globalThis[key]) return;

  let timer;
  let tableUrl;
  let history = [];
  let previousSignature;
  let journal = createSplendorJournal();
  let overlay;
  let archive;
  let boardDocument;
  let turnOrder = [];
  let firstPlayerId;
  let roundOrder;
  let reserveTracker;
  const observedActions = new Map();
  const guide = createSplendorGuide();

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
      archive?.flush(true);
      overlay?.dispose();
      overlay?.host.remove();
      overlay = undefined;
      guide.reset();
      return null;
    }

    if (location.href !== tableUrl) {
      clearInterval(timer);
      timer = undefined;
      guide.reset();
      archive?.flush(true);
      tableUrl = location.href;
      observedActions.clear();
      turnOrder = [];
      firstPlayerId = undefined;
      roundOrder = undefined;
      reserveTracker = createSplendorReserveTracker();
      guide.clearTarget();
      archive = createSplendorArchive(new Date().toISOString().replace(/[^0-9]/g, "") + "-" + crypto.randomUUID());
      history = [];
      previousSignature = undefined;
      journal = createSplendorJournal();
    }

    const snapshot = capture();
    if (!snapshot || snapshot.archiveFrameUnavailable) return snapshot;
    timer ??= setInterval(capture, 750);
    if (snapshot.tableLoading) return snapshot;
    return { snapshot, history: history.slice(), events: journal.export() };
  };

  function capture() {
    if (location.href !== tableUrl) {
      clearInterval(timer);
      timer = undefined;
      archive?.flush(true);
      overlay?.dispose();
      overlay?.host.remove();
      overlay = undefined;
      guide.reset();
      return null;
    }
    const snapshot = readBoard();
    if (!snapshot || snapshot.archiveFrameUnavailable || snapshot.tableLoading) {
      guide.reset();
      if (overlay) overlay.message.textContent = "میز در دسترس نیست.";
      previousSignature = undefined;
      return snapshot;
    }
    if (snapshot.move === 1 && snapshot.activePlayerId) {
      firstPlayerId = snapshot.activePlayerId;
      roundOrder = undefined;
    }
    const oldActive = turnOrder.at(-1);
    if (snapshot.activePlayerId && oldActive !== snapshot.activePlayerId) {
      turnOrder.push(snapshot.activePlayerId);
      if (turnOrder.length > 12) turnOrder.shift();
    }
    if (!roundOrder && firstPlayerId) {
      const firstIndex = turnOrder.indexOf(firstPlayerId);
      const cycle = firstIndex >= 0 ? turnOrder.slice(firstIndex, firstIndex + snapshot.players.length) : [];
      if (cycle.length === snapshot.players.length &&
          new Set(cycle).size === cycle.length && snapshot.players.every(player => cycle.includes(player.id))) {
        roundOrder = cycle;
      }
    }
    if (roundOrder) snapshot.roundOrder = roundOrder;
    const previousCycle = turnOrder.slice(0, -1);
    const lastOwnTurn = previousCycle.lastIndexOf(snapshot.localPlayerId);
    snapshot.rivalOrder = lastOwnTurn < 0 ? [] : previousCycle.slice(lastOwnTurn + 1);
    for (const event of snapshot.gameLog) observedActions.set(event.id, event);
    snapshot.rivalEvents = [...observedActions.values()].sort((a, b) => a.move - b.move).slice(-36);
    snapshot.publicRivalReserves = reserveTracker.observe(snapshot);
    const { capturedAt, ...state } = snapshot;
    const signature = JSON.stringify(state, (key, value) => key === "x" || key === "y" ? undefined : value);
    if (signature !== previousSignature) {
      journal.observe(snapshot);
      archive.observe(snapshot);
      history.push(snapshot);
      if (history.length > 150) history.shift();
      previousSignature = signature;
    }
    archive.flush();
    renderOverlay(snapshot);
    return snapshot;
  }

  function renderOverlay(snapshot) {
    if (!overlay) {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;bottom:16px;right:20px;z-index:2147483647";
      const shadow = host.attachShadow({ mode: "closed" });
      const panel = document.createElement("section");
      panel.dir = "rtl";
      const styles = document.createElement("style");
      styles.textContent = `
        section.panel { box-sizing:border-box; width:min(338px, calc(100vw - 40px)); max-height:75vh;
          overflow:auto; background:#151026; color:#faf5ff; border:1px solid #895ab1; border-radius:16px;
          padding:13px; box-shadow:0 14px 34px #10091baa; font:14px/1.55 system-ui,sans-serif; }
        header, h3 { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        header { margin-bottom:9px; cursor:move; touch-action:none; }
        .grip { display:block; margin:8px auto 0 0; cursor:nwse-resize; touch-action:none; }

        header strong { font-size:16px; }
        button { color:inherit; background:#302246; border:1px solid #725692; border-radius:7px;
          padding:4px 10px; font:inherit; cursor:pointer; }
        .move { margin-top:7px; padding:8px 10px; background:#221936; border:1px solid #49345f; border-radius:10px; }
        .primary { border:2px solid #ef78e9; background:#342048; }
        h3 { margin:0 0 6px; font-size:14px; }
        .badge { background:#f8a6f2; color:#341239; font-size:11px; padding:2px 7px; border-radius:12px; }
        .choices { display:flex; gap:6px; flex-wrap:wrap; }
        .choice { display:grid; justify-items:center; gap:3px; min-width:42px; padding:4px 6px;
          border-radius:7px; background:#3c2d54; font-size:12px; }
        .selected { background:#852c48; outline:1px solid #ff7d94; }
        small { font-size:10px; }
        .return { margin:5px 0 0; color:#ffe2a8; }
      `;
      panel.className = "panel";
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = "راهنمای اسپلندور";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "بستن";
      close.addEventListener("click", () => globalThis[key]("stop"));
      header.append(title, close);
      const message = document.createElement("div");
      message.setAttribute("role", "status");
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "grip";
      grip.textContent = "تغییر اندازه ↘";
      const archiveStatus = document.createElement("small");
      panel.append(header, message, archiveStatus, grip);
      shadow.append(styles, panel);
      document.body.append(host);
      overlay = { host, message, archiveStatus, dispose: manageSplendorPanel(host, panel, header, grip) };
    }

    const saveStatus = archive.status();
    overlay.archiveStatus.textContent = saveStatus === "folder-required"
      ? "ذخیره متوقف است. از پنجرهٔ افزونه، محل ذخیره را تنظیم کن."
      : saveStatus && saveStatus !== "saved" ? "آخرین ذخیره موفق نبود." : "";
    if (guide.render(snapshot, boardDocument, overlay.message, archive.recordDecision)) return;

    if (!snapshot.activePlayerId && snapshot.activePlayerName) {
      overlay.message.textContent = `نوبت ${snapshot.activePlayerName} است؛ شناسهٔ بازیکن هنوز مشخص نیست.`;
      return;
    }
    if (!snapshot.activePlayerId) {
      overlay.message.textContent = "ثبت فعال است؛ بازیکن صاحب نوبت هنوز مشخص نیست.";
      return;
    }
    if (!snapshot.localPlayerId || snapshot.activePlayerId !== snapshot.localPlayerId) {
      overlay.message.textContent = snapshot.activePlayerName
        ? `نوبت ${snapshot.activePlayerName} است.`
        : "ثبت فعال است؛ منتظر تشخیص نوبت شما.";
      return;
    }
  }

  function readBoard() {
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

    const table = findSplendorTable(document, location.href, isDisplayed);
    if (!table?.board) return table;
    const { board } = table;
    boardDocument = board.ownerDocument;
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
        reserved: /^card_\d+$/.test(element.id) &&
          Boolean(element.closest("#player_reserve, #spl_playerreserve, #spl_playerreserve_cards, #player_reserved_cards, #player_reserved")),

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

    const itemIds = new Set(graphics.map(item => /^player_items_(\d+)_[CSERO]$/.exec(item.parentId ?? "")?.[1]).filter(Boolean));
    const localPlayerId = itemIds.size === 1 ? [...itemIds][0] : null;
    const turn = readSplendorTurn(boardDocument, isDisplayed, localPlayerId);
    const gameState = readSplendorBoardData(board, turn.players, localPlayerId, isDisplayed);
    const moveText = boardDocument.getElementById("move_nbr")?.innerText.trim();
    const move = /^\d+$/.test(moveText ?? "") ? Number(moveText) : null;

    return {
      schemaVersion: 3,
      ...turn,
      localPlayerId,
      game: "splendor",
      capturedAt: new Date().toISOString(),
      text,
      counters,
      gameLog: gameState.events,
      gameState,
      move,
      selectedCardIds: graphics.filter(item => /^card_\d+$/.test(item.elementId ?? "") &&
        boardDocument.getElementById(item.elementId)?.matches(".selected, .card_selected, [aria-selected='true']"))
        .map(item => item.elementId),

      graphics
    };
  }
})();
