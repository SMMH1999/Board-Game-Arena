globalThis.createSplendorGuide = () => {
  const colors = { C: "سفید", S: "آبی", E: "سبز", R: "قرمز", O: "سیاه", G: "طلا" };
  let plan;
  let layer;

  function reset() {
    plan = undefined;
    layer?.remove();
    layer = undefined;
  }

  function render(snapshot, doc, message) {
    const prompt = snapshot.turnText ?? "";
    const pending = /^(?:you (?:have )?selected|you (?:must|may) (?:return|discard|choose a noble))/i.test(prompt) ||
      Array.from(doc.querySelectorAll("#generalactions button, #generalactions a")).some(button =>
        button.getClientRects().length && /^confirm\b/i.test(button.innerText.trim()));
    const ours = snapshot.localPlayerId && snapshot.activePlayerId === snapshot.localPlayerId;
    const opponent = snapshot.activePlayerId && !ours;
    if (!opponent && plan && pending) plan.hadPending = true;
    if (opponent || /(?:game (?:is )?over|game has ended)/i.test(prompt) ||
        (!pending && plan?.hadPending && /^you must play/i.test(prompt))) reset();
    if (opponent || /(?:game (?:is )?over|game has ended)/i.test(prompt) || (!ours && !plan)) return false;
    if (!plan && !pending) {
      const advice = splendorAdvice(snapshot);
      if (advice) plan = { advice, snapshot, previews: new Map() };
    }
    if (!plan) {
      message.textContent = "پس از پایان انتخاب جاری، پیشنهاد نوبت بعدی نمایش داده می‌شود.";
      return true;
    }

    const { advice } = plan;
    const primary = advice.buy ? "buy" : advice.take ? "take" : "reserve";
    const picked = color => {
      const current = snapshot.counters.find(item => item.elementId === `coincounter_${color}`)?.text;
      return /^\d+$/.test(current ?? "") ? Math.max(0, advice.bank[color] - Number(current)) : 0;
    };
    if (!layer) {
      layer = document.createElement("div");
      layer.style.cssText = "pointer-events:none;position:fixed;inset:0;z-index:2147483646";
      document.body.append(layer);
    }
    layer.replaceChildren();
    message.replaceChildren();

    function addRow(kind, label, items, returned = []) {
      const row = document.createElement("div");
      row.style.cssText = "margin-top:7px;display:flex;align-items:center;gap:5px;flex-wrap:wrap";
      row.append(document.createTextNode((kind === primary ? "پیشنهاد اول · " : "") + label));
      for (const { id, label: caption, done } of items) {
        const element = doc.getElementById(id);
        const chip = document.createElement("span");
        chip.style.cssText = `display:inline-grid;justify-items:center;padding:2px;border-radius:5px;background:${done ? "#af3036" : "#304353"}`;
        const preview = element && spritePreview(element, id.startsWith("coinpile_") ? 26 : 38);
        if (preview) plan.previews.set(id, preview);
        const saved = plan.previews.get(id);
        if (saved) chip.append(saved.cloneNode(true));
        chip.append(document.createTextNode(caption));
        row.append(chip);
        if (kind === primary && element) drawHalo(element, done);
      }
      if (returned.length) row.append(document.createTextNode(` پس بده: ${returned.map(color => colors[color]).join("، ")}`));
      message.append(row);
    }

    function cardLabel(id) {
      const card = plan.snapshot.graphics.find(item => item.elementId === id);
      if (/^drawpile[123]$/.test(id)) return `دستهٔ سطح ${id.at(-1)}`;
      if (card.reserved) return `رزرو خودت · کارت ${id.slice(5)}`;
      const position = plan.snapshot.graphics.filter(item => item.parentId === card.parentId &&
        /^card_\d+$/.test(item.elementId ?? "") && item.x < card.x).length + 1;
      return `سطح ${card.parentId.at(-1)}، کارت ${position} از چپ`;
    }
    const cardItem = id => ({ id, label: cardLabel(id), done: snapshot.selectedCardIds.includes(id) });
    if (advice.buy) addRow("buy", "خرید", [cardItem(advice.buy.id)]);
    if (advice.take) {
      const seen = {};
      addRow("take", "برداشتن ژتون", advice.take.tokens.map(color => {
        seen[color] = (seen[color] ?? 0) + 1;
        return { id: `coinpile_${color}`, label: colors[color], done: picked(color) >= seen[color] };
      }), advice.take.returned);
    }
    if (advice.reserve) {
      addRow("reserve", advice.reserve.gold ? "رزرو + یک طلا" : "رزرو", [cardItem(advice.reserve.id)], advice.reserve.returned);
    }
    if (!message.childNodes.length) message.textContent = "حرکت قابل‌تأییدی پیدا نشد.";
    return true;
  }

  function drawHalo(element, done) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const frame = element.ownerDocument.defaultView.frameElement;
    const bounds = frame?.getBoundingClientRect();
    const sx = bounds && frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
    const sy = bounds && frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
    const halo = document.createElement("div");
    halo.style.cssText = `position:absolute;left:${(bounds?.left ?? 0) + rect.left * sx - 3}px;top:${(bounds?.top ?? 0) + rect.top * sy - 3}px;width:${rect.width * sx + 6}px;height:${rect.height * sy + 6}px;box-sizing:border-box;border:3px dashed ${done ? "#ff5159" : "#ffdb53"};border-radius:8px`;
    layer.append(halo);
  }

  function spritePreview(element, width) {
    const source = element.ownerDocument.defaultView.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (source.backgroundImage === "none" || !rect.width || !rect.height) return null;
    const preview = document.createElement("span");
    preview.style.cssText = `display:block;width:${width}px;height:${Math.round(width * rect.height / rect.width)}px;border-radius:4px`;
    preview.style.backgroundImage = source.backgroundImage;
    preview.style.backgroundSize = source.backgroundSize;
    preview.style.backgroundPosition = source.backgroundPosition;
    preview.style.backgroundRepeat = "no-repeat";
    return preview;
  }

  return { render, reset };
};
