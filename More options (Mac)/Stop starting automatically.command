#!/bin/bash
# Double-click to stop Pit Wall running in the background and starting at login.
PLIST="$HOME/Library/LaunchAgents/com.pitwall.server.plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "Pit Wall has stopped and won't start at login any more."
  echo "Use 'Start Pit Wall' whenever you want it."
else
  echo "Pit Wall wasn't set to start automatically, so there's nothing to turn off."
fi
echo
read -r -n 1 -p "Press any key to close this window."
