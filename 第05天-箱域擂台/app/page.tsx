"use client";

import { useState } from "react";
import BilliardsGame from "./games/BilliardsGame";
import PushOnceGame from "./games/PushOnceGame";
import SokobanGame from "./games/SokobanGame";

type GameId = "sokoban" | "push-once" | "billiards";

const GAMES: { id: GameId; number: string; title: string; subtitle: string; description: string; accent: string }[] = [
  { id: "sokoban", number: "01", title: "推箱子", subtitle: "想清楚，再推动", description: "三张手工关卡，支持撤回、重开和最少推动记录。", accent: "#ffcc38" },
  { id: "push-once", number: "02", title: "推一下", subtitle: "蓄好力，看连锁", description: "控制角度与力度，只用一次推动制造连锁进洞。", accent: "#ff6138" },
  { id: "billiards", number: "03", title: "六袋台球", subtitle: "算球路，一杆清台", description: "真实碰球、碰库反弹和三段预测轨迹。", accent: "#43c993" },
];

export default function Home() {
  const [activeGame, setActiveGame] = useState<GameId>("sokoban");
  const current = GAMES.find((game) => game.id === activeGame)!;

  return (
    <main className="arcade-page">
      <header className="arcade-header">
        <button className="arcade-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <span className="arcade-logo"><i /><b /></span>
          <span><strong>箱游室</strong><small>三个规则，一页开玩</small></span>
        </button>
        <nav aria-label="小游戏切换">
          {GAMES.map((game) => <button key={game.id} className={game.id === activeGame ? "active" : ""} onClick={() => setActiveGame(game.id)}>{game.title}</button>)}
        </nav>
        <span className="header-note">无需登录 · 记录保存在本机</span>
      </header>

      <section className="arcade-hero">
        <span className="hero-kicker">三款物理与空间小游戏</span>
        <h1>选一个，<em>马上玩。</em></h1>
        <p>不学技能树，不背道具表。每个游戏只突出一个好玩的动作。</p>
      </section>

      <section className="game-selector" aria-label="选择小游戏">
        {GAMES.map((game) => (
          <button
            key={game.id}
            className={`game-card card-${game.id} ${game.id === activeGame ? "active" : ""}`}
            onClick={() => setActiveGame(game.id)}
            style={{ "--card-accent": game.accent } as React.CSSProperties}
          >
            <span className="card-number">{game.number}</span>
            <span className="card-art" aria-hidden="true">
              {game.id === "sokoban" && <><i className="mini-wall" /><i className="mini-box" /><i className="mini-goal" /><i className="mini-person" /></>}
              {game.id === "push-once" && <><i className="mini-pusher" /><i className="mini-crate one" /><i className="mini-crate two" /><i className="mini-hole" /></>}
              {game.id === "billiards" && <><i className="mini-pocket" /><i className="mini-ball white" /><i className="mini-ball yellow" /><i className="mini-ball red" /><b /></>}
            </span>
            <span className="card-copy"><small>{game.subtitle}</small><strong>{game.title}</strong><p>{game.description}</p></span>
            <span className="card-action">{game.id === activeGame ? "正在玩" : "开始游戏"}<i>→</i></span>
          </button>
        ))}
      </section>

      <section className="active-game" id="game-stage">
        <div className="active-game-label"><span>{current.number}</span><strong>{current.title}</strong><i /></div>
        {activeGame === "sokoban" && <SokobanGame />}
        {activeGame === "push-once" && <PushOnceGame />}
        {activeGame === "billiards" && <BilliardsGame />}
      </section>

      <footer className="arcade-footer"><strong>箱游室</strong><p>想推箱时推箱，想算线路时算线路。</p><span>三款游戏均支持鼠标或触屏</span></footer>
    </main>
  );
}
