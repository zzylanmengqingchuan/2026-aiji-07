/**
 * 3D 坦克大战 · 多人 Agent/人类混战服务端
 * 规则（同学需求）：
 * - 仅入房玩家/用户 Agent 互打，无系统 AI 兵
 * - 每人 3 命（被打 3 下出局）
 * - 命中 +1 本把分；击杀吞并对方本把分，对方本把分清零
 * - 每把 60s；最后存活者 或 时间到积分最高者 为本把优胜参考
 * - 共 10 局，每局 3 把，累计总分排名
 * - Agent：REST /api/v1/* + WebSocket；保留人类网页
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3099;
// 对战 20Hz；大厅更低频，省带宽
const TICK_HZ = 20;
const LOBBY_HZ = 8;
const DT = 1 / TICK_HZ;
const r2 = (n) => Math.round(n * 100) / 100;
const A = 55; // 战场半宽
const MAX_PLAYERS = 8; // 小组可多于 4；仍可用 2 人开打
const MIN_PLAYERS = 2;
const PLAYER_SPEED = 16;
const PLAYER_MAX_HP = 3; // 被打 3 下出局
const FIRE_DMG = 1; // 每发子弹 = 1 命
const FIRE_SPEED = 60;
const FIRE_CD = 0.32;
const FIRE_CD_RAPID = 0.11;
const HIT_R = 1.7;
const SHIELD_R = 2.6;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 60;
const GAMES_PER_MATCH = 10;
const ROUNDS_PER_GAME = 3;
const ROUND_BREAK_SECONDS = Number(process.env.ROUND_BREAK_SECONDS) || 4;
const COUNTDOWN_SECONDS = Number(process.env.COUNTDOWN_SECONDS) || 3;

// 与前端程序化色板保持一致：低饱和军绿、陶土橙、钢蓝、赭金。
const COLORS = [0x4f8d5c, 0xd85c41, 0x4f78a8, 0xd6aa3d];
const COLOR_NAMES = ['军绿', '陶土橙', '钢蓝', '赭金'];
// 对角优先分配：双人局分别出生在左下角和右上角，避免同边开局直接对射。
// 四人局仍会使用全部四个角落。
const SPAWNS = [
  { x: -38, z: -38 },
  { x: 38, z: 38 },
  { x: -38, z: 38 },
  { x: 38, z: -38 },
];

// 固定障碍（联机必须一致，不能随机）
const OBSTACLES = (() => {
  const list = [];
  const seed = [
    [0, 0, 3.2, 3.2, 2.4],
    [-18, -12, 2.4, 2.8, 2.2],
    [16, -18, 2.6, 2.2, 2.8],
    [-22, 14, 2.2, 2.6, 2.0],
    [20, 16, 2.8, 2.4, 2.6],
    [-8, 22, 2.0, 2.4, 1.9],
    [10, -26, 2.4, 2.0, 2.2],
    [-28, -4, 2.2, 3.0, 2.5],
    [26, 6, 2.6, 2.2, 2.1],
    [4, 12, 2.0, 2.0, 3.0],
    [-12, -24, 2.8, 2.2, 2.3],
    [14, 26, 2.2, 2.6, 2.0],
    [-30, 28, 2.4, 2.0, 2.4],
    [30, -28, 2.0, 2.4, 2.2],
    [-4, -8, 1.8, 2.2, 2.6],
    [8, 4, 2.2, 1.8, 2.1],
  ];
  for (const [x, z, hw, hd, h] of seed) {
    list.push({ x, z, hw, hd, h });
  }
  return list;
})();

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
function collideObstacles(p, r) {
  p.x = clamp(p.x, -A + r, A - r);
  p.z = clamp(p.z, -A + r, A - r);
  for (const o of OBSTACLES) {
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const gapX = o.hw + r;
    const gapZ = o.hd + r;
    if (Math.abs(dx) < gapX && Math.abs(dz) < gapZ) {
      const penX = gapX - Math.abs(dx);
      const penZ = gapZ - Math.abs(dz);
      if (penX < penZ) p.x = o.x + (dx >= 0 ? 1 : -1) * gapX;
      else p.z = o.z + (dz >= 0 ? 1 : -1) * gapZ;
    }
  }
  return p;
}
function pointInObstacle(x, z, r) {
  if (Math.abs(x) > A - r || Math.abs(z) > A - r) return true;
  for (const o of OBSTACLES) {
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
  constructor(code) {
    this.code = code;
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
    this.collisionLog = [];
    this.matchEndReason = null;
    this.nextBulletId = 1;
    this.game = 0; // 当前大局 1..10
    this.round = 0; // 当前小把 1..3
    this.roundTimeLeft = ROUND_SECONDS;
    this.roundBreakLeft = 0;
    this.roundHistory = []; // 每把小结
    this.gameHistory = []; // 每局小结
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
    const spawn = SPAWNS[slot % SPAWNS.length];
    const kind = opts.kind === 'agent' ? 'agent' : 'human';
    const waitingNextRound = midMatch; // 中途加入：等下一把
    const p = {
      id,
      token,
      ws: ws || null,
      kind,
      agentId: opts.agentId ? String(opts.agentId).slice(0, 64) : null,
      name: (name || (kind === 'agent' ? 'Agent' : '玩家')).slice(0, 16),
      color: COLORS[slot % COLORS.length],
      colorName: COLOR_NAMES[slot % COLOR_NAMES.length],
      slot,
      x: spawn.x,
      z: spawn.z,
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
      roundScore: 0,
      gameScore: 0,
      totalScore: 0,
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
    // 对局中减员：只剩 ≤1 个仍在打的人则提前结束本局
    if (this.state === 'playing' || this.state === 'countdown') {
      this.checkWin();
    }
    // 大厅不足 2 人：保持等待（不会傻等第三人，只是等人凑齐 2 个再自动开）
  }

  maybeDestroyRoom() {
    if (this.players.size === 0 && this.spectators.size === 0) {
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

  /** full=true 时带障碍物（仅加入时需要） */
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
        hitScore: 1,
        killStealsRoundScore: true,
        roundSeconds: ROUND_SECONDS,
        gamesPerMatch: GAMES_PER_MATCH,
        roundsPerGame: ROUNDS_PER_GAME,
        roundsPerMatch: GAMES_PER_MATCH * ROUNDS_PER_GAME,
        noSystemBots: true,
      },
      game: this.game,
      gamesTotal: GAMES_PER_MATCH,
      round: this.round,
      roundsTotal: ROUNDS_PER_GAME,
      roundTimeLeft: r2(Math.max(0, this.roundTimeLeft)),
      roundBreakLeft: r2(Math.max(0, this.roundBreakLeft)),
      roundHistory: this.roundHistory,
      gameHistory: this.gameHistory,
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
          yaw: r2(p.yaw),
          turretYaw: r2(p.turretYaw),
          hp: Math.round(p.hp),
          maxHp: p.maxHp,
          alive: p.alive,
          waitingNextRound: !!p.waitingNextRound,
          kills: p.kills,
          deaths: p.deaths || 0,
          roundScore: p.roundScore || 0,
          gameScore: p.gameScore || 0,
          totalScore: p.totalScore || 0,
        };
        if (inGame) {
          base.shield = r2(p.shield);
          base.rapid = r2(p.rapid);
          base.invuln = r2(p.invuln);
        }
        return base;
      }),
      bullets: this.state === 'playing'
        ? this.bullets.map((b) => ({
            id: b.id,
            x: r2(b.x),
            y: 1.4,
            z: r2(b.z),
            ownerId: b.ownerId,
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
      snap.obstacles = OBSTACLES;
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
      obstacles: OBSTACLES,
      you: you
        ? {
            id: you.id,
            name: you.name,
            kind: you.kind,
            x: r2(you.x),
            z: r2(you.z),
            yaw: r2(you.yaw),
            turretYaw: r2(you.turretYaw),
            hp: Math.round(you.hp),
            maxHp: you.maxHp,
            alive: you.alive,
            waitingNextRound: !!you.waitingNextRound,
            kills: you.kills,
            roundScore: you.roundScore || 0,
            gameScore: you.gameScore || 0,
            totalScore: you.totalScore || 0,
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

  /** 每一局开始：房间里所有选手（含中途排队的）全部上场 */
  resetPlayersForRound() {
    let i = 0;
    for (const id of this.order) {
      const p = this.players.get(id);
      if (!p) continue;
      const sp = SPAWNS[i % SPAWNS.length];
      p.x = sp.x;
      p.z = sp.z;
      p.yaw = 0;
      p.turretYaw = 0;
      p.aimX = sp.x;
      p.aimZ = sp.z + 10;
      p.hp = PLAYER_MAX_HP;
      p.maxHp = PLAYER_MAX_HP;
      p.alive = true;
      p.waitingNextRound = false;
      p.fireCd = 0;
      p.shield = 0;
      p.rapid = 0;
      p.invuln = 1.5;
      p.roundScore = 0;
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
    this.collisionLog = [];
    this.matchEndReason = null;
    this.nextBulletId = 1;
    this.roundHistory = [];
    this.gameHistory = [];
    this.startedAt = Date.now();
    this.finishedAt = null;
    for (const p of this.players.values()) {
      p.totalScore = 0;
      p.gameScore = 0;
      p.kills = 0;
      p.deaths = 0;
      p.waitingNextRound = false;
    }
    this.game = 1;
    this.round = 1;
    this.resetPlayersForRound();
    this.state = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.roundTimeLeft = ROUND_SECONDS;
    this.events.push({
      kind: 'banner',
      text: `第 1/${GAMES_PER_MATCH} 局 · 第 1/${ROUNDS_PER_GAME} 把 · ${this.players.size} 人`,
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
    this.collisionLog = [];
    this.matchEndReason = null;
    this.roundHistory = [];
    this.gameHistory = [];
    this.game = 0;
    this.round = 0;
    this.startedAt = null;
    this.finishedAt = null;
    for (const p of this.players.values()) {
      p.alive = true;
      p.hp = PLAYER_MAX_HP;
      p.maxHp = PLAYER_MAX_HP;
      p.kills = 0;
      p.deaths = 0;
      p.roundScore = 0;
      p.gameScore = 0;
      p.totalScore = 0;
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
    const gameWins = new Map(rankings.map((p) => [p.id, 0]));
    const roundWins = new Map(rankings.map((p) => [p.id, 0]));
    for (const game of this.gameHistory) {
      if (game.winnerId) gameWins.set(game.winnerId, (gameWins.get(game.winnerId) || 0) + 1);
    }
    for (const round of this.roundHistory) {
      if (round.roundWinnerId) roundWins.set(round.roundWinnerId, (roundWins.get(round.roundWinnerId) || 0) + 1);
    }
    const leader = rankings[0] || null;
    const runnerUp = rankings[1] || null;
    const scoreGap = leader ? leader.totalScore - (runnerUp ? runnerUp.totalScore : 0) : 0;
    const durationSec = this.startedAt
      ? Math.round(((this.finishedAt || Date.now()) - this.startedAt) / 1000)
      : 0;
    const playerReports = rankings.map((p) => ({
      ...p,
      gameWins: gameWins.get(p.id) || 0,
      roundWins: roundWins.get(p.id) || 0,
      kd: p.deaths ? r2(p.kills / p.deaths) : p.kills,
    }));
    const endedEarly = this.matchEndReason === 'manual_stop';
    const highlights = [];
    if (leader) {
      highlights.push(`${leader.name}以${leader.totalScore}分夺得第一，领先第二名${scoreGap}分`);
      highlights.push(`${leader.name}拿下${gameWins.get(leader.id) || 0}局、${roundWins.get(leader.id) || 0}把，完成${leader.kills}次击杀`);
    }
    if (this.collisionLog.length) {
      highlights.push(`全场发生${this.collisionLog.length}次坦克对撞，相关选手同时出局`);
    }
    if (endedEarly) highlights.push('本场由房主或选手主动提前结束，排名按停止时已结算积分生成');
    return {
      title: `房间 ${this.code} 战斗回顾`,
      headline: leader ? `${leader.name}赢得本场混战` : '本场混战结束',
      endReason: this.matchEndReason || 'completed',
      endedEarly,
      durationSec,
      completedGames: this.gameHistory.length,
      completedRounds: this.roundHistory.length,
      scheduledGames: GAMES_PER_MATCH,
      scheduledRounds: GAMES_PER_MATCH * ROUNDS_PER_GAME,
      scoreGap,
      collisionCount: this.collisionLog.length,
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
        totalScore: p.totalScore || 0,
        kills: p.kills,
        deaths: p.deaths || 0,
        colorName: p.colorName,
      }))
      .sort((a, b) => b.totalScore - a.totalScore || b.kills - a.kills);
    const top = rankings[0] || null;
    const report = this.buildBattleReport(rankings);
    return {
      code: this.code,
      phase: 'finished',
      rules: '10局×每局3把×60s，命中+1，击杀吞分，3命，总积分排名',
      winnerId: top ? top.id : null,
      winnerName: top ? top.name : null,
      winnerKind: top ? top.kind : null,
      winnerAgentId: top ? top.agentId : null,
      rankings,
      roundHistory: this.roundHistory.slice(),
      gameHistory: this.gameHistory.slice(),
      killLog: this.killLog.slice(),
      collisionLog: this.collisionLog.slice(),
      endReason: this.matchEndReason || 'completed',
      endedEarly: this.matchEndReason === 'manual_stop',
      report,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt || Date.now(),
      durationSec: this.startedAt
        ? Math.round(((this.finishedAt || Date.now()) - this.startedAt) / 1000)
        : 0,
      summary: top
        ? `${this.matchEndReason === 'manual_stop' ? '比赛提前结束 · ' : ''}全场第1：${top.name}（总分 ${top.totalScore}，击杀 ${top.kills}）`
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
    if (this.state === 'playing') {
      this.endRound('manual_stop', true);
    } else {
      this.finishMatch('manual_stop');
    }
    return { ok: true, phase: this.state, result: this.result };
  }

  /** 结束当前把：结算本把分，进入把间或全场结束 */
  endRound(reason, forceFinish = false) {
    if (this.state !== 'playing') return;
    // 本把积分同时计入当前局积分和全场总积分
    for (const p of this.players.values()) {
      p.gameScore = (p.gameScore || 0) + (p.roundScore || 0);
      p.totalScore = (p.totalScore || 0) + (p.roundScore || 0);
    }
    const byRound = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        roundScore: p.roundScore || 0,
        gameScore: p.gameScore || 0,
        totalScore: p.totalScore || 0,
        alive: p.alive,
      }))
      .sort((a, b) => b.roundScore - a.roundScore);
    const alive = [...this.players.values()].filter(
      (p) => p.alive && !p.waitingNextRound
    );
    let roundWinnerId = null;
    let roundWinnerName = null;
    if (reason === 'mutual_collision') {
      roundWinnerId = null;
      roundWinnerName = null;
    } else if (reason === 'last_alive' && alive.length === 1) {
      roundWinnerId = alive[0].id;
      roundWinnerName = alive[0].name;
    } else if (byRound.length) {
      roundWinnerId = byRound[0].id;
      roundWinnerName = byRound[0].name;
    }
    const summary = {
      game: this.game,
      hand: this.round,
      round: this.round,
      reason, // last_alive | time_up | mutual_collision | manual_stop
      roundWinnerId,
      roundWinnerName,
      scores: byRound,
    };
    this.roundHistory.push(summary);
    this.events.push({
      kind: 'banner',
      text:
        reason === 'last_alive' && roundWinnerName
          ? `第${this.game}局第${this.round}把结束 · ${roundWinnerName} 存活胜出`
          : reason === 'mutual_collision'
            ? `第${this.game}局第${this.round}把结束 · 对撞同归于尽`
          : reason === 'manual_stop'
            ? `比赛已提前结束 · 当前领先 ${roundWinnerName || '-'}`
          : `第${this.game}局第${this.round}把结束 · 积分最高 ${roundWinnerName || '-'}`,
    });
    this.events.push({ kind: 'round_end', ...summary });

    const gameFinished = this.round >= ROUNDS_PER_GAME;
    if (gameFinished) {
      const gameScores = [...this.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          gameScore: p.gameScore || 0,
          totalScore: p.totalScore || 0,
        }))
        .sort((a, b) => b.gameScore - a.gameScore);
      this.gameHistory.push({
        game: this.game,
        winnerId: gameScores[0] ? gameScores[0].id : null,
        winnerName: gameScores[0] ? gameScores[0].name : null,
        scores: gameScores,
      });
    }

    if (forceFinish || (gameFinished && this.game >= GAMES_PER_MATCH)) {
      this.finishMatch(forceFinish ? 'manual_stop' : 'completed');
      return;
    }

    // 把间休息 → 下一把；第三把后进入下一局
    this.state = 'round_break';
    this.roundBreakLeft = ROUND_BREAK_SECONDS;
    this.bullets = [];
  }

  beginNextRound() {
    // 不足 2 人无法继续：回大厅等人（中途加入的也算人数）
    if (this.players.size < MIN_PLAYERS) {
      this.state = 'lobby';
      this.game = 0;
      this.round = 0;
      this.events.push({
        kind: 'banner',
        text: '人数不足，已回大厅（再满 2 人将自动开局）',
      });
      return;
    }
    if (this.round >= ROUNDS_PER_GAME) {
      this.game += 1;
      this.round = 1;
      for (const p of this.players.values()) p.gameScore = 0;
    } else {
      this.round += 1;
    }
    this.resetPlayersForRound(); // 含本局中途 join 的等待玩家
    this.state = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.roundTimeLeft = ROUND_SECONDS;
    this.events.push({
      kind: 'banner',
      text: `第 ${this.game}/${GAMES_PER_MATCH} 局 · 第 ${this.round}/${ROUNDS_PER_GAME} 把 · ${this.players.size} 人`,
    });
  }

  checkWin(zeroAliveReason = 'all_eliminated') {
    if (this.state !== 'playing') return;
    // 只统计本局在场（非 waiting）且存活的
    const alive = [...this.players.values()].filter(
      (p) => p.alive && !p.waitingNextRound
    );
    if (alive.length <= 1) {
      this.endRound(alive.length === 0 ? zeroAliveReason : 'last_alive');
    }
  }

  spawnPowerup() {
    let tries = 0;
    while (tries++ < 40) {
      const x = (Math.random() * 2 - 1) * (A - 12);
      const z = (Math.random() * 2 - 1) * (A - 12);
      if (pointInObstacle(x, z, 2)) continue;
      if ([...this.players.values()].some((p) => hypot(p.x - x, p.z - z) < 10)) continue;
      const type = ['hp', 'rapid', 'shield'][(Math.random() * 3) | 0];
      this.powerups.push({
        id: Math.random().toString(36).slice(2, 8),
        type,
        x,
        z,
        t: 18,
      });
      return;
    }
  }

  tick() {
    if (this.state === 'countdown') {
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.roundTimeLeft = ROUND_SECONDS;
        this.events.push({
          kind: 'banner',
          text: `开战！第${this.game}局第${this.round}把 · ${ROUND_SECONDS}s`,
        });
        this.events.push({ kind: 'sfx', name: 'wave' });
      }
      return;
    }
    if (this.state === 'round_break') {
      this.roundBreakLeft -= DT;
      if (this.roundBreakLeft <= 0) this.beginNextRound();
      return;
    }
    if (this.state !== 'playing') return;

    // 当局倒计时
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

      const inp = p.input;
      let mx = inp.mx || 0;
      let mz = inp.mz || 0;
      const len = hypot(mx, mz);
      if (len > 0) {
        mx /= len;
        mz /= len;
        p.x += mx * PLAYER_SPEED * DT;
        p.z += mz * PLAYER_SPEED * DT;
        const pos = collideObstacles({ x: p.x, z: p.z }, 1.7);
        p.x = pos.x;
        p.z = pos.z;
        const wantYaw = Math.atan2(mx, mz);
        p.yaw = p.yaw + normAngle(wantYaw - p.yaw) * Math.min(1, 10 * DT);

        // 木箱是轻型动态道具：坦克保持原速度穿过，木箱获得冲量并腾空翻滚。
        for (const prop of this.props) {
          const dx = prop.x - p.x;
          const dz = prop.z - p.z;
          const d = hypot(dx, dz);
          if (d >= 2.45) continue;
          const force = 1 - d / 2.45;
          prop.vx += mx * (18 + force * 18);
          prop.vz += mz * (18 + force * 18);
          prop.vy = Math.max(prop.vy, 3.8 + force * 4.5);
          prop.vrx += -mz * (3.5 + force * 4);
          prop.vrz += mx * (3.5 + force * 4);
          prop.vry += (mx - mz) * 2.8;
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
          speed: FIRE_SPEED,
          dmg: FIRE_DMG,
          life: 2.5,
          ownerId: p.id,
          color: p.color,
        });
        p.fireCd = p.rapid > 0 ? FIRE_CD_RAPID : FIRE_CD;
        this.events.push({ kind: 'sfx', name: 'shoot', x: mx0, z: mz0 });
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

    // 坦克高速正面相撞时双方同归于尽；普通擦碰仍做软分离。
    const arr = [...this.players.values()].filter((p) => p.alive && !p.waitingNextRound);
    let playerDiedThisTick = false;
    let collisionThisTick = false;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = hypot(dx, dz);
        const crashDistance = 2.45;
        if (d < crashDistance && a.invuln <= 0 && b.invuln <= 0) {
          a.hp = 0;
          b.hp = 0;
          a.alive = false;
          b.alive = false;
          a.deaths = (a.deaths || 0) + 1;
          b.deaths = (b.deaths || 0) + 1;
          const crash = {
            t: Date.now(),
            playerIds: [a.id, b.id],
            playerNames: [a.name, b.name],
            x: r2((a.x + b.x) / 2),
            z: r2((a.z + b.z) / 2),
          };
          this.collisionLog.push(crash);
          this.events.push({ kind: 'crash', ...crash });
          this.events.push({ kind: 'sfx', name: 'crash', x: crash.x, z: crash.z });
          playerDiedThisTick = true;
          collisionThisTick = true;
          continue;
        }
        const min = 3.2;
        if (d < min && d > 0.01) {
          const push = ((min - d) / d) * 0.5;
          a.x -= dx * push;
          a.z -= dz * push;
          b.x += dx * push;
          b.z += dz * push;
          collideObstacles(a, 1.7);
          collideObstacles(b, 1.7);
        }
      }
    }

    // bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= DT;
      let dead = b.life <= 0;
      const step = b.speed * DT;
      b.x += b.dx * step;
      b.z += b.dz * step;
      if (Math.abs(b.x) > A - 0.6 || Math.abs(b.z) > A - 0.6) dead = true;
      else if (pointInObstacle(b.x, b.z, 0.2)) dead = true;
      else {
        for (const p of this.players.values()) {
          if (!p.alive || p.waitingNextRound || p.id === b.ownerId) continue;
          if (p.invuln > 0) continue;
          const rr = p.shield > 0 ? SHIELD_R : HIT_R;
          if (Math.abs(b.x - p.x) < rr && Math.abs(b.z - p.z) < rr) {
            if (p.shield > 0) {
              // 护盾仅挡本次，不给分
              p.shield = 0;
              this.events.push({ kind: 'sfx', name: 'hit', x: p.x, z: p.z });
            } else {
              const killer = this.players.get(b.ownerId);
              p.hp -= FIRE_DMG;
              // 命中：攻击方本把 +1
              if (killer && killer.alive) killer.roundScore = (killer.roundScore || 0) + 1;
              this.events.push({ kind: 'sfx', name: 'phit', x: p.x, z: p.z, color: killer ? killer.color : 0xffffff });
              this.events.push({
                kind: 'hit',
                id: p.id,
                hp: p.hp,
                attackerId: b.ownerId,
                color: killer ? killer.color : 0xffffff,
                x: p.x,
                z: p.z,
                roundScore: killer ? killer.roundScore : null,
              });
              if (p.hp <= 0) {
                p.hp = 0;
                p.alive = false;
                p.deaths = (p.deaths || 0) + 1;
                // 击杀：吞并对方本把积分，对方本把清零
                const stolen = p.roundScore || 0;
                p.roundScore = 0;
                if (killer) {
                  killer.kills += 1;
                  killer.roundScore = (killer.roundScore || 0) + stolen;
                }
                this.killLog.push({
                  t: Date.now(),
                  killerId: b.ownerId,
                  killerName: killer ? killer.name : null,
                  victimId: p.id,
                  victimName: p.name,
                  stolen,
                });
                this.events.push({
                  kind: 'kill',
                  victimId: p.id,
                  killerId: b.ownerId,
                  stolen,
                  x: p.x,
                  z: p.z,
                });
                this.events.push({ kind: 'sfx', name: 'boom', x: p.x, z: p.z });
                // 不要在遍历子弹数组时结束本把；endRound 会清空子弹，
                // 过去会令循环下一项读到 undefined 并使整个 Node 进程崩溃。
                playerDiedThisTick = true;
              }
            }
            dead = true;
            break;
          }
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }

    // 同一服务端 tick 内先结算完所有子弹，再统一判断胜负。
    // 这样双方同时命中时，所有客户端看到的结果也完全一致。
    if (playerDiedThisTick) this.checkWin(collisionThisTick ? 'mutual_collision' : 'all_eliminated');

    // 新规则：不刷系统补给（避免干扰积分与 3 命）
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
    `【坦克混战】房间号：${code}`,
    `服务器：${base}`,
    ``,
    `把下面整段发给你的 Agent：`,
    `你要作为选手加入坦克混战（不要只观战）。`,
    `服务器 ${base}，房间 ${code}。`,
    `1) POST ${base}/api/v1/rooms/${code}/join`,
    `   {"name":"你的名字","kind":"agent","agentId":"唯一id"}`,
    `2) 保存 playerId、token`,
    `3) 房间满 2 人会【自动开局】；中途加入的人下一把上场`,
    `4) phase=playing 时循环 GET .../state 与 POST .../action (mx,mz,aimX,aimZ,fire)`,
    `5) 结束后 GET .../result 按 totalScore 排名汇报`,
    `规则：无系统机器人；3命；命中+1；击杀吞分；10局×每局3把×60秒；总积分排名；2人自动开。`,
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
  const room = new Room(code);
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
    name: 'Tank Battle 4P Agent API',
    version: '1.0',
    summary:
      'Agent/人类混战。3命；命中+1本把分；击杀吞对方本把分；10局×每局3把×60s；总积分排名。无系统AI兵。',
    rules: {
      maxHp: PLAYER_MAX_HP,
      hitScore: 1,
      killStealsRoundScore: true,
      roundSeconds: ROUND_SECONDS,
      gamesPerMatch: GAMES_PER_MATCH,
      roundsPerGame: ROUNDS_PER_GAME,
      roundsPerMatch: GAMES_PER_MATCH * ROUNDS_PER_GAME,
      winMatch: '10局、每局3把后 totalScore 最高',
      roundEnd: '每把仅存1人 或 60s到点（积分高者为本把参考）',
    },
    flow: [
      '1. POST /api/v1/rooms 创建（或人类网页创建）',
      '2. 分发 humanUrl / room 码给同学 Agent',
      '3. 各 Agent POST .../join（kind=agent）',
      '4. 任一方 start',
      '5. phase=playing 时循环 state + action',
      '6. phase=round_break 为局间；finished 后 GET result 看总分排名',
    ],
    endpoints: {
      'POST /api/v1/rooms': { body: { name: 'string', agentId: 'string?', kind: 'agent|human' } },
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
      },
      'POST /api/v1/rooms/:code/stop': {
        body: { playerId: 'string?', token: 'string?', hostKey: 'string?' },
        note: '选手或房主可提前结束测试局，并立即生成当前战报',
      },
      'GET /api/v1/rooms/:code/state?playerId&token': '观测（含 you）',
      'GET /api/v1/rooms/:code/result': '终局结果（结束后 30 分钟可查）',
      'GET /api/v1/rooms/:code': '房间大厅信息',
    },
    websocket: {
      create: { type: 'create', name: '', kind: 'agent', agentId: '' },
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
    const room = new Room(code);
    rooms.set(code, room);
    const links = roomLinks(base, code, null, null);
    return res.json({
      ok: true,
      code,
      hostKey: room.hostKey,
      empty: true,
      ...links,
      openSpectateHint: '请立即打开 spectateUrl 观战',
    });
  }
  const name = (req.body && req.body.name) || 'Agent';
  const kind = (req.body && req.body.kind) || 'agent';
  const agentId = req.body && req.body.agentId;
  const r = createRoomWithPlayer(name, { kind, agentId }, null);
  if (!r.ok) return res.status(400).json(r);
  const links = roomLinks(base, r.room.code, r.id, r.token);
  res.json({
    ok: true,
    code: r.room.code,
    playerId: r.id,
    token: r.token,
    hostId: r.room.hostId,
    hostKey: r.room.hostKey,
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
  res.json({
    ok: true,
    code,
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

app.post('/api/v1/rooms/:code/action', (req, res) => {
  const code = String(req.params.code || '')
    .toUpperCase()
    .trim();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false, err: '房间不存在' });
  const body = req.body || {};
  const me = room.getPlayerAuth(body.playerId, body.token);
  if (!me) return res.status(401).json({ ok: false, err: '鉴权失败' });
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
    obstacles: OBSTACLES,
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
      const r = createRoomWithPlayer(msg.name, { kind: msg.kind, agentId: msg.agentId }, ws);
      if (!r.ok) return send(ws, { type: 'error', err: r.err });
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
        obstacles: OBSTACLES,
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
  console.log(`坦克大战 Agent/人类混战服务已启动`);
  console.log(`本机:  http://localhost:${PORT}`);
  console.log(`规则: ${GAMES_PER_MATCH}局×每局${ROUNDS_PER_GAME}把×${ROUND_SECONDS}s · ${PLAYER_MAX_HP}命 · 命中+1 · 击杀吞分`);
  console.log(`Agent文档: http://localhost:${PORT}/api/v1/docs`);
});
