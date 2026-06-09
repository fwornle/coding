// PATTERN SOURCE: 55-08-PLAN.md Task 2 + 55-PATTERNS.md § OntologyFilter
//
// VOKB analog: _work/.../viewer/src/components/Filters/OntologyFilter.tsx
//
// Verifies:
//   - Default groupingSchema = VOKB_SCHEMA → Upper / Lower groups
//   - groupingSchema={CODING_SCHEMA} → Hierarchy / Typed Views groups
//   - Per-class checkbox row uses text-xs label + text-[10px] count badge
//   - Group all/none toggles use text-[9px]; disclosure triangle text-[8px]
//   - Unknown classes land in catch-all "Other" group (VOKB rule preserved)
//   - all/none operate union-add / filter-remove (NOT replace)
//   - Per-class toggle calls toggleOntologyClass(cls)

import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/api/ApiClient'
import {
  OntologyFilter,
  VOKB_SCHEMA,
  CODING_SCHEMA,
} from './OntologyFilter'

function makeEntity(id: string, ontologyClass: string): Entity {
  return { id, name: id, ontologyClass } as Entity
}

describe('OntologyFilter', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedOntologyClasses: [],
    })
    cleanup()
  })

  describe('schema constants', () => {
    test('VOKB_SCHEMA exposes Upper Ontology (Execution Model + Failure Model)', () => {
      expect(VOKB_SCHEMA.upper.name).toBe('Upper Ontology')
      expect(Object.keys(VOKB_SCHEMA.upper.subgroups)).toContain('Execution Model')
      expect(Object.keys(VOKB_SCHEMA.upper.subgroups)).toContain('Failure Model')
      expect(VOKB_SCHEMA.upper.subgroups['Execution Model'].has('Component')).toBe(true)
      expect(VOKB_SCHEMA.upper.subgroups['Failure Model'].has('RootCause')).toBe(true)
    })

    test('VOKB_SCHEMA exposes Lower Ontology (RaaS / KPI-FW / Business)', () => {
      expect(VOKB_SCHEMA.lower.name).toBe('Lower Ontology')
      expect(VOKB_SCHEMA.lower.subgroups['RaaS'].has('RPU')).toBe(true)
      expect(VOKB_SCHEMA.lower.subgroups['KPI-FW'].has('KPIDefinition')).toBe(true)
      expect(VOKB_SCHEMA.lower.subgroups['Business'].has('Decision')).toBe(true)
    })

    test('CODING_SCHEMA exposes Hierarchy (L0..L3) + Typed Views (LSL Pipeline / Patterns / Other)', () => {
      expect(CODING_SCHEMA.upper.name).toBe('Hierarchy')
      expect(CODING_SCHEMA.upper.subgroups['L0 — Project'].has('Project')).toBe(true)
      expect(CODING_SCHEMA.upper.subgroups['L1 — Component'].has('Component')).toBe(true)
      expect(CODING_SCHEMA.upper.subgroups['L2 — SubComponent'].has('SubComponent')).toBe(true)
      expect(CODING_SCHEMA.upper.subgroups['L3 — Detail'].has('Detail')).toBe(true)
      expect(CODING_SCHEMA.lower.name).toBe('Typed Views')
      expect(CODING_SCHEMA.lower.subgroups['LSL Pipeline'].has('Observation')).toBe(true)
      expect(CODING_SCHEMA.lower.subgroups['LSL Pipeline'].has('Insight')).toBe(true)
    })
  })

  describe('rendering with VOKB_SCHEMA (default)', () => {
    test('renders Upper Ontology and Lower Ontology section headers', () => {
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'RPU'),
      ]
      render(<OntologyFilter entities={entities} />)
      expect(screen.getByText('Upper Ontology')).toBeInTheDocument()
      expect(screen.getByText('Lower Ontology')).toBeInTheDocument()
    })

    test('renders Execution Model and Failure Model sub-groups under Upper Ontology', () => {
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'RootCause'),
      ]
      render(<OntologyFilter entities={entities} />)
      expect(screen.getByText('Execution Model')).toBeInTheDocument()
      expect(screen.getByText('Failure Model')).toBeInTheDocument()
    })

    test('per-class checkbox row uses text-xs label + text-[10px] count badge', () => {
      const entities = [makeEntity('a', 'Component'), makeEntity('b', 'Component')]
      render(<OntologyFilter entities={entities} />)
      const lbl = screen.getByTestId('filter-ontology-label-Component')
      expect(lbl.className).toMatch(/text-xs/)
      const badge = screen.getByTestId('filter-ontology-count-Component')
      expect(badge.textContent).toBe('2')
      expect(badge.className).toMatch(/text-\[10px\]/)
    })
  })

  describe('rendering with CODING_SCHEMA', () => {
    test('renders Hierarchy and Typed Views section headers', () => {
      const entities = [
        makeEntity('a', 'Project'),
        makeEntity('b', 'Observation'),
      ]
      render(<OntologyFilter entities={entities} groupingSchema={CODING_SCHEMA} />)
      expect(screen.getByText('Hierarchy')).toBeInTheDocument()
      expect(screen.getByText('Typed Views')).toBeInTheDocument()
    })

    test('renders L0 — Project / L1 — Component / L2 — SubComponent / L3 — Detail sub-groups', () => {
      const entities = [
        makeEntity('a', 'Project'),
        makeEntity('b', 'Component'),
        makeEntity('c', 'SubComponent'),
        makeEntity('d', 'Detail'),
      ]
      render(<OntologyFilter entities={entities} groupingSchema={CODING_SCHEMA} />)
      expect(screen.getByText('L0 — Project')).toBeInTheDocument()
      expect(screen.getByText('L1 — Component')).toBeInTheDocument()
      expect(screen.getByText('L2 — SubComponent')).toBeInTheDocument()
      expect(screen.getByText('L3 — Detail')).toBeInTheDocument()
    })

    test('LSL Pipeline subgroup includes Observation / Digest / Insight / LearningArtifact', () => {
      const entities = [
        makeEntity('a', 'Observation'),
        makeEntity('b', 'Digest'),
        makeEntity('c', 'Insight'),
        makeEntity('d', 'LearningArtifact'),
      ]
      render(<OntologyFilter entities={entities} groupingSchema={CODING_SCHEMA} />)
      expect(screen.getByText('LSL Pipeline')).toBeInTheDocument()
    })
  })

  describe('catch-all "Other" group (VOKB rule preserved)', () => {
    test('unknown classes that match no subgroup land in catch-all Other group', () => {
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'CompletelyUnknownClass'),
      ]
      render(<OntologyFilter entities={entities} />)
      // CompletelyUnknownClass is not in VOKB Upper or Lower → falls to "Other"
      expect(screen.getByText('Other')).toBeInTheDocument()
      expect(screen.getByTestId('filter-ontology-row-CompletelyUnknownClass')).toBeInTheDocument()
    })
  })

  describe('selection behavior', () => {
    test('clicking a class checkbox calls toggleOntologyClass with that class', () => {
      const entities = [makeEntity('a', 'Component')]
      render(<OntologyFilter entities={entities} />)
      const row = screen.getByTestId('filter-ontology-row-Component')
      const cb = row.querySelector('button[role="checkbox"]') as HTMLElement
      fireEvent.click(cb)
      expect(useViewerStore.getState().selectedOntologyClasses).toContain('Component')
    })

    test('group "all" UNION-ADDS the group classes to the current selection (does NOT replace)', () => {
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'DataAsset'),
        makeEntity('c', 'RPU'),
      ]
      // pre-seed selection with RPU
      useViewerStore.setState({ selectedOntologyClasses: ['RPU'] })
      render(<OntologyFilter entities={entities} />)
      const allBtn = screen.getByTestId('filter-ontology-all-Execution Model')
      fireEvent.click(allBtn)
      const sel = useViewerStore.getState().selectedOntologyClasses
      // RPU preserved (NOT replaced); Execution Model classes added
      expect(sel).toContain('RPU')
      expect(sel).toContain('Component')
      expect(sel).toContain('DataAsset')
    })

    test('group "none" filter-REMOVES the group classes from the current selection', () => {
      const entities = [
        makeEntity('a', 'Component'),
        makeEntity('b', 'RPU'),
      ]
      // pre-seed selection with one Upper class and one Lower class
      useViewerStore.setState({ selectedOntologyClasses: ['Component', 'RPU'] })
      render(<OntologyFilter entities={entities} />)
      const noneBtn = screen.getByTestId('filter-ontology-none-Execution Model')
      fireEvent.click(noneBtn)
      const sel = useViewerStore.getState().selectedOntologyClasses
      // RPU preserved; Component removed
      expect(sel).toContain('RPU')
      expect(sel).not.toContain('Component')
    })
  })

  describe('micro-type exceptions (UI-SPEC §3 preserved verbatim)', () => {
    test('group all/none toggles use text-[9px]', () => {
      const entities = [makeEntity('a', 'Component')]
      render(<OntologyFilter entities={entities} />)
      const allBtn = screen.getByTestId('filter-ontology-all-Execution Model')
      expect(allBtn.className).toMatch(/text-\[9px\]/)
      const noneBtn = screen.getByTestId('filter-ontology-none-Execution Model')
      expect(noneBtn.className).toMatch(/text-\[9px\]/)
    })

    test('group header disclosure triangle uses text-[8px] (NOT on text content)', () => {
      const entities = [makeEntity('a', 'Component')]
      render(<OntologyFilter entities={entities} />)
      const tri = screen.getByTestId('filter-ontology-triangle-upper')
      expect(tri.className).toMatch(/text-\[8px\]/)
    })
  })
})
