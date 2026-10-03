/**
 * T4 acceptance: two users share one project's learning repo.
 *
 * Users A and B have separate homes and data homes, each a checkout of the
 * same project with `.coding/` backed by one local bare remote (the stand-in
 * for bmw.ghe.com/<user>/raas-history). Real git, real km-core stores opened
 * with the per-project layout (lib/kb/layout.mjs), the real sync module
 * (lib/history/sync.mjs) and the real merge driver (lib/kb/merge-driver.mjs).
 *
 *   1. A learns an insight; it lands in A's repo file; A commits and pushes.
 *   2. B's next session start pulls; B's store has the insight.
 *   3. Both edit concurrently (B deletes one entity, A adds another and edits
 *      a third) and both push/pull: the JSON merge driver resolves the file,
 *      and both stores converge on the union minus the deletion.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { GraphKMStore, mintEntityId } from '@fwornle/km-core';
import * as link from '../../lib/history/repo-link.mjs';
import * as sync from '../../lib/history/sync.mjs';
import { kbLayout } from '../../lib/kb/layout.mjs';
import { mergeRows } from '../../lib/kb/merge-driver.mjs';

let root;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'kb-sync-')));
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

const NO_TEAMS = { teams: {}, active: [] };

/** One user: a home, a data home, a checkout of project `raas` linked to `bare`. */
function user(name, bare) {
  const base = join(root, name);
  const home = join(base, 'home');
  const project = join(base, 'work', 'raas');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  sh(project, 'init', '-q');
  writeFileSync(join(project, 'README'), 'raas\n');
  sh(project, 'add', '.');
  sh(project, 'commit', '-q', '-m', 'init');
  const opts = { home, env: {}, dataHome: join(base, 'data'), teamsDoc: NO_TEAMS, sharedRoot: join(base, 'data', 'var', 'shared') };
  const r = link.linkRemote(project, bare, { ...opts, toolsRepo: join(base, 'tools') });
  assert.equal(r.ok, true, JSON.stringify(r));
  link.record(project, { remote: bare }, opts);
  link.excludeFromOuter(project, opts);
  const layout = kbLayout({ ...opts, mode: 'owner', codingRoot: join(base, 'tools'), repos: [{ path: project }] });
  const open = async () => {
    const s = new GraphKMStore({ dbPath: join(base, 'data', 'var', 'leveldb'), exportDir: join(base, 'data', 'kb', 'exports'), layout, debounceMs: 0 });
    await s.open();
    return s;
  };
  return { name, home, project, opts, layout, open };
}

async function put(store, name, id = mintEntityId()) {
  await store.putEntity({
    id, name, entityType: 'Insight', layer: 'evidence', description: name,
    updatedAt: new Date().toISOString(), metadata: { project: 'raas' },
  }, { skipOntologyCheck: true });
  return id;
}

async function names(store) {
  const out = [];
  for await (const e of store.iterate()) out.push(e.name);
  return out.sort();
}

const tick = () => new Promise((r) => setTimeout(r, 15));

describe('two users share a learning repo', () => {
  let A, B, bare;

  test('setup: both link the same remote', () => {
    bare = join(root, 'raas-history.git');
    A = user('alice', bare);
    B = user('bob', bare);
    for (const u of [A, B]) {
      assert.ok(existsSync(join(u.project, '.coding', '.git')), `${u.name} has a checkout`);
      assert.equal(sync.checkoutFor(u.project, u.opts)?.kind, 'linked');
    }
  });

  let keepId, doomedId;

  test("A's insight reaches B after B's next session start", async () => {
    const a = await A.open();
    keepId = await put(a, 'retry-with-backoff');
    doomedId = await put(a, 'obsolete-workaround');
    await a.exportJson();
    await a.close();
    const file = join(A.project, '.coding', 'kb', 'knowledge-graph', 'raas.json');
    assert.ok(existsSync(file), 'written into the repo\'s learning checkout');

    const pushed = sync.syncAll('push', { ...A.opts, repo: A.project });
    const row = pushed.repos.find((r) => r.selected);
    assert.equal(row.pushed, true, JSON.stringify(row));
    assert.equal(row.ahead, 0);

    // B: session start = pull (what the launcher runs), then the store opens.
    const pulled = sync.syncAll('pull', { ...B.opts, repo: B.project });
    const prow = pulled.repos.find((r) => r.selected);
    assert.equal(prow.pulled, true, JSON.stringify(prow));
    assert.equal(prow.changed, true);
    const b = await B.open();
    assert.deepEqual(await names(b), ['obsolete-workaround', 'retry-with-backoff']);
    await b.close();
  });

  test('concurrent edits merge through the driver; a deletion travels', async () => {
    // B deletes one entity and learns a new one, then pushes.
    const b = await B.open();
    await b.deleteEntity(doomedId);
    await put(b, 'from-bob');
    await b.exportJson();
    await b.close();
    const bp = sync.syncAll('push', { ...B.opts, repo: B.project }).repos.find((r) => r.selected);
    assert.equal(bp.pushed, true, JSON.stringify(bp));

    // Meanwhile A edits one entity and learns another — same file, both sides.
    await tick();
    const a = await A.open();
    await put(a, 'retry-with-backoff-and-jitter', keepId);
    await put(a, 'from-alice');
    await a.exportJson();

    // A's next sync: commit + pull. Both sides changed raas.json; the driver merges.
    const ap = sync.syncAll('pull', { ...A.opts, repo: A.project }).repos.find((r) => r.selected);
    assert.equal(ap.pulled, true, JSON.stringify(ap));
    assert.ok(!ap.error, ap.error);
    const stats = await a.reloadSources();
    assert.equal(stats.removed, 1, 'the deletion arrived');
    assert.deepEqual(await names(a), ['from-alice', 'from-bob', 'retry-with-backoff-and-jitter']);
    await a.exportJson();
    await a.close();
    const ap2 = sync.syncAll('push', { ...A.opts, repo: A.project }).repos.find((r) => r.selected);
    assert.equal(ap2.pushed, true, JSON.stringify(ap2));

    // B pulls: fast-forward, same graph.
    sync.syncAll('pull', { ...B.opts, repo: B.project });
    const b2 = await B.open();
    assert.deepEqual(await names(b2), ['from-alice', 'from-bob', 'retry-with-backoff-and-jitter']);
    await b2.close();

    // The merged file is clean JSON, not conflict markers, and both trees are clean.
    const text = readFileSync(join(A.project, '.coding', 'kb', 'knowledge-graph', 'raas.json'), 'utf8');
    assert.doesNotMatch(text, /^<<<<<<<|^>>>>>>>/m);
    JSON.parse(text);
    for (const u of [A, B]) assert.equal(sync.status(join(u.project, '.coding')).behind, 0);
  });

  test('the sync state cache counts checkouts awaiting a push', async () => {
    const a = await A.open();
    await put(a, 'unpushed');
    await a.exportJson();
    await a.close();
    const doc = sync.syncAll('commit', { ...A.opts, repo: A.project });
    assert.equal(doc.ahead, 1);
    const cached = JSON.parse(readFileSync(sync.stateFile(A.opts), 'utf8'));
    assert.equal(cached.ahead, 1);
  });

  test('observation rows merge by id, newest wins', () => {
    const ours = [{ id: 'a', summary: 'old', lastUpdated: '2026-01-01T00:00:00Z' }, { id: 'b', summary: 'b' }];
    const theirs = [{ id: 'a', summary: 'new', lastUpdated: '2026-02-01T00:00:00Z' }, { id: 'c', summary: 'c' }];
    assert.deepEqual(mergeRows(ours, theirs).map((r) => `${r.id}:${r.summary}`), ['a:new', 'b:b', 'c:c']);
  });
});
