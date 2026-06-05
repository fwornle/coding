/**
 * ObservationPruner — Stateless module that deletes km-core entities of class
 * `Observation` and `Digest` whose top-level `createdAt` is older than
 * `retentionDays`. Reads + writes go exclusively through the km-core
 * `GraphKMStore` API (`findByOntologyClass` + `deleteEntity`).
 *
 * Plan 44-18 (Phase 44 wave 9). Before this plan the pruner held a direct
 * better-sqlite3 handle and issued bulk row deletes on the `observations` and
 * `digests` tables. After Plan 44-17 cut the consolidator to km-core, the
 * pruner + RetrievalService were the last two intentional SQLite consumers;
 * this module is the pruner half of that final cutover. See
 * `.planning/phases/44-rest-api-git-snapshots/44-18-AUDIT.md` §1 for the
 * call-site map.
 *
 * The 1h `setInterval` wiring lives in `scripts/observations-api-server.mjs`
 * (Phase 35 plan 35-04). This module ships in isolation so the deletion
 * contract is fully verified before any wiring lands.
 *
 * Concurrency model:
 *   The pruner does NOT serialize against the writer. Safety comes from
 *   temporal disjointness — the writer's hot path operates on entities
 *   created in the last 4h, while the pruner only ever deletes entities
 *   whose `createdAt` is older than `retentionDays` days (the
 *   `retentionDays >= 1` floor). The two working sets cannot overlap.
 *
 *   T-44-18-01 (medium): per-row `deleteEntity` is O(N) round-trips vs
 *   SQLite's single DELETE statement. Mitigation: chunk into 100-id
 *   `Promise.all` batches with a progress log per chunk. Perf gate:
 *   1000-obs prune ≤ 1s on the audit machine (asserted in
 *   `tests/integration/observation-pruner.km-core.test.js`).
 *
 * @module ObservationPruner
 */

/**
 * Stateless pruner over the `Observation` and `Digest` km-core ontology
 * classes.
 *
 * Construct once with an opened `GraphKMStore` and a `retentionDays` config
 * value, then call `.prune()` on demand. The instance does NOT own the
 * store lifecycle — the caller (typically `obs_api`) opens and closes it.
 */
export class ObservationPruner {
  /**
   * @param {Object} opts
   * @param {import('@fwornle/km-core').GraphKMStore} opts.kmStore — Open km-core store handle (caller-owned).
   *   Must implement `findByOntologyClass(cls)` and `deleteEntity(id)`.
   * @param {number} opts.retentionDays — Integer >= 1. Defense-in-depth against
   *   misconfiguration; the upstream `ObservationWriter` also throws on `< 1`,
   *   but this module is constructible standalone and cannot trust callers.
   */
  constructor({ kmStore, retentionDays } = {}) {
    if (
      !kmStore ||
      typeof kmStore.findByOntologyClass !== 'function' ||
      typeof kmStore.deleteEntity !== 'function'
    ) {
      throw new Error(
        '[ObservationPruner] kmStore must be an open GraphKMStore ' +
        '(missing findByOntologyClass or deleteEntity)'
      );
    }
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      throw new Error(
        `[ObservationPruner] retentionDays must be >= 1 (got ${retentionDays}) — ` +
        `the 4h dedup window in ObservationWriter._isSemanticallyDuplicate would be invalidated. ` +
        `See .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/CONTEXT.md L4.`
      );
    }
    this.kmStore = kmStore;
    this.retentionDays = retentionDays;
  }

  /**
   * Delete entities of class `Observation` and `Digest` whose top-level
   * `createdAt` is older than `retentionDays` days.
   *
   * Cutoff is computed in JS via `Date.now() - retentionDays * 86400000`,
   * then compared lexicographically against `entity.createdAt` (ISO-8601
   * strings sort identically to date order — km-core uses this comparison
   * strategy in `findRecentByAgent`).
   *
   * Deletes are issued in 100-id `Promise.all` chunks so a long prune is
   * observable (one stderr line per chunk). T-44-18-01 mitigation.
   *
   * @returns {Promise<{ observationsDeleted: number, digestsDeleted: number, cutoff: string }>}
   */
  async prune() {
    const cutoffMs = Date.now() - this.retentionDays * 86400000;
    const cutoffISO = new Date(cutoffMs).toISOString();

    const obsDeleted = await this._pruneClass('Observation', cutoffISO);
    const digDeleted = await this._pruneClass('Digest', cutoffISO);

    process.stderr.write(
      `[ObservationPruner] Pruned ${obsDeleted} obs + ${digDeleted} digests older than ${cutoffISO} ` +
      `(retentionDays=${this.retentionDays})\n`
    );

    return {
      observationsDeleted: obsDeleted,
      digestsDeleted: digDeleted,
      cutoff: cutoffISO,
    };
  }

  /**
   * Internal helper — fetch all entities of `cls`, filter to those older than
   * `cutoffISO`, and delete in chunked `Promise.all` batches.
   *
   * @param {string} cls — Ontology class (`'Observation'` or `'Digest'`).
   * @param {string} cutoffISO — ISO-8601 cutoff timestamp.
   * @returns {Promise<number>} Count of deleted entities.
   */
  async _pruneClass(cls, cutoffISO) {
    const all = await this.kmStore.findByOntologyClass(cls);
    const toDelete = all.filter((e) => {
      const createdAt = e?.createdAt;
      // Treat missing/invalid timestamps as too old to lose data, but in
      // practice every entity carries `createdAt` (D-31 stamping). Safer
      // path: skip entities with no timestamp (don't delete what we can't
      // date-check).
      if (typeof createdAt !== 'string' || createdAt.length === 0) return false;
      return createdAt < cutoffISO;
    });

    let deleted = 0;
    const CHUNK = 100;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const chunk = toDelete.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map((e) => this.kmStore.deleteEntity(e.id)));
      deleted += results.filter(Boolean).length;
      process.stderr.write(
        `[ObservationPruner] Pruned ${Math.min(i + CHUNK, toDelete.length)}/${toDelete.length} ${cls}\n`
      );
    }

    return deleted;
  }
}
