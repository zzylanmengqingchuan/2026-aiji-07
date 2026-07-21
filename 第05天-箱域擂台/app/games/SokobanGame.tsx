"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSokobanState,
  gridKey,
  moveSokoban,
  SOKOBAN_LEVELS,
  type GridDirection,
  type SokobanState,
} from "../game/sokoban";

const KEY_DIRECTION: Record<string, GridDirection> = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
};

export default function SokobanGame() {
  const [state, setState] = useState(() => createSokobanState(0));
  const [history, setHistory] = useState<SokobanState[]>([]);
  const [best, setBest] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    const saved = window.localStorage.getItem("game-room-sokoban-best");
    if (!saved) return {};
    try { return JSON.parse(saved); } catch { return {}; }
  });
  const definition = SOKOBAN_LEVELS[state.level];

  const move = useCallback((direction: GridDirection) => {
    setState((current) => {
      const next = moveSokoban(current, direction);
      if (next === current) return current;
      setHistory((old) => [...old, current].slice(-120));
      if (next.won) {
        setBest((old) => {
          const key = String(next.level);
          const record = old[key] ? Math.min(old[key], next.pushes) : next.pushes;
          const updated = { ...old, [key]: record };
          window.localStorage.setItem("game-room-sokoban-best", JSON.stringify(updated));
          return updated;
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = KEY_DIRECTION[event.key];
      if (!direction) return;
      event.preventDefault();
      if (!event.repeat) move(direction);
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  const reset = useCallback((level = state.level) => {
    setState(createSokobanState(level));
    setHistory([]);
  }, [state.level]);

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setState(previous);
    setHistory((old) => old.slice(0, -1));
  };

  const cells = useMemo(() => Array.from({ length: state.width * state.height }, (_, index) => ({
    row: Math.floor(index / state.width), col: index % state.width,
  })), [state.height, state.width]);

  return (
    <section className="sokoban-game">
      <div className="game-intro">
        <div><span className="game-kicker">经典推箱 · 三关</span><h2>慢一点，<em>想清楚再推。</em></h2></div>
        <p>方向键或字母键移动。把所有木箱推进发光仓位，走错可以撤回。</p>
      </div>

      <div className="sokoban-layout">
        <div className="sokoban-board-wrap">
          <div className="sokoban-toolbar">
            <div><span>关卡 {state.level + 1} / {SOKOBAN_LEVELS.length}</span><strong>{definition.name}</strong></div>
            <div><button onClick={undo} disabled={!history.length}>撤回一步</button><button onClick={() => reset()}>重新开始</button></div>
          </div>
          <div
            className="sokoban-board"
            role="application"
            aria-label="经典推箱子棋盘"
            style={{ gridTemplateColumns: `repeat(${state.width}, 1fr)` }}
          >
            {cells.map((cell) => {
              const key = gridKey(cell);
              const wall = state.walls.has(key);
              const goal = state.goals.has(key);
              const box = state.boxes.some((item) => gridKey(item) === key);
              const player = gridKey(state.player) === key;
              return <div key={key} className={`soko-cell ${wall ? "wall" : "floor"} ${goal ? "goal" : ""}`}>
                {goal && <i className="soko-goal" />}
                {box && <span className={`soko-box ${goal ? "parked" : ""}`}><i /></span>}
                {player && <span className="soko-player">你</span>}
              </div>;
            })}
            {state.won && <div className="soko-win"><span>仓库清空</span><strong>{state.pushes} 推完成</strong><button onClick={() => reset((state.level + 1) % SOKOBAN_LEVELS.length)}>下一关</button></div>}
          </div>
        </div>

        <aside className="sokoban-side">
          <span className="side-label">本关记录</span>
          <div className="soko-stat"><strong>{state.moves}</strong><span>移动</span></div>
          <div className="soko-stat"><strong>{state.pushes}</strong><span>推动</span></div>
          <div className="soko-stat"><strong>{best[String(state.level)] ?? "—"}</strong><span>最少推动</span></div>
          <p>{definition.hint}</p>
          <div className="level-buttons">{SOKOBAN_LEVELS.map((level, index) => <button key={level.name} className={index === state.level ? "active" : ""} onClick={() => reset(index)}>{index + 1}</button>)}</div>
          <div className="direction-pad compact">
            <button onClick={() => move("up")} aria-label="向上">↑</button>
            <button onClick={() => move("left")} aria-label="向左">←</button>
            <button onClick={() => move("down")} aria-label="向下">↓</button>
            <button onClick={() => move("right")} aria-label="向右">→</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
