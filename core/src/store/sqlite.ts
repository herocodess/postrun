/**
 * A thin layer over Node's built-in SQLite (node:sqlite, Node 22.13+), so the
 * store has no native dependency and installs anywhere Node runs.
 *
 * It keeps the few conveniences the store relies on:
 * - named parameters as a plain object (`{ id }` binds `@id`): keys the
 *   statement does not use are ignored, and `undefined` binds NULL;
 * - `pragma(sql)` and `pragma(sql, { simple: true })`;
 * - `transaction(fn)`, which returns a function that runs `fn` inside
 *   BEGIN IMMEDIATE / COMMIT (a SAVEPOINT when already inside one) and rolls
 *   back if it throws.
 * Rows come back as plain objects.
 */

import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

type Params = Record<string, unknown>;
type Value = SQLInputValue;

const NAMED = /[@:$]([A-Za-z_][A-Za-z0-9_]*)/g;

function bindValue(v: unknown): Value {
  if (v === undefined) return null;
  return v as Value;
}

function isParams(v: unknown): v is Params {
  return typeof v === "object" && v !== null && !ArrayBuffer.isView(v) && !Array.isArray(v);
}

function plain<T>(row: unknown): T {
  return (row === undefined ? undefined : { ...(row as object) }) as T;
}

export class Statement {
  private readonly names: Set<string>;

  constructor(
    private readonly stmt: StatementSync,
    sql: string,
  ) {
    this.names = new Set([...sql.matchAll(NAMED)].map((m) => m[1]!));
  }

  private args(params: unknown[]): Value[] | [Record<string, Value>, ...Value[]] {
    if (params.length === 1 && isParams(params[0])) {
      const named: Record<string, Value> = {};
      for (const name of this.names) named[name] = bindValue(params[0][name]);
      return [named];
    }
    return params.map(bindValue);
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt.run(...(this.args(params) as Value[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = unknown>(...params: unknown[]): T | undefined {
    return plain<T>(this.stmt.get(...(this.args(params) as Value[])));
  }

  all<T = unknown>(...params: unknown[]): T[] {
    return this.stmt.all(...(this.args(params) as Value[])).map((r) => plain<T>(r));
  }
}

export class Database {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql), sql);
  }

  /** Runs `PRAGMA <sql>`. With `simple`, returns the first column of the first row. */
  pragma(sql: string, opts: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${sql}`).all();
    if (!opts.simple) return rows.map((r) => plain(r));
    const first = rows[0];
    return first === undefined ? undefined : Object.values(first)[0];
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const savepoint = this.depth > 0 ? `postrun_sp_${this.depth}` : undefined;
      this.db.exec(savepoint ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.db.exec(savepoint ? `RELEASE ${savepoint}` : "COMMIT");
        return result;
      } catch (err) {
        this.depth--;
        this.db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
        throw err;
      }
    };
  }

  close(): void {
    this.db.close();
  }
}
