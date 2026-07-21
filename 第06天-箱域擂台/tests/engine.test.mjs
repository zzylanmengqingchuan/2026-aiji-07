import assert from "node:assert/strict";
import test from "node:test";
import {
  countCrates,
  countSunk,
  createLevel,
  launchPusher,
  powerFromHold,
  stepPhysics,
} from "../app/game/engine.ts";

test("每一关只有一种普通箱子和一个推动者", () => {
  const level = createLevel(1);
  assert.equal(level.bodies.filter((body) => body.kind === "pusher").length, 1);
  assert.ok(countCrates(level.bodies) >= 3);
  assert.ok(level.bodies.filter((body) => body.kind === "crate").every((body) => body.radius === 27));
});

test("蓄力时间会映射到有限力度", () => {
  assert.equal(powerFromHold(0), 0.08);
  assert.ok(powerFromHold(600) > powerFromHold(200));
  assert.equal(powerFromHold(5000), 1);
});

test("松手后推动者按照瞄准方向运动", () => {
  const level = createLevel(1);
  const launched = launchPusher(level.bodies, Math.PI / 4, 0.6);
  const pusher = launched.find((body) => body.kind === "pusher");
  assert.ok(pusher.vx > 0);
  assert.ok(pusher.vy > 0);
});

test("推动者撞击箱子后会传递速度", () => {
  const bodies = [
    { id: "pusher", kind: "pusher", x: 100, y: 100, vx: 400, vy: 0, radius: 31, sunk: false },
    { id: "crate", kind: "crate", x: 155, y: 100, vx: 0, vy: 0, radius: 27, sunk: false },
  ];
  const result = stepPhysics(bodies, [], 0.016);
  assert.ok(result.collisions > 0);
  assert.ok(result.bodies[1].vx > 0);
});

test("箱子进入洞口后会被计为进洞", () => {
  const bodies = [{ id: "crate", kind: "crate", x: 500, y: 280, vx: 0, vy: 0, radius: 27, sunk: false }];
  const result = stepPhysics(bodies, [{ x: 500, y: 280, radius: 70 }], 0.016);
  assert.deepEqual(result.sunkIds, ["crate"]);
  assert.equal(countSunk(result.bodies), 1);
});

test("循环关卡会逐渐缩小洞口", () => {
  const first = createLevel(1);
  const later = createLevel(7);
  assert.equal(first.name, later.name);
  assert.ok(later.holes[0].radius < first.holes[0].radius);
});
