// tests/context-turns/sweeper.test.mjs
//
// Behavior (RESEARCH Test Map): the age sweeper deletes files older than the
// retention window, keeps files at-or-below it, and never throws on a bad dir.
// Drives `context-turns-sweeper-job.sh` via env `CONTEXT_TURNS_RETENTION_DAYS`.
//
// Wave 0 stub — implemented in 84-03. Harness-wiring smoke only.
import { test } from 'node:test';
import { mkTmpMeasurementsDir } from './_helpers.mjs';

test(
  'age sweeper deletes >retention, keeps <=retention, never throws on bad dir',
  { skip: 'Wave 0 stub — implemented in 84-03' },
  () => {
    // 84-03: seed old + fresh files under mkTmpMeasurementsDir(), run the
    // sweeper job with CONTEXT_TURNS_RETENTION_DAYS, assert old gone / fresh
    // kept; point it at a nonexistent dir and assert exit 0 (never-throw).
    const tmp = mkTmpMeasurementsDir();
    try {
      void tmp.dir;
    } finally {
      tmp.cleanup();
    }
  },
);
