import { ApiError } from './types.ts';
import type { BlendMode, DisposalMode, SequenceInput } from './types.ts';

export const LIMITS = {
  MAX_DIM: 256,
  MAX_FRAMES: 256,
  MAX_PIXELS: 256 * 256,
  MAX_DELAY_MS: 60_000,
} as const;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function validateSequence(raw: unknown): SequenceInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new ApiError('E_BODY', '请求体必须是 JSON 对象');
  }
  const input = raw as Record<string, unknown>;
  const canvas = input.canvas as Record<string, unknown> | undefined;
  if (!canvas || !isInt(canvas.width) || !isInt(canvas.height)) {
    throw new ApiError('E_CANVAS', 'canvas.width/height 必须是整数');
  }
  if (
    canvas.width < 1 ||
    canvas.height < 1 ||
    canvas.width > LIMITS.MAX_DIM ||
    canvas.height > LIMITS.MAX_DIM ||
    canvas.width * canvas.height > LIMITS.MAX_PIXELS
  ) {
    throw new ApiError(
      'E_CANVAS',
      `画布尺寸超出限制：单边 1..${LIMITS.MAX_DIM}，总像素 <= ${LIMITS.MAX_PIXELS}`,
    );
  }
  const frames = input.frames;
  if (!Array.isArray(frames) || frames.length < 1) {
    throw new ApiError('E_FRAME_COUNT', 'frames 必须是非空数组');
  }
  if (frames.length > LIMITS.MAX_FRAMES) {
    throw new ApiError('E_FRAME_COUNT', `帧数超过上限 ${LIMITS.MAX_FRAMES}`);
  }
  const out = frames.map((f, i) => {
    if (typeof f !== 'object' || f === null) {
      throw new ApiError('E_FRAME', `第 ${i} 帧必须是对象`);
    }
    const fr = f as Record<string, unknown>;
    const rect = fr.rect as Record<string, unknown> | undefined;
    if (
      !rect ||
      !isInt(rect.x) ||
      !isInt(rect.y) ||
      !isInt(rect.width) ||
      !isInt(rect.height)
    ) {
      throw new ApiError('E_RECT', `第 ${i} 帧 rect 字段必须是整数`);
    }
    if (rect.width < 1 || rect.height < 1) {
      throw new ApiError('E_RECT', `第 ${i} 帧 rect 宽高必须 >= 1`);
    }
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > (canvas.width as number) ||
      rect.y + rect.height > (canvas.height as number)
    ) {
      throw new ApiError('E_RECT', `第 ${i} 帧矩形越界（超出画布）`);
    }
    const pixels = fr.pixels;
    const expected = (rect.width as number) * (rect.height as number) * 4;
    if (!Array.isArray(pixels) || pixels.length !== expected) {
      throw new ApiError(
        'E_PIXELS',
        `第 ${i} 帧像素数错误：期望 ${expected}，实际 ${Array.isArray(pixels) ? pixels.length : '非数组'}`,
      );
    }
    for (let p = 0; p < pixels.length; p++) {
      const v = pixels[p];
      if (!isInt(v) || v < 0 || v > 255) {
        throw new ApiError('E_CHANNEL', `第 ${i} 帧像素通道非法（索引 ${p}，值 ${v}），需 0-255 整数`);
      }
    }
    if (!isInt(fr.delayMs) || fr.delayMs < 0 || fr.delayMs > LIMITS.MAX_DELAY_MS) {
      throw new ApiError('E_DELAY', `第 ${i} 帧 delayMs 需为 0..${LIMITS.MAX_DELAY_MS} 整数`);
    }
    if (fr.blend !== 'source' && fr.blend !== 'over') {
      throw new ApiError('E_BLEND', `第 ${i} 帧 blend 必须是 "source" 或 "over"`);
    }
    if (fr.disposal !== 'none' && fr.disposal !== 'background' && fr.disposal !== 'previous') {
      throw new ApiError('E_DISPOSAL', `第 ${i} 帧 disposal 必须是 "none" | "background" | "previous"`);
    }
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pixels: pixels as number[],
      delayMs: fr.delayMs,
      blend: fr.blend as BlendMode,
      disposal: fr.disposal as DisposalMode,
    };
  });
  return {
    canvas: { width: canvas.width, height: canvas.height },
    frames: out,
  };
}
