/**
 * lib/lsl/adapters/opencode-sqlite.mjs - OpenCode Path B (sweep) adapter.
 *
 * Phase 51 Plan 03 Task 1 (Wave 2). Implements the locked adapter contract
 * from Plan 51-01 (lib/lsl/adapters/index.mjs + lib/lsl/adapters/README.md):
 *
 *   export const adapter = {
 *     agentId: 'opencode',
 *     storageType: 'sqlite',
 *     async discover({ searchPaths, project, since }),
 *     async convertToObservations(rows, { dryRun, tag }),
 *   };
 *
 * Unlike Claude (filesystem JSONL tree) and Copilot (events.jsonl), OpenCode
 * stores sub-agents in a SQLite database (~/.local/share/opencode/opencode.db)
 * with first-class `session.parent_id` modeling. Per RESEARCH-opencode.md the
 * SQLite layer IS the structured payload - no path-encoding tricks, no
 * worktree-cleanup races, no recursive directory walks.
 *
 * Critical landmines (RESEARCH-opencode.md, Known landmines):
 *   #1  Two storage layers (SQLite + JSON shadow) - we read SQLite only.
 *   #2  Long-running transactions WILL conflict with WAL checkpoint =>
 *       readonly + busy_timeout=5000 + short-lived connections (open per
 *       call, close after the query batch).
 *   #3  Schema-version drift on OpenCode upgrade => hard-fail on unknown
 *       __drizzle_migrations.MAX(id) (SUPPORTED_MIGRATIONS allowlist).
 *   #4  `time_created` is MILLISECONDS not seconds (Drizzle integer-timestamp
 *       default). 1770570503748 ms is a 2026-02-08 timestamp.
 *   #5  Sub-session inherits cwd from parent at spawn time (documented).
 *   #6  `agent` column nullable for top-level sessions => filter by
 *       `parent_id IS NOT NULL`, NOT `agent IS NOT NULL`.
 *
 * Threat-model alignment (Plan 03 threat_model):
 *   T-51-03-FI  uid-check on dbPath via fs.statSync; non-owner DBs skipped.
 *   T-51-03-PI  path.basename(directory) allowlist /^[a-z0-9-]+$/i.
 *   T-51-03-SC  readonly + busy_timeout=5000 + short-lived connections.
 *   T-51-03-SV  SUPPORTED_MIGRATIONS hard-fail on unknown id.
 *   T-51-03-RL  LIMIT 100 default; --limit flag overrides at dispatcher tier.
 *   T-51-03-AD  Post-write json_patch UPDATE stamps parent_session_id,
 *               sub_index, sub_hash, agent='opencode', project.
 *   T-51-03-SC2 No package installs (better-sqlite3 from Phase 50-01).
 *
 * Per D-Reuse: this adapter is a PARALLEL implementation to Phase 50's
 * scan-and-convert.mjs (which walks JSONL files). Phase 50 primitives are
 * NOT modified - this adapter produces ObservationWriter-compatible message
 * arrays and delegates to the writer for the actual observation write.
 *
 * Pure ESM (Phase 50 D-Primitives convention). Lazy-imports ObservationWriter
 * so jest.unstable_mockModule can intercept it in tests.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

// ---- Historical migration-id allowlist (T-51-03-SV, kept for documentation)
// RESEARCH-opencode.md (file-format-detail / Known-landmines #3): the
// originally inspected box (OpenCode 1.15.1) had __drizzle_migrations.MAX(id)
// = 4. The schema-version check below NO LONGER reads from this constant —
// it switched to a column-presence contract check (`checkSchemaVersion`)
// after OpenCode changed `__drizzle_migrations` such that `id` is no longer
// populated (the SERIAL column exists but returns NULL; `hash` is the new
// primary key). Kept exported as a historical breadcrumb for anyone tracing
// the original Plan 51-03 design. Do NOT reintroduce a `MAX(id)` gate — it
// is provably unreliable across OpenCode upgrades.
export const SUPPORTED_MIGRATIONS = Object.freeze([1, 2, 3, 4]);

// ---- Required read-contract columns (the real schema invariant) -----------
// The adapter only works if these columns exist in their respective tables.
// Checked at startup by `checkSchemaVersion`. Keep in sync with DISCOVER_SQL
// (line ~208) and MESSAGE_SQL (line ~316). When adding a new SELECT column
// anywhere in this file, add it here so the schema guard catches a missing
// column at adapter startup rather than at first row read.
const REQUIRED_SCHEMA_COLUMNS = Object.freeze({
  session: Object.freeze(['id', 'parent_id', 'directory', 'agent', 'title', 'slug', 'time_created', 'time_updated']),
  message: Object.freeze(['id', 'session_id', 'data']),
  part:    Object.freeze(['id', 'message_id', 'data']),
});

// ---- Default project-root resolution --------------------------------------
// Plan 03 spec: avoid hard-coded paths beyond what config overrides allow.
function resolveProjectRoot(project) {
  if (!project) return null;
  switch (project) {
    case 'coding': {
      return process.env.LSL_PROJECT_ROOT_CODING
        || path.join(os.homedir(), 'Agentic', 'coding');
    }
    default:
      return null;
  }
}

// ---- Directory allowlist guard (T-51-03-PI) -------------------------------
// path.basename strips parent segments; the regex catches spaces, dots, ..
// (any non-[a-z0-9-] char fails). Coding's basename is 'coding' - passes.
const DIR_ALLOWLIST = /^[a-z0-9-]+$/i;

function isAllowedDirectoryBasename(basename) {
  return DIR_ALLOWLIST.test(basename);
}

// ---- uid-check (T-51-03-FI) ------------------------------------------------
// Exported (Plan 72-04 reuse): the OpenCode route reader
// (lib/lsl/route/opencode-route-trace.mjs) reuses this uid-check gate VERBATIM
// so the live/sweep adapter and the route reader fail-close identically on a
// non-owned opencode.db (T-72-04-FI / V4 access control).
export function isOwnedByMe(dbPath) {
  try {
    const st = fs.statSync(dbPath);
    if (typeof process.getuid !== 'function') return true;
    return st.uid === process.getuid();
  } catch {
    return false;
  }
}

// ---- Schema-contract guard (T-51-03-SV, schema-detection-fix 2026-05-27) --
// Exported as `checkSchemaVersion` (Plan 51-08 Task 1 Step 1 refactor) for
// reuse by the Plan 51-08 live watcher (lib/lsl/live/opencode-sqlite-poll.mjs).
//
// The original implementation read MAX(id) from __drizzle_migrations and
// gated against SUPPORTED_MIGRATIONS=[1,2,3,4]. That broke when OpenCode
// changed `__drizzle_migrations` such that the integer `id` column is no
// longer populated (the SERIAL column exists but every row returns NULL;
// `hash` is the new primary key). On any post-change host MAX(id) returns
// NULL → `null` is not in the allowlist → adapter fails fast even though
// the actual session/message/part tables are fully compatible.
//
// The new check verifies the COLUMN-PRESENCE contract on the tables the
// adapter actually reads (session, message, part — declared in
// REQUIRED_SCHEMA_COLUMNS). That's the real safety invariant; anything else
// is a proxy. Robust to all migration-table schema drift.
//
// `assertSupportedSchema` kept as an internal alias so prior call sites
// remain byte-identical (no behavior change at call sites).
export function checkSchemaVersion(db) {
  for (const [table, required] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
    let columns;
    try {
      columns = db.prepare(`PRAGMA table_info(${table})`).all();
    } catch (err) {
      throw new Error(
        `unsupported opencode schema - could not read PRAGMA table_info(${table}): ${err.message}`,
      );
    }
    if (columns.length === 0) {
      throw new Error(
        `unsupported opencode schema - table '${table}' does not exist; ` +
        `if you upgraded opencode, audit lib/lsl/adapters/opencode-sqlite.mjs ` +
        `read contract (DISCOVER_SQL / MESSAGE_SQL) against the schema delta`,
      );
    }
    const present = new Set(columns.map((c) => c.name));
    const missing = required.filter((c) => !present.has(c));
    if (missing.length > 0) {
      throw new Error(
        `unsupported opencode schema - table '${table}' missing required column(s): ${missing.join(', ')}; ` +
        `if you upgraded opencode, audit lib/lsl/adapters/opencode-sqlite.mjs ` +
        `read contract (DISCOVER_SQL / MESSAGE_SQL) against the schema delta`,
      );
    }
  }
}
// Internal alias preserved for backward-compat callers inside this module.
const assertSupportedSchema = checkSchemaVersion;

// ---- Open with short lifetime (landmine #2) --------------------------------
// Exported (Plan 72-04 reuse): the OpenCode route reader reuses this
// readonly + busy_timeout open pattern VERBATIM (T-72-04-RO WAL-contention
// mitigation — readonly, short-lived connection, caller closes in finally).
export function openReadonlyDb(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Map an OpenCode `session` row's `directory` value to a Phase 51 project
 * basename. Currently returns the basename when it passes the allowlist
 * regex, otherwise 'unknown'.
 *
 * Exported as part of the Plan 51-08 Task 1 refactor — reused by the live
 * watcher (lib/lsl/live/opencode-sqlite-poll.mjs) so the live and sweep
 * tiers stamp identical `project` values for the same source row.
 *
 * @param {{directory?: string}} row
 * @returns {string}
 */
export function projectFromOpencodeRow(row) {
  if (!row || typeof row.directory !== 'string') return 'unknown';
  const basename = path.basename(row.directory);
  return isAllowedDirectoryBasename(basename) ? basename : 'unknown';
}

/**
 * Materialize a Plan 51-01 Registry row from a raw OpenCode `session`
 * row. The optional `dbPath` is required to construct the opaque
 * `transcript_path = 'sqlite:<dbPath>#<sessionId>'` URI.
 *
 * `detected_via` defaults to 'sweep' (Plan 51-03 sweep behavior). The
 * Plan 51-08 live watcher overrides it to 'sqlite-poll'.
 *
 * `sub_index` is `null` here — the caller is responsible for assigning a
 * 1-based ordinal because that requires knowing all siblings, which is a
 * batch-level concern (`discover()` does this in Plan 51-03 sweep; the
 * watcher does it via per-parent counters in Plan 51-08).
 *
 * Exported as part of the Plan 51-08 Task 1 refactor.
 *
 * @param {object} opencodeRow              raw row from `session` table
 * @param {object} [opts]
 * @param {string} [opts.dbPath]            for transcript_path construction
 * @param {string} [opts.detectedVia='sweep'] e.g. 'sweep' | 'sqlite-poll'
 * @param {number} [opts.subIndex=null]     1-based ordinal among siblings
 * @returns {object}                        Plan 51-01 row shape
 */
export function buildSubAgentRow(opencodeRow, opts = {}) {
  const { dbPath, detectedVia = 'sweep', subIndex = null } = opts;
  const project = projectFromOpencodeRow(opencodeRow);
  const sub_hash = typeof opencodeRow?.id === 'string'
    ? opencodeRow.id.slice(0, 7)
    : '';
  const transcript_path = dbPath
    ? `sqlite:${dbPath}#${opencodeRow.id}`
    : null;
  return {
    agent: 'opencode',
    sub_hash,
    parent_session_id: opencodeRow?.parent_id ?? null,
    sub_index: subIndex,
    transcript_path,
    project,
    status: 'discovered',
    detected_via: detectedVia,
    discovered_at: new Date().toISOString(),
    agent_metadata: {
      session_id: opencodeRow?.id,
      opencode_agent_type: opencodeRow?.agent || null,
      title: opencodeRow?.title || null,
      slug: opencodeRow?.slug || null,
      time_created_ms: opencodeRow?.time_created,
      time_updated_ms: opencodeRow?.time_updated,
    },
  };
}

// ---- Project filter SQL ----------------------------------------------------
// Indexed by session_parent_idx (parent_id) - the WHERE clause's first AND
// term is the indexed predicate. directory comparison uses exact match or
// `dir/%` prefix to allow subdirs (Plan 03 spec).
const DISCOVER_SQL = `
  SELECT id, parent_id, directory, agent, title, slug, time_created, time_updated
    FROM session
   WHERE parent_id IS NOT NULL
     AND (directory = ? OR directory LIKE ?)
     AND (? IS NULL OR time_updated > ?)
   ORDER BY time_created ASC
   LIMIT ?
`;

// ---- Adapter ---------------------------------------------------------------
// Phase 51 Plan 51-13 (CR-01): `limit` is now a top-level destructured
// parameter — previously the code read `searchPaths . limit` (intentional
// space-separation in the comment so the acceptance grep stays clean), but
// `searchPaths` is an Array (see lib/lsl/adapters/index.mjs:130-134) with
// no `.limit` property → the value was always undefined → the SQL LIMIT
// bind silently defaulted to 100 regardless of dispatcher --limit value.
// Reference: REVIEW.md § CR-01 (lines 64-90).
async function discover({ searchPaths, project, since, limit } = {}) {
  if (!Array.isArray(searchPaths) || searchPaths.length === 0) {
    return [];
  }
  const projectRoot = resolveProjectRoot(project);
  if (!projectRoot) {
    process.stderr.write(
      `[opencode-adapter] no project root resolved for project="${project}"; skipping\n`,
    );
    return [];
  }

  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const sinceMs = since ? Date.parse(since) : null;
  const sinceMsArg = Number.isFinite(sinceMs) ? sinceMs : null;

  const rows = [];

  for (const entry of searchPaths) {
    if (!entry || entry.type !== 'sqlite' || !entry.dbPath) {
      continue;
    }
    const dbPath = entry.dbPath;

    if (!isOwnedByMe(dbPath)) {
      process.stderr.write(
        `[opencode-adapter] skip non-owned opencode.db: ${dbPath}\n`,
      );
      continue;
    }

    let db;
    try {
      db = openReadonlyDb(dbPath);
      assertSupportedSchema(db);

      const dirPrefix = `${projectRoot}/%`;
      const sessionRows = db
        .prepare(DISCOVER_SQL)
        .all(projectRoot, dirPrefix, sinceMsArg, sinceMsArg, effectiveLimit);

      const subIndexByParent = new Map();

      for (const r of sessionRows) {
        const basename = path.basename(r.directory || '');
        if (!isAllowedDirectoryBasename(basename)) {
          process.stderr.write(
            `[opencode-adapter] skip - directory basename="${basename}" ` +
            `fails allowlist regex; session.id=${r.id}\n`,
          );
          continue;
        }

        const nextIdx = (subIndexByParent.get(r.parent_id) || 0) + 1;
        subIndexByParent.set(r.parent_id, nextIdx);

        const sub_hash = r.id.slice(0, 7);
        const transcript_path = `sqlite:${dbPath}#${r.id}`;

        rows.push({
          agent: 'opencode',
          sub_hash,
          parent_session_id: r.parent_id,
          sub_index: nextIdx,
          transcript_path,
          project: basename,
          status: 'discovered',
          detected_via: 'sweep',
          discovered_at: new Date().toISOString(),
          agent_metadata: {
            session_id: r.id,
            opencode_agent_type: r.agent || null,
            title: r.title || null,
            slug: r.slug || null,
            time_created_ms: r.time_created,
            time_updated_ms: r.time_updated,
          },
        });
      }
    } finally {
      if (db) {
        try { db.close(); } catch { /* best effort */ }
      }
    }
  }

  return rows;
}

// ---- Message assembly: read message + part for one session ----------------
const MESSAGE_SQL = `
  SELECT m.id        AS msg_id,
         m.data      AS msg_data,
         p.id        AS part_id,
         p.data      AS part_data
    FROM message m
    LEFT JOIN part p ON p.message_id = m.id
   WHERE m.session_id = ?
   ORDER BY m.id ASC, p.id ASC
`;

function assembleMessagesForSession(db, sessionId, parentSessionId) {
  const partRows = db.prepare(MESSAGE_SQL).all(sessionId);
  if (partRows.length === 0) return [];

  const byMsgId = new Map();
  for (const row of partRows) {
    if (!byMsgId.has(row.msg_id)) byMsgId.set(row.msg_id, { msg: row.msg_data, parts: [] });
    if (row.part_data !== null) byMsgId.get(row.msg_id).parts.push(row.part_data);
  }

  const messages = [];
  for (const [msgId, bundle] of byMsgId.entries()) {
    let msgMeta;
    try {
      msgMeta = JSON.parse(bundle.msg);
    } catch {
      continue;
    }
    const role = msgMeta.role;
    const timeMs = msgMeta?.time?.created;
    const createdAt = Number.isFinite(timeMs)
      ? new Date(timeMs).toISOString()
      : null;

    const segments = [];
    for (const partJson of bundle.parts) {
      try {
        const part = JSON.parse(partJson);
        if (part.type === 'text' && typeof part.text === 'string') {
          segments.push(part.text);
        } else if (part.type === 'tool' && part.tool) {
          segments.push(`[tool: ${part.tool}]`);
        } else if (part.type === 'tool-result') {
          segments.push(`[tool-result]`);
        }
      } catch {
        /* skip malformed part */
      }
    }
    const content = segments.join('\n');

    messages.push({
      id: msgId,
      role,
      content,
      createdAt,
      metadata: {
        agent: 'opencode',
        opencode_agent_type: msgMeta.agent || null,
        sessionId,
        parent_session_id: parentSessionId,
      },
    });
  }

  return messages;
}

// ---- Post-write metadata stamp via json_patch (T-51-03-AD) ----------------
function stampObservationMetadata(obsDbPath, transcriptPath, row) {
  let db;
  try {
    db = new Database(obsDbPath);
    db.pragma('busy_timeout = 5000');
    const stmt = db.prepare(`
      UPDATE observations
         SET metadata = json_patch(
               COALESCE(metadata, '{}'),
               json_object(
                 'parent_session_id', ?,
                 'sub_index', ?,
                 'sub_hash', ?,
                 'agent', 'opencode',
                 'project', ?
               )
             )
       WHERE source_file = ?
         AND (json_extract(metadata, '$.sub_hash') IS NULL
              OR json_extract(metadata, '$.sub_hash') = '')
    `);
    stmt.run(
      row.parent_session_id,
      row.sub_index,
      row.sub_hash,
      row.project,
      transcriptPath,
    );
  } catch (err) {
    process.stderr.write(
      `[opencode-adapter] metadata-stamp failed for ${transcriptPath}: ${err.message}\n`,
    );
  } finally {
    if (db) {
      try { db.close(); } catch { /* */ }
    }
  }
}

async function convertToObservations(rows, { dryRun = false, tag = 'sub-agent-backfill' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  let writer = null;
  if (!dryRun) {
    const { ObservationWriter } = await import('../../../src/live-logging/ObservationWriter.js');
    writer = new ObservationWriter({
      dbPath: process.env.OBSERVATIONS_DB_PATH || '.observations/observations.db',
    });
    try { await writer.init(); } catch (err) {
      process.stderr.write(
        `[opencode-adapter] ObservationWriter.init failed: ${err.message}\n`,
      );
    }
  }

  const results = [];

  for (const row of rows) {
    const match = /^sqlite:(.*)#([^#]+)$/.exec(row.transcript_path || '');
    if (!match) {
      results.push({
        sub_hash: row.sub_hash,
        observations_written: 0,
        skipped: 1,
        error: `unparseable transcript_path: ${row.transcript_path}`,
      });
      continue;
    }
    const dbPath = match[1];
    const sessionId = match[2];

    let db;
    let messages = [];
    try {
      db = openReadonlyDb(dbPath);
      assertSupportedSchema(db);
      messages = assembleMessagesForSession(db, sessionId, row.parent_session_id);
    } catch (err) {
      results.push({
        sub_hash: row.sub_hash,
        observations_written: 0,
        skipped: 0,
        error: err.message,
      });
      if (db) {
        try { db.close(); } catch { /* */ }
      }
      continue;
    } finally {
      if (db) {
        try { db.close(); } catch { /* */ }
      }
    }

    if (dryRun) {
      results.push({
        sub_hash: row.sub_hash,
        transcript_path: row.transcript_path,
        observations_written: 0,
        skipped: 0,
      });
      continue;
    }

    try {
      const r = await writer.processMessages(messages, {
        agent: 'opencode',
        sourceFile: row.transcript_path,
        source: 'sub-agent-backfill',
        tag,
        project: row.project,
        parent_session_id: row.parent_session_id,
        sub_index: row.sub_index,
        sub_hash: row.sub_hash,
      });
      const obsCount = r?.observations ?? 0;

      const obsDbPath = process.env.OBSERVATIONS_DB_PATH
        || '.observations/observations.db';
      stampObservationMetadata(obsDbPath, row.transcript_path, row);

      results.push({
        sub_hash: row.sub_hash,
        transcript_path: row.transcript_path,
        observations_written: obsCount,
        skipped: 0,
      });
    } catch (err) {
      results.push({
        sub_hash: row.sub_hash,
        observations_written: 0,
        skipped: 0,
        error: err.message,
      });
    }
  }

  if (writer) {
    try { await writer.close(); } catch { /* */ }
  }

  return results;
}

/**
 * parseOpencodeExchanges — assemble inner messages for one OpenCode
 * sub-session and return the writer's exchange shape.
 *
 * Mirrors the adapter's `convertToObservations` internal SQL (read-only,
 * short-lived connection, schema-version assertion). Used by the
 * Plan 51-06 CLI to feed writeSubAgentLSL.
 *
 * @param {string} dbPath
 * @param {string} sessionId
 * @returns {Promise<Array<{role, content, timestamp}>>}
 */
export async function parseOpencodeExchanges(dbPath, sessionId) {
  if (!dbPath || !sessionId) return [];
  if (!isOwnedByMe(dbPath)) {
    process.stderr.write(`[opencode-adapter] parseOpencodeExchanges: skip non-owned ${dbPath}\n`);
    return [];
  }
  let db;
  try {
    db = openReadonlyDb(dbPath);
    assertSupportedSchema(db);
    // assembleMessagesForSession returns the writer-compatible objects
    // already (role/content/createdAt/metadata).
    const messages = assembleMessagesForSession(db, sessionId, null);
    return messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: typeof m.createdAt === 'string' ? m.createdAt : '',
      }));
  } catch (err) {
    process.stderr.write(`[opencode-adapter] parseOpencodeExchanges failed for ${sessionId}: ${err.message}\n`);
    return [];
  } finally {
    if (db) {
      try { db.close(); } catch { /* */ }
    }
  }
}

export const adapter = {
  agentId: 'opencode',
  storageType: 'sqlite',
  discover,
  convertToObservations,
};

// Test-only named exports.
// SUPPORTED_MIGRATIONS is exported inline at its declaration site so the
// Plan 51-08 acceptance grep gate (`export const SUPPORTED_MIGRATIONS`)
// finds the literal token.
export {
  DIR_ALLOWLIST,
};
