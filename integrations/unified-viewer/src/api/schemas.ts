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
