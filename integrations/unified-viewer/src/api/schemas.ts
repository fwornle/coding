// PATTERN SOURCES:
//   lib/km-core/src/adapters/observation-view.ts:78-108 (LegacyDigest, LegacyInsight interface declarations)
//   tests/integration/typed-views.test.js:35-63 (REQUIRED_*_KEYS — the canonical assertion lists)
//   .planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md (camelCase wire-shape lock)
//
// Phase 44 Plan 16 wire-shape lock — DO NOT change multi-word field casing.
// Digests + Insights serialize multi-word fields as camelCase: observationIds,
// filesTouched, digestIds, lastUpdated, createdAt. Observations are the single
// exception that preserves the original SQL column casing on session_id.
//
// This file is one of THREE ratification sites for the camelCase contract:
//   1. tests/integration/typed-views.test.js (server-side Jest test)
//   2. src/api/shape-lock.test.ts (this viewer's Vitest mirror)
//   3. .planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md (the lock doc)
import { z } from 'zod'

export const DigestSchema = z.object({
  id: z.string(),
  date: z.string(),
  theme: z.string(),
  summary: z.string(),
  observationIds: z.array(z.string()),    // camelCase per Plan 44-16 lock
  agents: z.array(z.string()),
  filesTouched: z.array(z.string()),      // camelCase per Plan 44-16 lock
  project: z.string().nullable().optional(),
  // 'createdAt' surfaces in dashboard payloads (digests.tsx:23) — keep optional
  createdAt: z.string().optional(),
})

export const InsightSchema = z.object({
  id: z.string(),
  topic: z.string(),
  summary: z.string(),
  confidence: z.number(),
  digestIds: z.array(z.string()),         // camelCase per Plan 44-16 lock
  lastUpdated: z.string(),                // camelCase per Plan 44-16 lock
  project: z.string().nullable().optional(),
})

// Observations are the only typed-view that keeps snake_case session_id
// per Plan 44-16 lock (typed-views.test.js:35-42).
export const ObservationSchema = z.object({
  id: z.string(),
  agent: z.string(),
  project: z.string(),
  content: z.string(),
  artifacts: z.array(z.string()),
  timestamp: z.string(),
  session_id: z.string().optional(),      // EXCEPTION — snake_case stays
})

export type Digest = z.infer<typeof DigestSchema>
export type Insight = z.infer<typeof InsightSchema>
export type Observation = z.infer<typeof ObservationSchema>

// ---------------------------------------------------------------------------
// Entity confidence — `/api/v1/entities/:id/confidence`
// ---------------------------------------------------------------------------
//
// THE ENDPOINT THAT SKIPPED THIS FILE, AND WHAT IT COST.
//
// Every other payload above is parsed. This one was a bare TS cast
// (`this.get<ConfidencePayload>(...)`), and the declared type was wrong: it
// said `overall: { score, label }` while the server has always sent a scalar
// float plus a `bands` histogram. So `payload.overall.score` was `undefined`,
// `Math.round(undefined * 100)` was `NaN`, and the panel rendered "· NaN%" —
// for months, on every entity.
//
// Nothing failed. The client test mocked the shape the frontend WISHED it got;
// the server test asserted `typeof data.overall === 'number'`. Both passed,
// neither touched the other, and a cast cannot disagree with reality loudly
// enough to be noticed. Hence: the shape below is transcribed from the handler
// (scripts/observations-api-server.mjs:2946-3001), and it is PARSED, so the
// next divergence is a thrown error at the boundary instead of a NaN on screen.
export const ConfidenceSegmentSchema = z.object({
  segmentId: z.string(),
  confidence: z.number(),
  source: z.string().optional(),
})

export const ConfidencePayloadSchema = z.object({
  /** Scalar in [0,1]. The server clamps it; we do not re-clamp, we verify. */
  overall: z.number().min(0).max(1),
  /** Per-band segment counts. With no segments the server puts 1 on the
   *  overall's own band, so this is never all-zero for a real entity. */
  bands: z.object({
    high: z.number(),
    moderate: z.number(),
    low: z.number(),
  }),
  segments: z.array(ConfidenceSegmentSchema),
})

export type ConfidenceSegment = z.infer<typeof ConfidenceSegmentSchema>
export type ConfidencePayload = z.infer<typeof ConfidencePayloadSchema>

/** Confidence band for a score.
 *
 *  MIRRORS THE SERVER EXACTLY — `classifyConfidence`,
 *  scripts/observations-api-server.mjs:2940-2944. The thresholds live in two
 *  places because the client must label a scalar the server only sends as a
 *  number; they must not drift, so the boundaries are asserted in the tests
 *  (0.8 -> High, 0.6 -> Moderate, 0.5999... -> Low).
 *
 *  Non-finite input yields 'Low' rather than throwing: this feeds a colour
 *  lookup and a label, and a broken score should read as untrustworthy rather
 *  than take the panel down. */
export function classifyConfidence(score: number): 'High' | 'Moderate' | 'Low' {
  if (!Number.isFinite(score)) return 'Low'
  if (score >= 0.8) return 'High'
  if (score >= 0.6) return 'Moderate'
  return 'Low'
}
