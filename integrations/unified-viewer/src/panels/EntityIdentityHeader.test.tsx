// PATTERN SOURCE: 55-09-PLAN.md Task 1 <behavior> (Identity)
// CONTRACT: 55-PATTERNS.md § EntityIdentityHeader.tsx
//
// Tests:
//   1. Renders entity.name in text-xl font-semibold
//   2. Class chip uses border color from classColor(className, theme)
//   3. Renders L{level} / parent / created / last-confirmed in
//      text-xs text-muted-foreground tabular-nums
//   4. Missing fields render `—` placeholder, never blank
//   5. Theme prop drives classColor (dark vs light still produces a non-empty borderColor)

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { EntityIdentityHeader } from './EntityIdentityHeader'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/graph/types'

// 2026-09-26: this fixture used to carry `level: 2, parent: 'parent-1'`, and
// Test 3 asserted the header echoed them. The header no longer reads either
// field — nothing has ever written them (0 of 2809 live rows) — so keeping
// them here would only re-advertise a wire contract that does not exist. The
// derived values are pinned in the second describe block, against the store
// map that actually supplies them. `Observation` is outside the ontology
// ladder (HIERARCHY_LEVEL), so its depth is legitimately `L—`.
const baseEntity: Entity = {
  id: 'e1',
  name: 'Selected Entity',
  ontologyClass: 'Observation',
  createdAt: '2026-01-02',
  // "last confirmed" comes from the provenance stamp, which is where the wire
  // puts it. It used to be a top-level `lastConfirmedAt` here — a field no
  // writer sets, so the chip read `—` on every real row while this fixture
  // made the test pass.
  metadata: {
    provenance: {
      createdBy: { provider: 'observation-writer', model: 'live-pipeline', runId: 'r1', timestamp: '2026-01-02' },
      lastConfirmedBy: { provider: 'observation-writer', model: 'live-pipeline', runId: 'r9', timestamp: '2026-02-03' },
      confirmationCount: 3,
    },
  },
}

describe('EntityIdentityHeader (Plan 55-09 Task 1)', () => {
  test('Test 1: renders entity.name in text-xl font-semibold', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="light" />)
    const name = screen.getByTestId('identity-name')
    expect(name.textContent).toBe('Selected Entity')
    expect(name.className).toMatch(/\btext-xl\b/)
    expect(name.className).toMatch(/\bfont-semibold\b/)
  })

  test('Test 2: class chip uses border color from classColor(className, theme)', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="light" />)
    const badge = screen.getByTestId('identity-class-badge')
    expect(badge.textContent).toBe('Observation')
    // Inline borderColor is set per classColor() output — assert non-empty.
    const style = badge.getAttribute('style') ?? ''
    expect(style).toMatch(/border-color/i)
  })

  test('Test 3: renders L{level} / parent / created / last confirmed in text-xs text-muted-foreground tabular-nums', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="light" />)
    const meta = screen.getByTestId('identity-meta')
    expect(meta.className).toMatch(/\btext-xs\b/)
    expect(meta.className).toMatch(/\btext-muted-foreground\b/)
    expect(meta.className).toMatch(/\btabular-nums\b/)
    // All four slots present. Level and parent come from the derived hierarchy,
    // which this bare mount supplies nothing for, so both are placeholders —
    // the values themselves are asserted in the derived-hierarchy block below.
    expect(meta.textContent).toContain('L—')
    expect(meta.textContent).toContain('parent: —')
    expect(meta.textContent).toContain('2026-01-02')
    expect(meta.textContent).toContain('2026-02-03')
  })

  test('Test 4: missing fields render `—` placeholder, never blank', () => {
    const sparse: Entity = {
      id: 'sparse',
      name: 'Sparse',
      ontologyClass: 'Observation',
    }
    render(<EntityIdentityHeader entity={sparse} theme="light" />)
    const meta = screen.getByTestId('identity-meta')
    // 4 placeholder slots: level / parent / created / last confirmed
    const dashes = meta.textContent?.match(/—/g) ?? []
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })

  test('Test 5: dark theme still produces a non-empty borderColor', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="dark" />)
    const badge = screen.getByTestId('identity-class-badge')
    const style = badge.getAttribute('style') ?? ''
    expect(style).toMatch(/border-color/i)
  })
})

// ---------------------------------------------------------------------------
// 2026-09-26 regression: the two slots that could never show a value.
//
// Every test above passes an entity carrying `level` and `parent`. No live row
// does — both fields are set on 0 of 2801 entities — so the suite was green
// while the header printed `L— · parent: —` for every entity an operator ever
// selected. These cases use the REAL row shape.
// ---------------------------------------------------------------------------

describe('EntityIdentityHeader — a real row has no .level/.parent, and must still say where it sits', () => {
  const realShape: Entity = {
    id: 'sub',
    name: 'SpecstoryAdapter',
    ontologyClass: 'SubComponent',
    // no `level`, no `parent` — exactly what /api/v1/entities returns
  }
  const entities: Entity[] = [
    { id: 'sub', name: 'SpecstoryAdapter', ontologyClass: 'SubComponent' },
    { id: 'comp', name: 'LiveLoggingSystem', ontologyClass: 'Component' },
  ]

  beforeEach(() => {
    act(() => { useViewerStore.setState({ hierarchyParents: new Map([['sub', 'comp']]) }) })
  })
  afterEach(() => {
    act(() => { useViewerStore.setState({ hierarchyParents: new Map() }) })
  })

  test('renders the derived depth and the parent NAME, not two dashes', () => {
    render(<EntityIdentityHeader entity={realShape} theme="light" entities={entities} />)
    const meta = screen.getByTestId('identity-meta').textContent ?? ''
    expect(meta).toContain('L3')
    expect(meta).toContain('parent: LiveLoggingSystem')
    expect(meta).not.toContain('L—')
    expect(meta).not.toContain('parent: —')
  })

  test('a stored field is IGNORED — the derived hierarchy is the only source', () => {
    // Inverted on 2026-09-26. For one day this asserted the opposite: the
    // stored field was kept as the first operand of a `??` "so a row that one
    // day does carry it still wins". Nothing writes either field, so that
    // preference could never fire, and its only effect was to tell the next
    // reader the wire supplies these.
    //
    // The decoy now sits in `metadata`, because `Entity` no longer has a
    // top-level `level`/`parent` to put it in — the compiler enforces what this
    // test asserts. Kept as a test anyway: metadata is an open bag, so a future
    // reader COULD still reach in and prefer it.
    render(
      <EntityIdentityHeader
        entity={{ ...realShape, metadata: { level: 0, parent: 'ExplicitlyStored' } }}
        theme="light"
        entities={entities}
      />,
    )
    const meta = screen.getByTestId('identity-meta').textContent ?? ''
    expect(meta).toContain('L3')
    expect(meta).toContain('parent: LiveLoggingSystem')
    expect(meta).not.toContain('L0')
    expect(meta).not.toContain('ExplicitlyStored')
  })

  test('a row with no parent in the map renders `parent: —`', () => {
    act(() => { useViewerStore.setState({ hierarchyParents: new Map() }) })
    render(<EntityIdentityHeader entity={realShape} theme="light" entities={entities} />)
    expect(screen.getByTestId('identity-meta').textContent).toContain('parent: —')
  })

  test('a parent the store does not hold shows its id, so a broken reference does not read as a root', () => {
    act(() => { useViewerStore.setState({ hierarchyParents: new Map([['sub', 'ghost-id']]) }) })
    render(<EntityIdentityHeader entity={realShape} theme="light" entities={entities} />)
    const meta = screen.getByTestId('identity-meta').textContent ?? ''
    expect(meta).toContain('ghost-id')
    expect(meta).not.toContain('parent: —')
  })

  test('a class outside the hierarchy ladder gets no fabricated depth', () => {
    render(
      <EntityIdentityHeader
        entity={{ id: 'o1', name: 'An Observation', ontologyClass: 'Observation' }}
        theme="light"
        entities={entities}
      />,
    )
    expect(screen.getByTestId('identity-meta').textContent).toContain('L—')
  })
})
