# Phase 60 — Deferred Items (out-of-scope discoveries)

Items found during Plan 60-01 execution that are pre-existing and NOT
caused by this plan's changes. Logged here per execute-plan scope-boundary
rule; address in a follow-up plan or as their own micro-fix.

## Stale toggleLayer expectations in LayerFilter.test.tsx (2 tests)

**Source:** `integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx:39-53`

Two tests assert post-Phase-55 semantics:
- `clicking Evidence calls store.toggleLayer with "evidence"` →
  expects `selectedLayers` to contain `'evidence'` after click.
- `clicking Pattern calls store.toggleLayer with "pattern"` →
  expects `selectedLayers` to contain `'pattern'` after click.

**Status:** PRE-EXISTING FAILURE (verified by `git stash` round-trip — failing
on `HEAD~2` before Plan 60-01 even started; no edits in Plan 60-01 touch
these two test bodies — the new tests are appended at file line 95+).

**Root cause:** `viewer-store.ts:881-911` `toggleLayer` was updated 2026-06-12
to fix two UX bugs (initial-state interpretation + empty-array collapse).
From `selectedLayers = []` (all visible), clicking Evidence materializes
ALL_LAYERS then removes 'evidence' → `['pattern']`. The two tests were
written under older semantics where clicking Evidence pushed `['evidence']`.

**Why deferred:** Plan 60-01 scope is the deriveLayer single-source-of-truth
fix (VKBUI-01 asymmetry). Updating these tests to match current store
semantics is independent and would balloon this plan's diff with
unrelated assertions.

**Suggested fix:** Update the two tests to reflect current semantics — e.g.
`expect(useViewerStore.getState().selectedLayers).toEqual(['pattern'])` after
clicking Evidence. File as a follow-up micro-fix against the unified-viewer
test suite.

## Wider unified-viewer test-suite drift (16 additional failures)

A full `npx vitest run` produced 18 failures total across 9 test files. Two
are the toggleLayer drift above; the other 16 are scattered across files
Plan 60-01 does NOT touch:

| File | Failure count | Likely root cause |
|---|---|---|
| `src/store/viewer-store.test.ts` | 2 | Same 2026-06-12 toggleLayer semantics change as above |
| `src/panels/filters/OntologyFilter.test.tsx` | 1 | `toggleOntologyClass` empty-array semantics drift (similar pattern: `['__none__']` materialisation) |
| `src/routes/UnifiedViewer.test.tsx` | 4 | Phase 55 routing test fixtures (Coding/OKB system slugs) |
| `src/panels/NavBar.test.tsx` | 1 | NavBar Phase 55 routing test |
| `src/config/system-endpoints.test.ts` | 1 | `SYSTEM_LABELS` mismatch |
| `src/graph/color-fallback.test.ts` | 2 | Palette hex pins (Plan 03 round 2 sigma WebGL contract) |
| `src/graph/node-renderer.test.ts` | 4 | Edge-state hex palette pins (same Plan 03 contract) |
| `src/graph/SigmaCanvas.test.tsx` | 1 | Default slate hex pin |

**Status:** All PRE-EXISTING — Plan 60-01 modifies only
`graph/visibility-predicate.ts`, `graph/layer.ts` (new), `graph/layer.test.ts`
(new), `graph/visibility-predicate.test.ts` (new), `panels/filters/LayerFilter.tsx`,
`panels/filters/LayerFilter.test.tsx`. None of those overlap the failing files.

**Why deferred:** Out of Plan 60-01 scope. Each failing cluster has its own
phase ownership (Phase 55 routing, Plan 03 round 2 palette) and bundling
them into Plan 60-01 would mask the deriveLayer-fix diff. File against each
owner phase as standalone follow-ups, or batch into a "unified-viewer test
suite repair" micro-phase.

