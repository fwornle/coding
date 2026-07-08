import { createSlice, createAsyncThunk, createSelector, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../index'
import { normalizeModel } from '@/components/performance/models'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// A Run row as returned by GET /api/experiments/runs. The endpoint returns
// `{ rows: [...] }` where each row is the Run metadata spread flat with a
// joined `score` and `outcome` (Plan 74-04 SUMMARY: handleRunsQuery returns
// `{ rows }`, each row = { ...runMetadata, score, outcome }). Typed loosely
// on the variable-payload fields — the score/outcome shapes ride in metadata
// and evolve; consumers narrow at the usage site (corrected-wins helper).

export interface RunScore {
  goal_aligned_ratio?: number | null
  goal_achieved?: number | null
  code_quality?: number | null
  test_coverage?: number | null
  regressions?: number | null
  spec_drift?: number | null
  corrected_goal_achieved?: number | null
  corrected_code_quality?: number | null
  corrected_test_coverage?: number | null
  corrected_regressions?: number | null
  corrected_spec_drift?: number | null
  overridden_by?: string | null
  overridden_at?: string | null
  pending?: boolean | null
  // WR-02: the writer (lib/experiments/score-write.mjs / judge.mjs) persists
  // this as the string literal 'trivial' (D-04) or null — NOT a boolean. The
  // consumer (scoreStateOf) only does a truthy check, so 'trivial' worked at
  // runtime, but the boolean type was wrong (run.score.not_scored === true would
  // never match). Type it to the real domain value.
  not_scored?: 'trivial' | boolean | null
  [key: string]: number | string | boolean | null | undefined
}

export interface RunOutcome {
  totalTokens?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
  closedState?: string | null
  [key: string]: number | string | boolean | null | undefined
}

export interface Run {
  task_id: string
  task_class?: string | null
  agent?: string | null
  model?: string | null
  // ATTR-02 (D-05/D-06): canonical = the foreground chat agent/model computed
  // ONCE at measurement-stop and persisted on Run.metadata (run-write.mjs). All
  // three Performance surfaces READ these — never recompute per surface (the
  // per-surface recompute is exactly how finding B's dominant-vs-first-row
  // divergence arose). Empty canonical persists as null → the "unmeasured"
  // sentinel (legacy Run with no foreground capture), NEVER a dominant fallback.
  canonical_model?: string | null
  canonical_agent?: string | null
  // The concurrent background-service models (consolidator/health-coordinator/
  // observation-writer …) segregated from the foreground chat. Empty → []
  // (renders the em-dash sentinel), never coerced.
  background_models?: { model: string; process: string; total_tokens: number }[]
  framework?: string | null
  // Human-readable goal sentence typed at measurement start (persisted on the
  // Run entity's `description`, surfaced by readRuns as goal_sentence). null for
  // legacy runs that recorded no goal. Distinct from the goal_achieved *score*.
  goal_sentence?: string | null
  pending?: boolean | null
  started_at?: string | null
  ended_at?: string | null
  // route heuristics (may be null = "could not compute")
  loop_count?: number | null
  edit_revert_count?: number | null
  redundant_read_count?: number | null
  abandoned_tool_count?: number | null
  total_step_count?: number | null
  wallclock_per_step?: number | null
  score: RunScore | null
  outcome: RunOutcome | null
  [key: string]: unknown
}

// A timeline row as returned by GET /api/experiments/runs/:taskId/timeline.
// `{ timeline: [...] }` where each parent carries a tier badge + children
// (per-reasoning-step sub-bands). tier ∈ {per-turn, per-reasoning-step,
// per-session-aggregate}.
export type GranularityTier = 'per-turn' | 'per-reasoning-step' | 'per-session-aggregate'

export interface TimelineRow {
  tool_call_id?: string | null
  parent_call_id?: string | null
  granularity_tier: GranularityTier | string
  timestamp?: string | null
  model?: string | null
  // What produced this row (e.g. consolidator-insight, observation-writer, or the
  // foreground chat agent). Rendered in the timeline so each row is identifiable
  // rather than an anonymous "Turn N · untagged" (finding-1 display gap).
  process?: string | null
  agent?: string | null
  provider?: string | null
  reasoning_tokens?: number | null
  input_tokens?: number | null
  output_tokens?: number | null
  total_tokens?: number | null
  // Prompt-cache tokens, surfaced SEPARATELY from total_tokens (which is input+output).
  // cache_read = cache HIT (cheap), cache_write = cache creation. A heavily-cached claude
  // run is dominated by these; without them it looks far cheaper than it is.
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
  tokens_estimated?: number | null
  estimated?: boolean
  children?: TimelineRow[]
  [key: string]: unknown
}

// A per-message digest inside a context-turn line (D-07 fallback): the role,
// UTF-8 byte size, optional tool metadata, and a ≤120-char preview. Written
// VERBATIM by the proxy line-builder (buildAnthropicLine/buildOpenAILine).
export interface ContextTurnMessage {
  i: number
  role: string | null
  bytes: number
  tool: { name: string | null; size: number } | null
  preview: string
}

// A single per-request context-turns line as returned by
// GET /api/experiments/runs/:taskId/context-turns → `{ contextTurns: [...] }`.
// Served VERBATIM from the proxy's context-turns.jsonl(.gz) (Plan 84-04 write
// hook + 84-07 read route). The `wire` discriminator is load-bearing: OpenAI-wire
// lines carry `usage.cache_write: null` so the explainer renders "N/A (provider
// reports no cache-creation)" instead of an inferred 0 (D-12). The cache split is
// kept as four separate fields, never folded into a total (D-09).
export interface ContextTurnRow {
  ts: string
  task_id: string
  agent: string
  wire: 'anthropic' | 'openai'
  request_id: string
  model: string
  usage: {
    input: number
    output: number
    cache_read: number
    // null ONLY on the OpenAI wire — the provider reports no cache-creation
    // counter, so the UI must render N/A, never 0 (D-12).
    cache_write: number | null
  }
  // Message INDICES carrying cache_control (D-08) — empty [] on the OpenAI wire.
  cache_breakpoints: number[]
  categories: { key: string; label: string; bytes: number }[]
  messages: ContextTurnMessage[]
  // Correlated at span close (Plan 84-05); null in the hot path. When an ETM
  // observation lands in the turn's time+agent window it carries the semantic
  // "what this turn is doing" — `intent` is a ≤120-char snippet of the
  // observation's Intent clause (D-07 primary explanation), `theme` optional.
  observation_ref: { id: string; intent: string; theme?: string } | string | null
}

// A development-narrative item: an observation written during a run's time window,
// carrying the plain-language "Intent: …" of a foreground turn. Joined by time
// window + agent (observations have no task_id), so it is best-effort and only
// meaningful for real coding runs.
export interface NarrativeItem {
  id: string
  timestamp: string | null
  agent: string | null
  content: string
  artifacts?: unknown[]
}

// A digest: the consolidated, higher-level summary the knowledge pipeline writes
// over a set of observations. `observationIds` is the load-bearing link — it lets
// the timeline tie a digest back to the exact observations (and therefore turns)
// of a run, instead of a fuzzy time-window guess.
export interface DigestItem {
  id: string
  date: string | null
  createdAt: string | null
  theme: string
  summary: string
  observationIds: string[]
}

// Score-state buckets surfaced as a facet (D-06 quarantine + scored/not_scored).
export type ScoreState = 'scored' | 'pending' | 'not_scored'

// A saved Report as returned by GET /api/experiments/reports (report-read.mjs
// toView): the FROZEN snapshot + facet_state deserialized. DASH-03: the view
// renders `snapshot` verbatim and NEVER re-queries on view.
export interface Report {
  reportId: string
  title: string
  createdBy?: string | null
  createdAt?: string | null
  snapshotFrozenAt?: string | null
  facetState: Partial<FacetState> | Record<string, unknown>
  snapshot: Run[]
}

// A single per-dimension override edit issued by the drawer Save.
export interface OverrideEdit {
  dimension: string
  value: number
}

// The facet selection state. Each set holds the SELECTED values for that facet
// group; an empty set means "no filter on this group" (everything passes).
export interface FacetState {
  task_id: string[]
  task_class: string[]
  agent: string[]
  model: string[]
  framework: string[]
  scoreState: ScoreState[]
  // date window (ISO bounds); null = unbounded on that side
  startedAfter: string | null
  startedBefore: string | null
}

export type FacetKey = keyof Omit<FacetState, 'startedAfter' | 'startedBefore'>

interface PerformanceState {
  facetState: FacetState
  // When true, fetchRuns requests ?includePending=true so D-06-quarantined
  // (pending) runs — e.g. trivial/unclassified smoke runs — are surfaced in the
  // Runs table instead of hidden. Default false: quarantined runs stay out of the
  // comparison view (the server excludes them unless includePending is set).
  includePending: boolean
  runs: Run[]
  runsLoading: boolean
  runsError: string | null
  selectedTaskId: string | null // drives the inline Timeline panel (row click)
  overrideTaskId: string | null // drives the modal Score-override drawer (explicit "Edit scores")
  explainTaskId: string | null // drives the Context/Caching explainer dialog (explicit "Explain" button)
  selectedRunIds: string[] // multi-select for bulk run deletion
  deleteRunsPending: boolean
  compareA: string | null // run-comparison view: left run
  compareB: string | null // run-comparison view: right run
  timelineByTaskId: Record<string, TimelineRow[]>
  timelineLoading: boolean
  timelineError: string | null
  // Per-request context-turns (Plan 84-08) keyed by taskId, mirroring the
  // timeline cache above. Populated by fetchContextTurns.
  contextTurnsByTaskId: Record<string, ContextTurnRow[]>
  narrativeByTaskId: Record<string, NarrativeItem[]>
  narrativeLoadingId: string | null
  digestsByTaskId: Record<string, DigestItem[]>
  digestLoadingId: string | null
  // Saved Reports (KB-04 / DASH-03) — shared cross-component state.
  reports: Report[]
  activeReportId: string | null
  reportsLoading: boolean
  reportsError: string | null
  saveReportPending: boolean
  // Per-id refresh pending so multiple report cards can refresh independently.
  refreshReportPendingIds: string[]
  // Score-override (SCORE-02) save state — drawer reads these to branch on
  // success / 404 / 400.
  saveOverridePending: boolean
  saveOverrideError: string | null
  saveOverrideStatus: number | null
  saveOverrideSuccessAt: number | null
  // Measurement lifecycle control (dashboard-only MVP).
  activeMeasurement: ActiveMeasurement | null
  measurementLoading: boolean
  measurementError: string | null
  lastCloseCommand: string | null // host command surfaced after Stop
  // Experiment Control Center (Plan 85-05).
  specList: SpecSummary[]
  specListLoading: boolean
  // The run currently being monitored (drives the 5s run-status poll). Set on a
  // successful launch; cleared when the operator dismisses the monitor.
  activeRunId: string | null
  runStatus: RunProgress | null
  runStatusError: string | null
  // The 409-holder / validation message surfaced after a rejected launch (never
  // a silent failure — D-09).
  launchError: string | null
  launchPending: boolean
  // D-11 re-run pre-fill payload (set by the runs-table Re-run button, consumed
  // + cleared by the launcher on mount).
  launcherPrefill: LauncherPrefill | null
}

// The active measurement span (mirrors .data/active-measurement.json).
export interface ActiveMeasurement {
  task_id: string
  started_at: string
  goal_sentence?: string
}

// ---------------------------------------------------------------------------
// Experiment Control Center (Plan 85-05, D-09/D-10/D-11/D-12)
// ---------------------------------------------------------------------------

// One resolved spec summary as returned by GET /api/experiments/specs (Plan 04
// handleSpecList): `{ specs: [{ file, goal_sentence, repeats, variantCount,
// cellCount, snapshot_id, variants }] }`. cellCount is computed SERVER-SIDE
// (variantCount × repeats) — D-09: the launcher previews this number, it does
// NOT recompute the axes client-side. A malformed spec is listed with `error`
// (not fatal) so the picker can show it disabled.
export interface SpecSummary {
  file: string
  goal_sentence?: string | null
  repeats?: number | null
  variantCount?: number | null
  cellCount?: number | null
  snapshot_id?: string | null
  variants?: string[] | null
  // Present only when resolveExperimentSpec threw for this file — the endpoint
  // lists it rather than dropping it (Plan 04).
  error?: string | null
}

// The per-variant model/agent override map (D-06). Keyed by the ORIGINAL variant
// name — the runner's applyVariantOverride (Plan 01 Task 4) keys on this exact
// name. This is the cross-plan contract field name — do NOT rename in isolation.
export interface VariantOverride {
  model?: string
  agent?: string
}

// The overrides payload bundled into launchExperiment's body. Matches the Plan
// 01/04 runner/API field names exactly (repeats/timeout/variants/
// capture_raw_bodies/variantOverrides). Every field optional — an empty object
// means "run the spec as-authored".
export interface ExperimentOverrides {
  repeats?: number
  timeout?: number
  // The variant SUBSET to run (D-06). Each entry must be one of the spec's
  // resolved variant names — the server re-validates (Plan 04 _validateOverrides).
  variants?: string[]
  // D-12 — default OFF. When true the proxy captures raw request/response bodies
  // for the measured cells (rawBodyCaptureEnabled strict === true).
  capture_raw_bodies?: boolean
  // D-06 per-variant model/agent override map, keyed by ORIGINAL variant name.
  variantOverrides?: Record<string, VariantOverride>
}

// The verbatim progress.json served by GET /api/experiments/run-status/:runId
// (Plan 04 handleRunStatus). Rendered STRAIGHT by the monitor (D-10, no log-tail).
// ENOENT is served gracefully as `{ runId, overall:'unknown', cells:[] }`.
export type RunCellState =
  | 'pending' | 'restoring' | 'running' | 'scoring'
  | 'complete' | 'timeout' | 'abort' | 'skipped'

export interface RunProgressCell {
  variant: string
  rep: number
  task_id?: string | null
  state: RunCellState | string
  started_at?: string | null
  ended_at?: string | null
  // Abort/skip explanation (D-10). Rendered as React text content (auto-escaped)
  // — never dangerouslySetInnerHTML (T-85-05-03).
  reason?: string | null
  [key: string]: unknown
}

export interface RunProgress {
  run_id?: string | null
  // The graceful-empty ENOENT shape names the id as `runId`; a live progress.json
  // names it `run_id`. Both are tolerated by the selectors.
  runId?: string | null
  spec?: string | null
  snapshot_id?: string | null
  pid?: number | null
  done?: number | null
  total?: number | null
  overall?: string | null
  cells: RunProgressCell[]
  [key: string]: unknown
}

// The D-11 re-run pre-fill payload. Set by the runs-table Re-run button and
// consumed by the launcher to pre-populate the spec select + snapshot_id +
// rerun_of + override fields (including any seeded per-variant variantOverrides).
export interface LauncherPrefill {
  spec: string
  snapshot_id?: string | null
  rerun_of?: string | null
  overrides?: ExperimentOverrides
}

const emptyFacetState: FacetState = {
  task_id: [],
  task_class: [],
  agent: [],
  model: [],
  framework: [],
  scoreState: [],
  startedAfter: null,
  startedBefore: null,
}

const initialState: PerformanceState = {
  facetState: emptyFacetState,
  includePending: false,
  runs: [],
  runsLoading: false,
  runsError: null,
  selectedTaskId: null,
  overrideTaskId: null,
  explainTaskId: null,
  selectedRunIds: [],
  deleteRunsPending: false,
  compareA: null,
  compareB: null,
  timelineByTaskId: {},
  timelineLoading: false,
  timelineError: null,
  contextTurnsByTaskId: {},
  narrativeByTaskId: {},
  narrativeLoadingId: null,
  digestsByTaskId: {},
  digestLoadingId: null,
  reports: [],
  activeReportId: null,
  reportsLoading: false,
  reportsError: null,
  saveReportPending: false,
  refreshReportPendingIds: [],
  saveOverridePending: false,
  saveOverrideError: null,
  saveOverrideStatus: null,
  saveOverrideSuccessAt: null,
  activeMeasurement: null,
  measurementLoading: false,
  measurementError: null,
  lastCloseCommand: null,
  specList: [],
  specListLoading: false,
  activeRunId: null,
  runStatus: null,
  runStatusError: null,
  launchError: null,
  launchPending: false,
  launcherPrefill: null,
}

// Default operator identity stamped into overridden_by when no richer identity
// source is wired into the dashboard (documented in 74-06-SUMMARY). The server
// caps overridden_by at 256 chars and requires non-empty — this satisfies both.
export const DEFAULT_OVERRIDDEN_BY = 'dashboard-operator'

// ---------------------------------------------------------------------------
// Async thunks — fetch lives INSIDE the thunk, same-origin /api/experiments/...
// (NOT host:port). Mirrors initializeWorkflowConfig's rejectWithValue idiom.
// ---------------------------------------------------------------------------

export const fetchRuns = createAsyncThunk(
  'performance/fetchRuns',
  // Optional override: pass a boolean to force include/exclude quarantined runs.
  // When omitted (mount, score-drawer re-dispatch), read the current toggle from
  // state so every refetch respects the operator's "Show quarantined" choice.
  async (includePending: boolean | void | undefined, { getState, rejectWithValue }) => {
    try {
      const inc = typeof includePending === 'boolean'
        ? includePending
        : (getState() as RootState).performance.includePending
      const url = inc ? '/api/experiments/runs?includePending=true' : '/api/experiments/runs'
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }
      const data = await response.json()
      // Plan 74-04 contract: handler returns `{ rows }`. Tolerate `{ runs }`
      // as a defensive fallback so a future endpoint rename doesn't silently
      // blank the table.
      const rows: Run[] = (data?.rows ?? data?.runs ?? []) as Run[]
      return rows
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// Delete one or more runs (Run + joined Score/Outcome/Route) from the experiment
// store, then re-fetch the runs list and clear the selection. Server-authoritative
// via DELETE /api/experiments/runs { taskIds }.
export const deleteSelectedRuns = createAsyncThunk<
  { deleted: string[]; entities: number },
  string[],
  { rejectValue: string }
>(
  'performance/deleteSelectedRuns',
  async (taskIds, { dispatch, rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/runs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds }),
      })
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      // Refresh the table so the deleted rows disappear (respects the current
      // includePending toggle via the no-arg fetchRuns).
      await dispatch(fetchRuns())
      return { deleted: (data?.deleted ?? []) as string[], entities: (data?.entities ?? 0) as number }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Delete failed')
    }
  }
)

export const fetchTimeline = createAsyncThunk(
  'performance/fetchTimeline',
  async (taskId: string, { rejectWithValue }) => {
    try {
      const response = await fetch(`/api/experiments/runs/${encodeURIComponent(taskId)}/timeline`)
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }
      const data = await response.json()
      const timeline: TimelineRow[] = (data?.timeline ?? []) as TimelineRow[]
      return { taskId, timeline }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// fetchContextTurns (Plan 84-08): pull the per-request context-turns lines the
// proxy appended for THIS run (Plan 84-04 write hook), served VERBATIM by the vkb
// read route (Plan 84-07). Mirrors fetchTimeline exactly — same-origin, graceful
// on absence (the route returns `{ contextTurns: [] }` on miss, never 500). Feeds
// the honest per-turn sent/cached/fresh split into the cache explainer.
export const fetchContextTurns = createAsyncThunk(
  'performance/fetchContextTurns',
  async (taskId: string, { rejectWithValue }) => {
    try {
      const response = await fetch(`/api/experiments/runs/${encodeURIComponent(taskId)}/context-turns`)
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }
      const data = await response.json()
      const contextTurns: ContextTurnRow[] = (data?.contextTurns ?? []) as ContextTurnRow[]
      return { taskId, contextTurns }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// fetchRunNarrative (B): join the plain-language "Intent: …" observations written
// during a run's time window into a chronological development story. Observations
// have no task_id, so the join is by [from,to] window + agent (best-effort). The
// caller computes the window from the run (started/ended or timeline min/max).
export const fetchRunNarrative = createAsyncThunk<
  { taskId: string; items: NarrativeItem[] },
  { taskId: string; from: string; to: string; agent?: string | null },
  { rejectValue: string }
>(
  'performance/fetchRunNarrative',
  async ({ taskId, from, to, agent }, { rejectWithValue }) => {
    try {
      const qs = new URLSearchParams({ from, to, limit: '200' })
      if (agent) qs.set('agent', agent)
      const response = await fetch(`/api/observations?${qs.toString()}`)
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      const raw: Record<string, unknown>[] = data?.data ?? data?.observations ?? data?.rows ?? []
      const items: NarrativeItem[] = raw.map((r) => ({
        id: String(r.id ?? ''),
        timestamp: (r.timestamp ?? r.createdAt ?? null) as string | null,
        agent: (r.agent ?? null) as string | null,
        content: String(r.content ?? r.summary ?? ''),
        artifacts: Array.isArray(r.artifacts) ? r.artifacts : Array.isArray(r.modifiedFiles) ? r.modifiedFiles : [],
      }))
      // Oldest → newest so the story reads top-to-bottom.
      items.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
      return { taskId, items }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// fetchRunDigests: pull the digests that consolidate a run's observations. Digests
// carry `observationIds`, so the caller can precisely intersect them with the run's
// narrative observations (rather than a fuzzy time guess). The date window is a
// coarse pre-filter passed to the API; the exact tie is done in the selector/UI by
// observationIds. Best-effort, mirrors fetchRunNarrative.
export const fetchRunDigests = createAsyncThunk<
  { taskId: string; items: DigestItem[] },
  { taskId: string; from: string; to: string },
  { rejectValue: string }
>(
  'performance/fetchRunDigests',
  async ({ taskId, from, to }, { rejectWithValue }) => {
    try {
      const qs = new URLSearchParams({ from, to, limit: '200' })
      const response = await fetch(`/api/digests?${qs.toString()}`)
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      const raw: Record<string, unknown>[] = data?.data ?? data?.digests ?? data?.rows ?? []
      const items: DigestItem[] = raw.map((r) => ({
        id: String(r.id ?? ''),
        date: (r.date ?? null) as string | null,
        createdAt: (r.createdAt ?? null) as string | null,
        theme: String(r.theme ?? ''),
        summary: String(r.summary ?? ''),
        observationIds: Array.isArray(r.observationIds) ? r.observationIds.map((x) => String(x)) : [],
      }))
      items.sort((a, b) => (a.createdAt ?? a.date ?? '').localeCompare(b.createdAt ?? b.date ?? ''))
      return { taskId, items }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// saveOverride (SCORE-02 / D-02): issues ONE same-origin PATCH per edited
// dimension to the EXISTING Phase 73 endpoint. No applyOverride re-implementation
// — the server is authoritative (re-validates ranges, writes corrected_* to the
// dedicated experiment store). On all-success it re-dispatches fetchRuns so the
// corrected-wins table refreshes. A non-ok PATCH short-circuits with the HTTP
// status via rejectWithValue so the drawer can branch 400 (validation) vs 404
// (score changed/missing). Mirrors initializeWorkflowConfig's rejectWithValue idiom.
export const saveOverride = createAsyncThunk<
  { taskId: string; edits: OverrideEdit[]; overridden_by: string },
  { taskId: string; edits: OverrideEdit[]; overridden_by: string },
  { rejectValue: { status: number; message: string } }
>(
  'performance/saveOverride',
  async ({ taskId, edits, overridden_by }, { rejectWithValue }) => {
    for (const { dimension, value } of edits) {
      const response = await fetch(`/api/experiments/scores/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimension, value, overridden_by }),
      })
      if (!response.ok) {
        let message = `API returned ${response.status}`
        try {
          const body = await response.json()
          if (body?.message) message = body.message
        } catch {
          // non-JSON error body — keep the status message
        }
        return rejectWithValue({ status: response.status, message })
      }
    }
    // The PATCH persisted to the experiment LevelDB. We deliberately do NOT
    // re-dispatch fetchRuns here: the store's JSON export is debounced (~5s) and
    // km-core hydrate() prefers it, so an immediate re-read returns the
    // PRE-override snapshot and would clobber the corrected value back to judged.
    // Instead the fulfilled reducer applies an optimistic corrected-wins patch;
    // the next natural fetchRuns reconciles once the export catches up.
    return { taskId, edits, overridden_by }
  }
)

// fetchReports (KB-04 / DASH-03): GET the saved Reports (each with its FROZEN
// snapshot deserialized server-side). Same-origin.
export const fetchReports = createAsyncThunk<Report[], void | undefined, { rejectValue: string }>(
  'performance/fetchReports',
  async (_: void | undefined, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/reports')
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      return (data?.reports ?? []) as Report[]
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// saveReport (KB-04): POST the current facet-state + the currently-filtered run
// rows as the frozen snapshot. On success re-dispatch fetchReports so the new
// report appears in the slice list. Same-origin.
export const saveReport = createAsyncThunk<
  { reportId: string },
  { title: string; facetState: FacetState; snapshotRows: Run[] },
  { rejectValue: string }
>(
  'performance/saveReport',
  async ({ title, facetState, snapshotRows }, { dispatch, rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, facetState, snapshotRows }),
      })
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      await dispatch(fetchReports())
      return { reportId: data?.reportId as string }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// refreshReport (DASH-03): re-run the saved query server-side and overwrite ONLY
// the snapshot + frozen-at. On success re-dispatch fetchReports to pull the new
// frozen-at. Same-origin.
export const refreshReport = createAsyncThunk<
  { reportId: string },
  string,
  { rejectValue: string }
>(
  'performance/refreshReport',
  async (reportId: string, { dispatch, rejectWithValue }) => {
    try {
      const response = await fetch(`/api/experiments/reports/${encodeURIComponent(reportId)}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      await dispatch(fetchReports())
      return { reportId }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// Measurement lifecycle (dashboard-only MVP) — same-origin /api/experiments/measurement/*.
export const fetchActiveMeasurement = createAsyncThunk<
  ActiveMeasurement | null, void | undefined, { rejectValue: string }
>(
  'performance/fetchActiveMeasurement',
  async (_arg, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/measurement/active')
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      return data.active ? (data.span as ActiveMeasurement) : null
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

export const startMeasurement = createAsyncThunk<
  ActiveMeasurement, { task_id: string; goal: string }, { rejectValue: string }
>(
  'performance/startMeasurement',
  async ({ task_id, goal }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/measurement/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id, goal }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || `API returned ${response.status}`)
      return data.span as ActiveMeasurement
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

export const stopMeasurement = createAsyncThunk<
  { close_command: string }, { task_class?: string }, { rejectValue: string }
>(
  'performance/stopMeasurement',
  async ({ task_class }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/measurement/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_class }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || `API returned ${response.status}`)
      return { close_command: data.close_command as string }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// ---------------------------------------------------------------------------
// Experiment Control Center thunks (Plan 85-05) — same-origin
// /api/experiments/*. Mirror the startMeasurement/fetchActiveMeasurement shape:
// a rejected POST surfaces `data?.message` (the 409 holder) via rejectWithValue
// so the launcher can render it, never a silent failure (D-09).
// ---------------------------------------------------------------------------

// fetchSpecList (D-09): GET the resolved variant-matrix preview for every
// config/experiments/*.yaml. Feeds the launcher's spec picker + cellCount preview.
export const fetchSpecList = createAsyncThunk<SpecSummary[], void | undefined, { rejectValue: string }>(
  'performance/fetchSpecList',
  async (_arg, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/specs')
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      return (data?.specs ?? []) as SpecSummary[]
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// launchExperiment (D-09/D-11/D-12): POST a chosen spec + overrides (+ rerun_of).
// The `overrides` object carries the D-06 variantOverrides map per the cross-plan
// contract — forwarded whole, not renamed. A 409 (interactive span or a live run
// already holding the single slot) surfaces the holder message via rejectWithValue
// — the operator always sees WHY the launch was refused (D-09).
export const launchExperiment = createAsyncThunk<
  { run_id: string; pid?: number | null },
  { spec: string; overrides?: ExperimentOverrides; rerun_of?: string | null },
  { rejectValue: string }
>(
  'performance/launchExperiment',
  async ({ spec, overrides, rerun_of }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, overrides: overrides ?? {}, rerun_of: rerun_of ?? null }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return { run_id: data.run_id as string, pid: (data.pid ?? null) as number | null }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// fetchRunStatus (D-10): GET the verbatim progress.json for a run. Polled every 5s
// by the monitor. The server serves ENOENT gracefully as
// `{ runId, overall:'unknown', cells:[] }`, so this never 500s on a not-yet-started
// run.
export const fetchRunStatus = createAsyncThunk<RunProgress, string, { rejectValue: string }>(
  'performance/fetchRunStatus',
  async (runId, { rejectWithValue }) => {
    try {
      const response = await fetch(`/api/experiments/run-status/${encodeURIComponent(runId)}`)
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      // Normalize the cells array so downstream renders never index into undefined.
      return { ...data, cells: Array.isArray(data?.cells) ? data.cells : [] } as RunProgress
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// cancelRun (D-08): POST a run cancel. The server delegates a negated-pid group
// kill to the host coordinator — it acts immediately (no graceful-after-cell
// latency). Body carries run_id + run_dir (Plan 04 handleRunCancel reads run.json
// for the pid).
export const cancelRun = createAsyncThunk<
  { killed?: boolean; run_id?: string },
  { run_id: string; run_dir?: string },
  { rejectValue: string }
>(
  'performance/cancelRun',
  async ({ run_id, run_dir }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/run-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id, run_dir }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return { killed: data?.killed as boolean, run_id: data?.run_id as string }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const performanceSlice = createSlice({
  name: 'performance',
  initialState,
  reducers: {
    // Toggle a single facet value within an array-valued facet group.
    setFacet(state, action: PayloadAction<{ key: FacetKey; value: string }>) {
      const { key, value } = action.payload
      const arr = state.facetState[key] as string[]
      const idx = arr.indexOf(value)
      if (idx === -1) arr.push(value)
      else arr.splice(idx, 1)
    },
    // Toggle whether D-06-quarantined (pending) runs are requested. The caller
    // re-dispatches fetchRuns after flipping this so the table reloads with the
    // new ?includePending value.
    setIncludePending(state, action: PayloadAction<boolean>) {
      state.includePending = action.payload
    },
    // Set the date-window bounds (either side may be null = unbounded).
    setDateWindow(state, action: PayloadAction<{ startedAfter?: string | null; startedBefore?: string | null }>) {
      if ('startedAfter' in action.payload) state.facetState.startedAfter = action.payload.startedAfter ?? null
      if ('startedBefore' in action.payload) state.facetState.startedBefore = action.payload.startedBefore ?? null
    },
    clearFilters(state) {
      state.facetState = {
        task_id: [],
        task_class: [],
        agent: [],
        model: [],
        framework: [],
        scoreState: [],
        startedAfter: null,
        startedBefore: null,
      }
    },
    setSelectedTaskId(state, action: PayloadAction<string | null>) {
      // Row selection drives ONLY the inline Timeline panel — never the modal
      // drawer (decoupled so the timeline is viewable without the dimming overlay).
      state.selectedTaskId = action.payload
    },
    setOverrideTaskId(state, action: PayloadAction<string | null>) {
      // Explicit "Edit scores" affordance opens the modal Score-override drawer.
      state.overrideTaskId = action.payload
      // Opening/closing a run resets the transient override save state so a stale
      // error/success banner never leaks across runs.
      state.saveOverrideError = null
      state.saveOverrideStatus = null
      state.saveOverrideSuccessAt = null
    },
    setExplainTaskId(state, action: PayloadAction<string | null>) {
      // Explicit "Explain context & caching" affordance opens the read-only
      // ContextCacheExplainer dialog. Decoupled from row selection (like the
      // score drawer) so the inline Timeline panel stays viewable underneath.
      state.explainTaskId = action.payload
    },
    toggleRunSelected(state, action: PayloadAction<string>) {
      const id = action.payload
      const i = state.selectedRunIds.indexOf(id)
      if (i === -1) state.selectedRunIds.push(id)
      else state.selectedRunIds.splice(i, 1)
    },
    // Replace the whole selection (used by select-all / select-none over the
    // currently-filtered set; the caller passes the exact id list).
    setRunsSelected(state, action: PayloadAction<string[]>) {
      state.selectedRunIds = action.payload
    },
    clearRunSelection(state) {
      state.selectedRunIds = []
    },
    setActiveReportId(state, action: PayloadAction<string | null>) {
      state.activeReportId = action.payload
    },
    setCompareA(state, action: PayloadAction<string | null>) {
      state.compareA = action.payload
    },
    setCompareB(state, action: PayloadAction<string | null>) {
      state.compareB = action.payload
    },
    clearOverrideStatus(state) {
      state.saveOverrideError = null
      state.saveOverrideStatus = null
      state.saveOverrideSuccessAt = null
    },
    // D-11: seed the launcher pre-fill (spec + snapshot_id + rerun_of + override
    // fields incl. per-variant variantOverrides). Dispatched by the runs-table
    // Re-run button; consumed + cleared by the launcher on mount.
    setLauncherPrefill(state, action: PayloadAction<LauncherPrefill | null>) {
      state.launcherPrefill = action.payload
      // Re-opening the launcher clears any stale launch error banner.
      state.launchError = null
    },
    clearLauncherPrefill(state) {
      state.launcherPrefill = null
    },
    // Set/clear the run being monitored (drives the 5s run-status poll).
    setActiveRunId(state, action: PayloadAction<string | null>) {
      state.activeRunId = action.payload
      if (action.payload === null) {
        state.runStatus = null
        state.runStatusError = null
      }
    },
    clearLaunchError(state) {
      state.launchError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRuns.pending, (state) => {
        state.runsLoading = true
        state.runsError = null
      })
      .addCase(fetchRuns.fulfilled, (state, action) => {
        state.runs = action.payload
        state.runsLoading = false
        state.runsError = null
      })
      .addCase(fetchRuns.rejected, (state, action) => {
        state.runsLoading = false
        state.runsError = (action.payload as string) ?? 'Failed to load runs'
      })
      .addCase(deleteSelectedRuns.pending, (state) => {
        state.deleteRunsPending = true
      })
      .addCase(deleteSelectedRuns.fulfilled, (state) => {
        state.deleteRunsPending = false
        state.selectedRunIds = [] // selection consumed; fetchRuns already re-dispatched
      })
      .addCase(deleteSelectedRuns.rejected, (state, action) => {
        state.deleteRunsPending = false
        state.runsError = (action.payload as string) ?? 'Failed to delete runs'
      })
      .addCase(fetchTimeline.pending, (state) => {
        state.timelineLoading = true
        state.timelineError = null
      })
      .addCase(fetchTimeline.fulfilled, (state, action) => {
        state.timelineByTaskId[action.payload.taskId] = action.payload.timeline
        state.timelineLoading = false
        state.timelineError = null
      })
      .addCase(fetchTimeline.rejected, (state, action) => {
        state.timelineLoading = false
        state.timelineError = (action.payload as string) ?? 'Failed to load timeline'
      })
      // fetchContextTurns (Plan 84-08) — store the per-request lines keyed by
      // taskId. Best-effort: on rejection we leave the existing (possibly empty)
      // array so the explainer degrades to the timeline path.
      .addCase(fetchContextTurns.fulfilled, (state, action) => {
        state.contextTurnsByTaskId[action.payload.taskId] = action.payload.contextTurns
      })
      .addCase(fetchRunNarrative.pending, (state, action) => {
        state.narrativeLoadingId = action.meta.arg.taskId
      })
      .addCase(fetchRunNarrative.fulfilled, (state, action) => {
        state.narrativeByTaskId[action.payload.taskId] = action.payload.items
        if (state.narrativeLoadingId === action.payload.taskId) state.narrativeLoadingId = null
      })
      .addCase(fetchRunNarrative.rejected, (state) => {
        state.narrativeLoadingId = null
      })
      .addCase(fetchRunDigests.pending, (state, action) => {
        state.digestLoadingId = action.meta.arg.taskId
      })
      .addCase(fetchRunDigests.fulfilled, (state, action) => {
        state.digestsByTaskId[action.payload.taskId] = action.payload.items
        if (state.digestLoadingId === action.payload.taskId) state.digestLoadingId = null
      })
      .addCase(fetchRunDigests.rejected, (state) => {
        state.digestLoadingId = null
      })
      // saveOverride (SCORE-02)
      .addCase(saveOverride.pending, (state) => {
        state.saveOverridePending = true
        state.saveOverrideError = null
        state.saveOverrideStatus = null
      })
      .addCase(saveOverride.fulfilled, (state, action) => {
        state.saveOverridePending = false
        state.saveOverrideError = null
        state.saveOverrideStatus = 200
        state.saveOverrideSuccessAt = Date.now()
        // Optimistic corrected-wins: the PATCH persisted, but the experiment
        // store's debounced JSON export means an immediate re-fetch returns stale
        // judged values. Apply the edits locally so the table reflects the
        // override instantly; a later fetchRuns reconciles with the server.
        const { taskId, edits, overridden_by } = action.payload
        const run = state.runs.find((r) => r.task_id === taskId)
        if (run && run.score) {
          for (const { dimension, value } of edits) {
            run.score[`corrected_${dimension}`] = value
          }
          run.score.overridden_by = overridden_by
          run.score.overridden_at = new Date().toISOString()
        }
      })
      .addCase(saveOverride.rejected, (state, action) => {
        state.saveOverridePending = false
        state.saveOverrideStatus = action.payload?.status ?? 500
        state.saveOverrideError = action.payload?.message ?? 'Failed to save the override'
      })
      // fetchReports (KB-04)
      .addCase(fetchReports.pending, (state) => {
        state.reportsLoading = true
        state.reportsError = null
      })
      .addCase(fetchReports.fulfilled, (state, action) => {
        state.reports = action.payload
        state.reportsLoading = false
        state.reportsError = null
      })
      .addCase(fetchReports.rejected, (state, action) => {
        state.reportsLoading = false
        state.reportsError = (action.payload as string) ?? 'Failed to load reports'
      })
      // saveReport (KB-04)
      .addCase(saveReport.pending, (state) => {
        state.saveReportPending = true
      })
      .addCase(saveReport.fulfilled, (state) => {
        state.saveReportPending = false
      })
      .addCase(saveReport.rejected, (state) => {
        state.saveReportPending = false
      })
      // refreshReport (DASH-03) — per-id pending tracking
      .addCase(refreshReport.pending, (state, action) => {
        const id = action.meta.arg
        if (!state.refreshReportPendingIds.includes(id)) state.refreshReportPendingIds.push(id)
      })
      .addCase(refreshReport.fulfilled, (state, action) => {
        state.refreshReportPendingIds = state.refreshReportPendingIds.filter((id) => id !== action.payload.reportId)
      })
      .addCase(refreshReport.rejected, (state, action) => {
        const id = action.meta.arg
        state.refreshReportPendingIds = state.refreshReportPendingIds.filter((rid) => rid !== id)
      })
      // Measurement lifecycle
      .addCase(fetchActiveMeasurement.fulfilled, (state, action) => {
        state.activeMeasurement = action.payload
      })
      .addCase(startMeasurement.pending, (state) => {
        state.measurementLoading = true
        state.measurementError = null
        state.lastCloseCommand = null
      })
      .addCase(startMeasurement.fulfilled, (state, action) => {
        state.measurementLoading = false
        state.activeMeasurement = action.payload
      })
      .addCase(startMeasurement.rejected, (state, action) => {
        state.measurementLoading = false
        state.measurementError = action.payload ?? 'Failed to start measurement'
      })
      .addCase(stopMeasurement.pending, (state) => {
        state.measurementLoading = true
        state.measurementError = null
      })
      .addCase(stopMeasurement.fulfilled, (state, action) => {
        state.measurementLoading = false
        state.activeMeasurement = null
        state.lastCloseCommand = action.payload.close_command
      })
      .addCase(stopMeasurement.rejected, (state, action) => {
        state.measurementLoading = false
        state.measurementError = action.payload ?? 'Failed to stop measurement'
      })
      // Experiment Control Center (Plan 85-05)
      .addCase(fetchSpecList.pending, (state) => {
        state.specListLoading = true
      })
      .addCase(fetchSpecList.fulfilled, (state, action) => {
        state.specListLoading = false
        state.specList = action.payload
      })
      .addCase(fetchSpecList.rejected, (state) => {
        state.specListLoading = false
        // Leave the (possibly empty) list in place — the picker degrades to empty.
      })
      .addCase(launchExperiment.pending, (state) => {
        state.launchPending = true
        state.launchError = null
      })
      .addCase(launchExperiment.fulfilled, (state, action) => {
        state.launchPending = false
        state.launchError = null
        // Start monitoring the freshly-launched run.
        state.activeRunId = action.payload.run_id
        state.runStatus = null
        state.runStatusError = null
        // Consume the pre-fill once the launch succeeds.
        state.launcherPrefill = null
      })
      .addCase(launchExperiment.rejected, (state, action) => {
        state.launchPending = false
        // D-09: surface the 409 holder / validation message (never silent).
        state.launchError = action.payload ?? 'Failed to launch experiment'
      })
      .addCase(fetchRunStatus.fulfilled, (state, action) => {
        state.runStatus = action.payload
        state.runStatusError = null
      })
      .addCase(fetchRunStatus.rejected, (state, action) => {
        state.runStatusError = action.payload ?? 'Failed to load run status'
      })
      .addCase(cancelRun.fulfilled, (state) => {
        // The host group-kill was requested; the next 5s poll reflects the
        // terminal cell states. Keep monitoring so the operator sees the wind-down.
      })
      .addCase(cancelRun.rejected, (state, action) => {
        state.runStatusError = action.payload ?? 'Failed to cancel run'
      })
  },
})

export const {
  setFacet,
  setIncludePending,
  setDateWindow,
  clearFilters,
  setSelectedTaskId,
  setOverrideTaskId,
  setExplainTaskId,
  toggleRunSelected,
  setRunsSelected,
  clearRunSelection,
  setActiveReportId,
  setCompareA,
  setCompareB,
  clearOverrideStatus,
  setLauncherPrefill,
  clearLauncherPrefill,
  setActiveRunId,
  clearLaunchError,
} = performanceSlice.actions

// ---------------------------------------------------------------------------
// Score-state classification (shared by the facet filter + counts selector).
// ---------------------------------------------------------------------------
export function scoreStateOf(run: Run): ScoreState {
  if (run.pending || run.score?.pending) return 'pending'
  if (!run.score || run.score.not_scored) return 'not_scored'
  return 'scored'
}

// ---------------------------------------------------------------------------
// Selectors — live in the slice file, typed against RootState.
// ---------------------------------------------------------------------------
export const selectRuns = (state: RootState) => state.performance.runs
export const selectIncludePending = (state: RootState) => state.performance.includePending
export const selectRunsLoading = (state: RootState) => state.performance.runsLoading
export const selectRunsError = (state: RootState) => state.performance.runsError
export const selectFacetState = (state: RootState) => state.performance.facetState
export const selectSelectedTaskId = (state: RootState) => state.performance.selectedTaskId
export const selectCompareA = (state: RootState) => state.performance.compareA
export const selectCompareB = (state: RootState) => state.performance.compareB
export const selectTimelineLoading = (state: RootState) => state.performance.timelineLoading
export const selectTimelineError = (state: RootState) => state.performance.timelineError

// Per-taskId timeline selector factory.
export const selectTimelineFor = (taskId: string | null) => (state: RootState): TimelineRow[] =>
  taskId ? (state.performance.timelineByTaskId[taskId] ?? []) : []

// Per-taskId context-turns selector factory (Plan 84-08). Returns the stored
// per-request lines, or [] when absent/null so the explainer never crashes on a
// missing or failed fetch (T-84-08-02).
export const selectContextTurnsFor = (taskId: string | null) => (state: RootState): ContextTurnRow[] =>
  taskId ? (state.performance.contextTurnsByTaskId[taskId] ?? []) : []

export const selectNarrativeFor = (taskId: string | null) => (state: RootState): NarrativeItem[] =>
  taskId ? (state.performance.narrativeByTaskId[taskId] ?? []) : []
export const selectNarrativeLoadingId = (state: RootState) => state.performance.narrativeLoadingId
export const selectDigestsFor = (taskId: string | null) => (state: RootState): DigestItem[] =>
  taskId ? (state.performance.digestsByTaskId[taskId] ?? []) : []
export const selectDigestLoadingId = (state: RootState) => state.performance.digestLoadingId

// Measurement lifecycle selectors.
export const selectActiveMeasurement = (state: RootState) => state.performance.activeMeasurement
export const selectMeasurementLoading = (state: RootState) => state.performance.measurementLoading
export const selectMeasurementError = (state: RootState) => state.performance.measurementError
export const selectLastCloseCommand = (state: RootState) => state.performance.lastCloseCommand

// Experiment Control Center selectors (Plan 85-05).
export const selectSpecList = (state: RootState) => state.performance.specList
export const selectSpecListLoading = (state: RootState) => state.performance.specListLoading
export const selectActiveRunId = (state: RootState) => state.performance.activeRunId
export const selectRunStatus = (state: RootState) => state.performance.runStatus
export const selectRunStatusError = (state: RootState) => state.performance.runStatusError
export const selectLaunchError = (state: RootState) => state.performance.launchError
export const selectLaunchPending = (state: RootState) => state.performance.launchPending
export const selectLauncherPrefill = (state: RootState) => state.performance.launcherPrefill

// Score-override save-state selectors (drawer branches on these).
export const selectSaveOverridePending = (state: RootState) => state.performance.saveOverridePending
export const selectSaveOverrideError = (state: RootState) => state.performance.saveOverrideError
export const selectSaveOverrideStatus = (state: RootState) => state.performance.saveOverrideStatus
export const selectSaveOverrideSuccessAt = (state: RootState) => state.performance.saveOverrideSuccessAt

// The run whose Timeline is shown inline (row selection).
export const selectSelectedRun = (state: RootState): Run | null => {
  const id = state.performance.selectedTaskId
  if (!id) return null
  return state.performance.runs.find((r) => r.task_id === id) ?? null
}

// The run being edited in the modal Score-override drawer ("Edit scores").
export const selectOverrideTaskId = (state: RootState) => state.performance.overrideTaskId
export const selectOverrideRun = (state: RootState): Run | null => {
  const id = state.performance.overrideTaskId
  if (!id) return null
  return state.performance.runs.find((r) => r.task_id === id) ?? null
}

// The run whose context/caching is explained in the ContextCacheExplainer dialog.
export const selectSelectedRunIds = (state: RootState) => state.performance.selectedRunIds
export const selectDeleteRunsPending = (state: RootState) => state.performance.deleteRunsPending
export const selectExplainTaskId = (state: RootState) => state.performance.explainTaskId
export const selectExplainRun = (state: RootState): Run | null => {
  const id = state.performance.explainTaskId
  if (!id) return null
  return state.performance.runs.find((r) => r.task_id === id) ?? null
}

// Saved-report selectors.
export const selectReports = (state: RootState) => state.performance.reports
export const selectReportsLoading = (state: RootState) => state.performance.reportsLoading
export const selectReportsError = (state: RootState) => state.performance.reportsError
export const selectActiveReportId = (state: RootState) => state.performance.activeReportId
export const selectSaveReportPending = (state: RootState) => state.performance.saveReportPending
export const selectActiveReport = (state: RootState): Report | null => {
  const id = state.performance.activeReportId
  if (!id) return null
  return state.performance.reports.find((r) => r.reportId === id) ?? null
}
// Per-id refresh-pending predicate.
export const selectIsRefreshPending = (reportId: string) => (state: RootState): boolean =>
  state.performance.refreshReportPendingIds.includes(reportId)

// ---------------------------------------------------------------------------
// Facet-value canonicalization — a SINGLE source of truth used by the options,
// counts, and filter predicate so the three never disagree. Collapses the two
// "no value" spellings (null and empty string) into one `(none)` bucket, and
// unifies agent/framework aliases (claude-code == claude) so the same actor is
// not split across two facet rows.
// ---------------------------------------------------------------------------
export const FACET_NONE = '(none)'
const AGENT_ALIASES: Record<string, string> = { 'claude-code': 'claude' }

function facetAgent(v: string | null | undefined): string {
  const t = (v ?? '').trim()
  if (!t) return FACET_NONE
  return AGENT_ALIASES[t] ?? t
}
// Framework shares the same actor aliasing as agent (claude-code == claude).
const facetFramework = facetAgent
function facetTaskClass(v: string | null | undefined): string {
  const t = (v ?? '').trim()
  return t || 'unclassified'
}

// The Model facet is MULTI-VALUED and derived from the SAME fields the runs table
// displays — the canonical (foreground chat) model plus the background-service
// models — so filtering by a model only surfaces runs where that model is actually
// visible in the table. (It deliberately does NOT use the legacy run.model field,
// which ATTR-02 suppresses as "unmeasured" — using it made the facet disagree with
// the table.) A run with no attributed models falls into the single `(none)` bucket.
export function runModels(run: Run): string[] {
  const set = new Set<string>()
  const cm = normalizeModel(run.canonical_model)
  if (cm && cm.trim()) set.add(cm)
  for (const b of run.background_models ?? []) {
    const m = normalizeModel(b.model)
    if (m && m.trim()) set.add(m)
  }
  return set.size ? [...set] : [FACET_NONE]
}

// Predicate: does a run pass the current facet state? (date window + each
// array facet — an empty array means "no constraint on that group").
function runPassesFacets(run: Run, f: FacetState): boolean {
  if (f.task_id.length && !f.task_id.includes(run.task_id)) return false
  if (f.task_class.length && !f.task_class.includes(facetTaskClass(run.task_class))) return false
  if (f.agent.length && !f.agent.includes(facetAgent(run.agent))) return false
  if (f.model.length) {
    const models = runModels(run)
    if (!f.model.some((m) => models.includes(m))) return false
  }
  if (f.framework.length && !f.framework.includes(facetFramework(run.framework))) return false
  if (f.scoreState.length && !f.scoreState.includes(scoreStateOf(run))) return false
  if (f.startedAfter && (!run.started_at || run.started_at < f.startedAfter)) return false
  if (f.startedBefore && (!run.started_at || run.started_at > f.startedBefore)) return false
  return true
}

// Derived: the filtered run set. Memoized so component re-renders are cheap
// and we never hold a page-local filtered array.
export const selectFilteredRuns = createSelector(
  [selectRuns, selectFacetState],
  (runs, facetState): Run[] => runs.filter((r) => runPassesFacets(r, facetState))
)

// Live per-facet-value counts over the FILTERED set (D-01: counts reflect the
// post-filter set). Returns a map keyed by facet group -> value -> count.
export interface FacetCounts {
  task_class: Record<string, number>
  agent: Record<string, number>
  model: Record<string, number>
  framework: Record<string, number>
  scoreState: Record<string, number>
}

export const selectFacetCounts = createSelector(
  [selectFilteredRuns],
  (filtered): FacetCounts => {
    const counts: FacetCounts = {
      task_class: {},
      agent: {},
      model: {},
      framework: {},
      scoreState: {},
    }
    const bump = (bucket: Record<string, number>, key: string) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }
    for (const r of filtered) {
      bump(counts.task_class, facetTaskClass(r.task_class))
      bump(counts.agent, facetAgent(r.agent))
      for (const m of runModels(r)) bump(counts.model, m)
      bump(counts.framework, facetFramework(r.framework))
      bump(counts.scoreState, scoreStateOf(r))
    }
    return counts
  }
)

// All distinct facet values present in the UNFILTERED run set — used to render
// the facet rows themselves (so a value with a current count of 0 still shows).
export const selectFacetOptions = createSelector(
  [selectRuns],
  (runs) => {
    const uniqSorted = (vals: string[]) => Array.from(new Set(vals)).sort()
    return {
      task_class: uniqSorted(runs.map((r) => facetTaskClass(r.task_class))),
      agent: uniqSorted(runs.map((r) => facetAgent(r.agent))),
      model: uniqSorted(runs.flatMap((r) => runModels(r))),
      framework: uniqSorted(runs.map((r) => facetFramework(r.framework))),
      scoreState: ['scored', 'pending', 'not_scored'] as ScoreState[],
    }
  }
)

export default performanceSlice.reducer
