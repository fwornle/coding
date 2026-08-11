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

import { cellTaskId, bindCellEnv, resolveCellTokens, DEFAULT_WIRE_BIND, TOKEN_FIELDS } from '../../lib/kgbench/tokens.mjs';

const EMPTY = { totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0, calls: 0 }, sessions: [], byAgentModel: [] };
const rows = (o) => ({
  totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, calls: 1, ...o },
  sessions: o.sessions ?? [],
  byAgentModel: [],
});
// No settle delay in tests: the polling exists for adapter write lag, not for logic.
const NOW = { attempts: 1, settleMs: 0 };

/** One row of aggregateSessionsTouchingWindow: a whole session with its full lifespan. */
const session = (o) => ({
  task_id: 'ses_x', user_hash: 'opcadt', agent: 'opencode',
  first_seen: '2026-08-08T09:00:00.000Z', last_seen: '2026-08-08T09:00:10.000Z',
  input_tokens: 0, output_tokens: 0, total_tokens: 0,
  reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, calls: 1, ...o,
});
const sessionSet = (sessions) => ({ sessions });
/** Every path that reaches the DB must be injected, or a test reads the developer's real one. */
const NO_SESSIONS = () => sessionSet([]);
/** Attempt windows in the shape runCell records them — one per spawn, in order. */
const attemptWindows = (...pairs) => pairs.map(([started_at, ended_at]) => ({ started_at, ended_at }));

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

  it('recovers stop-adapter rows by session when no task_id join exists', async () => {
    // The real case: opencode's rows carry ses_01f58a8b…, a session id the harness that
    // spawned the process never learns.
    const t = await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:15:00.000Z', endedAt: '2026-08-08T09:15:25.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({
          task_id: 'ses_01f58a8b2ffeiszwjsaXKo8DhQ', first_seen: '2026-08-08T09:15:02.000Z',
          input_tokens: 117617, output_tokens: 724, total_tokens: 118341, calls: 8,
        }),
      ]),
      ...NOW,
    });
    expect(t.token_source).toBe('proxy-db-session');
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

  it('flags two sessions that STARTED inside one cell — a real concurrent run', async () => {
    // Passes NO attempt windows, so this is a single-attempt cell with two starts: genuine
    // concurrency, which must keep flagging. Read it as a pair with `does not flag a retried
    // cell` below — that one has the same two sessions spread across two attempt windows, and
    // the ONLY thing separating an anomaly from a retry is which window each session began in.
    const t = await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_A', first_seen: '2026-08-08T09:00:05.000Z', total_tokens: 150, calls: 3 }),
        session({ task_id: 'ses_B', first_seen: '2026-08-08T09:00:12.000Z', total_tokens: 50, calls: 1 }),
      ]),
      ...NOW,
    });
    expect(t.token_ambiguous).toBe(true);
    expect(t.token_window_sessions).toBe(2);
    expect(t.total_tokens).toBe(200);
  });

  describe('a neighbouring cell\'s trailing calls are not this cell\'s tokens', () => {
    // THE DEFECT THIS PINS. Cells run back-to-back, and a session does not stop when the
    // process that started it does — its last calls are still being written while the next
    // cell is already running. Summing rows BY TIMESTAMP therefore charged each cell part of
    // its predecessor's traffic. Real numbers, run coding-v1-x2 cell grep/L1 rep1:
    //
    //   ses_…iG1tHz  06:58:37 → 06:59:14   started 33s BEFORE the cell spawned
    //   ses_…SBBuDZ  06:59:15 → 06:59:22   started inside the window — the cell's own
    //
    // 25,620 of the predecessor's tokens landed inside this cell's window. It hit 94 of 96
    // opencode cells, and the old detector called it "more than one session ran
    // concurrently", which reads as a busy machine and sent an investigation looking for a
    // background process that did not exist.
    const predecessorStillWriting = () => sessionSet([
      session({
        task_id: 'ses_iG1tHz', first_seen: '2026-08-09T06:58:37.964Z',
        last_seen: '2026-08-09T06:59:14.829Z', total_tokens: 72887, calls: 5,
      }),
      session({
        task_id: 'ses_SBBuDZ', first_seen: '2026-08-09T06:59:15.774Z',
        last_seen: '2026-08-09T06:59:22.712Z', total_tokens: 71723, calls: 3,
      }),
    ]);
    const cell = {
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-09T06:59:10.400Z', endedAt: '2026-08-09T06:59:22.966Z',
      byTaskId: () => EMPTY, bySessionSet: predecessorStillWriting, ...NOW,
    };

    it('charges only the session that began inside the window', async () => {
      expect((await resolveCellTokens(cell)).total_tokens).toBe(71723);
    });

    it('does not call adjacency ambiguous — one session started here, so this is clean', async () => {
      const t = await resolveCellTokens(cell);
      expect(t.token_ambiguous).toBeUndefined();
      expect(t.token_window_sessions).toBe(1);
    });

    it('records that a predecessor was present, so the attribution stays auditable', async () => {
      expect((await resolveCellTokens(cell)).token_sessions_inherited).toBe(1);
    });
  });

  it('counts a session\'s FULL spend, including calls written after the window closed', async () => {
    // The same boundary in the other direction: this cell's own last call lands after the
    // window's upper bound, and a timestamp sum would silently drop it. Attribution follows
    // the session, so where the rows fall in time stops mattering.
    const t = await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-09T07:00:00.000Z', endedAt: '2026-08-09T07:00:20.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({
          task_id: 'ses_own', first_seen: '2026-08-09T07:00:03.000Z',
          last_seen: '2026-08-09T07:00:41.000Z', total_tokens: 90000, calls: 6,
        }),
      ]),
      ...NOW,
    });
    expect(t.total_tokens).toBe(90000);
    expect(t.token_source).toBe('proxy-db-session');
  });

  it('falls back to the time join when NO session began inside the window, and says so', async () => {
    // An agent that reuses one long-lived session across cells cannot be attributed per
    // session. Reporting zero would be a lie; reporting the window sum without saying which
    // method produced it would hide exactly the weakness the session logic exists to remove.
    const t = await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-09T08:00:00.000Z', endedAt: '2026-08-09T08:00:20.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_long', first_seen: '2026-08-09T07:30:00.000Z', total_tokens: 500000, calls: 40 }),
      ]),
      byWindow: () => rows({ total_tokens: 4200, calls: 2 }),
      ...NOW,
    });
    expect(t.token_source).toBe('proxy-db-window');
    expect(t.total_tokens).toBe(4200);
    expect(t.token_ambiguous).toBe(true);
    expect(t.token_ambiguity).toMatch(/cannot be attributed by session/);
    expect(t.token_window_sessions).toBe(0);
  });

  it('declares every field it can emit, so a re-resolution can clear them first', async () => {
    // THE DEFECT THIS PINS. Re-resolution merges with Object.assign, which only overwrites
    // keys the NEW result has. A conditional field set by an earlier resolution and omitted
    // by a later one therefore survives as a verdict about a computation that no longer
    // exists. When attribution moved from window sums to session sets, all 94 re-attributed
    // cells kept `token_ambiguous: true` and the old "2 distinct sessions ran inside this
    // cell's window" text, sitting beside fresh fields saying the cell was cleanly attributed
    // to exactly one session — and the report read the stale one, so the fix looked inert.
    //
    // The invariant that prevents it: TOKEN_FIELDS must name every key this function emits.
    const emitted = new Set();
    const collect = (t) => Object.keys(t).forEach((k) => emitted.add(k));

    collect(await resolveCellTokens({ result: { total_tokens: 5 }, agent: 'claude', taskId: 'a--b--c', ...NOW }));
    collect(await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_A', first_seen: '2026-08-08T09:00:05.000Z', total_tokens: 150 }),
        session({ task_id: 'ses_B', first_seen: '2026-08-08T09:00:12.000Z', total_tokens: 50 }),
      ]),
      ...NOW,
    }));
    collect(await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([session({ task_id: 'ses_old', first_seen: '2026-08-08T08:00:00.000Z', total_tokens: 9 })]),
      byWindow: () => rows({ total_tokens: 42 }),
      ...NOW,
    }));
    // A RETRIED cell — the only path that emits token_attempt_windows/token_attempt_sessions.
    // Without this call the invariant would pass while saying nothing about the two newest
    // conditional fields, which is precisely the class of omission it was written to catch.
    collect(await resolveCellTokens({
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      windows: attemptWindows(
        ['2026-08-08T09:00:00.000Z', '2026-08-08T09:00:10.000Z'],
        ['2026-08-08T09:00:11.000Z', '2026-08-08T09:00:30.000Z'],
      ),
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_A', first_seen: '2026-08-08T09:00:02.000Z', total_tokens: 150 }),
        session({ task_id: 'ses_B', first_seen: '2026-08-08T09:00:14.000Z', total_tokens: 50 }),
      ]),
      ...NOW,
    }));

    const undeclared = [...emitted].filter((k) => !TOKEN_FIELDS.includes(k));
    expect(undeclared).toEqual([]);
  });

  it('reports unmeasured rather than zero when nothing is found', async () => {
    // A 0 renders as "this agent cost nothing", which is plausible and false — and would make
    // the least measurable agent look the cheapest in every median.
    const t = await resolveCellTokens({
      result: {}, agent: 'copilot', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY, bySessionSet: NO_SESSIONS, byWindow: () => EMPTY, ...NOW,
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
      bySessionSet: () => { throw new Error('database is locked'); },
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
      bySessionSet: (a) => { seen = a; return sessionSet([]); },
      byWindow: () => EMPTY, ...NOW,
    });
    expect(seen.startedAt).toBe('2026-08-08T09:00:09.000Z');
    expect(seen.endedAt).toBe('2026-08-08T09:00:21.000Z');
    expect(seen.agent).toBe('opencode');
  });
});

/**
 * A RETRIED cell owns one session per attempt.
 *
 * THE DEFECT THIS PINS. Ambiguity was judged against the CELL: more than one session starting
 * inside its window meant something foreign was running. But a retry is a fresh spawn, so it opens
 * a session of its own, and every retried cell therefore tripped the check. In run coding-v1-r8
 * that was 21 cells — and the 21 flagged cells were EXACTLY the 21 retried cells, with no foreign
 * session anywhere in the run. The sums were right; only the label was wrong.
 *
 * The cost of believing the label was worse than the label. The published analysis excluded those
 * rows from opencode's medians as over-counts; since a retried cell pays for two attempts, the
 * exclusion pushed that agent's measured cost DOWN — a correction in the wrong direction, applied
 * to correct data, on the strength of a warning that named the wrong cause.
 */
describe('one session per attempt is a retry, not an anomaly', () => {
  // Run coding-v1-r8, cell grep/L2 rep2. Attempt 1 returned no_result and was retried; the row
  // stored 274,139 = 134,412 + 139,727, which is the cell's true cost across both attempts.
  const L2r2 = {
    result: {}, agent: 'opencode', taskId: 'coding-v1-r8--opencode-x--grep-L2-r2',
    startedAt: '2026-08-10T17:19:26.225Z', endedAt: '2026-08-10T17:20:39.888Z',
    windows: attemptWindows(
      ['2026-08-10T17:19:26.225Z', '2026-08-10T17:20:04.225Z'],
      ['2026-08-10T17:20:04.225Z', '2026-08-10T17:20:39.888Z'],
    ),
    byTaskId: () => EMPTY,
    bySessionSet: () => sessionSet([
      session({ task_id: 'ses_0135045cbffeuvxJE69Vi3zgRr', first_seen: '2026-08-10T17:19:31.052Z', last_seen: '2026-08-10T17:20:03.971Z', total_tokens: 134412, calls: 7 }),
      session({ task_id: 'ses_0134fb12fffeHKysw2Y2F4UP3n', first_seen: '2026-08-10T17:20:08.909Z', last_seen: '2026-08-10T17:20:39.650Z', total_tokens: 139727, calls: 6 }),
    ]),
    ...NOW,
  };

  it('does not flag a retried cell, and charges it for both attempts', async () => {
    const t = await resolveCellTokens(L2r2);
    expect(t.token_ambiguous).toBeUndefined();
    expect(t.token_ambiguity).toBeUndefined();
    expect(t.total_tokens).toBe(274139);
    expect(t.token_window_sessions).toBe(2);
    // The structure that makes the verdict auditable: one session in each of two attempts.
    expect(t.token_attempt_windows).toBe(2);
    expect(t.token_attempt_sessions).toEqual([1, 1]);
  });

  it('still flags two sessions inside ONE attempt, and says which attempt', async () => {
    // Same cell, but a third session starts during attempt 2. That is the genuine concurrency
    // the old check was reaching for, and it must survive the change that stops flagging retries.
    const t = await resolveCellTokens({
      ...L2r2,
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_a', first_seen: '2026-08-10T17:19:31.052Z', total_tokens: 134412 }),
        session({ task_id: 'ses_b', first_seen: '2026-08-10T17:20:08.909Z', total_tokens: 139727 }),
        session({ task_id: 'ses_foreign', first_seen: '2026-08-10T17:20:20.000Z', total_tokens: 5000 }),
      ]),
    });
    expect(t.token_ambiguous).toBe(true);
    expect(t.token_attempt_sessions).toEqual([1, 2]);
    // Naming the attempt is the point: "2 sessions in this cell" sent the last investigation
    // looking for a background process that did not exist.
    expect(t.token_ambiguity).toMatch(/attempt 2 of 2/);
  });

  it('flags a session that started BETWEEN attempts, belonging to neither', async () => {
    // The containment guard. A session in the gap is either something foreign, or evidence that
    // a recorded window is wrong — and the offline repair script relies on this being loud.
    // Without this case, "assign to the nearest preceding window" would look like a harmless
    // simplification and would silently delete the only check on a reconstructed window.
    const t = await resolveCellTokens({
      ...L2r2,
      windows: attemptWindows(
        ['2026-08-10T17:19:26.225Z', '2026-08-10T17:19:40.000Z'],
        ['2026-08-10T17:20:04.225Z', '2026-08-10T17:20:39.888Z'],
      ),
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_a', first_seen: '2026-08-10T17:19:31.052Z', total_tokens: 134412 }),
        session({ task_id: 'ses_gap', first_seen: '2026-08-10T17:19:55.000Z', total_tokens: 900 }),
        session({ task_id: 'ses_b', first_seen: '2026-08-10T17:20:08.909Z', total_tokens: 139727 }),
      ]),
    });
    expect(t.token_ambiguous).toBe(true);
    expect(t.token_ambiguity).toMatch(/between two attempts/);
    expect(t.token_attempt_sessions).toEqual([1, 1]);
  });

  it('asks the DB exactly once, spanning every attempt', async () => {
    // Per-attempt attribution is applied in memory. If it ever became one query per attempt, a
    // 384-cell run would multiply its DB traffic for a verdict it can already compute.
    const calls = [];
    await resolveCellTokens({
      ...L2r2,
      bySessionSet: (a) => { calls.push(a); return sessionSet([]); },
      byWindow: () => EMPTY,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].startedAt).toBe('2026-08-10T17:19:25.225Z');   // first window − 1s
    expect(calls[0].endedAt).toBe('2026-08-10T17:20:40.888Z');     // last window + 1s
  });

  it('is byte-identical to the old path when no windows are given', async () => {
    // THE BACKWARDS-COMPATIBILITY CONTRACT, stated as an executable invariant rather than a
    // comment. Every row of r6, r7 and x2, and all 363 non-retried rows of r8, take this path.
    const base = {
      result: {}, agent: 'opencode', taskId: 'a--b--c',
      startedAt: '2026-08-08T09:00:00.000Z', endedAt: '2026-08-08T09:00:30.000Z',
      byTaskId: () => EMPTY,
      bySessionSet: () => sessionSet([
        session({ task_id: 'ses_A', first_seen: '2026-08-08T09:00:05.000Z', total_tokens: 150, calls: 3 }),
      ]),
      ...NOW,
    };
    const implicit = await resolveCellTokens(base);
    const explicit = await resolveCellTokens({
      ...base,
      windows: attemptWindows(['2026-08-08T09:00:00.000Z', '2026-08-08T09:00:30.000Z']),
    });
    expect(explicit).toEqual(implicit);
    // A single attempt emits neither new field — one-attempt cells are the overwhelming
    // majority, and two constant columns on every row would make results.jsonl worse to read.
    expect(implicit.token_attempt_windows).toBeUndefined();
    expect(implicit.token_attempt_sessions).toBeUndefined();
  });
});
