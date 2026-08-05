#!/usr/bin/env bash
set -Eeuo pipefail

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}" <<'SQL'
SELECT format('CREATE ROLE peas_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peas_app')\gexec
SQL
