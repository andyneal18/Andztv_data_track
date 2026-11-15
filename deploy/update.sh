#!/usr/bin/env bash
# Update andztv on this machine to the latest code on GitHub. One line, from anywhere:
#     curl -fsSL https://raw.githubusercontent.com/andyneal18/Andztv_data_track/main/deploy/update.sh | bash
# Finds the app folder by itself (or pass it: ... | bash -s /path/to/andztv).
# Only code and curated lists are updated. Your library, posters and backups are
# never touched, and library.json is backed up first anyway.
set -euo pipefail
REPO=https://github.com/andyneal18/Andztv_data_track.git
is_app() { [ -f "$1/server.js" ] && [ -f "$1/data/library.json" ]; }

# 1. Find the app: the folder given, else the one the service runs from, else a running
#    "node server.js", else search the disk.
DIR="${1:-}"
HOW=""
if [ -z "$DIR" ]; then
  DIR=$(systemctl show -p WorkingDirectory --value andztv 2>/dev/null || true)
  [ -n "$DIR" ] && HOW=systemd
fi
if [ -z "$DIR" ] || ! is_app "$DIR"; then
  for pid in $(pgrep -f "server\.js" 2>/dev/null || true); do
    d=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    if [ -n "$d" ] && is_app "$d"; then DIR="$d"; HOW=process; break; fi
  done
fi
if [ -z "$DIR" ] || ! is_app "$DIR"; then
  echo "Looking for the andztv folder (can take a minute)…"
  FOUND=$( { find "$HOME" -path "*/data/library.json" -not -path "*/backups/*" 2>/dev/null || true
             find / -xdev -path "*/data/library.json" -not -path "*/backups/*" -not -path "$HOME/*" 2>/dev/null || true; } |
           while read -r f; do d=$(dirname "$(dirname "$f")"); if is_app "$d"; then echo "$d"; fi; done | sort -u || true)
  COUNT=$(printf "%s" "$FOUND" | grep -c . || true)
  if [ "$COUNT" -eq 0 ]; then
    echo
    echo "Couldn't find andztv on this machine (no folder with server.js and data/library.json)."
    echo "What's running that might be it:"
    pgrep -af "node|server\.js" 2>/dev/null | grep -v pgrep || echo "  (no node processes)"
    command -v docker >/dev/null && docker ps --format '  docker: {{.Names}}  {{.Image}}  {{.Ports}}' 2>/dev/null || true
    systemctl list-units --type=service --no-pager 2>/dev/null | grep -i -E "andz|node|tv" || true
    exit 1
  fi
  if [ "$COUNT" -gt 1 ]; then
    echo "Found more than one andztv folder:"; echo "$FOUND"
    echo "Run again with the right one at the end:  curl -fsSL …/update.sh | bash -s /path/to/folder"; exit 1
  fi
  DIR="$FOUND"
fi
echo "Updating andztv in: $DIR"

# 2. Back up the library.
STAMP=$(date +%Y-%m-%d-%H%M)
cp "$DIR/data/library.json" "$DIR/data/library-before-update-$STAMP.json"
echo "Backed up your library to data/library-before-update-$STAMP.json"

# 3. Fetch the code only (no posters or library), then copy it in.
command -v git >/dev/null || { echo "Installing git…"; sudo apt-get install -y git; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --filter=blob:none --sparse "$REPO" "$TMP/src"
git -C "$TMP/src" sparse-checkout set public tools deploy data/curated
S="$TMP/src"
cp -r "$S/server.js" "$S/README.md" "$S/public" "$S/tools" "$S/deploy" "$DIR/"
mkdir -p "$DIR/data" && cp -r "$S/data/curated" "$DIR/data/"
echo "Code updated to: $(git -C "$S" log -1 --format='%h %s')"

# 4. Restart.
if [ "$HOW" = systemd ] || systemctl cat andztv >/dev/null 2>&1; then
  sudo systemctl restart andztv && echo "andztv restarted. Open the app and refresh the page."
else
  echo
  echo "Code is updated, but andztv isn't set up as a service here, so restart it yourself:"
  echo "  stop the old one (Ctrl+C in its window, or: pkill -f \"$DIR/server.js\"), then run"
  echo "  cd \"$DIR\" && node server.js"
  echo "Or make it a proper service that restarts by itself:  cd \"$DIR\" && ./deploy/install.sh"
fi
