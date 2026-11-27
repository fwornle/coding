#!/bin/bash
# End-to-end check of `coding update` on a clean Linux, run INSIDE the
# install-test image (docker/Dockerfile.install-test) by
#   scripts/test-install-linux.sh --release <A.tgz> --update-to <B.tgz> update
#
# In the container:
#   1. release A is installed the way a release install is laid out:
#      ~/.coding/releases/<A>/ + current, then `current/install.sh --ci`
#   2. release B is published on a file:// "release server"
#   3. `coding update` runs (from A, through current) and must end on B with
#      the build and register phases done, .env carried, features.yaml intact
#   4. `coding update --rollback` must end on A again
# Prints UPDATE_E2E=pass|fail lines the host side asserts on.
#
# Usage (in the container): update-e2e.sh <A.tgz> <B.tgz>
set -uo pipefail

A_TGZ="$1"; B_TGZ="$2"
ok() { echo "UPDATE_E2E=pass $*"; }
bad() { echo "UPDATE_E2E=fail $*"; FAILED=1; }
FAILED=0
ver() { tar -xzf "$1" -O --wildcards '*/release.json' | node -p 'JSON.parse(require("fs").readFileSync(0)).version'; }
A="$(ver "$A_TGZ")"; B="$(ver "$B_TGZ")"
if [[ -z "$A" || -z "$B" ]]; then
    echo "UPDATE_E2E=fail could not read the release versions from $A_TGZ / $B_TGZ"
    echo "UPDATE_E2E_DONE failed=1"; exit 0
fi
echo "=== update e2e: $A -> $B ==="

REL="$HOME/.coding/releases"
mkdir -p "$REL" /tmp/unpack-a
tar -xzf "$A_TGZ" -C /tmp/unpack-a
node /tmp/unpack-a/coding-"$A"/scripts/releases.mjs adopt /tmp/unpack-a/coding-"$A" >/dev/null
node /tmp/unpack-a/coding-"$A"/scripts/releases.mjs use "$A" >/dev/null
CUR="$REL/current"

# 1. first install, through current (what install.sh will do in P6)
( cd "$CUR" && CODING_REPO="$CUR" bash ./install.sh --ci ) > /tmp/install-a.log 2>&1
grep -q "Node.js dependencies installed" /tmp/install-a.log && ok "release $A installed" || bad "release $A install (see /tmp/install-a.log)"
echo 'CODING_E2E_MARKER=kept' >> "$CUR/.env"
cp "$HOME/.coding/features.yaml" /tmp/features.before 2>/dev/null || true

# 2. the release server
SRV=/tmp/release-server; mkdir -p "$SRV/download/v$B"
cp "$B_TGZ" "$SRV/download/v$B/coding-$B.tar.gz"
(cd "$SRV/download/v$B" && sha256sum "coding-$B.tar.gz" > "coding-$B.tar.gz.sha256")
echo "v$B" > "$SRV/latest"
export CODING_RELEASE_URL="file://$SRV"

# 3. update
"$CUR/bin/coding" update --check > /tmp/check.log 2>&1
grep -q "coding $B is available (this is $A)" /tmp/check.log && ok "--check sees $B" || bad "--check: $(tail -2 /tmp/check.log)"
"$CUR/bin/coding" update > /tmp/update.log 2>&1; rc=$?
[[ $rc -eq 0 ]] && ok "coding update exit 0" || bad "coding update exit $rc: $(grep -iE 'coding update|error' /tmp/update.log | tail -3)"
[[ "$(readlink "$CUR")" == "$B" ]] && ok "current -> $B" || bad "current -> $(readlink "$CUR")"
grep -q "coding update: build phase" /tmp/update.log && ok "build phase ran" || bad "build phase did not run"
grep -q "coding update: register phase" /tmp/update.log && ok "register phase ran" || bad "register phase did not run"
[[ -d "$REL/$B/node_modules" ]] && ok "dependencies installed in $B" || bad "no node_modules in $B"
grep -q '^CODING_E2E_MARKER=kept' "$REL/$B/.env" && ok ".env carried" || bad ".env not carried"
grep -q "export CODING_REPO=\"$CUR\"" "$REL/$B/.activate" 2>/dev/null && ok ".activate names current" || bad ".activate: $(grep CODING_REPO "$REL/$B/.activate" 2>/dev/null)"
if [[ -f /tmp/features.before ]]; then
  cmp -s /tmp/features.before "$HOME/.coding/features.yaml" && ok "features.yaml unchanged" || bad "features.yaml changed"
fi
if grep -rqs "$REL/$A\|$REL/$B" "$REL/$B/.activate" "$REL/$B/.claude/settings.local.json" "$REL/$B/claude-code-mcp-processed.json"; then
  bad "a version folder path was stored: $(grep -rls "$REL/$A\|$REL/$B" "$REL/$B/.activate" "$REL/$B/.claude/settings.local.json" "$REL/$B/claude-code-mcp-processed.json" | tr '\n' ' ')"
else
  ok "no version folder path stored"
fi

# 4. rollback
"$CUR/bin/coding" update --rollback > /tmp/rollback.log 2>&1; rc=$?
[[ "$(readlink "$CUR")" == "$A" ]] && ok "rollback -> $A (exit $rc)" || bad "rollback: current -> $(readlink "$CUR"), exit $rc"

echo "UPDATE_E2E_DONE failed=$FAILED"
echo "--- update log tail ---"; tail -25 /tmp/update.log
exit 0
