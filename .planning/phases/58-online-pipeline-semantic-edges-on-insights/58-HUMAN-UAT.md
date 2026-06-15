---
status: complete
phase: 58-online-pipeline-semantic-edges-on-insights
source: [58-VERIFICATION.md]
started: 2026-06-15T18:06:42Z
updated: 2026-06-15T19:38:00Z
---

## Current Test

[all items complete]

## Tests

### 1. SC#1 — Live backfill execution + recent-Insight coverage gate

expected: `node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18` exits 0 with `result=PASS` (the ROADMAP-literal acceptance: "Sampling 20 random *recent* online-learned Insights, at least 18 carry at least one semantic-content relation")

result: **PASS — verified 2026-06-15T19:18Z**

Live-run details (executed 2026-06-15T18:38–18:43Z):

- Snapshot: `.data/knowledge-graph/exports/general.json.pre-58-mentions-20260615T182308Z.bak` (6.6 MB)
- km-core hydrate-prefer-JSON patch: PRESENT
- Routing override correction (runbook had wrong key): the runbook said `mentions-classification` but the proxy keys by `process` literal = `consolidator-mentions` (`PROCESS_LABEL` at `src/live-logging/MentionsClassifier.js:78`). Installed `consolidator-mentions → copilot/claude-haiku-4.5` via PUT to `/api/llm/settings` — direct probe dropped from 6.9s (claude-code fallback) to 1.4s (copilot/haiku). Captured in `memory/feedback_rapid_llm_proxy_override_key.md`.
- Daemon dance: `launchctl bootout com.coding.obs-api` + `docker-compose stop coding-services` (verified `lsof .data/knowledge-graph/level.db/LOCK` showed only Spotlight read-only)
- Live run: 96/96 classified, 303 mentions edges written, 0 errors, durationMs=204150 (~3.4 min wall-clock)
- Daemon restore: `docker-compose start coding-services` (healthy) + `launchctl bootstrap com.coding.obs-api`

**SC#1 acceptance (ROADMAP-literal):** `node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18` → `sample=20 covered=18 threshold=18 result=PASS` ✓

Note: a stricter full-population audit (`--sample 100 --min 90 --no-recent-only`) shows 75/100 covered — below 90%. This is **over-spec**, not what SC#1 requires. The shortfall on historical Insights stems from a known D-02.1 trade-off: ~25 Insight summaries don't name any Component/SubComponent/Detail by token-boundary, and the closed-set hallucination guard correctly returns empty mentions for those rather than fabricating edges. Live-run archive: `58-03-LIVE-BACKFILL-2026-06-15.json`.

### 2. SC#2 — Atomicity contract (concurrent reader)

expected: a concurrent `/api/v1/entities` reader never observes an Insight node without its mentions/has_insight edges (no orphan-Insight intermediate state)

result: **PASS — verified by integration test**

- `src/live-logging/MentionsAtomicity.integration.test.js` Test 2: locks callLog ordering (`putEntity` index < all `mentions` `addRelation` indices < `capturedBy` `addRelation` index)
- Test 3: simulates concurrent reader; asserts no observable orphan-Insight state
- Test 6: `_pushInsightToKG` returns early on classifier error → zero entities + zero edges written (D-04.1)
- 36/36 phase 58 tests pass on `2026-06-15T19:19Z`

### 3. SC#3 — Unified viewer visual check

expected: with Learning Source = Online filter applied in the unified viewer (VKB at http://localhost:8080), online Insights show connected to domain entities via semantic-content edges (`mentions`), not as isolated nodes hanging off LiveLoggingSystem only

result: **PASS — verified by screenshot evidence 2026-06-15T19:28Z**

- Screenshots archived in `screenshots/` (this directory):
  - `58-SC3-01-vkb-baseline.png` — Combined filter, 928 entities, dense graph
  - `58-SC3-02-online-filter.png` — Online filter applied, 60 entities, Insights clustered by edge type
  - `58-SC3-03-online-mentions.png` — Online + Relation Type=mentions, 4 visible Insight↔Component clusters via labeled `mentions` edges (to "rapid-llm-proxy Standalone Package", "System Health Dashboard — Frontend Pages and Service Architecture", "Knowledge Graph API and Working Memory Service", "Knowledge Context Injection — Retrieval Relevance and Deduplication")
- Insight↔domain connectivity is visible via `mentions` (semantic-content), not `capturedBy → LiveLoggingSystem` alone — SC#3 acceptance met

### 4. CR-01 bridge scope decision (pre-existing data condition)

expected: Either (a) `_relinkOrphanOnlineInsights` is patched to use `entityType='Insight'` filter, OR (b) operator documents acceptance that the one-shot backfill covers the 74 historical orphans and the bridge's 22-Insight scope is sufficient for steady-state

result: **PASS — CR-01 invalidated 2026-06-15T19:35Z; no code change needed**

**Re-investigation:** The reviewer's "22 entities" measurement was based on the assumption that `findByOntologyClass(cls)` is a strict ontologyClass filter. It is not — see `lib/km-core/src/store/GraphKMStore.ts:578`:

```ts
if (entity.entityType !== cls && entity.ontologyClass !== cls) continue;
```

That's an OR-gate (matches when `entityType === cls` OR `ontologyClass === cls`). On the live graph (verified 2026-06-15T19:33Z), 100 of 100 entities with `entityType === 'Insight'` pass:

```
entityType=Insight ontologyClass=Detail:  74  ← the "missing" set the reviewer feared
entityType=Insight ontologyClass=Insight: 26  ← the only set the reviewer thought the bridge saw
                                         total: 100
```

All 100 also carry `validUntil === undefined`, so they pass the `isActive` BC short-circuit (`GraphKMStore.ts:566-567`). The bridge `_relinkOrphanOnlineInsights` therefore iterates all 100 Insights every cycle — it does NOT miss the 74 ontologyClass='Detail' historical records.

The 25 Insights that still lack mentions edges after the live backfill are not bridge-scope misses; they're cases where the closed-set classifier correctly returned an empty array (no Component/SubComponent/Detail token-boundary match in the Insight summary — intentional D-02.1 hallucination guard, not a bridge defect).

**Companion fix shipped this session:** the entityType-drift fix in `loadMentionCandidates` (commit `c0459015`) — also discovered while validating CR-01 — does the inverse: it prevents 74 Insights whose ontologyClass got stamped 'Detail' from drifting into the candidate set and being emitted as targets of `mentions` edges. So the FROM side (bridge iteration) was already fine and the TO side (candidate set) is now also strict.

### 5. REQUIREMENTS.md traceability update

expected: `grep '| EDGE-01 | Phase 58 | Not started |' .planning/REQUIREMENTS.md` returns 0 hits; both EDGE-01 and EDGE-02 marked complete

result: **PASS — updated 2026-06-15T19:36Z**

- `EDGE-01` and `EDGE-02` checkboxes flipped from `[ ]` to `[x]` with delivery-date stamp
- Traceability table rows updated: `Phase 58 | Not started` → `Phase 58 | Complete (2026-06-15)`
- Acceptance evidence inline on each requirement bullet

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — Phase 58 closed cleanly. SC#1/SC#2/SC#3 all PASS by ROADMAP-literal acceptance; CR-01 invalidated by re-investigation; REQUIREMENTS.md traceability current.
