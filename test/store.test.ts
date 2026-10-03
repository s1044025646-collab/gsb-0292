import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import type { SequenceInput } from '../src/types.ts';

function makeInput(color: number[]): SequenceInput {
  return {
    canvas: { width: 2, height: 2 },
    frames: [
      { rect: { x: 0, y: 0, width: 2, height: 2 }, pixels: [...color, ...color, ...color, ...color], delayMs: 50, blend: 'source', disposal: 'none' },
    ],
  };
}

test('导入-合成-读取-版本隔离-重启持久化', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fc-'));
  try {
    const db = path.join(dir, 'app.db');
    let store = new Store(db);
    const s1 = store.importSequence(makeInput([255, 0, 0, 255]));
    assert.equal(s1.version, 1);
    const r1 = store.compose(s1.sequenceId);
    assert.equal(r1.cached, false);
    assert.equal(store.compose(s1.sequenceId).cached, true, '重复合成返回既有报告');

    // 修改早期帧 → 同组新版本，旧报告不被污染
    const s2 = store.importSequence(makeInput([0, 255, 0, 255]), s1.groupId);
    assert.equal(s2.version, 2);
    store.compose(s2.sequenceId);
    const f1 = store.getFrame(s1.sequenceId, 0);
    const f2 = store.getFrame(s2.sequenceId, 0);
    assert.deepEqual(f1.display.slice(0, 4), [255, 0, 0, 255], '旧版本报告不变');
    assert.deepEqual(f2.display.slice(0, 4), [0, 255, 0, 255]);
    assert.equal((store.versions(s1.groupId) as unknown[]).length, 2);
    store.close();

    // 重启后按编号读取同一帧
    store = new Store(db);
    const f1b = store.getFrame(s1.sequenceId, 0);
    assert.deepEqual(f1b.display, f1.display);
    assert.equal((store.history() as unknown[]).length, 2);
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows 下 SQLite 句柄释放有延迟，临时目录留给系统清理 */ };
  }
});

test('未合成时读取帧返回 E_NOT_COMPOSED', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fc-'));
  try {
    const store = new Store(path.join(dir, 'app.db'));
    const { sequenceId } = store.importSequence(makeInput([1, 2, 3, 4]));
    assert.throws(() => store.getFrame(sequenceId, 0), (e: unknown) => (e as { code: string }).code === 'E_NOT_COMPOSED');
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows 下 SQLite 句柄释放有延迟，临时目录留给系统清理 */ };
  }
});
