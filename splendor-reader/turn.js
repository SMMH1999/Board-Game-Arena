globalThis.readSplendorTurn = (doc, isDisplayed, localPlayerId) => {
  const normalize = value => value?.replace(/\s+/g, " ").trim() ?? "";
  const visibleText = element => element && isDisplayed(element) ? normalize(element.innerText) : "";
  const panels = Array.from(doc.querySelectorAll("[id^='player_board_']"))
    .filter(panel => /^player_board_\d+$/.test(panel.id) && isDisplayed(panel));
  const players = panels.map(panel => {
    const id = panel.id.slice("player_board_".length);
    const nameElements = [
      panel.querySelector(`[id='player_name_${id}'] a`),
      panel.querySelector(`[id='player_name_${id}']`),
      panel.querySelector(".player-name a, .playername a"),
      panel.querySelector(".player-name, .playername"),
      doc.getElementById(`player_name_${id}`)
    ];
    const name = nameElements.map(visibleText).find(Boolean) ?? null;
    const score = visibleText(panel.querySelector(`[id='player_score_${id}']`));
    return { id, name, score: /^\d+$/.test(score) ? Number(score) : null };
  });

  const turnText = visibleText(doc.getElementById("pagemaintitletext"));
  const yourTurn = /^(?:you must\b|you (?:have )?selected\b|your turn\b|it['’]s your turn\b)/i.test(turnText);
  const headingName = yourTurn ? null : /^(.+?) must (?:play|\S.*)$/i.exec(turnText)?.[1] ?? null;
  const named = headingName
    ? players.filter(player => player.name?.toLowerCase() === headingName.toLowerCase())
    : [];
  const activePanels = panels.filter(panel => panel.matches(".active-player, .player-board-active"));
  const markedId = activePanels.length === 1 ? activePanels[0].id.slice("player_board_".length) : null;
  const marked = players.find(player => player.id === markedId);
  // A contradictory or ambiguous name should never authorize a local recommendation.
  const markedMatches = !headingName ||
    marked?.name?.toLowerCase() === headingName.toLowerCase();
  const activePlayerId = yourTurn ? localPlayerId :
    named.length === 1 ? named[0].id :
    named.length === 0 && markedMatches ? markedId : null;
  const activePlayerName = headingName ?? players.find(player => player.id === activePlayerId)?.name ?? null;

  return { activePlayerId, activePlayerName, turnText, players };
};
