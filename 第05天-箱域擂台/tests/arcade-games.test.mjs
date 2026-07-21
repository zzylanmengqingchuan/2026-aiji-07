import assert from "node:assert/strict";
import test from "node:test";
import { createSokobanState, moveSokoban } from "../app/game/sokoban.ts";
import {
  createPoolBalls,
  launchCueBall,
  predictRailPath,
  RAIL,
  BALL_RADIUS,
  stepPoolPhysics,
} from "../app/game/billiards.ts";

test("推箱子可以移动并保留撤回所需的不可变状态", () => {
  const state = createSokobanState(0);
  const moved = moveSokoban(state, "left");
  assert.notEqual(moved, state);
  assert.equal(state.moves, 0);
  assert.equal(moved.moves, 1);
});

test("推箱子不能把箱子推入墙体", () => {
  const state = { ...createSokobanState(0), player: { row: 1, col: 2 }, boxes: [{ row: 1, col: 1 }] };
  assert.equal(moveSokoban(state, "left"), state);
});

test("台球开杆会按照瞄准角度获得速度", () => {
  const balls = launchCueBall(createPoolBalls(), Math.PI / 2, 0.5);
  const cue = balls.find((ball) => ball.cue);
  assert.ok(Math.abs(cue.vx) < 0.001);
  assert.ok(cue.vy > 0);
});

test("台球碰库后会反弹", () => {
  const cue = createPoolBalls()[0];
  cue.x = RAIL + BALL_RADIUS + 1;
  cue.vx = -300;
  const result = stepPoolPhysics([cue], 0.02);
  assert.ok(result.balls[0].vx > 0);
  assert.ok(result.collisions > 0);
});

test("台球落袋后从桌面移除", () => {
  const cue = createPoolBalls()[0];
  cue.x = RAIL;
  cue.y = RAIL;
  const result = stepPoolPhysics([cue], 0.016);
  assert.deepEqual(result.sunkIds, [0]);
  assert.equal(result.balls[0].sunk, true);
});

test("预测轨迹会画出碰库后的多段线路", () => {
  const path = predictRailPath({ x: 270, y: 260 }, -0.55, 2);
  assert.equal(path.length, 4);
  assert.ok(path.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});
