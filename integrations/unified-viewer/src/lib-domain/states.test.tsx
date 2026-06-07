// PATTERN SOURCE: 45-03-PLAN.md Task 1 States behavior tests
//
// State Contract verification — every copy string here MUST match
// UI-SPEC § Copywriting Contract VERBATIM. Drifting a string is a
// design-contract break.

import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  EmptyFilterState,
  EmptyNoDataState,
  EmptyNodeDetailState,
  EmptySearchState,
  ErrorCorsState,
  ErrorOntologyFetchState,
  ErrorUnreachableState,
  InitialLoadingState,
} from './states'

describe('State Contract components', () => {
  test('Test 1: InitialLoadingState renders Loader2 spinner + interpolated label', () => {
    render(<InitialLoadingState system="coding" />)
    expect(screen.getByTestId('state-initial-loading')).toBeInTheDocument()
    expect(screen.getByText(/Loading coding graph\.\.\./)).toBeInTheDocument()
  })

  test('Test 2: EmptyNoDataState heading + body copy verbatim with system interpolation', () => {
    render(<EmptyNoDataState system="okb" />)
    expect(screen.getByText('No entities yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        /This okb knowledge graph is empty\. Ingest data via okb's pipeline to see nodes appear here\./,
      ),
    ).toBeInTheDocument()
  })

  test('Test 3: EmptyFilterState — heading "No matches" + Clear filters button fires onClear', () => {
    const onClear = vi.fn()
    render(<EmptyFilterState onClear={onClear} />)
    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(screen.getByText('No entities match the current filter.')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Clear filters' })
    btn.click()
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test('Test 4: EmptySearchState — heading with query quoted + body verbatim', () => {
    render(<EmptySearchState query="foo" />)
    expect(screen.getByText('No matches for "foo"')).toBeInTheDocument()
    expect(
      screen.getByText('Try a different search term or clear it to see all entities.'),
    ).toBeInTheDocument()
  })

  test('Test 5: ErrorUnreachableState — destructive classes + body interpolation + Retry', () => {
    const onRetry = vi.fn()
    render(
      <ErrorUnreachableState
        system="cap"
        baseUrl="https://okm.cc.bmwgroup.net"
        onRetry={onRetry}
      />,
    )
    const banner = screen.getByTestId('state-error-unreachable')
    // Destructive banner classes from UI-SPEC State Contract row "Error (unreachable)"
    expect(banner.className).toMatch(/bg-destructive\/10/)
    expect(banner.className).toMatch(/border-destructive\/30/)
    expect(
      screen.getByText(
        /Cannot reach cap API at https:\/\/okm\.cc\.bmwgroup\.net\. Check that the service is running and accessible\./,
      ),
    ).toBeInTheDocument()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('Test 6: ErrorCorsState — CORS-specific copy with system + baseUrl interpolated', () => {
    render(<ErrorCorsState system="cap" baseUrl="https://x.example.com" />)
    expect(
      screen.getByText(
        /Browser blocked the request to https:\/\/x\.example\.com \(CORS\)\. The cap service must allow this origin or be reached through a proxy\./,
      ),
    ).toBeInTheDocument()
  })

  test('Test 7: ErrorOntologyFetchState — amber palette + verbatim copy', () => {
    render(<ErrorOntologyFetchState />)
    const banner = screen.getByTestId('state-error-ontology-fetch')
    expect(banner.className).toMatch(/bg-amber-500\/10/)
    expect(banner.className).toMatch(/border-amber-500\/30/)
    expect(
      screen.getByText(
        'Ontology metadata unavailable — node colors will use hash-based fallback.',
      ),
    ).toBeInTheDocument()
  })

  test('Test 8: EmptyNodeDetailState shows MousePointer + the verbatim panel-empty copy', () => {
    render(<EmptyNodeDetailState />)
    expect(screen.getByTestId('state-empty-node-detail')).toBeInTheDocument()
    expect(screen.getByText('Click any node to see its details.')).toBeInTheDocument()
  })
})
