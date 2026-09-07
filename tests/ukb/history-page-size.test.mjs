/**
 * Source contract for the UKB History tab's page size.
 *
 * The tab fetched `/api/ukb/history?limit=50` with the 50 hardcoded at the call
 * site. That is fewer than the reports this project already has (119), so
 * everything older than the newest 50 was unreachable from the UI — including
 * the ONLY batch-analysis run, the one whose Pipeline Totals card shows commits,
 * sessions and entity counts. The list said "50 workflows found", presenting a
 * page as if it were the total, so nothing indicated anything was missing.
 *
 * These are source assertions rather than behavioural ones: the dashboard has no
 * React component test harness, and standing one up for a page-size constant is
 * not worth it. The same technique is used elsewhere in this repo (see
 * tests/integration/obs-api-busy-signal.test.js) for exactly this case — a
 * constant or guard whose regression is invisible at runtime until someone goes
 * looking for missing data.
 *
 * Runner: node --test tests/ukb/history-page-size.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASH = path.join(REPO_ROOT, 'integrations', 'system-health-dashboard');

const modal = readFileSync(path.join(DASH, 'src', 'components', 'ukb-workflow-modal.tsx'), 'utf8');
const slice = readFileSync(path.join(DASH, 'src', 'store', 'slices', 'ukbSlice.ts'), 'utf8');
const server = readFileSync(path.join(DASH, 'server.js'), 'utf8');

describe('UKB history page size', () => {
  test('the history fetch uses the named constant, not a literal', () => {
    assert.match(modal, /\/api\/ukb\/history\?limit=\$\{HISTORY_PAGE_SIZE\}/);
    // The literal that caused the bug must not come back at the call site.
    assert.doesNotMatch(modal, /\/api\/ukb\/history\?limit=\d+/);
  });

  test('the page size comfortably exceeds the reports a project accumulates', () => {
    const declared = modal.match(/const HISTORY_PAGE_SIZE = (\d+)/);
    assert.ok(declared, 'HISTORY_PAGE_SIZE is not declared');
    assert.ok(
      Number(declared[1]) >= 500,
      `HISTORY_PAGE_SIZE is ${declared[1]}; reports accrue one per run and 119 already exist`,
    );
  });

  test('the server still reports the true total alongside the page', () => {
    // The "N of M" label and the truncation warning both depend on this field.
    assert.match(server, /total: filteredReports\.length/);
    assert.match(server, /data: filteredReports\.slice\(0, parseInt\(limit\)\)/);
  });
});

describe('UKB history truncation is visible, not silent', () => {
  test('the store keeps the server total, not just the page length', () => {
    assert.match(slice, /historyTotal: number/);
    assert.match(slice, /state\.historyTotal = action\.payload\.total/);
  });

  test('a truncated list says "of M" rather than presenting the page as the total', () => {
    const flat = modal.replace(/\s+/g, ' ');
    assert.match(flat, /historyTotal > historicalWorkflows\.length \? ` of \$\{historyTotal\}` : ''/);
  });

  test('hitting the page size logs a warning naming the constant', () => {
    const flat = modal.replace(/\s+/g, ' ');
    assert.match(flat, /Workflow history truncated at \$\{HISTORY_PAGE_SIZE\}/);
    assert.match(flat, /Logger\.warn\(/);
  });

  test('the total falls back to the page length when the server omits it', () => {
    // Otherwise an older server would make the label read "0".
    assert.match(slice, /action\.payload\.total \?\? action\.payload\.workflows\.length/);
  });
});
