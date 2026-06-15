---
phase: 58-online-pipeline-semantic-edges-on-insights
verified: 2026-06-15T22:00:00Z
status: human_needed
score: 5/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Operator executes the live backfill runbook (Plan 58-03 Task 3) — stops obs-api + docker-compose, adds the 'mentions-classification' copilot processOverride, runs 'node scripts/backfill-insight-mentions.mjs', restores daemons"
    expected: "node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18 exits 0 with result=PASS; jq count of mentions edges in general.json >= 86"
    why_human: "Requires privileged operator actions: launchctl bootout com.coding.obs-api, docker-compose stop coding-services, exclusive LevelDB write access. Executor cannot hold the daemon lock. Pre-flight state confirmed: km-core hydrate-prefer-JSON patch present; 96 Insights / 0 mentions edges in live export; mentions-classification processOverride NOT yet installed (must be added before live run per 58-03-SUMMARY pre-flight table)."
  - test: "Verify CR-01 bridge scope fix: confirm whether the bridge's findByOntologyClass('Insight') can actually reach all 96 Insights or only 22 (the 74 with ontologyClass='Detail' but entityType='Insight' are skipped)"
    expected: "Either (a) the bridge is patched to use entityType filter / union query as described in 58-REVIEW.md CR-01 fix options, OR (b) a decision is documented that the one-shot backfill (Plan 58-03 Task 1) covers the 74 gap and the bridge's 22-Insight scope is accepted for steady-state (new Insights written by the Phase 58 _pushInsightToKG path always get ontologyClass='Insight')"
    why_human: "CR-01 is confirmed by live jq (22 vs 96). The fix requires either a code change (bridge filter) or an architectural acceptance decision. Automated verification cannot determine operator intent."
  - test: "Operator confirms the REQUIREMENTS.md traceability table for EDGE-01 and EDGE-02 is updated from 'Not started' to 'complete' (or equivalent)"
    expected: "grep for '| EDGE-01 | Phase 58 | Not started |' returns 0 hits; both requirements marked complete"
    why_human: "The requirements table was not updated as part of any Phase 58 plan or commit. Operator must decide whether to update REQUIREMENTS.md or accept that tracking is done in ROADMAP.md only."
---

# Phase 58: Online Pipeline Semantic Edges on Insights — Verification Report

**Phase Goal:** Emit semantic `mentions` edges atomically on Insight writes (EDGE-01) and ensure ≥86/96 existing Insights are covered (EDGE-02 live coverage gate, SC#1).
**Verified:** 2026-06-15T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Every new Insight written by ObservationConsolidator exits `_pushInsightToKG` with ≥1 mentions edge via `ObservationWriter.writeInsight(row, {mentionsTargetIds})` | VERIFIED | Code confirmed: `_pushInsightToKG` routes through `_ensureObservationWriter().writeInsight(row, {mentionsTargetIds})`. Integration test Test 1 passes (EDGE-01 emission: 1 Insight + 2 mentions + 1 capturedBy + 1 has_insight). |
| 2 | The Insight node and its mentions edges land within the same km-core exporter debounce window — no orphan-Insight intermediate state observable in the JSON export | VERIFIED | `ObservationWriter._emitMentionsEdges` runs inside the same try-block as `putEntity`, before `_anchorEntity`. Integration test Test 2 locks the ordering (putEntity index < all mentions addRelation indices < capturedBy index). Test 3 confirms concurrent reader cannot observe orphan. |
| 3 | D-04.1 fail-fast: when the classifier throws, the Insight is NOT written | VERIFIED | `_pushInsightToKG` returns early on classifier error before calling `writeInsight`. Integration test Test 6 asserts zero entities and zero edges when classifier throws. Unit test (ObservationWriter.test.js Test 8) confirms. |
| 4 | The backfill script `scripts/backfill-insight-mentions.mjs` can retroactively emit mentions edges on the 96 existing Insights (offline machinery verified; live execution deferred) | VERIFIED | Script exists (644 lines, executable, shebang present). 8 unit tests pass. Dry-run against live export exits 0 in <1s, writes summary artifact, 0 live edges added. `export async function processInsight` confirmed importable. |
| 5 | The bridge `_relinkOrphanOnlineInsights` emits missing mentions edges via the same classifier (D-06.2), with idempotency gate | PARTIAL | Bridge Pass 2 code exists and is kmStore-native (0 fetch() calls). Idempotency gate confirmed (existing.length > 0 → continue). BUT CR-01 defect: bridge uses `findByOntologyClass('Insight')` which returns only 22 of 96 Insights on the live graph (74 have entityType='Insight' but ontologyClass='Detail' due to pre-Phase-58 clobber). Bridge scope covers only ~23% of the historical population. |
| 6 | SC#1 acceptance gate: ≥86/96 existing Insights carry ≥1 mentions edge (live coverage verified) | FAILED | `node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18` exits 1 with `result=FAIL` / `covered=0`. The live backfill (Plan 58-03 Task 3) is deferred as operator verification-debt. Pre-execution state: 96 Insights in graph, 0 mentions edges. |
| 7 | D-01: exactly one new semantic-content edge type (`mentions`) — no `dependsOn`/`isRelatedTo`/`instanceOf` in any Phase 58 code path | VERIFIED | Grep confirms only `type: 'mentions'` appears in `_emitMentionsEdges`, `_relinkOrphanOnlineInsights` Pass 2, and `backfill-insight-mentions.mjs`. No other semantic edge types introduced. |

**Score:** 5/7 truths verified (1 partial, 1 failed pending operator live backfill)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `src/live-logging/MentionsClassifier.js` | Exports loadMentionCandidates / buildMentionsPrompt / extractMentionsFromLLMResponse / classifyMentions / __resetCacheForTests | VERIFIED | 422 lines. All 5 exports confirmed. Port 12435 wired (5 hits). `/api/complete` endpoint (6 hits). `taskType: 'mentions-classification'` present. SANITY_CAP=20 constant named. findByOntologyClass for Component/SubComponent/Detail all present. 0 console.* calls. |
| `src/live-logging/MentionsClassifier.test.js` | 10 unit tests, no live LLM | VERIFIED | 220 lines. `node --test` exits 0 with 10/10 pass. globalThis.fetch stubbed. FabricatedNameXYZ rejection tested. __resetCacheForTests exercised. |
| `src/live-logging/ObservationWriter.js` | writeInsight extended with options.mentionsTargetIds; _emitMentionsEdges helper added | VERIFIED | `_emitMentionsEdges` at lines 478-522 (3 grep hits). `writeInsight(row, options = {})` signature extended (5 hits for mentionsTargetIds). Ordering putEntity → _emitMentionsEdges → _anchorEntity confirmed in code. `metadata.source: 'observation-writer'` present. findRelations dedup before addRelation present. ontologyClass guard `if (!entity.ontologyClass)` present. 0 console.* calls. |
| `src/live-logging/ObservationWriter.test.js` | 9 unit tests locking EDGE-01/EDGE-02/D-04.1/D-06 | VERIFIED | 570 lines, 9 tests. Passes in combined run. callLog assertions, EDGE-02 narrative, classifyMentions stubs, fail-fast tests, observationWriter injection all present. |
| `src/live-logging/ObservationConsolidator.js` | _pushInsightToKG routes through ObservationWriter, 0 fetch() in method; _relinkOrphanOnlineInsights kmStore-native | VERIFIED (with CR-01 caveat) | MentionsClassifier imported at line 53. `this._observationWriter` constructor field + `_ensureObservationWriter` lazy getter. `awk` extract of `_pushInsightToKG` shows 0 fetch() calls, classifyMentions call, writeInsight call, has_insight addRelation. `_relinkOrphanOnlineInsights`: 0 fetch() calls, 9 kmStore method calls, idempotency gates present. CR-01: bridge uses findByOntologyClass('Insight') — only 22/96 Insights on live graph. |
| `scripts/backfill-insight-mentions.mjs` | One-shot backfill; processInsight exported; 8 tests | VERIFIED | 644 lines. Executable bit set. Shebang `#!/usr/bin/env node`. `export async function processInsight` confirmed. MentionsClassifier import (3 hits). `metadata.source: 'backfill-insight-mentions'` (4 hits). findRelations dedup before write (1 hit). 0 console.* calls. Dry-run verified live: exits 0 in <1s, 0 edges added. |
| `scripts/backfill-insight-mentions.test.mjs` | 8 unit tests | VERIFIED | 371 lines, 8/8 tests pass. |
| `scripts/check-insight-mentions-coverage.mjs` | SC#1 gate: exits 0/1 with parseable stdout | VERIFIED | 325 lines. Executable. `--help` documents all flags. Single-line stdout matches contract format. FAIL fixture → exit 1. PASS fixture → exit 0. Synthetic smoke tests passed during execution (per 58-04-SUMMARY). Live probe: covered=0, exit 1 (pre-backfill expected). CR-02: `--recent-only` (default true) biases toward fresh Insights; may miss the 74 historical orphans. |
| `src/live-logging/MentionsAtomicity.integration.test.js` | 8 integration tests, none skipped | VERIFIED | 873 lines. 8/8 tests pass, 0 skipped. processInsight imported directly from backfill script (W5 contract). EDGE-01, EDGE-02, atomicity, idempotency, fail-fast, bridge surface all covered by named tests. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `ObservationConsolidator.js` | `MentionsClassifier.js` | `import { loadMentionCandidates, classifyMentions } from './MentionsClassifier.js'` at line 53 | WIRED | Confirmed in source. `loadMentionCandidates` + `classifyMentions` called in `_pushInsightToKG` and `_relinkOrphanOnlineInsights`. |
| `ObservationConsolidator.js` | `ObservationWriter.js` | `this._observationWriter.writeInsight(row, {mentionsTargetIds})` | WIRED | `_ensureObservationWriter` lazy getter constructs `new ObservationWriter({kmStore, configPath})`. `writer.writeInsight(row, {mentionsTargetIds})` called at line 659. |
| `ObservationWriter.js` | `kmStore.addRelation` | `_emitMentionsEdges` for-loop calls `kmStore.addRelation({type:'mentions',...})` | WIRED | Confirmed. Dedup probe via `kmStore.findRelations` precedes each `addRelation`. |
| `backfill-insight-mentions.mjs` | `MentionsClassifier.js` | `import { loadMentionCandidates, classifyMentions } from '../src/live-logging/MentionsClassifier.js'` | WIRED | 3 grep hits for MentionsClassifier in backfill script. `processInsight(options.classifier)` accepts injected classifier with live fallback. |
| `MentionsAtomicity.integration.test.js` | `backfill-insight-mentions.mjs` (processInsight) | `import { processInsight } from '../../scripts/backfill-insight-mentions.mjs'` | WIRED | Confirmed in integration test (W5 contract). Test 5 imports and exercises the exported helper directly. |
| `MentionsClassifier.js` | `http://localhost:12435/api/complete` | `callProxy(buildMentionsPrompt(...))` via fetch POST | WIRED (unit-tested) | Port 12435 hardcoded as default. `/api/complete` endpoint present (6 hits). Not live-tested (requires running proxy); unit tests stub globalThis.fetch. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|------------------|--------|
| `ObservationConsolidator._pushInsightToKG` | `mentionsTargetIds` | `classifyMentions(entry.summary, candidates)` → rapid-llm-proxy `/api/complete` → `extractMentionsFromLLMResponse` | YES when LLM proxy up and candidate catalog non-empty | FLOWING (pending live proxy; unit-tested path confirmed) |
| `ObservationWriter._emitMentionsEdges` | mentions edges in kmStore | `kmStore.addRelation({from: mintedId, to: toId, type: 'mentions'})` | YES — real kmStore writes | FLOWING |
| `scripts/backfill-insight-mentions.mjs` | mentions edges | classifier → `processInsight` → `kmStore.addRelation` | YES in live run; 0 during dry-run (by design) | STATIC (pre-backfill); will be FLOWING after operator Task 3 |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 35-test Phase 58 suite | `node --test src/live-logging/MentionsClassifier.test.js src/live-logging/ObservationWriter.test.js scripts/backfill-insight-mentions.test.mjs src/live-logging/MentionsAtomicity.integration.test.js` | `tests 35 / pass 35 / fail 0 / skipped 0` (2566ms) | PASS |
| Coverage gate (pre-backfill expected FAIL) | `node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18 --no-recent-only` | `covered=0 threshold=18 result=FAIL` exit 1 | FAIL (expected — live backfill not yet run) |
| Dry-run backfill | `node scripts/backfill-insight-mentions.mjs --dry-run --limit=1` | exit 0, summary artifact written, 0 live edges added, 96 Insights reported | PASS |
| Coverage gate with --min 0.9 (per task instruction) | `node scripts/check-insight-mentions-coverage.mjs --source general.json --min 0.9 --sample 96` | `threshold=0 result=PASS` exit 0 — NOTE: --min 0.9 parsed as float → floors to 0 by parseInt; this is CR-02 surface behavior (not the intended invocation; use --min 86 for integer threshold) | SKIPPED (incorrect invocation parsed as trivial pass) |

---

### Probe Execution

No probe scripts under `scripts/*/tests/probe-*.sh` were declared for this phase. Step 7c is SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|---------|
| EDGE-01 | 58-01, 58-02, 58-03, 58-04 | Online Insights carry ≥1 semantic-content edge beyond capturedBy; ≥18/20 sampled Insights verified | PARTIAL | Writer path wired and unit-tested (35 tests pass). Backfill script complete and dry-run verified. SC#1 gate (check-insight-mentions-coverage.mjs) exists and correctly exits 1 pre-backfill. Live coverage 0/20 because Plan 58-03 Task 3 (operator live backfill) is deferred. |
| EDGE-02 | 58-02, 58-04 | ObservationConsolidator writes Insight node + semantic-content edges atomically | VERIFIED | putEntity → _emitMentionsEdges → _anchorEntity ordering locked in ObservationWriter.writeInsight try-block. Integration tests (Test 2 callLog ordering + Test 3 concurrent reader) pass. |

**Orphaned requirements:** EDGE-01 traceability row in REQUIREMENTS.md still marked "Not started" — no Phase 58 plan updated this table. EDGE-02 same. Informational only; does not affect acceptance.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/live-logging/ObservationConsolidator.js` | 667 | `if (this._kgPushDebug)` — flag never set anywhere (no constructor default, no env-var bridge, no setter) | Warning | Dead branch; diagnostic log `mintedId=... mentions=...` never fires. Operator cannot use CONSOLIDATOR_KG_DEBUG to get forensic output without a code change. Reported as WR-05 in 58-REVIEW.md. |
| `src/live-logging/ObservationConsolidator.js` | 2057, 2133 | `findByOntologyClass('Insight')` in bridge — returns only 22 of 96 live Insights (74 have entityType='Insight' but ontologyClass='Detail') | BLOCKER (CR-01) | Bridge backfill scope covers ~23% of historical population. The one-shot backfill script correctly uses entityType filter; the bridge does not. After the backfill runs, new Insights will get ontologyClass='Insight' going forward (writer fix in Phase 58 Plan 02). But any regression that produces ontologyClass drift again would be invisible to the bridge. |
| `scripts/check-insight-mentions-coverage.mjs` | 276-286 | `--recent-only` default true biases sampling toward freshly-written Insights | Warning (CR-02) | SC#1 can return PASS with the 74 historical orphans uncovered, if those are old enough to fall outside the top-2*N recent window. Operator must pass `--no-recent-only` for the full-population gate. |
| `scripts/backfill-insight-mentions.mjs` | 31-35 (docstring), 113-123 (parser) | CLI docs advertise `--source PATH` (space form) but parser only handles `--source=PATH` (equals form) | Warning (WR-03) | Operator following the documented usage will silently drop the path argument. |
| `scripts/backfill-insight-mentions.mjs` | 113-122 | `--limit=<negative>` / `--limit=foo` silently coerce to null (no error) | Warning (WR-04) | `--limit=0` gives entire population instead of "zero". |
| `scripts/backfill-insight-mentions.mjs` | (parseArgs loop) | No `else` branch for unknown flags — silently ignored | Warning (WR-06) | `--soure=path.json` typo silently runs against live default. |
| `src/live-logging/ObservationWriter.test.js` | 303-318 | Hardcoded `'mock-ent-2'` as self-loop target — fragile if createMockKmStore seed grows | Info (WR-07) | Not a test correctness failure today; becomes a false-pass risk if the mock is extended. |

**Debt marker gate:** 0 TBD/FIXME/XXX markers in any Phase 58 file. Gate passes.

---

### Human Verification Required

#### 1. Operator live backfill execution (Plan 58-03 Task 3)

**Test:** Execute the operator runbook in 58-03-SUMMARY.md (Task 3 Operator Runbook section):
1. Snapshot general.json
2. Verify km-core hydrate-prefer-JSON patch in place (grep confirmed present 2026-06-15)
3. Add `mentions-classification` processOverride → copilot (CURRENTLY MISSING per 58-03-SUMMARY pre-flight)
4. Dry-run: `node scripts/backfill-insight-mentions.mjs --dry-run`
5. Stop BOTH LOCK holders: `docker-compose -f docker/docker-compose.yml stop coding-services` + `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist`
6. Run live: `node scripts/backfill-insight-mentions.mjs`
7. Verify: `jq '[.edges[]? | select(.attributes.type == "mentions") | .attributes.from] | unique | length' .data/knowledge-graph/exports/general.json` ≥ 86
8. Restore: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist` + `docker-compose -f docker/docker-compose.yml start coding-services`
9. Run final gate: `node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18 --no-recent-only`

**Expected:** jq count ≥ 86; coverage gate exits 0 with `result=PASS`

**Why human:** Requires exclusive LevelDB write access (launchctl bootout + docker stop). Executor cannot hold or release the daemon lock. The mentions-classification copilot processOverride is confirmed NOT installed as of 2026-06-15 — without it, the ~96 LLM calls default to claude-code subprocess routing (~90 min wall-clock vs ~3 min via copilot).

#### 2. CR-01 bridge scope decision

**Test:** Determine whether the bridge `_relinkOrphanOnlineInsights` needs to be patched to find the 74 Insights with entityType='Insight' but ontologyClass='Detail'. Live evidence: `jq '[.nodes[] | select(.attributes.entityType=="Insight" and .attributes.ontologyClass!="Insight")] | length' .data/knowledge-graph/exports/general.json` returns 74.

**Expected:** Either: (a) code patch to bridge to use entityType filter (Option A in 58-REVIEW CR-01), OR (b) documented architectural acceptance that steady-state (new Insights from Phase 58 writer) always get ontologyClass='Insight' and the historical 74 are covered once by the one-shot backfill only.

**Why human:** Requires architectural decision from operator. The one-shot backfill covers the 74 historical Insights, so EDGE-01 SC#1 acceptance is achievable without the bridge fix. But the bridge's D-06.2 self-healing claim is weakened. Decision affects whether CR-01 is a true BLOCKER or an accepted scope gap.

#### 3. REQUIREMENTS.md traceability update

**Test:** After the live backfill confirms EDGE-01 + EDGE-02, update the REQUIREMENTS.md traceability table from "Not started" to "complete" for both EDGE-01 and EDGE-02.

**Expected:** `grep '| EDGE-01 | Phase 58 | Not started |' .planning/REQUIREMENTS.md` returns 0 hits.

**Why human:** Operator must make the editorial decision to mark requirements complete after in-person validation of the live coverage gate.

---

### Gaps Summary

The automated code-level implementation of EDGE-01 (classifier, writer path, backfill script, bridge extension) and EDGE-02 (atomicity contract, integration tests) is complete and all 35 tests pass. The phase goal is mechanically achievable.

**The sole blocking gap is operational:** Plan 58-03 Task 3 (operator-executed live backfill against the 96 production-graph Insights) has not been run. This is expected and documented — the plan explicitly marked Task 3 as a `checkpoint:human-action gate="blocking-human"`. The pre-flight state is fully confirmed:
- km-core hydrate-prefer-JSON patch: PRESENT
- 96 Insights / 0 mentions edges in live export: CONFIRMED
- `mentions-classification` copilot processOverride: NOT installed (operator must add before Task 3 step 5)
- LevelDB LOCK holders: obs-api (PID 62584) + coding-services container (both must be stopped)

**CR-01 (bridge scope drift)** is a WARNING, not a BLOCKER for SC#1: the one-shot backfill covers all 96 Insights including the 74 with ontologyClass='Detail'. The bridge misses those 74 historically but new Insights from the Phase 58 writer will have ontologyClass='Insight' (writer bug fixed in Plan 02). The bridge's gap only matters for future ontologyClass-drift regressions.

**CR-02 (--recent-only sampling bias)** is a WARNING: the canonical SC#1 invocation (`--sample 20 --min 18`) defaults to `--recent-only=true`, which would sample from the 40 most-recent Insights. After the backfill, all 96 should have mentions edges regardless of sampling window, so CR-02 only becomes a BLOCKER if coverage is not actually achieved by the backfill.

---

_Verified: 2026-06-15T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
