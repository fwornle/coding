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
# Grading tier. Copilot on both networks — NOT claude-code/opus, which was the previous
# answer and did not survive contact with the fallback chain. See 'kgbench-judge' below.
JUDGE = {'provider': 'copilot', 'model': 'claude-sonnet-5'}

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
    # kb-relevance-judge (2026-07-23): the knowledge-injection precision gate runs on EVERY
    # substantive prompt and must be fast — the default claude-code (CLI subprocess) route is
    # ~2.8s and blows the retrieval timeout into fail-open (keeping noise). Pin to CHEAP (copilot/
    # haiku, HTTP) so it returns in ~0.7s. Small prompt (≤12 candidate titles) → haiku is the tier.
    'kb-relevance-judge':                      CHEAP,
    # LSL observation resolver (src/live-logging/LslObservationResolver.js —
    # the 30-min in-process obs-api sweep). Small prompt (a vague summary + a
    # 3-prompt LSL window) and small response (4-line template + a confidence
    # line), so haiku is the right tier. Pinned to copilot (HTTP) because the
    # default claude-code (CLI subprocess) path hit the resolver's 60s per-row
    # timeout and dropped rows to `failed`.
    'observation-resolution':                  CHEAP,
    # Consolidator (src/live-logging/ObservationConsolidator.js _callLLM tags).
    # User-triggered batch synthesis, not continuous, so the cost vs. ~30x
    # latency tradeoff favors copilot. -digest / -insight are full synthesis
    # workloads (sonnet). -compaction / -resynthesize are small refresh
    # deltas over a single existing insight (haiku).
    'consolidator-digest':                     HEAVY,
    'consolidator-insight':                    HEAVY,
    'consolidator-compaction':                 CHEAP,
    'consolidator-resynthesize':               CHEAP,
    # kgbench's secondary scorer (lib/kgbench/judge.mjs). This override is not an
    # optimisation — it is the ONLY way to choose the judge's model at all, because
    # /api/complete ignores the request-body `model`. Without an entry here the judge gets
    # whatever the proxy defaults to, which is how runs r6 and r7 were graded by
    # claude-haiku-4-5 while run.json published `claude-opus-4.8` (a version that does not
    # exist, so the substitution was silent and total).
    #
    # THIS USED TO SAY claude-code/claude-opus-5, on the reasoning that the grader should get
    # the strongest model the personal subscription offers, with a JUDGE=work switch to
    # copilot/sonnet inside the corporate network where Copilot has no Opus at any version
    # (`400 The requested model is not supported` — still true, re-probed 2026-08-10).
    #
    # It did not hold, and the failure was silent in exactly the way this entry exists to
    # prevent. The pin IS applied — the proxy logs `process-override [kgbench-judge]: prefer
    # claude-code model=claude-opus-5` and then `claude-code: model=claude-opus-5 method=cli`
    # — but claude-code's direct API answers RATE_LIMITED far more often than not, and the
    # fallback ("via CLI worker pool, same Max subscription, different rate-limit bucket")
    # comes back claude-haiku-4-5 no matter which model was asked for. The worker is even
    # spawned under `key=claude-opus-5::…` and still returns haiku. On 2026-08-09 that was 21
    # opus-5 rows against 2065 haiku, and the haiku stretch covered run coding-v1-x2 — so the
    # benchmark was graded by haiku while run.json published opus. Same shape as the r6/r7
    # incident above, one layer further down.
    #
    # So the judge is pinned to a provider that HONOURS the model rather than the one with the
    # best catalogue. Probed 2026-08-10: copilot returns exactly what it is asked for
    # (claude-sonnet-5, claude-sonnet-4.6, claude-haiku-4.5 all exact), and 400s on every opus
    # variant. sonnet-5 is therefore the strongest DETERMINISTIC judge available, and one
    # setting now works on both networks — JUDGE=work is gone.
    #
    # Not absolute, and worth knowing: if copilot's enterprise upstream goes unreachable the
    # chain promotes claude-code above it and carries the model across, which lands back on
    # the rate-limited path. `--show` reports the pin, not what was served; the run's own
    # warning line reports what was served, and that remains the thing to read.
    #
    # An A/B over 18 cells with independently established ground truth scored haiku-4.5 and
    # sonnet-4.6 both 18/18, so this is not a correctness rescue — it is provenance (getting
    # what we asked for) plus sharper score separation. It does mean scores from this judge
    # are not comparable to runs graded earlier by haiku; re-grade or re-run, do not mix.
    'kgbench-judge':                           JUDGE,
    # opencode's own calls. PROVIDER ONLY, DELIBERATELY NO MODEL — an override model replaces
    # body.model for the whole Claude family, so pinning one here would silently serve a
    # matrix cell launched at claude-sonnet-4.6 with something else and make the run's
    # declared model false. opencode already picks per call: sonnet-5 for the agentic loop,
    # haiku-4.5 for title generation, and both are honoured.
    #
    # What this changes is only WHERE the toolless calls go. Tool-bearing requests are already
    # forced onto copilot (gateToolCapableChain drops claude-code, which is spawned
    # `--tools ''`), but title-gen carries no tools, so it fell through to the claude-code CLI
    # — 184 calls on the 2026-08-09 x2 day, on the same subprocess path whose worker-pool
    # fallback loses the model. Pinning the provider keeps opencode off it entirely.
    'opencode':                                {'provider': 'copilot'},
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

# An override may pin the provider ALONE (see 'opencode'). `model` is genuinely absent then,
# not empty, because the proxy only substitutes a model when the key is present — so it is
# rendered as the thing it means rather than defaulted to a name nobody chose.
def fmt(o):
    if not o:
        return '(none)'
    return f'{o["provider"]}/{o["model"]}' if o.get('model') else f'{o["provider"]} (model: caller\'s)'


if mode == 'show':
    print('--- current processOverrides ---')
    for proc in sorted(overrides):
        o = overrides[proc]
        marker = ' [wave-analysis]' if proc.startswith('wave-analysis-') else ''
        model = o['model'] if o.get('model') else "(caller's own)"
        print(f'  {proc:30}  {o["provider"]:12}  {model}{marker}')
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
print(f'applied {len(changed)} override change(s):')
for proc, was, now in changed:
    print(f'  {proc:30}  {fmt(was):25} -> {fmt(now)}')
PY
