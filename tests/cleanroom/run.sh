#!/usr/bin/env bash
# tests/cleanroom/run.sh — the clean-room isolation test (P4), host side.
#
# Builds a container that has never seen `coding`, puts a snapshot of THIS
# working tree in it as a fresh clone, and runs tests/cleanroom/inside.sh: a
# real ./install.sh --ci --scope=team-a --features=learning-perf, then the writers,
# then assertions that nothing landed outside team-a's own data home — in
# particular not on a planted `coding` tenant.
#
# Local, not CI: the submodules (lib/km-core, integrations/*) are private, and
# without them neither obs-api nor the knowledge writers exist to be tested.
#
#   tests/cleanroom/run.sh            # build + run; exit status = failed assertions
#   CLEANROOM_KEEP=1 tests/cleanroom/run.sh   # keep the container for inspection
#
# The snapshot is `git ls-files --recurse-submodules` from the WORKING TREE:
# uncommitted changes are tested, while node_modules, .data user trees and
# session history are not tracked and so never enter the clean room.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CTX="$(mktemp -d "${TMPDIR:-/tmp}/cleanroom.XXXXXX")"
trap 'rm -rf "$CTX"' EXIT
IMAGE=coding-cleanroom
NAME="coding-cleanroom-$$"

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
cp "$REPO/tests/cleanroom/Dockerfile" "$CTX/Dockerfile"
echo "[cleanroom] snapshot $(du -h "$CTX/snapshot.tar" | cut -f1); building image"
docker build -q -t "$IMAGE" "$CTX" >/dev/null

rm_flag=(--rm); [ "${CLEANROOM_KEEP:-0}" = "1" ] && rm_flag=()
echo "[cleanroom] running ${NAME}"
set +e
docker run ${rm_flag[@]+"${rm_flag[@]}"} --name "$NAME" "$IMAGE"
status=$?
set -e
[ "${CLEANROOM_KEEP:-0}" = "1" ] && echo "[cleanroom] kept: docker cp $NAME:/tmp/cleanroom ./cleanroom-out"
exit "$status"
