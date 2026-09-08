// 2026-09-08 — Teams / Views grouping + the edge-derived Hierarchy Navigator.
//
// Two sidebar surfaces had each degenerated into a flat, unbounded list, and
// both failure modes are only visible against the real backend — which is why
// they are asserted here rather than only in the component tests:
//
//   1. Teams / Views listed one checkbox per `metadata.team`. Every kgbench run
//      mints a `kgbench-tree-<id>` team, so the list grew without limit and the
//      five teams that matter were buried. The predefined ones now come from
//      config/teams/ (obs-api GET /api/teams) and dynamic views collapse into
//      one node, kgbench runs nested inside it.
//
//   2. HierarchyNavigator never rendered at all: FilterRail mounted it without
//      the `entities` prop, so it fell back to a store key nothing writes and
//      showed its empty state permanently. With entities threaded, it derives
//      parents from the graph's containment edges rather than the never-written
//      `metadata.parent`, and the benchmark-run anchors sit under `Kgbench`.
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/panels/filters/{TeamsFilter,team-groups}.*
//   - integrations/unified-viewer/src/graph/hierarchy-parents.ts
//   - integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx
//   - lib/teams/registry.mjs + config/teams/
//
// PRECONDITION: obs-api on :12436 serves /api/teams and holds the coding graph.

import { test, expect } from '@playwright/test'

test.describe('Teams / Views rail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-filter-rail')).toBeVisible()
  })

  test('groups the registry by kind and collapses dynamic views', async ({ page }) => {
    await expect(page.getByTestId('filter-team-group-projects')).toBeVisible()
    await expect(page.getByTestId('filter-team-group-teams')).toBeVisible()
    await expect(page.getByTestId('filter-team-group-views')).toBeVisible()

    // Registry groups open, Views closed — the whole point of the grouping.
    await expect(page.getByTestId('filter-team-group-toggle-projects')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByTestId('filter-team-group-toggle-views')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  test('serves the five config/teams entries, split project vs team', async ({ page }) => {
    // Under Projects (kind: 'project')
    await expect(page.getByTestId('filter-team-coding')).toBeVisible()
    await expect(page.getByTestId('filter-team-ui')).toBeVisible()
    // Under Teams (kind: 'team'). RaaS has no entities and must still render —
    // a registry that hides its members until data arrives is not a registry.
    await expect(page.getByTestId('filter-team-normalisa')).toBeVisible()
    await expect(page.getByTestId('filter-team-raas')).toBeVisible()
    await expect(page.getByTestId('filter-team-resi')).toBeVisible()
  })

  test('kgbench run teams are nested, not top-level rows', async ({ page }) => {
    const rail = page.getByTestId('filter-teams')

    // Collapsed Views: no dynamic view rows on screen at all.
    expect(await rail.locator('label[data-testid^="filter-team-kgbench"]').count()).toBe(0)

    await page.getByTestId('filter-team-group-toggle-views').click()
    // Views open, but the kgbench cluster is its own still-closed node.
    await expect(page.getByTestId('filter-team-group-kgbench')).toBeVisible()
    expect(await rail.locator('label[data-testid^="filter-team-kgbench"]').count()).toBe(0)

    await page.getByTestId('filter-team-group-toggle-kgbench').click()
    expect(
      await rail.locator('label[data-testid^="filter-team-kgbench-tree-"]').count(),
    ).toBeGreaterThan(0)
  })

  test('a group all/none affects only that group', async ({ page }) => {
    const codingBox = page.getByTestId('filter-team-coding').locator('button')
    await expect(codingBox).toHaveAttribute('data-state', 'checked')

    await page.getByLabel('Clear all in Projects').click()
    await expect(codingBox).toHaveAttribute('data-state', 'unchecked')
    // A team in a different group is untouched.
    await expect(page.getByTestId('filter-team-resi').locator('button')).toHaveAttribute(
      'data-state',
      'checked',
    )
  })
})

test.describe('Hierarchy Navigator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-filter-rail')).toBeVisible()
  })

  test('renders a tree rather than its empty state', async ({ page }) => {
    const nav = page.getByTestId('hierarchy-navigator')
    await expect(nav).toBeVisible()
    await expect(page.getByTestId('hierarchy-empty-state')).toHaveCount(0)
    await expect(nav.getByRole('treeitem').first()).toBeVisible()
  })

  test('CollectiveKnowledge is the single real root', async ({ page }) => {
    const nav = page.getByTestId('hierarchy-navigator')
    // Anchor on a locator that auto-waits before counting — `.count()` resolves
    // immediately and would read 0 while the entity fetch is still in flight.
    await expect(nav.getByLabel(/Filter to System: CollectiveKnowledge/)).toBeVisible()
    // CollectiveKnowledge, plus the Unparented diagnostic bucket when the graph
    // still has nodes with no containment edge. Never the ~1341 flat rows the
    // metadata.parent build produced.
    const count = await nav.locator('[role="treeitem"][aria-level="1"]').count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(2)
  })

  test('benchmark runs hang under Kgbench, not beside the projects', async ({ page }) => {
    const nav = page.getByTestId('hierarchy-navigator')
    const root = nav.getByLabel(/Filter to System: CollectiveKnowledge/)
    await expect(root).toBeVisible()

    // The eleven KgbenchTree* anchors are Components under Kgbench now, so none
    // of them is a top-level row.
    await expect(
      nav.locator('[role="treeitem"][aria-level="1"]').getByLabel(/KgbenchTree/),
    ).toHaveCount(0)

    // Expand CollectiveKnowledge — Radix unmounts collapsed content, so the
    // Kgbench row only exists once its parent is open.
    //
    // The row nests a button inside the accordion trigger: the inner one is the
    // subtree filter and stops propagation, so a centred click sets a filter
    // instead of expanding. The inner button is `flex-1` and stops short of the
    // chevron, so aim at the chevron end of the trigger.
    const trigger = nav.locator('[role="treeitem"][aria-level="1"] h3 > button').first()
    const box = await trigger.boundingBox()
    if (!box) throw new Error('accordion trigger has no box')
    await trigger.click({ position: { x: box.width - 8, y: box.height / 2 } })
    await expect(nav.getByLabel(/Filter to Project: Kgbench \(\d+ descendants\)/)).toBeVisible()
  })
})

test.describe('Provenance edges hidden by default', () => {
  // capturedBy + mentions are 88% of the coding graph (13,090 + 9,284 of
  // 25,468 edges). Rendering them all put 24,997 paths on the canvas and made
  // it an unreadable grey wall; the default now draws the ~2,900 structural
  // edges instead. Asserted against the real backend because the ratio, and
  // therefore the whole point, only exists on the real graph.
  test('the canvas draws structure, not the full provenance set', async ({ page }) => {
    await page.goto('/viewer/coding')
    const paths = page.locator('[data-testid="viewer-canvas"] svg path')
    await expect.poll(() => paths.count(), { timeout: 30_000 }).toBeGreaterThan(0)

    // Structure is thousands of edges; the full set is tens of thousands. The
    // bound is deliberately loose — this guards the default, not a fixed graph.
    expect(await paths.count()).toBeLessThan(10_000)
  })

  test('the stats bar still reports every edge — nothing is silently dropped', async ({ page }) => {
    await page.goto('/viewer/coding')
    const footer = page.getByTestId('footer-status')
    await expect(footer).toBeVisible()
    // The footer paints "0 of 0 nodes · 0 edges" before the fetch resolves, so
    // poll rather than reading it once.
    const edgeCount = async () =>
      Number(
        ((await footer.textContent()) ?? '').match(/([\d,]+)\s+edges/)?.[1]?.replace(/,/g, '') ??
          '0',
      )
    // A default that hid edges from the COUNT would be a lie about the graph.
    await expect.poll(edgeCount, { timeout: 30_000 }).toBeGreaterThan(10_000)
  })

  test('the Legend shows them as hidden and can bring them back', async ({ page }) => {
    await page.goto('/viewer/coding')
    const paths = page.locator('[data-testid="viewer-canvas"] svg path')
    await expect.poll(() => paths.count(), { timeout: 30_000 }).toBeGreaterThan(0)
    const structureOnly = await paths.count()

    // The Legend is a <details>, collapsed by default (UI-SPEC §7 row 12).
    await page.getByTestId('viewer-legend-panel').locator('summary').click()

    // Hidden rows render struck-through rather than vanishing, so the operator
    // can see what is being withheld.
    const captured = page.getByTestId('legend-rel-capturedBy')
    await expect(captured).toBeVisible()
    await expect(captured).toHaveAttribute('data-hidden', 'true')
    await expect(captured).toHaveCSS('text-decoration-line', 'line-through')
    // A structural type is NOT hidden — the default is targeted, not blanket.
    // `data-hidden` is only emitted when true, so absence is the visible state.
    await expect(page.getByTestId('legend-rel-contains')).not.toHaveAttribute('data-hidden', 'true')

    await captured.click()
    await expect.poll(() => paths.count(), { timeout: 30_000 }).toBeGreaterThan(structureOnly)
  })
})
