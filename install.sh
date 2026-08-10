#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DEPLOY="$SCRIPT_ROOT/ops/peas-deploy.sh"
SYSTEM_DEPLOY="/usr/local/sbin/peas-deploy"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

deploy_program() {
  if [[ -x "$SYSTEM_DEPLOY" && -f /etc/peas/peas.env ]]; then
    printf '%s' "$SYSTEM_DEPLOY"
  else
    printf '%s' "$LOCAL_DEPLOY"
  fi
}

run_as_root() {
  if [[ "$(id -u)" == 0 ]]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || die "sudo is required"
    sudo -- "$@"
  fi
}

pause_menu() {
  printf '\n'
  read -r -p "Press Enter to return to the menu..." _ </dev/tty || true
}

run_action() {
  printf '\n'
  if "$@"; then
    printf '\nCompleted successfully.\n'
  else
    local rc=$?
    printf '\nThe operation failed (exit code %s). Review the message above.\n' "$rc" >&2
  fi
  pause_menu
}

prompt_required() {
  local label="$1" value=""
  while [[ -z "$value" ]]; do
    read -r -p "$label: " value </dev/tty || true
  done
  printf '%s' "$value"
}

prompt_default() {
  local label="$1" fallback="$2" value=""
  read -r -p "$label [$fallback]: " value </dev/tty || true
  printf '%s' "${value:-$fallback}"
}

first_install() {
  printf '\nFirst-time production installation\n'
  printf '%s\n' "Have these ready before continuing:"
  printf '%s\n' \
    "  - production DNS name and ACME email" \
    "  - PeAS GHCR image pinned as @sha256:..." \
    "  - pinned PostgreSQL, Caddy, ClamAV, and Alpine utility image digests" \
    "  - SMTP relay credentials" \
    "  - Restic S3 repository credentials and a GHCR read-only token"
  printf '\nSecrets are entered with hidden prompts and stored under /etc/peas/secrets.\n\n'

  local domain acme_email image ssh_port
  domain="$(prompt_required "Production domain (without https://)")"
  acme_email="$(prompt_required "ACME certificate email")"
  image="$(prompt_required "PeAS image digest (ghcr.io/...@sha256:...)")"
  ssh_port="$(prompt_default "SSH port" "22")"

  run_action run_as_root "$LOCAL_DEPLOY" install \
    --domain "$domain" \
    --acme-email "$acme_email" \
    --image "$image" \
    --ssh-port "$ssh_port"
}

deploy_update() {
  local image
  image="$(prompt_required "New PeAS image digest (ghcr.io/...@sha256:...)")"
  run_action run_as_root "$(deploy_program)" deploy "$image"
}

show_logs() {
  local service
  service="$(prompt_default "Service (app, media-worker, abstract-worker, db, caddy, clamav)" "app")"
  run_action run_as_root "$(deploy_program)" logs "$service"
}

rollback_release() {
  local image
  read -r -p "Rollback image digest (leave blank for the recorded previous image): " image </dev/tty || true
  if [[ -n "$image" ]]; then
    run_action run_as_root "$(deploy_program)" rollback "$image"
  else
    run_action run_as_root "$(deploy_program)" rollback
  fi
}

restore_backup() {
  local snapshot
  snapshot="$(prompt_required "Exact Restic snapshot ID")"
  run_action run_as_root "$(deploy_program)" restore "$snapshot"
}

advanced_menu() {
  local choice
  while true; do
    printf '\nAdvanced recovery and diagnostics\n'
    printf '%s\n' \
      "  1) View service logs" \
      "  2) Verify public HTTPS endpoints" \
      "  3) Roll back application image" \
      "  4) Restore a Restic snapshot" \
      "  0) Back"
    read -r -p "Choose an option: " choice </dev/tty || true
    case "$choice" in
      1) show_logs ;;
      2) run_action run_as_root "$(deploy_program)" verify ;;
      3) rollback_release ;;
      4) restore_backup ;;
      0) return ;;
      *) printf 'Choose a listed option.\n' >&2 ;;
    esac
  done
}

main_menu() {
  local choice
  [[ -x "$LOCAL_DEPLOY" ]] || die "missing $LOCAL_DEPLOY"
  [[ -t 0 || -r /dev/tty ]] || die "the installation menu requires an interactive terminal"

  while true; do
    printf '\n'
    printf '%s\n' \
      "PeAS Ubuntu Server Installation" \
      "================================" \
      "  1) Install PeAS on a new server" \
      "  2) Configure outgoing email" \
      "  3) Create an administrator" \
      "  4) Set an administrator password" \
      "  5) Deploy an application update" \
      "  6) Run production readiness checks" \
      "  7) Show service status" \
      "  8) Create an encrypted backup" \
      "  9) Advanced recovery and logs" \
      "  0) Exit"
    read -r -p "Choose an option: " choice </dev/tty || true
    case "$choice" in
      1) first_install ;;
      2) run_action run_as_root "$(deploy_program)" configure-email ;;
      3) run_action run_as_root "$(deploy_program)" bootstrap-admin ;;
      4) run_action run_as_root "$(deploy_program)" set-admin-password ;;
      5) deploy_update ;;
      6) run_action run_as_root "$(deploy_program)" doctor ;;
      7) run_action run_as_root "$(deploy_program)" status ;;
      8) run_action run_as_root "$(deploy_program)" backup ;;
      9) advanced_menu ;;
      0) printf 'Goodbye.\n'; return ;;
      *) printf 'Choose a listed option.\n' >&2 ;;
    esac
  done
}

main_menu
