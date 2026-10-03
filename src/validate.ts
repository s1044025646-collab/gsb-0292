import { ApiError } from "./errors.js";
import type { FrameInput, SequenceInput } from "./types.js";

export const LIMITS = {
  MAX_WIDTH: 256,
  MAX_HEIGHT: 256,
  MAX_FRAMES: 256,
  MAX_RECT_PIXELS: 256 * 256,
  MAX_TOTAL_PIXELS: 256 * 256 * 64,
  MAX_DELAY_MS: 60_000,
} as const;

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function validateSequence(input: unknown): SequenceInput {
  if (typeof input !== "object" || input === null) {
    throw new ApiError("BAD_BODY", "请求体必须是 JSON 对象");
  }
  const o = input as Record<string, unknown>;
  if (!isInt(o.width) || o.width < 1 || o.width > LIMITS.MAX_WIDTH) {
    throw new ApiError("INVALID_WIDTH", `width 必须是 1..${LIMITS.MAX_WIDTH} 的整数`);
  }
  if (!isInt(o.height) || o.height < 1 || o.height > LIMITS.MAX_HEIGHT) {
    throw new ApiError("INVALID_HEIGHT", `height 必须是 1..${LIMITS.MAX_HEIGHT} 的整数`);
  }
  if (!Array.isArray(o.frames) || o.frames.length < 1) {
    throw new ApiError("NO_FRAMES", "frames 必须是非空数组");
  }
  if (o.frames.length > LIMITS.MAX_FRAMES) {
    throw new ApiError("TOO_MANY_FRAMES", `帧数超过上限 ${LIMITS.MAX_FRAMES}`);
  }
  let totalPixels = 0;
  const frames = o.frames.map((f, i) => validateFrame(f, i, o.width as number, o.height as number));
  for (const f of frames) totalPixels += f.w * f.h;
  if (totalPixels > LIMITS.MAX_TOTAL_PIXELS) {
    throw new ApiError("PIXEL_BUDGET", `像素总量超过预算 ${LIMITS.MAX_TOTAL_PIXELS}`);
  }
  return { width: o.width, height: o.height, frames };
}

function validateFrame(input: unknown, index: number, W: number, H: number): FrameInput {
  const where = `frames[${index}]`;
  if (typeof input !== "object" || input === null) {
    throw new ApiError("BAD_FRAME", `${where} 必须是对象`);
  }
  const f = input as Record<string, unknown>;
  for (const k of ["x", "y", "w", "h"] as const) {
    if (!isInt(f[k])) throw new ApiError("INVALID_RECT", `${where}.${k} 必须是整数`);
  }
  const { x, y, w, h } = f as { x: number; y: number; w: number; h: number };
  if (w < 1 || h < 1) throw new ApiError("INVALID_RECT", `${where}: w/h 必须 >= 1`);
  if (w * h > LIMITS.MAX_RECT_PIXELS) {
    throw new ApiError("RECT_TOO_LARGE", `${where}: 矩形像素数超过上限`);
  }
  if (x < 0 || y < 0 || x + w > W || y + h > H) {
    throw new ApiError("RECT_OUT_OF_BOUNDS", `${where}: 矩形 (${x},${y},${w},${h}) 超出画布 ${W}x${H}`);
  }
  if (!Array.isArray(f.pixels) || f.pixels.length !== w * h * 4) {
    throw new ApiError(
      "PIXEL_COUNT_MISMATCH",
      `${where}.pixels 长度应为 ${w * h * 4}，实际 ${Array.isArray(f.pixels) ? f.pixels.length : "非数组"}`,
    );
  }
  for (let i = 0; i < f.pixels.length; i++) {
    const c = f.pixels[i];
    if (!isInt(c) || c < 0 || c > 255) {
      throw new ApiError("INVALID_CHANNEL", `${where}.pixels[${i}] 必须是 0..255 的整数，实际 ${c}`);
    }
  }
  if (!isInt(f.delayMs) || f.delayMs < 0 || f.delayMs > LIMITS.MAX_DELAY_MS) {
    throw new ApiError("INVALID_DELAY", `${where}.delayMs 必须是 0..${LIMITS.MAX_DELAY_MS} 的整数`);
  }
  if (f.blend !== "source" && f.blend !== "over") {
    throw new ApiError("INVALID_BLEND", `${where}.blend 必须是 "source" | "over"`);
  }
  if (f.dispose !== "none" && f.dispose !== "background" && f.dispose !== "previous") {
    throw new ApiError("INVALID_DISPOSE", `${where}.dispose 必须是 "none" | "background" | "previous"`);
  }
  return {
    x, y, w, h,
    pixels: f.pixels as number[],
    delayMs: f.delayMs,
    blend: f.blend,
    dispose: f.dispose,
  };
}
