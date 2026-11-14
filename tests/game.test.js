import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { aiController } from "../src/core/ai.js";
import { Game } from "../src/core/game.js";
import { arena } from "./support/helpers.js";

/** A scripted "human" for player 0: the same commands at the same ticks every run. */
function scripted(game) {
  const hq = game.owned(0, (e) => e.type === "hq")[0];
  const units = game.owned(0, (e) => e.kind === "unit").map((e) => e.id);
  return (tick) => {
    if (tick === 5) game.command(0, { type: "build", item: "power" });
    if (tick === 200) game.command(0, { type: "place", tx: hq.tx + 4, ty: hq.ty });
    if (tick === 210) game.command(0, { type: "build", item: "refinery" });
    if (tick === 300) game.command(0, { type: "move", ids: units, x: 24.5, y: 24.5, attackMove: true });
    if (tick === 500) game.command(0, { type: "place", tx: hq.tx, ty: hq.ty + 4 });
  };
}

function play(seed, ticks) {
  const game = new Game({ seed, size: 48, controllers: [null, aiController("normal")] });
  const script = scripted(game);
  const hashes = [];
  for (let t = 0; t < ticks; t += 1) {
    script(game.tick);
    game.step();
    if (game.tick % 250 === 0) hashes.push(game.hash());
  }
  return hashes;
}

describe("determinism (NFR-3)", () => {
  it("same seed + same commands → identical state hashes, tick for tick", () => {
    const a = play(11, 3000);
    const b = play(11, 3000);
    assert.equal(a.length, 12);
    assert.deepEqual(a, b);
  });

  it("a different seed gives a different game", () => {
    assert.notDeepEqual(play(11, 1000), play(12, 1000));
  });

  it("AI vs AI replays identically", () => {
    const run = () => {
      const game = new Game({ seed: 5, size: 48, controllers: [aiController("hard"), aiController("easy")] });
      game.run(20 * 60 * 3);
      return game.hash();
    };
    assert.equal(run(), run());
  });
});

describe("command validation", () => {
  it("cannot command the other player's units or attack your own", () => {
    const game = arena();
    const mine = game.spawn(0, "tank", 5.5, 5.5);
    const theirs = game.spawn(1, "tank", 8.5, 5.5);
    game.refreshVision();
    assert.equal(game.command(0, { type: "move", ids: [theirs.id], x: 1, y: 1 }).ok, false);
    assert.equal(game.command(0, { type: "attack", ids: [mine.id], target: mine.id }).ok, false);
    assert.equal(game.command(0, { type: "dance" }).ok, false);
    assert.equal(game.command(0, { type: "move", ids: [mine.id], x: NaN, y: 1 }).ok, false);
    assert.equal(game.command(0, { type: "harvest", ids: [mine.id] }).ok, false, "only harvesters harvest");
  });

  it("a fresh skirmish starts with an HQ and the starting squad for both players", () => {
    const game = new Game({ seed: 2, size: 48 });
    for (const id of [0, 1]) {
      assert.equal(game.count(id, "hq"), 1);
      assert.equal(game.owned(id, (e) => e.kind === "unit").length, 4);
      assert.equal(game.players[id].credits, 3000);
    }
  });
});

describe("original IP only (NFR-9)", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|html|css)$/.test(name)) files.push(path);
    }
  };
  walk("src");
  files.push("index.html");
  it("no names from the Command & Conquer / Red Alert franchise in the game", () => {
    const banned = ["Red Alert", "Command & Conquer", "Westwood", "Soviet", "Allies", "Allied", "Tanya", "Tesla", "Kirov", "Chrono", "Mammoth", "Yuri", "Báo Động Đỏ"];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const name of banned) assert.equal(text.includes(name), false, `${name} in ${file}`);
    }
  });
});
