/** Random ids and CLI tokens. Tokens are stored only as a SHA-256 hash. */

import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A random base62 id. 16 characters is about 95 bits: a share link's id is what keeps it unlisted. */
export function randomId(length = 16): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      // 248 = 62 * 4: drop the top values so every character is equally likely.
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const TOKEN_PREFIX = "prt_";

export function newCliToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeCliToken(t: string): boolean {
  return /^prt_[A-Za-z0-9_-]{43}$/.test(t);
}

/** A share link's id as it appears in /s/<id>. */
export function isShareId(id: string): boolean {
  return /^[A-Za-z0-9]{16}$/.test(id);
}
