# Plan 34-05 SUMMARY — ETM Plan B + [🧠] proxy badge + dashboard surface

**Status:** Tasks 1 + 2 (full) + 3 complete and on main. Task 2(d)
dead-reader cleanup done for the two async methods (1 + 2); method 3
(`getRunningTranscriptMonitorsSync`) intentionally retains its
`.health/*.json` fallback because the method is synchronous and PSM
init is async. W-1 live tmux render verified by operator on 2026-05-11.

**Commits:**
- `3351f6e89` — feat(34-05): delete 6 dead modules + add [🧠] proxy badge to statusline (Tasks 1+2 partial)
- `<this commit>` — feat(34-05): add LLM Proxy Health card to dashboard (Task 3)

## What landed

### Task 1 — file deletions (D-08 Plan B)

Six source files deleted:
- `src/live-logging/RealTimeTrajectoryAnalyzer.js`
- `src/knowledge-management/StreamingKnowledgeExtractor.js`
- `src/knowledge-management/KnowledgeExtractor.js`
- `src/knowledge-management/KnowledgeDecayTracker.js`
- `src/knowledge-management/ConceptAbstractionAgent.js`
- `src/knowledge-management/TrajectoryAnalyzer.js`

Two standalone test files deleted:
- `tests/unit/knowledge-management/KnowledgeExtraction.test.ts`
- `scripts/test-knowledge-extraction.js`

Two partial-skip tests cleaned:
- `tests/unit/ontology/integration.test.js` — only had a dangling `import`
  for the deleted streaming-extractor; the describe blocks below it were
  ontology-only and never instantiated the deleted module. Dropped the
  import; left the suites running.
- `tests/acceptance/knowledge-system-acceptance.test.js` — gutted to a
  27-line skip-stub. The original 765+ LoC dynamic imports referenced
  `src/knowledge/*` paths that **never existed** in this codebase shape
  (the actual modules lived under `src/knowledge-management/`), so the
  suite had been a dead acceptance file before deletion. Replaced body
  with `describe.skip(...)` placeholder so CI surfaces "skipped" rather
  than a hard import failure.

KEEP-list audit confirmed all 7 live consumers untouched: `KnowledgeRetriever`,
`UKBDatabaseWriter`, `QdrantSyncService`, `KnowledgeStorageService`,
`GraphDatabaseService`, `KnowledgeQueryService`, `KnowledgeExportService`.

**SPEC AC #8 grep**: returns 0 lines across `.js / .ts / .cjs / .mjs`,
excluding `node_modules / dist / .specstory / site / .spec-workflow /
worktrees`. Verified end-to-end.

### Task 2 (partial) — getProxySystemStatus + [🧠] badge

`scripts/combined-status-line.js`:

1. **New `getProxySystemStatus()` method** mirrors `getKnowledgeSystemStatus()`
   pattern: GET `${HEALTH_COORDINATOR_URL}/health/state`, read `state.proxy`
   slice, map `(semantic_ok, auto_heal_status)` to the D-12 6-state enum:
   - `auto_heal_status === 'disabled'` → `'disabled'`
   - `auto_heal_status === 'cooldown'` → `'cooling'`
   - `semantic_ok === null` → `'unknown'`
   - `semantic_ok === true` → `'healthy'`
   - else → `'degraded'`
   - Catch-all → `{ status: 'unreachable', reason: error.message }` (Pattern A)

2. **Wired into `buildCombinedStatus`** after `knowledgeStatus` — the
   call chain in the `generateStatusLine` getter now passes
   `proxyStatus` through. Method signature was extended; all
   callers updated.

3. **New [🧠] switch block** placed immediately after the `[📚]` switch.
   Six cases: ✅ healthy / ⚠️ degraded (green→yellow) / 🚫 cooling (forces
   red) / 🔇 disabled / ❓ unknown / ❌ unreachable.

4. **Collision resolution (PATTERNS.md anomaly #1)**. The existing UKB
   workflow indicator below ALSO opens with `[🧠`. Resolved by suffix
   shape — proxy emits a single status emoji; UKB emits an N+counter
   form (e.g. `[🧠1⏳2⚠️]`). Both badges coexist visually. A code
   comment marks the resolution.

## Verification

| Check | Result |
|---|---|
| `node --check scripts/combined-status-line.js` | PASS |
| Plan acceptance grep `function getProxySystemStatus\|getProxySystemStatus()` ≥ 2 | PASS (2 — definition + call) |
| All 6 [🧠X] tokens present in source | PASS |
| Existing UKB `ukbPart` references unchanged | PASS (6 occurrences preserved) |
| SPEC AC #8 grep returns 0 lines | PASS |
| Offline render emits `[🧠✅]` after `[📚✅]` | PASS (verified: `… [📚✅] [🧠✅] [📋16-17] 16:20`) |
| Unreachable-coordinator graceful exit | PASS (`HEALTH_COORDINATOR_URL=http://127.0.0.1:1` exits 0) |

## Task 3 — LLM Proxy Health dashboard card (newly added)

`integrations/system-health-dashboard/src/components/system-health-dashboard.tsx`:
- New `getProxyHealthItems()` builder mirrors `getPortDetailItems`'s
  pattern. Reads `(healthStatus as any)?.proxy` (pragmatic narrow);
  returns 3 items — Semantic readiness (RTT in ms), Network mode
  (vpn/public/unknown), Auto-heal (healthy/cooldown N/3-in-5m/disabled).
  Falls back to a single "no data" offline item when `proxy` is null.
- New `<HealthStatusCard title="LLM Proxy Health" icon={<Brain text-purple-500 />} items={getProxyHealthItems()} />`
  card added as the 5th tile in the existing `lg:grid-cols-5` cluster
  (after UKB Workflows). `Brain` icon was already imported from
  `lucide-react`; the purple tint distinguishes it from UKB Workflows
  which uses the default Brain colour.

`integrations/system-health-dashboard/src/store/slices/healthStatusSlice.ts`:
- Added `proxy: ProxyHealth | null` to `HealthStatusState`. Loose typing
  on purpose — the slice's internal shape evolves with the coordinator's
  pollProxySemantic / FSM and a strict dashboard-side type sync would
  gate every coordinator schema tweak. Consumers narrow at usage site.
- `fetchHealthStatusSuccess` now writes `state.proxy = action.payload.proxy ?? null`.
  Replace, not merge — when coordinator marks the slice null (proxy
  unreachable), the dashboard card sees null too rather than the last
  successful read.

`integrations/system-health-dashboard/server.js`:
- `handleGetHealthStatus` (`/api/health-verifier/status` reverse-proxy
  to coordinator) now passes `proxy: state.proxy ?? null` through into
  the data envelope. Without this the coordinator's proxy slice would
  never reach the dashboard's redux store, and the card would only ever
  see the "no data" fallback.

Build / restart:
- `cd integrations/system-health-dashboard && npm run build` — OK,
  `built in 5.48s`. Two pre-existing unrelated TS errors in
  `node-details-sidebar.tsx` ignored (Vite emits dist anyway).
- `docker-compose restart coding-services` — full container restart
  required because `server.js` was edited (Docker Desktop's VirtioFS
  caches bind-mounted files and `supervisorctl restart` alone re-reads
  the STALE cached file per CLAUDE.md FUSE caveat). Live verified:
  `/api/health-verifier/status` returns `proxy: { semantic_ok: true,
  networkMode: "public", auto_heal_status: "healthy", … }`.

Browser verification (via headless Playwright + screenshot):
- `LLM Proxy Health` card renders as the 5th tile.
- All 3 items visible: `Semantic readiness 817ms RTT (OK)` /
  `Network mode public (OK)` / `Auto-heal healthy (OK)`.
- No layout regression — Databases / Services / Processes / UKB
  Workflows / LLM Proxy Health all aligned in the
  `lg:grid-cols-5` row.

## Task 2(d) — dead-reader cleanup (completed 2026-05-11)

Refactor commit: `<this commit>` — drops 54 net LoC from
`combined-status-line.js`. Two of three legacy `.health/<project>-transcript-monitor-health.json`
reader sites removed:

### `ensureTranscriptMonitorRunning()` (async, ~80 → ~50 LoC)

Old contract: PSM check primary; if PSM threw OR PSM returned no live
monitor, fall through to `existsSync(healthFile)` + 10s freshness
window. The fallback was redundant in the "no live monitor" case
(PSM already gave a definitive answer) and unsafe in the "PSM threw"
case (the .health file could be stale from a dead monitor whose
unregister had been written before crash).

New contract:
- PSM is the sole source of truth.
- `getService` → if non-null `existingMonitor` AND `isProcessAlive(pid)` → no-op.
- If `existingMonitor` non-null but PID dead → `unregisterService` then
  `startTranscriptMonitor()`.
- If PSM init throws → outer try/catch logs and returns. No spawn (the
  next status-line tick retries).

### `ensureTranscriptMonitorsRunning()` (async, per-project loop)

Old contract: per project, `existsSync(healthFile)` + 60s freshness
window + `psm.isProcessAlive(healthData.metrics.processId)`. The
healthFile-parse-then-pid-check pulled the same PID that PSM already
had registered — pure indirection.

New contract:
- `existingMonitor = await psm.getService('enhanced-transcript-monitor', 'per-project', { projectPath })`
- If `!existingMonitor` → `needsRestart=true, reason='no PSM entry'`
- Else if `!psm.isProcessAlive(existingMonitor.pid)` → `needsRestart=true, reason='PID … is dead'`
- The existing spawn block at lines 1404-1442 is unchanged; it already
  did `unregisterService` before respawning.

### `getRunningTranscriptMonitorsSync()` (sync) — deliberately retained

This method is synchronous (it's invoked from sync render paths) and
PSM initialization is async. The pgrep-then-`.health/*.json`-fallback
shape stays. PSM substitution would require either:
- Restructuring the call site to async (out of scope here), or
- Preloading PSM cache at module load and reading it synchronously
  (couples render path to PSM cold-start cost).

Documented as intentional in the code path; not a regression vs the
SPEC AC #8 grep (which only targets the deleted-module symbol names,
not the .health-file reads).

### Verification

| Check | Result |
|---|---|
| `node --check scripts/combined-status-line.js` | PASS |
| Phase 33 `quick.sh` regression suite | PASS (2/2) |
| Destructive end-to-end test: `kill -TERM 82996` (sketcher ETM) → status-line tick → PSM detects dead PID → spawns PID 7398 → coordinator state shows fresh `lastBeat_age_s=2.0` | PASS |
| Offline render: all 6 badges present, `[🧠]` between `[📚]` and `[📋]` | PASS |
| W-1 live tmux render (operator-confirmed 2026-05-11) | PASS |

### Diff stats

```
scripts/combined-status-line.js | 110 ++++++++++------------------------------
1 file changed, 28 insertions(+), 82 deletions(-)
```

## Deferred — R3 / R4 destructive tests for [🧠] state transitions

The plan also calls for exercising `auto_heal_status='cooldown'` to
confirm the `[🧠🚫]` badge renders + forces overallColor red, and the
dashboard card surfaces "cooldown — N/3 kickstarts in last 5 min".
These need the same destructive setup deferred from Plan 34-03 (force
OAuth failure for 5+ min, cycle 3 kickstarts) and are tracked there.

## Phase 34 progress after this commit

| Plan | Status |
|---|---|
| 34-01 | ✅ on main |
| 34-02 | ✅ on main |
| 34-03 | ✅ on main (R3/R4 destructive tests deferred) |
| 34-04 | ✅ on main |
| **34-05** | **✅ done** — Tasks 1 + 2 (full, incl. 2(d) dead-reader cleanup) + 3 on main; W-1 live tmux render operator-verified 2026-05-11 |
| 34-06 | ✅ on main |

R3/R4 destructive cooldown tests for the `[🧠🚫]` badge are the only
acceptance items left — they share the destructive-window gate with
Plan 34-03 and will fire in the same operator session.
