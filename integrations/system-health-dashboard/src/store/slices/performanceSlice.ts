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
  tokens_estimated?: number | null
  estimated?: boolean
  children?: TimelineRow[]
  [key: string]: unknown
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
  runs: Run[]
  runsLoading: boolean
  runsError: string | null
  selectedTaskId: string | null // drives the inline Timeline panel (row click)
  overrideTaskId: string | null // drives the modal Score-override drawer (explicit "Edit scores")
  timelineByTaskId: Record<string, TimelineRow[]>
  timelineLoading: boolean
  timelineError: string | null
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
}

// The active measurement span (mirrors .data/active-measurement.json).
export interface ActiveMeasurement {
  task_id: string
  started_at: string
  goal_sentence?: string
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
  runs: [],
  runsLoading: false,
  runsError: null,
  selectedTaskId: null,
  overrideTaskId: null,
  timelineByTaskId: {},
  timelineLoading: false,
  timelineError: null,
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
  async (_: void | undefined, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/runs')
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
    setActiveReportId(state, action: PayloadAction<string | null>) {
      state.activeReportId = action.payload
    },
    clearOverrideStatus(state) {
      state.saveOverrideError = null
      state.saveOverrideStatus = null
      state.saveOverrideSuccessAt = null
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
  },
})

export const {
  setFacet,
  setDateWindow,
  clearFilters,
  setSelectedTaskId,
  setOverrideTaskId,
  setActiveReportId,
  clearOverrideStatus,
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
export const selectRunsLoading = (state: RootState) => state.performance.runsLoading
export const selectRunsError = (state: RootState) => state.performance.runsError
export const selectFacetState = (state: RootState) => state.performance.facetState
export const selectSelectedTaskId = (state: RootState) => state.performance.selectedTaskId
export const selectTimelineLoading = (state: RootState) => state.performance.timelineLoading
export const selectTimelineError = (state: RootState) => state.performance.timelineError

// Per-taskId timeline selector factory.
export const selectTimelineFor = (taskId: string | null) => (state: RootState): TimelineRow[] =>
  taskId ? (state.performance.timelineByTaskId[taskId] ?? []) : []

// Measurement lifecycle selectors.
export const selectActiveMeasurement = (state: RootState) => state.performance.activeMeasurement
export const selectMeasurementLoading = (state: RootState) => state.performance.measurementLoading
export const selectMeasurementError = (state: RootState) => state.performance.measurementError
export const selectLastCloseCommand = (state: RootState) => state.performance.lastCloseCommand

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

// Predicate: does a run pass the current facet state? (date window + each
// array facet — an empty array means "no constraint on that group").
function runPassesFacets(run: Run, f: FacetState): boolean {
  if (f.task_id.length && !f.task_id.includes(run.task_id)) return false
  if (f.task_class.length && !f.task_class.includes(run.task_class ?? 'unclassified')) return false
  if (f.agent.length && !f.agent.includes(run.agent ?? '—')) return false
  if (f.model.length && !f.model.includes(normalizeModel(run.model) ?? '—')) return false
  if (f.framework.length && !f.framework.includes(run.framework ?? '—')) return false
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
      bump(counts.task_class, r.task_class ?? 'unclassified')
      bump(counts.agent, r.agent ?? '—')
      bump(counts.model, normalizeModel(r.model) ?? '—')
      bump(counts.framework, r.framework ?? '—')
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
    const distinct = (vals: Array<string | null | undefined>, fallback: string) =>
      Array.from(new Set(vals.map((v) => v ?? fallback))).sort()
    return {
      task_class: distinct(runs.map((r) => r.task_class), 'unclassified'),
      agent: distinct(runs.map((r) => r.agent), '—'),
      model: distinct(runs.map((r) => normalizeModel(r.model)), '—'),
      framework: distinct(runs.map((r) => r.framework), '—'),
      scoreState: ['scored', 'pending', 'not_scored'] as ScoreState[],
    }
  }
)

export default performanceSlice.reducer
