#!/usr/bin/env bash
# Run this ON YOUR MAC after code changes, to send them to the EliteDesk:
#     ./deploy/push.sh andz@elitedesk
# Only code and curated lists are sent. Your library, posters and backups on the
# EliteDesk are never touched.
set -euo pipefail
HOST="${1:?usage: ./deploy/push.sh user@elitedesk-address}"
DEST="${2:-~/andztv}"
cd "$(dirname "$0")/.."
rsync -av --relative \
  ./server.js ./README.md ./public ./tools ./deploy ./data/curated \
  --exclude '__pycache__' \
  "$HOST:$DEST/"
ssh -t "$HOST" "sudo systemctl restart andztv && echo 'andztv restarted'"
