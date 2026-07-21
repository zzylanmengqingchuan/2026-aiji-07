# 星旅冒险 · Star Trail Adventure

横版平台跳跃小游戏：控制小绿在「1-1 翠星原野」收集星币、踩怪变身，冲向终点传送门。

- 技术：Canvas 2D + 原生 JS，零第三方依赖
- 素材：Kenney Platformer Art Deluxe（CC0），详见 `assets/CREDITS.txt`
- 音效：Web Audio API 实时合成

## 在线地址

独立端口部署（**不占用** 堂课坦克项目的 3100）：

**http://175.178.106.164:3131/**

| 检查项 | 地址 |
| --- | --- |
| 游戏 | http://175.178.106.164:3131/ |
| 健康检查 | http://175.178.106.164:3131/health |

服务器目录：`/home/ubuntu/31-star-trail`  
进程：`PORT=3131 node server.js`  
防火墙：TCP **3131**

> 说明：曾临时挂在 `3100/star-trail/` 下，现已拆除，避免与坦克动荡（3100）混在同一站点。

## 本地运行

```bash
# 任选其一
python3 -m http.server 8080
# 或（推荐，含 /health）
PORT=3131 node server.js
```

浏览器打开 `http://127.0.0.1:8080/` 或 `http://127.0.0.1:3131/`。

## 操作

| 端 | 操作 |
| --- | --- |
| 电脑 | A/D 或方向键移动；空格 / W / ↑ 跳跃；J/K 发射能量球（火焰形态）；P 暂停；R 重开 |
| 手机 | 左下移动，右下跳跃 / 发射 |

## 部署（腾讯云轻量）

```bash
# 同步到独立目录（不要写进 tank-torzan/public）
rsync -avz --exclude .DS_Store --exclude app.log ./ ubuntu@175.178.106.164:/home/ubuntu/31-star-trail/

# 重启独立进程
ssh ubuntu@175.178.106.164 'pkill -f 31-star-trail/server.js || true; sleep 1; cd /home/ubuntu/31-star-trail && nohup env PORT=3131 node server.js >> app.log 2>&1 < /dev/null &'

# 验证
curl -s http://175.178.106.164:3131/health
```

与堂课项目端口划分：

| 端口 | 项目 |
| --- | --- |
| 3100 | 坦克动荡 |
| 3200 | 箱域擂台 |
| **3131** | **星旅冒险** |

## 通关条件

走到关卡最右侧终点传送门；当前仅一关，下一关按钮为「开发中」。
