---
phase: 37-km-core-foundation
plan: 03
subsystem: database
tags: [km-core, leveldb, graphology, classic-level, json-export, atomic-rename, debounce, uuidv7]

# Dependency graph
requires:
  - phase: 37-km-core-foundation/01
    provides: package skeleton + RED test scaffolds (tests/unit/persistence.test.ts + tests/unit/exporter.test.ts)
  - phase: 37-km-core-foundation/02
    provides: Entity / Relation / EntityId / SerializedGraph canonical types (CORE-01 + CORE-03)
provides:
  - PersistenceManager — LevelDB-first hydrate with per-domain JSON fallback, atomic temp+rename for exportJson, writing re-entry guard, LEVEL_NOT_FOUND duck-typing preserved
  - Exporter — event-driven 5s-debounced (D-22) per-domain JSON writer with atomic rename and writing guard; consumer wires scheduleExport(snapshot) on each mutation, flush() on close
  - Constructor-parametrized domain list (no more OKM hard-coded ['raas','kpifw','general']) — KM-Core consumers bring their own list; default ['general']
  - Atomic write contract that the OKB-baseline-guard pre-commit hook relies on (no torn .data/exports/*.json files)
affects:
  - 37-04 (GraphKMStore composes both modules + wires mutation events to Exporter.scheduleExport)
  - 39 (Phase 39 round-trip fixtures use hydrate + exportJson on the canonical shape locked here)
  - 41 (INT-01 / PIPE-02 — A's adapter is first KM-Core consumer end-to-end)
  - 42 (INT-02 — B migration uses PersistenceManager.exportJson as the .data/exports/coding.json source)
  - 43 (INT-03 — C migration uses PersistenceManager with domains: ['raas','kpifw','general'])

# Tech tracking
tech-stack:
  added: []  # all deps were already on Plan 01: classic-level, graphology, graphology-types, uuidv7
  patterns:
    - "Atomic write: write to `${path}.tmp.${pid}.${ts}` then `fs.promises.rename` (POSIX atomic) — applied to PersistenceManager.exportJson AND Exporter.exportJson"
    - "Re-entry guard: `private writing = false` with `if (this.writing) return;` early-out and `try/finally { this.writing = false }` — applied to both modules"
    - "LEVEL_NOT_FOUND duck-typing: `err && typeof err === 'object' && 'code' in err && err.code === 'LEVEL_NOT_FOUND'` (classic-level does not export typed error classes)"
    - "Single-timer debounce: one `exportTimer: NodeJS.Timeout | null` field reset on every `scheduleExport(snapshot)` call; fires `exportJson(pending)` once after debounceMs of inactivity"
    - "Decoupled exporter API: consumer wires its own EventEmitter to `scheduleExport` (no inversion of control imposed on KM-Core; D-16 contract)"
    - "Domain bucketing fall-through: members of configured `domains` get their own `${domain}.json`; everything else falls into `general.json` (matches OKM analog line 105)"

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/store/persistence.ts (317 lines) — PersistenceManager class
    - /Users/Q284340/Agentic/km-core/src/store/exporter.ts (228 lines) — Exporter class
  modified: []

key-decisions:
  - "Preserve OKM method names verbatim (`persistGraph`, `exportJson`) instead of renaming to `persist` as PATTERNS-text suggested — the RED test contract calls `pm.persistGraph(seed)` and `pm.exportJson(graph)` explicitly. Tests are the contract; PATTERNS-text was advisory."
  - "Exporter exposes `scheduleExport(snapshot)` + `exportJson(data)` (no `getSnapshot` callback) — RED test passes graph data directly to both methods. Avoids the closure-capture indirection PATTERNS suggested; consumer in Plan 04 will call `exporter.scheduleExport(this.graph.export() as SerializedGraph)` from its mutation handlers."
  - "Default `domains` = `['general']` (sane default per PATTERNS Delta 1). KM-Core consumers always supply their own list — B supplies `['coding']`, C supplies `['raas','kpifw','general']`."
  - "Hydrate fallback ALWAYS reads `general.json` even when consumer's domains list does not include it — colleagues' machines may have dumped unknown-domain nodes into `general.json` via Exporter's fallthrough. This is defensive extra coverage, not in OKM analog."
  - "Defense-in-depth in Exporter constructor: `path.resolve(exportDir)` (T-37-03-02 mitigation). Consumer in Plan 04 still owns vetting; this is belt-and-braces."

patterns-established:
  - "Shared atomic write pattern across persistence.ts + exporter.ts (DRY through similar private `writeAtomic` helpers — kept per-module to avoid premature cross-file shared utility; Plan 04 may extract if duplication grows)"
  - "Logging via `process.stderr.write` only — zero `console.*` in src/. CLAUDE.md `no-console-log` constraint."
  - "ESM with NodeNext `.js` import extensions on internal imports (e.g., `from '../types/entity.js'`)"

requirements-completed: [CORE-02]

# Metrics
duration: ~10 min
completed: 2026-05-20
---

# Phase 37 Plan 03: PersistenceManager + Exporter Summary

**LevelDB-first hydrate with per-domain JSON fallback + 5s-debounced atomic-rename per-domain JSON exporter, both lifted from OKM/B production code with parametrized domain list, zero `console.*`, and atomic temp+rename for OKB-baseline-guard safety**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-20T06:58Z (post Plan 02 HEAD `246f1f5`)
- **Completed:** 2026-05-20T05:08Z (km-core push complete)
- **Tasks:** 2 (both `type=auto`)
- **Files modified:** 2 (both newly created)

## Accomplishments

- **PersistenceManager extracted** from OKM's `_work/.../okm/src/store/persistence.ts` (verbatim adoption + 4 deltas) — LevelDB lifecycle, hydrate-or-fallback, atomic exportJson, re-entry guard, `LEVEL_NOT_FOUND` duck-typing all preserved exactly.
- **Exporter built** as a composite of OKM's per-domain bucketing logic (`persistence.ts:97-161`) + B's setTimeout debounce pattern (`GraphKnowledgeExporter.js:35-123`), TS-converted with explicit types and a single-timer design (D-22).
- **Test transitions:** `tests/unit/persistence.test.ts` 5/5 RED→GREEN; `tests/unit/exporter.test.ts` 4/4 RED→GREEN. Cumulative: **4 of 5 unit test files now GREEN** (entity + ids + persistence + exporter). `graph-store.test.ts` + the round-trip integration stay RED — Plan 04 lands them.
- **km-core pushed to `origin/main`** at `cd3af5d` (over `246f1f5..cd3af5d`).

## Task Commits

Both tasks committed atomically in the km-core repo:

1. **Task 1: Extract PersistenceManager** — `c023a64` (feat)
   `feat(37-03): extract PersistenceManager from OKM with parametrized domains plus atomic temp+rename (CORE-02)`
2. **Task 2: Build Exporter** — `cd3af5d` (feat)
   `feat(37-03): build Exporter with 5s debounce plus per-domain bucketing plus atomic rename (CORE-02 D-22)`

**Plan metadata:** (this SUMMARY + STATE/ROADMAP updates committed in the coding repo as a separate `docs(37-03): …` commit per execute-plan workflow)

## Files Created/Modified

- `/Users/Q284340/Agentic/km-core/src/store/persistence.ts` (NEW, 317 lines) — `PersistenceManager` class: constructor with parametrized `domains` option, `persistGraph` (LevelDB put), `hydrate` (LevelDB-first + JSON-fallback), private `hydrateFromJsonExports`, `exportJson` (per-domain atomic bucketed write), private `writeAtomic`, `close`.
- `/Users/Q284340/Agentic/km-core/src/store/exporter.ts` (NEW, 228 lines) — `Exporter` class: constructor with `ExporterOptions` ({exportDir, domains?, debounceMs?}), `scheduleExport(snapshot)` (debounce trigger), `flush()` (close-time drain), `exportJson(data)` (immediate per-domain bucketed write), private `writeAtomic`.

## Decisions Made

The plan text in 37-03-PLAN.md suggested some API names that conflicted with the RED test contract written in Plan 01. In each case the RED test contract won — tests-are-the-spec.

- **`persistGraph` not `persist`** — Plan text said "`persist` … keep the OKM name VERBATIM" but then in body suggested `persist` either way; OKM analog uses `persistGraph` and the test calls `pm.persistGraph(seed)` directly. Kept the OKM name verbatim.
- **`scheduleExport(snapshot)` not `schedule()` + `getSnapshot` callback** — Plan text proposed a `getSnapshot: () => SerializedGraph` constructor option and a parameterless `schedule()`. The RED test calls `exporter.scheduleExport(graph)` with the graph passed directly. Took the test signature; simpler and more testable (no closure indirection).
- **`exportJson(graph)` not `exportNow()` (private)** — Plan text suggested `private async exportNow()`. RED test spies on `exporter.exportJson` as a public method. Made it public to satisfy the spy contract; `scheduleExport`'s setTimeout callback fires `this.exportJson(pending)`.

These are not deviations from the requirements — they are deviations from the planner's *suggested* API spelling toward the *test contract*. CORE-02's must-haves (atomic rename, 5s debounce, re-entry guard, per-domain bucketing, no `console.*`) all hold.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - API contract] Method names per RED test contract, not plan text suggestions**

- **Found during:** Task 1 and Task 2 (verify steps reading the existing RED tests)
- **Issue:** Plan text proposed `persist` / `schedule` / `exportNow` (private) — the RED tests written in Plan 01 use `persistGraph` / `scheduleExport(snapshot)` / `exportJson(data)` (public, exported).
- **Fix:** Adopted the method names that the RED tests call. Plan acceptance criteria explicitly required "ALL 5 named tests PASSING" and "ALL 4 named tests PASSING" — the tests are the contract.
- **Files modified:** `src/store/persistence.ts`, `src/store/exporter.ts`
- **Verification:** `vitest run tests/unit/persistence.test.ts tests/unit/exporter.test.ts` → 9/9 passing.
- **Committed in:** `c023a64` (Task 1), `cd3af5d` (Task 2)

**2. [Rule 2 - Defensive extra coverage] Hydrate fallback also reads `general.json` even when not in consumer's `domains` list**

- **Found during:** Task 1 design (writing `hydrateFromJsonExports`)
- **Issue:** OKM analog only iterates the hard-coded `['raas','kpifw','general']`. After parametrization (Delta 1) with consumer-supplied domains like `['coding']`, the analog logic would skip `general.json` entirely on hydrate. But Exporter's fallthrough means unknown-domain nodes from a colleague's run could be sitting in `general.json` and we'd lose them on cold-start hydrate.
- **Fix:** After iterating `this.domains`, also read `general.json` if it wasn't already in the list. Same merge logic, same edge-dedup.
- **Files modified:** `src/store/persistence.ts`
- **Verification:** Existing `hydrate falls back to JSON exports when LevelDB has LEVEL_NOT_FOUND` test (which writes `general.json` directly and expects nodes back) still passes with default `['general']` domains; the extra branch is exercised when consumers pass non-`general` domains in Plan 04+.
- **Committed in:** `c023a64`

**3. [Rule 2 - Defense in depth] `path.resolve(exportDir)` in Exporter constructor**

- **Found during:** Task 2 (threat-model mitigation T-37-03-02)
- **Issue:** Plan threat-model row T-37-03-02 called for defensive path resolution but the plan body left the implementation strictly to consumers. Without `path.resolve`, an `exportDir: '.'` or relative path could behave differently depending on the consumer's cwd at construct time vs export time.
- **Fix:** `this.exportDir = path.resolve(opts.exportDir);` in the Exporter constructor (PersistenceManager already passes `exportDir` through to `fs.mkdirSync` which resolves implicitly).
- **Files modified:** `src/store/exporter.ts`
- **Verification:** All 4 exporter tests pass (they use `os.tmpdir()`-rooted absolute paths so resolution is a no-op there).
- **Committed in:** `cd3af5d`

---

**Total deviations:** 3 auto-fixed (1 Rule 1 API contract, 2 Rule 2 defense-in-depth)
**Impact on plan:** None of these change CORE-02's behavior contract — they reconcile plan-text-vs-test-contract drift, harden hydrate against colleague-machine data, and add belt-and-braces path resolution. No scope creep. No architectural change.

## Issues Encountered

- **Benign test-harness noise:** the debounce test (`debounce coalesces 10 rapid mutations into a single export`) uses `vi.useFakeTimers()` and arms a setTimeout that fires `exportJson` asynchronously. By the time `afterEach` runs `fs.rmSync(tmpdir, { recursive: true, force: true })`, the spied-on `exportJson` has already been invoked once (test assertion passes) but its underlying `writeAtomic` may still be racing. The `rename` then fails with ENOENT because the temp dir was just nuked. Surfaces via `process.stderr.write` (`[km-core/exporter] debounced export failed: …`) but **does not fail the test**. The `.catch` in `scheduleExport` is explicitly there to swallow exactly this kind of post-flush teardown race — no fix needed.
- No other issues. Both files compiled clean on first `npx tsc --noEmit`; both test files were green on first run.

## Self-Check: PASSED

- `[ -f /Users/Q284340/Agentic/km-core/src/store/persistence.ts ]` → FOUND
- `[ -f /Users/Q284340/Agentic/km-core/src/store/exporter.ts ]` → FOUND
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep c023a64` → FOUND (`feat(37-03): extract PersistenceManager…`)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep cd3af5d` → FOUND (`feat(37-03): build Exporter…`)
- `git -C /Users/Q284340/Agentic/km-core ls-remote origin main | grep cd3af5d` → confirmed pushed to `origin/main`
- `npx vitest run tests/unit/persistence.test.ts tests/unit/exporter.test.ts` → 9/9 PASSING
- `grep -E '^[^/]*console\.(log|info|warn|error)' src/store/{persistence,exporter}.ts` → 0 lines (only doc-comments mention `console.info`)

## Next Phase Readiness

- **Ready for Plan 04 (GraphKMStore + final integration):** PersistenceManager + Exporter primitives operational. Plan 04 composes both into `GraphKMStore` (Graphology in-memory + LevelDB durable + EventEmitter for `entity:put` / `entity:delete` / `relation:added` / `relation:removed` per D-16, wired to `exporter.scheduleExport(this.graph.export() as SerializedGraph)`).
- **No new blockers.** The two RED test files left (`graph-store.test.ts` + round-trip integration) are exactly Plan 04's scope.
- **Behavior surprises worth flagging to reviewers:**
  - `LEVEL_NOT_FOUND` is duck-typed on `err.code`, not via an instanceof check — classic-level does not export typed error classes (37-PATTERNS Shared Patterns).
  - `writing` re-entry guard on a concurrent `exportJson` call returns `undefined` with NO side effects (matches OKM verbatim) — the second concurrent call is silently a no-op. Document this in Plan 04's GraphKMStore.close path: if the consumer needs guaranteed final flush, use `await exporter.flush()` which serializes via clearing the pending timer.
  - Unknown domains ALWAYS fall through to `general.json` even when `general` is not in the consumer's `domains` list — matches OKM's "catch-all" semantics and protects against losing nodes that arrive via git pull from a colleague using different domain conventions.

---
*Phase: 37-km-core-foundation*
*Completed: 2026-05-20*
