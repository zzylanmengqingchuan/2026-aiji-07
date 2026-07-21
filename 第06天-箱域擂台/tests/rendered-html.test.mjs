import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("服务端能够输出三款小游戏入口", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>箱游室/);
  assert.match(html, /推箱子/);
  assert.match(html, /推一下/);
  assert.match(html, /六袋台球/);
  assert.match(html, /经典推箱子棋盘/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("结束按钮不会被游戏场地劫持指针事件", async () => {
  const source = await readFile(new URL("../app/games/PushOnceGame.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(phase !== "aiming"\) return;\s*event\.currentTarget\.setPointerCapture/);
  assert.match(source, /onPointerDown=\{\(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*restart\(\);/);
  assert.match(source, />再推一次<\/button>/);
});

test("健康检查入口可用", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("health-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "box-arcade", version: "4.0.0" });
});
