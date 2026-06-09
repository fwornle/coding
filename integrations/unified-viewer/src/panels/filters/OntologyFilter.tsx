// PATTERN SOURCE: 55-08-PLAN.md Task 2 + 55-PATTERNS.md § OntologyFilter
// PORT-SPEC: _work/.../viewer/src/components/Filters/OntologyFilter.tsx
//
// Replaces Phase 45's flat ClassList. Groups ontology classes by an
// `OntologyGroupSchema`: defaults to VOKB_SCHEMA (Upper/Lower); the
// coding tab passes CODING_SCHEMA (Hierarchy L0..L3 + Typed Views).
//
// Empty selection = "all visible" (UI-SPEC §10 filter composition).
// Catch-all "Other" group catches any class not present in any subgroup
// (verbatim VOKB rule, OntologyFilter.tsx:42).
//
// Micro-type exceptions preserved verbatim (UI-SPEC §3):
//   - text-[10px] for count badges
//   - text-[9px] for group all/none toggles
//   - text-[8px] for disclosure triangles (NOT on text content)

import { useState, useMemo, useCallback } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'
import type { Entity } from '@/api/ApiClient'

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

// Coding-specific schema (UI-SPEC §13.1 hierarchy + Typed Views)
export const CODING_SCHEMA: OntologyGroupSchema = {
  upper: {
    name: 'Hierarchy',
    subgroups: {
      'L0 — Project': new Set(['Project']),
      'L1 — Component': new Set(['Component']),
      'L2 — SubComponent': new Set(['SubComponent']),
      'L3 — Detail': new Set(['Detail']),
    },
  },
  lower: {
    name: 'Typed Views',
    subgroups: {
      'LSL Pipeline': new Set(['Observation', 'Digest', 'Insight', 'LearningArtifact']),
      Patterns: new Set(['Pattern', 'Service', 'Feature', 'Contract', 'RuntimeDiagnostics']),
      Other: new Set(['File', 'System', 'Knowledge']),
    },
  },
}

export interface OntologyFilterProps {
  entities: readonly Entity[]
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
  groupingSchema = VOKB_SCHEMA,
}: OntologyFilterProps) {
  const selectedOntologyClasses = useViewerStore((s) => s.selectedOntologyClasses)
  const toggleOntologyClass = useViewerStore((s) => s.toggleOntologyClass)
  const setSelectedOntologyClasses = useViewerStore(
    (s) => s.setSelectedOntologyClasses,
  )

  const [collapsed, setCollapsed] = useState(false)
  const [upperCollapsed, setUpperCollapsed] = useState(false)
  const [lowerCollapsed, setLowerCollapsed] = useState(false)

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

  const classified = useMemo(
    () => classifyAvailable(availableClasses, groupingSchema),
    [availableClasses, groupingSchema],
  )

  const isSelected = (cls: string) =>
    selectedOntologyClasses.length === 0 || selectedOntologyClasses.includes(cls)

  // Union-add (VOKB convention: NOT replace) — OntologyFilter.tsx:93-98
  const selectGroup = useCallback(
    (classes: string[]) => {
      const current = new Set(selectedOntologyClasses)
      for (const c of classes) current.add(c)
      setSelectedOntologyClasses(Array.from(current))
      Logger.info(
        Logger.Categories.FILTERS,
        `OntologyFilter selectGroup +${classes.length}`,
      )
    },
    [selectedOntologyClasses, setSelectedOntologyClasses],
  )

  // Filter-remove (VOKB convention) — OntologyFilter.tsx:100-105
  const deselectGroup = useCallback(
    (classes: string[]) => {
      const toRemove = new Set(classes)
      setSelectedOntologyClasses(
        selectedOntologyClasses.filter((c) => !toRemove.has(c)),
      )
      Logger.info(
        Logger.Categories.FILTERS,
        `OntologyFilter deselectGroup -${classes.length}`,
      )
    },
    [selectedOntologyClasses, setSelectedOntologyClasses],
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
          toggleOntologyClass(cls)
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
    testIdPrefix: string,
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

  // Don't render the panel if there are no available classes from the entity
  // payload — matches VOKB OntologyFilter.tsx:189 (`if (length === 0) return null`).
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
