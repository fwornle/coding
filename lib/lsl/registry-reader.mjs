/**
 * lib/lsl/registry-reader.mjs — Sub-agent heartbeat-file reader.
 *
 * Phase 51 Plan 10 Task 1 (D-Statusline cleanup target).
 *
 * Reads the per-agent heartbeat state files written by the daemons in:
 *   - Plan 51-07 — claude   → .data/sub-agent-live-state-claude.json
 *   - Plan 51-08 — opencode → .data/sub-agent-live-state-opencode.json
 *   - Plan 51-09 — copilot  → .data/sub-agent-live-state-copilot.json
 *
 * Aggregates a per-project sub-agent freshness signal that
 * scripts/combined-status-line.js consumes in place of the 2026-05-24
 * mitigation that re-walked `<parent>/subagents/` on every statusline tick.
 *
 * Per CONTEXT.md D-Statusline (verbatim):
 * > Phase 51 includes a dedicated cleanup plan (one of the final plans in
 * > the phase) that:
 * > - Sources subMt for each project from the new registry instead of
 * >   re-walking <parent>/subagents/ on every tick
 *
 * Per CONTEXT.md D-Reuse: this module does NOT import Phase 50 primitives
 * (lib/lsl/window.mjs or lib/lsl/scan-and-convert.mjs).
 *
 * Per CLAUDE.md no-console-log: forensic output goes through
 * process.stderr.write exclusively.
 *
 * Defensive design — the statusline MUST NEVER crash on a bad heartbeat
 * file. Missing files → empty objects. Corrupt JSON → empty object + stderr.
 * uid-mismatch → empty object + stderr. Stale (>90s) files → returned with
 * `stale: true` flag so callers can ignore them in freshness calculations.
 *
 * Pure ESM. Zero new package installs (T-51-10-SC mitigation).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Frozen mapping of agent name → heartbeat filename. The daemons in Plans
 * 51-07/08/09 write to these paths under the project's `.data/` dir
 * (Plan 51-11 wires them to launchd with explicit --state-file flags
 * matching this contract).
 *
 * Note on the claude default: Plan 51-07's daemon's hardcoded default is
 * `sub-agent-live-state.json` (no suffix). The plan contract — and Plan
 * 51-11's launchd plist — sets `--state-file .data/sub-agent-live-state-claude.json`
 * to align with the agent-suffixed convention used by opencode and copilot.
 * Operators running the claude daemon by hand without the explicit
 * --state-file flag will write to the un-suffixed default and the reader
 * will not find their heartbeats. The launchd path is the production path.
 */
const HEARTBEAT_FILES = Object.freeze({
  claude: 'sub-agent-live-state-claude.json',
  opencode: 'sub-agent-live-state-opencode.json',
  copilot: 'sub-agent-live-state-copilot.json',
});

/** Default stale threshold — 3x the 30s heartbeat interval. */
const DEFAULT_MAX_AGE_MS = 90_000;

/**
 * Read all three heartbeat files from `stateDir` (default `.data/`).
 *
 * Returns: `{ claude: <heartbeat>, opencode: <heartbeat>, copilot: <heartbeat> }`
 * where each `<heartbeat>` is one of:
 *   - `{}` — file missing, unreadable, malformed JSON, or owned by another uid
 *   - `{...parsed, stale: false, mtime_ms: <number>}` — fresh (age ≤ maxAgeMs)
 *   - `{...parsed, stale: true, age_ms: <number>}` — stale (age > maxAgeMs)
 *
 * Defensive — must NEVER throw. Statusline cannot afford to crash on a
 * tampered/corrupt heartbeat file (T-51-10-CR / T-51-10-FI / T-51-10-PI
 * mitigations).
 */
export function loadAllHeartbeats({ stateDir = '.data', maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const result = { claude: {}, opencode: {}, copilot: {} };
  const myUid = typeof process.getuid === 'function' ? process.getuid() : null;

  for (const [agent, filename] of Object.entries(HEARTBEAT_FILES)) {
    const filePath = path.join(stateDir, filename);
    let stat;
    try {
      if (!fs.existsSync(filePath)) {
        // Missing file — daemon not running yet, or pre-launchd setup.
        continue;
      }
      stat = fs.statSync(filePath);
    } catch (err) {
      process.stderr.write(`[registry-reader] stat failed for ${filePath}: ${err.message}\n`);
      continue;
    }

    // uid-check (T-51-10-FI / T-51-10-PI): only trust files owned by the
    // current uid. Defends against a malicious peer dropping a crafted
    // heartbeat file into the operator's .data dir.
    if (myUid !== null && stat.uid !== myUid) {
      process.stderr.write(`[registry-reader] skipping non-owned heartbeat ${filePath} (uid=${stat.uid}, expected=${myUid})\n`);
      continue;
    }

    let parsed;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        process.stderr.write(`[registry-reader] heartbeat is not an object: ${filePath}\n`);
        continue;
      }
    } catch (err) {
      process.stderr.write(`[registry-reader] failed to parse heartbeat ${filePath}: ${err.message}\n`);
      continue;
    }

    const age = Date.now() - stat.mtimeMs;
    if (age > maxAgeMs) {
      // Stale — daemon may be down or in a long pause; surface for caller's
      // freshness calculation but DON'T drop the row.
      result[agent] = { ...parsed, stale: true, age_ms: age };
    } else {
      result[agent] = { ...parsed, stale: false, mtime_ms: stat.mtimeMs };
    }
  }

  return result;
}

/**
 * Enumerate currently-running sub-agents for a given project across all
 * three agents. Filters out:
 *   - stale heartbeats (file mtime > maxAgeMs old)
 *   - rows whose `status` is not 'running'
 *   - rows whose `project` does not match (rows lacking `project` are
 *     treated as matching, since older daemon revisions may not have
 *     stamped the field — defensive default)
 *
 * Returns: `Array<{agent, sub_hash, parent_session_id, status, heartbeat_age_ms}>`.
 * Empty array when nothing live.
 */
export function getFreshSubAgents(project, { stateDir = '.data', maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const heartbeats = loadAllHeartbeats({ stateDir, maxAgeMs });
  const out = [];
  const now = Date.now();
  for (const [agent, hb] of Object.entries(heartbeats)) {
    if (!hb || hb.stale) continue;
    const rows = Array.isArray(hb.registry_rows) ? hb.registry_rows : [];
    for (const row of rows) {
      if (!row || row.status !== 'running') continue;
      // project filter: explicit non-match excludes; missing project field
      // is treated as a match (defensive — Plan 51-07 daemon does not stamp
      // project on the inner registry rows yet; mtime-source-of-truth means
      // false-positives here are harmless when the daemon writes for a
      // single project anyway).
      if (row.project !== undefined && row.project !== null && row.project !== project) continue;
      out.push({
        agent,
        sub_hash: row.sub_hash,
        parent_session_id: row.parent_session_id,
        status: row.status,
        heartbeat_age_ms: typeof hb.mtime_ms === 'number' ? now - hb.mtime_ms : null,
      });
    }
  }
  return out;
}

/**
 * Return the most-recent heartbeat-file mtime (ms since epoch) ACROSS all
 * three agents for the given project. The statusline uses this in place of
 * the 2026-05-24 mitigation's re-walk of `<parent>/subagents/`.
 *
 * Returns 0 when no fresh sub-agent is registered for the project. This is
 * the signal `combined-status-line.js` uses to OMIT the `subMt` field from
 * `combined-status-line-projects.json` per the D-Statusline cleanup spec.
 *
 * NB: uses the heartbeat FILE mtime (the daemon rewrites it every 30s, so
 * a fresh file means the daemon is alive AND saw activity in the last
 * heartbeat window), NOT the `last_heartbeat_at` field inside the JSON.
 * The file mtime is the canonical "this signal is fresh" timestamp.
 */
export function getProjectSubMt(project, { stateDir = '.data', maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const heartbeats = loadAllHeartbeats({ stateDir, maxAgeMs });
  let maxMt = 0;
  for (const hb of Object.values(heartbeats)) {
    if (!hb || hb.stale) continue;
    const rows = Array.isArray(hb.registry_rows) ? hb.registry_rows : [];
    let hasMatch = false;
    for (const row of rows) {
      if (!row || row.status !== 'running') continue;
      if (row.project !== undefined && row.project !== null && row.project !== project) continue;
      hasMatch = true;
      break;
    }
    if (!hasMatch) continue;
    if (typeof hb.mtime_ms === 'number' && hb.mtime_ms > maxMt) maxMt = hb.mtime_ms;
  }
  return maxMt;
}

/** Exported for tests + downstream introspection. */
export { HEARTBEAT_FILES, DEFAULT_MAX_AGE_MS };
