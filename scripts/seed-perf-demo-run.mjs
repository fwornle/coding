// scripts/seed-perf-demo-run.mjs
//
// Seeds ONE fully-scored, multi-turn demo Run so the Phase 74 Performance tab's
// score-override drawer and collapsible timeline can be exercised end-to-end in
// the live dashboard. Writes:
//   - experiment store (LevelDB): a Run + Outcome + a fully-judged 5-dim Score
//     (via the sanctioned writeRun/writeScore APIs, openExperimentStore →
//     ontologyDir-aware).
//   - token-usage.db (SQLite): two per-turn parent rows, each with
//     per-reasoning-step children (tool_call_id `${turn}:reason:N`) so the
//     timeline renders expandable sub-bands with real granularity_tier badges.
//
// The token rows use a dedicated user_hash ('seed-demo') so they never collide
// with the proxy's real (user_hash, id) primary key, and so `--remove` can delete
// exactly this seed and nothing else.
//
// Usage:
//   node scripts/seed-perf-demo-run.mjs            # seed
//   node scripts/seed-perf-demo-run.mjs --remove   # remove the seed
//
// NOTE: token-usage.db is normally proxy-owned (read-only from app code). This is
// a deliberate, clearly-scoped TEST FIXTURE writer keyed on a synthetic
// user_hash/task_id; it is not part of the app runtime path.
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { writeRun } from '../lib/experiments/run-write.mjs';
import { writeScore } from '../lib/experiments/score-write.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_DB = path.join(REPO_ROOT, '.data', 'llm-proxy', 'token-usage.db');

const TASK_ID = 'seed-multiturn-demo';
const SEED_USER_HASH = 'seed-demo';
const MODEL = 'claude-sonnet-4-6';
const NOW = new Date();
const iso = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

const remove = process.argv.includes('--remove');

// Two per-turn parents, each with per-reasoning-step children. total_tokens on a
// parent is the turn total; children carry reasoning_tokens. tool_call_id of a
// child is `${parent}:reason:${N}` so timeline-read nests it under the parent.
const TURNS = [
  {
    tool_call_id: 'seed-turn-1', input: 1200, output: 300, total: 1500,
    children: [
      { n: 1, reasoning: 200, total: 200, estimated: 1 },
      { n: 2, reasoning: 150, total: 150, estimated: 0 },
    ],
  },
  {
    tool_call_id: 'seed-turn-2', input: 800, output: 250, total: 1050,
    children: [
      { n: 1, reasoning: 120, total: 120, estimated: 0 },
    ],
  },
];
const TOTAL_TOKENS = TURNS.reduce((s, t) => s + t.total, 0); // 2550
const REASONING_TOKENS = TURNS.flatMap((t) => t.children).reduce((s, c) => s + c.reasoning, 0); // 470

async function seedExperimentStore() {
  const store = await openExperimentStore();
  try {
    if (remove) {
      // Delete Score, Outcome, Run carrying this task_id.
      for (const entityType of ['Score', 'Outcome', 'Run']) {
        const ids = [];
        for await (const e of store.iterate({ entityType })) {
          const key = entityType === 'Run' ? e.metadata?.task_id : e.metadata?.run_task_id;
          if (key === TASK_ID) ids.push(e.id);
        }
        for (const id of ids) await store.deleteEntity(id);
      }
      process.stderr.write(`[seed] removed experiment-store entities for ${TASK_ID}\n`);
      return;
    }

    await writeRun(store, {
      span: {
        task_id: TASK_ID,
        started_at: iso(-120000),
        ended_at: iso(0),
        goal_sentence: 'Demo: add a feature across two turns to exercise the Performance tab.',
      },
      taskClass: 'new-feature',
      pending: false,
      tags: {
        task_hash: 'seed-demo-hash',
        agent: 'claude',
        model: MODEL,
        framework: 'claude-code',
        trace_id: TASK_ID,
      },
      totals: { input_tokens: 2000, output_tokens: 550, total_tokens: TOTAL_TOKENS, reasoning_tokens: REASONING_TOKENS },
      heuristics: {
        loop_count: 0,
        edit_revert_count: 1,
        redundant_read_count: 0,
        abandoned_tool_count: 0,
        total_step_count: 7,
        wallclock_per_step: 17.1,
      },
    });

    await writeScore(store, {
      span: { task_id: TASK_ID },
      judgment: {
        goal_aligned_ratio: 0.85,
        event_labels: [
          { seq: 1, label: 'toward' },
          { seq: 2, label: 'neutral' },
          { seq: 3, label: 'toward' },
        ],
        ratio_rationale: 'Most steps moved toward the stated goal; one neutral exploration step.',
        rubric: {
          goal_achieved: 1,
          code_quality: 0.8,
          test_coverage: 0.6,
          regressions: 0,
          spec_drift: 0.1,
        },
        rubric_rationale: 'Goal met; solid quality; coverage partial; no regressions; minor spec drift.',
        pending: false,
        not_scored: null,
      },
    });
    process.stderr.write(`[seed] wrote Run + Outcome + Score for ${TASK_ID}\n`);
  } finally {
    await store.close?.();
  }
}

function seedTokenDb() {
  const db = new Database(TOKEN_DB);
  db.pragma('busy_timeout = 5000');
  try {
    if (remove) {
      const info = db.prepare('DELETE FROM token_usage WHERE task_id = ?').run(TASK_ID);
      process.stderr.write(`[seed] removed ${info.changes} token-usage rows for ${TASK_ID}\n`);
      return;
    }

    // Build the row set: per-turn parents + per-reasoning-step children.
    const rows = [];
    let ts = 0;
    for (const turn of TURNS) {
      rows.push({
        timestamp: iso(ts), tool_call_id: turn.tool_call_id, parent_call_id: '',
        granularity_tier: 'per-turn', input_tokens: turn.input, output_tokens: turn.output,
        total_tokens: turn.total, reasoning_tokens: 0, tokens_estimated: 0,
      });
      ts += 1000;
      for (const c of turn.children) {
        rows.push({
          timestamp: iso(ts), tool_call_id: `${turn.tool_call_id}:reason:${c.n}`,
          parent_call_id: turn.tool_call_id, granularity_tier: 'per-reasoning-step',
          input_tokens: 0, output_tokens: 0, total_tokens: c.total,
          reasoning_tokens: c.reasoning, tokens_estimated: c.estimated,
        });
        ts += 500;
      }
    }

    // Composite PK is (user_hash, id); id is not autoincrement, so allocate ids
    // within our dedicated user_hash namespace.
    const maxRow = db.prepare('SELECT MAX(id) m FROM token_usage WHERE user_hash = ?').get(SEED_USER_HASH);
    let nextId = (maxRow?.m ?? 0) + 1;

    const insert = db.prepare(`
      INSERT INTO token_usage
        (id, timestamp, provider, model, process, subscription, input_tokens,
         output_tokens, total_tokens, latency_ms, prompt_preview, tokens_estimated,
         user_hash, model_raw, overhead_ms, agent, task_id, tool_call_id,
         parent_call_id, granularity_tier, reasoning_tokens)
      VALUES
        (@id, @timestamp, @provider, @model, @process, @subscription, @input_tokens,
         @output_tokens, @total_tokens, @latency_ms, @prompt_preview, @tokens_estimated,
         @user_hash, @model_raw, @overhead_ms, @agent, @task_id, @tool_call_id,
         @parent_call_id, @granularity_tier, @reasoning_tokens)
    `);
    const tx = db.transaction((items) => {
      for (const r of items) {
        insert.run({
          id: nextId++, timestamp: r.timestamp, provider: 'anthropic', model: MODEL,
          process: 'seed-demo', subscription: 'demo', input_tokens: r.input_tokens,
          output_tokens: r.output_tokens, total_tokens: r.total_tokens, latency_ms: 1200,
          prompt_preview: '', tokens_estimated: r.tokens_estimated, user_hash: SEED_USER_HASH,
          model_raw: MODEL, overhead_ms: 0, agent: 'claude', task_id: TASK_ID,
          tool_call_id: r.tool_call_id, parent_call_id: r.parent_call_id,
          granularity_tier: r.granularity_tier, reasoning_tokens: r.reasoning_tokens,
        });
      }
    });
    tx(rows);
    process.stderr.write(`[seed] wrote ${rows.length} token-usage rows for ${TASK_ID}\n`);
  } finally {
    db.close();
  }
}

await seedExperimentStore();
seedTokenDb();
process.stderr.write(remove ? '[seed] removal complete\n' : '[seed] seed complete\n');
