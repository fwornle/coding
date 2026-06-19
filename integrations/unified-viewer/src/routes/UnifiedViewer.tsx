// PATTERN SOURCE: 45-RESEARCH.md § Pattern 1 (lines 367-384)
//   + 55-PATTERNS.md § routes/UnifiedViewer.tsx (EXTEND)
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
//
// Phase 55 Plan 07 extensions:
//   - StatsBar mounted between NavBar and the flex content row.
//   - LegendPanel mounted as the bottomSlot of FilterRail.
//   - mode-aware central canvas: kg → <SigmaCanvas/>, triage → lazy
//     <IssueTriageView/> (Plan 55-10 Task 2 swapped the lazy import here
//     from the 55-07 stub to the real Mode B canvas at
//     '@/routes/IssueTriageView').
//   - URL `?mode=triage` persistence via useSearchParams.
//   - Keyboard shortcut `m` flips the mode via setMode.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  isValidSystem,
  SYSTEM_ENDPOINTS,
  type System,
} from '@/config/system-endpoints'
import { ApiClient } from '@/api/ApiClient'
import { SigmaCanvas } from '@/graph/SigmaCanvas'
import { D3GraphCanvas } from '@/graph/D3GraphCanvas'
import { useGraphData } from '@/graph/useGraphData'
import { deriveLevel } from '@/graph/graph-builder'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { KeyboardHelpDialog } from '@/components/KeyboardHelpDialog'
import { NavBar } from '@/panels/NavBar'
import { FilterRail } from '@/panels/FilterRail'
import { SidePanel } from '@/panels/SidePanel'
import { Footer } from '@/panels/Footer'
import { StatsBar } from '@/panels/StatsBar'
import { LegendPanel } from '@/panels/LegendPanel'
import LslTimelineStrip from '@/panels/coding/LslTimelineStrip'
import EtmTailSheet from '@/panels/coding/EtmTailSheet'
import WorkflowStatusPanel from '@/panels/coding/WorkflowStatusPanel'
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

// Plan 55-10 Task 2 swap: the lazy import path moved from the 55-07 stub
// to '@/routes/IssueTriageView' (the real Mode B canvas). The stub file
// stays on disk per plan — only the import here is swapped (single-line
// edit per 55-10 PLAN.md key_links).
const IssueTriageView = lazy(() => import('@/routes/IssueTriageView'))

interface ViewerCoreProps {
  system: System
  apiClient: ApiClient
}

function entitiesHaveIncidents(entities: ReadonlyArray<{ entityType?: unknown; ontologyClass?: unknown }>): boolean {
  return entities.some((e) => {
    const t = ((e.entityType as string | undefined) ?? (e.ontologyClass as string | undefined) ?? '')
    return /incident|failureincident/i.test(t)
  })
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

  // E2E hook — Phase 56 Playwright spec drives selection via
  // window.__viewerStore.getState().setSelection({...}) / .clearSelection().
  // Same code path the in-tree click handlers use; avoids the unreliable
  // coordinate-based canvas hit-testing inside headless chromium when D3's
  // force layout is still settling. SSR guard mirrors viewer-store.ts:180-188.
  // Cleanup deletes the global on unmount so cross-system remounts don't
  // leak a stale reference.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.__viewerStore = useViewerStore
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__viewerStore
      }
    }
  }, [])

  const { entities, relations, isLoading, error } = useGraphData(apiClient, system)

  // Phase 55 — Zustand mode slice.
  const mode = useViewerStore((s) => s.mode)
  const setMode = useViewerStore((s) => s.setMode)
  // 2026-06-11: subscribe to the renderer flag so the NavBar toggle
  // remounts the central canvas reactively (D3 ↔ Sigma).
  const renderer = useViewerStore((s) => s.renderer)
  const [searchParams, setSearchParams] = useSearchParams()
  const hasIncidents = useMemo(() => entitiesHaveIncidents(entities), [entities])

  // Hydrate mode from `?mode=triage` URL param on first load (and on system
  // remount). Only honored if the entity set actually has incidents — per
  // UI-SPEC §9, the Triage mode is hidden entirely otherwise.
  useEffect(() => {
    const urlMode = searchParams.get('mode')
    if (urlMode === 'triage' && hasIncidents) {
      setMode('triage')
    } else if (urlMode === 'kg') {
      setMode('kg')
    }
    // No dep on setMode — Zustand setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasIncidents])

  // Persist mode → URL. Strip `?mode=kg` (the default) to keep the URL clean.
  useEffect(() => {
    const current = searchParams.get('mode')
    if (mode === 'triage' && current !== 'triage') {
      const next = new URLSearchParams(searchParams)
      next.set('mode', 'triage')
      setSearchParams(next, { replace: true })
    } else if (mode === 'kg' && current === 'triage') {
      const next = new URLSearchParams(searchParams)
      next.delete('mode')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Phase 55 keyboard shortcut `m` — toggles mode (no-op if hidden).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'm' && event.key !== 'M') return
      // Skip when an input or textarea has focus (same discipline as the
      // shared useKeyboardShortcuts hook).
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (entities.length === 0) return
      const next = mode === 'kg' ? 'triage' : 'kg'
      if (next === 'triage' && !hasIncidents) return // Triage hidden — no-op
      setMode(next)
      Logger.info(Logger.Categories.PANELS, `Mode keyboard toggle → ${next}`)
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mode, hasIncidents, entities.length, setMode])

  // Log fetch errors exactly once per error transition, not on every render.
  // Plan 03 wired Logger.error inline inside the canvas IIFE which fired
  // on every re-render while in the error state — the operator checkpoint
  // surfaced the resulting console spam.
  useEffect(() => {
    if (error) {
      Logger.error(Logger.Categories.API, `Graph fetch failed: ${error.message}`)
    }
  }, [error])

  // Derive the actual ontology classes present in the fetched entities so
  // FilterRail's "Class" section reflects reality. The km-core
  // /api/v1/ontology/classes endpoint returns a hardcoded 4-element list
  // (LearningArtifact / Observation / Digest / Insight) that doesn't
  // include the wave-analysis hierarchy classes (System / Project /
  // Component / SubComponent / Detail), so deriving from entities is the
  // only truthful representation until Plan 45-04 lands the display
  // overlay endpoint.
  const classOptions = useMemo<readonly string[]>(() => {
    const set = new Set<string>()
    for (const e of entities) {
      if (typeof e.ontologyClass === 'string' && e.ontologyClass.length > 0) {
        set.add(e.ontologyClass)
      }
    }
    return Array.from(set).sort()
  }, [entities])

  const searchQuery = useViewerStore((s) => s.searchQuery)
  const visibleLevels = useViewerStore((s) => s.visibleLevels)
  const selectedClasses = useViewerStore((s) => s.selectedClasses)

  // Auto-populate selectedClasses on first load. Plan 03 checkpoint
  // round 2 flipped the filter semantic from "empty Set = all visible"
  // to "what's checked is what's visible". To keep the default
  // experience as "everything shown", we seed selectedClasses with
  // every classOption on first load. Subsequent renders only top up
  // newly-discovered classes (data refresh) — never remove operator
  // selections.
  useEffect(() => {
    if (classOptions.length === 0) return
    const currentSel = useViewerStore.getState().selectedClasses
    const missing = classOptions.filter((c) => !currentSel.has(c))
    if (currentSel.size === 0) {
      useViewerStore.getState().setSelectedClasses(new Set(classOptions))
      Logger.info(
        Logger.Categories.FILTERS,
        `Auto-selected ${classOptions.length} classes on first load`,
      )
    } else if (missing.length > 0) {
      // Top up — new classes appeared in the data; add them to the
      // current selection so they're visible by default.
      const next = new Set(currentSel)
      for (const c of missing) next.add(c)
      useViewerStore.getState().setSelectedClasses(next)
      Logger.info(
        Logger.Categories.FILTERS,
        `Added ${missing.length} newly-discovered classes to selection`,
      )
    }
  }, [classOptions])

  // Visible-count predicate — mirrors the FULL D3GraphCanvas filter
  // pipeline so the Footer "Showing X of Y" actually changes when the
  // user toggles LearningSource / Teams / Layer / HideDocNodes. The
  // previous version only saw level/class/search, which is why every
  // other filter looked like it had no effect.
  const learningSource = useViewerStore((s) => s.learningSource)
  const selectedTeams = useViewerStore((s) => s.selectedTeams)
  const selectedLayers = useViewerStore((s) => s.selectedLayers)
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  const visibleCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return entities.reduce((n, e) => {
      // [Raw] placeholders are not real knowledge — match D3 viewer's hide.
      if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) return n
      // Observations + Digests are raw stream items — hide from the count
      // since the D3 viewer hides them too.
      const etype = (e as unknown as { entityType?: string }).entityType
      if (etype === 'Observation' || etype === 'Digest') return n
      const meta = (e.metadata as { team?: string; source?: string; layer?: string; doc?: boolean } | undefined) ?? {}
      // Teams
      if (selectedTeams.size > 0) {
        if (selectedTeams.has('__none__')) return n
        const team = meta.team ?? 'coding'
        if (!selectedTeams.has(team)) return n
      }
      // LearningSource (structural backbone exempt — same as graph-builder)
      if (learningSource && learningSource !== 'combined') {
        const ocls = e.ontologyClass
        const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
        if (!isStructural) {
          const isAuto = meta.source === 'auto' || meta.source === 'online'
          if (learningSource === 'online' && !isAuto) return n
          if (learningSource === 'batch' && isAuto) return n
        }
      }
      // Layer
      if (selectedLayers.includes('__none__')) return n
      if (selectedLayers.length > 0) {
        const layer = meta.layer ?? (e as unknown as { layer?: string }).layer
        const inferred = layer
          ?? (e.ontologyClass === 'Insight' || e.ontologyClass === 'Pattern' ? 'pattern' : 'evidence')
        if (!selectedLayers.includes(inferred)) return n
      }
      // Doc-nodes
      if (hideDocNodes) {
        const isDoc = meta.doc === true || e.ontologyClass === 'Documentation'
        if (isDoc) return n
      }
      // Class + Level + Search
      const level = e.level ?? deriveLevel(e.ontologyClass)
      const levelOk = level !== undefined && visibleLevels.has(level)
      const classOk =
        typeof e.ontologyClass === 'string' && selectedClasses.has(e.ontologyClass)
      const searchOk =
        q.length === 0 ||
        e.name.toLowerCase().includes(q) ||
        (typeof e.description === 'string' && e.description.toLowerCase().includes(q))
      return n + (levelOk && classOk && searchOk ? 1 : 0)
    }, 0)
  }, [entities, searchQuery, visibleLevels, selectedClasses, learningSource, selectedTeams, selectedLayers, hideDocNodes])

  const canvas = (() => {
    if (isLoading) return <InitialLoadingState system={system} />
    if (error) {
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
    // Mode-aware canvas: kg → SigmaCanvas; triage → lazy IssueTriageView
    // (Plan 55-10 Task 2 swapped from the 55-07 stub to the real view).
    if (mode === 'triage' && hasIncidents) {
      return (
        <Suspense
          fallback={
            <div
              data-testid="triage-suspense-fallback"
              className="flex items-center justify-center h-full text-sm text-muted-foreground"
            >
              Loading triage…
            </div>
          }
        >
          <IssueTriageView entities={entities} relations={relations} />
        </Suspense>
      )
    }
    // 2026-06-11: VKB-parity port — coding/VKB tab uses the D3 viewer
    // (verbatim port of memory-visualizer's GraphVisualization). OKB and
    // any other system stay on the sigma WebGL canvas. The user can flip
    // back to sigma via the NavBar renderer toggle.
    // NOTE: `renderer` is captured at parent-render time (see the
    // subscribed value at the top of this component) so the toggle
    // re-mounts the canvas reactively.
    const useD3 = system === 'coding' && renderer === 'd3'
    return useD3
      ? <D3GraphCanvas apiClient={apiClient} system={system} />
      : <SigmaCanvas apiClient={apiClient} system={system} />

  })()

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col h-screen bg-background text-foreground">
        <NavBar
          onOpenHelpDialog={() => setHelpDialogOpen(true)}
          entities={entities}
        />
        <StatsBar apiClient={apiClient} system={system} />
        <div className="flex flex-1 overflow-hidden">
          <FilterRail
            apiClient={apiClient}
            classOptions={classOptions}
            registerSearchInputRef={registerSearchInputRef}
            system={system}
            entities={entities}
            bottomSlot={<LegendPanel className="pt-2" entities={entities} relations={relations} hideLayers={system === 'coding'} />}
          />
          <main
            className="flex-1 bg-background overflow-hidden relative"
            data-testid="viewer-canvas"
          >
            {canvas}
          </main>
          <SidePanel apiClient={apiClient} system={system} />
        </div>
        {/* Phase 55-11: LslTimelineStrip (Surface #14) — coding-only.
            Mounted between the main content row and the Footer per UI-SPEC §6. */}
        {system === 'coding' && <LslTimelineStrip system={system} apiClient={apiClient} />}
        <Footer total={entities.length} visible={visibleCount} edges={relations.length} />
        {/* Phase 55-12: WorkflowStatusPanel (Surface #16) — coding-only.
            Mounted BELOW the Footer per UI-SPEC §13.4. */}
        {system === 'coding' && <WorkflowStatusPanel system={system} />}
        {/* Phase 55-12: EtmTailSheet (Surface #15) — coding-only overlay.
            Sheet is portaled by Radix; layout-neutral when closed. */}
        {system === 'coding' && <EtmTailSheet system={system} apiClient={apiClient} />}
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
