#!/bin/zsh
# Double-click to start the andztv library and open it in your browser.
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
(sleep 1 && open "http://localhost:4545") &
node server.js
