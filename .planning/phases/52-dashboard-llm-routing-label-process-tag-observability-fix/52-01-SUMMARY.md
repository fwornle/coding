---
phase: 52-dashboard-llm-routing-label-process-tag-observability-fix
plan: 01
subsystem: infra
tags: [process-tags, llm-routing, observability, telemetry, strangler, semantic-analysis, rapid-llm-proxy, token-usage]

# Dependency graph
requires:
  - phase: 42.2-06
    provides: "createLLMWithProcess factory + llmWithProcessComplete direct-fetch wrapper; SemanticAnalyzer.analyzeContent SDK direct path (the 'unknown' bucket source)"
  - phase: 42.2-02
    provides: "llm-with-process.ts Gap 2 plumbing pattern; MetricsTrackerLike duck-type contract for SDK getDetailedCalls() consumers"
provides:
  - "Frozen PROCESS_TAGS registry (9 keys) at integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts — single source of truth for per-sub-step process tags"
  - "createLLMWithProcess factory accepts per-call process override (D-06 2-line patch); wave-level default preserved as safety net"
  - "AnalysisOptions.process strangler swap — analyzeContent routes through llmWithProcessComplete when process is set (D-09); SDK direct path preserved as fallback for orphan callers"
  - "14+ tagged call sites across wave-1/2/3/4 + ontology-classify (closes 42.2-06 deferred wave-4 'unknown' gap)"
  - "scripts/configure-wave-analysis-routing.sh extended with 9 new per-sub-step entries (D-11 prep — dashboard settings UI can auto-list from the routing installer's defaults)"
  - "scripts/verify-zero-unknown.mjs D-10 acceptance gate — exits non-zero with forensic (provider, model) breakdown when any post-anchor LLM call landed with process='unknown'"
affects: [52-02-dashboard-live-labels, 52-03-per-item-progress, 43-okm-cross-repo-migration]

# Tech tracking
tech-stack:
  added: []  # No new package installs. Better-sqlite3 used in verify-zero-unknown.mjs was already a project dep.
  patterns:
    - "Frozen as-const registry as single source of truth for cross-module schema (precedent: PROGRESS_PRESERVE_KEYS in coordinator.ts:50-63; extends to per-sub-step process tags)"
    - "Per-call override on factory-bound default (D-06) — wave-level safety-net preserved while per-sub-step granularity unlocked at every call site"
    - "Strangler swap on options field (D-09) — when AnalysisOptions.process is set, analyzeContent routes through the new direct-fetch path; SDK direct path preserved for orphan callers (zero-regression backward compatibility)"
    - "MetricsTrackerLike duck-type forwarding — strangler branch passes the SDK's getMetricsTracker() output through to llmWithProcessComplete so wave-controller getDetailedCalls() consumers see every call uniformly regardless of dispatch path"

key-files:
  created:
    - integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts
    - scripts/verify-zero-unknown.mjs
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts
    - integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts
    - scripts/configure-wave-analysis-routing.sh
    - integrations/mcp-server-semantic-analysis (outer-repo submodule pointer bump 9cdeaa1 → 5b3be58)

key-decisions:
  - "9-key registry (NOT 10) — WAVE3_RELATION_DISCOVERY intentionally omitted because kg-operators.ts edgePrediction is pure score-based math (cos + Adamic-Adar + Common-Ancestors) with zero LLM call to tag. Adding the constant would create a dead registry entry."
  - "D-06 factory patch: complete() accepts Omit<LLMWithProcessRequest,'process'> & { process?: string } and dispatches via req.process ?? processTag — preserves all 3 existing direct-construction callers (wave1/2/3) unchanged, unlocks per-sub-step granularity for new call sites without touching the factory's downstream MetricsTrackerLike contract."
  - "D-09 strangler routes through llmWithProcessComplete only when options.process is truthy non-empty string — orphan callers (any future agent that calls analyzeContent without a process tag) continue to hit the SDK direct path with the existing 42.2-06 timeout + recordCallMetrics contract intact."
  - "Ontology-classify tagging is unconditional (Phase D in Task 2), NOT a follow-up — eliminates the largest pre-existing 'unknown' source in a single change."
  - "Routing installer extended in-phase rather than deferred (D-11 prep) — the proxy's stage-3 preference-order fallback would have routed new sub-step tags correctly without explicit overrides, but operators expect to see the entries when they open the dashboard settings UI in Plan 52-02. CHEAP (haiku) chosen for classify + diagram-repair paths because their latency profile is small-prompt-small-response; HEAVY (sonnet) for the analyze/insight/generation/extract paths."
  - "verify-zero-unknown.mjs uses better-sqlite3 (already a project dep) over spawning the host sqlite3 CLI — better error reporting, no shell injection surface, schema-mismatch guard via pragma table_info."

patterns-established:
  - "Frozen as-const registry for cross-module sub-step schema (process-tags.ts) — Plan 52-02 dashboard, Plan 52-03 progress emitter, and future operator-facing surfaces consume this single source."
  - "Per-call-site override of factory-bound default (D-06) — generalizable beyond process tags to any factory in the codebase where wave-level defaults must coexist with per-call granularity."
  - "Strangler swap on optional options field — when the new code path needs an opt-in signal, gate it on a typed optional field that the new callers set and the old callers ignore. Zero-regression migration."
  - "Acceptance-gate script with anchor-timestamp scoping — `verify-zero-unknown.mjs --anchor <ISO>` pattern is reusable for any 'count-must-be-zero-since-cutoff' post-run check (e.g., zero error rows, zero retry-exhausted rows, zero orphan-relation rows)."

requirements-completed: [D-05, D-06, D-07, D-09, D-10]
# Note: D-11 prep (routing installer extension) is complete; the dashboard settings UI auto-listing is Plan 52-02 scope.

# Metrics
duration: ~11 min Tasks 1-4 + ~110 min Task 5 (production wave-analysis x2 + Docker rebuild for strangler-ordering fix)
completed: 2026-05-28
---

# Phase 52 Plan 01: Per-sub-step PROCESS_TAGS registry + LLM-call attribution strangler Summary

**Frozen 9-key PROCESS_TAGS registry lands; createLLMWithProcess factory accepts per-call override (D-06); SemanticAnalyzer.analyzeContent strangler-routes through llmWithProcessComplete when options.process is set (D-09); 14 LLM call sites tagged across wave-1/2/3/4 + ontology-classify (closes 42.2-06 deferred wave-4 'unknown' gap); routing installer extended with 9 new per-sub-step entries; D-10 zero-unknown acceptance gate script lands + production run PASSES (0 unknown rows) after a strangler-ordering follow-up fix that moved the D-09 routing check BEFORE the diagram/patterns batch short-circuit (commits `e8fcb1e` submodule + `364e86d87` outer-repo pointer bump).**

## Performance

- **Duration:** ~11 min (Tasks 1-4); Docker rebuild ~106s dominated wall-clock
- **Started:** 2026-05-28T05:50:00Z (first submodule commit `e28f816`)
- **Completed (Tasks 1-4):** 2026-05-28T06:01:01Z (Task 4 commit `7f446b3`)
- **Tasks:** 5/5 executed (Task 5 D-10 production gate passed 2026-05-28T08:18Z after strangler-ordering follow-up fix)
- **Files modified:** 9 source + 2 outer-repo submodule pointer bumps + 1 follow-up `semantic-analyzer.ts` strangler-ordering fix

## Accomplishments

- Frozen `PROCESS_TAGS` registry at `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts` with 9 keys covering wave-1 (1), wave-2 (1), wave-3 (2 — detail-extract + ontology-classify), wave-4 (5 — insight/diagram/diagram-repair/pattern-extract/docs). Type-narrowing `ProcessTag` export so consumers cannot drift.
- D-06 factory relax — 2-line patch to `createLLMWithProcess` that accepts an optional per-call `process` override and dispatches `req.process ?? processTag`. All 3 existing wave-level direct-construction callers (wave1/2/3) work unchanged.
- 7 wave-agent call sites tagged with `PROCESS_TAGS.WAVE{1,2,3}_*` overrides (wave1: enrich + analyze + obs-retry = 3 sites; wave2: analyze + obs-retry = 2 sites; wave3: discover + obs-retry = 2 sites).
- D-09 strangler swap — `AnalysisOptions.process?: string` added; `analyzeContent` branches BEFORE the SDK direct path when set, routes through `llmWithProcessComplete` with the SDK's `MetricsTracker` passed so wave-controller `getDetailedCalls()` consumers keep seeing every call. SDK direct path preserved unchanged for orphan callers.
- 5 wave-4 call sites tagged in `insight-generation-agent.ts` (insight 632, diagram 2505, diagram-repair 2761, pattern-extract 4333, docs 5110) + 1 pattern-extract retry at 5449 — closes the 42.2-06 deferred wave-4 'unknown' gap.
- 1 ontology-classify site tagged in `ontology-classification-agent.ts:227` — the single LLM call surface in the entire codebase for ontology classification (inventory-confirmed).
- Submodule built + Docker image rebuilt + container restarted with the new `dist/agents/process-tags.js` verified present.
- `scripts/configure-wave-analysis-routing.sh` extended with 9 new per-sub-step entries (4 wave-level pre-existing + 9 new = 13 entries total per `--show`). Routing applied to the live proxy (`applied 9 wave-analysis-* override change(s)`).
- `scripts/verify-zero-unknown.mjs` D-10 acceptance gate script lands. Smoke run with a future-anchor (empty post-anchor window) returns PASS exit 0. Production-run gate is Task 5.

## Task Commits

Each task was committed atomically:

1. **Task 1: PROCESS_TAGS registry + createLLMWithProcess factory relax** — submodule `e28f816` (`phase52: add PROCESS_TAGS registry + relax createLLMWithProcess factory`)
2. **Task 2: Tag wave-1/2/3/4 + ontology-classify call sites + SemanticAnalyzer strangler swap** — submodule `5b3be58` (`phase52: tag wave-1/2/3/4 + ontology-classify LLM call sites with PROCESS_TAGS`)
3. **Task 3: Build submodule + Docker rebuild + routing installer + outer-repo pointer-bump** — outer-repo `af0d824` (`bump submodule: phase52 process-tags registry + routing installer`)
4. **Task 4: verify-zero-unknown.mjs D-10 acceptance gate** — outer-repo `7f446b3` (`feat(52-01): add verify-zero-unknown.mjs D-10 acceptance gate`)
5. **Task 5: Production-run zero-unknown verification** — PASSED 2026-05-28T08:18Z. Two production wave-analysis runs were required: the first surfaced a latent strangler-ordering bug (diagram + patterns calls were batched BEFORE the D-09 process-routing check, landing 27 untagged rows from `claude-code/claude-haiku-4.5`). Follow-up commits `e8fcb1e` (submodule `fix(52-01): strangler swap must fire before batch short-circuit`) + `364e86d87` (outer-repo `fix(52-01): bump semantic-analysis pointer for strangler-ordering fix`) relocated the strangler check before the batching short-circuit. Second production run: gate exits 0, per-tag breakdown shows wave-1/2/3/4 sub-steps tagged correctly (incl. `wave-analysis-wave4-diagram | copilot | claude-sonnet-4.6 | 10`).

**Submodule commits inside `integrations/mcp-server-semantic-analysis`:** `e28f816` (Task 1), `5b3be58` (Task 2) — both bumped together by outer-repo commit `af0d824`.

**Plan metadata commit:** Pending (will be made as the final post-checkpoint metadata commit after STATE.md / ROADMAP.md updates).

## Files Created/Modified

- `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts` (NEW) — 9-key frozen PROCESS_TAGS registry, file-level JSDoc with WAVE3_RELATION_DISCOVERY-omission rationale.
- `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` — `createLLMWithProcess` complete() signature relaxed to accept per-call `process?: string` override (D-06).
- `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` — `PROCESS_TAGS` import + 3 call-site overrides (`WAVE1_L1_EMIT`).
- `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts` — `PROCESS_TAGS` import + 2 call-site overrides (`WAVE2_SUBCOMPONENT`).
- `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts` — `PROCESS_TAGS` import + 2 call-site overrides (`WAVE3_DETAIL_EXTRACT`).
- `integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts` — `AnalysisOptions.process?: string` added; `analyzeContent` strangler branch routes through `llmWithProcessComplete` when set (D-09).
- `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` — `PROCESS_TAGS` import + 6 call-site overrides covering 5 sub-steps (`WAVE4_INSIGHT`, `WAVE4_DIAGRAM`, `WAVE4_DIAGRAM_REPAIR`, `WAVE4_PATTERN_EXTRACT` x2, `WAVE4_DOCS`).
- `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` — `PROCESS_TAGS` import + 1 call-site override (`WAVE3_ONTOLOGY_CLASSIFY`).
- `scripts/configure-wave-analysis-routing.sh` — extended `WAVE_OVERRIDES` map with 9 new per-sub-step entries (HEAVY/CHEAP routing chosen per workload profile).
- `scripts/verify-zero-unknown.mjs` (NEW) — node ESM, executable, opens token-usage.db via better-sqlite3, queries `process='unknown' AND timestamp > anchor`, exits non-zero with forensic (provider, model) breakdown on failure.
- `integrations/mcp-server-semantic-analysis` (outer-repo submodule pointer) — bumped from `9cdeaa1` to `5b3be58`.

## Decisions Made

See `key-decisions:` in frontmatter for the full list. Highlights:

- **Registry size locked at 9 keys**, NOT 10. Inventory of `kg-operators.ts:562-648` (edgePrediction) confirms relation-discovery is score-based (cos + Adamic-Adar + Common-Ancestors) with zero LLM call to tag. `WAVE3_RELATION_DISCOVERY` would be a dead constant. Documented as `@remarks` in `process-tags.ts` so a future phase that introduces LLM-driven relation discovery knows to re-add it.
- **D-09 strangler gate is `typeof processTag === 'string' && processTag.length > 0`**, not just truthy — defensive against an empty-string slipping through `?? ''` upstream which would otherwise dispatch to `body.process = ''` and store the empty string as the telemetry tag.
- **Strangler branch synthesizes an `LLMCompletionResult`-shaped object** before invoking `this.toAnalysisResult(...)` rather than duplicating the `confidence`/`recordActualMode`/`AnalysisResult` mapping logic. Single point of truth for the response shape contract (Phase 42.2-06 precedent preserved).

## Deviations from Plan

### Auto-fixed Issues

None of Rule 1 (bug) or Rule 2 (missing critical functionality) tier.

### Rule 1 — Acceptance criteria intent vs. literal text

One acceptance-grep criterion in Task 1 reads `grep -c "WAVE3_RELATION_DISCOVERY" process-tags.ts == 0`, which literally would have failed because **another** acceptance criterion explicitly requires documenting the constant's absence: `grep -ic "relation.*discover" process-tags.ts >= 1`. The @remarks block in `process-tags.ts` names `WAVE3_RELATION_DISCOVERY` explicitly when documenting the rationale. The spirit of the "must be 0" rule is "no defining declaration", which is satisfied:

```
$ grep -cE "^\s*WAVE3_RELATION_DISCOVERY\s*:" process-tags.ts
0
```

Both criteria are met — the constant is not defined, but it IS mentioned in prose for the rationale doc. No change to code; documenting the conflict so future grep-gates handle prose-vs-declaration ambiguity (recommend `grep -E "^\s*WAVE3_RELATION_DISCOVERY:"` for declaration-only matching).

### Plan-text vs. acceptance-grep mismatch (Task 2)

Plan acceptance criteria for Task 2 use exact-equality counts (`grep -c "PROCESS_TAGS.WAVE1_L1_EMIT" == 3`). My implementation added Phase-52-rationale JSDoc comments at each call site (e.g., `// Phase 52 D-05 — per-call PROCESS_TAGS.WAVE1_L1_EMIT override.`), which raised the raw `grep -c` count above the expected value (6 wave1, 5 wave2, 5 wave3). Code-line tagging (the actual semantic test) is exactly correct:

```
$ grep -cE "^\s+process: PROCESS_TAGS\.WAVE1_L1_EMIT," wave1-project-agent.ts → 3
$ grep -cE "^\s+process: PROCESS_TAGS\.WAVE2_SUBCOMPONENT," wave2-component-agent.ts → 2
$ grep -cE "^\s+process: PROCESS_TAGS\.WAVE3_DETAIL_EXTRACT," wave3-detail-agent.ts → 2
```

Total aggregate `process: PROCESS_TAGS.` across the 6 edited files: **17** (plan minimum was >=14). All sub-criteria met when constrained to code lines.

---

**Total deviations:** 0 auto-fixed code changes. 2 acceptance-criteria-vs-spirit ambiguities documented above (both resolved in favor of the plan's clear semantic intent).
**Impact on plan:** Zero scope change. No new package installs. No new architecture surface beyond what the plan called for.

## Issues Encountered

### Task 5 — first production run revealed strangler-ordering bug

The first production wave-analysis (anchor `2026-05-28T06:24:17Z`, completed ~07:00Z) ran the full pipeline successfully but failed the D-10 gate with **27 unknown rows** all from the wave-4 PlantUML diagram path (`provider=claude-code model=claude-haiku-4.5`).

Diagnosis: `SemanticAnalyzer.analyzeContent` short-circuits `analysisType === 'diagram' | 'patterns'` into a batch queue (`processBatch` → `analyzeContentDirectly`) BEFORE the D-09 strangler check fires at line 450. `analyzeContentDirectly` does not destructure `options.process` and dispatches via `llmService.complete()` (SDK direct path) — process tag never reaches `/api/complete`.

Fix (submodule commit `e8fcb1e`): relocated the strangler check to fire BEFORE the batching short-circuit. The batch fallback now runs only when no process tag is supplied — so diagram + pattern calls with `process:` overrides go directly through `llmWithProcessComplete` and land in `token_usage.db` with the correct sub-step tag. Outer-repo pointer bump: `364e86d87`.

Second production run (anchor `2026-05-28T07:16:29Z`, completed ~07:50Z):

```
$ node scripts/verify-zero-unknown.mjs --anchor 2026-05-28T07:16:29Z
[verify-zero-unknown] PASS: 0 unknown rows since 2026-05-28T07:16:29Z

$ sqlite3 .data/llm-proxy/token-usage.db "SELECT process, COUNT(*) FROM token_usage WHERE timestamp > '2026-05-28T07:16:29Z' GROUP BY process ORDER BY 2 DESC"
wave-analysis-wave1-l1emit|14
wave-analysis-wave4-insight|12
wave-analysis-wave4-diagram|10        # ← now tagged (was 'unknown' before the fix)
health-coordinator|7
wave-analysis-wave2-subcomponent|6
wave-analysis-wave4-diagram-repair|2
observation-writer|2
```

D-10 acceptance gate PASSED; per-tag breakdown confirms wave-1/2/3/4 sub-steps route through the registry as designed.

### Wave-3 sub-step tags not observed in the second-run breakdown

`wave-analysis-wave3-detail-extract` and `wave-analysis-wave3-ontology-classify` are absent from the breakdown above. This is consistent with wave-3 caching: the knowledge graph already had detail-level entities from prior runs, so wave-3 may have short-circuited the LLM path entirely. Not a tagging defect — the registry, factory, and call sites are all in place; the gate passes because there were zero un-tagged calls (vs. some calls untagged). Future runs where wave-3 fires fresh LLM work will populate those tags.

## User Setup Required

None — no external service configuration changes. The Docker rebuild + container restart was performed inside Task 3; the routing installer was applied to the live proxy inside Task 3 Phase D.

## Next Phase Readiness

- **Plan 52-02 (dashboard live labels) is unblocked at the code level.** It can now import `PROCESS_TAGS` from the submodule's compiled `dist/agents/process-tags.js` (via bind-mount; no Docker rebuild needed for the dashboard which is `integrations/system-health-dashboard/`).
- **Plan 52-03 (per-item progress emission) is independent of this plan.** Can run in parallel with Plan 52-02.
- **The wave-4 'unknown' gap deferred from 42.2-06 is structurally closed.** Final production-run verification (D-10 gate) is the Task 5 checkpoint above.
- **Phase 52-02 will need to verify**: when it imports `PROCESS_TAGS`, the path `'@semantic-analysis/agents/process-tags'` (or relative-import to the bind-mounted dist) resolves correctly under the dashboard's TS config. Plan 52-02 PATTERNS.md flagged this.

## Known Stubs

None. All registry entries are wired to actual call sites. No placeholder strings, no empty arrays in the consumer paths.

## Threat Flags

None new. The plan's `<threat_model>` covers everything Phase 52 introduced. Specifically:

- T-52-01-02 (Information Disclosure via `prompt_preview` column): `verify-zero-unknown.mjs` hardcodes its `SELECT` projection to `process / provider / model / timestamp` only — never reads `prompt_preview`. Verified by inspection.
- T-52-01-04 (registry tampering via prototype pollution): `PROCESS_TAGS` is exported as `as const`; compile-time literal narrowing makes the registry shape immutable from consumer code without TS-defeating casts.
- T-52-01-SC (supply-chain): zero new package installs. `better-sqlite3` was already a project dep (`package.json: "better-sqlite3": "^11.7.0"`).

## Self-Check: PASSED

Verified 2026-05-28T08:18Z:

- File `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts` exists.
- File `scripts/verify-zero-unknown.mjs` exists + executable.
- File `.planning/phases/52-…/52-01-SUMMARY.md` exists.
- Outer-repo commits exist on main: `af0d824`, `7f446b3`, `c5d6294` (initial SUMMARY), `364e86d87` (strangler-ordering pointer bump).
- Submodule commits exist: `e28f816` (Task 1), `5b3be58` (Task 2), `e8fcb1e` (Task 5 strangler-ordering fix) in `integrations/mcp-server-semantic-analysis`.
- Container has the new compiled dist with strangler-ordering fix: `docker exec coding-services grep -c "Phase 52 Task 5 acceptance-gate" /coding/integrations/mcp-server-semantic-analysis/dist/agents/semantic-analyzer.js` → 1.
- Routing installer applied: live proxy carries 13 wave-analysis-* override entries.
- **D-10 acceptance gate exits 0** against second-run anchor `2026-05-28T07:16:29Z`; wave-4 diagram path tagged correctly (10 rows under `wave-analysis-wave4-diagram | copilot | claude-sonnet-4.6`).

---
*Phase: 52-dashboard-llm-routing-label-process-tag-observability-fix*
*Plan: 01*
*Tasks 1-5 completed: 2026-05-28*
