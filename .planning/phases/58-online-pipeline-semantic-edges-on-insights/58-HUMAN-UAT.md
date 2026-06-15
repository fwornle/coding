---
status: partial
phase: 58-online-pipeline-semantic-edges-on-insights
source: [58-VERIFICATION.md]
started: 2026-06-15T18:06:42Z
updated: 2026-06-15T18:46:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live backfill execution (Plan 58-03 Task 3)
expected: `node scripts/check-insight-mentions-coverage.mjs --sample 96 --min 86 --no-recent-only` exits 0 with `result=PASS`; `jq` count of unique-Insight mentions edges in `.data/knowledge-graph/exports/general.json` ≥ 86

result: **executed 2026-06-15T18:38–18:43Z — script PASSED, SC#1 FAILED**

- Snapshot: `.data/knowledge-graph/exports/general.json.pre-58-mentions-20260615T182308Z.bak` (6.6 MB)
- km-core hydrate-prefer-JSON patch: PRESENT (1 grep hit, confirmed pre-run)
- Pre-flight processOverride: **runbook said `mentions-classification` was wrong key** — actual `process` field MentionsClassifier sends is `consolidator-mentions` (see `PROCESS_LABEL` at `src/live-logging/MentionsClassifier.js:78`). Installed `consolidator-mentions → copilot/claude-haiku-4.5` via PUT to `/api/llm/settings`. Verified direct proxy probe dropped from 6.9s (claude-code fallback) to 1.4s (copilot/haiku). With the wrong key, dry-run `--limit=3` hit 33% timeouts in 134s.
- Dry-run cross-check (post-fix): `--limit=3` → 8s wall-clock, 0 errors
- Daemon dance: `launchctl bootout com.coding.obs-api` (PID 62584 → none) + `docker-compose stop coding-services` (verified `lsof .data/knowledge-graph/level.db/LOCK` showed only Spotlight read-only)
- **Live run:** 96/96 classified, 303 mentions edges written, 0 errors, durationMs=204150 (~3.4 min wall-clock) — matches SUMMARY projection
- Daemon restore: `docker-compose start coding-services` (healthy) + `launchctl bootstrap com.coding.obs-api` (PID 33965) — `curl http://localhost:3033/api/health` → `{"status":"success"}`
- **SC#1 result:** `node scripts/check-insight-mentions-coverage.mjs --sample 96 --min 86 --no-recent-only` → `sample=96 covered=59 threshold=86 result=FAIL`
- jq independent verification: `[.edges[] | select(.attributes.type=="mentions") | .attributes.from] | unique | length = 59`

**Root cause of coverage shortfall (not a script bug):** 37 of 96 Insights have summaries that the closed-set hallucination guard correctly rejects every candidate for (no Component/SubComponent/Detail named in the summary text). This is intentional D-02.1 behavior — the alternative would be edge fabrication. SC#1's 86/96 threshold was set under the assumption that most Insights reference components by name; the actual data is 61% (59/96).

**Operator decision needed (W4 — Threshold reconciliation):**
- (a) Accept the 59/96 reality and relax SC#1 to `--min 59` (or document the threshold as aspirational)
- (b) Improve Insight summary generation upstream so more Insights name specific components (out-of-scope for Phase 58)
- (c) Open the closed-set guard (against D-02.1) — NOT recommended; this is the design intent

### 2. CR-01 bridge scope decision
expected: Either (a) `_relinkOrphanOnlineInsights` is patched to use `entityType='Insight'` filter (or union with `findByOntologyClass('Insight')`) so all 96 Insights are reachable, OR (b) operator documents acceptance that the one-shot backfill covers the 74 historical orphans and the bridge's 22-Insight scope is sufficient for steady-state (new Insights written by the Phase 58 `_pushInsightToKG` path always carry `ontologyClass='Insight'`)

why_human: CR-01 is confirmed by live `jq` (22 vs 96). The fix requires either a code change or an architectural acceptance decision. Automated verification cannot determine operator intent.

result: [pending]

### 3. REQUIREMENTS.md traceability update
expected: `grep '| EDGE-01 | Phase 58 | Not started |' .planning/REQUIREMENTS.md` returns 0 hits; both EDGE-01 and EDGE-02 marked complete

why_human: Requirements table was not updated as part of any Phase 58 plan or commit. Operator must decide whether to update REQUIREMENTS.md or accept that tracking is done in ROADMAP.md only.

result: [pending]

## Summary

total: 4
passed: 0
issues: 1
pending: 3
skipped: 0
blocked: 0

## Gaps

### 4. SC#1 threshold over-specified for data (added 2026-06-15 post live-run)
status: failed
expected: covered ≥ 86 / 96
observed: covered = 59 / 96 (61%)
cause: closed-set hallucination guard correctly returns empty mentions for Insight summaries that don't name a Component/SubComponent/Detail by token-boundary match — 37 of 96 such Insights exist in the live data
not_a_bug: writer-path, backfill, and bridge all correctly emit mentions when LLM identifies candidates; mechanism verified by 35/35 tests
remediation_options:
  - relax SC#1 to 59 (data-supported floor)
  - upstream: improve Insight summary generation to name components explicitly
  - NOT recommended: relax D-02.1 closed-set guard (allows hallucinated edges)
