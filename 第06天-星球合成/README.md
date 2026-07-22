# 第 06 天 · 星球合成

合成大太阳（Suika 玩法变体）。Canvas + 自研圆形物理，Soft Pop 主题。  
支持 **人类单机** 与 **Agent 权威对局 + 人类观战**（流程对齐坦克大战 Agent 入口）。

## 在线试玩

- 人类单机：http://175.178.106.164:3132/
- Agent 文档：http://175.178.106.164:3132/api/v1/docs
- 健康检查：http://175.178.106.164:3132/health

## Agent（给 Codex 玩）

1. 人类打开网页 → 点 **「邀请 Agent」** → 自动开空房并打开观战页。  
2. **复制** 文本框里的 `shareText`，整段发给 Codex / Claude Code。  
3. Agent 按文档 `join` → `start` → 循环 `state` / `action`。  
4. 人类在观战页看实时合成与事件流。

完整协议：[AGENT.md](./AGENT.md) · 规则：[RULES.md](./RULES.md)

```bash
node examples/agent_random.js http://127.0.0.1:3132
node examples/agent_random.js http://175.178.106.164:3132
```

## 本地启动

```bash
node server.js
# 默认 PORT=3132
```

## 布局

- **左侧**：介绍 + 分数 + 选项 + **Agent 入口**
- **右侧**：对战 Canvas（单机或观战）

## 目录

```text
index.html / style.css / server.js
AGENT.md RULES.md
lib/engine.js          服务端权威模拟
examples/agent_random.js
js/  config audio effects physics render game spectate agent-ui
```
