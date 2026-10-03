/**
 * The LSL classifiers decide "is this the tools repo?" by containment, not by
 * string prefix or substring.
 *
 * PathAnalyzer.isCodingPath used `resolvedPath.startsWith(codingRepo)` and
 * `filePath.includes('coding/')`; ConversationBiasTracker used
 * `cwd.includes(codingRepo)`. With the repo at <x>/coding, all three called the
 * sibling <x>/coding-history — the LSL history checkout — part of the tools
 * repo, and `includes('coding/')` also fired on any `decoding/` directory.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import PathAnalyzer from '../../src/live-logging/PathAnalyzer.js';
import ConversationBiasTracker from '../../src/live-logging/ConversationBiasTracker.js';

let root;
let repo;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'containment-'));
  repo = join(root, 'coding');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), '');
  mkdirSync(join(root, 'coding-history'), { recursive: true });
  writeFileSync(join(root, 'coding-history', 'log.md'), '');
  mkdirSync(join(root, 'decoding'), { recursive: true });
  writeFileSync(join(root, 'decoding', 'b.js'), '');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('PathAnalyzer.isCodingPath', () => {
  test('a file inside the repo is a coding path', () => {
    const pa = new PathAnalyzer({ codingRepo: repo });
    assert.equal(pa.isCodingPath(join(repo, 'src', 'a.js')), true);
  });

  test('a file in the prefix-sharing sibling is not', () => {
    const pa = new PathAnalyzer({ codingRepo: repo });
    assert.equal(pa.isCodingPath(join(root, 'coding-history', 'log.md')), false);
  });

  test('a decoding/ directory is not', () => {
    const pa = new PathAnalyzer({ codingRepo: repo });
    assert.equal(pa.isCodingPath(join(root, 'decoding', 'b.js')), false);
  });

  test('a checkout under another name is found by its own name', () => {
    const other = join(root, 'tools');
    mkdirSync(join(other, 'lib'), { recursive: true });
    const pa = new PathAnalyzer({ codingRepo: other });
    assert.equal(pa.isCodingPath(join(other, 'lib', 'x.js')), true);
    assert.equal(pa.isCodingPath(join(repo, 'src', 'a.js')), false);
  });
});

describe('ConversationBiasTracker working-directory signal', () => {
  // Zero-confidence classifications add no weight of their own, so the
  // working-directory signal alone decides the bias. Two of them, because the
  // tracker computes no bias from a window shorter than two.
  const biasFor = (cwd) => {
    const t = new ConversationBiasTracker({ codingRepo: repo });
    t.currentWorkingDir = cwd;
    t.addClassification({ target: 'LOCAL', confidence: 0 });
    t.addClassification({ target: 'LOCAL', confidence: 0 });
    return t.currentBias;
  };

  test('a cwd inside the repo leans CODING', () => {
    assert.equal(biasFor(join(repo, 'src')), 'CODING_INFRASTRUCTURE');
  });

  test('a cwd in the prefix-sharing sibling leans LOCAL', () => {
    assert.equal(biasFor(join(root, 'coding-history')), 'LOCAL');
  });
});
