# shellcheck shell=bash
# tests/cleanroom/snapshot.sh — the build context both clean rooms start from.
#
#   cleanroom_snapshot <repo> <ctx>   → <ctx>/snapshot.tar, <ctx>/extras/
#
# Used by run.sh (isolation, no service manager) and services.sh (a real install
# per tier under systemd).
cleanroom_snapshot() {
  local REPO="$1" CTX="$2"
  echo "[cleanroom] snapshotting tracked files (incl. submodules) from $REPO"
  # Plus untracked-but-not-ignored files of the main repo (new files not yet
  # committed), minus .data/, where runtime leftovers are untracked rather than
  # ignored.
  (cd "$REPO" && { git ls-files -z --recurse-submodules
                   git ls-files -z --others --exclude-standard -- . ':!.data'; } \
    | while IFS= read -r -d '' f; do [ -e "$f" ] && printf '%s\0' "$f"; done \
    | tar --null -T - -cf "$CTX/snapshot.tar")
  # The LLM proxy, as the installer's clone SOURCE. Its real remote is a private
  # repo the container cannot authenticate to, so it gets a git bundle of the
  # sibling checkout's committed HEAD instead, and inside.sh points
  # RAPID_LLM_PROXY_REPO at it. That still exercises the installer's real clone,
  # build and service path; only the URL differs. Committed state only: an
  # uncommitted proxy change is not in the bundle, so say so rather than test a
  # version nobody has.
  mkdir -p "$CTX/extras"
  local PROXY_SRC branch
  PROXY_SRC="${RAPID_LLM_PROXY_DIR:-$(cd "$REPO/.." && pwd)/_work/rapid-llm-proxy}"
  if git -C "$PROXY_SRC" rev-parse --git-dir >/dev/null 2>&1; then
    branch="$(git -C "$PROXY_SRC" branch --show-current)"
    git -C "$PROXY_SRC" bundle create -q "$CTX/extras/rapid-llm-proxy.bundle" HEAD "$branch"
    echo "[cleanroom] proxy: bundled $(git -C "$PROXY_SRC" rev-parse --short HEAD) ($branch) from $PROXY_SRC"
    [ -z "$(git -C "$PROXY_SRC" status --porcelain --untracked-files=no)" ] \
      || echo "[cleanroom] proxy: WARNING — uncommitted changes in $PROXY_SRC are NOT in the bundle"
  else
    echo "[cleanroom] proxy: no checkout at $PROXY_SRC — the proxy assertions will be skipped"
  fi
}
