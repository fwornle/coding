// PATTERN SOURCE: 55-11-PLAN.md Task 1 <behavior>
//   + 55-PATTERNS.md § HierarchyNavigator.tsx (tree-build + render pattern)
//   + 55-UI-SPEC.md §13.1 (Hierarchy Navigator full UX)
//   + 55-UI-SPEC.md §10 (keyboard `g h` shortcut)
//
// Behavior covered (the plan's <behavior> block):
//   - Test: when system !== 'coding', returns null (renders nothing)
//   - Test: default export is a React component
//   - Test (tree-build): entities with ontologyClass in {System,Project,Component,
//     SubComponent,Detail} linked by containment EDGES build a 4-level tree.
//     2026-09-08: the fixture used to link via `metadata.parent`. Nothing has ever
//     written that field, so the component now derives parents from the graph's
//     `contains` / `parent-child` / `includes` edges (graph/hierarchy-parents.ts)
//     and the fixture supplies those instead.
//   - Test (render): each L1 row is a button with aria-label including class+name+(N descendants)
//   - Test (a11y): tree uses role="tree" parent + role="treeitem" rows + aria-level + aria-expanded
//   - Test (click L1): setHierarchySubtreeFilter(l1.id) called
//   - Test (Cmd/Ctrl+F search): opens search input above tree when navigator focused
//   - Test (g h shortcut via hook): focuses search input
//   - Test (empty state): "No hierarchy data yet." + run-wave-analysis sub-text
//   - Test (Logger): Logger.info on L1 click, no raw console.*

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import HierarchyNavigator from './HierarchyNavigator'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/api/ApiClient'
import type { HierarchyEdge } from '@/graph/hierarchy-parents'

function makeEntities(): Entity[] {
  return [
    {
      id: 'p1',
      name: 'Coding Project',
      ontologyClass: 'Project',
      metadata: {},
    } as unknown as Entity,
    {
      id: 'c1',
      name: 'LiveLoggingSystem',
      ontologyClass: 'Component',
      metadata: {},
    } as unknown as Entity,
    {
      id: 'c2',
      name: 'KnowledgeManagement',
      ontologyClass: 'Component',
      metadata: {},
    } as unknown as Entity,
    {
      id: 's1',
      name: 'ETM',
      ontologyClass: 'SubComponent',
      metadata: {},
    } as unknown as Entity,
    {
      id: 'd1',
      name: 'StallDetect',
      ontologyClass: 'Detail',
      metadata: {},
    } as unknown as Entity,
    // entity OUTSIDE the hierarchy classes — must be excluded
    {
      id: 'noise',
      name: 'NotInTree',
      ontologyClass: 'Pattern',
      metadata: {},
    } as unknown as Entity,
  ]
}

/** The containment edges that actually carry the hierarchy in the live graph. */
function makeRelations(): HierarchyEdge[] {
  return [
    { from: 'p1', to: 'c1', type: 'parent-child' },
    { from: 'p1', to: 'c2', type: 'parent-child' },
    { from: 'c1', to: 's1', type: 'contains' },
    { from: 's1', to: 'd1', type: 'contains' },
    // non-containment edges must not create parents
    { from: 'p1', to: 'd1', type: 'has_insight' },
  ]
}

beforeEach(() => {
  // Reset store (cast: `entities` is not on ViewerState — store is driven via
  // the prop in production; in tests we drive via setState as the harness).
  useViewerStore.setState({
    // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set.
    focalNodeId: null,
    selectedNodeIds: new Set<string>(),
    selectedEdgeId: null,
    searchQuery: '',
    visibleLevels: new Set([0, 1, 2, 3]),
    selectedClasses: new Set<string>(),
    theme: 'light',
    filterRailCollapsed: false,
    hierarchySubtreeFilter: null,
    ...({ entities: makeEntities(), relations: makeRelations() } as Record<string, unknown>),
  } as unknown as Parameters<typeof useViewerStore.setState>[0])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HierarchyNavigator', () => {
  test('Test 1: returns null when system !== "coding"', () => {
    const { container } = render(<HierarchyNavigator system="okb" />)
    expect(container.textContent ?? '').toBe('')
  })

  test('Test 2: default export is a React component (FilterRail lazy import contract)', async () => {
    const mod = await import('./HierarchyNavigator')
    expect(typeof mod.default).toBe('function')
  })

  test('Test 3: tree-build — builds a 4-level tree from hierarchy entities + parent metadata', () => {
    render(<HierarchyNavigator system="coding" />)
    // L1 (Project) row should be present and have the L2 children count
    // 1 project → 2 components → 1 subcomponent → 1 detail = 4 descendants total
    const l1Button = screen.getByLabelText(/Filter to Project: Coding Project \(4 descendants\)/)
    expect(l1Button).toBeTruthy()
  })

  test('Test 4: a11y — tree uses role="tree" parent + role="treeitem" rows + aria-level + aria-expanded', () => {
    render(<HierarchyNavigator system="coding" />)
    const tree = screen.getByRole('tree')
    expect(tree).toBeTruthy()
    const items = screen.getAllByRole('treeitem')
    expect(items.length).toBeGreaterThanOrEqual(1)
    // First L1 should have aria-level=1 and aria-expanded attribute
    const l1Item = items[0]
    expect(l1Item.getAttribute('aria-level')).toBe('1')
    expect(l1Item.hasAttribute('aria-expanded')).toBe(true)
  })

  test('Test 5: click L1 row calls setHierarchySubtreeFilter(l1.id)', () => {
    render(<HierarchyNavigator system="coding" />)
    expect(useViewerStore.getState().hierarchySubtreeFilter).toBeNull()
    const l1Button = screen.getByLabelText(/Filter to Project: Coding Project/)
    act(() => {
      fireEvent.click(l1Button)
    })
    expect(useViewerStore.getState().hierarchySubtreeFilter).toBe('p1')
  })

  test('Test 6: Cmd/Ctrl+F while focus inside navigator opens text input above tree', () => {
    const { container } = render(<HierarchyNavigator system="coding" />)
    const navigator = container.querySelector('[data-testid="hierarchy-navigator"]') as HTMLElement
    expect(navigator).toBeTruthy()
    // Initially, no search input
    expect(container.querySelector('[data-testid="hierarchy-search-input"]')).toBeNull()
    // Focus the navigator then press Cmd+F
    navigator.focus()
    act(() => {
      fireEvent.keyDown(navigator, { key: 'f', metaKey: true })
    })
    // Search input should appear
    expect(container.querySelector('[data-testid="hierarchy-search-input"]')).toBeTruthy()
  })

  test('Test 7: `g h` keyboard shortcut focuses the search input (via hook registerSequence)', async () => {
    vi.useFakeTimers()
    render(<HierarchyNavigator system="coding" />)
    // The navigator must register the sequence handler — fire g then h
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
      vi.advanceTimersByTime(100)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    // The search input should appear AND be focused
    const input = document.querySelector('[data-testid="hierarchy-search-input"]') as HTMLInputElement | null
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)
  })

  test('Test 8: empty state — "No hierarchy data yet." + sub-text when no hierarchy entities', () => {
    useViewerStore.setState({
      entities: [
        { id: 'noise', name: 'NotInTree', ontologyClass: 'Pattern' } as unknown as Entity,
      ],
    } as unknown as Parameters<typeof useViewerStore.setState>[0])
    render(<HierarchyNavigator system="coding" />)
    expect(screen.getByText(/No hierarchy data yet/)).toBeTruthy()
    expect(screen.getByText(/Run wave-analysis to populate/)).toBeTruthy()
  })

  test('Test 9: Logger discipline — no raw console.* in the source file', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/HierarchyNavigator.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Test 10: placeholder testid is GONE (file overwritten)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/HierarchyNavigator.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/hierarchy-navigator-placeholder/)
  })

  test('Test 11: no ad-hoc inline sequence handling (per W-6: lives in the hook)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/HierarchyNavigator.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/lastKey|pendingKey|gKeyPressed/)
  })

  test('Test 12: source-grep gates — system==coding gate, role="tree", role="treeitem", aria-level, aria-expanded all present', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/HierarchyNavigator.tsx'),
      'utf8',
    )
    expect(src).toMatch(/system === ['"]coding['"]/)
    expect(src).toMatch(/role=['"]tree['"]/)
    expect(src).toMatch(/role=['"]treeitem['"]/)
    expect(src).toMatch(/aria-level/)
    expect(src).toMatch(/aria-expanded/)
  })

  test('Test 13: default export present (single occurrence) — FilterRail lazy import requires default export', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/HierarchyNavigator.tsx'),
      'utf8',
    )
    const matches = src.match(/export default/g) ?? []
    expect(matches.length).toBe(1)
  })

  // ---- 2026-09-08: edge-derived hierarchy + the Unparented bucket ----

  test('the tree comes from edges, not metadata.parent', () => {
    // metadata.parent has never been written by anything. Honouring it would
    // silently resurrect the flat-list bug the moment someone set it wrongly.
    const entities = [
      { id: 'p1', name: 'P', ontologyClass: 'Project', metadata: {} },
      { id: 'c1', name: 'C', ontologyClass: 'Component', metadata: { parent: 'p1' } },
    ] as unknown as Entity[]
    render(<HierarchyNavigator system="coding" entities={entities} relations={[]} />)
    // no edges → the Component is orphaned, not nested under P
    expect(screen.getByLabelText(/Filter to Project: P \(0 descendants\)/)).toBeTruthy()
    expect(screen.getByLabelText(/Filter to Unparented: Unparented/)).toBeTruthy()
  })

  test('System is rendered, so CollectiveKnowledge is the single root', () => {
    const entities = [
      { id: 'sys', name: 'CollectiveKnowledge', ontologyClass: 'System', metadata: {} },
      { id: 'p1', name: 'Coding', ontologyClass: 'Project', metadata: {} },
      { id: 'p2', name: 'Kgbench', ontologyClass: 'Project', metadata: {} },
    ] as unknown as Entity[]
    const relations = [
      { from: 'sys', to: 'p1', type: 'includes' },
      { from: 'sys', to: 'p2', type: 'includes' },
    ]
    render(<HierarchyNavigator system="coding" entities={entities} relations={relations} />)
    const roots = screen.getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')
    expect(roots).toHaveLength(1)
    expect(screen.getByLabelText(/Filter to System: CollectiveKnowledge \(2 descendants\)/)).toBeTruthy()
  })

  test('a Project with no incoming edge is still a root, not orphaned', () => {
    // No System node in this graph, so Project IS the top level.
    const entities = [
      { id: 'p1', name: 'Coding', ontologyClass: 'Project', metadata: {} },
      { id: 'c1', name: 'C', ontologyClass: 'Component', metadata: {} },
    ] as unknown as Entity[]
    render(
      <HierarchyNavigator
        system="coding"
        entities={entities}
        relations={[{ from: 'p1', to: 'c1', type: 'parent-child' }]}
      />,
    )
    expect(screen.getByLabelText(/Filter to Project: Coding \(1 descendants\)/)).toBeTruthy()
    expect(screen.queryByLabelText(/Filter to Unparented/)).toBeNull()
  })

  test('deeper nodes with no containment edge collect under one Unparented root', () => {
    // ~540 Details are in this state today. Spilling them across the top level
    // is what made the "tree" a flat list of 1341 rows.
    const entities = [
      { id: 'sys', name: 'CollectiveKnowledge', ontologyClass: 'System', metadata: {} },
      { id: 'p1', name: 'Coding', ontologyClass: 'Project', metadata: {} },
      { id: 'd1', name: 'LooseOne', ontologyClass: 'Detail', metadata: {} },
      { id: 'd2', name: 'LooseTwo', ontologyClass: 'Detail', metadata: {} },
    ] as unknown as Entity[]
    render(
      <HierarchyNavigator
        system="coding"
        entities={entities}
        relations={[{ from: 'sys', to: 'p1', type: 'includes' }]}
      />,
    )
    const roots = screen.getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')
    expect(roots).toHaveLength(2) // CollectiveKnowledge + Unparented
    expect(screen.getByLabelText(/Filter to Unparented: Unparented \(2 descendants\)/)).toBeTruthy()
  })

  test('a kgbench-style regrouping nests the run anchors under their parent', () => {
    const entities = [
      { id: 'sys', name: 'CollectiveKnowledge', ontologyClass: 'System', metadata: {} },
      { id: 'kg', name: 'Kgbench', ontologyClass: 'Project', metadata: {} },
      { id: 'r1', name: 'KgbenchTreeHomruf', ontologyClass: 'Component', metadata: {} },
      { id: 'r2', name: 'KgbenchTreeDltk21', ontologyClass: 'Component', metadata: {} },
    ] as unknown as Entity[]
    render(
      <HierarchyNavigator
        system="coding"
        entities={entities}
        relations={[
          { from: 'sys', to: 'kg', type: 'includes' },
          { from: 'kg', to: 'r1', type: 'contains' },
          { from: 'kg', to: 'r2', type: 'contains' },
        ]}
      />,
    )
    // Radix unmounts collapsed AccordionContent, so nested rows are not in the
    // DOM until expanded. Assert the nesting through what IS observable: one
    // root, owning all three descendants (Kgbench + its two run anchors).
    const roots = screen.getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')
    expect(roots).toHaveLength(1)
    expect(
      screen.getByLabelText(/Filter to System: CollectiveKnowledge \(3 descendants\)/),
    ).toBeTruthy()
    // the run anchors are not top-level rows any more
    expect(screen.queryByLabelText(/Filter to Component: KgbenchTreeHomruf/)).toBeNull()
  })
})
