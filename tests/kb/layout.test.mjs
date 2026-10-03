/**
 * Where each project's knowledge is written (lib/kb/layout.mjs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kbLayout, bucketName } from '../../lib/kb/layout.mjs';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kb-layout-')));
  const repo = (name, { coding = true, ignored = true, linked = false } = {}) => {
    const p = join(root, name);
    mkdirSync(join(p, '.git', 'info'), { recursive: true });
    if (coding) mkdirSync(join(p, '.coding', linked ? '.git' : 'kb'), { recursive: true });
    if (ignored) writeFileSync(join(p, '.git', 'info', 'exclude'), '.coding/\n.specstory/history\n');
    return { path: p };
  };
  const repos = [
    repo('linked', { linked: true }),
    repo('skipped'),
    repo('never-launched', { ignored: false }), // has .coding/ but the outer repo does not ignore it yet
    repo('no-coding', { coding: false }),
    repo('tools', { linked: true }),
  ];
  const sharedRoot = join(root, 'shared');
  mkdirSync(join(sharedRoot, 'teammate', '.git'), { recursive: true });
  const opts = { env: {}, dataHome: join(root, 'data'), teamsDoc: { teams: {}, active: [] }, sharedRoot, repos, codingRoot: join(root, 'tools') };
  return { root, opts, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('bucket = project, else legacy team, else general; always a safe file name', () => {
  assert.equal(bucketName({ project: 'raas', team: 'x' }), 'raas');
  assert.equal(bucketName({ team: 'coding' }), 'coding');
  assert.equal(bucketName({}), 'general');
  assert.equal(bucketName({ project: '../evil/x' }), '__evil_x');
});

test('owner mode: repos that ignore .coding/ get their file; others stay local', () => {
  const f = fixture();
  try {
    const l = kbLayout({ ...f.opts, mode: 'owner' });
    const local = join(f.opts.dataHome, 'kb', 'knowledge-graph', 'exports', 'projects');
    assert.equal(l.fileFor('linked'), join(f.root, 'linked', '.coding', 'kb', 'knowledge-graph', 'linked.json'));
    assert.equal(l.fileFor('skipped'), join(f.root, 'skipped', '.coding', 'kb', 'knowledge-graph', 'skipped.json'));
    assert.equal(l.fileFor('never-launched'), join(local, 'never-launched.json'), 'would show up in the user\'s repo');
    assert.equal(l.fileFor('tools'), join(f.root, 'tools', '.coding', 'kb', 'knowledge-graph', 'tools.json'), 'the tools repo is an ordinary linked repo (T7)');
    assert.equal(l.fileFor('teammate'), join(local, 'teammate.json'), 'a shared clone is never written');
    const d = l.describe();
    assert.equal(d.linked.kind, 'linked');
    assert.equal(d.skipped.kind, 'local');
    assert.equal(d.teammate.kind, 'shared');
    assert.ok(l.owns(join(local, 'x.json')));
    assert.ok(!l.owns(l.fileFor('linked')), 'never empties a repo file');
  } finally {
    f.done();
  }
});

test('sources include the shared clone and the legacy general.json', () => {
  const f = fixture();
  try {
    const kg = join(f.opts.sharedRoot, 'teammate', 'kb', 'knowledge-graph');
    mkdirSync(kg, { recursive: true });
    writeFileSync(join(kg, 'teammate.json'), '{}');
    const l = kbLayout({ ...f.opts, mode: 'owner' });
    const src = l.sources();
    assert.ok(src.includes(join(kg, 'teammate.json')));
    assert.ok(src.includes(join(f.opts.dataHome, 'kb', 'knowledge-graph', 'exports', 'general.json')));
  } finally {
    f.done();
  }
});

test('local mode (container stores): reads everything, writes one local file', () => {
  const f = fixture();
  try {
    const l = kbLayout({ ...f.opts, mode: 'local' });
    const legacy = join(f.opts.dataHome, 'kb', 'knowledge-graph', 'exports', 'general.json');
    assert.equal(l.bucketOf({ project: 'linked' }), 'general');
    assert.equal(l.fileFor('general'), legacy);
    assert.ok(l.owns(legacy));
  } finally {
    f.done();
  }
});
