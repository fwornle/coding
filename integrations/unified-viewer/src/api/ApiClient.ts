// PATTERN SOURCES:
//   integrations/system-health-dashboard/src/store/middleware/apiMiddleware.ts:10-30 (fetch+throw idiom)
//   integrations/system-health-dashboard/src/pages/digests.tsx:29-34 (envelope `body.data` shape)
//   lib/km-core/src/api/handlers/ontology.ts:50-68 (canonical /api/v1 routes)
//   45-PATTERNS.md § ApiClient.ts (the class structure)
//
// km-core /api/v1 REST client + Phase 44 typed-views endpoints.
//
// The `?withDisplay=true` ontology branch targets Plan 04's extension (the server
// side lands later). Until Plan 04 ships, the existing handler returns a string
// array — we transparently map it to `[{name: s}]` so the graph renderer in Plan
// 02 sees a uniform shape regardless of which side ships first.

import type { Digest, Insight, Observation } from './schemas'

interface ApiSuccess<T> { success: true; data: T }
interface ApiError { success: false; error: string }

/** km-core canonical entity shape (Phase 44 /api/v1/entities). */
export interface Entity {
  id: string
  name: string
  ontologyClass: string
  description?: string | null
  level?: number
  [k: string]: unknown
}

/** km-core canonical relation shape (Phase 44 /api/v1/relations). */
export interface Relation {
  from: string
  to: string
  type?: string
  [k: string]: unknown
}

/** Ontology class — pre-Plan-04 returns `string[]`, post-Plan-04 returns objects. */
export interface OntologyClass {
  name: string
  level?: number
  parent?: string | null
  display?: {
    color?: string
    icon?: string
    shape?: string
  }
}

/** Entity neighborhood payload (Phase 44 /api/v1/entities/:id/neighbors). */
export interface NeighborhoodPayload {
  entity: Entity
  neighbors: Entity[]
  relations: Relation[]
}

/**
 * Phase 55 — confidence payload returned by `/api/v1/entities/:id/confidence`.
 * UI-SPEC §18 row 8. Backend wired in Plan 55-06; the EntityDetailPanel
 * Confidence sub-tab consumes this lazily and falls back to a client
 * heuristic on 404 / network error (UI-SPEC §16).
 */
export interface ConfidenceSegment {
  runId: string
  score: number
  label: 'High' | 'Moderate' | 'Low'
}
export interface ConfidencePayload {
  overall: { score: number; label: 'High' | 'Moderate' | 'Low' }
  segments: ConfidenceSegment[]
}

/** Phase 44 typed-view envelope shape (matches Pitfall 2 envelope in typed-views.test.js). */
export interface TypedViewEnvelope<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  /** Expose baseUrl for diagnostics + error-banner copy. */
  get base(): string {
    return this.baseUrl
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      throw new Error(`${url} → HTTP ${res.status}`)
    }
    const body = (await res.json()) as ApiSuccess<T> | ApiError
    if (!body.success) {
      throw new Error(body.error)
    }
    return body.data
  }

  listEntities(): Promise<Entity[]> {
    // Opt out of km-core's default 1000-entity clip (entities.js:64 — "clip to
    // 1000 if no caller limit AND large"). Without it, a graph with >1000 nodes
    // silently drops the overflow; any node beyond the cap (e.g. a freshly-
    // created hierarchy parent) and its edges vanish from the render, re-
    // surfacing as a phantom "island". The graph viewer needs the full set.
    //
    // NOTE: the handler's documented `limit=0` opt-out is broken — it computes
    // `hasCallerLimit = callerLimit > 0`, so 0 falls through to the default
    // clip. We pass an explicit large cap instead until km-core honors 0.
    return this.get<Entity[]>('/api/v1/entities?limit=1000000')
  }

  async listRelations(): Promise<Relation[]> {
    // Phase 44 wire shape is the graphology edge envelope:
    //   { key, source, target, attributes: { type, metadata, createdAt } }
    // (km-core/api/handlers/relations.js emits via relationToWire per
    // 44-CONTEXT-amendment.md). Normalize to {from, to, type} here so the
    // graph-builder's `r.from`/`r.to` reads keep working — otherwise every
    // edge is silently dropped at graph-build time because `r.from` is
    // undefined and `graph.hasNode(undefined)` is false.
    const raw = await this.get<Array<{
      key?: string
      source?: string
      target?: string
      from?: string
      to?: string
      type?: string
      attributes?: { type?: string; metadata?: unknown; createdAt?: string }
    }>>('/api/v1/relations')
    return raw.map((r) => ({
      from: r.source ?? r.from ?? '',
      to: r.target ?? r.to ?? '',
      type: r.attributes?.type ?? r.type,
    }))
  }

  /**
   * Phase 45 Plan 04 extension. Targets `?withDisplay=true` by default.
   * BC fallback: if the server still returns `string[]` (current pre-Plan-04
   * shape), map to `[{name: s}]` so callers see a uniform OntologyClass[].
   */
  async listOntologyClasses(): Promise<OntologyClass[]> {
    const raw = await this.get<unknown>('/api/v1/ontology/classes?withDisplay=true')
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
      // Pre-Plan-04 shape — wrap so consumers can rely on `.name`.
      return (raw as string[]).map((name) => ({ name }))
    }
    return raw as OntologyClass[]
  }

  /** Back-compat path — explicit pre-Plan-04 shape (array of class-name strings). */
  listOntologyClassesNoDisplay(): Promise<string[]> {
    return this.get<string[]>('/api/v1/ontology/classes')
  }

  getNeighbors(id: string, depth = 1): Promise<NeighborhoodPayload> {
    const safeId = encodeURIComponent(id)
    return this.get<NeighborhoodPayload>(
      `/api/v1/entities/${safeId}/neighbors?depth=${depth}`,
    )
  }

  /**
   * Phase 55 Plan 09 — lazy fetch the Confidence sub-tab bands.
   * Backend wired in Plan 55-06 (UI-SPEC §18 row 8). The EntityDetailPanel
   * Confidence sub-tab calls this once per `selectedNodeId`; on rejection
   * (404 / network), it falls back to the client heuristic per NodeDetails.tsx
   * :165-213 (UI-SPEC §16).
   */
  getEntityConfidence(id: string): Promise<ConfidencePayload> {
    const safeId = encodeURIComponent(id)
    return this.get<ConfidencePayload>(`/api/v1/entities/${safeId}/confidence`)
  }

  // Phase 44 typed views (camelCase wire shape per Plan 44-16 lock).
  // Path is system-specific — `/api/coding/*` for A. Other systems will mount
  // their own typed-view paths in later phases; coding is what's live today.
  listDigests(limit = 50): Promise<TypedViewEnvelope<Digest>> {
    return this.get<TypedViewEnvelope<Digest>>(`/api/coding/digests?limit=${limit}`)
  }

  listInsights(limit = 50): Promise<TypedViewEnvelope<Insight>> {
    return this.get<TypedViewEnvelope<Insight>>(`/api/coding/insights?limit=${limit}`)
  }

  listObservations(limit = 50): Promise<TypedViewEnvelope<Observation>> {
    return this.get<TypedViewEnvelope<Observation>>(`/api/coding/observations?limit=${limit}`)
  }
}
