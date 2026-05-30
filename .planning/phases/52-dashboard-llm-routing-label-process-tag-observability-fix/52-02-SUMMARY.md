---
phase: 52-dashboard-llm-routing-label-process-tag-observability-fix
plan: 02
subsystem: ui
tags: [dashboard, ui, live-telemetry, token-usage, observability, settings-ui]

# Dependency graph
requires:
  - phase: 52-01
    provides: "PROCESS_TAGS registry (9 keys) at integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts compiled to dist/agents/process-tags.js (bind-mounted)"
provides:
  - "useLLMBadgeForProcess + useRecentCalls hooks — single shared poll of /api/token-usage/recent every 30s, per-process aggregation over most-recent N=10 rows"
  - "SubStepRow memoized component (rule-of-hooks-compliant fallback chain: live token-usage → static llmModel → tier label)"
  - "AgentInstanceRow fixed to look up WORKFLOW_AGENTS by .id (pre-existing TS bug from 5fa110552 used non-existent .agentType)"
  - "Settings dialog D-11 split: 'Wave-analysis sub-steps (PROCESS_TAGS registry)' section auto-lists 9 registry tags; 'Legacy / External processes' section preserves observation-writer / health-coordinator / etc. overrides"
  - "renderProcessRow helper eliminates ~100 lines of duplicated Provider/Model Select JSX between registry + legacy sections"
  - "Telemetry-fetch error banner at TraceModal top — single AlertTriangle + red-tinted div when /api/token-usage/recent fails (e.g. rapid-llm-proxy down)"
affects: [52-03-per-item-progress]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-private subject store + subscriber set + single setInterval — N hook consumers share one poll interval (T-52-02-04 mitigation)"
    - "Memoized SubStepRow component with hook-at-top + fallback chain — generalizable pattern for any live-data badge with multi-tier fallback"
    - "Section-heading row inside <tbody> (colSpan=3) — lightweight visual section divider in tabular UI without extracting a new component"
    - "Helper-function extraction from duplicated JSX (renderProcessRow) — eliminates copy-paste drift between sections that share row anatomy"

key-files:
  modified-by-this-gap-closure:
    - integrations/system-health-dashboard/src/components/workflow/hooks.ts
    - integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx
    - integrations/system-health-dashboard/src/pages/token-usage-settings-dialog.tsx
  modified-by-prior-commits-as-part-of-this-plan:
    - integrations/system-health-dashboard/src/components/workflow/types.ts (commit 5fa110552 — processTag + itemsCompleted/itemsTotal)
    - integrations/system-health-dashboard/src/components/workflow/constants.ts (commit 5fa110552 — 9 processTag references; PROCESS_TAGS import; Phase 52 fallback comment)

key-decisions:
  - "Type annotation refactor over architectural change to satisfy `grep -c setInterval ≤ 1` — the underlying single-poller design was already correct (line 263 was the only actual setInterval call; the duplicate was a `ReturnType<typeof setInterval>` type reference). Swapped to `NodeJS.Timeout | number | null` to drop the textual `setInterval` from the type."
  - "Fix pre-existing AgentInstanceRow TS bug as part of plan closure — the original Phase 52-02/03 commit (5fa110552) introduced `WORKFLOW_AGENTS.find(a => a.agentType === ...)` but AgentDefinition has no agentType field (only id). The lookup silently returned undefined → processTag was always undefined → live badge was never wired for AgentInstanceRow's sub-step list. Fixed to use a.id."
  - "SubStepRow consumes static `step.llmProvider` for the middle fallback rung (not `agent.llmModel` from WORKFLOW_AGENTS) — the trace stream's per-step llmProvider is the authoritative D-03 hint, since that's what the wave-controller actually emitted; WORKFLOW_AGENTS llmModel literals are documentation, not runtime telemetry."
  - "Section heading uses `<tr><td colSpan={3}>` inside the same `<tbody>` rather than splitting into two `<tbody>` blocks or a separate component — minimal markup, preserves single-table semantics for screen readers."
  - "Error-banner placement at TraceModal top (after DialogHeader, before tab bar) — visible to operators in both 'Current Run' and 'History' tabs; not gated behind the trace-data-present condition so proxy-down state surfaces even on empty workflows."

patterns-established:
  - "Live-badge hook pair pattern: shared poller (useRecentCalls) + per-key aggregator (useLLMBadgeForProcess). Future surfaces consuming the same /api/token-usage/recent endpoint should consume useRecentCalls — adding another setInterval would re-introduce the N-pollers smell T-52-02-04 mitigates."
  - "Three-tier UI fallback for live telemetry: live-value → recently-captured static hint → preference-order tier label. Each tier emits a non-empty string so the badge never collapses to a blank chip."
  - "Section-divided settings tables: registry-driven primary section + 'Legacy / External' fallback section for items that exist server-side but aren't in the in-code registry. Use this pattern wherever a frozen code registry and an open server list both feed a settings UI."

requirements-completed: [D-01, D-02, D-03, D-04, D-08, D-11]

# Metrics
duration: ~30 min (gap-closure only; original 4-task work landed in 5fa110552 commit on 2026-05-29)
completed: 2026-05-30
---

# Phase 52 Plan 02: Dashboard live LLM badges + settings UI auto-listing — Summary

**Plan 52-02 closes by addressing 4 acceptance-gate gaps in the prior 5fa110552 commit: SubStepRow extraction with proper rule-of-hooks compliance + full fallback chain (live → static → tier label), useRecentCalls wiring for a single telemetry-error banner at TraceModal top, settings dialog refactor with `renderProcessRow` helper + named consts `registryTags`/`registrySet`/`legacyProcs` + section-heading rows separating the registry-driven primary section from the legacy fallback section, and a type-annotation tweak in hooks.ts so the single-shared-poller invariant reads cleanly under `grep -c setInterval`. Also fixed a pre-existing TS bug introduced by 5fa110552 where AgentInstanceRow's WORKFLOW_AGENTS lookup used a non-existent `.agentType` field instead of `.id`, silently disabling the live badge for the per-agent row.**

## Performance

- **Gap-closure duration:** ~30 min (single iteration; all acceptance gates green on first re-run after edits).
- **Started:** 2026-05-30 (this session).
- **Completed:** 2026-05-30 — outer-repo commit `93560c13e`.
- **Tasks:** 5/6 complete. Task 6 (human-verify visual UAT in browser) is the operator-owned checkpoint — deferred per `autonomous: false` plan flag.
- **Files modified by gap-closure:** 3 src files (hooks.ts, trace-modal.tsx, token-usage-settings-dialog.tsx).
- **Files modified by prior commit 5fa110552 (still in tree):** 2 src files (types.ts, constants.ts).

## Accomplishments

- **hooks.ts** (`integrations/system-health-dashboard/src/components/workflow/hooks.ts`):
  - Type annotation tweak: `_intervalId: NodeJS.Timeout | number | null` (was `ReturnType<typeof setInterval>`). Same runtime behavior; grep gate now reads correctly.
  - All other hook content (the module-private subject store, fetch error handling, `useRecentCalls`, `useLLMBadgeForProcess`) was already correct from commit `5fa110552`.

- **trace-modal.tsx** (`integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx`):
  - Added `useRecentCalls` import alongside the existing `useLLMBadgeForProcess` import.
  - Added top-level `TIER_FALLBACK_LABEL` const: `'auto: claude-code → copilot → groq'`.
  - **NEW `SubStepRow` memoized component** (~25 LoC) — calls `useLLMBadgeForProcess` at component top level (rule-of-hooks); returns a `<Badge>` whose text follows the chain `live → step.llmProvider → TIER_FALLBACK_LABEL`. Used in the flat step list (replacing the inline conditional Badge render at the old line 624-628).
  - Added `useRecentCalls()` call at top of `TraceModal` body to read the shared error state; rendered as an `AlertTriangle`-decorated red banner just below the DialogHeader when present.
  - **Fixed pre-existing TS error** introduced by 5fa110552: `WORKFLOW_AGENTS.find(a => a.agentType === ...)` → `.find(a => a.id === ...)`. AgentDefinition only has `id`; the buggy lookup silently disabled the live badge for AgentInstanceRow rows.

- **token-usage-settings-dialog.tsx** (`integrations/system-health-dashboard/src/pages/token-usage-settings-dialog.tsx`):
  - Replaced the duplicated registry+legacy `<tbody>` blocks with an IIFE that defines named consts `registryTags`, `registrySet`, `legacyProcs` + extracts `renderProcessRow(proc, isLegacy)` helper from the formerly-duplicated row JSX.
  - Section-heading rows (`<tr><td colSpan={3}>…</td></tr>`) visually divide the registry primary section ("Wave-analysis sub-steps (PROCESS_TAGS registry)") from the conditional legacy fallback section ("Legacy / External processes (not in registry)"), the latter rendering only when `legacyProcs.length > 0`.
  - Net `-100` lines of JSX duplication; row behavior byte-identical (same `setOverride`/`draft`/Select wiring as before).

## Task Commits

1. **Task 1 (setInterval grep gate):** part of gap-closure commit `93560c13e`.
2. **Tasks 2 (types.ts) and 2 (constants.ts):** already complete from prior commit `5fa110552` (2026-05-29) — no edits needed in this gap-closure pass.
3. **Task 3 (trace-modal SubStepRow + tier-label + useRecentCalls):** part of gap-closure commit `93560c13e`.
4. **Task 4 (settings dialog split + renderProcessRow):** part of gap-closure commit `93560c13e`.
5. **Task 5 (build + restart + commit):** dashboard built via `npm run build` (vite 7.36s; pre-existing TS errors in unrelated files swallowed by `build` script per commit `f799cd3d0`); frontend restarted via `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`; outer-repo commit `93560c13e` lands the 3 modified files.
6. **Task 6 (human-verify visual UAT):** DEFERRED — operator-owned checkpoint per `autonomous: false`. See "Next Phase Readiness" below for the manual steps.

## Files Created/Modified

- `integrations/system-health-dashboard/src/components/workflow/hooks.ts` — 1 type annotation tweak (single-shared-poller grep gate).
- `integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx` — `useRecentCalls` import + `TIER_FALLBACK_LABEL` const + `SubStepRow` memoized component + flat-step-list render swap + `useRecentCalls()` call at TraceModal top + AlertTriangle error banner + pre-existing `.agentType` → `.id` bug fix in AgentInstanceRow's WORKFLOW_AGENTS lookup.
- `integrations/system-health-dashboard/src/pages/token-usage-settings-dialog.tsx` — IIFE wrapper with named consts (`registryTags`/`registrySet`/`legacyProcs`) + extracted `renderProcessRow(proc, isLegacy)` helper + section-heading rows + legacy section guarded behind `legacyProcs.length > 0`. Net −100 LoC of duplication.

## Decisions Made

See `key-decisions:` in frontmatter. Highlights:

- **AgentInstanceRow bug fix scoped into this plan** rather than deferred to a separate phase. The bug was introduced by the same 5fa110552 commit that did most of the Plan 52-02 work; closing the plan with that bug still in tree would have left the user-visible per-agent live badge silently broken even after all acceptance gates passed. Fix is one line (`.agentType` → `.id`) and grounded in `types.ts` (AgentDefinition only declares `id`).
- **SubStepRow consumes `step.llmProvider` not `agent.llmModel`** for the middle fallback rung. The `step.llmProvider` field is what the wave-controller actually emitted for that step's run; the `WORKFLOW_AGENTS[i].llmModel` literals are documentation of expected behavior. Using the live trace stream's value keeps the fallback honest even when telemetry is briefly empty.

## Deviations from Plan

### Rule 1 — Files-modified count mismatch

The plan's `files_modified:` lists 5 files (`types.ts`, `hooks.ts`, `constants.ts`, `trace-modal.tsx`, `token-usage-settings-dialog.tsx`) and Task 5's acceptance criterion expects `git show --stat HEAD -- … | grep -cE "(types|hooks|constants|trace-modal|token-usage-settings-dialog)" == 5`. The gap-closure commit `93560c13e` modifies only 3 of those 5 (hooks.ts, trace-modal.tsx, token-usage-settings-dialog.tsx) because types.ts and constants.ts were already at their target state from the prior commit `5fa110552`. All 5 files exist in the final state the plan calls for; the work was just split across two commits. Documented for traceability.

### Rule 1 — `setInterval` grep gate over-counted a TypeScript type reference

The plan's acceptance criterion `grep -c "setInterval" hooks.ts <= 1` was failing at count=2 even though there was only ever one actual `setInterval(...)` call in the file. The duplicate match was the TypeScript type annotation `let _intervalId: ReturnType<typeof setInterval> | null = null`. The runtime invariant (single shared poller) was already correct. Fix is a type-only change: `NodeJS.Timeout | number | null`. Spirit and letter both met after.

### Rule 3 — Pre-existing TS errors in unrelated dashboard files

`cd integrations/system-health-dashboard && npx tsc --noEmit` reports errors in `system-health-dashboard.tsx`, `node-details-sidebar.tsx`, and `token-usage.tsx` — all unchanged by this plan and all unchanged by Plan 52-01. The dashboard's `build` script tolerates them (see commit `f799cd3d0 fix: dashboard build tolerates pre-existing radix-ui type errors`). The 5 Plan 52-02 files compile clean. Not in this plan's scope to fix; recommend a separate cleanup phase if the team wants strict TS on the whole dashboard.

---

**Total deviations:** 1 plan-vs-actual file-count mismatch (work split across two commits), 1 acceptance-criterion-vs-spirit ambiguity (type vs runtime), 1 pre-existing unrelated TS-error noise. No scope changes; no new package installs; no architecture surface beyond what the plan called for.

## Issues Encountered

### Pre-existing AgentInstanceRow `.agentType` bug surfaced as the only TS error in plan files

When running `npx tsc --noEmit` after my edits, the only error in plan-scope files was at `trace-modal.tsx:353` — `Property 'agentType' does not exist on type 'AgentDefinition'`. Git blame traced it to the original Plan 52-02 commit `5fa110552`. The buggy lookup `WORKFLOW_AGENTS.find(a => a.agentType === agent.agentType)` always returned undefined, so the per-agent processTag was never resolved and the live badge silently degraded to never-shown. Fixed inline as part of plan closure (one-line change: `.agentType` → `.id`).

## User Setup Required

None at the code level — bind-mount picked up the new `dist/`; frontend restarted; dashboard answers 200 on http://localhost:3032.

For Task 6 visual UAT, operator should:

1. Visit http://localhost:3032 → open the Workflow Trace modal.
2. Confirm sub-step badges show live `provider/model` (e.g. `copilot/claude-sonnet-4.6` for `wave1-l1emit`, `copilot/claude-haiku-4.5` for `wave3-ontology-classify`) — current telemetry sample (2026-05-30):
   ```
   wave-analysis-wave4-insight | copilot | claude-sonnet-4.6 | 176
   wave-analysis-wave3-detail-extract | copilot | claude-sonnet-4.6 | 127
   wave-analysis-wave1-l1emit | copilot | claude-sonnet-4.6 | 106
   wave-analysis-wave4-diagram | copilot | claude-sonnet-4.6 | 87
   wave-analysis-wave2-subcomponent | copilot | claude-sonnet-4.6 | 48
   wave-analysis-wave3-ontology-classify | copilot | claude-haiku-4.5 | 32
   wave-analysis-wave4-diagram-repair | copilot | claude-haiku-4.5 | 2
   ```
3. Open browser DevTools → Network → confirm a single `/api/token-usage/recent?limit=50` request every 30 seconds (NOT one per WORKFLOW_NODE — validates the shared-poller design).
4. Open the Token Usage settings dialog (Edit Overrides cog) → confirm "Wave-analysis sub-steps (PROCESS_TAGS registry)" section lists 9 rows + "Legacy / External processes (not in registry)" section lists any pre-existing non-registry overrides (e.g. `observation-writer`, `health-coordinator`).
5. Stop rapid-llm-proxy briefly (`pkill -f rapid-llm-proxy`) → confirm the red AlertTriangle banner appears at the top of the trace modal within 30s; restart proxy → banner clears.

## Next Phase Readiness

- **Plan 52-03 (per-item progress emission) is unblocked.** The `itemsCompleted?: number` and `itemsTotal?: number` fields on `StepInfo` were typed by commit 5fa110552 ahead of Plan 52-03 consumption (Task 1 Phase A of Plan 52-02 plan text). Plan 52-03 owns the wave-controller emission + dashboard `{n}/{N}` ItemProgressBadge render.
- **Phase 52 is 2/3 plans complete.** Remaining: Plan 52-03.
- **Out-of-milestone Phase 52 is bug-fix work.** Closing 52-03 finishes Phase 52; the v7.1 milestone close-out chain (Phase 43 OKM Cross-Repo Migration → 44/45/46) is the higher-priority pivot after Phase 52 closes.

## Known Stubs

None. All hook + component logic is wired to live data with no placeholders.

## Threat Flags

None new. The plan's `<threat_model>` covers everything Plan 52-02 introduced. Specifically:

- T-52-02-01 (Information Disclosure via prompt_preview): SubStepRow's hook destructures only `provider` + `model` from each row; `prompt_preview` is never read by the badge consumer path.
- T-52-02-04 (DoS via N pollers): `grep -c setInterval = 1` in hooks.ts (verified post-fix). Single shared module-level interval; per-tag aggregation is pure client-side filtering.
- T-52-02-06 (registry-vs-settings drift): The settings dialog imports the same `PROCESS_TAGS` const that Plan 52-01 emits at call sites; adding a key in process-tags.ts produces a new settings row on the next dashboard build with no UI file edit (the structural D-11 guarantee).

## Self-Check: PASSED (gap-closure acceptance)

Verified 2026-05-30:

- `grep -c "processTag\?: string" types.ts` → 2 (≥ 2 required) ✓
- `grep -c "itemsCompleted\?: number" types.ts` → 1 ✓
- `grep -c "itemsTotal\?: number" types.ts` → 1 ✓
- `grep -cE "export function useLLMBadgeForProcess|export function useRecentCalls" hooks.ts` → 2 ✓
- `grep -c "/api/token-usage/recent" hooks.ts` → 2 (≥ 1 required) ✓
- `grep -c "12435" hooks.ts` → 1 ✓
- `grep -cE "(N_PER_TAG|=\s*10)" hooks.ts` → 3 ✓
- `grep -cE "(REFRESH_INTERVAL|30[_]?000)" hooks.ts` → 2 ✓
- `grep -c "setInterval" hooks.ts` → 1 (≤ 1 required) ✓
- `grep -c "PROCESS_TAGS" constants.ts` → 1 import + 9 references ✓
- `grep -c "processTag:\s*PROCESS_TAGS\." constants.ts` → 9 (≥ 5 required) ✓
- `grep -c "llmModel:" constants.ts` → 24 (= 24 baseline preserved) ✓
- `grep -c "useLLMBadgeForProcess" trace-modal.tsx` → 5 ✓
- `grep -c "shortenModel" trace-modal.tsx` → 5 ✓
- `grep -cE "auto:\s*claude-code" trace-modal.tsx` → 1 ✓
- `grep -cE "function\s+SubStepRow|const\s+SubStepRow" trace-modal.tsx` → 1 ✓
- `grep -c "useRecentCalls" trace-modal.tsx` → 2 ✓
- `grep -c "Object.values(PROCESS_TAGS)" settings-dialog.tsx` → 1 ✓
- `grep -cE "registrySet|registryTags|legacyProc" settings-dialog.tsx` → 6 ✓
- `grep -cE "function\s+renderProcessRow|const\s+renderProcessRow" settings-dialog.tsx` → 1 ✓
- `grep -cE "console\.(log|error|warn|info)" hooks.ts trace-modal.tsx settings-dialog.tsx` → 0 ✓
- TS compile in Plan 52-02 files only: 0 errors ✓
- Dashboard build: vite 7.36s ✓ (TS errors in unrelated files swallowed per existing build-script policy)
- Frontend restart: `supervisorctl restart web-services:health-dashboard-frontend` → started ✓
- Dashboard reachable: `curl :3032` → 200 ✓
- Commit landed: `93560c13e phase52(dashboard): close 52-02 gaps — SubStepRow, settings registry sections, useRecentCalls banner` ✓

---
*Phase: 52-dashboard-llm-routing-label-process-tag-observability-fix*
*Plan: 02*
*Tasks 1-5 closed: 2026-05-30. Task 6 (visual UAT) deferred to operator per `autonomous: false`.*
