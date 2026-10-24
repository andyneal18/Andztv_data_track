#!/usr/bin/env bash
# Run this ON THE ELITEDESK, from inside the andztv folder:
#     ./deploy/install.sh
# Installs Node if needed and sets andztv up as a background service that starts
# on boot and restarts itself if it ever crashes.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
PORT="${PORT:-4545}"

need_node() {
  ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]
}
if need_node; then
  echo "Installing Node.js 20 (needs your password)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v python3 >/dev/null || sudo apt-get install -y python3

echo
read -r -s -p "Set a password for the site? (Enter to skip): " PASS; echo

SERVICE=/etc/systemd/system/andztv.service
sudo tee "$SERVICE" >/dev/null <<EOF
[Unit]
Description=andztv library
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Environment=PORT=$PORT
Environment=ANDZTV_PASSWORD=$PASS
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo chmod 600 "$SERVICE"   # it may hold your password
sudo systemctl daemon-reload
sudo systemctl enable --now andztv
sleep 1
sudo systemctl --no-pager --lines=3 status andztv || true

echo
echo "andztv is running and will start on every boot."
echo "  On your home network:  http://$(hostname -I | awk '{print $1}'):$PORT"
if command -v tailscale >/dev/null 2>&1; then
  echo "  Anywhere (Tailscale):  http://$(tailscale ip -4 2>/dev/null | head -1):$PORT"
else
  echo "  For access away from home, install Tailscale — see README (\"Run it 24/7\")."
fi
echo
echo "Useful: sudo systemctl restart andztv   |   journalctl -u andztv -f   (logs)"
