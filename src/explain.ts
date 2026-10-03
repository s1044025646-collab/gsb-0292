import { getPixel } from './engine.ts';
import type { RGBA } from './engine.ts';
import type { SequenceInput } from './types.ts';

export interface PixelExplanation {
  frame: number;
  x: number;
  y: number;
  insideRect: boolean;
  blend?: string;
  sourcePixel?: RGBA;
  canvasBefore?: RGBA;
  display: RGBA;
  disposal: string;
  after: RGBA;
  reason: string;
}

/**
 * 解释指定帧某像素的来源：重放到该帧，给出合成前值、源像素、合成规则、
 * 显示值与处置后值。帧 0 的合成前画布为透明黑。
 */
export function explainPixel(
  input: SequenceInput,
  frames: { display: number[]; after: number[] }[],
  frameIndex: number,
  x: number,
  y: number,
): PixelExplanation {
  const { width } = input.canvas;
  const frame = input.frames[frameIndex];
  const before = frameIndex === 0 ? new Array(width * input.canvas.height * 4).fill(0) : frames[frameIndex - 1].after;
  const { x: rx, y: ry, width: rw, height: rh } = frame.rect;
  const inside = x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  const display = getPixel(frames[frameIndex].display, width, x, y);
  const after = getPixel(frames[frameIndex].after, width, x, y);
  const canvasBefore = getPixel(before, width, x, y) as RGBA;
  const base: PixelExplanation = {
    frame: frameIndex,
    x,
    y,
    insideRect: inside,
    canvasBefore,
    display,
    disposal: frame.disposal,
    after,
    reason: '',
  };
  if (!inside) {
    base.reason = '像素在本帧矩形之外，显示值继承上一帧处置后的画布';
    return base;
  }
  const si = ((y - ry) * rw + (x - rx)) * 4;
  base.blend = frame.blend;
  base.sourcePixel = [
    frame.pixels[si],
    frame.pixels[si + 1],
    frame.pixels[si + 2],
    frame.pixels[si + 3],
  ];
  base.reason =
    frame.blend === 'source'
      ? 'source 混合：源像素直接替换目标（含透明源）'
      : 'over 混合：标准 source-over alpha 合成';
  return base;
}
