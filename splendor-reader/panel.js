globalThis.manageSplendorPanel = (host, panel, handle, grip) => {
  let drag;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  function fit(left, top, width, height) {
    const maxWidth = Math.max(1, window.innerWidth - 16);
    const maxHeight = Math.max(1, window.innerHeight - 16);
    width = clamp(width, Math.min(240, maxWidth), maxWidth);
    height = clamp(height, Math.min(160, maxHeight), maxHeight);
    Object.assign(host.style, {
      right: "auto", bottom: "auto",
      left: `${clamp(left, 8, Math.max(8, window.innerWidth - width - 8))}px`,
      top: `${clamp(top, 8, Math.max(8, window.innerHeight - height - 8))}px`
    });
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.maxHeight = "none";
  }
  for (const [element, resize] of [[handle, false], [grip, true]]) {
    element.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button") && !resize) return;
      const rect = panel.getBoundingClientRect();
      drag = { rect, x: event.clientX, y: event.clientY, id: event.pointerId };
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    element.addEventListener("pointermove", event => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const { left, top, width, height } = drag.rect;
      fit(left + (resize ? 0 : dx), top + (resize ? 0 : dy),
        width + (resize ? dx : 0), height + (resize ? dy : 0));
    });
    element.addEventListener("lostpointercapture", () => { drag = undefined; });
  }
  const onResize = () => {
    if (!panel.style.height) return;
    const { left, top, width, height } = panel.getBoundingClientRect();
    fit(left, top, width, height);
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
};
