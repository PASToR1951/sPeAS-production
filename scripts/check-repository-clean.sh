#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

failures=0
fail() {
  echo "repository cleanliness failure: $*" >&2
  failures=$((failures + 1))
}

while IFS= read -r -d '' path; do
  case "$path" in
    .env|.env.*|*/.env|*/.env.*)
      case "$path" in
        .env.example|.env.*.example|*/.env.example|*/.env.*.example) ;;
        *) fail "secret environment file is tracked: $path" ;;
      esac
      ;;
    *.pem|*.key|*.p12|*.pfx|*.jks|*.der)
      fail "private-key or certificate material is tracked: $path"
      ;;
    *.pdf|*.dump|*.bak|*.sql.gz)
      fail "binary/archive data file is tracked: $path"
      ;;
    storage/*|*/storage/*|node_modules/*|*/node_modules/*|coverage/*|test-results/*|playwright-report/*|output/*)
      fail "generated or uploaded data path is tracked: $path"
      ;;
    Deno/db/peas_db.sql|Deno/db/schema.sql|app-ui/next-app/*|dev-nginx.conf|mime.types)
      fail "known development-only artifact is tracked: $path"
      ;;
  esac

  size="$(git cat-file -s ":$path")"
  if [[ "$size" =~ ^[0-9]+$ ]] && ((size > 10 * 1024 * 1024)); then
    fail "tracked file exceeds 10 MiB allowlist: $path ($size bytes)"
  fi
done < <(git ls-files -z)

matches_file="$(mktemp)"
trap 'rm -f "$matches_file"' EXIT
if git grep -n -I -E "admin123|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY" -- ':!scripts/check-repository-clean.sh' >"$matches_file" 2>/dev/null; then
  while IFS= read -r match; do fail "credential-like content found: $match"; done <"$matches_file"
fi

if ((failures > 0)); then
  exit 1
fi
echo "Repository cleanliness check passed."
