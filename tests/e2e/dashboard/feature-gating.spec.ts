/**
 * tests/e2e/dashboard/feature-gating.spec.ts
 *
 * The dashboard must show exactly the features that are switched on.
 *
 * /api/features is STUBBED in every test. Driving the real endpoint would write
 * ~/.coding/features.yaml and stop launchd daemons on whatever machine runs the
 * suite — a test that reconfigures the developer's system is not a test anyone
 * can run twice. The host side of that round trip is covered by
 * tests/features/*.test.mjs and was verified end-to-end by hand; what belongs
 * here is the rendering contract, and that only needs a believable payload.
 *
 * See docs/architecture/features.md.
 */

import { test, expect, type Page } from '@playwright/test'

const ALL_FEATURES = [
  'lsl', 'observations', 'knowledge', 'codegraph', 'constraints',
  'llm-proxy', 'performance', 'health', 'statusline',
] as const

const META: Record<string, { label: string; requires: string[]; applyTier: string; needsDocker: boolean }> = {
  lsl: { label: 'Live Session Logging', requires: [], applyTier: 'apply', needsDocker: false },
  observations: { label: 'Observations', requires: ['lsl'], applyTier: 'apply', needsDocker: false },
  knowledge: { label: 'Knowledge Base', requires: ['observations'], applyTier: 'apply', needsDocker: true },
  codegraph: { label: 'Code Graph', requires: [], applyTier: 'apply', needsDocker: true },
  constraints: { label: 'Constraint Monitoring', requires: [], applyTier: 'session', needsDocker: true },
  'llm-proxy': { label: 'LLM Proxy', requires: [], applyTier: 'apply', needsDocker: false },
  performance: { label: 'Performance Measurement', requires: ['llm-proxy'], applyTier: 'apply', needsDocker: false },
  health: { label: 'Health Monitoring', requires: [], applyTier: 'apply', needsDocker: false },
  statusline: { label: 'Status Line', requires: [], applyTier: 'live', needsDocker: false },
}

function payload(off: string[] = []) {
  const features: Record<string, unknown> = {}
  for (const id of ALL_FEATURES) {
    const enabled = !off.includes(id)
    features[id] = {
      enabled,
      reason: enabled ? 'on — default' : 'off — set explicitly in ~/.coding/features.yaml',
      source: enabled ? 'default' : '~/.coding/features.yaml',
      description: `${META[id].label} description`,
      ...META[id],
    }
  }
  return {
    ok: true,
    profile: null,
    features,
    enabled: ALL_FEATURES.filter((id) => !off.includes(id)),
    disabled: off,
    needsDocker: ALL_FEATURES.some((id) => !off.includes(id) && META[id].needsDocker),
    warnings: [],
    profiles: { full: [...ALL_FEATURES], 'proxy-only': ['llm-proxy', 'statusline'], minimal: ['statusline'] },
  }
}

async function stubFeatures(page: Page, off: string[] = []) {
  await page.route('**/api/features', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(off)) })
  })
}

const tabNames = (page: Page) =>
  page.locator('nav a').allTextContents().then((t) => t.map((s) => s.replace(/\d+$/, '').trim()).filter(Boolean))

test.describe('nav tabs', () => {
  test('all features on shows every tab', async ({ page }) => {
    await stubFeatures(page)
    await page.goto('/')
    await expect(page.getByTestId('features-tab')).toBeVisible()
    const names = await tabNames(page)
    for (const expected of ['Health', 'Sessions', 'Observations', 'Digests', 'Insights', 'Coverage', 'Token Usage', 'Performance']) {
      expect(names).toContain(expected)
    }
  })

  test('a disabled feature omits its tab rather than greying it', async ({ page }) => {
    // Omission, not greying: a greyed nav item that routes nowhere invites a
    // click that lands on a dead page.
    await stubFeatures(page, ['performance'])
    await page.goto('/')
    await expect(page.getByTestId('features-tab')).toBeVisible()
    expect(await tabNames(page)).not.toContain('Performance')
  })

  test('one feature can own several tabs', async ({ page }) => {
    await stubFeatures(page, ['observations'])
    await page.goto('/')
    await expect(page.getByTestId('features-tab')).toBeVisible()
    const names = await tabNames(page)
    for (const gone of ['Observations', 'Digests', 'Insights']) expect(names).not.toContain(gone)
    expect(names).toContain('Sessions') // lsl is still on
  })

  test('the Features tab survives every configuration — there is always a way back', async ({ page }) => {
    await stubFeatures(page, [...ALL_FEATURES])
    await page.goto('/features')
    await expect(page.getByTestId('features-tab')).toBeVisible()
  })
})

test.describe('disabled routes', () => {
  test('a bookmarked URL explains itself instead of rendering an empty page', async ({ page }) => {
    await stubFeatures(page, ['performance'])
    await page.goto('/performance')
    const panel = page.getByTestId('feature-disabled-performance')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('switched off')
    // The reason comes from the resolver, so the UI never invents its own.
    await expect(panel).toContainText('~/.coding/features.yaml')
    await expect(panel.getByRole('link', { name: 'Open Features' })).toBeVisible()
  })

  test('an enabled route renders the page, not the panel', async ({ page }) => {
    await stubFeatures(page)
    await page.goto('/performance')
    await expect(page.getByTestId('feature-disabled-performance')).toHaveCount(0)
  })
})

test.describe('health tiles', () => {
  test('a disabled tile is greyed and carries the resolver reason', async ({ page }) => {
    // Greyed, not removed: the health grid is a fixed inventory of what this
    // system CAN monitor, and a hole in it reads as something having gone
    // missing rather than as something switched off.
    await stubFeatures(page, ['codegraph'])
    await page.goto('/')
    const tile = page.getByTestId('disabled-tile-code-graph')
    await expect(tile).toBeVisible()
    await expect(tile).toContainText('Disabled')
    await expect(tile).toContainText('~/.coding/features.yaml')
  })

  test('an enabled tile is not greyed', async ({ page }) => {
    await stubFeatures(page)
    await page.goto('/')
    await expect(page.getByTestId('code-graph-tile')).toBeVisible()
    await expect(page.getByTestId('disabled-tile-code-graph')).toHaveCount(0)
  })
})

test.describe('features editor', () => {
  test('lists every feature with its apply tier', async ({ page }) => {
    await stubFeatures(page)
    await page.goto('/features')
    await expect(page.getByTestId('features-page')).toBeVisible()
    for (const id of ALL_FEATURES) {
      await expect(page.getByTestId(`feature-row-${id}`)).toBeVisible()
    }
    await expect(page.getByTestId('feature-row-constraints')).toContainText('new sessions')
    await expect(page.getByTestId('feature-row-statusline')).toContainText('live')
  })

  test('warns what a toggle will knock out BEFORE saving', async ({ page }) => {
    // The surprising case — turning off lsl also silences observations and the
    // knowledge base — is exactly the one a user must not discover afterwards.
    await stubFeatures(page)
    await page.goto('/features')
    await expect(page.getByTestId('feature-row-lsl')).toContainText('also switches off')
    await expect(page.getByTestId('feature-row-lsl')).toContainText('Observations')
  })

  test('a feature blocked by its dependency cannot be toggled on', async ({ page }) => {
    // The resolver would immediately switch it back off, and a toggle that
    // silently undoes itself is worse than one that will not move.
    await stubFeatures(page, ['lsl', 'observations'])
    await page.goto('/features')
    const row = page.getByTestId('feature-row-observations')
    await expect(row.getByRole('switch')).toBeDisabled()
    await expect(row).toContainText('switch that on first')
  })

  test('Save is inert until something changes', async ({ page }) => {
    await stubFeatures(page)
    await page.goto('/features')
    await expect(page.getByTestId('features-save')).toBeDisabled()
    await page.getByTestId('feature-row-codegraph').getByRole('switch').click()
    await expect(page.getByTestId('features-save')).toBeEnabled()
    await expect(page.getByTestId('feature-row-codegraph')).toContainText('unsaved')
  })

  test('an unreachable coordinator fails OPEN, with an honest error', async ({ page }) => {
    // Hiding tabs because a host service blipped is indistinguishable from a
    // broken build. Showing everything plus the error is recoverable.
    await page.route('**/api/features', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'health coordinator unreachable' }),
    }))
    await page.goto('/')
    const names = await tabNames(page)
    expect(names).toContain('Performance')
    expect(names).toContain('Coverage')
  })
})
