#!/usr/bin/env bash
# tests/integration/okb-guard-snapshot-bypass.sh
#
# Phase 44 Wave 0 — RED test stub.
#
# Asserts the OKB-baseline guard's OKB_SNAPSHOT=1 bypass contract (Phase 44
# S-3). Plan 44-04 inserts the 4-line guard between `set -euo pipefail` and
# the `KB_PATTERN=` line in scripts/hooks/pre-commit-okb-guard.sh:
#
#   if [ "${OKB_SNAPSHOT:-0}" = "1" ]; then
#       exit 0
#   fi
#
# Test cases:
#   Case A: OKB_SNAPSHOT=0 + stage .data/exports/foo.json  → expect exit 1
#           (hook complains and rejects the commit — current behavior)
#   Case B: OKB_SNAPSHOT=1 + stage .data/exports/foo.json  → expect exit 0
#           (bypass passes through — RED today; GREEN after Plan 44-04)
#
# EXPECTED FAILURE MODE (RED today):
#   * Case A passes (hook already rejects without OKB_SNAPSHOT).
#   * Case B fails (no bypass exists yet — hook still rejects).
#   * Final summary line prints "FAIL: Case B …" and the script exits 1.
#
# GOES GREEN after: Plan 44-04 inserts the bypass at line ~14 of
#   scripts/hooks/pre-commit-okb-guard.sh.
#
# Runner:  bash tests/integration/okb-guard-snapshot-bypass.sh
#   (no test framework — pure bash; matches the script-based shell test
#   pattern called out in 44-VALIDATION.md row 8.)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK="$REPO_ROOT/scripts/hooks/pre-commit-okb-guard.sh"

if [ ! -f "$HOOK" ]; then
    echo "FAIL: hook script not found at $HOOK" >&2
    exit 1
fi

# Isolated tmpdir — T-44-02-01 mitigation (trap-on-exit cleanup).
TMP="$(mktemp -d "${TMPDIR:-/tmp}/okb-guard-bypass.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"

# Minimal git repo for the staging plumbing the hook walks.
git init -q
git config user.email "test@example.invalid"
git config user.name "okb-guard-bypass-test"

# Stage a file matching the KB_PATTERN regex
#   '\.data/(knowledge-export|exports)/.*\.json$'
# Picking the .data/exports/ branch (per S-1 whole-dir-snapshot scope).
mkdir -p .data/exports
echo '{"placeholder": "kb-row"}' > .data/exports/foo.json
git add -A

PASS=0
FAIL=0

# ── Case A: OKB_SNAPSHOT=0 (or unset) — hook must reject (exit != 0).
echo "── Case A: OKB_SNAPSHOT=0 expecting hook exit != 0"
set +e
OKB_SNAPSHOT=0 bash "$HOOK" > /dev/null 2>&1
A_EXIT=$?
set -e
if [ "$A_EXIT" -ne 0 ]; then
    echo "  PASS: hook rejected (exit=$A_EXIT)"
    PASS=$((PASS+1))
else
    echo "  FAIL: hook should have rejected with OKB_SNAPSHOT=0 (got exit=0)" >&2
    FAIL=$((FAIL+1))
fi

# ── Case B: OKB_SNAPSHOT=1 — hook must bypass (exit 0). RED today.
echo "── Case B: OKB_SNAPSHOT=1 expecting hook exit 0"
set +e
OKB_SNAPSHOT=1 bash "$HOOK" > /dev/null 2>&1
B_EXIT=$?
set -e
if [ "$B_EXIT" -eq 0 ]; then
    echo "  PASS: hook bypassed (exit=0)"
    PASS=$((PASS+1))
else
    echo "  FAIL: hook should have bypassed with OKB_SNAPSHOT=1 (got exit=$B_EXIT) — Plan 44-04 not yet applied" >&2
    FAIL=$((FAIL+1))
fi

echo ""
echo "── Summary: PASS=$PASS, FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    echo "RED (expected pre-Plan-44-04): see failures above." >&2
    exit 1
fi
echo "GREEN: OKB_SNAPSHOT bypass contract holds."
exit 0
