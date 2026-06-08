// Phase 45 Plan 06 — Spec 7: RCA ingestion ops (CAP).
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "rca-ingestion"
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/panels/RcaOpsPanel.tsx
//                  + integrations/unified-viewer/src/api/OkmRcaClient.ts
//
// Per 45-06-PLAN.md Task 2 spec-7: this test runs in MOCK mode because
// the BMW CAP backend (https://okm.cc.bmwgroup.net) is not reachable from
// the Plan 06 executor's network — Probe 1/2 are DEFERRED-TO-OPERATOR
// per 45-06-OPERATOR-PROBES.md. Even when the operator's CAP probes are
// GREEN, the executor can't run them; so this spec is mock-only by design.
//
// What this spec asserts:
//   1. Route /api/okm/rca/dirs to a fixture that returns one RaaS dir.
//   2. Route /api/okm/ingest/progress to a server-sent-events stream that
//      emits connected → stage(extract) → stage(dedup) → ... → complete.
//      Because Playwright doesn't natively stream SSE through page.route,
//      we install a `TestEventSource` shim via an init script that
//      intercepts the EventSource constructor and feeds messages on a
//      timer.
//   3. /viewer/cap loads, the RCA tab shows the dir list with one row,
//      clicking Ingest cycles through the stage pills and reaches the
//      completion card.

import { test, expect } from '@playwright/test'

// Fixture: one RaaS dir to ingest.
const RCA_DIRS_FIXTURE = {
  kpifw: [],
  raas: [
    {
      path: '/data/rca/raas/2026-06-07T12-00-00Z',
      timestamp: '2026-06-07T12:00:00Z',
      findingCount: 5,
    },
  ],
  e2e: [],
}

// SSE script the test-init injects to mock EventSource.
const TEST_EVENT_SOURCE_INIT = `
(() => {
  const RealEventSource = window.EventSource;
  class TestEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onmessage = null;
      this.onerror = null;
      this.onopen = null;
      // Park outbound events on the instance so the test can fire them.
      window.__testSseInstances = window.__testSseInstances || [];
      window.__testSseInstances.push(this);
      // Auto-emit "connected" on next tick so the panel registers a handshake.
      setTimeout(() => {
        this.readyState = 1;
        this._emit({ type: 'connected' });
      }, 0);
    }
    _emit(payload) {
      if (typeof this.onmessage === 'function') {
        this.onmessage({ data: JSON.stringify(payload) });
      }
    }
    close() {
      this.readyState = 2;
    }
    addEventListener() { /* no-op for MVP */ }
    removeEventListener() { /* no-op for MVP */ }
  }
  window.EventSource = TestEventSource;
  window.__testSseEmitAll = (payload) => {
    (window.__testSseInstances || []).forEach(es => es._emit(payload));
  };
  window.__realEventSource = RealEventSource;
})();
`

test.describe('Unified Viewer — RCA ingestion (mock mode)', () => {
  test('mocked SSE drives the stage pills through to completion', async ({
    page,
  }) => {
    // 1. Inject the TestEventSource BEFORE any page script runs.
    await page.addInitScript(TEST_EVENT_SOURCE_INIT)

    // 2. Mock the dir listing.
    await page.route('**/api/okm/rca/dirs', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(RCA_DIRS_FIXTURE),
      }),
    )

    // 3. Mock the ingest POST.
    await page.route('**/api/okm/rca/ingest', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, runId: 'mock-run-1' }),
      }),
    )

    // 4. Even though Probe 1 deferred, intercept entities/relations/
    //    ontology so /viewer/cap mounts the CAP-system shell without
    //    waiting for an unreachable backend.
    await page.route('**/api/v1/entities', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
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
        body: JSON.stringify({ success: true, data: [] }),
      }),
    )

    await page.goto('/viewer/cap')
    await page.getByTestId('tab-rca').click()

    // RCA panel should render the one RaaS row.
    await expect(page.getByTestId('rca-ops-panel')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('rca-group-raas')).toBeVisible()
    const ingestBtn = page.getByTestId('rca-row-raas-0').getByRole('button')
    await expect(ingestBtn).toBeVisible()

    // Click Ingest — flips runningPipeline.
    await ingestBtn.click()

    // Drive the SSE stream forward — emit stage transitions.
    const stages: string[] = ['extract', 'dedup', 'store', 'synthesize', 'resolve']
    for (const stage of stages) {
      await page.evaluate((s) => {
        const w = window as unknown as {
          __testSseEmitAll?: (p: unknown) => void
        }
        w.__testSseEmitAll?.({ type: 'stage', stage: s })
      }, stage)
      // Tiny wait between events so React renders the pill transition.
      await page.waitForTimeout(100)
    }
    // Emit a progress event and a complete event.
    await page.evaluate(() => {
      const w = window as unknown as {
        __testSseEmitAll?: (p: unknown) => void
      }
      w.__testSseEmitAll?.({ type: 'progress', progress: 100 })
      w.__testSseEmitAll?.({
        type: 'complete',
        message: 'Ingestion complete (mock)',
      })
    })

    // The completion card surfaces.
    await expect(page.getByTestId('rca-completion-card')).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByTestId('rca-completion-card')).toContainText(
      'Ingestion complete (mock)',
    )
  })
})
