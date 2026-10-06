/**
 * Creates or updates the database tables: Better Auth's, then Postrun's own
 * (db/schema.sql). Safe to run again; it only adds what's missing.
 *
 *   pnpm --filter @postrun/app db:migrate
 *
 * Reads DATABASE_URL (and the other settings) from apps/app/.env.local.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMigrations } from "better-auth/db/migration";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, "..", ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { authOptions } = await import("../lib/auth");
const { pool } = await import("../lib/db");

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions());
if (toBeCreated.length || toBeAdded.length) {
  console.log(`Better Auth: creating ${toBeCreated.map((t) => t.table).join(", ") || "nothing"}${toBeAdded.length ? `; adding columns to ${toBeAdded.map((t) => t.table).join(", ")}` : ""}`);
  await runMigrations();
} else console.log("Better Auth: tables are up to date");

await pool().query(readFileSync(join(here, "..", "db", "schema.sql"), "utf8"));
console.log("Postrun: share and cli_token tables are up to date");
await pool().end();
