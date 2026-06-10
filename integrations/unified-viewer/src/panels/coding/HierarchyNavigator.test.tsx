// PATTERN SOURCE: 55-11-PLAN.md Task 1 <behavior>
//   + 55-PATTERNS.md § HierarchyNavigator.tsx (tree-build + render pattern)
//   + 55-UI-SPEC.md §13.1 (Hierarchy Navigator full UX)
//   + 55-UI-SPEC.md §10 (keyboard `g h` shortcut)
//
// Behavior covered (the plan's <behavior> block):
//   - Test: when system !== 'coding', returns null (renders nothing)
//   - Test: default export is a React component
//   - Test (tree-build): entities with ontologyClass in {Project,Component,SubComponent,Detail}
//     and metadata.parent linking them build a 4-level tree
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
      metadata: { parent: 'p1' },
    } as unknown as Entity,
    {
      id: 'c2',
      name: 'KnowledgeManagement',
      ontologyClass: 'Component',
      metadata: { parent: 'p1' },
    } as unknown as Entity,
    {
      id: 's1',
      name: 'ETM',
      ontologyClass: 'SubComponent',
      metadata: { parent: 'c1' },
    } as unknown as Entity,
    {
      id: 'd1',
      name: 'StallDetect',
      ontologyClass: 'Detail',
      metadata: { parent: 's1' },
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

beforeEach(() => {
  // Reset store
  useViewerStore.setState({
    selectedNodeId: null,
    selectedEdgeId: null,
    searchQuery: '',
    visibleLevels: new Set([0, 1, 2, 3]),
    selectedClasses: new Set<string>(),
    theme: 'light',
    filterRailCollapsed: false,
    entities: makeEntities() as unknown as Entity[],
    hierarchySubtreeFilter: null,
  })
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
    })
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
})
