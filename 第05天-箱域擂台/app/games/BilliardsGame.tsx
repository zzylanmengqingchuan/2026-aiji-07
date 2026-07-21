"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BALL_RADIUS,
  createPoolBalls,
  launchCueBall,
  POCKET_RADIUS,
  POCKETS,
  predictRailPath,
  RAIL,
  respotCueBall,
  stepPoolPhysics,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  type PoolBall,
} from "../game/billiards";

type PoolPhase = "aiming" | "moving" | "cleared";

function usePoolSounds() {
  const context = useRef<AudioContext | null>(null);
  return useCallback((frequency: number, duration = 0.06) => {
    const audio = context.current ?? new AudioContext();
    context.current = audio;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + duration);
  }, []);
}

export default function BilliardsGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [balls, setBalls] = useState<PoolBall[]>(() => createPoolBalls());
  const ballsRef = useRef(balls);
  const [phase, setPhase] = useState<PoolPhase>("aiming");
  const [angle, setAngle] = useState(0);
  const angleRef = useRef(0);
  const [charging, setCharging] = useState(false);
  const chargeStart = useRef(0);
  const [power, setPower] = useState(0.35);
  const [shots, setShots] = useState(0);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState("移动鼠标瞄准，按住蓄力");
  const [foul, setFoul] = useState(false);
  const sound = usePoolSounds();
  const cue = balls.find((ball) => ball.cue) ?? balls[0];
  const remaining = balls.filter((ball) => !ball.cue && !ball.sunk).length;
  const path = useMemo(() => predictRailPath({ x: cue.x, y: cue.y }, angle, 2), [angle, cue.x, cue.y]);

  useEffect(() => { ballsRef.current = balls; }, [balls]);
  useEffect(() => { angleRef.current = angle; }, [angle]);

  const pointFromEvent = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * TABLE_WIDTH, y: (clientY - rect.top) / rect.height * TABLE_HEIGHT };
  };

  const aim = (clientX: number, clientY: number) => {
    if (phase !== "aiming" || charging || cue.sunk) return;
    const point = pointFromEvent(clientX, clientY);
    const next = Math.atan2(point.y - cue.y, point.x - cue.x);
    angleRef.current = next;
    setAngle(next);
  };

  const beginCharge = (clientX: number, clientY: number, pointerId: number) => {
    if (phase !== "aiming" || charging || cue.sunk) return;
    aim(clientX, clientY);
    canvasRef.current?.setPointerCapture(pointerId);
    chargeStart.current = performance.now();
    setCharging(true);
    setMessage("松手击球");
  };

  const release = () => {
    if (!charging || phase !== "aiming") return;
    const finalPower = Math.min(1, 0.18 + (performance.now() - chargeStart.current) / 1200);
    const launched = launchCueBall(ballsRef.current, angleRef.current, finalPower);
    ballsRef.current = launched;
    setBalls(launched);
    setPower(finalPower);
    setCharging(false);
    setShots((value) => value + 1);
    setFoul(false);
    setPhase("moving");
    setMessage("看球路");
    sound(120, 0.1);
  };

  useEffect(() => {
    if (!charging) return;
    let frame = 0;
    const tick = () => {
      setPower(Math.min(1, 0.18 + (performance.now() - chargeStart.current) / 1200));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [charging]);

  useEffect(() => {
    if (phase !== "moving") return;
    let frame = 0;
    let last = performance.now();
    let hitCooldown = 0;
    const tick = (now: number) => {
      const result = stepPoolPhysics(ballsRef.current, (now - last) / 1000);
      last = now;
      ballsRef.current = result.balls;
      setBalls(result.balls);
      if (result.collisions && now - hitCooldown > 80) { sound(185); hitCooldown = now; }
      if (result.sunkIds.length) {
        const cueSunk = result.sunkIds.includes(0);
        const objectCount = result.sunkIds.filter((id) => id !== 0).length;
        if (cueSunk) { setFoul(true); setMessage("白球落袋，罚分并复位"); setScore((value) => Math.max(0, value - 50)); }
        if (objectCount) { setScore((value) => value + objectCount * 100); setMessage(`${objectCount} 球落袋！`); sound(520, 0.16); }
      }
      if (!result.moving) {
        let settled = result.balls;
        if (settled.find((ball) => ball.cue)?.sunk) settled = respotCueBall(settled);
        const left = settled.filter((ball) => !ball.cue && !ball.sunk).length;
        ballsRef.current = settled;
        setBalls(settled);
        if (left === 0) { setPhase("cleared"); setMessage("清台完成"); }
        else { setPhase("aiming"); setPower(0.35); setMessage("移动鼠标瞄准，按住蓄力"); }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, sound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = TABLE_WIDTH * ratio;
    canvas.height = TABLE_HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

    context.fillStyle = "#342116";
    context.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
    context.fillStyle = "#124f3d";
    context.fillRect(RAIL, RAIL, TABLE_WIDTH - RAIL * 2, TABLE_HEIGHT - RAIL * 2);
    context.strokeStyle = "rgba(255,255,255,.08)";
    context.lineWidth = 2;
    context.strokeRect(RAIL + 10, RAIL + 10, TABLE_WIDTH - RAIL * 2 - 20, TABLE_HEIGHT - RAIL * 2 - 20);
    for (const pocket of POCKETS) {
      context.beginPath(); context.arc(pocket.x, pocket.y, POCKET_RADIUS + 5, 0, Math.PI * 2);
      context.fillStyle = "#080a08"; context.fill();
      context.strokeStyle = "#b88b55"; context.lineWidth = 4; context.stroke();
    }

    if (phase === "aiming" && !cue.sunk) {
      context.beginPath();
      context.moveTo(path[0].x, path[0].y);
      path.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.strokeStyle = "rgba(255,255,255,.78)";
      context.lineWidth = 2;
      context.setLineDash([10, 10]);
      context.stroke();
      context.setLineDash([]);
      path.slice(1).forEach((point, index) => {
        context.beginPath(); context.arc(point.x, point.y, index === 0 ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = index === 0 ? "#f5cf35" : "rgba(255,255,255,.7)"; context.fill();
      });
      const pull = 28 + power * 62;
      context.beginPath();
      context.moveTo(cue.x - Math.cos(angle) * pull, cue.y - Math.sin(angle) * pull);
      context.lineTo(cue.x - Math.cos(angle) * (pull + 180), cue.y - Math.sin(angle) * (pull + 180));
      context.strokeStyle = "#e8c38e"; context.lineWidth = 8; context.stroke();
    }

    for (const ball of balls) {
      if (ball.sunk) continue;
      context.save();
      context.translate(ball.x, ball.y);
      context.beginPath(); context.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      context.fillStyle = ball.color; context.fill();
      if (ball.stripe) {
        context.fillStyle = "#f5f2e9"; context.fillRect(-BALL_RADIUS, -5, BALL_RADIUS * 2, 10);
      }
      context.beginPath(); context.arc(-4, -5, 3.2, 0, Math.PI * 2); context.fillStyle = "rgba(255,255,255,.72)"; context.fill();
      context.strokeStyle = "rgba(0,0,0,.55)"; context.lineWidth = 1.5; context.stroke();
      if (!ball.cue) {
        context.beginPath(); context.arc(0, 0, 5.5, 0, Math.PI * 2); context.fillStyle = "#f7f5ec"; context.fill();
        context.fillStyle = "#171816"; context.font = "bold 7px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(String(ball.id), 0, .5);
      }
      context.restore();
    }
  }, [angle, balls, cue.sunk, cue.x, cue.y, path, phase, power]);

  const restart = () => {
    const next = createPoolBalls();
    ballsRef.current = next;
    setBalls(next); setPhase("aiming"); setShots(0); setScore(0); setPower(.35); setFoul(false); setMessage("移动鼠标瞄准，按住蓄力");
  };

  return (
    <section className="billiards-game">
      <div className="game-intro dark-intro">
        <div><span className="game-kicker">六袋台球 · 单人清台</span><h2>看准线路，<em>一杆多进。</em></h2></div>
        <p>白色虚线会提前画出碰库反弹路线。按住球桌蓄力，松手击球。</p>
      </div>
      <div className="pool-panel">
        <div className="pool-status">
          <span><small>得分</small><strong>{score}</strong></span>
          <span><small>杆数</small><strong>{shots}</strong></span>
          <span><small>剩余</small><strong>{remaining}</strong></span>
          <p className={foul ? "foul" : ""}>{message}</p>
          <button onClick={restart}>重新摆球</button>
        </div>
        <canvas
          ref={canvasRef}
          className="pool-table"
          role="application"
          aria-label="六袋台球桌"
          onPointerMove={(event) => aim(event.clientX, event.clientY)}
          onPointerDown={(event) => beginCharge(event.clientX, event.clientY, event.pointerId)}
          onPointerUp={release}
          onPointerCancel={release}
        />
        <div className="pool-power"><span>击球力度</span><div><i style={{ width: `${power * 100}%` }} /></div><strong>{Math.round(power * 100)}</strong></div>
        {phase === "cleared" && <div className="pool-clear"><span>清台成功</span><strong>{shots} 杆 · {score} 分</strong><button onClick={restart}>再来一局</button></div>}
      </div>
      <div className="pool-rules"><span>① 鼠标指向决定角度</span><span>② 虚线显示三段反弹轨迹</span><span>③ 所有彩球落袋即完成</span></div>
    </section>
  );
}
