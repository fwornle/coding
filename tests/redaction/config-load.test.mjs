// tests/redaction/config-load.test.mjs
//
// Behavior (RESEARCH Test Map + Hand-off #2): the redaction applier loads all
// 27 configured patterns; masks sk-/Bearer/JWT/env-var secrets; preserves the
// existing `{ content, redactionCount, securityLevel }` return shape (the
// lsl-file-manager.js caller depends on it); fails closed on redaction error.
//
// Wave 0 stub — implemented in 84-02. Harness-wiring smoke only.
import { test } from 'node:test';
import { mkTmpMeasurementsDir } from '../context-turns/_helpers.mjs';

test(
  'redaction applier loads 27 patterns; masks secrets; preserves shape; fail-closed',
  { skip: 'Wave 0 stub — implemented in 84-02' },
  () => {
    // 84-02: load the pattern config, run redact() over strings containing
    // sk-/Bearer/JWT/env-var secrets, assert all masked, count>0, return shape
    // { content, redactionCount, securityLevel } intact, and fail-closed
    // ('[REDACTION_ERROR_CONTENT_BLOCKED]') on a forced error.
    const tmp = mkTmpMeasurementsDir();
    try {
      void tmp.dir;
    } finally {
      tmp.cleanup();
    }
  },
);
