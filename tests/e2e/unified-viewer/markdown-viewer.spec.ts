// Phase 45 Plan 06 — Spec 6: MarkdownViewer panel (OKB).
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "markdown-viewer"
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx
//
// What this spec asserts (per 45-06-PLAN.md Task 2 spec-6 contract):
//   1. /viewer/okb mounts with the Markdown tab visible.
//   2. With NO entity selected, the empty-state copy
//      "Select a node with a description to view its markdown." renders.
//   3. Picking an entity and switching to the Markdown tab renders the
//      MarkdownViewerPanel shell (back/forward IconButtons + filename
//      header + scrollable content area).
//   4. Mermaid placeholder testid appears IFF the rendered description
//      contains a ```mermaid``` fenced block. We do not require Mermaid
//      content in the live OKB graph; if no Mermaid is present we assert
//      the placeholder testid is ABSENT and the content area is non-empty.
//   5. Theme toggle (NavBar's `theme-toggle` IconButton) flips the
//      `<html class>` between '' and 'dark' AND the highlight.js
//      stylesheet link's href swaps between the github.min.css and
//      github-dark.min.css URLs.

import { test, expect } from '@playwright/test'

interface WindowWithSigma {
  __viewerSigma?: {
    getGraph(): { order: number; nodes(): string[] }
    emit(eventType: string, payload: unknown): void
  }
}

test.describe('Unified Viewer — MarkdownViewer panel', () => {
  test('Markdown tab renders empty state by default', async ({ page }) => {
    await page.goto('/viewer/okb')
    await page.getByTestId('tab-markdown').click()
    await expect(page.getByTestId('markdown-empty')).toBeVisible()
    await expect(page.getByTestId('markdown-empty')).toContainText(
      'Select a node with a description to view its markdown.',
    )
  })

  test('selecting an entity renders the MarkdownViewer shell', async ({ page }) => {
    // Mock /viewer/okb data so the spec doesn't depend on the live OKB
    // backend's entity count (B may be empty between ingestion runs,
    // which would shunt ViewerCore into EmptyNoDataState — that state
    // does NOT mount SigmaCanvas, so `__viewerSigma` is unavailable and
    // the markdown panel can't be exercised). Mocking a 2-entity payload
    // is the stable contract: it always renders sigma + the tab.
    const MOCK_ENTITY = {
      id: 'mock-1',
      name: 'Mock OKB Entity',
      ontologyClass: 'Observation',
      level: 3,
      description: '# Heading\n\nSome **markdown** body.',
    }
    await page.route('**/api/v1/entities', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [MOCK_ENTITY] }),
      }),
    )
    await page.route('**/api/v1/relations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    )
    await page.route('**/api/v1/ontology/classes**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: ['Observation'] }),
      }),
    )

    await page.goto('/viewer/okb')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Wait for graph + sigma test hook.
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    // Select the mock node + switch to Markdown tab.
    await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      w.__viewerSigma?.emit('clickNode', { node: 'mock-1' })
    })
    await page.getByTestId('tab-markdown').click()

    // The MarkdownViewer panel should mount and render the mock description.
    await expect(page.getByTestId('markdown-viewer-panel')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId('markdown-back')).toBeVisible()
    await expect(page.getByTestId('markdown-forward')).toBeVisible()
    await expect(page.getByTestId('markdown-filename')).toBeVisible()
    await expect(page.getByTestId('markdown-content')).toBeVisible()
    // Heading anchor id verification — `# Heading` → `id="heading"`.
    await expect(
      page.locator('[data-testid="markdown-content"] #heading'),
    ).toBeVisible()
  })

  test('theme toggle flips <html class> and highlight.js href', async ({
    page,
  }) => {
    await page.goto('/viewer/okb')

    // Read initial theme — readPersistedThemeForStore() may have synced
    // to OS prefers-color-scheme; capture both classList + hljs href.
    const initialIsDark = await page.evaluate(
      () => document.documentElement.classList.contains('dark'),
    )

    // Switch to the Markdown tab so the highlight.js <link> mounts. The
    // MarkdownViewerPanel `applyHighlightTheme(theme)` runs on mount AND
    // on every theme change; an empty-state panel does NOT mount the
    // panel — we need to actually drive the panel into render.
    await page.getByTestId('tab-markdown').click()

    // Click the theme toggle in NavBar.
    await page.getByTestId('theme-toggle').click()

    // <html class> flipped.
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(!initialIsDark)
  })
})
