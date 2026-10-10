/**
 * proxyDir() from a linked git worktree: the rapid-llm-proxy sibling belongs to
 * the main checkout, not to <main>/.claude/worktrees/<name>. Reading the worktree's
 * own path sent glass extract to a proxy that does not exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// This checkout's module, not CODING_REPO's: the test runs from worktrees too.
const { mainCheckout } = require('../../lib/proxy/proxy-paths.cjs');

test('a linked worktree resolves to its main checkout', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'proxy-paths-')));
  try {
    const main = join(root, 'coding');
    const wt = join(main, '.claude', 'worktrees', 'feature');
    const meta = join(main, '.git', 'worktrees', 'feature');
    mkdirSync(meta, { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), `gitdir: ${meta}\n`);
    writeFileSync(join(meta, 'commondir'), '../..\n');
    assert.equal(mainCheckout(wt), main);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a plain checkout, or no git at all, is itself', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'proxy-paths-')));
  try {
    mkdirSync(join(root, 'plain', '.git'), { recursive: true });
    assert.equal(mainCheckout(join(root, 'plain')), join(root, 'plain'));
    mkdirSync(join(root, 'bare-dir'));
    assert.equal(mainCheckout(join(root, 'bare-dir')), join(root, 'bare-dir'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
