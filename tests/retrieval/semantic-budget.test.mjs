// tests/retrieval/semantic-budget.test.mjs
//
// The caller's token budget must GOVERN the injected block.
//
// The defect this pins: retrieval-service.js computed
//     const semanticBudget = Math.min(budget - wm.tokens, 700);
// where 700 was a literal with no name and no comment. A caller raising `budget` to 2,000 or
// 3,000 to "give the block more room" silently still received 700 — the single most obvious
// remedy for an under-filled context block was a no-op, and nothing in the trace said so.
// Measured before the fix, three probe queries against a nominal 1,000-token budget returned
// tokens_used 675 / 670 / 689: pinned against the hidden ceiling, not the budget.
//
// Two guards, because either alone is weak:
//   1. a SOURCE assertion that no literal ceiling has been reintroduced — mirrors the existing
//      'no indexer re-introduces a hard-coded preview length' test in preview-length.test.mjs,
//      which is the established way this repo pins "do not hard-code this again";
//   2. a BEHAVIOURAL assertion that the assembler actually spends a larger budget, so the
//      guard cannot pass on a service that derives the budget correctly and then wastes it.
//
// node:test + node:assert/strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleBudgetedMarkdown } from '../../src/retrieval/token-budget.js';
import { SUMMARY_PREVIEW_CHARS } from '../../dist/embedding/preview.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE = path.join(REPO_ROOT, 'src', 'retrieval', 'retrieval-service.js');

test('the semantic budget is derived from the caller budget, not clamped to a literal', () => {
  const src = fs.readFileSync(SERVICE, 'utf8');
  const line = src.split('\n').find((ln) => /const\s+semanticBudget\s*=/.test(ln));
  assert.ok(line, 'semanticBudget assignment not found — did the variable get renamed?');

  // It must reference the caller's budget...
  assert.match(line, /\bbudget\b/, `semanticBudget must derive from budget, got: ${line.trim()}`);
  // ...and must NOT re-clamp it to a bare number. `Math.min(budget - wm.tokens, 700)` is the
  // exact shape that made a 3,000-token request behave like a 700-token one.
  assert.doesNotMatch(
    line,
    /Math\.min\([^)]*\b\d{2,}\b[^)]*\)/,
    `semanticBudget must not be clamped to a numeric literal, got: ${line.trim()}`,
  );
});

test('a larger budget actually buys more complete insights', () => {
  // p90-sized insight previews (the new cap). Each costs ~825 tokens, so 700 admits ONE and
  // 2,700 admits several — the whole point of the change.
  const insight = (id) => ({
    id,
    tier: 'insights',
    rrfScore: 1 - id / 100,
    payload: {
      topic: `Topic ${id}`,
      confidence: 0.9,
      summary_preview: `body ${id} ` + 'lorem ipsum dolor sit amet consectetur '.repeat(80),
    },
  });
  const results = [insight(1), insight(2), insight(3), insight(4)];

  const small = assembleBudgetedMarkdown(results, 700);
  const large = assembleBudgetedMarkdown(results, 2700);

  assert.ok(
    large.items.length > small.items.length,
    `2,700 tokens should admit more items than 700 (got ${large.items.length} vs ${small.items.length})`,
  );
  assert.ok(large.tokensUsed > small.tokensUsed, 'the larger budget should actually be spent');
  assert.ok(large.tokensUsed <= 2700, `must not exceed the budget, used ${large.tokensUsed}`);
});

test('the preview cap clears the embedder window, so delivery is not the narrower limit', () => {
  // all-MiniLM-L6-v2 truncates at 512 tokens — measured at ~2,050 chars (two texts sharing a
  // 2,132-char head and differing entirely after it embed to byte-identical vectors). A stored
  // preview SHORTER than that would throw away text the retriever had already read and ranked
  // on, which is strictly wasteful. It may exceed it (the model still benefits), but never
  // undershoot it.
  const EMBEDDER_WINDOW_CHARS = 2050;
  assert.ok(
    SUMMARY_PREVIEW_CHARS >= EMBEDDER_WINDOW_CHARS,
    `preview cap ${SUMMARY_PREVIEW_CHARS} is below the ~${EMBEDDER_WINDOW_CHARS}-char embedder window, ` +
      'so ranked-on text would be discarded before injection',
  );
});
