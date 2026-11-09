#!/usr/bin/env bash
# ============================================================
#  tg-media-bot — one-shot install for a Linux host (Docker)
#  Installs Docker (if missing) and starts the bot + the local
#  Bot API server (2GB uploads) via docker compose.
#      bash scripts/install-linux.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

# --- 1) docker ------------------------------------------------
say "docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "installing docker engine + compose plugin..."
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker.io docker-compose-v2
  $SUDO systemctl enable --now docker
  # let the current user talk to docker without sudo
  [ "$(id -u)" -ne 0 ] && $SUDO usermod -aG docker "$USER"
  echo "NOTE: 'newgrp docker' or log in again for group membership."
fi
echo "docker: $(docker --version)"

# --- 2) .env --------------------------------------------------
say "configuration"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "created $ROOT/.env — EDIT IT:"
  echo "   TOKEN             <- from @BotFather   (required)"
  echo "   TELEGRAM_API_ID   <- from my.telegram.org (for 2GB uploads)"
  echo "   TELEGRAM_API_HASH <- from my.telegram.org"
  echo
  echo "Stopping here: edit .env, then re-run this script."
  exit 0
fi
grep -q '^TOKEN=.' .env || { echo "TOKEN is empty in .env — fill it first." >&2; exit 1; }

# --- 3) run ---------------------------------------------------
say "docker compose up"
docker compose up -d --build
docker compose ps

say "done"
cat <<'EOF'
  logs:     docker compose logs -f
  status:   docker compose ps
  update:   git pull && docker compose up -d --build
EOF
