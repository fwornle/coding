/**
 * lib/history/paths.cjs + scripts/lib/history-dir.sh — where a repo's
 * transcripts live (T9). Both implementations answer every layout the same.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { repoHistoryDir, isHistoryDir, repoOfHistoryDir } = require('../../lib/history/paths.cjs');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SH = join(ROOT, 'scripts', 'lib', 'history-dir.sh');

const base = mkdtempSync(join(tmpdir(), 'history-paths-'));
test.after(() => rmSync(base, { recursive: true, force: true }));

function repo(name, build) {
  const r = join(base, name);
  mkdirSync(r, { recursive: true });
  build(r);
  return r;
}
const bash = (r) => execFileSync('bash', ['-c', `source "${SH}"; repo_history_dir "$1"`, '_', r], { encoding: 'utf8' }).trim();

const LAYOUTS = {
  'nothing yet → where it will be': [(r) => {}, '.coding/history'],
  'linked: .coding/ + the symlink': [(r) => {
    mkdirSync(join(r, '.coding', 'history'), { recursive: true });
    mkdirSync(join(r, '.specstory'));
    symlinkSync('../.coding/history', join(r, '.specstory', 'history'));
  }, '.coding/history'],
  'skipped: a local .coding/ only': [(r) => mkdirSync(join(r, '.coding')), '.coding/history'],
  'not launched since T3: a real .specstory/history': [(r) => mkdirSync(join(r, '.specstory', 'history'), { recursive: true }), '.specstory/history'],
  'an empty .coding/ does not hide a real legacy history (pofo, 2026-10-06)': [(r) => {
    mkdirSync(join(r, '.coding'));
    mkdirSync(join(r, '.specstory', 'history'), { recursive: true });
  }, '.specstory/history'],
  'both real (mid-migration): .coding wins': [(r) => {
    mkdirSync(join(r, '.coding', 'history'), { recursive: true });
    mkdirSync(join(r, '.specstory', 'history'), { recursive: true });
  }, '.coding/history'],
};

describe('repoHistoryDir', () => {
  for (const [name, [build, want]] of Object.entries(LAYOUTS)) {
    test(name, () => {
      const r = repo(name.replace(/\W+/g, '-'), build);
      assert.equal(repoHistoryDir(r), join(r, want));
      assert.equal(bash(r), join(r, want), 'the bash twin agrees');
    });
  }
});

describe('isHistoryDir / repoOfHistoryDir', () => {
  test('both layouts are recognised and map back to the repo', () => {
    for (const rel of ['.coding/history', '.specstory/history']) {
      assert.ok(isHistoryDir(join(base, 'x', rel)));
      assert.equal(repoOfHistoryDir(join(base, 'x', rel)), join(base, 'x'));
    }
  });
  test('anything else is not a history dir', () => {
    assert.equal(isHistoryDir(join(base, 'x', 'history')), false);
    assert.equal(repoOfHistoryDir(join(base, 'x', 'docs')), null);
  });
});
