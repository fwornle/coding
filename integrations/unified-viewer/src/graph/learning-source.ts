// Where a node's knowledge came from — one rule, used everywhere.
//
// The viewer had TWO answers to this question and they disagreed:
//
//   - the canvas + the Learning Source filter asked `source ∈ {auto, online}`
//   - HistorySidebar asked `source === 'manual' ? manual : auto`
//
// The sidebar's version collapses everything that is not literally 'manual'
// into 'auto', so a UKB batch run's output badges red "Auto" alongside genuine
// ETM captures. Measured on the 387 entities written since 2026-09-07: the
// sidebar called all 387 auto; the canvas called 194 of them batch.
//
// Neither was right about the hard case. 138 of those 387 carry NO `source` at
// all, and they are two different populations:
//
//   56  metadata.subsystem === 'wave-analysis'   → batch (a UKB run that
//                                                  simply never stamped source)
//   82  digests with observation_ids/agents/…    → online (ETM output)
//
// `source ∈ {auto, online}` calls all 138 batch; `!== 'manual'` calls all 138
// auto. So the fallbacks below are load-bearing, not decoration.

/** Minimal shape — anything with metadata. Both Entity variants satisfy it. */
export interface SourcedNode {
  metadata?: Record<string, unknown> | null
}

export type LearningSource = 'manual' | 'batch' | 'online'

/** Sources the writers stamp for ETM / consolidator (online-learned) output. */
const ONLINE_SOURCES: ReadonlySet<string> = new Set(['auto', 'online'])

/** Sources the batch (UKB / wave-analysis) writers stamp. */
const BATCH_SOURCES: ReadonlySet<string> = new Set(['wave-analysis', 'manual-import'])

/**
 * Metadata keys only the online digest/observation writers emit. Their presence
 * identifies ETM output that never stamped `source` — the 82-entity population
 * above. Checked only AFTER `source` and `subsystem`, so an explicit stamp
 * always wins over this shape sniff.
 */
const ONLINE_SHAPE_KEYS: readonly string[] = ['observation_ids', 'sourceCount', 'agents']

/**
 * Classify a node's learning source.
 *
 * Rules are ordered most-explicit-first; the last two are inference for records
 * written before their writer stamped anything.
 */
export function learningSourceOf(node: SourcedNode | null | undefined): LearningSource {
  const meta = (node?.metadata ?? {}) as Record<string, unknown>
  const source = typeof meta.source === 'string' ? meta.source : undefined

  if (source === 'manual') return 'manual'
  if (source && ONLINE_SOURCES.has(source)) return 'online'
  if (source && BATCH_SOURCES.has(source)) return 'batch'

  // A UKB run that wrote the subsystem but not the source.
  if (meta.subsystem === 'wave-analysis') return 'batch'

  // ETM digest/observation shape.
  if (ONLINE_SHAPE_KEYS.some((k) => meta[k] !== undefined)) return 'online'

  // Default batch: an unrecognised source string is far more likely a named
  // batch writer (a repair script, an importer) than ETM output, which always
  // stamps 'auto'/'online' or carries the digest shape above.
  return 'batch'
}

/** Convenience for the ring overlay + filter, which only care about online-ness. */
export function isOnlineLearned(node: SourcedNode | null | undefined): boolean {
  return learningSourceOf(node) === 'online'
}

/** Human-facing badge text, matching the LearningSourceFilter's vocabulary. */
export const LEARNING_SOURCE_LABEL: Readonly<Record<LearningSource, string>> = {
  manual: 'Manual',
  batch: 'Batch',
  online: 'Auto',
}
