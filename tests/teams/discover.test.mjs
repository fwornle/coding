/**
 * Repo discovery (lib/teams/discover.mjs) on a fixture tree, its cache, the
 * container-side path translation, and cloning shared learning repos
 * (lib/teams/shared.mjs) from a local bare remote.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { scan, discover, discoveredProjects, readCache, describeRepo } from '../../lib/teams/discover.mjs';
import { sharedPlan, syncShared, sharedName } from '../../lib/teams/shared.mjs';

let root;
before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'teams-discover-')));
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = t\n\temail = t@l\n[init]\n\tdefaultBranch = main\n');
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});
after(() => rmSync(root, { recursive: true, force: true }));

function mk(p, files = {}) {
  mkdirSync(p, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(p, rel, '..'), { recursive: true });
    writeFileSync(join(p, rel), body);
  }
  return p;
}

/** home/
 *   Agentic/coding        .git + .coding/.git (origin) + .specstory/history
 *   Agentic/_work/raas    .git + .specstory/history
 *   Agentic/plain         .git, no markers
 *   Agentic/plain/inner   marked, but inside an unmarked repo → not ours
 *   Agentic/notes         no .git, has .coding → not a repo
 *   node_modules/pkg      marked repo inside an ignored dir
 *   deep/a/b/c/d/e        marked repo below the depth limit
 */
function tree() {
  const home = join(root, `home-${Math.random().toString(36).slice(2, 8)}`);
  mk(join(home, 'Agentic', 'coding'), {
    '.git/HEAD': '', '.coding/.git/config': '[remote "origin"]\n\turl = https://h/me/coding-history.git\n', '.specstory/history/.keep': '',
  });
  mk(join(home, 'Agentic', '_work', 'raas'), { '.git/HEAD': '', '.specstory/history/.keep': '' });
  mk(join(home, 'Agentic', 'plain'), { '.git/HEAD': '' });
  mk(join(home, 'Agentic', 'plain', 'inner'), { '.git/HEAD': '', '.coding/x': '' });
  mk(join(home, 'Agentic', 'notes'), { '.coding/x': '' });
  mk(join(home, 'node_modules', 'pkg'), { '.git/HEAD': '', '.coding/x': '' });
  mk(join(home, 'deep', 'a', 'b', 'c', 'd', 'e'), { '.git/HEAD': '', '.coding/x': '' });
  symlinkSync(join(home, 'Agentic'), join(home, 'link-to-agentic'));
  return home;
}

describe('scan', () => {
  test('a repo set up after T9 (.coding/history, no .specstory/) has transcripts', () => {
    const home = join(root, `home-${Math.random().toString(36).slice(2, 8)}`);
    const r = mk(join(home, 'fresh'), { '.git/HEAD': '', '.coding/history/.keep': '' });
    assert.deepEqual(describeRepo(r).markers, ['coding', 'history']);
  });

  test('finds marked git repos only, honouring ignore and depth, never through symlinks', () => {
    const home = tree();
    const found = scan({ roots: [home], depth: 4, ignore: ['node_modules'], home });
    assert.deepEqual(found.map((r) => r.path.slice(home.length + 1)), ['Agentic/_work/raas', 'Agentic/coding']);
    const coding = found.find((r) => r.name === 'coding');
    assert.deepEqual(coding.markers, ['coding', 'specstory', 'history']);
    assert.equal(coding.learningRemote, 'https://h/me/coding-history.git');
    assert.equal(found.find((r) => r.name === 'raas').learningRepo, false);
  });

  test('a deeper scan reaches the deep repo', () => {
    const home = tree();
    assert.ok(scan({ roots: [home], depth: 7, ignore: ['node_modules'], home }).some((r) => r.name === 'e'));
  });
});

describe('the cache', () => {
  test('is written, reused while fresh, refreshed on demand', () => {
    const home = tree();
    const cachePath = join(home, 'var', 'projects.json');
    const teamsDoc = { teams: {}, discovery: { roots: [home], depth: 4, ignore: ['node_modules'], ttlMinutes: 10 } };
    const first = discover({ teamsDoc, cachePath, home, now: Date.parse('2026-10-03T10:00:00Z') });
    assert.equal(first.repos.length, 2);
    assert.ok(existsSync(cachePath));
    mk(join(home, 'Agentic', 'fresh'), { '.git/HEAD': '', '.coding/x': '' });
    const cached = discover({ teamsDoc, cachePath, home, now: Date.parse('2026-10-03T10:05:00Z') });
    assert.equal(cached.repos.length, 2, 'fresh cache is reused');
    const refreshed = discover({ teamsDoc, cachePath, home, refresh: true });
    assert.equal(refreshed.repos.length, 3);
    assert.equal(readCache({ cachePath }).repos.length, 3);
  });

  test('the container reads host paths through its workspace mount', () => {
    // Host: <home>/Agentic/... ; container: <ws>/... ; tools checkout elsewhere.
    const hostHome = '/Users/someone';
    const ws = mk(join(root, 'ws'), { 'raas/.git/HEAD': '', 'raas/.specstory/history/.keep': '' });
    const tools = mk(join(root, 'tools-in-container'), { '.git/HEAD': '', '.specstory/history/.keep': '' });
    const cachePath = join(root, 'container-cache.json');
    writeFileSync(cachePath, JSON.stringify({
      version: 2, scannedAt: new Date().toISOString(), home: hostHome, toolsRepo: `${hostHome}/Agentic/coding`, roots: [hostHome], depth: 4,
      repos: [
        { path: `${hostHome}/Agentic/raas`, name: 'raas', markers: ['specstory', 'history'] },
        { path: `${hostHome}/Agentic/coding`, name: 'coding', markers: ['coding', 'specstory', 'history'] },
        { path: `${hostHome}/elsewhere/x`, name: 'x', markers: ['coding'] },
      ],
    }));
    const prev = process.env.LSL_WORKSPACE_ROOT;
    process.env.LSL_WORKSPACE_ROOT = ws;
    try {
      const got = discoveredProjects({ cachePath, codingRoot: tools, marker: 'history' });
      assert.deepEqual(got.map((r) => r.path).sort(), [join(ws, 'raas'), tools].sort());
      assert.equal(got.find((r) => r.name === 'raas').hostPath, `${hostHome}/Agentic/raas`);
    } finally {
      if (prev === undefined) delete process.env.LSL_WORKSPACE_ROOT; else process.env.LSL_WORKSPACE_ROOT = prev;
    }
  });

  test('a version-1 cache (written before the history marker) still answers `history`', () => {
    const dir = join(root, `v1-${Math.random().toString(36).slice(2, 8)}`);
    const tools = mk(join(dir, 'coding'), { '.git/HEAD': '', '.coding/history/.keep': '' });
    const legacy = mk(join(dir, 'legacy'), { '.git/HEAD': '', '.specstory/history/.keep': '' });
    const cachePath = join(dir, 'projects.json');
    writeFileSync(cachePath, JSON.stringify({
      version: 1, scannedAt: new Date().toISOString(), roots: [dir], depth: 4,
      repos: [
        { path: tools, name: 'coding', markers: ['coding'] },
        { path: legacy, name: 'legacy', markers: ['specstory'] },
      ],
    }));
    const got = discoveredProjects({ cachePath, codingRoot: tools, marker: 'history' });
    assert.deepEqual(got.map((r) => r.name).sort(), ['coding', 'legacy']);
  });

  test('with no cache it falls back to the sibling scan', () => {
    const parent = mk(join(root, 'fallback'));
    const tools = mk(join(parent, 'tools'), { '.git/HEAD': '', '.specstory/history/.keep': '' });
    mk(join(parent, 'sib'), { '.git/HEAD': '', '.coding/x': '' });
    const got = discoveredProjects({ cachePath: join(parent, 'none.json'), codingRoot: tools });
    assert.deepEqual(got.map((r) => r.name).sort(), ['sib', 'tools']);
  });
});

describe('shared learning repos', () => {
  test('a remote-only team repo is cloned under var/shared/<project>', () => {
    const work = mk(join(root, 'mate-work'), { 'history/2026/10/t.md': 't\n', 'README.md': '# mate\n' });
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
    spawnSync('git', ['add', '.'], { cwd: work });
    spawnSync('git', ['commit', '-q', '-m', 'seed'], { cwd: work });
    const remote = join(root, 'raas-history.git');
    spawnSync('git', ['clone', '-q', '--bare', work, remote]);

    const sharedRoot = join(root, 'shared');
    const teamsDoc = { teams: { raas: { id: 'raas', repos: [{ remote }], include: [] } } };
    const opts = { teamsDoc, repos: [], sharedRoot };
    assert.equal(sharedName(remote), 'raas');
    assert.deepEqual(sharedPlan(opts).map((i) => i.state), ['missing']);
    const done = syncShared(opts);
    assert.equal(done[0].state, 'shared');
    assert.ok(existsSync(join(sharedRoot, 'raas', 'history', '2026', '10', 't.md')));
    assert.deepEqual(sharedPlan(opts).map((i) => i.state), ['shared'], 'idempotent');
  });

  test('a remote that is already checked out locally is not cloned again', () => {
    const teamsDoc = { teams: { t: { id: 't', repos: [{ remote: 'git@h:me/x-history.git' }], include: [] } } };
    const plan = sharedPlan({ teamsDoc, repos: [{ path: '/here/x', learningRemote: 'https://h/me/x-history.git' }], sharedRoot: join(root, 's2') });
    assert.deepEqual(plan.map((i) => [i.state, i.path]), [['local', '/here/x']]);
  });
});
