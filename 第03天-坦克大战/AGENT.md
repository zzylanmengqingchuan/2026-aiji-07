# Agent 接入协议（坦克混战 4P）

> 核心定位：**主要给 Agent 自动对战**，同时保留人类浏览器入口做验收。  
> 服务地址示例：`http://152.136.211.81:3099`

完整机器可读文档：`GET /api/v1/docs`

---

## 1. 推荐课堂流程（15 组 × 约 4 人）

1. **组长（人或 Agent）** 创建房间，得到 `code` 与邀请链接。  
2. 链接发到小组群：  
   - 人类：浏览器打开 `http://<host>:3099/?room=XXXX`  
   - Agent：用 REST `join`（把同一 `code` 交给各自 Agent）。  
3. 人先进房操作 30 秒～1 分钟，确认无异常。  
4. 人退出或保留旁观；其余位由 **Agent join**。  
5. 满 2 人后服务器自动开始，也可由已入房成员调用 `start`。  
6. Agent 循环：`GET state` → 决策 → `POST action`（建议 10～20 次/秒）。  
7. `phase === 'finished'` 后 `GET result`，用户问 Agent「谁赢了」时据此回答。

---

## 2. 分享链接

| 链接 | 用途 |
|------|------|
| `http://HOST:3099/?room=ABCD` | 人类打开，可手动点加入 |
| `http://HOST:3099/?room=ABCD&autojoin=1&name=小明` | 人类自动加入 |
| `http://HOST:3099/api/v1/docs` | Agent 协议说明 |

创建房间后，网页大厅也会显示可复制的邀请链接。

---

## 3. REST API 速查

### 3.1 创建房间

```http
POST /api/v1/rooms
Content-Type: application/json

{"name":"组1-AgentA","kind":"agent","agentId":"team1-a"}
```

响应要点：

```json
{
  "ok": true,
  "code": "K7P2",
  "playerId": "xxxx",
  "token": "hex...",
  "humanUrl": "http://HOST:3099/?room=K7P2",
  "stateUrl": "...",
  "actionUrl": "...",
  "resultUrl": "..."
}
```

**务必保存 `playerId` + `token`**，后续行动鉴权用。

### 3.2 加入房间

```http
POST /api/v1/rooms/K7P2/join
{"name":"组1-AgentB","kind":"agent","agentId":"team1-b"}
```

### 3.3 开始对局（任意成员）

```http
POST /api/v1/rooms/K7P2/start
{"playerId":"...","token":"..."}
```

至少 2 名玩家。

### 3.4 观测

```http
GET /api/v1/rooms/K7P2/state?playerId=...&token=...
```

返回含：

- `phase`: `lobby` | `countdown` | `playing` | `round_break` | `finished`
- `game` / `gamesTotal`：当前第几局，共 10 局
- `round` / `roundsTotal`：本局第几把，每局 3 把
- `you`: 自己的位置、血量、yaw…
- `players` / `bullets` / `powerups` / `obstacles`
- `actionSpace`: 字段含义
- `result`: 结束后的战报（若有）

### 3.5 行动

```http
POST /api/v1/rooms/K7P2/action
{
  "playerId":"...",
  "token":"...",
  "mx": 0,
  "mz": -1,
  "aimX": 10,
  "aimZ": -20,
  "fire": true
}
```

| 字段 | 含义 |
|------|------|
| `mx` | -1..1，+X 为右（D） |
| `mz` | -1..1，**-1 为前进（W）** |
| `aimX/aimZ` | 瞄准点世界坐标 |
| `fire` | 是否开火 |

### 3.6 战果

```http
GET /api/v1/rooms/K7P2/result
```

结束后约 **30 分钟** 内仍可查（即使人已离开房间）。

`result.summary` 示例：`胜者：AgentB（Agent，击杀 2）`  
`result.rankings`：击杀榜；`killLog`：击杀流水。

---

## 4. WebSocket（可选）

连接：`ws://HOST:3099`

```json
{"type":"create","name":"A","kind":"agent","agentId":"a1"}
{"type":"join","code":"K7P2","name":"B","kind":"agent"}
{"type":"input","mx":0,"mz":-1,"aimX":0,"aimZ":0,"fire":false}
{"type":"start"}
```

人类网页也走 WebSocket；Agent 更推荐 REST（实现简单、易调试）。

---

## 5. 最小 Agent 伪代码

```python
import requests, time
BASE = "http://152.136.211.81:3099"

# 加入已有房间
r = requests.post(f"{BASE}/api/v1/rooms/ROOM/join",
    json={"name":"Bot","kind":"agent","agentId":"bot-1"}).json()
pid, token, code = r["playerId"], r["token"], r["code"]

# 人满后开始（或等人点）
requests.post(f"{BASE}/api/v1/rooms/{code}/start",
    json={"playerId":pid,"token":token})

while True:
    st = requests.get(f"{BASE}/api/v1/rooms/{code}/state",
        params={"playerId":pid,"token":token}).json()
    if st.get("phase") == "finished":
        print(st.get("result") or requests.get(f"{BASE}/api/v1/rooms/{code}/result").json())
        break
    you = st.get("you") or {}
    # 朴素策略：朝最近敌人移动并开火
    enemies = [p for p in st["players"] if p["id"] != pid and p["alive"]]
    mx = mz = 0
    fire = False
    aimX, aimZ = you.get("x",0), you.get("z",0)
    if enemies and you.get("alive"):
        e = min(enemies, key=lambda p: (p["x"]-you["x"])**2+(p["z"]-you["z"])**2)
        dx, dz = e["x"]-you["x"], e["z"]-you["z"]
        n = (dx*dx+dz*dz)**0.5 or 1
        mx, mz = dx/n, dz/n
        aimX, aimZ = e["x"], e["z"]
        fire = n < 35
    requests.post(f"{BASE}/api/v1/rooms/{code}/action", json={
        "playerId": pid, "token": token,
        "mx": mx, "mz": mz, "aimX": aimX, "aimZ": aimZ, "fire": fire
    })
    time.sleep(0.05)
```

仓库内可参考：`examples/agent_random.js`

---

## 6. 用户问 Agent「战况如何」

Agent 应调用：

```http
GET /api/v1/rooms/{code}/result
```

用自然语言复述 `summary`、`rankings`、`durationSec`、`killLog`。

---

## 7. 注意

- 每房最多 **8** 人（人类+Agent 合计）。  
- 对局中途可以加入，但会等待当前把结束，从下一把开始参战。  
- `token` 相当于座位密钥，不要泄露给对手 Agent。  
- 权威状态在服务器；客户端/Agent 本地预测仅用于手感。  

---

## 8. 版本管理与提交规范（开发约定）

- **远程仓库**：`https://github.com/zzylanmengqingchuan/2026-aiji-07`（私有），代码在 `第03天-坦克大战/` 子目录。
- **同步方式**：本项目目录本身不是 git 仓库；通过目录内的 `.gh-sync/`（远程仓库的克隆）同步——`rsync` 当前文件进 `.gh-sync/第03天-坦克大战/`（排除 `node_modules`、`reports`、`.gh-sync` 自身、`.DS_Store`），再 commit + push。
- **提交时机**：每次完成一个可验证的版本更新（功能/动效/修复，且测试通过后）及时提交，不攒批。
- **分支策略**：默认直接在 `main` 上提交（单人项目）；涉及结构性大改或不确定能否一次做对的改动，先开 `feature/*` 分支验证，通过后再合入 `main`。
- **提交信息**：中文，写清「做了什么 + 为什么」，动效类改动注明参考来源。
