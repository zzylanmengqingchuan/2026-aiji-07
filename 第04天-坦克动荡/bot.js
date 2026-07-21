// 服务端内置 AI 车长：每 tick 为 bot 玩家计算输入 {mx,mz,aimX,aimZ,fire}
// 台球桌版定制：waypoint 巡逻 + 库边镜像反弹瞄准 + 致命弹闪避
// 难度参数集中在下方，调"简单/困难"只改数字即可
const A = 55; // 战场半宽（与 server.js 一致）

const CFG = {
  WAYPOINT_MARGIN: 8, // 巡逻点离墙最小距离
  WP_MIN_S: 2.0, // 换巡逻点最小间隔（秒）
  WP_MAX_S: 4.0, // 换巡逻点最大间隔（秒）
  WP_ARRIVE: 3.0, // 到位判定半径
  AIM_ERROR_RAD: 0.07, // 瞄准随机误差（±4°，让它会打丢）
  FIRE_GAP: 0.55, // 两次开火最小间隔（秒）
  REAIM_S: [1.0, 2.0], // 重新选墙瞄准的间隔范围（秒）
  DODGE_R: 4.0, // 闪避判定半径（单位）
  DODGE_T: 1.2, // 闪避预判窗口（秒）
  BULLET_SPEED: 60, // 与服务端 FIRE_SPEED 一致
};

const rand = (a, b) => a + Math.random() * (b - a);
const hypot = Math.hypot;

// 把对手位置按指定墙做镜像：瞄准镜像点 → 弹道撞墙反射后直奔对手（入射角=反射角）
function mirrorAim(bot, foe) {
  const walls = [
    { key: 'x+', f: (p) => ({ x: 2 * A - p.x, z: p.z }) },
    { key: 'x-', f: (p) => ({ x: -2 * A - p.x, z: p.z }) },
    { key: 'z+', f: (p) => ({ x: p.x, z: 2 * A - p.z }) },
    { key: 'z-', f: (p) => ({ x: p.x, z: -2 * A - p.z }) },
  ];
  // 选镜像点离自己最远的一面墙（弹道更长更像台球，也避免贴脸墙导致出膛即弹）
  let best = null;
  for (const w of walls) {
    const m = w.f(foe);
    const d = hypot(m.x - bot.x, m.z - bot.z);
    if (!best || d > best.d) best = { m, d };
  }
  // 加瞄准误差：绕自己旋转一个小角度
  const ang = Math.atan2(best.m.x - bot.x, best.m.z - bot.z) + rand(-CFG.AIM_ERROR_RAD, CFG.AIM_ERROR_RAD);
  return { x: bot.x + Math.sin(ang) * best.d, z: bot.z + Math.cos(ang) * best.d };
}

function pickWaypoint(bot) {
  bot._wp = {
    x: rand(-A + CFG.WAYPOINT_MARGIN, A - CFG.WAYPOINT_MARGIN),
    z: rand(-A + CFG.WAYPOINT_MARGIN, A - CFG.WAYPOINT_MARGIN),
    until: bot._now + rand(CFG.WP_MIN_S, CFG.WP_MAX_S),
  };
}

// 致命弹（已反弹）闪避：预判 DODGE_T 秒内最近距离，小于 DODGE_R 就垂直侧移
function dodgeVector(bot, bullets) {
  for (const b of bullets) {
    if ((b.bounces || 0) < 1) continue;
    const rx = bot.x - b.x, rz = bot.z - b.z;
    const vx = b.dx * CFG.BULLET_SPEED, vz = b.dz * CFG.BULLET_SPEED;
    const t = Math.max(0, Math.min(CFG.DODGE_T, (rx * vx + rz * vz) / (CFG.BULLET_SPEED * CFG.BULLET_SPEED)));
    const cx = b.x + vx * t, cz = b.z + vz * t;
    if (hypot(bot.x - cx, bot.z - cz) < CFG.DODGE_R) {
      // 垂直于弹道方向，选离墙远的一侧
      const s1 = { x: -b.dz, z: b.dx };
      const side = (bot.x * s1.x + bot.z * s1.z) > 0 ? 1 : -1;
      return { mx: s1.x * side, mz: s1.z * side };
    }
  }
  return null;
}

// 主入口：server 每 tick 调用一次，dt 秒
function computeBotInput(room, bot, dt) {
  bot._now = (bot._now || 0) + dt;
  bot._nextReaim = bot._nextReaim ?? 0;
  bot._lastFire = bot._lastFire ?? -9;
  bot._aim = bot._aim || { x: 0, z: 0 };

  const foe = [...room.players.values()].find((p) => p.id !== bot.id && p.alive && !p.waitingNextRound);
  const input = { mx: 0, mz: 0, aimX: bot._aim.x, aimZ: bot._aim.z, fire: false };

  // —— 移动：闪避优先，其次 waypoint 巡逻 ——
  const dodge = dodgeVector(bot, room.bullets || []);
  if (dodge) {
    input.mx = dodge.mx;
    input.mz = dodge.mz;
  } else {
    if (!bot._wp || bot._now > bot._wp.until || hypot(bot._wp.x - bot.x, bot._wp.z - bot.z) < CFG.WP_ARRIVE) {
      pickWaypoint(bot);
    }
    const dx = bot._wp.x - bot.x, dz = bot._wp.z - bot.z;
    const d = hypot(dx, dz) || 1;
    input.mx = dx / d;
    input.mz = dz / d;
  }

  // —— 瞄准与开火：对手存活才打，库边镜像反弹 ——
  if (foe) {
    if (bot._now >= bot._nextReaim) {
      bot._aim = mirrorAim(bot, foe);
      bot._nextReaim = bot._now + rand(CFG.REAIM_S[0], CFG.REAIM_S[1]);
    }
    input.aimX = bot._aim.x;
    input.aimZ = bot._aim.z;
    if ((bot.fireCd || 0) <= 0 && bot._now - bot._lastFire >= CFG.FIRE_GAP) {
      input.fire = true;
      bot._lastFire = bot._now;
    }
  }

  bot.input = input;
}

module.exports = { computeBotInput, CFG };
