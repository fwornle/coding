/**
 * lib/lsl/route/opencode-route-trace.mjs
 *
 * Phase 72, Plan 72-04 (Wave 3) — the OpenCode normalized-route-trace reader (D-01).
 * Emits the cross-agent `RouteEvent[]` (lib/lsl/route/route-event.mjs) from the
 * `part` table `type:'tool'` rows of an OpenCode `opencode.db` — the DISJOINT
 * slice the Phase-51 *adapter* (opencode-sqlite.mjs, assembles whole messages)
 * does NOT model per-tool.
 *
 * OpenCode stores everything in SQLite (no JSONL) — the `part` table carries
 * full per-tool fidelity in each row's `data` JSON. This reader reuses ONLY the
 * file-location + uid + schema gates from the Phase-51 adapter (RESEARCH
 * Don't-Hand-Roll / Pitfall 3), NOT the message-assembly builders:
 *   - `isOwnedByMe(dbPath)` (opencode-sqlite.mjs:106-114) — non-owned → [] (T-72-04-FI / V4);
 *   - `openReadonlyDb` pattern (opencode-sqlite.mjs:167-171) — readonly + busy_timeout,
 *     short-lived connection closed in `finally` (T-72-04-RO / landmine #2 WAL contention);
 *   - `checkSchemaVersion(db)` (opencode-sqlite.mjs:135) — column-presence contract guard (T-72-04-SV).
 *
 * SQL-injection mitigation (T-72-04-SQLI / V5): the `part` table is queried with
 * a CONSTANT SQL string and each row's `data` JSON is parsed-then-filtered to
 * `data.type === 'tool'` IN JS — there is NO user-controlled SQL string
 * interpolation. The only run-specific input (the time-window) is applied by the
 * dispatcher (build-trace.mjs) AFTER this reader returns.
 *
 * Tool-part shape (confirmed): part.data = {
 *   type:'tool', callID, tool, state:{ status, input, error, time:{ start, end } }
 * }
 *   status 'completed' → success ; 'error' → error ;
 *   'pending'|'running' (no terminal state) → abandoned ; time is epoch MILLISECONDS.
 *
 * D-07: one RouteEvent == one tool part. Per the CLAUDE.md logging rule:
 * process.stderr.write only (no stdout logging API). Pure ESM (no build step).
 */

import process from 'node:process';
import {
  isOwnedByMe,
  openReadonlyDb,
  checkSchemaVersion,
} from '../adapters/opencode-sqlite.mjs';
import { inputsDigest, OUTCOMES } from './route-event.mjs';

// Constant query — read every part row, filter to type:'tool' in JS (no
// user-controlled SQL interpolation; T-72-04-SQLI). Ordered by id for a stable
// encounter order before the started_at sort below.
const PART_SQL = `
  SELECT p.id AS part_id, p.data AS part_data
    FROM part p
   ORDER BY p.id ASC
`;

/**
 * Convert an epoch-MILLISECONDS value to an ISO-8601 string, or null when the
 * value is not a finite number. Mirrors opencode-sqlite.mjs:385-387 (Pitfall 6:
 * OpenCode `state.time.{start,end}` are Drizzle integer-timestamp milliseconds,
 * NOT seconds — 1770570503748 ms is a 2026-02-08 timestamp).
 *
 * @param {*} ms
 * @returns {string|null}
 */
function msToIso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Map an OpenCode tool-part `state.status` to a RouteEvent outcome.
 *   'completed' → success ; 'error' → error ;
 *   'pending' | 'running' (or any non-terminal status) → abandoned.
 * `hasTerminalTime` (a finite state.time.end) disambiguates: a part with a
 * terminal end timestamp but an unrecognized status folds to error (it ran to
 * completion of some sort), whereas a part with no terminal time is abandoned.
 *
 * @param {string|undefined} status
 * @param {boolean} hasTerminalTime
 * @returns {'success'|'error'|'abandoned'}
 */
function outcomeFor(status, hasTerminalTime) {
  if (status === 'completed') return OUTCOMES.SUCCESS;
  if (status === 'error') return OUTCOMES.ERROR;
  if (status === 'pending' || status === 'running') return OUTCOMES.ABANDONED;
  // No recognized terminal status: a finite end time means it terminated
  // (treat as error — it consumed a step but did not succeed); otherwise it
  // never reached a terminal event → abandoned.
  return hasTerminalTime ? OUTCOMES.ERROR : OUTCOMES.ABANDONED;
}

/**
 * Build the normalized `RouteEvent[]` for one OpenCode `opencode.db` from its
 * `part` table `type:'tool'` rows.
 *
 * Honors the uid-check gate (non-owned db → []) and the schema-contract guard
 * (`checkSchemaVersion` throws on schema drift). The db is opened READ-ONLY and
 * ALWAYS closed in `finally` (landmine #2 — single-owner WAL contention). Each
 * `part.data` JSON is parsed defensively (a malformed row is skipped, never
 * aborts the pass — T-72-04-style DOS resilience).
 *
 * @param {string} dbPath absolute path to an opencode.db
 * @param {{startedAt?:string, endedAt?:string}} [_window] accepted for signature
 *        symmetry with the dispatcher; the time-window is applied by
 *        build-trace.mjs AFTER this reader returns (parse-all-then-filter).
 * @returns {Array<import('./route-event.mjs').RouteEvent>} 0-based seq, started_at order
 */
export function buildOpenCodeRouteTrace(dbPath, _window = {}) {
  // --- uid-check gate (T-72-04-FI) — fail closed on a non-owned db. ---
  if (!isOwnedByMe(dbPath)) {
    process.stderr.write(
      `[route-reader-opencode] skipping non-owned opencode.db: ${dbPath}\n`,
    );
    return [];
  }

  let db;
  /** @type {Array<{id:string,name:string,input:*,startedAt:string|null,endedAt:string|null,outcome:string}>} */
  const collected = [];
  try {
    // readonly + busy_timeout, short-lived (T-72-04-RO). Throws via
    // fileMustExist:true when the db is absent — the dispatcher only calls this
    // after locating the file, but be robust here too.
    db = openReadonlyDb(dbPath);
    // Schema-contract guard (T-72-04-SV) — throws on schema drift.
    checkSchemaVersion(db);

    const rows = db.prepare(PART_SQL).all();
    for (const row of rows) {
      let data;
      try {
        data = JSON.parse(row.part_data);
      } catch {
        // Malformed part row → skip, never abort the pass.
        continue;
      }
      // Parse-then-filter to type:'tool' IN JS (T-72-04-SQLI — no SQL
      // interpolation of the discriminator).
      if (!data || typeof data !== 'object' || data.type !== 'tool') continue;
      if (typeof data.callID !== 'string') continue;

      const state = data.state && typeof data.state === 'object' ? data.state : {};
      const time = state.time && typeof state.time === 'object' ? state.time : {};
      const startedAt = msToIso(time.start);
      const endedAt = msToIso(time.end);
      const outcome = outcomeFor(state.status, endedAt !== null);

      const input = state.input;
      const targetPath = input && typeof input === 'object'
        && typeof input.file_path === 'string'
        ? input.file_path
        : null;

      collected.push({
        id: data.callID,
        name: typeof data.tool === 'string' ? data.tool : '',
        input,
        targetPath,
        startedAt,
        endedAt,
        outcome,
      });
    }
  } finally {
    // ALWAYS close — single-owner WAL contention (landmine #2).
    if (db) {
      try { db.close(); } catch { /* best effort */ }
    }
  }

  // Sort by started_at (nulls last), assign 0-based seq. Lexical ISO comparison
  // is chronologically correct; ties (and null starts) preserve the id order
  // already established by PART_SQL's `ORDER BY p.id ASC`.
  collected.sort((a, b) => {
    if (a.startedAt === b.startedAt) return 0;
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return a.startedAt < b.startedAt ? -1 : 1;
  });

  const events = [];
  let seq = 0;
  for (const c of collected) {
    events.push({
      seq: seq++,
      tool_call_id: c.id,
      tool_name: c.name,
      inputs_digest: inputsDigest(c.input),
      target_path: c.targetPath,
      started_at: c.startedAt,
      ended_at: c.endedAt,
      outcome: c.outcome,
      agent: 'opencode',
    });
  }

  return events;
}
