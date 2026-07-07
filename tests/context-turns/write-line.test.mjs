// tests/context-turns/write-line.test.mjs
//
// Behavior (RESEARCH Test Map): logContextTurn writes one valid JSONL line per
// request.
//
// Wave 0 stub — implemented in 84-04. This file proves the harness is wired
// (imports _helpers.mjs + loads the recorded Anthropic request body). The
// production assertion (one parseable JSONL line, required fields present) is
// filled when 84-04 lands logContextTurn.
import { test } from 'node:test';
import { loadFixture } from './_helpers.mjs';

// Prove the fixture loads through the harness (module-eval smoke).
const anthropicBody = loadFixture('anthropic-messages-body.json');

test(
  'logContextTurn writes exactly one valid JSONL line per request',
  { skip: 'Wave 0 stub — implemented in 84-04' },
  () => {
    // 84-04: call logContextTurn(anthropicBody, ...), read the .jsonl via
    // readJsonl(), assert exactly one line with the required turn fields.
    void anthropicBody;
  },
);
