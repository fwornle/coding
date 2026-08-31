#!/usr/bin/env bash
# Install the prompt-classifier service as a launchd agent.
#
# The service answers POST /classify {text} -> {band} on 127.0.0.1:12437 and is
# what rapid-llm-proxy's `classifier.impl: http` asks. KeepAlive, because a
# classifier that is down does not break routing — the proxy fails open and
# keeps the caller's band — but every minute it is down is a minute of cheap
# work paying for an expensive model, and nobody would notice.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.coding.prompt-classifier"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/scripts/prompt-classifier-service.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$REPO/.logs/prompt-classifier.log</string>
  <key>StandardErrorPath</key><string>$REPO/.logs/prompt-classifier.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST_EOF

mkdir -p "$REPO/.logs"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "installed $LABEL"
sleep 2
curl -s -m 5 http://127.0.0.1:12437/health || echo "(not answering yet — check $REPO/.logs/prompt-classifier.log)"
echo
