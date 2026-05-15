/**
 * ObservationPruner - Stateless module that deletes rows older than
 * `retentionDays` from the `observations` and `digests` tables. The long-term
 * memory table consumed by the prompt-injection hook (Phase 30/30.1/31) is
 * intentionally not referenced from this module — see CONTEXT.md L2.
 *
 * Phase 35 plan 35-02. The 35-04 plan wires this into `obs_api` on a 1h
 * `setInterval`; this module ships in isolation so the deletion contract is
 * fully verified before any wiring lands.
 *
 * Concurrency model (full discussion in 35-02-PLAN.md):
 *   The pruner does NOT acquire `ObservationWriter._writeLock`. Atomicity comes
 *   from better-sqlite3 transactions (BEGIN IMMEDIATE ... COMMIT), and safety
 *   from temporal disjointness — the writer's hot path operates on rows in the
 *   last 4h, while the pruner only ever deletes rows older than 24h (the
 *   `retentionDays >= 1` floor). The two working sets cannot overlap. The
 *   pruner is therefore safe to call from a free-running interval without
 *   coordinating with `ensureWriter`.
 *
 * @module ObservationPruner
 */

/**
 * Stateless pruner over the `observations` and `digests` tables.
 *
 * Construct once with an open better-sqlite3 handle and a `retentionDays`
 * config value, then call `.prune()` on demand. The instance does NOT own the
 * DB handle lifecycle — the caller (typically `obs_api`) opens and closes it.
 */
export class ObservationPruner {
  /**
   * @param {Object} opts
   * @param {import('better-sqlite3').Database} opts.db - Open DB handle (caller-owned).
   * @param {number} opts.retentionDays - Integer >= 1. Defense-in-depth against
   *   misconfiguration; the upstream `ObservationWriter` also throws on `< 1`,
   *   but this module is constructible standalone and cannot trust callers.
   */
  constructor({ db, retentionDays } = {}) {
    if (!db || typeof db.prepare !== 'function') {
      throw new Error('[ObservationPruner] db must be an open better-sqlite3 handle (got falsy or missing .prepare)');
    }
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      throw new Error(
        `[ObservationPruner] retentionDays must be >= 1 (got ${retentionDays}) — ` +
        `the 4h dedup window in ObservationWriter._isSemanticallyDuplicate would be invalidated. ` +
        `See .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/CONTEXT.md L4.`
      );
    }
    this.db = db;
    this.retentionDays = retentionDays;
  }

  /**
   * Delete rows older than `retentionDays` from `observations` and `digests`.
   *
   * Runs both DELETEs inside a single better-sqlite3 transaction. The cutoff is
   * computed by SQLite itself (`datetime('now', ?)`), so there is no clock-skew
   * window between Node and the DB. The bulk DELETE on `observations` fires the
   * `observations_ad` AFTER DELETE trigger (defined in ObservationWriter.js:111-128
   * when FTS5 is available) once per deleted row, which keeps the
   * `observations_fts` virtual table in sync without any work from this module.
   *
   * @returns {{ observationsDeleted: number, digestsDeleted: number, cutoff: string }}
   */
  prune() {
    const cutoffSql = `-${this.retentionDays} days`;
    const cutoffRow = this.db.prepare("SELECT datetime('now', ?) AS t").get(cutoffSql);
    const cutoff = cutoffRow && cutoffRow.t ? cutoffRow.t : null;

    const deleteObs = this.db.prepare("DELETE FROM observations WHERE created_at < datetime('now', ?)");
    const deleteDig = this.db.prepare("DELETE FROM digests WHERE created_at < datetime('now', ?)");

    const runPrune = this.db.transaction(() => {
      const obs = deleteObs.run(cutoffSql).changes;
      const dig = deleteDig.run(cutoffSql).changes;
      return { obs, dig };
    });
    const { obs, dig } = runPrune();

    process.stderr.write(
      `[ObservationPruner] Pruned ${obs} obs + ${dig} digests older than ${cutoff} ` +
      `(retentionDays=${this.retentionDays})\n`
    );

    return {
      observationsDeleted: obs,
      digestsDeleted: dig,
      cutoff,
    };
  }
}
