// PATTERN SOURCE: 55-08-PLAN.md Task 1 + 55-PATTERNS.md § DomainFilter
//
// VOKB analog: _work/.../viewer/src/components/Filters/DomainFilter.tsx
//
// Verifies:
//   - On okb-shaped data (entities with .domain), renders RaaS/KPI-FW/General with counts
//   - On coding-shaped data (no entities have .domain), renders italic muted
//     "Domain filter not applicable for this system" (UI-SPEC §7 row 3 graceful degradation)
//   - Clicking RaaS calls store.toggleDomain('raas')
//   - Empty selectedDomains = "all visible"

import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/api/ApiClient'
import { DomainFilter } from './DomainFilter'

describe('DomainFilter', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedDomains: [],
    })
    cleanup()
  })

  test('renders Domain group header', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X', domain: 'raas' },
    ] as unknown as Entity[]
    render(<DomainFilter entities={entities} />)
    expect(screen.getByText('Domain')).toBeInTheDocument()
  })

  test('on okb data with entity.domain set, renders RaaS / KPI-FW / General checkboxes with counts', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X', domain: 'raas' },
      { id: 'b', name: 'B', ontologyClass: 'X', domain: 'raas' },
      { id: 'c', name: 'C', ontologyClass: 'X', domain: 'kpifw' },
      { id: 'd', name: 'D', ontologyClass: 'X', domain: 'general' },
    ] as unknown as Entity[]
    render(<DomainFilter entities={entities} />)
    expect(screen.getByText('RaaS')).toBeInTheDocument()
    expect(screen.getByText('KPI-FW')).toBeInTheDocument()
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByTestId('filter-domain-count-raas').textContent).toBe('2')
    expect(screen.getByTestId('filter-domain-count-kpifw').textContent).toBe('1')
    expect(screen.getByTestId('filter-domain-count-general').textContent).toBe('1')
  })

  test('on coding-tab data where NO entity has .domain, renders graceful degradation italic message', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'Component' },
      { id: 'b', name: 'B', ontologyClass: 'Project' },
    ] as unknown as Entity[]
    render(<DomainFilter entities={entities} />)
    const msg = screen.getByTestId('filter-domain-not-applicable')
    expect(msg.textContent).toMatch(/not applicable/i)
    expect(msg.className).toMatch(/italic/)
    // Does NOT throw, does NOT render the domain checkboxes
    expect(screen.queryByTestId('filter-domain-raas')).toBeNull()
  })

  test('clicking RaaS calls store.toggleDomain("raas")', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X', domain: 'raas' },
    ] as unknown as Entity[]
    render(<DomainFilter entities={entities} />)
    const wrapper = screen.getByTestId('filter-domain-raas')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().selectedDomains).toContain('raas')
  })

  test('empty selectedDomains → isSelected("raas") is true (all-visible semantic)', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X', domain: 'raas' },
    ] as unknown as Entity[]
    render(<DomainFilter entities={entities} />)
    const wrapper = screen.getByTestId('filter-domain-raas')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    expect(cb.getAttribute('data-state')).toBe('checked')
  })

  test('count badge uses text-[10px] micro-type', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X', domain: 'raas' },
    ] as unknown as Entity[]
    render(<DomainFilter entities={entities} />)
    const badge = screen.getByTestId('filter-domain-count-raas')
    expect(badge.className).toMatch(/text-\[10px\]/)
  })

  test('empty entities list also renders the not-applicable message (no entities = no .domain anywhere)', () => {
    render(<DomainFilter entities={[]} />)
    expect(screen.getByTestId('filter-domain-not-applicable')).toBeInTheDocument()
  })
})
