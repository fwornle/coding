/**
 * Teams as sets of repos (lib/teams/config.cjs): YAML layering over the
 * ontology JSON, the active selection, and the repo → team mapping.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const teams = require('../../lib/teams/config.cjs');

let root;
let n = 0;
before(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'teams-config-'))); });
after(() => rmSync(root, { recursive: true, force: true }));

/** A fixture tools repo with config/teams/*.json + an isolated home. */
function fixture({ json = {}, shipped = null, user = null } = {}) {
  n += 1;
  const base = join(root, `c${n}`);
  const repoRoot = join(base, 'tools');
  const home = join(base, 'home');
  mkdirSync(join(repoRoot, 'config', 'teams'), { recursive: true });
  mkdirSync(join(home, '.coding'), { recursive: true });
  for (const [f, doc] of Object.entries(json)) writeFileSync(join(repoRoot, 'config', 'teams', f), JSON.stringify(doc));
  if (shipped != null) writeFileSync(join(repoRoot, 'config', 'teams.yaml'), shipped);
  if (user != null) writeFileSync(join(home, '.coding', 'teams.yaml'), user);
  const opts = { repoRoot, home, env: {} };
  return { base, repoRoot, home, opts };
}

function repo(base, name, { learningRemote } = {}) {
  const dir = join(base, 'repos', name);
  mkdirSync(join(dir, '.git'), { recursive: true });
  if (learningRemote) {
    mkdirSync(join(dir, '.coding', '.git'), { recursive: true });
    writeFileSync(join(dir, '.coding', '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${learningRemote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  }
  return dir;
}

describe('layering', () => {
  test('the ontology JSON is the base, kept verbatim', () => {
    const { opts } = fixture({ json: { 'resi.json': { team: 'ReSi', kind: 'team', description: 'd', confidenceThreshold: 0.8 } } });
    const doc = teams.loadTeams(opts);
    assert.deepEqual(Object.keys(doc.teams), ['resi']);
    assert.equal(doc.teams.resi.label, 'ReSi');
    assert.equal(doc.teams.resi.ontology.confidenceThreshold, 0.8);
    assert.deepEqual(doc.teams.resi.repos, []);
  });

  test('shipped yaml extends a JSON team; the user layer wins per field', () => {
    const { opts } = fixture({
      json: { 'raas.json': { team: 'RaaS', kind: 'team', description: 'from json' } },
      shipped: 'teams:\n  raas:\n    description: from shipped\n    include: [rapid-*]\n',
      user: 'teams:\n  raas:\n    include: [raas]\n  mine:\n    label: Mine\n    kind: project\n',
    });
    const doc = teams.loadTeams(opts);
    assert.equal(doc.teams.raas.description, 'from shipped');
    assert.deepEqual(doc.teams.raas.include, ['raas'], 'user layer replaces the field');
    assert.deepEqual(doc.teams.raas.sources, ['config/teams/raas.json', 'config/teams.yaml', '~/.coding/teams.yaml']);
    assert.equal(doc.teams.mine.kind, 'project', 'a user-only team exists');
  });

  test('an unreadable layer is skipped with a warning, never thrown', () => {
    const { opts } = fixture({ json: { 'a.json': { team: 'A' } }, user: 'teams: [oops\n' });
    const doc = teams.loadTeams(opts);
    assert.deepEqual(Object.keys(doc.teams), ['a']);
    assert.match(doc.warnings.join('\n'), /teams\.yaml/);
  });

  test('repos entries normalise: ~ paths, remotes, objects', () => {
    const { opts } = fixture({ user: 'teams:\n  x:\n    repos:\n      - /abs/path\n      - https://h/o/x-history.git\n      - git@h:o/y.git\n      - { path: /p, id: pid }\n' });
    const refs = teams.loadTeams(opts).teams.x.repos;
    assert.deepEqual(refs, [{ path: '/abs/path' }, { remote: 'https://h/o/x-history.git' }, { remote: 'git@h:o/y.git' }, { path: '/p', id: 'pid' }]);
  });
});

describe('active selection', () => {
  test('env beats the user layer beats shipped; none means all', () => {
    const { opts } = fixture({ json: { 'a.json': { team: 'A' }, 'b.json': { team: 'B' } }, shipped: 'active: [a]\n', user: 'active: [b]\n' });
    assert.deepEqual(teams.loadTeams(opts).active, ['b']);
    assert.deepEqual(teams.loadTeams({ ...opts, env: { CODING_TEAMS: 'a, B' } }).active, ['a', 'b']);
    const bare = fixture({ json: { 'a.json': { team: 'A' } } });
    assert.deepEqual(teams.loadTeams(bare.opts).active, []);
  });

  test('an undefined active team is a warning', () => {
    const { opts } = fixture({ user: 'active: [ghost]\n' });
    assert.match(teams.loadTeams(opts).warnings.join(), /ghost/);
  });
});

describe('mapping', () => {
  test('with no membership declared, a team holds its same-named repo (the old meaning)', () => {
    const { base, opts } = fixture({ json: { 'coding.json': { team: 'Coding' } } });
    assert.deepEqual(teams.teamsOf(repo(base, 'coding'), opts), ['coding']);
    assert.deepEqual(teams.teamsOf(repo(base, 'other'), opts), []);
  });

  test('by path, by include glob and by learning-repo remote — several teams at once', () => {
    const { base, home, opts } = fixture();
    writeFileSync(join(home, '.coding', 'teams.yaml'), [
      'teams:',
      '  raas:',
      '    include: [rapid-*]',
      '  platform:',
      `    repos: [${join(base, 'repos', 'rapid-automations')}, "git@bmw.ghe.com:me/km-history.git"]`,
      '',
    ].join('\n'));
    const ra = repo(base, 'rapid-automations');
    const km = repo(base, 'km', { learningRemote: 'https://bmw.ghe.com/me/km-history.git' });
    assert.deepEqual(teams.teamsOf(ra, opts), ['platform', 'raas']);
    assert.deepEqual(teams.teamsOf(km, opts), ['platform'], 'https and ssh spellings of one remote match');
  });

  test('projectIdFor: the directory name unless a repos entry names it', () => {
    const { base, opts } = fixture();
    const dir = repo(base, 'checkout-2');
    assert.equal(teams.projectIdFor(dir, opts), 'checkout-2');
    const named = fixture({ user: `teams:\n  t:\n    repos:\n      - { path: ${dir}, id: proj }\n` });
    assert.equal(teams.projectIdFor(dir, named.opts), 'proj');
  });

  test('isActiveRepo: nothing selected passes everything', () => {
    const { base, opts } = fixture({ json: { 'a.json': { team: 'A' } } });
    assert.equal(teams.isActiveRepo(repo(base, 'zzz'), opts), true);
    const sel = fixture({ json: { 'a.json': { team: 'A' } }, user: 'active: [a]\n' });
    assert.equal(teams.isActiveRepo(repo(sel.base, 'a'), sel.opts), true);
    assert.equal(teams.isActiveRepo(repo(sel.base, 'zzz'), sel.opts), false);
  });
});

describe('writing ~/.coding/teams.yaml', () => {
  test('patches active and teams, keeping what it was not told about', () => {
    const { home, opts } = fixture({ user: 'discovery:\n  depth: 3\nteams:\n  keep:\n    label: Keep\n' });
    teams.writeUserTeams({ active: ['keep'], teams: { new: { label: 'New', repos: ['~/x'] } } }, opts);
    const doc = teams.loadTeams(opts);
    assert.deepEqual(doc.active, ['keep']);
    assert.equal(doc.teams.keep.label, 'Keep');
    assert.equal(doc.teams.new.label, 'New');
    assert.equal(doc.discovery.depth, 3);
    teams.writeUserTeams({ teams: { new: null }, active: null }, opts);
    const after = teams.loadTeams(opts);
    assert.equal(after.teams.new, undefined);
    assert.deepEqual(after.active, []);
    assert.match(readFileSync(join(home, '.coding', 'teams.yaml'), 'utf8'), /^# coding — teams for this user/);
  });

  test('validates, and refuses to rewrite a file it cannot read', () => {
    const { opts } = fixture();
    assert.throws(() => teams.writeUserTeams({ teams: { 'Bad Id': {} } }, opts), /invalid team id/);
    assert.throws(() => teams.writeUserTeams({ teams: { x: { kind: 'squad' } } }, opts), /kind/);
    const broken = fixture({ user: 'teams: [oops\n' });
    assert.throws(() => teams.writeUserTeams({ active: [] }, broken.opts), /unreadable/);
  });
});

describe('the shipped config', () => {
  test('parses and declares nothing that changes the old meaning', () => {
    const repoRoot = new URL('../..', import.meta.url).pathname;
    const doc = teams.loadTeams({ repoRoot, home: join(root, 'nohome'), env: {} });
    assert.deepEqual(doc.warnings, []);
    for (const t of Object.values(doc.teams)) {
      assert.deepEqual(t.repos, [], `${t.id} declares repos`);
      assert.deepEqual(t.include, [], `${t.id} declares include`);
    }
  });
});
