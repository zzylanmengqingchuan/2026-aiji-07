# CodePilot 接入小米 MiMo 模型排错实录：一个字母引发的 "No output generated"

> 作者：kimi ｜ 安吉集训 Day08 过程记录
>
> 记录一次 CodePilot 配置小米「百万 Token 计划」API Key 的完整排查过程。
> 报错很笼统，根因很隐蔽：**API Key 分中国区（cn）和新加坡区（sgp），key 和 base_url 的区域必须一致。**

## 背景

CodePilot 是一个本地 Agent 客户端，内置三个执行引擎：

| 引擎 | 说明 |
| --- | --- |
| Claude Code | 调用 Anthropic 官方 CLI 跑 Agent |
| CodePilot | 自带内核，直连 provider API |
| Codex | OpenAI Codex 应用服务 |

本次使用「CodePilot 自带内核」+「Anthropic Third-party API」provider，接入小米 MiMo 模型的 API Key。小米给了两种协议的接入地址：

```text
OpenAI 接口协议:    https://token-plan-cn.xiaomimimo.com/v1
Anthropic 接口协议: https://token-plan-cn.xiaomimimo.com/anthropic
```

## 现象

配置完成后，在 CodePilot 里发任何消息都报错：

```json
{"category":"AGENT_ERROR","userMessage":"No output generated. Check the stream for errors."}
```

Key 没填错、模型映射也配了，但就是没有任何输出。

## 排查过程

### 第一步：绕过客户端，直接用 curl 验证 key

CodePilot 的配置存在本地 SQLite 数据库 `~/.codepilot/codepilot.db` 里，但在翻配置之前，先确认 key 本身是活的：

```bash
curl -sS -m 15 https://token-plan-cn.xiaomimimo.com/v1/models \
  -H "Authorization: Bearer <你的key>"
```

返回正常，可用的模型有：

```json
{"object":"list","data":[
  {"id":"mimo-v2.5","object":"model","owned_by":"xiaomi"},
  {"id":"mimo-v2.5-pro","object":"model","owned_by":"xiaomi"},
  ...
]}
```

再验证 Anthropic 协议端点：

```bash
curl -sS -m 20 https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages \
  -H "x-api-key: <你的key>" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"mimo-v2.5","max_tokens":50,"messages":[{"role":"user","content":"say hi"}]}'
```

也正常返回。**结论：key 有效，服务端没问题，问题出在 CodePilot 的配置上。**

### 第二步：翻 CodePilot 的配置数据库

```bash
sqlite3 ~/.codepilot/codepilot.db \
  "SELECT id, name, base_url, is_active, role_models_json FROM api_providers;"
```

发现关键问题：

```text
Anthropic Third-party API | https://token-plan-sgp.xiaomimimo.com/anthropic | ...
```

provider 的 base_url 指向的是 **`-sgp-`（新加坡区）**，而这个 key 是 **`-cn-`（中国区）** 的！

### 第三步：交叉验证，坐实根因

用同一个 key 分别请求两个区域的端点：

```bash
# 新加坡区 + 中国区 key → 401
curl -sS https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages ...
# {"error":{"message":"Invalid API Key","code":"401","type":"invalid_key"}}

# 中国区 + 中国区 key → 正常
curl -sS https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages ...
# 正常返回 message 内容
```

根因确认：**小米的 API Key 按区域签发，cn 区和 sgp 区的 key 互不通用。** CodePilot 拿着中国区的 key 去请求新加坡区的端点，被 401 拒绝，流里没有任何内容，前端就只能报出那句笼统的 "No output generated"。

（为什么 base_url 会是 sgp？因为之前自己开的「百万 Token 计划」买成了新加坡区，当时配置填的就是 sgp 地址；这次换了中国区的 key，key 换了，base_url 却没跟着换。）

### 第四步：修复

直接改数据库里的 base_url：

```bash
sqlite3 ~/.codepilot/codepilot.db \
  "UPDATE api_providers \
   SET base_url='https://token-plan-cn.xiaomimimo.com/anthropic', \
       updated_at=datetime('now') \
   WHERE id='<provider_id>';"
```

模型映射（sonnet/opus/haiku → `mimo-v2.5-pro`）不用动，实测该模型在 cn 端点工作正常。**重启 CodePilot 后恢复正常。**

## 经验总结

### 换 key 时的自检流程

新 key 到手先跑一条命令，判断它属于哪个区：

```bash
curl -sS -m 15 https://token-plan-cn.xiaomimimo.com/v1/models \
  -H "Authorization: Bearer <你的key>"
```

- 返回模型列表 → 中国区，base_url 用 `https://token-plan-cn.xiaomimimo.com/anthropic`
- 返回 `Invalid API Key` → 换 `-sgp-` 域名再试

**key 的区域和 base_url 的区域必须一致**，这是最隐蔽也最容易漏的一点。

### 排查方法论

1. **先绕过客户端验证服务端**：客户端报错往往很笼统（"No output generated" 什么信息都没有），用 curl 直接打 API，能看到真实的错误码（这次是 401）。
2. **找到客户端的真实配置存储**：CodePilot 的配置在 `~/.codepilot/codepilot.db`（SQLite），直接 `sqlite3` 读写比在 UI 里反复点快得多，改完重启应用生效。
3. **交叉对照**：一个变量一个变量地试——同一个 key 打不同端点、同一个端点用不同模型，两两组合很快就能锁定问题维度。

## 附：另一个小警告

CodePilot 健康检查里还有一条 "1 other Claude CLI installation(s) detected"，原因是系统里装了两份 Claude Code：

```text
~/.local/bin/claude   → v2.1.165（PATH 优先，实际生效的新版）
/usr/local/bin/claude → v2.1.96（旧版残留）
```

不影响使用，想消除的话删掉旧版即可（root 所有，需要 sudo）：

```bash
sudo npm uninstall -g @anthropic-ai/claude-code --prefix /usr/local
```
