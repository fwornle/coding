/**
 * token_usage.project — which repo each token was spent on (per-repo tenancy T4b).
 *
 * The proxy fills it from the launcher's x-project header / /p/<id> path; the
 * adapters, which reconstruct calls the proxy never saw, fill it from each
 * session's OWN record of where it ran (a Claude transcript line's cwd, a copilot
 * session.start gitRoot, an opencode message's path.root) mapped through
 * projectIdFor. Runs take the project that carried most of their tokens, and
 * obs-api exports a per-project summary into each repo's learning checkout.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const { openTokenDb, insertTokenRow, ADAPTER_USER_HASH_CLAUDE } = await import('../../lib/lsl/token/token-db.mjs');
const { buildClaudeTokenRows } = await import('../../lib/lsl/token/claude-token-rows.mjs');
const { buildCopilotTokenRows } = await import('../../lib/lsl/token/copilot-token-rows.mjs');
const { buildOpencodeTokenRows } = await import('../../lib/lsl/token/opencode-token-rows.mjs');
const { aggregateByTaskId } = await import('../../lib/experiments/token-aggregate.mjs');
const { summarizeProjects, writeProjectUsage, usageFileFor } = await import('../../lib/usage/project-usage.mjs');
const { buildAgentRoutingEnv } = await import('../../lib/experiments/agent-routing.mjs');

const SCHEMA = `CREATE TABLE token_usage (
  id INTEGER NOT NULL, timestamp TEXT NOT NULL, provider TEXT NOT NULL,
  model TEXT NOT NULL, process TEXT NOT NULL, subscription TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
  prompt_preview TEXT NOT NULL, tokens_estimated INTEGER NOT NULL,
  user_hash TEXT NOT NULL, model_raw TEXT NOT NULL, overhead_ms INTEGER,
  agent TEXT NOT NULL DEFAULT '', task_id TEXT NOT NULL DEFAULT '',
  tool_call_id TEXT NOT NULL DEFAULT '', parent_call_id TEXT NOT NULL DEFAULT '',
  granularity_tier TEXT NOT NULL DEFAULT '', reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  PROJECTCOL
  PRIMARY KEY (user_hash, id)
);`;

let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-tag-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A git repo (just a .git dir — enough for repoRootForPath) with a unique name. */
function makeRepo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  return fs.realpathSync(dir);
}
function makeDb(withProject = true) {
  const p = path.join(tmp, `db-${Math.random().toString(36).slice(2)}.db`);
  const d = new Database(p);
  d.exec(SCHEMA.replace('PROJECTCOL', withProject ? "project TEXT NOT NULL DEFAULT ''," : ''));
  d.close();
  return p;
}
const row = (extra) => ({
  timestamp: '2026-10-03T10:00:00.000Z', agent: 'claude', provider: 'claude-code',
  process: 'token-adapter-claude', subscription: '', model: 'm', model_raw: 'm',
  input_tokens: 10, output_tokens: 5, total_tokens: 15, latency_ms: 0, overhead_ms: null,
  prompt_preview: '', tokens_estimated: 0, reasoning_tokens: 0, cache_read_tokens: 0,
  cache_write_tokens: 0, user_hash: ADAPTER_USER_HASH_CLAUDE, task_id: '', parent_call_id: '',
  granularity_tier: 'per-turn', ...extra,
});

describe('token-db writes project', () => {
  test('a recorded project lands; a path or junk records ""', () => {
    const db = openTokenDb(makeDb());
    try {
      insertTokenRow(db, row({ tool_call_id: 'a', project: 'alpha' }));
      insertTokenRow(db, row({ tool_call_id: 'b', project: '/Users/x/alpha' }));
      insertTokenRow(db, row({ tool_call_id: 'c' }));
      const got = db.prepare('SELECT tool_call_id, project FROM token_usage ORDER BY tool_call_id').all();
      expect(got.map((r) => r.project)).toEqual(['alpha', '', '']);
    } finally { db.close(); }
  });

  test('a proxy DB predating the column still takes the row', () => {
    const db = openTokenDb(makeDb(false));
    try {
      expect(insertTokenRow(db, row({ tool_call_id: 'a', project: 'alpha' }))).toBe(true);
      expect(db.prepare('SELECT COUNT(*) n FROM token_usage').get().n).toBe(1);
    } finally { db.close(); }
  });
});

describe('builders take the project from the session’s own cwd', () => {
  test('claude: each transcript line’s cwd, from a subdirectory too', () => {
    const repo = makeRepo('claude-proj-x1');
    const f = path.join(tmp, 'claude.jsonl');
    fs.writeFileSync(f, [
      { type: 'user', cwd: path.join(repo, 'src', 'deep'), message: { role: 'user', content: 'hi' } },
      {
        type: 'assistant', cwd: path.join(repo, 'src', 'deep'), requestId: 'req_1', uuid: 'u1',
        timestamp: '2026-10-03T10:00:00.000Z',
        message: { model: 'claude-test', usage: { input_tokens: 3, output_tokens: 4 }, content: [] },
      },
    ].map((r) => JSON.stringify(r)).join('\n'));
    const rows = buildClaudeTokenRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe('claude-proj-x1');
    // A caller that knows better wins.
    expect(buildClaudeTokenRows(f, { project: 'override' })[0].project).toBe('override');
  });

  test('copilot: session.start context.gitRoot', () => {
    const repo = makeRepo('copilot-proj-x1');
    const dir = path.join(tmp, 'copilot-sess');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'events.jsonl');
    fs.writeFileSync(f, [
      { type: 'session.start', data: { sessionId: 's1', context: { cwd: path.join(repo, 'src'), gitRoot: repo } } },
      { type: 'session.shutdown', timestamp: '2026-10-03T10:00:00.000Z',
        data: { modelMetrics: { 'gpt-x': { usage: { inputTokens: 7, outputTokens: 2 } } } } },
    ].map((r) => JSON.stringify(r)).join('\n'));
    const rows = buildCopilotTokenRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe('copilot-proj-x1');
  });

  test('opencode: the message’s path.root', () => {
    const repo = makeRepo('opencode-proj-x1');
    const p = path.join(tmp, 'opencode.db');
    const d = new Database(p);
    d.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
            CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);`);
    d.prepare('INSERT INTO message VALUES (?,?,?)').run('msg_1', 'ses_x', JSON.stringify({
      role: 'assistant', providerID: 'github-copilot', modelID: 'claude-opus-5',
      time: { created: Date.parse('2026-10-03T10:00:00.000Z') },
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      path: { cwd: path.join(repo, 'src'), root: repo },
    }));
    d.close();
    const rows = buildOpencodeTokenRows(p, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe('opencode-proj-x1');
  });

  test('a cwd outside any repo records ""', () => {
    const f = path.join(tmp, 'claude-norepo.jsonl');
    fs.writeFileSync(f, JSON.stringify({
      type: 'assistant', cwd: '/', requestId: 'r', uuid: 'u', timestamp: '2026-10-03T10:00:00.000Z',
      message: { model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, content: [] },
    }));
    expect(buildClaudeTokenRows(f)[0].project).toBe('');
  });
});

describe('Runs take the project that carried most of their tokens', () => {
  test('dominant by tokens, empty rows ignored, null when none recorded', () => {
    const dbPath = makeDb();
    const db = openTokenDb(dbPath);
    insertTokenRow(db, row({ tool_call_id: '1', task_id: 'T', project: 'alpha', total_tokens: 10 }));
    insertTokenRow(db, row({ tool_call_id: '2', task_id: 'T', project: 'beta', total_tokens: 500 }));
    insertTokenRow(db, row({ tool_call_id: '3', task_id: 'T', project: '', total_tokens: 9000 }));
    insertTokenRow(db, row({ tool_call_id: '4', task_id: 'U', project: '' }));
    db.close();
    expect(aggregateByTaskId('T', dbPath).project).toBe('beta');
    expect(aggregateByTaskId('U', dbPath).project).toBe(null);
  });
});

describe('per-repo usage export', () => {
  const ME = 'abc123';
  function seeded() {
    const dbPath = makeDb();
    const db = openTokenDb(dbPath);
    insertTokenRow(db, row({ tool_call_id: '1', project: 'alpha', task_id: 'T1', timestamp: '2026-10-02T09:00:00.000Z' }));
    insertTokenRow(db, row({ tool_call_id: '2', project: 'alpha', timestamp: '2026-10-02T11:00:00.000Z' }));
    insertTokenRow(db, row({ tool_call_id: '3', project: 'beta', timestamp: '2026-10-03T09:00:00.000Z' }));
    // A teammate's row hydrated from their export: theirs to summarise, not ours.
    insertTokenRow(db, row({ tool_call_id: '4', project: 'alpha', user_hash: 'zzz999' }));
    insertTokenRow(db, row({ tool_call_id: '5', project: '' }));
    db.close();
    return dbPath;
  }

  test('summarises this machine’s rows per project, day and task', () => {
    const db = new Database(seeded(), { readonly: true });
    try {
      const s = summarizeProjects(db, { userHash: ME, sinceIso: '2026-01-01' });
      expect([...s.keys()].sort()).toEqual(['alpha', 'beta']);
      const a = s.get('alpha');
      expect(a.daily).toHaveLength(1);
      expect(a.daily[0]).toMatchObject({ date: '2026-10-02', calls: 2, total_tokens: 30 });
      expect(a.tasks).toHaveLength(1);
      expect(a.tasks[0]).toMatchObject({ task_id: 'T1', calls: 1 });
    } finally { db.close(); }
  });

  test('writes into a linked repo’s .coding/kb/usage, elsewhere into the data home; unchanged is not rewritten', () => {
    const repo = makeRepo('usage-linked');
    const dirs = new Map([['alpha', { kbDir: path.join(repo, '.coding', 'kb'), repo, kind: 'linked' }]]);
    const home = path.join(tmp, 'datahome');
    const opts = { dbPath: seeded(), userHash: ME, dirs, dataHomeOpts: { env: { CODING_DATA_HOME: home } },
      now: new Date('2026-10-03T12:00:00Z') };

    const r1 = writeProjectUsage(opts);
    expect(r1.written.map((w) => w.project)).toEqual(['alpha', 'beta']);
    const alphaFile = path.join(repo, '.coding', 'kb', 'usage', `${ME}.json`);
    expect(r1.written[0].file).toBe(alphaFile);
    expect(r1.written[1].file).toBe(usageFileFor('beta', ME, { dirs, dataHomeOpts: opts.dataHomeOpts }));
    expect(r1.written[1].file.startsWith(home)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(alphaFile, 'utf8'));
    expect(doc).toMatchObject({ project: 'alpha', user_hash: ME });

    const r2 = writeProjectUsage(opts);
    expect(r2.written).toEqual([]);
    expect(r2.unchanged.sort()).toEqual(['alpha', 'beta']);
  });

  test('a shared clone (a teammate’s repo) is never written', () => {
    const repo = makeRepo('usage-shared');
    const dirs = new Map([['alpha', { kbDir: path.join(repo, 'kb'), repo, kind: 'shared' }]]);
    const home = path.join(tmp, 'datahome2');
    const r = writeProjectUsage({ dbPath: seeded(), userHash: ME, dirs,
      dataHomeOpts: { env: { CODING_DATA_HOME: home } }, now: new Date('2026-10-03T12:00:00Z') });
    expect(fs.existsSync(path.join(repo, 'kb', 'usage'))).toBe(false);
    expect(r.written.find((w) => w.project === 'alpha').file.startsWith(home)).toBe(true);
  });
});

describe('experiment cells send the project like the launcher does', () => {
  const env = { CODING_PROJECT_ID: 'alpha' };
  test('claude: x-project header next to x-task-id', () => {
    expect(buildAgentRoutingEnv('claude', env, { taskId: 't1' }).ANTHROPIC_CUSTOM_HEADERS)
      .toBe('x-task-id: t1\nx-project: alpha');
  });
  test('copilot: /p/<id> before /t/<task>', () => {
    expect(buildAgentRoutingEnv('copilot', env, { taskId: 't1' }).COPILOT_PROVIDER_BASE_URL)
      .toMatch(/\/v1\/copilot\/p\/alpha\/t\/t1$/);
  });
  test('opencode: x-project on every spliced provider', () => {
    const cfg = JSON.parse(buildAgentRoutingEnv('opencode', env, { taskId: 't1' }).OPENCODE_CONFIG_CONTENT);
    for (const p of Object.values(cfg.provider)) expect(p.options.headers['x-project']).toBe('alpha');
  });
  test('an unusable id is dropped, not sent', () => {
    const out = buildAgentRoutingEnv('claude', { CODING_PROJECT_ID: '../x' }, { taskId: 't1' });
    expect(out.ANTHROPIC_CUSTOM_HEADERS).toBe('x-task-id: t1');
  });
});
