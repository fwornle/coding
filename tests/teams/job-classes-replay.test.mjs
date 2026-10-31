/**
 * P4 of shared job classes: per-class replay trials (lib/job-classes/turn-capture.mjs,
 * replay-locate.mjs, replay-sandbox.mjs, replay-run.mjs, replay-judge.mjs).
 *
 * Everything here runs on synthetic repos, turn records and token rows; no agent is
 * spawned and no model is called (the judge is a stub). The turn records are the
 * shape rapid-llm-proxy's proxy-bridge/turn-record.mjs writes.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { captureTurn, captureOf, listCaptures, repoForProject, sweep, CAPS } from '../../lib/job-classes/turn-capture.mjs';
import { candidates, labelledTurns } from '../../lib/job-classes/replay-locate.mjs';
import { buildTree, futureLeaks, pathSpellings, renderPrompt, sandboxProfile, treeDigest } from '../../lib/job-classes/replay-sandbox.mjs';
import { modelKey, replayTurn, servedAsAsked, servedModels } from '../../lib/job-classes/replay-run.mjs';
import { judgePair, parseJudgment, verdicts } from '../../lib/job-classes/replay-judge.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let root;
before(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'job-classes-replay-'))); });
after(() => rmSync(root, { recursive: true, force: true }));

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: process.env.GIT_DATE, GIT_COMMITTER_DATE: process.env.GIT_DATE } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function repoAt(name, files, date = '2026-10-30T10:00:00Z') {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), c); }
  git(dir, 'add', '-A');
  process.env.GIT_DATE = date;
  git(dir, 'commit', '-q', '-m', 'first');
  delete process.env.GIT_DATE;
  return dir;
}

const turn = (ck, ti, extra = {}) => ({ conversationKey: ck, turnIndex: ti, agent: 'copilot', project: 'r', ...extra });

describe('turn capture', () => {
  test('keeps HEAD, the dirty patch and untracked files under the turn identity, no prompt', () => {
    const repo = repoAt('cap', { 'a.txt': 'one\n' });
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    writeFileSync(join(repo, 'new.txt'), 'untracked\n');
    const replayRoot = join(root, 'rr-cap');
    const r = captureTurn(turn('ck0', 3, { repoRoot: repo, at: '2026-10-31T10:00:00.000Z' }), { replayRoot });
    assert.equal(r.meta.complete, true);
    assert.equal(r.meta.sha, git(repo, 'rev-parse', 'HEAD'));
    assert.match(readFileSync(join(r.dir, 'dirty.patch'), 'utf8'), /\+two/);
    assert.equal(readFileSync(join(r.dir, 'untracked', 'new.txt'), 'utf8'), 'untracked\n');
    assert.equal(captureOf('ck0', 3, { replayRoot }).meta.agent, 'copilot');
  });

  test('the repo is the discovered checkout of the turn\'s project, and only an unambiguous one', () => {
    const a = repoAt('proj-a', { 'x': '1' });
    const repos = [{ path: a }, { path: join(root, 'elsewhere') }];
    const r = repoForProject('proj-a', { repos });
    assert.equal(r.dir, a);
    assert.match(repoForProject('nope', { repos }).reason, /no discovered repo/);
    assert.match(repoForProject('', { repos }).reason, /no project/);
    const cap = captureTurn(turn('ck-np', 1, { project: 'nope' }), { replayRoot: join(root, 'rr-np'), repos });
    assert.equal(cap.meta.complete, false, 'recorded as unusable, not silently missing');
  });

  test('an oversized untracked file marks the capture incomplete', () => {
    const repo = repoAt('cap-big', { 'a.txt': 'x\n' });
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(CAPS.untrackedFileBytes + 1));
    const r = captureTurn(turn('ck-big', 1, { repoRoot: repo }), { replayRoot: join(root, 'rr-big') });
    assert.equal(r.meta.complete, false);
    assert.match(r.meta.reasons.join(), /big\.bin/);
  });

  test('the sweep keeps kept-class captures, deletes the rest, waits on young ones, caps records', () => {
    const repo = repoAt('cap-sweep', { 'a.txt': 'x\n' });
    const replayRoot = join(root, 'rr-sweep');
    const now = Date.now();
    const H = 3600_000;
    const mk = (ck, ageMs) => captureTurn(turn(ck, 1, { repoRoot: repo, at: new Date(now - ageMs).toISOString() }), { replayRoot });
    mk('status-old', 2 * H);
    mk('fix-old', 2 * H);
    mk('young', 5 * 60_000);
    mk('unlabelled-old', 7 * H);
    mk('unlabelled-mid', 2 * H);
    const labels = { 'status-old': 'status', 'fix-old': 'fix' };
    const labelOf = (m) => (labels[m.conversationKey] ? { jobClass: labels[m.conversationKey] } : null);
    const s = sweep({ replayRoot, now, classes: ['status', 'explain'], labelOf });
    assert.deepEqual({ kept: s.kept, deleted: s.deleted, waiting: s.waiting }, { kept: 1, deleted: 2, waiting: 2 });
    const left = listCaptures({ replayRoot });
    assert.deepEqual(left.filter((c) => c.state === 'kept').map((c) => [c.cls, c.meta.conversationKey]), [['status', 'status-old']]);
    assert.deepEqual(left.filter((c) => c.state === 'pending').map((c) => c.meta.conversationKey).sort(), ['unlabelled-mid', 'young']);
    // Kept captures and turn records are capped, oldest first.
    mk('status-new', 2 * H - 1000);
    labels['status-new'] = 'status';
    mkdirSync(join(replayRoot, 'turns'), { recursive: true });
    for (const n of ['a-t1', 'b-t1']) writeFileSync(join(replayRoot, 'turns', `${n}.json`), '{}');
    const s2 = sweep({ replayRoot, now, classes: ['status'], maxKept: 1, labelOf });
    assert.equal(s2.trimmed, 2);
    assert.deepEqual(listCaptures({ replayRoot }).filter((c) => c.state === 'kept').map((c) => c.meta.conversationKey), ['status-new']);
  });

  test('the worker the proxy starts writes a capture and returns', () => {
    const repo = repoAt('worked', { 'a.txt': 'x\n' });
    const replayRoot = join(root, 'rr-worker');
    const r = spawnSync(process.execPath, [join(process.cwd(), 'lib', 'job-classes', 'turn-capture.mjs'), '--worker',
      JSON.stringify({ ...turn('ckw', 2, { repoRoot: repo }), at: new Date().toISOString(), replayRoot })], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(captureOf('ckw', 2, { replayRoot }).meta.complete, true);
  });
});

// A turn record as the proxy writes it.
function record(live, extra = {}) {
  return {
    schema: 1, conversationKey: 'ck1', turnIndex: 2, agent: 'copilot', project: 'r', at: '2026-10-30T11:00:00.000Z',
    jobClass: 'status', taxonomy: 'tax-v2', prompt: 'what is next?', image: false,
    history: [
      { role: 'user', text: 'first question' },
      { role: 'assistant', name: 'grep', text: `→ grep({"path":"${live}/src"})` },
      { role: 'tool', name: 'tool', text: `${live}/src/a.ts: match` },
      { role: 'assistant', text: 'It is in src/a.ts.' },
    ],
    historyOmitted: 0, answer: 'Next is P4.', ...extra,
  };
}

describe('the prompt a replay arm is given', () => {
  test('the earlier conversation as context, then the person\'s message, with live paths rewritten', () => {
    const live = '/Users/u/Agentic/some-repo';
    const p = renderPrompt(record(live), { liveRepo: live, sandboxPath: '/tmp/sbx/repo' });
    assert.match(p, /<earlier-conversation>[\s\S]*\[user\]\nfirst question[\s\S]*\[assistant tool call\]\n→ grep[\s\S]*\[tool result\][\s\S]*<\/earlier-conversation>/);
    assert.ok(p.trimEnd().endsWith('what is next?'));
    assert.ok(!p.includes(live) && p.includes('/tmp/sbx/repo/src/a.ts'));
    assert.ok(!p.includes('Next is P4.'), 'the real answer is the future');
    assert.deepEqual(futureLeaks({ tree: join(root, 'nonexistent'), turnAt: '2026-10-30T11:00:00Z', promptText: p, liveRepo: live }), []);
    assert.equal(renderPrompt(record(live, { history: [] }), { liveRepo: live, sandboxPath: '/x' }), 'what is next?', 'a first turn is just the prompt');
  });

  test('the no-future check names a live path left in the prompt', () => {
    const v = futureLeaks({ tree: join(root, 'nonexistent'), turnAt: '2026-10-30T11:00:00Z', promptText: 'see ~/Agentic/r/x', liveRepo: '/Users/someone/Agentic/r' });
    assert.equal(v.length, 0, 'not under this home: only the absolute spelling applies');
    const w = futureLeaks({ tree: join(root, 'nonexistent'), turnAt: '2026-10-30T11:00:00Z', promptText: 'see /Users/someone/Agentic/r/x', liveRepo: '/Users/someone/Agentic/r' });
    assert.equal(w.length, 1, w.join(' | '));
  });

  test('path spellings cover absolute, ~ and the redacted user', () => {
    const s = pathSpellings('/Users/u/Agentic/r', '/Users/u');
    assert.deepEqual(new Set(s), new Set(['/Users/u/Agentic/r', '~/Agentic/r', '/Users/<USER_ID_REDACTED>/Agentic/r']));
  });
});

describe('the replay tree', () => {
  test('holds one commit and the captured state; a later commit is not in it', () => {
    const live = repoAt('live', { 'a.txt': 'one\n', 'b.txt': 'b\n' }, '2026-10-30T09:00:00Z');
    writeFileSync(join(live, 'a.txt'), 'one\ndirty\n');
    writeFileSync(join(live, 'notes.md'), 'untracked\n');
    const cap = captureTurn(turn('ck-tree', 1, { repoRoot: live, at: '2026-10-30T11:00:00Z' }), { replayRoot: join(root, 'rr-tree') });
    // The future: a commit after the turn.
    git(live, 'add', '-A');
    process.env.GIT_DATE = '2026-10-30T12:00:00Z';
    git(live, 'commit', '-q', '-m', 'after the turn');
    delete process.env.GIT_DATE;

    const capture = { dir: cap.dir, meta: cap.meta };
    const at = '2026-10-30T11:00:00Z';
    const t1 = join(root, 'tree1');
    const t2 = join(root, 'tree2');
    buildTree({ capture, liveRepo: live, at, dir: t1 });
    buildTree({ capture, liveRepo: live, at, dir: t2 });
    assert.equal(git(t1, 'rev-list', '--all').split('\n').length, 1);
    assert.equal(git(t1, 'log', '-1', '--format=%s'), 'first');
    assert.equal(readFileSync(join(t1, 'a.txt'), 'utf8'), 'one\ndirty\n');
    assert.equal(readFileSync(join(t1, 'notes.md'), 'utf8'), 'untracked\n');
    assert.equal(git(t1, 'remote'), '');
    assert.ok(!existsSync(join(t1, '.git', 'FETCH_HEAD')));
    assert.deepEqual(futureLeaks({ tree: t1, turnAt: at, promptText: '', liveRepo: live }), []);
    assert.equal(treeDigest(t1), treeDigest(t2), 'two builds of one turn are identical');
    writeFileSync(join(t2, 'notes.md'), 'changed\n');
    assert.notEqual(treeDigest(t1), treeDigest(t2));
  });

  test('without a capture, HEAD\'s commit at the prompt time and a recorded gap', () => {
    const live = join(root, 'live');
    const dir = join(root, 'tree-uncaptured');
    const r = buildTree({ capture: null, liveRepo: live, at: '2026-10-30T11:00:00Z', dir });
    assert.equal(git(dir, 'log', '-1', '--format=%s'), 'first');
    assert.ok(r.gaps.some((g) => /no capture/.test(g)));
  });

  test('the OS sandbox denies the live trees, the session stores and all network but the proxy', () => {
    const p = sandboxProfile({ sandboxDir: '/tmp/sbx', home: '/Users/u', proxyPort: 12435 });
    const denyLine = p.split('\n').find((l) => l.startsWith('(deny file-read* file-write*'));
    for (const d of ['/Users/u/Agentic', '/Users/u/.coding', '/Users/u/.claude/projects', '/Users/u/.copilot/session-state', '/Users/u/.pi/agent/sessions']) {
      assert.ok(denyLine.includes(`(subpath "${d}")`), d);
    }
    assert.ok(!denyLine.includes('(subpath "/Users/u/.claude")'), 'the agent\'s own config and login stay readable');
    assert.ok(p.indexOf('(allow file-write*') < p.indexOf('(deny file-read* file-write*'), 'the deny comes last, so it wins');
    assert.match(p, /\(deny network-outbound\)/);
    assert.match(p, /localhost:12435/);
  });
});

describe('locating labelled turns', () => {
  function tokenDb() {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE token_usage (conversation_key TEXT, turn_index INTEGER, tool_call_id TEXT, model TEXT, timestamp TEXT);
      CREATE INDEX idx_token_usage_turn ON token_usage(conversation_key, turn_index) WHERE conversation_key != '';
      CREATE TABLE turn_job_class (conversation_key TEXT, turn_index INTEGER, agent TEXT, project TEXT, taxonomy TEXT, job_class TEXT,
        teacher_class TEXT, prompt_preview TEXT, labelled_at TEXT, PRIMARY KEY (conversation_key, turn_index));`);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO turn_job_class VALUES (?,?,?,?,?,?,?,?,?)').run('ck1', 2, 'copilot', 'r', 'tax-v2', 'status', '', 'what is next?', now);
    db.prepare('INSERT INTO turn_job_class VALUES (?,?,?,?,?,?,?,?,?)').run('ck2', 1, 'mastra', 'r', 'tax-v2', 'status', '', 'old agent', now);
    db.prepare('INSERT INTO token_usage VALUES (?,?,?,?,?)').run('ck1', 2, '', 'claude-haiku-5.5', '2026-10-30T11:00:01Z');
    db.prepare('INSERT INTO token_usage VALUES (?,?,?,?,?)').run('ck1', 2, '', 'claude-sonnet-5', '2026-10-30T11:00:09Z');
    return db;
  }

  test('label → turn record → capture, by the proxy\'s turn identity, for any agent', () => {
    const db = tokenDb();
    const live = join(root, 'live');
    const replayRoot = join(root, 'rr-locate');
    mkdirSync(join(replayRoot, 'turns'), { recursive: true });
    writeFileSync(join(replayRoot, 'turns', 'ck1-t2.json'), JSON.stringify(record(live)));

    const labels = labelledTurns({ db, classes: ['status'] });
    assert.equal(labels.find((l) => l.conversationKey === 'ck1').model, 'claude-sonnet-5', 'the turn\'s last call');

    let [c, old] = candidates({ db, replayRoot, classes: ['status'], days: 3650 });
    assert.deepEqual(c.reasons, ['no capture of the repo at turn start']);
    assert.equal(c.record.prompt, 'what is next?');
    assert.deepEqual(old.reasons, ["no replay adapter for agent 'mastra'", 'no turn record (labelled before the proxy kept records, or a class it does not keep)']);

    captureTurn(turn('ck1', 2, { repoRoot: live }), { replayRoot });
    [c] = candidates({ db, replayRoot, classes: ['status'], days: 3650, agent: 'copilot' });
    assert.deepEqual(c.reasons, []);
    assert.equal(c.capture.meta.repoRoot, live);
    [c] = candidates({ db, replayRoot: join(root, 'rr-none'), classes: ['status'], days: 3650, agent: 'copilot', allowUncaptured: true });
    assert.deepEqual(c.reasons, ['no turn record (labelled before the proxy kept records, or a class it does not keep)']);
  });

  test('a dry run builds and checks every arm\'s sandbox for a non-Claude turn, and spawns nothing', async () => {
    const db = tokenDb();
    const live = join(root, 'live');
    const replayRoot = join(root, 'rr-locate');
    const run = async () => {
      const [c] = candidates({ db, replayRoot, classes: ['status'], days: 3650, agent: 'copilot' });
      return replayTurn({ c, candidate: 'claude-haiku-5-5', runId: 'jcr-test', aa: true, dryRun: true, osSandbox: false, replayRoot });
    };
    // The capture holds today's HEAD, committed after the 11:00 prompt: that is the future.
    assert.match((await run()).refused, /HEAD committed .* after the turn/);
    writeFileSync(join(replayRoot, 'turns', 'ck1-t2.json'), JSON.stringify(record(live, { at: '2026-10-30T13:00:00.000Z' })));
    const r = await run();
    assert.equal(r.refused, null, r.refused);
    assert.equal(r.agent, 'copilot');
    assert.equal(r.incumbent, 'claude-sonnet-5');
    assert.equal(r.sha, git(live, 'rev-parse', 'HEAD'));
    assert.ok(r.gaps.some((g) => /copilot/.test(g)), 'the agent\'s own gaps are recorded');
    assert.ok(!existsSync(join(replayRoot, 'runs')), 'a dry run records nothing');
  });
});

describe('which model answered', () => {
  test('an arm counts only when the model it asked for wrote most of the output', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE token_usage (task_id TEXT, model TEXT, output_tokens INTEGER)');
    const ins = db.prepare('INSERT INTO token_usage VALUES (?,?,?)');
    ins.run('t1', 'claude-haiku-5.5', 900);
    ins.run('t1', 'claude-sonnet-5', 40); // a utility call on another model
    ins.run('t2', 'claude-sonnet-5', 900); // the route answered with its own model
    assert.equal(servedAsAsked('rapid-proxy/claude-haiku-5.5', servedModels('t1', { db })), true);
    assert.equal(servedAsAsked('claude-haiku-5-5', servedModels('t1', { db })), true, 'one spelling across agents');
    assert.equal(servedAsAsked('claude-haiku-5.5', servedModels('t2', { db })), false);
    assert.equal(servedAsAsked('claude-haiku-5.5', servedModels('none', { db })), false, 'no rows is no evidence');
    assert.equal(modelKey('rapid-proxy/claude-opus-5'), 'claude-opus-5');
  });
});

describe('judging', () => {
  test('same core only when both readings agree; completeness follows the answer, not the slot', async () => {
    // A stub judge that sees through position: it scores "A-text" 4 and "B-text" 2 wherever they stand.
    const complete = async (messages) => {
      const u = messages[1].content;
      const first = u.indexOf('FIRST ANSWER:\nA-text') >= 0 ? 4 : 2;
      return JSON.stringify({ same_core: true, contradictions: [], completeness_first: first, completeness_second: 6 - first });
    };
    const j = await judgePair({ request: 'q', a: 'A-text', b: 'B-text', complete });
    assert.equal(j.sameCore, true);
    assert.equal(j.completenessA, 4);
    assert.equal(j.completenessB, 2);

    let n = 0;
    const flip = async () => JSON.stringify({ same_core: (n++ % 2) === 0, contradictions: ['x'], completeness_first: 3, completeness_second: 3 });
    const s = await judgePair({ request: 'q', a: 'a', b: 'b', complete: flip });
    assert.equal(s.sameCore, false);
    assert.equal(s.split, true);
    assert.deepEqual(s.contradictions, ['x']);
  });

  test('an unreadable judgment is no verdict, not a "different"', async () => {
    assert.equal(parseJudgment('no json here'), null);
    const j = await judgePair({ request: 'q', a: 'a', b: 'b', complete: async () => 'nope' });
    assert.equal(j.sameCore, null);
  });

  test('verdicts: collecting, pass, fail, and a floor too low to judge by', () => {
    const r = (cls, cand, same, floor) => ({ jobClass: cls, candidate: cand, incumbent: 'opus', trial: { sameCore: same, completenessA: 4, completenessB: 3 }, floor: { sameCore: floor } });
    const rows = [
      ...Array.from({ length: 5 }, () => r('status', 'haiku', true, true)),
      ...Array.from({ length: 20 }, (_, i) => r('explain', 'haiku', i < 19, true)),
      ...Array.from({ length: 20 }, (_, i) => r('explain', 'sonnet', i < 10, true)),
      ...Array.from({ length: 20 }, (_, i) => r('docs', 'haiku', true, i < 10)),
    ];
    const v = Object.fromEntries(verdicts(rows).map((x) => [`${x.jobClass}/${x.candidate}`, x]));
    assert.equal(v['status/haiku'].verdict, 'collecting');
    assert.equal(v['explain/haiku'].verdict, 'pass');
    assert.equal(v['explain/haiku'].sameRate, 0.95);
    assert.equal(v['explain/haiku'].completenessDelta, -1);
    assert.equal(v['explain/sonnet'].verdict, 'fail');
    assert.equal(v['docs/haiku'].verdict, 'floor-too-low');
  });
});
