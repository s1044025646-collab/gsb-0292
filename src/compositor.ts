import type { ComposeReport, FrameInput, FrameReport, SequenceInput } from "./types.js";

/**
 * 标准 source-over alpha 合成（非预乘，0..255 整数通道）。
 * 公式：aO = aS + aD*(1-aS)；cO = (cS*aS + cD*aD*(1-aS)) / aO
 * 舍入时机：仅在最终输出通道时四舍五入到整数；中间计算用浮点。
 * 透明归一：输出 alpha 为 0 时，RGB 一律归一为 0（透明黑）。
 */
export function blendOver(sr: number, sg: number, sb: number, sa: number,
                          dr: number, dg: number, db: number, da: number): [number, number, number, number] {
  if (sa === 0) return normalize(dr, dg, db, da);
  if (sa === 255) return [sr, sg, sb, 255];
  const aS = sa / 255, aD = da / 255;
  const aO = aS + aD * (1 - aS);
  const r = (sr * aS + dr * aD * (1 - aS)) / aO;
  const g = (sg * aS + dg * aD * (1 - aS)) / aO;
  const b = (sb * aS + db * aD * (1 - aS)) / aO;
  return normalize(r, g, b, aO * 255);
}

function normalize(r: number, g: number, b: number, a: number): [number, number, number, number] {
  const ai = Math.round(a);
  if (ai <= 0) return [0, 0, 0, 0];
  return [
    Math.min(255, Math.max(0, Math.round(r))),
    Math.min(255, Math.max(0, Math.round(g))),
    Math.min(255, Math.max(0, Math.round(b))),
    Math.min(255, ai),
  ];
}

function summarize(buf: Uint8Array): { opaque: number; transparent: number; semi: number } {
  let opaque = 0, transparent = 0, semi = 0;
  for (let i = 3; i < buf.length; i += 4) {
    const a = buf[i];
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    else semi++;
  }
  return { opaque, transparent, semi };
}

/**
 * 逐帧合成。每一步：
 * 1) 保留合成前画布（供 dispose=previous 恢复）；
 * 2) 在矩形内按 blend 合成局部像素，得到本帧显示画布（display，处置前取快照）；
 * 3) 执行 dispose：none 保留 / background 仅清本帧矩形为透明 / previous 恢复到本帧合成前状态；
 *    处置结果作为下一帧背景。
 */
export function compose(seq: SequenceInput, sequenceId = 0, version = 0): ComposeReport {
  const { width: W, height: H } = seq;
  let canvas = new Uint8Array(W * H * 4); // 初始透明黑
  const frames: FrameReport[] = [];
  let clock = 0;

  seq.frames.forEach((f, index) => {
    const pre = canvas.slice(); // 合成前快照
    // 合成
    for (let row = 0; row < f.h; row++) {
      for (let col = 0; col < f.w; col++) {
        const si = (row * f.w + col) * 4;
        const di = ((f.y + row) * W + (f.x + col)) * 4;
        const sr = f.pixels[si], sg = f.pixels[si + 1], sb = f.pixels[si + 2], sa = f.pixels[si + 3];
        if (f.blend === "source") {
          canvas[di] = sr; canvas[di + 1] = sg; canvas[di + 2] = sb; canvas[di + 3] = sa;
        } else {
          const [r, g, b, a] = blendOver(sr, sg, sb, sa, canvas[di], canvas[di + 1], canvas[di + 2], canvas[di + 3]);
          canvas[di] = r; canvas[di + 1] = g; canvas[di + 2] = b; canvas[di + 3] = a;
        }
      }
    }
    const display = canvas.slice(); // 本帧输出（处置前），独立快照
    // 处置
    if (f.dispose === "background") {
      for (let row = 0; row < f.h; row++) {
        for (let col = 0; col < f.w; col++) {
          const di = ((f.y + row) * W + (f.x + col)) * 4;
          canvas[di] = canvas[di + 1] = canvas[di + 2] = canvas[di + 3] = 0;
        }
      }
    } else if (f.dispose === "previous") {
      canvas = pre; // 恢复到本帧合成前（仅矩形内曾被改动）
    }
    const postDispose = canvas.slice();
    const startMs = clock;
    clock += f.delayMs;
    frames.push({
      index,
      rect: { x: f.x, y: f.y, w: f.w, h: f.h },
      blend: f.blend,
      dispose: f.dispose,
      delayMs: f.delayMs,
      startMs,
      endMs: clock,
      display: Array.from(display),
      postDispose: Array.from(postDispose),
      summary: summarize(display),
    });
  });

  return {
    sequenceId,
    version,
    width: W,
    height: H,
    frameCount: frames.length,
    totalDurationMs: clock,
    frames,
  };
}

export interface PixelOrigin {
  x: number;
  y: number;
  /** 来源：initial=初始透明黑；frame=某帧合成写入；disposed=被处置清除 */
  source: "initial" | "frame" | "disposed";
  frameIndex?: number;
  blend?: string;
  /** 该像素在显示帧中的 RGBA（取 source 帧的 display；disposed/initial 为 [0,0,0,0]） */
  rgba: [number, number, number, number];
  detail: string;
}

/** 解释指定像素在指定显示帧中的来源（重放至该帧，追踪来源帧号）。 */
export function explainPixel(seq: SequenceInput, x: number, y: number, upToFrame: number): PixelOrigin {
  const { width: W, height: H } = seq;
  let canvas = new Uint8Array(W * H * 4);
  // provenance: -1 = 初始/被清除；>=0 = 来源帧号
  let prov = new Int32Array(W * H).fill(-1);
  const pi = y * W + x;
  const di = pi * 4;

  for (let i = 0; i <= upToFrame && i < seq.frames.length; i++) {
    const f = seq.frames[i];
    const preCanvas = canvas.slice();
    const preProv = prov.slice();
    const inRect = x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h;
    // 合成（整矩形）
    for (let row = 0; row < f.h; row++) {
      for (let col = 0; col < f.w; col++) {
        const si = (row * f.w + col) * 4;
        const dj = ((f.y + row) * W + (f.x + col)) * 4;
        const pj = (f.y + row) * W + (f.x + col);
        const sa = f.pixels[si + 3];
        if (f.blend === "source") {
          canvas[dj] = f.pixels[si]; canvas[dj + 1] = f.pixels[si + 1];
          canvas[dj + 2] = f.pixels[si + 2]; canvas[dj + 3] = sa;
          prov[pj] = i;
        } else {
          const [r, g, b, a] = blendOver(f.pixels[si], f.pixels[si + 1], f.pixels[si + 2], sa,
            canvas[dj], canvas[dj + 1], canvas[dj + 2], canvas[dj + 3]);
          canvas[dj] = r; canvas[dj + 1] = g; canvas[dj + 2] = b; canvas[dj + 3] = a;
          if (sa > 0) prov[pj] = i; // 源完全透明时保留目标来源
        }
      }
    }
    if (i === upToFrame) {
      // 显示值在处置前取得
      const rgba: [number, number, number, number] = [canvas[di], canvas[di + 1], canvas[di + 2], canvas[di + 3]];
      const src = prov[pi];
      if (src >= 0) {
        const sf = seq.frames[src];
        return {
          x, y, source: "frame", frameIndex: src, blend: sf.blend, rgba,
          detail: inRect && src === i
            ? `像素由第 ${i} 帧（${sf.blend}）在矩形内直接写入`
            : `像素来自第 ${src} 帧合成结果，之后未被覆盖`,
        };
      }
      return { x, y, source: "initial", rgba, detail: "像素从未被任何帧写入，保持初始透明黑" };
    }
    // 处置
    if (f.dispose === "background") {
      for (let row = 0; row < f.h; row++) {
        for (let col = 0; col < f.w; col++) {
          const dj = ((f.y + row) * W + (f.x + col)) * 4;
          canvas[dj] = canvas[dj + 1] = canvas[dj + 2] = canvas[dj + 3] = 0;
          prov[(f.y + row) * W + (f.x + col)] = -1;
        }
      }
    } else if (f.dispose === "previous") {
      canvas = preCanvas;
      prov = preProv;
    }
  }
  return { x, y, source: "initial", rgba: [0, 0, 0, 0], detail: "帧序号超出范围" };
}
