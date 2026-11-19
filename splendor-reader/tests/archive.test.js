const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function contextFor(file, overrides) {
  const listeners = { addListener() {} };
  const context = vm.createContext({
    console, importScripts() {},
    chrome: { runtime: { onInstalled: listeners, onMessage: listeners } },
    ...overrides
  });
  vm.runInContext(fs.readFileSync(require.resolve(`../${file}`), "utf8"), context);
  return context;
}

test("classifies wins, losses, ambiguous ties, and in-progress games for the local player", async () => {
  let payload;
  const { createSplendorArchive } = contextFor("session.js", {
    chrome: { runtime: { sendMessage: async ({ data }) => { payload = data; return { saved: true }; } } }
  });
  const record = async (turnText, points) => {
    const session = createSplendorArchive("test-session");
    const players = ["Mine", "Rival"].map((name, index) => ({ id: name, name, score: points[index] }));
    session.observe({
      localPlayerId: "Mine", move: 1, turnText, counters: [],
      gameState: { events: [], cards: [], nobles: [], players }
    });
    await session.flush(true);
    return payload.result;
  };

  assert.equal((await record("You must play", [16, 10])).outcome, "in_progress");
  assert.equal((await record("End of game : Mine wins", [15, 15])).outcome, "win");
  assert.equal((await record("End of game : Rival wins", [15, 15])).outcome, "loss");
  assert.equal((await record("Game over", [15, 15])).outcome, "unknown");
  assert.equal((await record("Game over: draw", [15, 15])).outcome, "draw");
  assert.equal((await record("End of game", [15, 12])).outcome, "win");
  assert.equal((await record("End of game", [8, 4])).outcome, "unknown");
});

test("commits the classified archive before removing the in-progress copy", async () => {
  const files = new Map();
  const missing = () => Object.assign(new Error(), { name: "NotFoundError" });
  let failWrite = false;

  function directory(path) {
    return {
      queryPermission: async () => "granted",
      async getDirectoryHandle(name, { create } = {}) {
        const prefix = `${path}${name}/`;
        if (!create && !Array.from(files.keys()).some(file => file.startsWith(prefix))) throw missing();
        return directory(prefix);
      },
      async getFileHandle(name, { create } = {}) {
        const key = path + name;
        if (!create && !files.has(key)) throw missing();
        return {
          getFile: async () => ({ text: async () => files.get(key) }),
          createWritable: async () => {
            let contents;
            return {
              write: async data => { contents = data; },
              close: async () => {
                if (failWrite) throw new Error("disk error");
                files.set(key, contents);
              },
              abort: async () => {}
            };
          }
        };
      },
      async removeEntry(name) {
        files.delete(path + name);
      }
    };
  }

  const { save } = contextFor("archive.js", { splendorDirectory: async () => directory("") });
  const session = "test-session";
  const data = { session, timeline: [] };
  const staging = "games/in-progress/test-session/game.json";
  const final = "games/wins/test-session/game.json";
  await save(session, data);
  assert.ok(files.has(staging));
  const result = { finished: true, outcome: "win" };
  failWrite = true;
  await assert.rejects(save(session, { ...data, result }), /disk error/);
  assert.ok(files.has(staging));
  assert.ok(!files.has(final));

  failWrite = false;
  await save(session, { ...data, result });
  assert.ok(!files.has(staging));
  assert.equal(JSON.parse(files.get(final)).result.outcome, "win");
  await save(session, { ...data, result });
  assert.deepEqual([...files.keys()], [final]);
});
