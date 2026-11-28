#!/bin/bash
# Fresh-machine install from a release, run INSIDE the install-test image by
#   scripts/test-install-linux.sh --release <A.tgz> bootstrap
# (BOOTSTRAP_TIER picks the tier; default harness).
#
# A clean Ubuntu user with nothing but node/curl/git: the release is published on
# a file:// server, `coding-install.sh` (scripts/release/bootstrap.sh) installs it,
# and the result must be a release install whose every stored path names
# ~/.coding/releases/current. Prints BOOTSTRAP_E2E=pass|fail lines.
#
# Usage (in the container): bootstrap-e2e.sh <A.tgz>
set -uo pipefail
TGZ="$1"; TIER="${BOOTSTRAP_TIER:-harness}"
ok() { echo "BOOTSTRAP_E2E=pass [$TIER] $*"; }
bad() { echo "BOOTSTRAP_E2E=fail [$TIER] $*"; }
V="$(tar -xzf "$TGZ" -O --wildcards '*/release.json' | node -p 'JSON.parse(require("fs").readFileSync(0)).version')"
if [[ -z "$V" ]]; then bad "could not read the release version"; echo "BOOTSTRAP_E2E_DONE"; exit 0; fi
echo "=== bootstrap e2e: coding $V, tier $TIER ==="

SRV=/tmp/release-server; mkdir -p "$SRV/download/v$V"
cp "$TGZ" "$SRV/download/v$V/coding-$V.tar.gz"
(cd "$SRV/download/v$V" && sha256sum "coding-$V.tar.gz" > "coding-$V.tar.gz.sha256")
echo "v$V" > "$SRV/latest"
# The bootstrap as a user gets it: a single file, run from anywhere.
cp scripts/release/bootstrap.sh /tmp/coding-install.sh
cd /tmp

CODING_RELEASE_URL="file://$SRV" bash /tmp/coding-install.sh --ci --features="$TIER" > /tmp/bootstrap.log 2>&1; rc=$?
echo "--- bootstrap log tail ---"; tail -15 /tmp/bootstrap.log; echo "---"
CUR="$HOME/.coding/releases/current"
# What only this run can tell: the installer's own exit and log.
[[ $rc -eq 0 ]] && ok "installer exit 0" || bad "installer exit $rc"
grep -q "Node.js dependencies installed" /tmp/bootstrap.log && ok "dependencies installed" || bad "npm install did not succeed"
grep -qE "Initializing [a-z-]+ submodule|git submodule update" /tmp/bootstrap.log && bad "tried to fetch a submodule" || ok "no submodule fetched"
# Unattended (--ci, no --yes) the installer declines to edit the shell rc — that
# needs consent — and prints the line to add instead. Either way the path must
# be `current`: written to the rc, or in the suggested line.
rc_hit="$(grep -h 'export CODING_REPO=' "$HOME/.bashrc" "$HOME/.profile" "$HOME/.zshrc" 2>/dev/null | head -1)"
suggested="$(sed 's/\x1b\[[0-9;]*m//g' /tmp/bootstrap.log | grep -A3 'Skipped shell configuration modification' | grep 'export CODING_REPO=' | head -1)"
if [[ "$rc_hit" == *"$CUR"* ]]; then ok "shell rc names current"
elif [[ -z "$rc_hit" && "$suggested" == *"\"$CUR\""* ]]; then ok "shell rc left alone (no consent under --ci); the suggested export names current"
else bad "shell rc: ${rc_hit:-none}; suggested: ${suggested:-none}"; fi

# Everything else is what a user checks after installing: the same script.
while IFS= read -r line; do
    case "$line" in
        "VERIFY pass "*) ok "${line#VERIFY pass }" ;;
        "VERIFY fail "*) bad "${line#VERIFY fail }" ;;
    esac
done < <(bash "$CUR/scripts/release/verify-install.sh" --tier "$TIER" --allow-no-rc --offline 2>&1)
echo "BOOTSTRAP_E2E_DONE"
exit 0
