import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchSpecList,
  launchExperiment,
  previewForkCount,
  clearLauncherPrefill,
  clearLaunchError,
  selectSpecList,
  selectSpecListLoading,
  selectLaunchError,
  selectLaunchPending,
  selectLauncherPrefill,
  type SpecSummary,
  type ExperimentOverrides,
  type VariantOverride,
  type ForkAxes,
} from '@/store/slices/performanceSlice'

// AVN-03 (D-03) — the four fork axes rendered as curated-by-default groups. The
// agent literals match the runner's KNOWN_AGENTS (mastra is surfaced as the
// `mastracode` literal Plan 87-02 added). SDD-framework options are the
// spec-driven-development harnesses (disambiguated from a code framework). The
// knowledge-injection dimension is a prominent on/off toggle encoded server-side
// into the existing `env` axis as kb-on/kb-off (Plan 87-02) — NOT a 5th cell key.
const FORK_AGENTS = ['claude', 'copilot', 'opencode', 'mastracode'] as const
const FORK_MODELS = ['opus', 'sonnet', 'gpt-5', 'haiku'] as const
const FORK_FRAMEWORKS = ['gsd', 'spec-workflow', 'none'] as const

// D-02 guardrail threshold: above this many avenues a sweep gets the amber
// "review before confirming" caution line. Kept conservative — a sequential
// runner (one avenue at a time) makes a large matrix cost-bearing.
const SWEEP_CAUTION_THRESHOLD = 8

// Rough per-avenue token/cost estimate for the pre-launch preview. This is a
// PLANNING hint only (labelled "Est."); the authoritative count is the SERVER
// cellCount (D-09) and real spend is measured post-run. A single avenue restores
// a full snapshot + runs one agent turn-loop — order ~120k tokens is a sane
// order-of-magnitude anchor for the operator's go/no-go, never billed.
const EST_TOKENS_PER_AVENUE = 120_000
const EST_USD_PER_1K_TOKENS = 0.003

// Experiment launcher (D-09/D-11/D-12) — the operator-facing CONTROL surface. It
// lists specs, previews the server-resolved matrix (variantCount × repeats = N
// cells — D-09, NOT a client-side axes recompute), offers override fields
// (repeats, timeout, variant subset, per-variant model/agent, capture_raw_bodies),
// surfaces a 409 holder (never a silent failure), and pre-fills from a re-run
// (D-11). It is a launcher, NEVER a spec editor — no free-form authoring surface
// exists here (D-09: launches, never edits).

// Parse a comma/space-separated variant subset into a clean string[] (only the
// variants that are members of the resolved spec are forwarded; the server
// re-validates in Plan 04 _validateOverrides).
function parseVariantSubset(picked: string[]): string[] | undefined {
  const clean = picked.filter((v) => v.trim() !== '')
  return clean.length ? clean : undefined
}

export function ExperimentLauncher() {
  const dispatch = useAppDispatch()
  const specs = useAppSelector(selectSpecList)
  const specsLoading = useAppSelector(selectSpecListLoading)
  const launchError = useAppSelector(selectLaunchError)
  const launchPending = useAppSelector(selectLaunchPending)
  const prefill = useAppSelector(selectLauncherPrefill)

  const [specFile, setSpecFile] = useState('')
  const [rerunOf, setRerunOf] = useState<string | null>(null)
  const [repeats, setRepeats] = useState('')
  const [timeout, setTimeoutVal] = useState('')
  // Selected variant SUBSET (multi-pick). Empty = run all variants.
  const [variantSubset, setVariantSubset] = useState<string[]>([])
  // Per-variant model/agent overrides, keyed by the ORIGINAL variant name (D-06).
  const [variantOverrides, setVariantOverrides] = useState<Record<string, VariantOverride>>({})
  const [captureRawBodies, setCaptureRawBodies] = useState(false)
  // 85-06 DEFECT B: a transient highlight + confirmation shown when a Re-run pre-fills the
  // launcher, so the operator sees the click landed (the runs-table Re-run button also scrolls
  // this card into view). Cleared after a few seconds so it doesn't linger.
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null)

  // AVN-03 (D-03) fork state — populated ONLY when "Fork into avenues" pre-fills
  // the launcher (origin_span_id present). It drives the four-axis picker + the
  // sweep guardrail. In fork mode the launch threads origin_span_id so avenue
  // Runs group by origin (Plan 87-03).
  const [originSpanId, setOriginSpanId] = useState<string | null>(null)
  const [forkAxes, setForkAxes] = useState<ForkAxes>({})
  const [sweep, setSweep] = useState(false)
  const isForkMode = originSpanId !== null

  // Phase 87-07 (CR-02/CR-03): the SERVER-resolved axes-aware fork cell count. In fork mode
  // this REPLACES the origin spec's static YAML metadata as the preview source — the server
  // synthesizes+counts the avenue matrix from the CHOSEN forkAxes (D-09 authoritative). Null
  // until the server round-trip resolves → the launch button stays disabled (D-02).
  const [forkPreviewCount, setForkPreviewCount] = useState<number | null>(null)

  // Fetch the spec list once on mount.
  useEffect(() => {
    dispatch(fetchSpecList())
  }, [dispatch])

  // D-11: consume a re-run pre-fill (set by the runs-table Re-run button). Populate
  // the spec select + rerun_of + override fields, including any seeded per-variant
  // variantOverrides, then clear it so re-mounting the launcher doesn't re-apply.
  useEffect(() => {
    if (!prefill) return
    setSpecFile(prefill.spec)
    setRerunOf(prefill.rerun_of ?? null)
    const o = prefill.overrides ?? {}
    setRepeats(o.repeats != null ? String(o.repeats) : '')
    setTimeoutVal(o.timeout != null ? String(o.timeout) : '')
    setVariantSubset(Array.isArray(o.variants) ? o.variants : [])
    setVariantOverrides(o.variantOverrides ?? {})
    setCaptureRawBodies(o.capture_raw_bodies === true)
    // AVN-03: consume the D-03 fork fields (present only for a Fork pre-fill). A
    // plain Re-run leaves origin_span_id null → the axis picker stays hidden.
    setOriginSpanId(prefill.origin_span_id ?? null)
    setForkAxes(prefill.axes ?? {})
    setSweep(prefill.sweep === true)
    // DEFECT B: flag the pre-fill source so a confirmation banner + highlight ring render.
    setPrefilledFrom(prefill.origin_span_id ?? prefill.rerun_of ?? prefill.spec ?? 'a completed run')
    dispatch(clearLauncherPrefill())
  }, [prefill, dispatch])

  // DEFECT B: auto-clear the pre-fill highlight a few seconds after it appears so the ring +
  // confirmation banner are a transient affordance, not permanent chrome.
  useEffect(() => {
    if (!prefilledFrom) return
    const t = setTimeout(() => setPrefilledFrom(null), 6000)
    return () => clearTimeout(t)
  }, [prefilledFrom])

  // Phase 87-07 (CR-02/CR-03): dispatch the SERVER fork-preview whenever the chosen
  // forkAxes / sweep / repeats change in fork mode, so previewCellCount stays axes-aware
  // and honest (D-09 server-authoritative — never a client cross-product). Reset the count
  // to null on each change so the launch button disables until the fresh count resolves.
  useEffect(() => {
    if (!isForkMode || !originSpanId) {
      setForkPreviewCount(null)
      return
    }
    setForkPreviewCount(null)
    let cancelled = false
    const reps = repeats.trim() !== '' && Number.isFinite(Number(repeats)) ? Number(repeats) : undefined
    dispatch(previewForkCount({ origin_span_id: originSpanId, forkAxes, sweep, repeats: reps }))
      .then((action) => {
        if (cancelled) return
        if (previewForkCount.fulfilled.match(action)) {
          setForkPreviewCount(action.payload.cellCount)
        }
      })
    return () => { cancelled = true }
  }, [dispatch, isForkMode, originSpanId, forkAxes, sweep, repeats])

  const selectedSpec: SpecSummary | undefined = useMemo(
    () => specs.find((s) => s.file === specFile),
    [specs, specFile]
  )

  // The server-resolved variant names for the currently-selected spec (drives the
  // subset picker + the per-variant override rows). Empty when the spec is
  // malformed (listed with `error`) or omits variants.
  const variantNames: string[] = useMemo(
    () => (selectedSpec?.variants ?? []).filter((v) => typeof v === 'string'),
    [selectedSpec]
  )

  // D-09 matrix preview — read the SERVER-computed cellCount.
  //
  // Phase 87-07 (CR-02/CR-03): in FORK mode the count MUST come from the server
  // fork-preview round-trip (forkPreviewCount), which synthesizes+counts the avenue
  // matrix from the CHOSEN forkAxes — NOT the origin spec's static YAML metadata
  // (selectedSpec.variantCount, the wrong source per CR-02). Null until the server
  // preview resolves → the launch stays disabled (D-02). Only the NON-fork (plain
  // rerun/launch) branch reads selectedSpec — that path is unchanged.
  const previewCellCount: number | null = useMemo(() => {
    if (isForkMode) return forkPreviewCount
    if (!selectedSpec) return null
    const baseVariants = selectedSpec.variantCount ?? selectedSpec.variants?.length ?? null
    if (baseVariants == null) return selectedSpec.cellCount ?? null
    const subsetCount = variantSubset.length > 0 ? variantSubset.length : baseVariants
    const overriddenRepeats = repeats.trim() !== '' ? Number(repeats) : (selectedSpec.repeats ?? null)
    if (overriddenRepeats == null || !Number.isFinite(overriddenRepeats)) return selectedSpec.cellCount ?? null
    return subsetCount * overriddenRepeats
  }, [isForkMode, forkPreviewCount, selectedSpec, variantSubset, repeats])

  // AVN-03 (D-09) — the avenue count shown in the guardrail and reflected in the
  // "Launch {N} avenues" CTA is the SERVER-resolved previewCellCount. We do NOT
  // multiply the picked axes client-side to produce the launch-gating number
  // (T-87-05-03 — the server cellCount is authoritative; a client cross-product
  // could spoof it). The axis selections shape WHAT is forked; the SERVER resolves
  // HOW MANY cells that becomes. Null until the preview has resolved → launch stays
  // disabled (D-02: launch disabled until the preview has rendered).
  const avenueCount: number | null = previewCellCount

  // Est. token / cost preview (D-02) — a labelled PLANNING hint derived from the
  // SERVER count, never billed. Absent until the count resolves.
  const estTokens: number | null = avenueCount == null ? null : avenueCount * EST_TOKENS_PER_AVENUE
  const estCostUsd: number | null = estTokens == null ? null : (estTokens / 1000) * EST_USD_PER_1K_TOKENS
  const overThreshold = avenueCount != null && avenueCount > SWEEP_CAUTION_THRESHOLD

  // Toggle a value in one of the multi-select fork axes (agents/models/frameworks).
  const toggleAxisMember = (axis: 'agents' | 'models' | 'frameworks', value: string) => {
    setForkAxes((prev) => {
      const current = prev[axis] ?? []
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      return { ...prev, [axis]: next }
    })
  }

  const setVariantOverrideField = (variant: string, field: keyof VariantOverride, value: string) => {
    setVariantOverrides((prev) => {
      const next = { ...prev }
      const entry: VariantOverride = { ...(next[variant] ?? {}) }
      if (value.trim() === '') {
        delete entry[field]
      } else {
        entry[field] = value.trim()
      }
      if (!entry.model && !entry.agent) {
        delete next[variant]
      } else {
        next[variant] = entry
      }
      return next
    })
  }

  const toggleVariantSubset = (variant: string) => {
    setVariantSubset((prev) =>
      prev.includes(variant) ? prev.filter((v) => v !== variant) : [...prev, variant]
    )
  }

  const buildOverrides = (): ExperimentOverrides => {
    const o: ExperimentOverrides = {}
    if (repeats.trim() !== '' && Number.isFinite(Number(repeats))) o.repeats = Number(repeats)
    // CR-03 (Phase 85 REVIEW): the runner CLI contract is SECONDS (scripts/experiment-run.mjs
    // multiplies by 1000). The field is now labelled "timeout seconds (override)" and forwarded
    // verbatim — label and backend unit agree, no client-side conversion.
    if (timeout.trim() !== '' && Number.isFinite(Number(timeout))) o.timeout = Number(timeout)
    const subset = parseVariantSubset(variantSubset)
    if (subset) o.variants = subset
    if (captureRawBodies) o.capture_raw_bodies = true
    if (Object.keys(variantOverrides).length > 0) o.variantOverrides = variantOverrides
    return o
  }

  const onLaunch = async () => {
    if (!specFile) return
    // D-02: in fork mode the launch is gated on the SERVER preview having rendered
    // (avenueCount resolved). Guard here too so a keyboard-driven launch can't beat
    // the disabled button.
    if (isForkMode && avenueCount == null) return
    const result = await dispatch(
      // AVN-02: the fork is a THIN wrapper — same launchExperiment thunk, plus the
      // origin_span_id link so the avenue Runs group by origin (Plan 87-03). A
      // plain Re-run passes origin_span_id undefined (null-preserved server-side).
      launchExperiment({
        spec: specFile,
        overrides: buildOverrides(),
        rerun_of: rerunOf,
        origin_span_id: originSpanId,
        // Phase 87-07 (CR-02): in fork mode carry the CHOSEN axes + sweep so the server
        // synthesizes the AVENUE matrix (not the origin spec's static matrix). The picker
        // is no longer decorative — these fields now actually reach the server.
        ...(isForkMode ? { forkAxes, sweep } : {}),
      })
    )
    if (launchExperiment.fulfilled.match(result)) {
      // Reset the transient overrides after a successful launch; keep the spec
      // selected so a quick re-launch is easy.
      setRerunOf(null)
      setRepeats('')
      setTimeoutVal('')
      setVariantSubset([])
      setVariantOverrides({})
      setCaptureRawBodies(false)
      // Reset the fork axis picker back to non-fork mode on success.
      setOriginSpanId(null)
      setForkAxes({})
      setSweep(false)
      setForkPreviewCount(null)
    }
  }

  return (
    <Card
      id="experiment-launcher"
      data-testid="experiment-launcher"
      // DEFECT B: a transient highlight ring when pre-filled from a Re-run, so scrolling this
      // card into view is unmistakably tied to the click (the ring fades when prefilledFrom clears).
      className={
        prefilledFrom
          ? 'scroll-mt-4 ring-2 ring-primary transition-shadow'
          : 'scroll-mt-4 transition-shadow'
      }
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {isForkMode ? 'Fork span into avenues' : 'Launch experiment'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {prefilledFrom && (
            <p
              className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-sm text-foreground"
              role="status"
              data-testid="rerun-prefill-confirmation"
            >
              Launcher pre-filled from <span className="font-mono">{prefilledFrom}</span> — review the
              spec + overrides below, then Launch.
            </p>
          )}
          {rerunOf && (
            <p className="text-sm text-muted-foreground" data-testid="rerun-banner">
              Re-running <span className="font-mono">{rerunOf}</span> — same spec + snapshot, comparable task_hash.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="spec-select">Spec:</label>
            <select
              id="spec-select"
              aria-label="experiment spec"
              data-testid="spec-select"
              className="h-9 min-w-[20rem] rounded-md border bg-background px-2 text-sm"
              value={specFile}
              onChange={(e) => setSpecFile(e.target.value)}
            >
              <option value="">{specsLoading ? 'Loading specs…' : 'Choose a spec…'}</option>
              {specs.map((s) => (
                <option key={s.file} value={s.file} disabled={!!s.error}>
                  {s.file}{s.error ? ' (malformed)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* AVN-03 (D-03): the four-axis variant picker — rendered ONLY in fork
              mode (origin_span_id present). Curated-by-default: each picked
              combination is one avenue. A Sweep toggle expands the chosen axes
              into their cross-product. Reuses the existing Checkbox primitive +
              token classes only. */}
          {isForkMode && (
            <div className="space-y-3" data-testid="fork-axes">
              {/* Agent axis */}
              <div className="space-y-1">
                <p className="text-sm font-medium">Agent</p>
                <div className="flex flex-wrap items-center gap-3">
                  {FORK_AGENTS.map((agent) => (
                    <label key={agent} className="flex items-center gap-1 text-sm">
                      <Checkbox
                        checked={(forkAxes.agents ?? []).includes(agent)}
                        onCheckedChange={() => toggleAxisMember('agents', agent)}
                        id={`fork-agent-${agent}`}
                      />
                      <span className="font-mono">{agent}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Model axis */}
              <div className="space-y-1">
                <p className="text-sm font-medium">Model</p>
                <div className="flex flex-wrap items-center gap-3">
                  {FORK_MODELS.map((model) => (
                    <label key={model} className="flex items-center gap-1 text-sm">
                      <Checkbox
                        checked={(forkAxes.models ?? []).includes(model)}
                        onCheckedChange={() => toggleAxisMember('models', model)}
                        id={`fork-model-${model}`}
                      />
                      <span className="font-mono">{model}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* SDD framework axis — DISAMBIGUATED (mandatory caption). */}
              <div className="space-y-1">
                <p className="text-sm font-medium">SDD framework</p>
                <p className="text-xs text-muted-foreground">
                  The spec-driven-development harness (gsd / spec-workflow / none) — not a code framework.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {FORK_FRAMEWORKS.map((fw) => (
                    <label key={fw} className="flex items-center gap-1 text-sm">
                      <Checkbox
                        checked={(forkAxes.frameworks ?? []).includes(fw)}
                        onCheckedChange={() => toggleAxisMember('frameworks', fw)}
                        id={`fork-framework-${fw}`}
                      />
                      <span className="font-mono">{fw}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Knowledge injection — PROMINENT first-class on/off toggle. Encodes
                  to the runner's env axis kb-on/kb-off (Plan 87-02). Both on → the
                  injection axis is A/B'd (on vs off). */}
              <div className="space-y-1" data-testid="fork-knowledge-injection">
                <p className="text-sm font-medium">Knowledge injection</p>
                <p className="text-xs text-muted-foreground">
                  Inject observations, digests, insights &amp; VKB context (the working-memory prefix) into the agent. A/B this on vs off.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    <Checkbox
                      checked={forkAxes.kbOn === true}
                      onCheckedChange={(v) => setForkAxes((prev) => ({ ...prev, kbOn: v === true }))}
                      id="fork-kb-on"
                    />
                    <span>on (kb-on)</span>
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <Checkbox
                      checked={forkAxes.kbOff === true}
                      onCheckedChange={(v) => setForkAxes((prev) => ({ ...prev, kbOff: v === true }))}
                      id="fork-kb-off"
                    />
                    <span>off (kb-off)</span>
                  </label>
                </div>
              </div>

              {/* Sweep toggle — expands the chosen axes into their cross-product. */}
              <div className="space-y-1" data-testid="fork-sweep">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={sweep}
                    onCheckedChange={(v) => setSweep(v === true)}
                    id="fork-sweep-toggle"
                  />
                  <span>Sweep (cross-product of chosen axes)</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Expands the selected dimensions into every combination.
                </p>
              </div>
            </div>
          )}

          {/* D-09: server-resolved matrix preview shown BEFORE launch. */}
          {selectedSpec && (
            <div className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="matrix-preview">
              {selectedSpec.error ? (
                <span className="text-destructive" role="alert">Spec is malformed: {selectedSpec.error}</span>
              ) : (
                <>
                  {selectedSpec.goal_sentence && (
                    <div className="mb-1"><span className="text-muted-foreground">goal:</span> {selectedSpec.goal_sentence}</div>
                  )}
                  <div>
                    {/* Self-consistent with the selected SUBSET: "1 of 3 variants × 1
                        repeat = 1 cell" when a subset is picked; the plain full-matrix
                        product otherwise. The base variant count stays the SERVER's
                        variantCount (D-09 — never a client-side axes recompute). */}
                    {(() => {
                      const baseVariants = selectedSpec.variantCount ?? variantNames.length
                      const pickedVariants = variantSubset.length > 0 ? variantSubset.length : baseVariants
                      const effRepeatsRaw = repeats.trim() !== '' ? Number(repeats) : (selectedSpec.repeats ?? null)
                      const effRepeats = effRepeatsRaw != null && Number.isFinite(effRepeatsRaw) ? effRepeatsRaw : null
                      const plural = (n: number | null, word: string) => (n === 1 ? word : `${word}s`)
                      return (
                        <>
                          <span className="font-mono">
                            {variantSubset.length > 0 ? `${pickedVariants} of ${baseVariants}` : pickedVariants}
                          </span>{' '}
                          {/* "1 of 3 variants" — the noun follows the BASE count in
                              the subset phrasing, the picked count otherwise. */}
                          {plural(variantSubset.length > 0 ? baseVariants : pickedVariants, 'variant')} ×{' '}
                          <span className="font-mono">{effRepeats ?? '?'}</span> {plural(effRepeats, 'repeat')} ={' '}
                          <span className="font-mono font-semibold" data-testid="matrix-cell-count">{previewCellCount ?? '?'}</span>{' '}
                          {plural(previewCellCount, 'cell')}
                        </>
                      )
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {/* AVN-03 (D-02) MANDATORY sweep guardrail — the primary focal point of
              the fork surface. Reuses the matrix-preview bg-muted/40 box. The count
              is the SERVER-resolved avenueCount (= previewCellCount, D-09 — never a
              client axes recompute); until it resolves the launch stays disabled.
              Over-threshold shows the amber caution line. */}
          {isForkMode && (
            <div
              className="rounded-md border bg-muted/40 p-2 text-sm"
              data-testid="sweep-guardrail"
            >
              {(() => {
                const plural = (n: number | null, word: string) => (n === 1 ? word : `${word}s`)
                // V (variants) × R (repeats) framing kept for continuity with the
                // spec matrix-preview copy; both figures are SERVER-resolved via the
                // selected spec (or shown as ? until the preview resolves).
                const v = selectedSpec?.variantCount ?? selectedSpec?.variants?.length ?? null
                const r = repeats.trim() !== '' ? Number(repeats) : (selectedSpec?.repeats ?? null)
                const rNum = r != null && Number.isFinite(r) ? r : null
                return (
                  <>
                    <div>
                      <span className="font-mono">{v ?? '?'}</span> {plural(v, 'variant')} ×{' '}
                      <span className="font-mono">{rNum ?? '?'}</span> {plural(rNum, 'repeat')} ={' '}
                      <span className="font-mono font-semibold" data-testid="avenue-count">
                        {avenueCount ?? '?'}
                      </span>{' '}
                      {plural(avenueCount, 'avenue')}
                    </div>
                    <div className="text-muted-foreground" data-testid="avenue-cost-preview">
                      Est.{' '}
                      <span className="font-mono">
                        {estTokens != null ? estTokens.toLocaleString() : '?'}
                      </span>{' '}
                      tokens ·{' '}
                      <span className="font-mono">
                        {estCostUsd != null ? `~$${estCostUsd.toFixed(2)}` : '~?'}
                      </span>
                    </div>
                    {overThreshold && (
                      <div className="mt-1 text-status-warning" data-testid="sweep-caution" role="status">
                        This will launch <span className="font-mono">{avenueCount}</span> avenues. Review before confirming.
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {/* Override fields (D-06). */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              type="number"
              min={1}
              placeholder="repeats (override)"
              value={repeats}
              onChange={(e) => setRepeats(e.target.value)}
              data-testid="override-repeats"
            />
            <Input
              className="w-48"
              type="number"
              min={1}
              placeholder="timeout seconds (override)"
              value={timeout}
              onChange={(e) => setTimeoutVal(e.target.value)}
              data-testid="override-timeout"
            />
          </div>

          {/* Variant subset multi-pick (copies the TASK_CLASSES select idiom as a
              set of toggles keyed by the resolved variant names). */}
          {variantNames.length > 0 && (
            <div className="space-y-2" data-testid="variant-subset">
              <p className="text-sm text-muted-foreground">
                Variant subset (none selected = run all) + per-variant model/agent override:
              </p>
              <div className="space-y-2">
                {variantNames.map((variant) => (
                  <div key={variant} className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-sm">
                      <Checkbox
                        checked={variantSubset.includes(variant)}
                        onCheckedChange={() => toggleVariantSubset(variant)}
                        id={`variant-subset-${variant}`}
                      />
                      <span className="font-mono">{variant}</span>
                    </label>
                    <Input
                      className="w-44"
                      placeholder="model override"
                      value={variantOverrides[variant]?.model ?? ''}
                      onChange={(e) => setVariantOverrideField(variant, 'model', e.target.value)}
                      data-testid={`variant-override-${variant}-model`}
                    />
                    <Input
                      className="w-44"
                      placeholder="agent override"
                      value={variantOverrides[variant]?.agent ?? ''}
                      onChange={(e) => setVariantOverrideField(variant, 'agent', e.target.value)}
                      data-testid={`variant-override-${variant}-agent`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* D-12: capture_raw_bodies checkbox, default OFF. */}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={captureRawBodies}
              onCheckedChange={(v) => setCaptureRawBodies(v)}
              id="capture-raw-bodies"
            />
            <span data-testid="capture-raw-bodies">Capture raw request/response bodies (heavier; default off)</span>
          </label>

          <div className="flex items-center gap-2">
            <Button
              onClick={onLaunch}
              // D-02: in fork mode the launch is DISABLED until the server-resolved
              // avenue count (previewCellCount) has rendered — the guardrail must be
              // seen before any launch is possible.
              disabled={
                launchPending ||
                specFile === '' ||
                !!selectedSpec?.error ||
                (isForkMode && avenueCount == null)
              }
              data-testid="launch-experiment"
            >
              {launchPending
                ? 'Launching…'
                : isForkMode
                  ? `Launch ${avenueCount ?? '…'} avenues`
                  : 'Launch experiment'}
            </Button>
          </div>

          {/* D-09: a 409 holder / validation message surfaces here — never silent.
              Dismissible (85-06): a 409 captured while a run held the slot otherwise
              renders forever after the slot frees, reading as a stuck launcher. The
              run-monitor also auto-clears it when the run reaches a terminal state. */}
          {launchError && (
            <p className="mt-1 flex items-start gap-2 text-sm text-destructive" role="alert" data-testid="launch-error">
              <span className="flex-1">{launchError}</span>
              <button
                type="button"
                aria-label="dismiss launch error"
                data-testid="dismiss-launch-error"
                className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => dispatch(clearLaunchError())}
              >
                ×
              </button>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
