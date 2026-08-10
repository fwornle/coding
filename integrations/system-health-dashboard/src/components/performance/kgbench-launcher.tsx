import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppSelector, useAppDispatch } from '@/store'
import { AllNone, Explain, Hint, PickGroup, type PickOption } from './kgbench-controls'
import {
  fetchKgbenchConfig,
  fetchKgbenchModels,
  probeKgbenchModels,
  launchKgbench,
  clearKgbenchLaunchError,
  selectKgbenchConfig,
  selectKgbenchConfigLoading,
  selectKgbenchConfigError,
  selectKgbenchModels,
  selectKgbenchProbePending,
  selectKgbenchProbeError,
  selectKgbenchLaunchPending,
  selectKgbenchLaunchError,
  selectKgbenchExistingRun,
  selectVerifiedModelNames,
  type KgbenchQuestion,
} from '@/store/slices/kgbenchSlice'

// The kgbench launcher — set × arms × agents × models × reps.
//
// It is a LAUNCHER, not an editor: arms come from config/kgbench/arms.json and questions from
// config/kgbench/questions/, both served by /api/kgbench/config, and nothing here can change
// them. An arm's identity is its tool surface; a UI that let you edit the surface would let
// you relabel the experiment without relabelling the results.
//
// LAYOUT: axes on the left, a STICKY summary on the right. The axes are the long part —
// seventeen questions, four arms, three agents — and the number that decides whether to press
// the button is the cell count. Putting the count in a sticky column means it stays legible
// while you scroll the axes, instead of sitting at the bottom of a tall card where you have to
// scroll away from the checkboxes to see what they cost.
//
// Three things it refuses to do quietly, each because the quiet version has cost a run:
//
//   1. It does not offer a model the proxy was not OBSERVED to serve. `providerModels` both
//      over-reports (copilot + claude-opus-4.6 → 400 "not supported") and under-reports (it
//      lists no Opus 5, which claude serves). An unverified model is shown, marked, and
//      launchable only after an explicit override — never presented as equivalent.
//   2. It shows which arm×agent pairs the runner will SKIP, with the harness's own reason,
//      before you launch. Picking three agents and receiving a one-agent matrix is otherwise
//      something you discover in the results file.
//   3. It will not silently resume. A run id that already has cells offers a resume.

// A conservative cost anchor for the pre-launch estimate. kgbench cells are whole agent
// sessions against a restored worktree; the x2 run's claude cells averaged ~130k total tokens.
// Labelled "est." wherever it appears — the authoritative number is measured after the fact.
const EST_TOKENS_PER_CELL = 130_000
// Rough serial wall-clock per cell, from the x2 run's medians (17–37s per arm, plus restore
// and grading overhead). Only ever shown as an order of magnitude.
const EST_SECONDS_PER_CELL = 45
// Above this many cells a matrix is hours of wall-clock and real money.
const LARGE_MATRIX_CELLS = 200

// The benchmark's canonical model spellings, offered as suggestions. Whether any of them is
// actually served is decided by the probe cache, never by this list.
const CANDIDATE_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-sonnet-4.6', 'claude-haiku-4.5']

// What each question class is FOR. Shown on hover so the class filters are meaningful to
// someone who has not read the benchmark's README.
const CLASS_HINTS: Record<string, string> = {
  lookup: 'Find one named thing — a file, a function, a route. The cheapest retrieval question there is.',
  structural: 'Describe how parts are wired: precedence orders, which program runs what, which transports exist.',
  blast: 'Trace consequences. "If X changed, what breaks" — the questions a graph should be best at.',
  arch: 'Explain a deliberate design decision and the reason recorded for it. Prose answers, judged as well as checked.',
  abstain: 'Traps. The thing asked about does NOT exist, and the correct answer is to say so. Never judged — they carry no checklist.',
}

function ordered(classes: Record<string, number> | undefined): string[] {
  // Fixed order — lookup → structural → blast → arch → abstain — matching the report's tables
  // and the difficulty gradient. Object key order would be arbitrary.
  const ORDER = ['lookup', 'structural', 'blast', 'arch', 'abstain']
  const present = Object.keys(classes ?? {})
  return [...ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !ORDER.includes(c))]
}

function fmtDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${(seconds / 3600).toFixed(1)} h`
}

export function KgbenchLauncher() {
  const dispatch = useAppDispatch()
  const config = useAppSelector(selectKgbenchConfig)
  const configLoading = useAppSelector(selectKgbenchConfigLoading)
  const configError = useAppSelector(selectKgbenchConfigError)
  const models = useAppSelector(selectKgbenchModels)
  const probePending = useAppSelector(selectKgbenchProbePending)
  const probeError = useAppSelector(selectKgbenchProbeError)
  const launchPending = useAppSelector(selectKgbenchLaunchPending)
  const launchError = useAppSelector(selectKgbenchLaunchError)
  const existingRun = useAppSelector(selectKgbenchExistingRun)
  const verifiedNames = useAppSelector(selectVerifiedModelNames)

  const [runId, setRunId] = useState('')
  const [setName, setSetName] = useState('')
  const [reps, setReps] = useState('3')
  const [pickedArms, setPickedArms] = useState<string[]>([])
  const [pickedAgents, setPickedAgents] = useState<string[]>([])
  const [pickedModels, setPickedModels] = useState<string[]>([])
  const [pickedQuestions, setPickedQuestions] = useState<string[]>([])
  const [allowUnverifiedModels, setAllowUnverifiedModels] = useState(false)

  useEffect(() => {
    dispatch(fetchKgbenchConfig())
    dispatch(fetchKgbenchModels())
  }, [dispatch])

  const selectedSet = useMemo(
    () => config?.sets.find((s) => s.name === setName) ?? null,
    [config, setName]
  )
  const questions: KgbenchQuestion[] = useMemo(() => selectedSet?.questions ?? [], [selectedSet])

  // Seed from the harness's own defaults once the config lands, so the button in its resting
  // state launches the benchmark as configured — the same matrix the CLI runs with no flags.
  // An empty-by-default form invites a partial matrix by accident.
  useEffect(() => {
    if (!config) return
    setSetName((s) => s || config.sets.find((x) => x.name === 'coding-v1')?.name || config.sets[0]?.name || '')
    setPickedArms((a) => (a.length ? a : config.arms.filter((x) => x.enabled && x.resolved).map((x) => x.id)))
    setPickedAgents((a) => (a.length ? a : (config.defaults.agents ?? ['claude']).filter((x) => config.agents.includes(x))))
    setPickedModels((m) => (m.length ? m : (config.defaults.models ?? [config.defaults.model].filter(Boolean) as string[])))
  }, [config])

  // Every question is on by default, and changing set re-seeds. "None picked = all" was the
  // previous behaviour and it made the class filters unreadable: unticking one question in a
  // 17-question set silently meant "run only the 16 I did not untick", which is right, but
  // unticking the LAST one meant "run all 17" — the opposite of what the click said.
  useEffect(() => {
    setPickedQuestions(questions.map((q) => q.id))
  }, [questions])

  const classes = useMemo(() => ordered(selectedSet?.classes), [selectedSet])

  // The arm×agent pairs the runner will skip, from the SAME verdicts the runner uses
  // (armIsFaithful, served in /api/kgbench/config). Not a client-side guess.
  const skipped = useMemo(() => {
    if (!config) return []
    const out: { arm: string; agent: string; reason: string }[] = []
    for (const armId of pickedArms) {
      const arm = config.arms.find((a) => a.id === armId)
      if (!arm) continue
      for (const agent of pickedAgents) {
        const v = arm.agents?.[agent]
        if (v && !v.faithful) out.push({ arm: armId, agent, reason: v.reason ?? 'not faithful for this agent' })
      }
    }
    return out
  }, [config, pickedArms, pickedAgents])

  const faithfulPairs = Math.max(0, pickedArms.length * pickedAgents.length - skipped.length)

  // Cells = questions × faithful arm×agent pairs × models × reps. Skipped pairs are SUBTRACTED:
  // at launch time the operator is deciding whether to spend the money, and quoting a matrix a
  // quarter of which will not run would be quoting the wrong price.
  const cellCount = useMemo(() => {
    const q = pickedQuestions.length
    const m = Math.max(1, pickedModels.length)
    const r = Number(reps)
    if (!q || faithfulPairs <= 0 || !Number.isFinite(r) || r < 1) return null
    return q * faithfulPairs * m * r
  }, [pickedQuestions, faithfulPairs, pickedModels, reps])

  const estTokens = cellCount == null ? null : cellCount * EST_TOKENS_PER_CELL
  const unverifiedPicked = pickedModels.filter((m) => !verifiedNames.has(m))
  const runIdInvalid = runId.trim() !== '' && !/^[A-Za-z0-9._-]{1,48}$/.test(runId.trim())

  const blockers: string[] = []
  if (runId.trim() === '') blockers.push('a run id')
  if (runIdInvalid) blockers.push('a valid run id')
  if (!setName) blockers.push('a question set')
  if (pickedArms.length === 0) blockers.push('at least one arm')
  if (pickedAgents.length === 0) blockers.push('at least one agent')
  if (pickedQuestions.length === 0) blockers.push('at least one question')
  if (pickedModels.length === 0) blockers.push('at least one model')
  if (faithfulPairs <= 0 && pickedArms.length && pickedAgents.length) {
    blockers.push('one arm×agent pair the runner will actually run')
  }
  if (unverifiedPicked.length > 0 && !allowUnverifiedModels) blockers.push('the unverified-model acknowledgement')
  const blocked = blockers.length > 0 || cellCount == null || cellCount <= 0

  const onLaunch = async (resume = false) => {
    if (blocked && !resume) return
    await dispatch(launchKgbench({
      run_id: runId.trim(),
      set: setName,
      reps: Number(reps),
      arms: pickedArms,
      agents: pickedAgents,
      models: pickedModels,
      // Send the subset only when it IS a subset — an explicit list of all 17 and an omitted
      // list mean the same run, and the omitted form is what a person would type.
      only: pickedQuestions.length === questions.length ? [] : pickedQuestions,
      resume,
    }))
  }

  if (configError) {
    return (
      <Card data-testid="kgbench-launcher">
        <CardHeader className="pb-2"><CardTitle className="text-base">Launch benchmark</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              Could not read the kgbench config ({configError}). Check that the vkb-server experiment
              API is reachable and that <span className="font-mono">config/kgbench/arms.json</span> exists.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const armOptions: PickOption[] = (config?.arms ?? []).map((arm) => ({
    value: arm.id,
    label: arm.label,
    disabled: !arm.enabled || !arm.resolved,
    suffix: !arm.enabled
      ? <Badge variant="outline" className="shrink-0">off</Badge>
      : !arm.resolved
        ? <Badge variant="destructive" className="shrink-0">unresolved</Badge>
        : null,
    hint: !arm.resolved
      ? 'This arm could not be resolved — its backend is missing from config/code-graph.json. Listed rather than hidden, because a missing arm looks like one that was never configured.'
      : !arm.enabled
        ? 'Disabled in config/kgbench/arms.json.'
        : <>Tool surface: <span className="font-mono">{arm.allowedTools?.join(', ') || '—'}</span></>,
  }))

  const agentOptions: PickOption[] = (config?.agents ?? []).map((agent) => ({
    value: agent,
    label: agent,
    hint: agent === 'claude'
      ? 'The only agent whose built-in tools can be gated (--allowedTools). Arms defined by WITHHOLDING search are faithful only here.'
      : `MCP servers can be restricted on ${agent}, but built-in file tools cannot — so arms that withhold Glob/Grep are skipped for it.`,
  }))

  const modelOptions: PickOption[] = [...new Set([
    ...CANDIDATE_MODELS, ...pickedModels, ...(models?.verified ?? []).map((m) => m.requested),
  ])].map((name) => {
    const v = models?.verified.find((m) => m.requested === name)
    const rejected = models?.rejected.find((m) => m.requested === name)
    return {
      value: name,
      label: name,
      suffix: v
        ? (v.exact
          ? <Badge variant="default" className="shrink-0">verified</Badge>
          : <Badge variant="secondary" className="shrink-0">→ {v.served}</Badge>)
        : rejected
          ? <Badge variant="destructive" className="shrink-0">rejected</Badge>
          : <Badge variant="outline" className="shrink-0">unverified</Badge>,
      hint: v
        ? (v.exact
          ? `Probed: served as ${v.served}${v.stable ? '' : ' (UNSTABLE — repeat probes disagreed)'}.`
          : `Probed: this request RESOLVES to ${v.served}. Not the same model you asked for.`)
        : rejected
          ? `Probed and rejected: ${rejected.error ?? 'the provider refused it'}.`
          : 'Never probed. The catalog is not evidence — it advertises models providers reject and omits models they serve. Re-probe, or acknowledge below.',
    }
  })

  return (
    <TooltipProvider delayDuration={200}>
      <Card data-testid="kgbench-launcher" className="scroll-mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Launch benchmark</CardTitle>
          <CardDescription>
            One question, answered by one arm on one agent at one model, graded against a stored key.
            Every combination below is one cell.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configLoading && !config && <p className="text-sm text-muted-foreground">Loading arms and question sets…</p>}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            {/* ── Axes ─────────────────────────────────────────────────── */}
            <div className="min-w-0 space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground" htmlFor="kgb-run-id">
                    <Hint text="Becomes the directory name under .data/kgbench/runs/ and the resume key. Reusing an id resumes that run rather than starting a new one — the launcher will ask first.">
                      Run id
                    </Hint>
                  </label>
                  <Input
                    id="kgb-run-id"
                    data-testid="kgb-run-id"
                    className={runIdInvalid ? 'border-destructive' : ''}
                    placeholder="coding-v1-r8"
                    value={runId}
                    onChange={(e) => setRunId(e.target.value)}
                  />
                  {runIdInvalid && (
                    <p className="text-xs text-destructive">
                      1–48 chars; letters, digits, <span className="font-mono">. _ -</span> only.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground" htmlFor="kgb-set">
                    <Hint text="A question set is the graded corpus: prompts plus the answer keys and evidence file:line references that score them. Defined in config/kgbench/questions/.">
                      Question set
                    </Hint>
                  </label>
                  <select
                    id="kgb-set"
                    data-testid="kgb-set"
                    aria-label="question set"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={setName}
                    onChange={(e) => setSetName(e.target.value)}
                  >
                    <option value="">Choose a set…</option>
                    {(config?.sets ?? []).map((s) => (
                      <option key={s.name} value={s.name} disabled={!!s.error}>
                        {s.name}{s.error ? ' (malformed)' : ` — ${s.questionCount} questions`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground" htmlFor="kgb-reps">
                    <Hint text="How many times each cell is repeated. Agents are non-deterministic, so a single rep measures one sample, not a capability. 3 is the working default; the published run deepened its hardest questions to 10.">
                      Reps per cell
                    </Hint>
                  </label>
                  <Input
                    id="kgb-reps" data-testid="kgb-reps" type="number" min={1} max={100}
                    value={reps} onChange={(e) => setReps(e.target.value)}
                  />
                </div>
              </div>

              <PickGroup
                title="Arms"
                hint="An arm is one way of answering: a fixed tool surface. Arms differ ONLY in the tools they may use, so the comparison measures retrieval strategy rather than model."
                options={armOptions}
                selected={pickedArms}
                onChange={setPickedArms}
                minColWidth="15rem"

              />

              <PickGroup
                title="Agents"
                hint="Which coding CLI drives the cell. Only claude can be held to an arm's tool surface — mastracode is omitted here because it has never produced a cell in any run."
                options={agentOptions}
                selected={pickedAgents}
                onChange={setPickedAgents}
                minColWidth="9rem"

              />

              <PickGroup
                title="Models"
                hint="Which model each agent runs. Names are the benchmark's canonical spelling; each agent's own dialect is derived from it. 'verified' means the proxy was OBSERVED serving it, not that a catalog lists it."
                options={modelOptions}
                selected={pickedModels}
                onChange={setPickedModels}
                minColWidth="15rem"

                footer={
                  <div className="space-y-1.5 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {models?.probedAt
                          ? `probed ${new Date(models.probedAt).toLocaleString()}`
                          : 'never probed — nothing is verified'}
                      </span>
                      <Explain text="Runs scripts/llm-model-probe.mjs on the host: installs a temporary routing override per candidate, sends one real completion, and records which model actually answered. Serialised, so it takes minutes and costs tokens.">
                        <Button
                          variant="outline" size="sm" disabled={probePending}
                          onClick={() => dispatch(probeKgbenchModels())}
                          data-testid="kgb-probe-models"
                        >
                          {probePending ? 'Probing… (minutes)' : 'Re-probe models'}
                        </Button>
                      </Explain>
                    </div>
                    {probeError && <p className="text-xs text-destructive" role="alert">{probeError}</p>}
                    {unverifiedPicked.length > 0 && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
                        <Checkbox
                          id="kgb-allow-unverified"
                          checked={allowUnverifiedModels}
                          onCheckedChange={(c) => setAllowUnverifiedModels(c === true)}
                          data-testid="kgb-allow-unverified"
                        />
                        <label htmlFor="kgb-allow-unverified" className="cursor-pointer text-xs leading-snug">
                          <span className="font-mono">{unverifiedPicked.join(', ')}</span>{' '}
                          {unverifiedPicked.length === 1 ? 'has' : 'have'} not been observed being served.
                          Launch anyway.
                        </label>
                      </div>
                    )}
                  </div>
                }
              />

              {/* Questions — grouped by class, each class with its own all/none. */}
              {questions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      <Hint text="Every question is graded by a deterministic checklist; most are also scored by an LLM judge. Untick to run a subset — useful for deepening the hard ones without re-running the whole set.">
                        Questions
                      </Hint>
                      <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                        {pickedQuestions.length} of {questions.length}
                      </span>
                    </p>
                    <AllNone
                      label="questions"
                      onAll={() => setPickedQuestions(questions.map((q) => q.id))}
                      onNone={() => setPickedQuestions([])}
                      allDisabled={pickedQuestions.length === questions.length}
                      noneDisabled={pickedQuestions.length === 0}
                    />
                  </div>

                  <div className="space-y-3" data-testid="kgb-questions">
                    {classes.map((cls) => {
                      const inClass = questions.filter((q) => q.cls === cls)
                      const ids = inClass.map((q) => q.id)
                      const onCount = ids.filter((id) => pickedQuestions.includes(id)).length
                      return (
                        <div key={cls} className="rounded-md border px-3 py-2">
                          <div className="mb-1.5 flex items-baseline justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <Hint text={CLASS_HINTS[cls] ?? 'A question class defined by the set.'}>
                                {cls}
                              </Hint>
                              <span className="ml-2 font-normal tabular-nums">{onCount}/{ids.length}</span>
                            </p>
                            <AllNone
                              label={`${cls} questions`}
                              onAll={() => setPickedQuestions((p) => [...new Set([...p, ...ids])])}
                              onNone={() => setPickedQuestions((p) => p.filter((id) => !ids.includes(id)))}
                              allDisabled={onCount === ids.length}
                              noneDisabled={onCount === 0}
                            />
                          </div>
                          <div
                            className="grid gap-x-6 gap-y-1"
                            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(19rem, 1fr))' }}
                          >
                            {inClass.map((q) => (
                              <label key={q.id} className="flex min-w-0 cursor-pointer items-center gap-1.5 text-sm">
                                <Checkbox
                                  checked={pickedQuestions.includes(q.id)}
                                  onCheckedChange={() => setPickedQuestions((p) =>
                                    p.includes(q.id) ? p.filter((x) => x !== q.id) : [...p, q.id])}
                                />
                                <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">{q.id}</span>
                                <span className="truncate">{q.label ?? '(no summary)'}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Sticky summary ───────────────────────────────────────── */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="space-y-3 rounded-lg border p-4" data-testid="kgb-preview">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Matrix</p>
                  <p className="text-3xl font-semibold tabular-nums" data-testid="kgb-cell-count">
                    {cellCount ?? '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">cells, run one at a time</p>
                </div>

                <dl className="space-y-1 border-t pt-3 text-sm">
                  {[
                    ['questions', pickedQuestions.length],
                    ['arm × agent', faithfulPairs],
                    ['models', pickedModels.length],
                    ['reps', reps],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="tabular-nums">{String(v)}</dd>
                    </div>
                  ))}
                </dl>

                {cellCount != null && (
                  <div className="space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        <Hint text={`A planning hint only, at ~${(EST_TOKENS_PER_CELL / 1000).toFixed(0)}k tokens per cell (the x2 run's claude median). Real spend is measured after the run, never estimated.`}>
                          est. tokens
                        </Hint>
                      </dt>
                      <dd className="tabular-nums">{((estTokens ?? 0) / 1_000_000).toFixed(1)}M</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        <Hint text={`At roughly ${EST_SECONDS_PER_CELL}s per cell, serial. A slow host or a retry makes this longer, never shorter.`}>
                          est. wall-clock
                        </Hint>
                      </dt>
                      <dd className="tabular-nums">{fmtDuration(cellCount * EST_SECONDS_PER_CELL)}</dd>
                    </div>
                  </div>
                )}

                {cellCount != null && cellCount > LARGE_MATRIX_CELLS && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs" data-testid="kgb-large-matrix">
                    Large matrix — hours of wall-clock and real spend. The supervisor is resumable:
                    a signal death keeps completed cells and continues.
                  </p>
                )}

                <div className="border-t pt-3">
                  <Button
                    className="w-full"
                    onClick={() => onLaunch(false)}
                    disabled={blocked || launchPending}
                    data-testid="kgb-launch"
                  >
                    {launchPending ? 'Launching…' : `Launch ${cellCount ?? ''} cells`}
                  </Button>
                  {/* A disabled button that does not say why is a dead end. */}
                  {blockers.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground" data-testid="kgb-blockers">
                      Needs {blockers.join(', ')}.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Runs detached under <span className="font-mono">kgbench-supervise.sh</span> — survives
                    this page, a container restart, and a signal death.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Skipped pairs — full width below, since the reasons are prose. */}
          {skipped.length > 0 && (
            <Alert className="mt-4" data-testid="kgb-skipped">
              <AlertDescription>
                <p className="mb-1 text-sm font-medium">
                  {skipped.length} arm × agent {skipped.length === 1 ? 'combination' : 'combinations'} will
                  be skipped — already excluded from the {cellCount ?? 0}-cell count
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {skipped.map((s) => (
                    <li key={`${s.arm}|${s.agent}`}>
                      <span className="font-mono">{s.arm} × {s.agent}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {launchError && (
            <Alert variant={existingRun ? 'default' : 'destructive'} className="mt-4" data-testid="kgb-launch-error">
              <AlertDescription>
                <p className="text-sm">{launchError}</p>
                <div className="mt-2 flex items-center gap-2">
                  {existingRun && (
                    <Button size="sm" variant="outline" onClick={() => onLaunch(true)}
                      disabled={launchPending} data-testid="kgb-resume">
                      Resume {existingRun.run_id} ({existingRun.cells} cells done)
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => dispatch(clearKgbenchLaunchError())}>
                    Dismiss
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
