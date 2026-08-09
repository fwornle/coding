/**
 * Cross-agent token attribution for kgbench cells.
 *
 * THE PROBLEM THIS SOLVES. A claude cell reports its own usage in the stream-json `result`
 * event, so `total_tokens` is a fact the runner reads directly. No other agent has an
 * equivalent, and the runner deliberately wrote `null` rather than `0` for them — a zero
 * renders as "this agent used no tools and cost nothing", which is plausible and false.
 * Those nulls were correct but useless: a benchmark whose token column is empty for two of
 * three agents cannot compare cost across agents at all.
 *
 * The tokens were never missing. They were in the proxy's token-usage.db the whole time,
 * under a key the harness could not predict:
 *
 *   11:15:07  opencode  claude-sonnet-4.6  task=ses_01f58a8b2ffeiszwjsaXKo8DhQ  uh=opcadt  21292
 *   11:10:02  copilot   claude-sonnet-4.6  task=67f25221-c129-429a-93b0-…       uh=copadt  96280
 *
 * Both rows are from the first cross-agent smoke run. Both are stamped with the AGENT'S OWN
 * session identity, written by its stop-adapter after the CLI exited. A `WHERE task_id = ?`
 * join on a harness-chosen id returns nothing for either.
 *
 * TWO SOURCES, RANKED, NEVER SILENTLY MIXED. This module resolves a cell's tokens from the
 * strongest source that has data and RECORDS WHICH ONE, because they do not mean the same
 * thing:
 *
 *   stream-json      the agent reported its own usage        (claude only)
 *   proxy-db-taskid  the wire carried this cell's task_id    (bound: exact)
 *   proxy-db-session sessions that BEGAN while this cell ran (inferred: good)
 *   proxy-db-window  rows stamped while this cell ran        (inferred: weakest)
 *   unmeasured       nothing found — stays null, never 0
 *
 * WHY SESSION BEATS WINDOW, AND WHY WINDOW WAS WRONG. Both infer rather than read a tag, but
 * they infer different things. A window sums the rows whose TIMESTAMPS land between two
 * instants; a session sums everything spent by a session that BEGAN inside them.
 *
 * The window looks sound because cells run serially, and it is not, because a session does
 * not stop when the process that started it does — its final calls are still being written
 * while the next cell is already running. Measured on run coding-v1-x2, cell grep/L1 rep1:
 *
 *   ses_…iG1tHz  06:58:37 → 06:59:14   started 33s BEFORE the cell spawned
 *   ses_…SBBuDZ  06:59:15 → 06:59:22   started inside the window — the cell's own
 *
 * The window charged that cell 25,620 tokens of its PREDECESSOR's traffic, and would equally
 * have dropped its own rows had any landed after the window closed. It hit 94 of 96 opencode
 * cells, and the old detector reported it as "more than one session ran concurrently" — which
 * reads as a busy machine and sent an investigation looking for a background process. Nothing
 * else was running. The cells were adjacent, which is the normal case, not an anomaly.
 *
 * So ambiguity now means what it says: more than one session STARTED inside a single cell's
 * window, i.e. something else of this agent really did begin while the cell was running.
 * Adjacency is attributed correctly instead of flagged. An ambiguous number is still
 * published with its ambiguity, never quietly averaged in.
 *
 * WHY BINDING IS NOT SIMPLY TURNED ON FOR EVERY AGENT. Binding a task_id means changing HOW
 * the agent reaches its model — copilot moves from its own GitHub login onto the proxy's BYOK
 * seam, opencode's provider base URL gains a task-scoped path. Both alter the thing being
 * measured to improve the label on the measurement, and both have already produced silent
 * failures in this project (a copilot 500 "model is not supported"; a `Model not found` for a
 * model that was in the catalog). So the wire binding is opt-in per agent via `wireBind`,
 * claude excepted: its binding is a request HEADER on a connection it already makes to the
 * proxy, which changes routing not at all.
 */

import { aggregateByTaskId, aggregateByWindow, aggregateSessionsTouchingWindow } from '../experiments/token-aggregate.mjs';
import { buildAgentRoutingEnv } from '../experiments/agent-routing.mjs';

/** Source ranking, strongest first. Recorded per cell as `token_source`. */
export const TOKEN_SOURCES = ['stream-json', 'proxy-db-taskid', 'proxy-db-session', 'proxy-db-window', 'unmeasured'];

/**
 * Every field `resolveCellTokens` owns on a result row.
 *
 * Exists so a re-resolution can CLEAR them before merging. `Object.assign` only overwrites
 * keys the new result has, so a field set by an earlier resolution and absent from a later
 * one survives as a verdict about a computation that no longer exists — a re-attributed cell
 * kept `token_ambiguous: true` from its window-sum era while its fresh fields said it had
 * been cleanly attributed to a single session, and the report read the stale one.
 *
 * Anything conditional — `token_ambiguous`, `token_ambiguity`, `token_sessions_inherited` —
 * MUST be listed here, because those are exactly the fields a later resolution may omit.
 */
export const TOKEN_FIELDS = [
  'in_tokens', 'out_tokens', 'total_tokens', 'reasoning_tokens',
  'cache_read_tokens', 'cache_write_tokens', 'token_calls',
  'token_source', 'token_task_id', 'token_bound',
  'token_window_sessions', 'token_sessions_inherited',
  'token_ambiguous', 'token_ambiguity',
];

/**
 * Which agents get their task_id bound onto the wire by default.
 *
 * claude only, and the reason is asymmetric risk rather than caution for its own sake. For
 * claude the binding is an `x-task-id` header on a request that already goes to the proxy —
 * it labels traffic without redirecting it. For copilot and opencode the binding IS a
 * redirect, and a redirect that fails does not fail loudly: it produces a cell that ran on a
 * different path than the one it claims, which is the exact defect class this benchmark keeps
 * finding in itself. Turn them on per run with `wireBind` once a smoke run shows the cell
 * still answers.
 */
export const DEFAULT_WIRE_BIND = ['claude'];

/** The proxy's task_id charset (src/measurement-span.ts sanitizeTaskId) and length cap. */
const SAFE_TASK_ID = /^[A-Za-z0-9._-]+$/;
const MAX_TASK_ID_LEN = 200;

/** Everything outside the proxy's allowed charset collapses to '-'. */
const slug = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The composite per-cell task_id.
 *
 * Shape follows the convention the proxy already parses — `<run>--<agent>-<model>--<rest>`
 * (proxy-bridge/server.mjs runIdentityFromTaskId). That is not cosmetic: the proxy's
 * span-leakage guard reads the SECOND segment to decide whether an incoming request
 * plausibly belongs to this run, rejecting a `/v1/messages` request against an opencode
 * cell or an opus request against a sonnet one. An id that does not start its second
 * segment with the agent name silently opts out of that protection.
 *
 * Truncation is on the ARM/QUESTION tail, so the run + agent + model prefix — the part the
 * guard reads and the part a human needs to identify the cell — always survives.
 */
export function cellTaskId({ runId, agent, model, arm, question, rep }) {
  const head = `${slug(runId)}--${slug(agent)}-${slug(model)}`;
  const tail = `--${slug(arm)}-${slug(question)}-r${slug(rep)}`;
  let id = head + tail;
  if (id.length > MAX_TASK_ID_LEN) id = id.slice(0, MAX_TASK_ID_LEN).replace(/-+$/, '');
  if (!SAFE_TASK_ID.test(id)) {
    // Unreachable via slug(), but a task_id the proxy rejects would make every row for this
    // cell unattributable, and failing here is far cheaper than discovering it in the report.
    throw new Error(`kgbench: composed an unusable task_id ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Add this cell's task_id to the agent's launch env, where a seam exists.
 *
 * Delegates the per-agent env map to lib/experiments/agent-routing.mjs — the project's single
 * definition of how an agent is bound to a measurement — rather than restating it. kgbench
 * adds one thing of its own: it DROPS an inherited `OPENCODE_CONFIG_CONTENT`. That variable
 * is exported by the interactive launcher and was reaching cells verbatim
 * (`{"model":"github-copilot-enterprise/claude-opus-4.6","disabled_providers":["anthropic"]}`),
 * so a cell's opencode configuration partly came from whichever session happened to spawn the
 * benchmark. The pinned config file must be the only configuration a cell sees.
 *
 * @param {object} params
 * @param {string} params.agent   agent id
 * @param {object} params.env     base env for the cell
 * @param {string} [params.taskId] this cell's composite task_id
 * @param {string} [params.model] the RESOLVED launch model (copilot BYOK needs it)
 * @param {string[]} [params.wireBind] agents whose task_id is bound onto the wire
 * @param {number} [params.port]  proxy port
 * @returns {{env: object, bound: boolean, seam: string}}
 */
export function bindCellEnv({ agent, env = {}, taskId, model, wireBind = DEFAULT_WIRE_BIND, port } = {}) {
  const base = { ...env };
  // Unconditional, bind or no bind: an inherited config is a confound either way.
  delete base.OPENCODE_CONFIG_CONTENT;

  if (!taskId || !wireBind.includes(agent)) {
    return { env: base, bound: false, seam: 'none' };
  }
  const seam = agent === 'claude' ? 'x-task-id header'
    : agent === 'copilot' ? 'BYOK task-scoped base URL'
    : agent === 'opencode' ? 'task-scoped shim path'
    : 'none';
  return { env: buildAgentRoutingEnv(agent, base, { taskId, model, port }), bound: seam !== 'none', seam };
}

/** A DB aggregate with no rows is not a measurement of zero. */
const hasRows = (t) => !!t && Number(t.calls) > 0 && Number(t.total_tokens) > 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a finished cell's token fields.
 *
 * Called AFTER the agent exits, and polled: the stop-adapters that write copilot's and
 * opencode's rows run at session teardown, so the rows can land a second or two behind the
 * process. Polling stops the moment anything is found, so a claude cell — which never needs
 * the DB — pays nothing, and a genuinely unmeasured cell pays the full (short) budget once.
 *
 * NEVER overwrites a number the agent reported itself. stream-json usage is first-party; the
 * DB is a reconstruction, and preferring the reconstruction would quietly replace exact
 * per-cell accounting with a window sum.
 *
 * @param {object} params
 * @param {object} params.result     the runAgent/runCell result so far
 * @param {string} params.agent      agent id
 * @param {string} [params.taskId]   this cell's composite task_id
 * @param {string} params.startedAt  ISO timestamp of spawn
 * @param {string} params.endedAt    ISO timestamp of exit
 * @param {boolean} [params.bound]   was the task_id bound onto the wire
 * @param {boolean} [params.allowWindow=true] permit the weaker window join
 * @param {number} [params.attempts=3] poll attempts
 * @param {number} [params.settleMs=1200] delay between attempts
 * @param {string} [params.dbPath]   explicit DB path (tests)
 * @param {Function} [params.byTaskId] injectable aggregator (tests)
 * @param {Function} [params.byWindow] injectable aggregator (tests)
 * @returns {Promise<object>} token fields to merge onto the row
 */
export async function resolveCellTokens({
  result = {},
  agent,
  taskId,
  startedAt,
  endedAt,
  bound = false,
  allowWindow = true,
  attempts = 3,
  settleMs = 1200,
  dbPath,
  byTaskId = aggregateByTaskId,
  byWindow = aggregateByWindow,
  bySessionSet = aggregateSessionsTouchingWindow,
} = {}) {
  // First-party numbers win outright.
  if (result.total_tokens != null) {
    return { token_source: 'stream-json', token_task_id: taskId ?? null };
  }

  // The window is widened by a second at each end. A row's timestamp is written when the
  // proxy handles the call, not when the harness observed the spawn, and the two clocks are
  // the same clock but not the same instant — a call issued in the cell's first
  // milliseconds can carry a stamp fractionally before `startedAt`.
  const lo = startedAt ? new Date(new Date(startedAt).getTime() - 1000).toISOString() : null;
  const hi = endedAt ? new Date(new Date(endedAt).getTime() + 1000).toISOString() : null;

  for (let i = 1; i <= Math.max(1, attempts); i++) {
    if (taskId) {
      const agg = safely(() => byTaskId(taskId, dbPath));
      if (hasRows(agg?.totals)) {
        return {
          ...fromTotals(agg.totals),
          token_source: 'proxy-db-taskid',
          token_task_id: taskId,
          token_bound: bound,
        };
      }
    }

    if (allowWindow && lo && hi) {
      // ATTRIBUTE BY SESSION, NOT BY INSTANT.
      //
      // Summing the rows whose timestamps fall in the window is wrong in both directions at
      // once, because a session does not stop when the process that started it does — its
      // last calls are still being written while the next cell is already running.
      //
      // Measured on run coding-v1-x2, cell grep/L1 rep1 (window 06:59:09.4 → 06:59:23.9):
      //
      //   ses_…iG1tHz  06:58:37 → 06:59:14   started 33s BEFORE the cell spawned
      //   ses_…SBBuDZ  06:59:15 → 06:59:22   started inside the window — the cell's own
      //
      // The window sum charged this cell 25,620 tokens of its PREDECESSOR's traffic, and
      // would equally have dropped any of its own rows written after the window closed. It
      // affected 94 of 96 opencode cells, and the old detector called that "more than one
      // session ran concurrently" — which reads as a busy machine and is not what happened.
      // Nothing else was running. The cells were simply adjacent.
      //
      // A session that BEGAN inside this cell's window is this cell's, and everything it
      // spent belongs to it wherever the rows land in time. A session that began earlier
      // belongs to whoever spawned it.
      const touched = safely(() => bySessionSet({ startedAt: lo, endedAt: hi, agent, dbPathOverride: dbPath }));
      const all = (touched?.sessions ?? []).filter((s) => Number(s.total_tokens) > 0);
      const own = all.filter((s) => s.first_seen >= lo);
      const inherited = all.length - own.length;

      if (own.length) {
        const totals = own.reduce((a, s) => ({
          input_tokens: a.input_tokens + Number(s.input_tokens || 0),
          output_tokens: a.output_tokens + Number(s.output_tokens || 0),
          total_tokens: a.total_tokens + Number(s.total_tokens || 0),
          reasoning_tokens: a.reasoning_tokens + Number(s.reasoning_tokens || 0),
          cache_read_tokens: a.cache_read_tokens + Number(s.cache_read_tokens || 0),
          cache_write_tokens: a.cache_write_tokens + Number(s.cache_write_tokens || 0),
          calls: a.calls + Number(s.calls || 0),
        }), {
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, calls: 0,
        });
        return {
          ...fromTotals(totals),
          token_source: 'proxy-db-session',
          token_task_id: taskId ?? null,
          token_bound: bound,
          token_window_sessions: own.length,
          token_sessions_inherited: inherited,
          // Two sessions STARTING inside one cell's window is the real ambiguity: something
          // else of this agent began while the cell was running. Adjacency no longer counts.
          ...(own.length > 1 ? {
            token_ambiguous: true,
            token_ambiguity: `${own.length} distinct ${agent} sessions STARTED inside this cell's `
              + 'window; another session of the same agent began while the cell was running, so '
              + 'the sum may include traffic that is not this cell',
          } : {}),
        };
      }

      // No session began inside the window. Either the agent reuses one long-lived session
      // across cells, or the rows for this cell had not landed yet. Fall back to the old
      // instant-sum rather than reporting zero — but say which method produced the number,
      // because a window sum here is exactly the measurement the session logic replaced.
      const agg = safely(() => byWindow({ startedAt: lo, endedAt: hi, agent, dbPathOverride: dbPath }));
      if (hasRows(agg?.totals)) {
        return {
          ...fromTotals(agg.totals),
          token_source: 'proxy-db-window',
          token_task_id: taskId ?? null,
          token_bound: bound,
          token_window_sessions: 0,
          token_sessions_inherited: inherited,
          token_ambiguous: true,
          token_ambiguity: `no ${agent} session began inside this cell's window, so its tokens `
            + 'cannot be attributed by session; this is a time-join over rows belonging to '
            + `${all.length} session(s) that started elsewhere`,
        };
      }
    }

    if (i < attempts) await sleep(settleMs);
  }

  // Still nothing. Null, not zero — and say so, so "we did not measure this" is
  // distinguishable in the results file from "this has not been looked at yet".
  return {
    token_source: 'unmeasured',
    token_task_id: taskId ?? null,
    token_bound: bound,
    token_note: `no token_usage rows for this cell (agent=${agent}${bound ? ', wire-bound' : ', unbound'})`,
  };
}

/** Never let a DB hiccup fail a cell that otherwise succeeded. */
function safely(fn) {
  try { return fn(); } catch { return null; }
}

/**
 * DB totals -> the runner's field names. Stored values are used AS STORED, never re-derived.
 *
 * This looked like the wrong choice at first. claude's stream-json reports `input_tokens`,
 * `cache_creation_input_tokens` and `cache_read_input_tokens` as three separate numbers that
 * the parser sums, so folding the DB's two cache columns into `input_tokens` the same way
 * seemed like the move that keeps `content_tokens` comparable across sources. It doubled the
 * first real copilot cell — 121,413 tokens reported as 242,103:
 *
 *   in=120,713  cache_read=108,398  cache_write=12,292  out=700  total_tokens=121,413
 *
 * `cache_read + cache_write` ≈ `input_tokens`, because for that writer the cache columns are a
 * BREAKDOWN of input, not an addition to it. Other writers store the opposite (in=2 alongside
 * cache_read=277,173). The one invariant that holds across all 566 cache-carrying rows checked
 * is `total_tokens = input_tokens + output_tokens`, so that is what this trusts — the same
 * values aggregateByTaskId and the dashboard already report.
 *
 * The cost is a real caveat, recorded rather than papered over: a DB-derived `in_tokens` may
 * account for cache differently from a stream-json one, so `content_tokens` — which subtracts
 * a baseline measured on claude — is strictly comparable only WITHIN a token source. The
 * report prints the source next to every figure for exactly this reason.
 */
function fromTotals(t) {
  const inTok = Number(t.input_tokens ?? 0);
  const outTok = Number(t.output_tokens ?? 0);
  return {
    in_tokens: inTok,
    out_tokens: outTok,
    // Prefer the stored total; fall back to the sum only if the column is absent.
    total_tokens: t.total_tokens != null ? Number(t.total_tokens) : inTok + outTok,
    // Informational: kept because they say HOW the input was composed, never added to it.
    cache_read_tokens: t.cache_read_tokens != null ? Number(t.cache_read_tokens) : null,
    cache_write_tokens: t.cache_write_tokens != null ? Number(t.cache_write_tokens) : null,
    reasoning_tokens: Number(t.reasoning_tokens ?? 0) || null,
    token_calls: Number(t.calls ?? 0),
  };
}
