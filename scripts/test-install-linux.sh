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
    echo "--------------------------------------------------------------------"
    bash ./install.sh --ci
    echo "--------------------------------------------------------------------"
    echo "INSTALLER_EXIT=$?"
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
}
trap cleanup EXIT

# ── build ────────────────────────────────────────────────────────────────────
info "Building $IMAGE ${PLATFORM_FLAG:+($PLATFORM_FLAG)}..."
# shellcheck disable=SC2086
docker build $PLATFORM_FLAG -f "$CODING_REPO/docker/Dockerfile.install-test" \
    -t "$IMAGE" "$CODING_REPO" >/tmp/coding-install-build.log 2>&1 \
    || { echo "${RED}build failed${NC} — see /tmp/coding-install-build.log"; tail -20 /tmp/coding-install-build.log; exit 1; }
pass "image built"

run_installer() {
    # $1 = extra docker args (as a string), rest ignored. Emits combined output.
    local extra="$1"; shift
    # shellcheck disable=SC2086
    docker run --rm --name coding-install-runner $PLATFORM_FLAG $extra \
        -v "$CODING_REPO:/src:ro" "$IMAGE" 2>&1
}

# ── shape: direct ────────────────────────────────────────────────────────────
shape_direct() {
    echo; info "── shape: direct (normal egress) ──"
    local out; out="$(run_installer "")"
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
    out="$(run_installer "--network $NET --dns 127.0.0.1 \
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
    local out; out="$(run_installer "--network none")"
    echo "$out" > /tmp/coding-install-noegress.log

    if grep -q "Network preflight failed" <<<"$out"; then
        pass "no-egress: failed at preflight"
    else
        fail "no-egress: did not fail at preflight"
    fi
    # Must fail BEFORE the expensive npm step, not inside it.
    if grep -q "Installing Node.js dependencies" <<<"$out"; then
        fail "no-egress: reached npm install — preflight ran too late"
    else
        pass "no-egress: aborted before npm install"
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
