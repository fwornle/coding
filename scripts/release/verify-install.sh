#!/usr/bin/env bash
# Check a release install of coding (docs/architecture/release-layout.md).
#
#   bash ~/.coding/releases/current/scripts/release/verify-install.sh [--tier <name>] [--allow-no-rc] [--offline]
#
# Run it as the user who installed, after `coding-install.sh` or `coding update`.
# macOS, Linux and WSL. One line per check; exit 1 when any check failed.
#
#   --tier <name>   also check that features.yaml selects this tier
#   --allow-no-rc   accept a shell rc without CODING_REPO (an unattended --ci
#                   install declines to edit it without consent)
#   --offline       skip `coding update --check` (it asks GitHub)
#
# Every line starts with "VERIFY pass " or "VERIFY fail " so a harness can read it
# (scripts/release/bootstrap-e2e.sh does). CODING_HOME replaces $HOME.
set -uo pipefail

TIER=""; ALLOW_NO_RC=false; OFFLINE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tier) shift; TIER="${1:-}" ;;
        --tier=*) TIER="${1#*=}" ;;
        --allow-no-rc) ALLOW_NO_RC=true ;;
        --offline) OFFLINE=true ;;
        -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
        *) echo "verify-install: unknown option $1" >&2; exit 2 ;;
    esac
    shift
done

H="${CODING_HOME:-$HOME}"
REL="$H/.coding/releases"
CUR="$REL/current"
FAILED=0
pass() { echo "VERIFY pass $*"; }
fail() { echo "VERIFY fail $*"; FAILED=1; }

# ── layout ───────────────────────────────────────────────────────────────────
V="$(readlink "$CUR" 2>/dev/null || true)"
if [[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then pass "current -> $V"
else fail "~/.coding/releases/current is missing or not a release (${V:-no link})"; echo "VERIFY_DONE failed=1"; exit 1; fi
[[ -f "$REL/$V/release.json" ]] && pass "release $V is complete (release.json)" || fail "release $V has no release.json"
if grep -q '"channel": *"release"' "$H/.coding/install.json" 2>/dev/null; then pass "install.json: release channel"
else fail "install.json: $(tr -d '\n' < "$H/.coding/install.json" 2>/dev/null || echo missing)"; fi

st="$("$CUR/bin/coding" releases status 2>&1)"
grep -q "code root: $CUR\$" <<<"$st" && pass "coding releases status: code root is current" || fail "coding releases status says: $(grep 'code root' <<<"$st" || echo "$st" | tail -1)"
[[ -d "$CUR/node_modules" ]] && pass "dependencies installed in $V" || fail "no node_modules in $V"

# ── what the installer stored outside the tree ───────────────────────────────
link="$(readlink "$H/bin/coding" 2>/dev/null || true)"
[[ "$link" == "$CUR/bin/coding" ]] && pass "~/bin/coding -> current" || fail "~/bin/coding -> ${link:-missing}"

RCS=("$H/.zshrc" "$H/.zprofile" "$H/.bashrc" "$H/.bash_profile" "$H/.profile")
rc_hit="$(grep -h 'export CODING_REPO=' "${RCS[@]}" 2>/dev/null | tail -1)"
if [[ "$rc_hit" == *"$CUR"* ]]; then pass "shell rc: CODING_REPO names current"
elif [[ -z "$rc_hit" && "$ALLOW_NO_RC" == true ]]; then pass "shell rc: not edited (allowed)"
else fail "shell rc: ${rc_hit:-no CODING_REPO export} (expected $CUR)"; fi

# Nothing persisted may name a version folder: an update would strand it.
stored=("$CUR/.activate" "$CUR/.claude/settings.local.json" "$CUR/claude-code-mcp-processed.json" "${RCS[@]}" "$H/.claude.json")
case "$(uname -s)" in
    Darwin) for f in "$H"/Library/LaunchAgents/com.coding.*.plist; do [[ -e "$f" ]] && stored+=("$f"); done ;;
    Linux)  for f in "$H"/.config/systemd/user/coding*.service "$H"/.config/systemd/user/com.coding.*.service; do [[ -e "$f" ]] && stored+=("$f"); done ;;
esac
hits="$(grep -l "$REL/[0-9][0-9.]*[0-9]" "${stored[@]}" 2>/dev/null | sed "s#^$H#~#" | tr '\n' ' ')"
[[ -z "$hits" ]] && pass "no version folder path stored (${#stored[@]} places checked)" || fail "version folder path stored in: $hits"

# ── features ─────────────────────────────────────────────────────────────────
if [[ -f "$H/.coding/features.yaml" ]]; then
    if [[ -z "$TIER" ]] || grep -qE "^profile: *$TIER([[:space:]]|$)" "$H/.coding/features.yaml"; then pass "features.yaml${TIER:+ selects $TIER}"
    else fail "features.yaml does not select $TIER: $(grep -m1 '^profile:' "$H/.coding/features.yaml" || echo 'no profile line')"; fi
else
    fail "no ~/.coding/features.yaml"
fi

# ── daemons ──────────────────────────────────────────────────────────────────
case "$(uname -s)" in
    Darwin)
        n=0; down=""
        for f in "$H"/Library/LaunchAgents/com.coding.*.plist; do
            [[ -e "$f" ]] || continue
            label="$(basename "$f" .plist)"; n=$((n + 1))
            launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 || down="$down $label"
        done
        if [[ $n -eq 0 ]]; then pass "no coding daemons registered (fine for a tier without any)"
        elif [[ -z "$down" ]]; then pass "$n coding daemon(s) loaded in launchd"
        else fail "registered but not loaded:$down"; fi
        ;;
    Linux)
        if systemctl --user is-system-running >/dev/null 2>&1 || systemctl --user list-units >/dev/null 2>&1; then
            down="$(systemctl --user list-units --all --no-legend 'coding*' 'com.coding.*' 2>/dev/null | awk '$3 != "active" {print $1}' | tr '\n' ' ')"
            [[ -z "$down" ]] && pass "coding systemd units active" || fail "systemd units not active: $down"
        else
            pass "no systemd user manager here — daemons not checked"
        fi
        ;;
esac

# ── release check ────────────────────────────────────────────────────────────
if [[ "$OFFLINE" == false ]]; then
    chk="$("$CUR/bin/coding" update --check 2>&1)"; rc=$?
    [[ $rc -eq 0 ]] && pass "coding update --check: $(tail -1 <<<"$chk" | tr -d '\033' | sed 's/\[?1004l//')" || fail "coding update --check (exit $rc): $(tail -1 <<<"$chk")"
fi

echo "VERIFY_DONE failed=$FAILED"
exit "$FAILED"
