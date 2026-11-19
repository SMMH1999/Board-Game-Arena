const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const spec = require("../strategies/splendor_strategy_codex.json");

test("loads the packaged profile, an archive profile and a compatible imported override", async () => {
  let archive, imported;
  const ctx = vm.createContext({
    fetch: async url => ({ ok: url === "strategies/splendor_strategy_codex.json", json: async () => spec }),
    chrome: { runtime: { getURL: path => path }, storage: { local: { get: async () => ({
      splendorStrategies: imported ? [{ definition: imported }] : []
    }) } } },
    splendorDirectory: async () => ({
      queryPermission: async () => "granted",
      getDirectoryHandle: async () => ({ getFileHandle: async () => ({
        getFile: async () => ({ size: 100, text: async () => JSON.stringify(archive) })
      }) })
    })
  });
  vm.runInContext(fs.readFileSync(require.resolve("../strategy-loader.js"),"utf8"),ctx);
  assert.equal((await ctx.loadSplendorStrategy()).source,"bundled");
  archive = { ...spec, tuning: { goldSpent: 0.6 } };
  assert.equal((await ctx.loadSplendorStrategy()).tuning.goldSpent,0.6);
  imported = { ...spec, tuning: { goldSpent: 0.8 } };
  assert.equal((await ctx.loadSplendorStrategy()).source,"imported");
  imported = { ...spec, rules: {} };
  assert.equal((await ctx.loadSplendorStrategy()).source,"archive");
});
