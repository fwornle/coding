---
status: partial
phase: 58-online-pipeline-semantic-edges-on-insights
source: [58-VERIFICATION.md]
started: 2026-06-15T18:06:42Z
updated: 2026-06-15T19:32:00Z
---

## Current Test

[awaiting human testing on item 3 only]

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

context: 74 of 100 Insights have `ontologyClass='Detail'` (pre-Phase-58 data condition). The new writer-path correctly sets `ontologyClass='Insight'` on new writes. The 2026-06-15 entityType-drift fix (`fix(58): GREEN — strict entityType filter in loadMentionCandidates`) prevents NEW Insight→Insight noise edges but does not patch the historical 74 ontologyClass='Detail' records.

result: [pending — operator decision]

### 5. REQUIREMENTS.md traceability update

expected: `grep '| EDGE-01 | Phase 58 | Not started |' .planning/REQUIREMENTS.md` returns 0 hits; both EDGE-01 and EDGE-02 marked complete

why_human: Requirements table was not updated as part of any Phase 58 plan or commit. Operator must decide whether to update REQUIREMENTS.md or accept that tracking is done in ROADMAP.md only.

result: [pending]

## Summary

total: 5
passed: 3
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

None blocking — Phase 58's three success criteria (SC#1, SC#2, SC#3) all PASS per the ROADMAP-literal acceptance tests. Outstanding items (4, 5) are operator-decision items, not code defects.
