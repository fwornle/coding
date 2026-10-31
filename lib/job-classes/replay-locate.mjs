/**
 * Find the turns a replay can use (.planning/shared-job-classes.md, P4).
 *
 * ONE KEY, EVERY AGENT. A label, the proxy's turn record and the repo capture are
 * all keyed by the proxy's turn identity (conversation_key, turn_index), which it
 * derives the same way for claude, copilot, opencode and pi. So the join is exact
 * and needs no agent's on-disk transcript:
 *
 *   turn_job_class (the label)
 *     → turns/<conversation>-t<turn>.json   the prompt and the conversation before it
 *                                           (rapid-llm-proxy proxy-bridge/turn-record.mjs)
 *     → kept/<class>/<conversation>-t<turn>/ the repo at turn start (turn-capture.mjs)
 *
 * WHAT MAKES A TURN UNUSABLE (each a reason on the candidate, never a silent drop):
 * no record (labelled before the proxy kept records, or a class it does not keep),
 * the prompt carried an image, there is no capture, or the capture is incomplete.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { KNOWN_AGENTS } from '../kgbench/agents.mjs';
import { captureOf, replayRoot, turnName } from './turn-capture.mjs';

const require = createRequire(import.meta.url);
const dataHome = require('../paths/data-home.cjs');

function openDb(opts = {}) {
  const file = opts.tokenDb || dataHome.tokenUsageDb(opts);
  if (!fs.existsSync(file)) throw new Error(`no token database at ${file}`);
  const Database = require('better-sqlite3');
  return new Database(file, { readonly: true, fileMustExist: true });
}

/**
 * Labelled turns of the given classes, every agent's, each with the model that
 * answered it (the turn's last call: a turn's first call may be a cheaper utility
 * request).
 *
 * The model lookup restates `conversation_key != ''`: idx_token_usage_turn is
 * PARTIAL on that predicate, and the planner only uses a partial index whose
 * predicate the query proves (otherwise it scans the whole table once per label).
 *
 * @returns {Array<{conversationKey, turnIndex, jobClass, teacherClass, taxonomy, agent, project, labelledAt, preview, model}>}
 */
export function labelledTurns({ classes, agent, since, ...opts } = {}) {
  const db = opts.db || openDb(opts);
  try {
    const where = ['1 = 1'];
    const args = [];
    if (agent) { where.push('agent = ?'); args.push(agent); }
    if (classes?.length) { where.push(`job_class IN (${classes.map(() => '?').join(',')})`); args.push(...classes); }
    if (since) { where.push('labelled_at >= ?'); args.push(since); }
    const labels = db.prepare(`SELECT conversation_key, turn_index, job_class, teacher_class, taxonomy, agent, project,
      labelled_at, prompt_preview FROM turn_job_class WHERE ${where.join(' AND ')} ORDER BY labelled_at`).all(...args);
    const model = db.prepare(`SELECT model FROM token_usage INDEXED BY idx_token_usage_turn
      WHERE conversation_key = ? AND conversation_key != '' AND turn_index = ? AND model != ''
      ORDER BY timestamp DESC LIMIT 1`);
    return labels.map((l) => ({
      conversationKey: l.conversation_key, turnIndex: l.turn_index, jobClass: l.job_class,
      teacherClass: l.teacher_class || null, taxonomy: l.taxonomy, agent: l.agent, project: l.project,
      labelledAt: l.labelled_at, preview: l.prompt_preview,
      model: model.get(l.conversation_key, l.turn_index)?.model || null,
    }));
  } finally {
    if (!opts.db) db.close();
  }
}

/** The proxy's record of a turn, or null. */
export function readRecord(conversationKey, turnIndex, opts = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(replayRoot(opts), 'turns', `${turnName(conversationKey, turnIndex)}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Why a turn cannot be replayed, or [] when it can. */
export function unusableReasons(label, record, capture, { allowUncaptured = false } = {}) {
  const r = [];
  if (!KNOWN_AGENTS.includes(label.agent)) r.push(`no replay adapter for agent '${label.agent || '?'}'`);
  if (!record) return [...r, 'no turn record (labelled before the proxy kept records, or a class it does not keep)'];
  if (record.image) r.push('prompt carries an image');
  if (!String(record.prompt || '').trim()) r.push('the record has no prompt');
  if (!capture && !allowUncaptured) r.push('no capture of the repo at turn start');
  if (capture && !capture.meta.complete) r.push(`capture incomplete: ${capture.meta.reasons.join('; ')}`);
  return r;
}

/**
 * Every labelled turn of the classes, with its record and capture, judged usable or not.
 *
 * @returns {Array<{label: object, record: object|null, capture: object|null, reasons: string[]}>}
 */
export function candidates({ classes, days = 14, agent, allowUncaptured = false, ...opts } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return labelledTurns({ classes, agent, since, ...opts }).map((label) => {
    const record = readRecord(label.conversationKey, label.turnIndex, opts);
    const capture = captureOf(label.conversationKey, label.turnIndex, opts);
    return { label, record, capture, reasons: unusableReasons(label, record, capture, { allowUncaptured }) };
  });
}
