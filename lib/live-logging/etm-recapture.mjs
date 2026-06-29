/**
 * lib/live-logging/etm-recapture.mjs
 *
 * Phase 75 Plan 05 (OBS-02 + OBS-01) — the mid-prompt-set re-capture fire
 * boundary, extracted as a PURE function so it is unit-testable without
 * booting the ETM daemon (Plan 01 locked this target — see
 * tests/live-logging/ETM-recapture.test.js).
 *
 * THE BUG (finding D): ETM's unit-of-observation is the typed-prompt prompt-set,
 * snapshotted once near its start and stamped at the FIRST exchange (T0). A GSD
 * session is one typed prompt → hours of agent work steered by AskUserQuestion.
 * Result for the real `e0af5b8b` case: a session whose last typed prompt was at
 * 2026-06-28T21:00:43Z but which ran overnight with 5 morning AskUserQuestion
 * decisions (05:30–06:03Z) produced 8 observations ALL stamped 21:00:43Z.
 *
 * THE FIX (D-07/D-08/D-09): fire mid-set on
 *   (a) each AskUserQuestion decision boundary (tool_use + matching tool_result),
 *   (b) significant tool-activity batches between decisions
 *       (≥ toolBatchThreshold tool_use blocks OR ≥ timeThresholdMs elapsed
 *        since the last fire within a question-less stretch),
 * stamping each fire's `created_at` with the batch's REAL last-message timestamp
 * (D-08) — NOT the prompt-set start, NOT wall-clock — and carrying the active
 * `task_id` (D-09). A per-transcript `lastFiredExchangeUuid` cursor (advanced to
 * the batch's LAST message uuid, mirroring the existing ETM lastMessageUuid
 * preference) guarantees the next batch starts AFTER the cursor, so no earlier
 * exchange is re-emitted (Pitfall 4). The OBS dedup key is
 * `(task_id, batch-last-message-uuid)`.
 *
 * This module is intentionally side-effect-free: it consumes the raw Claude
 * transcript messages and returns the per-batch observation DESCRIPTORS
 * (`created_at`, `metadata.task_id`, `dedupKey`, `batchLastMessageUuid`,
 * `messages`). The ETM daemon (enhanced-transcript-monitor.js) calls this to
 * decide WHERE to fire, then passes each descriptor's batch-local messages to
 * ObservationWriter so its earliest-`createdAt` resolves to the batch's real
 * time. The persist seam is NOT exercised here.
 *
 * @module etm-recapture
 */

/** Default "significant tool-activity batch" threshold (RESEARCH A4). */
export const DEFAULT_TOOL_BATCH_THRESHOLD = 8;
/** Default time threshold for a question-less stretch (RESEARCH A4): 10 min. */
export const DEFAULT_TIME_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Is this raw transcript message an assistant turn containing an
 * AskUserQuestion tool_use? (the natural operator steering boundary).
 * @param {object} m raw Claude transcript message
 * @returns {boolean}
 */
function isAskUserQuestion(m) {
  return (
    m?.type === 'assistant' &&
    Array.isArray(m.message?.content) &&
    m.message.content.some(
      (c) => c?.type === 'tool_use' && c.name === 'AskUserQuestion',
    )
  );
}

/**
 * Count the tool_use blocks in a raw assistant message (0 for non-assistant).
 * @param {object} m raw Claude transcript message
 * @returns {number}
 */
function countToolUse(m) {
  if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) return 0;
  return m.message.content.filter((c) => c?.type === 'tool_use').length;
}

/**
 * Parse a message timestamp to epoch ms; NaN when absent/unparseable.
 * @param {object} m raw Claude transcript message
 * @returns {number}
 */
function tsMs(m) {
  return Date.parse(m?.timestamp ?? '');
}

/**
 * Build a fire descriptor for a batch of accumulated messages.
 *
 * The batch's `created_at` is the LAST message's timestamp (D-08 — the
 * decision/last-message event time), and the dedup key is keyed off the LAST
 * message uuid (Pitfall 4 — `(task_id, batch-last-message-uuid)`).
 *
 * @param {object[]} batch accumulated raw messages since the last fire
 * @param {string} taskId active task_id (D-09; resolveLiveTaskIdSafe at caller)
 * @returns {object|null} fire descriptor, or null for an empty batch
 */
function makeFire(batch, taskId) {
  if (!batch || batch.length === 0) return null;
  const last = batch[batch.length - 1];
  const batchLastMessageUuid = last?.uuid ?? '';
  // created_at = the batch's REAL last-message timestamp (D-08), never T0.
  const createdAt = new Date(tsMs(last)).toISOString();
  return {
    created_at: createdAt,
    metadata: { task_id: taskId },
    batchLastMessageUuid,
    dedupKey: batchLastMessageUuid,
    messages: batch,
  };
}

/**
 * Compute the per-batch observation fires for a prompt set's messages.
 *
 * Walks the messages in order, accumulating a batch since the last fire, and
 * flushes a fire when EITHER:
 *   (a) an AskUserQuestion decision boundary is reached — the batch is flushed
 *       once the decision's tool_result (or the next message) arrives, so the
 *       batch's last-message timestamp = the decision time;
 *   (b) the accumulated tool_use count reaches `toolBatchThreshold`, OR
 *       `timeThresholdMs` has elapsed (last-message ts − batch-first ts) within
 *       a question-less stretch.
 * Any trailing batch is flushed at the end. Each fire stamps the active
 * `task_id` and advances the `lastFiredExchangeUuid` cursor (Pitfall 4).
 *
 * @param {object[]} messages raw Claude transcript messages (ordered)
 * @param {object} [opts]
 * @param {string} [opts.taskId] active task_id (D-09)
 * @param {number} [opts.toolBatchThreshold] ≥N tool_use → fire (default 8)
 * @param {number} [opts.timeThresholdMs] ≥ms elapsed → fire (default 10 min)
 * @param {string} [opts.lastFiredExchangeUuid] resume cursor — only messages
 *        AFTER this uuid are considered (per-transcript re-capture cursor)
 * @returns {object[]} fire descriptors (created_at, metadata.task_id, dedupKey,
 *                      batchLastMessageUuid, messages)
 */
export function computeRecaptureFires(messages, opts = {}) {
  const taskId = opts.taskId ?? '';
  const toolBatchThreshold = opts.toolBatchThreshold ?? DEFAULT_TOOL_BATCH_THRESHOLD;
  const timeThresholdMs = opts.timeThresholdMs ?? DEFAULT_TIME_THRESHOLD_MS;
  const cursor = opts.lastFiredExchangeUuid ?? null;

  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Re-capture cursor (Pitfall 4): drop everything up to and including the
  // last-fired uuid so a batch is never re-emitted on re-processing.
  let working = messages;
  if (cursor) {
    const idx = messages.findIndex((m) => m?.uuid === cursor);
    working = idx >= 0 ? messages.slice(idx + 1) : messages;
  }
  if (working.length === 0) return [];

  const fires = [];
  let batch = [];
  let batchToolUse = 0;
  let batchFirstMs = NaN;

  /** Flush the current batch as a fire and reset the accumulator. */
  const flush = () => {
    const fire = makeFire(batch, taskId);
    if (fire) fires.push(fire);
    batch = [];
    batchToolUse = 0;
    batchFirstMs = NaN;
  };

  for (const m of working) {
    batch.push(m);
    if (Number.isNaN(batchFirstMs)) batchFirstMs = tsMs(m);
    batchToolUse += countToolUse(m);

    // (a) Decision boundary: an AskUserQuestion turn is a steering point. Flush
    // the batch INCLUDING the decision so the fire is stamped at the decision
    // time (the question's own timestamp is the batch last-message ts).
    if (isAskUserQuestion(m)) {
      flush();
      continue;
    }

    // (b) Significant tool-activity batch within a question-less stretch:
    // ≥ toolBatchThreshold tool_use blocks OR ≥ timeThresholdMs elapsed.
    const lastMs = tsMs(m);
    const elapsed =
      Number.isFinite(batchFirstMs) && Number.isFinite(lastMs)
        ? lastMs - batchFirstMs
        : 0;
    if (batchToolUse >= toolBatchThreshold || elapsed >= timeThresholdMs) {
      flush();
    }
  }

  // Trailing batch (e.g. the post-decision deliverables) — flush so its real
  // event time is captured too.
  if (batch.length > 0) flush();

  // Final dedup safety (Pitfall 4): collapse any fires sharing the same
  // (task_id, batch-last-message-uuid) key — should never trigger given the
  // cursor advance, but guarantees the OBS dedup invariant.
  const seen = new Set();
  const deduped = [];
  for (const f of fires) {
    const key = `${taskId}|${f.batchLastMessageUuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }
  return deduped;
}
