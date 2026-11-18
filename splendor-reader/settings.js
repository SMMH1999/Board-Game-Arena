const status = document.querySelector("#status");
const restore = document.querySelector("#restore");
let directory;

async function showStatus() {
  if (!directory) {
    status.textContent = "هنوز پوشه‌ای ثبت نشده است.";
    restore.hidden = true;
    return;
  }
  const granted = await directory.queryPermission({ mode: "readwrite" }) === "granted";
  restore.hidden = granted;
  status.textContent = granted
    ? `پوشهٔ «${directory.name}» فعال است.`
    : `پوشهٔ «${directory.name}» ثبت شده و برای نوشتن به تأیید مرورگر نیاز دارد.`;
}

document.querySelector("#choose").addEventListener("click", async () => {
  try {
    const selected = await window.showDirectoryPicker({
      id: "splendor-archive",
      startIn: "desktop",
      mode: "readwrite"
    });
    directory = await splendorDirectory(selected);
    await showStatus();
  } catch (error) {
    if (error.name !== "AbortError") status.textContent = "ثبت پوشه ممکن نشد.";
  }
});

restore.addEventListener("click", async () => {
  try {
    await directory.requestPermission({ mode: "readwrite" });
    await showStatus();
  } catch {
    status.textContent = "فعال‌کردن دسترسی پوشه ممکن نشد.";
  }
});

splendorDirectory().then(handle => {
  directory = handle;
  return showStatus();
}).catch(() => { status.textContent = "تنظیمات پوشه قابل خواندن نیست."; });
