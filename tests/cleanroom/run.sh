#!/usr/bin/env bash
# tests/cleanroom/run.sh — the clean-room isolation test (P4), host side.
#
# Builds a container that has never seen `coding`, puts a snapshot of THIS
# working tree in it as a fresh clone, and runs tests/cleanroom/inside.sh: a
# real ./install.sh --ci --scope=team-a --features=km-perf, then the writers,
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
