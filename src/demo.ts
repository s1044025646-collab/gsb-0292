import { composeSequence, getPixel } from './engine.ts';
import { validateSequence } from './validate.ts';
import type { SequenceInput } from './types.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const input = validateSequence(
  JSON.parse(readFileSync(path.join(root, '..', 'examples', 'sequence.json'), 'utf8')),
);

function render(input: SequenceInput, label: string): void {
  console.log(`\n=== ${label} ===`);
  const { width, height } = input.canvas;
  const frames = composeSequence(input);
  frames.forEach((f, i) => {
    console.log(
      `帧 ${i} [${f.meta.startMs}..${f.meta.endMs}ms] blend=${f.meta.blend} disposal=${f.meta.disposal} rect=${JSON.stringify(f.meta.rect)}`,
    );
    console.log('  显示画布（处置前）:');
    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) row.push(getPixel(f.display, width, x, y).join(','));
      console.log('   ', row.join(' | '));
    }
    console.log('  处置后画布（下一帧背景）:');
    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) row.push(getPixel(f.after, width, x, y).join(','));
      console.log('   ', row.join(' | '));
    }
  });
}

render(input, '原始处置规则（none / background / previous / none）');

// 同一组局部帧，更换处置规则：全部改为 none，展示显示差异
const allNone: SequenceInput = {
  canvas: input.canvas,
  frames: input.frames.map((f) => ({ ...f, disposal: 'none' as const })),
};
render(allNone, '同一组帧改为全部 none（对比帧 2/3 的显示差异）');

const allPrev: SequenceInput = {
  canvas: input.canvas,
  frames: input.frames.map((f) => ({ ...f, disposal: 'previous' as const })),
};
render(allPrev, '同一组帧改为全部 previous');
