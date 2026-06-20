---
phase: 61-lsl-timeline-okb-routing-honesty
plan: 03
subsystem: unified-viewer (LSL timeline strip)
tags: [lsl-timeline, honesty-badge, bi-source-color, 1y-window, frontend]
requires:
  - "Plan 01 obs-api envelope: data.total (pre-slice M) + data.limit"
  - "Plan 01 per-session field: source ('online' | 'batch')"
provides:
  - "useLslSessions { sessions, total } widened return + LslSession.source + limit=500 + '1y' window key"
  - "LslTimelineStrip N-of-M honesty badge (data-testid=lsl-nofm-badge)"
  - "amber (batch) vs pink (online) bi-source tick color"
  - "honest 1y window ladder (no 'all' literal / no 'All time' label)"
affects:
  - "useNodeToBucketsIndex (second hook consumer — now reads data.sessions)"
tech-stack:
  added: []
  patterns:
    - "additive hook return widen { sessions, total } propagated to both consumers"
    - "fillClass provenance branch mirroring color-fallback.ts source partition (auto->online, else batch)"
    - "presentational N-of-M badge gated on typeof total === 'number' && total > N"
key-files:
  created:
    - ".planning/phases/61-lsl-timeline-okb-routing-honesty/61-03-SUMMARY.md"
  modified:
    - "integrations/unified-viewer/src/panels/coding/useLslSessions.ts"
    - "integrations/unified-viewer/src/graph/useNodeToBucketsIndex.ts"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx"
decisions:
  - "D-04/D-06: LslWindow/WINDOW_MS key 'all'->'1y' (365d value UNCHANGED — label honesty only)"
  - "D-02: fetchSessions returns { sessions, total }; total = backend pre-slice M; N = deduped sessions.length"
  - "D-03: client cap raised limit=200 -> 500 (backend LSL_MAX_LIMIT)"
  - "D-08: bi-source fillClass — source==='batch'->amber-300, else pink-300; amber over slate (RESEARCH Unknown 2: slate too close to opacity-40 disabled dim)"
  - "Badge N = deduped sessions.length (what's actually drawn as ticks), M = data.total — the honest comparison per PATTERNS §C"
metrics:
  duration: ~25 min
  completed: 2026-06-20
  tasks: 3 (2 auto complete; Task 3 human-verify checkpoint pending)
  files: 4
---

# Phase 61 Plan 03: LSL Timeline Strip Honesty Summary

Made the LSL timeline strip tell the truth on all three axes: a "showing N of M" badge so the bounded fetch cap can never silently fool the operator (LSLTIME-01), an honest `1y` window label replacing the misnamed `'all'` (a silent 365-day cap) (LSLTIME-02), and two distinct tick colors — amber for manual/batch and pink for online/auto — distinguishable at a glance (LSLTIME-03). Consumes Plan 01's backend `total` + per-session `source` fields.

## What Was Built

### Task 1 — Hook plumbing (`useLslSessions.ts` + `useNodeToBucketsIndex.ts`, commit `fa590891d`)

`useLslSessions.ts`:
- **`'all'`->`'1y'` rename** (D-04/D-06): `LslWindow` literal and `WINDOW_MS` key renamed; the 365-day value is unchanged — this is label-honesty only, no backend window change.
- **`source?: 'online' | 'batch'`** added to the `LslSession` interface (consumes Plan 01's backend field; drives the strip's fillClass branch).
- **total-M plumbing** (D-02): widened the body object arm to `{ sessions; total?; limit? } | LslSession[]`; `fetchSessions` now returns `Promise<{ sessions; total? }>` — `{ sessions: data, total: data.length }` on the array arm, `{ sessions: data?.sessions ?? [], total: data?.total }` on the object arm.
- **cap raise** (D-03): `&limit=200` -> `&limit=500` (the backend `LSL_MAX_LIMIT`).
- **header comment**: documents the bounded 500 cap + the N-of-M badge contract (operator can never be silently truncated).

`useNodeToBucketsIndex.ts` (the SECOND consumer of the hook):
- Changed `const { data: sessions } = useLslSessions(...)` (which would have made `sessions` the whole `{ sessions, total }` object after the widen and broken every `.map`/`.forEach`) to `const { data } = useLslSessions(...); const sessions = data?.sessions`. The pre-check grep confirmed the exact destructure pattern before editing; tsc verified the widen propagates cleanly.

### Task 2 — Strip render + tests (`LslTimelineStrip.tsx` + `.test.tsx`, commit `b65327a26`)

`LslTimelineStrip.tsx`:
- **Consume the widened hook**: `data?.sessions` feeds the dedup memo (tick list); `data?.total` (`const total`) feeds the badge `M`. The previous `const arr = data ?? []` (which treated `data` as the array) is now `data?.sessions ?? []`.
- **N-of-M badge** (D-01/D-02): a `<span data-testid="lsl-nofm-badge" className="text-[10px] text-muted-foreground px-1.5">showing {N} of {M}</span>` rendered next to the toggle row ONLY when `typeof total === 'number' && total > sessions.length`. N = the deduped rendered tick count; M = `data.total`.
- **bi-source fillClass** (D-08): the non-halo arm splits on `s.source` — `'batch'` -> `bg-amber-300 hover:bg-amber-400`, else `bg-pink-300 hover:bg-pink-400`. Halo (`bg-blue-200/40`), selection ring (`ring-blue-*`), and disabled (`opacity-40`) classes compose on top unchanged.
- **`'all'`->`'1y'` consumer sites** (D-06): auto-slide ladder fall-through, `allOriginMs` guard, `isAll` derivation, `WINDOW_MS['all']` read, `onWindowChange` guard, and the `ToggleGroupItem` (`value="1y"` / `aria-label="1 year"` / label `1y`). All `'all'` prose comments updated for clarity. No functional `'all'` literal remains.

`LslTimelineStrip.test.tsx`:
- Test 2 assertion `limit=200` -> `limit=500`.
- Test local `LslSession` type gains `source?: 'online' | 'batch'`.
- All six `getByLabelText('All time')` references -> `getByLabelText('1 year')` (the renamed aria-label).
- New tests: Test 41 (1y item present, no 'all'/'All time' item), Test 42 (badge "showing 3 of 7" when total>N), Test 43 (badge absent when total===N), Test 44 (badge absent when backend omits total), Test 45 (batch tick amber + online tick pink), Test 46 (no-source tick defaults pink). Added a `renderStripWithPayload` helper to inject a `{ sessions, total }` envelope (the shared `renderStrip` only wires `{ sessions }`).

### Task 3 — Human-verify checkpoint (PENDING)

Visual verification of badge, 1y ladder, and bi-source tick color. NOT self-approved — see `## Checkpoint` below.

## Verification

- `cd integrations/unified-viewer && npx tsc --noEmit` — **clean of real type errors** across all four files (the widen propagates to BOTH the strip and `useNodeToBucketsIndex`). The only tsc output is 3 environment-only `TS2688` "cannot find type definition file" errors for `vitest/globals`, `vite/client`, `@testing-library/jest-dom` — these are caused by the worktree lacking `node_modules` (gitignored), NOT by any code change. Filtered grep `npx tsc --noEmit 2>&1 | grep 'error TS' | grep -v TS2688` returns nothing.
- `grep -nE "'all'|value=\"all\"|All time"` on both `useLslSessions.ts` and `LslTimelineStrip.tsx` (functional code) returns nothing — only renamed-away prose remains.
- `grep -n "lsl-nofm-badge|source === 'batch'|bg-amber-300|value=\"1y\""` on the strip all match.
- `no-console-log`: no `console.*` introduced in any edited `.ts`/`.tsx` file.

### Test-runner note (environment, not a code deviation)

The worktree checkout lacks `node_modules` (gitignored), and `vitest.config.ts` imports `vitest/config` + `@vitejs/plugin-react`, which cannot resolve without a local install — so `npx vitest run` fails at config-load with `ERR_MODULE_NOT_FOUND`. Plan 01 worked around an analogous `dist/` gap with a temporary, gitignored, never-staged symlink to the main repo's build; the equivalent `node_modules` symlink here was **denied by the harness sandbox** on every attempt, so the suite could not be run in-worktree. The vitest suite (including the six new tests) is type-checked clean by tsc and follows the file's existing vitest idioms verbatim; it should be run post-merge in the main repo (`cd integrations/unified-viewer && npx vitest run src/panels/coding/LslTimelineStrip.test.tsx`) where `node_modules` is installed. The new tests assert against deterministic, mocked payloads, so no environment coupling is expected.

## Deviations from Plan

None affecting code. The plan executed exactly as written across both auto tasks (all rename sites, the widen, the badge, the bi-source color, the cap raise, and all test additions landed at the planned locations with the pinned decisions verbatim). The only deviation is environmental: the in-worktree vitest run could not be executed (see Test-runner note) — the suite is deferred to the post-merge main-repo run.

## Known Stubs

None. The badge, color branch, and window ladder are all wired to real backend data (`total` and `source` from Plan 01's obs-api envelope). The badge correctly renders nothing when the backend omits `total` (no false honesty claim).

## Checkpoint: Task 3 (human-verify) — AWAITING

Visual verification is required because tick color + badge presence are visual properties. NOT self-approved. The orchestrator/human must run the gsd-browser smoke described in the plan after this worktree is merged (or against a throwaway Vite serving the worktree code) — the standing `:5173` dev server serves MAIN-repo code, so it will not reflect these worktree edits until merge.

What to look for:
1. Window toggle row reads **24h / 7d / 30d / 1y** — NO "all" / "All time".
2. Selecting **1y**: a "showing N of M" badge appears near the toggle if the year holds more sessions than the rendered ticks (expected, given 12 months of history vs the 500 cap). Ticks visible back toward the window edge — not a silent cliff.
3. Two distinct tick colors at a glance: **amber** (manual/batch wave-analysis) vs **pink** (online/auto). No hover required.
4. Blue selection/halo rings and greyed-out 0-obs disabled ticks still render correctly (not overwritten by the new color).

## Self-Check: PASSED

- FOUND: integrations/unified-viewer/src/panels/coding/useLslSessions.ts (modified, tsc clean)
- FOUND: integrations/unified-viewer/src/graph/useNodeToBucketsIndex.ts (modified, tsc clean)
- FOUND: integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx (modified, tsc clean)
- FOUND: integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx (modified, tsc clean)
- FOUND: commit fa590891d (Task 1)
- FOUND: commit b65327a26 (Task 2)
</content>
</invoke>
