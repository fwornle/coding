// PATTERN SOURCE: 55-10-PLAN.md Task 2 <behavior>
//   + 55-PATTERNS.md § IssueTriageView.tsx (BFS pattern)
//   + 55-UI-SPEC.md §5 (Triage copy) + §6 (layout map) + §9 (mode switching)
//     + §10 (click semantics Triage rows)
//
// Behavior covered (the plan's <behavior> block):
//   - Test 1: layout — left pane w-[380px] + right pane flex-1
//   - Test 2: incident list seeded from entities filtered by entityType ∈ {Incident, FailureIncident}
//   - Test 3: search input filters incident list by name (case-insensitive)
//   - Test 4: clicking incident sets internal selectedKey + RCA chain renders
//   - Test 5: BFS adjacency renders 6 SECTION_ORDER sections in fixed order
//   - Test 6: chain item click → setSelectedNodeId(item.entity.id)
//   - Test 7: "View in Graph" CTA → setMode('kg')
//   - Test 8: Sources & Evidence imports from @/lib-domain/evidence-types
//   - Test 9: empty-state copies (left + right) match UI-SPEC §5 verbatim
//   - Test 10: data-testid="issue-triage-view" on root element
//   - Test 11: Logger.info(PANELS) on incident selection
//   - Test 12: ZERO raw console.* (source-level audit)

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity, Relation } from '@/graph/types'

// IssueTriageView reads entities/relations from useGraphData via the store-
// adapter pattern matching IssueTriage.tsx (VOKB Redux selector → here a
// hook prop). We pass them as props for testability — matches the executor
// pattern used elsewhere in this codebase (StatsBar takes apiClient as a
// prop; IssueTriageView takes the resolved entities/relations).

import IssueTriageView from './IssueTriageView'

// ---- Fixtures ----------------------------------------------------------

function makeIncident(id: string, name: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    name,
    ontologyClass: 'FailureIncident',
    entityType: 'FailureIncident',
    description: `Description for ${name}`,
    ...extra,
  } as Entity
}

function makeEntity(id: string, name: string, entityType: string): Entity {
  return {
    id,
    name,
    ontologyClass: entityType,
    entityType,
    description: `Description for ${name}`,
  } as Entity
}

const SAMPLE_ENTITIES: Entity[] = [
  makeIncident('inc-1', 'Cluster wide latency spike'),
  makeIncident('inc-2', 'Search index corrupted'),
  makeEntity('sym-1', 'p99 latency > 5s', 'Symptom'),
  makeEntity('rc-1', 'Disk full on coordinator', 'RootCause'),
  makeEntity('res-1', 'Rotate coordinator volume', 'Resolution'),
  makeEntity('fp-1', 'Lossy network partition', 'FailurePattern'),
  makeEntity('risk-1', 'Cascade risk during failover', 'Risk'),
  makeEntity('dec-1', 'Use quorum-based reads', 'Decision'),
  makeEntity('unrelated-1', 'Just a passing observation', 'Observation'),
]

const SAMPLE_RELATIONS: Relation[] = [
  { from: 'inc-1', to: 'sym-1', type: 'HAS_SYMPTOM' },
  { from: 'inc-1', to: 'rc-1', type: 'HAS_ROOT_CAUSE' },
  { from: 'rc-1', to: 'res-1', type: 'MITIGATED_BY' },
  { from: 'inc-1', to: 'fp-1', type: 'MATCHES' },
  { from: 'inc-1', to: 'risk-1', type: 'INDICATES' },
  { from: 'inc-1', to: 'dec-1', type: 'ADDRESSES' },
  // An unrelated edge that should NOT pull non-RCA neighbors past depth 0
  { from: 'sym-1', to: 'unrelated-1', type: 'MENTIONED_BY' },
]

beforeEach(() => {
  // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set + focal.
  useViewerStore.getState().setSelectedNode(null)
  useViewerStore.setState({ mode: 'triage' })
})

afterEach(() => {
  cleanup()
})

describe('IssueTriageView', () => {
  test('Test 1: layout has left pane w-[380px] and right pane flex-1', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    const root = screen.getByTestId('issue-triage-view')
    expect(root).toBeInTheDocument()
    const left = screen.getByTestId('triage-left-pane')
    expect(left.className).toMatch(/w-\[380px\]/)
    const right = screen.getByTestId('triage-right-pane')
    expect(right.className).toMatch(/flex-1/)
  })

  test('Test 2: incident list shows only Incident/FailureIncident entities', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    expect(screen.getByText('Cluster wide latency spike')).toBeInTheDocument()
    expect(screen.getByText('Search index corrupted')).toBeInTheDocument()
    // Non-incidents must not appear in the left list (they may appear in
    // the right pane after selection, but the left list is incidents-only).
    const list = screen.getByTestId('triage-incident-list')
    expect(list.textContent).not.toMatch(/p99 latency/)
    expect(list.textContent).not.toMatch(/Disk full/)
  })

  test('Test 3: search input filters incident list by name (case-insensitive)', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    const search = screen.getByTestId('triage-incident-search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'CLUSTER' } })
    expect(screen.queryByText('Cluster wide latency spike')).toBeInTheDocument()
    expect(screen.queryByText('Search index corrupted')).toBeNull()
  })

  test('Test 4: clicking incident sets internal selectedKey and renders RCA chain', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    // Pre-selection: right pane shows "Select an incident to investigate."
    expect(screen.getByText('Select an incident to investigate.')).toBeInTheDocument()
    const inc1 = screen.getByTestId('triage-incident-inc-1')
    fireEvent.click(inc1)
    // RCA chain renders after selection — at least one of the section
    // headers appears.
    expect(screen.queryByText('Select an incident to investigate.')).toBeNull()
  })

  test('Test 5: BFS renders 6 SECTION_ORDER sections in fixed order with the correct entities', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    fireEvent.click(screen.getByTestId('triage-incident-inc-1'))

    // Verify the sections appear in the correct order. SECTION_ORDER is
    // [Symptom, FailurePattern, RootCause, Resolution, Risk, Decision].
    expect(screen.getByTestId('rca-section-Symptom')).toBeInTheDocument()
    expect(screen.getByTestId('rca-section-FailurePattern')).toBeInTheDocument()
    expect(screen.getByTestId('rca-section-RootCause')).toBeInTheDocument()
    expect(screen.getByTestId('rca-section-Resolution')).toBeInTheDocument()
    expect(screen.getByTestId('rca-section-Risk')).toBeInTheDocument()
    expect(screen.getByTestId('rca-section-Decision')).toBeInTheDocument()

    // The right entity in each section
    expect(screen.getByText('p99 latency > 5s')).toBeInTheDocument()
    expect(screen.getByText('Lossy network partition')).toBeInTheDocument()
    expect(screen.getByText('Disk full on coordinator')).toBeInTheDocument()
    // Resolution sits 2 hops away (rc-1 → res-1 via MITIGATED_BY)
    expect(screen.getByText('Rotate coordinator volume')).toBeInTheDocument()
    expect(screen.getByText('Cascade risk during failover')).toBeInTheDocument()
    expect(screen.getByText('Use quorum-based reads')).toBeInTheDocument()

    // The non-RCA neighbor must NOT appear in the chain (filtered out
    // because depth > 0 and the edge type is NOT in RCA_EDGE_TYPES).
    expect(screen.queryByText('Just a passing observation')).toBeNull()

    // Order check — the section testids must appear in SECTION_ORDER.
    const allSections = Array.from(
      document.querySelectorAll('[data-testid^="rca-section-"]'),
    ).map((el) => el.getAttribute('data-testid'))
    const expectedOrder = [
      'rca-section-Symptom',
      'rca-section-FailurePattern',
      'rca-section-RootCause',
      'rca-section-Resolution',
      'rca-section-Risk',
      'rca-section-Decision',
    ]
    expect(allSections).toEqual(expectedOrder)
  })

  test('Test 6: clicking chain item calls setSelectedNodeId(item.entity.id)', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    fireEvent.click(screen.getByTestId('triage-incident-inc-1'))
    const chainItem = screen.getByTestId('rca-chain-item-sym-1')
    fireEvent.click(chainItem)
    expect(useViewerStore.getState().focalNodeId).toBe('sym-1')
  })

  test('Test 7: "View in Graph" CTA → setMode("kg") and preserves selection', () => {
    useViewerStore.setState({ mode: 'triage' })
    useViewerStore.getState().setSelectedNode('sym-1')
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    fireEvent.click(screen.getByTestId('triage-incident-inc-1'))
    const cta = screen.getByTestId('view-in-graph')
    fireEvent.click(cta)
    expect(useViewerStore.getState().mode).toBe('kg')
    // focalNodeId is set on chain-item click; the CTA itself just flips
    // the mode (per the plan's <action> block).
    expect(useViewerStore.getState().focalNodeId).toBe('inc-1')
  })

  test('Test 8: Sources & Evidence imports from @/lib-domain/evidence-types (source-grep)', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/IssueTriageView.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).toMatch(/from\s+['"]@\/lib-domain\/evidence-types['"]/)
    // Also assert NO locally-declared EVIDENCE_TYPE_ICONS / EVIDENCE_TYPE_LABELS
    expect(src).not.toMatch(/const EVIDENCE_TYPE_ICONS:/)
    expect(src).not.toMatch(/const EVIDENCE_TYPE_LABELS:/)
  })

  test('Test 9a: empty-state copy (left) when no incidents in dataset', () => {
    // Strip incidents from the dataset entirely.
    const noIncidents = SAMPLE_ENTITIES.filter(
      (e) => !/incident|failureincident/i.test(String(e.entityType ?? e.ontologyClass)),
    )
    render(<IssueTriageView entities={noIncidents} relations={SAMPLE_RELATIONS} />)
    expect(
      screen.getByText('No incidents in knowledge base. Ingest data to populate.'),
    ).toBeInTheDocument()
  })

  test('Test 9b: empty-state copy (right) before selection', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    expect(screen.getByText('Select an incident to investigate.')).toBeInTheDocument()
  })

  test('Test 10: root element carries data-testid="issue-triage-view"', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    expect(screen.getByTestId('issue-triage-view')).toBeInTheDocument()
  })

  test('Test 11: Logger.info(PANELS) fires on incident selection', async () => {
    const { Logger } = await import('@/lib/logging')
    const spy = vi.spyOn(Logger, 'info')
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    fireEvent.click(screen.getByTestId('triage-incident-inc-1'))
    expect(spy).toHaveBeenCalled()
    const calls = spy.mock.calls as unknown as [string, ...unknown[]][]
    expect(calls.some((c) => c[0] === Logger.Categories.PANELS)).toBe(true)
    spy.mockRestore()
  })

  test('Test 12: searching with no matches shows the empty match message', () => {
    render(<IssueTriageView entities={SAMPLE_ENTITIES} relations={SAMPLE_RELATIONS} />)
    const search = screen.getByTestId('triage-incident-search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'nomatch-zzz' } })
    expect(screen.queryByText('Cluster wide latency spike')).toBeNull()
    expect(screen.queryByText('Search index corrupted')).toBeNull()
  })
})

describe('IssueTriageView — Logger discipline + structural greps', () => {
  test('ZERO raw console.* in IssueTriageView.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/IssueTriageView.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })

  test('uses RCA_EDGE_TYPES + SECTION_ORDER + SECTION_META + setMode + setSelectedNodeId', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/IssueTriageView.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).toMatch(/RCA_EDGE_TYPES/)
    expect(src).toMatch(/SECTION_ORDER/)
    expect(src).toMatch(/SECTION_META/)
    expect(src).toMatch(/EVIDENCE_TYPE_ICONS/)
    expect(src).toMatch(/setMode/)
    expect(src).toMatch(/setSelectedNode/) // store action name is setSelectedNode
  })

  test('RCA_EDGE_TYPES contains the 12 locked edge types verbatim from VOKB', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/IssueTriageView.tsx')
    const src = readFileSync(filePath, 'utf8')
    const expected = [
      'HAS_SYMPTOM', 'HAS_ROOT_CAUSE', 'CAUSED', 'CAUSED_BY',
      'INDICATES', 'MITIGATED_BY', 'MITIGATES', 'ADDRESSES',
      'MATCHES', 'DERIVED_FROM', 'AFFECTS', 'APPLIED_TO',
    ]
    for (const edge of expected) {
      expect(src.includes(`'${edge}'`)).toBe(true)
    }
  })

  test('default export present (single occurrence)', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/IssueTriageView.tsx')
    const src = readFileSync(filePath, 'utf8')
    const matches = src.match(/export default/g) || []
    expect(matches.length).toBe(1)
  })
})
