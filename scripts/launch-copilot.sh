#!/bin/bash

# Launch CoPilot with fallback services
# Thin wrapper — all shared logic lives in launch-agent-common.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"
export CODING_REPO

source "$SCRIPT_DIR/agent-common-setup.sh"
source "$SCRIPT_DIR/launch-agent-common.sh"
launch_agent "$CODING_REPO/config/agents/copilot.sh" "$@"
