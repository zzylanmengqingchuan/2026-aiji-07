/**
 * Tank Trouble 式 1v1 反弹坦克对战服务端（台球桌版）
 * 规则：
 * - 1v1：满 2 人自动开局；仅入房玩家/用户 Agent 互打，无系统 AI 兵
 * - 人机对战：create / POST /rooms 传 vsBot:true，入座后立即补 1 名系统 AI 车长（kind=bot，bot.js 决策）
 * - 空旷台球桌：±55 战场 + 四周边框墙（库边），无任何迷宫墙/房屋；固定对角出生点 (±38, ±38)
 * - 直射无效：炮弹必须先撞过墙面（外框墙）至少 1 次才有杀伤力，未反弹的炮弹直接穿过坦克
 * - 每人每把 3 血；被致命炮弹击中 -1，包括被自己反弹的炮弹击中
 * - 血尽死亡，对方 +1 分（自杀同样对方 +1）；死一个即把结束
 * - 先拿 5 分者赢整场；单把上限 60s，超时双方不得分进下一把
 * - 比分 4:4 后下一把为决胜把
 * - 炮弹：每人同屏最多 3 发；CD 0.32s；每发最多反弹 8 次，存活 6 秒
 * - countdown 期间全场冻结，倒计时结束双方同时开打
 * - Agent：REST /api/v1/* + WebSocket；保留人类网页
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { computeBotInput } = require('./bot.js'); // 系统 AI 车长决策：每 tick 改写 bot.input

const PORT = process.env.PORT || 3100;
// 对战 20Hz；大厅更低频，省带宽
const TICK_HZ = 20;
const LOBBY_HZ = 8;
const DT = 1 / TICK_HZ;
const r2 = (n) => Math.round(n * 100) / 100;
const A = 55; // 战场半宽
const MAX_PLAYERS = 2; // 1v1
const MIN_PLAYERS = 2;
const PLAYER_SPEED = 16;
const PLAYER_ACCEL = 7.5;
const PLAYER_BRAKE = 9;
const PLAYER_MAX_HP = 3; // 每把 3 血，被打 3 下出局
const FIRE_DMG = 1; // 每发子弹 = 1 血
const FIRE_SPEED = 60;
const FIRE_CD = 0.32;
const MAX_ACTIVE_BULLETS = 5; // 每人同屏最多 5 发活跃弹（超出时挤掉最早一发，开火不阻塞）
const MAX_BOUNCES = 8; // 每发最多反弹 8 次
const BULLET_LIFE = 6; // 子弹存活秒数
const BULLET_R = 0.2; // 子弹半径（撞墙判定用）
const MUZZLE_PROTECT = 0.5; // owner 出膛保护秒数，防止开炮瞬间自爆
const HIT_R = 1.7;
// 坦克物理碰撞半径：车模宽约 3.8、长约 4.7，用前后双圆（半径 1.8）贴合真实车体（子弹命中判定仍用 HIT_R 保持手感）
const TANK_R = 1.8;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 60;
const WIN_SCORE = Number(process.env.WIN_SCORE) || 5; // 先拿 N 分赢整场
const ROUND_BREAK_SECONDS = Number(process.env.ROUND_BREAK_SECONDS) || 4;
const COUNTDOWN_SECONDS = Number(process.env.COUNTDOWN_SECONDS) || 3;
// action 端点限流：每 playerId 每秒最多 30 次
const ACTION_RATE_LIMIT = 30;

// 与前端程序化色板保持一致：低饱和军绿、陶土橙、钢蓝、赭金。
const COLORS = [0x4f8d5c, 0xd85c41, 0x4f78a8, 0xd6aa3d];
const COLOR_NAMES = ['军绿', '陶土橙', '钢蓝', '赭金'];
// 台球桌版固定对角出生点；出生朝向在 resetPlayersForRound 里按点位算（面向场地中心）
const DEFAULT_SPAWNS = [
  { x: -38, z: -38 },
  { x: 38, z: 38 },
];

// 可被坦克撞飞的轻型木箱。它们只提供动态反馈，不参与射线遮挡和胜负判定，
// 因此不会改变既有对战平衡；位置与旋转仍由服务端同步，所有客户端看到一致结果。
const CRATE_SPAWNS = [
  [-10, -4], [12, 9], [-33, 18], [33, -16],
  [-7, 34], [24, 31], [-35, -23], [5, -36],
];

function freshCrates() {
  return CRATE_SPAWNS.map(([x, z], i) => ({
    id: `crate-${i + 1}`,
    kind: 'crate',
    x,
    y: 0.75,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: (i * 0.73) % (Math.PI * 2),
    rz: 0,
    vrx: 0,
    vry: 0,
    vrz: 0,
    hitCd: 0,
  }));
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function hypot(x, z) {
  return Math.sqrt(x * x + z * z);
}
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}
function collideObstacles(p, r, walls, hit) {
  // hit（可选）：回传碰撞推挤方向（单位法线），供撞击事件使用
  let nx = 0, nz = 0;
  const px = clamp(p.x, -A + r, A - r);
  if (px !== p.x) nx = px > p.x ? 1 : -1;
  p.x = px;
  const pz = clamp(p.z, -A + r, A - r);
  if (pz !== p.z) nz = pz > p.z ? 1 : -1;
  p.z = pz;
  for (const o of walls) {
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const gapX = o.hw + r;
    const gapZ = o.hd + r;
    if (Math.abs(dx) < gapX && Math.abs(dz) < gapZ) {
      const penX = gapX - Math.abs(dx);
      const penZ = gapZ - Math.abs(dz);
      if (penX < penZ) { p.x = o.x + (dx >= 0 ? 1 : -1) * gapX; nx = dx >= 0 ? 1 : -1; nz = 0; }
      else { p.z = o.z + (dz >= 0 ? 1 : -1) * gapZ; nz = dz >= 0 ? 1 : -1; nx = 0; }
    }
  }
  if (hit && (nx || nz)) {
    const l = hypot(nx, nz);
    hit.nx = nx / l;
    hit.nz = nz / l;
  }
  return p;
}

// 坦克车体近似为前后两个圆（半径 TANK_R、间距 TANK_OFF*2）：
// 车头/车尾都不允许陷入墙壁或障碍物，解决单圆碰撞导致的车角视觉穿插。
// 修正方向取自陷入更深的那个采样圆（整份推挤一次施加），避免前后圆交替修正造成抖动。
const TANK_OFF = 1.2;
function collideTank(p, yaw, walls, hit) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const hits = [{}, {}];
  const outs = [];
  for (const s of [1, -1]) {
    const i = s === 1 ? 0 : 1;
    const pt = { x: p.x + fx * TANK_OFF * s, z: p.z + fz * TANK_OFF * s };
    collideObstacles(pt, TANK_R, walls, hits[i]);
    outs.push({ dx: pt.x - (p.x + fx * TANK_OFF * s), dz: pt.z - (p.z + fz * TANK_OFF * s) });
  }
  const pen0 = hypot(outs[0].dx, outs[0].dz);
  const pen1 = hypot(outs[1].dx, outs[1].dz);
  const worst = pen0 >= pen1 ? 0 : 1;
  if (pen0 > 0 || pen1 > 0) {
    p.x += outs[worst].dx;
    p.z += outs[worst].dz;
    p.x = clamp(p.x, -A + 1, A - 1);
    p.z = clamp(p.z, -A + 1, A - 1);
    const src = hits[worst];
    if (hit && src.nx != null) { hit.nx = src.nx; hit.nz = src.nz; }
  }
  return p;
}
function pointInObstacle(x, z, r, walls) {
  if (Math.abs(x) > A - r || Math.abs(z) > A - r) return true;
  for (const o of walls) {
    if (Math.abs(x - o.x) < o.hw + r && Math.abs(z - o.z) < o.hd + r) return true;
  }
  return false;
}

const rooms = new Map(); // code -> Room
const clientRoom = new Map(); // ws -> code
const resultArchive = new Map(); // code -> result
const RESULT_TTL_MS = 30 * 60 * 1000;

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}
function publicBase(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

class Room {
  constructor(code, debugMazeSeed = null) { // debugMazeSeed 保留兼容旧调用，台球桌版忽略
    this.code = code;
    this.createdAt = Date.now();
    this.lastTouchedAt = this.createdAt;
    this.keepEmptyLobby = false;
    this.players = new Map();
    this.order = [];
    this.bullets = [];
    this.powerups = [];
    this.props = freshCrates();
    this.state = 'lobby';
    this.countdown = 0;
    this.hostId = null;
    this.winnerId = null;
    this.powerSpawnT = 8;
    this.tickAcc = 0;
    this.seq = 0;
    this.events = [];
    this.createdAt = Date.now();
    this.startedAt = null;
    this.finishedAt = null;
    this.result = null;
    this.killLog = [];
    this.matchEndReason = null;
    this.nextBulletId = 1;
    this.round = 0; // 当前把数（1 起，无"局"概念，一直打到有人满 WIN_SCORE 分）
    this.roundTimeLeft = ROUND_SECONDS;
    this.roundBreakLeft = 0;
    this.roundHistory = []; // 每把小结
    this.mazeSeed = null; // 台球桌版不再生成迷宫：字段保留但固定 null（兼容旧客户端/调试参数）
    this.walls = []; // 空旷台球桌：永远为空数组（只剩外框墙，由 ±A clamp 碰撞）
    this.spawns = DEFAULT_SPAWNS; // 固定的两个对角出生点
    this.spectators = new Map(); // id -> { id, ws, name }
    this.hostKey = newToken(); // 空房/房主密钥，可用于 start
  }

  fighterCount() {
    return this.players.size;
  }

  /** 观战：不占玩家位、不参与战斗，只收状态 */
  addSpectator(ws, name) {
    const id = 'sp_' + Math.random().toString(36).slice(2, 10);
    const sp = {
      id,
      ws: ws || null,
      name: (name || '观众').slice(0, 16),
      kind: 'spectator',
    };
    this.spectators.set(id, sp);
    return { ok: true, id, spectator: sp };
  }

  removeSpectator(id) {
    this.spectators.delete(id);
  }

  /**
   * 加入选手：
   * - lobby：直接进房；人数≥2 时自动开局
   * - 对局中（countdown/playing/round_break）：进「下一把队列」，本把不参战
   * - finished：拒绝（请再开一场）
   */
  addPlayer(ws, name, opts = {}) {
    if (this.players.size >= MAX_PLAYERS) return { ok: false, err: `房间已满（最多 ${MAX_PLAYERS} 名选手）` };
    if (this.state === 'finished') return { ok: false, err: '本场已结束，请创建新房间' };

    const midMatch =
      this.state === 'playing' ||
      this.state === 'countdown' ||
      this.state === 'round_break';

    const id = Math.random().toString(36).slice(2, 10);
    const token = newToken();
    const slot = this.order.length;
    const spawn = this.spawns[slot % this.spawns.length];
    const kind = opts.kind === 'agent' ? 'agent' : opts.kind === 'bot' ? 'bot' : 'human';
    const waitingNextRound = midMatch; // 中途加入：等下一把
    const p = {
      id,
      token,
      ws: ws || null,
      kind,
      agentId: opts.agentId ? String(opts.agentId).slice(0, 64) : null,
      name: (name || (kind === 'agent' ? 'Agent' : kind === 'bot' ? 'AI 车长' : '玩家')).slice(0, 16),
      color: COLORS[slot % COLORS.length],
      colorName: COLOR_NAMES[slot % COLOR_NAMES.length],
      slot,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      yaw: 0,
      turretYaw: 0,
      aimX: spawn.x,
      aimZ: spawn.z + 1,
      hp: waitingNextRound ? 0 : PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      alive: !waitingNextRound,
      waitingNextRound,
      fireCd: 0,
      shield: 0,
      rapid: 0,
      invuln: 0,
      kills: 0,
      deaths: 0,
      score: 0, // 胜把数（唯一一层积分），先到 WIN_SCORE 赢整场
      input: { mx: 0, mz: 0, aimX: spawn.x, aimZ: spawn.z + 1, fire: false },
      ready: false,
    };
    this.players.set(id, p);
    this.order.push(id);
    if (!this.hostId) this.hostId = id;

    if (waitingNextRound) {
      this.events.push({
        kind: 'banner',
        text: `${p.name} 已加入，下一把参战`,
      });
    }

    // 大厅满 2 人自动开局（不依赖 Agent 调 start）
    let autoStarted = false;
    if (this.state === 'lobby' && this.players.size >= MIN_PLAYERS) {
      const r = this.startMatch(null, null, { system: true });
      autoStarted = !!(r && r.ok);
    }

    return {
      ok: true,
      id,
      token,
      player: p,
      waitingNextRound,
      autoStarted,
      message: waitingNextRound
        ? '已入队，本把观战/等待，下一把自动上场'
        : autoStarted
          ? '人数已达 2，自动开局'
          : '已进入大厅，再等至少 1 人将自动开局',
    };
  }

  /**
   * 加入系统 AI 车长（人机对战）：占一个选手位，ws 恒为 null；
   * 每 tick 由 bot.js 的 computeBotInput 直接改写 input，计分/死亡/战报全走现有逻辑。
   * 加入后满 2 人时同样触发 addPlayer 里的自动开局。
   */
  addBotPlayer() {
    const r = this.addPlayer(null, 'AI 车长', { kind: 'bot' });
    if (!r.ok) return r;
    r.player.isBot = true;
    return r;
  }

  getPlayerAuth(playerId, token) {
    const p = this.players.get(playerId);
    if (!p || p.token !== token) return null;
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) this.hostId = this.order[0] || null;
    this.events.push({ kind: 'banner', text: `${p.name} 离开` });
    this.maybeDestroyRoom();
    if (!rooms.has(this.code)) return;
    // 对局中（含把间）减员：离场视为负，留在场上的选手 +1 并结束本把。
    // 注意"您的对手已逃离战场"banner 要在 endRound 之后推，保证它是最后一条 banner，
    // 客户端顶部醒目提示不会被把结束文案覆盖。
    const inMatch = ['playing', 'countdown', 'round_break'].includes(this.state);
    if (this.state === 'playing' || this.state === 'countdown') {
      const other = [...this.players.values()].find((x) => x.alive && !x.waitingNextRound);
      if (other) other.score = (other.score || 0) + 1;
      this.endRound('leave');
    }
    if (inMatch) {
      this.events.push({ kind: 'opponent_left', name: p.name });
      this.events.push({ kind: 'banner', text: '您的对手已逃离战场' });
    }
    // 大厅不足 2 人：保持等待（不会傻等第三人，只是等人凑齐 2 个再自动开）
  }

  maybeDestroyRoom() {
    // 纯 bot 不撑房：房里只剩系统 AI 车长（没有任何人类/Agent 真实玩家）时同样销毁。
    // 例外：keepEmptyLobby 的「空房+bot」大厅要留着等 Agent join 进来和 bot 打。
    const botOnly =
      this.players.size > 0 && [...this.players.values()].every((p) => p.isBot);
    if ((this.players.size === 0 || botOnly) && this.spectators.size === 0) {
      if (this.keepEmptyLobby && this.state === 'lobby') return;
      if (this.result) {
        resultArchive.set(this.code, { ...this.result, archivedAt: Date.now() });
      }
      rooms.delete(this.code);
    }
  }

  broadcast(msg, exceptId) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (exceptId && p.id === exceptId) continue;
      if (p.ws && p.ws.readyState === 1) {
        try { p.ws.send(data); } catch (err) { console.error(`[${this.code}] 玩家状态发送失败:`, err.message); }
      }
    }
    for (const sp of this.spectators.values()) {
      if (exceptId && sp.id === exceptId) continue;
      if (sp.ws && sp.ws.readyState === 1) {
        try { sp.ws.send(data); } catch (err) { console.error(`[${this.code}] 观战状态发送失败:`, err.message); }
      }
    }
  }

  /** full=true 时附带 arena 信息；walls 固定空数组、mazeSeed 固定 null（台球桌版，字段保留兼容） */
  snapshot(full = false) {
    const inGame =
      this.state === 'playing' ||
      this.state === 'countdown' ||
      this.state === 'round_break';
    const snap = {
      type: 'state',
      seq: this.seq,
      code: this.code,
      phase: this.state,
      countdown: this.state === 'countdown' ? Math.ceil(this.countdown) : 0,
      hostId: this.hostId,
      winnerId: this.winnerId,
      t: Date.now(),
      rules: {
        maxHp: PLAYER_MAX_HP,
        winScore: WIN_SCORE,
        roundSeconds: ROUND_SECONDS,
        maxActiveBullets: MAX_ACTIVE_BULLETS,
        maxBounces: MAX_BOUNCES,
        bulletLife: BULLET_LIFE,
        fireCd: FIRE_CD,
        ricochet: true, // 炮弹撞边框墙镜面反弹，含自伤
        directHitNoKill: true, // 直射无效：反弹 >=1 次的炮弹才有杀伤力
        noSystemBots: true,
      },
      round: this.round,
      roundTimeLeft: r2(Math.max(0, this.roundTimeLeft)),
      roundBreakLeft: r2(Math.max(0, this.roundBreakLeft)),
      roundHistory: this.roundHistory,
      mazeSeed: this.mazeSeed,
      walls: this.walls,
      players: [...this.players.values()].map((p) => {
        const base = {
          id: p.id,
          name: p.name,
          kind: p.kind || 'human',
          agentId: p.agentId || null,
          color: p.color,
          colorName: p.colorName,
          slot: p.slot,
          x: r2(p.x),
          z: r2(p.z),
          vx: r2(p.vx || 0),
          vz: r2(p.vz || 0),
          speed: r2(hypot(p.vx || 0, p.vz || 0)),
          yaw: r2(p.yaw),
          turretYaw: r2(p.turretYaw),
          hp: Math.round(p.hp),
          maxHp: p.maxHp,
          alive: p.alive,
          waitingNextRound: !!p.waitingNextRound,
          kills: p.kills,
          deaths: p.deaths || 0,
          score: p.score || 0,
        };
        if (inGame) {
          base.shield = r2(p.shield);
          base.rapid = r2(p.rapid);
          base.invuln = r2(p.invuln);
        }
        return base;
      }),
      bullets: this.state === 'playing' || this.state === 'countdown'
        ? this.bullets.map((b) => ({
            id: b.id,
            x: r2(b.x),
            y: 1.4,
            z: r2(b.z),
            dx: r2(b.dx),
            dz: r2(b.dz),
            bounces: b.bounces,
            owner: b.ownerId,
            color: b.color,
          }))
        : [],
      powerups: [], // 新规则下无系统补给，避免干扰积分
      props: this.props.map((p) => ({
        id: p.id,
        kind: p.kind,
        x: r2(p.x),
        y: r2(p.y),
        z: r2(p.z),
        rx: r2(p.rx),
        ry: r2(p.ry),
        rz: r2(p.rz),
      })),
      events: this.events.splice(0, this.events.length),
      result: this.state === 'finished' ? this.result : null,
      spectatorCount: this.spectators.size,
    };
    if (full) {
      snap.arena = A;
    }
    return snap;
  }

  /** Agent 观测：带 you / 可行动作说明 */
  observation(forPlayerId) {
    const snap = this.snapshot(false);
    const you = forPlayerId ? this.players.get(forPlayerId) : null;
    return {
      ...snap,
      arena: A,
      you: you
        ? {
            id: you.id,
            name: you.name,
            kind: you.kind,
            x: r2(you.x),
            z: r2(you.z),
            vx: r2(you.vx || 0),
            vz: r2(you.vz || 0),
            speed: r2(hypot(you.vx || 0, you.vz || 0)),
            yaw: r2(you.yaw),
            turretYaw: r2(you.turretYaw),
            hp: Math.round(you.hp),
            maxHp: you.maxHp,
            alive: you.alive,
            waitingNextRound: !!you.waitingNextRound,
            kills: you.kills,
            score: you.score || 0,
            shield: r2(you.shield),
            rapid: r2(you.rapid),
            invuln: r2(you.invuln),
            fireCd: r2(you.fireCd),
          }
        : null,
      actionSpace: {
        mx: '[-1,1] 左右移动，+1 为 +X（键 D）',
        mz: '[-1,1] 前后移动，-1 为 -Z（键 W 前进）',
        aimX: '瞄准点世界坐标 X',
        aimZ: '瞄准点世界坐标 Z',
        fire: 'boolean 是否开火',
      },
      killLog: this.killLog.slice(-20),
    };
  }

  /** 每一把开始：空旷台球桌无需生成迷宫，所有选手回固定对角出生点、面向场地中心 */
  resetPlayersForRound() {
    this.walls = [];
    this.spawns = DEFAULT_SPAWNS;
    let i = 0;
    for (const id of this.order) {
      const p = this.players.get(id);
      if (!p) continue;
      const sp = this.spawns[i % this.spawns.length];
      p.x = sp.x;
      p.z = sp.z;
      p.vx = 0;
      p.vz = 0;
      // 出生车体朝向场地中心（炮塔相对车体为 0，瞄准点也放到中心）
      p.yaw = Math.atan2(-sp.x, -sp.z);
      p.turretYaw = 0;
      p.aimX = 0;
      p.aimZ = 0;
      p.hp = PLAYER_MAX_HP;
      p.maxHp = PLAYER_MAX_HP;
      p.alive = true;
      p.waitingNextRound = false;
      p.fireCd = 0;
      p.shield = 0;
      p.rapid = 0;
      p.invuln = 1.5;
      p.input = { mx: 0, mz: 0, aimX: p.aimX, aimZ: p.aimZ, fire: false };
      i++;
    }
    this.bullets = [];
    this.powerups = [];
    this.props = freshCrates();
  }

  /**
   * @param opts.system 系统自动开局（满 2 人），无需权限
   */
  startMatch(byId, hostKey, opts = {}) {
    if (this.state !== 'lobby') return { ok: false, err: '已在对局中' };
    const asSystem = !!(opts && opts.system);
    const asHost = hostKey && hostKey === this.hostKey;
    const asPlayer = byId && this.players.has(byId);
    if (!asSystem && !asHost && !asPlayer) {
      return { ok: false, err: '无权限开始（需要进房选手或 hostKey）' };
    }
    if (this.players.size < MIN_PLAYERS) {
      return { ok: false, err: `至少 ${MIN_PLAYERS} 人才能开局` };
    }

    this.winnerId = null;
    this.result = null;
    this.killLog = [];
    this.matchEndReason = null;
    this.nextBulletId = 1;
    this.roundHistory = [];
    this.startedAt = Date.now();
    this.finishedAt = null;
    for (const p of this.players.values()) {
      p.score = 0;
      p.kills = 0;
      p.deaths = 0;
      p.waitingNextRound = false;
    }
    this.round = 1;
    this.resetPlayersForRound();
    this.state = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.roundTimeLeft = ROUND_SECONDS;
    this.events.push({
      kind: 'banner',
      text: `第 1 把 · ${this.players.size} 人 · 先拿 ${WIN_SCORE} 分赢整场`,
    });
    return { ok: true };
  }

  rematch(byId) {
    if (this.state !== 'finished') return { ok: false, err: '对局未结束' };
    if (byId && !this.players.has(byId)) return { ok: false, err: '玩家不在房间内' };
    this.state = 'lobby';
    this.winnerId = null;
    this.result = null;
    this.killLog = [];
    this.matchEndReason = null;
    this.roundHistory = [];
    this.round = 0;
    this.startedAt = null;
    this.finishedAt = null;
    for (const p of this.players.values()) {
      p.alive = true;
      p.hp = PLAYER_MAX_HP;
      p.maxHp = PLAYER_MAX_HP;
      p.kills = 0;
      p.deaths = 0;
      p.score = 0;
    }
    this.bullets = [];
    this.powerups = [];
    // 再来一场时若仍≥2人，自动开局
    if (this.players.size >= MIN_PLAYERS) {
      return this.startMatch(null, null, { system: true });
    }
    return { ok: true };
  }

  buildBattleReport(rankings) {
    const leader = rankings[0] || null;
    const runnerUp = rankings[1] || null;
    const durationSec = this.startedAt
      ? Math.round(((this.finishedAt || Date.now()) - this.startedAt) / 1000)
      : 0;
    const playerReports = rankings.map((p) => ({
      ...p,
      kd: p.deaths ? r2(p.kills / p.deaths) : p.kills,
    }));
    const endedEarly = this.matchEndReason === 'manual_stop';
    const highlights = [];
    if (leader && runnerUp) {
      highlights.push(
        `${leader.name}以${leader.score}:${runnerUp.score}战胜${runnerUp.name}，先拿${WIN_SCORE}分赢下整场`
      );
      highlights.push(
        `全场共进行${this.roundHistory.length}把，${leader.name}完成${leader.kills}次击毁、被击毁${leader.deaths}次`
      );
      const selfKills = this.killLog.filter((k) => k.selfKill).length;
      if (selfKills > 0) {
        highlights.push(`全场出现${selfKills}次自杀（被自己的反弹弹击中），反弹有风险，开炮需谨慎`);
      }
    }
    if (endedEarly) highlights.push('本场由房主或选手主动提前结束，比分按停止时已结算分数生成');
    const leaveRounds = this.roundHistory.filter((r) => r.reason === 'leave').length;
    if (leaveRounds > 0) {
      highlights.push(`有${leaveRounds}把因对手逃离战场直接结束（离场记负，对方 +1）`);
    }
    return {
      title: `房间 ${this.code} 战斗回顾`,
      headline: leader ? `${leader.name}赢得本场 1v1 对决` : '本场对决结束',
      endReason: this.matchEndReason || 'completed',
      endedEarly,
      durationSec,
      totalRounds: this.roundHistory.length,
      winScore: WIN_SCORE,
      playerReports,
      highlights,
      recap: highlights.join('；') + '。',
    };
  }

  buildMatchResult() {
    const rankings = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        agentId: p.agentId,
        score: p.score || 0,
        kills: p.kills,
        deaths: p.deaths || 0,
        colorName: p.colorName,
      }))
      .sort((a, b) => b.score - a.score || b.kills - a.kills);
    const top = rankings[0] || null;
    const second = rankings[1] || null;
    const report = this.buildBattleReport(rankings);
    return {
      code: this.code,
      phase: 'finished',
      rules: `1v1台球桌反弹坦克：每把${PLAYER_MAX_HP}血；直射无效，炮弹撞墙反弹至少1次后才致命（含自己的反弹弹）；死亡对方+1；先拿${WIN_SCORE}分赢整场；单把${ROUND_SECONDS}s，超时双方不得分；${WIN_SCORE - 1}:${WIN_SCORE - 1}后决胜把`,
      winnerId: top ? top.id : null,
      winnerName: top ? top.name : null,
      winnerKind: top ? top.kind : null,
      winnerAgentId: top ? top.agentId : null,
      rankings,
      roundHistory: this.roundHistory.slice(),
      killLog: this.killLog.slice(),
      endReason: this.matchEndReason || 'completed',
      endedEarly: this.matchEndReason === 'manual_stop',
      report,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt || Date.now(),
      durationSec: this.startedAt
        ? Math.round(((this.finishedAt || Date.now()) - this.startedAt) / 1000)
        : 0,
      summary: top
        ? `${this.matchEndReason === 'manual_stop' ? '比赛提前结束 · ' : ''}胜者：${top.name}（${top.score}:${second ? second.score : 0}，击毁 ${top.kills}）`
        : '无排名',
    };
  }

  finishMatch(reason = 'completed') {
    this.matchEndReason = reason;
    this.state = 'finished';
    this.finishedAt = Date.now();
    this.bullets = [];
    this.result = this.buildMatchResult();
    this.winnerId = this.result.winnerId;
    resultArchive.set(this.code, { ...this.result, archivedAt: Date.now() });
    this.events.push({ kind: 'banner', text: this.result.summary });
    this.events.push({ kind: 'win', result: this.result });
  }

  stopMatch(byId, hostKey) {
    const asHost = hostKey && hostKey === this.hostKey;
    const asPlayer = byId && this.players.has(byId);
    if (!asHost && !asPlayer) return { ok: false, err: '无权限结束比赛' };
    if (!['countdown', 'playing', 'round_break'].includes(this.state)) {
      return { ok: false, err: '当前没有可结束的比赛' };
    }
    if (this.state === 'playing' || this.state === 'countdown') {
      this.endRound('manual_stop', true);
    } else {
      this.finishMatch('manual_stop');
    }
    return { ok: true, phase: this.state, result: this.result };
  }

  /** 结束当前把：唯一死者的对手 +1（含自杀），随后进入把间或整场结束 */
  endRound(reason, forceFinish = false) {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    const fighters = [...this.players.values()].filter((p) => !p.waitingNextRound);
    const dead = fighters.filter((p) => !p.alive);
    const alive = fighters.filter((p) => p.alive);
    // 唯一死者 → 对方 +1；双死 / 超时 / 手动停止 → 双方不得分
    let scorer = null;
    let deadOne = null;
    if (!forceFinish && dead.length === 1 && alive.length === 1) {
      deadOne = dead[0];
      scorer = alive[0];
      scorer.score = (scorer.score || 0) + 1;
    }
    const scoreText = fighters.map((p) => `${p.name} ${p.score || 0}`).join(' : ');
    const summary = {
      round: this.round,
      reason, // kill | leave | time_up | manual_stop
      scorerId: scorer ? scorer.id : null,
      scorerName: scorer ? scorer.name : null,
      deadId: deadOne ? deadOne.id : null,
      deadName: deadOne ? deadOne.name : null,
      scores: fighters.map((p) => ({ id: p.id, name: p.name, score: p.score || 0 })),
    };
    this.roundHistory.push(summary);
    let bannerText;
    if (reason === 'manual_stop') {
      bannerText = `比赛已提前结束 · ${scoreText}`;
    } else if (reason === 'leave') {
      bannerText = `第${this.round}把结束 · 对手已逃离战场（${scoreText}）`;
    } else if (scorer && deadOne) {
      bannerText = `第${this.round}把结束 · ${deadOne.name} 被击毁，${scorer.name} +1（${scoreText}）`;
    } else if (dead.length >= 2) {
      bannerText = `第${this.round}把结束 · 同归于尽，双方不得分（${scoreText}）`;
    } else {
      bannerText = `第${this.round}把结束 · ${ROUND_SECONDS}s 超时，双方不得分（${scoreText}）`;
    }
    this.events.push({ kind: 'banner', text: bannerText });
    this.events.push({ kind: 'round_end', ...summary });

    const matchWinner = fighters.find((p) => (p.score || 0) >= WIN_SCORE);
    if (forceFinish || matchWinner) {
      this.finishMatch(forceFinish ? 'manual_stop' : 'completed');
      return;
    }

    // 平分且都只差一分 → 决胜把
    if (
      fighters.length === 2 &&
      fighters.every((p) => (p.score || 0) === WIN_SCORE - 1)
    ) {
      this.events.push({
        kind: 'banner',
        text: `${WIN_SCORE - 1}:${WIN_SCORE - 1} 平！下一把为决胜把`,
      });
    }

    this.state = 'round_break';
    this.roundBreakLeft = ROUND_BREAK_SECONDS;
    this.bullets = [];
  }

  beginNextRound() {
    // 不足 2 人无法继续：回大厅等人（中途加入的也算人数）
    if (this.players.size < MIN_PLAYERS) {
      this.state = 'lobby';
      this.round = 0;
      this.events.push({
        kind: 'banner',
        text: '人数不足，已回大厅（再满 2 人将自动开局）',
      });
      return;
    }
    this.round += 1;
    this.resetPlayersForRound(); // 回固定对角出生点
    this.state = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.roundTimeLeft = ROUND_SECONDS;
    this.events.push({
      kind: 'banner',
      text: `第 ${this.round} 把 · ${this.players.size} 人 · 对角重生`,
    });
  }

  checkWin() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    // 只统计本把在场（非 waiting）且存活的
    const alive = [...this.players.values()].filter(
      (p) => p.alive && !p.waitingNextRound
    );
    if (alive.length <= 1) {
      this.endRound('kill');
    }
  }

  tick() {
    if (this.state === 'round_break') {
      this.roundBreakLeft -= DT;
      if (this.roundBreakLeft <= 0) this.beginNextRound();
      return;
    }
    if (this.state === 'countdown') {
      // 倒计时期间全场冻结：不能移动、不能开火、bot 也不行动，
      // 倒计时归零双方从同一秒开打（否则 AI 会在人类还被倒计时时抢先开炮）
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.events.push({
          kind: 'banner',
          text: `开战！第${this.round}把 · ${ROUND_SECONDS}s`,
        });
        this.events.push({ kind: 'sfx', name: 'wave' });
      }
      return;
    }
    if (this.state !== 'playing') return;

    // 系统 AI 车长：与真人同规则——只在 playing 阶段计算输入，由下方玩家循环消费
    for (const p of this.players.values()) {
      if (p.isBot) computeBotInput(this, p, DT);
    }
    // 大把倒计时
    this.roundTimeLeft -= DT;
    if (this.roundTimeLeft <= 0) {
      this.roundTimeLeft = 0;
      this.endRound('time_up');
      return;
    }

    // players（排队等下一把的不参战）
    for (const p of this.players.values()) {
      if (!p.alive || p.waitingNextRound) continue;
      p.invuln = Math.max(0, p.invuln - DT);
      p.shield = Math.max(0, p.shield - DT);
      p.rapid = Math.max(0, p.rapid - DT);
      p.fireCd = Math.max(0, p.fireCd - DT);
      p.impactCd = Math.max(0, (p.impactCd || 0) - DT);

      const inp = p.input;
      let mx = inp.mx || 0;
      let mz = inp.mz || 0;
      const len = hypot(mx, mz);
      if (len > 0) {
        mx /= len;
        mz /= len;
        const blend = Math.min(1, PLAYER_ACCEL * DT);
        p.vx += (mx * PLAYER_SPEED - (p.vx || 0)) * blend;
        p.vz += (mz * PLAYER_SPEED - (p.vz || 0)) * blend;
      } else {
        const brake = Math.max(0, 1 - PLAYER_BRAKE * DT);
        p.vx = (p.vx || 0) * brake;
        p.vz = (p.vz || 0) * brake;
        if (hypot(p.vx, p.vz) < 0.05) p.vx = p.vz = 0;
      }

      const expectedX = p.x + (p.vx || 0) * DT;
      const expectedZ = p.z + (p.vz || 0) * DT;
      const wallHit = {};
      const pos = collideTank({ x: expectedX, z: expectedZ }, p.yaw || 0, this.walls, wallHit);
      p.x = pos.x;
      p.z = pos.z;
      // 撞上墙壁/障碍物：记录撞击事件（客户端做火花/凹痕/震屏），速度越大效果越强
      if (wallHit.nx != null && p.impactCd <= 0) {
        const into = Math.abs((p.vx || 0) * wallHit.nx + (p.vz || 0) * wallHit.nz);
        if (into > 3.5) {
          p.impactCd = 0.35;
          this.events.push({
            kind: 'impact', playerId: p.id,
            x: r2(p.x), z: r2(p.z), nx: r2(wallHit.nx), nz: r2(wallHit.nz), speed: r2(into),
          });
        }
      }
      // 被墙推挤后把指向墙内的速度分量清零（不反弹）。老版本 *= -0.12 让速度反向弹跳，
      // 贴墙斜向滑行时每步都"狠狠撞一下"；清零后沿墙滑行顺滑无抖动。
      if (Math.abs(p.x - expectedX) > 0.01) p.vx = 0;
      if (Math.abs(p.z - expectedZ) > 0.01) p.vz = 0;
      const speed = hypot(p.vx || 0, p.vz || 0);
      if (speed > 0.1) {
        const wantYaw = Math.atan2(p.vx, p.vz);
        p.yaw = p.yaw + normAngle(wantYaw - p.yaw) * Math.min(1, (5 + speed * 0.25) * DT);

        // 木箱是轻型动态道具：坦克保持原速度穿过，木箱获得冲量并腾空翻滚。
        for (const prop of this.props) {
          const dx = prop.x - p.x;
          const dz = prop.z - p.z;
          const d = hypot(dx, dz);
          if (d >= 2.9) continue;
          const force = 1 - d / 2.9;
          const driveX = p.vx / Math.max(1, speed);
          const driveZ = p.vz / Math.max(1, speed);
          prop.vx += driveX * (12 + speed * 0.8 + force * 18);
          prop.vz += driveZ * (12 + speed * 0.8 + force * 18);
          prop.vy = Math.max(prop.vy, 3.8 + force * 4.5);
          prop.vrx += -driveZ * (3.5 + force * 4);
          prop.vrz += driveX * (3.5 + force * 4);
          prop.vry += (driveX - driveZ) * 2.8;
          if (prop.hitCd <= 0) {
            prop.hitCd = 0.35;
            this.events.push({
              kind: 'prop_hit',
              id: prop.id,
              propKind: prop.kind,
              x: r2(prop.x),
              y: r2(prop.y),
              z: r2(prop.z),
              speed: r2(Math.hypot(prop.vx, prop.vz)),
              playerId: p.id,
            });
            this.events.push({ kind: 'sfx', name: 'crate', x: r2(prop.x), z: r2(prop.z) });
          }
        }
      }

      p.aimX = inp.aimX;
      p.aimZ = inp.aimZ;
      const want = Math.atan2(p.aimX - p.x, p.aimZ - p.z);
      p.turretYaw = normAngle(want - p.yaw);

      if (inp.fire && p.fireCd <= 0) {
        // 每人同屏最多 MAX_ACTIVE_BULLETS 发；到上限时挤掉自己最早的一发——开火永不卡顿
        const mine = this.bullets.filter((b) => b.ownerId === p.id);
        if (mine.length >= MAX_ACTIVE_BULLETS) {
          const oldest = mine.reduce((a, b) => (b.age > a.age ? b : a));
          this.bullets.splice(this.bullets.indexOf(oldest), 1);
        }
        {
          const dirx = p.aimX - p.x;
          const dirz = p.aimZ - p.z;
          const dlen = Math.max(0.01, hypot(dirx, dirz));
          const dx = dirx / dlen;
          const dz = dirz / dlen;
          // muzzle offset
          const mx0 = p.x + Math.sin(want) * 2.2;
          const mz0 = p.z + Math.cos(want) * 2.2;
          this.bullets.push({
            id: `${p.id}-${this.nextBulletId++}`,
            x: mx0,
            y: 1.4,
            z: mz0,
            dx,
            dz,
            bounces: 0,
            age: 0,
            speed: FIRE_SPEED,
            dmg: FIRE_DMG,
            life: BULLET_LIFE,
            ownerId: p.id,
            color: p.color,
          });
          p.fireCd = FIRE_CD;
          this.events.push({ kind: 'sfx', name: 'shoot', playerId: p.id, x: mx0, z: mz0, dx, dz });
        }
      }
    }

    // 动态道具的轻量刚体积分：重力、地面反弹、摩擦、边界回弹。
    for (const prop of this.props) {
      prop.hitCd = Math.max(0, prop.hitCd - DT);
      prop.x += prop.vx * DT;
      prop.y += prop.vy * DT;
      prop.z += prop.vz * DT;
      prop.rx += prop.vrx * DT;
      prop.ry += prop.vry * DT;
      prop.rz += prop.vrz * DT;
      prop.vy -= 18 * DT;
      if (prop.y < 0.75) {
        prop.y = 0.75;
        if (prop.vy < -1.2) prop.vy *= -0.28;
        else prop.vy = 0;
        prop.vx *= 0.86;
        prop.vz *= 0.86;
        prop.vrx *= 0.8;
        prop.vry *= 0.8;
        prop.vrz *= 0.8;
      } else {
        prop.vx *= 0.992;
        prop.vz *= 0.992;
      }
      if (Math.abs(prop.x) > A - 1) {
        prop.x = clamp(prop.x, -A + 1, A - 1);
        prop.vx *= -0.45;
      }
      if (Math.abs(prop.z) > A - 1) {
        prop.z = clamp(prop.z, -A + 1, A - 1);
        prop.vz *= -0.45;
      }
    }

    // 坦克之间只做软分离（已删除高速对撞同归于尽规则）。
    const arr = [...this.players.values()].filter((p) => p.alive && !p.waitingNextRound);
    let playerDiedThisTick = false;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = hypot(dx, dz);
        const rvx = (a.vx || 0) - (b.vx || 0);
        const rvz = (a.vz || 0) - (b.vz || 0);
        const closingSpeed = d > 0.01 ? Math.abs((rvx * dx + rvz * dz) / d) : hypot(rvx, rvz);
        // 软分离：用前后双圆找最近的一对采样点，沿该方向推开，避免车体角对角穿插
        let sepDx = dx, sepDz = dz, sepD = d;
        const pts = [1, -1];
        for (const sa of pts) {
          const ax = a.x + Math.sin(a.yaw || 0) * TANK_OFF * sa;
          const az = a.z + Math.cos(a.yaw || 0) * TANK_OFF * sa;
          for (const sb of pts) {
            const bx = b.x + Math.sin(b.yaw || 0) * TANK_OFF * sb;
            const bz = b.z + Math.cos(b.yaw || 0) * TANK_OFF * sb;
            const pdx = bx - ax, pdz = bz - az, pd = hypot(pdx, pdz);
            if (pd < sepD) { sepD = pd; sepDx = pdx; sepDz = pdz; }
          }
        }
        const min = TANK_R * 2;
        if (sepD < min && sepD > 0.01) {
          const nx = sepDx / sepD;
          const nz = sepDz / sepD;
          const push = ((min - sepD) / sepD) * 0.5;
          a.x -= sepDx * push;
          a.z -= sepDz * push;
          b.x += sepDx * push;
          b.z += sepDz * push;
          collideTank(a, a.yaw || 0, this.walls);
          collideTank(b, b.yaw || 0, this.walls);
          const aInto = (a.vx || 0) * nx + (a.vz || 0) * nz;
          const bInto = (b.vx || 0) * nx + (b.vz || 0) * nz;
          if (aInto > 0) { a.vx -= nx * aInto * 0.72; a.vz -= nz * aInto * 0.72; }
          if (bInto < 0) { b.vx -= nx * bInto * 0.72; b.vz -= nz * bInto * 0.72; }
          // 剐蹭/碰撞：发撞击事件，双方车体留凹痕
          if (closingSpeed >= 5 && a.impactCd <= 0 && b.impactCd <= 0) {
            a.impactCd = b.impactCd = 0.35;
            this.events.push({
              kind: 'impact', playerIds: [a.id, b.id],
              x: r2((a.x + b.x) / 2), z: r2((a.z + b.z) / 2),
              nx: r2(nx), nz: r2(nz), speed: r2(closingSpeed),
            });
          }
        }
      }
    }

    // bullets：每 tick 拆 2 个子步积分，每子步后做碰撞检测（防高速穿墙）。
    // 撞墙按镜面反射 v' = v - 2(v·n)n，最多反弹 MAX_BOUNCES 次，存活 BULLET_LIFE 秒。
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= DT;
      b.age += DT;
      let dead = b.life <= 0;
      let hitP = null;
      // 坦克命中判定：owner 也参与（自伤），但 owner 有出膛保护防止开炮瞬间自爆。
      // 直射无效：bounces<1 的炮弹没有杀伤力，直接穿过坦克（不掉血、无命中事件）。
      const hitTest = () => {
        if (b.bounces < 1) return null;
        for (const p of this.players.values()) {
          if (!p.alive || p.waitingNextRound) continue;
          if (p.invuln > 0) continue;
          if (p.id === b.ownerId && b.age < MUZZLE_PROTECT) continue;
          if (Math.abs(b.x - p.x) < HIT_R && Math.abs(b.z - p.z) < HIT_R) return p;
        }
        return null;
      };
      for (let sub = 0; sub < 2 && !dead; sub++) {
        const step = b.speed * (DT / 2);
        b.x += b.dx * step;
        b.z += b.dz * step;
        let bounced = false;
        // 外围墙：对应速度分量取反，位置 clamp 回界内一点
        if (Math.abs(b.x) > A || Math.abs(b.z) > A) {
          if (Math.abs(b.x) > A) {
            b.dx = -b.dx;
            b.x = clamp(b.x, -A + 0.3, A - 0.3);
          }
          if (Math.abs(b.z) > A) {
            b.dz = -b.dz;
            b.z = clamp(b.z, -A + 0.3, A - 0.3);
          }
          bounced = true;
        } else {
          // AABB 墙：最小穿透轴即撞击面法线，反射后沿法线推出墙外
          for (const o of this.walls) {
            const odx = b.x - o.x;
            const odz = b.z - o.z;
            const gx = o.hw + BULLET_R;
            const gz = o.hd + BULLET_R;
            if (Math.abs(odx) < gx && Math.abs(odz) < gz) {
              const penX = gx - Math.abs(odx);
              const penZ = gz - Math.abs(odz);
              if (penX < penZ) {
                const nx = odx >= 0 ? 1 : -1; // 法线 (±1,0)
                b.dx = -b.dx;
                b.x = o.x + nx * (gx + 0.05);
              } else {
                const nz = odz >= 0 ? 1 : -1; // 法线 (0,±1)
                b.dz = -b.dz;
                b.z = o.z + nz * (gz + 0.05);
              }
              bounced = true;
              break;
            }
          }
        }
        if (bounced) {
          b.bounces += 1;
          // 反弹事件：前端播音效，Agent 也可据此校正弹道预判
          this.events.push({
            kind: 'ricochet',
            x: r2(b.x),
            z: r2(b.z),
            dx: r2(b.dx),
            dz: r2(b.dz),
            bounces: b.bounces,
            owner: b.ownerId,
          });
          this.events.push({ kind: 'sfx', name: 'ricochet', x: r2(b.x), z: r2(b.z) });
          if (b.bounces > MAX_BOUNCES) { dead = true; break; }
        }
        hitP = hitTest();
        if (hitP) { dead = true; break; }
      }

      if (hitP) {
        const p = hitP;
        const killer = this.players.get(b.ownerId);
        const selfKill = b.ownerId === p.id;
        p.hp -= FIRE_DMG;
        this.events.push({ kind: 'sfx', name: 'phit', x: p.x, z: p.z, color: killer ? killer.color : 0xffffff });
        this.events.push({
          kind: 'hit',
          id: p.id,
          hp: p.hp,
          attackerId: b.ownerId,
          selfKill,
          color: killer ? killer.color : 0xffffff,
          x: p.x,
          z: p.z,
        });
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.deaths = (p.deaths || 0) + 1;
          // 死亡即把结束，对方 +1 在 endRound 统一结算（自杀同样对方 +1）
          if (killer && !selfKill) killer.kills += 1;
          this.killLog.push({
            t: Date.now(),
            killerId: b.ownerId,
            killerName: killer ? killer.name : null,
            victimId: p.id,
            victimName: p.name,
            selfKill,
          });
          this.events.push({
            kind: 'kill',
            victimId: p.id,
            killerId: b.ownerId,
            selfKill,
            x: p.x,
            z: p.z,
          });
          this.events.push({ kind: 'sfx', name: 'boom', x: p.x, z: p.z });
          // 不要在遍历子弹数组时结束本把；endRound 会清空子弹，
          // 过去会令循环下一项读到 undefined 并使整个 Node 进程崩溃。
          playerDiedThisTick = true;
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }

    // 同一服务端 tick 内先结算完所有子弹，再统一判断把结束。
    // 这样双方同时命中时，所有客户端看到的结果也完全一致。
    if (playerDiedThisTick) this.checkWin();

    // 新规则：不刷系统补给（避免干扰对抗）
  }
}

// ---------- HTTP + REST Agent API + WS ----------
const app = express();
app.use(express.json({ limit: '256kb' }));

function applyInput(me, body) {
  if (me.waitingNextRound || !me.alive) {
    me.input.mx = 0;
    me.input.mz = 0;
    me.input.fire = false;
    return;
  }
  me.input.mx = clamp(+body.mx || 0, -1, 1);
  me.input.mz = clamp(+body.mz || 0, -1, 1);
  if (typeof body.aimX === 'number') me.input.aimX = body.aimX;
  if (typeof body.aimZ === 'number') me.input.aimZ = body.aimZ;
  // 兼容 aim: {x,z}
  if (body.aim && typeof body.aim === 'object') {
    if (typeof body.aim.x === 'number') me.input.aimX = body.aim.x;
    if (typeof body.aim.z === 'number') me.input.aimZ = body.aim.z;
  }
  me.input.fire = !!(body.fire || body.shoot);
}

function roomLinks(base, code, playerId, token) {
  const playUrl = `${base}/?room=${encodeURIComponent(code)}&autojoin=1`;
  const spectateUrl = `${base}/?room=${encodeURIComponent(code)}&spectate=1`;
  const docsUrl = `${base}/api/v1/docs`;
  // Agent 负责 start；观战在开战后再看 3D
  const shareText = [
    `【1v1 台球桌反弹坦克】房间号：${code}`,
    `服务器：${base}`,
    ``,
    `把下面整段发给你的 Agent：`,
    `你要作为选手加入 1v1 台球桌反弹坦克对战（不要只观战）。`,
    `服务器 ${base}，房间 ${code}。`,
    `1) POST ${base}/api/v1/rooms/${code}/join`,
    `   {"name":"你的名字","kind":"agent","agentId":"唯一id"}`,
    `2) 保存 playerId、token`,
    `3) 房间满 2 人会【自动开局】，固定对角出生`,
    `4) phase=playing 或 countdown 时循环 GET .../state 与 POST .../action (mx,mz,aimX,aimZ,fire)，action 限流 30 次/秒`,
    `5) 结束后 GET .../result 看比分与战报`,
    `规则：1v1 空旷台球桌；直射无效——炮弹撞墙反弹至少 1 次后才有杀伤力（最多反弹${MAX_BOUNCES}次、存活${BULLET_LIFE}s，含自己的反弹弹）；每把3血；死亡对方+1；先拿${WIN_SCORE}分赢整场；单把${ROUND_SECONDS}s超时双方不得分；每人同屏最多${MAX_ACTIVE_BULLETS}发（超出挤掉最早一发）；countdown 期间全场冻结。`,
    `文档：${docsUrl}`,
  ].join('\n');
  return {
    humanUrl: `${base}/?room=${encodeURIComponent(code)}`,
    humanAutoJoinUrl: playUrl,
    spectateUrl,
    agentDocUrl: docsUrl,
    shareText,
    wsUrl: `${base.replace(/^http/, 'ws')}`,
    stateUrl: playerId
      ? `${base}/api/v1/rooms/${code}/state?playerId=${playerId}&token=${token}`
      : `${base}/api/v1/rooms/${code}/state`,
    actionUrl: `${base}/api/v1/rooms/${code}/action`,
    resultUrl: `${base}/api/v1/rooms/${code}/result`,
  };
}

function createRoomWithPlayer(name, opts, ws) {
  let code;
  do {
    code = roomCode();
  } while (rooms.has(code));
  const room = new Room(code, opts && opts.seed);
  const r = room.addPlayer(ws, name, opts);
  if (!r.ok) return r;
  rooms.set(code, room);
  return { ok: true, room, ...r };
}

app.get('/health', (_req, res) =>
  res.json({ ok: true, rooms: rooms.size, mode: 'agent-ready' })
);

app.get('/api/v1/docs', (_req, res) => {
  res.json({
    name: 'Tank Trouble 1v1 台球桌反弹坦克 Agent API',
    version: '2.1',
    summary:
      `1v1 台球桌反弹坦克对战（空旷 ±55 场地 + 四周边框墙，无迷宫墙/房屋）。直射无效：炮弹撞墙反弹至少 1 次后才致命，最多反弹 ${MAX_BOUNCES} 次、存活 ${BULLET_LIFE} 秒。每把 ${PLAYER_MAX_HP} 血，被致命炮弹击中 -1（包括被自己反弹的炮弹击中）；血尽死亡对方 +1（自杀同样对方 +1）；先拿 ${WIN_SCORE} 分赢整场；单把 ${ROUND_SECONDS}s，超时双方不得分；${WIN_SCORE - 1}:${WIN_SCORE - 1} 后下一把为决胜把。无系统AI兵（人机对战房除外：vsBot:true 时房内会有 1 名系统 AI 车长）。`,
    rules: {
      maxHp: PLAYER_MAX_HP,
      winScore: WIN_SCORE,
      roundSeconds: ROUND_SECONDS,
      scoring: '死亡则对方 +1（含自杀）；超时双方不得分；score 即胜把数',
      countdown: 'countdown 期间全场冻结（不能移动/开火），归零后双方同时开打',
      bullets: {
        maxActive: MAX_ACTIVE_BULLETS,
        fireCd: FIRE_CD,
        maxBounces: MAX_BOUNCES,
        lifeSeconds: BULLET_LIFE,
        directHit: '直射无效：bounces>=1 的炮弹才有杀伤力；未反弹的炮弹穿过坦克，不掉血、无命中事件',
        selfHit: 'owner 也会被自己的弹击中（出膛 0.5s 保护除外），同样要反弹过才致命',
      },
    },
    ricochet: {
      formula: "镜面反射：v' = v - 2(v·n)n，v 为入射方向 (dx,dz)，n 为撞击面单位法线",
      note: '战场是 ±55 的正方形空旷台球桌，walls 固定为空数组；只有四周边框墙（x=±55 / z=±55，即台球桌库边），法线只会是 (±1,0) 或 (0,±1)。',
      agentTip:
        `预判弹道：state.bullets 带 dx,dz（归一化方向）与 bounces。想打对手，必须让炮弹先撞一次边框墙：把墙法线 n 代入上式算 v'，瞄准点取射线与墙的交点即可。直射无效——bounces=0 的炮弹会直接穿过坦克不造成伤害。反弹 ${MAX_BOUNCES} 次或 ${BULLET_LIFE} 秒后子弹消失；小心自己的反弹弹，自杀同样送对方 1 分。`,
    },
    stateFields: {
      walls: '固定为空数组 []（台球桌版无迷宫墙；仅外框墙，由 ±55 边界体现）',
      mazeSeed: '固定 null（本版本不再生成迷宫）',
      'bullets[]': '{id,x,y,z,dx,dz,bounces,owner,color}：dx/dz 归一化方向，bounces 已反弹次数（>=1 才致命），owner 为射手 playerId',
      'players[].score': '胜把数，先到 winScore 赢整场',
    },
    flow: [
      '1. POST /api/v1/rooms 创建（或人类网页创建）；想和系统 AI 对打：body 加 vsBot:true，入座即补 1 名 AI 车长并自动开局',
      '2. 分发 humanUrl / room 码给对手 Agent',
      '3. 各 Agent POST .../join（kind=agent）',
      '4. 满 2 人自动开局（也可任一方 start）',
      '5. phase=playing 时循环 state + action（countdown 为冻结读秒，归零后同时开打）',
      '6. phase=round_break 为把间；finished 后 GET result 看比分与中文战报',
    ],
    endpoints: {
      'POST /api/v1/rooms': {
        body: {
          name: 'string',
          agentId: 'string?',
          kind: 'agent|human',
          vsBot: 'boolean? 传 true 立即加入系统 AI 车长（kind=bot）陪练，满 2 人自动开局；与 empty:true 同传则空房预置 bot 一个位，Agent join 后与 bot 对战',
        },
      },
      'POST /api/v1/rooms/:code/join': { body: { name: 'string', agentId: 'string?', kind: 'agent|human' } },
      'POST /api/v1/rooms/:code/start': { body: { playerId: 'string', token: 'string' } },
      'POST /api/v1/rooms/:code/action': {
        body: {
          playerId: 'string',
          token: 'string',
          mx: 'number -1..1',
          mz: 'number -1..1',
          aimX: 'number',
          aimZ: 'number',
          fire: 'boolean',
        },
        rateLimit: `每 playerId ${ACTION_RATE_LIMIT} 次/秒，超出返回 429`,
      },
      'POST /api/v1/rooms/:code/stop': {
        body: { playerId: 'string?', token: 'string?', hostKey: 'string?' },
        note: '选手或房主可提前结束测试局，并立即生成当前战报',
      },
      'GET /api/v1/rooms/:code/state?playerId&token': '观测（含 you / walls / mazeSeed / bullets）',
      'GET /api/v1/rooms/:code/result': '终局结果（结束后 30 分钟可查）',
      'GET /api/v1/rooms/:code': '房间大厅信息',
    },
    websocket: {
      create: { type: 'create', name: '', kind: 'agent', agentId: '', vsBot: 'boolean? true 则立即补 1 名系统 AI 车长陪练' },
      join: { type: 'join', code: 'XXXX', name: '', kind: 'agent', agentId: '' },
      input: { type: 'input', mx: 0, mz: 0, aimX: 0, aimZ: 0, fire: false },
      start: { type: 'start' },
    },
    coordinate: {
      note: 'XZ 平面，Y 向上。W 键对应 mz=-1（屏幕上方/ -Z）。',
      arenaHalf: A,
    },
  });
});

app.post('/api/v1/rooms', (req, res) => {
  const base = publicBase(req);
  // 空房：给人开 Agent 局（人不占选手位，用 hostKey 开局）
  if (req.body && (req.body.empty || req.body.mode === 'agent_lobby')) {
    let code;
    do {
      code = roomCode();
    } while (rooms.has(code));
    const room = new Room(code, req.body && req.body.seed);
    room.keepEmptyLobby = true;
    // empty + vsBot：空房里预置 1 名系统 AI 车长占一个位，Agent join 进来即满 2 人自动开局
    if (req.body.vsBot) {
      const br = room.addBotPlayer();
      if (!br.ok) return res.status(400).json(br);
    }
    rooms.set(code, room);
    const links = roomLinks(base, code, null, null);
    return res.json({
      ok: true,
      code,
      hostKey: room.hostKey,
      empty: true,
      vsBot: !!req.body.vsBot,
      ...links,
      openSpectateHint: '请立即打开 spectateUrl 观战',
    });
  }
  const name = (req.body && req.body.name) || 'Agent';
  const kind = (req.body && req.body.kind) || 'agent';
  const agentId = req.body && req.body.agentId;
  const r = createRoomWithPlayer(name, { kind, agentId, seed: req.body && req.body.seed }, null);
  if (!r.ok) return res.status(400).json(r);
  // 人机对战：入座后立即补 1 名系统 AI 车长，满 2 人自动开局
  if (req.body && req.body.vsBot) {
    const br = r.room.addBotPlayer();
    if (!br.ok) return res.status(400).json(br);
  }
  const links = roomLinks(base, r.room.code, r.id, r.token);
  res.json({
    ok: true,
    code: r.room.code,
    playerId: r.id,
    token: r.token,
    hostId: r.room.hostId,
    hostKey: r.room.hostKey,
    vsBot: !!(req.body && req.body.vsBot),
    phase: r.room.state,
    players: [...r.room.players.values()].map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    ...links,
    openSpectateHint: '请用户浏览器打开 spectateUrl 即可实时观看 Agent 对战',
  });
});

app.post('/api/v1/rooms/:code/join', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false, err: '房间不存在' });
  const name = (req.body && req.body.name) || 'Agent';
  const kind = (req.body && req.body.kind) || 'agent';
  const agentId = req.body && req.body.agentId;
  const r = room.addPlayer(null, name, { kind, agentId });
  if (!r.ok) return res.status(400).json(r);
  room.broadcast(room.snapshot(false));
  const base = publicBase(req);
  res.json({
    ok: true,
    code,
    playerId: r.id,
    token: r.token,
    hostId: room.hostId,
    ...roomLinks(base, code, r.id, r.token),
  });
});

app.get('/api/v1/rooms/:code', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (!room) {
    const archived = resultArchive.get(code);
    if (archived) return res.json({ ok: true, code, phase: 'finished', result: archived, archived: true });
    return res.status(404).json({ ok: false, err: '房间不存在' });
  }
  room.lastTouchedAt = Date.now();
  res.json({
    ok: true,
    code,
    spectateUrl: roomLinks(publicBase(req), code, null, null).spectateUrl,
    phase: room.state,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      agentId: p.agentId,
      colorName: p.colorName,
    })),
    result: room.result,
  });
});

app.post('/api/v1/rooms/:code/start', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false, err: '房间不存在' });
  const { playerId, token, hostKey } = req.body || {};
  if (hostKey && hostKey === room.hostKey) {
    const r = room.startMatch(null, hostKey);
    if (!r.ok) return res.status(400).json(r);
    room.broadcast(room.snapshot(false));
    return res.json({ ok: true, phase: room.state });
  }
  const me = room.getPlayerAuth(playerId, token);
  if (!me) return res.status(401).json({ ok: false, err: '鉴权失败' });
  const r = room.startMatch(me.id);
  if (!r.ok) return res.status(400).json(r);
  room.broadcast(room.snapshot(false));
  res.json({ ok: true, phase: room.state });
});

// action 端点限流：每 playerId 滑动窗口 1s 内最多 ACTION_RATE_LIMIT 次
const actionRate = new Map(); // playerId -> number[]（时间戳）
function actionRateOk(playerId) {
  const now = Date.now();
  let arr = actionRate.get(playerId);
  if (!arr) {
    arr = [];
    actionRate.set(playerId, arr);
  }
  while (arr.length && now - arr[0] > 1000) arr.shift();
  if (arr.length >= ACTION_RATE_LIMIT) return false;
  arr.push(now);
  if (arr.length === 0) actionRate.delete(playerId);
  return true;
}

app.post('/api/v1/rooms/:code/action', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false, err: '房间不存在' });
  const body = req.body || {};
  const me = room.getPlayerAuth(body.playerId, body.token);
  if (!me) return res.status(401).json({ ok: false, err: '鉴权失败' });
  if (!actionRateOk(me.id)) {
    return res.status(429).json({ ok: false, err: `请求过频（每玩家 ${ACTION_RATE_LIMIT} 次/秒）` });
  }
  if (room.state !== 'playing' && room.state !== 'countdown') {
    return res.status(400).json({ ok: false, err: '对局未开始', phase: room.state });
  }
  if (!me.alive && room.state === 'playing') {
    return res.json({ ok: true, dead: true, phase: room.state });
  }
  applyInput(me, body);
  res.json({ ok: true, phase: room.state });
});

app.post('/api/v1/rooms/:code/stop', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false, err: '房间不存在' });
  const { playerId, token, hostKey } = req.body || {};
  let byId = null;
  if (playerId || token) {
    const me = room.getPlayerAuth(playerId, token);
    if (!me) return res.status(401).json({ ok: false, err: '鉴权失败' });
    byId = me.id;
  }
  const r = room.stopMatch(byId, hostKey);
  if (!r.ok) return res.status(403).json(r);
  room.broadcast(room.snapshot(false));
  res.json(r);
});

app.get('/api/v1/rooms/:code/state', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (!room) {
    const archived = resultArchive.get(code);
    if (archived) return res.json({ ok: true, phase: 'finished', result: archived, archived: true });
    return res.status(404).json({ ok: false, err: '房间不存在' });
  }
  const playerId = req.query.playerId;
  const token = req.query.token;
  if (playerId && token && !room.getPlayerAuth(String(playerId), String(token))) {
    return res.status(401).json({ ok: false, err: '鉴权失败' });
  }
  res.json({ ok: true, ...room.observation(playerId ? String(playerId) : null) });
});

app.get('/api/v1/rooms/:code/result', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (room && room.result) return res.json({ ok: true, result: room.result });
  if (room && room.state !== 'finished') {
    return res.json({ ok: true, finished: false, phase: room.state, result: null });
  }
  const archived = resultArchive.get(code);
  if (archived) return res.json({ ok: true, result: archived, archived: true });
  return res.status(404).json({ ok: false, err: '无结果（房间不存在或尚未结束）' });
});

// 浏览器运行所需资源全部由本站提供，避免校园网/防火墙拦截外部 CDN。
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function send(ws, msg) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (err) { console.error('单连接发送失败:', err.message); }
  }
}

function wsJoinedPayload(room, r, reqHost) {
  const base = reqHost || '';
  const links = roomLinks(
    base || `http://127.0.0.1:${PORT}`,
    room.code,
    r.id,
    r.token
  );
  return {
    type: 'joined',
    id: r.id,
    token: r.token,
    code: room.code,
    hostId: room.hostId,
    kind: r.player ? r.player.kind : 'spectator',
    role: r.player ? 'player' : 'spectator',
    walls: room.walls,
    mazeSeed: room.mazeSeed,
    arena: A,
    tickHz: TICK_HZ,
    shareUrl: `/?room=${room.code}`,
    spectateUrl: `/?room=${room.code}&spectate=1`,
    shareText: links.shareText,
    humanAutoJoinUrl: links.humanAutoJoinUrl,
  };
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'create') {
      const r = createRoomWithPlayer(msg.name, { kind: msg.kind, agentId: msg.agentId, seed: msg.seed }, ws);
      if (!r.ok) return send(ws, { type: 'error', err: r.err });
      // 人机对战：人类入座后立即补 1 名系统 AI 车长，满 2 人触发自动开局
      if (msg.vsBot) {
        const br = r.room.addBotPlayer();
        if (!br.ok) return send(ws, { type: 'error', err: br.err });
      }
      clientRoom.set(ws, r.room.code);
      ws.playerId = r.id;
      ws.role = 'player';
      const base =
        (msg.origin && String(msg.origin).replace(/\/$/, '')) ||
        `http://127.0.0.1:${PORT}`;
      send(ws, wsJoinedPayload(r.room, r, base));
      r.room.broadcast(r.room.snapshot(false));
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.code || '')
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', err: '房间不存在' });
      const r = room.addPlayer(ws, msg.name, { kind: msg.kind, agentId: msg.agentId });
      if (!r.ok) return send(ws, { type: 'error', err: r.err });
      clientRoom.set(ws, code);
      ws.playerId = r.id;
      ws.role = 'player';
      const base =
        (msg.origin && String(msg.origin).replace(/\/$/, '')) ||
        `http://127.0.0.1:${PORT}`;
      send(ws, wsJoinedPayload(room, r, base));
      room.broadcast(room.snapshot(false));
      return;
    }

    if (msg.type === 'spectate') {
      const code = String(msg.code || '')
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', err: '房间不存在' });
      const r = room.addSpectator(ws, msg.name || '观众');
      clientRoom.set(ws, code);
      ws.playerId = r.id;
      ws.role = 'spectator';
      const base =
        (msg.origin && String(msg.origin).replace(/\/$/, '')) ||
        `http://127.0.0.1:${PORT}`;
      const links = roomLinks(base, code, null, null);
      send(ws, {
        type: 'joined',
        id: r.id,
        code,
        hostId: room.hostId,
        role: 'spectator',
        kind: 'spectator',
        walls: room.walls,
        mazeSeed: room.mazeSeed,
        arena: A,
        tickHz: TICK_HZ,
        spectateUrl: links.spectateUrl,
        shareText: links.shareText,
      });
      // 立即推一帧状态供观战渲染
      send(ws, room.snapshot(false));
      return;
    }

    const code = clientRoom.get(ws);
    const room = code && rooms.get(code);
    if (!room) return;

    // 房主观战窗口可提前结束测试局，其余观战操作仍忽略。
    if (ws.role === 'spectator') {
      if (msg.type === 'stop') {
        const r = room.stopMatch(null, msg.hostKey);
        if (!r.ok) return send(ws, { type: 'error', err: r.err });
        room.broadcast(room.snapshot(false));
        return;
      }
      if (msg.type === 'ping') send(ws, { type: 'pong', t: msg.t });
      return;
    }

    const me = room.players.get(ws.playerId);
    if (!me) return;
    // 绑定/更新 ws（人类刷新后）
    me.ws = ws;

    if (
      (msg.type === 'input' || msg.type === 'action') &&
      (room.state === 'playing' || room.state === 'countdown')
    ) {
      applyInput(me, msg);
      return;
    }

    if (msg.type === 'start') {
      const r = room.startMatch(me.id);
      if (!r.ok) return send(ws, { type: 'error', err: r.err });
      room.broadcast(room.snapshot(false));
      return;
    }

    if (msg.type === 'rematch') {
      const r = room.rematch(me.id);
      if (!r.ok) return send(ws, { type: 'error', err: r.err });
      room.broadcast(room.snapshot(false));
      return;
    }

    if (msg.type === 'stop') {
      const r = room.stopMatch(me.id, null);
      if (!r.ok) return send(ws, { type: 'error', err: r.err });
      room.broadcast(room.snapshot(false));
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t });
    }
  });

  ws.on('close', () => {
    const code = clientRoom.get(ws);
    clientRoom.delete(ws);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (ws.role === 'spectator') {
      room.removeSpectator(ws.playerId);
      room.maybeDestroyRoom();
      return;
    }
    const me = room.players.get(ws.playerId);
    if (me && me.ws === ws) {
      room.removePlayer(ws.playerId);
      if (rooms.has(code)) room.broadcast(room.snapshot(false));
    }
  });
});

// 清理过期战果
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of resultArchive) {
    if (now - (r.archivedAt || r.finishedAt || 0) > RESULT_TTL_MS) resultArchive.delete(code);
  }
  for (const [code, room] of rooms) {
    // 纯 bot 的空房大厅同样按过期处理（bot 不撑房）
    const botOnly =
      room.players.size > 0 && [...room.players.values()].every((p) => p.isBot);
    const staleEmptyLobby = room.keepEmptyLobby && room.state === 'lobby' &&
      (room.players.size === 0 || botOnly) && room.spectators.size === 0 &&
      now - room.lastTouchedAt > RESULT_TTL_MS;
    if (staleEmptyLobby) rooms.delete(code);
  }
}, 60 * 1000);

// 对局高频；大厅/结算低频
let lobbyAccum = 0;
setInterval(() => {
  lobbyAccum += 1 / TICK_HZ;
  const lobbyDue = lobbyAccum >= 1 / LOBBY_HZ;
  if (lobbyDue) lobbyAccum = 0;

  for (const room of rooms.values()) {
    const fighting =
      room.state === 'playing' ||
      room.state === 'countdown' ||
      room.state === 'round_break';
    try {
      if (fighting) {
        room.seq += 1;
        room.tick();
        room.broadcast(room.snapshot(false));
      } else if (lobbyDue) {
        room.seq += 1;
        room.broadcast(room.snapshot(false));
      }
    } catch (err) {
      // 单个房间异常不能拖垮整台游戏服务器和其他房间。
      console.error(`[${room.code}] 游戏循环异常:`, err && err.stack ? err.stack : err);
      room.bullets = [];
      room.events.push({ kind: 'banner', text: '本房间刚刚自动恢复，请继续操作' });
    }
  }
}, 1000 / TICK_HZ);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tank Trouble 1v1 台球桌反弹坦克服务已启动`);
  console.log(`本机:  http://localhost:${PORT}`);
  console.log(`规则: 1v1 空旷台球桌 · 直射无效（反弹≥1次才致命） · 每把${PLAYER_MAX_HP}血 · 死亡对方+1（含自杀） · 先拿${WIN_SCORE}分赢 · 单把${ROUND_SECONDS}s · 炮弹最多反弹${MAX_BOUNCES}次/存活${BULLET_LIFE}s`);
  console.log(`Agent文档: http://localhost:${PORT}/api/v1/docs`);
});
