/**
 * The per-repo learning repo (lib/history/repo-link.mjs), against real git and
 * local bare remotes — every path the launcher can take: a new remote, a
 * teammate's existing one (old and new layout), skip, a public remote refused,
 * and the migrations from the older layouts.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import * as link from '../../lib/history/repo-link.mjs';

let root;
let n = 0;

// Real git, but never the developer's identity, hooks or signing config.
before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'repo-link-')));
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = test\n\temail = test@localhost\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});
after(() => rmSync(root, { recursive: true, force: true }));

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A fresh outer project repo + an isolated coding home. */
function fixture() {
  n += 1;
  const base = join(root, `case${n}`);
  const project = join(base, 'proj');
  const home = join(base, 'home');
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  sh(project, 'init', '-q');
  writeFileSync(join(project, 'app.txt'), 'x\n');
  sh(project, 'add', '.');
  sh(project, 'commit', '-q', '-m', 'init');
  const logs = [];
  const opts = { home, toolsRepo: join(base, 'tools'), log: (m) => logs.push(m), env: {}, ghHome: home };
  return { base, project, home, opts, logs };
}

/** A bare remote seeded with the given files. */
function seededRemote(base, name, files) {
  const work = join(base, `${name}-work`);
  const bare = join(base, `${name}.git`);
  mkdirSync(work, { recursive: true });
  sh(work, 'init', '-q', '-b', 'main');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(work, rel, '..'), { recursive: true });
    writeFileSync(join(work, rel), body);
  }
  sh(work, 'add', '.');
  sh(work, 'commit', '-q', '-m', 'seed');
  sh(base, 'clone', '-q', '--bare', work, bare);
  return bare;
}

function assertLayout(project) {
  // T9: nothing addresses the legacy path, so no .specstory/ is created.
  assert.ok(!existsSync(join(project, '.specstory')), 'no .specstory/ of our making');
  for (const p of ['history', 'kb', 'README.md', '.gitignore']) {
    assert.ok(existsSync(join(project, '.coding', p)), `.coding/${p}`);
  }
  const exclude = readFileSync(join(project, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\.coding\/$/m);
  assert.match(exclude, /^\.specstory\/history$/m);
  // The outer repo sees neither, and no tracked file changed.
  assert.equal(sh(project, 'status', '--porcelain'), '');
}

const neverAsk = async () => { throw new Error('must not prompt'); };

describe('a new remote', () => {
  test('is created private, the skeleton pushed, the choice recorded', async () => {
    const { base, project, opts } = fixture();
    const remote = join(base, 'proj-history.git');
    const r = await link.ensure(project, { ...opts, ask: async () => remote });
    assert.equal(r.action, 'seeded');
    assertLayout(project);
    assert.match(sh(base, 'ls-remote', remote), /refs\/heads\/main/);
    assert.equal(sh(join(project, '.coding'), 'remote', 'get-url', 'origin'), remote);
    assert.deepEqual(link.lookup(project, opts), { remote });

    // Next launch: a registry hit, no question.
    const again = await link.ensure(project, { ...opts, ask: neverAsk });
    assert.equal(again.action, 'existing');
  });

  test('Enter takes the suggested URL', async () => {
    const { base, project, opts } = fixture();
    const remote = join(base, 'tmpl-proj-history.git');
    const r = await link.ensure(project, {
      ...opts, env: { LSL_HISTORY_REMOTE_TEMPLATE: join(base, 'tmpl-{project}-history.git') }, ask: async () => '',
    });
    assert.equal(r.action, 'seeded');
    assert.deepEqual(link.lookup(project, opts), { remote });
  });
});

describe('an existing remote is cloned and shared', () => {
  test('a teammate repo in the current layout is cloned as-is', async () => {
    const { base, project, opts } = fixture();
    const remote = seededRemote(base, 'mate', {
      'README.md': '# mate\n', 'history/2026/09/2026-09-01_0900-1000_ab.md': 'turn\n', 'kb/insights.json': '[]\n',
    });
    const r = await link.ensure(project, { ...opts, ask: async () => remote });
    assert.equal(r.action, 'cloned');
    assertLayout(project);
    assert.equal(readFileSync(join(project, '.coding', 'history', '2026', '09', '2026-09-01_0900-1000_ab.md'), 'utf8'), 'turn\n');
    assert.equal(readFileSync(join(project, '.coding', 'kb', 'insights.json'), 'utf8'), '[]\n');
  });

  test('an older transcripts-only repo is restructured into history/, committed locally, not pushed', async () => {
    const { base, project, opts } = fixture();
    const remote = seededRemote(base, 'old', {
      'README.md': '# old\n', '2025/11/2025-11-14_0700-0800_g9.md': 'turn\n', 'logs/classification/x.jsonl': '{}\n',
    });
    const remoteHead = sh(base, 'ls-remote', remote, 'refs/heads/main');
    const r = await link.ensure(project, { ...opts, ask: async () => remote });
    assert.equal(r.action, 'cloned');
    assertLayout(project);
    const dir = join(project, '.coding');
    assert.ok(existsSync(join(dir, 'history', '2025', '11', '2025-11-14_0700-0800_g9.md')));
    assert.ok(!existsSync(join(dir, '2025')));
    assert.match(sh(dir, 'log', '--format=%s'), /Restructure into the \.coding layout/);
    assert.equal(sh(dir, 'status', '--porcelain'), '', 'layout committed, nothing left dirty');
    assert.equal(sh(base, 'ls-remote', remote, 'refs/heads/main'), remoteHead, 'nothing was pushed');
  });

  test('local files in .coding/ survive the clone', async () => {
    const { base, project, opts } = fixture();
    mkdirSync(join(project, '.coding'), { recursive: true });
    writeFileSync(join(project, '.coding', 'session-state.json'), '{"local":true}\n');
    const remote = seededRemote(base, 'mate2', { 'history/a.md': 'a\n' });
    await link.ensure(project, { ...opts, ask: async () => remote });
    assert.equal(readFileSync(join(project, '.coding', 'session-state.json'), 'utf8'), '{"local":true}\n');
    // ...and stays machine-local.
    assert.doesNotMatch(sh(join(project, '.coding'), 'status', '--porcelain'), /session-state/);
  });
});

describe('skip', () => {
  test('is remembered, never re-asked, and stays untracked', async () => {
    const { project, opts } = fixture();
    const r = await link.ensure(project, { ...opts, ask: async () => 'skip' });
    assert.equal(r.action, 'skip');
    assertLayout(project);
    assert.ok(!existsSync(join(project, '.coding', '.git')), 'no repo on skip');
    assert.deepEqual(link.lookup(project, opts), { skip: true });
    assert.equal((await link.ensure(project, { ...opts, ask: neverAsk })).action, 'skip');
  });

  test('LSL_HISTORY_AUTO=no skips without asking', async () => {
    const { project, opts } = fixture();
    const r = await link.ensure(project, { ...opts, auto: 'no', ask: neverAsk });
    assert.equal(r.action, 'skip');
  });

  test('a legacy skip marker migrates into the registry', async () => {
    const { project, opts } = fixture();
    mkdirSync(join(project, '.specstory'), { recursive: true });
    writeFileSync(join(project, '.specstory', '.history-repo-skipped'), '');
    const r = await link.ensure(project, { ...opts, ask: neverAsk });
    assert.equal(r.action, 'skip');
    assert.ok(!existsSync(join(project, '.specstory', '.history-repo-skipped')));
    assert.deepEqual(link.lookup(project, opts), { skip: true });
  });

  test('without a way to ask, nothing is recorded but transcripts stay out of the outer repo', async () => {
    const { project, opts } = fixture();
    const r = await link.ensure(project, { ...opts });
    assert.equal(r.action, 'undecided');
    assertLayout(project);
    assert.equal(link.lookup(project, opts), null);
  });
});

describe('a public remote', () => {
  test('is refused: no checkout, no registry entry', async () => {
    const { project, opts } = fixture();
    const url = 'https://github.example/someone/proj-history.git';
    const run = (cmd, args, o) => {
      if (cmd === 'gh' && args[0] === 'auth') return { code: 0, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[0] === 'repo') return { code: 0, stdout: '{"isEmpty":false,"isPrivate":false}', stderr: '' };
      if (cmd === 'git' && args[0] === 'clone') throw new Error('must not clone a public repo');
      return link.defaultRun(cmd, args, o);
    };
    const r = await link.ensure(project, { ...opts, run, ask: async () => url });
    assert.equal(r.action, 'refused');
    assert.equal(r.state, 'public');
    assert.ok(!existsSync(join(project, '.coding', '.git')));
    assert.equal(link.lookup(project, opts), null);
    assert.equal(sh(project, 'status', '--porcelain'), '', 'transcripts still kept out of the outer repo');
  });
});

describe('migration from the older layouts', () => {
  test('a nested .specstory/history checkout becomes .coding/', async () => {
    const { base, project, opts } = fixture();
    const remote = seededRemote(base, 'nested', { 'README.md': '# n\n', '2026/01/t.md': 't\n', '.gitignore': '**/.flush.lock\n' });
    sh(project, 'clone', '-q', remote, join(project, '.specstory', 'history'));
    writeFileSync(join(project, '.specstory', 'history', '2026', '01', 'untracked.md'), 'u\n');
    const r = await link.ensure(project, { ...opts, ask: neverAsk });
    assert.equal(r.action, 'migrated');
    assertLayout(project);
    assert.ok(existsSync(join(project, '.coding', 'history', '2026', '01', 't.md')));
    // The restructure commit takes the not-yet-staged transcript with it (the
    // ETM would have staged it anyway) and leaves nothing dirty.
    assert.equal(sh(join(project, '.coding'), 'status', '--porcelain'), '');
    assert.match(sh(join(project, '.coding'), 'ls-files'), /history\/2026\/01\/untracked\.md/);
    assert.ok(existsSync(join(project, '.coding', 'history', '2026', '01', 'untracked.md')));
    assert.deepEqual(link.lookup(project, opts), { remote });
  });

  test('a plain .specstory/history directory moves into .coding/history/', async () => {
    const { project, opts } = fixture();
    mkdirSync(join(project, '.specstory', 'history', '2026', '02'), { recursive: true });
    writeFileSync(join(project, '.specstory', 'history', '2026', '02', 'p.md'), 'p\n');
    // .specstory/history/ ignored the old way, as ensure_coding_runtime_ignored writes it.
    await link.ensure(project, { ...opts, auto: 'no' });
    assert.ok(existsSync(join(project, '.coding', 'history', '2026', '02', 'p.md')));
    assert.ok(!existsSync(join(project, '.specstory', 'history')), 'the emptied legacy dir is gone, no symlink in its place');
  });

  test('a folder that is no git repo still has its .specstory/history moved (pofo, 2026-10-06)', async () => {
    const { base, opts } = fixture();
    const dir = join(base, 'plain');
    mkdirSync(join(dir, '.specstory', 'history', 'logs'), { recursive: true });
    writeFileSync(join(dir, '.specstory', 'history', 'logs', 'system.log'), 'old\n');
    const r = await link.ensure(dir, { ...opts, auto: 'no' });
    assert.equal(r.action, 'not-a-repo');
    assert.ok(existsSync(join(dir, '.coding', 'history', 'logs', 'system.log')));
    assert.ok(!existsSync(join(dir, '.specstory')), 'nothing of ours left in .specstory/');
  });

  test('the symlink an earlier launch created is removed; a foreign one is left', async () => {
    const { project, opts } = fixture();
    mkdirSync(join(project, '.coding', 'history'), { recursive: true });
    mkdirSync(join(project, '.specstory'), { recursive: true });
    symlinkSync(join('..', '.coding', 'history'), join(project, '.specstory', 'history'));
    await link.ensure(project, { ...opts, auto: 'no' });
    assert.ok(!existsSync(join(project, '.specstory')), 'link and the emptied .specstory/ removed');

    const other = fixture();
    mkdirSync(join(other.project, '.specstory'), { recursive: true });
    symlinkSync(other.base, join(other.project, '.specstory', 'history'));
    writeFileSync(join(other.project, '.specstory', 'keep.json'), '{}');
    await link.ensure(other.project, { ...other.opts, auto: 'no' });
    assert.ok(lstatSync(join(other.project, '.specstory', 'history')).isSymbolicLink(), 'not ours: left alone');
  });

  test('migrated transcripts are committed locally but never pushed on seeding', async () => {
    const { base, project, opts } = fixture();
    mkdirSync(join(project, '.specstory', 'history', '2026', '03'), { recursive: true });
    writeFileSync(join(project, '.specstory', 'history', '2026', '03', 'q.md'), 'q\n');
    const remote = join(base, 'seed.git');
    const r = await link.ensure(project, { ...opts, ask: async () => remote });
    assert.equal(r.action, 'seeded-local');
    assert.equal(sh(base, 'ls-remote', remote), '', 'remote created, nothing pushed');
    assert.match(sh(join(project, '.coding'), 'ls-files'), /history\/2026\/03\/q\.md/);
  });
});

describe('the tools repo (T7) is an ordinary linked repo', () => {
  test('its nested coding-history checkout migrates; the runtime in .coding/ stays local', async () => {
    const { base, project, opts } = fixture();
    const remote = seededRemote(base, 'coding-history', { 'README.md': '# c\n', '2026/01/t.md': 't\n', 'chain-map.json': '{}\n' });
    sh(project, 'clone', '-q', remote, join(project, '.specstory', 'history'));
    // What a launch of the tools repo keeps in .coding/ before the move.
    mkdirSync(join(project, '.coding', 'runtime'), { recursive: true });
    writeFileSync(join(project, '.coding', 'runtime', 'features.json'), '{}\n');
    mkdirSync(join(project, '.coding', 'claude-plugin', 'commands'), { recursive: true });
    writeFileSync(join(project, '.coding', 'claude-plugin', 'commands', 'x.md'), 'x\n');
    writeFileSync(join(project, '.coding', 'session-state.json'), '{}\n');
    const r = await link.ensure(project, { ...opts, toolsRepo: project, ask: neverAsk });
    assert.equal(r.action, 'migrated');
    assertLayout(project);
    const c = join(project, '.coding');
    assert.ok(existsSync(join(c, 'history', '2026', '01', 't.md')));
    assert.ok(existsSync(join(c, 'history', 'chain-map.json')));
    // Runtime left where the launcher and the container expect it, never committed.
    assert.ok(existsSync(join(c, 'runtime', 'features.json')));
    assert.ok(existsSync(join(c, 'claude-plugin', 'commands', 'x.md')));
    const tracked = sh(c, 'ls-files');
    assert.doesNotMatch(tracked, /runtime\/|claude-plugin\/|session-state\.json/);
    assert.equal(sh(c, 'status', '--porcelain'), '');
    assert.deepEqual(link.lookup(project, opts), { remote });
  });

  test('a remote chosen at install time answers the question without asking', async () => {
    const { base, project, opts } = fixture();
    const remote = seededRemote(base, 'preset', { 'README.md': '# p\n', 'history/2026/02/a.md': 'a\n' });
    const r = await link.ensure(project, { ...opts, toolsRepo: project, remote, ask: neverAsk });
    assert.equal(r.action, 'cloned');
    assertLayout(project);
    assert.ok(existsSync(join(project, '.coding', 'history', '2026', '02', 'a.md')));
    assert.deepEqual(link.lookup(project, opts), { remote });
  });
});

describe('stands down', () => {
  test('when the outer repo already tracks transcripts', async () => {
    const { project, opts } = fixture();
    mkdirSync(join(project, '.specstory', 'history'), { recursive: true });
    writeFileSync(join(project, '.specstory', 'history', 'leak.md'), 'x\n');
    sh(project, 'add', '-f', '.specstory/history/leak.md');
    sh(project, 'commit', '-q', '-m', 'leak');
    const r = await link.ensure(project, { ...opts, ask: neverAsk });
    assert.equal(r.action, 'tracked-history');
    assert.ok(!existsSync(join(project, '.coding')));
  });
});

describe('remote state', () => {
  test('local remotes: absent, empty, populated', () => {
    const { base } = fixture();
    assert.equal(link.remoteState(join(base, 'nope.git')), 'absent');
    sh(base, 'init', '-q', '--bare', join(base, 'empty.git'));
    assert.equal(link.remoteState(join(base, 'empty.git')), 'empty');
    assert.equal(link.remoteState(seededRemote(base, 'full', { a: '1' })), 'populated');
  });

  test('URL parsing', () => {
    assert.equal(link.urlHost('https://bmw.ghe.com/me/x-history.git'), 'bmw.ghe.com');
    assert.equal(link.urlSlug('https://bmw.ghe.com/me/x-history.git'), 'me/x-history');
    assert.equal(link.urlHost('git@cc-github.bmwgroup.net:me/x.git'), 'cc-github.bmwgroup.net');
    assert.equal(link.urlSlug('git@cc-github.bmwgroup.net:me/x.git'), 'me/x');
  });
});
