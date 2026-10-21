#!/bin/bash
# Double-click once: Pit Wall then runs in the background whenever this Mac is on,
# so you can just open the bookmark (or the iPad icon) without starting anything.
source "$(dirname "$0")/scripts/mac-common.sh"

case "$APP_DIR" in
  "$HOME/Downloads"* | "$HOME/Desktop"* | "$HOME/Documents"*)
    echo "macOS doesn't let background apps use the Downloads, Desktop or Documents folders."
    echo "Move this folder into your home folder first (in Finder: Go > Home), then double-click this file again."
    open "$HOME"
    pause_and_exit 1
    ;;
esac

ensure_node
ensure_installed
build_app
mkdir -p cache

LABEL="com.pitwall.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
launchctl unload "$PLIST" 2>/dev/null
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP_DIR/node_modules/tsx/dist/cli.mjs</string>
    <string>server/index.ts</string>
    <string>--production</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/cache/server.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/cache/server.log</string>
</dict>
</plist>
PLIST
launchctl load "$PLIST"

echo "Starting…"
for _ in $(seq 1 40); do is_running && break; sleep 0.5; done
if is_running; then
  echo
  echo "  Done. Pit Wall now starts by itself whenever you log in to this Mac."
  echo "  On this Mac:   http://localhost:$PORT   (bookmark it)"
  [ -n "$(ipad_address)" ] && echo "  On your iPad:  $(ipad_address)   (Share > Add to Home Screen)"
  echo
  echo "  You can close this window. To turn it off, double-click 'Stop starting automatically'."
  open "http://localhost:$PORT"
else
  echo "Pit Wall didn't start. The log is in cache/server.log; send it to Claude."
fi
pause_and_exit 0
