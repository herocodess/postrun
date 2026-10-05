/**
 * Ingest token: a random bearer secret that lets local adapters push to
 * POST /api/ingest.
 *
 * Why a token on a loopback-only server: the Host check stops DNS rebinding,
 * but a web page can still send a blind cross-site POST to 127.0.0.1. A
 * browser cannot attach an Authorization header to such a request without a
 * CORS preflight, which this server never approves, so requiring the token
 * shuts that path. It also keeps other local users' processes out on shared
 * machines, since the file is owner-only.
 *
 * Stored at ~/.postrun/ingest-token (0600), created on first use. Override the
 * path with POSTRUN_INGEST_TOKEN_FILE. Delete the file to rotate.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ensurePrivateDir, ensurePrivateFile, PRIVATE_FILE_MODE } from "../util/files.js";

/** Shortest token accepted from disk. Generated tokens are 43 characters (32 bytes, base64url). */
export const MIN_TOKEN_LENGTH = 32;

export function defaultTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["POSTRUN_INGEST_TOKEN_FILE"] ?? join(homedir(), ".postrun", "ingest-token");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Read the token at path, creating it (owner-only) when absent. */
export function loadOrCreateToken(path: string = defaultTokenPath()): string {
  ensurePrivateDir(dirname(path));
  const existing = readToken(path);
  if (existing !== undefined) return existing;
  const token = generateToken();
  try {
    // wx: never overwrite a token another process created between the read and here.
    writeFileSync(path, token + "\n", { mode: PRIVATE_FILE_MODE, flag: "wx" });
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const raced = readToken(path);
    if (raced === undefined) throw new Error(`${path} exists but holds no token`);
    return raced;
  }
}

function readToken(path: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  ensurePrivateFile(path);
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`${path} holds a token shorter than ${MIN_TOKEN_LENGTH} characters; delete it to generate a new one`);
  }
  return token;
}

/** Constant-time check of an Authorization header against the token. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return false;
  // Hash both sides so the comparison is fixed-length and timingSafeEqual never throws on length.
  const a = createHash("sha256").update(m[1] as string).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}
