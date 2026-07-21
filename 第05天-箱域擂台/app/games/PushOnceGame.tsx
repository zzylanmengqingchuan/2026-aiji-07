"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  countCrates,
  createLevel,
  launchPusher,
  powerFromHold,
  stepPhysics,
  type Body,
} from "../game/engine";

type Phase = "aiming" | "moving" | "cleared" | "game-over";

function useGameSounds() {
  const contextRef = useRef<AudioContext | null>(null);
  const lastHitRef = useRef(0);

  const tone = useCallback((frequency: number, duration: number, gain = 0.045, delay = 0) => {
    if (typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext;
    const context = contextRef.current ?? new AudioContextClass();
    contextRef.current = context;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay);
    volume.gain.setValueAtTime(gain, context.currentTime + delay);
    volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(context.currentTime + delay);
    oscillator.stop(context.currentTime + delay + duration);
  }, []);

  return useMemo(() => ({
    hit() {
      const now = performance.now();
      if (now - lastHitRef.current < 75) return;
      lastHitRef.current = now;
      tone(150, 0.07, 0.035);
    },
    sink(chain: number) {
      tone(410 + chain * 75, 0.18, 0.055);
      tone(620 + chain * 90, 0.22, 0.04, 0.06);
    },
    launch() { tone(120, 0.16, 0.06); },
    perfect() { [0, 1, 2, 3].forEach((index) => tone(440 + index * 120, 0.24, 0.045, index * 0.08)); },
    fail() { tone(150, 0.42, 0.055); },
  }), [tone]);
}

export default function PushOnceGame() {
  const [stage, setStage] = useState(1);
  const [level, setLevel] = useState(() => createLevel(1));
  const [bodies, setBodies] = useState<Body[]>(level.bodies);
  const bodiesRef = useRef(bodies);
  const [phase, setPhase] = useState<Phase>("aiming");
  const [charging, setCharging] = useState(false);
  const chargeStartRef = useRef(0);
  const [power, setPower] = useState(0);
  const [angle, setAngle] = useState(0);
  const angleRef = useRef(0);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [best, setBest] = useState(0);
  const [combo, setCombo] = useState(0);
  const [message, setMessage] = useState("按住场地蓄力，松手推出");
  const [shake, setShake] = useState(false);
  const sounds = useGameSounds();

  const pusher = bodies.find((body) => body.kind === "pusher") ?? bodies[0];
  const totalCrates = countCrates(bodies);
  const sunkCrates = bodies.filter((body) => body.kind === "crate" && body.sunk).length;

  useEffect(() => {
    bodiesRef.current = bodies;
  }, [bodies]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("push-once-best") ?? 0);
    const timer = window.setTimeout(() => {
      if (Number.isFinite(saved)) setBest(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    angleRef.current = angle;
  }, [angle]);

  const aimAt = useCallback((clientX: number, clientY: number, target: HTMLElement) => {
    if (phase !== "aiming" || charging) return;
    const rect = target.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * FIELD_WIDTH;
    const y = (clientY - rect.top) / rect.height * FIELD_HEIGHT;
    const next = Math.atan2(y - pusher.y, x - pusher.x);
    setAngle(Math.max(-1.25, Math.min(1.25, next)));
  }, [charging, phase, pusher.x, pusher.y]);

  const beginCharge = useCallback((clientX?: number, clientY?: number, target?: HTMLElement) => {
    if (phase !== "aiming" || charging) return;
    if (clientX !== undefined && clientY !== undefined && target) {
      const rect = target.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width * FIELD_WIDTH;
      const y = (clientY - rect.top) / rect.height * FIELD_HEIGHT;
      const next = Math.atan2(y - pusher.y, x - pusher.x);
      const clamped = Math.max(-1.25, Math.min(1.25, next));
      angleRef.current = clamped;
      setAngle(clamped);
    }
    chargeStartRef.current = performance.now();
    setPower(0.08);
    setCharging(true);
    setMessage("松手！");
  }, [charging, phase, pusher.x, pusher.y]);

  const release = useCallback(() => {
    if (!charging || phase !== "aiming") return;
    const finalPower = powerFromHold(performance.now() - chargeStartRef.current);
    const launched = launchPusher(bodiesRef.current, angleRef.current, finalPower);
    bodiesRef.current = launched;
    setBodies(launched);
    setPower(finalPower);
    setCharging(false);
    setPhase("moving");
    setMessage("看它们撞起来");
    sounds.launch();
  }, [charging, phase, sounds]);

  useEffect(() => {
    if (!charging) return;
    let frame = 0;
    const update = () => {
      setPower(powerFromHold(performance.now() - chargeStartRef.current));
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [charging]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      beginCharge();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      release();
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [beginCharge, release]);

  useEffect(() => {
    if (phase !== "moving") return;
    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    let quietFor = 0;
    let chain = 0;

    const finish = () => {
      const current = bodiesRef.current;
      const sunk = current.filter((body) => body.kind === "crate" && body.sunk).length;
      const total = countCrates(current);
      if (sunk === 0) {
        setPhase("game-over");
        setMessage("差一点，再来一次");
        setBest((oldBest) => {
          const nextBest = Math.max(oldBest, scoreRef.current);
          window.localStorage.setItem("push-once-best", String(nextBest));
          return nextBest;
        });
        sounds.fail();
        return;
      }
      const perfect = sunk === total;
      if (perfect) {
        const bonus = stage * 50;
        setScore((value) => {
          scoreRef.current = value + bonus;
          return scoreRef.current;
        });
        setMessage(`完美清场 +${bonus}`);
        sounds.perfect();
      } else {
        setMessage(`推进 ${sunk} 个，过关`);
      }
      setPhase("cleared");
    };

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      elapsed += dt;
      const result = stepPhysics(bodiesRef.current, level.holes, dt);
      bodiesRef.current = result.bodies;
      setBodies(result.bodies);
      if (result.collisions > 0) {
        sounds.hit();
        setShake(true);
        window.setTimeout(() => setShake(false), 90);
      }
      for (let index = 0; index < result.sunkIds.length; index += 1) {
        chain += 1;
        const earned = 10 * stage * chain;
        setCombo(chain);
        setScore((value) => {
          scoreRef.current = value + earned;
          return scoreRef.current;
        });
        setMessage(chain > 1 ? `${chain} 连进！ +${earned}` : `进了！ +${earned}`);
        sounds.sink(chain);
      }
      quietFor = result.moving ? 0 : quietFor + dt;
      if ((elapsed > 0.8 && quietFor > 0.38) || elapsed > 6.5) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level.holes, phase, sounds, stage]);

  useEffect(() => {
    if (phase !== "cleared") return;
    const timer = window.setTimeout(() => {
      const nextStage = stage + 1;
      const nextLevel = createLevel(nextStage);
      setStage(nextStage);
      setLevel(nextLevel);
      setBodies(nextLevel.bodies);
      bodiesRef.current = nextLevel.bodies;
      setPhase("aiming");
      setPower(0);
      setCombo(0);
      setAngle(0);
      setMessage("按住场地蓄力，松手推出");
    }, 1250);
    return () => window.clearTimeout(timer);
  }, [phase, stage]);

  const restart = () => {
    const first = createLevel(1);
    setStage(1);
    setLevel(first);
    setBodies(first.bodies);
    bodiesRef.current = first.bodies;
    setPhase("aiming");
    setScore(0);
    scoreRef.current = 0;
    setCombo(0);
    setPower(0);
    setAngle(0);
    setCharging(false);
    setMessage("按住场地蓄力，松手推出");
  };

  const trajectory = [0, 1, 2, 3, 4].map((index) => {
    const distance = 68 + index * 48;
    return {
      left: `${(pusher.x + Math.cos(angle) * distance) / FIELD_WIDTH * 100}%`,
      top: `${(pusher.y + Math.sin(angle) * distance) / FIELD_HEIGHT * 100}%`,
    };
  });

  return (
    <section className={`push-once ${shake ? "is-shaking" : ""}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-box" /><div><strong>推一下</strong><small>一次就够了</small></div></div>
        <div className="scoreboard">
          <span><small>本次得分</small><strong>{score}</strong></span>
          <i />
          <span><small>最高纪录</small><strong>{Math.max(best, score)}</strong></span>
        </div>
        <button className="restart-link" onClick={restart}>重新开始</button>
      </header>

      <section className="game-shell">
        <div className="game-heading">
          <div><span className="eyebrow">第 {stage} 关 · {level.name}</span><h1>按住。松手。<em>看它撞。</em></h1></div>
          <p>{level.hint}<br />进一个就过关，全部进洞就是完美。</p>
        </div>

        <div
          className={`playfield phase-${phase} ${charging ? "is-charging" : ""}`}
          role="application"
          aria-label="推箱游戏场地"
          onPointerMove={(event) => aimAt(event.clientX, event.clientY, event.currentTarget)}
          onPointerDown={(event) => {
            if (phase !== "aiming") return;
            event.currentTarget.setPointerCapture(event.pointerId);
            beginCharge(event.clientX, event.clientY, event.currentTarget);
          }}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <div className="field-grid" />
          <div className="field-number">{String(stage).padStart(2, "0")}</div>

          {level.holes.map((hole, index) => (
            <div key={index} className="goal-hole" style={{
              left: `${hole.x / FIELD_WIDTH * 100}%`,
              top: `${hole.y / FIELD_HEIGHT * 100}%`,
              width: `${hole.radius * 2 / FIELD_WIDTH * 100}%`,
              aspectRatio: "1",
            }}><span>进这里</span></div>
          ))}

          {phase === "aiming" && trajectory.map((style, index) => <i key={index} className="trajectory-dot" style={style} />)}

          {bodies.map((body) => (
            <div
              key={body.id}
              className={`${body.kind === "pusher" ? "pusher" : "crate"} ${body.sunk ? "is-sunk" : ""}`}
              style={{
                left: `${body.x / FIELD_WIDTH * 100}%`,
                top: `${body.y / FIELD_HEIGHT * 100}%`,
                width: `${body.radius * 2 / FIELD_WIDTH * 100}%`,
                aspectRatio: "1",
                transform: `translate(-50%, -50%) ${body.kind === "pusher" && charging ? `scaleX(${1 - power * 0.22}) scaleY(${1 + power * 0.2})` : ""}`,
              }}
            >{body.kind === "crate" && <><i /><b /></>}</div>
          ))}

          <div className={`game-message ${combo > 1 ? "combo" : ""}`}><strong>{message}</strong><small>{phase === "aiming" ? "鼠标移动瞄准 · 也可按空格蓄力" : `${sunkCrates} / ${totalCrates} 个箱子进洞`}</small></div>

          <div className="power-wrap" aria-label={`蓄力${Math.round(power * 100)}%`}>
            <span>力度</span><div><i style={{ width: `${power * 100}%` }} /></div><strong>{Math.round(power * 100)}</strong>
          </div>

          {phase === "game-over" && (
            <div className="result-card">
              <span>本次结束</span><strong>{score}</strong><p>第 {stage} 关差一点进洞</p>
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  restart();
                }}
                onClick={restart}
              >再推一次</button>
            </div>
          )}
          {phase === "cleared" && <div className="clear-flash"><span>{sunkCrates === totalCrates ? "完美！" : "过关！"}</span></div>}
        </div>

        <div className="single-rule">
          <div><span>一</span><strong>移动鼠标</strong><p>瞄准你想撞的位置</p></div>
          <i />
          <div><span>二</span><strong>按住蓄力</strong><p>短按轻推，长按猛推</p></div>
          <i />
          <div><span>三</span><strong>松手看戏</strong><p>连锁越多，得分越高</p></div>
        </div>
      </section>

      <footer><strong>推一下</strong><p>没有道具，没有技能，只有这一下。</p><span>最高纪录会保存在当前设备</span></footer>
    </section>
  );
}
