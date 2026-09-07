/**
 * Routing attribution for calls that BYPASSED the proxy.
 *
 * THE BUG THESE PROTECT AGAINST
 * -----------------------------
 * The routing dashboard's "Recent decisions" table filters on `routing_source`
 * being non-empty — reasonably, since a row with no attribution has nothing to
 * show in a table of decisions. The token adapters, which reconstruct calls the
 * proxy never saw, wrote every routing column at its schema DEFAULT ''. So an
 * entire agent's foreground traffic (opencode on its native github-copilot
 * provider) was absent from the routing view while being plainly present in the
 * totals directly above it — 190 calls in one afternoon, with nothing on the
 * page to say they had been dropped.
 *
 * "It bypassed the proxy" is itself the decision worth recording, so it is now
 * recorded as `routing_source = 'direct'`. That does two jobs: it makes the rows
 * visible, and it stops rapid-llm-proxy/scripts/backfill-routing-decisions.mjs
 * (which selects `WHERE routing_source = ''`) from later re-stamping them
 * 'backfill' — i.e. from claiming a routing decision that never happened.
 *
 * WHY THE SCHEMA PROBE IS TESTED TOO
 * ----------------------------------
 * The routing columns belong to the proxy's migration, and this adapter is the
 * SECOND writer on someone else's schema. Naming a column that does not exist
 * would turn every adapter insert into a hard error and lose the token
 * accounting the adapter exists to provide — a far worse failure than an
 * unattributed row. Both shapes are therefore exercised here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const {
  openTokenDb,
  insertTokenRow,
  DIRECT_ROUTING_SOURCE,
  ADAPTER_USER_HASH_OPENCODE,
} = await import('../../lib/lsl/token/token-db.mjs');
const { buildOpencodeTokenRows, BYPASS_PROVIDERS } = await import(
  '../../lib/lsl/token/opencode-token-rows.mjs'
);

/** The proxy's CURRENT shape: base columns plus the routing-decision columns. */
const CREATE_WITH_ROUTING = `CREATE TABLE token_usage (
  id INTEGER NOT NULL, timestamp TEXT NOT NULL, provider TEXT NOT NULL,
  model TEXT NOT NULL, process TEXT NOT NULL, subscription TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
  prompt_preview TEXT NOT NULL, tokens_estimated INTEGER NOT NULL,
  user_hash TEXT NOT NULL, model_raw TEXT NOT NULL, overhead_ms INTEGER,
  agent TEXT NOT NULL DEFAULT '', task_id TEXT NOT NULL DEFAULT '',
  tool_call_id TEXT NOT NULL DEFAULT '', parent_call_id TEXT NOT NULL DEFAULT '',
  granularity_tier TEXT NOT NULL DEFAULT '', reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  route_key TEXT NOT NULL DEFAULT '', route_band TEXT NOT NULL DEFAULT '',
  route_step INTEGER NOT NULL DEFAULT 0, offloaded_from TEXT NOT NULL DEFAULT '',
  chain_position INTEGER NOT NULL DEFAULT 0, attempt_trail TEXT NOT NULL DEFAULT '',
  routing_source TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_hash, id)
);`;

/** The pre-migration shape, with no routing columns at all. */
const CREATE_WITHOUT_ROUTING = `CREATE TABLE token_usage (
  id INTEGER NOT NULL, timestamp TEXT NOT NULL, provider TEXT NOT NULL,
  model TEXT NOT NULL, process TEXT NOT NULL, subscription TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
  prompt_preview TEXT NOT NULL, tokens_estimated INTEGER NOT NULL,
  user_hash TEXT NOT NULL, model_raw TEXT NOT NULL, overhead_ms INTEGER,
  agent TEXT NOT NULL DEFAULT '', task_id TEXT NOT NULL DEFAULT '',
  tool_call_id TEXT NOT NULL DEFAULT '', parent_call_id TEXT NOT NULL DEFAULT '',
  granularity_tier TEXT NOT NULL DEFAULT '', reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, id)
);`;

let dirs = [];
function makeDb(ddl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-attr-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.exec(ddl);
  seed.close();
  return dbPath;
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const directRow = {
  timestamp: '2026-09-07T14:53:50.063Z',
  agent: 'opencode',
  provider: 'github-copilot',
  process: 'token-adapter-opencode',
  subscription: '',
  model: 'claude-opus-5',
  model_raw: 'claude-opus-5',
  input_tokens: 1249,
  output_tokens: 4323,
  total_tokens: 5572,
  latency_ms: 0,
  overhead_ms: null,
  prompt_preview: '',
  tokens_estimated: 0,
  cache_read_tokens: 83231,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  user_hash: ADAPTER_USER_HASH_OPENCODE,
  task_id: 'ses_x',
  tool_call_id: 'ses_x:msg_1',
  parent_call_id: '',
  granularity_tier: 'per-turn',
  route_key: 'fg-chat/opencode',
  route_band: '',
  route_step: 0,
  offloaded_from: '',
  chain_position: 0,
  attempt_trail: '',
  routing_source: DIRECT_ROUTING_SOURCE,
};

describe('token-db — routing attribution on adapter rows', () => {
  test("a bypassed call is stored as routing_source 'direct', not as nothing", () => {
    const db = openTokenDb(makeDb(CREATE_WITH_ROUTING));
    try {
      expect(insertTokenRow(db, directRow)).toBe(true);
      const got = db.prepare('SELECT * FROM token_usage').get();
      expect(got.routing_source).toBe('direct');
      expect(got.route_key).toBe('fg-chat/opencode');
      expect(got.provider).toBe('github-copilot');
    } finally {
      db.close();
    }
  });

  test("'direct' survives the dashboard filter that dropped these rows", () => {
    // The exact predicate token-usage-routing-tab.tsx applies to /recent, and
    // the exact predicate the behaviour endpoint applies server-side.
    const db = openTokenDb(makeDb(CREATE_WITH_ROUTING));
    try {
      insertTokenRow(db, directRow);
      const visible = db
        .prepare("SELECT COUNT(*) n FROM token_usage WHERE routing_source != ''")
        .get().n;
      expect(visible).toBe(1);
    } finally {
      db.close();
    }
  });

  test("'direct' is not '', so the proxy backfill will not restamp it 'backfill'", () => {
    // backfill-routing-decisions.mjs selects WHERE routing_source = '' and
    // stamps 'backfill' — a claim that the router made a decision. For a call
    // that never reached the router that claim is false.
    const db = openTokenDb(makeDb(CREATE_WITH_ROUTING));
    try {
      insertTokenRow(db, directRow);
      const backfillable = db
        .prepare("SELECT COUNT(*) n FROM token_usage WHERE routing_source = ''")
        .get().n;
      expect(backfillable).toBe(0);
    } finally {
      db.close();
    }
  });

  test('a database predating the routing columns still accepts the row', () => {
    // The adapter is the SECOND writer on the proxy's schema. Losing the whole
    // row because an attribution column is missing would be a much worse
    // outcome than losing the attribution.
    const db = openTokenDb(makeDb(CREATE_WITHOUT_ROUTING));
    try {
      expect(insertTokenRow(db, directRow)).toBe(true);
      const got = db.prepare('SELECT * FROM token_usage').get();
      expect(got.total_tokens).toBe(5572);
      expect(got).not.toHaveProperty('routing_source');
    } finally {
      db.close();
    }
  });

  test('a proxy row with no routing fields is unchanged — defaults, not nulls', () => {
    const db = openTokenDb(makeDb(CREATE_WITH_ROUTING));
    try {
      const { route_key, route_band, route_step, offloaded_from,
        chain_position, attempt_trail, routing_source, ...bare } = directRow;
      expect(insertTokenRow(db, bare)).toBe(true);
      const got = db.prepare('SELECT * FROM token_usage').get();
      expect(got.routing_source).toBe('');
      expect(got.route_step).toBe(0);
      expect(got.attempt_trail).toBe('');
    } finally {
      db.close();
    }
  });
});

describe('opencode adapter — what it claims about the calls it reconstructs', () => {
  /** A minimal opencode store: one bypass-provider assistant message. */
  function makeOpencodeDb(providerID) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-store-'));
    dirs.push(dir);
    const p = path.join(dir, 'opencode.db');
    const d = new Database(p);
    d.exec(`
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `);
    d.prepare('INSERT INTO message VALUES (?,?,?)').run('msg_1', 'ses_x', JSON.stringify({
      role: 'assistant',
      providerID,
      modelID: 'claude-opus-5',
      time: { created: Date.parse('2026-09-07T14:53:50.063Z') },
      tokens: { input: 1249, output: 4323, reasoning: 0, cache: { read: 83231, write: 0 } },
    }));
    d.close();
    return p;
  }

  test('reconstructed rows carry the direct attribution end to end', () => {
    const rows = buildOpencodeTokenRows(makeOpencodeDb('github-copilot'), {});
    expect(rows).toHaveLength(1);
    expect(rows[0].routing_source).toBe(DIRECT_ROUTING_SOURCE);
    expect(rows[0].route_key).toBe('fg-chat/opencode');
    // Band stays empty ON PURPOSE: fg-chat/opencode is `complexity: from-caller`
    // and a bypassed call declared no band to anyone. Deriving one from the
    // model would read as a routing decision that was never taken.
    expect(rows[0].route_band).toBe('');
    expect(rows[0].chain_position).toBe(0);
    expect(rows[0].attempt_trail).toBe('');
  });

  test('the no-double-count gate still holds — proxy-routed providers are skipped', () => {
    // The attribution must not become a reason to emit rows the proxy already
    // wrote. Only a provider PROVEN to bypass the proxy is reconstructed.
    expect(BYPASS_PROVIDERS.has('github-copilot')).toBe(true);
    expect(BYPASS_PROVIDERS.has('anthropic')).toBe(false);
    expect(buildOpencodeTokenRows(makeOpencodeDb('anthropic'), {})).toHaveLength(0);
  });
});
