import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { composeSequence } from './engine.ts';
import { ApiError } from './types.ts';
import type { FrameResult, SequenceInput } from './types.ts';

export interface StoredFrame {
  meta: FrameResult['meta'];
  display: number[];
  after: number[];
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seq_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES seq_groups(id),
        version INTEGER NOT NULL,
        input_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(group_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id INTEGER NOT NULL UNIQUE REFERENCES sequences(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS report_frames (
        report_id INTEGER NOT NULL REFERENCES reports(id),
        frame_index INTEGER NOT NULL,
        meta_json TEXT NOT NULL,
        display_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        PRIMARY KEY (report_id, frame_index)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 导入新序列；提供 groupId 时在该组下产生新版本（用于修改早期帧的场景） */
  importSequence(input: SequenceInput, groupId?: number): { sequenceId: number; groupId: number; version: number } {
    const now = new Date().toISOString();
    let gid = groupId;
    if (gid === undefined) {
      const r = this.db.prepare('INSERT INTO seq_groups (created_at) VALUES (?)').run(now);
      gid = Number(r.lastInsertRowid);
    } else {
      const g = this.db.prepare('SELECT id FROM seq_groups WHERE id = ?').get(gid);
      if (!g) throw new ApiError('E_NOT_FOUND', `序列组 ${gid} 不存在`, 404);
    }
    const vrow = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM sequences WHERE group_id = ?')
      .get(gid) as { v: number };
    const r = this.db
      .prepare('INSERT INTO sequences (group_id, version, input_json, created_at) VALUES (?,?,?,?)')
      .run(gid, vrow.v, JSON.stringify(input), now);
    return { sequenceId: Number(r.lastInsertRowid), groupId: gid, version: vrow.v };
  }

  getSequenceInput(sequenceId: number): SequenceInput {
    const row = this.db.prepare('SELECT input_json FROM sequences WHERE id = ?').get(sequenceId) as
      | { input_json: string }
      | undefined;
    if (!row) throw new ApiError('E_NOT_FOUND', `序列 ${sequenceId} 不存在`, 404);
    return JSON.parse(row.input_json) as SequenceInput;
  }

  /** 合成并持久化报告；同一序列重复调用返回既有报告（不可变） */
  compose(sequenceId: number): { reportId: number; frameCount: number; cached: boolean } {
    const input = this.getSequenceInput(sequenceId);
    const existing = this.db.prepare('SELECT id FROM reports WHERE sequence_id = ?').get(sequenceId) as
      | { id: number }
      | undefined;
    if (existing) {
      const c = this.db
        .prepare('SELECT COUNT(*) AS c FROM report_frames WHERE report_id = ?')
        .get(existing.id) as { c: number };
      return { reportId: existing.id, frameCount: c.c, cached: true };
    }
    const results = composeSequence(input);
    const now = new Date().toISOString();
    const r = this.db.prepare('INSERT INTO reports (sequence_id, created_at) VALUES (?,?)').run(sequenceId, now);
    const reportId = Number(r.lastInsertRowid);
    const ins = this.db.prepare(
      'INSERT INTO report_frames (report_id, frame_index, meta_json, display_json, after_json) VALUES (?,?,?,?,?)',
    );
    for (const f of results) {
      ins.run(reportId, f.meta.index, JSON.stringify(f.meta), JSON.stringify(f.display), JSON.stringify(f.after));
    }
    return { reportId, frameCount: results.length, cached: false };
  }

  private reportIdFor(sequenceId: number): number {
    const row = this.db.prepare('SELECT id FROM reports WHERE sequence_id = ?').get(sequenceId) as
      | { id: number }
      | undefined;
    if (!row) throw new ApiError('E_NOT_COMPOSED', `序列 ${sequenceId} 尚未合成，请先调用 compose`, 409);
    return row.id;
  }

  getFrame(sequenceId: number, frameIndex: number): StoredFrame {
    const reportId = this.reportIdFor(sequenceId);
    const row = this.db
      .prepare('SELECT meta_json, display_json, after_json FROM report_frames WHERE report_id = ? AND frame_index = ?')
      .get(reportId, frameIndex) as
      | { meta_json: string; display_json: string; after_json: string }
      | undefined;
    if (!row) throw new ApiError('E_NOT_FOUND', `帧 ${frameIndex} 不存在`, 404);
    return {
      meta: JSON.parse(row.meta_json),
      display: JSON.parse(row.display_json),
      after: JSON.parse(row.after_json),
    };
  }

  listFrames(sequenceId: number): FrameResult['meta'][] {
    const reportId = this.reportIdFor(sequenceId);
    const rows = this.db
      .prepare('SELECT meta_json FROM report_frames WHERE report_id = ? ORDER BY frame_index')
      .all(reportId) as { meta_json: string }[];
    return rows.map((r) => JSON.parse(r.meta_json));
  }

  history(): unknown[] {
    return this.db
      .prepare(
        `SELECT s.id AS sequenceId, s.group_id AS groupId, s.version, s.created_at AS createdAt,
                r.id AS reportId, r.created_at AS composedAt
         FROM sequences s LEFT JOIN reports r ON r.sequence_id = s.id
         ORDER BY s.id`,
      )
      .all();
  }

  versions(groupId: number): unknown[] {
    return this.db
      .prepare('SELECT id AS sequenceId, version, created_at AS createdAt FROM sequences WHERE group_id = ? ORDER BY version')
      .all(groupId);
  }
}
