#!/usr/bin/env bash
set -uo pipefail

# Launchd-side periodic pruner for dangling cold-store digest references.
#
# Driven by ~/Library/LaunchAgents/com.coding.digest-refs-sweeper.plist
# (StartInterval=21600 = 6h + RunAtLoad). Runs
# scripts/prune-dangling-digest-refs.mjs --apply, which filters each cold-store
# digest's `observationIds` down to ids that still resolve to an existing
# observation in `.data/observation-export/observations.json`.
#
# WHY this exists: a Digest keeps its source observation ids as provenance;
# those observations are continuously pruned by retention (or were never
# exported because quality==='low'), so refs dangle over time. This sweeper
# keeps the cold store self-consistent without manual intervention.
#
# SINGLE-OWNER RACE — safe by self-healing: `digests.json` is owned by obs-api
# (ObservationExporter is the writer). This job edits it from outside, so a write
# can interleave. That is SAFE here because the pruner only REMOVES dangling ids
# (never drops whole digests) via atomic tmp+rename, and the exporter rewrites
# `kmStore ∪ existing`:
#   - exporter clobbers our clean file → reintroduces dangling refs → we remove
#     them again next run (idempotent).
#   - we clobber a digest the exporter just wrote → it is still in kmStore, so the
#     exporter re-adds it on its next write. No lasting loss either way.
# As a courtesy we SKIP a run while a consolidation is inflight (best-effort — if
# the probe fails or obs-api is down, we proceed; the files are still readable).
#
# SAFETY / never-throw: `set -uo pipefail` + always `exit 0` so a bad run never
# crashes the daemon or trips launchd throttling. Mirrors
# scripts/context-turns-sweeper-job.sh (Phase 84) conventions.
#
# Env overrides (tests + hand-driving):
#   CODING_REPO           repo root (default /Users/Q284340/Agentic/coding)
#   OBS_API_URL           obs-api base (default http://localhost:12436)

REPO_ROOT="${CODING_REPO:-/Users/Q284340/Agentic/coding}"
OBS_API_URL="${OBS_API_URL:-http://localhost:12436}"

log() { printf '[digest-refs-sweeper][%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

cd "${REPO_ROOT}" || { log "ERROR: cannot cd to ${REPO_ROOT}"; exit 0; }

# Best-effort: skip while a consolidation is inflight (narrows the write window).
INFLIGHT="$(curl -sS --max-time 5 "${OBS_API_URL}/api/consolidation/status" 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).inflight===true));}catch(e){process.stdout.write('unknown');}});" 2>/dev/null || echo 'unknown')"
if [[ "${INFLIGHT}" == "true" ]]; then
  log "consolidation inflight — skipping this run (retry next interval)"
  exit 0
fi

log "running: node scripts/prune-dangling-digest-refs.mjs --apply"
node scripts/prune-dangling-digest-refs.mjs --apply
EXIT_CODE=$?
if [[ ${EXIT_CODE} -ne 0 ]]; then
  log "pruner exited ${EXIT_CODE} (non-fatal — will retry next interval)"
fi

log "sweep complete"
exit 0
