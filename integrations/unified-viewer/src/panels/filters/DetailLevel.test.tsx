// DetailLevel — the control that replaced four checkboxes with one question.
//
// The rules worth pinning are not "the buttons render". They are:
//   1. each preset writes the exact flag triple the canvas needs,
//   2. the level is DERIVED from those flags, so Advanced cannot desync it,
//   3. a combination no preset produces reports `custom` rather than lying,
//   4. the presets are written in ONE store write — three separate writes
//      would restart the force simulation three times and jump the viewport.

import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore, deriveDetailLevel, DETAIL_LEVEL_FLAGS } from '@/store/viewer-store'
import { DetailLevel } from './DetailLevel'

function flags() {
  const s = useViewerStore.getState()
  return {
    hideRolledUp: s.hideRolledUp,
    collapseSubComponents: s.collapseSubComponents,
    aggregatesOnly: s.aggregatesOnly,
  }
}

describe('DetailLevel', () => {
  beforeEach(() => {
    cleanup()
    useViewerStore.setState({ ...DETAIL_LEVEL_FLAGS.overview })
  })

  test('defaults to overview — the flag triple the rail ships with', () => {
    render(<DetailLevel />)
    expect(deriveDetailLevel(flags())).toBe('overview')
  })

  test('each preset writes its exact flag triple', () => {
    render(<DetailLevel />)

    fireEvent.click(screen.getByTestId('detail-level-full'))
    expect(flags()).toEqual(DETAIL_LEVEL_FLAGS.full)

    fireEvent.click(screen.getByTestId('detail-level-summary'))
    expect(flags()).toEqual(DETAIL_LEVEL_FLAGS.summary)

    fireEvent.click(screen.getByTestId('detail-level-overview'))
    expect(flags()).toEqual(DETAIL_LEVEL_FLAGS.overview)
  })

  test('summary is the only preset that turns aggregatesOnly on', () => {
    // This is what makes it the <=10 view — roll-up parents plus the
    // architecture backbone, nothing else.
    expect(DETAIL_LEVEL_FLAGS.full.aggregatesOnly).toBe(false)
    expect(DETAIL_LEVEL_FLAGS.overview.aggregatesOnly).toBe(false)
    expect(DETAIL_LEVEL_FLAGS.summary.aggregatesOnly).toBe(true)
  })

  test('reports custom when the Advanced switches make a non-preset combination', () => {
    render(<DetailLevel />)
    expect(screen.queryByTestId('detail-level-custom')).toBeNull()

    // aggregatesOnly on WITHOUT the collapse — no preset produces this.
    useViewerStore.setState({ aggregatesOnly: true, collapseSubComponents: false })
    cleanup()
    render(<DetailLevel />)

    expect(deriveDetailLevel(flags())).toBe('custom')
    expect(screen.getByTestId('detail-level-custom')).toBeInTheDocument()
  })

  test('the level is derived, not stored — no detailLevel key in the store', () => {
    // A stored copy would go stale the moment Advanced moved a flag, and the
    // control would then claim a level the canvas is not showing.
    expect('detailLevel' in useViewerStore.getState()).toBe(false)
  })

  test('applies a preset in ONE store write (viewport stability)', () => {
    render(<DetailLevel />)
    let writes = 0
    const unsub = useViewerStore.subscribe(() => {
      writes += 1
    })
    fireEvent.click(screen.getByTestId('detail-level-summary'))
    unsub()
    // Three flags, one write. More than one restarts the force simulation
    // repeatedly and the canvas jumps under the operator.
    expect(writes).toBe(1)
  })

  test('re-clicking the active level does not clear the selection', () => {
    // Radix unsets the value when the active item is clicked again; the
    // handler must treat that as a no-op rather than a jump to nothing.
    render(<DetailLevel />)
    fireEvent.click(screen.getByTestId('detail-level-overview'))
    expect(deriveDetailLevel(flags())).toBe('overview')
  })

  test('renders the node count and the unanchored count when given them', () => {
    render(<DetailLevel visibleCount={25} unanchoredCount={132} />)
    expect(screen.getByTestId('detail-level-readout').textContent).toMatch(/25 nodes/)
    expect(screen.getByTestId('detail-level-unanchored').textContent).toMatch(/132 unanchored/)
  })

  test('hides the unanchored figure when there is nothing unanchored', () => {
    render(<DetailLevel visibleCount={10} unanchoredCount={0} />)
    expect(screen.queryByTestId('detail-level-unanchored')).toBeNull()
  })
})
