import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { validateSequence } from './validate.ts';
import { composeSequence, normalizeForExport } from './engine.ts';
import { explainPixel } from './explain.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? path.join(root, '..', 'data', 'app.db');
const store = new Store(dbPath);

function arg(i: number, name: string): string {
  const v = process.argv[3 + i];
  if (v === undefined) throw new Error(`缺少参数 ${name}`);
  return v;
}

function out(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

const cmd = process.argv[2];
try {
  switch (cmd) {
    case 'import': {
      // import <file.json> [groupId]
      const raw = JSON.parse(readFileSync(arg(0, 'file'), 'utf8'));
      const input = validateSequence(raw);
      const gid = process.argv[4] !== undefined ? Number(process.argv[4]) : undefined;
      out(store.importSequence(input, gid));
      break;
    }
    case 'compose': {
      out(store.compose(Number(arg(0, 'sequenceId'))));
      break;
    }
    case 'frames': {
      out(store.listFrames(Number(arg(0, 'sequenceId'))));
      break;
    }
    case 'frame': {
      // frame <seqId> <n> [--after]
      const seqId = Number(arg(0, 'sequenceId'));
      const n = Number(arg(1, 'frameIndex'));
      const after = process.argv.includes('--after');
      const stored = store.getFrame(seqId, n);
      const input = store.getSequenceInput(seqId);
      out({
        meta: stored.meta,
        canvas: after ? 'after' : 'display',
        width: input.canvas.width,
        height: input.canvas.height,
        pixels: normalizeForExport(after ? stored.after : stored.display),
      });
      break;
    }
    case 'pixel': {
      // pixel <seqId> <n> <x> <y>
      const seqId = Number(arg(0, 'sequenceId'));
      const input = store.getSequenceInput(seqId);
      out(
        explainPixel(input, composeSequence(input), Number(arg(1, 'n')), Number(arg(2, 'x')), Number(arg(3, 'y'))),
      );
      break;
    }
    case 'export': {
      const seqId = Number(arg(0, 'sequenceId'));
      const n = Number(arg(1, 'frameIndex'));
      const stored = store.getFrame(seqId, n);
      const input = store.getSequenceInput(seqId);
      out({ frame: n, width: input.canvas.width, height: input.canvas.height, pixels: normalizeForExport(stored.display) });
      break;
    }
    case 'history': {
      out(store.history());
      break;
    }
    case 'versions': {
      out(store.versions(Number(arg(0, 'groupId'))));
      break;
    }
    default:
      console.log(`用法: node src/cli.ts <命令>
  import <file.json> [groupId]   导入帧序列（给 groupId 则产生新版本）
  compose <seqId>                合成并保存报告（幂等）
  frames <seqId>                 列出每帧元数据（摘要/矩形/规则/播放区间）
  frame <seqId> <n> [--after]    查看第 n 帧显示画布或处置后画布
  pixel <seqId> <n> <x> <y>      解释指定像素来源
  export <seqId> <n>             导出第 n 帧显示像素 JSON
  history                        查询历史
  versions <groupId>             查看组内版本`);
  }
} finally {
  store.close();
}
