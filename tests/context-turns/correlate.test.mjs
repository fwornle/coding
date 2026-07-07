// tests/context-turns/correlate.test.mjs
//
// Behavior (RESEARCH Test Map + Hand-off #1): observation correlation picks the
// nearest-by-createdAt observation within the span window + matching agent, and
// yields null when none correlate. Observations carry NO task_id, so the join
// is a best-effort [from,to]-window + agent reference (D-07/D-08).
//
// Wave 0 stub — implemented in 84-05. Harness-wiring smoke only.
import { test } from 'node:test';
import { loadFixture } from './_helpers.mjs';

const observations = loadFixture('observations-slice.json');

test(
  'correlation: nearest-by-createdAt within span window + agent; null when none',
  { skip: 'Wave 0 stub — implemented in 84-05' },
  () => {
    // 84-05: given a span window (2026-07-07T10:00Z..11:00Z, agent 'claude'),
    // assert a turn correlates to the nearest in-window claude observation and
    // that the out-of-window 2026-07-06 record is excluded (→ null when none).
    void observations;
  },
);
