---
phase: 84-per-turn-context-revelation
plan: 08
subsystem: dashboard-explainer
tags: [context-turns, redux-thunk, cache-explainer, wire-discriminator, honest-measurement, N/A-cache-write, dashboard-ui, wave-3]

# Dependency graph
requires:
  - "84-04 — proxy appends per-request context-turns.jsonl lines (wire discriminator, usage split, OpenAI cache_write:null)"
  - "84-07 — vkb-server handleContextTurns read route (GET /api/experiments/runs/:taskId/context-turns) + dashboard proxy mirror"
provides:
  - "fetchContextTurns(taskId) thunk + contextTurnsByTaskId state + fulfilled reducer + selectContextTurnsFor selector in performanceSlice.ts (mirrors fetchTimeline)"
  - "ContextTurnRow + ContextTurnMessage TS types matching the proxy line shape"
  - "context-cache-explainer.tsx: summarize() prefers real per-request wire values; per-turn honest cache split; OpenAI-wire cache-write rendered as 'N/A (provider reports no cache-creation)' (D-12); 'how prompt caching actually works' copy"
affects: [84-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Redux read seam cloned verbatim from fetchTimeline (thunk + state field + fulfilled reducer + per-taskId selector factory) — no new store surface invented"
    - "Wire-discriminated honest render: cache_write === null (OpenAI wire) → N/A string, never 0 or an inferred value; a run with ANY Anthropic-wire turn keeps the real aggregate"

key-files:
  created: []
  modified:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx

key-decisions:
  - "ContextTurnRow.usage.cache_write is typed number|null (not number) so the OpenAI wire's null propagates through the type system to the N/A render — the type IS the honesty guard (D-12)."
  - "summarize() takes an optional contextTurns arg and PREFERS it over the timeline: when context-turns exist, per-turn read/write/input/output come from the real usage-reported wire counts (not the timeline's ~bytes/4 estimate); it falls back to the timeline path for runs with no captured context-turns. turnCount/verdict/biggest-turn/chart/stat-cards all switch to real wire values automatically."
  - "OpenAI-wire cache-write honesty is enforced at TWO levels: per-turn (writeNA flag → the exact N/A string in the per-turn table) and run-aggregate (writeIsNA = pure-OpenAI-wire run → the Cache-write stat card shows N/A instead of a summed 0). A run with any Anthropic-wire turn keeps the real number."
  - "No new components (D-11): the per-turn honest table + the caching-explainer copy block were added INLINE inside the existing context-cache-explainer.tsx. Richer per-turn views remain deferred to Phase 86."
  - "The exact D-12 string 'N/A (provider reports no cache-creation)' is hoisted to a single const CACHE_WRITE_NA and reused, so the wording can never drift between the per-turn table, the stat card, and the copy."

requirements-completed: []

# Metrics
duration: 55min
completed: 2026-07-08
---

# Phase 84 Plan 08: Honest Per-Turn Cache Explainer (wire data + N/A + caching copy) Summary

**The existing context-cache-explainer now consumes the real per-request context-turns (D-11/D-12): a `fetchContextTurns` thunk + `selectContextTurnsFor` selector mirror `fetchTimeline`, `summarize()` prefers the honest usage-reported wire values over the timeline's ~bytes/4 estimate, OpenAI-wire cache-write renders as the exact string "N/A (provider reports no cache-creation)" (never 0 or an inferred value) at both per-turn and run-aggregate levels, and a "how prompt caching actually works" copy block explains the Anthropic-wire (has a cache-creation counter) vs OpenAI-wire (cache reads only) asymmetry. No new components — the explainer was extended in place.**

## Performance

- **Duration:** ~55 min (incl. deploy + gsd-browser visual verification)
- **Completed:** 2026-07-08
- **Tasks:** 3 (2 autonomous + 1 human-verify checkpoint, APPROVED)
- **Files modified:** 2 (both in-repo dashboard frontend)

## Accomplishments

- **Task 1 — Redux seam (`performanceSlice.ts`).** Added `ContextTurnRow` + `ContextTurnMessage` types matching the proxy line-builder shape (`ts, task_id, agent, wire:'anthropic'|'openai', request_id, model, usage:{input,output,cache_read,cache_write:number|null}, cache_breakpoints:number[], categories, messages, observation_ref`), a `fetchContextTurns(taskId)` `createAsyncThunk` fetching `/api/experiments/runs/${encodeURIComponent(taskId)}/context-turns` and returning `{ taskId, contextTurns }` (rejectWithValue on error), a `contextTurnsByTaskId: Record<string, ContextTurnRow[]>` state field (typed + init `{}`), a `.fulfilled` extraReducer storing the array, and a `selectContextTurnsFor(taskId)` selector returning `[]` on absence (T-84-08-02). All strictly typed — no `any`. Mirrors the timeline seams verbatim.
- **Task 2 — Honest explainer (`context-cache-explainer.tsx`).** Three edits, no new components: (1) dispatch `fetchContextTurns(taskId)` alongside `fetchTimeline` + `const contextTurns = useAppSelector(selectContextTurnsFor(taskId))`; (2) `summarize()` now takes `contextTurns` and prefers the real wire values, tracking per-turn `wire` + `writeNA` and a run-level `writeIsNA` (pure-OpenAI-wire) flag — the OpenAI-wire `cache_write: null` becomes the exact N/A string, never 0; a new inline per-turn table renders each request's real read/write/input/output with the wire badge and the N/A branch; the Cache-write stat card shows N/A for pure-OpenAI-wire runs; the honesty note switches from "~bytes/4 estimate" to "real usage-reported count" when context-turns exist; (3) added the "how prompt caching actually works — and why cache-write is sometimes 'N/A'" copy block explaining the wire asymmetry.
- **Task 3 — Human-verify checkpoint: APPROVED.** Deployed the frontend (`npm run build` exit 0, bundle `index-BD5Ujnag.js`; restarted `web-services:health-dashboard-frontend`), restarted `web-services:vkb-server` to activate 84-07's read route (was 502/not-live; now `200 {contextTurns:[…]}`), seeded a controlled mixed-wire fixture (2 Anthropic + 2 OpenAI turns), drove the dialog open via the Redux store (runs KB empty → no Explain button), and captured gsd-browser screenshots. Operator reviewed and confirmed all four honest-rendering conditions. Demo fixture removed post-approval.

## Task Commits

1. **Task 1: fetchContextTurns thunk + selector + state + reducer** — `89ebc89eb` (feat)
2. **Task 2: honest per-turn wire render + N/A + caching copy** — `4e981c5b2` (feat)
3. **Checkpoint-awaiting state + evidence** — docs commit (STATE.md + evidence PNGs)

## Files Created/Modified

- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` (**MODIFIED**) — `ContextTurnRow`/`ContextTurnMessage` types, `fetchContextTurns` thunk, `contextTurnsByTaskId` state (+init), `.fulfilled` reducer, `selectContextTurnsFor` selector.
- `integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx` (**MODIFIED**) — dispatch+selector, `summarize()` wire-preference + honesty flags, `CACHE_WRITE_NA` const, per-turn honest table, N/A stat card branch, updated honesty note, "how prompt caching actually works" copy block.

## Human-Verify Checkpoint (Task 3) — PASSED

**Approved 2026-07-08** by operator after reviewing gsd-browser screenshots. Confirmed conditions:
- **(a)** Real per-turn cache split — cache read 0 / 15,800 / 4,100 / 8,600; fresh input; output — from real wire values (not bytes/4 estimate).
- **(b)** OpenAI-wire turns (T3, T4) render **"N/A (provider reports no cache-creation)"** for cache-write, NOT 0.
- **(c)** The "how prompt caching actually works" copy is present (Anthropic-wire cache-creation counter vs OpenAI-wire cache-reads-only asymmetry).
- **(d)** Anthropic-wire turn (T1) shows real cache-write **15,800**; T2 shows real **0**. Verdict banner driven by real wire values ("28,500 tokens read back across 4 turns — 44%").

**Evidence screenshots** (committed under `.planning/phases/84-per-turn-context-revelation/evidence/`):
- `84-08-explainer-top.png` — header + data-driven verdict + anatomy band.
- `84-08-per-turn-table.png` — per-turn honest split + stat cards (N/A on OpenAI turns).
- `84-08-caching-copy.png` — the caching-explainer copy block.
- `84-08-explainer-full.png` — full dialog capture.

## Deviations from Plan

**1. [Rule 3 — Blocking issue] Restarted `web-services:vkb-server` to activate 84-07's read route for verification.**
- **Found during:** Task 3 (checkpoint deploy).
- **Issue:** `GET /api/experiments/runs/:taskId/context-turns` returned 502 (HTML→JSON parse fail) — the running vkb-server process predated 84-07's `handleContextTurns` (84-07 explicitly deferred its container restart to 84-09). Without it, `fetchContextTurns` could never succeed, so the checkpoint was unverifiable.
- **Fix:** `docker exec coding-services supervisorctl restart web-services:vkb-server` — the route then returned `200 {contextTurns:[…]}`. This is the same restart 84-09 will perform; doing it here only makes the read route live (no code change).
- **Files modified:** none.

**2. [Verification-enabling] Seeded a controlled mixed-wire fixture + drove the dialog via the Redux store.**
- **Found during:** Task 3.
- **Issue:** No live context-turns data on disk and the experiments runs KB is empty (`/api/experiments/runs` → `{"rows":[]}`) — the proxy write hook (84-04/05) is NOT redeployed (Plan 84-09's job). With no run, the runs table shows no "Explain" button, and the Redux store is not exposed on `window`.
- **Fix:** Wrote a synthetic `.data/measurements/ctx-demo-mixed-84-08/context-turns.jsonl.gz` (2 Anthropic + 2 OpenAI turns), verified the read route served it correctly (cache_write:null for openai, real numbers for anthropic), then located the Redux store by walking the React fiber tree and dispatched `performance/setExplainTaskId`. The rendering logic + N/A branch are proven with this fixture; end-to-end live data is Plan 84-09's verification. Fixture removed after approval.
- **Files modified:** none (fixture was ephemeral, now deleted).

## Deferred Issues

- **Pre-existing tsc error in `src/pages/token-usage.tsx:675`** (recharts `Formatter` type — `number | undefined` not assignable to `number`). NOT introduced by this plan (last touched Phase 66-04); the build is unaffected because the build script is `tsc --noEmit 2>/dev/null; vite build` (tsc non-blocking) and exits 0. Out of scope per the deviation SCOPE BOUNDARY — logged here, not fixed.

## Threat Surface

- **T-84-08-01 (Info Disclosure / measurement integrity)** mitigated: cache-write branches on the per-line `wire` discriminator; OpenAI-wire (`cache_write === null`) renders the exact N/A string at both per-turn and run-aggregate levels, never 0 or an inferred number (D-12). The `number | null` type enforces this at compile time.
- **T-84-08-02 (DoS / empty-or-failed fetch)** mitigated: `selectContextTurnsFor` returns `[]` on absence; the thunk uses rejectWithValue; the explainer degrades to the timeline path when context-turns are empty.
- **T-84-08-SC (Tampering / npm installs)** N/A: no new packages — existing dashboard deps only.

## Verification

- Grep gates: `fetchContextTurns`=6 (≥3), `selectContextTurnsFor|contextTurnsByTaskId`=5 (≥2) in performanceSlice; `fetchContextTurns|selectContextTurnsFor`=4 (≥2), `N/A (provider reports no cache-creation)`=1 (≥1), `how prompt caching|cache-creation counter|cache reads`=4 (≥1) in the explainer.
- `npx tsc --noEmit` — no errors in either edited file (the only error is the pre-existing `token-usage.tsx` one).
- `npm run build` — exit 0 (bundle `index-BD5Ujnag.js`).
- Live DOM assertion (gsd-browser eval): `hasNA=true`, `hasCopy=true`, `hasPerTurnTable=true`, `hasCopyBlock=true`.
- Read route live-verified: `GET /api/experiments/runs/ctx-demo-mixed-84-08/context-turns` → 4 turns (2 anthropic real cache_write, 2 openai cache_write:null).

## Next Phase Readiness

- 84-09 (live E2E / redeploy) redeploys the proxy write hook (84-04/05), runs a golden cross-agent comparison, and verifies the full write→close→read→explainer path with REAL run data. The explainer UI + read route are now live and proven with a controlled fixture; 84-09 supplies the live data. The vkb-server read route was activated here (84-07's deferred restart).

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-08*
</content>
</invoke>

## Self-Check: PASSED
- Both modified files present (`performanceSlice.ts`, `context-cache-explainer.tsx`), SUMMARY + evidence PNGs present.
- Commits `89ebc89eb` (feat, Task 1) and `4e981c5b2` (feat, Task 2) verified in git log.
