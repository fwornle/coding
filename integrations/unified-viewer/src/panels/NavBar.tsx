// PATTERN SOURCE: 45-PATTERNS.md § NavBar.tsx + 55-PATTERNS.md § NavBar.tsx (EXTEND)
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 1 (sticky top-0 h-16)
//   + § Icon-only controls (Theme toggle, Keyboard help)
//   + § Typography — active NavLink uses font-bold + accent underline
//     (sole display-weight exception per UI-SPEC)
//   + 55-UI-SPEC.md §9 — Mode switch (Knowledge Graph ↔ Issue Triage),
//     hidden when `entities.length === 0`; Triage item hidden when entity
//     set lacks `Incident`/`FailureIncident` types.

import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Keyboard, Moon, Sun } from 'lucide-react'
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
