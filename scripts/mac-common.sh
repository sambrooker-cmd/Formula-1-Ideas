#!/bin/bash
# Shared by the double-click .command files: find Node, install dependencies, build the app.

cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd)"
PORT=8787
# Finder-launched scripts get a minimal PATH; add the usual Node install locations.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.volta/bin:$PATH"

pause_and_exit() {
  echo
  read -r -n 1 -p "Press any key to close this window."
  exit "${1:-1}"
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js isn't installed yet."
    echo "Opening nodejs.org: download the LTS version, install it, then double-click this file again."
    open "https://nodejs.org/"
    pause_and_exit 1
  fi
  NODE="$(command -v node)"
  local major minor
  IFS=. read -r major minor _ <<<"$(node -v | tr -d v)"
  if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 13 ]; }; then
    echo "Your Node.js is $(node -v); Pit Wall needs 22.13 or newer."
    echo "Opening nodejs.org: install the LTS version, then double-click this file again."
    open "https://nodejs.org/"
    pause_and_exit 1
  fi
}

ensure_installed() {
  if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
    echo "Installing (first run only, about a minute)…"
    npm install --no-fund --no-audit --loglevel=error || { echo "Install failed: see the message above."; pause_and_exit 1; }
    touch node_modules
  fi
}

build_app() {
  echo "Preparing the app…"
  npx vite build --logLevel error >/dev/null || { echo "Build failed: see the message above."; pause_and_exit 1; }
}

is_running() {
  curl -s -o /dev/null "http://localhost:$PORT/api/sessions"
}

ipad_address() {
  local name
  name="$(scutil --get LocalHostName 2>/dev/null)"
  [ -n "$name" ] && echo "http://$name.local:$PORT/companion"
}
