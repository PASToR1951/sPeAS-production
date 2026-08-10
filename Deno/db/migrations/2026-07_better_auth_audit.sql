-- Read-only audit to run BEFORE 2026-07_better_auth.sql.
-- Quantifies the data the migration has to normalize; nothing is modified.

-- 1. Users without an email (will receive <id>@no-email.speas.invalid placeholders;
--    they cannot use email password reset until fixed).
SELECT count(*) AS users_without_email FROM users WHERE email IS NULL OR btrim(email) = '';

-- 2. Duplicate emails (case-insensitive). Only the row with the most recent
--    last_login (fallback created_at) keeps the email; the rest get placeholders.
SELECT lower(btrim(email)) AS email, array_agg(id ORDER BY last_login DESC NULLS LAST) AS user_ids
FROM users
WHERE email IS NOT NULL AND btrim(email) <> ''
GROUP BY 1
HAVING count(*) > 1;

-- 3. Credentials that are NOT PBKDF2 hashes (plaintext leftovers). These are
--    excluded from the account backfill: those users need an operator-set
--    credential or an administrator password reset.
SELECT count(*) AS non_pbkdf2_credentials FROM credentials WHERE password NOT LIKE 'pbkdf2_sha256$%';

-- 4. Users with no credential row at all (operator action is required).
SELECT count(*) AS users_without_credentials
FROM users u LEFT JOIN credentials c ON c.user_id = u.id
WHERE c.id IS NULL;

-- 5. Administrators without a deliverable email cannot use password reset.
SELECT count(*) AS administrators_without_recovery_email
FROM users u
JOIN roles r ON r.id = u.role_id
WHERE lower(r.role_name) = 'admin'
  AND (u.email IS NULL OR btrim(u.email) = '');
