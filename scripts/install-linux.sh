#!/usr/bin/env bash
# ============================================================
#  tg-media-bot — one-shot install for a Linux host
#  Installs: bun, yt-dlp, ffmpeg (if missing), then prepares
#  the bot directory. Run as the user that will run the bot:
#      bash scripts/install-linux.sh
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/tg-media-bot}"

say() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

# --- 1) dependencies -----------------------------------------
say "dependencies"
need=()
command -v bun    >/dev/null 2>&1 || need+=("bun")
command -v yt-dlp >/dev/null 2>&1 || need+=("yt-dlp")
command -v ffmpeg >/dev/null 2>&1 || need+=("ffmpeg")

if [ "${#need[@]}" -gt 0 ]; then
  echo "missing: ${need[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    SUDO=""
    [ "$(id -u)" -ne 0 ] && SUDO="sudo"
    $SUDO apt-get update -y
    [ " ${need[*]} " = *" ffmpeg "* ] && $SUDO apt-get install -y --no-install-recommends ffmpeg
    echo "bun & yt-dlp will be installed user-local below."
  else
    echo "apt not found — install bun/yt-dlp/ffmpeg manually (see README)" >&2
  fi
fi

# bun (user-local)
if ! command -v bun >/dev/null 2>&1; then
  say "installing bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# yt-dlp (user-local standalone)
if ! command -v yt-dlp >/dev/null 2>&1; then
  say "installing yt-dlp"
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o "$HOME/.local/bin/yt-dlp" 2>/dev/null || {
    mkdir -p "$HOME/.local/bin"
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o "$HOME/.local/bin/yt-dlp"
  }
  chmod +x "$HOME/.local/bin/yt-dlp"
  export PATH="$HOME/.local/bin:$PATH"
fi

echo "bun:    $(bun --version)"
echo "yt-dlp: $(yt-dlp --version)"
echo "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1)"

# --- 2) app dir ----------------------------------------------
say "app directory"
if [ ! -d "$APP_DIR/bot" ]; then
  echo "expected repo at $APP_DIR (with a bot/ subdirectory)" >&2
  exit 1
fi
if [ ! -f "$APP_DIR/bot/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/bot/.env"
  chmod 600 "$APP_DIR/bot/.env"
  echo "created $APP_DIR/bot/.env — EDIT IT AND SET YOUR TOKEN"
fi
cd "$APP_DIR/bot"
bun install

# --- 3) verify ------------------------------------------------
say "smoke test (bot boots without a token? expect 'Empty token!')"
timeout 10 bun bot.ts 2>&1 | head -4 || true

say "done"
cat <<'EOF'
Next steps:
  1) edit  $APP_DIR/bot/.env   (TOKEN=...)
  2) run   cd $APP_DIR/bot && bun bot.ts
  3) keep  (pick one)
     - systemd:  see deploy/tg-media-bot.service
     - docker:   see deploy/docker-compose.yml (2GB uploads)
EOF
