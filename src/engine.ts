import type { FrameResult, SequenceInput } from './types.ts';

export type RGBA = [number, number, number, number];

/**
 * 标准 source-over alpha 合成。
 * 内部使用归一化浮点 alpha（0..1），仅在输出时 Math.round 到 0..255 并 clamp。
 * 完全透明结果归一为 (0,0,0,0)，避免透明像素携带无意义颜色。
 */
export function blendOver(src: RGBA, dst: RGBA): RGBA {
  const as = src[3] / 255;
  const ad = dst[3] / 255;
  const ao = as + ad * (1 - as);
  if (ao === 0) return [0, 0, 0, 0];
  const ch = (cs: number, cd: number) =>
    clamp255(Math.round((cs * as + cd * ad * (1 - as)) / ao));
  return [ch(src[0], dst[0]), ch(src[1], dst[1]), ch(src[2], dst[2]), clamp255(Math.round(ao * 255))];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function blank(size: number): number[] {
  return new Array<number>(size * 4).fill(0);
}

function summarize(display: number[]) {
  let opaque = 0;
  let semiTransparent = 0;
  let transparent = 0;
  let checksum = 0;
  for (let i = 0; i < display.length; i += 4) {
    const a = display[i + 3];
    if (a === 255) opaque++;
    else if (a === 0) transparent++;
    else semiTransparent++;
    checksum = (checksum + display[i] * 3 + display[i + 1] * 5 + display[i + 2] * 7 + a * 11) % 1_000_000_007;
  }
  return { opaque, semiTransparent, transparent, checksum };
}

/**
 * 逐步合成整个序列。
 * 每一步：先复制合成前画布（供 disposal=previous 恢复），在矩形内合成局部像素得到
 * 本帧显示画布（display，处置之前取样），之后才执行处置得到 after（下一帧背景）。
 * 所有返回数组均为独立拷贝，后续帧不会改写先前结果。
 */
export function composeSequence(input: SequenceInput): FrameResult[] {
  const { width, height } = input.canvas;
  const size = width * height;
  let canvas = blank(size); // 初始画布：透明黑
  const results: FrameResult[] = [];
  let clock = 0;

  input.frames.forEach((frame, index) => {
    const before = canvas.slice(); // 合成前完整快照
    const display = canvas.slice(); // 在副本上合成
    const { x, y, width: rw, height: rh } = frame.rect;
    for (let row = 0; row < rh; row++) {
      for (let col = 0; col < rw; col++) {
        const si = (row * rw + col) * 4;
        const di = ((y + row) * width + (x + col)) * 4;
        const src: RGBA = [
          frame.pixels[si],
          frame.pixels[si + 1],
          frame.pixels[si + 2],
          frame.pixels[si + 3],
        ];
        if (frame.blend === 'source') {
          display[di] = src[0];
          display[di + 1] = src[1];
          display[di + 2] = src[2];
          display[di + 3] = src[3];
        } else {
          const dst: RGBA = [display[di], display[di + 1], display[di + 2], display[di + 3]];
          const out = blendOver(src, dst);
          display[di] = out[0];
          display[di + 1] = out[1];
          display[di + 2] = out[2];
          display[di + 3] = out[3];
        }
      }
    }

    // 处置：在显示画布取样之后执行，只影响下一帧背景
    let after: number[];
    if (frame.disposal === 'none') {
      after = display.slice();
    } else if (frame.disposal === 'background') {
      after = display.slice();
      for (let row = 0; row < rh; row++) {
        for (let col = 0; col < rw; col++) {
          const di = ((y + row) * width + (x + col)) * 4;
          after[di] = 0;
          after[di + 1] = 0;
          after[di + 2] = 0;
          after[di + 3] = 0;
        }
      }
    } else {
      // previous：恢复到本帧合成前的像素（仅矩形区域实际被改动过，整体恢复等价）
      after = before;
    }

    const startMs = clock;
    clock += frame.delayMs;
    results.push({
      meta: {
        index,
        rect: frame.rect,
        blend: frame.blend,
        disposal: frame.disposal,
        delayMs: frame.delayMs,
        startMs,
        endMs: clock,
        summary: summarize(display),
      },
      display,
      after,
    });
    canvas = after;
  });
  return results;
}

/** 导出时透明像素颜色归一：alpha=0 的像素 RGB 输出为 0 */
export function normalizeForExport(pixels: number[]): number[] {
  const out = pixels.slice();
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
    }
  }
  return out;
}

export function getPixel(canvas: number[], width: number, x: number, y: number): RGBA {
  const i = (y * width + x) * 4;
  return [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]];
}
