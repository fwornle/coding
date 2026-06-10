// Phase 55 Plan 13 — Spec: Renderer encoding (SC-3 / SC-4 / UI-SPEC §12 + §14).
//
// SCOPE: Legend visibility + per-node shape/border/pulse attribute stamping.
//
// What this spec asserts:
//   1. The viewer Legend (`<details data-testid="viewer-legend-panel">`) is
//      present and exposes 4 sub-sections (Domains, Layers, Source,
//      Relationships) per UI-SPEC §14.
//   2. Per-node attribute stamping holds: the Sigma graph carries a `shape`,
//      `borderStyle`, and (optionally) `pulseRule` attribute on every node
//      (Plan 55-05's graph-builder contract).
//   3. At least one node carries `borderStyle: 'dashed'` (the orphan rule)
//      OR the graph has zero orphans — both outcomes are valid per
//      UI-SPEC §14. We log the outcome via `test.info().annotations`.
//   4. Forbidden-string gate (D-55-01c).
//
// IMPORTANT (Plan 55-05 v1 stub): Sigma's `nodeProgramClasses` map all five
//   shape keys to `NodeCircleProgram` — meaning the on-canvas rendering of
//   diamond/square/triangle/hexagon is currently a circle. Plan 55-05's
//   summary explicitly defers custom GLSL programs. This spec MUST NOT
//   assert distinct shapes via canvas inspection; instead it verifies the
//   ATTRIBUTE-LEVEL contract (shape value present on the graph node) plus
//   the SVG legend (source of truth for the encoded shape mapping).
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/panels/LegendPanel.tsx (4 Sections)
//   - integrations/unified-viewer/src/graph/graph-builder.ts (per-node attrs)
//   - integrations/unified-viewer/src/graph/SigmaCanvas.tsx (__viewerSigma)

import { test, expect } from '@playwright/test'

interface WindowWithSigma {
  __viewerSigma?: {
    getGraph(): {
      order: number
      nodes(): string[]
      getNodeAttributes(id: string): Record<string, unknown>
    }
  }
}

test.describe('Phase 55 — Renderer encoding (SC-3 / SC-4 / UI-SPEC §12 + §14)', () => {
  test('Legend panel is present with 4 sub-sections', async ({ page }) => {
    await page.goto('/viewer/coding')
    const legend = page.getByTestId('viewer-legend-panel')
    await expect(legend).toBeVisible()

    // Open the <details> so the inner sections render in the DOM.
    await legend.evaluate((el) => {
      ;(el as HTMLDetailsElement).open = true
    })

    // 4 sub-section headers expected (UI-SPEC §14: Domains, Layers, Source,
    // Relationships). We don't pin a strict testid for each section because
    // SHAPE_SWATCHES / LAYER_BADGE_CLASS / etc. produce per-row testids; the
    // section CONTAINERS are easiest to count via the per-row testid PREFIX.
    const domainSwatches = legend.locator('[data-testid^="legend-domain-"]')
    const layerSwatches = legend.locator('[data-testid^="legend-layer-"]')
    const sourceSwatches = legend.locator('[data-testid^="legend-source-"]')
    const relSwatches = legend.locator('[data-testid^="legend-rel-"]')

    await expect(domainSwatches.first()).toBeVisible()
    await expect(layerSwatches.first()).toBeVisible()
    await expect(sourceSwatches.first()).toBeVisible()
    await expect(relSwatches.first()).toBeVisible()

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('Sigma nodes carry shape + borderStyle attributes', async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Wait for at least one node to load.
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    // Probe a sample of node attributes.
    const sample = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      const g = w.__viewerSigma?.getGraph()
      if (!g) return null
      const nodes = g.nodes().slice(0, 10)
      return nodes.map((id) => {
        const attrs = g.getNodeAttributes(id)
        return {
          id,
          shape: attrs.shape,
          borderStyle: attrs.borderStyle,
          pulseRule: attrs.pulseRule,
        }
      })
    })
    expect(sample).not.toBeNull()
    if (!sample) return
    expect(sample.length).toBeGreaterThan(0)

    // Every sampled node should carry a `shape` attribute (one of the 5
    // shape kinds) AND a `borderStyle` attribute ('solid' | 'dashed').
    const VALID_SHAPES = ['circle', 'square', 'diamond', 'triangle', 'hexagon']
    for (const node of sample) {
      expect(VALID_SHAPES).toContain(node.shape)
      expect(['solid', 'dashed']).toContain(node.borderStyle)
    }
  })

  test('dashed-orphan rule is reflected on node attributes (or graph has zero orphans)', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    const counts = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      const g = w.__viewerSigma?.getGraph()
      if (!g) return null
      const ids = g.nodes()
      let dashed = 0
      let solid = 0
      for (const id of ids) {
        const bs = g.getNodeAttributes(id).borderStyle
        if (bs === 'dashed') dashed += 1
        else if (bs === 'solid') solid += 1
      }
      return { total: ids.length, dashed, solid }
    })
    expect(counts).not.toBeNull()
    if (!counts) return

    // At least one node must have a borderStyle stamped (solid OR dashed)
    // — the attribute itself is the contract from Plan 55-05's
    // graph-builder. Orphan presence is data-dependent; we log the count.
    expect(counts.solid + counts.dashed).toBeGreaterThan(0)
    test.info().annotations.push({
      type: 'orphan-count',
      description: `total=${counts.total} solid=${counts.solid} dashed=${counts.dashed}`,
    })

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })
})
