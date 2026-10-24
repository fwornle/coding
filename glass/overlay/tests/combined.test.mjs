// tests/combined.test.mjs — glass's usage views with coding's figures added:
// finding coding's token DB, the read-only union, and coding's copies of glass
// sessions counted once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { initTokenDb, resolveTokenDbPath, getSummary, getRecent } = await import('../proxy/dist/token-usage.js');
const { codingTokenDb, openCombined, createUsageSource } = await import('../lib/glass/combined.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glass-combined-'));
const now = Date.now();
const at = (minAgo) => new Date(now - minAgo * 60_000).toISOString();

function seed(dir, rows) {
  const h = initTokenDb(dir);
  const ins = h.db.prepare(`INSERT INTO token_usage (id, timestamp, provider, model, process, input_tokens, output_tokens, total_tokens, user_hash, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  rows.forEach((r, i) => ins.run(i + 1, r.at, r.provider, 'm', r.process ?? 'p', r.input, 0, r.input, 'cladpt', r.task ?? ''));
  h.db.close();
  return resolveTokenDbPath(dir);
}

function pair() {
  const glass = seed(tmp(), [
    { at: at(5), provider: 'claude-code-max', input: 100, task: 'glass-claude-1' },
    { at: at(4), provider: 'gh-copilot', input: 10, task: 'glass-copilot-2' },
    // An unbound call: its empty task id must not match coding's untagged rows.
    { at: at(4), provider: 'gh-copilot', input: 1 },
  ]);
  const coding = seed(tmp(), [
    // glass forwarded this one through coding's proxy: the same call, recorded twice.
    { at: at(5), provider: 'claude-code-max', input: 100, task: 'glass-claude-1' },
    // coding's own work, and a glass session from before this glass home existed.
    { at: at(3), provider: 'gh-copilot', input: 1000, process: 'bg-ukb' },
    { at: at(2), provider: 'claude-code-max', input: 7, task: 'coding-session-9' },
    { at: at(1), provider: 'anthropic-api', input: 50, task: 'glass-opencode-old' },
  ]);
  return { glass, coding };
}

test('the union: glass rows plus coding\'s, with coding\'s copy of a glass session dropped', () => {
  const { glass, coding } = pair();
  const h = openCombined(glass, coding);
  const s = getSummary(h, { hours: 1 });
  assert.equal(s.total_calls, 6, '3 glass + 3 coding-only; the shared call once');
  assert.equal(s.total_input, 100 + 10 + 1 + 1000 + 7 + 50);
  assert.deepEqual(getRecent(h, { limit: 10 }).data.map((r) => r.task_id).filter((t) => t === 'glass-claude-1'), ['glass-claude-1']);
  // The account selection filters the union like any other read.
  assert.equal(getSummary(h, { hours: 1, exclude: ['gh-copilot'] }).total_calls, 3);
  h.db.close();
});

test('read-only: nothing can be written to either file through the combined handle', () => {
  const { glass, coding } = pair();
  const h = openCombined(glass, coding);
  assert.throws(() => h.db.exec(`INSERT INTO coding.token_usage (id, timestamp, provider, model) VALUES (99, 'x', 'y', 'z')`), /readonly/i);
  assert.throws(() => h.db.exec(`INSERT INTO main.token_usage (id, timestamp, provider, model) VALUES (99, 'x', 'y', 'z')`), /readonly/i);
  h.db.close();
});

test('finding coding\'s DB: an explicit path, else the most recently written scope — never CODING_DATA_HOME (glass\'s own in the daemon)', () => {
  const home = tmp();
  assert.equal(codingTokenDb({}, home), null, 'no coding here');
  const mk = (scope) => {
    const f = path.join(home, '.coding', 'data', scope, 'var', 'llm-proxy', 'token-usage.db');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '');
    return f;
  };
  const a = mk('coding');
  const b = mk('other');
  fs.utimesSync(a, new Date(now - 60_000), new Date(now - 60_000));
  assert.equal(codingTokenDb({}, home), b);
  fs.writeFileSync(`${a}-wal`, 'x'); // a live proxy writes the WAL, not the DB file
  assert.equal(codingTokenDb({}, home), a);
  assert.equal(codingTokenDb({ CODING_DATA_HOME: path.join(home, '.coding', 'data', 'other') }, home), a);
  assert.equal(codingTokenDb({ GLASS_CODING_TOKEN_DB: path.join(home, 'nope.db') }, home), null);
  assert.equal(codingTokenDb({ GLASS_CODING_TOKEN_DB: b }, home), b);
});

test('the usage source: combined while wanted and present, glass\'s own otherwise or when coding\'s is unreadable', () => {
  const { glass, coding } = pair();
  const own = initTokenDb(path.dirname(path.dirname(glass)));
  let wanted = true;
  let where = coding;
  const src = createUsageSource({ own: () => own, glassDbPath: glass, wanted: () => wanted, locate: () => where, recheckMs: 0 });
  assert.equal(getSummary(src.handle(), { hours: 1 }).total_calls, 6);
  assert.deepEqual(src.state(), { found: true, included: true, path: coding });
  wanted = false;
  assert.equal(src.handle(), own);
  assert.equal(src.state().included, false);
  wanted = true;
  where = null;
  assert.equal(src.handle(), own, 'coding removed');
  where = glass;
  assert.equal(src.handle(), own, 'glass\'s own DB is never added to itself');
  const broken = path.join(tmp(), 'broken.db');
  fs.writeFileSync(broken, 'not a database');
  where = broken;
  const logs = [];
  const loud = createUsageSource({ own: () => own, glassDbPath: glass, wanted: () => true, locate: () => where, recheckMs: 0, log: (l) => logs.push(l) });
  assert.equal(loud.handle(), own);
  assert.equal(loud.handle(), own);
  assert.equal(logs.length, 1, 'said once');
  src.close(); loud.close(); own.db.close();
});
