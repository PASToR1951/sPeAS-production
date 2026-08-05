#!/usr/bin/env bash
set -Eeuo pipefail

app_password_file=/run/secrets/db_app_password
if [[ ! -s "$app_password_file" ]]; then
  echo "db_app_password secret is required" >&2
  exit 1
fi

app_password=$(<"$app_password_file")
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$app_password" <<'SQL'
SELECT format('CREATE ROLE peas_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peas_app')\gexec
SQL
unset app_password
