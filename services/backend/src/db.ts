import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { D1Like, D1Prepared } from "./env.js";

const asSql = (values: unknown[]): SQLInputValue[] => values as SQLInputValue[];

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../schema.sql");

export function applySchemaSql(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function migrate(db: D1Like, schema = readFileSync(schemaPath, "utf8")): Promise<void> {
  for (const stmt of applySchemaSql(schema)) {
    await db.prepare(stmt).run();
  }
}

/** In-memory sqlite that speaks the D1-like API for tests. */
export function openMemoryDb(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  const prepare = (sql: string): D1Prepared => {
    let bound: unknown[] = [];
    const self: D1Prepared = {
      bind(...values: unknown[]) {
        bound = values;
        return self;
      },
      async first<T>(col?: string) {
        const stmt = raw.prepare(sql);
        const row = stmt.get(...asSql(bound)) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (col) return row[col] as T;
        return row as T;
      },
      async run() {
        const stmt = raw.prepare(sql);
        const info = stmt.run(...asSql(bound));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
      async all<T>() {
        const stmt = raw.prepare(sql);
        const results = stmt.all(...asSql(bound)) as T[];
        return { results };
      },
    };
    return self;
  };
  const db: D1Like & { raw: DatabaseSync } = {
    raw,
    prepare,
    exec(sql: string) {
      raw.exec(sql);
    },
  };
  for (const stmt of applySchemaSql(readFileSync(schemaPath, "utf8"))) {
    raw.exec(stmt);
  }
  return db;
}
