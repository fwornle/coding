// Anti-drift gate for the graph visibility rule set.
//
// History this gate exists to stop repeating: three consumers each built
// their own `VisibilityFilters` literal from their own store subscriptions,
// and twice they silently diverged from the canvas —
//
//   - UnifiedViewer.visibleCount drifted in FIVE ways (debug shield, teams
//     exemption for structural nodes, learningSourceOf, deriveLayer, LSL
//     filter). Fixed by collapsing it onto isEntityVisible.
//   - useVisibleEntityIds then turned out to omit `hiddenNodeTypes`, so the
//     LSL strip and bucket list disagreed with the canvas about every class
//     switched off in the legend.
//
// Neither bites in the DEFAULT filter state, which is exactly why both
// survived so long: the divergence only appears once a filter is engaged —
// precisely when someone is looking at the number. A behavioural test in the
// default state would not have caught either one, so the gate is structural:
// there must be ONE place that reads the filter store and builds the filter
// object, and the consumers must go through it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

const CONSUMERS = [
  'graph/D3GraphCanvas.tsx',
  'graph/useVisibleEntityIds.ts',
  'routes/UnifiedViewer.tsx',
] as const

describe('useGraphVisibility — single source of truth for canvas visibility', () => {
  it.each(CONSUMERS)('%s resolves visibility through useGraphVisibility()', (rel) => {
    expect(read(rel)).toMatch(/useGraphVisibility\(\)/)
  })

  it.each(CONSUMERS)('%s does not call isEntityVisible directly', (rel) => {
    // Calling the raw predicate means hand-building the filter object, which
    // is how both divergences happened. Consumers take the bound predicate.
    expect(read(rel)).not.toMatch(/isEntityVisible\s*\(/)
  })

  it.each(CONSUMERS)('%s does not rebuild the filter literal (searchQueryLowered)', (rel) => {
    // `searchQueryLowered` is the field only a hand-built VisibilityFilters
    // literal sets — a reliable tell that a fourth copy has appeared.
    expect(read(rel)).not.toMatch(/searchQueryLowered:/)
  })

  it('hiddenNodeTypes is applied inside the predicate, not bolted on at call sites', () => {
    // The `&& !hiddenNodeTypes.has(...)` form is what was forgettable.
    const predicate = read('graph/visibility-predicate.ts')
    expect(predicate).toMatch(/filters\.hiddenNodeTypes/)
    for (const rel of CONSUMERS) {
      expect(read(rel)).not.toMatch(/&&\s*!\s*hiddenNodeTypes\.has/)
    }
  })

  it('only useGraphVisibility subscribes to the filter fields it owns', () => {
    // Each field below fed the duplicated literal. A consumer re-subscribing
    // to one is the first step of the next drift.
    const OWNED = [
      'selectedTeams', 'visibleLevels', 'learningSource', 'selectedLayers',
      'hideDocNodes', 'hideArchived', 'lslFilterEntityIds',
      'showDebugEntityTypes', 'hiddenNodeTypes',
      // The hierarchy subtree focus is a filter field like the rest: the
      // navigator WRITES it, the canvas reads it through here. UnifiedViewer
      // may read `hierarchySubtreeFilter`/`hierarchySubtreeLabel` — the row's
      // identity and name, for the chip — but never the resolved id set, which
      // is what actually filters.
      'hierarchySubtreeIds',
    ]
    for (const rel of CONSUMERS) {
      const src = read(rel)
      for (const field of OWNED) {
        expect(
          src.includes(`useViewerStore((s) => s.${field})`),
          `${rel} re-subscribes to ${field} — it belongs to useGraphVisibility`,
        ).toBe(false)
      }
    }
  })

  it('the hook memoises on every filter field it reads (no stale predicate)', () => {
    // A field read but missing from the dep list freezes the predicate at its
    // first value — the filter would appear to do nothing at all.
    const src = read('graph/useGraphVisibility.ts')
    const reads = [...src.matchAll(/useViewerStore\(\(s\) => s\.(\w+)\)/g)].map((m) => m[1])
    const deps = src.slice(src.lastIndexOf('}, [')).match(/[\w]+/g) ?? []
    expect(reads.length).toBeGreaterThan(0)
    for (const field of reads) {
      expect(deps, `${field} is read but missing from the dep list`).toContain(field)
    }
  })
})
