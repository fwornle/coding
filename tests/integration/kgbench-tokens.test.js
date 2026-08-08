/**
 * Cross-agent token attribution.
 *
 * The nulls this replaces were correct and useless. copilot and opencode have no stream-json
 * equivalent, so the runner recorded `null` rather than a lying `0` — and a benchmark whose
 * token column is empty for two of three agents cannot compare cost across agents at all.
 *
 * The tokens were in the proxy DB the whole time, under the agent's OWN session identity
 * (`ses_01f58a8b…`, a copilot UUID) written by its stop-adapter. These tests pin the three
 * things that make recovering them safe rather than merely convenient:
 *
 *   - a first-party number is NEVER replaced by a reconstructed one
 *   - "no rows" resolves to null, never to 0
 *   - a window join that caught more than one session of the agent says so, because it is a
 *     time join and its whole validity rests on nothing else of that agent running
 */

import { cellTaskId, bindCellEnv, resolveCellTokens, DEFAULT_WIRE_BIND } from '../../lib/kgbench/tokens.mjs';

const EMPTY = { totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0, calls: 0 }, sessions: [], byAgentModel: [] };
const rows = (o) => ({
  totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, calls: 1, ...o },
  sessions: o.sessions ?? [],
  byAgentModel: [],
});
// No settle delay in tests: the polling exists for adapter write lag, not for logic.
const NOW = { attempts: 1, settleMs: 0 };

describe('the composite task_id', () => {
  it('puts agent and model in the second segment, where the proxy looks for them', () => {
    // proxy-bridge/server.mjs runIdentityFromTaskId splits on '--' and reads segment 1 to
    // decide whether an incoming request plausibly belongs to this run. An id shaped any
    // other way silently opts out of that protection.
    const id = cellTaskId({ runId: 'kgb1', agent: 'opencode', model: 'rapid-proxy/claude-sonnet-4.6', arm: 'grep', question: 'L1', rep: 2 });
    const variant = id.split('--')[1];
    expect(variant).toMatch(/^opencode/);
    expect(variant).toMatch(/sonnet/);
    expect(id).toMatch(/grep-L1-r2$/);
  });

  it('emits only characters the proxy will accept', () => {
    // sanitizeTaskId allows [A-Za-z0-9._-] and THROWS otherwise; a rejected id makes every
    // row for the cell unattributable, which is invisible until the report is empty.
    const id = cellTaskId({ runId: 'run/1 x', agent: 'opencode', model: 'rapid-proxy/claude-sonnet-4.6', arm: 'a b', question: 'Q#1', rep: 1 });
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('truncates the tail, never the run/agent/model head', () => {
    const id = cellTaskId({ runId: 'r'.repeat(60), agent: 'claude', model: 'claude-sonnet-4-6', arm: 'x'.repeat(120), question: 'Q'.repeat(60), rep: 1 });
    expect(id.length).toBeLessThanOrEqual(200);
    expect(id.split('--')[1]).toBe('claude-claude-sonnet-4-6');
  });
});

describe('binding a cell to the wire', () => {
  it('labels a claude request with x-task-id without redirecting it', () => {
    const { env, bound, seam } = bindCellEnv({ agent: 'claude', env: {}, taskId: 'kgb--claude-sonnet--grep-L1-r1', model: 'claude-sonnet-4-6' });
    expect(bound).toBe(true);
    expect(seam).toBe('x-task-id header');
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('x-task-id: kgb--claude-sonnet--grep-L1-r1');
  });

  it('leaves copilot and opencode unbound by default', () => {
    // Binding those two means REDIRECTING them (BYOK base URL / task-scoped shim path), and a
    // redirect that fails produces a cell that ran on a path other than the one it claims.
    expect(DEFAULT_WIRE_BIND).toEqual(['claude']);
    for (const agent of ['copilot', 'opencode']) {
      const { bound, env } = bindCellEnv({ agent, env: {}, taskId: 't--x--y', model: 'm' });
      expect(bound).toBe(false);
      expect(env.COPILOT_PROVIDER_BASE_URL).toBeUndefined();
    }
  });

  it('binds copilot onto the task-scoped BYOK path when asked explicitly', () => {
    const { env, bound } = bindCellEnv({ agent: 'copilot', env: {}, taskId: 'kgb--copilot-sonnet--grep-L1-r1', model: 'claude-sonnet-4.6', wireBind: ['copilot'] });
    expect(bound).toBe(true);
    expect(env.COPILOT_PROVIDER_BASE_URL).toContain('/v1/copilot/t/kgb--copilot-sonnet--grep-L1-r1');
    expect(env.COPILOT_MODEL).toBe('claude-sonnet-4.6');
  });

  it('drops an inherited OPENCODE_CONFIG_CONTENT whether or not it binds', () => {
    // The interactive launcher exports this, and it was reaching cells verbatim —
    // {"model":"github-copilot-enterprise/claude-opus-4.6","disabled_providers":["anthropic"]} —
    // so part of a cell's opencode configuration came from whichever session spawned the run.
    const leaked = { OPENCODE_CONFIG_CONTENT: '{"disabled_providers":["anthropic"]}' };
    expect(bindCellEnv({ agent: 'opencode', env: leaked }).env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(bindCellEnv({ agent: 'claude', env: leaked, taskId: 'a--b--c' }).env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

describe('resolving a finished cell\'s tokens', () => {
  it('keeps the agent\'s own number and never re-derives it', async () => {
    // stream-json usage is first-party. Preferring a DB reconstruction would quietly swap
    // exact per-cell accounting for a window sum.
    let dbHits = 0;
    const spy = () => { dbHits++; return rows({ total_tokens: 999999, input_tokens: 999999 }); };
    const t = await resolveCellTokens({
      result: { in_tokens: 900, out_tokens: 100, total_tokens: 1000 },
      agent: 'claude', taskId: 'a--b--c', startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: spy, byWindow: spy, ...NOW,
    });
    expect(t.token_source).toBe('stream-json');
    expect(t.total_tokens).toBeUndefined(); // the runner's own value is left untouched
    expect(dbHits).toBe(0);
  });

  it('prefers a bound task_id join over the time window', async () => {
    let windowHits = 0;
    const byTaskId = () => rows({ input_tokens: 400, output_tokens: 100, total_tokens: 500, calls: 2 });
    const byWindow = () => { windowHits++; return rows({ total_tokens: 99999 }); };
    const t = await resolveCellTokens({
      result: {}, agent: 'copilot', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      bound: true, byTaskId, byWindow, ...NOW,
    });
    expect(t.token_source).toBe('proxy-db-taskid');
    expect(t.total_tokens).toBe(500);
    expect(windowHits).toBe(0);
  });

  it('recovers stop-adapter rows by window when no task_id join exists', async () => {
    // The real case: opencode's rows carry ses_01f58a8b…, a session id the harness that
    // spawned the process never learns.
    const t = await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:15:00.000Z', endedAt: '2026-08-08T09:15:25.000Z',
      byTaskId: () => EMPTY,
      byWindow: () => rows({
        input_tokens: 117617, output_tokens: 724, total_tokens: 118341, calls: 8,
        sessions: [{ task_id: 'ses_01f58a8b2ffeiszwjsaXKo8DhQ', user_hash: 'opcadt', total_tokens: 118341, calls: 8 }],
      }),
      ...NOW,
    });
    expect(t.token_source).toBe('proxy-db-window');
    expect(t.total_tokens).toBe(118341);
    expect(t.token_window_sessions).toBe(1);
    expect(t.token_ambiguous).toBeUndefined();
  });

  it('never adds the cache columns to input_tokens — they are a breakdown, not an addition', async () => {
    // The real copilot row that caught this: adding cache_read + cache_write to input_tokens
    // reported 121,413 tokens as 242,103, because for that writer the cache columns SUM TO
    // input_tokens rather than extending it. `total_tokens = input + output` is the invariant
    // that actually holds across writers, so the stored values are used as stored.
    const t = await resolveCellTokens({
      result: {}, agent: 'copilot', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:57:00.000Z', endedAt: '2026-08-08T09:57:36.000Z',
      byTaskId: () => rows({
        input_tokens: 120713, output_tokens: 700, total_tokens: 121413,
        cache_read_tokens: 108398, cache_write_tokens: 12292,
      }),
      ...NOW,
    });
    expect(t.in_tokens).toBe(120713);
    expect(t.total_tokens).toBe(121413);
    // Kept for provenance, but out of the arithmetic.
    expect(t.cache_read_tokens).toBe(108398);
  });

  it('flags a window that caught more than one session of the same agent', async () => {
    const t = await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY,
      byWindow: () => rows({
        total_tokens: 200, calls: 4,
        sessions: [
          { task_id: 'ses_A', user_hash: 'opcadt', total_tokens: 150, calls: 3 },
          { task_id: 'ses_B', user_hash: 'opcadt', total_tokens: 50, calls: 1 },
        ],
      }),
      ...NOW,
    });
    expect(t.token_ambiguous).toBe(true);
    expect(t.token_window_sessions).toBe(2);
  });

  it('reports unmeasured rather than zero when nothing is found', async () => {
    // A 0 renders as "this agent cost nothing", which is plausible and false — and would make
    // the least measurable agent look the cheapest in every median.
    const t = await resolveCellTokens({
      result: {}, agent: 'copilot', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY, byWindow: () => EMPTY, ...NOW,
    });
    expect(t.token_source).toBe('unmeasured');
    expect(t.total_tokens).toBeUndefined();
    expect(t.in_tokens).toBeUndefined();
  });

  it('treats a DB error as unmeasured instead of failing the cell', async () => {
    const t = await resolveCellTokens({
      result: {}, agent: 'copilot', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => { throw new Error('database is locked'); },
      byWindow: () => { throw new Error('database is locked'); },
      ...NOW,
    });
    expect(t.token_source).toBe('unmeasured');
  });

  it('widens the window by a second at each end', async () => {
    // A call issued in the cell's first milliseconds can carry a proxy-side stamp
    // fractionally before the harness observed the spawn.
    let seen = null;
    await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: null,
      startedAt: '2026-08-08T09:00:10.000Z', endedAt: '2026-08-08T09:00:20.000Z',
      byWindow: (a) => { seen = a; return EMPTY; }, ...NOW,
    });
    expect(seen.startedAt).toBe('2026-08-08T09:00:09.000Z');
    expect(seen.endedAt).toBe('2026-08-08T09:00:21.000Z');
    expect(seen.agent).toBe('opencode');
  });
});
