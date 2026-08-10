-- Remove the retired Microsoft identity provider after every administrator
-- has a local password credential. Existing linked installations must attest
-- that a restorable backup was verified before OAuth accounts are deleted:
-- PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED

DO $$
DECLARE
  linked_accounts bigint;
  administrators_without_password bigint;
BEGIN
  SELECT COUNT(*) INTO linked_accounts
  FROM public.account
  WHERE lower(provider_id) = 'microsoft';

  SELECT COUNT(*) INTO administrators_without_password
  FROM public.users AS users
  WHERE lower(users.role) = 'admin'
    AND NOT EXISTS (
      SELECT 1
      FROM public.account AS credentials
      WHERE credentials.user_id = users.id
        AND credentials.provider_id = 'credential'
        AND credentials.password IS NOT NULL
    );

  RAISE NOTICE 'PeAS password-only migration: linked_accounts=%, administrators_without_password=%',
    linked_accounts, administrators_without_password;

  IF administrators_without_password > 0 THEN
    RAISE EXCEPTION 'Password-only migration refused: every administrator must have a credential password';
  END IF;

  IF linked_accounts > 0
     AND COALESCE(current_setting('peas.backup_verified', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Password-only migration refused: set PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED after verifying a restorable backup';
  END IF;
END $$;

-- Sessions do not record the authentication method. Revoke sessions for every
-- formerly linked administrator before removing their provider credentials.
DELETE FROM public.session AS sessions
WHERE EXISTS (
  SELECT 1
  FROM public.account AS linked
  WHERE linked.user_id = sessions.user_id
    AND lower(linked.provider_id) = 'microsoft'
);

DELETE FROM public.account
WHERE lower(provider_id) = 'microsoft';

ALTER TABLE public.account
  DROP CONSTRAINT IF EXISTS account_microsoft_provider_forbidden;
ALTER TABLE public.account
  ADD CONSTRAINT account_microsoft_provider_forbidden
  CHECK (lower(provider_id) <> 'microsoft');
