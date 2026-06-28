// PATTERN SOURCE: 55-08-PLAN.md Task 2 + 55-PATTERNS.md § OntologyFilter +
//                 60-05-PLAN.md G5 (D-16..D-20)
// PORT-SPEC: _work/.../viewer/src/components/Filters/OntologyFilter.tsx
//
// Dual-mode rendering (60-05):
//   - `groupingSchema` PROVIDED → legacy hardcoded path (VOKB tab uses
//     VOKB_SCHEMA verbatim). Renders Upper/Lower groups via classifyAvailable
//     + renderSubGroup. apiClient is unused in this mode.
//   - `groupingSchema` OMITTED → API-driven path (coding tab). Fetches
//     /api/v1/ontology/classes?withDisplay=true via apiClient and builds
//     L1→L2 groups (D-17), L0 anchors ungrouped at top (D-20), per-class
//     count badges (D-18), [all]/[none] link-buttons (D-18), and UI-only
//     L1 collapse (D-19).
//
// Phase 60 removed the legacy coding-specific stopgap schema (D-16). The
// Phase 57 lower ontology (.data/ontologies/coding.lower.json) supersedes it.
//
// Empty selection = "all visible" (UI-SPEC §10 filter composition).
// Catch-all "Other" group catches any class not present in any subgroup
// (verbatim VOKB rule, OntologyFilter.tsx:42).
//
// Micro-type exceptions preserved verbatim (UI-SPEC §3):
//   - text-[10px] for count badges
//   - text-[9px] for group all/none toggles
//   - text-[8px] for disclosure triangles (NOT on text content)

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'
import type { ApiClient, Entity, OntologyClass } from '@/api/ApiClient'

export interface OntologyGroupSchema {
  upper: { name: string; subgroups: Record<string, ReadonlySet<string>> }
  lower: { name: string; subgroups: Record<string, ReadonlySet<string>> }
}

// Verbatim from VOKB OntologyFilter.tsx:14-42
export const VOKB_SCHEMA: OntologyGroupSchema = {
  upper: {
    name: 'Upper Ontology',
    subgroups: {
      'Execution Model': new Set([
        'Component',
        'DataAsset',
        'Infrastructure',
        'Job',
        'Pipeline',
        'Service',
        'Session',
        'Step',
      ]),
      'Failure Model': new Set([
        'FailurePattern',
        'Incident',
        'Resolution',
        'RootCause',
        'Symptom',
      ]),
    },
  },
  lower: {
    name: 'Lower Ontology',
    subgroups: {
      RaaS: new Set([
        'ArgoWorkflow',
        'DataQualityCheck',
        'RPU',
        'RPUType',
        'RPUVersion',
        'S3DataPath',
      ]),
      'KPI-FW': new Set([
        'GrafanaDashboard',
        'KPIDefinition',
        'KPIPipeline',
        'MetricsAggregation',
        'SignalExtraction',
      ]),
      Business: new Set([
        'ActionItem',
        'Decision',
        'DocumentSource',
        'Requirement',
        'Risk',
      ]),
    },
  },
}

export interface OntologyFilterProps {
  entities: readonly Entity[]
  /** REQUIRED for API-driven path (groupingSchema omitted). Unused on legacy path. */
  apiClient: ApiClient
  /**
   * Optional. PROVIDED → legacy hardcoded path (VOKB tab). OMITTED →
   * API-driven path (coding tab). Phase 60 preserves the legacy path for the
   * VOKB tab; see checker W-1 + 60-05-PLAN.md.
   */
  groupingSchema?: OntologyGroupSchema
}

interface ClassifiedClasses {
  upperSubgroupClasses: Record<string, string[]>
  lowerSubgroupClasses: Record<string, string[]>
  otherClasses: string[]
}

function classifyAvailable(
  available: string[],
  schema: OntologyGroupSchema,
): ClassifiedClasses {
  const upperSubgroupClasses: Record<string, string[]> = {}
  const lowerSubgroupClasses: Record<string, string[]> = {}
  const knownAll = new Set<string>()

  for (const [name, members] of Object.entries(schema.upper.subgroups)) {
    upperSubgroupClasses[name] = available.filter((c) => members.has(c)).sort()
    for (const m of members) knownAll.add(m)
  }
  for (const [name, members] of Object.entries(schema.lower.subgroups)) {
    lowerSubgroupClasses[name] = available.filter((c) => members.has(c)).sort()
    for (const m of members) knownAll.add(m)
  }
  // Catch-all: anything in `available` that's NOT in any subgroup membership
  // (verbatim VOKB rule — OntologyFilter.tsx:42). Surface as "Other" so a
  // new ontology class is never silently invisible.
  const otherClasses = available.filter((c) => !knownAll.has(c)).sort()
  return { upperSubgroupClasses, lowerSubgroupClasses, otherClasses }
}

export function OntologyFilter({
  entities,
  apiClient,
  groupingSchema,
}: OntologyFilterProps) {
  const selectedOntologyClasses = useViewerStore((s) => s.selectedOntologyClasses)
  const setSelectedOntologyClasses = useViewerStore(
    (s) => s.setSelectedOntologyClasses,
  )

  const [collapsed, setCollapsed] = useState(false)
  const [upperCollapsed, setUpperCollapsed] = useState(false)
  const [lowerCollapsed, setLowerCollapsed] = useState(false)
  // API-driven path: per-L1 UI-only collapse (D-19).
  const [collapsedL1, setCollapsedL1] = useState<Record<string, boolean>>({})
  // API-driven path: ontology classes from /api/v1/ontology/classes?withDisplay=true.
  // null = loading; [] = error-fallback (renders entity-derived flat rows).
  const [ontologyClasses, setOntologyClasses] = useState<
    OntologyClass[] | null
  >(null)
  const [fetchError, setFetchError] = useState(false)

  // Trigger the fetch only on API-driven path. Single fetch per mount; do
  // not re-fetch on `entities` prop change (the response is registry-driven,
  // not entity-driven).
  useEffect(() => {
    if (groupingSchema !== undefined) return // legacy path — no fetch
    let cancelled = false
    apiClient
      .listOntologyClasses()
      .then((classes) => {
        if (cancelled) return
        setOntologyClasses(classes)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        Logger.warn(
          Logger.Categories.FILTERS,
          `OntologyFilter listOntologyClasses failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        setFetchError(true)
        setOntologyClasses([])
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, groupingSchema])

  const { availableClasses, counts } = useMemo(() => {
    const set = new Set<string>()
    const map: Record<string, number> = {}
    for (const e of entities) {
      const cls = e.ontologyClass
      if (typeof cls === 'string' && cls.length > 0) {
        set.add(cls)
        map[cls] = (map[cls] || 0) + 1
      }
    }
    return { availableClasses: Array.from(set).sort(), counts: map }
  }, [entities])

  const isSelected = (cls: string) =>
    selectedOntologyClasses.length === 0 || selectedOntologyClasses.includes(cls)

  // Materialise the effective selection EXACTLY the way the per-row checkbox
  // does (renderClassCheckbox) so a group all/none button can't collide with
  // the empty-array "all visible" sentinel:
  //   - []            ("all visible")  → the full available class list
  //   - ['__none__']  ("none visible") → the empty set
  //   - otherwise                      → the explicit selection
  // Before this fix, group all/none mutated the raw `selectedOntologyClasses`:
  // clicking "all" on ONE group (e.g. COMPONENT) collapsed [] to just that
  // group's classes, which DESELECTED every other class (Project, System);
  // clicking "none" emptied the array back to [] which the sentinel reads as
  // "all visible", re-checking everything. (Bug report 2026-06-28.)
  const materialiseBase = useCallback((): string[] => {
    if (selectedOntologyClasses.includes('__none__')) return []
    if (selectedOntologyClasses.length === 0) return availableClasses.slice()
    return selectedOntologyClasses.slice()
  }, [selectedOntologyClasses, availableClasses])

  // Select a group: union-add onto the materialised base (VOKB convention:
  // add, never replace) — so other groups keep their state.
  const selectGroup = useCallback(
    (classes: string[]) => {
      const next = new Set(materialiseBase())
      for (const c of classes) next.add(c)
      setSelectedOntologyClasses(Array.from(next))
      Logger.info(
        Logger.Categories.FILTERS,
        `OntologyFilter selectGroup +${classes.length}`,
      )
    },
    [materialiseBase, setSelectedOntologyClasses],
  )

  // Deselect a group: filter-remove from the materialised base. An emptied
  // result becomes the ['__none__'] "none visible" sentinel — NOT [] (which
  // the sentinel reads as "all visible"). Mirrors the per-row toggle.
  const deselectGroup = useCallback(
    (classes: string[]) => {
      const toRemove = new Set(classes)
      const next = materialiseBase().filter((c) => !toRemove.has(c))
      setSelectedOntologyClasses(next.length === 0 ? ['__none__'] : next)
      Logger.info(
        Logger.Categories.FILTERS,
        `OntologyFilter deselectGroup -${classes.length}`,
      )
    },
    [materialiseBase, setSelectedOntologyClasses],
  )

  const renderClassCheckbox = (cls: string) => (
    <label
      key={cls}
      className="flex items-center gap-2 cursor-pointer hover:bg-accent p-1 rounded"
      data-testid={`filter-ontology-row-${cls}`}
    >
      <Checkbox
        checked={isSelected(cls)}
        onCheckedChange={() => {
          // 2026-06-12: same empty-set-sentinel bug Teams + Layer had.
          // selectedOntologyClasses === [] means "all visible". Clicking
          // one used to push `[cls]` which made every other class look
          // unchecked. Materialise the full available list first, then
          // toggle the clicked class. Also handle the symmetric
          // `['__none__']` "none visible" sentinel — clicking from that
          // state selects ONLY the clicked class.
          if (selectedOntologyClasses.includes('__none__')) {
            setSelectedOntologyClasses([cls])
          } else {
            const base = selectedOntologyClasses.length === 0
              ? availableClasses.slice()
              : selectedOntologyClasses
            const idx = base.indexOf(cls)
            if (idx >= 0) {
              const next = base.slice()
              next.splice(idx, 1)
              setSelectedOntologyClasses(next.length === 0 ? ['__none__'] : next)
            } else {
              setSelectedOntologyClasses([...base, cls])
            }
          }
          Logger.info(
            Logger.Categories.FILTERS,
            `OntologyFilter toggle: ${cls}`,
          )
        }}
        aria-label={cls}
      />
      <span
        className="text-xs text-foreground flex-1 truncate"
        data-testid={`filter-ontology-label-${cls}`}
      >
        {cls}
      </span>
      <span
        className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded tabular-nums"
        data-testid={`filter-ontology-count-${cls}`}
      >
        {counts[cls] || 0}
      </span>
    </label>
  )

  const renderSubGroup = (
    label: string,
    classes: string[],
    _testIdPrefix: string,
  ) => {
    if (classes.length === 0) return null
    return (
      <div key={label} className="ml-2 mt-0.5">
        <div className="flex items-center justify-between pr-1 mb-0.5">
          <span className="text-[9px] font-medium text-muted-foreground tracking-wide">
            {label}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                selectGroup(classes)
              }}
              className="text-[9px] text-muted-foreground hover:text-foreground"
              data-testid={`filter-ontology-all-${label}`}
              aria-label={`Select all in ${label}`}
            >
              all
            </button>
            <span className="text-[9px] text-muted-foreground/50">|</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                deselectGroup(classes)
              }}
              className="text-[9px] text-muted-foreground hover:text-foreground"
              data-testid={`filter-ontology-none-${label}`}
              aria-label={`Deselect all in ${label}`}
            >
              none
            </button>
          </div>
        </div>
        {classes.map(renderClassCheckbox)}
      </div>
    )
  }

  // -------------------------------------------------------------------
  // BRANCH: legacy hardcoded path (VOKB tab) — `groupingSchema` provided
  // -------------------------------------------------------------------
  if (groupingSchema !== undefined) {
    const classified = classifyAvailable(availableClasses, groupingSchema)
    // Don't render the panel if there are no available classes from the entity
    // payload — matches VOKB OntologyFilter.tsx:189.
    if (availableClasses.length === 0) return null
    const upperEntries = Object.entries(classified.upperSubgroupClasses).filter(
      ([, cs]) => cs.length > 0,
    )
    const lowerEntries = Object.entries(classified.lowerSubgroupClasses).filter(
      ([, cs]) => cs.length > 0,
    )

    return (
      <div className="space-y-1" data-testid="filter-ontology-section">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
        >
          <span>Ontology Class</span>
          <span
            className={`transform transition-transform text-[8px] ${collapsed ? '' : 'rotate-90'}`}
            aria-hidden
          >
            ▶
          </span>
        </button>
        {!collapsed && (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {upperEntries.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-1 mb-0.5">
                  <button
                    type="button"
                    onClick={() => setUpperCollapsed(!upperCollapsed)}
                    className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 hover:text-foreground"
                    aria-expanded={!upperCollapsed}
                  >
                    <span
                      className={`transform transition-transform text-[8px] ${
                        upperCollapsed ? '' : 'rotate-90'
                      }`}
                      aria-hidden
                      data-testid="filter-ontology-triangle-upper"
                    >
                      ▶
                    </span>
                    {groupingSchema.upper.name}
                  </button>
                </div>
                {!upperCollapsed &&
                  upperEntries.map(([name, cs]) => renderSubGroup(name, cs, 'upper'))}
              </div>
            )}

            {lowerEntries.length > 0 && (
              <div className={upperEntries.length > 0 ? 'border-t border-border pt-1 mt-1' : ''}>
                <div className="flex items-center justify-between px-1 mb-0.5">
                  <button
                    type="button"
                    onClick={() => setLowerCollapsed(!lowerCollapsed)}
                    className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 hover:text-foreground"
                    aria-expanded={!lowerCollapsed}
                  >
                    <span
                      className={`transform transition-transform text-[8px] ${
                        lowerCollapsed ? '' : 'rotate-90'
                      }`}
                      aria-hidden
                      data-testid="filter-ontology-triangle-lower"
                    >
                      ▶
                    </span>
                    {groupingSchema.lower.name}
                  </button>
                </div>
                {!lowerCollapsed &&
                  lowerEntries.map(([name, cs]) => renderSubGroup(name, cs, 'lower'))}
              </div>
            )}

            {classified.otherClasses.length > 0 && (
              <div className="border-t border-border pt-1 mt-1">
                {renderSubGroup('Other', classified.otherClasses, 'other')}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------
  // BRANCH: API-driven path (coding tab) — `groupingSchema` omitted
  // -------------------------------------------------------------------

  // Loading: fetch still pending and no error yet → render nothing (Test 9).
  if (ontologyClasses === null) return null

  // Build groups from the registry response, filtered by which classes
  // actually appear in the entity payload (`availableClasses`).
  const availSet = new Set(availableClasses)

  // BC fallback: pre-Plan-04 server returns classes without `level` fields.
  const hasAnyLevel = ontologyClasses.some(
    (c) => typeof c.level === 'number',
  )

  // Error fallback: API rejected → derive flat list from entity classes (Test 10).
  // BC fallback: no level info → all flat (Test 8).
  let l0Classes: string[] = []
  let l1WithChildren: Array<{ name: string; children: string[] }> = []
  let l1Flat: string[] = []
  // Phase 60 Plan 09 (SC#5): level-None classes that entities actually carry
  // (e.g. Insight, Digest with `level: null` in the API response). Previously
  // these matched no numeric-level bucket and were silently dropped despite
  // having entities. Rendered as flat selectable rows in their own section.
  let levelNoneFlat: string[] = []

  if (fetchError) {
    l1Flat = availableClasses.slice()
  } else if (!hasAnyLevel) {
    // Pre-Plan-04 string-array shape: render available classes as flat rows.
    l1Flat = ontologyClasses
      .map((c) => c.name)
      .filter((n) => availSet.has(n))
      .sort()
  } else {
    // L1→L2 group construction.
    const byName = new Map<string, OntologyClass>()
    for (const c of ontologyClasses) byName.set(c.name, c)
    const l2ByParent = new Map<string, string[]>()
    for (const c of ontologyClasses) {
      if (c.level === 2 && c.parent && availSet.has(c.name)) {
        const arr = l2ByParent.get(c.parent) ?? []
        arr.push(c.name)
        l2ByParent.set(c.parent, arr)
      }
    }
    for (const arr of l2ByParent.values()) arr.sort()

    l0Classes = ontologyClasses
      .filter((c) => c.level === 0 && availSet.has(c.name))
      .map((c) => c.name)
      .sort()

    const l1Classes = ontologyClasses.filter((c) => c.level === 1)
    for (const l1 of l1Classes) {
      const children = l2ByParent.get(l1.name) ?? []
      if (children.length > 0) {
        l1WithChildren.push({ name: l1.name, children })
      } else if (availSet.has(l1.name)) {
        l1Flat.push(l1.name)
      }
    }
    l1WithChildren.sort((a, b) => a.name.localeCompare(b.name))
    l1Flat.sort()

    // Level-None classes entities carry (e.g. Insight/Digest). They have no
    // numeric `level`, so they can never collide with the L0/L1/L2 buckets
    // above — render them as their own flat section instead of dropping them.
    levelNoneFlat = ontologyClasses
      .filter((c) => typeof c.level !== 'number' && availSet.has(c.name))
      .map((c) => c.name)
      .sort()

    // Discard L1 group headers whose name itself isn't on screen AND none of
    // whose children are on screen (avoid empty groups). We retain a group
    // even if the L1 header class is not in availSet, as long as ≥1 child is.
    void byName // (reserved for future ancestor-walk extensions; not used now)
  }

  // Don't render the panel at all if there's nothing to show.
  if (
    l0Classes.length === 0 &&
    l1WithChildren.length === 0 &&
    l1Flat.length === 0 &&
    levelNoneFlat.length === 0
  ) {
    return null
  }

  const toggleL1Collapse = (name: string) => {
    setCollapsedL1((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  const renderL1Group = (l1Name: string, children: string[]) => {
    const isCollapsed = collapsedL1[l1Name] === true
    return (
      <div key={l1Name} className="mt-1">
        <div className="flex items-center justify-between px-1 mb-0.5">
          <button
            type="button"
            onClick={() => toggleL1Collapse(l1Name)}
            className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 hover:text-foreground"
            aria-expanded={!isCollapsed}
          >
            <span
              className={`transform transition-transform text-[8px] ${
                isCollapsed ? '' : 'rotate-90'
              }`}
              aria-hidden
              data-testid={`filter-ontology-l1-triangle-${l1Name}`}
            >
              ▶
            </span>
            {l1Name}
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                selectGroup(children)
              }}
              className="text-[9px] text-muted-foreground hover:text-foreground"
              data-testid={`filter-ontology-all-${l1Name}`}
              aria-label={`Select all in ${l1Name}`}
            >
              all
            </button>
            <span className="text-[9px] text-muted-foreground/50">|</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                deselectGroup(children)
              }}
              className="text-[9px] text-muted-foreground hover:text-foreground"
              data-testid={`filter-ontology-none-${l1Name}`}
              aria-label={`Deselect all in ${l1Name}`}
            >
              none
            </button>
          </div>
        </div>
        {!isCollapsed && (
          <div className="ml-2">{children.map(renderClassCheckbox)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1" data-testid="filter-ontology-section">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
      >
        <span>Ontology Class</span>
        <span
          className={`transform transition-transform text-[8px] ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        >
          ▶
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {/* L0 anchors — ungrouped at top per D-20 */}
          {l0Classes.length > 0 && (
            <div data-testid="filter-ontology-l0-anchors">
              {l0Classes.map(renderClassCheckbox)}
            </div>
          )}

          {/* L1 groups (with L2 children) */}
          {l1WithChildren.length > 0 && (
            <div
              className={l0Classes.length > 0 ? 'border-t border-border pt-1 mt-1' : ''}
              data-testid="filter-ontology-l1-groups"
            >
              {l1WithChildren.map(({ name, children }) =>
                renderL1Group(name, children),
              )}
            </div>
          )}

          {/* L1 flat rows (L1s without L2 children) */}
          {l1Flat.length > 0 && (
            <div
              className={
                l0Classes.length > 0 || l1WithChildren.length > 0
                  ? 'border-t border-border pt-1 mt-1'
                  : ''
              }
              data-testid="filter-ontology-l1-flat"
            >
              {l1Flat.map(renderClassCheckbox)}
            </div>
          )}

          {/* Level-None flat rows (classes entities carry with no numeric level,
              e.g. Insight/Digest) — Phase 60 Plan 09 (SC#5) */}
          {levelNoneFlat.length > 0 && (
            <div
              className={
                l0Classes.length > 0 ||
                l1WithChildren.length > 0 ||
                l1Flat.length > 0
                  ? 'border-t border-border pt-1 mt-1'
                  : ''
              }
              data-testid="filter-ontology-level-none-flat"
            >
              {levelNoneFlat.map(renderClassCheckbox)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
