# HTTPS + Cloudflare 域名部署

目标访问地址：

**https://tank.xiaoxiaole.space**

架构：

```text
浏览器 HTTPS
    → Cloudflare（证书、CDN、橙云代理）
        → 腾讯云 80 端口（Nginx）
            → 127.0.0.1:3099（Node 游戏）
```

---

## 一、Cloudflare 控制台（DNS + SSL）

### 1. DNS

进入域名 `xiaoxiaole.space` → **DNS** → **添加记录**：

| 类型 | 名称 | 内容 | 代理状态 |
|------|------|------|----------|
| A | `tank` | `152.136.211.81` | **已代理（橙色云）** |

- 若已有 `tank` 记录，改成上述 IP 并打开代理即可（覆盖旧项目）。
- 不要用「仅 DNS / 灰云」除非你自己在源站配好了证书。

### 2. SSL/TLS

**SSL/TLS** → 概述：

- 加密模式选 **灵活（Flexible）**  
  - 访客 ↔ Cloudflare：HTTPS  
  - Cloudflare ↔ 你的服务器：HTTP（80）  
  - 源站不必装证书，最简单  

（以后若要「完全」模式，再在源站配 Let's Encrypt。）

### 3. 可选

- **SSL/TLS → 边缘证书**：始终使用 HTTPS → 开启  
- **网络**：WebSockets → 确认开启（默认一般是开的）

---

## 二、腾讯云安全组

入站放行：

| 端口 | 用途 |
|------|------|
| **80** | Cloudflare → Nginx（必开） |
| **443** | 预留 / 部分 CF 探测（建议开） |
| **3099** | 可保留作调试；正式可只走 80 |
| **22** | SSH |

---

## 三、服务器：Nginx 反代 + 游戏进程

```bash
# 1) 安装 Nginx（CentOS）
yum install -y nginx

# 2) 写入站点配置（把仓库里的文件拷上去后）
cp ~/tank-battle-4p/deploy/nginx-tank.conf /etc/nginx/conf.d/tank.conf

# 3) 检查并启动
nginx -t
systemctl enable nginx
systemctl restart nginx

# 4) 保证游戏在 3099 运行
cd ~/tank-battle-4p
# 前台：node server.js
# 或：pm2 restart tank4p / pm2 start server.js --name tank4p
```

本机自检：

```bash
curl -sI http://127.0.0.1/ -H 'Host: tank.xiaoxiaole.space'
curl -s http://127.0.0.1:3099/health
```

---

## 四、验证

浏览器打开：

- https://tank.xiaoxiaole.space  
- https://tank.xiaoxiaole.space/api/v1/docs  

DNS 生效可能要几分钟。若 522/521：查安全组 80、Nginx、Node 是否都在跑。

---

## 五、Agent / 链接

创建房间后邀请链接会变成：

`https://tank.xiaoxiaole.space/?room=XXXX`

API：

`https://tank.xiaoxiaole.space/api/v1/...`
