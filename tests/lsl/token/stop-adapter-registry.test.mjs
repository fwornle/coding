/**
 * Phase 75 Plan 01 (Wave 0) — RED unit test for the per-agent stop-adapter
 * registry (ATTR-03 / D-04).
 *
 * This is the acceptance shape Plan 03 must satisfy. It is RED today because
 * `lib/lsl/token/stop-adapter-registry.mjs` does NOT exist yet — the static
 * `import { STOP_ADAPTERS, captureForegroundTokens }` resolves nothing and
 * `node --test` reports `Cannot find module`.
 *
 * What it locks:
 *   - STOP_ADAPTERS.claude.mode === 'transcript' with userHash 'cladpt' and a
 *     real `build` function (Claude bypasses the proxy → must build main-session
 *     rows and insert them as cladpt).
 *   - STOP_ADAPTERS.copilot / opencode / mastra each mode === 'stamp-only' with
 *     NO `build` function — these are already in token_usage via the proxy, so a
 *     transcript adapter would DOUBLE-COUNT (the D-04 anti-pattern guard).
 *   - captureForegroundTokens, given a span + the fixture main-session path,
 *     inserts cladpt rows stamped with the active task_id, and inserts NOTHING
 *     for a stamp-only agent.
 *
 * A separate scratch assertion proves the owned main-session fixture parses
 * through the EXISTING buildClaudeTokenRows extractor (a non-subagent path →
 * per-turn + per-reasoning-step rows with task_id:'') so the fixture is valid
 * input before Plan 03 wires the registry around it.
 *
 * Live paths (if any) gate on EXPERIMENTS_LIVE, NEVER a `--live` argv (MEMORY.md
 * reference_node_test_argv_live_gate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// EXISTING extractor — proves the fixture is valid input (not RED).
import { buildClaudeTokenRows } from '../../../lib/lsl/token/claude-token-rows.mjs';
// NEW contract — RED today (module does not exist until Plan 03).
import {
  STOP_ADAPTERS,
  captureForegroundTokens,
  SUBAGENT_PROCESS,
} from '../../../lib/lsl/token/stop-adapter-registry.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN_SESSION_FIXTURE = path.join(__dirname, '_fixtures', 'main-session.jsonl');

/**
 * A token_usage table matching the proxy-owned schema's adapter-insert columns
 * (token-db.mjs INSERT_SQL order). captureForegroundTokens inserts through
 * openTokenDb + insertTokenRowDeduped, so the temp DB must accept those rows.
 */
function createTokenUsageTable(db) {
  db.exec(`CREATE TABLE token_usage (
    id               INTEGER NOT NULL,
    timestamp        TEXT    NOT NULL DEFAULT '',
    provider         TEXT    NOT NULL DEFAULT '',
    model            TEXT    NOT NULL DEFAULT '',
    process          TEXT    NOT NULL DEFAULT '',
    subscription     TEXT    NOT NULL DEFAULT '',
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    total_tokens     INTEGER NOT NULL DEFAULT 0,
    latency_ms       INTEGER NOT NULL DEFAULT 0,
    prompt_preview   TEXT    NOT NULL DEFAULT '',
    tokens_estimated INTEGER NOT NULL DEFAULT 0,
    user_hash        TEXT    NOT NULL DEFAULT '',
    model_raw        TEXT    NOT NULL DEFAULT '',
    overhead_ms      INTEGER,
    agent            TEXT    NOT NULL DEFAULT '',
    task_id          TEXT    NOT NULL DEFAULT '',
    tool_call_id     TEXT    NOT NULL DEFAULT '',
    parent_call_id   TEXT    NOT NULL DEFAULT '',
    granularity_tier TEXT    NOT NULL DEFAULT '',
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_hash, id)
  );`);
}

function newTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-adapter-registry-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const db = new Database(dbPath);
  createTokenUsageTable(db);
  db.close();
  return { dir, dbPath };
}

test('scratch: owned main-session fixture parses through buildClaudeTokenRows (per-turn + per-reasoning-step)', () => {
  const rows = buildClaudeTokenRows(MAIN_SESSION_FIXTURE);
  assert.ok(rows.length >= 2, 'at least one per-turn and one per-reasoning-step row');
  const turns = rows.filter((r) => r.granularity_tier === 'per-turn');
  const reasoning = rows.filter((r) => r.granularity_tier === 'per-reasoning-step');
  assert.ok(turns.length >= 1, 'at least one per-turn row from the usage block');
  assert.ok(reasoning.length >= 1, 'at least one per-reasoning-step row from the thinking block');
  // Non-subagent path → parent_call_id stays '' (main-session, not a sidechain).
  assert.ok(rows.every((r) => r.parent_call_id === ''), 'main-session path → empty parent_call_id');
  // Extractor leaves task_id unstamped — the caller (Plan 03) stamps it.
  assert.ok(rows.every((r) => r.task_id === ''), 'extractor leaves task_id:"" for the caller to stamp');
});

test('STOP_ADAPTERS.claude is a transcript adapter (cladpt + build) ', () => {
  assert.ok(STOP_ADAPTERS && STOP_ADAPTERS.claude, 'claude adapter present');
  assert.equal(STOP_ADAPTERS.claude.mode, 'transcript', 'claude bypasses the proxy → transcript mode');
  assert.equal(STOP_ADAPTERS.claude.userHash, 'cladpt', 'claude rows are inserted as cladpt');
  assert.equal(typeof STOP_ADAPTERS.claude.build, 'function', 'claude adapter carries a build function');
});

test('STOP_ADAPTERS copilot/opencode/mastra are stamp-only with NO build (double-count guard)', () => {
  for (const agent of ['copilot', 'opencode', 'mastra']) {
    assert.ok(STOP_ADAPTERS[agent], `${agent} adapter present`);
    assert.equal(STOP_ADAPTERS[agent].mode, 'stamp-only', `${agent} is proxy-routed → stamp-only`);
    assert.equal(
      typeof STOP_ADAPTERS[agent].build,
      'undefined',
      `${agent} must NOT carry a transcript build (would double-count proxy rows)`,
    );
  }
});

test('captureForegroundTokens(claude): inserts cladpt rows stamped with the active task_id', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    const span = {
      task_id: 'm-stop-1',
      agent: 'claude',
      started_at: '2026-06-29T05:29:00.000Z',
      ended_at: '2026-06-29T05:35:00.000Z',
    };
    await captureForegroundTokens(span, {
      dbPath,
      mainSessionPath: MAIN_SESSION_FIXTURE,
      resolveTaskId: async () => 'm-stop-1',
    });

    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare('SELECT user_hash, task_id, granularity_tier FROM token_usage')
        .all();
      assert.ok(rows.length >= 2, 'cladpt rows inserted from the main-session transcript');
      assert.ok(rows.every((r) => r.user_hash === 'cladpt'), 'all inserted rows are cladpt');
      assert.ok(rows.every((r) => r.task_id === 'm-stop-1'), 'every row stamped with the active task_id');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('captureForegroundTokens(claude): ATTR-04 captures sub-agents with the SUBAGENT_PROCESS marker, main stays token-adapter-claude', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // A minimal sub-agent transcript with a DISTINCT model + requestId so its rows
    // neither collide (dedup key) nor merge with the main-session opus rows.
    const subFixture = path.join(dir, 'agent-sub.jsonl');
    fs.writeFileSync(
      subFixture,
      JSON.stringify({
        type: 'assistant',
        requestId: 'req-sub-0001',
        uuid: 'aaaa0001',
        timestamp: '2026-06-29T05:31:00.000Z',
        message: { model: 'claude-haiku-4-5', usage: { input_tokens: 400, output_tokens: 120 }, content: [] },
      }) + '\n',
    );

    const span = {
      task_id: 'm-stop-sub',
      agent: 'claude',
      started_at: '2026-06-29T05:29:00.000Z',
      ended_at: '2026-06-29T05:35:00.000Z',
    };
    const inserted = await captureForegroundTokens(span, {
      dbPath,
      mainSessionPath: MAIN_SESSION_FIXTURE,
      subagentPaths: [subFixture], // inject the located sub-agent list
      resolveTaskId: async () => 'm-stop-sub',
    });
    assert.ok(inserted >= 2, 'inserted main + sub-agent rows');

    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare('SELECT user_hash, task_id, process, model FROM token_usage')
        .all();
      // Every captured row is foreground (cladpt) + task-stamped.
      assert.ok(rows.every((r) => r.user_hash === 'cladpt'), 'all rows cladpt');
      assert.ok(rows.every((r) => r.task_id === 'm-stop-sub'), 'all rows task-stamped');

      // The sub-agent (haiku) rows carry the SUBAGENT_PROCESS marker; the main
      // (opus) rows keep the plain adapter process — so canonical selection in
      // measurement-stop can exclude the sub-agent from chat-model attribution.
      const sub = rows.filter((r) => r.process === SUBAGENT_PROCESS);
      const main = rows.filter((r) => r.process !== SUBAGENT_PROCESS);
      assert.ok(sub.length >= 1, 'at least one sub-agent row captured');
      assert.ok(sub.every((r) => r.model === 'claude-haiku-4-5'), 'sub-agent rows are the haiku model');
      assert.ok(main.length >= 1, 'main-session rows still captured');
      assert.ok(main.every((r) => r.model === 'claude-opus-4-8'), 'main rows are the opus model');
      assert.ok(main.every((r) => r.process === 'token-adapter-claude'), 'main rows keep the plain adapter process');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('captureForegroundTokens(opencode): stamp-only inserts NOTHING (no transcript build)', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    const span = {
      task_id: 'm-stop-2',
      agent: 'opencode',
      started_at: '2026-06-29T05:29:00.000Z',
      ended_at: '2026-06-29T05:35:00.000Z',
    };
    await captureForegroundTokens(span, {
      dbPath,
      mainSessionPath: MAIN_SESSION_FIXTURE,
      resolveTaskId: async () => 'm-stop-2',
    });

    const db = new Database(dbPath, { readonly: true });
    try {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM token_usage').get();
      assert.equal(n, 0, 'a stamp-only agent must not build/insert transcript rows (no double-count)');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
