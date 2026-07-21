# 坦克动荡 · Tank Trouble Arena

经典 Tank Trouble 玩法的 3D 网页复刻（台球桌版）：两辆坦克在空旷矩形台球桌上对战，四周砖墙是库边；直射无效——炮弹必须撞墙反弹至少 1 次才有杀伤力，也可能命中射手自己。支持浏览器玩家、REST/WebSocket Agent 和固定全场观战。

## 规则

| 项目 | 规则 |
|---|---|
| 人数 | 1v1，满 2 人自动开局；固定对角出生点 (±38, ±38) |
| 场地 | 空旷 ±55 台球桌，四周边框墙（库边），无迷宫墙/房屋 |
| 生命 | 每把 3 血，致命炮弹命中均扣 1 血，包含自己的反弹弹 |
| 直射 | 直射无效：炮弹撞墙反弹至少 1 次后才致命，未反弹的炮弹直接穿过坦克 |
| 胜负 | 一方被击毁，另一方得 1 分；先得 5 分获胜 |
| 时间 | 每把最多 5 分钟，超时双方不得分 |
| 炮弹 | 每人同时最多 3 发，最多反弹 8 次，最长存活 6 秒 |
| 操作 | WASD 按屏幕方向移动，鼠标瞄准，左键或空格开火 |
| 视角 | 固定斜俯瞰，全场始终一屏可见；玩家和观战使用同一机位 |

## 快速开始

```bash
cd /Users/zzy/tank-trouble
npm install
npm start
```

打开 `http://localhost:3100`。端口可用 `PORT=3200 npm start` 覆盖。

常用入口：

- 人类加入：`http://HOST:3100/?room=ABCD&autojoin=1`
- 观战：`http://HOST:3100/?room=ABCD&spectate=1`
- Agent 文档：`http://HOST:3100/api/v1/docs`

## Agent

权威状态由服务端以 20Hz 模拟。`state` 会下发 `walls`（台球桌版固定为空数组）、`mazeSeed`（固定 null），以及带 `dx`、`dz`、`bounces` 的炮弹数据（`bounces >= 1` 的炮弹才有杀伤力），Agent 可以据此预测反弹。

```bash
node examples/agent_random.js http://127.0.0.1:3100
node examples/agent_bounce.js http://127.0.0.1:3100 ABCD
```

完整接入说明见 [AGENT.md](./AGENT.md)。

## 验证

```bash
npm run test:motion
```

测试会启动隔离端口、创建两个 REST Agent、打开 Playwright 观战页，并检查前端运行错误、固定全场镜头、对局结算、平均帧率与 P95 帧耗时。结果与截图写入 `reports/`。

## 主要文件

```text
server.js                  房间、权威物理、台球桌反弹与先得 5 分赛制
maze.js                    随机迷宫生成器（台球桌版未使用，保留待用）
public/index.html          Three.js 客户端与固定全场机位
examples/agent_random.js   随机游走 Agent
examples/agent_bounce.js   弹道感知闪避 Agent
scripts/perf-motion.mjs    端到端与性能验收
DEPLOY.md                  部署准备说明（不自动部署）
```

## 许可证

底座项目源自学习用途的 3D 坦克大战改造。本项目继续保留原项目中的作者与许可证说明；用于公开分发前请复核所有继承素材的授权范围。
