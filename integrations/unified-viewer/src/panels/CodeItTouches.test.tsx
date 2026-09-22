// The bottom of the intent drill, and the reverse join back up it.
//
// What these tests exist to prevent:
//
//  - the block appearing on rows with no file evidence, where it would be an
//    empty box implying the data is missing rather than absent;
//  - the provenance line claiming more coverage than it has — "172 files" with
//    no statement of how many lessons they came from reads as a complete map;
//  - a file focus landing on the canvas as an island, i.e. the lessons without
//    the code they sit under;
//  - the synthetic focus root leaking into the filter set as a member that
//    matches no entity;
//  - the focus failing to toggle off, which would leave the canvas stuck with
//    no way back except the chip.

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import CodeItTouches from './CodeItTouches'
import { useViewerStore } from '@/store/viewer-store'
import { fileFocusId, type ReachInsight } from '@/graph/intent-code-reach'

const lesson = (id: string, files?: string[], at = '2026-09-19T11:35:05Z'): ReachInsight => ({
  id,
  name: `lesson ${id}`,
  metadata: files ? { codeVerification: { verifiedAt: at, referencedFiles: files } } : {},
})

// i1 sits under sc1 ─ c1 ─ p1; i2 under c2 ─ p1.
const PARENTS = new Map<string, string>([
  ['c1', 'p1'],
  ['c2', 'p1'],
  ['sc1', 'c1'],
  ['i1', 'sc1'],
  ['i2', 'c2'],
])

beforeEach(() => {
  act(() => {
    useViewerStore.setState({
      hierarchySubtreeFilter: null,
      hierarchySubtreeLabel: null,
      hierarchySubtreeIds: null,
      hierarchyParents: PARENTS,
    } as unknown as Parameters<typeof useViewerStore.setState>[0])
  })
})

afterEach(() => cleanup())

describe('CodeItTouches', () => {
  test('renders nothing at all when no lesson carries file evidence', () => {
    const { container } = render(<CodeItTouches insights={[lesson('i1')]} totalLessons={1} />)
    // Not an empty box — absent. A box would imply the data failed to load.
    expect(container.firstChild).toBeNull()
  })

  test('ranks files by how many lessons name them', () => {
    render(
      <CodeItTouches
        insights={[
          lesson('i1', ['config/code-graph.json', 'lib/x.mjs']),
          lesson('i2', ['config/code-graph.json']),
        ]}
        totalLessons={2}
      />,
    )
    const rows = screen.getAllByRole('button')
    expect(rows[0].textContent).toBe('config/code-graph.json')
    expect(rows[1].textContent).toBe('lib/x.mjs')
  })

  test('the provenance line says how much of the corpus the files came from', () => {
    render(
      <CodeItTouches
        insights={[lesson('i1', ['a/b.ts']), lesson('i2'), lesson('i3')]}
        totalLessons={3}
      />,
    )
    // 1 of 3 — without this a thin sample reads as a complete map.
    expect(screen.getByTestId('code-it-touches-provenance').textContent).toBe(
      '1 file · from 1 of 3 lessons · verified 2026-09-19',
    )
  })

  test('the verification date is omitted when the corpus was checked in more than one pass', () => {
    render(
      <CodeItTouches
        insights={[
          lesson('i1', ['a/b.ts'], '2026-09-19T00:00:00Z'),
          lesson('i2', ['c/d.ts'], '2026-08-01T00:00:00Z'),
        ]}
        totalLessons={2}
      />,
    )
    expect(screen.getByTestId('code-it-touches-provenance').textContent).not.toContain('verified')
  })

  test('clicking a file focuses its lessons AND the code they sit under', () => {
    render(
      <CodeItTouches
        insights={[lesson('i1', ['a/b.ts']), lesson('i2', ['a/b.ts'])]}
        totalLessons={2}
      />,
    )
    act(() => { fireEvent.click(screen.getByTestId('code-file-a/b.ts')) })
    const state = useViewerStore.getState()
    // The lessons, plus the ancestor chains that re-attach them to the spine.
    expect([...(state.hierarchySubtreeIds ?? [])].sort()).toEqual(
      ['c1', 'c2', 'i1', 'i2', 'p1', 'sc1'],
    )
    expect(state.hierarchySubtreeLabel).toBe('a/b.ts')
    expect(state.hierarchySubtreeFilter).toBe(fileFocusId('a/b.ts'))
  })

  test('the synthetic focus root is not left in the member set', () => {
    render(<CodeItTouches insights={[lesson('i1', ['a/b.ts'])]} totalLessons={1} />)
    act(() => { fireEvent.click(screen.getByTestId('code-file-a/b.ts')) })
    const ids = useViewerStore.getState().hierarchySubtreeIds
    expect(ids?.has(fileFocusId('a/b.ts'))).toBe(false)
  })

  test('the count on screen is the number of lessons focused', () => {
    render(
      <CodeItTouches
        insights={[lesson('i1', ['a/b.ts']), lesson('i2', ['a/b.ts'])]}
        totalLessons={2}
      />,
    )
    const button = screen.getByTestId('code-file-a/b.ts')
    // The label states a fact about the corpus. It deliberately does NOT
    // promise a node count: the focus intersects with the canvas's other
    // filters, so 2 lessons named can legitimately render as fewer.
    expect(button.getAttribute('aria-label')).toBe('Focus on a/b.ts — named by 2 lessons')
    act(() => { fireEvent.click(button) })
    const ids = [...(useViewerStore.getState().hierarchySubtreeIds ?? [])]
    expect(ids.filter((id) => id === 'i1' || id === 'i2')).toHaveLength(2)
  })

  test('clicking the focused file again clears it', () => {
    render(<CodeItTouches insights={[lesson('i1', ['a/b.ts'])]} totalLessons={1} />)
    act(() => { fireEvent.click(screen.getByTestId('code-file-a/b.ts')) })
    expect(useViewerStore.getState().hierarchySubtreeFilter).not.toBeNull()
    act(() => { fireEvent.click(screen.getByTestId('code-file-a/b.ts')) })
    expect(useViewerStore.getState().hierarchySubtreeFilter).toBeNull()
    expect(useViewerStore.getState().hierarchySubtreeIds).toBeNull()
  })

  test('the focused file says so out loud, not only in colour', () => {
    render(<CodeItTouches insights={[lesson('i1', ['a/b.ts'])]} totalLessons={1} />)
    const button = screen.getByTestId('code-file-a/b.ts')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    act(() => { fireEvent.click(button) })
    expect(screen.getByTestId('code-file-a/b.ts').getAttribute('aria-pressed')).toBe('true')
  })

  test('a long list is cut, and says what the tail is worth', () => {
    const many = Array.from({ length: 30 }, (_, n) => lesson(`i${n}`, [`f${n}/x.ts`]))
    render(<CodeItTouches insights={many} totalLessons={30} />)
    expect(screen.getAllByRole('button')).toHaveLength(25)
    expect(screen.getByText(/\+5 more/)).toBeTruthy()
  })
})
