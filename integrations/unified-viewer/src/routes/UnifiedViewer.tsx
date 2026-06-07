// PATTERN SOURCE: 45-RESEARCH.md § Pattern 1 (lines 367-384)
//
// CRITICAL: key={system} guarantees full unmount on system switch.
// React unmounts the entire subtree (including module-scoped Zustand
// state read by hooks under this tree) and remounts it fresh, so NO
// state can leak across /viewer/coding -> /viewer/okb transitions
// (Pitfall 2 lock).
//
// Plan 03 wires the full chrome: NavBar / FilterRail / SidePanel /
// Footer + global keyboard shortcuts + KeyboardHelpDialog + the State
// Contract surfaces. The graph canvas remains Plan 02's SigmaCanvas;
// Plan 03 just sits around it.

import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  isValidSystem,
  SYSTEM_ENDPOINTS,
  type System,
} from '@/config/system-endpoints'
import { ApiClient } from '@/api/ApiClient'
import { SigmaCanvas } from '@/graph/SigmaCanvas'
import { useGraphData } from '@/graph/useGraphData'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { KeyboardHelpDialog } from '@/components/KeyboardHelpDialog'
import { NavBar } from '@/panels/NavBar'
import { FilterRail } from '@/panels/FilterRail'
import { SidePanel } from '@/panels/SidePanel'
import { Footer } from '@/panels/Footer'
import {
  EmptyFilterState,
  EmptyNoDataState,
  EmptySearchState,
  ErrorCorsState,
  ErrorUnreachableState,
  InitialLoadingState,
} from '@/lib-domain/states'
import { UnknownSystem } from './UnknownSystem'
import { Logger } from '@/lib/logging'

interface ViewerCoreProps {
  system: System
  apiClient: ApiClient
}

function isCorsError(err: Error | null): boolean {
  if (!err) return false
  // Browser fetch throws TypeError "Failed to fetch" on CORS failures —
  // and the error message has no useful subclass marker, so a substring
  // match against the canonical wording is the best signal available.
  return /Failed to fetch/i.test(err.message)
}

function ViewerCore({ system, apiClient }: ViewerCoreProps) {
  const [helpDialogOpen, setHelpDialogOpen] = useState(false)

  // useKeyboardShortcuts mounts ONCE per ViewerCore — the per-system
  // key={system} remount in UnifiedViewer tears it down on system swap.
  const { registerSearchInputRef } = useKeyboardShortcuts({
    onOpenHelpDialog: () => setHelpDialogOpen(true),
    onCloseHelpDialog: () => {
      if (helpDialogOpen) {
        setHelpDialogOpen(false)
        return true
      }
      return false
    },
  })

  const { entities, relations, isLoading, error } = useGraphData(apiClient, system)

  const searchQuery = useViewerStore((s) => s.searchQuery)
  const visibleLevels = useViewerStore((s) => s.visibleLevels)
  const selectedClasses = useViewerStore((s) => s.selectedClasses)

  // Visible-count predicate — same rules computeNodeState uses (UI-SPEC).
  const visibleCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return entities.reduce((n, e) => {
      const levelOk =
        e.level === undefined ||
        visibleLevels.has(e.level as 0 | 1 | 2 | 3)
      const classOk =
        selectedClasses.size === 0 ||
        (typeof e.ontologyClass === 'string' && selectedClasses.has(e.ontologyClass))
      const searchOk =
        q.length === 0 ||
        e.name.toLowerCase().includes(q) ||
        (typeof e.description === 'string' && e.description.toLowerCase().includes(q))
      return n + (levelOk && classOk && searchOk ? 1 : 0)
    }, 0)
  }, [entities, searchQuery, visibleLevels, selectedClasses])

  const canvas = (() => {
    if (isLoading) return <InitialLoadingState system={system} />
    if (error) {
      const message = error.message
      Logger.error(Logger.Categories.API, `Graph fetch failed: ${message}`)
      if (isCorsError(error)) {
        return (
          <ErrorCorsState
            system={system}
            baseUrl={apiClient.base}
            onRetry={() => window.location.reload()}
          />
        )
      }
      return (
        <ErrorUnreachableState
          system={system}
          baseUrl={apiClient.base}
          onRetry={() => window.location.reload()}
        />
      )
    }
    if (entities.length === 0) {
      return <EmptyNoDataState system={system} />
    }
    if (visibleCount === 0) {
      // Distinguish search-empty (search query active) from filter-empty
      // (level/class filter eliminated everything). Both copy strings
      // come verbatim from UI-SPEC § Copywriting.
      if (searchQuery.trim().length > 0) {
        return <EmptySearchState query={searchQuery.trim()} />
      }
      return (
        <EmptyFilterState
          onClear={() => {
            // Reset is in-system: clears search + selectedClasses but keeps
            // visibleLevels so the user can re-toggle. (Plan 01 store contract.)
            useViewerStore.getState().reset()
            Logger.info(Logger.Categories.FILTERS, 'Cleared filters via Empty state')
          }}
        />
      )
    }
    return <SigmaCanvas apiClient={apiClient} system={system} />
  })()

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col h-screen bg-background text-foreground">
        <NavBar onOpenHelpDialog={() => setHelpDialogOpen(true)} />
        <div className="flex flex-1 overflow-hidden">
          <FilterRail
            apiClient={apiClient}
            registerSearchInputRef={registerSearchInputRef}
          />
          <main
            className="flex-1 bg-background overflow-hidden relative"
            data-testid="viewer-canvas"
          >
            {canvas}
          </main>
          <SidePanel apiClient={apiClient} system={system} />
        </div>
        <Footer total={entities.length} visible={visibleCount} edges={relations.length} />
        <KeyboardHelpDialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen} />
      </div>
    </TooltipProvider>
  )
}

export function UnifiedViewer() {
  const { system } = useParams<{ system: string }>()
  const apiClient = useMemo(
    () => (isValidSystem(system) ? new ApiClient(SYSTEM_ENDPOINTS[system]) : null),
    [system],
  )
  if (!isValidSystem(system) || !apiClient) {
    return <UnknownSystem />
  }
  return <ViewerCore key={system} system={system} apiClient={apiClient} />
}
