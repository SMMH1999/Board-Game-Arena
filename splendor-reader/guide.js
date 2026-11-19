globalThis.createSplendorGuide = () => {
  const colors = { C: "سفید", S: "آبی", E: "سبز", R: "قرمز", O: "سیاه", G: "طلا" };
  let plan;
  let preferredTarget;
  let previousNobles = [];
  let previousBuy;
  let preferredColors = [];
  let layer;
  const halos = new Map();
  const nobleHalos = new Map();
  let recommended = [];
  let colorChanged = false;

  function clearPlan() {
    plan = undefined;
    for (const halo of halos.values()) halo.remove();
    halos.clear();
  }

  function reset() {
    clearPlan();
    layer?.remove();
    layer = undefined;
    nobleHalos.clear();
  }

  function render(snapshot, doc, message, recordDecision) {
    const prompt = snapshot.turnText ?? "";
    if (/end of (?:the )?game|game over|game has ended/i.test(prompt)) {
      clearPlan();
      message.textContent = "بازی به پایان رسید.";
      return true;
    }
    if (/^pay\b.*\bto buy\b/i.test(prompt)) {
      clearPlan();
      message.textContent = "خرید در مرحلهٔ پرداخت است. پیشنهاد بعد از پایان پرداخت یا لغو خرید محاسبه می‌شود.";
      return true;
    }
    const pending = /^(?:you (?:have )?selected|you (?:must|may) (?:return|discard|choose a noble))/i.test(prompt) ||
      Array.from(doc.querySelectorAll("#generalactions button, #generalactions a")).some(button =>
        button.getClientRects().length && /^confirm\b/i.test(button.innerText.trim()));
    const ours = snapshot.localPlayerId && snapshot.activePlayerId === snapshot.localPlayerId;
    const opponent = snapshot.activePlayerId && !ours;
    if (!opponent && plan && pending) plan.hadPending = true;
    if (opponent || /(?:game (?:is )?over|game has ended)/i.test(prompt) ||
        (!pending && plan?.hadPending && /^you must play/i.test(prompt))) clearPlan();
    if (opponent || /(?:game (?:is )?over|game has ended)/i.test(prompt) || (!ours && !plan)) return false;
    if (colorChanged && !pending) clearPlan();
    if (!plan && !pending) {
      colorChanged = false;
      const deferredBuy = previousBuy && previousBuy.move !== snapshot.move ? previousBuy.id : null;
      const nobleTargets = (snapshot.gameState?.nobles ?? [])
        .filter(noble => previousNobles.includes(noble.id));
      previousNobles = nobleTargets.map(noble => noble.id);
      const advice = splendorAdvice(snapshot, preferredTarget, deferredBuy, previousNobles, preferredColors);
      if (advice?.incomplete) {
        message.textContent = advice.incomplete === "market"
          ? "بازار هنوز کامل خوانده نشده است؛ پیشنهاد پس از تکمیل نمایش داده می‌شود."
          : "اطلاعات ژتون‌ها، تخفیف‌ها یا امتیاز هنوز برای پیشنهاد کافی نیست.";
        recordDecision?.(snapshot, advice);
        return true;
      }
      if (advice?.race) {
        previousNobles = advice.race.focusedNobles;
        recommended = advice.race.recommendedColors;
      preferredColors = advice.race.preferredColors;
      }
      if (advice?.paths.length) preferredTarget = advice.paths[0].id;
      if (advice) {
        plan = { advice, snapshot, previews: new Map() };
        if (previousBuy?.move !== snapshot.move) {
          previousBuy = advice.primary !== "buy" && advice.buy
            ? { move: snapshot.move, id: advice.buy.id } : null;
        }
        recordDecision?.(snapshot, advice);
      }
    }
    if (!plan) {
      message.textContent = "پس از پایان انتخاب جاری، پیشنهاد نوبت بعدی نمایش داده می‌شود.";
      return true;
    }

    const { advice } = plan;
    const primary = advice.primary;
    const picked = color => {
      const current = snapshot.counters.find(item => item.elementId === `coincounter_${color}`)?.text;
      return /^\d+$/.test(current ?? "") ? Math.max(0, advice.bank[color] - Number(current)) : 0;
    };
    const visibleHalos = new Set();
    const rivalsExpanded = message.querySelector("details")?.open ?? false;
    message.replaceChildren();
    if (advice.buy || advice.take || advice.reserve) {
      const hint = document.createElement("p");
      hint.className = "return";
      hint.textContent = advice.mode === "optimal-economy" ? "اقتصاد بهینه · برای این نوبت یک حرکت انتخاب کن." : "برای این نوبت یکی از گزینه‌ها را انتخاب کن.";
      message.append(hint);
    }

    function addRow(kind, label, items, returned = []) {
      const row = document.createElement("section");
      row.className = kind === primary ? "move primary" : "move";
      const heading = document.createElement("h3");
      heading.textContent = label;
      row.append(heading);
      if (kind === primary) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "پیشنهاد اول";
        heading.append(badge);
      }
      const choices = document.createElement("div");
      choices.className = "choices";
      for (const { id, label: caption, done } of items) {
        const element = doc.getElementById(id);
        const chip = document.createElement("div");
        chip.className = done ? "choice selected" : "choice";
        const token = id.startsWith("coinpile_");
        if (!plan.previews.has(id) && element) {
          const preview = spritePreview(element, token ? 38 : 56);
          if (preview) plan.previews.set(id, preview);
        }
        const saved = plan.previews.get(id);
        if (saved) chip.append(saved.cloneNode(true));
        const text = document.createElement("span");
        text.textContent = caption;
        chip.append(text);
        if (done) {
          const status = document.createElement("small");
          status.textContent = "انتخاب شد";
          chip.append(status);
        }
        choices.append(chip);
        if (kind === primary && element) {
          visibleHalos.add(id);
          drawHalo(element, done, id);
        }
      }
      row.append(choices);
      if (returned.length) {
        const note = document.createElement("p");
        note.className = "return";
        note.textContent = `پس بده: ${returned.map(color => colors[color]).join("، ")}`;
        row.append(note);
      }
      message.append(row);
    }

    function cardLabel(id) {
      const card = plan.snapshot.graphics.find(item => item.elementId === id);
      if (/^drawpile[123]$/.test(id)) return `دستهٔ سطح ${id.at(-1)}`;
      if (!card) {
        const known = plan.snapshot.gameState?.cards.find(item => item.id === id);
        return known?.reserved ? `رزرو خودت · کارت ${id.slice(5)}` : `کارت ${id.slice(5)}`;
      }
      if (card.reserved) return `رزرو خودت · کارت ${id.slice(5)}`;
      const position = plan.snapshot.graphics.filter(item => item.parentId === card.parentId &&
        /^card_\d+$/.test(item.elementId ?? "") && item.x < card.x).length + 1;
      return `سطح ${card.parentId.at(-1)}، کارت ${position} از چپ`;
    }
    const cardItem = id => ({ id, label: cardLabel(id), done: snapshot.selectedCardIds.includes(id) });
    if (advice.buy) addRow("buy", (advice.buy.reserved ? "خرید کارت رزروشده" : "خرید") +
      (advice.buy.earnsNoble ? " · جذب نوبل" : ""), [cardItem(advice.buy.id)]);
    if (advice.reservedBuy && advice.reservedBuy.id !== advice.buy?.id) {
      addRow("reserved-buy", "خرید از رزرو · گزینهٔ دیگر", [cardItem(advice.reservedBuy.id)]);
    }
    if (advice.take) {
      const seen = {};
      addRow("take", "برداشتن ژتون", advice.take.tokens.map(color => {
        seen[color] = (seen[color] ?? 0) + 1;
        return { id: `coinpile_${color}`, label: colors[color], done: picked(color) >= seen[color] };
      }), advice.take.returned);
    }
    const paths = advice.paths.filter(path => plan.snapshot.graphics.some(piece => piece.elementId === path.id));
    if (paths.length || advice.race) {
      const routes = document.createElement("p");
      routes.className = "return";
      const details = [];
      if (advice.race) {
        details.push(`هدف امتیازی: ${advice.race.target}`);
        if (advice.race.discountPriorities?.length) {
          const coverage = advice.race.discountPriorities.map(({ color, appearances }) => `${colors[color]} ${appearances}`);
          details.push(`تعداد نوبل‌ها برای هر تخفیف: ${coverage.join("، ")}`);
        }
        if (advice.race.discountGroups?.length) {
          const groups = advice.race.discountGroups.map(group => group.map(color => colors[color]).join("، "));
          details.push(`اولویت تخفیف: ${groups.join(" ← ")}`);
        }
        const claim = plan.snapshot.gameState?.nobles.find(n => n.id === advice[primary]?.nobleId);
        if (claim) {
          const costs = Object.entries(claim.cost).map(([color, count]) => count + " " + colors[color]);
          details.push("نوبل این نوبت با تخفیف‌های " + costs.join("، "));
        } else if (advice.race.nobleTarget) {
          const needs = Object.entries(advice.race.nobleTarget.needs)
            .map(([color, count]) => `${count} ${colors[color]}`);
          details.push(`تا نوبل هدف: ${needs.join("، ")} کارت تخفیف`);
        }
        if (advice.race.removedTarget) details.push("حریف کارت هدف قبلی را رزرو کرد؛ مسیر دوباره محاسبه شد");
        if (advice.race.immediatePoints > 0 && !advice.race.finishing) {
          details.push(`امتیاز همین نوبت: +${advice.race.immediatePoints}`);
        }
        if (advice.race.finishing) details.push(`امتیاز پس از خرید: ${advice.race.ownNextScore}`);
        if (advice.race.rivalThreat >= 15) details.push(`تهدید قابل‌مشاهدهٔ حریف: ${advice.race.rivalThreat}`);
      }
      if (paths[0]) details.push(`هدف خرید: ${cardLabel(paths[0].id)}`);
      if (paths[1]) details.push(`جایگزین: ${cardLabel(paths[1].id)}`);
      routes.textContent = details.join(" · ");
      message.append(routes);
    }
    if (advice.take?.risk?.length || advice.take?.targetContested || advice.buy?.contested) {
      const note = document.createElement("p");
      note.className = "return";
      const risks = [];
      if (advice.take?.risk?.length) risks.push(`ژتون کمیاب در مسیر خرید: ${advice.take.risk.map(color => colors[color]).join("، ")}`);
      if (advice.take?.targetContested) risks.push(`کارت هدفِ برداشت برای ${advice.take.targetContested} حریف هم قابل خرید است.`);
      if (advice.buy?.contested) risks.push(`کارت خرید برای ${advice.buy.contested} حریف هم قابل خرید است.`);
      note.textContent = risks.join(" · ");
      message.append(note);
    }
    if (advice.reserve) {
      addRow("reserve", advice.reserve.gold ? "رزرو + یک طلا" : "رزرو", [cardItem(advice.reserve.id)], advice.reserve.returned);
    }
    const rivals = (snapshot.rivalEvents ?? []).filter(event => event.playerId !== snapshot.localPlayerId &&
      ["gets", "buys", "reserves"].includes(event.action)).slice(-3).reverse();
    if (rivals.length) {
      const recent = document.createElement("details");
      recent.className = "move";
      recent.open = rivalsExpanded;
      const label = document.createElement("summary");
      label.textContent = "آخرین حرکت‌های دیده‌شدهٔ حریفان";
      recent.append(label);
      const actions = { gets: "گرفت", buys: "خرید", reserves: "رزرو کرد" };
      for (const event of rivals) {
        const player = snapshot.gameState.players.find(item => item.id === event.playerId);
        const line = document.createElement("div");
        line.textContent = [player?.name ?? event.playerId, actions[event.action],
          ...event.icons.map(icon => colors[icon.color])].filter(Boolean).join(" ");
        recent.append(line);
      }
      message.append(recent);
    }
    for (const [id, halo] of halos) {
      if (!visibleHalos.has(id)) {
        halo.remove();
        halos.delete(id);
      }
    }
    if (!message.childNodes.length) message.textContent = "حرکت قابل‌تأییدی پیدا نشد.";
    return true;
  }

  function renderTargets(snapshot, doc, controls, refresh) {
    const choices = ["C", "S", "E", "R", "O"];
    if (controls.dataset.colors !== choices.join("")) {
      controls.dataset.colors = choices.join("");
      controls.replaceChildren();
      for (const color of choices) {
        const label = document.createElement("label");
        label.className = "color-token";
        const radio = document.createElement("input");
        radio.type = "checkbox";
        radio.name = "preferred-colors";
        radio.value = color;
        radio.addEventListener("change", () => {
          preferredColors = preferredColors.includes(color) ? preferredColors.filter(item => item !== color) : [...preferredColors, color].slice(-3);
          if (preferredColors.length > 3) {
            preferredColors = preferredColors.slice(-3);
            radio.checked = false;
            return;
          }
          if (preferredColors.length < 2) {
            preferredColors = choices.slice(0, 2);
          }
          colorChanged = true;
          refresh();
        });
        const preview = spritePreview(doc.getElementById(`coinpile_${color}`), 24);
        const token = preview ?? document.createElement("span");
        if (!preview) token.className = "color-token-disc";
        token.setAttribute("aria-hidden", "true");
        label.append(radio, token, colors[color]);
        label.dataset.color = color;
        controls.append(label);
      }
    }
    for (const radio of controls.querySelectorAll("input")) radio.checked = preferredColors.includes(radio.value);

    const visible = new Set((snapshot.gameState?.nobles ?? []).map(noble => noble.id));
    for (const id of previousNobles) {
      const element = visible.has(id) && doc.getElementById(id);
      if (element) drawHalo(element, false, id, "#ffd166", nobleHalos);
    }
    for (const [id, halo] of nobleHalos) {
      if (!visible.has(id) || !previousNobles.includes(id) || !doc.getElementById(id)?.getClientRects().length) {
        halo.remove();
        nobleHalos.delete(id);
      }
    }
  }

  function drawHalo(element, done, id, highlight, activeHalos = halos) {
    if (!layer) {
      layer = document.createElement("div");
      layer.style.cssText = "pointer-events:none;position:fixed;inset:0;z-index:2147483646";
      document.body.append(layer);
    }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const frame = element.ownerDocument.defaultView.frameElement;
    const bounds = frame?.getBoundingClientRect();
    const sx = bounds && frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
    const sy = bounds && frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
    let halo = activeHalos.get(id);
    if (!halo) {
      halo = document.createElement("div");
      halo.setAttribute("aria-hidden", "true");
      layer.append(halo);
      activeHalos.set(id, halo);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        halo.animate([{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], {
          duration: 1350, iterations: Infinity
        });
      }
    }
    const color = highlight ?? (done ? "#ff596d" : "#ff4ff2");
    halo.style.cssText = `position:absolute;left:${(bounds?.left ?? 0) + rect.left * sx - 8}px;top:${(bounds?.top ?? 0) + rect.top * sy - 8}px;width:${rect.width * sx + 16}px;height:${rect.height * sy + 16}px;box-sizing:border-box;border:4px solid ${color};border-radius:${id.startsWith("coinpile_") ? "50%" : "12px"};box-shadow:0 0 0 2px #26132d,0 0 18px 4px ${color}`;
  }

  function spritePreview(element, width) {
    if (!element) return null;
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !element.offsetWidth || !element.offsetHeight) return null;

    // Preserve the original CSS-pixel sizes and layer positions before scaling.
    const preview = document.createElement("span");
    preview.style.cssText = `display:block;position:relative;width:${width}px;height:${width * rect.height / rect.width}px;overflow:hidden;border-radius:5px`;
    const art = document.createElement("span");
    art.style.cssText = `position:absolute;inset:0 auto auto 0;width:${element.offsetWidth}px;height:${element.offsetHeight}px;transform-origin:top left;transform:scale(${width / element.offsetWidth}, ${width * rect.height / rect.width / element.offsetHeight})`;
    preview.append(art);
    const sx = element.offsetWidth / rect.width;
    const sy = element.offsetHeight / rect.height;
    for (const part of [element, ...element.querySelectorAll("*")]) {
      const style = view.getComputedStyle(part);
      const bounds = part.getBoundingClientRect();
      if (!bounds.width || !bounds.height || style.visibility !== "visible" ||
          !part.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const image = part.tagName === "IMG" && part.currentSrc;
      const sprite = style.backgroundImage !== "none";
      if (!image && !sprite) continue;
      const tile = document.createElement(image ? "img" : "span");
      if (image) {
        tile.src = part.currentSrc;
        tile.alt = "";
        tile.style.objectFit = style.objectFit;
      }
      tile.style.position = "absolute";
      tile.style.left = `${(bounds.left - rect.left) * sx}px`;
      tile.style.top = `${(bounds.top - rect.top) * sy}px`;
      tile.style.width = `${bounds.width * sx}px`;
      tile.style.height = `${bounds.height * sy}px`;
      tile.style.backgroundImage = style.backgroundImage;
      tile.style.backgroundSize = style.backgroundSize;
      tile.style.backgroundPosition = style.backgroundPosition;
      tile.style.backgroundRepeat = style.backgroundRepeat;
      tile.style.borderRadius = style.borderRadius;
      art.append(tile);
    }
    return art.childElementCount ? preview : null;
  }

  return { render, renderTargets, reset, clearTarget: () => { previousNobles = []; recommended = []; preferredColors = []; colorChanged = false; preferredTarget = null; previousBuy = null; } };
};
