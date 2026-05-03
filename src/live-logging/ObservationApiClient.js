/**
 * ObservationApiClient — HTTP client mirroring the subset of ObservationWriter's
 * surface that callers use. Used in place of ObservationWriter when a remote
 * Observations API is available (default http://localhost:12436).
 *
 * Eliminates direct SQLite handles in long-running host writers like the
 * enhanced-transcript-monitor. The host API service is the single owner of
 * .observations/observations.db.
 */

export class ObservationApiClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseUrl] - Observations API base URL (default: env OBS_API_URL or http://localhost:12436)
   * @param {number} [options.timeoutMs] - Per-request timeout (default: 60_000; LLM summarize can take ~10–30s)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.OBS_API_URL || 'http://localhost:12436';
    this.timeoutMs = options.timeoutMs ?? 60_000;
    // db is intentionally null. Any caller reaching for `.db.prepare(...)`
    // must migrate to a corresponding HTTP endpoint instead.
    this.db = null;
  }

  /**
   * No-op for compatibility with ObservationWriter.init(). The host API
   * server initializes the DB itself; clients just need it reachable.
   * Throws if the API is unreachable so the caller fails fast at startup.
   */
  async init() {
    const r = await this._fetch('/health');
    if (!r.ok) throw new Error(`Observations API health check failed: ${r.status}`);
  }

  /**
   * Send a chunk of raw messages to the host API for summarization + insert.
   * Mirrors ObservationWriter.processMessages.
   * @returns {Promise<{ observations: number, errors: number, lastObservationId?: string }>}
   */
  async processMessages(messages, metadata = {}) {
    if (!messages || messages.length === 0) {
      return { observations: 0, errors: 0 };
    }
    try {
      const r = await this._fetch('/api/observations/messages', {
        method: 'POST',
        body: JSON.stringify({ messages, metadata }),
      });
      if (!r.ok) {
        const text = await r.text();
        process.stderr.write(`[ObsApiClient] processMessages ${r.status}: ${text}\n`);
        return { observations: 0, errors: 1 };
      }
      return await r.json();
    } catch (err) {
      process.stderr.write(`[ObsApiClient] processMessages error: ${err.message}\n`);
      return { observations: 0, errors: 1 };
    }
  }

  /**
   * Patch recent observations whose summary still says "Artifacts: none".
   */
  async patchRecentArtifacts(agent, modifiedFiles) {
    if (!modifiedFiles || modifiedFiles.length === 0) return { patched: 0 };
    try {
      const r = await this._fetch('/api/observations/patch-artifacts/recent', {
        method: 'POST',
        body: JSON.stringify({ agent, modifiedFiles }),
      });
      if (!r.ok) return { patched: 0 };
      return await r.json();
    } catch (err) {
      process.stderr.write(`[ObsApiClient] patchRecentArtifacts error: ${err.message}\n`);
      return { patched: 0 };
    }
  }

  /**
   * One-time historical patch — mirrors transcript-monitor's startup pass.
   */
  async patchHistoricalArtifacts() {
    try {
      const r = await this._fetch('/api/observations/patch-artifacts/historical', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!r.ok) return { patched: 0 };
      return await r.json();
    } catch (err) {
      process.stderr.write(`[ObsApiClient] patchHistoricalArtifacts error: ${err.message}\n`);
      return { patched: 0 };
    }
  }

  /**
   * Compatibility no-op. The DB lives in the API server's process; clients
   * have nothing to flush.
   */
  async close() { /* no-op */ }

  // ── internal ────────────────────────────────────────────────────────────

  async _fetch(pathAndQuery, init = {}) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${pathAndQuery}`, {
        ...init,
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
