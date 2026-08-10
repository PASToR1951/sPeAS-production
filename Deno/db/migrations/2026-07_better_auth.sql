-- Better Auth migration: Better Auth takes ownership of the existing `users`
-- table (snake_case columns mapped in Deno/config/auth.ts) and gets fresh
-- `account`, `session`, and `verification` tables. Legacy `sessions` is
-- dropped (everyone re-logs-in) and `credentials` is renamed to
-- `credentials_legacy` after its hashes are backfilled into `account`.
--
-- Run 2026-07_better_auth_audit.sql first and review the duplicate-email
-- output; rows that lose the dedupe get a placeholder email and keep
-- password login only.

BEGIN;

-- ============ users: align with the Better Auth user model ============
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name varchar(255),
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS username varchar(255),
  ADD COLUMN IF NOT EXISTS display_username varchar(255),
  ADD COLUMN IF NOT EXISTS role varchar(20);

UPDATE public.users
SET name = NULLIF(btrim(concat_ws(' ', first_name, middle_name, last_name)), '')
WHERE name IS NULL;
UPDATE public.users SET name = id WHERE name IS NULL;
ALTER TABLE public.users ALTER COLUMN name SET NOT NULL;

-- Denormalized auth role; roles/role_id stay for the rest of the app.
UPDATE public.users u SET role = lower(r.role_name)
FROM public.roles r
WHERE u.role_id = r.id AND u.role IS NULL;
UPDATE public.users SET role = 'user' WHERE role IS NULL OR role = 'guest';

-- School-ID login via the Better Auth username plugin.
UPDATE public.users SET username = lower(id) WHERE username IS NULL;
UPDATE public.users SET display_username = id WHERE display_username IS NULL;

-- Email: normalize, dedupe (keep most recently active), and fill gaps with
-- placeholders that cannot receive account-recovery messages.
UPDATE public.users SET email = lower(btrim(email)) WHERE email IS NOT NULL;
UPDATE public.users SET email = NULL WHERE email = '';
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY email
           ORDER BY last_login DESC NULLS LAST, created_at DESC NULLS LAST, id
         ) AS rn
  FROM public.users
  WHERE email IS NOT NULL
)
UPDATE public.users u SET email = NULL
FROM ranked
WHERE u.id = ranked.id AND ranked.rn > 1;
UPDATE public.users
SET email = lower(id) || '@no-email.speas.invalid'
WHERE email IS NULL;
ALTER TABLE public.users ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON public.users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON public.users (username);

-- Operator-provisioned administrator emails are trusted regardless of domain.
UPDATE public.users
SET email_verified = true
WHERE lower(role) = 'admin'
  AND email NOT LIKE '%@no-email.speas.invalid';

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Better Auth core tables ============
CREATE TABLE IF NOT EXISTS public.account (
  id                        varchar PRIMARY KEY,
  user_id                   varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id                varchar NOT NULL,
  provider_id               varchar NOT NULL,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON public.account (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_uidx ON public.account (provider_id, account_id);

CREATE TABLE IF NOT EXISTS public.session (
  id          varchar PRIMARY KEY,
  user_id     varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token       varchar NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  ip_address  varchar,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON public.session (user_id);

CREATE TABLE IF NOT EXISTS public.verification (
  id          varchar PRIMARY KEY,
  identifier  varchar NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON public.verification (identifier);

-- ============ backfill: credentials -> account ============
-- Better Auth stores password credentials as provider_id='credential' with
-- account_id = user id and the hash in account.password. Hashes are copied
-- verbatim; the custom password.verify in config/auth.ts keeps PBKDF2 valid.
INSERT INTO public.account (id, user_id, account_id, provider_id, password, created_at, updated_at)
SELECT gen_random_uuid()::text,
       c.user_id,
       c.user_id,
       'credential',
       c.password,
       COALESCE(c.created_at, CURRENT_TIMESTAMP),
       COALESCE(c.updated_at, CURRENT_TIMESTAMP)
FROM public.credentials c
JOIN public.users u ON u.id = c.user_id
WHERE c.password LIKE 'pbkdf2_sha256$%'
ON CONFLICT (provider_id, account_id) DO NOTHING;

-- ============ retire legacy auth tables ============
DROP TABLE IF EXISTS public.sessions;
ALTER TABLE public.credentials RENAME TO credentials_legacy;

COMMIT;
