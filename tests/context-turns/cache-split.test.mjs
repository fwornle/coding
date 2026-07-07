// tests/context-turns/cache-split.test.mjs
//
// Behavior (RESEARCH Test Map): cache split carried separately
// (input/read/write/output), never folded into a single total.
//
// Wave 0 stub — implemented in 84-04. Harness-wiring smoke only.
import { test } from 'node:test';
import { loadFixture } from './_helpers.mjs';

const anthropicBody = loadFixture('anthropic-messages-body.json');

test(
  'cache split (input/read/write/output) is carried separately, never folded',
  { skip: 'Wave 0 stub — implemented in 84-04' },
  () => {
    // 84-04: assert the emitted line carries distinct cache_read / cache_write
    // / input / output fields (the >=2 ephemeral cache_control blocks in the
    // fixture drive non-empty breakpoints).
    void anthropicBody;
  },
);
