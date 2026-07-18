# 云服务器更新部署说明

目标机示例：`root@152.136.211.81`（CentOS，项目目录 `/root/tank-battle-4p`）

> 本机连 SSH 时请用代理 **规则模式**，不要全局模式。

---

## 方式 A：从 Mac 上传覆盖（推荐）

### 1. 本机打包

在 **Mac 终端**（不是服务器）：

```bash
cd /Users/zzy
tar czf tank-battle-4p.tgz \
  --exclude='tank-battle-4p/node_modules' \
  tank-battle-4p
ls -lh tank-battle-4p.tgz   # 应有几十 KB 以上
```

### 2. 上传

```bash
scp /Users/zzy/tank-battle-4p.tgz root@152.136.211.81:~/
```

### 3. 服务器解压并重启

```bash
ssh root@152.136.211.81
```

```bash
# 停掉旧进程
pkill -f "node server.js" || true
# 若用了 pm2：
# pm2 stop tank4p

cd ~
rm -rf tank-battle-4p.bak
mv tank-battle-4p tank-battle-4p.bak 2>/dev/null || true
tar xzf tank-battle-4p.tgz
cd tank-battle-4p
npm config set registry https://registry.npmmirror.com
npm install --production

# 前台启动（测试）
node server.js

# 或后台：
# nohup node server.js > game.log 2>&1 &
# 或 pm2 start server.js --name tank4p
```

### 4. 验证

浏览器打开：`http://152.136.211.81:3099`  
Agent 文档：`http://152.136.211.81:3099/api/v1/docs`

安全组需放行 **TCP 3099**。

---

## 方式 B：只改个别文件

例如只更新了 `server.js` 和 `public/index.html`：

```bash
# Mac
scp /Users/zzy/tank-battle-4p/server.js root@152.136.211.81:~/tank-battle-4p/
scp /Users/zzy/tank-battle-4p/public/index.html root@152.136.211.81:~/tank-battle-4p/public/

# 服务器
pkill -f "node server.js" || true
cd ~/tank-battle-4p && node server.js
```

---

## 后台常驻（建议正式使用时配置）

```bash
# 安装 pm2（Node 已装的前提下）
npm install -g pm2
cd ~/tank-battle-4p
pm2 delete tank4p 2>/dev/null || true
pm2 start server.js --name tank4p
pm2 save
pm2 startup
# 按提示再执行一行命令
pm2 logs tank4p
```

更新代码后：

```bash
# 上传覆盖文件后
cd ~/tank-battle-4p && npm install --production
pm2 restart tank4p
```

---

## 回滚

```bash
cd ~
pkill -f "node server.js" || true
rm -rf tank-battle-4p
mv tank-battle-4p.bak tank-battle-4p
cd tank-battle-4p && node server.js
```
