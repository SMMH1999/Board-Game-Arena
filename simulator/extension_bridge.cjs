const path = require("node:path");
const readline = require("node:readline");

require(path.join(__dirname, "../splendor-reader/forecast.js"));
require(path.join(__dirname, "../splendor-reader/advice.js"));

const requests = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
requests.on("line", (line) => {
  try {
    const { snapshot, preferred } = JSON.parse(line);
    const advice = globalThis.splendorAdvice(snapshot, preferred);
    process.stdout.write(JSON.stringify({ advice }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error) }) + "\n");
  }
});
