// PATTERN SOURCE: 45-PATTERNS.md § OkmRcaClient.ts
// CONTRACT: 45-05-PLAN.md <interfaces> block — verbatim port of VOKB's
//           okbClient.ts:474-497 surface (listDirs / getStatus / rcaIngest
//           / subscribeProgress).
//
// KEEPS km-core /api/v1/* PURE — OKM RCA lives at /api/okm/rca/* (NOT
// inside /api/v1/*), so this client is intentionally SEPARATE from
// ApiClient. The viewer instantiates OkmRcaClient ONLY when system === 'cap'
// (per RESEARCH § Architectural Responsibility Map row 9).
//
// Threat model anchors (45-05-PLAN.md <threat_model>):
//   T-45-05-01 Information Disclosure (CORS/SSO from non-corp browser) —
//     mitigation: Plan 06 Wave-0 operator probes; UI degrades to
//     ErrorUnreachable/CorsState (no crash here, just rejected fetch).
//   T-45-05-02 Denial of Service (EventSource leak on unmount) —
//     mitigation: subscribeProgress() RETURNS the EventSource so the caller
//     OWNS the lifecycle. JSDoc on the method explicitly says: caller MUST
//     `.close()` on unmount. The RcaOpsPanel useEffect cleanup does so.
//   T-45-05-03 Tampering (CSRF on POST /ingest) —
//     mitigation: TRANSFERRED to OKM service (SameSite / token). We attach
//     credentials:'include' so the cookie travels; CSRF token handling
//     would be added here if OKM emits one (not in MVP).
//
// Wire shape (verbatim from VOKB):
//   GET  /api/okm/rca/dirs       → RcaDirGroups
//   GET  /api/okm/rca/status     → IngestionStatus
//   POST /api/okm/rca/ingest     {pipeline, dirPath, force} → IngestStartResponse
//   SSE  /api/okm/ingest/progress → stream of PipelineEvent

/** Three pipelines hosted by the C-system OKM service. */
export type Pipeline = 'kpifw' | 'raas' | 'e2e'

/** One RCA directory under .data/rca/<pipeline>/. */
export interface RcaDir {
  path: string
  timestamp: string
  findingCount: number
}

/** Grouped dir listing — the shape returned by GET /api/okm/rca/dirs. */
export interface RcaDirGroups {
  kpifw: RcaDir[]
  raas: RcaDir[]
  e2e: RcaDir[]
}

/** Snapshot of the OKM ingestion service state, returned by GET /api/okm/rca/status. */
export interface IngestionStatus {
  active: boolean
  pipeline?: Pipeline
  dirPath?: string
  currentStage?: 'extract' | 'dedup' | 'store' | 'synthesize' | 'resolve'
  /** 0-100. */
  progress?: number
  /** ISO timestamp. */
  startedAt?: string
}

/** SSE event shape from /api/okm/ingest/progress. */
export interface PipelineEvent {
  type: 'connected' | 'stage' | 'progress' | 'complete' | 'error'
  stage?: string
  progress?: number
  message?: string
  timestamp?: string
}

/** Response shape from POST /api/okm/rca/ingest. */
export interface IngestStartResponse {
  success: boolean
  runId?: string
  error?: string
}

/** Optional flags to rcaIngest(). */
export interface RcaIngestOpts {
  force?: boolean
}

/**
 * REST + SSE client for OKM RCA ingestion ops. INSTANTIATE ONLY when
 * `system === 'cap'` (the C-system). A and B never construct this — per
 * RESEARCH § Architectural Responsibility Map row 9.
 *
 * The caller OWNS the EventSource returned by subscribeProgress(). It MUST
 * call `.close()` on unmount or the connection leaks (T-45-05-02).
 */
export class OkmRcaClient {
  constructor(private readonly baseUrl: string) {}

  /** Expose baseUrl for diagnostics + error-banner copy. */
  get base(): string {
    return this.baseUrl
  }

  /** GET — list available .data/rca/{kpifw,raas,e2e} directories. */
  async listDirs(): Promise<RcaDirGroups> {
    const path = '/api/okm/rca/dirs'
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} at ${path}`)
    }
    return (await res.json()) as RcaDirGroups
  }

  /** GET — current ingestion-service status. */
  async getStatus(): Promise<IngestionStatus> {
    const path = '/api/okm/rca/status'
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} at ${path}`)
    }
    return (await res.json()) as IngestionStatus
  }

  /**
   * POST — trigger an ingestion run. `opts.force` defaults to false (re-runs
   * are explicit per VOKB:408-420 toggle behaviour).
   *
   * NOTE: CSRF protection is the OKM service's responsibility (T-45-05-03 —
   * dispositioned `transfer`). We attach `credentials:'include'` so an SSO
   * cookie ships with the request; if OKM emits a CSRF meta-tag token in
   * a future plan, plumb it through here.
   */
  async rcaIngest(
    pipeline: Pipeline,
    dirPath: string,
    opts?: RcaIngestOpts,
  ): Promise<IngestStartResponse> {
    const path = '/api/okm/rca/ingest'
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipeline,
        dirPath,
        force: opts?.force ?? false,
      }),
    })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} at ${path}`)
    }
    return (await res.json()) as IngestStartResponse
  }

  /**
   * Subscribe to the ingestion progress SSE stream. Returns the underlying
   * EventSource so the caller can:
   *   - Inspect `readyState` for diagnostic purposes
   *   - Call `.close()` on unmount (MANDATORY — T-45-05-02 leak mitigation)
   *
   * Malformed JSON payloads do NOT throw — the callback receives a synthetic
   * `{type:'error', message: ...}` event instead so the panel can decide
   * whether to render an error banner. The EventSource itself stays open
   * (auto-reconnect behaviour preserved).
   *
   * @example
   *   useEffect(() => {
   *     const es = client.subscribeProgress(onEvent)
   *     return () => es.close()   // MANDATORY cleanup
   *   }, [client])
   */
  subscribeProgress(onMessage: (event: PipelineEvent) => void): EventSource {
    const url = `${this.baseUrl}/api/okm/ingest/progress`
    const es = new EventSource(url, { withCredentials: true } as EventSourceInit)
    es.onmessage = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as PipelineEvent
        onMessage(parsed)
      } catch (err) {
        onMessage({
          type: 'error',
          message: err instanceof Error ? err.message : 'SSE parse error',
        })
      }
    }
    es.onerror = () => {
      onMessage({ type: 'error', message: 'EventSource error' })
    }
    return es
  }
}
