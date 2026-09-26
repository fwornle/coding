// Reading an entity's provenance — who wrote this row, who last confirmed it,
// and how many times.
//
// WHY THIS EXISTS
//
// The wire puts provenance under `metadata.provenance`, never at the top level.
// km-core's `entityToWire()` (lib/km-core/src/adapters/wire-serializers.ts:68)
// strips top-level `createdBy` / `lastConfirmedBy` / `confirmationCount` and
// FOLDS them into that object, and `contracts.ts:148-153` states the contract.
//
// The panels did not follow it. `EntityDetailPanel` read `entity.createdBy`,
// `entity.lastConfirmedBy`, `entity.lastSegment` and `entity.confirmationCount`
// straight off the entity — 0 of 2809 live rows carry any of them, against
// 2705 (96%) carrying `metadata.provenance` — so the whole Provenance section
// printed `—` for almost every row it was asked about. `entity.lastConfirmedAt`
// was the same defect in the Identity block and in the shared header chip, so
// "last confirmed —" showed on EVERY entity in both side panels.
//
// AND THE TWO READERS THAT DID EXIST DISAGREED ABOUT THE TYPE. The Timeline
// visibility predicate typed `provenance.createdBy` as `string` and tested it
// with `!!`; the Timeline renderer typed the SAME field as an object and read
// `.provider` off it. A row whose stamp is an object satisfied the predicate,
// so the pill appeared — then the renderer found no `.provider`, fell through
// to the dead top-level field, pushed no creation event, and the tab opened
// onto an empty list. One shape, read one way, is the fix for that.
//
// A stamp is all-or-nothing: `ProvenanceStampSchema`
// (lib/km-core/src/api/contracts.ts:67) requires all four fields whenever the
// stamp exists, which is why the readers below check `provider` alone and treat
// the rest as present. Measured 2026-09-26: all 2705 stamps carry all four.

/** Mirrors km-core `ProvenanceStampSchema` — all four fields, or no stamp. */
export interface ProvenanceStamp {
  provider: string
  model: string
  runId: string
  timestamp: string
}

export interface EntityProvenance {
  createdBy?: ProvenanceStamp
  lastConfirmedBy?: ProvenanceStamp
  confirmationCount: number
}

function asStamp(v: unknown): ProvenanceStamp | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  // `provider` is the discriminator. A legacy row that stored a bare STRING
  // here (the shape the old visibility predicate assumed) is deliberately NOT
  // coerced into a half-stamp: it would satisfy every `!!` check downstream and
  // then render blank, which is the exact failure this module exists to end.
  return typeof r.provider === 'string' ? (r as unknown as ProvenanceStamp) : undefined
}

/**
 * Read `metadata.provenance` off an entity-shaped object.
 *
 * Takes the metadata bag rather than the entity so callers that have already
 * destructured it (most of EntityDetailPanel) do not re-derive it.
 */
export function readProvenance(
  metadata: Record<string, unknown> | undefined,
): EntityProvenance {
  const p = (metadata?.provenance as Record<string, unknown> | undefined) ?? {}
  const count = p.confirmationCount
  return {
    createdBy: asStamp(p.createdBy),
    lastConfirmedBy: asStamp(p.lastConfirmedBy),
    confirmationCount: typeof count === 'number' ? count : 0,
  }
}

/**
 * Display form of a stamp: `provider/model`.
 *
 * `<provider>/<model>` is the repo-wide convention and it is load-bearing —
 * provider names are ACCOUNTS, not companies, so a bare model name does not
 * identify what produced a row. Returns `null` (not `'—'`) so the caller picks
 * its own placeholder and an absent stamp can never be mistaken for a value.
 */
export function formatStamp(stamp: ProvenanceStamp | undefined): string | null {
  if (!stamp) return null
  return stamp.model ? `${stamp.provider}/${stamp.model}` : stamp.provider
}
