globalThis.splendorDirectory = async (handle) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("splendor-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("settings", handle ? "readwrite" : "readonly");
      const store = transaction.objectStore("settings");
      const request = handle ? store.put(handle, "directory") : store.get("directory");
      transaction.oncomplete = () => resolve(handle ?? request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
};
