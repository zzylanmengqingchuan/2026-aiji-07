/**
 * 2048 新手闯关
 * - 动画演示教程：讲清「能移动 / 不能移动」
 * - 游戏中高亮当前有效方向
 * - WASD 控制
 */

(() => {
  "use strict";

  // ========== 关卡 ==========
  const LEVELS = [
    {
      id: 1,
      name: "入门体验",
      desc: "3×3 小棋盘，目标 64。棋盘会提示哪些方向能动。",
      size: 3,
      goal: 64,
      fourChance: 0.05,
      color: "#67c23a",
      tip: "看橙色按键 = 现在能动的方向。动不了的方向是灰色的。",
    },
    {
      id: 2,
      name: "小试牛刀",
      desc: "经典 4×4，目标 256。",
      size: 4,
      goal: 256,
      fourChance: 0.1,
      color: "#409eff",
      tip: "大数字尽量往一个角落堆。",
    },
    {
      id: 3,
      name: "渐入佳境",
      desc: "目标 512。",
      size: 4,
      goal: 512,
      fourChance: 0.1,
      color: "#e6a23c",
      tip: "不要把大数字放在中间。",
    },
    {
      id: 4,
      name: "经典 2048",
      desc: "原版目标：合成 2048。",
      size: 4,
      goal: 2048,
      fourChance: 0.1,
      color: "#f56c6c",
      tip: "保护最大的那块数字。",
    },
    {
      id: 5,
      name: "超越极限",
      desc: "5×5，目标 4096。",
      size: 5,
      goal: 4096,
      fourChance: 0.15,
      color: "#9b59b6",
      tip: "空间更大，目标更高。",
    },
  ];

  const STORAGE_KEY = "2048-beginner-progress";
  const DIR_KEY = { up: "W", down: "S", left: "A", right: "D" };
  const DIR_CN = { up: "上", down: "下", left: "左", right: "右" };
  const KEY_DIR = { w: "up", W: "up", a: "left", A: "left", s: "down", S: "down", d: "right", D: "right" };

  /**
   * 动画演示脚本
   * before → press 方向 → after（若 invalid 则 after=before）
   * verdict: "ok" | "no"
   */
  const DEMOS = [
    {
      name: "整体滑动",
      title: "规则 1：按一个方向，所有数字一起滑",
      text: "按 <strong>D（右）</strong> 后，左边的 2 会滑到最右边。中间的空位会被「挤掉」。",
      size: 3,
      before: [
        [2, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      dir: "right",
      after: [
        [0, 0, 2],
        [0, 0, 0],
        [0, 0, 0],
      ],
      verdict: "ok",
      captionBefore: "开始：2 在左边",
      captionDuring: "正在向右滑…",
      captionAfter: "✓ 有效：数字移动了",
    },
    {
      name: "相同才合并",
      title: "规则 2：只有「完全相同」的数字才会合并",
      text: "两个 <strong>2</strong> 按 <strong>A（左）</strong> 撞在一起 → 变成一个 <strong>4</strong>。记住：2+2=4，4+4=8，8+8=16…",
      size: 3,
      before: [
        [0, 0, 0],
        [2, 0, 2],
        [0, 0, 0],
      ],
      dir: "left",
      after: [
        [0, 0, 0],
        [4, 0, 0],
        [0, 0, 0],
      ],
      verdict: "ok",
      captionBefore: "两个相同的 2",
      captionDuring: "向左合并…",
      captionAfter: "✓ 有效：2+2 变成了 4",
    },
    {
      name: "不同不合",
      title: "特殊情况 A：2 和 4 永远合不成",
      text: "上面是 <strong>2</strong>，下面是 <strong>4</strong>。按 <strong>S（下）</strong> —— 它们不一样，所以<strong>不会合并</strong>，2 也掉不下去。这次移动<strong>无效</strong>。",
      size: 3,
      before: [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
      ],
      dir: "down",
      after: [
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
      ],
      verdict: "no",
      captionBefore: "2 压在 4 上面",
      captionDuring: "尝试向下…",
      captionAfter: "✗ 无效：不同数字挡路，棋盘没变",
    },
    {
      name: "换个方向",
      title: "特殊情况 B：这个方向不行，换方向就行",
      text: "还是类似局面：中间有 2，底下有两个 <strong>4</strong>。向下不行，但按 <strong>A（左）</strong>，两个 4 能合成 8！",
      size: 3,
      before: [
        [0, 0, 0],
        [0, 2, 0],
        [4, 4, 0],
      ],
      dir: "left",
      after: [
        [0, 0, 0],
        [2, 0, 0],
        [8, 0, 0],
      ],
      verdict: "ok",
      captionBefore: "向下会卡住，试试向左",
      captionDuring: "向左合并两个 4…",
      captionAfter: "✓ 有效：4+4=8，局面打开了",
    },
    {
      name: "贴边无效",
      title: "特殊情况 C：已经贴边，再往那边按没用",
      text: "2 已经在<strong>最底行</strong>。再按 <strong>S（下）</strong>，它没地方可去 → <strong>无效</strong>。可以改按 W/A/D。",
      size: 3,
      before: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 2, 0],
      ],
      dir: "down",
      after: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 2, 0],
      ],
      verdict: "no",
      captionBefore: "2 已经在最底下",
      captionDuring: "再按向下…",
      captionAfter: "✗ 无效：贴边了，没地方滑",
    },
    {
      name: "满盘还能走",
      title: "特殊情况 D：格子满了 ≠ 立刻输",
      text: "棋盘<strong>全满</strong>，但中间有两个相邻的 <strong>2</strong>。按 <strong>A（左）</strong> 仍能合并！所以：满了先看有没有相同数字挨着。",
      size: 3,
      before: [
        [4, 8, 16],
        [2, 2, 4],
        [8, 4, 2],
      ],
      dir: "left",
      after: [
        [4, 8, 16],
        [4, 4, 0],
        [8, 4, 2],
      ],
      // note: left on middle row [2,2,4] → [4,4,0] then game would spawn - we show merge only
      verdict: "ok",
      captionBefore: "满了！但有两个 2 挨着",
      captionDuring: "向左合并…",
      captionAfter: "✓ 有效：合并腾出空位，还没死",
    },
    {
      name: "真的走投无路",
      title: "特殊情况 E：满了 + 四周都不能合 = 失败",
      text: "全满，且<strong>上下左右都没有相同数字相邻</strong>。四个方向全都无效 → 游戏结束。平时要尽早合并，别拖到这一步。",
      size: 3,
      before: [
        [2, 4, 2],
        [4, 2, 4],
        [2, 4, 2],
      ],
      dir: "down",
      after: [
        [2, 4, 2],
        [4, 2, 4],
        [2, 4, 2],
      ],
      verdict: "no",
      tryAll: true, // 演示时会快速试四个方向都无效
      captionBefore: "满盘，且没有相邻相同数字",
      captionDuring: "试四个方向…",
      captionAfter: "✗ 全方向无效 → 这局失败",
    },
  ];

  // ========== 状态 ==========
  let mode = "intro";
  let currentLevel = null;
  let grid = [];
  let score = 0;
  let bestScores = {};
  let clearedLevels = new Set();
  let unlockedMax = 1;
  let won = false;
  let over = false;
  let history = null;

  // demo
  let demoIndex = 0;
  let demoTimer = null;
  let demoPlaying = false;
  let demoToken = 0;

  // ========== DOM ==========
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    intro: $("#screen-intro"),
    tutorial: $("#screen-tutorial"),
    levels: $("#screen-levels"),
    game: $("#screen-game"),
  };
  const levelList = $("#level-list");
  const boardEl = $("#board");
  const demoBoardEl = $("#demo-board");
  const overlay = $("#overlay");
  const helpModal = $("#help-modal");

  function showScreen(name) {
    mode = name;
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    if (name !== "tutorial") stopDemoTimers();
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      bestScores = data.bestScores || {};
      clearedLevels = new Set(data.cleared || []);
      unlockedMax = data.unlockedMax || 1;
    } catch (_) {}
  }

  function saveProgress() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bestScores,
        cleared: [...clearedLevels],
        unlockedMax,
      })
    );
  }

  // ========== 核心逻辑 ==========
  function emptyGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(0));
  }

  function cloneGrid(g) {
    return g.map((row) => row.slice());
  }

  function emptyCells(g) {
    const cells = [];
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] === 0) cells.push({ r, c });
      }
    }
    return cells;
  }

  function spawnTile(g, fourChance) {
    const cells = emptyCells(g);
    if (!cells.length) return null;
    const pick = cells[Math.floor(Math.random() * cells.length)];
    const value = Math.random() < fourChance ? 4 : 2;
    g[pick.r][pick.c] = value;
    return { ...pick, value };
  }

  function maxTile(g) {
    let m = 0;
    for (const row of g) for (const v of row) if (v > m) m = v;
    return m;
  }

  function slideLine(line) {
    const filtered = line.filter((v) => v !== 0);
    const merged = [];
    let scoreGain = 0;
    let i = 0;
    const mergeFlags = [];
    while (i < filtered.length) {
      if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
        const val = filtered[i] * 2;
        merged.push(val);
        mergeFlags.push(true);
        scoreGain += val;
        i += 2;
      } else {
        merged.push(filtered[i]);
        mergeFlags.push(false);
        i += 1;
      }
    }
    while (merged.length < line.length) {
      merged.push(0);
      mergeFlags.push(false);
    }
    const changed = merged.some((v, idx) => v !== line[idx]);
    return { line: merged, scoreGain, changed, mergeFlags };
  }

  function applyMove(g, direction) {
    const size = g.length;
    const next = cloneGrid(g);
    let totalGain = 0;
    let anyChanged = false;
    const mergeSet = new Set();

    if (direction === "left") {
      for (let r = 0; r < size; r++) {
        const result = slideLine(next[r]);
        if (result.changed) anyChanged = true;
        totalGain += result.scoreGain;
        next[r] = result.line;
        result.mergeFlags.forEach((f, c) => f && mergeSet.add(`${r},${c}`));
      }
    } else if (direction === "right") {
      for (let r = 0; r < size; r++) {
        const rev = next[r].slice().reverse();
        const result = slideLine(rev);
        if (result.changed) anyChanged = true;
        totalGain += result.scoreGain;
        next[r] = result.line.reverse();
        result.mergeFlags.forEach((f, c) => f && mergeSet.add(`${r},${size - 1 - c}`));
      }
    } else if (direction === "up") {
      for (let c = 0; c < size; c++) {
        const col = [];
        for (let r = 0; r < size; r++) col.push(next[r][c]);
        const result = slideLine(col);
        if (result.changed) anyChanged = true;
        totalGain += result.scoreGain;
        for (let r = 0; r < size; r++) next[r][c] = result.line[r];
        result.mergeFlags.forEach((f, r) => f && mergeSet.add(`${r},${c}`));
      }
    } else if (direction === "down") {
      for (let c = 0; c < size; c++) {
        const col = [];
        for (let r = size - 1; r >= 0; r--) col.push(next[r][c]);
        const result = slideLine(col);
        if (result.changed) anyChanged = true;
        totalGain += result.scoreGain;
        for (let r = 0; r < size; r++) next[size - 1 - r][c] = result.line[r];
        result.mergeFlags.forEach((f, r) => f && mergeSet.add(`${size - 1 - r},${c}`));
      }
    }
    return { grid: next, scoreGain: totalGain, changed: anyChanged, merges: mergeSet };
  }

  function canMoveDir(g, dir) {
    return applyMove(g, dir).changed;
  }

  function validDirs(g) {
    return ["up", "down", "left", "right"].filter((d) => canMoveDir(g, d));
  }

  function canMove(g) {
    return validDirs(g).length > 0;
  }

  function tileClass(value) {
    if (value <= 2048) return `tile-${value}`;
    if (value === 4096) return "tile-4096";
    if (value === 8192) return "tile-8192";
    return "tile-super";
  }

  function fontSizeClass(value, size) {
    const d = String(value).length;
    if (size >= 5) return d <= 2 ? "fs-md" : d === 3 ? "fs-sm" : "fs-xs";
    if (d <= 2) return "fs-lg";
    if (d === 3) return "fs-md";
    if (d === 4) return "fs-sm";
    return "fs-xs";
  }

  // ========== 渲染 ==========
  function layoutCells(board, size) {
    board.innerHTML = "";
    const gridDom = document.createElement("div");
    gridDom.className = `grid grid-size-${size}`;
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      gridDom.appendChild(cell);
    }
    board.appendChild(gridDom);
    return gridDom;
  }

  function cellRects(board, gridDom, size) {
    const boardRect = board.getBoundingClientRect();
    const cells = gridDom.querySelectorAll(".cell");
    const rects = [];
    for (let r = 0; r < size; r++) {
      rects[r] = [];
      for (let c = 0; c < size; c++) {
        const rect = cells[r * size + c].getBoundingClientRect();
        rects[r][c] = {
          left: rect.left - boardRect.left,
          top: rect.top - boardRect.top,
          width: rect.width,
          height: rect.height,
        };
      }
    }
    return rects;
  }

  function makeTileEl(val, size, rect, extraClass) {
    const tile = document.createElement("div");
    tile.className = `tile ${tileClass(val)} ${fontSizeClass(val, size)}${extraClass ? " " + extraClass : ""}`;
    tile.textContent = val;
    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
    tile.style.left = `${rect.left}px`;
    tile.style.top = `${rect.top}px`;
    return tile;
  }

  function renderStaticBoard(board, g, opts = {}) {
    const size = g.length;
    const gridDom = layoutCells(board, size);
    // force layout
    void board.offsetWidth;
    const rects = cellRects(board, gridDom, size);
    const merges = opts.merges || new Set();
    const newTile = opts.newTile;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const val = g[r][c];
        if (!val) continue;
        let extra = "";
        if (newTile && newTile.r === r && newTile.c === c) extra = "new";
        if (merges.has(`${r},${c}`)) extra = (extra + " merged").trim();
        board.appendChild(makeTileEl(val, size, rects[r][c], extra));
      }
    }
  }

  /**
   * 动画：从 before 滑到 after
   * 简化策略：按格子值跟踪不了唯一 id，用「同列/同行滑动」的视觉：
   * 先显示 before，再 CSS 过渡到 after 的位置映射（贪心匹配相同数字）
   */
  function animateBoard(board, before, after, dir, duration = 380) {
    return new Promise((resolve) => {
      const size = before.length;
      const gridDom = layoutCells(board, size);
      void board.offsetWidth;
      const rects = cellRects(board, gridDom, size);

      // 收集 before 中的块
      const tiles = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!before[r][c]) continue;
          const el = makeTileEl(before[r][c], size, rects[r][c]);
          el.dataset.r = r;
          el.dataset.c = c;
          el.dataset.v = before[r][c];
          board.appendChild(el);
          tiles.push(el);
        }
      }

      // 为每个 before 块找 after 中的落点（同方向压缩匹配）
      const targets = mapTilesToTargets(before, after, dir);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          tiles.forEach((el, i) => {
            const t = targets[i];
            if (!t) return;
            const rect = rects[t.r][t.c];
            el.style.transition = `left ${duration}ms ease, top ${duration}ms ease, transform ${duration}ms ease, opacity ${duration}ms ease`;
            el.style.left = `${rect.left}px`;
            el.style.top = `${rect.top}px`;
            if (t.mergedAway) {
              el.style.opacity = "0";
              el.style.transform = "scale(0.6)";
            }
            if (t.willBe) {
              // 到达后变成合并后的值在第二阶段处理
            }
          });
        });
      });

      setTimeout(() => {
        // 画最终态
        board.querySelectorAll(".tile").forEach((t) => t.remove());
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            if (!after[r][c]) continue;
            const el = makeTileEl(after[r][c], size, rects[r][c], "merged");
            board.appendChild(el);
          }
        }
        resolve();
      }, duration + 40);
    });
  }

  /** 把 before 每个非空格映射到 after 的目标坐标 */
  function mapTilesToTargets(before, after, dir) {
    const size = before.length;
    const targets = [];

    // 按移动方向的线处理
    const lines = [];
    if (dir === "left" || dir === "right") {
      for (let r = 0; r < size; r++) {
        const cells = [];
        for (let c = 0; c < size; c++) {
          if (before[r][c]) cells.push({ r, c, v: before[r][c], idx: targets.length + cells.length });
        }
        // 实际 idx 等下统一
      }
    }

    // 更简单：逐行/列模拟 slide，记录每个源块的去向
    const sourceList = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (before[r][c]) sourceList.push({ r, c, v: before[r][c] });
      }
    }

    // 默认：若棋盘不变，目标=原地
    const same =
      JSON.stringify(before) === JSON.stringify(after);
    if (same) {
      return sourceList.map((s) => ({ r: s.r, c: s.c, mergedAway: false }));
    }

    // 用模拟：对每一条线，源序列 → 目标序列
    const assign = new Map(); // "r,c" -> {r,c,mergedAway}

    function processLine(coords /* array of {r,c} in slide order toward direction */) {
      const sources = coords.filter(({ r, c }) => before[r][c] !== 0);
      // 模拟合并后的目标位置（在 coords 上靠「终点」一侧）
      const values = sources.map(({ r, c }) => before[r][c]);
      const result = [];
      let i = 0;
      const originOf = []; // 每个 result 项对应的 source index(es)
      while (i < values.length) {
        if (i + 1 < values.length && values[i] === values[i + 1]) {
          result.push(values[i] * 2);
          originOf.push([i, i + 1]);
          i += 2;
        } else {
          result.push(values[i]);
          originOf.push([i]);
          i += 1;
        }
      }
      // 目标坐标：向终点对齐
      // coords 顺序是「从远端到近端」还是？我们约定 coords[0] 是移动方向的终点
      // 即 left: c 从 0 到 n-1，终点是左边 → coords 应按 c 升序，目标填到前面
      // 为统一：coords 按「从起点到终点」？ 
      // left: 终点 c=0，填 result 到 coords 前 result.length 个
      // 我们传入的 coords 按终点优先（index 0 = 最靠移动方向的那一格）

      const destCoords = coords; // index 0 = 终点侧
      originOf.forEach((srcs, ri) => {
        const dest = destCoords[ri];
        srcs.forEach((si, j) => {
          const src = sources[si];
          const key = `${src.r},${src.c}`;
          // 合并时第二个源块也去同一格然后消失感
          assign.set(key, {
            r: dest.r,
            c: dest.c,
            mergedAway: srcs.length > 1 && j > 0,
          });
        });
      });
    }

    if (dir === "left") {
      for (let r = 0; r < size; r++) {
        const coords = [];
        for (let c = 0; c < size; c++) coords.push({ r, c });
        processLine(coords);
      }
    } else if (dir === "right") {
      for (let r = 0; r < size; r++) {
        const coords = [];
        for (let c = size - 1; c >= 0; c--) coords.push({ r, c });
        processLine(coords);
      }
    } else if (dir === "up") {
      for (let c = 0; c < size; c++) {
        const coords = [];
        for (let r = 0; r < size; r++) coords.push({ r, c });
        processLine(coords);
      }
    } else if (dir === "down") {
      for (let c = 0; c < size; c++) {
        const coords = [];
        for (let r = size - 1; r >= 0; r--) coords.push({ r, c });
        processLine(coords);
      }
    }

    return sourceList.map((s) => assign.get(`${s.r},${s.c}`) || { r: s.r, c: s.c, mergedAway: false });
  }

  // ========== 动画演示控制 ==========
  function stopDemoTimers() {
    demoToken++;
    if (demoTimer) {
      clearTimeout(demoTimer);
      demoTimer = null;
    }
    demoPlaying = false;
  }

  function sleep(ms, token) {
    return new Promise((resolve) => {
      demoTimer = setTimeout(() => {
        if (token === demoToken) resolve(true);
        else resolve(false);
      }, ms);
    });
  }

  function renderProgress() {
    const el = $("#demo-progress");
    el.innerHTML = DEMOS.map(
      (_, i) => `<span class="dot${i === demoIndex ? " active" : ""}${i < demoIndex ? " done" : ""}"></span>`
    ).join("");
  }

  function setVerdict(type, text) {
    const el = $("#demo-verdict");
    el.className = "demo-verdict " + (type || "");
    el.textContent = text || "";
  }

  function setDemoKey(dir, phase) {
    const el = $("#demo-key-show");
    if (!dir) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<span class="demo-key ${phase || ""}">${DIR_KEY[dir]}<small>${DIR_CN[dir]}</small></span>`;
  }

  async function playDemo(index) {
    stopDemoTimers();
    const token = demoToken;
    demoIndex = index;
    const demo = DEMOS[index];
    demoPlaying = true;

    $("#demo-label").textContent = `动画 ${index + 1}/${DEMOS.length}`;
    $("#demo-name").textContent = demo.name;
    $("#demo-title").innerHTML = demo.title;
    $("#demo-text").innerHTML = demo.text;
    $("#demo-caption").textContent = demo.captionBefore;
    $("#btn-demo-next").textContent =
      index === DEMOS.length - 1 ? "完成教程，去闯关" : "下一个动画";
    renderProgress();
    setVerdict("", "");
    setDemoKey(null);

    // 显示初始盘面
    renderStaticBoard(demoBoardEl, demo.before);
    if (!(await sleep(900, token))) return;

    if (demo.tryAll) {
      // 特殊：四个方向都试一遍
      $("#demo-caption").textContent = demo.captionDuring;
      for (const d of ["up", "down", "left", "right"]) {
        if (token !== demoToken) return;
        setDemoKey(d, "press");
        setVerdict("no", `试 ${DIR_KEY[d]}（${DIR_CN[d]}）→ 无效`);
        // 轻微震动感
        demoBoardEl.classList.add("shake");
        await sleep(450, token);
        demoBoardEl.classList.remove("shake");
        await sleep(200, token);
      }
      setDemoKey(null);
      setVerdict("no", "四个方向全无效 → 失败");
      $("#demo-caption").textContent = demo.captionAfter;
      demoPlaying = false;
      return;
    }

    // 显示按键
    setDemoKey(demo.dir, "press");
    $("#demo-caption").textContent = demo.captionDuring;
    if (!(await sleep(500, token))) return;

    if (demo.verdict === "no") {
      // 无效：棋盘抖动，不变
      demoBoardEl.classList.add("shake");
      setVerdict("no", `按 ${DIR_KEY[demo.dir]}（${DIR_CN[demo.dir]}）→ 无效，棋盘不变`);
      if (!(await sleep(500, token))) return;
      demoBoardEl.classList.remove("shake");
      $("#demo-caption").textContent = demo.captionAfter;
      setDemoKey(demo.dir, "fail");
    } else {
      // 有效：播放滑动动画
      setVerdict("ok", `按 ${DIR_KEY[demo.dir]}（${DIR_CN[demo.dir]}）→ 有效`);
      await animateBoard(demoBoardEl, demo.before, demo.after, demo.dir, 400);
      if (token !== demoToken) return;
      $("#demo-caption").textContent = demo.captionAfter;
      setDemoKey(demo.dir, "ok");
    }

    demoPlaying = false;
  }

  function startTutorial() {
    showScreen("tutorial");
    playDemo(0);
  }

  function demoNext() {
    if (demoIndex >= DEMOS.length - 1) {
      stopDemoTimers();
      renderLevelList();
      showScreen("levels");
      return;
    }
    playDemo(demoIndex + 1);
  }

  function demoReplay() {
    playDemo(demoIndex);
  }

  // ========== 正式游戏 ==========
  function setGameTip(html, isWarn) {
    const el = $("#game-tip");
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle("warn", !!isWarn);
  }

  function updateValidHighlights() {
    const dirs = validDirs(grid);
    const set = new Set(dirs);
    $("#game-wasd").querySelectorAll(".wasd-btn").forEach((btn) => {
      btn.classList.remove("highlight", "disabled-dir");
      if (set.has(btn.dataset.dir)) btn.classList.add("highlight");
      else btn.classList.add("disabled-dir");
    });
    const names = dirs.map((d) => `${DIR_KEY[d]}(${DIR_CN[d]})`).join(" · ");
    $("#valid-dirs-hint").textContent = dirs.length
      ? `现在能走：${names}（橙色键）`
      : "没有可走方向了…";
  }

  function explainInvalid(g, dir) {
    const key = DIR_KEY[dir];
    const cn = DIR_CN[dir];
    const others = validDirs(g);
    if (!others.length) {
      return `按 ${key}（${cn}）无效，而且四个方向都不能动了 → 本局失败。`;
    }
    // 粗略判断
    const size = g.length;
    let blockedDiff = false;
    if (dir === "down") {
      for (let c = 0; c < size; c++) {
        for (let r = 0; r < size - 1; r++) {
          if (g[r][c] && g[r + 1][c] && g[r][c] !== g[r + 1][c]) blockedDiff = true;
        }
      }
    } else if (dir === "up") {
      for (let c = 0; c < size; c++) {
        for (let r = 1; r < size; r++) {
          if (g[r][c] && g[r - 1][c] && g[r][c] !== g[r - 1][c]) blockedDiff = true;
        }
      }
    } else if (dir === "left") {
      for (let r = 0; r < size; r++) {
        for (let c = 1; c < size; c++) {
          if (g[r][c] && g[r][c - 1] && g[r][c] !== g[r][c - 1]) blockedDiff = true;
        }
      }
    } else if (dir === "right") {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size - 1; c++) {
          if (g[r][c] && g[r][c + 1] && g[r][c] !== g[r][c + 1]) blockedDiff = true;
        }
      }
    }
    const alt = others.map((d) => DIR_KEY[d]).join("/");
    if (blockedDiff) {
      return `按 ${key} 无效：不同数字挡路（只有相同才合并）。请按橙色键：${alt}`;
    }
    return `按 ${key} 无效：这个方向滑不动。请按橙色键：${alt}`;
  }

  function renderGame(opts = {}) {
    renderStaticBoard(boardEl, grid, opts);
    $("#score").textContent = score;
    $("#best").textContent = bestScores[String(currentLevel.id)] || 0;
    $("#goal").textContent = currentLevel.goal;
    updateValidHighlights();
  }

  function moveGame(dir) {
    if (mode !== "game" || won || over) return;
    const result = applyMove(grid, dir);
    if (!result.changed) {
      flashWasd($("#game-wasd"), dir, false);
      setGameTip(explainInvalid(grid, dir), true);
      updateValidHighlights();
      return;
    }

    flashWasd($("#game-wasd"), dir, true);
    history = { grid: cloneGrid(grid), score };
    $("#btn-undo").disabled = false;

    grid = result.grid;
    score += result.scoreGain;
    const spawned = spawnTile(grid, currentLevel.fourChance);

    const key = String(currentLevel.id);
    if (!bestScores[key] || score > bestScores[key]) {
      bestScores[key] = score;
      saveProgress();
    }

    setGameTip("橙色键 = 现在能走的方向 · 相同数字才合并", false);
    renderGame({ newTile: spawned, merges: result.merges });
    checkEnd();
  }

  function checkEnd() {
    if (maxTile(grid) >= currentLevel.goal && !won) {
      won = true;
      clearedLevels.add(currentLevel.id);
      if (currentLevel.id >= unlockedMax && currentLevel.id < LEVELS.length) {
        unlockedMax = currentLevel.id + 1;
      } else if (currentLevel.id === LEVELS.length) {
        unlockedMax = LEVELS.length;
      }
      saveProgress();
      showOverlay("win");
      return;
    }
    if (!canMove(grid)) {
      over = true;
      showOverlay("lose");
    }
  }

  function showOverlay(type) {
    const card = overlay.querySelector(".overlay-card");
    const title = $("#overlay-title");
    const msg = $("#overlay-msg");
    const btnNext = $("#btn-next");
    const btnRetry = $("#btn-retry");
    card.classList.remove("win", "lose");
    overlay.classList.remove("hidden");

    if (type === "win") {
      card.classList.add("win");
      title.textContent = "🎉 通关！";
      const isLast = currentLevel.id === LEVELS.length;
      msg.textContent = isLast
        ? `全部通关！最高块 ${maxTile(grid)}，得分 ${score}`
        : `达成 ${currentLevel.goal}！得分 ${score}，下一关已解锁`;
      btnNext.style.display = isLast ? "none" : "block";
      btnRetry.textContent = "再玩一次";
    } else {
      card.classList.add("lose");
      title.textContent = "😵 走投无路";
      msg.innerHTML = `四个方向都不能动了（满盘且没有相邻相同数字可合并）。得分 ${score}。<br/><br/>建议：点「再试一次」，或回去再看一遍动画教程。`;
      btnNext.style.display = "none";
      btnRetry.textContent = "再试一次";
    }
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function renderLevelList() {
    levelList.innerHTML = "";
    LEVELS.forEach((lv) => {
      const locked = lv.id > unlockedMax;
      const cleared = clearedLevels.has(lv.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `level-card${locked ? " locked" : ""}${cleared ? " cleared" : ""}`;
      btn.disabled = locked;
      btn.innerHTML = `
        <div class="level-num" style="background:${locked ? "#ccc" : lv.color}">${lv.id}</div>
        <div class="level-info">
          <h3>${lv.name}${cleared ? " ✓" : ""}</h3>
          <p>${lv.desc}</p>
          <div class="level-meta">
            <span class="chip">${lv.size}×${lv.size}</span>
            <span class="chip goal">目标 ${lv.goal}</span>
            ${locked ? '<span class="chip">🔒 先通前一关</span>' : ""}
          </div>
        </div>
        <div class="level-status">${locked ? "🔒" : cleared ? "⭐" : "▶"}</div>
      `;
      if (!locked) btn.addEventListener("click", () => startLevel(lv.id));
      levelList.appendChild(btn);
    });
  }

  function startLevel(id) {
    currentLevel = LEVELS.find((l) => l.id === id);
    if (!currentLevel) return;
    grid = emptyGrid(currentLevel.size);
    score = 0;
    won = false;
    over = false;
    history = null;
    $("#btn-undo").disabled = true;
    hideOverlay();
    $("#level-badge").textContent = `第 ${currentLevel.id} 关`;
    $("#level-name").textContent = currentLevel.name;
    spawnTile(grid, currentLevel.fourChance);
    spawnTile(grid, currentLevel.fourChance);
    setGameTip("橙色键 = 现在能走的方向 · 相同数字才合并", false);
    showScreen("game");
    renderGame();
  }

  function restart() {
    if (currentLevel) startLevel(currentLevel.id);
  }

  function undo() {
    if (!history || won || over) return;
    grid = history.grid;
    score = history.score;
    history = null;
    $("#btn-undo").disabled = true;
    setGameTip("已撤销一步", false);
    renderGame();
  }

  function flashWasd(container, dir, ok) {
    const btn = container.querySelector(`.wasd-btn[data-dir="${dir}"]`);
    if (!btn) return;
    btn.classList.add(ok ? "pressed" : "wrong");
    setTimeout(() => btn.classList.remove("pressed", "wrong"), 200);
  }

  function bindWasdPad(container, handler) {
    container.querySelectorAll(".wasd-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        handler(btn.dataset.dir);
      });
    });
  }

  function openHelp() {
    if (!currentLevel) return;
    const lv = currentLevel;
    $("#help-content").innerHTML = `
      <p><strong>目标：</strong>棋盘上出现一个 <strong>${lv.goal}</strong> 的方块（不是数字加总）。</p>
      <p><strong>什么时候能动？</strong></p>
      <p>按某个方向后，只要有数字<strong>位置变了</strong>或<strong>发生了合并</strong>，就是有效。橙色键 = 现在能动。</p>
      <p><strong>什么时候不能动？</strong></p>
      <p>① 已经贴边 ② 被不同数字挡住（2 和 4 不合）③ 该方向没有空位也不能合并。</p>
      <p><strong>什么时候失败？</strong>四个方向都无效（满盘且没有相邻相同数字）。</p>
      <p>操作：W 上 A 左 S 下 D 右</p>
      <p><button type="button" class="btn btn-secondary" id="btn-help-tutor" style="width:100%;margin-top:8px">再看动画教程</button></p>
    `;
    helpModal.classList.remove("hidden");
    const t = $("#btn-help-tutor");
    if (t) t.addEventListener("click", () => { closeHelp(); startTutorial(); });
  }

  function closeHelp() {
    helpModal.classList.add("hidden");
  }

  // 输入
  document.addEventListener("keydown", (e) => {
    if (helpModal && !helpModal.classList.contains("hidden")) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      if (mode === "game") {
        e.preventDefault();
        setGameTip("请用 W A S D，不用方向键", true);
      }
      return;
    }
    const dir = KEY_DIR[e.key];
    if (!dir) return;
    e.preventDefault();
    if (mode === "game") moveGame(dir);
  });

  bindWasdPad($("#game-wasd"), (dir) => moveGame(dir));

  // 触屏
  (function bindSwipe(board, handler) {
    let start = null;
    board.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    board.addEventListener("touchend", (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) handler(dx > 0 ? "right" : "left");
      else handler(dy > 0 ? "down" : "up");
    }, { passive: true });
    board.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  })(boardEl, (dir) => moveGame(dir));

  // 按钮
  $("#btn-tutorial").addEventListener("click", startTutorial);
  $("#btn-skip-tutorial").addEventListener("click", () => {
    renderLevelList();
    showScreen("levels");
  });
  $("#btn-tutorial-back").addEventListener("click", () => {
    stopDemoTimers();
    showScreen("intro");
  });
  $("#btn-demo-next").addEventListener("click", demoNext);
  $("#btn-demo-replay").addEventListener("click", demoReplay);
  $("#btn-demo-skip-all").addEventListener("click", () => {
    stopDemoTimers();
    renderLevelList();
    showScreen("levels");
  });
  $("#btn-re-tutorial").addEventListener("click", startTutorial);
  $("#btn-back-intro").addEventListener("click", () => showScreen("intro"));
  $("#btn-back-levels").addEventListener("click", () => {
    renderLevelList();
    showScreen("levels");
  });
  $("#btn-restart").addEventListener("click", restart);
  $("#btn-undo").addEventListener("click", undo);
  $("#btn-retry").addEventListener("click", restart);
  $("#btn-to-levels").addEventListener("click", () => {
    hideOverlay();
    renderLevelList();
    showScreen("levels");
  });
  $("#btn-next").addEventListener("click", () => {
    if (!currentLevel) return;
    const next = currentLevel.id + 1;
    if (next <= LEVELS.length && next <= unlockedMax) startLevel(next);
  });
  $("#btn-help").addEventListener("click", openHelp);
  $("#btn-close-help").addEventListener("click", closeHelp);
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) closeHelp();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (mode === "game" && currentLevel) renderGame();
      if (mode === "tutorial" && !demoPlaying) {
        renderStaticBoard(demoBoardEl, DEMOS[demoIndex].after || DEMOS[demoIndex].before);
      }
    }, 100);
  });

  loadProgress();
  showScreen("intro");
})();
