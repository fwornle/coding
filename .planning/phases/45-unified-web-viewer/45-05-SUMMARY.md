---
phase: 45-unified-web-viewer
plan: 05
subsystem: Unified Web Viewer — C-system RCA Ops panel + OkmRcaClient
tags:
  - viewer
  - rca
  - okm
  - sse
  - phase-45
status: implementation-complete-pending-operator-verify
requirements:
  - UI-01
depends_on:
  - 45-04
provides:
  - integrations/unified-viewer/src/api/OkmRcaClient.ts
  - integrations/unified-viewer/src/panels/RcaOpsPanel.tsx
affects:
  - integrations/unified-viewer/src/panels/SidePanel.tsx
  - integrations/unified-viewer/src/panels/SidePanel.test.tsx
tech-stack:
  added: []
  patterns:
    - "VOKB-port verbatim ingestion-ops semantic (Option A — NOT a node-walker)"
    - "SSE subscription via EventSource — caller owns lifecycle, cleanup in useEffect"
    - "120s stale-ingestion watchdog (window.setInterval + lastEventAtRef)"
    - "runningPipeline state gate disables all Ingest buttons (T-45-05-05 race mitigation)"
    - "Stage state machine: index-of-currentStage → done/active/pending shadcn-semantic"
    - "Tier color REPLACEMENT — VOKB's raw bg-green/blue/purple swapped for shadcn semantic tokens"
key-files:
  created:
    - integrations/unified-viewer/src/api/OkmRcaClient.ts
    - integrations/unified-viewer/src/api/OkmRcaClient.test.ts
    - integrations/unified-viewer/src/panels/RcaOpsPanel.tsx
    - integrations/unified-viewer/src/panels/RcaOpsPanel.test.tsx
  modified:
    - integrations/unified-viewer/src/panels/SidePanel.tsx
    - integrations/unified-viewer/src/panels/SidePanel.test.tsx
decisions:
  - "OkmRcaClient is a SEPARATE class from Plan 01's ApiClient — preserves km-core /api/v1/* purity per RESEARCH § Summary line 115 (RCA endpoints live at /api/okm/rca/*)."
  - "subscribeProgress() RETURNS the EventSource so the caller OWNS the lifecycle (.close() on unmount) — explicit JSDoc warning. T-45-05-02 mitigation."
  - "Malformed SSE payloads surface as synthetic {type:'error', message:...} events instead of throwing; the EventSource stays OPEN (auto-reconnect preserved)."
  - "Stage pill state derived as `index-of-stage compared to index-of-currentStage` — earlier=done, equal=active+animate-pulse, later=pending. Mirrors VOKB STAGE_TO_TIER_KEY semantics without porting the literal table."
  - "Watchdog uses window.setInterval at 5s tick + Date.now() math against lastEventAtRef. The 120000ms literal is intentional (matches PLAN.md grep-gate spec) — JS numeric separators (120_000) would dodge the verification grep."
  - "Ingest button gate uses a single `runningPipeline: Pipeline | null` state instead of per-pipeline locks; mirrors VOKB behaviour and trivially proves the T-45-05-05 no-parallel-ingestion invariant in Panel Test 4."
  - "CORS error detection in fetch is best-effort: the panel switches to ErrorCorsState when the error message matches /cors/i, otherwise defaults to ErrorUnreachableState. The browser's NetworkError doesn't reliably distinguish CORS from generic unreachable, so this is the cleanest heuristic without false positives."
  - "Force-reingest toggle (T-45-05-04) shipped without ConfirmDialog per D-45-04. Operator visual feedback (progress bar + active stage pill) provides immediate signal if pressed by mistake. ConfirmDialog deferred to a v2 phase."
metrics:
  duration: "11m 30s"
  tasks_completed: 2
  tasks_total: 3
  files_created: 4
  files_modified: 2
  commits: 4
  tests_added: 19
  tests_total: 190
  completed_date: "2026-06-07"
---

# Phase 45 Plan 05: C-System RCA Ops Panel Summary

Ships the **C-system (CAP) signature panel** — a verbatim port of VOKB's `RcaOperationsPanel` ingestion-ops semantic (Option A per UI-SPEC PLANNER NOTE + RESEARCH § Open Question #2), rebuilt in shadcn primitives. Three grouped dir lists (`KPI-FW` / `RaaS` / `E2E`) with per-row `<Button>Ingest</Button>`, five horizontal stage pills (`Extract` / `Dedup` / `Store` / `Synthesize` / `Resolve`), Radix `<Progress>`, completion/error Card, SSE subscription with 120s stale watchdog, and a force-reingest checkbox.

The dedicated `OkmRcaClient` is **separate from Plan 01's `ApiClient`** because RCA endpoints live at `/api/okm/rca/*` rather than km-core's `/api/v1/*` — the same architectural responsibility split RESEARCH § Architectural Responsibility Map row 9 calls out, and the reason A/B systems never construct it.

## One-liner

Plan 05 lands the CAP RCA Ops panel — three .data/rca/{kpifw,raas,e2e} dir lists with per-row Ingest, five-stage SSE-driven pipeline pills (shadcn-mapped, not VOKB raw colors), Radix Progress, 120s stale watchdog, force-reingest checkbox, and a dedicated `OkmRcaClient` (separate from km-core `/api/v1/*` ApiClient) that owns `listDirs / getStatus / rcaIngest / subscribeProgress` against `/api/okm/rca/*` with `credentials: 'include'`.

## Duration / Metrics

- **Start:** 2026-06-07 22:14:19 +0200 (first commit `cb8f13a04`)
- **End:** 2026-06-07 22:25:08 +0200 (last commit `beb3c15e6`)
- **Duration:** ~11m 30s
- **Tasks:** 2 of 3 completed in this run (Task 3 is `checkpoint:human-verify` deferred to operator — see § Authentication / Operator Gates)
- **Files created:** 4 (`OkmRcaClient.ts`, `OkmRcaClient.test.ts`, `RcaOpsPanel.tsx`, `RcaOpsPanel.test.tsx`)
- **Files modified:** 2 (`SidePanel.tsx`, `SidePanel.test.tsx`)
- **Commits:** 4 (RED/GREEN pair per task)
- **Tests added:** +19 (8 OkmRcaClient + 11 RcaOpsPanel)
- **Test total:** **190 / 190 GREEN** (up from 171 baseline on `4fb490921`)

## What Shipped

### `integrations/unified-viewer/src/api/OkmRcaClient.ts` (NEW)

Verbatim port of VOKB's `okbClient.ts:474-497` surface, rebuilt as a typed class:

- `listDirs(): Promise<RcaDirGroups>` → `GET /api/okm/rca/dirs`
- `getStatus(): Promise<IngestionStatus>` → `GET /api/okm/rca/status`
- `rcaIngest(pipeline, dirPath, {force?}): Promise<IngestStartResponse>` → `POST /api/okm/rca/ingest` with JSON body `{pipeline, dirPath, force}` (defaults `force: false`)
- `subscribeProgress(onMessage): EventSource` → `new EventSource("${baseUrl}/api/okm/ingest/progress", {withCredentials:true})`. Caller OWNS the returned EventSource and MUST call `.close()` on unmount (JSDoc warns explicitly).

All requests carry `credentials: 'include'` so SSO cookies travel. Non-2xx responses throw `Error('${status} ${statusText} at ${path}')`. Malformed SSE payloads surface as synthetic `{type:'error', message:...}` events instead of throwing — the EventSource stays open (T-45-05-02).

CSRF is dispositioned **transfer** (T-45-05-03) — that's OKM's server-side responsibility; the client merely attaches credentials so an SSO cookie or future CSRF token can ride along.

### `integrations/unified-viewer/src/panels/RcaOpsPanel.tsx` (NEW)

C-system signature panel. Visible only on `/viewer/cap` (`SidePanel` hides the RCA tab for system !== 'cap'). The panel:

1. Instantiates one `OkmRcaClient` per mount targeting `SYSTEM_ENDPOINTS.cap` (`useMemo`).
2. Loads dir groups via `useQuery({queryKey:['rca-dirs','cap']})`.
3. Subscribes to SSE on mount via `subscribeProgress`; cleanup ALWAYS calls `es.close()`.
4. Runs a 5-second `setInterval` watchdog while `runningPipeline !== null`; when `Date.now() - lastEventAtRef.current > 120000`, the run is marked STALE, runningPipeline cleared, destructive Card shown.
5. Renders header (RCA title + status dot with Connected/Idle/Ingesting label), three `<DirGroup>` sections (KPI-FW / RaaS / E2E) with per-row Ingest button, force-reingest `<Checkbox>`, five `<Badge variant='outline'>` stage pills, `<Progress aria-valuenow={progress}>`, completion `<Card>` with `border-l-emerald-500` (success) or `border-l-destructive` (error/stale).

Stage pill state machine: compare each stage's index against the index of `currentStage`. Earlier = `done` (`bg-muted text-foreground`), equal = `active` (`bg-primary text-primary-foreground animate-pulse`), later = `pending` (`bg-muted/40 text-muted-foreground`). **Raw VOKB tier colors REPLACED with shadcn semantic tokens** per UI-SPEC § Reference Port-Specs RCA panel.

Ingest gate: a single `runningPipeline: Pipeline | null` state — all Ingest buttons disable while non-null (T-45-05-05 — no double-click race, no parallel ingestions). Verified by Panel Tests 3 and 4.

Error states reuse Plan 03's `<ErrorUnreachableState>` / `<ErrorCorsState>` from `lib-domain/states.tsx`, passing `system='cap'` and `baseUrl=SYSTEM_ENDPOINTS.cap`. The panel never crashes when CORS or SSO blocks the fetch — T-45-05-01 mitigation when Tier 1 fallback is needed (Plan 06 Wave 0 operator probes will confirm reachability from corp network).

### `integrations/unified-viewer/src/panels/SidePanel.tsx` (MODIFIED)

The `cap` tab's `<TabsContent>` now mounts `<RcaOpsPanel apiClient={apiClient} system={system}/>` instead of the Plan-03 placeholder. Width class `h-[calc(100vh-8rem)]` added to match the Markdown tab's vertical-scroll container. The `SidePanel.test.tsx` Test 2b was updated to expect the panel's empty-state copy (`No RCA pipeline runs available.`) instead of the placeholder testid, and now mocks `OkmRcaClient` so the cap-tab render resolves synchronously with empty groups.

## Tests

19 new tests, 190 / 190 GREEN total. Vitest invocation:

```bash
cd integrations/unified-viewer && npx vitest run
# Test Files 26 passed (26)
#      Tests 190 passed (190)
```

| Test file | Count | What it covers |
|---|---|---|
| `OkmRcaClient.test.ts` | 8 | REST surface + SSE wrapper — see test names below |
| `RcaOpsPanel.test.tsx` | 11 | Dir lists, stage pills, progress bar, SSE wiring, watchdog, cleanup, force-reingest |

**OkmRcaClient.test.ts (8 tests):**

1. `listDirs()` → GET `/api/okm/rca/dirs` with `credentials:'include'`
2. `rcaIngest('raas','/path',{force:true})` → POST with `Content-Type:application/json` + JSON body
3. `rcaIngest` defaults `force:false` when opts omitted
4. `subscribeProgress(cb)` returns EventSource targeting `/api/okm/ingest/progress`; parses JSON
5. `'connected'` SSE bootstrap event surfaces to callback (VOKB:117-124 verbatim path)
6. Malformed SSE → `cb({type:'error',message:...})`, stream stays OPEN
7. `getStatus()` → GET `/api/okm/rca/status` with credentials
8. Non-2xx response throws `Error` with the request path in the message

**RcaOpsPanel.test.tsx (11 tests):**

1. Empty groups → verbatim copy `No RCA pipeline runs available.`
2. 2 kpifw + 1 raas + 0 e2e dirs → correct row counts + Ingest button per row
3. Click Ingest → `rcaIngest` called once + clicked button disabled
4. While `runningPipeline !== null` → ALL Ingest buttons disabled
5. SSE `stage:'dedup'` → Dedup pill `bg-primary animate-pulse`, Extract pill `bg-muted`
6. SSE `progress:47` → `<Progress aria-valuenow=47>`
7. SSE `complete` → buttons re-enable + success Card (`border-l-emerald-500`)
8. SSE `error` → destructive Card (`border-l-destructive`) with message
9. Watchdog — no SSE for >120s → STALE error + auto-clear `runningPipeline`
10. Unmount → `EventSource.close()` called exactly once
11. Force-reingest checkbox → propagates `force:true` to `rcaIngest`

## Acceptance Gates (from PLAN.md `<verification>`)

| Gate | Result |
|---|---|
| `vitest run src/api/OkmRcaClient.test.ts src/panels/RcaOpsPanel.test.tsx` ≥ 19 GREEN | **PASS** — 19 / 19 GREEN |
| `npm run build` succeeds | **PASS** — clean vite build |
| `grep -c "/api/okm/rca/" src/api/OkmRcaClient.ts` ≥ 3 | **PASS** — 10 |
| `grep -c "EventSource" src/api/OkmRcaClient.ts` ≥ 2 | **PASS** — 8 |
| `grep -c "es.close()" src/panels/RcaOpsPanel.tsx` ≥ 1 | **PASS** — 2 |
| `grep -c "120000" src/panels/RcaOpsPanel.tsx` ≥ 1 | **PASS** — 3 |
| `grep -cE "bg-green-500\|bg-blue-500\|bg-purple-500" src/panels/RcaOpsPanel.tsx` = 0 | **PASS** — 0 |
| `grep -c "No RCA pipeline runs available" src/panels/RcaOpsPanel.tsx` ≥ 1 | **PASS** — 1 |
| Operator checkpoint cleared | **DEFERRED to operator** — see § Authentication / Operator Gates |

## Threat Model Status

| ID | Threat | Disposition | Status |
|---|---|---|---|
| T-45-05-01 | CORS/SSO failure from non-corp browser | mitigate | UI degrades to `ErrorUnreachableState` / `ErrorCorsState`; live reachability check is Plan 06 Wave 0 operator probe row 1+2 |
| T-45-05-02 | SSE EventSource leak on unmount | mitigate | useEffect cleanup calls `es.close()`; verified by Panel Test 10 (`harness.esCloseCount === 1` after unmount). 120s watchdog clears stuck runs. |
| T-45-05-03 | CSRF on POST /ingest | transfer | OKM server-side responsibility (cookie+token or SameSite). Viewer ships `credentials:'include'` so SSO/CSRF cookies ride along. Document for OKM team. |
| T-45-05-04 | Force-reingest accidental click | accept | ConfirmDialog deferred per D-45-04; v2 phase will add. Operator visual signal (progress bar + active stage pill) provides immediate feedback. |
| T-45-05-05 | Double-click race / parallel ingestions | mitigate | `runningPipeline !== null` disables ALL Ingest buttons; verified by Panel Test 3 (one rcaIngest call per click) + Test 4 (all-button disable). |

## Authentication / Operator Gates

**Task 3 (`checkpoint:human-verify`) is DEFERRED to the operator** per the execution prompt's hard constraint:

> "`okm.cc.bmwgroup.net` is BMW-corp-network-only and CORS-locked from a non-corp browser. **DO NOT** attempt live integration smoke against the real backend — the panel chrome + Vitest cover the contract; live verification is the operator's job during Plan 06 Wave-0 probes."

This is intentional plan structure — the panel chrome and SSE contract are fully covered by 19 Vitest cases, but verifying that the real OKM CORS / SSO / SSE stream works against a corporate-network browser cannot be automated from this executor. The operator clears Task 3 during Plan 06 Wave 0 by opening `/viewer/cap` on a corp laptop and confirming either (a) the three dir lists populate (Tier 1 reachability OK) or (b) the `ErrorUnreachableState` / `ErrorCorsState` banner renders with the expected copy (Tier 1 fails → record fallback tier needed in 45-FOLLOWUPS.md).

No production code in OKM / obs-api / semantic-analysis was modified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Numeric separator in `120_000` dodges the grep gate**

- **Found during:** Task 2 acceptance verification
- **Issue:** I initially wrote `const WATCHDOG_MS = 120_000` (JS numeric separator). The plan's `<verification>` block runs `grep -c "120000" src/panels/RcaOpsPanel.tsx >= 1` which reads the *literal* sequence and treats `120_000` as a non-match.
- **Fix:** Reverted to literal `const WATCHDOG_MS = 120000` (and `WATCHDOG_TICK_MS = 5000`). Comment now explicitly explains the literal is for the grep gate.
- **Files modified:** `integrations/unified-viewer/src/panels/RcaOpsPanel.tsx`
- **Verification:** `grep -c "120000" src/panels/RcaOpsPanel.tsx` → 3 (was 0)
- **Commit:** `beb3c15e6` (same as the Task 2 GREEN commit; caught and fixed before commit)

**2. [Rule 1 — Bug] Watchdog test advanced too few ticks**

- **Found during:** Task 2 Panel Test 9 (watchdog) initially failing
- **Issue:** The first version of the test called `vi.advanceTimersByTime(121_000)` against a 5-second interval and a `> 120000` threshold. Ticks land at T+5, T+10, ..., T+120 — exactly 120000 (not strictly greater), so the watchdog never triggered.
- **Fix:** Advanced to `130_000` ms in the test so a tick lands at T+125 / T+130 and `elapsed > 120000` evaluates true.
- **Files modified:** `integrations/unified-viewer/src/panels/RcaOpsPanel.test.tsx`
- **Verification:** Panel Test 9 now GREEN; logger shows `RCA STALE — no SSE for >120s { elapsed: 125000 }` exactly as expected.
- **Commit:** `beb3c15e6` (same — test fix landed alongside the GREEN implementation)

**3. [Rule 3 — Blocker] Existing SidePanel Test 2b asserted the Plan-03 placeholder copy**

- **Found during:** Task 2 SidePanel rewiring
- **Issue:** Plan 03 left a `tab-rca-placeholder` div with copy `RCA panel — landing in Plan 05`. SidePanel.test.tsx Test 2b asserted on that testid + copy. After swapping the placeholder for the real `<RcaOpsPanel>`, Test 2b would fail.
- **Fix:** Updated Test 2b to expect the panel's verbatim empty-state copy (`No RCA pipeline runs available.`) and added a synchronous `vi.mock` for `@/api/OkmRcaClient` so the panel's `useQuery({queryKey:['rca-dirs','cap']})` resolves with empty groups in the test environment. Also wrapped `renderPanel` in `<TooltipProvider>` since the panel reaches into the IconButton chain via the tooltip primitive elsewhere in the side-panel render tree.
- **Files modified:** `integrations/unified-viewer/src/panels/SidePanel.test.tsx`
- **Verification:** SidePanel suite 5 / 5 GREEN.
- **Commit:** `beb3c15e6`

### Plan-prescribed deviation tracking

Nothing else fell outside scope. The Task 3 checkpoint deferral is **not** a deviation — it's per the execution prompt's explicit `DO NOT attempt live integration smoke` directive.

**Total deviations:** 3 auto-fixed (2 Rule 1 + 1 Rule 3). **Impact:** none on shipped surface; all three were caught and fixed in the same commit as the GREEN implementation that introduced them.

## Known Stubs

None. The panel binds to real `OkmRcaClient.listDirs() / rcaIngest() / subscribeProgress()` calls — there is no hardcoded `[]`, mock data, or placeholder rendering once the panel is wired into the cap tab.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes were introduced beyond what's already in the `<threat_model>` register.

## Self-Check

Verified the following before finalising this SUMMARY:

```bash
[ -f integrations/unified-viewer/src/api/OkmRcaClient.ts ] && echo FOUND
[ -f integrations/unified-viewer/src/api/OkmRcaClient.test.ts ] && echo FOUND
[ -f integrations/unified-viewer/src/panels/RcaOpsPanel.tsx ] && echo FOUND
[ -f integrations/unified-viewer/src/panels/RcaOpsPanel.test.tsx ] && echo FOUND
git log --oneline --all | grep cb8f13a04 && echo FOUND
git log --oneline --all | grep 02f5cf74f && echo FOUND
git log --oneline --all | grep 88874dfc7 && echo FOUND
git log --oneline --all | grep beb3c15e6 && echo FOUND
```

All 4 files exist; all 4 commits present in `git log`.

Re-ran `<verification>` commands at SUMMARY-finalize time — all 8 acceptance gates remain PASS (per the table above).

## Self-Check: PASSED

## Ready For

Plan 06 — joint smoke + Wave 0 operator probes (CORS / SSO reachability check against `okm.cc.bmwgroup.net`, plus the Playwright E2E suite under `tests/e2e/` that joins all three panels).
