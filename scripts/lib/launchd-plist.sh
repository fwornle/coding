# shellcheck shell=bash
#
# Rendering a checked-in launchd plist for the machine it is being installed on.
#
# THE PROBLEM THIS SOLVES
# -----------------------
# Every plist under launchd/ used to carry an absolute path to ONE developer's checkout —
# /Users/<someone>/Agentic/coding — in its ProgramArguments, WorkingDirectory and both log
# paths, and each installer repeated it in a hardcoded REPO_ROOT. On any other machine the
# installer wrote a plist that launchctl accepted and that then failed at every run, which
# is the worst shape of failure: `launchctl list` shows the job, so it looks installed.
#
# The plists stay checked in rather than being generated from heredocs (the approach
# scripts/install-prompt-classifier-launchd.sh takes) because several of them carry the
# reasoning for their own settings — com.coding.sub-agent-live-claude.plist has 25 lines
# explaining why KeepAlive is <true/> and not a dict, written after a daemon stayed dead
# for 14.5 hours. Moving those into a shell heredoc would bury them.
#
# So: the path becomes a token, and this file owns both the token's spelling and the
# substitution. That coupling is the whole point — a plist and an installer that disagree
# about the token produce a plist with an unsubstituted placeholder in it, which is why
# render_plist refuses to emit one.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/launchd-plist.sh"
#   render_plist "launchd/com.coding.foo.plist" "$tmp" "$REPO_ROOT"

# The placeholder every checked-in plist uses in place of the repo root.
LAUNCHD_REPO_TOKEN='__CODING_REPO__'

# Resolve the repo root for an installer living in scripts/.
#
# Honours CODING_REPO when set — the wrapper exports it, and tests need to point an
# installer at a fixture tree — then falls back to the installer's own location. Same idiom
# as scripts/install-prompt-classifier-launchd.sh, which was already doing this correctly.
launchd_repo_root() {
    if [[ -n "${CODING_REPO:-}" ]]; then
        printf '%s' "${CODING_REPO}"
    else
        (cd "$(dirname "${BASH_SOURCE[1]}")/.." && pwd)
    fi
}

# Render a source plist to `out`, substituting the repo root, then validate it.
#
# Substitution is bash parameter expansion rather than sed: a repo path containing `&` or
# `/` needs escaping in a sed replacement, and getting that wrong corrupts the path silently
# instead of failing.
#
# Two guards, both failing loudly rather than installing something broken:
#   * a leftover token means the plist and this file disagree about its spelling;
#   * plutil -lint runs on the RENDERED file, not the template, because the rendering is
#     what launchd will actually read.
render_plist() {
    local src="$1" out="$2" repo="$3"

    if [[ ! -f "$src" ]]; then
        printf 'render_plist: source plist not found: %s\n' "$src" >&2
        return 1
    fi

    local content
    content="$(cat "$src")"
    printf '%s\n' "${content//${LAUNCHD_REPO_TOKEN}/${repo}}" > "$out"

    # Reject ANY residual __UPPER_CASE__ placeholder, not just LAUNCHD_REPO_TOKEN.
    # Checking only the exact token misses the case that actually happens: a new plist
    # copied from an old one with the placeholder mistyped. That leaves no occurrence of
    # the real token, so an exact-match check passes, plutil -lint passes (it is still
    # valid XML), and launchd loads a job whose WorkingDirectory is literally
    # "__CODINGREPO__". A pattern match is what turns that into a failed install.
    local residual
    residual="$(grep -oE '__[A-Z][A-Z0-9_]*__' "$out" | head -1 || true)"
    if [[ -n "$residual" ]]; then
        printf 'render_plist: %s still contains placeholder %s after substitution\n' \
            "$src" "$residual" >&2
        return 1
    fi

    if ! /usr/bin/plutil -lint "$out" >/dev/null; then
        printf 'render_plist: rendered plist failed plutil -lint (from %s)\n' "$src" >&2
        return 1
    fi
}
