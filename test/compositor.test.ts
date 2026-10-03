import test from "node:test";
import assert from "node:assert/strict";
import { compose, blendOver, explainPixel } from "../src/compositor.js";
import { validateSequence } from "../src/validate.js";
import type { SequenceInput } from "../src/types.js";

/** 独立简单参考实现：逐像素浮点模拟，用于交叉核对。 */
function reference(seq: SequenceInput): number[][][][] {
  const { width: W, height: H } = seq;
  let canvas = Array.from({ length: H }, () => Array.from({ length: W }, () => [0, 0, 0, 0]));
  const displays: number[][][][] = [];
  for (const f of seq.frames) {
    const pre = canvas.map((r) => r.map((p) => [...p]));
    for (let row = 0; row < f.h; row++) {
      for (let col = 0; col < f.w; col++) {
        const si = (row * f.w + col) * 4;
        const [sr, sg, sb, sa] = f.pixels.slice(si, si + 4);
        const y = f.y + row, x = f.x + col;
        if (f.blend === "source") {
          canvas[y][x] = [sr, sg, sb, sa];
        } else {
          const [dr, dg, db, da] = canvas[y][x];
          const aS = sa / 255, aD = da / 255;
          const aO = aS + aD * (1 - aS);
          if (aO === 0) canvas[y][x] = [0, 0, 0, 0];
          else {
            const c = (s: number, d: number) => Math.round((s * aS + d * aD * (1 - aS)) / aO);
            canvas[y][x] = [c(sr, dr), c(sg, dg), c(sb, db), Math.round(aO * 255)];
          }
        }
      }
    }
    displays.push(canvas.map((r) => r.map((p) => [...p])));
    if (f.dispose === "background") {
      for (let row = 0; row < f.h; row++)
        for (let col = 0; col < f.w; col++) canvas[f.y + row][f.x + col] = [0, 0, 0, 0];
    } else if (f.dispose === "previous") {
      canvas = pre;
    }
  }
  return displays;
}

function displayOf(seq: SequenceInput, n: number): number[][][] {
  const report = compose(seq);
  const f = report.frames[n];
  const rows: number[][][] = [];
  for (let y = 0; y < seq.height; y++) {
    const row: number[][] = [];
    for (let x = 0; x < seq.width; x++) {
      const i = (y * seq.width + x) * 4;
      row.push(f.display.slice(i, i + 4));
    }
    rows.push(row);
  }
  return rows;
}

const px = (r: number, g: number, b: number, a: number, n: number) =>
  Array.from({ length: n }, () => [r, g, b, a]).flat();

test("红色(255,0,0,128) over 不透明蓝 = (128,0,127,255)", () => {
  assert.deepEqual(blendOver(255, 0, 0, 128, 0, 0, 255, 255), [128, 0, 127, 255]);
});

test("透明 source 覆盖旧像素；透明 over 保留目标", () => {
  const seq: SequenceInput = {
    width: 2, height: 1,
    frames: [
      { x: 0, y: 0, w: 2, h: 1, pixels: px(0, 0, 255, 255, 2), delayMs: 10, blend: "source", dispose: "none" },
      { x: 0, y: 0, w: 1, h: 1, pixels: [0, 0, 0, 0], delayMs: 10, blend: "source", dispose: "none" },
      { x: 1, y: 0, w: 1, h: 1, pixels: [0, 0, 0, 0], delayMs: 10, blend: "over", dispose: "none" },
    ],
  };
  const d = displayOf(seq, 2)[0];
  assert.deepEqual(d[0], [0, 0, 0, 0], "透明 source 应覆盖为透明");
  assert.deepEqual(d[1], [0, 0, 255, 255], "透明 over 应保留目标");
});

test("半透明目标与半透明源的 over 合成", () => {
  const [r, g, b, a] = blendOver(255, 0, 0, 128, 0, 0, 255, 128);
  // aO = 0.502+0.502*(1-0.502) = 0.7529 -> 192
  assert.equal(a, 192);
  assert.ok(r > 0 && b > 0 && r + b <= 256);
  assert.ok(g === 0);
});

test("source 直接替换且忽略目标 alpha", () => {
  assert.deepEqual(
    compose({
      width: 1, height: 1,
      frames: [
        { x: 0, y: 0, w: 1, h: 1, pixels: [9, 9, 9, 77], delayMs: 0, blend: "source", dispose: "none" },
        { x: 0, y: 0, w: 1, h: 1, pixels: [1, 2, 3, 4], delayMs: 0, blend: "source", dispose: "none" },
      ],
    }).frames[1].display,
    [1, 2, 3, 4],
  );
});

test("四帧交错处置：覆盖/清除/恢复之前，并与参考实现核对", () => {
  const seq: SequenceInput = {
    width: 4, height: 2,
    frames: [
      { x: 0, y: 0, w: 2, h: 2, pixels: px(255, 0, 0, 255, 4), delayMs: 100, blend: "source", dispose: "none" },
      { x: 2, y: 0, w: 2, h: 2, pixels: px(0, 0, 255, 255, 4), delayMs: 100, blend: "source", dispose: "background" },
      { x: 1, y: 0, w: 2, h: 2, pixels: px(0, 255, 0, 128, 4), delayMs: 100, blend: "over", dispose: "previous" },
      { x: 0, y: 0, w: 1, h: 1, pixels: [255, 255, 0, 255], delayMs: 100, blend: "source", dispose: "none" },
    ],
  };
  const report = compose(seq);
  const ref = reference(seq);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(displayOf(seq, i), ref[i], `第 ${i} 帧显示画布与参考实现不一致`);
  }
  // 帧2 显示含绿色混合，但 dispose=previous 后背景回到帧2 合成前（左红右透明，因帧1 被 background 清除）
  const post2 = report.frames[2].postDispose;
  const at = (x: number, y: number) => post2.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
  assert.deepEqual(at(0, 0), [255, 0, 0, 255], "恢复之前应保留帧0 的红色");
  assert.deepEqual(at(2, 0), [0, 0, 0, 0], "帧1 已被 background 清除，不能恢复成显示图");
  // 帧3 在 (0,0) 写黄色，其余背景来自恢复后的状态
  const d3 = displayOf(seq, 3);
  assert.deepEqual(d3[0][0], [255, 255, 0, 255]);
  assert.deepEqual(d3[0][1], [255, 0, 0, 255]);
  assert.deepEqual(d3[0][2], [0, 0, 0, 0]);
  // 时间区间
  assert.deepEqual(report.frames.map((f) => [f.startMs, f.endMs]), [[0, 100], [100, 200], [200, 300], [300, 400]]);
});

test("dispose=background 只清本帧矩形，矩形外不变", () => {
  const seq: SequenceInput = {
    width: 3, height: 1,
    frames: [
      { x: 0, y: 0, w: 3, h: 1, pixels: px(255, 0, 0, 255, 3), delayMs: 10, blend: "source", dispose: "none" },
      { x: 1, y: 0, w: 1, h: 1, pixels: px(0, 0, 255, 255, 1), delayMs: 10, blend: "source", dispose: "background" },
    ],
  };
  const post = compose(seq).frames[1].postDispose;
  assert.deepEqual(post.slice(0, 4), [255, 0, 0, 255]);
  assert.deepEqual(post.slice(4, 8), [0, 0, 0, 0]);
  assert.deepEqual(post.slice(8, 12), [255, 0, 0, 255]);
});

test("快照不可变：后续帧不修改已输出的显示画布", () => {
  const seq: SequenceInput = {
    width: 1, height: 1,
    frames: [
      { x: 0, y: 0, w: 1, h: 1, pixels: [255, 0, 0, 255], delayMs: 10, blend: "source", dispose: "none" },
      { x: 0, y: 0, w: 1, h: 1, pixels: [0, 0, 255, 255], delayMs: 10, blend: "source", dispose: "none" },
      { x: 0, y: 0, w: 1, h: 1, pixels: [0, 255, 0, 255], delayMs: 10, blend: "source", dispose: "none" },
    ],
  };
  const report = compose(seq);
  assert.deepEqual(report.frames[0].display, [255, 0, 0, 255]);
  assert.deepEqual(report.frames[1].display, [0, 0, 255, 255]);
  assert.deepEqual(report.frames[2].display, [0, 255, 0, 255]);
});

test("首帧基于透明黑；最后一帧输出在处置之前取得", () => {
  const seq: SequenceInput = {
    width: 1, height: 1,
    frames: [
      { x: 0, y: 0, w: 1, h: 1, pixels: [10, 20, 30, 40], delayMs: 10, blend: "source", dispose: "background" },
    ],
  };
  const report = compose(seq);
  assert.deepEqual(report.frames[0].display, [10, 20, 30, 40], "最后一帧显示必须在处置前");
  assert.deepEqual(report.frames[0].postDispose, [0, 0, 0, 0]);
});

test("像素来源解释", () => {
  const seq: SequenceInput = {
    width: 2, height: 1,
    frames: [
      { x: 0, y: 0, w: 2, h: 1, pixels: px(255, 0, 0, 255, 2), delayMs: 10, blend: "source", dispose: "background" },
      { x: 1, y: 0, w: 1, h: 1, pixels: [0, 0, 255, 255], delayMs: 10, blend: "source", dispose: "none" },
    ],
  };
  const o0 = explainPixel(seq, 0, 0, 1);
  assert.equal(o0.source, "initial"); // 帧0 被 background 清除
  const o1 = explainPixel(seq, 1, 0, 1);
  assert.equal(o1.source, "frame");
  assert.equal(o1.frameIndex, 1);
  assert.deepEqual(o1.rgba, [0, 0, 255, 255]);
});

test("校验：矩形越界 / 像素数错误 / 非法通道 / 非法枚举", () => {
  const base = { width: 2, height: 2, frames: [{ x: 0, y: 0, w: 1, h: 1, pixels: [0, 0, 0, 0], delayMs: 1, blend: "source", dispose: "none" }] };
  const code = (fn: () => void) => { try { fn(); } catch (e) { return (e as { code: string }).code; } return ""; };
  assert.equal(code(() => validateSequence({ ...base, frames: [{ ...base.frames[0], x: 2 }] })), "RECT_OUT_OF_BOUNDS");
  assert.equal(code(() => validateSequence({ ...base, frames: [{ ...base.frames[0], pixels: [0, 0, 0] }] })), "PIXEL_COUNT_MISMATCH");
  assert.equal(code(() => validateSequence({ ...base, frames: [{ ...base.frames[0], pixels: [0, 0, 0, 256] }] })), "INVALID_CHANNEL");
  assert.equal(code(() => validateSequence({ ...base, frames: [{ ...base.frames[0], pixels: [0, 0, 0, -1] }] })), "INVALID_CHANNEL");
  assert.equal(code(() => validateSequence({ ...base, frames: [{ ...base.frames[0], blend: "add" }] })), "INVALID_BLEND");
  assert.equal(code(() => validateSequence({ ...base, frames: [{ ...base.frames[0], dispose: "restore" }] })), "INVALID_DISPOSE");
  assert.equal(code(() => validateSequence({ ...base, width: 9999 })), "INVALID_WIDTH");
});

test("输出通道不出现负数或超界", () => {
  const seq: SequenceInput = {
    width: 2, height: 2,
    frames: [
      { x: 0, y: 0, w: 2, h: 2, pixels: px(100, 150, 200, 90, 4), delayMs: 5, blend: "source", dispose: "none" },
      { x: 0, y: 0, w: 2, h: 2, pixels: px(250, 30, 60, 130, 4), delayMs: 5, blend: "over", dispose: "none" },
    ],
  };
  for (const f of compose(seq).frames) {
    for (const buf of [f.display, f.postDispose]) {
      for (const c of buf) {
        assert.ok(Number.isInteger(c) && c >= 0 && c <= 255, `通道越界: ${c}`);
      }
    }
  }
});
