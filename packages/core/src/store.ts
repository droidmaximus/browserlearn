import { DatabaseSync } from "node:sqlite";
import type { IngestStatus } from "./protocol.js";
import { type FieldRule, redactRecording, safeRedactStep } from "./redact.js";
import type { RawStep, Recording, Run, StoredLicense, Workflow } from "./types.js";

/** Migration i brings the database from user_version i to i + 1. Append only; never edit a shipped entry. */
const MIGRATIONS = [
  `
CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS steps (
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (recording_id, seq)
);
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS workflows_name ON workflows(name);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, started_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS license (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
`,
];

function parseOne<T>(row: unknown): T | undefined {
  return row ? (JSON.parse((row as { data: string }).data) as T) : undefined;
}

function parseAll<T>(rows: unknown[]): T[] {
  return rows.map((r) => JSON.parse((r as { data: string }).data) as T);
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:" && path !== "") this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private version(): number {
    return (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  }

  private migrate(): void {
    if (this.version() > MIGRATIONS.length) {
      throw new Error(`database schema version ${this.version()} is newer than this BrowserLearn supports (${MIGRATIONS.length})`);
    }
    if (this.version() === MIGRATIONS.length) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (let v = this.version(); v < MIGRATIONS.length; v++) {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Validates and redacts the recording, then stores it. Throws on malformed input. */
  createRecording(raw: unknown): Recording {
    const r = redactRecording(raw);
    this.db.prepare("INSERT INTO recordings (id, started_at, data) VALUES (?, ?, ?)").run(r.id, r.startedAt, JSON.stringify(r));
    return r;
  }

  deleteRecording(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM recordings WHERE id = ?").run(id).changes) > 0;
  }

  getRecording(id: string): Recording | undefined {
    return parseOne(this.db.prepare("SELECT data FROM recordings WHERE id = ?").get(id));
  }

  listRecordings(): Recording[] {
    return parseAll(this.db.prepare("SELECT data FROM recordings ORDER BY started_at DESC, rowid DESC").all());
  }

  finishRecording(id: string, endedAt: number): Recording {
    const r = this.getRecording(id);
    if (!r) throw new Error(`recording not found: ${id}`);
    const done: Recording = { ...r, endedAt, status: "complete" };
    this.db.prepare("UPDATE recordings SET data = ? WHERE id = ?").run(JSON.stringify(done), id);
    return done;
  }

  /**
   * Validates and redacts the step, then stores it. A step redaction rejects is dropped; a re-sent seq
   * keeps the first stored step. Throws if the recording does not exist.
   */
  ingestStep(recordingId: string, raw: unknown, rules: FieldRule[] = []): { status: IngestStatus; step?: RawStep } {
    const step = safeRedactStep(raw, rules);
    if (!step) return { status: "dropped" };
    const { changes } = this.db
      .prepare("INSERT INTO steps (recording_id, seq, data) VALUES (?, ?, ?) ON CONFLICT (recording_id, seq) DO NOTHING")
      .run(recordingId, step.seq, JSON.stringify(step));
    return { status: Number(changes) > 0 ? "stored" : "duplicate", step };
  }

  listSteps(recordingId: string): RawStep[] {
    return parseAll(this.db.prepare("SELECT data FROM steps WHERE recording_id = ? ORDER BY seq").all(recordingId));
  }

  saveWorkflow(w: Workflow): Workflow {
    const existing = this.getWorkflow(w.id);
    const stored: Workflow = existing ? { ...w, version: existing.version + 1, createdAt: existing.createdAt } : w;
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, updated_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, data = excluded.data`,
      )
      .run(stored.id, stored.name, stored.updatedAt, JSON.stringify(stored));
    return stored;
  }

  getWorkflow(id: string): Workflow | undefined {
    return parseOne(this.db.prepare("SELECT data FROM workflows WHERE id = ?").get(id));
  }

  getWorkflowByName(name: string): Workflow | undefined {
    return parseOne(
      this.db.prepare("SELECT data FROM workflows WHERE name = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(name),
    );
  }

  listWorkflows(): Workflow[] {
    return parseAll(this.db.prepare("SELECT data FROM workflows ORDER BY updated_at DESC, rowid DESC").all());
  }

  findWorkflowBySource(recordingId: string): Workflow | undefined {
    return parseOne(
      this.db
        .prepare("SELECT data FROM workflows WHERE json_extract(data, '$.sourceRecordingId') = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1")
        .get(recordingId),
    );
  }

  uniqueWorkflowName(name: string, exceptId?: string): string {
    const taken = (n: string): boolean =>
      this.db.prepare("SELECT 1 FROM workflows WHERE name = ? AND id IS NOT ? LIMIT 1").get(n, exceptId ?? null) !== undefined;
    if (!taken(name)) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name} (${i})`;
      if (!taken(candidate)) return candidate;
    }
  }

  deleteWorkflow(id: string): boolean {
    this.db.prepare("DELETE FROM runs WHERE workflow_id = ?").run(id);
    return Number(this.db.prepare("DELETE FROM workflows WHERE id = ?").run(id).changes) > 0;
  }

  getRun(id: string): Run | undefined {
    return parseOne(this.db.prepare("SELECT data FROM runs WHERE id = ?").get(id));
  }

  saveRun(run: Run): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, workflow_id, started_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET workflow_id = excluded.workflow_id, started_at = excluded.started_at, data = excluded.data`,
      )
      .run(run.id, run.workflowId, run.startedAt, JSON.stringify(run));
  }

  listRuns(workflowId: string): Run[] {
    return parseAll(this.db.prepare("SELECT data FROM runs WHERE workflow_id = ? ORDER BY started_at DESC, rowid DESC").all(workflowId));
  }

  getLicense(): StoredLicense | undefined {
    return parseOne(this.db.prepare("SELECT data FROM license WHERE id = 1").get());
  }

  setLicense(l: StoredLicense): void {
    this.db
      .prepare("INSERT INTO license (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(JSON.stringify(l));
  }

  clearLicense(): void {
    this.db.prepare("DELETE FROM license").run();
  }
}
