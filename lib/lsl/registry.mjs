/**
 * lib/lsl/registry.mjs — agent-agnostic sub-agent registry (Phase 51 v1).
 *
 * Phase 51 Plan 01 Task 1 (CONTEXT.md Must #2 + D-LSL-Filename + Claude's Discretion).
 *
 * In-process Map-backed registry tracking sub-agents discovered across all four
 * supported coding agents (claude / opencode / copilot / mastra). Downstream
 * plans 51-02..51-11 build against this surface.
 *
 * Per CONTEXT.md "Claude's Discretion" bullet 1: Phase 51 v1 uses an in-memory
 * Map. SQLite persistence is a documented follow-up — does NOT affect correctness
 * in v1 because each sweep run re-discovers from disk (per-agent adapter walks
 * `searchPaths` on every invocation).
 *
 * Per CONTEXT.md D-Reuse: this module does NOT import Phase 50 primitives
 * (lib/lsl/window.mjs or lib/lsl/scan-and-convert.mjs). The sweep dispatcher
 * (scripts/sweep-sub-agents.mjs) composes the registry + adapter + Phase 50
 * primitives at the orchestration layer.
 *
 * Pure ESM (no build step). Zero new package installs (T-51-01-SC mitigation).
 */

/**
 * Row shape (frozen contract, see plan <interfaces> block):
 * {
 *   agent: 'claude'|'opencode'|'copilot'|'mastra',
 *   sub_hash: string,                 // 7-char prefix per D-LSL-Filename
 *   parent_session_id: string,
 *   sub_index: number|null,           // 1-based; may be null until siblings observed
 *   transcript_path: string,          // file path OR 'sqlite:<dbPath>#<sessionId>' opaque URI
 *   project: string,                  // e.g. 'coding'
 *   status: 'discovered'|'running'|'completed'|'failed',
 *   detected_via: 'sweep'|'fs-watch'|'sqlite-poll'|'event-tail',
 *   discovered_at: ISO string,        // set ONCE on first upsert; never overwritten
 *   completed_at: ISO string|null,
 *   observations_written: number,
 *   parent_sub_hash: string|null,     // reserved per D-LSL-Filename Could-#11
 *   error: string|null,
 *   agent_metadata: object            // per-agent free-form
 * }
 */

const VALID_STATUS = new Set(['discovered', 'running', 'completed', 'failed']);

function compositeKey(agent, sub_hash) {
  return `${agent}:${sub_hash}`;
}

class Registry {
  constructor() {
    // Primary store: composite key -> row.
    this._rows = new Map();
    // Secondary index: agent -> Set<sub_hash> for O(siblings) listByAgent.
    this._byAgent = new Map();
    // Secondary index: project -> Set<compositeKey> for O(siblings) listByProject.
    this._byProject = new Map();
  }

  /**
   * Insert or mutate-in-place. Idempotent — calling twice with the same
   * (agent, sub_hash) updates the existing row rather than appending.
   *
   * `discovered_at` is set on first insert and never overwritten.
   * `status` defaults to 'discovered' on first insert; on subsequent upserts
   * the existing status is preserved UNLESS the caller explicitly passes one.
   */
  upsert(row) {
    if (!row || typeof row !== 'object') {
      throw new TypeError('Registry.upsert: row must be an object');
    }
    const { agent, sub_hash } = row;
    if (!agent || typeof agent !== 'string') {
      throw new TypeError('Registry.upsert: row.agent is required');
    }
    if (!sub_hash || typeof sub_hash !== 'string') {
      throw new TypeError('Registry.upsert: row.sub_hash is required');
    }
    const key = compositeKey(agent, sub_hash);
    const existing = this._rows.get(key);
    if (existing) {
      // Mutate in place; preserve discovered_at and existing fields the caller
      // did not override.
      const merged = {
        ...existing,
        ...row,
        // Status: only overwrite if caller explicitly supplied one in this call.
        status: Object.prototype.hasOwnProperty.call(row, 'status') && row.status
          ? row.status
          : existing.status,
        // discovered_at is immutable post-insert.
        discovered_at: existing.discovered_at,
      };
      if (!VALID_STATUS.has(merged.status)) {
        throw new RangeError(`Registry.upsert: invalid status ${merged.status}`);
      }
      this._rows.set(key, merged);
      // Project index may need rebalancing if project changed.
      if (existing.project !== merged.project) {
        this._removeFromProjectIndex(existing.project, key);
        this._addToProjectIndex(merged.project, key);
      }
      return merged;
    }
    // First insert.
    const status = row.status && VALID_STATUS.has(row.status) ? row.status : 'discovered';
    const inserted = {
      agent,
      sub_hash,
      parent_session_id: row.parent_session_id ?? null,
      sub_index: row.sub_index ?? null,
      transcript_path: row.transcript_path ?? null,
      project: row.project ?? null,
      status,
      detected_via: row.detected_via ?? 'sweep',
      discovered_at: new Date().toISOString(),
      completed_at: null,
      observations_written: 0,
      parent_sub_hash: row.parent_sub_hash ?? null,
      error: null,
      agent_metadata: row.agent_metadata ?? {},
    };
    this._rows.set(key, inserted);
    // Maintain secondary indexes.
    if (!this._byAgent.has(agent)) this._byAgent.set(agent, new Set());
    this._byAgent.get(agent).add(sub_hash);
    this._addToProjectIndex(inserted.project, key);
    return inserted;
  }

  get(agent, sub_hash) {
    return this._rows.get(compositeKey(agent, sub_hash));
  }

  listByAgent(agent) {
    const hashes = this._byAgent.get(agent);
    if (!hashes) return [];
    const out = [];
    for (const h of hashes) {
      const row = this._rows.get(compositeKey(agent, h));
      if (row) out.push(row);
    }
    return out;
  }

  listByProject(project) {
    const keys = this._byProject.get(project);
    if (!keys) return [];
    const out = [];
    for (const k of keys) {
      const row = this._rows.get(k);
      if (row) out.push(row);
    }
    return out;
  }

  /**
   * Transition a row to terminal state. When `error` is supplied, status is
   * forced to 'failed'; otherwise status is set to 'completed'. completed_at
   * is stamped to now() ISO.
   */
  markCompleted(agent, sub_hash, { completed_at, observations_written, error } = {}) {
    const key = compositeKey(agent, sub_hash);
    const existing = this._rows.get(key);
    if (!existing) {
      throw new Error(`Registry.markCompleted: no row for ${key}`);
    }
    const updated = {
      ...existing,
      status: error ? 'failed' : 'completed',
      completed_at: completed_at ?? new Date().toISOString(),
      observations_written: typeof observations_written === 'number'
        ? observations_written
        : existing.observations_written,
      error: error ?? null,
    };
    this._rows.set(key, updated);
    return updated;
  }

  size() {
    return this._rows.size;
  }

  clear() {
    this._rows.clear();
    this._byAgent.clear();
    this._byProject.clear();
  }

  _addToProjectIndex(project, key) {
    if (!project) return;
    if (!this._byProject.has(project)) this._byProject.set(project, new Set());
    this._byProject.get(project).add(key);
  }

  _removeFromProjectIndex(project, key) {
    if (!project) return;
    const set = this._byProject.get(project);
    if (set) {
      set.delete(key);
      if (set.size === 0) this._byProject.delete(project);
    }
  }
}

/**
 * Factory — returns a fresh Registry instance.
 * Use this rather than `new Registry()` to keep callers decoupled from the
 * class shape (allows swap to SQLite-backed implementation later).
 */
export function createRegistry() {
  return new Registry();
}

export { Registry };
