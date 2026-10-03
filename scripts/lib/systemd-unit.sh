# shellcheck shell=bash
#
# Rendering a checked-in systemd user unit for the machine it is being installed on.
#
# The Linux half of scripts/lib/launchd-plist.sh, with the same token for the repo root
# so a unit and its plist twin read alike. One more token than launchd needs:
#
#   __CODING_REPO__   the checkout the daemons run from
#   __NODE_DIR__      the directory of the node this installer ran under
#
# The plists can name a fixed PATH because Homebrew puts node in one of two places. On
# Linux node is as often under $HOME (nvm, fnm, asdf, volta) as in /usr/bin, and a user
# manager inherits no shell PATH at all — a unit with a fixed PATH is a job that starts
# and then fails with `node: not found` at every run.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/systemd-unit.sh"
#   render_unit "systemd/obs-api.service" "$tmp" "$REPO_ROOT" "$(dirname "$(command -v node)")"

SYSTEMD_REPO_TOKEN='__CODING_REPO__'
SYSTEMD_NODE_TOKEN='__NODE_DIR__'

# Render `src` to `out`. Bash parameter expansion, not sed, for the reason given in
# launchd-plist.sh: a path with `&` or `/` in it corrupts a sed replacement silently.
#
# Fails on any residual __UPPER_CASE__ placeholder: a unit whose WorkingDirectory is
# literally "__CODINGREPO__" loads, fails at every start, and looks installed.
render_unit() {
    local src="$1" out="$2" repo="$3" node_dir="$4"

    if [[ ! -f "$src" ]]; then
        printf 'render_unit: source unit not found: %s\n' "$src" >&2
        return 1
    fi
    if [[ -z "$node_dir" ]]; then
        printf 'render_unit: no node directory to put on the unit PATH (is node installed?)\n' >&2
        return 1
    fi

    local content
    content="$(cat "$src")"
    content="${content//${SYSTEMD_REPO_TOKEN}/${repo}}"
    content="${content//${SYSTEMD_NODE_TOKEN}/${node_dir}}"
    printf '%s\n' "$content" > "$out"

    local residual
    residual="$(grep -oE '__[A-Z][A-Z0-9_]*__' "$out" | head -1 || true)"
    if [[ -n "$residual" ]]; then
        printf 'render_unit: %s still contains placeholder %s after substitution\n' \
            "$src" "$residual" >&2
        return 1
    fi
}

# Add `Environment=KEY=VALUE` to a rendered unit's [Service] section. For per-machine
# settings that have no place in the shared template (a non-default proxy port, a proxy
# checkout somewhere else) — the counterpart of the PlistBuddy edits on macOS.
unit_add_env() {
    local file="$1" key="$2" value="$3" tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/unit-env.XXXXXX")"
    awk -v line="Environment=${key}=${value}" '
        { print }
        /^\[Service\]$/ { print line }
    ' "$file" > "$tmp" && mv "$tmp" "$file"
}

# Does this machine have a user service manager we can talk to?
#
# Not `command -v systemctl`: WSL2 without `systemd=true` in /etc/wsl.conf ships the
# binary and answers every --user call with "Failed to connect to bus", and so does a
# Linux host where nothing started a user manager for this account (a bare ssh/CI login
# without lingering).
systemd_user_available() {
    command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

# What to tell someone whose machine has no user manager. One text for every caller.
systemd_user_unavailable_hint() {
    if [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
        cat <<'EOF'
This WSL distribution runs without systemd, so there is no user service manager.
Enable it (WSL 0.67.6 or newer), then re-run ./install.sh:
    printf '[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf
    wsl.exe --shutdown        # from Windows; reopen the distribution afterwards
EOF
    else
        cat <<'EOF'
No systemd user manager answers for this account (`systemctl --user` cannot reach
its bus). On a desktop login it starts with the session; for a headless or ssh-only
account, enable lingering and re-run ./install.sh:
    sudo loginctl enable-linger "$USER"
EOF
    fi
}
