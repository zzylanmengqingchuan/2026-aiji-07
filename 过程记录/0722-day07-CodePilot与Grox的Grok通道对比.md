# CodePilot 能用 Grok，Grox 却 403：两条路到底差在哪

> **日期**：2026-07-22（0722）  
> **天数**：day07 · 第 07 天  
> **类型**：过程记录 / 工具踩坑复盘  
> **仓库**：[zzylanmengqingchuan/2026-aiji-07](https://github.com/zzylanmengqingchuan/2026-aiji-07) · `过程记录/`  
> **关键词**：Grok、SuperGrok、Grox、CodePilot、Runtime、403、API、OAuth

---

## 写在前面：这篇文章要解决什么疑惑

集训后期，我同时碰到两件看起来「矛盾」的事：

1. **Grox**（一个面向 SuperGrok 的桌面客户端）里发消息，经常报错类似：  
   `403 Grok Build is coming soon. You don't have access now.`
2. **CodePilot**（臧师傅 / 歸藏 op7418 做的多模型 Agent 桌面客户端）里，选 **CodePilot 渠道** 或 **Codex 渠道**，却可以挂 **Grok 模型** 正常用。

第一反应很容易是：

> CodePilot 是不是有什么「非常巧」的黑科技？  
> Grox 是不是写得不行、不知道怎么接 Grok？

这篇文章把背景、报错原因、两边各自怎么「解决问题」、差别、以及这算不算歪门邪道，按「人话 + 稍微技术一点」两层写清楚。  
结论先放在这里：

> **不是 CodePilot 更聪明、Grox 更笨，而是产品定位不同，选的「进门通道」不同。**  
> CodePilot 走的是 **直接打 xAI 的 HTTP API**；  
> Grox 走的是 **官方 Grok Agent（stdio）那条通道**。  
> 官方对第二条卡得紧时，就会出现：同一台电脑、同一个订阅，CLI 能用、壳却 403。

---

## 一、背景：我当时在折腾什么

### 1.1 为什么需要「Grok 的桌面客户端」

官方 **Grok Build**（命令行里的 `grok`）已经能写代码、跑工具，但体验更像终端 REPL：

- 看长对话、管理多项目 session 不如 Codex / Cursor 那种侧边栏方便  
- 希望有一个「类 Codex 的 GUI」，底下仍是 SuperGrok 能力  

于是会接触到两个方向的软件：

| 软件 | 仓库 / 作者（当时） | 一句话定位 |
|------|---------------------|------------|
| **Grox** | [dandandujie/Grox](https://github.com/dandandujie/Grox) | SuperGrok / Grok Build 的桌面壳 |
| **CodePilot** | [op7418/CodePilot](https://github.com/op7418/CodePilot) | 多模型 AI Agent 桌面客户端（Claude / Codex / 国内套餐 / xAI …） |

### 1.2 同一时期还装过 CodePilot

2026-07-22 在 macOS Apple Silicon 上安装了 CodePilot **v0.59.1**（`/Applications/CodePilot.app`）。  
从 v0.59.0 起，官方 Release 明确写了：

- 支持 **xAI API Key + Grok 4.5**（CodePilot Runtime **和** Codex Runtime）  
- 支持 **xAI Grok OAuth**（兼容 SuperGrok 的浏览器 / 设备码登录）  
- v0.59.1 还修了「开系统代理时 OAuth 授权成功却登录失败」的问题  

于是问题就变成了：

> 为什么「多模型客户端」反而能用 Grok，  
> 「专门做 Grok 壳」的软件反而容易 403？

---

## 二、问题现场：Grox 上发生了什么

### 2.1 典型报错

在 Grox 里发送消息时，服务端返回大意是：

```text
403 Grok Build is coming soon. You don't have access now.
```

### 2.2 排查过程里很关键的对照实验

同一台 Mac、同一个 SuperGrok 账号：

| 入口 | 结果 |
|------|------|
| 终端 / Warp 里交互式跑 `grok` | **能正常对话** |
| Grox 桌面壳（背后拉起 agent） | **403** |

这说明：

- **账号 / 订阅本身未必废了**  
- **更像是「某种接入方式」被拒**，不是「你完全没资格用 Grok」

### 2.3 第一层根因：版本号报错（后来证明只是一部分）

Grox 0.2.0 时期，社区 / 作者（issue #1）修过一类问题：

- 壳把 `GROK_CLIENT_VERSION` 写成了 **应用版本 0.2.0**  
- 服务端按「客户端版本门闸」校验 → 可能直接 403  
- 修复版 **0.2.1** 改为上报 **真实 CLI 版本**（例如 0.2.106），并改进 ACP initialize 的版本元数据  

本机验证过：

- 已升级到 Grox **0.2.1**  
- 子进程环境里 `GROK_CLIENT_VERSION=0.2.106`（版本门闸那刀已生效）  
- **仍然 403**

所以对「我这台机器」而言：

> 版本写错是真 bug，也确实该修；  
> **但修完以后，stdio / 桌面壳路径仍可能被拒。**  
> 根因从「纯版本写错」升级成：「官方对 agent stdio / 桌面接入另有门闸」。

### 2.4 人话小结（Grox 侧）

```text
你以为：我登录了 SuperGrok，桌面端就应该能聊。
实际：  桌面端走的是「官方 Agent 通道」；
        官方可以只放行 CLI 交互，或卡死某类壳 / 某类协议路径。
```

---

## 三、CodePilot 是怎么「能用 Grok」的

### 3.1 先分清两个词：服务商 vs 渠道（Runtime）

CodePilot 界面上容易混的概念：

| 概念 | 人话 | 例子 |
|------|------|------|
| **服务商 / 凭据** | 你用谁的身份、什么钥匙 | xAI API Key、xAI Grok OAuth |
| **Runtime（渠道 / 引擎）** | 这轮对话用哪套「干活发动机」 | CodePilot Runtime、Codex Runtime、Claude Code Runtime |

**Grok 属于 xAI 家的协议，和 Claude 家不是一套插头。**

所以：

- 选 **CodePilot 渠道** 或 **Codex 渠道** → 可以挂 Grok  
- 选 **Claude Code 渠道** → 对不上 Grok（不是 bug，是协议不兼容）

就像：iPhone 充电线和安卓口，不是「手机坏了」，是接口不是一类。

### 3.2 CodePilot 的两条凭据路径

从 v0.59.x 的产品说明和本机安装包行为可以归纳：

#### 路径 A：xAI API Key（正规、更稳）

- 设置 → 服务商 → **xAI API Key**  
- 填官方 Key，Base 指向 `https://api.x.ai/v1`  
- 协议：**Responses API**（产品文案写明用于 CodePilot / Codex 运行时）  
- 默认模型目录含 **Grok 4.5**（`grok-4.5`）  
- **计费走 xAI API 账户，与 SuperGrok 订阅登录相互独立**

这是全世界做 AI 客户端的标准做法：有 Key 就直连 HTTP API。  
**不巧，不黑，很正常。**

#### 路径 B：xAI Grok OAuth（蹭 SuperGrok，兼容、偏脆）

- 设置里 **xAI Grok OAuth / 兼容 SuperGrok**  
- 浏览器授权或设备码登录  
- **复用公开 Grok CLI 的 OAuth client** 换 token  
- Token 端点在 xAI OAuth（如 `https://auth.x.ai/oauth2/token`）  
- 登录后仍主要是拿 token 去调 **API 侧**（`api.x.ai`），而不是再去 spawn 官方 `grok agent stdio`

官方自己也写了类似意思：

> 这是兼容接入，依赖 xAI 上游策略；  
> **API Key 是更稳定的备用渠道。**

翻译成人话：

- 没有「黑进 xAI」  
- 是 **借用官方 CLI 同一套公开登录门**，拿到令牌后走 API  
- 能用很香；上游一改策略，可能又不稳  

### 3.3 它「解决问题」的真正手法：换通道，而不是修 Grox

```text
Grox 的路：
  GUI 壳 → 拉起本机 grok agent stdio → 官方 Agent 网关
                                    └─ 容易 403「coming soon」

CodePilot 的路：
  GUI → 自己的 Runtime（CodePilot / Codex）
      → 直接 HTTP 调 xAI Responses API（Key 或 OAuth token）
      → 不经过 grok agent stdio
```

所以 CodePilot **不是**「更会用 Grok Build」，而是：

> **干脆不把「能聊天」绑死在 Grok Build Agent 通道上。**

这也解释了：为什么它要你在 UI 里选 **CodePilot / Codex 渠道**——  
那是「能讲 xAI / OpenAI 兼容 Responses 这一套」的发动机；  
Claude 发动机讲的是另一套语言。

### 3.4 和 Codex 渠道的关系（避免再混）

| 你选的 | 大致含义 | 和 Grok 的关系 |
|--------|----------|----------------|
| **CodePilot Runtime** | 应用内置的 AI SDK 引擎（含 `@ai-sdk/xai` 等） | 直接按 xAI 协议出 Grok |
| **Codex Runtime** | 走本机 Codex / app-server 那一套兼容路径 | 同样可挂 xAI 类 Responses 模型（产品声明支持） |
| **Codex Account（ChatGPT 登录）** | 用 ChatGPT Plus/Pro 登录出的 **GPT 系** | **不是 Grok**，别和 xAI 搞混 |
| **Claude Code Runtime** | Anthropic Agent / Claude Code CLI 能力 | **不挂 Grok** |

「能选 Codex 渠道用 Grok」≠「用 ChatGPT 订阅白嫖 Grok」。  
前者是 **Runtime 名字**；后者是 **另一家的账号体系**。

---

## 四、对照表：差别一眼看懂

### 4.1 产品与架构

| 维度 | Grox | CodePilot |
|------|------|-----------|
| 产品目标 | 做 Grok Build 的桌面体验 | 一个客户端接很多服务商 |
| Grok 在产品里的地位 | **核心 / 几乎唯一** | **十七个服务商之一** |
| 默认技术路径 | 壳 + 官方 CLI agent（stdio / ACP） | 多 Runtime + HTTP Provider |
| 挂了谁，就绑死谁 | 强依赖官方 Agent 策略 | Grok 挂了可以换 Claude / 国产套餐 |
| 失败时的体感 | 「Grok 客户端坏了」 | 「这个 provider 暂不可用」 |

### 4.2 鉴权

| 维度 | Grox | CodePilot |
|------|------|-----------|
| SuperGrok 登录 | 核心路径 | 可选兼容路径（OAuth） |
| API Key | 视版本 / 配置而定，产品心智偏订阅壳 | 一等公民，文档明确推荐更稳 |
| 令牌最终用来干嘛 | 驱动官方 agent 会话 | 调 `api.x.ai` 等 HTTP 接口 |

### 4.3 和 403 的关系

| 维度 | Grox | CodePilot |
|------|------|-----------|
| 会不会撞「Grok Build coming soon」 | **会**（agent 门闸） | **基本不靠这条门** |
| 版本门闸 bug | 0.2.0 报错版本号 → 0.2.1 修 | 不依赖那套 CLI 版本门闸语义 |
| 同账号 CLI 能用、壳不能用 | **典型现象** | 不适用同一条对比 |

### 4.4 「巧不巧」

| 路径 | 巧不巧 | 稳不稳 | 算不算歪 |
|------|--------|--------|----------|
| CodePilot + **API Key** | 不巧，行业标准 | 稳 | 正道 |
| CodePilot + **SuperGrok OAuth** | 有点巧（兼容 CLI 登录门） | 中等，看上游脸色 | 灰区兼容，作者已声明风险 |
| Grox + **agent stdio** | 不巧，贴官方 | 取决于官方是否放行桌面 / stdio | 正道（官方路线），但可能被卡 |

---

## 五、为啥 CodePilot「知道」，Grox「不知道」？

这是最容易产生误解的一句话。更准确的说法是：

### 5.1 Grox 不是不知道，是故意走官方路

Grox 想成为：

> 「官方 Grok 编程助手」的 GUI 皮肤。

那它就应该：

- 尽量复用官方 CLI / agent 的会话、工具、权限模型  
- 跟着官方升级、官方门闸、官方协议走  

官方对 **agent stdio** 一卡，壳就一起卡——这是 **产品绑定官方通道的代价**，不是工程师「不会打 API」。

如果 Grox 明天改成纯 `api.x.ai` 直连：

- 403 可能消失  
- 但它也不再是「Grok Build 桌面壳」，而变成「又一个多模型 / API 客户端」  
- 工具链、计费、订阅权益、官方功能对齐都会变味道  

**它不是不会，是产品选择没走那条。**

### 5.2 CodePilot 也不是开了天眼

CodePilot 从第一天就按：

> 设置里加 Provider → 填 Key / 登录 → 选 Runtime → 发消息

来设计。Grok 只是后来在目录里加了一个 **xai** 协议服务商，并声明：

- 仅 **CodePilot / Codex** Runtime 兼容  
- Claude Code Runtime 不展示 / 不可达  

这是 **多 Provider 架构的自然扩展**，不是针对 Grox 的降维打击。

### 5.3 那「OAuth 兼容 SuperGrok」算不算非常巧？

**算一点点巧，不算魔法。**

- 巧在：不用你再买 API，尽量让已有 SuperGrok 登录也能用  
- 脆在：依赖公开 CLI OAuth client 与上游策略  
- 作者已用产品文案降低预期：不稳就退回 API Key  

若有人把「兼容 OAuth」吹成「破解 Grok」，那是过誉；  
若有人把「API Key 直连」吹成「黑科技」，那是不懂行业常识。

---

## 六、一张总图（建议收藏）

```text
                    ┌─────────────────────────────────────┐
                    │           你想用 Grok 写代码           │
                    └─────────────────────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
              ▼                                               ▼
     ┌─────────────────┐                           ┌─────────────────────┐
     │      Grox       │                           │     CodePilot        │
     │  Grok 专用桌面壳 │                           │  多模型 Agent 客户端  │
     └────────┬────────┘                           └──────────┬──────────┘
              │                                               │
              ▼                                               ▼
   拉起官方 grok agent stdio                      选 Runtime：
   （像官方对讲机专用通道）                        CodePilot 或 Codex
              │                                    （别选 Claude 引擎）
              ▼                                               │
     官方 Agent 门闸                                    ┌──────┴──────┐
     版本 / 资格 / 策略                                  │             │
              │                                    API Key      SuperGrok OAuth
              │                                    （正道）      （兼容、偏脆）
              ▼                                             │
        可能 403 ──► 同机 CLI 却仍可能通                      ▼
                                              直接 HTTP → api.x.ai
                                              （Responses API）
                                                      │
                                                      ▼
                                                   正常出 Grok
```

---

## 七、对我有什么用：选型建议

### 7.1 你只是想「稳定写代码，模型用 Grok」

1. 优先：**CodePilot + xAI API Key + CodePilot Runtime**  
2. 次选：终端官方 `grok`（交互式 CLI，本机已验证能过）  
3. 谨慎：Grox 桌面壳（直到官方明确放行你的账号 / 路径）  
4. 可用但不稳：**CodePilot + Grok OAuth（SuperGrok）**

### 7.2 你想要「官方 Grok Agent 完整体验」

- 继续跟 **官方 CLI / 官方后续桌面**  
- Grox 的方向是对的，但你要接受：  
  **体验上限绑官方，失败模式也绑官方**

### 7.3 你想「一个软件搞定所有模型」

- **CodePilot** 这类多 Provider 客户端更合适  
- 把 Grok 只当成模型货架上的一格，而不是信仰

### 7.4 实操检查清单（CodePilot）

1. 设置 → 服务商 → 添加 **xAI API Key** 或 **xAI Grok OAuth**  
2. 新对话 → Runtime 选 **CodePilot** 或 **Codex**（不要 Claude Code）  
3. 模型选 **Grok 4.5**（或列表里的 Grok）  
4. 发一句「你好」验证  
5. 若 OAuth 抽风 → 换 API Key；若仍失败 → 看代理 / 网络（0.59.1 已修一类代理 OAuth 问题）

---

## 八、复盘：这件事真正教给我的三件事

### 8.1 「同账号、不同入口」可以有完全不同的权限结果

以前直觉是：登录成功 = 全能。  
实际是：**登录只证明你是你；入口还决定你能走哪扇门。**

CLI 一扇门，agent stdio 一扇门，HTTP API 又一扇门。  
门禁策略可以不一致。

### 8.2 排障时最有价值的是对照实验

- 只看壳：会以为「订阅废了」  
- 加上「同机 CLI 对照」：立刻定位到 **接入路径**  
- 再加上「升级后 env 已是正确版本仍 403」：排除「纯版本写错」的单因论  

**对照实验 > 猜。**

### 8.3 架构选择会决定你「能绕开什么问题」

- 绑官方 Agent：功能对齐最好，也最容易被官方一刀切  
- 绑公开 API：集成简单、行为清晰，但订阅权益、工具生态可能对不齐  
- 兼容 OAuth：体验好、工程巧，但声明风险、准备退路  

没有绝对正确，只有 **你的目标匹配哪一种代价**。

---

## 九、时间线备忘（便于以后自己回看）

| 时间 | 事件 |
|------|------|
| 约 07-20 | Grox 使用中出现 403；对照 Warp/`grok` 可正常推理 |
| 约 07-20 | 分析到 `GROK_CLIENT_VERSION` 与版本门闸；关注 issue #1 |
| 约 07-20～21 | 升级 Grox **0.2.1**，确认版本上报已正确，**403 仍在** |
| 07-22 | 安装 CodePilot **0.59.1**；阅读 v0.59.0/0.59.1 Release：xAI Key + Grok OAuth + 双 Runtime |
| 07-22 | 弄清：CodePilot/Codex 渠道可挂 Grok，本质是 **API 通道**，不是修好了 agent stdio |
| 07-22（day07） | 本文写入本仓库 `过程记录/`，标记 **0722 · day07** |

---

## 十、参考链接

- CodePilot 仓库：https://github.com/op7418/CodePilot  
- CodePilot Releases（含 v0.59.0 Grok 双渠道、v0.59.1 OAuth 代理修复）：https://github.com/op7418/CodePilot/releases  
- Grox 仓库：https://github.com/dandandujie/Grox  
- xAI API 文档入口（产品内链方向）：https://docs.x.ai/docs/overview  
- xAI Console（API Key）：https://console.x.ai/  

---

## 十一、一句话收束

> **CodePilot 能用 Grok，不是因为它「比 Grox 更懂 Grok」，**  
> **而是因为它根本不跟 Grox 抢同一条官方 Agent 通道——**  
> **它用 CodePilot / Codex 两台发动机，直接打电话给 xAI 的 API。**  
> **API Key 是正道；SuperGrok OAuth 是巧兼容；Grox 的 403 是官方门闸下的路径问题。**

---

*本文为 2026 年 7 月安吉集训 day07（0722）过程记录，归档于 `过程记录/0722-day07-CodePilot与Grox的Grok通道对比.md`。*
