-- Postrun's own tables, beside Better Auth's ("user", session, account,
-- verification, "rateLimit"). Safe to run again: every statement checks first.

-- A shared report. html_gz is the gzipped, already redacted HTML; it becomes
-- NULL when the link is turned off or expires, so only the list row remains.
CREATE TABLE IF NOT EXISTS share (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title          text NOT NULL,
  agent          text,
  html_gz        bytea,
  size_bytes     integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  opens          integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz
);
CREATE INDEX IF NOT EXISTS share_user_created ON share (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_live_expiry ON share (expires_at) WHERE html_gz IS NOT NULL;

-- A computer allowed to share as you (postrun login). Only the SHA-256 of the
-- token is kept; prefix is the first characters, shown in Settings.
CREATE TABLE IF NOT EXISTS cli_token (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS cli_token_user ON cli_token (user_id) WHERE revoked_at IS NULL;

-- A one-time code from approving `postrun login` in the browser. The browser
-- hands only this code to the computer; the computer swaps it for a token by
-- proving it holds the secret behind `challenge` (PKCE, as in OAuth). Codes
-- last two minutes and work once, so a code left in browser history is useless.
CREATE TABLE IF NOT EXISTS cli_code (
  code_hash  text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name       text NOT NULL,
  challenge  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
