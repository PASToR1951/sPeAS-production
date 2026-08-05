-- The clean-install baseline contains the legacy table definition only so the
-- schema export remains mechanically complete. It must never exist in a
-- production database because it is a password-bearing compatibility table.
DROP TABLE IF EXISTS public.credentials_legacy CASCADE;
DROP SEQUENCE IF EXISTS public.credentials_id_seq CASCADE;
