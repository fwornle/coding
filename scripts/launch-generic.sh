#!/bin/bash

# Generic agent launcher — used when no agent-specific launch-<name>.sh exists.
# Delegates entirely to launch-agent-common.sh with the agent config file.
#
# Called by bin/coding as: launch-generic.sh <agent-config-path> [args...]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"
export CODING_REPO

AGENT_CONFIG="$1"
shift

source "$SCRIPT_DIR/agent-common-setup.sh"
source "$SCRIPT_DIR/launch-agent-common.sh"
launch_agent "$AGENT_CONFIG" "$@"
