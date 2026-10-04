# shellcheck shell=bash
#
# Where a repo's session transcripts live — bash twin of lib/history/paths.cjs
# (T9). Same rule; tests/history/paths.test.mjs keeps the two field-equal.
#
#   <repo>/.coding/history      when <repo>/.coding exists, or nothing exists yet
#   <repo>/.specstory/history   only while it is a REAL directory and there is no
#                               .coding/ (a repo not launched since T3)
#
#   source "$CODING_REPO/scripts/lib/history-dir.sh"
#   dir="$(repo_history_dir "$project")"
repo_history_dir() {
    local repo="${1%/}"
    if [[ ! -d "$repo/.coding" || -L "$repo/.coding" ]] \
        && [[ -d "$repo/.specstory/history" && ! -L "$repo/.specstory/history" ]]; then
        printf '%s\n' "$repo/.specstory/history"
        return 0
    fi
    printf '%s\n' "$repo/.coding/history"
}
