// PATTERN SOURCE: 45-RESEARCH.md § Pattern 1 (lines 367-384)
//
// CRITICAL: key={system} guarantees full unmount on system switch.
// React unmounts the entire subtree (including module-scoped Zustand
// state read by hooks under this tree) and remounts it fresh, so NO
// state can leak across /viewer/coding -> /viewer/okb transitions
// (Pitfall 2 lock).
//
// ViewerCore composes the layout shell. The GraphCanvas region renders
// the live <SigmaCanvas/> (Plan 02). FilterRail and SidePanel remain
// stubs until Plan 03 lands.

import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { isValidSystem, SYSTEM_ENDPOINTS, SYSTEM_LABELS, type System } from '@/config/system-endpoints'
import { ApiClient } from '@/api/ApiClient'
import { SigmaCanvas } from '@/graph/SigmaCanvas'
import { UnknownSystem } from './UnknownSystem'

interface ViewerCoreProps {
  system: System
  apiClient: ApiClient
}

function ViewerCore({ system, apiClient }: ViewerCoreProps) {
  const label = SYSTEM_LABELS[system]
  const baseUrl = apiClient.base
  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <nav
        className="h-16 bg-secondary border-b border-border flex items-center px-4"
        data-testid="viewer-navbar"
      >
        <div className="font-bold text-base">Unified Viewer</div>
        <h1 className="ml-6 text-lg font-semibold" data-testid="viewer-wordmark">
          {label}
        </h1>
        <div className="ml-auto text-xs text-muted-foreground" data-testid="viewer-baseurl">
          {baseUrl}
        </div>
      </nav>
      <div className="flex flex-1 overflow-hidden">
        <aside
          className="w-64 bg-card border-r border-border p-4 overflow-y-auto"
          data-testid="viewer-filter-rail"
        >
          <div className="text-xs font-medium text-muted-foreground">Filter Rail</div>
          <div className="mt-2 text-sm text-muted-foreground">
            (Plan 03 wires this — search + level + class filters.)
          </div>
        </aside>
        <main
          className="flex-1 bg-background overflow-hidden relative"
          data-testid="viewer-canvas"
        >
          <SigmaCanvas apiClient={apiClient} system={system} />
        </main>
        <aside
          className="w-96 bg-card border-l border-border p-4 overflow-y-auto"
          data-testid="viewer-side-panel"
        >
          <div className="text-xs font-medium text-muted-foreground">Side Panel</div>
          <div className="mt-2 text-sm text-muted-foreground">
            (Plans 03-05 wire entity detail + markdown + RCA panels.)
          </div>
        </aside>
      </div>
      <footer className="h-8 border-t border-border text-xs text-muted-foreground flex items-center px-4" data-testid="viewer-footer">
        Phase 45 unified viewer — scaffold landing (Plan 01)
      </footer>
    </div>
  )
}

export function UnifiedViewer() {
  const { system } = useParams<{ system: string }>()
  // Memoize the ApiClient per :system. Without this, every render of
  // UnifiedViewer produced a new instance, which propagated as an
  // unstable dependency into GraphSetup's useEffect — re-firing on every
  // render and tripping React's max-update-depth guard.
  const apiClient = useMemo(
    () => (isValidSystem(system) ? new ApiClient(SYSTEM_ENDPOINTS[system]) : null),
    [system],
  )
  if (!isValidSystem(system) || !apiClient) {
    return <UnknownSystem />
  }
  return <ViewerCore key={system} system={system} apiClient={apiClient} />
}
