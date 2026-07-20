# 部署准备说明

部署目标为 `root@152.136.211.81`。`175.178.106.164` 属于参考的《坦克大战》项目，不是本项目服务器。默认应用端口为 `3100`，PM2 进程名为 `tank-trouble`。

## SSH 登录

```bash
ssh root@152.136.211.81
```

## 上传与安装

在本机打包：

```bash
cd /Users/zzy
tar czf tank-trouble.tgz \
  --exclude='tank-trouble/node_modules' \
  --exclude='tank-trouble/reports' \
  tank-trouble
scp /Users/zzy/tank-trouble.tgz root@152.136.211.81:~/
```

上传完成后登录服务器并安装：

```bash
cd ~
tar xzf tank-trouble.tgz
cd tank-trouble
npm ci --omit=dev
PORT=3100 node server.js
```

验证：

```bash
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3100/api/v1/docs
```

若暂时不配置 Nginx，可直接访问 `http://152.136.211.81:3100`，此时腾讯云安全组和服务器防火墙都需要放行 TCP 3100。

## PM2 常驻

```bash
cd ~/tank-trouble
pm2 delete tank-trouble 2>/dev/null || true
PORT=3100 pm2 start server.js --name tank-trouble
pm2 save
pm2 logs tank-trouble
```

更新后：

```bash
cd ~/tank-trouble
npm ci --omit=dev
pm2 restart tank-trouble --update-env
```

## Nginx

仓库提供的 `deploy/nginx-tank.conf` 已代理到 `127.0.0.1:3100`，并包含 WebSocket 升级头。复制到服务器后先检查再重载：

```bash
sudo cp deploy/nginx-tank.conf /etc/nginx/conf.d/tank-trouble.conf
sudo nginx -t
sudo systemctl reload nginx
```

现有配置的域名为 `tank.xiaoxiaole.space`，其 DNS A 记录应指向 `152.136.211.81`。若只经 Nginx 对外提供 80/443，无需向公网开放 3100。

## 回滚建议

部署前保留上一版目录或压缩包，回滚时切回旧目录后执行：

```bash
pm2 restart tank-trouble --update-env
```

项目验收完成前不执行实际部署。
