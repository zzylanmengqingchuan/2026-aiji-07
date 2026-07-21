export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 520;
export const RAIL = 42;
export const BALL_RADIUS = 13;
export const POCKET_RADIUS = 25;

export type PoolBall = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  stripe?: boolean;
  cue?: boolean;
  sunk: boolean;
};

export type PoolPoint = { x: number; y: number };

export const POCKETS: PoolPoint[] = [
  { x: RAIL, y: RAIL },
  { x: TABLE_WIDTH / 2, y: RAIL - 4 },
  { x: TABLE_WIDTH - RAIL, y: RAIL },
  { x: RAIL, y: TABLE_HEIGHT - RAIL },
  { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT - RAIL + 4 },
  { x: TABLE_WIDTH - RAIL, y: TABLE_HEIGHT - RAIL },
];

const COLORS = ["#f5cf35", "#2f65d9", "#e54b3f", "#7b48b7", "#ef812d", "#2f9368", "#862d35"];

export function createPoolBalls(): PoolBall[] {
  const balls: PoolBall[] = [{ id: 0, x: 270, y: TABLE_HEIGHT / 2, vx: 0, vy: 0, color: "#f7f5ec", cue: true, sunk: false }];
  let id = 1;
  const rackX = 690;
  for (let row = 0; row < 4; row += 1) {
    for (let index = 0; index <= row; index += 1) {
      balls.push({
        id,
        x: rackX + row * BALL_RADIUS * 1.78,
        y: TABLE_HEIGHT / 2 + (index - row / 2) * BALL_RADIUS * 2.05,
        vx: 0,
        vy: 0,
        color: COLORS[(id - 1) % COLORS.length],
        stripe: id > 5,
        sunk: false,
      });
      id += 1;
    }
  }
  return balls;
}

export function launchCueBall(balls: PoolBall[], angle: number, power: number) {
  const speed = 330 + Math.max(0, Math.min(1, power)) * 760;
  return balls.map((ball) => ball.cue && !ball.sunk ? { ...ball, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed } : ball);
}

export function poolIsMoving(balls: PoolBall[]) {
  return balls.some((ball) => !ball.sunk && Math.hypot(ball.vx, ball.vy) > 5);
}

export function stepPoolPhysics(input: PoolBall[], dt: number) {
  const balls = input.map((ball) => ({ ...ball }));
  const sunkIds: number[] = [];
  let collisions = 0;
  const step = Math.min(dt, 1 / 30);

  for (const ball of balls) {
    if (ball.sunk) continue;
    ball.x += ball.vx * step;
    ball.y += ball.vy * step;
    const friction = Math.pow(0.985, step * 60);
    ball.vx *= friction;
    ball.vy *= friction;
    if (Math.hypot(ball.vx, ball.vy) < 4) { ball.vx = 0; ball.vy = 0; }

    const pocket = POCKETS.find((item) => Math.hypot(ball.x - item.x, ball.y - item.y) < POCKET_RADIUS);
    if (pocket) {
      ball.sunk = true;
      ball.vx = 0;
      ball.vy = 0;
      sunkIds.push(ball.id);
      continue;
    }

    const minX = RAIL + BALL_RADIUS;
    const maxX = TABLE_WIDTH - RAIL - BALL_RADIUS;
    const minY = RAIL + BALL_RADIUS;
    const maxY = TABLE_HEIGHT - RAIL - BALL_RADIUS;
    if (ball.x < minX) { ball.x = minX; ball.vx = Math.abs(ball.vx) * 0.88; collisions += 1; }
    if (ball.x > maxX) { ball.x = maxX; ball.vx = -Math.abs(ball.vx) * 0.88; collisions += 1; }
    if (ball.y < minY) { ball.y = minY; ball.vy = Math.abs(ball.vy) * 0.88; collisions += 1; }
    if (ball.y > maxY) { ball.y = maxY; ball.vy = -Math.abs(ball.vy) * 0.88; collisions += 1; }
  }

  for (let first = 0; first < balls.length; first += 1) {
    const a = balls[first];
    if (a.sunk) continue;
    for (let second = first + 1; second < balls.length; second += 1) {
      const b = balls[second];
      if (b.sunk) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 0 || distance >= BALL_RADIUS * 2) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = BALL_RADIUS * 2 - distance;
      a.x -= nx * overlap / 2;
      a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2;
      b.y += ny * overlap / 2;
      const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (relative > 0) {
        const impulse = relative * 0.96;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }
      collisions += 1;
    }
  }

  return { balls, sunkIds, collisions, moving: poolIsMoving(balls) };
}

export function respotCueBall(balls: PoolBall[]) {
  return balls.map((ball) => ball.cue ? { ...ball, x: 270, y: TABLE_HEIGHT / 2, vx: 0, vy: 0, sunk: false } : ball);
}

export function predictRailPath(origin: PoolPoint, angle: number, maxBounces = 2): PoolPoint[] {
  const points = [{ ...origin }];
  let current = { ...origin };
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const minX = RAIL + BALL_RADIUS;
  const maxX = TABLE_WIDTH - RAIL - BALL_RADIUS;
  const minY = RAIL + BALL_RADIUS;
  const maxY = TABLE_HEIGHT - RAIL - BALL_RADIUS;
  for (let bounce = 0; bounce <= maxBounces; bounce += 1) {
    const tx = dx > 0 ? (maxX - current.x) / dx : dx < 0 ? (minX - current.x) / dx : Infinity;
    const ty = dy > 0 ? (maxY - current.y) / dy : dy < 0 ? (minY - current.y) / dy : Infinity;
    const distance = Math.min(tx, ty);
    if (!Number.isFinite(distance) || distance <= 0) break;
    current = { x: current.x + dx * distance, y: current.y + dy * distance };
    points.push(current);
    if (Math.abs(tx - distance) < 0.001) dx *= -1;
    if (Math.abs(ty - distance) < 0.001) dy *= -1;
  }
  return points;
}
