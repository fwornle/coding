/**
 * The team-pooled gate, coding's side (lib/job-classes/gate.mjs,
 * .planning/shared-job-classes.md P6): `coding job-classes publish` writes this
 * member's gate counts into the team package and commits them; a package in the
 * member's own learning checkout waits for `coding sync --push`, a shared clone
 * is pushed. Real git against bare repos; the format and pooling are tested in
 * rapid-llm-proxy (tests/unit/gate-pool.test.mjs).
 *
 * Skipped without a rapid-llm-proxy checkout that has proxy-bridge/gate-pool.mjs
 * (RAPID_LLM_PROXY_DIR, else the _work sibling).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { memberId } from '../../lib/job-classes/evolve.mjs';
import { boundTeams, gateMember, hasPublished, publishTeamGate, republishGates } from '../../lib/job-classes/gate.mjs';

const require = createRequire(import.meta.url);
const { proxyDir } = require('../../lib/proxy/proxy-paths.cjs');
const GATE_POOL = join(proxyDir(), 'proxy-bridge', 'gate-pool.mjs');
const skip = existsSync(GATE_POOL) ? false : `no ${GATE_POOL}`;

const TAXONOMY = `name: job-classes-ui
version: 1
prompt: |-
  {request}
classes:
  - id: fix
    test: Something is broken.
  - id: build
    test: Add a capability.
`;

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let root;
let n = 0;
before(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'job-classes-gate-'))); });
after(() => rmSync(root, { recursive: true, force: true }));

/** A team repo (bare) seeded with the package; the member's DB with labels under its tag. */
async function fixture({ state }) {
  n += 1;
  const base = join(root, `c${n}`);
  const bare = join(base, 'remote', 'timeline-history.git');
  mkdirSync(join(base, 'remote'), { recursive: true });
  sh(base, 'init', '-q', '--bare', '-b', 'main', bare);
  const seed = join(base, 'seed');
  sh(base, 'clone', '-q', bare, seed);
  mkdirSync(join(seed, 'job-classes'), { recursive: true });
  writeFileSync(join(seed, 'job-classes', 'taxonomy.yaml'), TAXONOMY);
  sh(seed, 'add', '.');
  sh(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'package');
  sh(seed, 'push', '-q', 'origin', 'HEAD');

  const home = join(base, 'home');
  const repoRoot = join(base, 'tools');
  mkdirSync(join(repoRoot, 'config', 'teams'), { recursive: true });
  mkdirSync(join(home, '.coding'), { recursive: true });
  const repo = join(base, 'repos', 'timeline');
  const sharedRoot = join(base, 'shared');
  mkdirSync(repo, { recursive: true });
  mkdirSync(sharedRoot, { recursive: true });
  // linked: the member's own learning checkout IS the team repo; shared: a clone under var/shared/.
  const checkout = state === 'linked' ? join(repo, '.coding') : join(sharedRoot, 'timeline');
  sh(base, 'clone', '-q', bare, checkout);
  writeFileSync(join(home, '.coding', 'teams.yaml'), `teams:\n  ui:\n    repos: [${repo}]\n    jobClasses: { repo: ${bare} }\n`);

  const { TURN_JOB_CLASS_DDL } = await import(pathToFileURL(join(proxyDir(), 'proxy-bridge', 'job-class.mjs')).href);
  const Database = require('better-sqlite3');
  const tokenDb = join(base, 'token-usage.db');
  const db = new Database(tokenDb);
  db.exec(TURN_JOB_CLASS_DDL);
  const ins = db.prepare(`INSERT INTO turn_job_class (conversation_key, turn_index, taxonomy, job_class, student_model, teacher_class, teacher_model, prompt_preview, labelled_at)
    VALUES (?, 0, 'job-classes-ui-v1', ?, 'gh-copilot/claude-sonnet-5', ?, ?, 'SECRET PROMPT TEXT', '2026-11-20T10:00:00Z')`);
  ins.run('a', 'fix', 'fix', 'gh-copilot/claude-sonnet-5');
  ins.run('b', 'fix', 'build', 'gh-copilot/claude-sonnet-5');
  ins.run('c', 'build', '', '');
  db.close();

  const opts = {
    repoRoot, home, env: {}, codingRoot: repoRoot, sharedRoot, tokenDb,
    repos: state === 'linked' ? [{ path: repo, name: 'timeline', learningRemote: bare, markers: ['coding'] }] : [{ path: repo, name: 'timeline', markers: ['coding'] }],
    hostname: 'host', user: 'me', now: () => Date.parse('2026-11-23T10:00:00Z'),
  };
  return { base, bare, checkout, opts };
}

describe('coding job-classes publish', { skip }, () => {
  test('the pseudonym is P3 memberId, so one person is one member in proposals and gate files', async () => {
    assert.equal(await gateMember({ hostname: 'host', user: 'me' }), memberId({ hostname: 'host', user: 'me' }));
  });

  test('own learning checkout: written and committed, pushed only by coding sync --push; republish commits nothing', async () => {
    const f = await fixture({ state: 'linked' });
    assert.deepEqual(boundTeams(f.opts), ['ui']);
    assert.equal(await hasPublished('ui', f.opts), false);
    const r = await publishTeamGate({ team: 'ui', push: true, ...f.opts });
    assert.equal(r.state, 'linked');
    assert.deepEqual([r.changed, r.committed, r.pushed, r.pushLater, r.error], [true, true, false, true, undefined]);
    const doc = JSON.parse(readFileSync(r.file, 'utf8'));
    assert.equal(doc.member, memberId({ hostname: 'host', user: 'me' }));
    assert.deepEqual(doc.pools[0].classes, { build: { labelled: 1, checked: 0, agree: 0 }, fix: { labelled: 2, checked: 2, agree: 1 } });
    assert.deepEqual(doc.pools[0].confusions, [['fix', 'build', 1]]);
    assert.ok(!readFileSync(r.file, 'utf8').includes('SECRET'), 'no prompt text in the published file');
    assert.equal(sh(f.bare, 'log', '-1', '--format=%s', 'main').trim(), 'package', 'nothing pushed');
    assert.equal(await hasPublished('ui', f.opts), true);
    const again = await publishTeamGate({ team: 'ui', push: true, ...f.opts, now: () => Date.parse('2026-11-24T10:00:00Z') });
    assert.deepEqual([again.changed, again.committed], [false, false]);
  });

  test('shared clone: pushed under the pseudonym', async () => {
    const f = await fixture({ state: 'shared' });
    const r = await publishTeamGate({ team: 'ui', push: true, ...f.opts });
    assert.equal(r.state, 'shared');
    assert.deepEqual([r.committed, r.pushed, r.error], [true, true, undefined]);
    const member = memberId({ hostname: 'host', user: 'me' });
    assert.equal(sh(f.bare, 'log', '-1', '--format=%an|%s', 'main').trim(), `job-classes ${member}|job-classes: gate counts of ${member}`);
    assert.equal(sh(f.bare, 'ls-tree', '--name-only', 'main', 'job-classes/gate/').trim(), `job-classes/gate/${member}.json`);
  });

  test('without --push a shared clone is only committed', async () => {
    const f = await fixture({ state: 'shared' });
    const r = await publishTeamGate({ team: 'ui', ...f.opts });
    assert.deepEqual([r.committed, r.pushed, r.pushLater], [true, false, undefined]);
  });

  test('coding sync --push republishes only where this member already published (the first publish is the opt-in)', async () => {
    const f = await fixture({ state: 'shared' });
    assert.deepEqual(await republishGates({ push: true, ...f.opts }), []);
    assert.equal(sh(f.bare, 'log', '-1', '--format=%s', 'main').trim(), 'package');
    await publishTeamGate({ team: 'ui', ...f.opts }); // by hand, not pushed
    const rows = await republishGates({ push: true, ...f.opts });
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].team, rows[0].pushed, rows[0].error], ['ui', true, undefined]);
  });
});
