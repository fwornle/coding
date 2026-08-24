/**
 * tests/e2e/performance/context-block-legibility.spec.ts
 *
 * The message samples in the Context & caching explainer (context-cache-explainer.tsx,
 * `cat-samples` branch) used to render each history block as the raw
 * `JSON.stringify(block)` the proxy stored. Everything an observer scans while
 * following the turns — the block TYPE, the TOOL, and the human-written DESCRIPTION —
 * sat buried among opaque `toolu_…` ids and multi-hundred-character base64
 * `signature` blobs, all in one undifferentiated colour.
 *
 * Contract under test:
 *   1. A tool_use block surfaces a coloured type chip, the tool name, and (when the
 *      tool supplies one) its description, ABOVE the verbatim JSON.
 *   2. The type chip is actually colour-coded per kind — tool_use and thinking must
 *      not resolve to the same colour. A "highlight the type" change that shipped
 *      with both chips grey would pass a text-only assertion, which is exactly the
 *      failure mode this project has hit before on graph-node colouring.
 *   3. The verbatim JSON is de-emphasized: folded into a <details> and rendered in a
 *      muted colour distinct from the description's foreground colour.
 *   4. Nothing is HIDDEN by the fold — expanding restores the full original preview,
 *      including the ids the header deliberately omits.
 *   5. Blocks whose preview is not a JSON content block (tool_result content arrives
 *      as a plain string) still render verbatim, unfolded, exactly as before.
 *
 * Offline guard: skips (never hard-fails) when the dashboard at :3032 is unreachable
 * or no run carries a `hist` category with tool_use blocks (fresh checkout / CI).
 */

import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3032';
const PERFORMANCE_TAB = '[data-testid="performance-tab"]';
const EXPLAINER = '[data-testid="context-cache-explainer"]';
const SAMPLES = '[data-testid="cat-samples"]';
const BLK_TOOL = '[data-testid="blk-tool"]';
const BLK_DESC = '[data-testid="blk-desc"]';
const BLK_CARD = '[data-testid="blk-card"]';

async function gotoPerformance(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { timeout: 8_000 });
    await page.waitForSelector(PERFORMANCE_TAB, { timeout: 8_000 });
    await page.click(PERFORMANCE_TAB);
    await page.waitForSelector('[data-testid="runs-table"]', { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a run whose `hist` category actually contains a tool_use block. Asserting on a
 * run without one would make every expectation below vacuously skip.
 *
 * The lookup MUST mirror the component's own query (context-cache-explainer.tsx
 * `setReal` effect): task_id alone almost never matches, because the proxy keys
 * captures by its OWN span id rather than the runs-table id, and the component
 * therefore also sends the run's wall-clock window + model + agent so the server can
 * match the capture recorded DURING the run. A first version of this helper queried
 * by bare task_id, found 0 of 25 runs with any history at all, and skipped all three
 * tests green — the exact silent-skip failure this suite has been bitten by before.
 */
async function findRunWithToolUse(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const rowsRes = await fetch('/api/experiments/runs').then((r) => r.json()).catch(() => null);
    const rows: Array<Record<string, unknown>> = rowsRes?.rows ?? [];
    for (const r of rows.slice(0, 120)) {
      const id = r.task_id as string | undefined;
      if (!id) continue;
      const params = new URLSearchParams({ task_id: id });
      const set = (k: string, v: unknown) => { if (typeof v === 'string' && v) params.set(k, v); };
      set('window_start', r.started_at);
      set('window_end', r.ended_at);
      set('model', r.canonical_model ?? r.model);
      set('agent', r.canonical_agent ?? r.agent);
      const d = await fetch('/api/context-breakdown?' + params.toString())
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      const hist = d?.categories?.find((c: { key: string }) => c.key === 'hist');
      const items: Array<{ preview?: string }> = hist?.detail?.items ?? [];
      if (items.some((it) => typeof it.preview === 'string' && it.preview.includes('"type":"tool_use"'))) return id;
    }
    return null;
  });
}

async function openHistSamples(page: Page, taskId: string): Promise<boolean> {
  const expandAll = page.getByRole('button', { name: 'Expand all' });
  if ((await expandAll.count()) > 0) {
    await expandAll.first().click();
    await page.waitForTimeout(500);
  }
  const btn = page.locator(`button[aria-label="Explain context and caching for ${taskId}"]`);
  for (let i = 0; i < 8; i++) {
    if ((await btn.count()) > 0) break;
    const more = page.locator('[data-testid="runs-pagination"] button');
    if ((await more.count()) === 0) break;
    await more.first().click();
    await page.waitForTimeout(200);
  }
  if ((await btn.count()) === 0) return false;
  await btn.first().scrollIntoViewIfNeeded();
  await btn.first().click();
  await page.waitForSelector(EXPLAINER, { timeout: 8_000 });

  const hist = page.locator(`${EXPLAINER} >> text=Conversation History`).first();
  if ((await hist.count()) === 0) return false;
  await hist.click();
  await page.waitForSelector(SAMPLES, { timeout: 8_000 });
  return true;
}

test.describe('Performance — context explainer block legibility', () => {
  test('tool_use blocks lead with type, tool and description; raw JSON is folded and dulled', async ({ page }) => {
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');
    const taskId = await findRunWithToolUse(page);
    test.skip(!taskId, 'no run with tool_use blocks in its captured history');
    test.skip(!(await openHistSamples(page, taskId as string)), 'run not reachable in the runs table');

    // 1. The scannable trio is present and above the fold.
    await expect(page.locator(BLK_TOOL).first()).toBeVisible();
    const toolName = (await page.locator(BLK_TOOL).first().innerText()).trim();
    expect(toolName.length).toBeGreaterThan(0);
    expect(toolName).not.toContain('{'); // a tool NAME, not a slice of JSON
    await expect(page.locator(BLK_DESC).first()).toBeVisible();

    // 3. The verbatim JSON is folded, and closed by default. Scope to the card that
    //    actually carries a tool name — the FIRST card in history order is usually a
    //    `thinking` block, whose raw JSON legitimately has no tool id or input, so
    //    asserting on `details.first()` tested a different block than the header above
    //    it (and failed for that reason on the first run of this spec).
    const toolCard = page.locator(BLK_CARD).filter({ has: page.locator(BLK_TOOL) }).first();
    const details = toolCard.locator('details').first();
    await expect(details).toBeVisible();
    expect(await details.evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);

    // 4. Folding must not DELETE anything: expanding reveals the ids the header omits.
    await details.locator('summary').click();
    expect(await details.evaluate((d: HTMLDetailsElement) => d.open)).toBe(true);
    const raw = await details.locator('pre').first().innerText();
    expect(raw).toContain('"type":"tool_use"');
    expect(raw).toMatch(/toolu_|"input"/); // the opaque detail is still retrievable

    // 3b. …and it is genuinely DULLER than the description, not merely relocated.
    const descColor = await toolCard.locator(BLK_DESC).first().evaluate((e) => getComputedStyle(e).color);
    const rawColor = await details.locator('pre').first().evaluate((e) => getComputedStyle(e).color);
    expect(rawColor).not.toBe(descColor);
  });

  test('the type chip is colour-coded per kind, not uniformly grey', async ({ page }) => {
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');
    const taskId = await findRunWithToolUse(page);
    test.skip(!taskId, 'no run with tool_use blocks in its captured history');
    test.skip(!(await openHistSamples(page, taskId as string)), 'run not reachable in the runs table');

    // Chips are the only mono 10px bordered spans in a sample card; select by text so
    // the assertion states which kinds it is comparing.
    const chipColor = async (kind: string): Promise<string | null> => {
      const chip = page.locator(`${SAMPLES} span`, { hasText: new RegExp(`^${kind}$`) }).first();
      if ((await chip.count()) === 0) return null;
      return chip.evaluate((e) => getComputedStyle(e).color);
    };
    const toolUse = await chipColor('tool_use');
    const thinking = await chipColor('thinking');

    expect(toolUse, 'a tool_use chip must render').not.toBeNull();
    // Both kinds appear in any real agent turn; if the capture happens to hold only
    // one, the cross-kind comparison cannot be made — but the chip must still be
    // tinted rather than inheriting the default foreground.
    if (thinking) {
      expect(thinking, 'tool_use and thinking must not share a colour').not.toBe(toolUse);
    }
    const plainForeground = await page.locator(BLK_TOOL).first().evaluate((e) => getComputedStyle(e).color);
    expect(toolUse, 'the chip must be tinted, not default foreground').not.toBe(plainForeground);
  });

  test('non-JSON samples (tool_result content) still render verbatim and unfolded', async ({ page }) => {
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');
    const taskId = await findRunWithToolUse(page);
    test.skip(!taskId, 'no run with tool_use blocks in its captured history');

    const expandAll = page.getByRole('button', { name: 'Expand all' });
    if ((await expandAll.count()) > 0) { await expandAll.first().click(); await page.waitForTimeout(500); }
    const btn = page.locator(`button[aria-label="Explain context and caching for ${taskId}"]`);
    test.skip((await btn.count()) === 0, 'run not reachable in the runs table');
    await btn.first().scrollIntoViewIfNeeded();
    await btn.first().click();
    await page.waitForSelector(EXPLAINER, { timeout: 8_000 });

    const tout = page.locator(`${EXPLAINER} >> text=Tool Outputs`).first();
    test.skip((await tout.count()) === 0, 'run has no Tool Outputs category');
    await tout.click();
    await page.waitForSelector(SAMPLES, { timeout: 8_000 });

    // Tool-output content arrives as a plain string, so there is no block to parse:
    // it must fall through to the original unfolded <pre>, NOT be swallowed by a fold.
    await expect(page.locator(`${SAMPLES} pre`).first()).toBeVisible();
    expect(await page.locator(`${SAMPLES} details`).count()).toBe(0);
  });
});
