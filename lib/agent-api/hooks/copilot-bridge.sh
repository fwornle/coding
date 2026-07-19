#!/bin/bash

# Copilot Bridge - Bridge script for GitHub Copilot CLI native hooks
#
# This script is called by Copilot CLI's native hook system (.github/hooks/hooks.json)
# and translates the event to the unified hook format.
#
# Usage in .github/hooks/hooks.json:
# {
#   "preToolUse": {
#     "command": "/path/to/coding/lib/agent-api/hooks/copilot-bridge.sh",
#     "args": ["preToolUse"]
#   }
# }
#
# The bridge:
# 1. Reads hook context from stdin (JSON)
# 2. Translates Copilot-native event to unified format
# 3. Calls the Node.js hook manager
# 4. Returns response in Copilot-expected format (JSON to stdout)

set -e

# Get the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="${CODING_REPO:-$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")}"

# Get the native event from argument or environment
NATIVE_EVENT="${1:-${HOOK_EVENT:-preToolUse}}"

# Map Copilot events to unified events
case "$NATIVE_EVENT" in
  "sessionStart")    UNIFIED_EVENT="startup" ;;
  "sessionEnd")      UNIFIED_EVENT="shutdown" ;;
  "preToolUse")      UNIFIED_EVENT="pre-tool" ;;
  "postToolUse")     UNIFIED_EVENT="post-tool" ;;
  "userPromptSubmitted") UNIFIED_EVENT="pre-prompt" ;;
  "errorOccurred")   UNIFIED_EVENT="error" ;;
  *)                 UNIFIED_EVENT="$NATIVE_EVENT" ;;
esac

# Read context from stdin
CONTEXT=$(cat)

# Create unified context
UNIFIED_CONTEXT=$(cat <<EOF
{
  "event": "$UNIFIED_EVENT",
  "agentEvent": "$NATIVE_EVENT",
  "agentType": "copilot",
  "sessionId": "${COPILOT_SESSION_ID:-copilot-$$}",
  "timestamp": $(date +%s000),
  "nativeContext": $CONTEXT
}
EOF
)

# Call the Node.js hook manager
RESULT=$(echo "$UNIFIED_CONTEXT" | node "$SCRIPT_DIR/copilot-bridge-handler.js" 2>/dev/null || echo '{"allow":true}')

# Transform result to Copilot format
# Copilot expects: { "continue": true/false, "message": "..." }
ALLOW=$(echo "$RESULT" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).allow !== false' 2>/dev/null || echo "true")
MESSAGE=$(echo "$RESULT" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).messages?.join("\\n") || ""' 2>/dev/null || echo "")

if [ "$ALLOW" != "true" ]; then
  echo "{\"continue\":false,\"message\":\"$MESSAGE\"}"
  exit 0
fi

# Per-prompt knowledge injection (parity with Claude's UserPromptSubmit hook).
# Copilot rewrites the model-facing prompt from this hook's `modifiedPrompt` field,
# so for userPromptSubmitted we retrieve the ~1000-token KB block and emit it. The
# helper reads the raw Copilot payload ({prompt,...}) and prints single-line JSON —
# {"modifiedPrompt":"<KB>\n\n<prompt>"} to inject, or {} to leave it unchanged.
# NOTE: dormant no-op on Copilot CLI v1.0.71 — filesystem hooks fire but their output
# is not processed for injection (verified). Activates on a build that honors
# modifiedPrompt from a filesystem hook. See knowledge-injection-copilot-prompt.js.
if [ "$NATIVE_EVENT" = "userPromptSubmitted" ]; then
  KB=$(echo "$CONTEXT" | node "$CODING_REPO/src/hooks/knowledge-injection-copilot-prompt.js" 2>/dev/null || echo '{}')
  [ -n "$KB" ] && echo "$KB" || echo '{"continue":true}'
  exit 0
fi

if [ -n "$MESSAGE" ]; then
  echo "{\"continue\":true,\"message\":\"$MESSAGE\"}"
else
  echo '{"continue":true}'
fi

exit 0
