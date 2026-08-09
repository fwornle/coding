import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAppSelector, useAppDispatch } from '@/store'
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
} from '@/store/slices/kgbenchSlice'

// The kgbench launcher — set × arms × agents × models × reps.
//
// It is a LAUNCHER, not an editor: arms come from config/kgbench/arms.json and questions from
// config/kgbench/questions/, both served by /api/kgbench/config, and nothing here can change
// them. That is deliberate. An arm's identity is its tool surface; a UI that let you edit the
// surface would let you relabel the experiment without relabelling the results.
//
// Three things it refuses to do quietly, each because the quiet version has already cost a run:
//
//   1. It does not offer a model the proxy was not OBSERVED to serve. `providerModels` both
//      over-reports (copilot + claude-opus-4.6 → 400 "not supported") and under-reports (it
//      lists no Opus 5, which claude serves). An unverified model is shown, marked, and
//      launchable only after an explicit override — never presented as equivalent.
//   2. It shows which arm×agent pairs the runner will SKIP, with the harness's own reason,
//      before you launch. Picking three agents and receiving a one-agent matrix is otherwise
//      something you discover in the results file.
//   3. It will not silently resume. A run id that already has cells produces an offer to
//      resume, not an append.

// A conservative cost anchor for the pre-launch estimate. kgbench cells are whole agent
// sessions against a restored worktree; the x2 run's claude cells averaged ~130k total tokens.
// Labelled "est." wherever it appears — the authoritative number is measured after the fact.
const EST_TOKENS_PER_CELL = 130_000
// Above this many cells a matrix is hours of wall-clock and real money, so it gets a caution
// line rather than a bare button.
const LARGE_MATRIX_CELLS = 200

// Model names the benchmark itself uses as its canonical spelling. Offered as suggestions
// only; whether any of them is actually served is decided by the probe cache, never by this list.
const CANDIDATE_MODELS = [
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-sonnet-4.6',
  'claude-haiku-4.5',
]

function RunIdField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground" htmlFor="kgb-run-id">Run id</label>
      <Input
        id="kgb-run-id"
        data-testid="kgb-run-id"
        className={invalid ? 'border-destructive' : ''}
        placeholder="coding-v1-r8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && (
        <p className="text-xs text-destructive">
          1–48 characters, letters/digits/<span className="font-mono">. _ -</span> only — it becomes a directory name.
        </p>
      )}
    </div>
  )
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
  const [onlyQuestions, setOnlyQuestions] = useState<string[]>([])
  const [allowUnverifiedModels, setAllowUnverifiedModels] = useState(false)

  useEffect(() => {
    dispatch(fetchKgbenchConfig())
    dispatch(fetchKgbenchModels())
  }, [dispatch])

  // Seed the picks from the harness's own defaults once the config lands, so the button in
  // its resting state launches the benchmark as configured — the same matrix the CLI would
  // run with no flags. An empty-by-default form invites a partial matrix by accident.
  useEffect(() => {
    if (!config) return
    setSetName((s) => s || config.sets.find((x) => x.name === 'coding-v1')?.name || config.sets[0]?.name || '')
    setPickedArms((a) => (a.length ? a : config.arms.filter((x) => x.enabled).map((x) => x.id)))
    setPickedAgents((a) => (a.length ? a : (config.defaults.agents ?? ['claude'])))
    setPickedModels((m) => (m.length ? m : (config.defaults.models ?? [config.defaults.model].filter(Boolean) as string[])))
  }, [config])

  const selectedSet = useMemo(
    () => config?.sets.find((s) => s.name === setName) ?? null,
    [config, setName]
  )

  // The arm×agent pairs the runner will skip, computed from the SAME verdicts the runner
  // uses (served in /api/kgbench/config from armIsFaithful). Not a client-side guess.
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

  // Cells = questions × (faithful arm×agent pairs) × models × reps. The skipped pairs are
  // SUBTRACTED here, unlike the monitor's denominator: at launch time the operator is deciding
  // whether to spend the money, and quoting a matrix a quarter of which will not run would be
  // quoting the wrong price.
  const cellCount = useMemo(() => {
    const q = onlyQuestions.length > 0 ? onlyQuestions.length : (selectedSet?.questionCount ?? 0)
    const pairs = pickedArms.length * pickedAgents.length - skipped.length
    const m = Math.max(1, pickedModels.length)
    const r = Number(reps)
    if (!q || pairs <= 0 || !Number.isFinite(r) || r < 1) return null
    return q * pairs * m * r
  }, [onlyQuestions, selectedSet, pickedArms, pickedAgents, skipped, pickedModels, reps])

  const estTokens = cellCount == null ? null : cellCount * EST_TOKENS_PER_CELL

  const unverifiedPicked = pickedModels.filter((m) => !verifiedNames.has(m))
  const runIdInvalid = runId.trim() !== '' && !/^[A-Za-z0-9._-]{1,48}$/.test(runId.trim())

  const blocked =
    runId.trim() === '' ||
    runIdInvalid ||
    !setName ||
    pickedArms.length === 0 ||
    pickedAgents.length === 0 ||
    cellCount == null ||
    cellCount <= 0 ||
    (unverifiedPicked.length > 0 && !allowUnverifiedModels)

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  const onLaunch = async (resume = false) => {
    if (blocked && !resume) return
    await dispatch(launchKgbench({
      run_id: runId.trim(),
      set: setName,
      reps: Number(reps),
      arms: pickedArms,
      agents: pickedAgents,
      models: pickedModels,
      only: onlyQuestions,
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

  return (
    <Card data-testid="kgbench-launcher" className="scroll-mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Launch benchmark</CardTitle>
        <CardDescription>
          kgbench — one question, answered by one arm on one agent at one model, graded against a stored key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {configLoading && !config && <p className="text-sm text-muted-foreground">Loading arms and question sets…</p>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <RunIdField value={runId} onChange={setRunId} invalid={runIdInvalid} />

            <div className="space-y-1">
              <label className="text-sm text-muted-foreground" htmlFor="kgb-set">Question set</label>
              <select
                id="kgb-set"
                data-testid="kgb-set"
                aria-label="question set"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={setName}
                onChange={(e) => { setSetName(e.target.value); setOnlyQuestions([]) }}
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
              <label className="text-sm text-muted-foreground" htmlFor="kgb-reps">Reps per cell</label>
              <Input
                id="kgb-reps"
                data-testid="kgb-reps"
                type="number"
                min={1}
                max={100}
                value={reps}
                onChange={(e) => setReps(e.target.value)}
              />
            </div>
          </div>

          {/* Arms */}
          <div className="space-y-1">
            <p className="text-sm font-medium">Arms</p>
            <div className="flex flex-wrap items-center gap-3" data-testid="kgb-arms">
              {(config?.arms ?? []).map((arm) => (
                <label
                  key={arm.id}
                  className={`flex items-center gap-1 text-sm ${arm.enabled && arm.resolved ? '' : 'text-muted-foreground'}`}
                  title={arm.resolved ? (arm.allowedTools?.join(', ') ?? '') : 'this arm could not be resolved — check config/code-graph.json'}
                >
                  <Checkbox
                    checked={pickedArms.includes(arm.id)}
                    disabled={!arm.enabled || !arm.resolved}
                    onCheckedChange={() => toggle(pickedArms, setPickedArms, arm.id)}
                  />
                  {arm.label}
                  {!arm.enabled && <Badge variant="outline">disabled</Badge>}
                  {arm.enabled && !arm.resolved && <Badge variant="destructive">unresolved</Badge>}
                </label>
              ))}
            </div>
          </div>

          {/* Agents */}
          <div className="space-y-1">
            <p className="text-sm font-medium">Agents</p>
            <div className="flex flex-wrap items-center gap-3" data-testid="kgb-agents">
              {(config?.agents ?? []).map((agent) => (
                <label key={agent} className="flex items-center gap-1 text-sm">
                  <Checkbox
                    checked={pickedAgents.includes(agent)}
                    onCheckedChange={() => toggle(pickedAgents, setPickedAgents, agent)}
                  />
                  {agent}
                </label>
              ))}
            </div>
          </div>

          {/* Models — verified-first, with the probe as an explicit action. */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium">Models</p>
              <span className="text-xs text-muted-foreground">
                {models?.probedAt
                  ? `probed ${new Date(models.probedAt).toLocaleString()}`
                  : 'never probed — nothing is verified'}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={probePending}
                onClick={() => dispatch(probeKgbenchModels())}
                data-testid="kgb-probe-models"
              >
                {probePending ? 'Probing… (minutes)' : 'Re-probe models'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3" data-testid="kgb-models">
              {[...new Set([...CANDIDATE_MODELS, ...pickedModels, ...(models?.verified ?? []).map((m) => m.requested)])].map((name) => {
                const v = models?.verified.find((m) => m.requested === name)
                const rejected = models?.rejected.find((m) => m.requested === name)
                return (
                  <label key={name} className="flex items-center gap-1 text-sm" title={rejected?.error ?? v?.served ?? 'not probed'}>
                    <Checkbox
                      checked={pickedModels.includes(name)}
                      onCheckedChange={() => toggle(pickedModels, setPickedModels, name)}
                    />
                    <span className={v ? '' : 'text-muted-foreground'}>{name}</span>
                    {v
                      ? (v.exact
                        ? <Badge variant="default">verified</Badge>
                        : <Badge variant="secondary">serves {v.served}</Badge>)
                      : rejected
                        ? <Badge variant="destructive">rejected</Badge>
                        : <Badge variant="outline">unverified</Badge>}
                  </label>
                )
              })}
            </div>
            {probeError && <p className="text-xs text-destructive" role="alert">{probeError}</p>}
            {unverifiedPicked.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1">
                <Checkbox
                  id="kgb-allow-unverified"
                  checked={allowUnverifiedModels}
                  onCheckedChange={(c) => setAllowUnverifiedModels(c === true)}
                  data-testid="kgb-allow-unverified"
                />
                <label htmlFor="kgb-allow-unverified" className="cursor-pointer text-xs">
                  {unverifiedPicked.join(', ')} {unverifiedPicked.length === 1 ? 'has' : 'have'} not been
                  observed being served. The catalog is not evidence — it advertises models providers
                  reject. Launch anyway.
                </label>
              </div>
            )}
          </div>

          {/* Question subset */}
          {selectedSet?.ids?.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Questions <span className="font-normal text-muted-foreground">(none picked = all {selectedSet.questionCount})</span>
              </p>
              <div className="flex flex-wrap items-center gap-2" data-testid="kgb-questions">
                {selectedSet.ids.map((id) => (
                  <label key={id} className="flex items-center gap-1 text-sm">
                    <Checkbox
                      checked={onlyQuestions.includes(id)}
                      onCheckedChange={() => toggle(onlyQuestions, setOnlyQuestions, id)}
                    />
                    <span className="font-mono text-xs">{id}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Skipped pairs — shown BEFORE launch, with the harness's own reason. */}
          {skipped.length > 0 && (
            <Alert data-testid="kgb-skipped">
              <AlertDescription>
                <p className="mb-1 text-sm font-medium">
                  {skipped.length} arm × agent {skipped.length === 1 ? 'combination' : 'combinations'} will be skipped
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

          {/* Matrix preview */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-sm" data-testid="kgb-preview">
            <span>
              <span className="font-semibold" data-testid="kgb-cell-count">{cellCount ?? '—'}</span> cells
            </span>
            <span className="text-muted-foreground">
              {onlyQuestions.length || selectedSet?.questionCount || '—'} questions ×{' '}
              {Math.max(0, pickedArms.length * pickedAgents.length - skipped.length)} arm×agent ×{' '}
              {Math.max(1, pickedModels.length)} model{pickedModels.length === 1 ? '' : 's'} × {reps} rep{reps === '1' ? '' : 's'}
            </span>
            {estTokens != null && (
              <span className="text-muted-foreground">est. {(estTokens / 1_000_000).toFixed(1)}M tokens</span>
            )}
          </div>

          {cellCount != null && cellCount > LARGE_MATRIX_CELLS && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs" data-testid="kgb-large-matrix">
              This is a large matrix — cells run one at a time, so expect hours of wall-clock and real spend.
              The supervisor is resumable: a signal death keeps completed cells and continues.
            </p>
          )}

          {/* A refused launch, with the resume offer when the id already has cells. */}
          {launchError && (
            <Alert variant={existingRun ? 'default' : 'destructive'} data-testid="kgb-launch-error">
              <AlertDescription>
                <p className="text-sm">{launchError}</p>
                <div className="mt-2 flex items-center gap-2">
                  {existingRun && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onLaunch(true)}
                      disabled={launchPending}
                      data-testid="kgb-resume"
                    >
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

          <div className="flex items-center gap-2">
            <Button
              onClick={() => onLaunch(false)}
              disabled={blocked || launchPending}
              data-testid="kgb-launch"
            >
              {launchPending ? 'Launching…' : `Launch ${cellCount ?? ''} cells`}
            </Button>
            <span className="text-xs text-muted-foreground">
              Runs detached under <span className="font-mono">kgbench-supervise.sh</span> — it survives this page,
              a container restart, and a signal death.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
