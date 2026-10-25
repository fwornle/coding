// lib/cost/billing-rules.mjs — the discount, Copilot rate and FX in force on a
// row's day: dated periods by account, model family and model, over the
// standing values, over GitHub's rate card.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COPILOT_RATE_CARD } from '../../lib/cost/copilot-pricing.mjs';
import { copilotPriceAt, discountAt, usdPerEurAt, billingProblems, dayOf } from '../../lib/cost/billing-rules.mjs';

const price = (k) => ({ in: k, out: k * 4, cacheRead: k / 10, cacheWrite: k });

// A made-up contract: 20% off from April, a spring promotion on one family and
// one model, a quarter at another FX, and one model's rate changed by GitHub.
const cfg = {
  discount: { copilot: 0.9 },
  currency: { usdPerEur: 1.2 },
  copilotPrices: { 'claude-sonnet-5': price(2) },
  periods: [
    { from: '2026-04-01', discount: 0.8, note: 'contract' },
    { from: '2026-03', to: '2026-06', families: { claude: 0.7, 'claude-opus': 0.5 }, models: { 'gpt-5.6-sol': 0.6 } },
    { to: '2026-09-30', prices: { 'gpt-5.6-sol': price(9) } },
    { from: '2026-07-01', to: '2026-09-30', usdPerEur: 1.1 },
  ],
};

test('days: a timestamp, a day and a month all name a UTC day', () => {
  assert.equal(dayOf('2026-05-04T23:59:59.000Z'), '2026-05-04');
  assert.equal(dayOf('2026-05-04'), '2026-05-04');
  assert.equal(dayOf('2026-05'), '2026-05-01');
});

test('discount: the most specific rule in force wins — model, then the longest family, then the account', () => {
  assert.equal(discountAt(cfg, 'copilot', 'gpt-5.6-sol', '2026-05-10'), 0.6, 'model');
  assert.equal(discountAt(cfg, 'copilot', 'claude-opus-5', '2026-05-10'), 0.5, 'longest family prefix');
  assert.equal(discountAt(cfg, 'copilot', 'claude-opus-4-8', '2026-05-10'), 0.5, 'proxy spelling folds to the billed id');
  assert.equal(discountAt(cfg, 'copilot', 'claude-sonnet-5', '2026-05-10'), 0.7, 'shorter family');
  assert.equal(discountAt(cfg, 'copilot', 'gpt-6-luna', '2026-05-10'), 0.8, 'the period\'s account-wide discount');
  assert.equal(discountAt(cfg, 'copilot', 'gpt-6-luna', '2026-03-15'), 0.9, 'before the contract period: standing');
  assert.equal(discountAt(cfg, 'copilot', 'claude-opus-5', '2026-06-30'), 0.5, 'a month-only to covers its last day');
  assert.equal(discountAt(cfg, 'copilot', 'claude-opus-5', '2026-07-01'), 0.8, 'promotion over');
  assert.equal(discountAt(cfg, 'claude-max', 'claude-opus-5', '2026-05-10'), 1, 'another account: its own rules (none)');
  assert.equal(discountAt(cfg, 'copilot', 'claude-opus-5-fast', '2026-05-10'), 0.5, 'fast mode: its base model');
});

test('discount: a family prefix never matches a longer word', () => {
  const c = { periods: [{ families: { 'gpt-5': 0.5 } }] };
  assert.equal(discountAt(c, 'copilot', 'gpt-5-mini'), 0.5);
  assert.equal(discountAt(c, 'copilot', 'gpt-5.6-sol'), 0.5);
  assert.equal(discountAt(c, 'copilot', 'gpt-50'), 1);
});

test('discount: at equal specificity the later period wins', () => {
  const c = { periods: [{ from: '2026-01-01', discount: 0.8 }, { from: '2026-05-01', to: '2026-05-31', discount: 0.6 }] };
  assert.equal(discountAt(c, 'copilot', 'm', '2026-05-15'), 0.6);
  assert.equal(discountAt(c, 'copilot', 'm', '2026-06-01'), 0.8);
});

test('Copilot rate: a dated period, then the measured table, then the rate card, then unknown', () => {
  assert.deepEqual(copilotPriceAt(cfg, 'gpt-5.6-sol', '2026-09-30T23:59:59.000Z'), price(9));
  assert.deepEqual(copilotPriceAt(cfg, 'gpt-5.6-sol', '2026-10-01'), COPILOT_RATE_CARD['gpt-5.6-sol']);
  assert.deepEqual(copilotPriceAt(cfg, 'claude-sonnet-5'), price(2));
  assert.deepEqual(copilotPriceAt(cfg, 'claude-sonnet-5-fast'), price(2), 'fast mode: its base model');
  assert.deepEqual(copilotPriceAt({}, 'claude-sonnet-5'), COPILOT_RATE_CARD['claude-sonnet-5'], 'no cost file: the card');
  assert.equal(copilotPriceAt(cfg, 'no-such-model'), null);
});

test('FX: a dated period, then the standing one, then 1.18', () => {
  assert.equal(usdPerEurAt(cfg, '2026-08-15'), 1.1);
  assert.equal(usdPerEurAt(cfg, '2026-10-01'), 1.2);
  assert.equal(usdPerEurAt({}, '2026-10-01'), 1.18);
});

test('problems: each bad entry said once, and a good file has none', () => {
  assert.deepEqual(billingProblems(cfg), []);
  assert.deepEqual(billingProblems({}), []);
  assert.deepEqual(billingProblems({ periods: {} }), ['periods: not a list']);
  const bad = billingProblems({ periods: [
    { from: '2026-13', to: 'June', note: 'x' },
    { from: '2026-06-01', to: '2026-05-01', discount: 0, models: { m: 'half' }, prices: { m: { in: 1 } }, typo: 1 },
  ] });
  assert.deepEqual(bad, [
    'periods[0] (x): from "2026-13" is not YYYY-MM-DD or YYYY-MM',
    'periods[0] (x): to "June" is not YYYY-MM-DD or YYYY-MM',
    'periods[1]: from is after to',
    'periods[1]: discount must be a number above 0',
    'periods[1]: models.m must be a number above 0',
    'periods[1]: prices.m needs in, out, cacheRead and cacheWrite',
    'periods[1]: unknown key "typo"',
  ]);
});

test('calibration --into: fitted rates join the cost file — standing, or as a dated period — and its other keys stay', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { writeInto } = await import('../../scripts/cost/calibrate-copilot-prices.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-into-'));
  const file = path.join(dir, 'cost.json');
  fs.writeFileSync(file, JSON.stringify({ discount: { copilot: 0.8 }, copilotPrices: { a: price(1) } }));
  assert.equal(writeInto(file, { b: price(2) }, null), 'copilotPrices');
  writeInto(file, { a: price(3) }, { from: '2026-08-01', to: '2026-09-30' });
  writeInto(file, { a: price(4) }, { from: '2026-08-01', to: '2026-09-30' });
  const out = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(out.discount, { copilot: 0.8 });
  assert.deepEqual(out.copilotPrices, { a: price(1), b: price(2) });
  assert.equal(out.periods.length, 1, 'the same window is replaced, not repeated');
  assert.deepEqual(out.periods[0].prices, { a: price(4) });
  assert.deepEqual(copilotPriceAt(out, 'a', '2026-09-15'), price(4));
  assert.deepEqual(copilotPriceAt(out, 'a', '2026-10-01'), price(1));
  assert.deepEqual(billingProblems(out), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
