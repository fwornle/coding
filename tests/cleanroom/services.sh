#!/usr/bin/env bash
# tests/cleanroom/services.sh — a real install of every tier on Linux, services up.
#
# The T2 acceptance test (.planning/per-repo-tenancy.md). Boots a container with
# systemd as PID 1 and a lingering user `dev`, puts a snapshot of THIS working
# tree in it as a fresh clone, and runs tests/cleanroom/services-inside.sh as
# that user: ./install.sh per tier (harness → learning → learning-perf →
# everything, the upgrade path), asserting after each that exactly the tier's
# daemons are installed and active under `systemctl --user`, that the health
# coordinator, obs-api and the LLM proxy answer /health, and that the status
# line renders. Ends with ./uninstall.sh, asserting every unit is gone.
#
# Local, not CI: the submodules and the proxy are private (see run.sh).
#
#   tests/cleanroom/services.sh                 # all four tiers
#   tests/cleanroom/services.sh harness         # just some
#   CLEANROOM_KEEP=1 tests/cleanroom/services.sh  # keep the container
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CTX="$(mktemp -d "${TMPDIR:-/tmp}/cleanroom-svc.XXXXXX")"
IMAGE=coding-cleanroom-systemd
NAME="coding-cleanroom-svc-$$"
TIERS=("$@"); [ ${#TIERS[@]} -gt 0 ] || TIERS=(harness learning learning-perf everything)

cleanup() {
  rm -rf "$CTX"
  if [ "${CLEANROOM_KEEP:-0}" = "1" ]; then
    echo "[cleanroom] kept: docker exec -it -u dev $NAME bash   (docker rm -f $NAME when done)"
  else
    docker rm -f "$NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# shellcheck source=tests/cleanroom/snapshot.sh
source "$REPO/tests/cleanroom/snapshot.sh"
cleanroom_snapshot "$REPO" "$CTX"
cp "$REPO/tests/cleanroom/Dockerfile.systemd" "$CTX/Dockerfile"
echo "[cleanroom] snapshot $(du -h "$CTX/snapshot.tar" | cut -f1); building image"
docker build -q -t "$IMAGE" "$CTX" >/dev/null

# systemd in a container: privileged, its own cgroup tree writable, tmpfs /run.
docker run -d --name "$NAME" --privileged --cgroupns=private \
  --tmpfs /run --tmpfs /run/lock "$IMAGE" >/dev/null

uid="$(docker exec "$NAME" id -u dev)"
echo "[cleanroom] waiting for systemd and dev's user manager (uid $uid)"
for _ in $(seq 1 60); do
  state="$(docker exec "$NAME" systemctl is-system-running 2>/dev/null || true)"
  if [[ "$state" == running || "$state" == degraded ]] \
     && docker exec "$NAME" test -S "/run/user/$uid/bus"; then
    break
  fi
  sleep 1
done
echo "[cleanroom] system: $state"
docker exec "$NAME" test -S "/run/user/$uid/bus" \
  || { echo "[cleanroom] dev's user manager never came up"; docker exec "$NAME" systemctl --failed; exit 1; }

set +e
docker exec -u dev -w /home/dev/coding \
  -e HOME=/home/dev -e USER=dev \
  -e XDG_RUNTIME_DIR="/run/user/$uid" \
  -e DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
  "$NAME" bash tests/cleanroom/services-inside.sh "${TIERS[@]}"
status=$?
set -e
exit "$status"
