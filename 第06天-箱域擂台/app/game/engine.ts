export const FIELD_WIDTH = 960;
export const FIELD_HEIGHT = 560;

export type Vec = { x: number; y: number };
export type BodyKind = "pusher" | "crate";

export type Body = Vec & {
  id: string;
  kind: BodyKind;
  vx: number;
  vy: number;
  radius: number;
  sunk: boolean;
};

export type Hole = Vec & { radius: number };

export type Level = {
  number: number;
  name: string;
  hint: string;
  bodies: Body[];
  holes: Hole[];
};

export type PhysicsResult = {
  bodies: Body[];
  sunkIds: string[];
  collisions: number;
  moving: boolean;
};

type LevelTemplate = {
  name: string;
  hint: string;
  pusher: Vec;
  crates: Vec[];
  holes: Hole[];
};

const LEVELS: LevelTemplate[] = [
  {
    name: "第一推",
    hint: "对准箱群中心，感受一次连锁。",
    pusher: { x: 112, y: 280 },
    crates: [{ x: 410, y: 280 }, { x: 474, y: 280 }, { x: 538, y: 280 }],
    holes: [{ x: 830, y: 280, radius: 78 }],
  },
  {
    name: "错位阵",
    hint: "瞄准两个箱子的接缝。",
    pusher: { x: 118, y: 280 },
    crates: [{ x: 408, y: 260 }, { x: 466, y: 300 }],
    holes: [{ x: 828, y: 280, radius: 76 }],
  },
  {
    name: "斜着来",
    hint: "方向比蛮力更重要。",
    pusher: { x: 130, y: 390 },
    crates: [{ x: 420, y: 326 }, { x: 486, y: 286 }, { x: 552, y: 246 }],
    holes: [{ x: 822, y: 142, radius: 73 }],
  },
  {
    name: "挤一挤",
    hint: "从侧面切入，箱子会自己找路。",
    pusher: { x: 126, y: 170 },
    crates: [{ x: 496, y: 282 }, { x: 562, y: 344 }],
    holes: [{ x: 820, y: 424, radius: 72 }],
  },
  {
    name: "一窝端",
    hint: "找准角度，一下可以清空全部。",
    pusher: { x: 118, y: 280 },
    crates: [{ x: 420, y: 245 }, { x: 420, y: 315 }, { x: 482, y: 280 }],
    holes: [{ x: 830, y: 280, radius: 76 }],
  },
  {
    name: "擦边球",
    hint: "别急着满力，轻一点也许更准。",
    pusher: { x: 132, y: 420 },
    crates: [{ x: 488, y: 310 }, { x: 556, y: 270 }],
    holes: [{ x: 814, y: 126, radius: 68 }],
  },
];

const makeBody = (id: string, kind: BodyKind, point: Vec): Body => ({
  id,
  kind,
  ...point,
  vx: 0,
  vy: 0,
  radius: kind === "pusher" ? 31 : 27,
  sunk: false,
});

export function createLevel(number = 1): Level {
  const template = LEVELS[(number - 1) % LEVELS.length];
  const cycle = Math.floor((number - 1) / LEVELS.length);
  const holeScale = Math.max(0.76, 1 - cycle * 0.055);
  return {
    number,
    name: template.name,
    hint: cycle === 0 ? template.hint : "洞口变小了，但你已经更准了。",
    bodies: [
      makeBody("pusher", "pusher", template.pusher),
      ...template.crates.map((point, index) => makeBody(`crate-${number}-${index}`, "crate", point)),
    ],
    holes: template.holes.map((hole) => ({ ...hole, radius: hole.radius * holeScale })),
  };
}

export function powerFromHold(heldMs: number) {
  return Math.max(0.08, Math.min(1, heldMs / 1350));
}

export function launchPusher(bodies: Body[], angle: number, power: number) {
  const speed = 330 + Math.max(0, Math.min(1, power)) * 770;
  return bodies.map((body) => body.kind === "pusher"
    ? { ...body, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }
    : { ...body });
}

function distance(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function stepPhysics(input: Body[], holes: Hole[], dt: number): PhysicsResult {
  const seconds = Math.min(0.034, Math.max(0.001, dt));
  const bodies = input.map((body) => ({ ...body }));
  const sunkIds: string[] = [];
  let collisions = 0;

  for (const body of bodies) {
    if (body.sunk) continue;
    body.x += body.vx * seconds;
    body.y += body.vy * seconds;
    const friction = Math.pow(0.986, seconds * 60);
    body.vx *= friction;
    body.vy *= friction;

    if (body.x < body.radius) {
      body.x = body.radius;
      body.vx = Math.abs(body.vx) * 0.78;
      collisions += 1;
    } else if (body.x > FIELD_WIDTH - body.radius) {
      body.x = FIELD_WIDTH - body.radius;
      body.vx = -Math.abs(body.vx) * 0.78;
      collisions += 1;
    }
    if (body.y < body.radius) {
      body.y = body.radius;
      body.vy = Math.abs(body.vy) * 0.78;
      collisions += 1;
    } else if (body.y > FIELD_HEIGHT - body.radius) {
      body.y = FIELD_HEIGHT - body.radius;
      body.vy = -Math.abs(body.vy) * 0.78;
      collisions += 1;
    }
  }

  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    if (a.sunk) continue;
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      if (b.sunk) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDistance = a.radius + b.radius;
      const actualDistance = Math.hypot(dx, dy);
      if (actualDistance >= minDistance || actualDistance === 0) continue;

      const nx = dx / actualDistance;
      const ny = dy / actualDistance;
      const overlap = minDistance - actualDistance;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const inverseMassA = a.kind === "pusher" ? 0.16 : 1;
        const inverseMassB = b.kind === "pusher" ? 0.16 : 1;
        const restitution = a.kind === "pusher" || b.kind === "pusher" ? 0.78 : 0.34;
        const impulse = -((1 + restitution) * relative) / (inverseMassA + inverseMassB);
        a.vx -= impulse * inverseMassA * nx;
        a.vy -= impulse * inverseMassA * ny;
        b.vx += impulse * inverseMassB * nx;
        b.vy += impulse * inverseMassB * ny;
        collisions += 1;
      }
    }
  }

  for (const body of bodies) {
    if (body.kind !== "crate" || body.sunk) continue;
    const hole = holes.find((target) => distance(body, target) < target.radius - body.radius * 0.18);
    if (!hole) continue;
    body.sunk = true;
    body.x = hole.x;
    body.y = hole.y;
    body.vx = 0;
    body.vy = 0;
    sunkIds.push(body.id);
  }

  const moving = bodies.some((body) => !body.sunk && Math.hypot(body.vx, body.vy) > 10);
  return { bodies, sunkIds, collisions, moving };
}

export function countCrates(bodies: Body[]) {
  return bodies.filter((body) => body.kind === "crate").length;
}

export function countSunk(bodies: Body[]) {
  return bodies.filter((body) => body.kind === "crate" && body.sunk).length;
}
