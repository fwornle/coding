// PATTERN SOURCE: 45-04-PLAN.md Task 2 MarkdownPanel Test 1-7
//
// MarkdownPanel Tests:
//   1. selectedNodeId === null → empty-copy state
//   2. Selected entity with description '# Hello\n\n**world**' →
//      <h1 id="hello">Hello</h1> and <strong>world</strong>
//   3. ```ts\nconst x = 1;\n``` → <code class="language-ts">
//   4. ```mermaid\ngraph TD\nA-->B\n``` → mermaid-placeholder div
//   5. theme=dark → github-dark.css link; theme=light → github.css link
//   6. external anchor → target=_blank rel="noopener noreferrer"
//   7. .md cross-link click → useMarkdownHistory.pushHistory(resolvedPath)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import type { ApiClient } from '@/api/ApiClient'

// Provide a typed Entity mock surface for useGraphData. Tests mutate this
// array in place via vi.mocked calls between assertions to swap entities.
const mockEntities: Array<{
  id: string
  name: string
  ontologyClass: string
  description?: string
  metadata?: { markdown_url?: string }
}> = [
  // e1 — plain description with heading + bold
  {
    id: 'e1',
    name: 'Hello Entity',
    ontologyClass: 'Observation',
    description: '# Hello\n\n**world**',
  },
  // e2 — TypeScript fenced code block
  {
    id: 'e2',
    name: 'Code Entity',
    ontologyClass: 'Observation',
    description: '```ts\nconst x = 1;\n```',
  },
  // e3 — Mermaid fenced code block (must render placeholder, NOT diagram)
  {
    id: 'e3',
    name: 'Mermaid Entity',
    ontologyClass: 'Observation',
    description: '```mermaid\ngraph TD\nA-->B\n```',
  },
  // e4 — external anchor link
  {
    id: 'e4',
    name: 'Link Entity',
    ontologyClass: 'Observation',
    description: '[example](https://example.com)',
  },
  // e5 — .md cross-link (relative). NO metadata.markdown_url so the panel
  // renders the description directly (no fetch loading state). The cross-
  // link click pushes 'other.md' onto useMarkdownHistory; the panel then
  // tries to fetch the new URL, which would put it into loading — but
  // Test 7 only inspects the back button state, not the content body.
  {
    id: 'e5',
    name: 'CrossLink Entity',
    ontologyClass: 'Observation',
    description: '[other doc](other.md)',
  },
]

vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: mockEntities,
    relations: [],
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { MarkdownViewerPanel } from './MarkdownViewerPanel'

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <MarkdownViewerPanel apiClient={apiClient} system="okb" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

// Global fetch stub — MarkdownViewerPanel uses TanStack Query to fetch
// markdown URLs when entity.metadata.markdown_url is present or when
// history navigation pushes a URL. Most tests render description-only
// entities, but Test 7 (cross-link click) triggers a fetch.
const originalFetch = global.fetch

describe('MarkdownViewerPanel (Plan 45-04 Task 2)', () => {
  beforeEach(() => {
    cleanup()
    useViewerStore.setState({
      selectedNodeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
    // Clean up any prior highlight.js <link> element from previous tests.
    const existing = document.getElementById('unified-viewer-highlightjs-theme')
    if (existing) existing.remove()
    // Default fetch stub — returns markdown text successfully.
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '# Fetched markdown',
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('MarkdownPanel Test 1: selectedNodeId === null → empty state', () => {
    renderPanel()
    expect(screen.getByTestId('markdown-empty')).toBeInTheDocument()
    expect(
      screen.getByText('Select a node with a description to view its markdown.'),
    ).toBeInTheDocument()
  })

  test('MarkdownPanel Test 2: description "# Hello\\n\\n**world**" renders <h1 id="hello">Hello</h1> + <strong>world</strong>', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    const { container } = renderPanel()
    const content = container.querySelector('[data-testid="markdown-content"]')
    expect(content).not.toBeNull()
    const h1 = content!.querySelector('h1')
    expect(h1).not.toBeNull()
    expect(h1!.getAttribute('id')).toBe('hello')
    expect(h1!.textContent).toBe('Hello')
    const strong = content!.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong!.textContent).toBe('world')
  })

  test('MarkdownPanel Test 3: TypeScript fenced code → <code> with language-ts marker class', () => {
    useViewerStore.setState({ selectedNodeId: 'e2' })
    const { container } = renderPanel()
    // react-markdown + rehype-highlight emits
    //   <pre><code class="hljs language-ts">...syntax tokens...</code></pre>
    // We assert language-ts appears in the className of some <code> element.
    const allCodes = container.querySelectorAll('code')
    const tsCode = Array.from(allCodes).find((c) =>
      (c.getAttribute('class') ?? '').includes('language-ts'),
    )
    expect(tsCode).toBeDefined()
    expect(tsCode!.textContent).toContain('const x = 1;')
  })

  test('MarkdownPanel Test 4: Mermaid fenced block → placeholder div, NOT a Mermaid render', () => {
    useViewerStore.setState({ selectedNodeId: 'e3' })
    renderPanel()
    const placeholder = screen.getByTestId('mermaid-placeholder')
    expect(placeholder).toBeInTheDocument()
    expect(placeholder.textContent).toContain(
      'Mermaid diagrams are not rendered in MVP',
    )
  })

  test('MarkdownPanel Test 5 (light theme): installs <link> to github.css', () => {
    useViewerStore.setState({ selectedNodeId: 'e1', theme: 'light' })
    renderPanel()
    const link = document.getElementById(
      'unified-viewer-highlightjs-theme',
    ) as HTMLLinkElement | null
    expect(link).not.toBeNull()
    expect(link!.href).toContain('github.min.css')
    expect(link!.href).not.toContain('github-dark')
  })

  test('MarkdownPanel Test 5b (dark theme): installs <link> to github-dark.css', () => {
    useViewerStore.setState({ selectedNodeId: 'e1', theme: 'dark' })
    renderPanel()
    const link = document.getElementById(
      'unified-viewer-highlightjs-theme',
    ) as HTMLLinkElement | null
    expect(link).not.toBeNull()
    expect(link!.href).toContain('github-dark.min.css')
  })

  test('MarkdownPanel Test 6: external anchor has target=_blank + rel="noopener noreferrer" (T-45-04-02)', () => {
    useViewerStore.setState({ selectedNodeId: 'e4' })
    const { container } = renderPanel()
    const content = within(
      container.querySelector('[data-testid="markdown-content"]') as HTMLElement,
    )
    const anchor = content.getByText('example').closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe('https://example.com')
    expect(anchor!.getAttribute('target')).toBe('_blank')
    expect(anchor!.getAttribute('rel')).toBe('noopener noreferrer')
  })

  test('MarkdownPanel Test 7: .md cross-link click triggers pushHistory + filename changes', () => {
    useViewerStore.setState({ selectedNodeId: 'e5' })
    renderPanel()
    // Initially, the filename header shows the entity name (no URL).
    expect(screen.getByTestId('markdown-filename').textContent).toBe(
      'CrossLink Entity',
    )
    // The cross-link is present inside the rendered body.
    const crossLink = screen.getByTestId('md-cross-link')
    expect(crossLink).toBeInTheDocument()
    expect(crossLink.textContent).toBe('other doc')
    // Click triggers pushHistory(resolved path); the panel switches into
    // fetch-loading state (no markdown_url base ⇒ resolveMdLink returns
    // 'other.md' verbatim ⇒ panel attempts to fetch it). At minimum the
    // filename header transitions to the new file basename.
    fireEvent.click(crossLink)
    // After the push, filename header reflects the new path tail.
    expect(screen.getByTestId('markdown-filename').textContent).toBe('other.md')
  })

  test('MarkdownPanel Test 7b: XSS — <script> embedded in description does NOT produce a <script> element', () => {
    // Inject an entity-style description with raw <script> at runtime by
    // pushing to the shared mock array.
    mockEntities.push({
      id: 'xss',
      name: 'XSS sample',
      ontologyClass: 'Observation',
      description: '<script>alert(1)</script>',
    })
    useViewerStore.setState({ selectedNodeId: 'xss' })
    const { container } = renderPanel()
    expect(container.querySelectorAll('script').length).toBe(0)
    // Clean up the injected entity.
    mockEntities.pop()
  })

  test('MarkdownPanel Test 7c: after first cross-link push, back is still disabled (cursor at index 0)', () => {
    useViewerStore.setState({ selectedNodeId: 'e5' })
    renderPanel()
    const crossLink = screen.getByTestId('md-cross-link')
    fireEvent.click(crossLink)
    // After the first push, the new URL is the cursor at index 0 — there's
    // no prior entry in the stack, so canBack is false. This confirms the
    // browser-history semantics of useMarkdownHistory: a push when the
    // stack is empty does not retroactively create a "previous" entry.
    const backBtn = screen.getByTestId('markdown-back')
    expect(backBtn).toBeDisabled()
  })
})
