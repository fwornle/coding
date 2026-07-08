import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchSpecList,
  launchExperiment,
  clearLauncherPrefill,
  selectSpecList,
  selectSpecListLoading,
  selectLaunchError,
  selectLaunchPending,
  selectLauncherPrefill,
  type SpecSummary,
  type ExperimentOverrides,
  type VariantOverride,
} from '@/store/slices/performanceSlice'

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
    dispatch(clearLauncherPrefill())
  }, [prefill, dispatch])

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

  // D-09 matrix preview — read the SERVER-computed cellCount (variantCount ×
  // repeats). We never recompute the axes client-side; when an operator overrides
  // repeats we show the adjusted product but the base count still comes from the
  // server's variantCount.
  const previewCellCount: number | null = useMemo(() => {
    if (!selectedSpec) return null
    const baseVariants = selectedSpec.variantCount ?? selectedSpec.variants?.length ?? null
    if (baseVariants == null) return selectedSpec.cellCount ?? null
    const subsetCount = variantSubset.length > 0 ? variantSubset.length : baseVariants
    const overriddenRepeats = repeats.trim() !== '' ? Number(repeats) : (selectedSpec.repeats ?? null)
    if (overriddenRepeats == null || !Number.isFinite(overriddenRepeats)) return selectedSpec.cellCount ?? null
    return subsetCount * overriddenRepeats
  }, [selectedSpec, variantSubset, repeats])

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
    if (timeout.trim() !== '' && Number.isFinite(Number(timeout))) o.timeout = Number(timeout)
    const subset = parseVariantSubset(variantSubset)
    if (subset) o.variants = subset
    if (captureRawBodies) o.capture_raw_bodies = true
    if (Object.keys(variantOverrides).length > 0) o.variantOverrides = variantOverrides
    return o
  }

  const onLaunch = async () => {
    if (!specFile) return
    const result = await dispatch(
      launchExperiment({ spec: specFile, overrides: buildOverrides(), rerun_of: rerunOf })
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
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Launch experiment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
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
              placeholder="timeout ms (override)"
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
              disabled={launchPending || specFile === '' || !!selectedSpec?.error}
              data-testid="launch-experiment"
            >
              {launchPending ? 'Launching…' : 'Launch experiment'}
            </Button>
          </div>

          {/* D-09: a 409 holder / validation message surfaces here — never silent. */}
          {launchError && (
            <p className="mt-1 text-sm text-destructive" role="alert" data-testid="launch-error">{launchError}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
