# 星旅冒险 · Star Trail Adventure

横版平台跳跃小游戏：控制小绿在「1-1 翠星原野」收集星币、踩怪变身，冲向终点传送门。

- 技术：Canvas 2D + 原生 JS，零第三方依赖
- 素材：Kenney Platformer Art Deluxe（CC0），详见 `assets/CREDITS.txt`
- 音效：Web Audio API 实时合成

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

## 部署（腾讯云）

独立进程示例：

```bash
rsync -avz --exclude .DS_Store ./ ubuntu@SERVER:/home/ubuntu/31-star-trail/
ssh ubuntu@SERVER "pkill -f '31-star-trail/server.js' || true; cd /home/ubuntu/31-star-trail && nohup env PORT=3131 node server.js >> app.log 2>&1 < /dev/null &"
```

- 健康检查：`GET /health`
- 防火墙需放行 TCP `3131`（或挂到已放行端口的静态目录）

## 通关条件

走到关卡最右侧终点传送门；当前仅一关，下一关按钮为「开发中」。
