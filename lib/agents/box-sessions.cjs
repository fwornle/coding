'use strict';
/**
 * Which agent sessions ran in the agent box — so session logging can mark each
 * observation `box`, `strict` or `host`.
 *
 * scripts/agent-box.mjs (the host launcher, never the box) appends one line
 * when a box starts and one when it ends to ~/.coding/box/sessions.jsonl.
 * The file is outside every box mount, so an agent cannot forge or erase it.
 *
 * Matching an observation to a box run, most exact first:
 *   opencode  by store: the box's exported snapshot vs the host's database
 *             (lib/lsl/opencode-dbs.cjs) — exact.
 *   claude    by session id, which the launcher pins (--session-id) — exact.
 *             A boxed claude whose id is unknowable (--continue) falls back
 *             to the window below.
 *   copilot,
 *   pi        by window: a box run of the same agent for the same project
 *             that was live at the observation's time. Running the same
 *             agent boxed and unboxed in one project at once would blur it.
 *
 * A run with no end line is closed when its launcher pid is gone (a killed
 * launcher), so a crash never marks later host sessions as boxed.
 *
 * Tracking starts with the registry's first line. Before it (or with no
 * registry at all) a non-opencode observation gets no runtime: box runs were
 * not recorded yet, so "no match" would not mean "host". A session that was
 * already running when this was installed is labelled from its next launch.
 *
 * CommonJS so the ESM launcher and the CJS/ESM readers can all load it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function boxSessionsFile({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.CODING_BOX_SESSIONS_FILE || path.join(home, '.coding', 'box', 'sessions.jsonl'));
}

/** Append one event. Never throws: losing a label must not stop a launch. */
function recordBoxEvent(event, opts = {}) {
  try {
    const file = boxSessionsFile(opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ ...event, at: event.at ?? Date.now() })}\n`);
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Box runs, one per box name: { name, agent, workspace, mode, sessionId,
 * pid, startedAt, endedAt }. endedAt is null while the run is live.
 */
function readBoxSessions({ text, alive = pidAlive, now = Date.now(), ...opts } = {}) {
  let raw = text;
  if (raw === undefined) {
    try { raw = fs.readFileSync(boxSessionsFile(opts), 'utf8'); } catch { return []; }
  }
  const runs = new Map();
  let first = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e.name !== 'string') continue;
    if (first == null && Number(e.at)) first = Number(e.at);
    if (e.event === 'start') {
      runs.set(e.name, {
        name: e.name, agent: e.agent, workspace: e.workspace, mode: e.mode === 'strict' ? 'strict' : 'box',
        sessionId: e.sessionId || null, pid: e.pid, startedAt: Number(e.at) || 0, endedAt: null,
      });
    } else if (e.event === 'end' && runs.has(e.name)) {
      runs.get(e.name).endedAt = Number(e.at) || now;
    }
  }
  for (const run of runs.values()) {
    if (run.endedAt == null && !alive(run.pid)) run.endedAt = run.startedAt; // launcher gone: closed
  }
  const list = [...runs.values()];
  list.trackedSince = first; // when recording began; null with no registry
  return list;
}

function samePlace(a, b) {
  if (!a || !b) return false;
  const norm = (p) => path.resolve(p).replace(/\/+$/, '');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * 'box' | 'strict' | 'host' for one observation, or null when it predates
 * tracking (or its time is unknown).
 *
 * @param {object} q
 * @param {string} q.agent
 * @param {string} [q.projectPath]
 * @param {string} [q.sessionId]   claude transcript id
 * @param {number} [q.atMs]        when the exchange happened
 * @param {string} [q.opencodeDb]  the store an opencode session was read from
 * @param {Array}  [q.runs]        readBoxSessions() result (read when absent)
 */
function runtimeOf({ agent, projectPath, sessionId, atMs, opencodeDb, runs, boxOpencodeDb, now = Date.now() } = {}) {
  const t = Number.isFinite(atMs) ? atMs : now;
  const all = runs ?? readBoxSessions();
  const mine = all.filter((r) => r.agent === agent);
  // A run without an end is still going (its launcher is alive): open-ended.
  const live = (r) => r.startedAt <= t && t <= (r.endedAt ?? Infinity);
  const windowMatch = (pred = () => true) =>
    mine.find((r) => pred(r) && live(r) && samePlace(r.workspace, projectPath));

  // opencode: the store says it, registry or not.
  if (agent === 'opencode' && opencodeDb) {
    if (!boxOpencodeDb || path.resolve(opencodeDb) !== path.resolve(boxOpencodeDb)) return 'host';
    return windowMatch()?.mode ?? 'box';
  }
  if (all.trackedSince == null || t < all.trackedSince) return null;
  if (agent === 'claude' && sessionId) {
    const exact = mine.find((r) => r.sessionId && r.sessionId === sessionId);
    if (exact) return exact.mode;
    // Only a boxed claude whose id could not be pinned (--continue) is matched by time.
    return windowMatch((r) => !r.sessionId)?.mode ?? 'host';
  }
  return windowMatch()?.mode ?? 'host';
}

module.exports = {
  boxSessionsFile,
  recordBoxEvent,
  readBoxSessions,
  runtimeOf,
};
