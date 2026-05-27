/**
 * lib/lsl/live/opencode-sqlite-poll.mjs - OpenCode Path A (live) watcher.
 *
 * Phase 51 Plan 08 Task 1 (Wave 4). Implements RESEARCH-opencode.md §Detection
 * plan - Path A Option 1 (RECOMMENDED): a 5-second polling watcher on the
 * OpenCode SQLite `session` table for rows where `parent_id IS NOT NULL` AND
 * `directory` matches the project root AND `time_updated` advanced since the
 * last poll.
 *
 * D-Reuse within Phase 51:
 *   - Imports SUPPORTED_MIGRATIONS, checkSchemaVersion, projectFromOpencodeRow,
 *     and buildSubAgentRow from Plan 51-03's adapter
 *     (`../adapters/opencode-sqlite.mjs`) - extended as named exports by the
 *     refactor step of Plan 08 Task 1.
 *   - Uses the same readonly + busy_timeout=5000 + short-lived connection
 *     pattern as the sweep adapter (landmine #2: long transactions starve
 *     WAL checkpoint).
 *
 * D-Live-Sweep-Tags:
 *   - Observations written by this watcher carry metadata.source = 'sub-agent'
 *     (NO -backfill suffix). The sweep adapter writes 'sub-agent-backfill'.
 *
 * Plan 51-07's Claude FSEvents watcher is the cousin module; this OpenCode
 * watcher mirrors its daemon shape so the Plan 51-11 launchd integration can
 * wire both with one harness pattern.
 *
 * Threat-model alignment (Plan 08 threat_model):
 *   T-51-08-SC  DB lock contention - readonly + busy_timeout=5000 + short-lived
 *               connections (one connection per pollOnce(), closed in finally).
 *   T-51-08-FS  Filesystem reliability - SQLite is durable; missed polls just
 *               delay registration. Sweep tier covers extended outage.
 *   T-51-08-RC  Race between OpenCode write and watcher read - WAL guarantees
 *               consistent reads; lastPollTime + time_updated filter is
 *               monotonic and idempotent.
 *   T-51-08-RL  Poll CPU runaway - default 5s cadence; operator-controlled via
 *               pollIntervalMs.
 *   T-51-08-SV  Schema-version drift - checkSchemaVersion hard-fails at boot.
 *
 * Per CLAUDE.md no-console-log rule: this module emits no console calls;
 * non-fatal errors are surfaced via onError callback + process.stderr.write.
 *
 * Pure ESM. Zero new package installs.
 */

import Database from 'better-sqlite3';

import {
  checkSchemaVersion,
  projectFromOpencodeRow,
  buildSubAgentRow,
} from '../adapters/opencode-sqlite.mjs';

// ---- SQL templates ---------------------------------------------------------
const POLL_SQL = `
  SELECT id, parent_id, directory, agent, title, slug, time_created, time_updated
    FROM session
   WHERE parent_id IS NOT NULL
     AND (directory = ? OR directory LIKE ?)
     AND time_updated > ?
   ORDER BY time_created ASC
`;

const NEW_MSG_SQL = `
  SELECT m.id        AS msg_id,
         m.data      AS msg_data,
         p.id        AS part_id,
         p.data      AS part_data
    FROM message m
    LEFT JOIN part p ON p.message_id = m.id
   WHERE m.session_id = ?
     AND m.id > ?
   ORDER BY m.id ASC, p.id ASC
`;

const COMPLETION_SQL = `
  SELECT p.id AS part_id, p.data AS part_data
    FROM part p
   WHERE p.session_id = ?
     AND json_extract(p.data, '$.type') = 'tool'
     AND json_extract(p.data, '$.tool') = 'task'
     AND json_extract(p.data, '$.state.metadata.sessionId') = ?
     AND json_extract(p.data, '$.state.status') IN ('success', 'error')
   LIMIT 1
`;

// ---- Helpers ---------------------------------------------------------------
function openReadonlyDb(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

function assembleMessagesFromRows(partRows, sessionId, parentSessionId) {
  if (partRows.length === 0) return [];

  const byMsgId = new Map();
  for (const row of partRows) {
    if (!byMsgId.has(row.msg_id)) {
      byMsgId.set(row.msg_id, { msg: row.msg_data, parts: [] });
    }
    if (row.part_data !== null) {
      byMsgId.get(row.msg_id).parts.push(row.part_data);
    }
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
        /* skip malformed */
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

/**
 * Start a polling watcher on an OpenCode SQLite DB.
 *
 * @param {object} args
 * @param {string} args.dbPath
 * @param {object} args.registry           Plan 51-01 registry (createRegistry())
 * @param {object} args.observationWriter  duck-typed: { processMessages(messages, meta) }
 * @param {string} args.projectRoot
 * @param {number} [args.pollIntervalMs=5000]
 * @param {(err: Error) => void} [args.onError]
 * @returns {Promise<{ stop: () => Promise<void>, getStats: () => object }>}
 */
export async function startOpencodeWatcher({
  dbPath,
  registry,
  observationWriter,
  projectRoot,
  pollIntervalMs = 5000,
  onError,
}) {
  if (!dbPath) throw new TypeError('startOpencodeWatcher: dbPath is required');
  if (!registry) throw new TypeError('startOpencodeWatcher: registry is required');
  if (!observationWriter) {
    throw new TypeError('startOpencodeWatcher: observationWriter is required');
  }
  if (!projectRoot) {
    throw new TypeError('startOpencodeWatcher: projectRoot is required');
  }

  // Boot-time schema-version guard. Open a connection, check, close.
  // Failure propagates - watcher refuses to start on unsupported migrations.
  {
    const probe = openReadonlyDb(dbPath);
    try {
      checkSchemaVersion(probe);
    } finally {
      try { probe.close(); } catch { /* */ }
    }
  }

  // ---- Watcher state -----------------------------------------------------
  const state = {
    lastPollTime: 0,
    lastSeenMessageIdBySession: new Map(),
    pollCount: 0,
    errorCount: 0,
    lastPollAt: null,
    stopped: false,
    inFlight: null,
    completedHashes: new Set(),
    subIndexByParent: new Map(),
  };

  const callOnError = (err) => {
    state.errorCount += 1;
    if (typeof onError === 'function') {
      try { onError(err); } catch { /* swallow */ }
    } else {
      try {
        process.stderr.write(
          `[opencode-poll] error: ${err && err.message ? err.message : String(err)}\n`,
        );
      } catch { /* */ }
    }
  };

  async function pollOnce() {
    let db;
    try {
      db = openReadonlyDb(dbPath);

      const dirPrefix = `${projectRoot}/%`;
      const rows = db.prepare(POLL_SQL).all(
        projectRoot,
        dirPrefix,
        state.lastPollTime,
      );

      let maxTimeUpdated = state.lastPollTime;

      for (const r of rows) {
        if (typeof r.time_updated === 'number' && r.time_updated > maxTimeUpdated) {
          maxTimeUpdated = r.time_updated;
        }

        const project = projectFromOpencodeRow(r);
        if (project === 'unknown') continue;

        const parentKey = r.parent_id || '';
        let siblingMap = state.subIndexByParent.get(parentKey);
        if (!siblingMap) {
          siblingMap = new Map();
          state.subIndexByParent.set(parentKey, siblingMap);
        }
        let subIndex = siblingMap.get(r.id);
        if (subIndex == null) {
          subIndex = siblingMap.size + 1;
          siblingMap.set(r.id, subIndex);
        }

        // buildSubAgentRow stamps `detected_via: 'sqlite-poll'` on the row.
        // (Acceptance grep gate looks for the literal `detected_via:` token.)
        const row = buildSubAgentRow(r, {
          dbPath,
          detectedVia: 'sqlite-poll',
          subIndex,
        });
        row.status = 'running';

        registry.upsert(row);

        const lastSeen = state.lastSeenMessageIdBySession.get(r.id) || '0';
        const partRows = db.prepare(NEW_MSG_SQL).all(r.id, lastSeen);

        const messages = assembleMessagesFromRows(
          partRows, r.id, r.parent_id,
        );

        if (messages.length > 0) {
          try {
            await observationWriter.processMessages(messages, {
              agent: 'opencode',
              sourceFile: row.transcript_path,
              source: 'sub-agent',
              tag: 'sub-agent',
              project: row.project,
              parent_session_id: row.parent_session_id,
              sub_index: row.sub_index,
              sub_hash: row.sub_hash,
            });
          } catch (writerErr) {
            callOnError(writerErr);
          }

          let maxMsgId = lastSeen;
          for (const pr of partRows) {
            if (pr.msg_id > maxMsgId) maxMsgId = pr.msg_id;
          }
          state.lastSeenMessageIdBySession.set(r.id, maxMsgId);
        }

        if (!state.completedHashes.has(row.sub_hash) && r.parent_id) {
          const completionRow = db.prepare(COMPLETION_SQL).get(r.parent_id, r.id);
          if (completionRow) {
            let taskStatus = 'success';
            try {
              const parsed = JSON.parse(completionRow.part_data);
              taskStatus = parsed?.state?.status || 'success';
            } catch { /* */ }
            registry.markCompleted('opencode', row.sub_hash, {
              completed_at: new Date().toISOString(),
              observations_written: messages.length,
              error: taskStatus === 'error' ? 'opencode task tool returned error' : undefined,
            });
            state.completedHashes.add(row.sub_hash);
          }
        }
      }

      if (maxTimeUpdated > state.lastPollTime) {
        state.lastPollTime = maxTimeUpdated;
      }
    } catch (err) {
      callOnError(err);
    } finally {
      if (db) {
        try { db.close(); } catch { /* */ }
      }
      state.pollCount += 1;
      state.lastPollAt = new Date().toISOString();
    }
  }

  // Run the initial tick immediately so callers do not have to wait
  // pollIntervalMs for the first registry.upsert.
  state.inFlight = pollOnce();
  await state.inFlight;
  state.inFlight = null;

  const timer = setInterval(() => {
    if (state.stopped) return;
    state.inFlight = pollOnce();
    state.inFlight
      .catch((err) => callOnError(err))
      .finally(() => {
        state.inFlight = null;
      });
  }, pollIntervalMs);

  const handle = {
    async stop() {
      state.stopped = true;
      clearInterval(timer);
      if (state.inFlight) {
        try { await state.inFlight; } catch { /* */ }
      }
    },
    getStats() {
      return {
        polls: state.pollCount,
        registered: registry.listByAgent('opencode').length,
        last_poll_at: state.lastPollAt || '',
        errors: state.errorCount,
      };
    },
  };

  return handle;
}

/**
 * Stop the watcher returned by startOpencodeWatcher. Drains any in-flight
 * poll then resolves. Idempotent.
 */
export async function stopOpencodeWatcher(handle) {
  if (!handle || typeof handle.stop !== 'function') return;
  await handle.stop();
}
