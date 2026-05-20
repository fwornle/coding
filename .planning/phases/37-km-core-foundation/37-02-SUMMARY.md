---
phase: 37-km-core-foundation
plan: 02
subsystem: api
tags: [typescript, uuidv7, branded-types, graphology, esm, km-core]

# Dependency graph
requires:
  - phase: 37-01
    provides: "km-core v0.1 skeleton (package.json, tsconfig, vitest), 4 frozen fixtures, RED test scaffolds (entity.test.ts, ids.test.ts, graph-store.test.ts, persistence.test.ts, exporter.test.ts, integration/round-trip.test.ts)"
provides:
  - "@fwornle/km-core canonical type surface: Entity, Relation, Layer, EntityId, SerializedGraph"
  - "Provenance subtype declarations preserved verbatim from OKM (ProvenanceStamp, EntityProvenance, SegmentConfirmation, DescriptionSegment, ResolutionRecord) — Phase 39 populates them"
  - "Branded compile-time `EntityId` (zero runtime cost) + `mintEntityId()` UUIDv7 factory + `parseEntityId(s)` validator with v7 defensive check"
  - "Store-API public types: `BatchOp` discriminated union (D-17), `FilterObject` predicate (D-18)"
  - "Event payload types for the 4 D-16 events: EntityPutEvent, EntityDeleteEvent, RelationAddedEvent, RelationRemovedEvent"
  - "Pluggable `OntologyValidator` interface + `noopOntologyValidator` default (D-19)"
affects: [37-03, 37-04, 37-05, 39, 41, 42, 43]

# Tech tracking
tech-stack:
  added: [uuidv7]
  patterns:
    - "Branded primitive type via `string & { readonly __brand: 'EntityId' }` — zero runtime cost, compile-time gate"
    - "Validator returns the branded type only on success (`parseEntityId(s): EntityId`)"
    - "Defensive variant check at position 14 of the canonical UUID string-form to reject non-v7 RFC 9562 UUIDs"
    - "ESM `.js` import extensions in `.ts` source (NodeNext module resolution)"
    - "OKM as the strict-superset baseline: adopt verbatim, layer in deltas (D-11 brand, D-13 legacyId, D-14 Relation rename)"
    - "Per-module barrel pattern (`src/types/index.ts`) so consumers can take a sub-surface without pulling the whole package"

key-files:
  created:
    - "~/Agentic/km-core/src/ids/branded.ts (5 lines, branded EntityId)"
    - "~/Agentic/km-core/src/ids/mint.ts (mintEntityId — uuidv7 wrapper)"
    - "~/Agentic/km-core/src/ids/parse.ts (parseEntityId — UUID.parse + charAt(14) v7 check)"
    - "~/Agentic/km-core/src/types/entity.ts (Entity, Relation, Layer, SerializedGraph + 5 provenance subtypes)"
    - "~/Agentic/km-core/src/types/index.ts (per-module barrel)"
    - "~/Agentic/km-core/src/store/types.ts (BatchOp, FilterObject)"
    - "~/Agentic/km-core/src/events/types.ts (4 event payload types)"
    - "~/Agentic/km-core/src/validation/ontology.ts (OntologyValidator interface + noopOntologyValidator default)"
  modified:
    - "~/Agentic/km-core/src/index.ts (was placeholder with only KM_CORE_VERSION; now the full public-API barrel)"

key-decisions:
  - "Adopted OKM's entity shape VERBATIM and added the 4 planned deltas — no scope creep, no refactor of OKM's provenance subtypes"
  - "Defensive `s.charAt(14) === '7'` v7 variant check kept on top of `UUID.parse` (37-PATTERNS DELTAS recommendation) so v4 UUIDs are rejected"
  - "Per-module barrel `src/types/index.ts` re-exports `EntityId` alongside Entity/Relation so consumers can take a sub-surface import"

patterns-established:
  - "Pattern: branded primitive types as compile-time identity tags — applicable to future Phase 38 OntologyClass / Phase 39 RunId etc."
  - "Pattern: validator-returns-brand — every caller-supplied opaque-string goes through a validator that returns the branded type on success and throws on failure"
  - "Pattern: `process.stderr.write` over `console.*` — carried forward from CLAUDE.md `no-console-log` constraint; OKM's `console.info` carryover was NOT brought across"

requirements-completed: [CORE-01, CORE-03]

# Metrics
duration: 14min
completed: 2026-05-20
---

# Phase 37 Plan 02: Canonical Type Surface + UUIDv7 ID Layer Summary

**Branded `EntityId` (UUIDv7) + canonical Entity/Relation types + store/events/validation type modules shipped on `@fwornle/km-core`; 2 of 5 unit test files turned RED → GREEN.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-20T04:43:00Z (plan executor spawn)
- **Completed:** 2026-05-20T04:58:00Z
- **Tasks:** 2/2
- **Files created:** 8
- **Files modified:** 1 (src/index.ts barrel)

## Accomplishments

- **CORE-03 met:** `mintEntityId()` returns a UUIDv7 branded as `EntityId`; `parseEntityId(s)` validates the format via `UUID.parse` AND adds the defensive `s.charAt(14) === '7'` v7 variant check so a v4 UUID like `00000000-0000-4000-8000-000000000000` throws `SyntaxError` (the CORE-03 "caller-supplied invalid id throws" acceptance criterion).
- **CORE-01 met:** `Entity`, `Relation`, `Layer`, `EntityId`, `SerializedGraph` are exported from `@fwornle/km-core` and compile cleanly under `strict: true`. All 5 OKM provenance subtypes (ProvenanceStamp, EntityProvenance, SegmentConfirmation, DescriptionSegment, ResolutionRecord) are preserved verbatim — Phase 39 will populate them but the shape is locked today.
- **Brand discipline:** `expectTypeOf<string>().not.toMatchTypeOf<EntityId>()` passes and the `@ts-expect-error` line on `const _id: EntityId = 'foo'` is honored — the brand catches raw-string assignment at compile time.
- **k-sortability holds:** 100 IDs minted in 10 batches (with `setImmediate` gaps) sort lexicographically in creation order — confirms the UUIDv7 timestamp lives in the most-significant bits as expected.
- **2 of 5 unit test files turn GREEN:** `entity.test.ts` (4/4) + `ids.test.ts` (5/5) = 9/9 passing. The other 4 test files (`graph-store.test.ts`, `persistence.test.ts`, `exporter.test.ts`, `integration/round-trip.test.ts`) remain RED as planned — Plans 03/04/05 land those.
- **Build replaces placeholder:** `npm run build` now produces a real `dist/index.js` (10 lines, full barrel) rather than the Wave-0 single-constant placeholder.
- **Pushed:** km-core `main` advanced from `94e9b2d` to `246f1f5` and pushed to `origin/main` (commit lossless under crash).

## Task Commits

Each task was committed atomically in the **km-core** repo:

1. **Task 1: Land ID layer (branded type + mint + parse)** — `1f0eb77` (feat)
2. **Task 2: Land canonical Entity/Relation types + supporting modules** — `246f1f5` (feat)

**Plan metadata commit:** in the **coding** repo (this commit) — SUMMARY.md + STATE.md + ROADMAP.md updates.

## Files Created/Modified

### Created (km-core repo)

- `src/ids/branded.ts` — branded `EntityId` type (5 lines + JSDoc citing D-11)
- `src/ids/mint.ts` — `mintEntityId()` factory wrapping `uuidv7` (JSDoc cites D-08, D-09, D-11)
- `src/ids/parse.ts` — `parseEntityId(s)` validator with `UUID.parse` + `s.charAt(14) === '7'` defensive variant check (JSDoc cites D-10 + 37-RESEARCH §Pitfall 2 + 37-PATTERNS DELTAS)
- `src/types/entity.ts` — `Entity`, `Relation`, `Layer`, `SerializedGraph`, and the 5 provenance subtypes preserved verbatim from OKM
- `src/types/index.ts` — per-module barrel re-exporting `Entity`/`Relation`/`Layer`/`SerializedGraph`/provenance subtypes plus `EntityId`
- `src/store/types.ts` — `BatchOp` discriminated union (D-17) + `FilterObject` predicate object (D-18)
- `src/events/types.ts` — `EntityPutEvent`, `EntityDeleteEvent`, `RelationAddedEvent`, `RelationRemovedEvent` payload types
- `src/validation/ontology.ts` — `OntologyValidator` interface + `noopOntologyValidator` default (D-19)

### Modified (km-core repo)

- `src/index.ts` — was a 5-line placeholder (`KM_CORE_VERSION` only); now the full public-API barrel re-exporting all type and runtime symbols listed above

### OKM Provenance Subtypes — Verbatim Preservation Audit

The CORE-01 contract is that KM-Core's `Entity` shape is OKM's strict superset (37-RESEARCH §"Pattern 1: Canonical Entity Type"). Specifically, the 5 provenance subtypes are preserved verbatim from `_work/rapid-automations/integrations/operational-knowledge-management/src/types/entity.ts` so Phase 39 can populate them without re-typing the consumers:

| Subtype | OKM lines | KM-Core preserved | Notes |
|---|---|---|---|
| `ProvenanceStamp` | 3-9 | yes | 4 fields, no deltas |
| `EntityProvenance` | 11-16 | yes | 3 fields, no deltas |
| `SegmentConfirmation` | 18-24 | yes | 4 fields, no deltas |
| `DescriptionSegment` | 26-56 | yes | 7 fields + JSDoc confidence heuristic preserved verbatim |
| `ResolutionRecord` | 58-68 | yes | 4 fields, no deltas |

`grep -cE "^export interface (ProvenanceStamp|EntityProvenance|SegmentConfirmation|DescriptionSegment|ResolutionRecord)" src/types/entity.ts` → **5**, satisfying acceptance criterion "greater than or equal to 4".

## Decisions Made

None beyond what was already specified in 37-CONTEXT.md (D-08 through D-19) and the planner's deltas in 37-PATTERNS.md. The plan executed exactly as written.

## Deviations from Plan

**None.** Plan executed exactly as written. All deltas in 37-PATTERNS.md §src/types/entity.ts and §src/ids/parse.ts applied verbatim; no Rule 1/2/3 auto-fixes were needed.

A small implementation detail worth recording (not a deviation): Task 1's verification step requires `tests/unit/ids.test.ts` to pass, which means `mintEntityId` and `parseEntityId` MUST be exported from `src/index.ts` at the end of Task 1 (not Task 2). The plan implicitly assumes this — I extended the barrel partially in Task 1 (just the two ID functions) and extended it fully in Task 2 (adding the type re-exports). Both commits leave the barrel coherent.

## Issues Encountered

None.

## Verification Snapshot

```
$ cd ~/Agentic/km-core
$ npx tsc --noEmit
# (clean — no output, exit 0)

$ npm run build
# tsc → dist/ populated (events/, ids/, store/, types/, validation/, index.{js,d.ts,...})

$ npx vitest run tests/unit/entity.test.ts tests/unit/ids.test.ts
 Test Files  2 passed (2)
      Tests  9 passed (9)

$ npx vitest run
 Test Files  4 failed | 2 passed (6)
      Tests  15 failed | 9 passed (24)
# 4 RED files (graph-store, persistence, exporter, integration/round-trip)
# expected — Plans 03/04/05 land those

$ grep -rE 'console\.(log|info|warn|error|debug|trace)' src/ tests/
# (no hits — CLAUDE.md no-console-log constraint clean)
```

## Next Phase Readiness

- **Plan 03 (CORE-02 persistence + exporter):** Ready. The canonical type surface is locked, `EntityId` brand is in place, `SerializedGraph` shape matches Graphology's `MultiDirectedGraph.export()` so `PersistenceManager.hydrate()` can directly cast.
- **Plan 04 (CORE-02 GraphKMStore + events):** Ready. `BatchOp`, `FilterObject`, the 4 event payload types, and `OntologyValidator` are all declared with the exact shapes 37-PATTERNS.md specifies for the store implementation.
- **Plan 05 (round-trip integration):** Unblocked once 03 and 04 land — the integration tests already import from `src/index.js` and the type surface they need is now in place.

No blockers. km-core is pushed to `origin/main` at `246f1f5` so a crash on the next plan does not lose this work.

## Self-Check: PASSED

Verified the following:

```
$ [ -f ~/Agentic/km-core/src/ids/branded.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/ids/mint.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/ids/parse.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/types/entity.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/types/index.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/store/types.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/events/types.ts ] && echo FOUND
FOUND
$ [ -f ~/Agentic/km-core/src/validation/ontology.ts ] && echo FOUND
FOUND
$ cd ~/Agentic/km-core && git log --oneline | grep -q "1f0eb77" && echo FOUND
FOUND
$ cd ~/Agentic/km-core && git log --oneline | grep -q "246f1f5" && echo FOUND
FOUND
```

All 8 created files exist; both task commits exist on `main` in km-core (and on `origin/main` after push).

---
*Phase: 37-km-core-foundation*
*Completed: 2026-05-20*
