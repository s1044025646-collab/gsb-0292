import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ComposeReport, SequenceInput } from "./types.js";

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        seq_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        input_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (seq_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        seq_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (seq_id, version)
      );
    `);
  }

  createSequence(seq: SequenceInput): { sequenceId: number; version: number } {
    const now = new Date().toISOString();
    const r = this.db
      .prepare("INSERT INTO sequences (width, height, created_at) VALUES (?, ?, ?)")
      .run(seq.width, seq.height, now);
    const id = Number(r.lastInsertRowid);
    this.addVersion(id, seq);
    return { sequenceId: id, version: 1 };
  }

  /** 修改帧序列 -> 产生新版本，不影响既有版本与报告 */
  addVersion(seqId: number, seq: SequenceInput): number {
    this.requireSequence(seqId);
    const row = this.db.prepare("SELECT MAX(version) AS v FROM versions WHERE seq_id = ?").get(seqId) as { v: number };
    const version = row.v + 1;
    this.db
      .prepare("INSERT INTO versions (seq_id, version, input_json, created_at) VALUES (?, ?, ?, ?)")
      .run(seqId, version, JSON.stringify(seq), new Date().toISOString());
    return version;
  }

  getInput(seqId: number, version?: number): { input: SequenceInput; version: number } {
    this.requireSequence(seqId);
    const v = version ?? (this.db.prepare("SELECT MAX(version) AS v FROM versions WHERE seq_id = ?").get(seqId) as { v: number }).v;
    const row = this.db.prepare("SELECT input_json FROM versions WHERE seq_id = ? AND version = ?").get(seqId, v) as
      | { input_json: string }
      | undefined;
    if (!row) throw Object.assign(new Error(`版本 ${v} 不存在`), { code: "VERSION_NOT_FOUND", status: 404 });
    return { input: JSON.parse(row.input_json), version: v };
  }

  saveReport(report: ComposeReport): void {
    this.db
      .prepare("INSERT OR REPLACE INTO reports (seq_id, version, report_json, created_at) VALUES (?, ?, ?, ?)")
      .run(report.sequenceId, report.version, JSON.stringify(report), new Date().toISOString());
  }

  getReport(seqId: number, version?: number): ComposeReport | null {
    this.requireSequence(seqId);
    const v = version ?? (this.db.prepare("SELECT MAX(version) AS v FROM versions WHERE seq_id = ?").get(seqId) as { v: number }).v;
    const row = this.db.prepare("SELECT report_json FROM reports WHERE seq_id = ? AND version = ?").get(seqId, v) as
      | { report_json: string }
      | undefined;
    return row ? JSON.parse(row.report_json) : null;
  }

  listSequences(): unknown[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.width, s.height, s.created_at,
                (SELECT MAX(version) FROM versions v WHERE v.seq_id = s.id) AS latest_version,
                (SELECT COUNT(*) FROM reports r WHERE r.seq_id = s.id) AS report_count
         FROM sequences s ORDER BY s.id`,
      )
      .all();
    return rows as unknown[];
  }

  history(seqId: number): unknown {
    this.requireSequence(seqId);
    const versions = this.db
      .prepare(
        `SELECT v.version, v.created_at,
                (r.seq_id IS NOT NULL) AS has_report
         FROM versions v LEFT JOIN reports r ON r.seq_id = v.seq_id AND r.version = v.version
         WHERE v.seq_id = ? ORDER BY v.version`,
      )
      .all(seqId);
    return { sequenceId: seqId, versions };
  }

  private requireSequence(seqId: number): void {
    const row = this.db.prepare("SELECT id FROM sequences WHERE id = ?").get(seqId);
    if (!row) throw Object.assign(new Error(`序列 ${seqId} 不存在`), { code: "SEQ_NOT_FOUND", status: 404 });
  }

  close(): void {
    this.db.close();
  }
}
