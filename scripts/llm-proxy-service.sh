#!/usr/bin/env bash
#
# llm-proxy-service.sh — what the login service (launchd or systemd) runs to start the
# LLM proxy. It resolves the three per-machine facts the service definition must NOT
# carry, then hands over to the proxy's own launcher, bin/start-llm-proxy.sh.
#
#   proxy checkout   RAPID_LLM_PROXY_DIR, else the sibling <parent-of-repo>/_work/rapid-llm-proxy
#                    (the same convention lib/lsl/token/task-id.mjs and the measurement
#                    scripts already assume)
#   data directory   LLM_PROXY_DATA_DIR, else `bin/coding-data-home --var` — the installer's
#                    scope, resolved at START time
#   repo root        this script's own location (CODING_REPO wins when set)
#
# WHY A SCRIPT AND NOT A FULLY-RENDERED PLIST
# The hand-made plist this replaces wrote all three as literal paths. That works until
# any of them moves: a scope change, a data-home migration, or a second machine, and
# then the job keeps starting against the old location. KeepAlive restarts it, so
# `launchctl list` shows it healthy while it writes token rows into a directory
# nothing reads. Resolving here means the service definition holds only the repo path,
# which is what scripts/lib/launchd-plist.sh can template and the portability test can
# check.
#
# LOGS: launchd's StandardOut/ErrorPath can only name a fixed file, and the data home is
# not fixed. So the service definition points at <repo>/.logs/llm-proxy-service.log,
# which receives only what this script says before the redirect below, i.e. why
# it could not start. Everything after that goes to <data>/llm-proxy/logs/{stdout,stderr}.log,
# where the proxy's logs have lived since the data-home move.

set -u

# The service manager starts this with a minimal PATH. Extend it the same way
# start-llm-proxy.sh does, so the node behind bin/coding-data-home resolves too.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
# A pinned NODE_BIN (an nvm/fnm node is never on a service PATH) goes first.
if [[ -n "${NODE_BIN:-}" ]]; then
    PATH="$(dirname "$NODE_BIN"):$PATH"
fi

say() { printf '[llm-proxy-service] %s\n' "$*" >&2; }

REPO_ROOT="${CODING_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PROXY_DIR="${RAPID_LLM_PROXY_DIR:-$(cd "$REPO_ROOT/.." && pwd)/_work/rapid-llm-proxy}"
LAUNCHER="$PROXY_DIR/bin/start-llm-proxy.sh"

if [[ ! -f "$LAUNCHER" ]]; then
    say "FATAL: no proxy checkout at $PROXY_DIR (missing bin/start-llm-proxy.sh)."
    say "  Clone it there, or set RAPID_LLM_PROXY_DIR in the service definition."
    exit 1
fi

# The bridge imports compiled ../dist/*.js, and dist/ is gitignored, so a checkout
# that was never built fails inside node with an import error that does not mention
# the build. Say so here instead.
if [[ ! -d "$PROXY_DIR/dist" ]]; then
    say "FATAL: $PROXY_DIR has no dist/ — run: (cd $PROXY_DIR && npm ci && npm run build)"
    exit 1
fi

if [[ -z "${LLM_PROXY_DATA_DIR:-}" ]]; then
    if ! LLM_PROXY_DATA_DIR="$("$REPO_ROOT/bin/coding-data-home" --ensure --var 2>&1)"; then
        say "FATAL: could not resolve the data home: $LLM_PROXY_DATA_DIR"
        exit 1
    fi
fi

mkdir -p "$LLM_PROXY_DATA_DIR/llm-proxy/logs" || {
    say "FATAL: cannot create $LLM_PROXY_DATA_DIR/llm-proxy/logs"
    exit 1
}

export CODING_REPO="$REPO_ROOT"
export LLM_PROXY_DATA_DIR
export LLM_PROXY_PORT="${LLM_PROXY_PORT:-${LLM_CLI_PROXY_PORT:-12435}}"

say "proxy=$PROXY_DIR data=$LLM_PROXY_DATA_DIR port=$LLM_PROXY_PORT — logging to $LLM_PROXY_DATA_DIR/llm-proxy/logs/"

exec >>"$LLM_PROXY_DATA_DIR/llm-proxy/logs/stdout.log" 2>>"$LLM_PROXY_DATA_DIR/llm-proxy/logs/stderr.log"
cd "$PROXY_DIR" || exit 1
exec /bin/bash "$LAUNCHER"
