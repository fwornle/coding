import { createSlice, createAsyncThunk, createSelector, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../index'

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
  not_scored?: boolean | null
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
  selectedTaskId: string | null
  timelineByTaskId: Record<string, TimelineRow[]>
  timelineLoading: boolean
  timelineError: string | null
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
  timelineByTaskId: {},
  timelineLoading: false,
  timelineError: null,
}

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
      state.selectedTaskId = action.payload
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
  },
})

export const { setFacet, setDateWindow, clearFilters, setSelectedTaskId } = performanceSlice.actions

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

// Predicate: does a run pass the current facet state? (date window + each
// array facet — an empty array means "no constraint on that group").
function runPassesFacets(run: Run, f: FacetState): boolean {
  if (f.task_id.length && !f.task_id.includes(run.task_id)) return false
  if (f.task_class.length && !f.task_class.includes(run.task_class ?? 'unclassified')) return false
  if (f.agent.length && !f.agent.includes(run.agent ?? '—')) return false
  if (f.model.length && !f.model.includes(run.model ?? '—')) return false
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
      bump(counts.model, r.model ?? '—')
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
      model: distinct(runs.map((r) => r.model), '—'),
      framework: distinct(runs.map((r) => r.framework), '—'),
      scoreState: ['scored', 'pending', 'not_scored'] as ScoreState[],
    }
  }
)

export default performanceSlice.reducer
