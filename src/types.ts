export type BlendMode = "source" | "over";
export type DisposeMode = "none" | "background" | "previous";

export interface FrameInput {
  x: number;
  y: number;
  w: number;
  h: number;
  /** RGBA, row-major, length = w*h*4, each 0..255 integer */
  pixels: number[];
  delayMs: number;
  blend: BlendMode;
  dispose: DisposeMode;
}

export interface SequenceInput {
  width: number;
  height: number;
  frames: FrameInput[];
}

export interface FrameReport {
  index: number;
  rect: { x: number; y: number; w: number; h: number };
  blend: BlendMode;
  dispose: DisposeMode;
  delayMs: number;
  startMs: number;
  endMs: number;
  /** RGBA of the full canvas as displayed for this frame (before dispose) */
  display: number[];
  /** RGBA of the full canvas after dispose (background for next frame) */
  postDispose: number[];
  summary: { opaque: number; transparent: number; semi: number };
}

export interface ComposeReport {
  sequenceId: number;
  version: number;
  width: number;
  height: number;
  frameCount: number;
  totalDurationMs: number;
  frames: FrameReport[];
}
