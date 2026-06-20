---
phase: 61-lsl-timeline-okb-routing-honesty
verified: 2026-06-20T18:02:20Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 61: LSL Timeline & OKB Routing Honesty — Verification Report

**Phase Goal:** The LSL timeline strip stops lying about how much data it shows (no silent 200-record cap, no silent 365-day "all" window, no single tick color for two distinct session sources), and the unified viewer's OKB tab actually reaches the OKM Express server on `:8090` so operators see real RaaS / KPI-FW / business entities — not the coding-KG mirror.
**Verified:** 2026-06-20T18:02:20Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC#1 | The LSL timeline strip surfaces a visible "showing N of M total" label whenever the in-strip count is below the underlying total — the operator can never be silently fooled by the legacy 200-record `fetchSessions` cap | VERIFIED | `LslTimelineStrip.tsx:850` renders `<span data-testid="lsl-nofm-badge">showing {sessions.length} of {total}</span>` gated on `typeof total === 'number' && total > sessions.length`; cap raised to `limit=500` (`useLslSessions.ts:67`); backend `total: sessions.length` emitted pre-slice (`observations-api-server.mjs:2478`); Test 42/43/44 in LslTimelineStrip.test.tsx (47/47 green) lock badge presence/absence |
| SC#2 | The "all" window option is renamed to honestly reflect what it actually shows ("1 year"); the current silent 365-day cap is no longer hidden behind an "all" label | VERIFIED | `LslWindow` type in `useLslSessions.ts:34` is `'24h' \| '7d' \| '30d' \| '1y'` (no `'all'`); `WINDOW_MS` key renamed `'1y':365*24*3600_000` (`L44`); `ToggleGroupItem value="1y" aria-label="1 year"` in `LslTimelineStrip.tsx:839`; grep of both files confirms zero functional `'all'` literal; Test 41 (vitest) asserts `'1 year'` item present and `'All time'` absent |
| SC#3 | LSL timeline ticks for manual-source sessions (batch) and online-source sessions (online) render in two visually distinct colors; an operator can tell the two sources apart at a glance | VERIFIED | `LslTimelineStrip.tsx:954-956` branches `s.source === 'batch' ? 'bg-blue-700 hover:bg-blue-800' : 'bg-pink-300 hover:bg-pink-400'`; batch=blue-700 matches the graph's established BATCH_PALETTE convention (commit `9fa2c1588` post-checkpoint fix from amber); backend emits `source: 'online'\|'batch'` per-session via any-manual→batch rule (`observations-api-server.mjs:2438`); Test 45/46 assert `bg-blue-700` for batch, `bg-pink-300` for online, confirmed green |
| SC#4 | Visiting `/viewer/okb` while OKM Express is running on `:8090` renders real RaaS / KPI-FW / business entities from OKM Express; the ApiClient detects the legacy `/api/entities` contract and routes correctly | VERIFIED | `ApiClient.ts:127-129` `apiPath()` rewrites `/api/v1/` → `/api/` when `apiVersion==='legacy'`; `UnifiedViewer.tsx:448` constructs `new ApiClient(SYSTEM_ENDPOINTS[system], system === 'okb' ? 'legacy' : 'v1')`; `listEntities` (`ApiClient.ts:169`) routes `legacy` to `/api/entities`; E2E spec `55-okb-routing.spec.ts:147` asserts `hitLegacyEntities === true`; context confirms live E2E passed against OKM Express on `:8090` with real entities; `14/14 ApiClient vitest` green |
| SC#5 | The OKB tab never shows coding-KG mirror entities; if OKM Express is unreachable the tab surfaces a truthful `:8090` unreachable message rather than silently rendering wrong data | VERIFIED | No swallow-to-empty fallback introduced (grep confirms no `?? []` / `catch { return [] }` on okb path in `UnifiedViewer.tsx` or `useGraphData.ts`); `ErrorUnreachableState` at `UnifiedViewer.tsx:335` fires on `isCorsError` / HTTP error; E2E `55-okb-routing.spec.ts:208-243` uses `route.fulfill({ status: 503 })` to force OKM-down and asserts the `:8090` unreachable banner is shown AND `PersistenceAgent`/`CodeAnalyzer` are absent (hard negative, runs unconditionally) |

**Score:** 5/5 truths verified

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LSLTIME-01 | 61-01, 61-03 | N-of-M badge / no silent 200-record cap | SATISFIED | Backend `total` field + client `limit=500` + strip badge (SC#1 above) |
| LSLTIME-02 | 61-03 | Rename "all" window to honest "1y" label | SATISFIED | `LslWindow` type + `WINDOW_MS` key + `ToggleGroupItem` all renamed (SC#2 above) |
| LSLTIME-03 | 61-01, 61-03 | Bi-source tick coloring (batch vs online) | SATISFIED | Backend `source` field + strip `fillClass` branch (SC#3 above) |
| OKBROUTE-01 | 61-02 | `/viewer/okb` ApiClient routes to legacy `/api/entities` on `:8090` | SATISFIED | `apiPath()` rewrite + `system==='okb'?'legacy':'v1'` construction (SC#4 above) |
| OKBROUTE-02 | 61-02 | `/viewer/okb` renders real OKM entities, NOT coding-KG mirrors | SATISFIED | Hard E2E mirror-absence assertion + no swallow fallback + truthful unreachable (SC#4/SC#5 above) |

All 5 requirement IDs claimed in plan frontmatter are covered.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/observations-api-server.mjs` | `total: sessions.length` + per-session `source` | VERIFIED | L2478 emits `{ sessions: sliced, total: sessions.length, limit }`; L2438 any-manual→batch rule; L2410 source from `attrs.metadata?.source ?? attrs.source` |
| `tests/integration/obs-api.coding-lsl-sessions.test.js` | Locks total + source + any-batch→batch | VERIFIED | 11/11 green (confirmed via `node --experimental-vm-modules node_modules/.bin/jest`); Test 6 asserts `total===4` with `limit=2`; Test 7 asserts batch/online rule |
| `integrations/unified-viewer/src/api/ApiClient.ts` | `apiVersion` param + `apiPath()` + `OKB_RELATION_CAP` + `{ relations, total }` return | VERIFIED | Constructor L112 `apiVersion: 'v1'\|'legacy'='v1'`; `apiPath()` L126-129; `OKB_RELATION_CAP=2000` L59; `{ relations, total }` on both branches (L204, L221-222); `supportsServerNeighbors()` L138-140; CORRELATED_WITH drop L218 (case-insensitive `.toUpperCase()`) |
| `integrations/unified-viewer/src/graph/useGraphData.ts` | Unwraps `.relations` from new uniform shape | VERIFIED | L73 `(relationsQ.data?.relations ?? [])` — coding graph stays byte-identical |
| `integrations/unified-viewer/src/graph/events.ts` | `supportsServerNeighbors()` branch; client-side 1-hop for okb | VERIFIED | L27 deps type includes `supportsServerNeighbors`; L38 `getLoadedRelations?`; L78 loads from `deps.getLoadedRelations?.() ?? []`; L173 branches on `supportsServerNeighbors()` |
| `integrations/unified-viewer/src/graph/SigmaCanvas.tsx` | Threads `getLoadedRelations` into `makeEventHandlers` | VERIFIED | L163 `getLoadedRelations: () => relations` |
| `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` | `new ApiClient(..., system==='okb'?'legacy':'v1')`; `relationTotal` to Footer | VERIFIED | L448 construction with `'legacy'` for okb; L138 `relationTotal` from cached query; L427 passes to `Footer` |
| `integrations/unified-viewer/src/panels/Footer.tsx` | `relationTotal` prop + "showing N of M relations" caption | VERIFIED | L22 `relationTotal?: number`; L27 `relationTotal > edges`; L45 renders caption |
| `integrations/unified-viewer/src/panels/coding/useLslSessions.ts` | `'1y'` window key, `source` on `LslSession`, `{ sessions, total }` return, `limit=500` | VERIFIED | L34 type `'1y'`; L44 `'1y':365*24*3600_000`; L56 `source?: 'online'\|'batch'`; L67 `&limit=500`; return widened to `{ sessions, total }` |
| `integrations/unified-viewer/src/graph/useNodeToBucketsIndex.ts` | Reads `data.sessions` after hook widen | VERIFIED | L72-75 `const { data } = useLslSessions(...); const sessions = data?.sessions` |
| `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` | N-of-M badge, `bg-blue-700`/`bg-pink-300` bi-source fill, `value="1y"`, no `'all'` | VERIFIED | L852 `data-testid="lsl-nofm-badge"`; L850 guard; L839 `value="1y"`; L954-956 `bg-blue-700`/`bg-pink-300` branch |
| `tests/e2e/unified-viewer/55-okb-routing.spec.ts` | OKBROUTE-01 path, SC#4 real entities, SC#5 mirror absence + unreachable banner | VERIFIED | L115 OKBROUTE-01 test; L150 OKBROUTE-02/SC#4 (skip-gated on `:8090` up); L208 SC#5 unreachable (route.fulfill 503); L201-202/241-243 hard `PersistenceAgent`/`CodeAnalyzer` absence assertions unconditional |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `observations-api-server.mjs` allEnts scan | `aggregateForRange` source derivation | `attrs.metadata?.source ?? attrs.source` → `matches.some(m=>m.source==='manual')?'batch':'online'` | WIRED | L2410 + L2438 |
| `observations-api-server.mjs` sessions loop | envelope `total` | `sessions.length` before `slice(0, limit)` | WIRED | L2472-2478 |
| `useLslSessions.ts` `fetchSessions` | `LslTimelineStrip.tsx` badge `total` | `{ sessions, total }` return → `data?.total` | WIRED | `useLslSessions.ts:L79-82` → `LslTimelineStrip.tsx:L427` |
| `LslSession.source` | strip `fillClass` branch | `s.source === 'batch' ? 'bg-blue-700...' : 'bg-pink-300...'` | WIRED | `LslTimelineStrip.tsx:L954-956` |
| `UnifiedViewer.tsx` ApiClient construction | `ApiClient.apiPath()` rewrite | `system === 'okb' ? 'legacy' : 'v1'` → `/api/v1/` replaced with `/api/` | WIRED | `UnifiedViewer.tsx:L448` → `ApiClient.ts:L126-129` |
| `ApiClient.listRelations()` legacy branch | Footer `relationTotal` | `{ relations, total }` → `relationsTotalQ.data?.total` → `Footer relationTotal` | WIRED | `ApiClient.ts:L221-222` → `UnifiedViewer.tsx:L138` → `L427` → `Footer.tsx:L27` |
| `events.ts` `handleDoubleClickNode` | client-side 1-hop | `supportsServerNeighbors()===false` → `getLoadedRelations()` neighborhood | WIRED | `events.ts:L173-178` + `SigmaCanvas.tsx:L163` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `LslTimelineStrip.tsx` | `sessions` (tick list) | `useLslSessions` → `obs-api /api/coding/lsl/sessions` → LSL filesystem walk | Yes — real LSL session files | FLOWING |
| `LslTimelineStrip.tsx` | `total` (badge M) | Same API call, `data.total = sessions.length` (pre-slice count) | Yes — pre-slice real count | FLOWING |
| `LslTimelineStrip.tsx` | `s.source` (tick color) | Per-session `source` from obs-api derived from km-core entity `metadata.source` | Yes — real entity metadata | FLOWING |
| `Footer.tsx` | `relationTotal` (N of M relations) | `ApiClient.listRelations()` okb branch: post-CORRELATED_WITH drop count, pre-OKB_RELATION_CAP | Yes — live OKM relation count | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| obs-api emits `total` + per-session `source` | `node --experimental-vm-modules node_modules/.bin/jest tests/integration/obs-api.coding-lsl-sessions.test.js` | 11/11 passed | PASS |
| ApiClient legacy rewrite + CORRELATED_WITH cap + vitest | `cd integrations/unified-viewer && npx vitest run src/api/ApiClient.test.ts src/graph/events.test.ts src/panels/coding/LslTimelineStrip.test.tsx` | 70/70 passed (14+9+47) | PASS |
| TypeScript clean of phase-61 files | `cd integrations/unified-viewer && npx tsc --noEmit 2>&1 \| grep "error TS" \| grep -v "TS2688\|OntologyFilter"` | No output (no new errors; pre-existing OntologyFilter.test.tsx errors are Phase 60 origin) | PASS |
| No functional `'all'` literal remains | `grep -n "'all'\|value=\"all\"\|All time"` on `useLslSessions.ts` + `LslTimelineStrip.tsx` (non-comment lines) | Only comments/prose referencing the old name; zero functional matches | PASS |
| No console.log in modified files | grep on all 6 modified .ts/.tsx/.mjs files | No matches | PASS |
| No swallow-to-empty fallback on okb path | `grep -nE 'catch\s*\{\s*return \[\]|\?\? defaultEntities' UnifiedViewer.tsx useGraphData.ts` | No matches | PASS |

---

### Probe Execution

Step 7c: SKIPPED — phase is a UI + REST endpoint change, not a migration or CLI/tooling phase with explicit probe scripts. No `scripts/*/tests/probe-*.sh` files declared or conventional for this phase.

---

### Anti-Patterns Found

No blockers. No TBD / FIXME / XXX markers in any modified file. No console.log introduced. The `bg-amber-300` color was in commit `b65327a26` (feat) but was corrected in commit `9fa2c1588` (fix) immediately after the human-verify checkpoint flagged it. The current codebase contains `bg-blue-700` (correct). Both commits are on main.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

---

### Human Verification Required

No items require human verification for this initial verification pass. The Plan 03 Task 3 human-verify checkpoint was completed by the operator during phase execution (commit `9fa2c1588` records the approved result). The visual check confirmed:

- Window toggle reads **24h / 7d / 30d / 1y** (no "all" / "All time")
- "showing N of M" badge appears on the 1y window
- Two distinct tick colors visible: blue (batch/manual) vs pink (online/auto)
- Blue selection rings and greyed-out disabled ticks still render correctly

The checkpoint was blocking and gated; its approval is part of the phase commit history. No re-verification of the visual result is required.

---

### Gaps Summary

No gaps. All 5 roadmap success criteria are verified against the actual merged codebase. All 5 requirement IDs (LSLTIME-01, LSLTIME-02, LSLTIME-03, OKBROUTE-01, OKBROUTE-02) are fully implemented and locked by tests.

**Note on SC#4 (OKBROUTE-02 real-entity verification):** The E2E spec asserts real OKM entity presence when `:8090` is up, with a documented `skip-with-reason` gate when OKM Express is down. The context confirms the live E2E ran against OKM Express on `:8090` during phase execution and passed. The path-rewrite (OKBROUTE-01) and mirror-absence/unreachable assertions run unconditionally and have been confirmed green.

---

_Verified: 2026-06-20T18:02:20Z_
_Verifier: Claude (gsd-verifier)_
