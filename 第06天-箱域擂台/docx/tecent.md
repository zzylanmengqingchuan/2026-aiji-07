# 腾讯云轻量服务器部署手册（人 & Agent 通用）

> 本文档描述一套可复用的部署流程：把本地项目同步到腾讯云轻量应用服务器（Ubuntu），并重启服务、验证生效。
> 目标读者：人类开发者 和 自动化 Agent（如 Kimi Code / Codex）。双方都按本文执行即可，无需额外上下文。

---

## 0. 适用场景与前置条件

- 服务器：腾讯云轻量应用服务器，Ubuntu 系统，已有一个可 ssh 登录的用户（示例用 `ubuntu`）
- 项目：本地一个可 `node server.js` 直接运行的 Node 项目（无构建步骤；有构建步骤的项目先本地构建，再同步产物）
- 本地：macOS / Linux 终端，装有 `rsync`、`ssh`、`curl`、`python3`

文中示例约定（实际使用时替换三处即可）：

| 占位 | 示例值 | 含义 |
|---|---|---|
| `<SERVER>` | `ubuntu@175.178.106.164` | 服务器 用户@IP |
| `<LOCAL_DIR>` | `/Users/zzy/tank-trouble` | 本地项目目录（结尾不带 `/`） |
| `<REMOTE_DIR>` | `/home/ubuntu/tank-torzan` | 服务器上的项目目录 |
| `<PORT>` | `3100` | 服务监听端口 |

---

## 1. 一次性配置：SSH 免密（密钥登录）

**目的**：之后所有 rsync/ssh 操作不再输密码；也是让 Agent 能非交互执行部署的前提。

```bash
# 1) 本地生成密钥对（已有则跳过）
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519

# 2) 把公钥装到服务器（这一步会要求输一次服务器密码，是唯一一次）
ssh-copy-id <SERVER>
```

原理：私钥留在本地 `~/.ssh/id_ed25519`，公钥写入服务器 `~/.ssh/authorized_keys`。之后 ssh/rsync 连接时用密钥握手，全程免密。

验证：

```bash
ssh -o BatchMode=yes <SERVER> 'echo OK'
# 输出 OK 且没问密码 = 配置成功；Permission denied = 公钥没装上，重做第 2 步
```

**安全须知**：私钥文件就是账号钥匙，不发给任何人、不上传。要收回访问权，删除服务器 `~/.ssh/authorized_keys` 里对应那一行即可。

---

## 2. 标准部署流程（四步）

### 第 1 步：同步代码

**必须在本地执行，且写成一行**（长命令换行粘贴会断行，见"坑 1"）：

```bash
rsync -avz --exclude node_modules --exclude reports --exclude .DS_Store <LOCAL_DIR>/ <SERVER>:<REMOTE_DIR>/
```

- 源目录末尾的 `/` 含义是"同步目录内容"而非"同步目录本身"，不要漏
- `node_modules` 不同步（服务器上已 `npm install` 过；首次部署需先 ssh 上去装一次依赖）
- 成功标志：输出里有实际文件传输（`sent` 字节数远大于几百），能看到 `server.js` 等关键文件

### 第 2 步：校验服务器上的代码版本

**传上去 ≠ 生效。先确认磁盘文件是新版，再重启：**

```bash
ssh <SERVER> "grep '特征字符串' <REMOTE_DIR>/server.js"
```

- "特征字符串"选本次改动里独有的一行（例如某个常量、某句文案）
- 看不到新版本特征 = 同步目标目录和实际运行目录不一致，去查进程实际读的是哪个文件（见"坑 3"）

### 第 3 步：重启服务

```bash
ssh <SERVER> "pkill -f 'server.js' || true; sleep 2; ss -ltnp | grep <PORT> || echo '端口已清空'; cd <REMOTE_DIR> && nohup env PORT=<PORT> node server.js >> app.log 2>&1 < /dev/null & sleep 2; curl -s http://localhost:<PORT>/health"
```

四个细节缺一不可：

1. **pkill 模式用 `'server.js'` 而不是 `'node server.js'`**——如果进程启动命令带参数（如 `node --trace-uncaught server.js`），后者匹配不上，旧进程杀不掉（见"坑 2"）
2. **杀完确认端口空了**（`ss -ltnp | grep <PORT>` 无输出）再启动，否则新进程 EADDRINUSE 起不来，旧进程继续骗你
3. **`< /dev/null`** 防止 nohup 挂住 ssh 会话
4. 重启后立刻 `curl localhost:<PORT>/health` 确认活着

### 第 4 步：从外部验证新版本真的生效

**不要只看进程活着，要验证行为是新版的：**

```bash
# 在本地执行：调用一个能体现本次改动的接口，断言返回值是新版行为
curl -s http://<服务器IP>:<PORT>/health
```

- 以本项目为例：建房后读 `state.roundTimeLeft`，是 300 说明新版生效，是 60 说明还是旧版
- 浏览器端验证前记得**强制刷新**（Mac：Cmd+Shift+R），静态文件有缓存

---

## 3. 一键部署脚本（模板）

把下面脚本保存为 `~/deploy.sh`，替换尖括号四处，以后部署只需 `bash ~/deploy.sh`：

```bash
#!/bin/bash
set -e
SRV=<SERVER>
DIR=<REMOTE_DIR>
PORT=<PORT>

echo "== 1/4 同步代码 =="
rsync -avz --exclude node_modules --exclude reports --exclude .DS_Store <LOCAL_DIR>/ $SRV:$DIR/

echo "== 2/4 校验版本 =="
ssh $SRV "grep '<特征字符串>' $DIR/server.js"

echo "== 3/4 重启服务 =="
ssh $SRV "pkill -f 'server.js' || true; sleep 2; ss -ltnp | grep $PORT || echo '端口已清空'; cd $DIR && nohup env PORT=$PORT node server.js >> app.log 2>&1 < /dev/null & sleep 2; curl -s http://localhost:$PORT/health"

echo "== 4/4 外部验证 =="
sleep 2
curl -s http://$(echo $SRV | cut -d@ -f2):$PORT/health
echo
echo "部署完成。请再调用业务接口确认新行为已生效。"
```

脚本里出现 ssh 密码提示是正常的（未配密钥时要输 2~3 次）；配完第 1 节密钥后全程免密。

---

## 4. 三个真实踩过的坑（排错速查）

### 坑 1：长命令断行，rsync 本地空跑

**症状**：rsync 输出一大串本地文件列表，最后 `sent` 只有几十字节，或报 `zsh: no such file or directory: ubuntu@...`。
**原因**：多行命令粘贴时反斜杠 `\` 后带了空格，或长行被复制源折行，续行失效，命令被拆成几条独立执行——rsync 没带目标参数，在本地空跑，什么都没上传。
**对策**：永远用单行命令；或用第 3 节的脚本文件，只敲 `bash ~/deploy.sh` 一条短命令。

### 坑 2：pkill 杀不掉旧进程，新进程端口冲突

**症状**：部署后行为仍是旧版；日志里 `EADDRINUSE`。
**原因**：旧进程启动命令是 `node --trace-uncaught --unhandled-rejections=strict server.js`，`pkill -f "node server.js"` 因中间隔着参数匹配失败。旧进程不死、占着端口，新进程起不来。
**对策**：`pkill -f 'server.js'`（不带 `node` 前缀）；杀完用 `ss -ltnp | grep <PORT>` 确认端口真空了再启动。

### 坑 3：同步的目录 ≠ 实际运行的目录

**症状**：rsync 成功、grep 磁盘文件也是新版，但行为依旧。
**原因**：进程是从另一个目录启动的（或 pm2 登记的是旧路径）。
**对策**：服务器上 `ps aux | grep node` 看进程的工作目录/启动路径；用 `ls -l /proc/<PID>/cwd` 确认它实际读哪个目录，把代码同步到那个目录去。

---

## 5. 给 Agent 的补充说明（人类可跳过）

- **前置硬条件**：必须先完成第 1 节密钥配置。Agent 的 shell 是非交互式的，无法回答密码提示；密钥就绪后用 `ssh -o BatchMode=yes` 执行可确保不会被密码提示卡住
- **幂等**：本流程任意一步失败可直接重跑，rsync 增量同步、pkill 幂等、端口检查兜底
- **验证义务**：部署完成 ≠ 任务完成。必须从外部调用接口验证"新行为"（不是只验证"活着"），并把验证输出展示给人类
- **禁止事项**：不得读取/复制/传输 `~/.ssh/` 下任何私钥文件；只调用 `ssh` 程序使用密钥
- **多项目复用**：替换第 0 节表格中的四个占位值即可，流程不变

---

## 6. 首次部署全新项目的额外步骤

1. `ssh <SERVER> "mkdir -p <REMOTE_DIR>"`
2. 按第 2 步同步代码
3. `ssh <SERVER> "cd <REMOTE_DIR> && npm install"`（装依赖，仅此一次或依赖变更时）
4. 防火墙/安全组：腾讯云控制台 → 轻量服务器 → 防火墙，放行 `<PORT>`（TCP），否则外网访问不到
5. 按第 3、4 步重启并验证
