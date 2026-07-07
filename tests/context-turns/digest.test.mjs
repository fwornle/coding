// tests/context-turns/digest.test.mjs
//
// Behavior (RESEARCH Test Map): preview fallback always present (~120 char cap)
// + tool name/size captured from tool_use / tool_result blocks.
//
// Wave 0 stub — implemented in 84-04. Harness-wiring smoke only.
import { test } from 'node:test';
import { loadFixture } from './_helpers.mjs';

const anthropicBody = loadFixture('anthropic-messages-body.json');

test(
  'preview fallback (~120 char cap) present and tool name/size captured',
  { skip: 'Wave 0 stub — implemented in 84-04' },
  () => {
    // 84-04: digest(anthropicBody) → assert preview length <= ~120 and the
    // tool_use ('read_file') name + tool_result size are extracted.
    void anthropicBody;
  },
);
