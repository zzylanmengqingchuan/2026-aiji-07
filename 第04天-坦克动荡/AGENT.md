# Agent 接入协议（坦克动荡 1v1）

机器可读文档以运行中服务的 `GET /api/v1/docs` 为准。默认地址为 `http://HOST:3100`。

## 最短流程

1. 创建房间或加入已有 4 位房间码。
2. 保存响应里的 `playerId` 和 `token`。
3. 满 2 人后自动开局。
4. 以 10～20Hz 循环读取 `state` 并提交 `action`，上限为每玩家 30 次/秒。
5. `phase === "finished"` 后读取 `result`。

创建：

```http
POST /api/v1/rooms
Content-Type: application/json

{"name":"AgentA","kind":"agent","agentId":"team-a"}
```

加入：

```http
POST /api/v1/rooms/ABCD/join
Content-Type: application/json

{"name":"AgentB","kind":"agent","agentId":"team-b"}
```

观测：

```http
GET /api/v1/rooms/ABCD/state?playerId=ID&token=TOKEN
```

行动：

```http
POST /api/v1/rooms/ABCD/action
Content-Type: application/json

{"playerId":"ID","token":"TOKEN","mx":0,"mz":-1,"aimX":10,"aimZ":-20,"fire":true}
```

## 关键状态

- `phase`：`lobby | countdown | playing | round_break | finished`
- `rules`：3 血、先得 5 分、反弹上限等当前规则
- `you` / `players`：位置、朝向、生命、`score`、存活状态
- `walls`：当前迷宫 AABB，形如 `{x,z,hw,hd,h,kind}`；每把可能变化
- `mazeSeed`：当前迷宫种子
- `bullets`：`{id,x,z,dx,dz,bounces,owner,color}`
- `roundTimeLeft`：本把剩余秒数

坐标位于 XZ 平面：`mx=1` 向右（+X），`mz=-1` 向屏幕上方（-Z）。

## 反弹预判

墙面法线为 `n`，炮弹方向为 `v` 时，反射方向为：

```text
v' = v - 2 × (v · n) × n
```

竖直墙面令 `dx` 取反，水平墙面令 `dz` 取反。`bullets[].bounces` 达到 3 或炮弹存活超过 4 秒后消失。自己的炮弹也会伤害自己。

示例：

```bash
node examples/agent_random.js http://127.0.0.1:3100
node examples/agent_bounce.js http://127.0.0.1:3100 ABCD
```

## WebSocket

连接 `ws://HOST:3100`（HTTPS 使用 `wss`）：

```json
{"type":"create","name":"A","kind":"agent","agentId":"a1"}
{"type":"join","code":"ABCD","name":"B","kind":"agent","agentId":"b1"}
{"type":"input","mx":0,"mz":-1,"aimX":0,"aimZ":0,"fire":false}
```

浏览器调试时可在创建房间的页面 URL 添加 `?seed=42`，让每把使用同一张可复现迷宫。
