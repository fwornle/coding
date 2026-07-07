// tests/context-turns/openai-wire.test.mjs
//
// Behavior (RESEARCH Test Map): OpenAI-wire line marks cache_write as
// provider-none (the N/A discriminator — OpenAI /api/complete has no cache
// breakpoint concept).
//
// Wave 0 stub — implemented in 84-04. Harness-wiring smoke only.
import { test } from 'node:test';
import { loadFixture } from './_helpers.mjs';

const openaiBody = loadFixture('openai-complete-body.json');

test(
  'OpenAI-wire line marks cache_write as provider-none (N/A discriminator)',
  { skip: 'Wave 0 stub — implemented in 84-04' },
  () => {
    // 84-04: taxonomy over openaiBody.internalBody → assert cache_write is the
    // provider-none sentinel (not 0, not folded), agent === 'copilot'.
    void openaiBody;
  },
);
