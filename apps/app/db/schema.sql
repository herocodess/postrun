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

-- Fixed-window rate limits for Postrun's own routes (Better Auth keeps its own
-- in "rateLimit"). The key is a SHA-256 of what is limited (an IP address, an
-- email, an account) so no address or email is stored here.
CREATE TABLE IF NOT EXISTS rate_limit (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL
);

-- Feedback sent on purpose from the review app, `postrun feedback` or this
-- site. No IP address is kept. `usage` is the plain-text usage summary the
-- person chose to attach (counts only).
CREATE TABLE IF NOT EXISTS feedback (
  id         text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id    text REFERENCES "user"(id) ON DELETE SET NULL,
  email      text,
  rating     smallint CHECK (rating BETWEEN 1 AND 5),
  message    text,
  source     text NOT NULL,
  version    text,
  platform   text,
  usage      text,
  status     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done'))
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at DESC);

-- A person's plan (lib/plans.ts). No row means Free, which is what everyone had
-- before plans existed, so this table changes nothing until a row is written.
-- Billing (when it exists) writes plan, status and the provider ids from its
-- webhook; `overrides` is set by hand for early access, comps, or to keep an
-- existing user's old limits if Free ever changes. Example:
--   {"plan": "pro", "limits": {"activeShares": 500}, "features": ["password_links"]}
CREATE TABLE IF NOT EXISTS account_plan (
  user_id                  text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  plan                     text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  current_period_end       timestamptz,
  provider                 text,
  provider_customer_id     text,
  provider_subscription_id text UNIQUE,
  overrides                jsonb NOT NULL DEFAULT '{}'::jsonb,
  note                     text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Every billing event that changed a plan, once (webhooks retry). Kept for support.
CREATE TABLE IF NOT EXISTS billing_event (
  id          text PRIMARY KEY,
  provider    text NOT NULL,
  type        text NOT NULL,
  user_id     text REFERENCES "user"(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL
);
