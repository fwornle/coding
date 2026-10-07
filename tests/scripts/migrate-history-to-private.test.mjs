/**
 * scripts/migrate-history-to-private.sh — the way out for a repo whose OUTER git
 * tracks its transcripts under .specstory/history (the launcher refuses those).
 * Run for real against a throwaway project and a local bare remote: the result
 * must be the per-repo tenancy layout (<project>/.coding/history), never the
 * old nested .specstory/history checkout, and the project's tracked .gitignore
 * must not be touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'migrate-history-to-private.sh');

const base = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-history-')));
test.after(() => rmSync(base, { recursive: true, force: true }));

const home = join(base, 'home');
mkdirSync(home);
writeFileSync(join(base, 'gitconfig'),
  '[user]\n\tname = test\n\temail = test@localhost\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
const env = {
  ...process.env,
  HOME: home,
  CODING_HOME: home,
  GIT_CONFIG_GLOBAL: join(base, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

test('tracked .specstory/history moves into .coding/history, linked to the private remote', () => {
  const project = join(base, 'proj');
  mkdirSync(join(project, '.specstory', 'history', '2025', '06'), { recursive: true });
  git(project, 'init', '-q');
  writeFileSync(join(project, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(project, 'app.txt'), 'x\n');
  writeFileSync(join(project, '.specstory', 'history', '2025', '06', 's.md'), '# session\n');
  git(project, 'add', '.');
  git(project, 'commit', '-q', '-m', 'init with tracked transcripts');
  const remote = join(base, 'proj-history.git');

  const r = spawnSync('bash', [SCRIPT, project, '--auto', '--remote', remote], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, `script failed:\n${r.stdout}\n${r.stderr}`);

  assert.equal(git(project, 'ls-files', '.specstory'), '', 'the outer repo no longer tracks transcripts');
  assert.match(git(project, 'log', '-1', '--format=%s'), /stop tracking \.specstory\/history/);
  assert.ok(existsSync(join(project, '.coding', 'history', '2025', '06', 's.md')), 'transcript in .coding/history');
  assert.ok(!existsSync(join(project, '.specstory')), 'no .specstory/ left, no nested checkout there');
  assert.ok(existsSync(join(project, '.coding', '.git')), '.coding/ is the learning checkout');
  assert.equal(git(join(project, '.coding'), 'remote', 'get-url', 'origin'), remote);
  assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), 'node_modules/\n', 'tracked .gitignore untouched');
  assert.equal(git(project, 'status', '--porcelain'), '', 'outer tree clean: .coding/ excluded, not committed');
  assert.match(readFileSync(join(home, '.coding', 'repos.yaml'), 'utf8'), /proj-history\.git/, 'choice recorded');
});
