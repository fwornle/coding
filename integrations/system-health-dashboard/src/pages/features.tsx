import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Info, Loader2, RotateCcw, Terminal } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchFeatures, saveFeatures, dismissRestartNotice,
  type FeatureId, type FeatureState, type RunMode, type SettingsPatch,
} from '@/store/slices/featuresSlice'
import { Badge } from '@/components/ui/badge'
import { PROXY_BASE } from '@/lib/llm-proxy'

/**
 * Features — choose which parts of `coding` are active.
 *
 * Writes ~/.coding/features.yaml (the per-machine layer) through the health
 * coordinator, then applies the delta to running services. The repo's
 * config/features.yaml is never touched here: it is the committed team default
 * and a local preference must not clobber it.
 *
 * See docs/architecture/features.md for what each feature actually controls.
 */

const TIER_COPY: Record<FeatureState['applyTier'], { label: string; hint: string }> = {
  live: { label: 'live', hint: 'Takes effect immediately — no restart.' },
  apply: { label: 'on save', hint: 'Services are started or stopped when you save.' },
  session: { label: 'new sessions', hint: 'Agent hooks are fixed at launch, so this applies to sessions started after the change.' },
}

/** Where agents run — one line each, in the order offered. */
const RUN_COPY: Record<RunMode, { label: string; hint: string }> = {
  auto: { label: 'Automatic', hint: 'The agent box while Constraint Monitoring is on, otherwise this machine.' },
  box: { label: 'Agent box', hint: 'An isolated container, under the guard.' },
  'strict-box': { label: 'Strict box', hint: 'The agent box, and the dashboard and viewer stay hidden from it.' },
  host: { label: 'This machine', hint: 'Directly on the host, no isolation.' },
}

/**
 * Job-class labelling, read and written on the PROXY (rapid-llm-proxy
 * GET/PUT /api/job-classes/enabled → its gitignored llm-routing.machine.yaml).
 * `unsupported` = a proxy from before that endpoint; `unreachable` = no proxy.
 */
type Labelling =
  | { state: 'loading' | 'unsupported' | 'unreachable' }
  | { state: 'ok'; enabled: boolean; team: boolean; override: boolean | null }

async function readLabelling(): Promise<Labelling> {
  try {
    const r = await fetch(`${PROXY_BASE}/api/job-classes/enabled`)
    if (r.status === 404) return { state: 'unsupported' }
    if (!r.ok) return { state: 'unreachable' }
    const b = await r.json()
    return { state: 'ok', enabled: !!b.enabled, team: !!b.team, override: b.override ?? null }
  } catch {
    return { state: 'unreachable' }
  }
}

type SavePayload = { features?: Record<string, boolean>; profile?: string; settings?: SettingsPatch }

function Toggle({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform
          ${checked ? 'translate-x-[1.15rem]' : 'translate-x-[0.2rem]'}`}
      />
    </button>
  )
}

/** Job-class labelling, a sub-switch of LLM Proxy: this machine's choice over the team's. */
function LabellingRow({ labelling, draft, error, disabled, onChange }: {
  labelling: Labelling
  draft: boolean | null | undefined
  error: string | null
  disabled: boolean
  onChange: (v: boolean | null | undefined) => void
}) {
  if (labelling.state === 'loading') return null
  if (labelling.state !== 'ok') {
    return (
      <div className="text-xs text-muted-foreground mt-2" data-testid="features-labelling">
        Job-class labelling: {labelling.state === 'unsupported'
          ? 'this proxy cannot be switched per machine yet — update rapid-llm-proxy (llm-routing.machine.yaml).'
          : 'the proxy is not reachable.'}
      </div>
    )
  }
  const override = draft === undefined ? labelling.override : draft
  const value = override ?? labelling.team
  const teamWord = labelling.team ? 'on' : 'off'
  return (
    <div className="mt-2 flex items-start gap-2 text-xs" data-testid="features-labelling">
      <Toggle
        checked={value}
        disabled={disabled}
        // Back to what is saved = no change at all, so no "unsaved" badge.
        onChange={v => onChange(
          (labelling.override === null && v === labelling.team) || labelling.override === v ? undefined : v,
        )}
        label="Job-class labelling"
      />
      <div className="min-w-0">
        <span className="text-sm">Job-class labelling</span>{' '}
        <Badge variant="secondary" className="text-[10px]" title={TIER_COPY.live.hint}>{TIER_COPY.live.label}</Badge>
        {draft !== undefined && <Badge className="text-[10px] ml-1">unsaved</Badge>}
        <div className="text-muted-foreground mt-0.5">
          Label each turn with its job class (Token Usage → Classes).{' '}
          {override === null
            ? <>Follows the team setting ({teamWord}).</>
            : <>Set on this machine; the team setting is {teamWord}.{' '}
                <button type="button" className="underline hover:text-foreground" disabled={disabled}
                  onClick={() => onChange(labelling.override === null ? undefined : null)}>
                  Follow the team setting
                </button>
              </>}
        </div>
        {error && <div className="text-destructive mt-0.5">{error}</div>}
      </div>
    </div>
  )
}

export function FeaturesPage() {
  const dispatch = useAppDispatch()
  const {
    features, profile, profiles, enabled, needsDocker, warnings, snapshot, settings,
    loading, saving, error, loaded, restartNotice,
  } = useAppSelector(state => state.features)

  /** Local edits, applied on Save. Null means "no pending change for this id". */
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  /** Pending run-mode / agents change, saved with the same button. */
  const [settingsDraft, setSettingsDraft] = useState<SettingsPatch>({})
  const [labelling, setLabelling] = useState<Labelling>({ state: 'loading' })
  /** Pending labelling change: true/false = this machine's override; null = follow the team file. */
  const [labellingDraft, setLabellingDraft] = useState<boolean | null | undefined>(undefined)
  const [labellingError, setLabellingError] = useState<string | null>(null)
  useEffect(() => { readLabelling().then(setLabelling) }, [])

  /**
   * A save that would switch off `health` is held here until confirmed.
   *
   * WHY. The dashboard is SERVED by the health feature — the coordinator answers
   * /api/features and the container's health-dashboard programs serve this page.
   * Saving `proxy-only` or `minimal` therefore stops the thing you are looking
   * at, mid-request, and takes the Features editor down with it. The first time
   * that happened it read as "I clicked save and the system broke", which is
   * exactly right and entirely avoidable: the resolver already knows, we just
   * were not asking first.
   */
  const [confirm, setConfirm] = useState<{ payload: SavePayload; label: string } | null>(null)

  useEffect(() => { dispatch(fetchFeatures()) }, [dispatch])
  // A save returns the newly resolved set, so any pending edit is now redundant
  // — and keeping it would make the UI disagree with the resolver about
  // dependency-disabled features.
  useEffect(() => { if (!saving) { setDraft({}); setSettingsDraft({}) } }, [saving])

  const ids = Object.keys(features) as FeatureId[]
  const settingsDirty = Object.keys(settingsDraft).length > 0
  const labellingDirty = labellingDraft !== undefined
  const featuresDirty = Object.keys(draft).length > 0 || settingsDirty
  const dirty = featuresDirty || labellingDirty
  const valueOf = (id: FeatureId) => draft[id] ?? features[id]?.enabled ?? true

  /**
   * What WOULD be running if the current draft were saved.
   *
   * The resolver disables a dependent whose dependency is off, and that cascades
   * — `knowledge` needs `observations`, which needs `lsl`. Reading each row's
   * dependencies straight off `valueOf` only ever saw ONE level: switching `lsl`
   * off correctly greyed out Observations, while Knowledge Base sat there still
   * showing ON, and the save then switched it off anyway. A preview that
   * under-reports the cascade is worse than none, because the surprise arrives
   * after the click.
   *
   * Iterating to a fixed point rather than one pass, so the answer does not
   * depend on the order features happen to be declared in.
   */
  const effective = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const id of ids) out[id] = draft[id] ?? features[id]?.enabled ?? true
    for (let pass = 0; pass < ids.length; pass++) {
      let changed = false
      for (const id of ids) {
        if (!out[id]) continue
        if ((features[id]?.requires || []).some(dep => out[dep] === false)) {
          out[id] = false
          changed = true
        }
      }
      if (!changed) break
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, draft])

  const draftEnabled = ids.filter(id => effective[id])
  const draftNeedsDocker = draftEnabled.some(id => features[id]?.needsDocker)

  const onToggle = (id: FeatureId, value: boolean) => {
    setDraft(prev => {
      const next = { ...prev }
      if ((features[id]?.enabled ?? true) === value) delete next[id]
      else next[id] = value
      return next
    })
  }

  /** Would this change leave `health` off? */
  const disablesHealth = (payload: SavePayload) => {
    if (payload.profile) return !(profiles[payload.profile] ?? []).includes('health')
    if (payload.features && 'health' in payload.features) return payload.features.health === false
    return false
  }

  const submit = (payload: SavePayload, label: string) => {
    // Only ask when health is actually ON right now — re-confirming a change
    // that takes an already-off feature off again would be noise.
    if (disablesHealth(payload) && features.health?.enabled) {
      setConfirm({ payload, label })
      return
    }
    if (payload.profile) setDraft({})
    dispatch(saveFeatures(payload))
  }

  const onSave = async () => {
    if (labellingDirty) {
      // Its own store (the proxy's machine overlay), written first: it is live
      // and has nothing to apply, so it cannot leave the features half-saved.
      try {
        const r = await fetch(`${PROXY_BASE}/api/job-classes/enabled`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: labellingDraft }),
        })
        const b = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`)
        setLabelling({ state: 'ok', enabled: !!b.enabled, team: !!b.team, override: b.override ?? null })
        setLabellingDraft(undefined)
        setLabellingError(null)
      } catch (err) {
        setLabellingError(`Labelling not saved: ${(err as Error).message}`)
        return
      }
    }
    if (featuresDirty) {
      submit({
        ...(Object.keys(draft).length ? { features: draft } : {}),
        ...(settingsDirty ? { settings: settingsDraft } : {}),
      }, 'this change')
    }
  }

  // ── run mode and agents (draft-aware) ──
  const runValue: RunMode = settingsDraft.run ?? settings?.run.value ?? 'auto'
  const agentsValue: string[] = settingsDraft.agents === null
    ? (settings?.agents.available ?? [])
    : (settingsDraft.agents ?? settings?.agents.enabled ?? [])
  const constraintsOn = effective.constraints !== false
  /** What a launch would do with the draft: mirrors resolveRun() in lib/features/resolve.cjs. */
  const runEffective: Exclude<RunMode, 'auto'> = runValue === 'auto'
    ? (constraintsOn ? 'box' : 'host')
    : (runValue !== 'host' && !constraintsOn ? 'host' : runValue)
  const defaultAgent = agentsValue.includes('claude') ? 'claude' : (settings?.agents.available.find(a => agentsValue.includes(a)) ?? null)

  const onRun = (mode: RunMode) => setSettingsDraft(prev => {
    const next = { ...prev }
    if ((settings?.run.value ?? 'auto') === mode) delete next.run
    else next.run = mode
    return next
  })
  const onAgent = (agent: string, on: boolean) => setSettingsDraft(prev => {
    const current = prev.agents === null ? (settings?.agents.available ?? []) : (prev.agents ?? settings?.agents.enabled ?? [])
    const list = (settings?.agents.available ?? []).filter(a => (a === agent ? on : current.includes(a)))
    const next = { ...prev }
    const saved = settings?.agents.enabled ?? []
    if (list.length === saved.length && list.every(a => saved.includes(a))) delete next.agents
    // Every agent ticked = no list at all, so a newly added agent is offered too.
    else next.agents = list.length === (settings?.agents.available.length ?? 0) ? null : list
    return next
  })
  const onProfile = (name: string) => submit({ profile: name }, `the '${name}' profile`)

  const confirmProceed = () => {
    if (!confirm) return
    if (confirm.payload.profile) setDraft({})
    dispatch(saveFeatures(confirm.payload))
    setConfirm(null)
  }

  /**
   * What a toggle would knock out. Shown BEFORE saving, because the surprising
   * case — turning off `lsl` also silences observations and the knowledge base
   * — is exactly the one a user should not discover afterwards.
   */
  const dependentsOf = (id: FeatureId) =>
    ids.filter(other => features[other]?.requires?.includes(id))

  if (!loaded && loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading feature configuration…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl" data-testid="features-page">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-xl font-semibold">Features</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which parts of <code>coding</code> run. Saved to{' '}
            <code>~/.coding/features.yaml</code> on this machine.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && (
            <button
              type="button"
              onClick={() => { setDraft({}); setSettingsDraft({}); setLabellingDraft(undefined) }}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Discard
            </button>
          )}
          <button
            type="button"
            data-testid="features-save"
            disabled={!dirty || saving}
            onClick={onSave}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors
              ${dirty && !saving
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'}`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {saving ? 'Applying…' : 'Save & apply'}
          </button>
        </div>
      </div>

      {confirm && (
        <div
          data-testid="features-confirm-health"
          className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Applying {confirm.label} will switch off Health Monitoring</div>
              <p className="text-sm text-muted-foreground mt-1">
                This dashboard is served by that feature. Saving will stop the health coordinator
                and this page along with it — including this editor. It is a valid thing to want;
                it just cannot be undone from here afterwards.
              </p>
              <div className="mt-3 text-sm">
                <div className="text-muted-foreground mb-1">To get it back, run in a terminal:</div>
                <code className="flex items-center gap-2 rounded bg-background/70 border border-border px-2 py-1.5 font-mono text-xs">
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  coding-features profile full
                </code>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button
                  type="button"
                  data-testid="features-confirm-cancel"
                  onClick={() => setConfirm(null)}
                  className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="features-confirm-proceed"
                  onClick={confirmProceed}
                  className="text-sm px-3 py-1.5 rounded-md bg-amber-600 text-white hover:opacity-90"
                >
                  Switch it off anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <div>
            <div className="font-medium">Feature configuration unavailable</div>
            <div className="text-muted-foreground">{error}</div>
            <div className="text-muted-foreground mt-1">
              Everything is shown as enabled until this is resolved — the dashboard does not
              hide tabs on a failure it cannot explain.
            </div>
          </div>
        </div>
      )}

      {restartNotice && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{restartNotice}</div>
          <button type="button" onClick={() => dispatch(dismissRestartNotice())} className="text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}

      {/* Profiles */}
      <div className="mt-6">
        <div className="text-sm font-medium mb-2">Profiles</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(profiles).map(([name, on]) => (
            <button
              key={name}
              type="button"
              data-testid={`features-profile-${name}`}
              disabled={saving}
              onClick={() => onProfile(name)}
              title={on.length ? on.join(', ') : 'nothing enabled'}
              className={`text-sm px-3 py-1.5 rounded-md border transition-colors
                ${profile === name
                  ? 'border-primary text-foreground bg-primary/10'
                  : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Choosing a profile is a reset — it clears any individual overrides below.
        </p>
      </div>

      {/* Agents: where they run, which are offered */}
      {settings && (
        <div className="mt-6 rounded-md border border-border divide-y divide-border" data-testid="features-agents">
          <div className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Run agents in</span>
              <Badge variant="secondary" className="text-[10px]" title={TIER_COPY.session.hint}>
                {TIER_COPY.session.label}
              </Badge>
              {settingsDraft.run !== undefined && <Badge className="text-[10px]">unsaved</Badge>}
            </div>
            <div className="flex flex-wrap gap-2 mt-2" role="radiogroup" aria-label="Run agents in">
              {(settings.run.choices ?? (Object.keys(RUN_COPY) as RunMode[])).map(mode => {
                const needsGuard = mode === 'box' || mode === 'strict-box'
                const blocked = needsGuard && !constraintsOn
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={runValue === mode}
                    data-testid={`features-run-${mode}`}
                    disabled={saving || blocked}
                    onClick={() => onRun(mode)}
                    title={blocked ? 'Needs Constraint Monitoring — the box runs under its guard.' : RUN_COPY[mode].hint}
                    className={`text-sm px-3 py-1.5 rounded-md border transition-colors
                      ${runValue === mode
                        ? 'border-primary text-foreground bg-primary/10'
                        : 'border-border text-muted-foreground hover:text-foreground'}
                      ${blocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {RUN_COPY[mode].label}
                  </button>
                )
              })}
            </div>
            <div className="text-xs text-muted-foreground mt-2" data-testid="features-run-effective">
              {RUN_COPY[runValue].hint}{' '}
              {runValue === 'auto' || runEffective !== runValue
                ? <>Now: <span className="text-foreground">{RUN_COPY[runEffective].label.toLowerCase()}</span>.</>
                : null}
              {!constraintsOn && runValue !== 'host' && (
                <span className="text-amber-600 dark:text-amber-500"> Constraint Monitoring is off, so agents run on this machine.</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Only {settings.run.boxAgents.join(', ')} can run in the box. <code>--box</code>, <code>--strict-box</code> and{' '}
              <code>--no-box</code> still override this for one launch.
            </div>
          </div>

          <div className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Offered agents</span>
              <Badge variant="secondary" className="text-[10px]" title={TIER_COPY.session.hint}>
                {TIER_COPY.session.label}
              </Badge>
              {settingsDraft.agents !== undefined && <Badge className="text-[10px]">unsaved</Badge>}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {settings.agents.available.map(agent => {
                const on = agentsValue.includes(agent)
                const last = on && agentsValue.length === 1
                return (
                  <label
                    key={agent}
                    data-testid={`features-agent-${agent}`}
                    className={`flex items-center gap-2 text-sm ${last ? 'opacity-60' : 'cursor-pointer'}`}
                    title={last ? 'At least one agent must stay enabled.' : undefined}
                  >
                    <Toggle
                      checked={on}
                      disabled={saving || last}
                      onChange={v => onAgent(agent, v)}
                      label={agent}
                    />
                    <span className={on ? '' : 'text-muted-foreground'}>{agent}</span>
                  </label>
                )
              })}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Plain <code>coding</code> launches <span className="text-foreground">{defaultAgent ?? '—'}</span>; an agent switched
              off here is refused by the launcher.
            </div>
          </div>
        </div>
      )}

      {/* Feature list */}
      <div className="mt-6 rounded-md border border-border divide-y divide-border">
        {ids.map(id => {
          const f = features[id]
          const value = valueOf(id)
          const changed = draft[id] !== undefined
          // A feature whose dependency is off cannot be turned on from here;
          // the resolver would immediately switch it back off, and a toggle
          // that silently undoes itself is worse than one that will not move.
          // Against `effective`, not `valueOf`: a dependency that is itself only
          // off BECAUSE of its own dependency still blocks this one.
          const blockedBy = (f.requires || []).filter(dep => effective[dep] === false)
          const dependents = dependentsOf(id)

          return (
            <div
              key={id}
              data-testid={`feature-row-${id}`}
              className={`flex items-start gap-3 p-3 ${value ? '' : 'bg-muted/20'}`}
            >
              <div className="pt-0.5">
                <Toggle
                  checked={value && blockedBy.length === 0}
                  disabled={saving || blockedBy.length > 0}
                  onChange={v => onToggle(id, v)}
                  label={f.label}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${value ? '' : 'text-muted-foreground'}`}>
                    {f.label}
                  </span>
                  <code className="text-xs text-muted-foreground">{id}</code>
                  <Badge variant="secondary" className="text-[10px]" title={TIER_COPY[f.applyTier].hint}>
                    {TIER_COPY[f.applyTier].label}
                  </Badge>
                  {f.needsDocker && (
                    <Badge variant="outline" className="text-[10px]" title="Runs in the coding-services container">
                      docker
                    </Badge>
                  )}
                  {changed && <Badge className="text-[10px]">unsaved</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{f.description}</div>

                {blockedBy.length > 0 && (
                  <div className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                    Needs {blockedBy.map(d => features[d]?.label ?? d).join(', ')} — switch that on first.
                  </div>
                )}
                {value && dependents.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Turning this off also switches off {dependents.map(d => features[d]?.label ?? d).join(', ')}.
                  </div>
                )}
                {!value && f.source === 'dependency' && (
                  <div className="text-xs text-muted-foreground mt-1">{f.reason}</div>
                )}
                {!value && f.source === 'env' && (
                  <div className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                    Forced off by an environment variable — this toggle cannot override it.
                  </div>
                )}
                {id === 'llm-proxy' && value && (
                  <LabellingRow
                    labelling={labelling}
                    draft={labellingDraft}
                    error={labellingError}
                    disabled={saving}
                    onChange={setLabellingDraft}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer facts */}
      <div className="mt-4 text-xs text-muted-foreground space-y-1">
        <div>
          {/*
            Counted from the DRAFT, not from the server's saved answer. With an
            unsaved edit on screen the two disagree, and the footer used to read
            "9 of 9 enabled" above two visibly greyed-out rows — the one line
            whose whole job is to summarise what you are looking at.
            `enabled`/`needsDocker` from the store are the saved figures and are
            what this falls back to once the draft is empty.
          */}
          {dirty ? draftEnabled.length : enabled.length} of {ids.length} enabled
          {dirty ? ' if saved' : null}
          {profile && !dirty ? <> · profile <code>{profile}</code></> : null}
          {' '}· Docker {(dirty ? draftNeedsDocker : needsDocker) ? 'required' : 'not needed'}
        </div>
        {snapshot && snapshot.state !== 'fresh' && snapshot.state !== 'unknown' && (
          <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              {snapshot.state === 'missing' ? (
                <>No feature snapshot on disk — the container falls back to all-on until one exists.</>
              ) : (
                <>
                  The container is acting on a snapshot from{' '}
                  <code>{snapshot.generatedAt}</code>, which still has{' '}
                  {snapshot.differences.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 ? ', ' : null}
                      <code>{d.id}</code> {d.snapshot === null ? 'absent' : d.snapshot ? 'on' : 'off'}
                    </span>
                  ))}
                  .
                </>
              )}
              {snapshot.remedy ? <> To fix: {snapshot.remedy}.</> : null}
            </span>
          </div>
        )}
        {warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" /> <span>{w}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
