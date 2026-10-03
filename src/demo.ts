import { compose } from "./compositor.js";
import type { SequenceInput } from "./types.js";

function px(r: number, g: number, b: number, a: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return out;
}

function render(canvas: number[], W: number, H: number): string {
  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = canvas[i + 3];
      row += a === 0 ? " ." : a === 255 ? (canvas[i] > 200 ? " R" : canvas[i + 2] > 200 ? " B" : " #") : " o";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

/** 同一组局部帧，仅 dispose 规则不同，展示显示差异。 */
export function runDemo(): void {
  const W = 4, H = 2;
  const baseFrames = [
    { x: 0, y: 0, w: 2, h: 2, pixels: px(255, 0, 0, 255, 4), delayMs: 100, blend: "source" as const },
    { x: 2, y: 0, w: 2, h: 2, pixels: px(0, 0, 255, 255, 4), delayMs: 100, blend: "source" as const },
    { x: 1, y: 0, w: 2, h: 2, pixels: px(0, 255, 0, 128, 4), delayMs: 100, blend: "over" as const },
  ];
  const variants: Array<{ name: string; dispose: Array<"none" | "background" | "previous"> }> = [
    { name: "全部保留 (none)", dispose: ["none", "none", "none"] },
    { name: "交错处置 (background/previous/none)", dispose: ["background", "previous", "none"] },
  ];
  for (const v of variants) {
    const seq: SequenceInput = {
      width: W, height: H,
      frames: baseFrames.map((f, i) => ({ ...f, dispose: v.dispose[i] })),
    };
    const report = compose(seq);
    console.log(`\n=== ${v.name} ===`);
    for (const f of report.frames) {
      console.log(`帧 ${f.index} dispose=${f.dispose} 显示画布:`);
      console.log(render(f.display, W, H));
    }
  }
  console.log("\n图例: .=透明 R=红 B=蓝 #=不透明其他 o=半透明");
}
