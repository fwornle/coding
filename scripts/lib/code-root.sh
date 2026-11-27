# shellcheck shell=bash
#
# The path worth persisting for the code an installer or the launcher runs from.
#
# A release lives in ~/.coding/releases/<version>/ with ~/.coding/releases/current
# pointing at the active one (lib/install/layout.cjs). Anything that persists a
# path — a launchd plist, a systemd unit, a scheduled task, the CODING_REPO a
# session exports into hooks and compose mounts — must name `current`, never the
# version folder: an update flips the link, and a version folder may be pruned.
#
# coding_code_root DIR
#   DIR is the folder this code was started from (any spelling; symlinks are
#   resolved for the comparison only). If `current` resolves to the same folder,
#   print the `current` path; otherwise print DIR unchanged — a dev checkout, or
#   an older release started on purpose, keeps its own path.
#
# Bash mirror of stableRoot() in lib/install/layout.cjs; keep the two equal
# (tests/install/layout.test.mjs runs both against the same tree).
coding_code_root() {
    local dir="$1"
    local cur="${CODING_HOME:-$HOME}/.coding/releases/current"
    if [[ -L "$cur" ]]; then
        local real_dir real_cur
        real_dir="$(cd -P "$dir" 2>/dev/null && pwd)" || real_dir=""
        real_cur="$(cd -P "$cur" 2>/dev/null && pwd)" || real_cur=""
        if [[ -n "$real_dir" && "$real_dir" == "$real_cur" ]]; then
            printf '%s' "$cur"
            return 0
        fi
    fi
    printf '%s' "$dir"
}
