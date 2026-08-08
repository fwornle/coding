#!/bin/bash
# Linux end-to-end verification for ./install.sh, runnable from macOS.
#
# Drives the installer through three network shapes on a clean Ubuntu container:
#
#   direct     — normal egress. The installer must complete and must NOT pin a proxy.
#   proxy-only — direct egress blocked, a squid proxy reachable via https_proxy.
#                This is the laptop-reproducible analogue of the corporate box
#                that failed, and the case CI could not catch.
#   no-egress  — no network at all. The installer must fail AT PREFLIGHT with
#                actionable guidance, not minutes later inside a native
#                postinstall.
#
# Usage:
#   scripts/test-install-linux.sh                  # all shapes
#   scripts/test-install-linux.sh direct           # one shape
#   scripts/test-install-linux.sh --arm64          # exercise the missing
#                                                  # tokenizers-linux-arm64-gnu path
#
# Exit 0 only if every selected shape behaves as specified.

set -uo pipefail

CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="coding-install-test"
NET="coding-install-test-net"
PLATFORM_FLAG=""
SHAPES=()

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'

PASSED=0; FAILED=0
pass() { echo "${GREEN}✅ PASS${NC} $*"; PASSED=$((PASSED+1)); }
fail() { echo "${RED}❌ FAIL${NC} $*"; FAILED=$((FAILED+1)); }
info() { echo "${CYAN}ℹ️  $*${NC}"; }

# ── in-container mode: just run the installer and report ─────────────────────
# Invoked by Dockerfile.install-test's CMD. Deliberately dumb: all assertions
# are made by the host side against the captured output and exit code.
if [[ "${1:-}" == "--in-container" ]]; then
    echo "=== container: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") $(uname -m) ==="
    echo "=== node $(node --version 2>/dev/null) npm $(npm --version 2>/dev/null) ==="
    echo "=== deliberately absent: $(for t in plantuml tmux jq; do command -v $t >/dev/null 2>&1 || printf '%s ' "$t"; done) ==="
    echo "=== proxy env: https_proxy=${https_proxy:-unset} ==="
    echo "=== installer args: ${INSTALL_ARGS:-<none>} ==="
    echo "--------------------------------------------------------------------"
    # INSTALL_ARGS is set per shape by the host side. It matters which flags are
    # used: --ci deliberately downgrades the network preflight to a warning, so
    # the fail-fast behaviour can only be observed WITHOUT it. stdin is not a
    # tty here, so install.sh forces NON_INTERACTIVE on its own and no prompt
    # can block even with no flags at all.
    # shellcheck disable=SC2086
    bash ./install.sh ${INSTALL_ARGS:-}
    rc=$?
    echo "--------------------------------------------------------------------"
    echo "INSTALLER_EXIT=$rc"
    exit 0
fi

# ── argument parsing ─────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --arm64)  PLATFORM_FLAG="--platform=linux/arm64" ;;
        --amd64)  PLATFORM_FLAG="--platform=linux/amd64" ;;
        direct|proxy-only|no-egress) SHAPES+=("$arg") ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        *) echo "unknown argument: $arg"; exit 2 ;;
    esac
done
[[ ${#SHAPES[@]} -eq 0 ]] && SHAPES=(direct proxy-only no-egress)

command -v docker >/dev/null 2>&1 || { echo "docker is required"; exit 2; }
docker info >/dev/null 2>&1 || { echo "docker daemon is not running"; exit 2; }

cleanup() {
    docker rm -f coding-install-runner squid-proxy >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    cleanup_ctx
}
trap cleanup EXIT

# ── prepare a pruned build context ───────────────────────────────────────────
# Tracked files only, minus the heavy paths the installer never touches
# (docs/ + docs-content/ are ~139MB of images, .data/ ~62MB of exports). That
# takes 275MB -> 44MB, and running it on the native filesystem takes ~9s versus
# minutes for the container reading the same tree over a macOS bind mount.
#
# --no-recursion is REQUIRED, not an optimisation: `git ls-files` emits submodule
# gitlinks as bare paths, and without it tar recurses into them and pulls in
# ~10.5G of submodule node_modules.
CTX="$(mktemp -d)"
prepare_context() {
    info "Preparing build context (tracked files, minus docs/.data/.planning/tests)..."
    ( cd "$CODING_REPO" && git ls-files -z -- . \
        ':!:docs/**' ':!:docs-content/**' ':!:.data/**' ':!:.planning/**' ':!:tests/**' \
      | tar --null -T - --no-recursion -cf - 2>/dev/null ) | tar -C "$CTX" -xf -
    cp "$CODING_REPO/docker/Dockerfile.install-test" "$CTX/Dockerfile.install-test"
    info "  context: $(du -sh "$CTX" | cut -f1), $(find "$CTX" -type f | wc -l | tr -d ' ') files"
}
cleanup_ctx() { [[ -n "${CTX:-}" && -d "$CTX" ]] && rm -rf "$CTX"; }

prepare_context

# ── build ────────────────────────────────────────────────────────────────────
info "Building $IMAGE ${PLATFORM_FLAG:+($PLATFORM_FLAG)}..."
# shellcheck disable=SC2086
docker build $PLATFORM_FLAG -f "$CTX/Dockerfile.install-test" \
    -t "$IMAGE" "$CTX" >/tmp/coding-install-build.log 2>&1 \
    || { echo "${RED}build failed${NC} — see /tmp/coding-install-build.log"; tail -20 /tmp/coding-install-build.log; exit 1; }
pass "image built"

# Runs the installer in a NAMED, DETACHED container and returns its full log.
#
# Detached on purpose: an earlier version used `docker run --rm` from a
# backgrounded subshell, and when the calling shell went away the container was
# orphaned with its stdout going nowhere — producing an empty log while the
# container was still running. Polling a named container and reading `docker
# logs` is immune to that.
run_installer() {
    local extra="$1"; shift
    local name="coding-install-runner"
    docker rm -f "$name" >/dev/null 2>&1 || true
    # Docker Desktop injects the HOST's proxy settings into every container by
    # default (Settings > Resources > Proxies), so containers arrive with
    # https_proxy=http://host.docker.internal:3128 already set — even under
    # --network none. That silently contaminated every shape: "no-egress" was not
    # proxy-free and "direct" was pointed at an unreachable proxy. Blank them
    # explicitly; each shape then sets only what it means to test.
    local clear_proxy="-e https_proxy= -e http_proxy= -e HTTPS_PROXY= -e HTTP_PROXY= -e no_proxy= -e NO_PROXY="
    # shellcheck disable=SC2086
    docker run -d --name "$name" $PLATFORM_FLAG $clear_proxy $extra "$IMAGE" >/dev/null 2>&1
    local waited=0
    while [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == "true" ]]; do
        sleep 3; waited=$((waited+3))
        if [[ $waited -gt 900 ]]; then
            docker kill "$name" >/dev/null 2>&1 || true
            echo "HARNESS_TIMEOUT after ${waited}s"
            break
        fi
    done
    docker logs "$name" 2>&1
    echo "CONTAINER_EXIT=$(docker inspect -f '{{.State.ExitCode}}' "$name" 2>/dev/null)"
    docker rm -f "$name" >/dev/null 2>&1 || true
}

# ── shape: direct ────────────────────────────────────────────────────────────
shape_direct() {
    echo; info "── shape: direct (normal egress) ──"
    local out; out="$(run_installer "-e INSTALL_ARGS=--ci")"
    echo "$out" > /tmp/coding-install-direct.log

    if grep -q "reachable directly — no proxy needed" <<<"$out"; then
        pass "direct: detected direct access, pinned no proxy"
    else
        fail "direct: did not report direct access"
    fi
    # The whole point of P1: missing plantuml/tmux/jq must not stop the install.
    if grep -q "Missing required dependencies" <<<"$out"; then
        fail "direct: dependency gate still aborts on optional tools"
    else
        pass "direct: optional tools (plantuml/tmux/jq) did not block the install"
    fi
    if grep -qE "Optional tools not found:.*(plantuml|tmux)" <<<"$out"; then
        pass "direct: optional tools reported, not fatal"
    else
        fail "direct: optional tools were not reported at all"
    fi
    # The original crash signature must be gone.
    if grep -q "ENOTFOUND github.com" <<<"$out"; then
        fail "direct: ENOTFOUND still present"
    else
        pass "direct: no ENOTFOUND"
    fi
    # And no host browser download.
    if grep -qi "Installing Playwright browsers" <<<"$out"; then
        fail "direct: still downloads a browser onto the host"
    else
        pass "direct: no chromium download"
    fi
}

# ── shape: proxy-only ────────────────────────────────────────────────────────
# The corporate case. --dns 127.0.0.1 makes public-name resolution fail exactly
# as it did on the Ubuntu box, so the ONLY route out is the proxy.
shape_proxy_only() {
    echo; info "── shape: proxy-only (direct blocked, squid reachable) ──"
    docker network create "$NET" >/dev/null 2>&1 || true
    docker rm -f squid-proxy >/dev/null 2>&1 || true
    if ! docker run -d --name squid-proxy --network "$NET" ubuntu/squid:latest >/dev/null 2>&1; then
        echo "${YELLOW}⚠️  SKIP proxy-only: could not start ubuntu/squid (image pull failed?)${NC}"
        return 0
    fi
    info "waiting for squid..."
    sleep 8

    local out
    out="$(run_installer "--network $NET --dns 127.0.0.1 -e INSTALL_ARGS=--ci \
        -e https_proxy=http://squid-proxy:3128 -e http_proxy=http://squid-proxy:3128")"
    echo "$out" > /tmp/coding-install-proxy.log

    if grep -qE "Your existing proxy works|Using proxy" <<<"$out"; then
        pass "proxy-only: installer used the proxy"
    else
        fail "proxy-only: installer did not report using a proxy"
    fi
    if grep -q "ENOTFOUND github.com" <<<"$out"; then
        fail "proxy-only: ENOTFOUND — the original bug is NOT fixed"
    else
        pass "proxy-only: no ENOTFOUND (the reported failure does not reproduce)"
    fi
    if grep -q "Network preflight failed" <<<"$out"; then
        fail "proxy-only: preflight failed despite a working proxy"
    else
        pass "proxy-only: preflight passed via proxy"
    fi
}

# ── shape: no-egress ─────────────────────────────────────────────────────────
shape_no_egress() {
    echo; info "── shape: no-egress (must fail fast, with guidance) ──"
    # No --ci here on purpose: --ci downgrades preflight to a warning, so
    # fail-fast is only observable in a real (non-CI-lite) install.
    local out; out="$(run_installer "--network none -e INSTALL_ARGS=")"
    echo "$out" > /tmp/coding-install-noegress.log

    if grep -q "Network preflight failed" <<<"$out"; then
        pass "no-egress: failed at preflight"
    else
        fail "no-egress: did not fail at preflight"
    fi
    # Must abort BEFORE the expensive npm step, not inside it.
    if grep -q "Installing Node.js dependencies" <<<"$out"; then
        fail "no-egress: reached npm install — preflight ran too late"
    else
        pass "no-egress: aborted before npm install"
    fi
    if grep -q "INSTALLER_EXIT=1" <<<"$out"; then
        pass "no-egress: exited non-zero"
    else
        fail "no-egress: did not exit 1 ($(grep -o 'INSTALLER_EXIT=[0-9]*' <<<"$out"))"
    fi
    if grep -q "export https_proxy=" <<<"$out"; then
        pass "no-egress: printed actionable remediation"
    else
        fail "no-egress: no actionable guidance in the error"
    fi
}

for shape in "${SHAPES[@]}"; do
    case "$shape" in
        direct)     shape_direct ;;
        proxy-only) shape_proxy_only ;;
        no-egress)  shape_no_egress ;;
    esac
done

echo
echo "════════════════════════════════════════════"
echo "  passed: $PASSED   failed: $FAILED"
echo "  logs: /tmp/coding-install-{direct,proxy,noegress}.log"
echo "════════════════════════════════════════════"
[[ $FAILED -eq 0 ]]
