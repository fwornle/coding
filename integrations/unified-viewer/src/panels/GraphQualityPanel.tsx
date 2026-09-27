// Graph quality — the numbers that were only ever in a CLI, and the one fix
// that can be applied from here.
//
// WHY THIS IS NOT A CI GATE. `scripts/assert-graph-density.ts` has computed all
// of this for a while and exits 1 on it, and it is deliberately wired into
// nothing: it fails on a data gap rather than on a regression, so adding it to
// CI would turn the build red until somebody did data work — without telling
// them which data work. The gap needs a surface with actions attached, not a
// red check.
//
// WHAT IT REFUSES TO DO. It does not offer to drag a row onto a project.
// Measured on the live store, there is no category here where a human has to
// INVENT a placement: every unattributed row is either already claimed by
// something the tree refuses to use, or pointing at a reference that is broken.
// A drag would write a second, redundant placement on top of those causes and
// make the graph look repaired while the cause stayed. So the only write on
// offer is "use the parent the writer already recorded", and the other three
// categories say what is wrong instead of pretending to fix it.
//
// THE SECOND WRITE: EVIDENCE. The `sourceRefs[]` and `occurrences[]` arrays
// under an entity's metadata are read by the entity panel in five places and were
// populated on 0 of 2795 rows, so every entity said "No sources." / "No
// occurrences.", hid its Evolution and Timeline pills, and scored an
// unmeasurable confidence. The values are recoverable exactly — an insight
// document that exists on disk, and incoming `mentions` / `capturedBy` edges
// that already carry their own dates — so this section offers the same deal as
// the one above: a finding set enumerated on screen first, then a write scoped
// to exactly that set. Nothing is inferred and no LLM is involved; the
// derivation lives in scripts/enrich-entity-sources.mjs and this button drives
// the same pure planner in-process on obs-api.
//
// (Those key names are written WITHOUT a `metadata.` prefix on purpose:
// scripts/audit-viewer-entity-fields.mjs extracts `metadata.<key>` from viewer
// source to find reads, so prose in that shape makes this file look like a
// reader of keys it merely mentions — and a marker named only in a tooltip
// would enter the audit's key set from nowhere.)
//
// WHY THE PREVIEW IS SERVER-SIDE while Attribution above is computed in the
// browser: the derivation needs the insight-document directory listing and the
// whole relation set, and it must agree exactly with the CLI. Two
// implementations of one derivation is how the bug this fixes got made.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiClient, EntityUpdateError, type SourceEnrichmentFinding } from '@/api/ApiClient'
import {
  categoriseUnattributed,
  CATEGORY_LABEL,
  type AttributionCategory,
  type AttributionEdge,
  type AttributionEntity,
  type AttributionFinding,
} from '@/graph/attribution'
import { Progress } from '@/components/ui/progress'
import { Logger } from '@/lib/logging'
import { useViewerStore } from '@/store/viewer-store'
import { useViewerStats } from './useViewerStats'
// The key the entity list is cached under — imported, not retyped, so a
// rename cannot silently turn this invalidation into a no-op.
import { ENTITIES_KEY } from '@/graph/useGraphData'

export interface GraphQualityPanelProps {
  apiClient: ApiClient
  system: string
  // Structurally minimal, per the note in hierarchy-parents.ts: the viewer has
  // two `Entity` shapes in play (api/ApiClient's `level: number` vs
  // graph/types' `level: 0|1|2|3`) and this panel reads neither. Naming only
  // the fields it uses lets either satisfy it without a cast at the call site.
  /** Every entity, for resolving recorded parent names and dangling edges. */
  entities: readonly AttributionEntity[]
  relations: readonly AttributionEdge[]
  /** The rows currently rendered — what the operator can actually see. */
  visibleIds: ReadonlySet<string>
}

/** Order matters: most actionable first, and it is the order the CLI prints. */
const CATEGORY_ORDER: readonly AttributionCategory[] = [
  'recordedParent',
  'wrongClass',
  'danglingRef',
  'unclaimed',
]

const NUM = 'tabular-nums font-medium'

function Row({ label, value, warn, title }: {
  label: string
  value: string
  warn?: boolean
  title?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`${NUM} ${warn ? 'text-amber-600 dark:text-amber-500' : ''}`}>{value}</span>
    </div>
  )
}

export default function GraphQualityPanel({
  apiClient,
  system,
  entities,
  relations,
  visibleIds,
}: GraphQualityPanelProps) {
  const queryClient = useQueryClient()
  const stats = useViewerStats(apiClient, system)
  const hierarchyParents = useViewerStore((s) => s.hierarchyParents)
  const hierarchyClasses = useViewerStore((s) => s.hierarchyClasses)
  const [expanded, setExpanded] = useState<AttributionCategory | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Judged over what is RENDERED, deliberately. The store holds 2,700 rows and
  // most of the unattributed ones are archived roll-up children nobody is
  // looking at; a count that includes them describes a corpus rather than the
  // screen, and the operator cannot tell which rows the number means.
  const report = useMemo(() => {
    const classOf = (id: string) => hierarchyClasses.get(id)
    const visible = entities.filter((e) => visibleIds.has(e.id))
    return categoriseUnattributed(visible, entities, relations, hierarchyParents, classOf)
  }, [entities, relations, visibleIds, hierarchyParents, hierarchyClasses])

  const accept = useMutation({
    mutationFn: async (findings: readonly AttributionFinding[]) => {
      // Sequential, not Promise.all. These are writes to one LevelDB-backed
      // store; a burst of parallel merges buys nothing and makes a partial
      // failure harder to describe. The loop stops at the first error so the
      // message can name the row that broke.
      let applied = 0
      for (const f of findings) {
        // THROW, do not skip. This used to `continue`, so a finding that had
        // lost its suggestion produced a mutation that issued no request,
        // returned 0 and reported success — the button sat on "Placing…" and
        // nothing anywhere said why. A silent skip in a write path is
        // indistinguishable from a write that worked.
        if (!f.suggestedParentId) {
          throw new Error(`${f.name}: no recorded parent to place it under — nothing was written.`)
        }
        await apiClient.updateEntityMetadata(f.id, { parentId: f.suggestedParentId })
        applied += 1
      }
      return applied
    },
    onSuccess: (applied) => {
      setError(null)
      Logger.info(Logger.Categories.API, `Graph quality: placed ${applied} row(s) by recorded parent`)
      // Refetch rather than patch the cache. The parent map is derived from
      // the whole entity list in UnifiedViewer, so a local edit would have to
      // reproduce that derivation to stay honest — and if it got it wrong the
      // panel would report a fix that had not happened.
      //
      // SCOPED to the entity list. A bare `invalidateQueries()` invalidates
      // every query in the app — including the 17MB entity payload AND the
      // stats query this panel itself renders from — so one click triggered a
      // refetch storm while the panel was still mounted mid-mutation.
      void queryClient.invalidateQueries({ queryKey: [ENTITIES_KEY] })
    },
    onError: (e: unknown) => {
      const transient = e instanceof EntityUpdateError && e.transient
      setError(
        transient
          ? 'The knowledge store is still starting up — try again in a moment.'
          : e instanceof Error ? e.message : 'Write failed.',
      )
      Logger.warn(Logger.Categories.API, `Graph quality: placement failed — ${String(e)}`)
    },
  })

  // ---- Evidence enrichment -----------------------------------------------
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [enrichError, setEnrichError] = useState<string | null>(null)

  const preview = useQuery({
    queryKey: ['enrich-sources-preview', apiClient.base],
    queryFn: () => apiClient.previewSourceEnrichment(),
    // Only while the section is open: closed, it should cost nothing.
    enabled: evidenceOpen && apiClient.supportsSourceEnrichment,
    staleTime: 60_000,
  })

  // Polls ONLY while a run is in flight. A status poll that keeps running after
  // the job ends is the reason the workflow panel needed an idle sentinel; here
  // the condition is simply `applying`, cleared the moment the server reports
  // no inflight job.
  const enrichStatus = useQuery({
    queryKey: ['enrich-sources-status', apiClient.base],
    queryFn: () => apiClient.sourceEnrichmentStatus(),
    enabled: applying && apiClient.supportsSourceEnrichment,
    refetchInterval: applying ? 1000 : false,
  })

  const inflight = enrichStatus.data?.inflight
  const lastEnrich = enrichStatus.data?.lastJob

  // Stop polling and refresh the corpus once the server reports the run done.
  //
  // Derived from the POLL, not from the POST's own promise: the run is a
  // server-side singleton, so the poll is the only thing that knows when the
  // work finished — including a run this client merely attached to, whose POST
  // resolved immediately with `attached: true`.
  //
  // In an effect and not inline in the render body: setState during render
  // re-enters immediately, and with a 1s refetch behind it that is a loop.
  const hasStatus = enrichStatus.data !== undefined
  useEffect(() => {
    if (!applying || !hasStatus || inflight !== null) return
    setApplying(false)
    const failed = lastEnrich?.error?.message ?? null
    setEnrichError(failed)
    if (failed) {
      Logger.warn(Logger.Categories.API, `Source enrichment failed — ${failed}`)
    } else {
      Logger.info(
        Logger.Categories.API,
        `Source enrichment wrote ${lastEnrich?.result?.written ?? 0} row(s)`,
      )
    }
    // Scoped, per the note on the placement mutation above: a bare
    // invalidateQueries() would refetch the 17MB entity payload AND every other
    // query in the app.
    void queryClient.invalidateQueries({ queryKey: [ENTITIES_KEY] })
    void queryClient.invalidateQueries({ queryKey: ['enrich-sources-preview'] })
  }, [applying, hasStatus, inflight, lastEnrich, queryClient])

  const enrich = useMutation({
    mutationFn: async () => apiClient.runSourceEnrichment({ dryRun: false }),
    onSuccess: (accepted) => {
      setEnrichError(null)
      setApplying(true)
      Logger.info(
        Logger.Categories.API,
        `Source enrichment ${accepted.attached ? 'attached to job' : 'started job'} ${accepted.jobId}`,
      )
    },
    onError: (e: unknown) => {
      setApplying(false)
      setEnrichError(e instanceof Error ? e.message : 'Enrichment failed to start.')
      Logger.warn(Logger.Categories.API, `Source enrichment refused — ${String(e)}`)
    },
  })

  const s = stats.data
  const coverage = s?.hierarchyCoverage

  return (
    <div data-testid="graph-quality-panel" className="space-y-3 max-h-[33vh] overflow-y-auto pr-1">
      {/* ---- Attribution ---------------------------------------------- */}
      <section className="space-y-1.5">
        <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Attribution
        </h4>
        {report.total === 0 ? (
          <p data-testid="graph-quality-attribution-clean" className="text-[11px] text-muted-foreground">
            Every rendered row sits under a project.
          </p>
        ) : (
          <>
            <Row
              label="rendered rows with no project"
              value={String(report.total)}
              warn
              title="No Project or System ancestor in the hierarchy. Not the same as the stats bar's orphan count, which means no edges at all."
            />
            {CATEGORY_ORDER.map((key) => {
              const findings = report.byCategory[key]
              if (findings.length === 0) return null
              const meta = CATEGORY_LABEL[key]
              const isOpen = expanded === key
              return (
                <div key={key} className="rounded border border-border/60 px-2 py-1.5 space-y-1">
                  <button
                    type="button"
                    data-testid={`graph-quality-category-${key}`}
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="w-full flex items-baseline justify-between gap-2 text-left text-[11px] hover:text-foreground"
                  >
                    <span>{meta.title}</span>
                    <span className={NUM}>{findings.length}</span>
                  </button>
                  {isOpen && (
                    <>
                      <p className="text-[10px] text-muted-foreground leading-snug">{meta.cause}</p>
                      <ul className="space-y-0.5">
                        {findings.slice(0, 12).map((f) => (
                          <li key={f.id} className="text-[10px] text-muted-foreground truncate" title={f.name}>
                            {f.name}
                            {f.suggestedParentName ? ` → ${f.suggestedParentName}` : ''}
                          </li>
                        ))}
                        {findings.length > 12 && (
                          <li className="text-[10px] text-muted-foreground italic">
                            …and {findings.length - 12} more
                          </li>
                        )}
                      </ul>
                      {/* The action exists for ONE category. For the others the
                          recorded answer is missing or broken, and writing a
                          placement would hide that rather than fix it. */}
                      {key === 'recordedParent' && (
                        <button
                          type="button"
                          data-testid="graph-quality-accept-all"
                          disabled={accept.isPending}
                          onClick={() => accept.mutate(findings)}
                          className="mt-1 w-full rounded border border-border px-2 py-1 text-[10px] hover:bg-accent disabled:opacity-50"
                        >
                          {accept.isPending
                            ? 'Placing…'
                            : `Place ${findings.length} row${findings.length === 1 ? '' : 's'} using the recorded parent`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </>
        )}
        {error && (
          <p data-testid="graph-quality-error" className="text-[10px] text-amber-600 dark:text-amber-500">
            {error}
          </p>
        )}
      </section>

      {/* ---- Evidence -------------------------------------------------- */}
      {apiClient.supportsSourceEnrichment && (
        <section className="space-y-1.5">
          <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Evidence
          </h4>
          <div className="rounded border border-border/60 px-2 py-1.5 space-y-1">
            <button
              type="button"
              data-testid="graph-quality-evidence-toggle"
              aria-expanded={evidenceOpen}
              onClick={() => setEvidenceOpen((v) => !v)}
              className="w-full flex items-baseline justify-between gap-2 text-left text-[11px] hover:text-foreground"
            >
              <span>Rows missing sources or occurrences</span>
              <span className={NUM}>
                {preview.isLoading ? '…' : preview.data ? preview.data.total : '?'}
              </span>
            </button>

            {evidenceOpen && (
              <>
                {preview.isError && (
                  <p className="text-[10px] text-muted-foreground">
                    Preview unavailable — obs-api did not answer.
                  </p>
                )}
                {preview.data && (
                  <>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Recoverable exactly, from data the graph already holds: an insight
                      document on disk named after the row, and incoming{' '}
                      <code>mentions</code> / <code>capturedBy</code> edges carrying
                      their own dates. Nothing is inferred.
                    </p>
                    <Row
                      label="from an insight document only"
                      value={String(preview.data.counts.docsOnly)}
                      title={`${preview.data.docCount} insight documents on disk; matched by exact name.`}
                    />
                    <Row
                      label="from evidence edges only"
                      value={String(preview.data.counts.edgesOnly)}
                      title="Incoming mentions / capturedBy edges. Occurrences are capped at the 50 most recent — the panel's own render cap."
                    />
                    <Row
                      label="from both"
                      value={String(preview.data.counts.both)}
                    />
                    {preview.data.counts.skippedMarker > 0 && (
                      <Row
                        label="already enriched"
                        value={String(preview.data.counts.skippedMarker)}
                        title="Carries the sourceRefsBackfilledAt marker. Re-deriving needs the CLI with --force."
                      />
                    )}

                    {/* Enumerated, per this panel's contract: the write below is
                        scoped to exactly this finding set, so the finding set is
                        on screen. `truncated` says when the list is shorter than
                        the count. */}
                    <ul className="space-y-0.5 pt-0.5">
                      {preview.data.findings.slice(0, 12).map((f: SourceEnrichmentFinding) => (
                        <li
                          key={f.id}
                          className="text-[10px] text-muted-foreground truncate"
                          title={`${f.name} — ${f.from.join(' + ')}`}
                        >
                          {f.name}
                          {f.sourceRefs > 0 ? ` · ${f.sourceRefs} ref` : ''}
                          {f.occurrences > 0 ? ` · ${f.occurrences} occ` : ''}
                        </li>
                      ))}
                      {preview.data.total > 12 && (
                        <li className="text-[10px] text-muted-foreground italic">
                          …and {preview.data.total - 12} more
                          {preview.data.truncated ? ' (list truncated server-side at 200)' : ''}
                        </li>
                      )}
                    </ul>

                    {/* The bar only exists while a job is running — an idle
                        0% bar reads as "stuck", which is exactly the confusion
                        the Confidence tab's unmeasurable state was added to
                        avoid. */}
                    {applying && inflight?.progress && inflight.progress.total > 0 && (
                      <Progress
                        data-testid="graph-quality-enrich-progress"
                        className="h-1.5"
                        value={Math.round(
                          (inflight.progress.done / inflight.progress.total) * 100,
                        )}
                      />
                    )}

                    {preview.data.total > 0 && (
                      <button
                        type="button"
                        data-testid="graph-quality-enrich-apply"
                        disabled={applying || enrich.isPending}
                        onClick={() => enrich.mutate()}
                        className="mt-1 w-full rounded border border-border px-2 py-1 text-[10px] hover:bg-accent disabled:opacity-50"
                      >
                        {applying || enrich.isPending
                          ? `Writing… ${inflight?.progress?.done ?? 0}/${inflight?.progress?.total ?? preview.data.total}`
                          : `Add sources to ${preview.data.total} row${preview.data.total === 1 ? '' : 's'}`}
                      </button>
                    )}

                    {/* The outcome of the last run, whether or not this client
                        started it. `written` is the server's count, not the
                        button's optimism. */}
                    {!applying && lastEnrich?.result && (
                      <p
                        data-testid="graph-quality-enrich-result"
                        className="text-[10px] text-muted-foreground"
                      >
                        Last run: wrote {lastEnrich.result.written} of{' '}
                        {lastEnrich.result.planned}
                        {lastEnrich.result.dryRun ? ' (rehearsal — nothing written)' : ''}
                        {lastEnrich.result.failureCount
                          ? `, ${lastEnrich.result.failureCount} failed`
                          : ''}
                        .
                      </p>
                    )}
                  </>
                )}
                {enrichError && (
                  <p
                    data-testid="graph-quality-enrich-error"
                    className="text-[10px] text-amber-600 dark:text-amber-500"
                  >
                    {enrichError}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ---- Hygiene --------------------------------------------------- */}
      <section className="space-y-1">
        <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Store hygiene
        </h4>
        {stats.isError && (
          <p className="text-[11px] text-muted-foreground">Stats unavailable.</p>
        )}
        {s && (
          <>
            {/* `?? undefined` and the em-dash: an older obs-api does not send
                these, and a missing metric must read as "not reported" rather
                than as a clean zero. */}
            <Row
              label="placed under a project"
              value={coverage ? `${Math.round(coverage.ratio * 100)}% of ${coverage.eligible}` : '—'}
              warn={coverage !== undefined && coverage.ratio < 0.9}
              title="Store-wide hierarchy coverage, from obs-api. Counts the whole corpus, not just what is rendered."
            />
            <Row
              label="orphans (no edges at all)"
              value={String(s.orphanCount)}
              warn={s.orphanCount > 0}
              title="Server-side, whole store: nodes with zero live edges of any type. Different question from 'no project' above."
            />
            <Row
              label="self-edges"
              value={s.selfEdgeCount === undefined ? '—' : String(s.selfEdgeCount)}
              warn={(s.selfEdgeCount ?? 0) > 0}
              title="Edges from a node to itself. Should be 0; a legacy backfill once created 49."
            />
            <Row
              label="duplicate edges"
              value={s.duplicateEdgeCount === undefined ? '—' : String(s.duplicateEdgeCount)}
              warn={(s.duplicateEdgeCount ?? 0) > 0}
              title="Edges repeating the same (source, target, type)."
            />
          </>
        )}
      </section>
    </div>
  )
}
