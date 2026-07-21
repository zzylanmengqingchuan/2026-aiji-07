export type GridPoint = { row: number; col: number };
export type GridDirection = "up" | "down" | "left" | "right";

export type SokobanLevel = {
  name: string;
  hint: string;
  rows: string[];
};

export type SokobanState = {
  level: number;
  width: number;
  height: number;
  walls: Set<string>;
  goals: Set<string>;
  boxes: GridPoint[];
  player: GridPoint;
  moves: number;
  pushes: number;
  won: boolean;
};

export const SOKOBAN_LEVELS: SokobanLevel[] = [
  {
    name: "第一间仓库",
    hint: "先把右边的箱子绕到下方，再处理左边。",
    rows: [
      "#########",
      "#   .   #",
      "#   $   #",
      "# . $ @ #",
      "#   $ . #",
      "#       #",
      "#########",
    ],
  },
  {
    name: "折角走廊",
    hint: "墙角不可回头，先给箱子留出转身的位置。",
    rows: [
      "##########",
      "#  .     #",
      "#  $ ##  #",
      "#  $  .  #",
      "# ##  $@ #",
      "#     .  #",
      "##########",
    ],
  },
  {
    name: "三岔仓门",
    hint: "中间箱子是钥匙，别急着把它贴墙。",
    rows: [
      "###########",
      "# .  #  . #",
      "# $  #  $ #",
      "#    $    #",
      "###     ###",
      "#  . @    #",
      "###########",
    ],
  },
];

const DELTA: Record<GridDirection, GridPoint> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

export const gridKey = (point: GridPoint) => `${point.row},${point.col}`;
const add = (point: GridPoint, delta: GridPoint) => ({ row: point.row + delta.row, col: point.col + delta.col });

export function createSokobanState(level: number): SokobanState {
  const definition = SOKOBAN_LEVELS[level % SOKOBAN_LEVELS.length];
  const walls = new Set<string>();
  const goals = new Set<string>();
  const boxes: GridPoint[] = [];
  let player = { row: 1, col: 1 };
  definition.rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, colIndex) => {
      const point = { row: rowIndex, col: colIndex };
      if (cell === "#") walls.add(gridKey(point));
      if (cell === "." || cell === "*" || cell === "+") goals.add(gridKey(point));
      if (cell === "$" || cell === "*") boxes.push(point);
      if (cell === "@" || cell === "+") player = point;
    });
  });
  return {
    level: level % SOKOBAN_LEVELS.length,
    width: Math.max(...definition.rows.map((row) => row.length)),
    height: definition.rows.length,
    walls,
    goals,
    boxes,
    player,
    moves: 0,
    pushes: 0,
    won: boxes.every((box) => goals.has(gridKey(box))),
  };
}

export function moveSokoban(state: SokobanState, direction: GridDirection): SokobanState {
  if (state.won) return state;
  const target = add(state.player, DELTA[direction]);
  if (state.walls.has(gridKey(target))) return state;
  const boxIndex = state.boxes.findIndex((box) => gridKey(box) === gridKey(target));
  let boxes = state.boxes;
  let pushes = state.pushes;
  if (boxIndex >= 0) {
    const boxTarget = add(target, DELTA[direction]);
    if (state.walls.has(gridKey(boxTarget)) || state.boxes.some((box) => gridKey(box) === gridKey(boxTarget))) return state;
    boxes = state.boxes.map((box, index) => index === boxIndex ? boxTarget : box);
    pushes += 1;
  }
  return {
    ...state,
    boxes,
    player: target,
    moves: state.moves + 1,
    pushes,
    won: boxes.every((box) => state.goals.has(gridKey(box))),
  };
}
