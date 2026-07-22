'use strict';
/* ================= 全局配置与星球等级定义 ================= */

const CFG = {
  W: 480,               // 画布逻辑宽
  H: 720,               // 画布逻辑高
  wallL: 10,            // 左墙内沿
  wallR: 470,           // 右墙内沿
  floorY: 706,          // 地面
  lineY: 132,           // 警戒线
  dropY: 72,            // 待掉落星球圆心高度
  gravity: 2400,
  restitution: 0.12,        // 星球间弹性
  wallRestitution: 0.32,    // 墙壁弹性
  airDrag: 0.02,
  floorFriction: 2.4,       // 地面摩擦
  maxSpeed: 1600,           // 限速防穿透
  dropCooldown: 0.55,       // 连续掉落间隔（秒）
  keySpeed: 420,            // 键盘瞄准移动速度（逻辑像素/秒）
  spawnLevels: 5,           // 随机掉落前 5 级
  overLineTime: 2.2,        // 超线容忍秒数
  comboWindow: 1.5,         // 连击时间窗（秒）
  storageHigh: 'planetMerge_high',
  storageSound: 'planetMerge_sound',
};

/* 11 个合成等级：陨石 → 太阳（全部原创程序化绘制） */
const LEVELS = [
  { name: '陨石',   r: 22,  kind: 'crater',  light: '#c9c9cf', base: '#9a9aa2', dark: '#5f5f66' },
  { name: '月球',   r: 30,  kind: 'crater',  light: '#f2f3f5', base: '#cfd2d6', dark: '#8a8e96' },
  { name: '水星',   r: 38,  kind: 'crater',  light: '#f0c08a', base: '#c98a4b', dark: '#7d4f24' },
  { name: '火星',   r: 46,  kind: 'crater',  light: '#ff9d6e', base: '#d9542b', dark: '#8c2c12' },
  { name: '金星',   r: 55,  kind: 'band',    light: '#ffe9a8', base: '#e8c15a', dark: '#a67c22' },
  { name: '地球',   r: 64,  kind: 'earth',   light: '#7ec3ff', base: '#3f8fdd', dark: '#1c4e8c' },
  { name: '海王星', r: 74,  kind: 'band',    light: '#7d9bff', base: '#2b4fd4', dark: '#152a75' },
  { name: '天王星', r: 84,  kind: 'ring',    light: '#c9fbfb', base: '#6fd6d6', dark: '#2f8f96', ring: '#b8efef' },
  { name: '土星',   r: 95,  kind: 'ring',    light: '#ffe3a6', base: '#d9b06a', dark: '#8f6a2e', ring: '#e8cd8f' },
  { name: '木星',   r: 107, kind: 'jupiter', light: '#f5cf9a', base: '#d89b5e', dark: '#8a5a2a' },
  { name: '太阳',   r: 120, kind: 'sun',     light: '#fff6c0', base: '#ffcf3f', dark: '#f07f13' },
];

/* 合成到第 i 级（索引）的基础得分 */
function mergeScore(levelIdx) {
  const n = levelIdx + 1;
  return (n * (n + 1)) / 2;
}

/* 确定性伪随机（用于星球表面纹理，保证每颗星球纹理稳定） */
function hashRand(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
