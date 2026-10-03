/**
 * bin/init-history.sh puts the tools repo's session history in the data home.
 *
 * Behavioural, unlike install-scope.test.mjs: the script runs on every
 * `bin/coding` launch and moves the most private data this system holds, so the
 * properties that matter — that a pre-data-home history is NEVER touched, that a
 * placeholder scope never gets a history, that both repo layouts clone to the
 * right place — are checked by running it, not by reading it.
 *
 * Each case builds a throwaway "tools repo" holding just the script and the two
 * resolvers it calls, a throwaway HOME (CODING_HOME), and local bare repos as
 * remotes. Nothing here can reach the real ~/.coding or a real history repo.
 *
 * Runner: node --test tests/scripts/init-history.test.mjs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readlinkSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;

let root, tools, home;

/** Run the sandboxed script with an environment scrubbed of every scope seam. */
function run() {
  const env = { ...process.env, CODING_HOME: home };
  for (const k of ['CODING_DATA_HOME', 'CODING_SCOPE', 'CODING_TOOLS_PATH', 'CODING_REPO']) delete env[k];
  return execFileSync('bash', [join(tools, 'bin', 'init-history.sh')], { env, encoding: 'utf8' });
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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
  git(work, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed');
  const bare = join(root, `${name}.git`);
  git(root, 'clone', '-q', '--bare', work, bare);
  return bare;
}

const setScope = (s) => {
  mkdirSync(join(home, '.coding'), { recursive: true });
  writeFileSync(join(home, '.coding', 'scope'), `${s}\n`);
};
const setRemote = (url) => writeFileSync(join(tools, '.env'), `CODING_HISTORY_REPO=${url}\n`);
const link = () => join(tools, '.specstory', 'history');
const dataHome = (s) => join(home, '.coding', 'data', s);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'init-history-'));
  tools = join(root, 'tools');
  home = join(root, 'home');
  mkdirSync(join(tools, 'bin'), { recursive: true });
  mkdirSync(home);
  for (const f of ['init-history.sh', 'coding-data-home']) cpSync(join(REPO, 'bin', f), join(tools, 'bin', f));
  // lib/history clones; lib/features/vendor is its YAML parser.
  for (const d of ['lib/paths', 'lib/scope', 'lib/history', 'lib/features/vendor']) cpSync(join(REPO, d), join(tools, d), { recursive: true });
  // bin/coding-data-home is extensionless ESM; it needs the module type.
  writeFileSync(join(tools, 'package.json'), '{"type":"module"}\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('bin/init-history.sh', () => {
  test('a scoped install with no repo gets a symlink into its own data home', () => {
    setScope('team-a');
    run();
    assert.ok(lstatSync(link()).isSymbolicLink(), '.specstory/history must be a symlink');
    assert.equal(readlinkSync(link()), join(dataHome('team-a'), 'history'));
    assert.ok(existsSync(join(dataHome('team-a'), 'history', 'logs', 'classification')));
    assert.ok(!existsSync(join(dataHome('team-a'), '.git')), 'no repo configured, no checkout');
  });

  test('the placeholder scope keeps history in the repo, and creates no data home', () => {
    // No ~/.coding/scope at all: history under data/default would be stranded
    // the moment the user names their scope.
    run();
    assert.ok(!lstatSync(link()).isSymbolicLink());
    assert.ok(lstatSync(link()).isDirectory());
    assert.ok(!existsSync(join(home, '.coding', 'data')), 'nothing filed under the placeholder');
  });

  test('a pre-data-home history directory is never touched', () => {
    // The developer's own machine, until it migrates deliberately.
    setScope('coding');
    setRemote(remote('other', { 'history/x.md': 'x' }));
    mkdirSync(join(link(), '2026', '10'), { recursive: true });
    writeFileSync(join(link(), '2026', '10', 'mine.jsonl'), 'precious');
    run();
    assert.ok(!lstatSync(link()).isSymbolicLink(), 'must not be replaced by a symlink');
    assert.equal(readFileSync(join(link(), '2026', '10', 'mine.jsonl'), 'utf8'), 'precious');
    assert.ok(!existsSync(join(dataHome('coding'), '.git')), 'and nothing cloned on its behalf');
  });

  test('a data-home repo becomes the data home itself, leaving var/ alone', () => {
    setScope('team-a');
    setRemote(remote('dh', { 'history/2026/10/s.jsonl': 'session', 'kb/notes.json': '{}', '.gitignore': 'var/\n' }));
    mkdirSync(join(dataHome('team-a'), 'var'), { recursive: true });
    writeFileSync(join(dataHome('team-a'), 'var', 'local.db'), 'machine-local');
    run();
    assert.ok(existsSync(join(dataHome('team-a'), '.git')), 'the data home is the checkout');
    assert.equal(readFileSync(join(link(), '2026', '10', 's.jsonl'), 'utf8'), 'session');
    assert.equal(readFileSync(join(dataHome('team-a'), 'kb', 'notes.json'), 'utf8'), '{}');
    assert.equal(readFileSync(join(dataHome('team-a'), 'var', 'local.db'), 'utf8'), 'machine-local');
    assert.equal(git(dataHome('team-a'), 'status', '--porcelain'), '', 'a clean checkout');
  });

  test('a transcripts-only repo (the original layout) is cloned into history/', () => {
    setScope('team-a');
    setRemote(remote('legacy', { '2026/09/old.md': 'old', 'logs/classification/c.json': '{}' }));
    run();
    assert.ok(existsSync(join(dataHome('team-a'), 'history', '.git')));
    assert.ok(!existsSync(join(dataHome('team-a'), '.git')));
    assert.equal(readFileSync(join(link(), '2026', '09', 'old.md'), 'utf8'), 'old');
  });

  test('a data home with knowledge of its own is not cloned over', () => {
    setScope('team-a');
    setRemote(remote('dh', { 'history/a.md': 'a' }));
    mkdirSync(join(dataHome('team-a'), 'kb'), { recursive: true });
    writeFileSync(join(dataHome('team-a'), 'kb', 'local.json'), 'mine');
    run();
    assert.ok(!existsSync(join(dataHome('team-a'), '.git')));
    assert.equal(readFileSync(join(dataHome('team-a'), 'kb', 'local.json'), 'utf8'), 'mine');
  });

  test('re-running changes nothing', () => {
    setScope('team-a');
    setRemote(remote('dh', { 'history/a.md': 'a' }));
    run();
    const head = git(dataHome('team-a'), 'rev-parse', 'HEAD');
    assert.equal(run(), '', 'a second launch is silent');
    assert.equal(git(dataHome('team-a'), 'rev-parse', 'HEAD'), head);
    assert.equal(readlinkSync(link()), join(dataHome('team-a'), 'history'));
  });

  test('a symlink pointing elsewhere is reported, not re-pointed', () => {
    setScope('team-a');
    mkdirSync(join(tools, '.specstory'), { recursive: true });
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    execFileSync('ln', ['-s', elsewhere, link()]);
    run();
    assert.equal(readlinkSync(link()), elsewhere);
  });
});
