# Phase 66 — Deferred Items (out-of-scope discoveries)

Logged per executor SCOPE BOUNDARY rule. NOT fixed by Plan 66-02 (pre-existing,
unrelated to the median-latency work).

## Pre-existing tsc errors in the dashboard (not introduced by 66-02)

Discovered while running `npx tsc --noEmit` for Task 1 / Task 2 verification.
All confirmed present at the 66-02 baseline (via `git stash` comparison) BEFORE
any 66-02 edit.

1. `src/pages/token-usage.tsx` — two recharts `Formatter<number, NameType>`
   type mismatches (TS2322) on `<Tooltip formatter={...} />` props
   (baseline lines 560 + 646). Pre-existing recharts typing drift; unrelated to
   the Median Latency column.

2. `src/components/system-health-dashboard.tsx` — three `StatusItem[]` TS2322
   errors (baseline lines 543/548/553) where `getDatabaseItems()` /
   `getServiceItems()` / `getProcessItems()` emit a `status` that may be
   `'unknown'`, which is not in the `StatusItem.status` union
   (`'operational' | 'warning' | 'error' | 'offline'`). Pre-existing; the
   `<LlmLatencyTile />` registration added in 66-02 type-checks cleanly and adds
   no new error. Fix would be to widen `StatusItem.status` to include `'unknown'`
   (or narrow the builders) — out of scope for the latency observability plan.
