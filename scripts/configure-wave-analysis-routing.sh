#!/usr/bin/env bash
#
# configure-wave-analysis-routing.sh
#
# Idempotently install rapid-llm-proxy processOverrides that route
# wave-analysis-* processes through fast providers (copilot/sonnet for
# the heavy analyze/enrich paths; copilot/haiku for the cheap classify
# and observation-retry paths).
#
# Why this exists: Phase 42.2 Plan 06 follow-up uncovered that without
# explicit overrides, the proxy's default routing sends wave-analysis
# LLM calls through `claude-code` (CLI subprocess). That path is
# 30x slower than `copilot` (HTTP+OAuth) for the wave1 analyzeComponent
# workload (44-59s vs ~18s end-to-end) AND it tends to return truncated
# JSON responses (16-token bodies) that the wave-agent parsers silently
# catch and degrade to mock-mode on. Net effect: wave-analysis appears
# to "succeed" but produces synthetic scaffolding entities with zero
# real semantic analysis.
#
# This script PUTs the correct overrides to the proxy admin API and
# preserves any other overrides already in place (notably
# health-coordinator and observation-writer which are pinned to
# claude-code intentionally — they run continuously and shouldn't
# burn paid Copilot/Anthropic quota).
#
# Usage:
#   scripts/configure-wave-analysis-routing.sh         # apply overrides
#   scripts/configure-wave-analysis-routing.sh --show  # show current state, no write
#   scripts/configure-wave-analysis-routing.sh --reset # remove only wave-analysis-* entries
#
# Env:
#   LLM_PROXY_HOST    proxy host (default localhost)
#   LLM_PROXY_PORT    proxy port (default 12435)
#
# Exit codes: 0 on success, 1 on proxy unreachable, 2 on bad CLI args.

set -euo pipefail

LLM_PROXY_HOST="${LLM_PROXY_HOST:-localhost}"
LLM_PROXY_PORT="${LLM_PROXY_PORT:-12435}"
SETTINGS_URL="http://${LLM_PROXY_HOST}:${LLM_PROXY_PORT}/api/llm/settings"

MODE="apply"
case "${1:-}" in
  --show)  MODE="show"  ;;
  --reset) MODE="reset" ;;
  "")      ;;
  *)       printf 'usage: %s [--show|--reset]\n' "$0" >&2; exit 2 ;;
esac

if ! curl -sf -o /dev/null "$SETTINGS_URL"; then
  printf 'ERROR: rapid-llm-proxy unreachable at %s\n' "$SETTINGS_URL" >&2
  printf '  start it via: bash _work/rapid-llm-proxy/bin/start-llm-proxy.sh\n' >&2
  exit 1
fi

python3 - "$MODE" "$SETTINGS_URL" <<'PY'
import json, sys, urllib.request

mode, url = sys.argv[1], sys.argv[2]

HEAVY = {'provider': 'copilot', 'model': 'claude-sonnet-4.6'}
CHEAP = {'provider': 'copilot', 'model': 'claude-haiku-4.5'}

# Phase 52 D-05/D-11 — per-sub-step PROCESS_TAGS entries. Mirrors the 9 keys
# in integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts.
# These default to HEAVY (copilot / claude-sonnet-4.6) for the analyze /
# generation / extract paths, and CHEAP (copilot / claude-haiku-4.5) for
# the classify / retry / repair recovery paths whose latency profile is
# small-prompt-small-response. Operators can override per entry via the
# dashboard settings UI (Plan 52-02) without changing this file.
WAVE_OVERRIDES = {
    # Pre-Phase-52 wave-level entries (preserved for any caller that does
    # not opt-in to the per-sub-step override — wave-level constants are
    # still bound at construction in wave{1,2,3}-*-agent.ts):
    'wave-analysis-wave1':        HEAVY,
    'wave-analysis-wave1-enrich': HEAVY,
    'wave-analysis-wave2':        HEAVY,
    'wave-analysis-wave3':        HEAVY,
    'wave-analysis-sem-analyze':  CHEAP,
    'wave-analysis-sem-analyzer': CHEAP,
    'wave-analysis-staleness':    CHEAP,
    # Phase 52 D-05 per-sub-step tags (9 keys from PROCESS_TAGS registry):
    'wave-analysis-wave1-l1emit':              HEAVY,
    'wave-analysis-wave2-subcomponent':        HEAVY,
    'wave-analysis-wave3-detail-extract':      HEAVY,
    'wave-analysis-wave3-ontology-classify':   CHEAP,
    'wave-analysis-wave4-insight':             HEAVY,
    'wave-analysis-wave4-diagram':             HEAVY,
    'wave-analysis-wave4-diagram-repair':      CHEAP,
    'wave-analysis-wave4-pattern-extract':     HEAVY,
    'wave-analysis-wave4-docs':                HEAVY,
    # Health/monitoring probes — must use copilot (HTTP) not claude-code (subprocess).
    # observation-writer pinned to CHEAP (haiku): empirically ~98% of overnight
    # calls return <10 output tokens (dedup churn / "no observation"), so paying
    # sonnet rates is pure waste. Heavy synthesis paths use the per-sub-step
    # wave-analysis-* tags above, not the generic observation-writer route.
    'health-coordinator':                      CHEAP,
    'observation-writer':                      CHEAP,
    # Consolidator (src/live-logging/ObservationConsolidator.js _callLLM tags).
    # User-triggered batch synthesis, not continuous, so the cost vs. ~30x
    # latency tradeoff favors copilot. -digest / -insight are full synthesis
    # workloads (sonnet). -compaction / -resynthesize are small refresh
    # deltas over a single existing insight (haiku).
    'consolidator-digest':                     HEAVY,
    'consolidator-insight':                    HEAVY,
    'consolidator-compaction':                 CHEAP,
    'consolidator-resynthesize':               CHEAP,
}

def get_settings():
    with urllib.request.urlopen(urllib.request.Request(url)) as r:
        body = json.loads(r.read())
    return body.get('settings', body)

def put_settings(s):
    req = urllib.request.Request(
        url,
        data=json.dumps(s).encode(),
        method='PUT',
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

current = get_settings()
overrides = dict(current.get('processOverrides', {}))

if mode == 'show':
    print('--- current processOverrides ---')
    for proc in sorted(overrides):
        o = overrides[proc]
        marker = ' [wave-analysis]' if proc.startswith('wave-analysis-') else ''
        print(f'  {proc:30}  {o["provider"]:12}  {o["model"]}{marker}')
    sys.exit(0)

if mode == 'reset':
    removed = [p for p in overrides if p.startswith('wave-analysis-')]
    for p in removed:
        del overrides[p]
    if not removed:
        print('no wave-analysis-* overrides present; nothing to remove')
        sys.exit(0)
    patched = dict(current)
    patched['processOverrides'] = overrides
    put_settings(patched)
    print(f'removed {len(removed)} wave-analysis-* overrides:')
    for p in removed:
        print(f'  - {p}')
    sys.exit(0)

changed = []
for proc, target in WAVE_OVERRIDES.items():
    existing = overrides.get(proc)
    if existing != target:
        overrides[proc] = target
        changed.append((proc, existing, target))

if not changed:
    print('all wave-analysis-* overrides already in place; nothing to do')
    sys.exit(0)

patched = dict(current)
patched['processOverrides'] = overrides
put_settings(patched)
print(f'applied {len(changed)} wave-analysis-* override change(s):')
for proc, was, now in changed:
    was_s = f"{was['provider']}/{was['model']}" if was else '(none)'
    now_s = f"{now['provider']}/{now['model']}"
    print(f'  {proc:30}  {was_s:25} -> {now_s}')
PY
