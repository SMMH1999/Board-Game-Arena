const input = document.querySelector("#directory");
const status = document.querySelector("#status");
input.addEventListener("change", async () => {
  const bundled = await bundledStrategy();
  const strategies = [];
  let skipped = 0;
  for (const file of input.files) {
    if (!file.name.toLowerCase().endsWith(".json")) continue;
    try {
      if (file.size > 100000 || strategies.length >= 30) throw new Error();
      const definition = JSON.parse(await file.text());
      if (!compatibleStrategy(definition, bundled)) throw new Error();
      strategies.push({ name: file.webkitRelativePath || file.name, definition });
    } catch {
      skipped++;
    }
  }
  if (!strategies.length) {
    status.textContent = "راهبرد سازگار با نسخهٔ اقتصاد بهینه در این پوشه پیدا نشد.";
    return;
  }
  try {
    await chrome.storage.local.set({ splendorStrategies: strategies });
    status.textContent = `${strategies.length} راهبرد بارگذاری شد · ${skipped} فایل کنار گذاشته شد.`;
  } catch {
    status.textContent = "ذخیرهٔ راهبردها ممکن نشد.";
  }
});
