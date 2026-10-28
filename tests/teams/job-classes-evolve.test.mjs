/**
 * P3 of shared job classes (lib/job-classes/evolve.mjs): a member's proposal
 * (synthetic examples only, in their own repo) and the maintainer's fold —
 * absorb, add, merge to make room at the cap, the stability gate, tombstones.
 * The teacher is a stub that reads the request the way a model would.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateTaxonomy } from '../../lib/job-classes/package.mjs';
import { isHarnessNoise } from '../../lib/job-classes/noise.mjs';
import { fold, propose, pendingProposals, readTaxonomy, resolveClass, confusedPairs, kappa } from '../../lib/job-classes/evolve.mjs';

const TAXONOMY = `# the team's taxonomy — this comment must survive a fold
name: job-classes-ui
version: 1
maxClasses: 3
none: nothing to do
precedence: [fix, build, cleanup]
prompt: |-
  {none} {precedence}
  {catalogue}
  REQUEST: {request}
classes:
  - id: fix
    test: Something is broken.
  - id: build
    test: Add a capability.
  - id: cleanup
    test: Tidy without changing behaviour.
`;

let root;
let n = 0;
before(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'job-classes-evolve-'))); });
after(() => rmSync(root, { recursive: true, force: true }));

/**
 * Team ui: my repo `timeline` (whose learning checkout holds the package), and a
 * teammate's repo cloned pull-only under shared/mate. Reference rows for timeline.
 */
function fixture({ taxonomy = TAXONOMY, reference = [] } = {}) {
  n += 1;
  const base = join(root, `c${n}`);
  const home = join(base, 'home');
  const repoRoot = join(base, 'tools');
  mkdirSync(join(repoRoot, 'config', 'teams'), { recursive: true });
  mkdirSync(join(home, '.coding'), { recursive: true });
  const repo = join(base, 'repos', 'timeline');
  const checkout = join(repo, '.coding');
  mkdirSync(join(checkout, '.git'), { recursive: true });
  writeFileSync(join(checkout, '.git', 'config'), '[remote "origin"]\n\turl = https://h/me/timeline-history.git\n');
  mkdirSync(join(checkout, 'job-classes'), { recursive: true });
  writeFileSync(join(checkout, 'job-classes', 'taxonomy.yaml'), taxonomy);
  writeFileSync(join(checkout, 'job-classes', 'CHANGELOG.md'), '# Job classes — team ui\n\n- v1: started.\n');
  mkdirSync(join(base, 'shared', 'mate', '.git'), { recursive: true });
  writeFileSync(join(home, '.coding', 'teams.yaml'),
    `teams:\n  ui:\n    repos: [${repo}, https://h/mate/mate-history.git]\n    jobClasses: { repo: https://h/me/timeline-history.git }\n`);
  mkdirSync(join(base, 'ref', 'ui'), { recursive: true });
  writeFileSync(join(base, 'ref', 'ui', 'reference-job-classes-ui-v1.jsonl'), reference.map((r, i) => JSON.stringify({ id: `p${i}`, repo: 'timeline', ...r })).join('\n'));
  const opts = {
    repoRoot, home, env: {}, codingRoot: repoRoot,
    repos: [{ path: repo, name: 'timeline', learningRemote: 'https://h/me/timeline-history.git', markers: ['coding'] }],
    sharedRoot: join(base, 'shared'), referenceDir: join(base, 'ref'), tokenDb: join(base, 'no.db'),
    hostname: 'host', user: 'me', now: () => Date.parse('2026-10-29T10:00:00Z'),
  };
  return { base, checkout, opts, pkg: join(checkout, 'job-classes') };
}

/** Reference rows: `agreed` per class, and teacher disagreements per pair. */
function reference({ agreed = {}, confused = [] } = {}) {
  const rows = [];
  for (const [cls, k] of Object.entries(agreed)) for (let i = 0; i < k; i++) rows.push({ text: `${cls} job number ${i}`, teacher: [cls, cls], class: cls });
  for (const [a, b, k] of confused) for (let i = 0; i < k; i++) rows.push({ text: `${a} or ${b} job ${i}`, teacher: [a, b], class: null });
  return rows;
}

function writeProposal(dir, team, doc) {
  mkdirSync(join(dir, 'job-classes', 'proposals', team), { recursive: true });
  writeFileSync(join(dir, 'job-classes', 'proposals', team, `${doc.member}-x.json`), JSON.stringify(doc));
}

const DESIGN = { key: 'mate-1-0', id: 'design', label: 'Design', test: 'Shape a screen or a flow before it is built.', group: null, examples: ['sketch the settings screen', 'lay out the onboarding flow', 'propose a layout for the empty state'], support: 5 };

/**
 * A stub teacher: a classification request is answered by the first word of the
 * request when it is a class in the catalogue, else "none"; `design` examples
 * are "none" (a new kind of job); a merge request gets one test.
 */
function teacher({ drift = false } = {}) {
  const calls = [];
  const complete = async (messages) => {
    const c = messages[0].content;
    calls.push(c);
    if (c.startsWith('Two job classes are merged')) return '{"test":"Add a capability or tidy the code."}';
    const req = c.slice(c.lastIndexOf('REQUEST: ') + 9);
    const ids = [...c.matchAll(/^- ([a-z-]+): /gm)].map((m) => m[1]);
    const first = req.split(' ')[0];
    if (drift && ids.includes('design')) return `{"class":"${first === 'fix' ? 'build' : first}"}`;
    if (ids.includes(first)) return `{"class":"${first}"}`;
    if (first === 'cleanup' && !ids.includes('cleanup')) return '{"class":"build"}';
    return '{"class":"none"}';
  };
  return { complete, calls };
}

describe('fold', () => {
  test('at the cap, the most-confused pair merges to make room; the old label resolves to the survivor', async () => {
    const { opts, pkg, base } = fixture({ reference: reference({ agreed: { fix: 12, build: 6, cleanup: 3 }, confused: [['build', 'cleanup', 4], ['fix', 'build', 1]] }) });
    writeProposal(join(base, 'shared', 'mate'), 'ui', { member: 'mate', createdAt: '2026-10-28T09:00:00Z', proposals: [DESIGN] });
    const commits = [];
    const { complete } = teacher();
    const r = await fold({ ...opts, team: 'ui', complete, commit: (dir, msg) => { commits.push(msg); return { committed: true }; } });

    assert.equal(r.to, 'job-classes-ui-v2');
    assert.deepEqual(r.decisions.map((d) => d.decision), ['merge', 'add']);
    assert.deepEqual([r.decisions[0].retired, r.decisions[0].into], ['cleanup', 'build'], 'the class holding more prompts survives');
    assert.ok(r.stability.kappa >= 0.7 && r.stability.compared >= 10);

    const file = join(pkg, 'taxonomy.yaml');
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^# the team's taxonomy — this comment must survive a fold/);
    assert.deepEqual(validateTaxonomy(file, { requireName: true }).errors, []);
    const tax = readTaxonomy(file);
    assert.equal(tax.version, 2);
    assert.deepEqual(tax.classes.map((c) => c.id), ['fix', 'build', 'design']);
    assert.deepEqual(tax.precedence, ['fix', 'build', 'design']);
    assert.equal(tax.classes[1].test, 'Add a capability or tidy the code.');
    assert.deepEqual(tax.retired.map(({ id, mergedInto, version }) => ({ id, mergedInto, version })), [{ id: 'cleanup', mergedInto: 'build', version: 2 }]);
    assert.equal(resolveClass(tax, 'cleanup'), 'build', 'a v1 label of the merged class still resolves');
    assert.match(readFileSync(join(pkg, 'CHANGELOG.md'), 'utf8'), /- v2 \(2026-10-29\): merged cleanup into build \(4 teacher disagreements\); added design \(held 5 unplaced prompts\)\. Stability kappa/);
    assert.deepEqual(JSON.parse(readFileSync(join(pkg, 'folded.json'), 'utf8')).folded['mate-1-0'], { decision: 'add', version: 2, at: '2026-10-29' });
    assert.deepEqual(commits, ['coding: job classes for team ui → job-classes-ui-v2']);

    assert.deepEqual(pendingProposals('ui', opts), [], 'a folded proposal is never folded twice');
    const again = await fold({ ...opts, team: 'ui', complete });
    assert.equal(again.note, 'no pending proposals');
  });

  test('a proposal an existing class already holds is absorbed: no new version', async () => {
    const { opts, base, pkg } = fixture({ reference: reference({ agreed: { fix: 12 } }) });
    writeProposal(join(base, 'shared', 'mate'), 'ui', { member: 'mate', createdAt: '2026-10-28T09:00:00Z',
      proposals: [{ ...DESIGN, key: 'mate-2-0', id: 'repair', examples: ['fix the crash on start', 'fix the broken login', 'tidy up'] }] });
    const r = await fold({ ...opts, team: 'ui', complete: teacher().complete });
    assert.deepEqual(r.decisions.map((d) => [d.decision, d.into]), [['absorb', 'fix']]);
    assert.equal(r.to, 'job-classes-ui-v1');
    assert.equal(readTaxonomy(join(pkg, 'taxonomy.yaml')).version, 1);
    assert.equal(JSON.parse(readFileSync(join(pkg, 'folded.json'), 'utf8')).folded['mate-2-0'].decision, 'absorb');
  });

  test('at the cap with no two classes confused enough, the proposal is rejected', async () => {
    const { opts, base } = fixture({ reference: reference({ agreed: { fix: 12, build: 6 }, confused: [['build', 'cleanup', 2]] }) });
    writeProposal(join(base, 'shared', 'mate'), 'ui', { member: 'mate', createdAt: '2026-10-28T09:00:00Z', proposals: [DESIGN] });
    const r = await fold({ ...opts, team: 'ui', complete: teacher().complete });
    assert.equal(r.decisions[0].decision, 'reject');
    assert.match(r.decisions[0].reason, /at the cap of 3/);
  });

  test('a version that moves the unchanged classes is refused, and nothing is written', async () => {
    const { opts, base, pkg } = fixture({ taxonomy: TAXONOMY.replace('maxClasses: 3', 'maxClasses: 16'), reference: reference({ agreed: { fix: 10, build: 10 } }) });
    writeProposal(join(base, 'shared', 'mate'), 'ui', { member: 'mate', createdAt: '2026-10-28T09:00:00Z', proposals: [DESIGN] });
    const before = readFileSync(join(pkg, 'taxonomy.yaml'), 'utf8');
    const r = await fold({ ...opts, team: 'ui', complete: teacher({ drift: true }).complete });
    assert.match(r.refused, /below 0\.7: churn, not learning/);
    assert.equal(readFileSync(join(pkg, 'taxonomy.yaml'), 'utf8'), before);
    assert.ok(!existsSync(join(pkg, 'folded.json')), 'a refused proposal stays pending');
  });

  test('only the maintainer folds: a pull-only package is refused', async () => {
    const { opts, base } = fixture();
    writeFileSync(join(opts.home, '.coding', 'teams.yaml'), 'teams:\n  ui:\n    repos: [https://h/mate/mate-history.git]\n    jobClasses: { repo: https://h/mate/mate-history.git }\n');
    mkdirSync(join(base, 'shared', 'mate', 'job-classes'), { recursive: true });
    await assert.rejects(fold({ ...opts, team: 'ui', complete: teacher().complete }), /only its maintainer folds/);
  });
});

describe('propose', () => {
  test("writes synthetic proposals into the member's own repo, dropping examples that copy a prompt", async () => {
    const gapsText = ['please draw the settings screen with two columns and a sticky footer', 'sketch how the onboarding should flow for a new user', 'design the empty state for the list view'];
    const { opts, checkout } = fixture({ reference: gapsText.map((text) => ({ text, teacher: ['none', 'none'], class: 'none' })).concat(reference({ agreed: { fix: 3 } })) });
    const answer = { proposals: [
      { id: 'Design', label: 'Design', test: 'Shape a screen or a flow before it is built.', group: null, covers: [0, 1, 2],
        examples: ['sketch the screen for exporting a report', 'draw the settings screen with two columns and a sticky footer', 'lay out a wizard for first-time setup'] },
      { id: 'fix', test: 'x', covers: [0, 1, 2], examples: ['a', 'b'] },
      { id: 'chat', test: 'Small talk.', covers: [1], examples: ['hi there', 'thanks a lot'] },
    ] };
    const commits = [];
    const r = await propose({ ...opts, team: 'ui', complete: async () => JSON.stringify(answer), commit: (dir, msg) => { commits.push([dir, msg]); return { committed: true }; } });
    assert.equal(r.gapsSeen, 3);
    assert.deepEqual(r.proposals.map((p) => [p.id, p.examples.length, p.support]), [['design', 2, 3]]);
    assert.ok(!r.proposals[0].examples.some((e) => e.includes('sticky footer')), 'an example copying a real prompt is dropped');
    assert.deepEqual(r.dropped.map((d) => d.reason), ['id fix is already a class', 'holds 1 of the prompts (needs 3)']);
    const files = readdirSync(join(checkout, 'job-classes', 'proposals', 'ui'));
    assert.equal(files.length, 1);
    const doc = JSON.parse(readFileSync(join(checkout, 'job-classes', 'proposals', 'ui', files[0]), 'utf8'));
    assert.equal(doc.taxonomy, 'job-classes-ui-v1');
    assert.match(doc.member, /^[0-9a-f]{10}$/, 'a pseudonym, never a user or host name');
    assert.ok(!JSON.stringify(doc).includes('sticky footer'), 'no real prompt in the shared file');
    assert.deepEqual(commits.map((c) => c[1]), ['coding: job-class proposal for team ui (design)']);
    assert.equal(pendingProposals('ui', opts).length, 1, 'the maintainer sees it as pending');
  });
});

describe('helpers', () => {
  test('confusion pairs follow tombstones; kappa', () => {
    const tax = { classes: [{ id: 'a' }, { id: 'b' }], retired: [{ id: 'c', mergedInto: 'b' }] };
    assert.deepEqual(confusedPairs(tax, [{ teacher: ['a', 'c'] }, { teacher: ['b', 'a'] }, { teacher: ['b', 'c'] }]), [{ pair: ['a', 'b'], n: 2 }]);
    assert.equal(kappa(['a', 'b', 'a'], ['a', 'b', 'a']), 1);
    assert.equal(kappa([], []), null);
  });
});

describe('harness noise', () => {
  test('skill loads, bash mode and its output are nobody\'s job; a real prompt is kept', () => {
    for (const t of [
      'Base directory for this skill: /x/skills/sl\n\n# Session logs',
      '(Re-invocation of /sl — the skill instructions were previously loaded',
      'Skill /documentation-style is already loaded above; instructions unchanged.',
      '! git -C ~/repo push origin --delete HEAD',
      '<bash-stdout>/x</bash-stdout><bash-stderr></bash-stderr>',
      'The following tool was executed by the user',
      '<task-notification>done</task-notification>',
    ]) assert.equal(isHarnessNoise(t), true, t);
    for (const t of ['restart the proxy and do the cleanup', 'why did ! fail here?', 'fix install.sh']) assert.equal(isHarnessNoise(t), false, t);
  });
});
