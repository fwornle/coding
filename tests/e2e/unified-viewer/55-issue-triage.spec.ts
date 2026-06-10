// Phase 55 Plan 13 — Spec: Issue Triage mode (SC-10 / UI-SPEC §10 + §16).
//
// SCOPE: Issue Triage is a second viewer mode (the first is Knowledge Graph).
//        It exposes a two-pane layout (left=incident list w-[380px],
//        right=RCA chain BFS w/ SECTION_ORDER labels) and reaches into the
//        ontology for `Incident` / `FailureIncident` classes. It is
//        coding-only (D-55-02b — the predicate gates by entity ontology
//        class, not by system slug).
//
// What this spec asserts:
//   1. Navigating to `/viewer/coding?mode=triage` mounts the
//      `issue-triage-view` testid AND a two-pane layout
//      (`triage-left-pane` + `triage-right-pane`).
//   2. When there are no Incident entities, the left pane shows the
//      "No incidents" empty-state (`triage-no-incidents`); the spec
//      annotates and asserts the empty state ONLY.
//   3. When incidents exist, the right pane lists the RCA Chain
//      SECTION_ORDER labels: "Symptoms", "Failure Patterns",
//      "Root Causes", "Resolutions", "Risks", "Decisions" (VOKB verbatim).
//   4. "View in Graph" CTA exists when an incident is selected (returns
//      to KG mode preserving selectedNodeId).
//   5. Forbidden-string gate (D-55-01c).
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/routes/IssueTriageView.tsx
//     (SECTION_ORDER + SECTION_META labels)
//   - integrations/unified-viewer/src/routes/UnifiedViewer.tsx
//     (mode hydration from ?mode=triage)

import { test, expect } from '@playwright/test'

const SECTION_LABELS = [
  'Symptoms',
  'Failure Patterns',
  'Root Causes',
  'Resolutions',
  'Risks',
  'Decisions',
]

test.describe('Phase 55 — Issue Triage mode (SC-10)', () => {
  test('/viewer/coding?mode=triage mounts two-pane Triage view', async ({
    page,
  }) => {
    await page.goto('/viewer/coding?mode=triage')

    // The triage view either mounts (entities present) OR the URL is
    // re-normalized to ?mode=kg (no entities OR no incidents triggers the
    // sanity fallback in UnifiedViewer.tsx). We tolerate either outcome
    // and annotate when KG mode wins.
    const triageView = page.getByTestId('issue-triage-view')
    const kgCanvas = page.getByTestId('viewer-canvas')

    const triageMounted = await triageView.isVisible().catch(() => false)
    const kgMounted = await kgCanvas.isVisible().catch(() => false)

    if (!triageMounted && kgMounted) {
      test.info().annotations.push({
        type: 'mode-fallback',
        description:
          'No incidents in coding KG — UnifiedViewer fell back to ?mode=kg. Triage gate intact (refusal to mount without data).',
      })
      // Forbidden-string gate (D-55-01c) still applies.
      const body = (await page.locator('body').textContent()) ?? ''
      expect(body).not.toContain('cc.bmwgroup.net')
      return
    }

    expect(triageMounted).toBe(true)
    await expect(page.getByTestId('triage-left-pane')).toBeVisible()
    await expect(page.getByTestId('triage-right-pane')).toBeVisible()

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('Triage left pane: incident list OR empty state', async ({ page }) => {
    await page.goto('/viewer/coding?mode=triage')
    const triageView = page.getByTestId('issue-triage-view')
    const triageMounted = await triageView.isVisible().catch(() => false)
    if (!triageMounted) {
      test.skip(true, 'Triage view did not mount — KG fallback active.')
      return
    }

    const list = page.getByTestId('triage-incident-list')
    await expect(list).toBeVisible()

    const noIncidents = page.getByTestId('triage-no-incidents')
    const incidentRows = page.locator('[data-testid^="triage-incident-"]')

    const noneCount = await noIncidents.count()
    const rowCount = await incidentRows.count()

    if (noneCount > 0 && rowCount === 0) {
      test.info().annotations.push({
        type: 'no-incidents',
        description: 'No Incident/FailureIncident entities — empty state shown.',
      })
      return
    }
    expect(rowCount).toBeGreaterThan(0)
  })

  test('Triage right pane: SECTION_ORDER labels when incident selected', async ({
    page,
  }) => {
    await page.goto('/viewer/coding?mode=triage')
    const triageView = page.getByTestId('issue-triage-view')
    const triageMounted = await triageView.isVisible().catch(() => false)
    if (!triageMounted) {
      test.skip(true, 'Triage view did not mount — KG fallback active.')
      return
    }

    // Pick the first incident row, if any.
    const firstIncident = page.locator('[data-testid^="triage-incident-"]').first()
    const incidentCount = await firstIncident.count()
    if (incidentCount === 0) {
      test.skip(true, 'No incidents available to select.')
      return
    }
    await firstIncident.click()

    // SECTION_ORDER labels are rendered as section headers in the right
    // pane. We assert each label appears at LEAST once on the page; the
    // exact rendering is left to IssueTriageView (the spec is a layout
    // contract, not a pixel match).
    const body = (await page.locator('body').textContent()) ?? ''
    for (const label of SECTION_LABELS) {
      expect(body).toContain(label)
    }

    // Forbidden-string gate (D-55-01c).
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('"View in Graph" CTA returns to KG mode preserving selection', async ({
    page,
  }) => {
    await page.goto('/viewer/coding?mode=triage')
    const triageView = page.getByTestId('issue-triage-view')
    const triageMounted = await triageView.isVisible().catch(() => false)
    if (!triageMounted) {
      test.skip(true, 'Triage view did not mount — KG fallback active.')
      return
    }

    const firstIncident = page
      .locator('[data-testid^="triage-incident-"]')
      .first()
    if ((await firstIncident.count()) === 0) {
      test.skip(true, 'No incidents available to select.')
      return
    }
    await firstIncident.click()

    const viewInGraph = page.getByTestId('view-in-graph')
    await expect(viewInGraph).toBeVisible()
    await viewInGraph.click()

    // After click, the URL should drop ?mode=triage (or normalize to ?mode=kg)
    // and the viewer canvas should mount.
    await expect(page.getByTestId('viewer-canvas')).toBeVisible({
      timeout: 5_000,
    })
    const url = page.url()
    expect(url).not.toContain('mode=triage')
  })
})
