import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendOver, composeSequence, getPixel, normalizeForExport } from '../src/engine.ts';
import { validateSequence } from '../src/validate.ts';
import type { SequenceInput } from '../src/types.ts';

/** 独立的简单参考实现：逐帧、逐像素重算，用于交叉核对引擎输出 */
function referenceCompose(input: SequenceInput): { display: number[]; after: number[] }[] {
  const { width, height } = input.canvas;
  let canvas = new Array(width * height * 4).fill(0);
  return input.frames.map((f) => {
    const before = [...canvas];
    const display = [...canvas];
    for (let r = 0; r < f.rect.height; r++) {
      for (let c = 0; c < f.rect.width; c++) {
        const si = (r * f.rect.width + c) * 4;
        const di = ((f.rect.y + r) * width + f.rect.x + c) * 4;
        const s = f.pixels.slice(si, si + 4);
        if (f.blend === 'source') {
          for (let k = 0; k < 4; k++) display[di + k] = s[k];
        } else {
          const as = s[3] / 255;
          const ad = display[di + 3] / 255;
          const ao = as + ad * (1 - as);
          if (ao === 0) {
            for (let k = 0; k < 4; k++) display[di + k] = 0;
          } else {
            for (let k = 0; k < 3; k++) {
              display[di + k] = Math.round((s[k] * as + display[di + k] * ad * (1 - as)) / ao);
            }
            display[di + 3] = Math.round(ao * 255);
          }
        }
      }
    }
    let after: number[];
    if (f.disposal === 'none') after = [...display];
    else if (f.disposal === 'previous') after = before;
    else {
      after = [...display];
      for (let r = 0; r < f.rect.height; r++) {
        for (let c = 0; c < f.rect.width; c++) {
          const di = ((f.rect.y + r) * width + f.rect.x + c) * 4;
          for (let k = 0; k < 4; k++) after[di + k] = 0;
        }
      }
    }
    canvas = after;
    return { display, after };
  });
}

const seq4: SequenceInput = {
  canvas: { width: 4, height: 3 },
  frames: [
    {
      rect: { x: 0, y: 0, width: 2, height: 2 },
      pixels: [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 0, 128],
      delayMs: 100,
      blend: 'source',
      disposal: 'none',
    },
    {
      rect: { x: 1, y: 1, width: 2, height: 2 },
      pixels: [255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 255, 64],
      delayMs: 100,
      blend: 'over',
      disposal: 'background',
    },
    {
      rect: { x: 2, y: 0, width: 2, height: 2 },
      pixels: [0, 255, 255, 200, 10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255],
      delayMs: 150,
      blend: 'source',
      disposal: 'previous',
    },
    {
      rect: { x: 0, y: 2, width: 4, height: 1 },
      pixels: [255, 255, 255, 255, 128, 128, 128, 128, 0, 0, 0, 255, 255, 255, 255, 90],
      delayMs: 200,
      blend: 'over',
      disposal: 'none',
    },
  ],
};

test('红色(255,0,0,128) over 不透明蓝 = (128,0,127,255)', () => {
  assert.deepEqual(blendOver([255, 0, 0, 128], [0, 0, 255, 255]), [128, 0, 127, 255]);
});

test('透明源 over 保留目标；透明源 source 覆盖目标', () => {
  assert.deepEqual(blendOver([0, 0, 0, 0], [10, 20, 30, 200]), [10, 20, 30, 200]);
  const input: SequenceInput = {
    canvas: { width: 1, height: 1 },
    frames: [
      { rect: { x: 0, y: 0, width: 1, height: 1 }, pixels: [10, 20, 30, 200], delayMs: 10, blend: 'source', disposal: 'none' },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, pixels: [0, 0, 0, 0], delayMs: 10, blend: 'source', disposal: 'none' },
    ],
  };
  const frames = composeSequence(input);
  assert.deepEqual(getPixel(frames[1].display, 1, 0, 0), [0, 0, 0, 0]);
});

test('半透明目标与半透明源的 over 合成', () => {
  const out = blendOver([255, 0, 0, 128], [0, 0, 255, 128]);
  assert.equal(out[3], 192);
  // ao≈0.7519：r = 255*as/ao ≈ 170，b = 255*ad*(1-as)/ao ≈ 85
  assert.equal(out[0], 170);
  assert.equal(out[2], 85);
  for (const v of out) {
    assert.ok(v >= 0 && v <= 255 && Number.isInteger(v));
  }
});

test('首帧基于透明黑；最后一帧输出在处置之前取得', () => {
  const frames = composeSequence(seq4);
  assert.deepEqual(getPixel(frames[0].display, 4, 3, 2), [0, 0, 0, 0]);
  const modified: SequenceInput = {
    ...seq4,
    frames: seq4.frames.map((f, i) => (i === 3 ? { ...f, disposal: 'background' as const } : f)),
  };
  const frames2 = composeSequence(modified);
  assert.deepEqual(frames2[3].display, frames[3].display, '最后一帧显示不随处置改变');
  assert.notDeepEqual(frames2[3].after, frames[3].display, '处置后画布被清除矩形');
});

test('disposal=background 只清除本帧矩形，矩形外不变', () => {
  const frames = composeSequence(seq4);
  const f1 = frames[1];
  const { width } = seq4.canvas;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      const inside = x >= 1 && x < 3 && y >= 1 && y < 3;
      const afterPx = getPixel(f1.after, width, x, y);
      if (inside) assert.deepEqual(afterPx, [0, 0, 0, 0], `(${x},${y}) 应被清除`);
      else assert.deepEqual(afterPx, getPixel(f1.display, width, x, y), `(${x},${y}) 矩形外不变`);
    }
  }
});

test('disposal=previous 恢复到本帧合成前，而非上一帧显示图', () => {
  const frames = composeSequence(seq4);
  assert.deepEqual(frames[2].after, frames[1].after);
  assert.notDeepEqual(frames[1].display, frames[1].after);
});

test('三种处置交错：与独立参考实现逐帧一致', () => {
  const frames = composeSequence(seq4);
  const ref = referenceCompose(seq4);
  assert.equal(frames.length, 4);
  frames.forEach((f, i) => {
    assert.deepEqual(f.display, ref[i].display, `帧 ${i} display`);
    assert.deepEqual(f.after, ref[i].after, `帧 ${i} after`);
  });
});

test('累计播放区间正确', () => {
  const frames = composeSequence(seq4);
  assert.deepEqual(
    frames.map((f) => [f.meta.startMs, f.meta.endMs]),
    [[0, 100], [100, 200], [200, 350], [350, 550]],
  );
});

test('快照不可变：后续帧不修改先前帧的显示结果', () => {
  const frames = composeSequence(seq4);
  const snapshot = frames.map((f) => [...f.display]);
  composeSequence(seq4);
  frames.forEach((f, i) => assert.deepEqual(f.display, snapshot[i]));
});

test('透明像素导出归一为 RGB=0', () => {
  assert.deepEqual(normalizeForExport([9, 8, 7, 0, 1, 2, 3, 255]), [0, 0, 0, 0, 1, 2, 3, 255]);
});

test('校验：矩形越界 / 像素数错误 / 非法通道 / 非法混合与处置', () => {
  const base = {
    canvas: { width: 2, height: 2 },
    frames: [
      { rect: { x: 0, y: 0, width: 1, height: 1 }, pixels: [1, 2, 3, 4], delayMs: 10, blend: 'source', disposal: 'none' },
    ],
  };
  const clone = () => JSON.parse(JSON.stringify(base));
  const code = (c: string) => (e: unknown) => (e as { code: string }).code === c;
  const bad1 = clone();
  bad1.frames[0].rect = { x: 1, y: 1, width: 2, height: 2 };
  assert.throws(() => validateSequence(bad1), code('E_RECT'));
  const bad2 = clone();
  bad2.frames[0].pixels = [1, 2, 3];
  assert.throws(() => validateSequence(bad2), code('E_PIXELS'));
  const bad3 = clone();
  bad3.frames[0].pixels = [1, 2, 3, 256];
  assert.throws(() => validateSequence(bad3), code('E_CHANNEL'));
  const bad4 = clone();
  bad4.frames[0].pixels = [1, 2, 3, -1];
  assert.throws(() => validateSequence(bad4), code('E_CHANNEL'));
  const bad5 = clone();
  bad5.frames[0].blend = 'add';
  assert.throws(() => validateSequence(bad5), code('E_BLEND'));
  const bad6 = clone();
  bad6.frames[0].disposal = 'undo';
  assert.throws(() => validateSequence(bad6), code('E_DISPOSAL'));
  const bad7 = clone();
  bad7.canvas = { width: 9999, height: 9999 };
  assert.throws(() => validateSequence(bad7), code('E_CANVAS'));
});
