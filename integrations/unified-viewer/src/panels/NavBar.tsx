// PATTERN SOURCE: 45-PATTERNS.md § NavBar.tsx + 55-PATTERNS.md § NavBar.tsx (EXTEND)
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 1 (sticky top-0 h-16)
//   + § Icon-only controls (Theme toggle, Keyboard help)
//   + § Typography — active NavLink uses font-bold + accent underline
//     (sole display-weight exception per UI-SPEC)
//   + 55-UI-SPEC.md §9 — Mode switch (Knowledge Graph ↔ Issue Triage),
//     hidden when `entities.length === 0`; Triage item hidden when entity
//     set lacks `Incident`/`FailureIncident` types.
//   + 55-UI-SPEC.md §13.3 + 55-12-PLAN.md Task 3 — coding-only 📡 ETM tail
//     trigger; aria-label flips between Open/Close observation stream;
//     badge shows unread observation count (last 30s, since the sheet last
//     closed) when the sheet is closed.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Keyboard, Moon, Radio, Sun, Workflow } from 'lucide-react'
import { SYSTEM_LABELS, VALID_SYSTEMS, type System } from '@/config/system-endpoints'
import { IconButton } from '@/components/IconButton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useViewerStore, type ViewerMode } from '@/store/viewer-store'
import type { Entity } from '@/api/ApiClient'
import { Logger } from '@/lib/logging'

export interface NavBarProps {
  /**
   * Called by the Keyboard-help IconButton click. Wired by ViewerCore to
   * the same setter that the `?` keyboard shortcut uses.
   */
  onOpenHelpDialog: () => void
  /**
   * Current entity set — drives the visibility predicates for the Mode
   * ToggleGroup (UI-SPEC §9). Pass `[]` to hide the toggle entirely.
   */
  entities?: ReadonlyArray<Entity>
}

// Phase 55 — predicate used to decide whether the Issue Triage mode is
// applicable. Mirrors 55-PATTERNS.md § IssueTriageView guidance.
function entitiesHaveIncidents(entities: ReadonlyArray<Entity>): boolean {
  return entities.some((e) => {
    const t = (e.entityType as string | undefined) ?? (e.ontologyClass as string | undefined) ?? ''
    return /incident|failureincident/i.test(t)
  })
}

function persistTheme(t: 'light' | 'dark') {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('viewer-theme', t)
  } catch {
    // ignore — quota / restricted contexts
  }
}

export function NavBar({ onOpenHelpDialog, entities = [] }: NavBarProps) {
  const params = useParams<{ system: string }>()
  const currentSystem = params.system as string | undefined
  const theme = useViewerStore((s) => s.theme)
  const setTheme = useViewerStore((s) => s.setTheme)
  const mode = useViewerStore((s) => s.mode)
  const setMode = useViewerStore((s) => s.setMode)

  // Phase 55-12 — ETM tail trigger (coding-only).
  const etmSheetOpen = useViewerStore((s) => s.etmSheetOpen)
  const setEtmSheetOpen = useViewerStore((s) => s.setEtmSheetOpen)
  const etmObservations = useViewerStore((s) => s.etmObservations)
  // Track the id of the newest observation seen the last time the sheet was
  // open — so the badge count only counts truly-unread items. Defaults to
  // null on first mount; after the sheet opens (or closes), we snapshot the
  // newest id and zero the badge.
  const [lastSeenObsId, setLastSeenObsId] = useState<string | null>(null)
  const lastSheetOpenRef = useRef(etmSheetOpen)

  useEffect(() => {
    if (etmSheetOpen && !lastSheetOpenRef.current) {
      // Sheet just opened — record what the user has now seen.
      setLastSeenObsId(etmObservations[0]?.id ?? null)
    }
    lastSheetOpenRef.current = etmSheetOpen
  }, [etmSheetOpen, etmObservations])

  const unreadCount = useMemo(() => {
    if (etmSheetOpen) return 0
    if (lastSeenObsId === null) {
      // Initial state — count all observations that arrived recently (last 30s).
      const cutoff = Date.now() - 30_000
      return etmObservations.filter((o) => {
        const t = Date.parse(o.timestamp)
        return Number.isFinite(t) ? t >= cutoff : true
      }).length
    }
    const seenIdx = etmObservations.findIndex((o) => o.id === lastSeenObsId)
    if (seenIdx === -1) {
      // Last seen scrolled off the ring buffer — count all observations
      // since they're all newer than what the user saw.
      return etmObservations.length
    }
    return seenIdx
  }, [etmSheetOpen, etmObservations, lastSeenObsId])

  const hasEntities = entities.length > 0
  const hasIncidents = hasEntities && entitiesHaveIncidents(entities)

  // Sync the document root .dark class with the store's theme on mount
  // AND on every change. Previously the toggle only happened inside the
  // click handler, so if localStorage persisted 'dark' from a prior
  // session the store loaded 'dark' but `<html>` never got the `.dark`
  // class — visually the app stayed light, the Sun icon (= "currently
  // dark") was shown, and the first click visually did nothing while
  // flipping the store to 'light' and the icon to Moon.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const handleThemeToggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    persistTheme(next)
    // DOM sync now happens via the useEffect above; no inline toggle.
    Logger.info(Logger.Categories.PANELS, `Theme switched to ${next}`)
  }

  return (
    <nav
      data-testid="viewer-navbar"
      className="sticky top-0 z-20 h-16 bg-secondary border-b border-border flex items-center justify-between px-6"
    >
      <div className="flex items-center gap-6">
        <span data-testid="viewer-wordmark" className="text-2xl font-bold tracking-tight">
          Unified Viewer
        </span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4" data-testid="viewer-nav-links">
          {VALID_SYSTEMS.map((sys) => {
            const isActive = sys === currentSystem
            return (
              <Link
                key={sys}
                to={`/viewer/${sys}`}
                data-testid={`nav-link-${sys}`}
                data-active={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                className={
                  'text-sm transition-colors px-2 py-1 ' +
                  (isActive
                    ? 'font-bold text-primary underline underline-offset-4 decoration-2 decoration-primary'
                    : 'text-foreground/80 hover:text-foreground')
                }
                onClick={() => Logger.info(Logger.Categories.ROUTING, `NavBar → ${sys}`)}
              >
                {SYSTEM_LABELS[sys as System]}
              </Link>
            )
          })}
        </div>

        {hasEntities && (
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => {
              // Radix unsets the value to empty when the same item is clicked
              // again; preserve the current selection in that case.
              if (!v) return
              setMode(v as ViewerMode)
              Logger.info(Logger.Categories.PANELS, `Mode switched to ${v}`)
            }}
            variant="outline"
            size="sm"
            data-testid="viewer-mode-toggle"
            aria-label="View mode"
          >
            <ToggleGroupItem value="kg" aria-label="Knowledge Graph mode" data-testid="mode-item-kg">
              Knowledge Graph
            </ToggleGroupItem>
            {hasIncidents && (
              <ToggleGroupItem
                value="triage"
                aria-label="Issue Triage mode"
                data-testid="mode-item-triage"
              >
                Issue Triage
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        )}
      </div>

      <div className="flex items-center gap-2">
        {currentSystem === 'coding' && (
          <div className="relative">
            <IconButton
              icon={Radio}
              ariaLabel={
                etmSheetOpen ? 'Close observation stream' : 'Open observation stream'
              }
              tooltipText="Observation stream (t)"
              onClick={() => {
                const next = !etmSheetOpen
                setEtmSheetOpen(next)
                Logger.info(
                  Logger.Categories.PANELS,
                  `ETM tail sheet ${next ? 'opened' : 'closed'} via NavBar`,
                )
              }}
              data-testid="etm-tail-trigger"
            />
            {!etmSheetOpen && unreadCount > 0 && (
              <span
                data-testid="etm-tail-trigger-badge"
                className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-[10px] text-white font-semibold flex items-center justify-center pointer-events-none tabular-nums"
                aria-label={`${unreadCount} unread observations`}
              >
                {unreadCount}
              </span>
            )}
          </div>
        )}
        {/* 2026-06-11: renderer toggle — `d3` is the VKB-parity SVG view
            (default), `sigma` is the WebGL canvas used by OKB. Visible
            on the coding system so the user can A/B-compare both ports
            without a code change. */}
        <IconButton
          icon={Workflow}
          ariaLabel="Toggle graph renderer"
          tooltipText={
            useViewerStore.getState().renderer === 'd3'
              ? 'Renderer: D3 (click for Sigma)'
              : 'Renderer: Sigma (click for D3)'
          }
          onClick={() => {
            const next = useViewerStore.getState().renderer === 'd3' ? 'sigma' : 'd3'
            useViewerStore.setState({ renderer: next })
            Logger.info(Logger.Categories.STORE, `Renderer → ${next}`)
          }}
          data-testid="renderer-toggle"
        />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          ariaLabel="Toggle theme"
          tooltipText={theme === 'dark' ? 'Light' : 'Dark'}
          onClick={handleThemeToggle}
          data-testid="theme-toggle"
        />
        <IconButton
          icon={Keyboard}
          ariaLabel="Show keyboard shortcuts"
          tooltipText="Keyboard shortcuts (?)"
          onClick={onOpenHelpDialog}
          data-testid="keyboard-help-button"
        />
      </div>
    </nav>
  )
}
