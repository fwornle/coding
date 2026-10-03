/**
 * bin/init-history.sh sets up the tools repo's own learning checkout — the
 * tools repo is an ordinary linked repo since per-repo tenancy T7:
 * `<coding>/.coding/` (history/ + kb/), `.specstory/history` and
 * `knowledge-management/insights` symlinks into it.
 *
 * Behavioural: the script runs on every `bin/coding` launch and moves the most
 * private data this system holds, so the properties that matter — the
 * developer's nested history checkout migrates intact, a remote from install
 * time is cloned, the insight documents leave the tracked tree only once they
 * are no longer tracked, nothing is pushed — are checked by running it.
 *
 * Each case builds a throwaway "tools repo" (a git repo holding just the script
 * and the modules it calls), a throwaway HOME (CODING_HOME), and local bare
 * repos as remotes. Nothing here can reach the real ~/.coding or a real
 * history repo.
 *
 * Runner: node --test tests/scripts/init-history.test.mjs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readlinkSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;

let root, tools, home, gitconfig;

/** Run the sandboxed script with an environment scrubbed of every scope seam. */
function run() {
  const env = { ...process.env, CODING_HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['CODING_DATA_HOME', 'CODING_SCOPE', 'CODING_TOOLS_PATH', 'CODING_REPO', 'LSL_HISTORY_AUTO', 'LSL_HISTORY_REMOTE_TEMPLATE']) delete env[k];
  return execFileSync('bash', [join(tools, 'bin', 'init-history.sh')], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

/** A bare remote whose tree is `files` ({ relativePath: content }). */
function remote(name, files) {
  const work = join(root, `${name}-src`);
  mkdirSync(work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(work, rel, '..'), { recursive: true });
    writeFileSync(join(work, rel), body);
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  const bare = join(root, `${name}.git`);
  git(root, 'clone', '-q', '--bare', work, bare);
  return bare;
}

const setRemote = (url) => writeFileSync(join(tools, '.env'), `CODING_HISTORY_REPO=${url}\n`);
const link = () => join(tools, '.specstory', 'history');
const insights = () => join(tools, 'knowledge-management', 'insights');
const checkout = () => join(tools, '.coding');
const registry = () => readFileSync(join(home, '.coding', 'repos.yaml'), 'utf8');

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'init-history-')));
  tools = join(root, 'tools');
  home = join(root, 'home');
  gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = test\n\temail = test@localhost\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
  mkdirSync(join(tools, 'bin'), { recursive: true });
  mkdirSync(home);
  cpSync(join(REPO, 'bin', 'init-history.sh'), join(tools, 'bin', 'init-history.sh'));
  // lib/history links; lib/scope + lib/paths resolve; lib/features/vendor is its YAML parser.
  for (const d of ['lib/paths', 'lib/scope', 'lib/history', 'lib/features/vendor']) cpSync(join(REPO, d), join(tools, d), { recursive: true });
  writeFileSync(join(tools, 'package.json'), '{"type":"module"}\n');
  // The real repo's ignore rule for the insights link (asserted against the
  // real .gitignore below), so `git status` here means what it means there.
  writeFileSync(join(tools, '.gitignore'), '/knowledge-management/insights\n.env\n');
  git(tools, 'init', '-q');
  git(tools, 'add', '-A');
  git(tools, 'commit', '-q', '-m', 'tools');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function assertLinks() {
  assert.ok(lstatSync(link()).isSymbolicLink(), '.specstory/history must be a symlink');
  assert.equal(readlinkSync(link()), join('..', '.coding', 'history'));
  assert.ok(lstatSync(insights()).isSymbolicLink(), 'knowledge-management/insights must be a symlink');
  assert.equal(readlinkSync(insights()), join('..', '.coding', 'kb', 'insights'));
  assert.ok(existsSync(join(checkout(), 'history', 'logs', 'classification')));
  assert.equal(git(tools, 'status', '--porcelain'), '', 'the tools repo sees none of it');
}

describe('bin/init-history.sh', () => {
  test('the real .gitignore ignores the insights link', () => {
    const r = execFileSync('git', ['check-ignore', '-v', '--no-index', 'knowledge-management/insights'], { cwd: REPO, encoding: 'utf8' });
    assert.match(r, /\.gitignore:\d+:\/knowledge-management\/insights\s/);
  });

  test('no remote configured: the layout, nothing recorded, nothing asked', () => {
    run();
    assertLinks();
    assert.ok(!existsSync(join(checkout(), '.git')), 'no repo configured, no checkout');
    assert.ok(!existsSync(join(home, '.coding', 'repos.yaml')), 'the launcher asks later');
  });

  test('a remote from install time is cloned and recorded', () => {
    const url = remote('dh', { 'history/2026/10/s.jsonl': 'session', 'kb/notes.json': '{}', 'README.md': '# c\n' });
    setRemote(url);
    run();
    assertLinks();
    assert.equal(readFileSync(join(link(), '2026', '10', 's.jsonl'), 'utf8'), 'session');
    assert.equal(readFileSync(join(checkout(), 'kb', 'notes.json'), 'utf8'), '{}');
    assert.match(registry(), new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('a transcripts-only repo (the original coding-history) is restructured, committed locally, not pushed', () => {
    const url = remote('legacy', { '2026/09/old.md': 'old', 'logs/classification/c.json': '{}' });
    setRemote(url);
    run();
    assertLinks();
    assert.equal(readFileSync(join(link(), '2026', '09', 'old.md'), 'utf8'), 'old');
    assert.equal(git(checkout(), 'status', '--porcelain'), '');
    assert.notEqual(git(checkout(), 'rev-parse', 'HEAD'), git(checkout(), 'rev-parse', 'origin/main'), 'restructure is local');
  });

  test("the developer's nested .specstory/history checkout migrates; the runtime stays untracked", () => {
    const url = remote('coding-history', { '2026/10/mine.md': 'precious', 'chain-map.json': '{}' });
    git(root, 'clone', '-q', url, link());
    mkdirSync(join(checkout(), 'runtime'), { recursive: true });
    writeFileSync(join(checkout(), 'runtime', 'features.json'), '{}');
    writeFileSync(join(checkout(), 'session-state.json'), '{}');
    run();
    assertLinks();
    assert.equal(readFileSync(join(link(), '2026', '10', 'mine.md'), 'utf8'), 'precious');
    assert.ok(existsSync(join(checkout(), 'runtime', 'features.json')));
    assert.doesNotMatch(git(checkout(), 'ls-files'), /runtime\/|session-state/);
    assert.equal(git(checkout(), 'status', '--porcelain'), '');
  });

  test('still-tracked insight documents are left alone', () => {
    mkdirSync(insights(), { recursive: true });
    writeFileSync(join(insights(), 'A.md'), 'a');
    git(tools, 'add', '-f', 'knowledge-management/insights/A.md');
    git(tools, 'commit', '-q', '-m', 'pre-T7');
    run();
    assert.ok(!lstatSync(insights()).isSymbolicLink());
    assert.equal(readFileSync(join(insights(), 'A.md'), 'utf8'), 'a');
  });

  test('untracked insight documents fold into .coding/kb/insights/, existing files win', () => {
    mkdirSync(join(insights(), 'images'), { recursive: true });
    writeFileSync(join(insights(), 'A.md'), 'a');
    writeFileSync(join(insights(), 'images', 'a.png'), 'png');
    writeFileSync(join(insights(), 'plantuml_errors.json'), '[]');
    mkdirSync(join(checkout(), 'kb', 'insights', 'images'), { recursive: true });
    writeFileSync(join(checkout(), 'kb', 'insights', 'B.md'), 'b');
    run();
    assertLinks();
    for (const [f, body] of [['A.md', 'a'], ['B.md', 'b'], ['images/a.png', 'png'], ['plantuml_errors.json', '[]']]) {
      assert.equal(readFileSync(join(insights(), f), 'utf8'), body, f);
    }
  });

  test('bin/coding never runs it on --dry-run (it moves data; the profile matrix dry-runs the real checkout)', () => {
    const launcher = readFileSync(join(REPO, 'bin', 'coding'), 'utf8');
    const call = launcher.indexOf('"$SCRIPT_DIR/init-history.sh" 2>/dev/null');
    assert.notEqual(call, -1, 'bin/coding no longer calls init-history.sh');
    const guard = launcher.lastIndexOf('if [ "$DRY_RUN" != true ]', call);
    assert.ok(guard > -1 && call - guard < 200, 'the call must sit inside the DRY_RUN guard');
  });

  test('re-running changes nothing', () => {
    setRemote(remote('dh', { 'history/a.md': 'a' }));
    run();
    const head = git(checkout(), 'rev-parse', 'HEAD');
    assert.equal(run(), '', 'a second launch is silent');
    assert.equal(git(checkout(), 'rev-parse', 'HEAD'), head);
    assertLinks();
  });
});
