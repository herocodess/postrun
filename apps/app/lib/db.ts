/**
 * One Postgres pool per server instance. On Neon, DATABASE_URL is the pooled
 * address (the host has `-pooler` in it), so many short-lived Vercel functions
 * can share a few real connections.
 */

import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

const g = globalThis as unknown as { __postrunPool?: Pool };

export function pool(): Pool {
  if (!g.__postrunPool) {
    const url = env("DATABASE_URL");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    g.__postrunPool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 10_000,
      // Neon needs TLS; a database on this machine usually has none.
      ssl: local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: true },
    });
    // On Vercel, closes idle connections before a function instance is suspended, so none leak. A no-op elsewhere.
    attachDatabasePool(g.__postrunPool);
  }
  return g.__postrunPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const r = await pool().query<T>(text, values);
  return r.rows;
}

export type Q = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

/** Run `fn` in one transaction on one connection; rolled back if it throws. */
export async function tx<R>(fn: (q: Q) => Promise<R>): Promise<R> {
  const client: PoolClient = await pool().connect();
  const q: Q = async (text, values = []) => (await client.query(text, values)).rows;
  try {
    await client.query("BEGIN");
    const r = await fn(q);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
