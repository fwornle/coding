/**
 * ColdStoreReader - Read-only reader over the JSON cold-store at
 * `.data/observation-export/{observations,digests}.json`.
 *
 * Phase 35 plan 35-03. The cold tier is populated by ObservationExporter on a
 * 10s debounced cadence and preserves rows that have already been pruned out
 * of SQLite by ObservationPruner. This module gives the 35-04 range-merge
 * helper in `obs_api` a way to pull historical rows without re-opening SQLite
 * for rows that no longer live there.
 *
 * Invariant #3 (CONTEXT.md L6): this module is read-only. The 35-03 test
 * source-greps the file for write-API references and will fail the build if
 * any are introduced — keep this constraint when refactoring.
 *
 * Cache strategy: a day-bucketed LRU keyed by `${kind}:${YYYY-MM-DD}` where
 * `kind` is `obs` or `dig`. The JSON file is parsed once per call (not per
 * day-bucket — it is a flat array spanning all days), then split into
 * per-day buckets and inserted into the Map. Map insertion order doubles as
 * LRU order, so eviction is `delete(keys().next().value)`. Default capacity
 * is 16 buckets (per CONTEXT.md G2 — ~16d of history hot in memory at peak).
 *
 * @module ColdStoreReader
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read-only reader over the JSON cold-store with a day-bucketed LRU cache.
 */
export class ColdStoreReader {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.exportDir] - Directory holding `observations.json` and
   *   `digests.json`. Defaults to `path.resolve('.data/observation-export')`.
   * @param {number} [opts.cacheSize] - Max day-bucket entries in the LRU. Defaults to 16.
   */
  constructor({ exportDir, cacheSize } = {}) {
    this.exportDir = exportDir || path.resolve('.data/observation-export');
    this.cacheSize = Number.isFinite(cacheSize) && cacheSize > 0 ? cacheSize : 16;
    this._cache = new Map();
    this._statsObj = { observationsParsed: 0, digestsParsed: 0, cacheHits: 0, cacheMisses: 0 };
  }

  /**
   * Return observations whose `createdAt` falls in `[from, to)`.
   * Tolerates a missing/malformed JSON file by returning `[]` and writing a
   * single stderr warning.
   *
   * @param {Object} [range]
   * @param {string} [range.from] - ISO-8601 lower bound (inclusive). Defaults to epoch.
   * @param {string} [range.to]   - ISO-8601 upper bound (exclusive). Defaults to now.
   * @returns {Array<Object>}
   */
  readObservations({ from, to } = {}) {
    const fromIso = from || '1970-01-01T00:00:00.000Z';
    const toIso = to || new Date().toISOString();
    return this._readRange('obs', 'observations.json', fromIso, toIso, (r) => r.createdAt, (k) => k.slice(0, 10));
  }

  /**
   * Return digests whose `date` (YYYY-MM-DD) falls in `[from, to)`.
   *
   * @param {Object} [range]
   * @param {string} [range.from] - Lower bound (inclusive). Either ISO-8601 or `YYYY-MM-DD`.
   * @param {string} [range.to]   - Upper bound (exclusive). Either ISO-8601 or `YYYY-MM-DD`.
   * @returns {Array<Object>}
   */
  readDigests({ from, to } = {}) {
    const fromDate = (from || '1970-01-01').slice(0, 10);
    const toDate = (to || new Date().toISOString()).slice(0, 10);
    return this._readRange('dig', 'digests.json', fromDate, toDate, (r) => r.date, (k) => k);
  }

  /**
   * Test-only introspection: running counters + current cache size.
   * @returns {Object}
   */
  _stats() {
    return { ...this._statsObj, cacheKeys: this._cache.size };
  }

  /** @private */
  _readRange(kind, fileName, from, to, keyOfRow, keyOfBound) {
    if (!from || !to || from >= to) return [];

    const buckets = this._enumerateBuckets(keyOfBound(from), keyOfBound(to));
    if (buckets === null) {
      process.stderr.write(`[ColdStoreReader] refusing range > ${MAX_RANGE_DAYS}d for ${fileName}\n`);
      return [];
    }

    const missing = buckets.filter((d) => !this._cache.has(`${kind}:${d}`));
    if (missing.length > 0) {
      this._statsObj.cacheMisses += missing.length;
      const parsed = this._parseFile(fileName, kind);
      if (parsed === null) return [];
      this._bucketAndCache(kind, parsed, keyOfRow);
      // Insert empty placeholders for buckets that have no rows on disk so
      // subsequent identical queries hit the cache instead of re-parsing.
      for (const day of missing) {
        const cacheKey = `${kind}:${day}`;
        if (!this._cache.has(cacheKey)) this._setCache(cacheKey, []);
      }
    }

    const out = [];
    for (const day of buckets) {
      const cacheKey = `${kind}:${day}`;
      const entry = this._cache.get(cacheKey);
      if (!entry) continue;
      this._statsObj.cacheHits++;
      // Refresh LRU recency by re-inserting.
      this._cache.delete(cacheKey);
      this._cache.set(cacheKey, entry);
      for (const row of entry.rows) {
        const k = keyOfRow(row);
        if (typeof k === 'string' && k >= from && k < to) out.push(row);
      }
    }

    out.sort((a, b) => {
      const ka = keyOfRow(a);
      const kb = keyOfRow(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return out;
  }

  /** @private */
  _enumerateBuckets(fromDate, toDate) {
    const start = Date.parse(fromDate + 'T00:00:00.000Z');
    const end = Date.parse(toDate + 'T00:00:00.000Z');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [fromDate];
    }
    const days = Math.ceil((end - start) / MS_PER_DAY);
    if (days > MAX_RANGE_DAYS) return null;
    const out = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(start + i * MS_PER_DAY);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  /** @private */
  _parseFile(fileName, kind) {
    const fullPath = path.join(this.exportDir, fileName);
    let raw;
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      process.stderr.write(`[ColdStoreReader] ${fileName} unreadable: ${err.message}\n`);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`[ColdStoreReader] ${fileName} unreadable: ${err.message}\n`);
      return null;
    }
    if (!Array.isArray(parsed)) {
      process.stderr.write(`[ColdStoreReader] ${fileName} unreadable: root is not an array\n`);
      return null;
    }
    if (kind === 'obs') this._statsObj.observationsParsed++;
    else this._statsObj.digestsParsed++;
    return parsed;
  }

  /** @private */
  _bucketAndCache(kind, rows, keyOfRow) {
    const grouped = new Map();
    for (const row of rows) {
      const k = keyOfRow(row);
      if (typeof k !== 'string') continue;
      const day = k.slice(0, 10);
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day).push(row);
    }
    for (const [day, dayRows] of grouped) {
      this._setCache(`${kind}:${day}`, dayRows);
    }
  }

  /** @private */
  _setCache(key, rows) {
    if (this._cache.has(key)) this._cache.delete(key);
    this._cache.set(key, { rows, parsedAt: Date.now() });
    while (this._cache.size > this.cacheSize) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }
}
