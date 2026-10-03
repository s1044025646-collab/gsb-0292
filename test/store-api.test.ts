import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { startServer } from "../src/server.js";
import type { SequenceInput } from "../src/types.js";

const px = (r: number, g: number, b: number, a: number, n: number) =>
  Array.from({ length: n }, () => [r, g, b, a]).flat();

const seqV1: SequenceInput = {
  width: 2, height: 1,
  frames: [
    { x: 0, y: 0, w: 1, h: 1, pixels: [255, 0, 0, 255], delayMs: 50, blend: "source", dispose: "none" },
    { x: 1, y: 0, w: 1, h: 1, pixels: [0, 0, 255, 255], delayMs: 50, blend: "source", dispose: "none" },
  ],
};
const seqV2: SequenceInput = {
  width: 2, height: 1,
  frames: [
    { x: 0, y: 0, w: 1, h: 1, pixels: [0, 255, 0, 255], delayMs: 50, blend: "source", dispose: "none" },
    { x: 1, y: 0, w: 1, h: 1, pixels: [0, 0, 255, 255], delayMs: 50, blend: "source", dispose: "none" },
  ],
};

test("版本化：修改早期帧产生新版本，不污染既有报告；重启后可按编号读取", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
  const db = path.join(dir, "t.db");
  let store = new Store(db);
  const { sequenceId, version } = store.createSequence(seqV1);
  assert.equal(version, 1);
  const { compose } = await import("../src/compositor.js");
  store.saveReport(compose(seqV1, sequenceId, 1));
  // 修改早期帧 -> 新版本
  const v2 = store.addVersion(sequenceId, seqV2);
  assert.equal(v2, 2);
  // 旧版本报告不受污染
  const r1 = store.getReport(sequenceId, 1)!;
  assert.deepEqual(r1.frames[0].display.slice(0, 4), [255, 0, 0, 255]);
  store.close();
  // 模拟重启
  store = new Store(db);
  const r1b = store.getReport(sequenceId, 1)!;
  assert.deepEqual(r1b.frames[0].display.slice(0, 4), [255, 0, 0, 255]);
  const { input } = store.getInput(sequenceId, 2);
  assert.deepEqual(input.frames[0].pixels, [0, 255, 0, 255]);
  const hist = store.history(sequenceId) as { versions: unknown[] };
  assert.equal(hist.versions.length, 2);
  store.close();
});

test("HTTP API 端到端", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
  const { port, close } = await startServer(path.join(dir, "api.db"), 0);
  assert.ok(port > 0, "默认应选到空闲端口");
  const base = `http://127.0.0.1:${port}`;
  try {
    // 导入
    let res = await fetch(`${base}/api/sequences`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seqV1),
    });
    assert.equal(res.status, 201);
    const { sequenceId } = (await res.json()) as { sequenceId: number };
    // 合成
    res = await fetch(`${base}/api/sequences/${sequenceId}/compose`, { method: "POST" });
    assert.equal(res.status, 200);
    // 按帧查看
    res = await fetch(`${base}/api/sequences/${sequenceId}/frames/0`);
    const f0 = (await res.json()) as { frame: { display: number[]; postDispose: number[] } };
    assert.deepEqual(f0.frame.display, [255, 0, 0, 255, 0, 0, 0, 0]);
    // 像素解释
    res = await fetch(`${base}/api/sequences/${sequenceId}/pixel?x=1&y=0&frame=1`);
    const origin = (await res.json()) as { source: string; frameIndex: number };
    assert.equal(origin.source, "frame");
    assert.equal(origin.frameIndex, 1);
    // 导出
    res = await fetch(`${base}/api/sequences/${sequenceId}/export`);
    const exp = (await res.json()) as { frameCount: number; totalDurationMs: number };
    assert.equal(exp.frameCount, 2);
    assert.equal(exp.totalDurationMs, 100);
    // 修改 -> 新版本，旧版本仍可读
    res = await fetch(`${base}/api/sequences/${sequenceId}/frames`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seqV2),
    });
    assert.equal(res.status, 201);
    res = await fetch(`${base}/api/sequences/${sequenceId}/frames/0?version=1`);
    const old = (await res.json()) as { frame: { display: number[] } };
    assert.deepEqual(old.frame.display.slice(0, 4), [255, 0, 0, 255]);
    // 历史
    res = await fetch(`${base}/api/sequences/${sequenceId}/history`);
    const hist = (await res.json()) as { versions: unknown[] };
    assert.equal(hist.versions.length, 2);
    // 错误码
    res = await fetch(`${base}/api/sequences`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 2, height: 1, frames: [{ ...seqV1.frames[0], x: 5 }] }),
    });
    assert.equal(res.status, 400);
    const err = (await res.json()) as { error: { code: string } };
    assert.equal(err.error.code, "RECT_OUT_OF_BOUNDS");
    res = await fetch(`${base}/api/sequences/999/frames/0`);
    assert.equal(res.status, 404);
  } finally {
    close();
  }
});
