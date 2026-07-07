// tests/context-turns/close-gzip.test.mjs
//
// Behavior (RESEARCH Test Map): gzip-at-close produces a `.gz` and removes the
// plaintext; a crash mid-run leaves a readable `.jsonl`.
//
// Wave 0 stub — implemented in 84-05. Harness-wiring smoke only (tmp
// measurements dir mechanic proven).
import { test } from 'node:test';
import { mkTmpMeasurementsDir } from './_helpers.mjs';

test(
  'gzip-at-close produces .gz + removes plaintext; crash leaves readable .jsonl',
  { skip: 'Wave 0 stub — implemented in 84-05' },
  () => {
    // 84-05: write a .jsonl under mkTmpMeasurementsDir().withTaskId(...), run
    // the close handler, assert .gz exists + plaintext gone; simulate crash
    // and assert the plaintext .jsonl is still readable.
    const tmp = mkTmpMeasurementsDir();
    try {
      void tmp.dir;
    } finally {
      tmp.cleanup();
    }
  },
);
