const input = document.querySelector("#directory");
const status = document.querySelector("#status");
input.addEventListener("change", async () => {
  const strategies = [];
  let skipped = 0;
  for (const file of input.files) {
    if (!file.name.toLowerCase().endsWith(".json")) continue;
    try {
      if (file.size > 100000 || strategies.length >= 30) throw new Error();
      const definition = JSON.parse(await file.text());
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error();
      strategies.push({ name: file.webkitRelativePath || file.name, definition });
    } catch {
      skipped++;
    }
  }
  if (!strategies.length) {
    status.textContent = "فایل JSON قابل‌خواندن پیدا نشد.";
    return;
  }
  try {
    await chrome.storage.local.set({ splendorStrategies: strategies });
    status.textContent = `${strategies.length} راهبرد بارگذاری شد · ${skipped} فایل کنار گذاشته شد.`;
  } catch {
    status.textContent = "ذخیرهٔ راهبردها ممکن نشد.";
  }
});
