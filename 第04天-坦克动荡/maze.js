// 迷宫生成器：11x11 网格，randomized DFS perfect maze + 随机拆墙造环 + 房屋占位
// 输出 AABB 墙段列表（供服务端碰撞 & 下发客户端渲染），seed 可复现
const A = 55; // 战场半宽（与 server.js 一致）
const N = 11; // 网格数
const CELL = (2 * A) / N; // 10
const WALL_T = 2; // 墙厚不小于 2；配合 1.5 单位子步防止高速炮弹穿墙
const WALL_H = 4; // 墙高（视觉）
const HOUSE_CELLS = 4; // 房屋数量
const LOOP_RATIO = 0.16; // 拆墙造环比例

// mulberry32 确定性随机
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (r, c) => r * N + c;
const cellCenter = (r, c) => ({ x: -A + CELL * (c + 0.5), z: -A + CELL * (r + 0.5) });

// 检查去掉 houseSet 后从 spawn 出发的连通性
function connected(houseSet, spawnCells) {
  const open = [];
  for (let i = 0; i < N * N; i++) open[i] = !houseSet.has(i);
  const start = spawnCells[0];
  if (!open[start]) return false;
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const cur = q.pop();
    const r = Math.floor(cur / N), c = cur % N;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const ni = idx(nr, nc);
      if (open[ni] && !seen.has(ni)) { seen.add(ni); q.push(ni); }
    }
  }
  for (let i = 0; i < N * N; i++) if (open[i] && !seen.has(i)) return false;
  return true;
}

function generateMaze(seed) {
  const rand = rng(seed);
  const spawnCells = [idx(0, 0), idx(N - 1, N - 1)]; // 对角出生

  // 1) 选房屋格：中心区域随机选，去掉后不破坏连通性才接受
  const houseSet = new Set();
  let guard = 0;
  while (houseSet.size < HOUSE_CELLS && guard++ < 200) {
    const r = 2 + Math.floor(rand() * (N - 4));
    const c = 2 + Math.floor(rand() * (N - 4));
    const i = idx(r, c);
    if (houseSet.has(i) || spawnCells.includes(i)) continue;
    houseSet.add(i);
    if (!connected(houseSet, spawnCells)) houseSet.delete(i);
  }

  // 2) randomized DFS 在 non-house 格子上雕 perfect maze
  //    wallsV[r][c] = (r,c) 与 (r,c+1) 之间是否有墙；wallsH[r][c] = (r,c) 与 (r+1,c) 之间是否有墙
  const wallsV = Array.from({ length: N }, () => new Array(N - 1).fill(true));
  const wallsH = Array.from({ length: N - 1 }, () => new Array(N).fill(true));
  const visited = new Set([...houseSet]);
  const stack = [spawnCells[0]];
  visited.add(spawnCells[0]);
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const r = Math.floor(cur / N), c = cur % N;
    const nbs = [];
    if (c + 1 < N && !visited.has(idx(r, c + 1))) nbs.push([r, c + 1, 'V', r, c]);
    if (c - 1 >= 0 && !visited.has(idx(r, c - 1))) nbs.push([r, c - 1, 'V', r, c - 1]);
    if (r + 1 < N && !visited.has(idx(r + 1, c))) nbs.push([r + 1, c, 'H', r, c]);
    if (r - 1 >= 0 && !visited.has(idx(r - 1, c))) nbs.push([r - 1, c, 'H', r - 1, c]);
    if (!nbs.length) { stack.pop(); continue; }
    const [nr, nc, kind, wr, wc] = nbs[Math.floor(rand() * nbs.length)];
    if (kind === 'V') wallsV[wr][wc] = false; else wallsH[wr][wc] = false;
    visited.add(idx(nr, nc));
    stack.push(idx(nr, nc));
  }

  // 3) 随机拆少量内墙造环路
  for (let r = 0; r < N; r++) for (let c = 0; c < N - 1; c++) {
    if (wallsV[r][c] && !houseSet.has(idx(r, c)) && !houseSet.has(idx(r, c + 1)) && rand() < LOOP_RATIO) wallsV[r][c] = false;
  }
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N; c++) {
    if (wallsH[r][c] && !houseSet.has(idx(r, c)) && !houseSet.has(idx(r + 1, c)) && rand() < LOOP_RATIO) wallsH[r][c] = false;
  }

  // 4) 墙段合并成 AABB：横墙按行合并连续段，竖墙按列合并连续段
  const walls = [];
  // 横墙：第 r 条网格线（0..N），第 c 列（0..N-1）
  for (let r = 0; r <= N; r++) {
    let c = 0;
    while (c < N) {
      const has = (c0) => {
        if (r === 0 || r === N) return true; // 外边界由 ±55 clamp 处理，不生成
        if (r === 0 || r === N) return false;
        const above = houseSet.has(idx(r - 1, c0));
        const below = houseSet.has(idx(r, c0));
        if (above && below) return false;
        if (above || below) return true; // 房屋边缘给墙，防止贴屋穿行
        return wallsH[r - 1][c0];
      };
      if (r === 0 || r === N) { c++; continue; } // 边界交给围墙逻辑
      if (!has(c)) { c++; continue; }
      let c2 = c;
      while (c2 + 1 < N && has(c2 + 1)) c2++;
      const z = -A + CELL * r;
      const x0 = -A + CELL * c, x1 = -A + CELL * (c2 + 1);
      walls.push({ x: (x0 + x1) / 2, z, hw: (x1 - x0) / 2 + WALL_T / 2, hd: WALL_T / 2, h: WALL_H, kind: 'wall' });
      c = c2 + 1;
    }
  }
  // 竖墙：第 c 条网格线（0..N），第 r 行（0..N-1）
  for (let c = 0; c <= N; c++) {
    let r = 0;
    while (r < N) {
      if (c === 0 || c === N) { r++; continue; }
      const has = (r0) => {
        const left = houseSet.has(idx(r0, c - 1));
        const right = houseSet.has(idx(r0, c));
        if (left && right) return false;
        if (left || right) return true;
        return wallsV[r0][c - 1];
      };
      if (!has(r)) { r++; continue; }
      let r2 = r;
      while (r2 + 1 < N && has(r2 + 1)) r2++;
      const x = -A + CELL * c;
      const z0 = -A + CELL * r, z1 = -A + CELL * (r2 + 1);
      walls.push({ x, z: (z0 + z1) / 2, hw: WALL_T / 2, hd: (z1 - z0) / 2 + WALL_T / 2, h: WALL_H, kind: 'wall' });
      r = r2 + 1;
    }
  }
  // 房屋本体
  for (const i of houseSet) {
    const r = Math.floor(i / N), c = i % N;
    const { x, z } = cellCenter(r, c);
    walls.push({ x, z, hw: CELL / 2, hd: CELL / 2, h: 5, kind: 'house' });
  }

  // 5) 出生点：对角格中心
  const spawns = spawnCells.map((i) => {
    const r = Math.floor(i / N), c = i % N;
    return cellCenter(r, c);
  });

  return { walls, spawns, seed };
}

module.exports = { generateMaze, A, N, CELL };
