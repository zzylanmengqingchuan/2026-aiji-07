# 项目协作备注

## 用户沟通偏好

- 使用中文回答。
- 给出部署和更新命令时保持简洁，不要把首次部署、故障排查和日常更新混在一起。
- 用户询问“重新上传、重新启动”时，默认只给日常更新三步，不主动追加 PM2、依赖重装、健康检查、安全组检查等内容。

## 日常更新固定流程

### 1. Mac 本地同步

```bash
rsync -avz --progress \
  --exclude node_modules \
  --exclude reports \
  /Users/zzy/tank-trouble/ \
  ubuntu@175.178.106.164:/home/ubuntu/tank-torzan/
```

### 2. SSH 登录

```bash
ssh ubuntu@175.178.106.164
```

### 3. 重启服务

```bash
pkill -f "node server.js" || true
cd /home/ubuntu/tank-torzan
nohup env PORT=3100 node server.js > tank-torzan.log 2>&1 &
```

只有当 `package.json`、`package-lock.json` 或依赖发生变化时，才补充执行：

```bash
npm ci --omit=dev
```

普通前端、服务端业务代码、样式、图片和游戏逻辑更新，不重复安装依赖。

## 服务器映射（不得混淆）

- `152.136.211.81`：旧《坦克大战》服务器，不用于本项目。
- `175.178.106.164`：新《坦克动荡》服务器，本项目部署目标。
- 新项目远程目录：`/home/ubuntu/tank-torzan`。
- 新项目访问端口：`3100`。
