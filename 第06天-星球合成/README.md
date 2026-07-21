# 第 06 天 · 星球合成

合成大太阳（Suika 玩法变体）。纯前端 Canvas + 自研圆形物理，Soft Pop 主题。

## 在线试玩

- 游戏：http://175.178.106.164:3132/
- 健康检查：http://175.178.106.164:3132/health

## 本地启动

```bash
node server.js
# 默认 PORT=3132
# 或：PORT=3132 node server.js
```

浏览器打开 http://127.0.0.1:3132/

## 布局

- **左侧**：游戏介绍 + 分数 / 最高分 / 下一个 + 操作选项
- **右侧**：对战主界面（Canvas）

## 目录

```text
index.html      页面结构
style.css       Soft Pop 主题样式
server.js       零依赖静态服务
js/
  config.js     等级与物理参数
  audio.js      Web Audio 音效
  effects.js    粒子 / 飘字 / 震屏
  physics.js    圆形刚体与合成
  render.js     程序化星球绘制
  game.js       状态机与主循环
```
