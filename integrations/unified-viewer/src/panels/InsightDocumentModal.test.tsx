/**
 * The insight-document modal must escape its render position.
 *
 * It is hand-rolled rather than built on the Radix dialog every other overlay
 * in this app uses — and Radix portals for exactly the reason tested here.
 * Rendered in place, this modal lives inside EntityDetailPanel -> SidePanel, so
 * its `fixed inset-0` backdrop is resolved against whatever stacking context an
 * ancestor happens to establish. The visible symptom was a backdrop that dimmed
 * the page but stopped short of the sticky NavBar and StatsBar at the top, an
 * un-dimmed strip a few pixels tall.
 *
 * Portalling to document.body puts the overlay in the ROOT stacking context,
 * where its z-50 genuinely outranks the bars' z-20. These tests assert the
 * placement rather than the class string, because the class was already correct
 * — it was the position in the tree that was wrong.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsightDocumentModal } from './InsightDocumentModal'

/** The modal fetches through react-query, so it needs a provider like its siblings. */
const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
)

// The modal fetches the document on mount; keep it inert and deterministic.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# Doc\n\nBody text.',
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InsightDocumentModal — overlay placement', () => {
  test('renders into document.body, not the container it was rendered in', async () => {
    const { container } = render(
      withQuery(
        <div data-testid="in-place-host">
          <InsightDocumentModal url="/x.md" title="X" onClose={() => {}} />
        </div>,
      ),
    )

    const modal = await screen.findByTestId('insight-document-modal')
    expect(modal).toBeTruthy()

    // The whole point: it must NOT be a descendant of its render position.
    const host = container.querySelector('[data-testid="in-place-host"]')
    expect(host).toBeTruthy()
    expect(host!.contains(modal)).toBe(false)
    expect(document.body.contains(modal)).toBe(true)
  })

  test('the backdrop still covers the viewport', async () => {
    render(withQuery(<InsightDocumentModal url="/x.md" title="X" onClose={() => {}} />))
    const modal = await screen.findByTestId('insight-document-modal')
    // fixed + inset-0 is what makes it viewport-sized; z-50 is what puts it
    // above the sticky bars (z-20) once it is in the root stacking context.
    expect(modal.className).toContain('fixed')
    expect(modal.className).toContain('inset-0')
    expect(modal.className).toContain('z-50')
  })
})
