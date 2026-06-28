// PATTERN SOURCE: 60-02-PLAN.md Task 1 <behavior>
//   + 60-CONTEXT.md § D-05..D-08
//
// Plan 60-02 rewrites LegendPanel.tsx so every section is derived from the
// currently-rendered (post-filter) entities + relations. These 11 behaviors
// cover D-05 (props-driven), D-06 (per-section rules), D-07 (empty hidden),
// D-08 (section order), plus the negative-assertion suite that proves the
// static OKB strings (RuntimeDiagnostics / Official doc / Automated RCA /
// Team knowledge / User input / CORRELATED_WITH / RELATES_TO) no longer
// bleed into the VKB tab when the rendered set is "Component-only".

import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LegendPanel } from './LegendPanel'
// Use the graph/types flavor — same shape useGraphData feeds the canvas + the
// new prop-driven LegendPanel (D-05 contract). ApiClient.Relation has an
// optional `type` and a wire-protocol index signature; graph/types.Relation
// is the canvas-facing shape.
import type { Entity, Relation } from '@/graph/types'

afterEach(() => cleanup())

// Helper — build a minimal Entity with whatever overrides the test wants.
// The ApiClient.Entity shape requires id/name/ontologyClass; everything else
// is optional via the `[k: string]: unknown` index signature.
function makeEntity(over: Partial<Entity> & { ontologyClass: string }): Entity {
  return {
    id: over.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    name: over.name ?? 'fixture',
    ...over,
  }
}

function makeRelation(type: string, idx = 0): Relation {
  return { from: `a-${idx}`, to: `b-${idx}`, type }
}

describe('LegendPanel — DOMAINS derivation (D-06)', () => {
  test('Test 1: DOMAINS lists exactly the ontologyClass values in the rendered set (no RuntimeDiagnostics bleed)', () => {
    const entities: Entity[] = [
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Service' }),
      makeEntity({ ontologyClass: 'Service' }),
      makeEntity({ ontologyClass: 'Pattern' }),
    ]
    const { container } = render(<LegendPanel entities={entities} relations={[]} />)

    // 3 distinct DOMAINS rows
    expect(container.querySelector('[data-testid="legend-domain-Component"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-domain-Service"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-domain-Pattern"]')).not.toBeNull()

    // No RuntimeDiagnostics row — that was the static OKB seed.
    expect(container.querySelector('[data-testid="legend-domain-RuntimeDiagnostics"]')).toBeNull()
    expect(screen.queryByText('RuntimeDiagnostics')).toBeNull()
  })

  test('Test 2: unknown ontologyClass falls back to gray circle with explanatory tooltip', () => {
    const entities: Entity[] = [makeEntity({ ontologyClass: 'NovelClass2099' })]
    const { container } = render(<LegendPanel entities={entities} relations={[]} />)

    const row = container.querySelector('[data-testid="legend-domain-NovelClass2099"]')
    expect(row).not.toBeNull()
    // Fallback rows carry an explanatory title attribute somewhere on the row
    // (D-22 — keep operators informed when a class lacks a registered shape).
    expect(row?.getAttribute('title') || row?.querySelector('[title]')?.getAttribute('title'))
      .toMatch(/class without registered shape/i)
  })

  // 2026-06-28 regression: the legend swatch MUST resolve color/shape via the
  // same chain as graph-builder.ts (registry display overlay → classColor with
  // the entity's source). Before the fix it ignored both, so registry-colored
  // and online-learned classes the canvas painted (purple/amber/red) showed up
  // grey in the legend — "grey circles I don't see in the graph".
  test('Test 2b: DOMAINS swatch uses registry display.color when present', () => {
    const fill = (c: Element | null) => c?.querySelector('svg [fill]')?.getAttribute('fill')
    const entities: Entity[] = [makeEntity({ ontologyClass: 'Insight' })]
    const registry = [
      { name: 'Insight', display: { color: '#a855f7', shape: 'diamond' } },
    ]
    const { container } = render(
      <LegendPanel entities={entities} relations={[]} ontologyRegistry={registry} />,
    )
    expect(fill(container.querySelector('[data-testid="legend-domain-Insight"]'))).toBe('#a855f7')
  })

  test('Test 2c: online-learned class (source=online) gets the pink RING (Hybrid), batch does not', () => {
    const strokeOf = (c: Element | null) =>
      c?.querySelector('svg [stroke]')?.getAttribute('stroke')
    // Hybrid scheme: fill carries the class hue; online provenance is shown as
    // the pink ring (ONLINE_RING_COLOR #f472b6), NOT a pink fill.
    const online: Entity[] = [
      makeEntity({ ontologyClass: 'OnlineObservation', metadata: { source: 'online' } } as Partial<Entity> & { ontologyClass: string }),
    ]
    const { container: c1 } = render(<LegendPanel entities={online} relations={[]} />)
    expect(strokeOf(c1.querySelector('[data-testid="legend-domain-OnlineObservation"]'))).toBe('#f472b6')

    cleanup()
    const batch: Entity[] = [
      makeEntity({ ontologyClass: 'OnlineObservation', metadata: { source: 'manual' } } as Partial<Entity> & { ontologyClass: string }),
    ]
    const { container: c2 } = render(<LegendPanel entities={batch} relations={[]} />)
    expect(strokeOf(c2.querySelector('[data-testid="legend-domain-OnlineObservation"]'))).not.toBe('#f472b6')
  })

  test('Test 2d: unstyled L2 class inherits its ancestor color (no grey) via parent-walk', () => {
    const fill = (c: Element | null) => c?.querySelector('svg [fill]')?.getAttribute('fill')
    // LiveLoggingSystem has no display color but parent=Component (#3b82f6).
    // The shared resolver walks up, so the swatch is blue, not slate grey.
    const entities: Entity[] = [makeEntity({ ontologyClass: 'LiveLoggingSystem' })]
    const registry = [
      { name: 'Component', display: { color: '#3b82f6', shape: 'square' } },
      { name: 'LiveLoggingSystem', parent: 'Component' },
    ]
    const { container } = render(
      <LegendPanel entities={entities} relations={[]} ontologyRegistry={registry} />,
    )
    expect(fill(container.querySelector('[data-testid="legend-domain-LiveLoggingSystem"]'))).toBe('#3b82f6')
  })
})

describe('LegendPanel — LAYERS derivation (D-06)', () => {
  test('Test 3: LAYERS renders both evidence + pattern when both are derivable from entities', () => {
    // Two Component (→ evidence via deriveLayer) + one Pattern (→ pattern).
    const entities: Entity[] = [
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Pattern' }),
    ]
    const { container } = render(<LegendPanel entities={entities} relations={[]} />)

    expect(container.querySelector('[data-testid="legend-layer-evidence"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-layer-pattern"]')).not.toBeNull()
  })

  test('Test 4: LAYERS hides "pattern" row when no pattern-derived entities are present', () => {
    const entities: Entity[] = [
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Service' }),
    ]
    const { container } = render(<LegendPanel entities={entities} relations={[]} />)

    expect(container.querySelector('[data-testid="legend-layer-evidence"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-layer-pattern"]')).toBeNull()
  })
})

describe('LegendPanel — SOURCE derivation (D-06)', () => {
  test('Test 5: SOURCE lists only distinct metadata.source values present (no Official doc / Automated RCA / etc.)', () => {
    const entities: Entity[] = [
      makeEntity({ ontologyClass: 'Component', metadata: { source: 'manual' } }),
      makeEntity({ ontologyClass: 'Component', metadata: { source: 'auto' } }),
      makeEntity({ ontologyClass: 'Component', metadata: { source: 'auto' } }),
      makeEntity({ ontologyClass: 'Component', metadata: { source: 'online' } }),
    ]
    const { container } = render(<LegendPanel entities={entities} relations={[]} />)

    expect(container.querySelector('[data-testid="legend-source-manual"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-source-auto"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-source-online"]')).not.toBeNull()

    // No static OKB rows
    expect(screen.queryByText(/Official doc/i)).toBeNull()
    expect(screen.queryByText(/Automated RCA/i)).toBeNull()
    expect(screen.queryByText(/Team knowledge/i)).toBeNull()
    expect(screen.queryByText(/User input/i)).toBeNull()
  })

  test('Test 6: SOURCE section is hidden entirely when no entity carries metadata.source (D-07)', () => {
    const entities: Entity[] = [
      makeEntity({ ontologyClass: 'Component' }),
      makeEntity({ ontologyClass: 'Service' }),
    ]
    const { container } = render(<LegendPanel entities={entities} relations={[]} />)

    // No SOURCE section heading
    expect(screen.queryByText(/^Source$/i)).toBeNull()
    // No SOURCE rows
    expect(container.querySelectorAll('[data-testid^="legend-source-"]').length).toBe(0)
  })
})

describe('LegendPanel — RELATIONSHIPS derivation (D-06)', () => {
  test('Test 7: RELATIONSHIPS lists only relation.type values in the rendered set (no CORRELATED_WITH / RELATES_TO bleed)', () => {
    const relations: Relation[] = [
      makeRelation('PART_OF', 0),
      makeRelation('PART_OF', 1),
      makeRelation('CAUSED_BY', 2),
    ]
    const entities: Entity[] = [makeEntity({ ontologyClass: 'Component' })]
    const { container } = render(<LegendPanel entities={entities} relations={relations} />)

    expect(container.querySelector('[data-testid="legend-rel-PART_OF"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="legend-rel-CAUSED_BY"]')).not.toBeNull()

    // No static OKB types
    expect(container.querySelector('[data-testid="legend-rel-CORRELATED_WITH"]')).toBeNull()
    expect(container.querySelector('[data-testid="legend-rel-RELATES_TO"]')).toBeNull()
    expect(container.querySelector('[data-testid="legend-rel-INDICATES"]')).toBeNull()
  })

  test('Test 8: unknown relation.type still renders with gray fallback line (#d1d5db)', () => {
    const entities: Entity[] = [makeEntity({ ontologyClass: 'Component' })]
    const relations: Relation[] = [makeRelation('NOVEL_REL', 0)]
    const { container } = render(<LegendPanel entities={entities} relations={relations} />)

    const row = container.querySelector('[data-testid="legend-rel-NOVEL_REL"]')
    expect(row).not.toBeNull()
    const line = row?.querySelector('line')
    expect(line).not.toBeNull()
    expect(line?.getAttribute('stroke')).toBe('#d1d5db')
  })
})

describe('LegendPanel — Empty sections + ordering', () => {
  test('Test 9: empty entities + empty relations → no Section components rendered (D-07); Legend summary still visible', () => {
    const { container } = render(<LegendPanel entities={[]} relations={[]} />)

    // Summary still rendered
    expect(screen.getByText(/^Legend$/i)).toBeInTheDocument()

    // No section headings (Domains/Layers/Source/Relationships)
    expect(screen.queryByText(/^Domains$/i)).toBeNull()
    expect(screen.queryByText(/^Layers$/i)).toBeNull()
    expect(screen.queryByText(/^Source$/i)).toBeNull()
    expect(screen.queryByText(/^Relationships$/i)).toBeNull()

    // No rows
    expect(container.querySelectorAll('[data-testid^="legend-domain-"]').length).toBe(0)
    expect(container.querySelectorAll('[data-testid^="legend-layer-"]').length).toBe(0)
    expect(container.querySelectorAll('[data-testid^="legend-source-"]').length).toBe(0)
    expect(container.querySelectorAll('[data-testid^="legend-rel-"]').length).toBe(0)
  })

  test('Test 10: section order is DOMAINS → LAYERS → SOURCE → RELATIONSHIPS when all four populated (D-08)', () => {
    const entities: Entity[] = [
      makeEntity({ ontologyClass: 'Component', metadata: { source: 'manual' } }),
      makeEntity({ ontologyClass: 'Pattern', metadata: { source: 'auto' } }),
    ]
    const relations: Relation[] = [makeRelation('PART_OF', 0)]
    render(<LegendPanel entities={entities} relations={relations} />)

    const headings = ['Domains', 'Layers', 'Source', 'Relationships'].map((t) => screen.getByText(new RegExp(`^${t}$`, 'i')))

    // Verify all four exist
    for (const h of headings) expect(h).toBeInTheDocument()

    // Verify DOM order — earlier in document should come first.
    function position(node: HTMLElement) {
      let n: Node | null = node
      let i = 0
      // Walk to root counting tree-order via documentPosition
      // Use compareDocumentPosition for direct ordering.
      return n
        ? Array.from(document.querySelectorAll('*')).indexOf(node)
        : -1
    }
    const positions = headings.map((h) => position(h as HTMLElement))
    expect(positions[0]).toBeLessThan(positions[1])
    expect(positions[1]).toBeLessThan(positions[2])
    expect(positions[2]).toBeLessThan(positions[3])
  })
})

describe('LegendPanel — Negative assertions (no static OKB content bleeds in)', () => {
  test('Test 11: with only a Component entity and zero relations, no static OKB labels appear anywhere', () => {
    const entities: Entity[] = [makeEntity({ ontologyClass: 'Component' })]
    render(<LegendPanel entities={entities} relations={[]} />)

    // These strings used to be hardcoded in the previous LegendPanel; they
    // must NEVER appear when the rendered set lacks them.
    expect(screen.queryByText(/RuntimeDiagnostics/i)).toBeNull()
    expect(screen.queryByText(/Official doc/i)).toBeNull()
    expect(screen.queryByText(/Automated RCA/i)).toBeNull()
    expect(screen.queryByText(/Team knowledge/i)).toBeNull()
    expect(screen.queryByText(/User input/i)).toBeNull()
    expect(screen.queryByText(/CORRELATED_WITH/i)).toBeNull()
    expect(screen.queryByText(/RELATES_TO/i)).toBeNull()
  })
})

describe('LegendPanel — Logger discipline', () => {
  test('ZERO raw console.* in LegendPanel.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/LegendPanel.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })
})
