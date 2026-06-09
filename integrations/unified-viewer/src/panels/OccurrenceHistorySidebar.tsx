// PATTERN SOURCE: 55-PATTERNS.md § OccurrenceHistorySidebar.tsx
//                  VOKB HistorySidebar.tsx (145 lines, verbatim port — Redux → Zustand)
// CONTRACT: 55-09-PLAN.md Task 1 (Sidebar behaviors) + UI-SPEC §7 row 11 hybrid
//
// Renders the "recently-touched entities" sidebar WHEN no entity is selected
// (UI-SPEC §7 row 11 hybrid). Once a node is selected the sidebar disappears
// and EntityDetailPanel takes the same panel slot.
//
// Sort: by entity.updatedAt || entity.createdAt descending.
// Cap:  50 items (VOKB HistorySidebar.tsx:27-35 verbatim).
// Time: relative format Just now / Xm / Xh / Xd; falls back to absolute (locale date)
//       once an item is older than 7 days (VOKB HistorySidebar.tsx:45-68 mirror).
// Click: setSelectedNode(entity.id) — promotes the row to the active selection.

import { useMemo } from 'react'
import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useGraphData } from '@/graph/useGraphData'
import { useViewerStore } from '@/store/viewer-store'
import { LAYER_BADGE_CLASS } from '@/graph/vokb-palette'
import { Logger } from '@/lib/logging'

export interface OccurrenceHistorySidebarProps {
  apiClient: ApiClient
  system: System
}

const MAX_ITEMS = 50

/** Relative-timestamp formatter — VOKB HistorySidebar.tsx:45-68 verbatim. */
function formatRelative(iso: string | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const ageMs = Date.now() - t
  if (ageMs < 60_000) return 'Just now'
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`
  if (ageMs < 7 * 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`
  }
  // Fallback: locale-date prefix (year visible — satisfies the test that checks
  // for "2026" on the 60d-ago row).
  return new Date(t).toISOString().slice(0, 10)
}

export function OccurrenceHistorySidebar(_: OccurrenceHistorySidebarProps) {
  // Destructured for parity with EntityDetailPanel signature — useGraphData
  // is the consumer; the args themselves are referenced via the no-op cast
  // below to keep TS6133 silent.
  const { apiClient, system } = _
  void apiClient
  void system

  const { entities } = useGraphData(apiClient, system)
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
  const setSelectedNode = useViewerStore((s) => s.setSelectedNode)

  const historyItems = useMemo(() => {
    return [...entities]
      .sort((a, b) => {
        const ta = (a.updatedAt as string | undefined) || (a.createdAt as string | undefined) || ''
        const tb = (b.updatedAt as string | undefined) || (b.createdAt as string | undefined) || ''
        return tb.localeCompare(ta)
      })
      .slice(0, MAX_ITEMS)
  }, [entities])

  // UI-SPEC §7 row 11 — hide entire sidebar when an entity is selected.
  if (selectedNodeId !== null) return null

  return (
    <div
      data-testid="occurrence-history-sidebar"
      className="space-y-1 py-2"
      role="list"
    >
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-2">
        Recently touched
      </h3>
      {historyItems.map((entity) => {
        const layer = (entity.layer as string | undefined) ?? ''
        const badgeClass =
          LAYER_BADGE_CLASS[layer] ??
          'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
        const ts = (entity.updatedAt as string | undefined) ?? (entity.createdAt as string | undefined)
        return (
          <button
            key={entity.id}
            type="button"
            role="listitem"
            data-testid={`occurrence-row-${entity.id}`}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              setSelectedNode(entity.id)
              Logger.info(
                Logger.Categories.PANELS,
                `OccurrenceHistorySidebar → ${entity.id}`,
              )
            }}
          >
            <span className="flex-1 truncate">{entity.name}</span>
            <span
              data-testid="occurrence-layer-badge"
              className={`${badgeClass} text-[10px] rounded px-1.5 py-0.5`}
            >
              {entity.ontologyClass}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
              {formatRelative(ts)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
