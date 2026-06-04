/**
 * scripts/lib/artifacts-patch-util.mjs
 *
 * Phase 44 Plan 14 — single source of truth for the in-place
 * "Artifacts: none → Artifacts: <files>" mutation shared between two
 * obs-api endpoints (and, after Plan 44-13 lands, the writer's
 * `_maybePatchArtifacts` path):
 *
 *   * POST /api/observations/patch-artifacts/recent      (last 4h, agent-scoped, limit 10)
 *   * POST /api/observations/patch-artifacts/historical  (one-shot, limit 500)
 *   * src/live-logging/ObservationWriter.js _maybePatchArtifacts  (Plan 44-13)
 *
 * The pre-Plan-44-14 implementation inlined the regex + meta merge in
 * each handler (scripts/observations-api-server.mjs:432-441 and
 * :467-473) and again inside the writer (Plan 44-13 follow-up).
 * Factoring it here removes the drift risk: any change to the
 * "Artifacts:" summary shape lands in one place and is picked up by
 * all three call sites at once.
 *
 * NO async, NO I/O — this module mutates the entity object IN PLACE
 * and returns `true` when a mutation happened, `false` otherwise.
 * The caller is responsible for persisting the mutated entity (writer
 * → kmStore.putEntity replay; consolidator-side SQLite UPDATE — gone
 * after Plan 44-14).
 *
 * Match the obs-api `process.stderr.write` convention (no-console-log
 * constraint): this module emits zero log lines; the caller logs.
 */

/**
 * In-place "Artifacts: none → Artifacts: <files>" mutation on a km-core
 * entity. Mirrors the regex + meta-merge that the pre-Plan-44-14 SQLite
 * UPDATE used (scripts/observations-api-server.mjs:431-441).
 *
 * Decision rules:
 *   1. If `entity.metadata.summary` (or `entity.description` — both
 *      copies of the summary survive in the legacy-ingest adapter)
 *      does NOT match `/Artifacts:\s*none/i`, return `false` — nothing
 *      to do.
 *   2. Otherwise, replace the first occurrence with
 *      `Artifacts: edited <basename1>, edited <basename2>, ...` (the
 *      same "basename only, prefix `edited `, comma-separated" shape
 *      the SQLite path produced).
 *   3. Merge `modifiedFiles` into `entity.metadata.modifiedFiles` as a
 *      set-union (preserves prior entries; idempotent).
 *
 * Both the `metadata.summary` field AND the top-level `description`
 * field are updated when they were tracking each other; updating only
 * one would cause the dashboard's read path (which prefers
 * `metadata.summary`) and the km-core mergeAttributes path (which
 * compares `description`) to drift.
 *
 * @param {import('@fwornle/km-core').Entity} entity - km-core entity
 *   (must be a real object, not a frozen snapshot). The function mutates
 *   `entity.metadata.summary`, `entity.metadata.modifiedFiles`, and
 *   `entity.description` directly.
 * @param {string[]} modifiedFiles - list of repo-rooted paths (e.g.
 *   `['src/foo.ts', 'lib/bar.js']`). Empty array → no-op.
 * @returns {boolean} `true` when the entity was mutated, `false` when
 *   no `Artifacts: none` placeholder was present (or `modifiedFiles`
 *   was empty).
 */
export function patchArtifactsInPlace(entity, modifiedFiles) {
  if (!entity || typeof entity !== 'object') return false;
  if (!Array.isArray(modifiedFiles) || modifiedFiles.length === 0) return false;

  // Both copies of the summary are valid sources. legacy-ingest.ts
  // stamps both `description` AND `metadata.summary`; the dashboard
  // reshape favors `metadata.summary` so we prioritize it for the
  // regex match, then mirror the replacement into `description`.
  const meta = entity.metadata && typeof entity.metadata === 'object'
    ? entity.metadata
    : (entity.metadata = {});
  const currentSummary = typeof meta.summary === 'string'
    ? meta.summary
    : (typeof entity.description === 'string' ? entity.description : '');

  if (!/Artifacts:\s*none/i.test(currentSummary)) return false;

  const artifactsList = modifiedFiles.map((f) => `edited ${f.split('/').pop()}`).join(', ');
  const updatedSummary = currentSummary.replace(/Artifacts:\s*none/i, `Artifacts: ${artifactsList}`);

  meta.summary = updatedSummary;
  if (typeof entity.description === 'string') {
    entity.description = updatedSummary;
  }

  const priorFiles = Array.isArray(meta.modifiedFiles) ? meta.modifiedFiles : [];
  meta.modifiedFiles = Array.from(new Set([...priorFiles, ...modifiedFiles]));

  return true;
}
