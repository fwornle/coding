// tests/retrieval/preview-length.test.mjs
//
// The stored preview is the real ceiling on injected knowledge.
//
// `formatResult` (src/retrieval/token-budget.js) renders ONLY an item's `summary_preview`,
// so whatever the indexer stores in that field is the most any single item can ever
// contribute to a prompt — regardless of the 1000-token budget. That coupling was
// invisible: the length lived as a bare `substring(0, 200)` duplicated across five call
// sites, and the measured consequence was a median 285 of 1000 tokens used, with the
// injected block cutting off mid-sentence before anything actionable.
//
// These tests pin the two properties that keep it honest: the length is defined in exactly
// one place, and it is large enough that the request-time BUDGET decides what gets injected
// rather than an index-time constant nobody can see.
//
// node:test + node:assert/strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/, not src/: src/embedding is TypeScript, and every runtime consumer imports the
// compiled module (retrieval-service.js does the same for embedding-service). This also
// makes the test fail loudly when dist/ is stale relative to a preview.ts change.
import { SUMMARY_PREVIEW_CHARS, makePreview, previewVersion } from '../../dist/embedding/preview.js';
import { assembleBudgetedMarkdown } from '../../src/retrieval/token-budget.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('makePreview truncates to the shared cap and is null-safe', () => {
  assert.equal(makePreview('x'.repeat(5000)).length, SUMMARY_PREVIEW_CHARS);
  assert.equal(makePreview('short'), 'short');
  assert.equal(makePreview(''), '');
  assert.equal(makePreview(null), '');
  assert.equal(makePreview(undefined), '');
});

test('previewVersion tracks the cap so a policy change forces a re-index', () => {
  // backfill.ts skips a point only when content_hash AND preview_version both match.
  // If this stamp stopped tracking the cap, raising the cap would silently skip every
  // point (the content is unchanged) and the longer preview would never be indexed.
  assert.equal(previewVersion(), SUMMARY_PREVIEW_CHARS);
});

test('no indexer re-introduces a hard-coded preview length', () => {
  // The regression this guards: the cap was `substring(0, 200)` in five places, so it was
  // not discoverable from the retrieval side that suffered for it.
  for (const rel of ['src/embedding/listener.ts', 'src/embedding/backfill.ts']) {
    const src = readFileSync(path.join(repoRoot, rel), 'utf8');
    // Scope to where a preview is actually assigned. A blanket `.substring(0, N)` search
    // false-positives on unrelated slicing (keyToUuid chops an md5 hex into UUID fields).
    const offenders = src
      .split(/\r?\n/)
      .filter((ln) => /summary_preview\s*:/.test(ln) && /\.substring\(/.test(ln));
    assert.deepEqual(
      offenders, [],
      `${rel} must build previews via makePreview(), not a literal substring:\n${offenders.join('\n')}`,
    );
    assert.ok(src.includes('makePreview('), `${rel} should use makePreview()`);
  }
});

test('the cap is generous enough that the token budget is what binds', () => {
  // The point of the change: a single item must be able to claim a meaningful share of the
  // 700-token semantic budget, so assembly (which is traced and tunable per request) decides
  // what is injected — not an index-time constant that needs a full re-embed to move.
  const big = (id) => ({
    id, tier: 'insights', rrfScore: 1 - id / 100,
    payload: { topic: `Topic ${id}`, confidence: 0.9, summary_preview: `body ${id} ` + 'lorem ipsum dolor sit amet '.repeat(80) },
  });
  const results = [big(1), big(2), big(3), big(4)];
  const capped = results.map((r) => ({
    ...r, payload: { ...r.payload, summary_preview: makePreview(r.payload.summary_preview) },
  }));

  const { items, skipped, tokensUsed } = assembleBudgetedMarkdown(capped, 700);

  // Budget-bound, not cap-bound: some items are refused for budget, and the ones that land
  // consume a real share of it.
  assert.ok(skipped.some((s) => s.reason === 'budget'), 'the 700-token budget should bind');
  assert.ok(items.length >= 1, 'at least one item must be injected');
  assert.ok(tokensUsed > 350, `expected to use most of the budget, used ${tokensUsed}`);
  assert.ok(tokensUsed <= 700, `must not exceed the budget, used ${tokensUsed}`);
});

test('at the OLD 200-char cap the budget could not bind — the regression being fixed', () => {
  // Same four items, truncated the way the indexer used to. Four insights (the tier cap)
  // cannot fill even half the budget, which is why real captures sat at 28% utilisation.
  const old = (id) => ({
    id, tier: 'insights', rrfScore: 1 - id / 100,
    payload: { topic: `Topic ${id}`, confidence: 0.9, summary_preview: (`body ${id} ` + 'lorem ipsum dolor sit amet '.repeat(80)).substring(0, 200) },
  });

  const { skipped, tokensUsed } = assembleBudgetedMarkdown([old(1), old(2), old(3), old(4)], 700);

  assert.equal(skipped.filter((s) => s.reason === 'budget').length, 0, 'budget never bound at 200 chars');
  assert.ok(tokensUsed < 350, `old cap left the budget mostly unused, got ${tokensUsed}`);
});
