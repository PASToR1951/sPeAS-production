#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

if [[ -z "${PEAS_RELEASE_ID:-}" ]] && command -v git >/dev/null 2>&1; then
  PEAS_RELEASE_ID="$(git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD 2>/dev/null || true)"
  export PEAS_RELEASE_ID
fi

# 1. Try Docker Compose if Docker daemon is running
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo "[peas-start] Launching PeAS via Docker Compose..."
    exec docker compose up --build
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "[peas-start] Launching PeAS via docker-compose..."
    exec docker-compose up --build
  fi
fi

# 2. Fallback to native Windows stack via PowerShell
NATIVE_SCRIPT="$PROJECT_ROOT/start-native.ps1"
if [[ -f "$NATIVE_SCRIPT" ]]; then
  echo "[peas-start] Docker daemon not active. Falling back to native Windows PeAS stack..."
  if command -v powershell.exe >/dev/null 2>&1; then
    WIN_PATH="$(cygpath -w "$NATIVE_SCRIPT" 2>/dev/null || echo "$NATIVE_SCRIPT")"
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WIN_PATH"
  elif command -v pwsh >/dev/null 2>&1; then
    exec pwsh -NoProfile -ExecutionPolicy Bypass -File "$NATIVE_SCRIPT"
  fi
fi

echo "Docker engine is not running and PowerShell runtime was not found."
echo "Run: powershell -ExecutionPolicy Bypass -File ./start-native.ps1"
exit 1
