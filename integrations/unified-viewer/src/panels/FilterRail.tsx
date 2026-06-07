// PATTERN SOURCE: 45-PATTERNS.md § FilterRail.tsx
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 3 (w-64 / w-12 collapsed)
//   + § Copywriting Contract (search placeholder verbatim)
//   + UI-SPEC § Icon-only controls table — collapse toggle uses
//     "Show filters" / "Hide filters" state-dependent aria-label.

import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import type { ApiClient } from '@/api/ApiClient'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/IconButton'
import { useViewerStore, type Level } from '@/store/viewer-store'
import { Logger } from '@/lib/logging'

export interface FilterRailProps {
  apiClient: ApiClient
  /**
   * Ontology classes derived from the actual entity payload — not the
   * hardcoded /api/v1/ontology/classes 4-element list. Wave 3 checkpoint
   * surfaced that the ontology endpoint returned a typed-views subset
   * (LearningArtifact / Observation / Digest / Insight) that excluded
   * the wave-analysis hierarchy classes used by most live entities. The
   * caller (UnifiedViewer) computes this `Set(entities.ontologyClass)`
   * so every togglable class corresponds to real, filterable data.
   */
  classOptions: readonly string[]
  /** Returned from useKeyboardShortcuts so `/` focuses our search input. */
  registerSearchInputRef: (input: HTMLInputElement | null) => void
}

const LEVELS: ReadonlyArray<{ value: Level; label: string }> = [
  { value: 0, label: 'L0' },
  { value: 1, label: 'L1' },
  { value: 2, label: 'L2' },
  { value: 3, label: 'L3' },
]

export function FilterRail({ classOptions, registerSearchInputRef }: FilterRailProps) {
  const searchQuery = useViewerStore((s) => s.searchQuery)
  const setSearch = useViewerStore((s) => s.setSearch)
  const visibleLevels = useViewerStore((s) => s.visibleLevels)
  const toggleLevel = useViewerStore((s) => s.toggleLevel)
  const setVisibleLevels = useViewerStore((s) => s.setVisibleLevels)
  const selectedClasses = useViewerStore((s) => s.selectedClasses)
  const toggleClass = useViewerStore((s) => s.toggleClass)
  const setSelectedClasses = useViewerStore((s) => s.setSelectedClasses)
  const collapsed = useViewerStore((s) => s.filterRailCollapsed)
  const setCollapsed = useViewerStore((s) => s.setFilterRailCollapsed)

  // Hand the search <input> DOM node to the keyboard-shortcuts hook so `/`
  // can focus it. The shadcn Input doesn't forwardRef, so we attach via
  // a ref callback on the inner element below — wrap it in useRef + effect
  // so the registration happens once per mount.
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    registerSearchInputRef(searchInputRef.current)
    return () => registerSearchInputRef(null)
  }, [registerSearchInputRef])

  // Ontology classes — derived by the caller from the live entity payload
  // (see UnifiedViewer.tsx classOptions). Wave 3 checkpoint replaced the
  // separate /api/v1/ontology/classes fetch with this prop-driven list so
  // the togglable classes correspond 1:1 with classes present in the data.
  const classes = classOptions

  // Width contract: w-64 expanded, w-12 collapsed (UI-SPEC § Layout Contract row 3).
  const widthClass = collapsed ? 'w-12' : 'w-64'

  if (collapsed) {
    return (
      <aside
        data-testid="viewer-filter-rail"
        className={`${widthClass} bg-card border-r border-border p-2 flex flex-col items-center gap-2`}
      >
        <IconButton
          icon={ChevronRight}
          ariaLabel="Show filters"
          onClick={() => {
            setCollapsed(false)
            Logger.info(Logger.Categories.FILTERS, 'Filter rail expanded')
          }}
          data-testid="filter-rail-toggle"
        />
        <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
      </aside>
    )
  }

  return (
    <aside
      data-testid="viewer-filter-rail"
      className={`${widthClass} bg-card border-r border-border p-4 overflow-y-auto space-y-4`}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Filters
        </div>
        <IconButton
          icon={ChevronLeft}
          ariaLabel="Hide filters"
          onClick={() => {
            setCollapsed(true)
            Logger.info(Logger.Categories.FILTERS, 'Filter rail collapsed')
          }}
          data-testid="filter-rail-toggle"
        />
      </div>

      <div>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => {
            setSearch(e.target.value)
            Logger.debug(Logger.Categories.FILTERS, `Search: "${e.target.value}"`)
          }}
          placeholder="Search entities..."
          data-testid="filter-search"
          aria-label="Search by name or description (/)"
          className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Level</div>
          <SelectAllNone
            allLabel="All"
            noneLabel="None"
            onAll={() => {
              setVisibleLevels(new Set<Level>([0, 1, 2, 3]))
              Logger.info(Logger.Categories.FILTERS, 'Selected all levels')
            }}
            onNone={() => {
              setVisibleLevels(new Set<Level>())
              Logger.info(Logger.Categories.FILTERS, 'Cleared all levels')
            }}
          />
        </div>
        <div className="space-y-1">
          {LEVELS.map(({ value, label }) => {
            const checked = visibleLevels.has(value)
            return (
              <label
                key={value}
                className="flex items-center gap-2 text-sm cursor-pointer"
                data-testid={`filter-level-${value}`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => {
                    toggleLevel(value)
                    Logger.info(
                      Logger.Categories.FILTERS,
                      `Level ${label} ${checked ? 'hidden' : 'shown'}`,
                    )
                  }}
                  aria-label={label}
                />
                <span>{label}</span>
              </label>
            )
          })}
        </div>
      </div>

      <div className="space-y-2" data-testid="filter-class-section">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Class</div>
          <SelectAllNone
            allLabel="All"
            noneLabel="None"
            disabled={classes.length === 0}
            onAll={() => {
              setSelectedClasses(new Set(classes))
              Logger.info(
                Logger.Categories.FILTERS,
                `Selected all ${classes.length} classes`,
              )
            }}
            onNone={() => {
              setSelectedClasses(new Set<string>())
              Logger.info(Logger.Categories.FILTERS, 'Cleared all classes')
            }}
          />
        </div>
        {classes.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="filter-class-empty">
            No classes available.
          </p>
        )}
        <ClassList
          classes={classes}
          selected={selectedClasses}
          onToggle={(name) => {
            toggleClass(name)
            Logger.info(Logger.Categories.FILTERS, `Class toggled: ${name}`)
          }}
        />
      </div>
    </aside>
  )
}

interface SelectAllNoneProps {
  allLabel: string
  noneLabel: string
  disabled?: boolean
  onAll: () => void
  onNone: () => void
}

function SelectAllNone({ allLabel, noneLabel, disabled, onAll, onNone }: SelectAllNoneProps) {
  const base =
    'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ' +
    'text-muted-foreground hover:text-foreground hover:bg-accent ' +
    'disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center gap-1" data-testid="filter-select-all-none">
      <button
        type="button"
        onClick={onAll}
        disabled={disabled}
        className={base}
        aria-label={`Select ${allLabel}`}
      >
        {allLabel}
      </button>
      <span className="text-[10px] text-muted-foreground">·</span>
      <button
        type="button"
        onClick={onNone}
        disabled={disabled}
        className={base}
        aria-label={`Select ${noneLabel}`}
      >
        {noneLabel}
      </button>
    </div>
  )
}

interface ClassListProps {
  classes: readonly string[]
  selected: ReadonlySet<string>
  onToggle: (name: string) => void
}

function ClassList({ classes, selected, onToggle }: ClassListProps) {
  // Empty selected set = "all classes visible" per T-45-03-03 mitigation.
  // We never seed defaults from a hardcoded list — only the live set
  // derived from the entity payload. Surface this via a debug log so the
  // operator knows the empty-set means everything is in scope.
  useEffect(() => {
    if (selected.size === 0 && classes.length > 0) {
      Logger.debug(
        Logger.Categories.FILTERS,
        `Class filter empty — showing all ${classes.length} classes`,
      )
    }
  }, [selected.size, classes.length])

  if (classes.length === 0) return null

  return (
    <div className="max-h-60 overflow-y-auto space-y-1" data-testid="filter-class-list">
      {classes.map((name) => {
        const isSelected = selected.has(name)
        return (
          <label
            key={name}
            className="flex items-center gap-2 text-sm cursor-pointer"
            data-testid={`filter-class-${name}`}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle(name)}
              aria-label={name}
            />
            <span className="truncate">{name}</span>
          </label>
        )
      })}
    </div>
  )
}
