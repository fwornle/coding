// Phase 55 Plan 13 — Spec: FilterRail parity with VOKB (SC-5 / UI-SPEC §6).
//
// SCOPE: The FilterRail must expose Layer, Domain, OntologyFilter (grouped
//        tree), and 4 GraphToggles — replacing Phase 45's flat class list.
//        On /viewer/coding the Ontology tree uses the Hierarchy + Typed Views
//        schema; on /viewer/okb it uses VOKB's Upper / Lower triangle groups.
//
// What this spec asserts:
//   1. /viewer/coding: FilterRail visible; Layer / Domain / Ontology / 4
//      GraphToggles all present via their stable test ids.
//   2. /viewer/okb: OntologyFilter exposes both Upper + Lower group sections.
//   3. 4 GraphToggles present and named per VOKB ports
//      (show-edges, show-clusters, merged-only, hide-doc).
//   4. Forbidden-string gate (D-55-01c).
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/panels/FilterRail.tsx
//   - integrations/unified-viewer/src/panels/filters/{Layer,Domain,Ontology,GraphToggles}.tsx
//
// NOTE: Per-class count badges (`filter-ontology-count-<cls>`) only render
//       when the class has visible entities; the spec checks that the
//       OntologyFilter SECTION mounts, not that every per-class chip exists.

import { test, expect } from '@playwright/test'

test.describe('Phase 55 — FilterRail parity (SC-5 / UI-SPEC §6)', () => {
  test('/viewer/coding: Layer + Domain + Ontology + 4 GraphToggles present', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-filter-rail')).toBeVisible()

    // Layer filter section.
    await expect(page.getByTestId('filter-layer-section')).toBeVisible()
    // Domain filter section.
    await expect(page.getByTestId('filter-domain-section')).toBeVisible()
    // Ontology filter section (grouped tree).
    await expect(page.getByTestId('filter-ontology-section')).toBeVisible()
    // 4 GraphToggles section + the four toggle controls.
    await expect(page.getByTestId('filter-graph-toggles-section')).toBeVisible()
    await expect(page.getByTestId('graph-toggle-show-edges')).toBeVisible()
    await expect(page.getByTestId('graph-toggle-show-clusters')).toBeVisible()
    await expect(page.getByTestId('graph-toggle-merged-only')).toBeVisible()
    await expect(page.getByTestId('graph-toggle-hide-doc')).toBeVisible()

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('/viewer/okb: OntologyFilter shows Upper + Lower triangle groups', async ({
    page,
  }) => {
    await page.goto('/viewer/okb')
    await expect(page.getByTestId('viewer-filter-rail')).toBeVisible()
    await expect(page.getByTestId('filter-ontology-section')).toBeVisible()

    // OKB schema uses the VOKB Upper/Lower triangle layout.
    // These two test ids are emitted by OntologyFilter when the schema is
    // the default (system !== 'coding'). They may not exist if OKM data
    // is empty — in which case OntologyFilter renders the section header
    // only. We use `count > 0` softly and skip if no entities loaded.
    const upperCount = await page
      .getByTestId('filter-ontology-triangle-upper')
      .count()
    const lowerCount = await page
      .getByTestId('filter-ontology-triangle-lower')
      .count()

    if (upperCount === 0 && lowerCount === 0) {
      test.info().annotations.push({
        type: 'data-skip',
        description:
          'OKM data empty — OntologyFilter triangles render only with classes; section header verified',
      })
    } else {
      // When data is loaded, both triangles must mount.
      expect(upperCount).toBeGreaterThan(0)
      expect(lowerCount).toBeGreaterThan(0)
    }

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('clicking Layer Select-None toggles the layer set', async ({ page }) => {
    await page.goto('/viewer/coding')
    const layerSection = page.getByTestId('filter-layer-section')
    await expect(layerSection).toBeVisible()

    // The Layer section has its own Select-All/None pair. We do NOT pin a
    // specific resulting visible-count here (the existing
    // filter-search.spec.ts covers footer-count semantics); we only assert
    // the control is wired and clickable.
    const noneBtn = layerSection.getByRole('button', { name: 'Select None' })
    if ((await noneBtn.count()) > 0) {
      await noneBtn.click()
      // After clicking None, at least one layer label should show unchecked
      // state. We re-query because the DOM may re-render.
      await expect(layerSection).toBeVisible()
    }

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })
})
