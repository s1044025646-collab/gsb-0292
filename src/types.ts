export type BlendMode = 'source' | 'over';
export type DisposalMode = 'none' | 'background' | 'previous';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameInput {
  rect: Rect;
  /** 按行优先展开的 RGBA 扁平数组，长度 = width*height*4，通道 0-255 整数 */
  pixels: number[];
  /** 显示时长（毫秒），仅用于记录累计播放区间 */
  delayMs: number;
  blend: BlendMode;
  disposal: DisposalMode;
}

export interface SequenceInput {
  canvas: { width: number; height: number };
  frames: FrameInput[];
}

export interface FrameMeta {
  index: number;
  rect: Rect;
  blend: BlendMode;
  disposal: DisposalMode;
  delayMs: number;
  startMs: number;
  endMs: number;
  summary: {
    opaque: number;
    semiTransparent: number;
    transparent: number;
    checksum: number;
  };
}

export interface FrameResult {
  meta: FrameMeta;
  /** 本帧应显示的完整画布（处置之前），RGBA 扁平数组 */
  display: number[];
  /** 处置之后的画布，作为下一帧背景 */
  after: number[];
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
