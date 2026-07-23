<script lang="ts">
  import { onMount } from 'svelte';

  type CrisisKind = 'rebellion' | 'famine' | 'corruption';
  type GeneralState = 'idle' | 'outbound' | 'working' | 'returning';

  type Point = { x: number; y: number };
  type Crisis = Point & {
    id: number;
    kind: CrisisKind;
    age: number;
    duration: number;
    progress: number;
    assignedTo: number | null;
  };
  type General = Point & {
    id: number;
    name: string;
    state: GeneralState;
    targetId: number | null;
    travel: number;
    path: { start: Point; control: Point; end: Point } | null;
  };
  type Particle = Point & { vx: number; vy: number; life: number; color: string };

  const CRISIS_INFO = {
    rebellion: { color: '#b9383e', dark: '#74272b', duration: 7, label: '叛', name: '边镇叛乱' },
    famine: { color: '#d39a2d', dark: '#7f5d20', duration: 5, label: '饥', name: '州郡饥荒' },
    corruption: { color: '#347c91', dark: '#245563', duration: 3, label: '贪', name: '吏治贪腐' },
  } as const;
  const TREE_POINTS = [
    [.08,.18],[.14,.72],[.22,.32],[.31,.82],[.42,.16],[.51,.75],[.66,.13],
    [.72,.69],[.84,.22],[.91,.58],[.95,.84],[.37,.58],[.78,.45],[.17,.48],
  ];

  let canvas: HTMLCanvasElement;
  let landings = 0;
  let pace = 0;
  let duration = 0;
  let gameOver = false;
  let paused = false;
  let selectedGeneral: number | null = null;
  let cursor: Point = { x: 0, y: 0 };

  let ctx: CanvasRenderingContext2D;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let city: Point = { x: 0, y: 0 };
  let crises: Crisis[] = [];
  let generals: General[] = [];
  let nextCrisisId = 1;
  let spawnTimer = 0;
  let elapsed = 0;
  let lastTime = 0;
  let lastHudUpdate = 0;
  let animationFrame = 0;
  let particles: Particle[] = [];
  let flash = 0;

  const bezier = (path: NonNullable<General['path']>, t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * path.start.x + 2 * u * t * path.control.x + t * t * path.end.x,
      y: u * u * path.start.y + 2 * u * t * path.control.y + t * t * path.end.y,
    };
  };

  function makePath(start: Point, end: Point) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = Math.min(70, length * 0.15) * (end.x < start.x ? -1 : 1);
    return {
      start: { ...start },
      control: {
        x: (start.x + end.x) / 2 - (dy / length) * bend,
        y: (start.y + end.y) / 2 + (dx / length) * bend,
      },
      end: { ...end },
    };
  }

  function resetGame() {
    crises = [];
    city = { x: width * (width < 700 ? 0.54 : 0.58), y: height * 0.5 };
    generals = ['霍', '卫', '岳'].map((name, i) => ({
      id: i,
      name,
      x: city.x + (i - 1) * 30,
      y: city.y + 62,
      state: 'idle' as GeneralState,
      targetId: null,
      travel: 0,
      path: null,
    }));
    nextCrisisId = 1;
    spawnTimer = 0.8;
    elapsed = 0;
    landings = 0;
    pace = 0;
    duration = 0;
    gameOver = false;
    paused = false;
    particles = [];
    flash = 0;
    selectedGeneral = null;
    lastTime = performance.now();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const oldWidth = width || rect.width;
    const oldHeight = height || rect.height;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (generals.length) {
      const sx = width / oldWidth;
      const sy = height / oldHeight;
      crises.forEach((item) => { item.x *= sx; item.y *= sy; });
      generals.forEach((general) => {
        general.x *= sx;
        general.y *= sy;
        if (general.path) {
          for (const point of [general.path.start, general.path.control, general.path.end]) {
            point.x *= sx;
            point.y *= sy;
          }
        }
      });
    }
    city = { x: width * (width < 700 ? 0.54 : 0.58), y: height * 0.5 };
  }

  function spawnCrisis() {
    const margin = Math.max(58, Math.min(width, height) * 0.09);
    const side = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    if (side < 2) {
      x = side === 0 ? margin : width - margin;
      y = margin + Math.random() * Math.max(1, height - margin * 2);
    } else {
      x = margin + Math.random() * Math.max(1, width - margin * 2);
      y = side === 2 ? margin : height - margin;
    }
    const roll = Math.random();
    const kind: CrisisKind = roll < 0.32 ? 'rebellion' : roll < 0.66 ? 'famine' : 'corruption';
    if (width > 700 && x < 330 && y < 330) y = Math.max(360, y);
    crises.push({
      id: nextCrisisId++, x, y, kind, age: 0,
      duration: CRISIS_INFO[kind].duration,
      progress: 0, assignedTo: null,
    });
  }

  function dispatch(general: General, crisis: Crisis) {
    crisis.assignedTo = general.id;
    general.state = 'outbound';
    general.targetId = crisis.id;
    general.travel = 0;
    general.path = makePath(general, crisis);
  }

  function update(dt: number) {
    if (gameOver || paused) return;
    elapsed += dt;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnCrisis();
      const pressure = Math.min(1.8, elapsed / 90);
      spawnTimer = Math.max(1.9, 4.5 - pressure) * (0.82 + Math.random() * 0.36);
    }

    for (const crisis of crises) {
      crisis.age += dt;
      if (crisis.age >= 20) {
        gameOver = true;
        selectedGeneral = null;
        break;
      }
    }

    for (const general of generals) {
      const target = crises.find((item) => item.id === general.targetId);
      if (general.state === 'outbound' && general.path && target) {
        const distance = Math.hypot(general.path.end.x - general.path.start.x, general.path.end.y - general.path.start.y);
        general.travel = Math.min(1, general.travel + (190 / Math.max(1, distance)) * dt);
        Object.assign(general, bezier(general.path, general.travel));
        if (general.travel >= 1) general.state = 'working';
      } else if (general.state === 'working' && target) {
        target.progress = Math.min(1, target.progress + dt / target.duration);
        if (target.progress >= 1) {
          crises = crises.filter((item) => item.id !== target.id);
          landings += 1;
          flash = 1;
          for (let i = 0; i < 18; i++) {
            const angle = (Math.PI * 2 * i) / 18;
            particles.push({
              x: target.x, y: target.y,
              vx: Math.cos(angle) * (24 + Math.random() * 42),
              vy: Math.sin(angle) * (24 + Math.random() * 42),
              life: 0.65 + Math.random() * 0.3,
              color: CRISIS_INFO[target.kind].color,
            });
          }
          general.state = 'returning';
          general.travel = 0;
          general.path = makePath(general, city);
        }
      } else if (general.state === 'returning' && general.path) {
        const distance = Math.hypot(general.path.end.x - general.path.start.x, general.path.end.y - general.path.start.y);
        general.travel = Math.min(1, general.travel + (210 / Math.max(1, distance)) * dt);
        Object.assign(general, bezier(general.path, general.travel));
        if (general.travel >= 1) {
          const slot = general.id - 1;
          general.x = city.x + slot * 30;
          general.y = city.y + 62;
          general.state = 'idle';
          general.targetId = null;
          general.path = null;
        }
      }
    }
    flash = Math.max(0, flash - dt * 3.5);
    particles.forEach((particle) => {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 25 * dt;
      particle.life -= dt;
    });
    particles = particles.filter((particle) => particle.life > 0);
  }

  function drawRoute(path: NonNullable<General['path']>, color = '#f0d27a', alpha = 0.9) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(22, 29, 31, .28)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(path.start.x, path.start.y);
    ctx.quadraticCurveTo(path.control.x, path.control.y, path.end.x, path.end.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -elapsed * 28;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#78aa72';
    ctx.fillRect(0, 0, width, height);

    // 帝国州界：大色块先建立地图层次，再以细线划分疆域。
    const provinces = [
      { color: '#82b77c', points: [[0,0],[.48,0],[.42,.36],[.18,.42],[0,.34]] },
      { color: '#70a36e', points: [[.48,0],[1,0],[1,.3],[.72,.38],[.42,.36]] },
      { color: '#8cbb7d', points: [[0,.34],[.18,.42],[.46,.38],[.51,.7],[.21,1],[0,1]] },
      { color: '#76ad70', points: [[.46,.38],[.72,.38],[.86,.66],[.72,1],[.21,1],[.51,.7]] },
      { color: '#669764', points: [[.72,.38],[1,.3],[1,1],[.72,1],[.86,.66]] },
    ];
    for (const province of provinces) {
      ctx.fillStyle = province.color;
      ctx.strokeStyle = 'rgba(45,79,49,.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      province.points.forEach(([px, py], i) => i ? ctx.lineTo(px * width, py * height) : ctx.moveTo(px * width, py * height));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 山脉
    ctx.fillStyle = '#61865b';
    ctx.strokeStyle = '#4c704b';
    for (let i = 0; i < 8; i++) {
      const mx = width * (0.78 + i * 0.027);
      const my = height * (0.16 + Math.sin(i * 1.7) * 0.035);
      ctx.beginPath();
      ctx.moveTo(mx - 18, my + 14);
      ctx.lineTo(mx, my - 17 - (i % 3) * 5);
      ctx.lineTo(mx + 19, my + 14);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d8d8b9';
      ctx.beginPath();
      ctx.moveTo(mx - 5, my - 7);
      ctx.lineTo(mx, my - 17 - (i % 3) * 5);
      ctx.lineTo(mx + 6, my - 6);
      ctx.fill();
      ctx.fillStyle = '#61865b';
    }

    // 大河，使用宽描边形成浅色河岸。
    const river = () => {
      ctx.beginPath();
      ctx.moveTo(width * 1.02, height * .63);
      ctx.bezierCurveTo(width * .83, height * .52, width * .75, height * .94, width * .47, height * 1.04);
    };
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#d7e4b8'; ctx.lineWidth = Math.max(38, width * .052); river(); ctx.stroke();
    ctx.strokeStyle = '#48a2b7'; ctx.lineWidth = Math.max(27, width * .039); river(); ctx.stroke();
    ctx.strokeStyle = 'rgba(231,247,227,.28)'; ctx.lineWidth = 2; river(); ctx.stroke();

    // 驿道从京城通往四方。
    ctx.save();
    ctx.strokeStyle = 'rgba(224,211,165,.78)';
    ctx.lineWidth = 5;
    ctx.setLineDash([9, 6]);
    const exits = [[width*.12,height*.13],[width*.91,height*.23],[width*.86,height*.77],[width*.19,height*.84]];
    for (const [ex, ey] of exits) {
      ctx.beginPath(); ctx.moveTo(city.x, city.y); ctx.lineTo(ex, ey); ctx.stroke();
    }
    ctx.restore();

    // 树木和投影。
    for (const [tx, ty] of TREE_POINTS) {
      const x = tx * width, y = ty * height;
      ctx.fillStyle = 'rgba(38,64,42,.18)'; ctx.fillRect(x + 6, y + 9, 15, 6);
      ctx.fillStyle = '#5f4d35'; ctx.fillRect(x - 2, y + 4, 5, 13);
      ctx.fillStyle = '#356d45'; ctx.fillRect(x - 9, y - 8, 18, 16);
      ctx.fillStyle = '#488154'; ctx.fillRect(x - 5, y - 12, 11, 10);
      ctx.fillStyle = '#2d5d3d'; ctx.fillRect(x - 8, y - 3, 7, 7);
    }

    for (const general of generals) {
      if (general.path && (general.state === 'outbound' || general.state === 'returning')) drawRoute(general.path);
    }

    const selected = generals.find((item) => item.id === selectedGeneral);
    if (selected && !gameOver) {
      const hovered = crises.find((item) => item.assignedTo === null && Math.hypot(item.x - cursor.x, item.y - cursor.y) < 32);
      drawRoute(makePath(selected, cursor), hovered ? '#f5dc76' : '#f0ead2', 0.95);
      ctx.strokeStyle = hovered ? '#f5dc76' : 'rgba(240,234,210,.65)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cursor.x, cursor.y, hovered ? 20 : 10, 0, Math.PI * 2); ctx.stroke();
    }

    // 京城：城墙、宫城与三个可调度的城门位。
    ctx.save();
    ctx.translate(city.x, city.y);
    ctx.fillStyle = 'rgba(35,49,39,.22)'; ctx.fillRect(-59, -31, 130, 82);
    ctx.fillStyle = '#d5c89e'; ctx.fillRect(-63, -42, 126, 84);
    ctx.strokeStyle = '#7f6742'; ctx.lineWidth = 7; ctx.strokeRect(-59, -38, 118, 76);
    ctx.fillStyle = '#88423d';
    ctx.fillRect(-32, -24, 64, 46);
    ctx.fillStyle = '#c7a34c'; ctx.fillRect(-37, -29, 74, 8);
    ctx.fillStyle = '#502f2a'; ctx.fillRect(-10, 1, 20, 21);
    ctx.fillStyle = '#f3e7be';
    ctx.font = 'bold 14px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('京 城', 0, -8);
    ctx.fillStyle = '#17222c'; ctx.fillRect(-36, -60, 72, 20);
    ctx.fillStyle = '#f0ead7'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('帝 都', 0, -49);
    ctx.restore();

    for (const crisis of crises) {
      const info = CRISIS_INFO[crisis.kind];
      const remaining = Math.max(0, 20 - crisis.age);
      const pulse = crisis.age > 14 ? 1 + Math.sin(elapsed * 8) * 0.18 : 1;
      ctx.save();
      ctx.translate(crisis.x, crisis.y);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = 'rgba(19,28,34,.2)'; ctx.fillRect(-18, -15, 43, 43);
      ctx.strokeStyle = '#f3ead2'; ctx.lineWidth = 3; ctx.globalAlpha = .75;
      ctx.beginPath();
      ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + (remaining / 20) * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = info.color;
      ctx.rotate(Math.PI / 4); ctx.fillRect(-13, -13, 26, 26); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#f3efe4';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.label, 0, 0);
      ctx.restore();

      const labelX = Math.min(width - 104, Math.max(8, crisis.x - 48));
      const labelY = crisis.y + 31;
      ctx.fillStyle = '#14202b'; ctx.fillRect(labelX, labelY, 96, 25);
      ctx.fillStyle = info.color; ctx.fillRect(labelX, labelY, 4, 25);
      ctx.fillStyle = '#f1ede0'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(info.name, labelX + 9, labelY + 11);
      ctx.fillStyle = '#aeb7b6'; ctx.font = '8px monospace';
      ctx.fillText(crisis.assignedTo === null ? `${remaining.toFixed(1)}秒 · 待命` : '名将处理中', labelX + 9, labelY + 20);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(labelX, labelY + 23, 96, 2);
      ctx.fillStyle = crisis.assignedTo === null ? info.color : '#e8cf73';
      ctx.fillRect(labelX, labelY + 23, 96 * (crisis.assignedTo === null ? remaining / 20 : crisis.progress), 2);
    }

    for (const general of generals) {
      const idle = general.state === 'idle';
      ctx.save();
      ctx.translate(general.x, general.y);
      ctx.fillStyle = 'rgba(25,35,30,.24)'; ctx.fillRect(-8, 5, 23, 8);
      ctx.fillStyle = selectedGeneral === general.id ? '#f0c94b' : idle ? '#1a2933' : '#263842';
      ctx.fillRect(-12, -13, 24, 26);
      ctx.fillStyle = selectedGeneral === general.id ? '#6f511a' : '#b7383e';
      ctx.fillRect(-12, -13, 24, 5);
      if (idle) {
        ctx.strokeStyle = selectedGeneral === general.id ? '#fff2ad' : 'rgba(243,234,210,.55)';
        ctx.lineWidth = 2; ctx.strokeRect(-16, -17, 32, 34);
      }
      ctx.fillStyle = '#f2eee3';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(general.name, 0, 1);
      ctx.restore();
    }

    for (const particle of particles) {
      ctx.globalAlpha = Math.min(1, particle.life * 2);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (crises.some((item) => item.age > 15)) {
      const urgency = Math.max(...crises.map((item) => item.age)) / 20;
      const gradient = ctx.createRadialGradient(width/2, height/2, Math.min(width,height)*.25, width/2, height/2, Math.max(width,height)*.68);
      gradient.addColorStop(0, 'rgba(118,28,31,0)');
      gradient.addColorStop(1, `rgba(118,28,31,${Math.max(0, urgency - .72) * .75})`);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,238,170,${flash * .13})`; ctx.fillRect(0, 0, width, height);
    }
  }

  function loop(now: number) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    update(dt);
    draw();
    if (now - lastHudUpdate > 100) {
      duration = elapsed;
      pace = elapsed > 0 ? (landings / elapsed) * 60 : 0;
      lastHudUpdate = now;
    }
    animationFrame = requestAnimationFrame(loop);
  }

  function pointerPosition(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent) {
    if (gameOver) return;
    cursor = pointerPosition(event);
    const general = generals.find((item) =>
      item.state === 'idle' && Math.hypot(item.x - cursor.x, item.y - cursor.y) <= 18
    );
    if (general) {
      selectedGeneral = general.id;
      canvas.setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent) {
    cursor = pointerPosition(event);
  }

  function onPointerUp(event: PointerEvent) {
    if (selectedGeneral === null) return;
    cursor = pointerPosition(event);
    const general = generals.find((item) => item.id === selectedGeneral);
    const crisis = crises.find((item) =>
      item.assignedTo === null && Math.hypot(item.x - cursor.x, item.y - cursor.y) <= 26
    );
    if (general && crisis) dispatch(general, crisis);
    selectedGeneral = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    resize();
    resetGame();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    animationFrame = requestAnimationFrame(loop);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  });
</script>

<svelte:head>
  <title>大一统帝国调度模拟器</title>
</svelte:head>

<main class="relative h-full w-full select-none overflow-hidden bg-[#78aa72] text-[#f2f0e8]">
  <canvas
    bind:this={canvas}
    class="h-full w-full touch-none cursor-crosshair [image-rendering:pixelated]"
    aria-label="帝国调度地图：拖动京城旁的名将方块至危机圆点"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  ></canvas>

  <section class="absolute left-3 top-3 w-[min(310px,calc(100vw-24px))] border-2 border-[#30414a] bg-[#111d29] shadow-[5px_6px_0_rgba(35,50,42,.24)] sm:left-5 sm:top-5">
    <div class="flex h-16 items-center justify-between border-b border-[#f4f0df]/25 px-4">
      <div>
        <p class="text-[9px] font-bold tracking-[0.26em] text-[#dfbf5d]">大一统 · 天命调度司</p>
        <h1 class="mt-1 text-base font-black tracking-[0.08em]">帝国军机战报</h1>
      </div>
      <div class="flex gap-1.5">
        <button
          onclick={() => { paused = !paused; lastTime = performance.now(); }}
          class="grid size-9 place-items-center border border-[#edf0e8]/20 bg-[#edf0e8] text-sm font-black text-[#111d29] transition hover:bg-[#dfbf5d]"
          aria-label={paused ? '继续游戏' : '暂停游戏'}
        >{paused ? '▶' : 'Ⅱ'}</button>
        <button onclick={resetGame} class="grid size-9 place-items-center border border-[#edf0e8]/20 text-lg transition hover:bg-white/10" aria-label="重新开始">↻</button>
      </div>
    </div>

    <div class="grid grid-cols-[40px_1fr_auto] items-center border-b border-[#f4f0df]/20 px-3 py-2.5">
      <span class="grid size-8 place-items-center bg-[#edf0e8] text-base font-black text-[#111d29]">定</span>
      <div class="pl-3"><b class="block text-sm">已平定</b><small class="text-[9px] text-[#9ca9ac]">累计处置危机</small></div>
      <strong class="text-2xl tabular-nums">{landings}</strong>
    </div>
    <div class="grid grid-cols-[40px_1fr_auto] items-center border-b border-[#f4f0df]/20 px-3 py-2.5">
      <span class="grid size-8 place-items-center bg-[#dfbf5d] text-base font-black text-[#111d29]">令</span>
      <div class="pl-3"><b class="block text-sm">军令效率</b><small class="text-[9px] text-[#9ca9ac]">每分钟平定数</small></div>
      <strong class="text-xl tabular-nums">{pace.toFixed(1)}<i class="ml-1 text-[9px] not-italic text-[#9ca9ac]">/分</i></strong>
    </div>
    <div class="grid grid-cols-[40px_1fr_auto] items-center border-b border-[#f4f0df]/20 px-3 py-2.5">
      <span class="grid size-8 place-items-center bg-[#edf0e8] text-base font-black text-[#111d29]">命</span>
      <div class="pl-3"><b class="block text-sm">国运</b><small class="text-[9px] text-[#9ca9ac]">王朝维持时间</small></div>
      <strong class="text-xl tabular-nums">{formatTime(duration)}</strong>
    </div>
    <div class="grid grid-cols-[40px_1fr_auto] items-center px-3 py-2.5">
      <span class="grid size-8 place-items-center bg-[#b9383e] text-base font-black">将</span>
      <div class="pl-3"><b class="block text-sm">京城待命</b><small class="text-[9px] text-[#9ca9ac]">拖动将旗发出军令</small></div>
      <strong class="text-xl tabular-nums">{generals.filter((item) => item.state === 'idle').length}<i class="ml-1 text-[9px] not-italic text-[#9ca9ac]">/ 3</i></strong>
    </div>
  </section>

  <aside class="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100vw-24px)] flex-wrap gap-px border-2 border-[#30414a] bg-[#111d29] p-1 text-[9px] font-bold tracking-[0.08em] shadow-[4px_5px_0_rgba(35,50,42,.2)] sm:bottom-5 sm:left-5">
    <span class="px-2.5 py-2"><i class="mr-1.5 inline-block size-2 bg-[#b9383e]"></i>叛乱 · 7秒</span>
    <span class="px-2.5 py-2"><i class="mr-1.5 inline-block size-2 bg-[#d39a2d]"></i>饥荒 · 5秒</span>
    <span class="px-2.5 py-2"><i class="mr-1.5 inline-block size-2 bg-[#347c91]"></i>贪腐 · 3秒</span>
  </aside>

  {#if elapsed < 8 && landings === 0 && !gameOver}
    <div class="pointer-events-none absolute bottom-16 right-4 border border-[#f4f0df]/25 bg-[#111d29]/95 px-4 py-3 text-right shadow-[4px_5px_0_rgba(35,50,42,.2)] sm:bottom-5 sm:right-5">
      <p class="text-[9px] font-bold tracking-[0.24em] text-[#dfbf5d]">第一道军令</p>
      <p class="mt-1 text-xs font-bold">从京城拖动一面将旗，连接到危机</p>
    </div>
  {/if}

  {#if paused && !gameOver}
    <div class="pointer-events-none absolute inset-0 grid place-items-center bg-[#111d29]/20 backdrop-blur-[1px]">
      <div class="border-2 border-[#30414a] bg-[#111d29] px-8 py-5 text-center shadow-[6px_7px_0_rgba(35,50,42,.3)]">
        <p class="text-[9px] tracking-[0.3em] text-[#dfbf5d]">军机暂歇</p>
        <p class="mt-2 text-xl font-black tracking-[0.2em]">时局暂停</p>
      </div>
    </div>
  {/if}

  {#if gameOver}
    <section class="absolute inset-0 grid place-items-center bg-[#111d29]/55 backdrop-blur-[2px]">
      <div class="w-[min(88vw,410px)] border-2 border-[#30414a] bg-[#111d29] p-8 text-center shadow-[8px_9px_0_rgba(35,50,42,.4)]">
        <p class="text-[10px] font-bold tracking-[0.3em] text-[#d84a50]">天命已失</p>
        <h2 class="mt-3 text-3xl font-black tracking-[0.2em]">山 河 失 序</h2>
        <p class="mt-5 text-xs leading-6 text-[#aeb8b8]">一道急报延宕超过二十秒，朝廷失去天下人心。</p>
        <div class="mx-auto mt-6 grid max-w-[280px] grid-cols-3 border-y border-[#f4f0df]/20 py-4">
          <div><b class="block text-xl">{landings}</b><span class="text-[9px] text-[#8f9d9f]">已平定</span></div>
          <div><b class="block text-xl">{pace.toFixed(1)}</b><span class="text-[9px] text-[#8f9d9f]">效率</span></div>
          <div><b class="block text-xl">{formatTime(duration)}</b><span class="text-[9px] text-[#8f9d9f]">国运</span></div>
        </div>
        <button onclick={resetGame} class="mt-7 border-2 border-[#e7c55f] bg-[#e7c55f] px-8 py-3 text-[10px] font-black tracking-[0.2em] text-[#111d29] transition hover:bg-transparent hover:text-[#e7c55f]">
          再整山河
        </button>
      </div>
    </section>
  {/if}
</main>
