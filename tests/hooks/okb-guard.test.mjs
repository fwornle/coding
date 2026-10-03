/**
 * The pre-commit KB guard, in both repositories it is installed into.
 *
 * It went stale silently: the trees it named (`.data/knowledge-export/`,
 * `.data/knowledge-graph/exports/`) moved to the data root in P0 and are
 * gitignored in the tools repo now, so the guard matched nothing except the
 * migration's own DELETIONS — which it then blocked. A guard that guards a
 * vacated path is worse than no guard: it reads as protection and provides
 * none, and its one observable effect is a false positive.
 *
 * These run the real hook against real throwaway git repositories, because the
 * thing being tested is its interaction with `git diff --cached`, and a mocked
 * git would only test the mock.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const HOOK = join(REPO, 'scripts/hooks/pre-commit-okb-guard.sh');

let root;

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

/** @returns {{code: number, out: string}} the hook's exit status and output */
function runHook(cwd, env = {}) {
  try {
    const out = execFileSync('bash', [HOOK], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function write(cwd, rel, body = 'x\n') {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

/**
 * A repo with an initial commit, so `git reset HEAD` is meaningful.
 * @param {boolean} isToolsRepo whether to plant the lib/paths marker
 */
function makeRepo(name, isToolsRepo) {
  const cwd = join(root, name);
  mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '.');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'user.name', 'test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  if (isToolsRepo) write(cwd, 'lib/paths/data-home.cjs', '// marker\n');
  write(cwd, 'README.md', 'base\n');
  git(cwd, 'add', '-A', '-f');
  git(cwd, 'commit', '-q', '-m', 'base', '--no-verify');
  return cwd;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'okb-guard-'));
});
after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('in the tools repo (lib/paths present)', () => {
  test('staging a moved KB tree is blocked, and the message says where it belongs', () => {
    const cwd = makeRepo('tools-add', true);
    write(cwd, '.data/knowledge-export/coding.json', '{}\n');
    git(cwd, 'add', '-f', '.data/knowledge-export/coding.json');

    const { code, out } = runHook(cwd);
    assert.equal(code, 1, 'KB content re-entering the tools repo must block the commit');
    assert.match(out, /coding-data-home/, 'the message must point at the data root, not "commit separately"');
    assert.match(out, /\.data\/knowledge-export\/coding\.json/, 'it must name the offending file');
  });

  test('all three moved trees are covered, not just the one that had a pattern', () => {
    // knowledge-graph/ and observation-export/ moved in the same pass. The old
    // pattern named `knowledge-export|exports`, so a re-included
    // observation-export would have walked straight through.
    for (const rel of [
      '.data/knowledge-graph/exports/coding.json',
      '.data/observation-export/observations.json',
      // T7: the UKB insight documents left too (a symlink into .coding/kb/).
      'knowledge-management/insights/SomePattern.md',
      'knowledge-management/insights/images/some-pattern.png',
    ]) {
      const cwd = makeRepo(`tools-${rel.split('/')[1]}`, true);
      write(cwd, rel, '{}\n');
      git(cwd, 'add', '-f', rel);
      assert.equal(runHook(cwd).code, 1, `${rel} must be guarded`);
    }
  });

  test('DELETING moved KB content is allowed', () => {
    // This is the false positive that exposed the staleness: the migration
    // commit was 507 deletions of exactly these paths, and the guard blocked
    // it. Removal is how the content leaves — it can never be the thing to stop.
    const cwd = makeRepo('tools-del', true);
    write(cwd, '.data/knowledge-export/coding.json', '{}\n');
    git(cwd, 'add', '-f', '.data/knowledge-export/coding.json');
    git(cwd, 'commit', '-q', '-m', 'kb', '--no-verify');

    git(cwd, 'rm', '-q', '--cached', '.data/knowledge-export/coding.json');
    assert.equal(runHook(cwd).code, 0, 'untracking KB content must not be blocked');

    // The T7 move: 2,353 insight documents untracked in one commit.
    write(cwd, 'knowledge-management/insights/A.md', 'a\n');
    git(cwd, 'add', '-f', 'knowledge-management/insights/A.md');
    git(cwd, 'commit', '-q', '-m', 'insight', '--no-verify');
    git(cwd, 'rm', '-q', '--cached', 'knowledge-management/insights/A.md');
    assert.equal(runHook(cwd).code, 0, 'untracking insight documents must not be blocked');
  });

  test('an ordinary code commit passes', () => {
    const cwd = makeRepo('tools-code', true);
    write(cwd, 'scripts/thing.js', '// code\n');
    git(cwd, 'add', 'scripts/thing.js');
    assert.equal(runHook(cwd).code, 0);
  });

  test('OKB_SNAPSHOT=1 still bypasses everything', () => {
    // SnapshotManager sets this via execGit env (Phase 44 S-3).
    const cwd = makeRepo('tools-snap', true);
    write(cwd, '.data/knowledge-export/coding.json', '{}\n');
    git(cwd, 'add', '-f', '.data/knowledge-export/coding.json');
    assert.equal(runHook(cwd, { OKB_SNAPSHOT: '1' }).code, 0);
  });
});

describe('in an OKB submodule (no lib/paths)', () => {
  // There `.data/exports/*.json` IS the live baseline and stays tracked, so the
  // original semantics must survive: KB-only fine, mixed blocked.

  test('a KB-only commit is allowed', () => {
    const cwd = makeRepo('okb-only', false);
    write(cwd, '.data/exports/coding.json', '{}\n');
    git(cwd, 'add', '-f', '.data/exports/coding.json');
    assert.equal(runHook(cwd).code, 0, 'a KB-only commit is the intended way to update the baseline');
  });

  test('mixing KB with code is blocked', () => {
    const cwd = makeRepo('okb-mixed', false);
    write(cwd, '.data/exports/coding.json', '{}\n');
    write(cwd, 'code.js', '// code\n');
    git(cwd, 'add', '-f', '.data/exports/coding.json', 'code.js');

    const { code, out } = runHook(cwd);
    assert.equal(code, 1);
    assert.match(out, /OKB BASELINE GUARD/);
  });

  test('a code-only commit passes', () => {
    const cwd = makeRepo('okb-code', false);
    write(cwd, 'code.js', '// code\n');
    git(cwd, 'add', 'code.js');
    assert.equal(runHook(cwd).code, 0);
  });
});

describe('the installed hook matches the template', () => {
  test('this repo runs the same guard install.sh ships', async () => {
    // They had drifted: the installed .git/hooks/pre-commit was a "mixed
    // commit" variant while the template blocked any KB staging. install.sh
    // only cp's the template at install time, so a template edit does not
    // reach an existing checkout until the next install — which is exactly how
    // a stale guard survives unnoticed.
    const { readFileSync, existsSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const installed = join(REPO, '.git/hooks/pre-commit');
    if (!existsSync(installed)) return; // a fresh clone before install.sh ran
    // Compared by digest, not by content: node:assert prints both values on
    // failure, and two 100-line shell scripts bury every other test's result.
    const digest = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
    assert.equal(
      digest(installed),
      digest(HOOK),
      'the installed .git/hooks/pre-commit differs from scripts/hooks/pre-commit-okb-guard.sh — ' +
        'run install.sh, or copy the template over it',
    );
  });
});
