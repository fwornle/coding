import { createSlice, createAsyncThunk, createSelector, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '@/store'

// Shared state for the Performance → Benchmarks sub-tab (kgbench).
//
// A slice of its own rather than an extension of performanceSlice: the two surfaces share a
// page and nothing else. An experiment Run is a task-anchored measurement of one agent turn;
// a kgbench cell is one question answered by one arm on one agent at one model, graded
// against a stored key. They have different identities, different lifecycles, and different
// servers behind them. Folding kgbench into the ~2k-line performance slice would have meant
// every kgbench poll re-rendering every experiment selector.
//
// Everything here is thin: fetch, keep, expose. No aggregation happens in the browser — the
// report numbers are computed by lib/kgbench/report.mjs (the same function the published CLI
// report calls) and rendered as served. A second implementation of the scoring aggregation in
// TypeScript is precisely how a dashboard starts disagreeing with the document it illustrates.

// ── Types ────────────────────────────────────────────────────────────────────

export interface KgbenchQuestionSet {
  name: string
  questionCount?: number
  classes?: Record<string, number>
  ids?: string[]
  error?: string
}

export interface KgbenchArmAgentVerdict {
  faithful: boolean
  // Why an arm×agent pair is refused, verbatim from lib/kgbench/agents.mjs armIsFaithful.
  // Shown in the launcher rather than summarised: the distinction between "this agent has no
  // tool allowlist" and "this harness has no verified mapping yet" is the difference between
  // a permanent limit and unfinished work, and collapsing it makes a fixable gap look final.
  reason: string | null
}

export interface KgbenchArm {
  id: string
  label: string
  enabled: boolean
  backend: string | null
  allowedTools: string[] | null
  resolved: boolean
  agents: Record<string, KgbenchArmAgentVerdict>
}

export interface KgbenchConfig {
  sets: KgbenchQuestionSet[]
  arms: KgbenchArm[]
  agents: string[]
  defaults: { model?: string; agents?: string[]; models?: string[]; timeoutMs?: number; maxAttempts?: number }
}

export interface KgbenchVerifiedModel {
  requested: string
  provider: string
  served: string
  // false when the request resolved to a DIFFERENT model than asked for. Surfaced, never
  // flattened: an unnoticed substitution is how the judge ran on haiku for two runs while
  // run.json published opus.
  exact: boolean
  stable: boolean
}

export interface KgbenchModels {
  probedAt: string | null
  proxy?: string | null
  verified: KgbenchVerifiedModel[]
  rejected: { requested: string; provider: string; error: string | null }[]
}

export interface KgbenchRunSummary {
  runId: string
  set: string | null
  reps: number | string | null
  commit: string | null
  arms: string[]
  agents: string[]
  models: string[]
  cells: number
  status: string | null
  live: boolean
  updatedAt: string | null
  startedAt?: string | null
}

export interface KgbenchStatusCell {
  arm: string
  agent: string
  model: string | null
  done: number
  questions: number
  failed: number
  mean_score: number | null
  last_at: string | null
  state: string
}

export interface KgbenchStatus {
  run_id: string
  overall: string
  done: number
  total: number | null
  status: string | null
  set?: string | null
  commit?: string | null
  cells: KgbenchStatusCell[]
}

export interface KgbenchStats {
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
  p95: number | null
  n: number
}

export interface KgbenchArmReport {
  arm: string
  agent?: string
  runs: number
  ranked: number
  ungraded: number
  failed: number
  hard_fail_rate: number | null
  retry_rate: number | null
  hallucination_rate: number | null
  provenance: {
    agents: string[]
    elicitations: string[]
    token_sources: Record<string, number>
    builtins_enforced: boolean
    builtins_states: string[]
    ambiguous_token_rows: number
  }
  metrics: Record<string, KgbenchStats>
}

export interface KgbenchDisagreement {
  id: string
  arm: string
  checklist: number
  judge: number
  kind: string
}

export interface KgbenchReport {
  meta?: Record<string, unknown>
  byArm: Record<string, KgbenchArmReport>
  byArmAgent?: Record<string, KgbenchArmReport> | null
  byClass?: Record<string, { scores: Record<string, KgbenchStats>; winner?: { winner: string | null; reason: string; ratio: number } }>
  classes?: string[]
  agents?: string[]
  provenance?: KgbenchArmReport['provenance']
  disagreements?: KgbenchDisagreement[]
  _source?: { runId: string; rows: number; rowsTotal: number; retiredQuestions: string[]; live: boolean }
}

export interface KgbenchLaunchRequest {
  run_id: string
  set: string
  reps?: number
  arms?: string[]
  agents?: string[]
  models?: string[]
  only?: string[]
  deepen?: string[]
  deepen_reps?: number
  resume?: boolean
}

// ── Thunks ───────────────────────────────────────────────────────────────────

const asCsv = (v?: string[]) => (v && v.length ? v.join(',') : undefined)

async function getJson(url: string) {
  const response = await fetch(url)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.message || data?.error || `API returned ${response.status}`)
  return data
}

export const fetchKgbenchConfig = createAsyncThunk<KgbenchConfig, void, { rejectValue: string }>(
  'kgbench/fetchConfig',
  async (_arg, { rejectWithValue }) => {
    try {
      const d = await getJson('/api/kgbench/config')
      return { sets: d.sets ?? [], arms: d.arms ?? [], agents: d.agents ?? [], defaults: d.defaults ?? {} }
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

export const fetchKgbenchModels = createAsyncThunk<KgbenchModels, void, { rejectValue: string }>(
  'kgbench/fetchModels',
  async (_arg, { rejectWithValue }) => {
    try {
      const d = await getJson('/api/kgbench/models')
      return { probedAt: d.probedAt ?? null, proxy: d.proxy ?? null, verified: d.verified ?? [], rejected: d.rejected ?? [] }
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

// Operator-triggered, never automatic. The probe installs a temporary processOverride per
// candidate and sends a real completion, serialised — minutes of wall-clock and real tokens.
// Firing it on mount would spend money to render a dropdown.
export const probeKgbenchModels = createAsyncThunk<
  KgbenchModels,
  { provider?: string; models?: string } | void,
  { rejectValue: string }
>(
  'kgbench/probeModels',
  async (arg, { dispatch, rejectWithValue }) => {
    try {
      const response = await fetch('/api/kgbench/probe-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg ?? {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      // The probe writes a file; the fresh list comes from re-reading it.
      const refreshed = await dispatch(fetchKgbenchModels())
      if (fetchKgbenchModels.fulfilled.match(refreshed)) return refreshed.payload
      return rejectWithValue('probe finished but the refreshed model list could not be read')
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

export const fetchKgbenchRuns = createAsyncThunk<KgbenchRunSummary[], void, { rejectValue: string }>(
  'kgbench/fetchRuns',
  async (_arg, { rejectWithValue }) => {
    try {
      const d = await getJson('/api/kgbench/runs')
      return (d.runs ?? []) as KgbenchRunSummary[]
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

export const fetchKgbenchStatus = createAsyncThunk<KgbenchStatus, string, { rejectValue: string }>(
  'kgbench/fetchStatus',
  async (runId, { rejectWithValue }) => {
    try {
      const d = await getJson(`/api/kgbench/run-status/${encodeURIComponent(runId)}`)
      return { ...d, cells: Array.isArray(d?.cells) ? d.cells : [] } as KgbenchStatus
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

// Auto-attach source: a matrix launched from the CLI or the /kgbench skill must surface here
// too, not only one launched from this tab.
export const fetchKgbenchActiveRun = createAsyncThunk<
  { runId: string | null; status?: string | null },
  void,
  { rejectValue: string }
>(
  'kgbench/fetchActiveRun',
  async (_arg, { rejectWithValue }) => {
    try {
      const d = await getJson('/api/kgbench/active-run')
      return { runId: d?.runId ?? null, status: d?.status ?? null }
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

// The rejection carries structure, not just a sentence. A launch refused because the run id
// already has cells is an offer, not a failure — the operator can resume that run — and the
// UI can only make that offer if it is told which run and how far it got.
export interface KgbenchLaunchRejection {
  message: string
  existing?: { run_id: string; cells: number; status: string | null }
}

export const launchKgbench = createAsyncThunk<
  { run_id: string; pid: number | null },
  KgbenchLaunchRequest,
  { rejectValue: KgbenchLaunchRejection }
>(
  'kgbench/launch',
  async (req, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/kgbench/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The axes travel as CSV because that is the supervisor's own flag contract
        // (--arms grep,hybrid). Converting here keeps the wire format identical to what a
        // person would type on the command line, so a launch is reproducible by copying it.
        body: JSON.stringify({
          run_id: req.run_id,
          set: req.set,
          reps: req.reps,
          arms: asCsv(req.arms),
          agents: asCsv(req.agents),
          models: asCsv(req.models),
          only: asCsv(req.only),
          deepen: asCsv(req.deepen),
          deepen_reps: req.deepen_reps,
          resume: req.resume === true,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const holder = data?.holder
        return rejectWithValue({
          message: data?.message || data?.error || `API returned ${response.status}`,
          existing: holder?.kind === 'kgbench' && holder?.cells !== undefined
            ? { run_id: holder.run_id, cells: holder.cells, status: holder.status ?? null }
            : undefined,
        })
      }
      return { run_id: data.run_id as string, pid: (data.pid ?? null) as number | null }
    } catch (e) {
      return rejectWithValue({ message: e instanceof Error ? e.message : 'Unknown error' })
    }
  }
)

export const cancelKgbenchRun = createAsyncThunk<
  { run_id: string; killed?: boolean; reason?: string },
  string,
  { rejectValue: string }
>(
  'kgbench/cancel',
  async (runId, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/kgbench/run-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return { run_id: runId, killed: data?.killed, reason: data?.reason }
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

export const fetchKgbenchReport = createAsyncThunk<
  { runId: string; report: KgbenchReport },
  { runId: string; published?: boolean },
  { rejectValue: string }
>(
  'kgbench/fetchReport',
  async ({ runId, published }, { rejectWithValue }) => {
    try {
      const url = published
        ? `/api/kgbench/published/${encodeURIComponent(runId)}`
        : `/api/kgbench/report/${encodeURIComponent(runId)}`
      return { runId, report: (await getJson(url)) as KgbenchReport }
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

export const fetchKgbenchPublished = createAsyncThunk<
  { name: string; runId: string | null; set: string | null; questionCount: number | null; reps: number | string | null; commit: string | null; agents: string[] }[],
  void,
  { rejectValue: string }
>(
  'kgbench/fetchPublished',
  async (_arg, { rejectWithValue }) => {
    try {
      const d = await getJson('/api/kgbench/published')
      return d.reports ?? []
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Unknown error')
    }
  }
)

// ── State ────────────────────────────────────────────────────────────────────

interface KgbenchState {
  config: KgbenchConfig | null
  configLoading: boolean
  configError: string | null

  models: KgbenchModels | null
  modelsLoading: boolean
  probePending: boolean
  probeError: string | null

  runs: KgbenchRunSummary[]
  runsLoading: boolean
  runsError: string | null

  activeRunId: string | null
  status: KgbenchStatus | null
  statusError: string | null

  launchPending: boolean
  launchError: string | null
  // The 409 holder when a launch was refused because the id already has results. Kept
  // separate from launchError so the UI can offer "resume it" rather than only an apology.
  existingRun: { run_id: string; cells: number; status: string | null } | null

  cancelPending: boolean

  // Which run's report is on screen, and whether it is the live aggregate or the published
  // artefact. Deliberately distinct: one is what the data says now, the other is what the
  // README's prose was written around.
  reportRunId: string | null
  reportIsPublished: boolean
  report: KgbenchReport | null
  reportLoading: boolean
  reportError: string | null

  published: { name: string; runId: string | null; set: string | null; questionCount: number | null; reps: number | string | null; commit: string | null; agents: string[] }[]
}

const initialState: KgbenchState = {
  config: null, configLoading: false, configError: null,
  models: null, modelsLoading: false, probePending: false, probeError: null,
  runs: [], runsLoading: false, runsError: null,
  activeRunId: null, status: null, statusError: null,
  launchPending: false, launchError: null, existingRun: null,
  cancelPending: false,
  reportRunId: null, reportIsPublished: false, report: null, reportLoading: false, reportError: null,
  published: [],
}

const kgbenchSlice = createSlice({
  name: 'kgbench',
  initialState,
  reducers: {
    setKgbenchActiveRunId(state, action: PayloadAction<string | null>) {
      state.activeRunId = action.payload
      if (action.payload === null) {
        state.status = null
        state.statusError = null
      }
    },
    clearKgbenchLaunchError(state) {
      state.launchError = null
      state.existingRun = null
    },
    clearKgbenchReport(state) {
      state.reportRunId = null
      state.report = null
      state.reportError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchKgbenchConfig.pending, (s) => { s.configLoading = true; s.configError = null })
      .addCase(fetchKgbenchConfig.fulfilled, (s, a) => { s.configLoading = false; s.config = a.payload })
      .addCase(fetchKgbenchConfig.rejected, (s, a) => { s.configLoading = false; s.configError = a.payload ?? 'Failed to load kgbench config' })

      .addCase(fetchKgbenchModels.pending, (s) => { s.modelsLoading = true })
      .addCase(fetchKgbenchModels.fulfilled, (s, a) => { s.modelsLoading = false; s.models = a.payload })
      .addCase(fetchKgbenchModels.rejected, (s) => { s.modelsLoading = false })

      .addCase(probeKgbenchModels.pending, (s) => { s.probePending = true; s.probeError = null })
      .addCase(probeKgbenchModels.fulfilled, (s, a) => { s.probePending = false; s.models = a.payload })
      .addCase(probeKgbenchModels.rejected, (s, a) => { s.probePending = false; s.probeError = a.payload ?? 'Model probe failed' })

      .addCase(fetchKgbenchRuns.pending, (s) => { s.runsLoading = true; s.runsError = null })
      .addCase(fetchKgbenchRuns.fulfilled, (s, a) => { s.runsLoading = false; s.runs = a.payload })
      .addCase(fetchKgbenchRuns.rejected, (s, a) => { s.runsLoading = false; s.runsError = a.payload ?? 'Failed to load runs' })

      .addCase(fetchKgbenchStatus.fulfilled, (s, a) => { s.status = a.payload; s.statusError = null })
      .addCase(fetchKgbenchStatus.rejected, (s, a) => { s.statusError = a.payload ?? 'Failed to read run status' })

      .addCase(launchKgbench.pending, (s) => { s.launchPending = true; s.launchError = null; s.existingRun = null })
      .addCase(launchKgbench.fulfilled, (s, a) => {
        s.launchPending = false
        s.activeRunId = a.payload.run_id
        s.status = null
      })
      .addCase(launchKgbench.rejected, (s, a) => {
        s.launchPending = false
        s.launchError = a.payload?.message ?? 'Launch failed'
        s.existingRun = a.payload?.existing ?? null
      })

      .addCase(cancelKgbenchRun.pending, (s) => { s.cancelPending = true })
      .addCase(cancelKgbenchRun.fulfilled, (s) => { s.cancelPending = false })
      .addCase(cancelKgbenchRun.rejected, (s, a) => { s.cancelPending = false; s.statusError = a.payload ?? 'Cancel failed' })

      .addCase(fetchKgbenchReport.pending, (s, a) => {
        s.reportLoading = true
        s.reportError = null
        s.reportRunId = a.meta.arg.runId
        s.reportIsPublished = a.meta.arg.published === true
      })
      .addCase(fetchKgbenchReport.fulfilled, (s, a) => { s.reportLoading = false; s.report = a.payload.report })
      .addCase(fetchKgbenchReport.rejected, (s, a) => { s.reportLoading = false; s.report = null; s.reportError = a.payload ?? 'Failed to load report' })

      .addCase(fetchKgbenchPublished.fulfilled, (s, a) => { s.published = a.payload })
  },
})

export const { setKgbenchActiveRunId, clearKgbenchLaunchError, clearKgbenchReport } = kgbenchSlice.actions

// ── Selectors ────────────────────────────────────────────────────────────────

export const selectKgbenchConfig = (s: RootState) => s.kgbench.config
export const selectKgbenchConfigLoading = (s: RootState) => s.kgbench.configLoading
export const selectKgbenchConfigError = (s: RootState) => s.kgbench.configError
export const selectKgbenchModels = (s: RootState) => s.kgbench.models
export const selectKgbenchProbePending = (s: RootState) => s.kgbench.probePending
export const selectKgbenchProbeError = (s: RootState) => s.kgbench.probeError
export const selectKgbenchRuns = (s: RootState) => s.kgbench.runs
export const selectKgbenchRunsLoading = (s: RootState) => s.kgbench.runsLoading
export const selectKgbenchActiveRunId = (s: RootState) => s.kgbench.activeRunId
export const selectKgbenchStatus = (s: RootState) => s.kgbench.status
export const selectKgbenchStatusError = (s: RootState) => s.kgbench.statusError
export const selectKgbenchLaunchPending = (s: RootState) => s.kgbench.launchPending
export const selectKgbenchLaunchError = (s: RootState) => s.kgbench.launchError
export const selectKgbenchExistingRun = (s: RootState) => s.kgbench.existingRun
export const selectKgbenchCancelPending = (s: RootState) => s.kgbench.cancelPending
export const selectKgbenchReport = (s: RootState) => s.kgbench.report
export const selectKgbenchReportRunId = (s: RootState) => s.kgbench.reportRunId
export const selectKgbenchReportIsPublished = (s: RootState) => s.kgbench.reportIsPublished
export const selectKgbenchReportLoading = (s: RootState) => s.kgbench.reportLoading
export const selectKgbenchReportError = (s: RootState) => s.kgbench.reportError
export const selectKgbenchPublished = (s: RootState) => s.kgbench.published

/**
 * The set of model names the proxy was OBSERVED to serve, as a lookup for the launcher's
 * verified/unverified gating.
 *
 * The catalog is not usable for this. `providerModels` advertises models a provider rejects
 * (copilot + claude-opus-4.6 → 400) and omits models it serves (no Opus 5, which claude
 * answers). A launcher offering catalog names would let an operator start a three-hour matrix
 * that fails at cell one.
 */
export const selectVerifiedModelNames = createSelector(
  [selectKgbenchModels],
  (models) => new Set((models?.verified ?? []).map((m) => m.requested))
)

/**
 * The arm×agent pairs the runner will SKIP for the current picks, with the harness's own
 * reason. Surfaced before launch because the alternative is an operator choosing three agents,
 * getting a one-agent matrix, and finding out from the results file.
 */
export const selectSkippedPairs = createSelector(
  [selectKgbenchConfig, (_s: RootState, picks: { arms: string[]; agents: string[] }) => picks],
  (config, picks) => {
    if (!config) return []
    const out: { arm: string; agent: string; reason: string }[] = []
    for (const armId of picks.arms) {
      const arm = config.arms.find((a) => a.id === armId)
      if (!arm) continue
      for (const agent of picks.agents) {
        const verdict = arm.agents?.[agent]
        if (verdict && !verdict.faithful) {
          out.push({ arm: armId, agent, reason: verdict.reason ?? 'not faithful for this agent' })
        }
      }
    }
    return out
  }
)

export default kgbenchSlice.reducer
