// PATTERN SOURCE: 55-08-PLAN.md Task 2 + 55-PATTERNS.md § OntologyFilter +
//                 60-05-PLAN.md G5 (D-16..D-20)
//
// VOKB analog: _work/.../viewer/src/components/Filters/OntologyFilter.tsx
//
// Phase 60 (60-05) deltas:
//   - CODING_SCHEMA + `Typed Views` (LSL Pipeline / Patterns / Other) DROPPED (D-16).
//     The coding-tab variant now drives its grouping from
//     `GET /api/v1/ontology/classes?withDisplay=true` via `apiClient.listOntologyClasses()`.
//   - VOKB_SCHEMA + `classifyAvailable` + the optional `groupingSchema` prop are
//     RETAINED verbatim per checker W-1. Passing `groupingSchema={VOKB_SCHEMA}` keeps
//     the legacy hardcoded rendering path unchanged for the VOKB tab regression case.
//   - New required prop: `apiClient: ApiClient`. When `groupingSchema` is OMITTED, the
//     filter fetches the API and builds L1→L2 groups (D-17), L0 anchors ungrouped at
//     top (D-20), per-class count badges (D-18), [all]/[none] link-buttons (D-18) and
//     UI-only collapse (D-19).
//
// Verifies:
//   - Test 1   (D-16): grep for CODING_SCHEMA / Typed Views / LSL Pipeline returns 0
//   - Test 1b  (W-1) : VOKB_SCHEMA export preserved
//   - Test 1c  (W-1) : groupingSchema={VOKB_SCHEMA} → legacy path, apiClient NOT called
//   - Test 2   (D-17): L1 with L2 children → collapsible group
//   - Test 3   (D-17): L1 without L2 children → flat row
//   - Test 4   (D-20): L0 anchors render ungrouped at top
//   - Test 5   (D-18): per-class count badges
//   - Test 6   (D-18): [all] / [none] link-buttons union-add / filter-remove
//   - Test 7   (D-19): UI-only collapse — selectedOntologyClasses unchanged
//   - Test 8   (BC) : pre-Plan-04 string-array response → all flat rows
//   - Test 9   (loading): pending fetch renders nothing (no crash)
//   - Test 10  (error fallback): rejected fetch → flat rows from entity-derived classes
//
// Source-code static assertions (Test 1) run a literal file-read via fs since vitest's
// jsdom environment can read the project source tree.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity, ApiClient, OntologyClass } from '@/api/ApiClient'
import { OntologyFilter, VOKB_SCHEMA } from './OntologyFilter'

function makeEntity(id: string, ontologyClass: string): Entity {
  return { id, name: id, ontologyClass } as Entity
}

function makeApiClient(
  classes: OntologyClass[] | Error,
  pending = false,
): ApiClient {
  const fn = vi.fn()
  if (pending) {
    fn.mockReturnValue(new Promise<OntologyClass[]>(() => {})) // never resolves
  } else if (classes instanceof Error) {
    fn.mockRejectedValue(classes)
  } else {
    fn.mockResolvedValue(classes)
  }
  return { listOntologyClasses: fn } as unknown as ApiClient
}

describe('OntologyFilter', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedOntologyClasses: [],
    })
    cleanup()
  })

  describe('Test 1 (D-16): hardcoded CODING_SCHEMA + Typed Views removed from source', () => {
    test('OntologyFilter.tsx source contains no "CODING_SCHEMA" / "Typed Views" / "LSL Pipeline" references', () => {
      const filePath = path.resolve(
        process.cwd(),
        'src/panels/filters/OntologyFilter.tsx',
      )
      const src = readFileSync(filePath, 'utf8')
      expect(src).not.toContain('CODING_SCHEMA')
      expect(src).not.toContain('Typed Views')
      expect(src).not.toContain('LSL Pipeline')
    })
  })

  describe('Test 1b (W-1): VOKB_SCHEMA export preserved', () => {
    test('VOKB_SCHEMA constant is still exported', () => {
      expect(VOKB_SCHEMA).toBeDefined()
      expect(VOKB_SCHEMA.upper.name).toBe('Upper Ontology')
      expect(VOKB_SCHEMA.lower.name).toBe('Lower Ontology')
    })

    test('OntologyFilter.tsx source contains "VOKB_SCHEMA" reference', () => {
      const filePath = path.resolve(
        process.cwd(),
        'src/panels/filters/OntologyFilter.tsx',
      )
      const src = readFileSync(filePath, 'utf8')
      expect(src).toContain('VOKB_SCHEMA')
    })
  })

  describe('Test 1c (W-1): legacy path — groupingSchema={VOKB_SCHEMA}', () => {
    test('renders Upper Ontology + Lower Ontology + Failure Model groups; apiClient NOT called', () => {
      const apiClient = makeApiClient([])
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'RootCause'),
        makeEntity('c', 'RPU'),
      ]
      render(
        <OntologyFilter
          entities={entities}
          apiClient={apiClient}
          groupingSchema={VOKB_SCHEMA}
        />,
      )
      expect(screen.getByText('Upper Ontology')).toBeInTheDocument()
      expect(screen.getByText('Lower Ontology')).toBeInTheDocument()
      expect(screen.getByText('Failure Model')).toBeInTheDocument()
      // apiClient.listOntologyClasses MUST NOT be called on the legacy path
      expect(apiClient.listOntologyClasses).not.toHaveBeenCalled()
    })
  })

  describe('Test 2 (D-17): API-driven — L1 with L2 children renders as a group', () => {
    test('Component L1 group contains LiveLoggingSystem and ConstraintMonitor sub-rows', async () => {
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
        { name: 'ConstraintMonitor', level: 2, parent: 'Component' },
      ])
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'LiveLoggingSystem'),
        makeEntity('c', 'ConstraintMonitor'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      await waitFor(() => {
        expect(apiClient.listOntologyClasses).toHaveBeenCalled()
      })
      // L1 header
      expect(await screen.findByText('Component')).toBeInTheDocument()
      // L2 children rendered
      expect(
        await screen.findByTestId('filter-ontology-row-LiveLoggingSystem'),
      ).toBeInTheDocument()
      expect(
        await screen.findByTestId('filter-ontology-row-ConstraintMonitor'),
      ).toBeInTheDocument()
    })
  })

  describe('Test 3 (D-17): API-driven — L1 without L2 children renders as flat row', () => {
    test('Pattern L1 (no L2 children) renders as a single flat checkbox row', async () => {
      const apiClient = makeApiClient([
        { name: 'Pattern', level: 1, parent: null },
      ])
      const entities = [makeEntity('a', 'Pattern')]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      await waitFor(() => {
        expect(apiClient.listOntologyClasses).toHaveBeenCalled()
      })
      expect(
        await screen.findByTestId('filter-ontology-row-Pattern'),
      ).toBeInTheDocument()
    })
  })

  describe('Test 4 (D-20): API-driven — L0 anchors render ungrouped at top', () => {
    test('System + Project rows render outside any collapsible group', async () => {
      const apiClient = makeApiClient([
        { name: 'System', level: 0, parent: null },
        { name: 'Project', level: 0, parent: null },
        { name: 'Component', level: 1, parent: null },
      ])
      const entities = [
        makeEntity('a', 'System'),
        makeEntity('b', 'Project'),
        makeEntity('c', 'Component'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      await waitFor(() => {
        expect(apiClient.listOntologyClasses).toHaveBeenCalled()
      })
      expect(
        await screen.findByTestId('filter-ontology-row-System'),
      ).toBeInTheDocument()
      expect(
        await screen.findByTestId('filter-ontology-row-Project'),
      ).toBeInTheDocument()
      // L0 rows live in the L0 anchor container, NOT in an L1 group's L2 list
      const anchorBlock = screen.getByTestId('filter-ontology-l0-anchors')
      expect(anchorBlock).toContainElement(
        screen.getByTestId('filter-ontology-row-System'),
      )
      expect(anchorBlock).toContainElement(
        screen.getByTestId('filter-ontology-row-Project'),
      )
    })
  })

  describe('Test 5 (D-18): per-class count badges', () => {
    test('LiveLoggingSystem count badge = 3, ConstraintMonitor = 1', async () => {
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
        { name: 'ConstraintMonitor', level: 2, parent: 'Component' },
      ])
      const entities = [
        makeEntity('a', 'LiveLoggingSystem'),
        makeEntity('b', 'LiveLoggingSystem'),
        makeEntity('c', 'LiveLoggingSystem'),
        makeEntity('d', 'ConstraintMonitor'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      const lllBadge = await screen.findByTestId(
        'filter-ontology-count-LiveLoggingSystem',
      )
      const cmBadge = await screen.findByTestId(
        'filter-ontology-count-ConstraintMonitor',
      )
      expect(lllBadge.textContent).toBe('3')
      expect(cmBadge.textContent).toBe('1')
    })
  })

  describe('Test 6 (D-18): [all] / [none] link-buttons on L1 group', () => {
    test('[all] on Component group union-adds its L2 children to selectedOntologyClasses', async () => {
      useViewerStore.setState({ selectedOntologyClasses: ['Pattern'] })
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
        { name: 'ConstraintMonitor', level: 2, parent: 'Component' },
      ])
      const entities = [
        makeEntity('a', 'LiveLoggingSystem'),
        makeEntity('b', 'ConstraintMonitor'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      const allBtn = await screen.findByTestId(
        'filter-ontology-all-Component',
      )
      fireEvent.click(allBtn)
      const sel = useViewerStore.getState().selectedOntologyClasses
      // Pattern preserved (union-add), L2 children added
      expect(sel).toContain('Pattern')
      expect(sel).toContain('LiveLoggingSystem')
      expect(sel).toContain('ConstraintMonitor')
    })

    test('[none] on Component group filter-removes its L2 children', async () => {
      useViewerStore.setState({
        selectedOntologyClasses: [
          'LiveLoggingSystem',
          'ConstraintMonitor',
          'Pattern',
        ],
      })
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
        { name: 'ConstraintMonitor', level: 2, parent: 'Component' },
      ])
      const entities = [
        makeEntity('a', 'LiveLoggingSystem'),
        makeEntity('b', 'ConstraintMonitor'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      const noneBtn = await screen.findByTestId(
        'filter-ontology-none-Component',
      )
      fireEvent.click(noneBtn)
      const sel = useViewerStore.getState().selectedOntologyClasses
      // Pattern preserved; L2 children removed
      expect(sel).toContain('Pattern')
      expect(sel).not.toContain('LiveLoggingSystem')
      expect(sel).not.toContain('ConstraintMonitor')
    })
  })

  describe('Test 7 (D-19): UI-only collapse', () => {
    test('clicking the L1 disclosure triangle does NOT mutate selectedOntologyClasses', async () => {
      useViewerStore.setState({
        selectedOntologyClasses: ['LiveLoggingSystem'],
      })
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
        { name: 'ConstraintMonitor', level: 2, parent: 'Component' },
      ])
      const entities = [
        makeEntity('a', 'LiveLoggingSystem'),
        makeEntity('b', 'ConstraintMonitor'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      const triangle = await screen.findByTestId(
        'filter-ontology-l1-triangle-Component',
      )
      const before = useViewerStore.getState().selectedOntologyClasses.slice()
      fireEvent.click(triangle)
      const after = useViewerStore.getState().selectedOntologyClasses
      expect(after).toEqual(before)
    })
  })

  describe('Test 8 (BC): pre-Plan-04 response — no level/parent fields', () => {
    test('classes without level fields render as flat top-level rows', async () => {
      const apiClient = makeApiClient([
        { name: 'X' },
        { name: 'Y' },
      ])
      const entities = [makeEntity('a', 'X'), makeEntity('b', 'Y')]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      expect(
        await screen.findByTestId('filter-ontology-row-X'),
      ).toBeInTheDocument()
      expect(
        await screen.findByTestId('filter-ontology-row-Y'),
      ).toBeInTheDocument()
    })
  })

  describe('Test 9 (loading state)', () => {
    test('pending fetch renders nothing (no crash, no rows)', () => {
      const apiClient = makeApiClient([], /* pending */ true)
      const entities = [makeEntity('a', 'Component')]
      const { container } = render(
        <OntologyFilter entities={entities} apiClient={apiClient} />,
      )
      // Either nothing rendered or only the collapsed section header — must
      // NOT throw and must NOT show any class rows.
      expect(
        container.querySelectorAll('[data-testid^="filter-ontology-row-"]')
          .length,
      ).toBe(0)
    })
  })

  describe('Test 10 (error fallback)', () => {
    test('rejected fetch → flat rows derived from entity classes', async () => {
      const apiClient = makeApiClient(new Error('network down'))
      const entities = [
        makeEntity('a', 'EntityClassA'),
        makeEntity('b', 'EntityClassB'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      expect(
        await screen.findByTestId('filter-ontology-row-EntityClassA'),
      ).toBeInTheDocument()
      expect(
        await screen.findByTestId('filter-ontology-row-EntityClassB'),
      ).toBeInTheDocument()
    })
  })

  describe('Micro-type exceptions (UI-SPEC §3 preserved verbatim)', () => {
    test('count badge uses text-[10px]', async () => {
      const apiClient = makeApiClient([
        { name: 'X' },
      ])
      const entities = [makeEntity('a', 'X')]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      const badge = await screen.findByTestId('filter-ontology-count-X')
      expect(badge.className).toMatch(/text-\[10px\]/)
    })
  })
})
