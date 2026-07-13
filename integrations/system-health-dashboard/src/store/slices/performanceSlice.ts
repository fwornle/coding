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
  // The experiment identity (Phase 79/80): a stable hash over the spec goal +
  // matrix. Every run of the same experiment shares it; the Comparison tab keys
  // its live fetch by this (D-03). readRuns surfaces it on each row.
  task_hash?: string | null
  variant?: string | null
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

// The per-span reconciliation summary (Phase 83, D-13) as returned by
// GET /api/experiments/runs/:taskId/reconciliation. The route serves the
// per-span reconciliation.json VERBATIM (top-level `summary` object), and on
// ENOENT returns `{ reconciliation: null }`. fetchReconciliation normalises
// both wire shapes to a single `ReconciliationSummary | null` (see the thunk),
// so consumers read one type. The summary is served AS-IS — never recomputed
// client-side (T-86-02-03): matched/flagged counts are Phase-83 truth.
export interface ReconciliationSummary {
  matched: number
  unmatched_wire: number
  unmatched_transcript: number
  fallback: number
  // aggregate per-field deltas between the wire and transcript token counts;
  // shape is provider-defined, kept opaque here (rendered as-is by the badge).
  aggregateDeltas: Record<string, number>
  flaggedCount: number
}

// ---------------------------------------------------------------------------
// CMP-04 (Phase 80): the variant-comparison report, modelling the FROZEN Phase 79
// JSON schema (scripts/experiments-compare.mjs:26-56) VERBATIM. Served live by
// GET /api/experiments/{comparison} keyed by ?task_hash=X&rank_by= (Plan 80-01) — the same
// {task_hash, rank_by, generated_at, ranked/failed/ungated/unscored} doc the CLI
// writes to .data/experiments/reports/<hash>.json (a drift test asserts equality).
// The four group arrays ARE the honesty spine: `ranked` is best-first (each with
// rank + composite); `failed`/`ungated`/`unscored` are shown, never ranked, each
// carrying a `.reason`. A variant with no successful runs lands in `failed` as
// "no successful runs" — never a cheap winner (D-02).
// ---------------------------------------------------------------------------

// A per-metric variance block: {mean,stddev,median,min,max,n}. Nulls are excluded
// upstream, so an absent metric key means "no data for this variant/metric".
export interface MetricStat {
  mean: number
  stddev: number
  median: number
  min: number
  max: number
  n: number
}

// The surfaced metric keys (frozen Phase 79 order). Kept as a wide record so an
// unexpected/added metric key does not break typing — the matrix renders the
// known rows and tolerates extras.
export type ComparisonMetrics = Partial<Record<string, MetricStat>>

export interface VariantEntry {
  variant: string
  n: number
  gate_outcome: 'passed' | 'failed' | 'ungated' | 'unscored'
  rank?: number // 1-based; ranked group only
  composite?: number // ranked only: totalTokens.mean / rubric_score.mean
  reason?: string // failed/ungated/unscored group only
  metrics: ComparisonMetrics
}

export interface ComparisonReport {
  task_hash: string
  rank_by: 'composite' | 'tokens' | 'wallclock' | 'score' | string
  generated_at: string
  ranked: VariantEntry[]
  failed: VariantEntry[]
  ungated: VariantEntry[]
  unscored: VariantEntry[]
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
  // Turn-modal open-state (Phase 86, D-01/D-02) — mirrors explainTaskId, but
  // carries WHICH turn within the run is focused. Drives turn-modal.tsx (Wave 2);
  // both null = closed. Decoupled from row selection like explainTaskId.
  modalTaskId: string | null
  modalTurnIndex: number | null
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
  // Per-span reconciliation summaries (Phase 86, D-12/D-13) keyed by taskId,
  // mirroring the context-turns cache above. Populated by fetchReconciliation;
  // `null` value = fetched-but-absent (a run with no reconciliation.json).
  reconciliationByTaskId: Record<string, ReconciliationSummary | null>
  // Per-experiment comparison reports (CMP-04, Phase 80) keyed by task_hash,
  // mirroring reconciliationByTaskId. Populated by fetchComparison; `null` value
  // = fetched-but-absent (a task_hash the endpoint returned non-ok for). The
  // matrix reads via selectComparisonFor and never fetches itself.
  comparisonByTaskHash: Record<string, ComparisonReport | null>
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
  // Branch avenues (Phase 87, Plan 87-06) — the git-computed merge status per
  // avenue task_id, served VERBATIM (Plan 04). `null` value = fetched-but-absent
  // (unknown/pruned branch) → the badge renders NOTHING (honesty). Keyed like the
  // reconciliation cache above.
  mergeStatusByTaskId: Record<string, AvenueMergeStatus | null>
  // The task_ids with an in-flight promote / prune op (per-row spinners + disabled
  // actions) so multiple avenue rows can act independently.
  promotePendingIds: string[]
  prunePendingIds: string[]
  // The verbatim promote outcome per task_id (drives the conflict-refused notice —
  // never a silent failure). Cleared when the row re-fetches status.
  promoteResultByTaskId: Record<string, AvenuePromoteResult>
  // The last avenue op error per task_id (surfaced inline, dismissible — D-09 honesty).
  avenueErrorByTaskId: Record<string, string | null>
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

// The D-03 fork axis selections (AVN-03). Curated-by-default four-axis picker —
// Agent × Model × SDD-framework × Knowledge-injection. The knowledge-injection
// dimension is encoded into the runner's existing `env` axis as `kb-on`/`kb-off`
// (Plan 87-02 — NOT a 5th cell key), so the frontend surfaces it as a prominent
// on/off toggle and the server maps env==='kb-off' → CODING_KNOWLEDGE_INJECTION=0.
// `agent` uses the runner literals (mastra is surfaced as `mastracode`, the
// literal Plan 87-02 added to KNOWN_AGENTS). Every field optional — an empty
// object means "seed from the origin span's own agent/model".
export interface ForkAxes {
  // Multi-select agent literals (claude / copilot / opencode / mastracode).
  agents?: string[]
  // Multi-select model literals (opus / sonnet / gpt-5 / haiku / …).
  models?: string[]
  // Multi-select SDD-framework literals (gsd / spec-workflow / none) — the
  // spec-driven-development harness, disambiguated from a code framework.
  frameworks?: string[]
  // Knowledge-injection A/B: when true a kb-on cell is included; when false a
  // kb-off cell. Both true → the injection axis is swept on vs off (2 cells).
  kbOn?: boolean
  kbOff?: boolean
}

// The D-11 re-run / D-03 fork pre-fill payload. Set by the runs-table Re-run and
// Fork buttons and consumed by the launcher to pre-populate the spec select +
// snapshot_id + rerun_of + override fields (including any seeded per-variant
// variantOverrides). The fork extension (EXTENDS this interface, does NOT fork
// the slice — Phase 86 frozen-contract discipline) carries the origin span link
// (`origin_span_id`), the four selectable axes, and the sweep flag.
export interface LauncherPrefill {
  spec: string
  snapshot_id?: string | null
  rerun_of?: string | null
  overrides?: ExperimentOverrides
  // D-03 fork fields — present only when the launcher was pre-filled by "Fork
  // into avenues" (absent for a plain Re-run, so the launcher renders the axis
  // picker only in fork mode).
  origin_span_id?: string | null
  axes?: ForkAxes
  // The D-02 sweep flag: expand the chosen axes into their cross-product. The
  // count/cost preview MUST still resolve SERVER-side (D-09), never a client
  // axes recompute.
  sweep?: boolean
}

// Read a string field off a Run's index signature defensively (the experiment
// runner stamps provenance fields — origin_span_id / snapshot_id / canonical_* —
// onto the Run's `[key: string]: unknown` map). Returns null for missing/blank.
function forkRunStr(run: Run, key: string): string | null {
  const v = run[key]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// buildForkPrefill (AVN-02/D-03) — the fork analogue of buildRerunPrefill. Seeds
// the four-axis picker from a COMPLETED span and carries the origin link
// (`origin_span_id` = the origin Run's task_id, mirroring Plan 87-03's threading).
// The picker opens CURATED-BY-DEFAULT: the origin's own agent/model pre-selected,
// the SDD-framework at the origin's framework (or `none`), knowledge-injection ON
// (the working-memory default), sweep OFF. The launch stays a THIN wrapper — the
// server synthesizes the avenue-spec (Plan 87-03 synthesizeAvenueSpec) and the
// count/cost preview is SERVER-resolved (D-09), never a client axes recompute.
export function buildForkPrefill(run: Run): LauncherPrefill {
  const originAgent = forkRunStr(run, 'canonical_agent') ?? forkRunStr(run, 'agent')
  const originModel = forkRunStr(run, 'canonical_model') ?? forkRunStr(run, 'model')
  const originFramework = forkRunStr(run, 'framework')
  return {
    spec: forkRunStr(run, 'spec') ?? '',
    snapshot_id: forkRunStr(run, 'snapshot_id'),
    // The fork groups avenues under the origin span — the origin Run's task_id is
    // the origin_span_id the runner stamps onto each avenue Run (Plan 87-03).
    origin_span_id: run.task_id,
    axes: {
      agents: originAgent ? [originAgent] : [],
      models: originModel ? [originModel] : [],
      frameworks: [originFramework ?? 'none'],
      // Curated default: knowledge injection ON (the working-memory prefix is the
      // normal operating mode); the operator A/Bs it off via the prominent toggle.
      kbOn: true,
      kbOff: false,
    },
    sweep: false,
  }
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
  modalTaskId: null,
  modalTurnIndex: null,
  selectedRunIds: [],
  deleteRunsPending: false,
  compareA: null,
  compareB: null,
  timelineByTaskId: {},
  timelineLoading: false,
  timelineError: null,
  contextTurnsByTaskId: {},
  reconciliationByTaskId: {},
  comparisonByTaskHash: {},
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
  mergeStatusByTaskId: {},
  promotePendingIds: [],
  prunePendingIds: [],
  promoteResultByTaskId: {},
  avenueErrorByTaskId: {},
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

// fetchReconciliation (Phase 86, D-12/D-13): pull THIS run's per-span
// reconciliation summary — the Phase-83 wire-vs-transcript match/flag counts —
// served VERBATIM by the vkb read route (lib/vkb-server/api-routes.js:623). A
// direct mirror of fetchContextTurns: same-origin, graceful on absence (the
// route returns `{ reconciliation: null }` on ENOENT, never 500). The reconciled
// counts feed the diff-viewer/badge header note (Waves 2/3) — NEVER recomputed
// client-side (T-86-02-03). The route serves the file's top-level `summary`
// object AS-IS; a missing/empty file yields `{ reconciliation: null }`. We
// normalise BOTH shapes to `ReconciliationSummary | null` so consumers read one
// type: prefer `data.reconciliation?.summary` (the documented empty-wrapper
// shape), else `data.summary` (the verbatim file shape), else null.
export const fetchReconciliation = createAsyncThunk(
  'performance/fetchReconciliation',
  async (taskId: string, { rejectWithValue }) => {
    try {
      const response = await fetch(`/api/experiments/runs/${encodeURIComponent(taskId)}/reconciliation`)
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }
      const data = await response.json()
      // Graceful-empty: ENOENT → `{ reconciliation: null }`; a real file is the
      // verbatim reconciliation.json carrying a top-level `summary`. Never throw
      // on absence — resolve to null so the badge degrades cleanly.
      const summary: ReconciliationSummary | null =
        (data?.reconciliation?.summary as ReconciliationSummary | undefined) ??
        (data?.summary as ReconciliationSummary | undefined) ??
        null
      return { taskId, reconciliation: summary }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// fetchComparison (CMP-04, Phase 80): pull THIS experiment's variant-comparison
// report from the live endpoint GET /api/experiments/{comparison}?task_hash=X, keyed
// by task_hash (D-03). Mirrors fetchReconciliation: keyed-by-id, graceful on
// absence — a non-ok response resolves to `report: null` (no thrown UI crash), so
// the matrix degrades to an "empty" placeholder rather than a red banner. The
// endpoint returns the frozen Phase 79 schema verbatim (same doc the CLI writes).
export const fetchComparison = createAsyncThunk<
  { taskHash: string; report: ComparisonReport | null },
  { taskHash: string; rankBy?: string },
  { rejectValue: string }
>(
  'performance/fetchComparison',
  async ({ taskHash, rankBy }, { rejectWithValue }) => {
    try {
      const qs = new URLSearchParams({ task_hash: taskHash })
      if (rankBy) qs.set('rank_by', rankBy)
      const response = await fetch(`/api/experiments/comparison?${qs.toString()}`)
      // Graceful-absent: a 4xx/5xx (unknown/invalid task_hash) is NOT a UI error —
      // resolve to null so the matrix shows its "no comparison" placeholder.
      if (!response.ok) {
        return { taskHash, report: null }
      }
      const report = (await response.json()) as ComparisonReport
      return { taskHash, report }
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
  { spec: string; overrides?: ExperimentOverrides; rerun_of?: string | null; origin_span_id?: string | null; forkAxes?: ForkAxes; sweep?: boolean },
  { rejectValue: string }
>(
  'performance/launchExperiment',
  async ({ spec, overrides, rerun_of, origin_span_id, forkAxes, sweep }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // AVN-02/D-01: the fork is a THIN wrapper over the existing run bridge —
        // it POSTs the SAME body plus the top-level `origin_span_id` link (mirrors
        // the WR-01 top-level `rerun_of` idiom), null-preserved (absent → null)
        // exactly like rerun_of, AND the chosen `forkAxes` + `sweep` flag.
        // Post-Phase-87-07 (CR-02) the server side is fully wired: handleExperimentRun
        // reads `origin_span_id` + `forkAxes`, calls `synthesizeAvenueSpec` to build the
        // AVENUE matrix from the chosen axes (NOT the origin spec's static matrix),
        // then threads `origin_span_id` + `--avenue` through the coordinator to the
        // runner (runMatrix → runCell → measurement-start `--origin-span-id`) so the
        // resulting avenue Runs carry a non-null origin_span_id and group by origin
        // (selectAvenuesByOrigin). Before 87-07 only origin_span_id was sent and the
        // server ignored it — that gap is closed; this body is the real shipped payload.
        body: JSON.stringify({
          spec,
          overrides: overrides ?? {},
          rerun_of: rerun_of ?? null,
          origin_span_id: origin_span_id ?? null,
          forkAxes: forkAxes ?? null,
          sweep: sweep ?? false,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return { run_id: data.run_id as string, pid: (data.pid ?? null) as number | null }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// Phase 87-07 (CR-02/CR-03): the axes-aware fork PREVIEW thunk. POSTs the chosen
// { origin_span_id, forkAxes, sweep, repeats } to the server and returns the
// SERVER-resolved { cellCount } (D-09 — the count is authoritative server-side, never
// a client axes cross-product). Mirrors the refreshReport POST-thunk idiom. The launcher
// dispatches this when the chosen axes/sweep/repeats change so the preview stays honest.
export const previewForkCount = createAsyncThunk<
  { cellCount: number },
  { origin_span_id: string; forkAxes?: ForkAxes; sweep?: boolean; repeats?: number },
  { rejectValue: string }
>(
  'performance/previewForkCount',
  async ({ origin_span_id, forkAxes, sweep, repeats }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/fork-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin_span_id, forkAxes: forkAxes ?? null, sweep: sweep ?? false, repeats: repeats ?? null }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return { cellCount: (data.cellCount ?? 0) as number }
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
// Branch avenues (Phase 87, Plan 87-06, Wave 4) — AVN-07/AVN-08/AVN-09.
// The origin-grouped N-way ranked panel groups avenue Runs by the `origin_span_id`
// the runner stamps (Plan 87-03), ranks them by outcome score (Phase 73 corrected-
// wins), and hangs a git-computed merge-status badge + host-side Promote/Prune
// off each row. The merge-status / promote / prune ops route host-side through the
// Plan 04 coordinator seam (vkb-server proxy → coordinator → avenue-branch.mjs) —
// NEVER git in the browser/container. The status is served VERBATIM (`state`,
// `ahead`, `behind`, `conflicts`, `branch`) — never client-recomputed (honesty).
// ---------------------------------------------------------------------------

// The verbatim git merge-status served by POST /api/experiments/avenue-merge-status
// (Plan 04 avenueMergeStatus → coordinator → vkb proxy). Rendered STRAIGHT by the
// merge-status badge (D-04). `state:'unknown'` (absent branch) → NO badge (honesty —
// we never fabricate a merge state for a branch that was never created / pruned).
export interface AvenueMergeStatus {
  state: 'merged' | 'unmerged' | 'conflicts' | 'unknown'
  ahead: number
  behind: number
  conflicts: number
  branch: string
}

// The verbatim promote result served by POST /api/experiments/avenue-promote.
// Conflict-blocked in the primitive: `{ promoted:false, reason:'conflicts' }`
// WITHOUT touching main. A clean promote advances main and returns `promoted:true`.
export interface AvenuePromoteResult {
  promoted: boolean
  reason?: 'conflicts' | 'unknown' | 'merge-failed'
  conflicts?: number
}

// fetchMergeStatus (AVN-08) — pull THIS avenue's git-computed merge status VERBATIM
// via the Plan 04 read route (host-only compute; the browser never runs git). Mirrors
// fetchReconciliation's graceful shape: a rejected/absent status leaves the badge to
// render nothing (honesty), never a crash. Body carries the avenue's task_id.
export const fetchMergeStatus = createAsyncThunk<
  { taskId: string; status: AvenueMergeStatus | null },
  string,
  { rejectValue: string }
>(
  'performance/fetchMergeStatus',
  async (taskId, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/avenue-merge-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      // The proxy relays the primitive JSON verbatim: { ok, state, ahead, behind,
      // conflicts, branch }. Store the shape MINUS the transport `ok` flag; a missing
      // `state` degrades to null so the badge simply renders nothing (honesty).
      const status: AvenueMergeStatus | null =
        typeof data?.state === 'string'
          ? {
              state: data.state as AvenueMergeStatus['state'],
              ahead: Number(data.ahead) || 0,
              behind: Number(data.behind) || 0,
              conflicts: Number(data.conflicts) || 0,
              branch: String(data.branch ?? `avenue/${taskId}`),
            }
          : null
      return { taskId, status }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// promoteAvenue (AVN-08) — merge the winning avenue branch into main, host-side.
// Conflict-blocked at BOTH the server (the primitive re-probes conflicts and refuses)
// AND the UI (the panel disables Promote when status==='conflicts'). Returns the
// verbatim `{ promoted, reason?, conflicts? }` so the operator always sees WHY a
// promote was refused. On success the caller re-fetches the merge status (main moved).
export const promoteAvenue = createAsyncThunk<
  { taskId: string; result: AvenuePromoteResult },
  string,
  { rejectValue: string }
>(
  'performance/promoteAvenue',
  async (taskId, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/avenue-promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return {
        taskId,
        result: {
          promoted: data?.promoted === true,
          reason: data?.reason as AvenuePromoteResult['reason'],
          conflicts: typeof data?.conflicts === 'number' ? data.conflicts : undefined,
        },
      }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

// pruneAvenue (AVN-09) — remove the avenue's git worktree+branch, host-side. The
// MEASUREMENT DATA in .data SURVIVES (D-05 guarantee — only the branch is removed);
// the confirm bar copy states this explicitly. Returns the verbatim `{ removed }`.
export const pruneAvenue = createAsyncThunk<
  { taskId: string; removed: boolean },
  string,
  { rejectValue: string }
>(
  'performance/pruneAvenue',
  async (taskId, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/avenue-prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || data?.error || `API returned ${response.status}`)
      return { taskId, removed: data?.removed === true }
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
    // Open the per-turn modal at a specific turn (Phase 86, D-01/D-02). Mirrors
    // setExplainTaskId but carries the focused turn index. The turn-modal (Wave
    // 2) mounts once in performance.tsx and reads modalTaskId/modalTurnIndex.
    openTurnModal(state, action: PayloadAction<{ taskId: string; index: number }>) {
      state.modalTaskId = action.payload.taskId
      state.modalTurnIndex = action.payload.index
    },
    closeTurnModal(state) {
      state.modalTaskId = null
      state.modalTurnIndex = null
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
    // Dismiss the inline per-avenue op error (D-09 honesty — never a silent failure).
    clearAvenueError(state, action: PayloadAction<string>) {
      state.avenueErrorByTaskId[action.payload] = null
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
      // fetchReconciliation (Phase 86) — store the per-span summary keyed by
      // taskId (null = fetched-but-absent). Best-effort like fetchContextTurns:
      // on rejection we leave the existing entry so the badge degrades cleanly.
      .addCase(fetchReconciliation.fulfilled, (state, action) => {
        state.reconciliationByTaskId[action.payload.taskId] = action.payload.reconciliation
      })
      // fetchComparison (CMP-04, Phase 80) — store the variant-comparison report
      // keyed by task_hash (null = fetched-but-absent). Fulfilled-only, best-effort
      // like fetchReconciliation: no pending/rejected banner — the matrix degrades
      // to an empty placeholder rather than a loading spinner or error alert.
      .addCase(fetchComparison.fulfilled, (state, action) => {
        state.comparisonByTaskHash[action.payload.taskHash] = action.payload.report
      })
      // fetchMergeStatus (Phase 87, Plan 87-06) — store the per-avenue git status
      // VERBATIM keyed by task_id (null = fetched-but-absent → no badge). Best-effort
      // like fetchReconciliation: on rejection leave the entry so the badge degrades.
      .addCase(fetchMergeStatus.fulfilled, (state, action) => {
        state.mergeStatusByTaskId[action.payload.taskId] = action.payload.status
      })
      // promoteAvenue — per-row pending flag + verbatim result (conflict-refused is
      // NOT a rejection; it comes back { promoted:false, reason:'conflicts' }).
      .addCase(promoteAvenue.pending, (state, action) => {
        const id = action.meta.arg
        if (!state.promotePendingIds.includes(id)) state.promotePendingIds.push(id)
        state.avenueErrorByTaskId[id] = null
      })
      .addCase(promoteAvenue.fulfilled, (state, action) => {
        const { taskId, result } = action.payload
        state.promotePendingIds = state.promotePendingIds.filter((x) => x !== taskId)
        state.promoteResultByTaskId[taskId] = result
      })
      .addCase(promoteAvenue.rejected, (state, action) => {
        const id = action.meta.arg
        state.promotePendingIds = state.promotePendingIds.filter((x) => x !== id)
        state.avenueErrorByTaskId[id] = (action.payload as string) ?? 'Promote failed'
      })
      // pruneAvenue — per-row pending flag; on success drop the cached status so the
      // badge disappears (the branch is gone — honesty). Measurement data survives.
      .addCase(pruneAvenue.pending, (state, action) => {
        const id = action.meta.arg
        if (!state.prunePendingIds.includes(id)) state.prunePendingIds.push(id)
        state.avenueErrorByTaskId[id] = null
      })
      .addCase(pruneAvenue.fulfilled, (state, action) => {
        const { taskId, removed } = action.payload
        state.prunePendingIds = state.prunePendingIds.filter((x) => x !== taskId)
        if (removed) state.mergeStatusByTaskId[taskId] = null
      })
      .addCase(pruneAvenue.rejected, (state, action) => {
        const id = action.meta.arg
        state.prunePendingIds = state.prunePendingIds.filter((x) => x !== id)
        state.avenueErrorByTaskId[id] = (action.payload as string) ?? 'Prune failed'
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
  openTurnModal,
  closeTurnModal,
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
  clearAvenueError,
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

// Per-taskId reconciliation-summary selector factory (Phase 86, D-12/D-13),
// mirroring selectContextTurnsFor. Returns the stored summary, or null when
// absent/failed so the badge never crashes on a missing or failed fetch.
export const selectReconciliationFor = (taskId: string | null) => (state: RootState): ReconciliationSummary | null =>
  taskId ? (state.performance.reconciliationByTaskId[taskId] ?? null) : null

// CMP-04 (Phase 80): the comparison report for a given task_hash, or null when
// absent/fetched-but-null so the matrix never crashes on a missing experiment.
export const selectComparisonFor = (state: RootState, taskHash: string | null): ComparisonReport | null =>
  taskHash ? (state.performance.comparisonByTaskHash[taskHash] ?? null) : null

// The task_hash the Comparison tab fetches with (D-03). Resolves the experiment
// identity from the currently-selected run (row click → selectedTaskId), falling
// back to the FIRST fetched run's task_hash so the tab renders the (single, in the
// pre-existing data) experiment by default instead of an empty placeholder. All
// 36 pre-existing runs share one task_hash, so the fallback is the honest default.
export const selectSelectedTaskHash = (state: RootState): string | null => {
  const runs = state.performance.runs
  const selectedId = state.performance.selectedTaskId
  if (selectedId) {
    const sel = runs.find((r) => r.task_id === selectedId)
    if (sel?.task_hash) return sel.task_hash
  }
  const first = runs.find((r) => !!r.task_hash)
  return first?.task_hash ?? null
}

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

// The per-turn modal open-state (Phase 86, D-01/D-02): the focused run + turn
// index, plus a `open` convenience flag. Both null = closed. turn-modal.tsx
// (Wave 2) mounts once and reads this; mirrors selectExplainTaskId/selectExplainRun.
export const selectModalTurn = (state: RootState): { taskId: string | null; index: number | null; open: boolean } => {
  const taskId = state.performance.modalTaskId
  const index = state.performance.modalTurnIndex
  return { taskId, index, open: taskId != null && index != null }
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

// ---------------------------------------------------------------------------
// Branch avenues (Phase 87, Plan 87-06) — origin-grouping + ranking selectors +
// merge-status readbacks. These power the origin-grouped N-way ranked panel
// (avenue-panel.tsx): group the fetched Runs by the `origin_span_id` the runner
// stamps (Plan 87-03), rank each origin's avenues by outcome score (Phase 73
// corrected-wins default), and hang the VERBATIM git merge status off each row.
// ---------------------------------------------------------------------------

// The read-only-safe `origin_span_id` off a Run's index signature (the runner
// stamps it — Plan 87-03). Reuses the same defensive read as buildForkPrefill.
export function runOriginSpanId(run: Run): string | null {
  return forkRunStr(run, 'origin_span_id')
}

// Outcome score for ranking — Phase 73 corrected-wins: prefer corrected_goal_achieved,
// fall back to goal_achieved, else null (unmeasured — sorts LAST, never coerced to 0
// so an unscored avenue never out-ranks a real low score — honesty). Read VERBATIM
// off the persisted score; never recomputed.
export function avenueOutcomeScore(run: Run): number | null {
  const corrected = run.score?.corrected_goal_achieved
  if (typeof corrected === 'number') return corrected
  const goal = run.score?.goal_achieved
  if (typeof goal === 'number') return goal
  return null
}

// The sortable columns for the ranked panel (UI-SPEC Interaction Contract 5):
// default = outcome score (best first); secondary = tokens/cost, route quality,
// wall-clock. Each maps to a VERBATIM persisted field (no client recompute).
export type AvenueRankColumn = 'outcome' | 'tokens' | 'route' | 'wallclock'
export type AvenueSortDir = 'asc' | 'desc'

// The comparable value for a given column — null = unmeasured (sorts last regardless
// of direction, honesty). tokens = outcome.totalTokens; route = loop_count (lower is
// better); wallclock = wallclock_per_step (lower is better).
function avenueColumnValue(run: Run, column: AvenueRankColumn): number | null {
  switch (column) {
    case 'outcome':
      return avenueOutcomeScore(run)
    case 'tokens':
      return typeof run.outcome?.totalTokens === 'number' ? run.outcome.totalTokens : null
    case 'route':
      return typeof run.loop_count === 'number' ? run.loop_count : null
    case 'wallclock':
      return typeof run.wallclock_per_step === 'number' ? run.wallclock_per_step : null
    default:
      return null
  }
}

// Rank an origin's avenues by a column+direction. Nulls (unmeasured) ALWAYS sort to
// the bottom (honesty — an unmeasured avenue never claims a rank it hasn't earned).
// Stable via task_id tiebreak so re-sorts don't jitter equal rows.
export function rankAvenues(
  avenues: Run[],
  column: AvenueRankColumn = 'outcome',
  dir: AvenueSortDir = 'desc',
): Run[] {
  const sign = dir === 'desc' ? -1 : 1
  return [...avenues].sort((a, b) => {
    const va = avenueColumnValue(a, column)
    const vb = avenueColumnValue(b, column)
    if (va == null && vb == null) return a.task_id.localeCompare(b.task_id)
    if (va == null) return 1 // a unmeasured → after b
    if (vb == null) return -1 // b unmeasured → after a
    if (va !== vb) return sign * (va - vb)
    return a.task_id.localeCompare(b.task_id)
  })
}

// Group the fetched Runs by origin_span_id into an ordered list of origin groups.
// Only Runs that carry an origin_span_id (i.e. avenues forked off an origin span —
// Plan 87-03) are grouped; plain (non-forked) Runs are excluded from the avenue
// panel. Each group's avenues are ranked by the DEFAULT column (outcome, best-first);
// the panel re-ranks per its own sort UI. Groups are ordered by origin id for a
// stable render.
export const selectAvenuesByOrigin = createSelector(
  [selectRuns],
  (runs): { originSpanId: string; avenues: Run[] }[] => {
    const groups = new Map<string, Run[]>()
    for (const run of runs) {
      const origin = runOriginSpanId(run)
      if (!origin) continue // not an avenue — skip
      const bucket = groups.get(origin)
      if (bucket) bucket.push(run)
      else groups.set(origin, [run])
    }
    return Array.from(groups.entries())
      .map(([originSpanId, avenues]) => ({ originSpanId, avenues: rankAvenues(avenues) }))
      .sort((a, b) => a.originSpanId.localeCompare(b.originSpanId))
  }
)

// Per-avenue merge-status selector factory (mirrors selectReconciliationFor). Returns
// the VERBATIM git status, or null when absent/unknown/pruned so the badge renders
// NOTHING (honesty — never a fabricated merge state).
export const selectMergeStatusFor = (taskId: string | null) => (state: RootState): AvenueMergeStatus | null =>
  taskId ? (state.performance.mergeStatusByTaskId[taskId] ?? null) : null

// Per-avenue promote/prune pending predicates + the verbatim promote result + the
// dismissible inline error (D-09).
export const selectPromotePending = (taskId: string) => (state: RootState): boolean =>
  state.performance.promotePendingIds.includes(taskId)
export const selectPrunePending = (taskId: string) => (state: RootState): boolean =>
  state.performance.prunePendingIds.includes(taskId)
export const selectPromoteResultFor = (taskId: string | null) => (state: RootState): AvenuePromoteResult | null =>
  taskId ? (state.performance.promoteResultByTaskId[taskId] ?? null) : null
export const selectAvenueErrorFor = (taskId: string | null) => (state: RootState): string | null =>
  taskId ? (state.performance.avenueErrorByTaskId[taskId] ?? null) : null

export default performanceSlice.reducer
