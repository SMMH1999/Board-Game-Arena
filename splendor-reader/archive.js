chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== "splendor-save" || !sender.tab ||
      !/^[a-zA-Z0-9-]+$/.test(message.session) || !/^\d{6}$/.test(message.batch)) return;
  const folder = `Splendor-Reader/games/${message.session}`;
  const data = JSON.stringify(message.data);
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  chrome.downloads.download({
    url: `data:application/json;base64,${btoa(binary)}`,
    filename: `${folder}/events-${message.batch}.json`,
    conflictAction: "overwrite",
    saveAs: false
  }).then(() => respond({ saved: true }), error => respond({ saved: false, error: error.message }));
  return true;
});
