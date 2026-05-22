---
phase: 41-online-learning-adapter-post-hoc-resolution
plan: 03
subsystem: km-core/store
tags: [km-core, store, graph, getDegree, survivor-selection, PIPE-02, phase-41]
requires:
  - phase: 37
    decisions: [D-14, D-16, D-22]
  - phase: 38
    decisions: [Pattern-S4-async-on-sync]
provides:
  - "GraphKMStore.prototype.getDegree(id): Promise<number>"
affects:
  - "Plan 06 (resolveEntities) — can now call store.getDegree() for OKM-pattern survivor-selection."
tech-stack:
  added: []
  patterns:
    - "Async public method wrapping sync Graphology call (Phase 38 Pattern S4)."
    - "Missing-node returns falsy value (0) instead of throwing — caller-friendly contract."
key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts (+36 LoC — one public method)"
    - "/Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts (+79 LoC — one describe block, 3 tests)"
decisions:
  - "Picked Option 1 from 41-PATTERNS Cross-Cutting (`No getDegree(id) in km-core GraphKMStore`) — add a thin wrapper to the store rather than expose `graph.degree()` via a callback or leak the private Graphology instance."
  - "Did NOT also add `inDegree`/`outDegree` separately — YAGNI; Plan 06 only needs the total. Future consumers can opt in later."
  - "Missing-node returns `0` (not throw) — Plan 06's `resolveEntities` may compare a pair where one node was just deleted by an earlier merge in the same wave; falsy comparison falls through cleanly without try/catch."
metrics:
  duration: "~6 min (RED → GREEN, no REFACTOR — 4-line method)"
  completed: "2026-05-22"
  tasks: 1
  files: 2
  loc-added: 115
  tests-added: 3
  vitest-suite: "180/180 green (was 177; +3 new)"
---

# Phase 41 Plan 03: GraphKMStore.getDegree() — Survivor-Selection Support Summary

Adds the public `getDegree(id: EntityId): Promise<number>` method to `GraphKMStore`. This is the only modification Phase 41 requires to the store contract; it unblocks Plan 06's `resolveEntities` to port OKM's "prefer higher-degree node" survivor-selection heuristic verbatim, without leaking the private Graphology instance or routing through callbacks.

## What Was Built

**Public method addition to `GraphKMStore`:**

```ts
async getDegree(id: EntityId): Promise<number> {
  if (!this.graph.hasNode(id)) return 0;
  return this.graph.degree(id);
}
```

Inserted immediately after `findRelations` (line 652) so it groups with the other read-only query methods. JSDoc references (a) Phase 41 Plan 03 — survivor-selection support for PIPE-02 `resolveEntities`, (b) the "missing node returns 0" contract for caller convenience, (c) the in+out total semantics (distinct from `inDegree`/`outDegree`), (d) explicit pin to "single A→B edge → both endpoints' degree === 1" so Plan 06's degree-based survivor selection has a deterministic reference.

**Tests appended to `tests/unit/graph-store.test.ts`** (new `describe('getDegree (Phase 41 Plan 03)', ...)` block):

- **Test A:** After `addRelation({type:'CONTAINS', from:A, to:B})`, `getDegree(A) === 1` AND `getDegree(B) === 1`. Pins the directed-multi-graph semantic that a single edge contributes one count to each endpoint.
- **Test B:** After 3 outgoing edges from A (to B, C, D), `getDegree(A) === 3` (inDegree=0, outDegree=3).
- **Test C:** `getDegree('nonexistent-id')` resolves to `0` and does not throw.

## TDD Cycle

| Phase | Commit | What |
|-------|--------|------|
| RED | `973f546` | `test(41-03): failing tests for GraphKMStore.getDegree` — 3 tests, all failing with `TypeError: ctx.store.getDegree is not a function`. |
| GREEN | `9eca196` | `feat(41-03): public GraphKMStore.getDegree wrapper for survivor-selection` — adds the 4-line method; 3 tests pass; full suite 180/180. |
| REFACTOR | _(none)_ | Method is 4 lines; nothing to clean up. |

## Verification

```
$ cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit
(exit 0, no output)

$ npx vitest run tests/unit/graph-store.test.ts
Test Files  1 passed (1)
     Tests  34 passed (34)

$ npx vitest run
Test Files  20 passed (20)
     Tests  180 passed (180)
```

**Acceptance criteria (all passed):**

| Criterion | Result |
|-----------|--------|
| `grep -nE "async getDegree\\(" src/store/GraphKMStore.ts` returns exactly 1 match | ✓ 1 match (line 652) |
| `grep -nE "this\\.graph\\.degree\\(" src/store/GraphKMStore.ts` returns exactly 1 match | ✓ 1 match (line 654) |
| `grep -n "getDegree" tests/unit/graph-store.test.ts` returns ≥ 4 matches | ✓ 7 matches (1 describe + 3 test names + 3 call sites) |
| `npx tsc --noEmit` exits 0 | ✓ exit 0 |
| `npx vitest run tests/unit/graph-store.test.ts` ≥3 NEW passing tests | ✓ +3 (31 → 34) |
| Full vitest suite green; ZERO regressions in Phase 37/38/39/40 tests | ✓ 180/180 |
| `grep -cE "console\\." src/store/GraphKMStore.ts` unchanged | ✓ 0 (was 0; stays 0) |

## must_haves — Truths Verified

- ✓ `GraphKMStore.getDegree(id: EntityId): Promise<number>` is a public async method that returns the Graphology in+out degree for the entity's node. (Method exists at GraphKMStore.ts:652; Tests A & B confirm semantics.)
- ✓ Calling `getDegree` on a missing id returns `0` (never throws). (Test C; verified via `expect(...).resolves.toBe(0)` — `resolves.toBe` would propagate any throw as a test failure.)
- ✓ `resolveEntities` (Plan 06) can call `await store.getDegree(survivorId)` to break ties between merge candidates per the OKM survivor-selection heuristic ported in `deduplicator.ts:711-719`. (Public surface added; no further blockers in the store contract.)

## must_haves — Key-Link Verified

- ✓ `GraphKMStore.getDegree` → `graphology MultiDirectedGraph.degree(id)` via `this.graph.degree(id)` wrapper (pattern `this\.graph\.degree\(`). Exactly one match in the source file (`GraphKMStore.ts:654`). No other call site exists.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` specified "insert a new public async method `getDegree` immediately after `findRelations`"; that is precisely where it landed. JSDoc covers all 4 required reference points (a–d). Tests A, B, C pin the literal values 1/1, 3, 0 as specified.

## Threat Flags

None — `getDegree` is a thin read-only wrapper. Threat T-41-03-01 (Information Disclosure: graph-structure metadata) is accepted per the plan's threat model (km-core is a trusted-caller library; degree count is non-sensitive). T-41-03-02/03/04 mitigations are unchanged (graphology pin in package.json holds; no npm installs; O(1) lookup means no DoS surface).

## Self-Check: PASSED

**Files exist (km-core repo):**
- ✓ `/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts` (modified — `async getDegree(` at line 652)
- ✓ `/Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts` (modified — `describe('getDegree (Phase 41 Plan 03)'` appended)

**Commits exist (km-core repo, branch `main`):**
- ✓ `973f546` — `test(41-03): failing tests for GraphKMStore.getDegree`
- ✓ `9eca196` — `feat(41-03): public GraphKMStore.getDegree wrapper for survivor-selection`

## TDD Gate Compliance

- ✓ RED gate: `test(41-03): ...` commit `973f546` exists and was failing at commit time (3/3 new tests reported `TypeError: ctx.store.getDegree is not a function`).
- ✓ GREEN gate: `feat(41-03): ...` commit `9eca196` exists after RED and turns the 3 tests green.
- ✓ REFACTOR gate: not required (method is 4 lines; no cleanup to do).
