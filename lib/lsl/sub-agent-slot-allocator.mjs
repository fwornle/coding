/**
 * lib/lsl/sub-agent-slot-allocator.mjs — per-day, per-parent-session slot
 * allocator for D-LSL-Filename sub-agent LSL files (Phase 51 Plan 06).
 *
 * The D-LSL-Filename convention (CONTEXT.md):
 *   {YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}[-part{N}].md
 *
 * `S{parent-slot}` is 1-indexed and assigned per active parent session
 * within the local LSL day. Across days the counter resets — each day's
 * dictionary keys parents in first-touch order. The allocator persists
 * this mapping to a JSON file (default `.data/sub-agent-slot-state.json`)
 * so repeated invocations of the writer produce stable slot assignments
 * (idempotency) and survive process restarts.
 *
 * Storage shape:
 *   {
 *     "2026-05-23": { "<parent-uuid-1>": 1, "<parent-uuid-2>": 2, ... },
 *     "2026-05-24": { "<parent-uuid-X>": 1, ... }
 *   }
 *
 * Atomic write semantics (T-51-06-CR): writes go through a `<path>.tmp`
 * sibling + `fs.renameSync` swap — matches Plan 50-03's lsl-resolver-job.sh
 * state-file pattern. A mid-rename crash leaves the original file intact
 * (Test 7 locks the behavior).
 *
 * Per CLAUDE.md no-console-log rule: this module emits no console calls;
 * crash signaling propagates via thrown errors.
 *
 * Pure ESM. Zero new package installs.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Default state-file path. Callers may override via `statePath` option.
 * Resolved relative to process.cwd() (matches the writer CLI's working dir).
 */
export const DEFAULT_STATE_PATH = path.join('.data', 'sub-agent-slot-state.json');

/**
 * Load the persisted slot-state JSON.
 *
 * Returns `{}` when the file does not exist (ENOENT) — this is the
 * cold-start case, not an error. Re-throws any other I/O or parse error
 * so corruption surfaces to the operator rather than silently degrading.
 *
 * @param {object} opts
 * @param {string} [opts.statePath]   Path to state file. Defaults to
 *                                    DEFAULT_STATE_PATH.
 * @returns {Record<string, Record<string, number>>}
 */
export function loadSlotState({ statePath = DEFAULT_STATE_PATH } = {}) {
  let text;
  try {
    text = fs.readFileSync(statePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
  if (!text || !text.trim()) return {};
  return JSON.parse(text);
}

/**
 * Persist the slot-state map atomically.
 *
 * Strategy (matches Plan 50-03's `.tmp + rename` pattern):
 *   1. Serialize via JSON.stringify(state, null, 2) for human-readable diffs.
 *   2. Write to `${statePath}.tmp` via writeFileSync (creates parent dir if needed).
 *   3. fs.renameSync(tmp, statePath) — atomic on POSIX.
 *
 * If step 3 throws (Test 7's simulated crash), the original file at
 * `statePath` is untouched — the tmp sibling is left behind for forensic
 * inspection and the thrown error propagates to the caller.
 *
 * @param {object} opts
 * @param {string} opts.statePath
 * @param {object} opts.state
 */
export function saveSlotState({ statePath = DEFAULT_STATE_PATH, state } = {}) {
  if (state == null || typeof state !== 'object') {
    throw new TypeError('saveSlotState: state must be an object');
  }
  // Ensure parent directory exists.
  const parentDir = path.dirname(statePath);
  if (parentDir && parentDir !== '.' && !fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  const tmpPath = `${statePath}.tmp`;
  // 2-space indent per Test 8.
  const text = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpPath, text, 'utf-8');
  // Atomic swap. Throws propagate; tmp file remains on disk for forensics.
  fs.renameSync(tmpPath, statePath);
}

/**
 * Allocate (or retrieve) the slot for a (dateKey, parentSessionId) pair.
 *
 * Semantics:
 *  - If no entry exists for dateKey, create it as an empty object.
 *  - If parentSessionId is already keyed for that day, return the existing
 *    slot (idempotent — Test 3).
 *  - Otherwise compute `slot = Object.keys(state[dateKey]).length + 1` and
 *    store it. This makes slot numbers stable for a given (dateKey,
 *    parentSessionId) regardless of how many times the function is called.
 *
 * Mutates `state` in place; returns the assigned slot number.
 *
 * @param {Record<string, Record<string, number>>} state
 * @param {string} parentSessionId
 * @param {string} dateKey   'YYYY-MM-DD' (caller is responsible for
 *                           computing local LSL day; the allocator is
 *                           date-format-agnostic — it only uses dateKey
 *                           as a string key).
 * @returns {number}         1-indexed slot.
 */
export function allocateSlot(state, parentSessionId, dateKey) {
  if (state == null || typeof state !== 'object') {
    throw new TypeError('allocateSlot: state must be an object');
  }
  if (!parentSessionId || typeof parentSessionId !== 'string') {
    throw new TypeError('allocateSlot: parentSessionId must be a non-empty string');
  }
  if (!dateKey || typeof dateKey !== 'string') {
    throw new TypeError('allocateSlot: dateKey must be a non-empty string');
  }
  if (!state[dateKey]) {
    state[dateKey] = {};
  }
  if (Object.prototype.hasOwnProperty.call(state[dateKey], parentSessionId)) {
    return state[dateKey][parentSessionId];
  }
  const slot = Object.keys(state[dateKey]).length + 1;
  state[dateKey][parentSessionId] = slot;
  return slot;
}
