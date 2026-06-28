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
  within,
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

  describe('Test 6b (2026-06-28 regression): group all/none respects the empty="all visible" sentinel', () => {
    // Bug: from the default [] ("all visible") state, clicking [all] on the
    // COMPONENT group collapsed selectedOntologyClasses to just that group's
    // L2 children — which DESELECTED the L0 anchors (Project, System). [none]
    // emptied the array back to [] which the sentinel reads as "all visible",
    // re-checking everything. Group buttons must now materialise the full set
    // first (like the per-row checkbox already did).
    const schema = [
      { name: 'System', level: 0, parent: null },
      { name: 'Project', level: 0, parent: null },
      { name: 'Component', level: 1, parent: null },
      { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
      { name: 'ConstraintMonitor', level: 2, parent: 'Component' },
    ]
    const makeEntities = () => [
      makeEntity('a', 'System'),
      makeEntity('b', 'Project'),
      makeEntity('c', 'LiveLoggingSystem'),
      makeEntity('d', 'ConstraintMonitor'),
    ]

    test('[all] on COMPONENT from [] does NOT deselect the Project/System L0 anchors', async () => {
      useViewerStore.setState({ selectedOntologyClasses: [] }) // "all visible"
      render(<OntologyFilter entities={makeEntities()} apiClient={makeApiClient(schema)} />)
      fireEvent.click(await screen.findByTestId('filter-ontology-all-Component'))
      const sel = useViewerStore.getState().selectedOntologyClasses
      // The L0 anchors must remain selected (the reported regression).
      expect(sel).toContain('System')
      expect(sel).toContain('Project')
      expect(sel).toContain('LiveLoggingSystem')
      expect(sel).toContain('ConstraintMonitor')
    })

    test('[none] on COMPONENT from [] hides only the components, keeps the L0 anchors (not "all visible")', async () => {
      useViewerStore.setState({ selectedOntologyClasses: [] }) // "all visible"
      render(<OntologyFilter entities={makeEntities()} apiClient={makeApiClient(schema)} />)
      fireEvent.click(await screen.findByTestId('filter-ontology-none-Component'))
      const sel = useViewerStore.getState().selectedOntologyClasses
      // Must NOT collapse back to [] ("all visible") — Project/System stay,
      // the component children are removed.
      expect(sel).not.toEqual([])
      expect(sel).toContain('System')
      expect(sel).toContain('Project')
      expect(sel).not.toContain('LiveLoggingSystem')
      expect(sel).not.toContain('ConstraintMonitor')
    })
  })

  describe('Test 6c (2026-06-28 regression): L1 class that ALSO carries entities is self-selectable', () => {
    // Bug: `Detail` (level 1, parent SubComponent) heads a child group of
    // level-2 Online* classes, so it rendered as a group header — but the
    // header had no checkbox of its own. `Detail` was the single largest class
    // (642 nodes) yet could never be deselected, so the graph barely shrank
    // when the user unchecked the visible groups. The header must now carry a
    // self-checkbox + count, and its all/none must include the parent class.
    const schema = [
      { name: 'SubComponent', level: 1, parent: null },
      { name: 'Detail', level: 1, parent: 'SubComponent' },
      { name: 'OnlineObservation', level: 2, parent: 'Detail' },
      { name: 'OnlineInsight', level: 2, parent: 'Detail' },
    ]
    const makeEntities = () => [
      makeEntity('a', 'Detail'),
      makeEntity('b', 'Detail'),
      makeEntity('c', 'OnlineObservation'),
      makeEntity('d', 'SubComponent'),
    ]

    test('the Detail group header renders its own checkbox + count', async () => {
      useViewerStore.setState({ selectedOntologyClasses: [] })
      render(<OntologyFilter entities={makeEntities()} apiClient={makeApiClient(schema)} />)
      const selfBox = await screen.findByTestId('filter-ontology-l1-self-Detail')
      expect(selfBox).toBeInTheDocument()
      expect(
        await screen.findByTestId('filter-ontology-l1-count-Detail'),
      ).toHaveTextContent('2')
    })

    test('[none] on the Detail group removes the Detail class itself (its nodes can be hidden)', async () => {
      useViewerStore.setState({ selectedOntologyClasses: [] }) // "all visible"
      render(<OntologyFilter entities={makeEntities()} apiClient={makeApiClient(schema)} />)
      fireEvent.click(await screen.findByTestId('filter-ontology-none-Detail'))
      const sel = useViewerStore.getState().selectedOntologyClasses
      // The parent class is now removable — the core fix.
      expect(sel).not.toContain('Detail')
      expect(sel).not.toContain('OnlineObservation')
      // Sibling class outside the group is untouched.
      expect(sel).toContain('SubComponent')
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

  describe('Test 11 (60-09 SC#5): level-None classes entities carry render as flat rows', () => {
    test('Insight + Digest (level: null) render as selectable flat rows with counts, not dropped', async () => {
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        // level-None classes — runtime value stays null; cast satisfies
        // OntologyClass.level (number | undefined) at compile time.
        { name: 'Insight', level: null as unknown as undefined, parent: null },
        { name: 'Digest', level: null as unknown as undefined, parent: null },
      ])
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'Insight'),
        makeEntity('c', 'Insight'),
        makeEntity('d', 'Digest'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      await waitFor(() => {
        expect(apiClient.listOntologyClasses).toHaveBeenCalled()
      })
      // Both level-None rows render (previously silently dropped).
      const insightRow = await screen.findByTestId('filter-ontology-row-Insight')
      const digestRow = await screen.findByTestId('filter-ontology-row-Digest')
      expect(insightRow).toBeInTheDocument()
      expect(digestRow).toBeInTheDocument()
      // Real per-class counts.
      expect(screen.getByTestId('filter-ontology-count-Insight')).toHaveTextContent('2')
      expect(screen.getByTestId('filter-ontology-count-Digest')).toHaveTextContent('1')
      // They live in the dedicated level-None section.
      expect(
        screen.getByTestId('filter-ontology-level-none-flat'),
      ).toBeInTheDocument()
    })

    test('selecting a level-None flat row toggles selectedOntologyClasses', async () => {
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'Insight', level: null as unknown as undefined, parent: null },
      ])
      const entities = [makeEntity('a', 'Component'), makeEntity('b', 'Insight')]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      const insightRow = await screen.findByTestId('filter-ontology-row-Insight')
      fireEvent.click(within(insightRow).getByRole('checkbox'))
      // Materialised the available set then toggled Insight OFF -> remaining = ['Component'].
      expect(useViewerStore.getState().selectedOntologyClasses).toContain('Component')
      expect(useViewerStore.getState().selectedOntologyClasses).not.toContain('Insight')
    })
  })

  describe('Test 12 (60-09 SC#5): Project at level:0 renders as an L0 anchor', () => {
    test('Project (level:0) appears in the L0 anchors section alongside System', async () => {
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
      const anchors = await screen.findByTestId('filter-ontology-l0-anchors')
      expect(within(anchors).getByTestId('filter-ontology-row-System')).toBeInTheDocument()
      expect(within(anchors).getByTestId('filter-ontology-row-Project')).toBeInTheDocument()
    })
  })

  describe('Test 13 (60-09 SC#5): L2 group renders with non-zero count badges', () => {
    test('L2 children under Component show real per-class counts > 0', async () => {
      const apiClient = makeApiClient([
        { name: 'Component', level: 1, parent: null },
        { name: 'LiveLoggingSystem', level: 2, parent: 'Component' },
        { name: 'OnlineObservation', level: 2, parent: 'Detail' },
        { name: 'Detail', level: 1, parent: null },
      ])
      const entities = [
        makeEntity('a', 'LiveLoggingSystem'),
        makeEntity('b', 'LiveLoggingSystem'),
        makeEntity('c', 'OnlineObservation'),
        makeEntity('d', 'OnlineObservation'),
        makeEntity('e', 'OnlineObservation'),
      ]
      render(<OntologyFilter entities={entities} apiClient={apiClient} />)
      await waitFor(() => {
        expect(apiClient.listOntologyClasses).toHaveBeenCalled()
      })
      expect(
        await screen.findByTestId('filter-ontology-row-LiveLoggingSystem'),
      ).toBeInTheDocument()
      expect(screen.getByTestId('filter-ontology-count-LiveLoggingSystem')).toHaveTextContent('2')
      expect(screen.getByTestId('filter-ontology-count-OnlineObservation')).toHaveTextContent('3')
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
