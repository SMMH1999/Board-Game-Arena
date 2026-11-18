globalThis.findSplendorTable = (doc, address, isDisplayed) => {
  const { hostname, protocol, pathname, searchParams } = new URL(address);
  if (protocol !== "https:" ||
      (hostname !== "boardgamearena.com" && !hostname.endsWith(".boardgamearena.com"))) return null;

  const tutorial = pathname === "/tutorial" && searchParams.get("game") === "splendor";
  const tableView = pathname === "/tableview" && /^\d+$/.test(searchParams.get("table") ?? "");
  const identified = tutorial || searchParams.get("game") === "splendor" ||
    /(?:^|\/)splendor\/?$/i.test(pathname) || /\bsplendor\b/i.test(doc.title);
  const root = doc.getElementById("game_play_area");
  if (identified && root && isDisplayed(root)) return { board: root };

  const frame = tutorial ? doc.querySelector(".bga-archive-frame iframe[title='Archive']") :
    tableView ? doc.querySelector("iframe#gameIframe") : null;
  if (!frame || !isDisplayed(frame)) return identified && (tutorial || tableView) ? { tableLoading: true } : null;

  const inner = frame.contentDocument;
  if (!inner) return identified ? { archiveFrameUnavailable: true } : null;
  const frameBoard = inner.getElementById("game_play_area");
  if (frameBoard && isDisplayed(frameBoard)) {
    // The table shell can still have a generic title when the game has already rendered.
    if (tutorial || (frameBoard.querySelector("#row_1") &&
        frameBoard.querySelector("#spl_playerboard_gemcount"))) return { board: frameBoard };
    return null;
  }
  return identified || inner.readyState === "loading" ? { tableLoading: true } : null;
};
