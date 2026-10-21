#!/bin/bash
# Double-click to start Pit Wall. Keep this window open while you use it; close it to stop.
source "$(dirname "$0")/scripts/mac-common.sh"

if is_running; then
  echo "Pit Wall is already running. Opening it…"
  open "http://localhost:$PORT"
  sleep 2
  exit 0
fi

ensure_node
ensure_installed
build_app

echo
echo "  Pit Wall is running."
echo "  On this Mac:   http://localhost:$PORT"
[ -n "$(ipad_address)" ] && echo "  On your iPad:  $(ipad_address)"
echo
echo "  Keep this window open while you use it. Close it to stop Pit Wall."
echo

( for _ in $(seq 1 30); do is_running && break; sleep 0.5; done; open "http://localhost:$PORT" ) &
exec "$NODE" node_modules/tsx/dist/cli.mjs server/index.ts --production
