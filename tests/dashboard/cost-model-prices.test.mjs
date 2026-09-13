/**
 * Price resolution in the dashboard's cost model.
 *
 * Guards two things that fail SILENTLY when wrong, which is why they are worth
 * a suite at all:
 *
 *   1. A model with no price row still resolves — `modelFamily()` substring-
 *      matches `claude-opus-5` to the opus family and prices it off whichever
 *      representative row exists. It returns `priced: true` and no warning, so
 *      a missing row for a high-traffic model looks exactly like a correct one.
 *      On 2026-09-13 the map had no `claude-opus-5` or `claude-sonnet-5` row
 *      while those two carried ~37k rows/month between them; they happened to
 *      price correctly only because the 4.8/4.6 representatives carry the same
 *      rates. That is luck, and it expires the moment a tier diverges.
 *
 *   2. Fast mode is the same model at premium price under a `-fast` model id.
 *      Without the rule the family fallback prices it at the STANDARD rate —
 *      again `priced: true`, again no warning, and understated by 2x.
 *
 * Prices asserted here are USD per 1M tokens, from the Anthropic price list as
 * of 2026-09-13. If a published price changes, this suite is where it shows up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COST_SRC, loadRoutingModules } from '../helpers/dashboard-ts.mjs';

const { DEFAULT_COST_CONFIG, priceForModel } = await loadRoutingModules({
  names: ['cost-model'],
  entry: 'cost-model',
  prefix: 'cost-model-prices-',
  srcDir: COST_SRC,
});

const PRICES = DEFAULT_COST_CONFIG.modelPrices;

test('claude-opus-5 has its own row at the current Opus tier', () => {
  const r = priceForModel('claude-opus-5', PRICES);
  assert.equal(r.source, 'exact', 'must not depend on the family fallback');
  assert.deepEqual(r.price, { in: 5, out: 25, cacheRead: 0.50, cacheWrite: 6.25 });
});

test('claude-sonnet-5 has its own row at the standard (post-intro) Sonnet tier', () => {
  const r = priceForModel('claude-sonnet-5', PRICES);
  assert.equal(r.source, 'exact');
  assert.deepEqual(r.price, { in: 3, out: 15, cacheRead: 0.30, cacheWrite: 3.75 });
});

test('every model family representative actually exists in the default map', () => {
  // The representative list is the fallback path; a name that is not a key in
  // modelPrices silently falls through to the looser any-key-in-family scan.
  for (const name of ['claude-haiku-4.5', 'claude-sonnet-5', 'claude-opus-5']) {
    assert.ok(PRICES[name], `${name} must be a real row`);
  }
});

test('-fast doubles the base model price', () => {
  const base = priceForModel('claude-opus-5', PRICES);
  const fast = priceForModel('claude-opus-5-fast', PRICES);
  assert.equal(fast.source, 'fast');
  assert.deepEqual(fast.price, { in: 10, out: 50, cacheRead: 1.00, cacheWrite: 12.50 });
  assert.equal(fast.price.in, base.price.in * 2);
  assert.equal(fast.price.out, base.price.out * 2);
});

test('-fast works for a model that itself only resolves by family', () => {
  // claude-opus-4.8-fast is the id actually present in token_usage. Strip the
  // suffix and the base is an exact row; the point here is the composition.
  const fast = priceForModel('claude-opus-4.8-fast', PRICES);
  assert.equal(fast.source, 'fast');
  assert.deepEqual(fast.price, { in: 10, out: 50, cacheRead: 1.00, cacheWrite: 12.50 });

  // And a fast id whose base is NOT a row at all: opus-4.6 has no row, so the
  // base resolves by family, then the premium applies on top.
  const viaFamily = priceForModel('claude-opus-4.6-fast', PRICES);
  assert.equal(viaFamily.source, 'fast');
  assert.equal(viaFamily.price.in, 10);
});

test('an explicit -fast row overrides the rule', () => {
  // Exact match is checked before the suffix, so an operator can pin a tier
  // whose fast premium is not 2x without touching the code.
  const pinned = { ...PRICES, 'claude-opus-5-fast': { in: 7, out: 35, cacheRead: 0.7, cacheWrite: 8.75 } };
  const r = priceForModel('claude-opus-5-fast', pinned);
  assert.equal(r.source, 'exact');
  assert.equal(r.price.in, 7);
});

test('the rule does not fire for a non-fast model', () => {
  for (const m of ['claude-opus-5', 'claude-sonnet-4.6', 'gpt-5', 'fastidious-model']) {
    assert.notEqual(priceForModel(m, PRICES).source, 'fast', `${m} must not be treated as fast mode`);
  }
});

test('a -fast id with no resolvable base stays unpriced rather than priced at zero-times-two', () => {
  const r = priceForModel('qwen3.8-27b-fast', PRICES);
  assert.equal(r.source, 'none');
  assert.equal(r.priced, false);
});
