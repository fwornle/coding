/**
 * The dashboard polls only while someone is looking (src/lib/attention.ts).
 *
 * The rules worth a suite, because each fails quietly — a page that polls too
 * much still renders, and one that never resumes just looks stale:
 *
 *   - a visible page with no input for 10 min is unattended (a tab left open
 *     overnight in a visible window polled all night on 2026-10-30)
 *   - the first input after that makes it attended at once
 *   - hiding the tab is unattended at once; showing it again is attended
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadRoutingModules } from '../helpers/dashboard-ts.mjs';

const LIB_SRC = path.resolve(import.meta.dirname, '..', '..', 'integrations/system-health-dashboard/src/lib');

function fakePage() {
  const handlers = { window: {}, document: {} };
  const on = (bag) => (ev, fn) => { (bag[ev] ||= []).push(fn); };
  const doc = { hidden: false, addEventListener: on(handlers.document) };
  const win = { addEventListener: on(handlers.window) };
  const fire = (bag, ev) => { for (const fn of handlers[bag][ev] || []) fn(); };
  return { doc, win, fire };
}

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-30T20:00:00Z') });
const page = fakePage();
globalThis.document = page.doc;
globalThis.window = page.win;
const attention = await loadRoutingModules({ names: ['attention'], entry: 'attention', prefix: 'attention-', srcDir: LIB_SRC });

test('a visible page goes unattended after 10 min without input, and the first input brings it back', () => {
  const seen = [];
  const off = attention.onPageAttendedChange((a) => seen.push(a));
  assert.equal(attention.isPageAttended(), true);

  mock.timers.tick(9 * 60_000);
  page.fire('window', 'pointermove');
  mock.timers.tick(9 * 60_000);
  assert.equal(attention.isPageAttended(), true, 'input 9 min ago: still attended');

  mock.timers.tick(2 * 60_000);
  assert.equal(attention.isPageAttended(), false, '11 min without input: unattended');

  page.fire('window', 'keydown');
  assert.equal(attention.isPageAttended(), true, 'one key: attended again');
  assert.deepEqual(seen, [false, true]);
  off();
});

test('hiding the tab is unattended at once; showing it again is attended', () => {
  page.doc.hidden = true;
  page.fire('document', 'visibilitychange');
  assert.equal(attention.isPageAttended(), false);
  page.fire('window', 'pointermove');
  assert.equal(attention.isPageAttended(), false, 'input on a hidden page does not count');

  page.doc.hidden = false;
  page.fire('document', 'visibilitychange');
  assert.equal(attention.isPageAttended(), true);
  assert.equal(attention.ATTENDED_IDLE_MS, 10 * 60_000);
});
