import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { damageFor, UNITS, WARHEADS } from "../src/core/rules.js";
import { arena, runUntil, seconds } from "./support/helpers.js";

describe("damage model (FR-7, FR-8)", () => {
  it("every warhead has a multiplier for every armour class", () => {
    for (const table of Object.values(WARHEADS)) assert.deepEqual(Object.keys(table).sort(), ["building", "heavy", "light", "none"]);
    assert.equal(damageFor(UNITS.rifle.weapon, "heavy"), 1.5);
    assert.equal(damageFor(UNITS.rocket.weapon, "heavy"), 40);
    assert.equal(damageFor(UNITS.rocket.weapon, "none"), 10);
  });

  it("every unit has complete stats", () => {
    for (const [id, u] of Object.entries(UNITS)) {
      for (const key of ["name", "category", "cost", "time", "hp", "speed", "sight", "armor", "radius"]) assert.ok(u[key] !== undefined, `${id}.${key}`);
      if (u.weapon) for (const key of ["damage", "range", "reload", "warhead"]) assert.ok(u.weapon[key] !== undefined, `${id}.weapon.${key}`);
    }
  });
});

describe("combat behaviour (FR-8)", () => {
  it("idle units open fire on enemies that come into range", () => {
    const game = arena();
    const rifle = game.spawn(0, "rifle", 10.5, 10.5);
    const enemy = game.spawn(1, "rifle", 13.5, 10.5);
    game.refreshVision();
    seconds(game, 2);
    assert.ok(rifle.hp < rifle.maxHp && enemy.hp < enemy.maxHp);
  });

  it("projectiles take time to fly; instant weapons hit at once", () => {
    const game = arena();
    const rocket = game.spawn(0, "rocket", 10.5, 10.5);
    const tank = game.spawn(1, "tank", 14.5, 10.5);
    tank.order = { type: "hold", fire: false }; // a non-idle, non-moving order: it will not fight back
    game.refreshVision();
    game.command(0, { type: "attack", ids: [rocket.id], target: tank.id });
    let fireTick = 0;
    let hitTick = 0;
    for (let i = 0; i < 60 && !hitTick; i += 1) {
      game.step();
      for (const e of game.takeEvents()) {
        if (e.type === "fire" && !fireTick) fireTick = game.tick;
        if (e.type === "impact" && !hitTick) hitTick = game.tick;
      }
    }
    assert.ok(fireTick && hitTick > fireTick + 3, `fired ${fireTick}, hit ${hitTick}`);
    assert.equal(tank.hp, tank.maxHp - 40);
  });

  it("artillery has a minimum range and splash that spares friends", () => {
    const game = arena({ width: 50, height: 30 });
    const art = game.spawn(0, "artillery", 5.5, 15.5);
    const close = game.spawn(1, "rifle", 7.5, 15.5);
    close.order = { type: "hold", fire: false };
    game.refreshVision();
    game.command(0, { type: "attack", ids: [art.id], target: close.id });
    // It must back off first, and never fire while the target is inside its minimum range.
    let fired = 0;
    for (let i = 0; i < 20 * 4; i += 1) {
      game.step();
      for (const e of game.takeEvents()) {
        if (e.type !== "fire") continue;
        fired += 1;
        assert.ok(game.distanceTo(art.x, art.y, close) >= UNITS.artillery.weapon.minRange - 1e-9, "fired inside minimum range");
      }
    }
    assert.ok(fired >= 1, "fired once it had backed off");
    assert.ok(Math.hypot(art.x - close.x, art.y - close.y) > 3, "backed away");

    const g2 = arena({ width: 50, height: 30 });
    const a2 = g2.spawn(0, "artillery", 5.5, 15.5);
    const cluster = [g2.spawn(1, "rifle", 13.5, 15.5), g2.spawn(1, "rifle", 13.5, 16.3), g2.spawn(1, "rifle", 14.3, 15.5)];
    const friend = g2.spawn(0, "rifle", 13.5, 14.6);
    for (const u of [...cluster, friend]) u.order = { type: "hold", fire: false };
    g2.spawn(0, "scout", 11.5, 15.5).order = { type: "hold", fire: false }; // spotter
    g2.refreshVision();
    g2.command(0, { type: "attack", ids: [a2.id], target: cluster[0].id });
    runUntil(g2, () => g2.takeEvents().some((e) => e.type === "impact"), 10);
    const hurt = cluster.filter((u) => u.hp < u.maxHp).length;
    assert.ok(hurt >= 2, `splash hit ${hurt} of 3`);
    assert.equal(friend.hp, friend.maxHp, "no friendly fire");
  });

  it("move ignores enemies; attack-move fights on the way", () => {
    const run = (attackMove) => {
      const game = arena({ width: 40, height: 20 });
      const tank = game.spawn(0, "tank", 3.5, 10.5);
      const enemy = game.spawn(1, "rifle", 20.5, 13.5);
      enemy.order = { type: "hold", fire: false };
      game.refreshVision();
      game.command(0, { type: "move", ids: [tank.id], x: 36.5, y: 10.5, attackMove });
      seconds(game, 14);
      return { enemyHurt: enemy.hp < enemy.maxHp || enemy.hp <= 0, tank };
    };
    assert.equal(run(false).enemyHurt, false);
    assert.equal(run(true).enemyHurt, true);
  });

  it("cannot attack what you cannot see (fog of war)", () => {
    const game = arena({ width: 60, height: 20 });
    const tank = game.spawn(0, "tank", 3.5, 10.5);
    const far = game.spawn(1, "tank", 50.5, 10.5);
    game.refreshVision();
    assert.equal(game.command(0, { type: "attack", ids: [tank.id], target: far.id }).ok, false);
  });

  it("turrets defend, and go offline without power", () => {
    const powered = arena();
    powered.spawnBuilding(0, "turret", 10, 10);
    powered.spawnBuilding(0, "power", 2, 2);
    const t1 = powered.spawn(1, "tank", 14.5, 10.5);
    t1.order = { type: "hold", fire: false };
    powered.refreshVision();
    seconds(powered, 3);
    assert.ok(t1.hp < t1.maxHp);

    const dark = arena();
    dark.spawnBuilding(0, "turret", 10, 10); // -25 power, nothing produced
    const t2 = dark.spawn(1, "tank", 14.5, 10.5);
    t2.order = { type: "hold", fire: false };
    dark.refreshVision();
    assert.equal(dark.lowPower(0), true);
    seconds(dark, 3);
    assert.equal(t2.hp, t2.maxHp);
  });

  it("units hit while idle fight back against a visible shooter", () => {
    const game = arena();
    const victim = game.spawn(0, "tank", 10.5, 10.5);
    const shooter = game.spawn(1, "rocket", 15, 10.5);
    game.refreshVision();
    game.command(1, { type: "attack", ids: [shooter.id], target: victim.id });
    seconds(game, 8);
    assert.ok(shooter.hp < shooter.maxHp, "the tank answered");
  });
});

describe("victory (FR-14)", () => {
  it("a player with nothing left is defeated and the game ends", () => {
    const game = arena();
    const tank = game.spawn(0, "tank", 10.5, 10.5);
    const rifle = game.spawn(1, "rifle", 13.5, 10.5);
    game.refreshVision();
    game.command(0, { type: "attack", ids: [tank.id], target: rifle.id });
    runUntil(game, () => game.over, 30);
    assert.equal(game.over, true);
    assert.equal(game.winner, 0);
    assert.equal(game.players[1].defeated, true);
    assert.equal(game.players[0].stats.killed, 1);
    assert.equal(game.command(0, { type: "stop", ids: [tank.id] }).ok, false);
  });
});
