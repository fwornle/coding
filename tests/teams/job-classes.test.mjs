/**
 * A team's shared job-class taxonomy (lib/job-classes/package.mjs): the
 * package validator, where a binding's repo is on this machine, the
 * project → taxonomy index rapid-llm-proxy reads, and init/join.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateTaxonomy, checkoutOf, resolveBindings, writeBindingsIndex, initPackage, joinTeam, withName,
} from '../../lib/job-classes/package.mjs';

const TAXONOMY = `# a comment that must survive
version: 2
none: nothing to do
precedence: [fix, build]
prompt: |-
  Pick one. {none} {precedence}
  {catalogue}
  {request}
groups:
  - id: programming
    label: Programming
classes:
  - id: fix
    group: programming
    test: Something is broken.
  - id: build
    group: programming
    test: Add a capability.
`;

let root;
let n = 0;
before(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'job-classes-'))); });
after(() => rmSync(root, { recursive: true, force: true }));

/** An isolated tools repo + home + data dir, and repos whose learning checkouts have the given remotes. */
function fixture({ user = '', repos = {} } = {}) {
  n += 1;
  const base = join(root, `c${n}`);
  const repoRoot = join(base, 'tools');
  const home = join(base, 'home');
  mkdirSync(join(repoRoot, 'config', 'teams'), { recursive: true });
  mkdirSync(join(home, '.coding'), { recursive: true });
  writeFileSync(join(repoRoot, 'config', 'job-classes.yaml'), TAXONOMY);
  const list = [];
  for (const [name, learningRemote] of Object.entries(repos)) {
    const dir = join(base, 'repos', name);
    mkdirSync(join(dir, '.coding', '.git'), { recursive: true });
    writeFileSync(join(dir, '.coding', '.git', 'config'), `[remote "origin"]\n\turl = ${learningRemote}\n`);
    list.push({ path: dir, name, learningRemote, markers: ['coding'] });
  }
  writeFileSync(join(home, '.coding', 'teams.yaml'), user.replaceAll('$BASE', base));
  const opts = {
    repoRoot, home, env: {}, codingRoot: repoRoot, repos: list,
    sharedRoot: join(base, 'shared'), bindingsFile: join(base, 'var', 'job-classes', 'bindings.json'),
  };
  return { base, repoRoot, home, opts, dir: (name) => join(base, 'repos', name) };
}

function writePackage(checkout, text = withName(TAXONOMY, 'job-classes-ui')) {
  mkdirSync(join(checkout, 'job-classes'), { recursive: true });
  writeFileSync(join(checkout, 'job-classes', 'taxonomy.yaml'), text);
}

describe('validateTaxonomy', () => {
  test('a good file passes and is tagged by its name, else by its file', () => {
    const { repoRoot } = fixture();
    const file = join(repoRoot, 'config', 'job-classes.yaml');
    assert.deepEqual(validateTaxonomy(file), { errors: [], tag: 'job-classes-v2', name: null, version: 2, classes: 2 });
    writeFileSync(join(repoRoot, 'named.yaml'), withName(TAXONOMY, 'job-classes-ui'));
    assert.equal(validateTaxonomy(join(repoRoot, 'named.yaml')).tag, 'job-classes-ui-v2');
  });

  test('a shared package must be named; every rule the proxy enforces is reported', () => {
    const { repoRoot } = fixture();
    const file = join(repoRoot, 'bad.yaml');
    writeFileSync(file, 'version: 1.5\nprompt: no placeholder\nprecedence: [ship]\nclasses:\n  - id: Fix\n    test: x\n    group: nope\n  - id: Fix\n');
    const { errors } = validateTaxonomy(file, { requireName: true });
    for (const re of [/name is required/, /version must be/, /\{request\}/, /precedence names unknown class ship/, /'Fix' must be lowercase/, /class Fix has no test/, /duplicate class ids: Fix/, /undeclared group nope/]) {
      assert.ok(errors.some((e) => re.test(e)), `${re} in ${errors.join(' | ')}`);
    }
  });

  test('withName keeps the comments and replaces an existing name', () => {
    const text = withName(TAXONOMY, 'job-classes-ui');
    assert.match(text, /^# a comment that must survive\nname: job-classes-ui\nversion: 2/);
    assert.match(withName(text, 'job-classes-x'), /^name: job-classes-x$/m);
  });
});

describe('bindings', () => {
  test("a binding resolves to the member's own checkout, or to a shared clone", () => {
    const { opts, dir, base } = fixture({ repos: { timeline: 'https://h/me/timeline-history.git' } });
    assert.deepEqual(checkoutOf('git@h:me/timeline-history', opts), { dir: join(dir('timeline'), '.coding'), state: 'linked', project: dir('timeline') });
    assert.deepEqual(checkoutOf('https://h/mate/ui-history.git', opts), { dir: join(base, 'shared', 'ui'), state: 'missing', project: null });
  });

  test("a bound team's projects use its taxonomy; a missing package is reported, not used", () => {
    const { opts, dir } = fixture({
      repos: { timeline: 'https://h/me/timeline-history.git', ui: 'https://h/me/ui-history.git' },
      user: 'teams:\n  ui:\n    repos: [$BASE/repos/timeline, $BASE/repos/ui]\n    jobClasses: { repo: https://h/me/timeline-history.git }\n'
        + '  other:\n    repos: [$BASE/repos/ui]\n    jobClasses: https://h/me/ui-history.git\n',
    });
    writePackage(join(dir('timeline'), '.coding'));
    const r = resolveBindings(opts);
    assert.equal(r.teams.ui.usable, true);
    assert.equal(r.teams.ui.tag, 'job-classes-ui-v2');
    assert.deepEqual(r.teams.ui.projects, ['timeline', 'ui']);
    assert.equal(r.teams.other.usable, false);
    assert.match(r.teams.other.errors[0], /no job-classes\/taxonomy\.yaml/);
    assert.deepEqual(Object.keys(r.projects), ['timeline', 'ui']);
    assert.equal(r.projects.timeline.file, join(dir('timeline'), '.coding', 'job-classes', 'taxonomy.yaml'));
    assert.deepEqual(r.conflicts, []);
  });

  test('a project in two teams bound to two taxonomies is a conflict, labelled by nobody', () => {
    const { opts, dir } = fixture({
      repos: { timeline: 'https://h/me/timeline-history.git', ui: 'https://h/me/ui-history.git' },
      user: 'teams:\n  ui:\n    repos: [$BASE/repos/timeline, $BASE/repos/ui]\n    jobClasses: { repo: https://h/me/timeline-history.git }\n'
        + '  other:\n    repos: [$BASE/repos/ui]\n    jobClasses: { repo: https://h/me/ui-history.git }\n',
    });
    writePackage(join(dir('timeline'), '.coding'));
    writePackage(join(dir('ui'), '.coding'), withName(TAXONOMY, 'job-classes-other'));
    const r = resolveBindings(opts);
    assert.deepEqual(r.conflicts, [{ project: 'ui', teams: ['other', 'ui'] }]);
    assert.deepEqual(r.projects.ui, { conflict: ['other', 'ui'] });
    assert.equal(r.projects.timeline.team, 'ui');
  });

  test('the index names the default taxonomy and is what the proxy reads', () => {
    const { opts, repoRoot } = fixture();
    const doc = writeBindingsIndex(opts);
    const onDisk = JSON.parse(readFileSync(opts.bindingsFile, 'utf8'));
    assert.equal(onDisk.default, join(repoRoot, 'config', 'job-classes.yaml'));
    assert.deepEqual(onDisk.projects, {});
    assert.equal(doc.file, opts.bindingsFile);
  });
});

describe('init and join', () => {
  test("init writes the team's package into the member's checkout, commits it, and binds the team", () => {
    const { opts, dir, home } = fixture({
      repos: { timeline: 'https://h/me/timeline-history.git' },
      user: 'teams:\n  ui:\n    repos: [$BASE/repos/timeline]\n',
    });
    const commits = [];
    const r = initPackage({ ...opts, team: 'ui', cwd: dir('timeline'), commit: (d, message) => { commits.push([d, message]); return { committed: true }; } });
    const pkg = join(dir('timeline'), '.coding', 'job-classes');
    assert.equal(r.created, true);
    assert.equal(r.tag, 'job-classes-ui-v2');
    assert.match(readFileSync(join(pkg, 'taxonomy.yaml'), 'utf8'), /^name: job-classes-ui$/m);
    assert.match(readFileSync(join(pkg, 'CHANGELOG.md'), 'utf8'), /- v2 \(\d{4}-\d\d-\d\d\): started from coding's config\/job-classes\.yaml \(job-classes-v2\)/);
    assert.deepEqual(commits, [[join(dir('timeline'), '.coding'), 'coding: job-class taxonomy for team ui (job-classes-ui-v2)']]);
    assert.match(readFileSync(join(home, '.coding', 'teams.yaml'), 'utf8'), /jobClasses:\n\s+repo: https:\/\/h\/me\/timeline-history\.git/);
    assert.equal(r.index.projects.timeline.tag, 'job-classes-ui-v2');

    const again = initPackage({ ...opts, team: 'ui', commit: () => assert.fail('nothing new to commit') });
    assert.equal(again.created, false, 'a second init binds the existing package and changes nothing');
  });

  test("init refuses a teammate's repo; join clones it and binds the team", () => {
    const { opts, base } = fixture({ user: 'teams:\n  ui:\n    repos: [https://h/mate/ui-history.git]\n' });
    assert.throws(() => initPackage({ ...opts, team: 'ui', repo: 'https://h/mate/ui-history.git' }), /not your own learning checkout here \(missing\).*job-classes join/);
    assert.throws(() => joinTeam({ ...opts, team: 'nope', repo: 'x' }), /no team 'nope'/);
    const r = joinTeam({ ...opts, team: 'ui', repo: 'https://h/mate/ui-history.git', clone: (d) => {
      mkdirSync(join(d, '.git'), { recursive: true });
      writePackage(d);
      return true;
    } });
    assert.equal(r.cloned, true);
    assert.ok(existsSync(join(base, 'shared', 'ui', 'job-classes', 'taxonomy.yaml')));
    assert.equal(r.index.teams.ui.state, 'shared');
    assert.equal(r.index.teams.ui.usable, true);
    assert.equal(r.index.projects.ui.tag, 'job-classes-ui-v2', 'a remote-only team repo is the project named like the remote');
  });
});
