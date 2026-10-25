// lib/cost/copilot-pricing.mjs — a past month at the rate GitHub charged then.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COPILOT_PRICE_HISTORY, COPILOT_RATE_CARD, copilotRate } from '../../lib/cost/copilot-pricing.mjs';

test('GPT-5.6 Sol: September at its old rate, October on at the rate card', () => {
  const old = COPILOT_PRICE_HISTORY['gpt-5.6-sol'][0].price;
  assert.deepEqual(copilotRate('gpt-5.6-sol', undefined, '2026-09'), old);
  assert.deepEqual(copilotRate('gpt-5.6-sol', undefined, '2026-09-30T23:59:59.000Z'), old);
  assert.deepEqual(copilotRate('gpt-5.6-sol', undefined, '2026-10'), COPILOT_RATE_CARD['gpt-5.6-sol']);
  assert.deepEqual(copilotRate('gpt-5.6-sol'), COPILOT_RATE_CARD['gpt-5.6-sol'], 'no date: the current rate');
});

test('a model without history ignores the date', () => {
  assert.deepEqual(copilotRate('claude-haiku-4.5', undefined, '2026-01'), copilotRate('claude-haiku-4.5'));
});
