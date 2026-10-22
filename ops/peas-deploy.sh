#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${PEAS_APP_ROOT:-/opt/peas}"
CONFIG_DIR="${PEAS_CONFIG_DIR:-/etc/peas}"
CONFIG_FILE="${PEAS_CONFIG_FILE:-$CONFIG_DIR/peas.env}"
SECRETS_DIR="${PEAS_SECRETS_DIR:-$CONFIG_DIR/secrets}"
STATE_DIR="${PEAS_STATE_DIR:-$APP_ROOT/state}"
AUDIT_LOG="$STATE_DIR/audit.log"
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$SCRIPT_ROOT/docker-compose.production.yml" && -z "${PEAS_REPO_ROOT:-}" ]]; then
  REPO_ROOT="$SCRIPT_ROOT"
else
  REPO_ROOT="${PEAS_REPO_ROOT:-$APP_ROOT/current}"
fi
STAGING_DIR="$APP_ROOT/backup-staging"
STATE_FILE="$STATE_DIR/releases.tsv"
LOCK_FILE="${PEAS_LOCK_FILE:-/var/lock/peas-deploy.lock}"

PHASE="startup"
die() { printf 'ERROR: %s\n' "$* " >&2; exit 1; }
info() { PHASE="$*"; printf '[peas] %s\n' "$*"; }
warn() { printf '[peas] WARNING: %s\n' "$*" >&2; }
require_root() { [[ "$(id -u)" == 0 ]] || die "run with sudo/root"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
is_image_digest() { [[ "$1" =~ ^[^[:space:]@]+@sha256:[0-9A-Fa-f]{64}$ ]]; }
audit_event() {
  install -d -m 750 "$STATE_DIR"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1:-unknown}" "${2:-success}" >>"$AUDIT_LOG"
  chmod 640 "$AUDIT_LOG"
}

usage() {
  cat <<'EOF'
Usage: peas-deploy <install|configure|configure-email|deploy|rollback|backup|restore|bootstrap-admin|set-admin-password|doctor|status|logs|verify>
  install --domain DOMAIN --acme-email EMAIL --image IMAGE@sha256:DIGEST [--ssh-port PORT]
  configure --set KEY=VALUE [--set KEY=VALUE ...]
  configure-email
  deploy IMAGE@sha256:DIGEST
  rollback [IMAGE@sha256:DIGEST]
  backup | restore SNAPSHOT | bootstrap-admin | set-admin-password | doctor | status | logs [SERVICE] | verify
EOF
}

load_config() {
  [[ -f "$CONFIG_FILE" ]] || die "missing $CONFIG_FILE"
  local line key value line_number=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || die "invalid configuration line $line_number in $CONFIG_FILE"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid configuration key on line $line_number in $CONFIG_FILE"
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "invalid newline in $key"
    printf -v "$key" '%s' "$value"
    export "$key"
  done <"$CONFIG_FILE"
  SECRETS_DIR="${PEAS_SECRETS_DIR:-$SECRETS_DIR}"
  REPO_ROOT="${PEAS_REPO_ROOT:-$REPO_ROOT}"
  [[ -f "$REPO_ROOT/docker-compose.production.yml" ]] || die "missing production Compose file"
}

compose() {
  local files=(--project-name peas-prod --env-file "$CONFIG_FILE" -f "$REPO_ROOT/docker-compose.production.yml")
  docker compose "${files[@]}" "$@"
}

remove_retired_newsletter_container() {
  local id
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    info "removing retired newsletter container $id"
    docker rm --force "$id" >/dev/null
  done < <(docker ps --all --quiet \
    --filter 'label=com.docker.compose.project=peas-prod' \
    --filter 'label=com.docker.compose.service=newsletter-worker')
}

set_config_value() {
  local key="$1" value="$2" tmp
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid configuration key: $key"
  if [[ -n "$value" && ! "$value" =~ ^[A-Za-z0-9._:/@%+,=-]+$ ]]; then
    die "$key contains unsupported characters"
  fi
  tmp="$(mktemp "$CONFIG_FILE.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^[[:space:]]*" key "=" { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$CONFIG_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$CONFIG_FILE"
}

write_secret() {
  local name="$1" value="$2" path="$SECRETS_DIR/$1"
  install -d -m 700 "$SECRETS_DIR"
  umask 077
  printf '%s' "$value" >"$path"
  chmod 600 "$path"
  unset value
}

generate_secret_if_missing() {
  local name="$1" path="$SECRETS_DIR/$1"
  [[ -s "$path" ]] || write_secret "$name" "$(openssl rand -hex 32)"
}

validate_config() {
  local required=(PUBLIC_APP_URL BETTER_AUTH_URL ACME_EMAIL PEAS_IMAGE PEAS_POSTGRES_IMAGE PEAS_CADDY_IMAGE PEAS_CLAMAV_IMAGE PEAS_UTILITY_IMAGE PEAS_RELEASE_ID SMTP_HOST SMTP_USERNAME CONTACT_RECIPIENT_EMAIL RESTIC_REPOSITORY PEAS_CSP_MODE TRUSTED_PROXY_RANGES SECURITY_CONTACT_EMAIL SECURITY_TXT_EXPIRES PEAS_VERIFY_PUBLIC_DOCUMENT_ID)
  local key smtp_port="${SMTP_PORT:-465}" smtp_tls="${SMTP_TLS:-true}"
  for key in "${required[@]}"; do [[ -n "${!key:-}" ]] || die "missing configuration: $key"; done
  [[ "$PUBLIC_APP_URL" == https://* ]] || die "PUBLIC_APP_URL must use HTTPS"
  [[ "$BETTER_AUTH_URL" == "$PUBLIC_APP_URL" ]] || die "BETTER_AUTH_URL must equal PUBLIC_APP_URL"
  [[ "$PEAS_CSP_MODE" == report-only || "$PEAS_CSP_MODE" == enforce ]] || die "PEAS_CSP_MODE must be report-only or enforce"
  [[ "$SECURITY_CONTACT_EMAIL" == *@* ]] || die "SECURITY_CONTACT_EMAIL must be an email address"
  [[ "$PEAS_VERIFY_PUBLIC_DOCUMENT_ID" =~ ^[1-9][0-9]*$ ]] || die "PEAS_VERIFY_PUBLIC_DOCUMENT_ID must be a positive integer"
  date --date="$SECURITY_TXT_EXPIRES" +%s >/dev/null 2>&1 || die "SECURITY_TXT_EXPIRES must be an RFC 3339 timestamp"
  local security_expiry_epoch now_epoch
  security_expiry_epoch="$(date --date="$SECURITY_TXT_EXPIRES" +%s)"
  now_epoch="$(date -u +%s)"
  ((security_expiry_epoch > now_epoch && security_expiry_epoch <= now_epoch + 366 * 86400)) || die "SECURITY_TXT_EXPIRES must be in the future and no more than 366 days away"
  for key in PEAS_IMAGE PEAS_POSTGRES_IMAGE PEAS_CADDY_IMAGE PEAS_CLAMAV_IMAGE PEAS_UTILITY_IMAGE; do
    is_image_digest "${!key}" || die "$key must end in a complete @sha256 image digest"
  done
  [[ "$SMTP_USERNAME" == *@* ]] || die "SMTP_USERNAME must be an email address"
  [[ "$CONTACT_RECIPIENT_EMAIL" == *@* ]] || die "CONTACT_RECIPIENT_EMAIL must be an email address"
  [[ "$smtp_port" =~ ^[0-9]+$ ]] && ((smtp_port >= 1 && smtp_port <= 65535)) || die "SMTP_PORT must be between 1 and 65535"
  [[ "$smtp_tls" == true || "$smtp_tls" == false ]] || die "SMTP_TLS must be true or false"
  for key in db_admin_password db_app_password better_auth_secret smtp_password restic_password; do
    [[ -s "$SECRETS_DIR/$key" ]] || die "missing secret: $key"
  done
}

load_restic_credentials() {
  export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-$SECRETS_DIR/restic_password}"
  [[ -s "$RESTIC_PASSWORD_FILE" ]] || die "missing Restic password file"
  if [[ -s "$SECRETS_DIR/s3_access_key_id" ]]; then
    export AWS_ACCESS_KEY_ID="$(<"$SECRETS_DIR/s3_access_key_id")"
  fi
  if [[ -s "$SECRETS_DIR/s3_secret_access_key" ]]; then
    export AWS_SECRET_ACCESS_KEY="$(<"$SECRETS_DIR/s3_secret_access_key")"
  fi
}

wait_for_health() {
  local service="$1" timeout="${2:-180}" id state deadline
  id="$(compose ps -q "$service")"
  [[ -n "$id" ]] || die "Compose did not create $service"
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
    case "$state" in
      healthy|running) info "$service is $state"; return 0 ;;
      unhealthy|dead|exited) compose logs --tail 100 "$service" >&2; die "$service entered $state" ;;
    esac
    sleep 2
  done
  compose logs --tail 100 "$service" >&2
  die "timed out waiting for $service"
}

record_release() {
  install -d -m 750 "$STATE_DIR"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PEAS_IMAGE" "${PEAS_RELEASE_ID:-unknown}" >>"$STATE_FILE"
  chmod 640 "$STATE_FILE"
}

backup() {
  require_root
  load_config
  validate_config
  require_command restic
  load_restic_credentials
  install -d -m 750 "$STAGING_DIR"
  local stamp dump storage_archive manifest migration_version host_identifier rc=0
  local running_services=() service container_id
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dump="$STAGING_DIR/peas-db-$stamp.dump"
  storage_archive="$STAGING_DIR/peas-storage-$stamp.tar.gz"
  manifest="$STAGING_DIR/manifest-$stamp.txt"

  info "stopping application writers for a consistent backup"
  remove_retired_newsletter_container
  compose up -d db >/dev/null
  wait_for_health db 180
  for service in app media-worker abstract-worker; do
    container_id="$(compose ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" && "$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)" == true ]]; then
      running_services+=("$service")
    fi
  done
  ((${#running_services[@]} == 0)) || compose stop "${running_services[@]}" >/dev/null

  migration_version="$(compose exec -T db psql -U postgres -d peas_db -Atc "SELECT COALESCE(MAX(migration_id), 'uninitialized') FROM public.schema_migrations" 2>/dev/null || true)"
  migration_version="${migration_version:-uninitialized}"
  host_identifier="$(hostname)"

  if compose exec -T db pg_dump -U postgres -d peas_db --format=custom --no-owner >"$dump" \
    && docker run --rm -v "${PEAS_STORAGE_VOLUME:-peas-prod-storage}:/data:ro" -v "$STAGING_DIR:/backup" "$PEAS_UTILITY_IMAGE" \
      tar -czf "/backup/$(basename "$storage_archive")" -C /data . \
    && {
      printf 'created_at=%s\n' "$stamp"
      printf 'host=%s\n' "$host_identifier"
      printf 'release=%s\n' "${PEAS_IMAGE:-unknown}"
      printf 'release_id=%s\n' "${PEAS_RELEASE_ID:-unknown}"
      printf 'migration=%s\n' "$migration_version"
      printf '%s  %s\n' "$(sha256sum "$dump" | awk '{print $1}')" "$(basename "$dump")"
      printf '%s  %s\n' "$(sha256sum "$storage_archive" | awk '{print $1}')" "$(basename "$storage_archive")"
    } >"$manifest" \
    && restic backup "$dump" "$storage_archive" "$manifest" \
    && restic check; then
    rm -f "$dump" "$storage_archive" "$manifest"
  else
    rc=$?
    warn "backup failed; staging artifacts were retained in $STAGING_DIR"
  fi

  ((${#running_services[@]} == 0)) || compose start "${running_services[@]}" >/dev/null
  ((rc == 0)) || return "$rc"
  info "backup completed"
}

verify() {
  load_config
  validate_config
  bash "$REPO_ROOT/scripts/test-peas-public-edge.sh"
  info "HTTPS, certificate, headers, authorization, public DTO, and PDF checks passed"
}

deploy() {
  require_root
  load_config
  local image="${1:-${PEAS_IMAGE:-}}"
  is_image_digest "$image" || die "deploy requires a complete @sha256 image digest"
  validate_config
  local previous="${PEAS_IMAGE:-}"
  backup
  [[ -z "$previous" || "$previous" != "$image" ]] && set_config_value PEAS_IMAGE_PREVIOUS "$previous"
  set_config_value PEAS_IMAGE "$image"
  load_config
  validate_config
  compose pull app media-worker abstract-worker migrate
  compose up -d db clamav
  wait_for_health db 180
  wait_for_health clamav 300
  compose run --rm migrate
  compose up -d --remove-orphans app media-worker abstract-worker caddy
  wait_for_health app 240
  verify
  record_release
  info "deployment completed: $image"
}

rollback() {
  require_root
  load_config
  local image="${1:-${PEAS_IMAGE_PREVIOUS:-}}"
  is_image_digest "$image" || die "no previous complete @sha256 image digest recorded"
  deploy "$image"
}

doctor() {
  require_root
  load_config
  require_command docker
  require_command curl
  require_command getent
  require_command restic
  docker info >/dev/null || die "Docker daemon unavailable"
  validate_config
  compose config --quiet
  local free_kb
  free_kb="$(df -Pk "$APP_ROOT" | awk 'NR==2 {print $4}')"
  ((free_kb > 20 * 1024 * 1024)) || die "less than 20 GiB free below $APP_ROOT"
  local host="${PUBLIC_APP_URL#https://}"
  host="${host%%/*}"
  getent ahosts "$host" >/dev/null || die "DNS does not resolve $host"
  local published
  published="$(docker ps --format '{{.Ports}}')"
  [[ "$published" != *':8000->'* && "$published" != *':5432->'* ]] || die "application or PostgreSQL port is published publicly"
  load_restic_credentials
  restic snapshots --latest 1 >/dev/null || die "Restic repository is unavailable"
  if [[ -n "$(compose ps -q db 2>/dev/null || true)" ]]; then
    compose exec -T db pg_isready -U postgres -d peas_db >/dev/null || die "PostgreSQL is not ready"
  fi
  if [[ -n "$(compose ps -q app 2>/dev/null || true)" ]]; then
    curl --fail --silent --show-error --max-time 20 "$PUBLIC_APP_URL/health/ready" >/dev/null || die "public readiness check failed"
  fi
  info "doctor checks passed (DNS, ports, Compose, disk, database, readiness, and backup repository)"
}

status() {
  require_root
  load_config
  validate_config
  compose ps
  [[ -f "$STATE_FILE" ]] && tail -n 5 "$STATE_FILE" || true
}

logs() {
  require_root
  load_config
  compose logs --tail 200 "${1:-app}" | sed -E 's/(password|secret|token|authorization)([=:])[^[:space:]]+/\1\2[REDACTED]/Ig'
}

restore() {
  require_root
  load_config
  validate_config
  require_command restic
  load_restic_credentials
  local snapshot="${1:-}"
  [[ -n "$snapshot" ]] || die "restore requires an exact snapshot ID"
  [[ "$snapshot" =~ ^[A-Za-z0-9]+$ ]] || die "snapshot must be an exact Restic snapshot ID"
  if [[ "${CONFIRM_YES:-false}" != true && "${PEAS_CONFIRM_RESTORE:-}" != "RESTORE $snapshot" ]]; then
    local confirmation=""
    read -r -p "Type RESTORE $snapshot to continue: " confirmation </dev/tty || true
    [[ "$confirmation" == "RESTORE $snapshot" ]] || die "restore confirmation did not match"
  fi
  local target="$APP_ROOT/restore/$snapshot"
  [[ ! -e "$target" ]] || die "restore target already exists: $target"
  install -d -m 750 "$target"
  restic restore "$snapshot" --target "$target"
  local dump storage_archive manifest
  dump="$(find "$target" -type f -name 'peas-db-*.dump' -print -quit)"
  storage_archive="$(find "$target" -type f -name 'peas-storage-*.tar.gz' -print -quit)"
  manifest="$(find "$target" -type f -name 'manifest-*.txt' -print -quit)"
  [[ -s "$dump" && -s "$storage_archive" && -s "$manifest" ]] || die "snapshot does not contain the required database, storage, and manifest artifacts"

  local expected actual artifact artifact_name
  for artifact in "$dump" "$storage_archive"; do
    artifact_name="$(basename "$artifact")"
    expected="$(awk -v name="$artifact_name" '$2 == name || $2 ~ ("/" name "$") { print $1; exit }' "$manifest")"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "manifest has no valid checksum for $artifact_name"
    actual="$(sha256sum "$artifact" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || die "checksum mismatch for $artifact_name"
  done
  info "backup manifest checksums passed"

  if [[ -n "$manifest" ]]; then
    local recorded_image
    recorded_image="$(awk -F= '$1 == "release" {print $2; exit}' "$manifest")"
    if is_image_digest "$recorded_image"; then
      PEAS_IMAGE="$recorded_image"
      export PEAS_IMAGE
    fi
  fi

  local stamp temp_db new_db new_storage
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  temp_db="peas-restore-db-$stamp"
  new_db="peas-prod-postgres-restore-$stamp"
  new_storage="peas-prod-storage-restore-$stamp"
  docker volume create "$new_db" >/dev/null
  docker volume create "$new_storage" >/dev/null

  info "restoring the database into new volume $new_db"
  docker run --detach --name "$temp_db" \
    --volume "$new_db:/var/lib/postgresql/data" \
    --env POSTGRES_DB=peas_db \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_PASSWORD=temporary-restore-admin \
    "$PEAS_POSTGRES_IMAGE" >/dev/null
  cleanup_restore_db() { docker rm --force "$temp_db" >/dev/null 2>&1 || true; }
  trap cleanup_restore_db RETURN
  for attempt in $(seq 1 60); do
    if docker exec "$temp_db" pg_isready -U postgres -d peas_db >/dev/null 2>&1; then break; fi
    sleep 2
  done
  docker exec "$temp_db" pg_isready -U postgres -d peas_db >/dev/null
  docker cp "$SECRETS_DIR/db_app_password" "$temp_db:/run/db_app_password"
  docker exec "$temp_db" psql -v ON_ERROR_STOP=1 --username=postgres --dbname=peas_db <<'SQL'
DO $$
DECLARE app_password text;
BEGIN
  app_password := pg_read_file('/run/db_app_password');
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peas_app') THEN
    EXECUTE format('CREATE ROLE peas_app LOGIN PASSWORD %L', app_password);
  END IF;
END
$$;
SQL
  docker cp "$dump" "$temp_db:/restore.dump"
  docker exec "$temp_db" pg_restore --exit-on-error --no-owner --dbname=peas_db --username=postgres /restore.dump
  docker exec "$temp_db" rm -f /restore.dump /run/db_app_password
  docker run --rm \
    --volume "$new_storage:/data" \
    --volume "$(dirname "$storage_archive"):/restore:ro" \
    "$PEAS_UTILITY_IMAGE" \
    tar -xzf "/restore/$(basename "$storage_archive")" -C /data
  cleanup_restore_db
  trap - RETURN

  export PEAS_POSTGRES_VOLUME="$new_db"
  export PEAS_STORAGE_VOLUME="$new_storage"
  remove_retired_newsletter_container
  compose stop app media-worker abstract-worker caddy db >/dev/null 2>&1 || true
  compose up -d db
  wait_for_health db 180
  compose run --rm migrate
  compose up -d --remove-orphans app media-worker abstract-worker caddy
  wait_for_health app 240
  verify
  set_config_value PEAS_POSTGRES_VOLUME "$new_db"
  set_config_value PEAS_STORAGE_VOLUME "$new_storage"
  if is_image_digest "${recorded_image:-}"; then
    set_config_value PEAS_IMAGE "$recorded_image"
  fi
  info "restore validated; previous volumes remain untouched for manual recovery"
}

bootstrap_admin() {
  require_root
  load_config
  validate_config
  compose run --rm --interactive --tty app task admin:bootstrap
}

set_admin_password() {
  require_root
  load_config
  validate_config
  compose run --rm --interactive --tty app task admin:set-password
}

prompt_value() {
  local prompt="$1" default="${2:-}" answer
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " answer </dev/tty || true
    answer="${answer:-$default}"
  else
    read -r -p "$prompt: " answer </dev/tty || true
  fi
  printf '%s' "$answer"
}

prompt_secret() {
  local prompt="$1" answer confirm
  read -r -s -p "$prompt: " answer </dev/tty || true
  printf '\n' >/dev/tty
  read -r -s -p "Confirm $prompt: " confirm </dev/tty || true
  printf '\n' >/dev/tty
  [[ -n "$answer" && "$answer" == "$confirm" ]] || die "secret values did not match"
  unset confirm
  printf '%s' "$answer"
}

prompt_config_if_missing() {
  local key="$1" prompt="$2" default="${3:-}" current="${!key:-}" value
  [[ -n "$current" && "$current" != replace-me ]] && return 0
  value="$(prompt_value "$prompt" "$default")"
  [[ -n "$value" ]] || die "$key is required"
  set_config_value "$key" "$value"
  printf -v "$key" '%s' "$value"
  export "$key"
}

prompt_secret_if_missing() {
  local key="$1" prompt="$2" path="$SECRETS_DIR/$1" value
  [[ -s "$path" ]] && return 0
  value="$(prompt_secret "$prompt")"
  write_secret "$key" "$value"
  unset value
}

prompt_config_value() {
  local key="$1" prompt="$2" fallback="${3:-}" current="${!key:-}" value
  current="${current:-$fallback}"
  value="$(prompt_value "$prompt" "$current")"
  [[ -n "$value" ]] || die "$key is required"
  set_config_value "$key" "$value"
  printf -v "$key" '%s' "$value"
  export "$key"
}

prompt_secret_update() {
  local key="$1" prompt="$2" path="$SECRETS_DIR/$1" answer value
  if [[ -s "$path" ]]; then
    read -r -p "$prompt is already stored. Replace it? [y/N] " answer </dev/tty || true
    [[ "${answer:-N}" =~ ^[Yy]$ ]] || return 0
  fi
  value="$(prompt_secret "$prompt")"
  write_secret "$key" "$value"
  unset value
}

configure_email_values() {
  info "outgoing email configuration"
  printf '%s\n' "Use an institutional relay or a provider that accepts SMTP username/password authentication."
  prompt_config_value SMTP_HOST "SMTP host"
  prompt_config_value SMTP_PORT "SMTP port" "587"
  prompt_config_value SMTP_TLS "Use implicit TLS (true for port 465; false for STARTTLS on port 587)" "false"
  prompt_config_value SMTP_USERNAME "SMTP username / sender email"
  prompt_config_value CONTACT_RECIPIENT_EMAIL "Contact form recipient email" "${SMTP_USERNAME:-}"
  prompt_secret_update smtp_password "SMTP password"
}

restart_app_after_configuration() {
  if [[ -n "$(compose ps -q app 2>/dev/null || true)" ]]; then
    info "restarting the application to load the updated credentials"
    remove_retired_newsletter_container
    compose up -d --remove-orphans --force-recreate app
    wait_for_health app 240
    verify
  else
    info "credentials saved; they will be loaded on the next deployment"
  fi
}

configure_email() {
  require_root
  load_config
  configure_email_values
  load_config
  validate_config
  restart_app_after_configuration
  info "email configuration completed"
}

install_host() {
  require_root
  require_command apt-get
  [[ -n "$DOMAIN" && -n "$ACME_EMAIL" && -n "$IMAGE" ]] || die "install requires --domain, --acme-email, and --image"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$ && "$DOMAIN" != *".."* ]] || die "domain must be a DNS hostname without a scheme or path"
  [[ "$ACME_EMAIL" == *@*.* ]] || die "ACME email must be a valid email address"
  is_image_digest "$IMAGE" || die "install requires a complete @sha256 image digest"
  [[ "$SSH_PORT" =~ ^[1-9][0-9]{0,4}$ && "$SSH_PORT" -le 65535 ]] || die "SSH port must be a valid TCP port"
  [[ -r /etc/os-release ]] || die "cannot identify the operating system"
  . /etc/os-release
  [[ "$ID" == ubuntu && ("${VERSION_ID:-}" == "24.04" || "${VERSION_ID:-}" == "22.04") ]] || die "Ubuntu 24.04 (or approved 22.04) is required"
  case "$(uname -m)" in x86_64|aarch64) ;; *) die "unsupported CPU architecture: $(uname -m)" ;; esac
  (( $(nproc) >= 2 )) || die "at least 2 vCPUs are required; 4 are recommended"
  local free_kb
  free_kb="$(df -Pk /opt | awk 'NR==2 {print $4}')"
  ((free_kb > 20 * 1024 * 1024)) || die "less than 20 GiB free below /opt"
  getent ahosts "$DOMAIN" >/dev/null || die "DNS does not resolve $DOMAIN"
  if command -v ss >/dev/null 2>&1 && ss -ltnH | awk '{print $4}' | grep -Eq '(:80|:443)$'; then
    die "TCP port 80 or 443 is already in use"
  fi
  install -d -m 750 "$APP_ROOT" "$STATE_DIR" "$CONFIG_DIR" "$SECRETS_DIR" "$STAGING_DIR"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git jq openssl restic rsync ufw util-linux
  if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "${UBUNTU_CODENAME:-$VERSION_CODENAME}" "$(dpkg --print-architecture)" >/etc/apt/sources.list.d/docker.sources
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
  if ! docker compose version >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin
  fi
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required"
  [[ -f "$CONFIG_FILE" ]] || {
    install -m 600 /dev/null "$CONFIG_FILE"
    printf 'PUBLIC_APP_URL=https://%s\nBETTER_AUTH_URL=https://%s\nACME_EMAIL=%s\nPEAS_IMAGE=%s\nPEAS_RELEASE_ID=initial\nPEAS_SECRETS_DIR=%s\nPEAS_REPO_ROOT=%s\nPEAS_CSP_MODE=report-only\nTRUSTED_PROXY_RANGES=172.30.0.0/24\nSECURITY_CONTACT_EMAIL=%s\nSECURITY_TXT_EXPIRES=%s\n' "$DOMAIN" "$DOMAIN" "$ACME_EMAIL" "$IMAGE" "$SECRETS_DIR" "$REPO_ROOT" "$ACME_EMAIL" "$(date -u --date='+365 days' +%Y-%m-%dT%H:%M:%SZ)" >"$CONFIG_FILE"
  }
  load_config
  prompt_config_if_missing PEAS_POSTGRES_IMAGE "Pinned PostgreSQL image (for example postgres:17-alpine@sha256:...)"
  prompt_config_if_missing PEAS_CADDY_IMAGE "Pinned Caddy image (for example caddy:2-alpine@sha256:...)"
  prompt_config_if_missing PEAS_CLAMAV_IMAGE "Pinned ClamAV image (for example clamav/clamav@sha256:...)"
  prompt_config_if_missing PEAS_UTILITY_IMAGE "Pinned backup utility image (for example alpine:3.21@sha256:...)"
  prompt_config_if_missing PEAS_VERIFY_PUBLIC_DOCUMENT_ID "Stable approved public document ID with an available PDF"
  configure_email_values
  prompt_config_if_missing RESTIC_REPOSITORY "Restic S3 repository URL"
  prompt_secret_if_missing restic_password "Restic repository password"
  prompt_secret_if_missing s3_access_key_id "S3 access key ID"
  prompt_secret_if_missing s3_secret_access_key "S3 secret access key"
  generate_secret_if_missing db_admin_password
  generate_secret_if_missing db_app_password
  generate_secret_if_missing better_auth_secret
  set_config_value RESTIC_PASSWORD_FILE "$SECRETS_DIR/restic_password"
  set_config_value PEAS_REPO_ROOT "$APP_ROOT/current"

  if [[ "$REPO_ROOT" != "$APP_ROOT/current" ]]; then
    local bootstrap_release="$APP_ROOT/releases/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 750 "$bootstrap_release"
    rsync -a --exclude=.git --exclude=node_modules --exclude=storage/ "$REPO_ROOT/" "$bootstrap_release/"
    if [[ -e "$APP_ROOT/current" && ! -L "$APP_ROOT/current" ]]; then
      die "$APP_ROOT/current exists and is not a symlink"
    fi
    ln -sfn "$bootstrap_release" "$APP_ROOT/current"
    REPO_ROOT="$APP_ROOT/current"
  fi
  chmod 600 "$CONFIG_FILE"
  install -m 0750 "$REPO_ROOT/ops/peas-deploy.sh" /usr/local/sbin/peas-deploy
  install -d -m 0750 /etc/systemd/system
  install -m 0644 "$REPO_ROOT/ops/systemd/peas-backup.service" /etc/systemd/system/peas-backup.service
  install -m 0644 "$REPO_ROOT/ops/systemd/peas-backup.timer" /etc/systemd/system/peas-backup.timer
  install -m 0644 "$REPO_ROOT/ops/systemd/peas-health.service" /etc/systemd/system/peas-health.service
  install -m 0644 "$REPO_ROOT/ops/systemd/peas-health.timer" /etc/systemd/system/peas-health.timer
  systemctl daemon-reload
  systemctl enable --now peas-backup.timer
  systemctl enable --now peas-health.timer
  ufw allow "$SSH_PORT/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  load_config
  validate_config
  load_restic_credentials
  if ! restic snapshots >/dev/null 2>&1; then
    info "initializing the encrypted Restic repository"
    restic init
  fi
  if [[ -t 0 || -t 1 ]]; then
    read -r -p "Log in to GHCR now using a read-only package token? [Y/n] " answer </dev/tty || true
    if [[ "${answer:-Y}" =~ ^[Yy]$ ]]; then
      local ghcr_user ghcr_token
      ghcr_user="$(prompt_value "GHCR username")"
      read -r -s -p "GHCR read-only token: " ghcr_token </dev/tty || true
      printf '\n' >/dev/tty
      printf '%s' "$ghcr_token" | docker login ghcr.io --username "$ghcr_user" --password-stdin
      unset ghcr_token ghcr_user
    fi
  fi
  deploy "$IMAGE"
  if [[ -t 0 || -t 1 ]]; then
    read -r -p "Create the first PeAS administrator now? [Y/n] " answer </dev/tty || true
    [[ "${answer:-Y}" =~ ^[Yy]$ ]] && bootstrap_admin
  fi
  verify
  info "installation and first deployment completed"
}

command="${1:-}"
shift || true
DOMAIN=""
ACME_EMAIL=""
IMAGE=""
SSH_PORT="22"
SET_VALUES=()
POSITIONAL=()
while (($#)); do
  case "$1" in
    --domain) (($# >= 2)) || die "--domain requires a value"; DOMAIN="$2"; shift 2 ;;
    --acme-email) (($# >= 2)) || die "--acme-email requires a value"; ACME_EMAIL="$2"; shift 2 ;;
    --image) (($# >= 2)) || die "--image requires a value"; IMAGE="$2"; shift 2 ;;
    --ssh-port) (($# >= 2)) || die "--ssh-port requires a value"; SSH_PORT="$2"; shift 2 ;;
    --set) (($# >= 2)) || die "--set requires a value"; SET_VALUES+=("$2"); shift 2 ;;
    --yes) CONFIRM_YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) die "unknown option: $1" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [[ "${DRY_RUN:-false}" == true ]]; then
  info "dry run: command=$command domain=${DOMAIN:-unset} image=${IMAGE:-unset} ssh_port=$SSH_PORT"
  exit 0
fi

if [[ "$command" == "-h" || "$command" == "--help" || -z "$command" ]]; then
  usage
  [[ -n "$command" ]] || exit 2
  exit 0
fi

install -d -m 755 "$(dirname "$LOCK_FILE")"
install -d -m 750 "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another peas-deploy operation is running"
failure_handler() {
  local rc=$?
  trap - ERR
  printf '[peas] FAILED phase: %s\n' "${PHASE:-unknown}" >&2
  audit_event "$command" "failed:${PHASE:-unknown}"
  exit "$rc"
}
trap failure_handler ERR

case "$command" in
  install)
    ((${#POSITIONAL[@]} == 0)) || die "install accepts options only; see --help"
    install_host
    audit_event install
    ;;
  configure)
    ((${#POSITIONAL[@]} == 0)) || die "configure accepts only --set KEY=VALUE"
    require_root
    load_config
    for assignment in "${SET_VALUES[@]}"; do
      [[ "$assignment" == *=* ]] || die "--set requires KEY=VALUE"
      key="${assignment%%=*}"
      value="${assignment#*=}"
      case "$key" in
        TRUSTED_ORIGINS)
          set_config_value "$key" "$value"
          ;;
        PUBLIC_APP_URL|BETTER_AUTH_URL|ACME_EMAIL|PEAS_IMAGE|PEAS_RELEASE_ID|PEAS_POSTGRES_IMAGE|PEAS_CADDY_IMAGE|PEAS_CLAMAV_IMAGE|PEAS_UTILITY_IMAGE|SMTP_HOST|SMTP_PORT|SMTP_USERNAME|SMTP_TLS|CONTACT_RECIPIENT_EMAIL|RESTIC_REPOSITORY|DOCUMENT_ANNOTATIONS_ENABLED|ABSTRACT_OCR_LANGUAGES|PEAS_CSP_MODE|TRUSTED_PROXY_RANGES|SECURITY_CONTACT_EMAIL|SECURITY_TXT_EXPIRES|PEAS_VERIFY_PUBLIC_DOCUMENT_ID)
          [[ -n "$value" ]] || die "$key cannot be empty"
          set_config_value "$key" "$value"
          ;;
        *) die "unsupported non-secret setting: $key" ;;
      esac
    done
    load_config
    validate_config
    info "configuration updated without printing secret values"
    audit_event configure
    ;;
  configure-email)
    ((${#POSITIONAL[@]} == 0)) || die "configure-email takes no arguments"
    configure_email
    audit_event configure-email
    ;;
  deploy)
    ((${#POSITIONAL[@]} <= 1)) || die "deploy accepts one image digest"
    deploy "${IMAGE:-${POSITIONAL[0]:-}}"
    audit_event deploy
    ;;
  rollback)
    ((${#POSITIONAL[@]} <= 1)) || die "rollback accepts at most one image digest"
    rollback "${POSITIONAL[0]:-}"
    audit_event rollback
    ;;
  backup)
    ((${#POSITIONAL[@]} == 0)) || die "backup takes no arguments"
    backup
    audit_event backup
    ;;
  restore)
    ((${#POSITIONAL[@]} == 1)) || die "restore requires one exact snapshot ID"
    restore "${POSITIONAL[0]}"
    audit_event restore
    ;;
  bootstrap-admin)
    ((${#POSITIONAL[@]} == 0)) || die "bootstrap-admin takes no arguments"
    bootstrap_admin
    audit_event bootstrap-admin
    ;;
  set-admin-password)
    ((${#POSITIONAL[@]} == 0)) || die "set-admin-password takes no arguments"
    set_admin_password
    audit_event set-admin-password
    ;;
  doctor)
    ((${#POSITIONAL[@]} == 0)) || die "doctor takes no arguments"
    doctor
    audit_event doctor
    ;;
  status)
    ((${#POSITIONAL[@]} == 0)) || die "status takes no arguments"
    status
    audit_event status
    ;;
  logs)
    ((${#POSITIONAL[@]} <= 1)) || die "logs accepts at most one service name"
    logs "${POSITIONAL[0]:-}"
    audit_event logs
    ;;
  verify)
    ((${#POSITIONAL[@]} == 0)) || die "verify takes no arguments"
    verify
    audit_event verify
    ;;
  -h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
