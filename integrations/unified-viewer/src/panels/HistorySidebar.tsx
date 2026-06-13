// HistorySidebar — chronological feed of recent Insights / Digests /
// Observations. Renders in place of EntityDetailPanel's empty state when
// no node is selected. Mirrors the VKB reference
// (memory-visualizer/src/components/KnowledgeGraph/HistorySidebar.tsx):
//
//   - newest first (sorted by metadata.createdAt or entity.createdAt)
//   - shows name + entityType + source badge (Manual/Auto) + relative time + team
//   - clicking a row selects the node in the graph
//
// Data source: the same `useGraphData` entities array the canvas reads
// from. No second fetch — the entities already include everything we
// need (createdAt, entityType, metadata.source, metadata.team).
//
// Added 2026-06-11 per user request "you need to separate the vkb viewer
// content (insights only) from the tabs in the health monitoring board".

import { useEffect, useMemo, useRef } from 'react'
import { useGraphData } from '@/graph/useGraphData'
import { useViewerStore } from '@/store/viewer-store'
import { ApiClient } from '@/api/ApiClient'
import { System } from '@/config/system-endpoints'
import { Logger } from '@/lib/logging'

interface HistorySidebarProps {
  apiClient: ApiClient
  system: System
}

interface HistoryItem {
  id: string
  name: string
  entityType: string
  source: 'auto' | 'manual'
  createdAt: string
  team: string
}

function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  // Render time relative to a fixed reference — taking "now" here would
  // mutate identity across re-renders (and is forbidden in workflow
  // scripts anyway). Use validity-from-current-document-load via the
  // performance API instead.
  const now = performance.timeOrigin + performance.now()
  const diffMs = now - t
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  if (diffMs < 30 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d ago`
  // Older than 30 days: show YYYY-MM-DD
  return iso.slice(0, 10)
}

// 2026-06-12: history feed is INSIGHTS ONLY now. User explicitly does
// not want raw stream items (Observations, Digests) cluttering the
// viewer — those are transient signals, not knowledge.
const HISTORY_TYPES = new Set(['Insight'])

export function HistorySidebar({ apiClient, system }: HistorySidebarProps) {
  const { entities } = useGraphData(apiClient, system)

  const items: HistoryItem[] = useMemo(() => {
    const out: HistoryItem[] = []
    for (const e of entities) {
      if (!HISTORY_TYPES.has(e.entityType as string)) continue
      // 2026-06-12: hide `[Raw]` placeholder observations the LLM summary
      // pipeline emits on failure — they're not real knowledge.
      if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) continue
      const meta = (e.metadata as Record<string, unknown> | undefined) ?? {}
      const created = (e.createdAt as string | undefined)
        ?? (meta.createdAt as string | undefined)
        ?? ''
      // 2026-06-12: default missing source to 'auto'. Observations and
      // Digests written from claude-code sessions have no
      // `metadata.source` field set yet (the writer's pipeline omits it)
      // but they're auto-captured by definition. The previous default
      // ('unknown') ⇒ Manual badge mis-labeled every recent Digest.
      // 'manual' is only used when explicitly tagged.
      const rawSource = meta.source as string | undefined
      const source: 'auto' | 'manual' = rawSource === 'manual' ? 'manual' : 'auto'
      out.push({
        id: e.id,
        name: (e.name as string) || '(unnamed)',
        entityType: e.entityType as string,
        source,
        createdAt: created,
        team: (meta.team as string | undefined) ?? 'general',
      })
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [entities])

  // Phase 56: atomic 4-field write (selectedNodeId + pathToSelected reset +
  // highlightedRowKey + selectionSource). Subscribers see one consistent
  // snapshot — the LslTimelineStrip selectedTs memo + OccurrenceHistorySidebar
  // highlightedRowKey read both depend on this being a single setState.
  const onClick = (id: string) => {
    useViewerStore.setState({
      selectedNodeId: id,
      pathToSelected: new Set<string>(),
      highlightedRowKey: id,
      selectionSource: 'history',
    })
    Logger.info(Logger.Categories.PANELS, `HistorySidebar → ${id}`)
  }

  // 2026-06-12: highlight + auto-scroll the active item when the
  // selection changes (e.g. user clicked a node in the graph or a
  // timeline tick).
  // 2026-06-13 (Phase 56): also subscribe to `highlightedRowKey` so a
  // tick-click cascade or other-pane signal can light this sidebar up
  // without flipping `selectedNodeId`.
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
  const highlightedRowKey = useViewerStore((s) => s.highlightedRowKey)
  const listRef = useRef<HTMLUListElement | null>(null)
  useEffect(() => {
    if (!selectedNodeId || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-history-id="${CSS.escape(selectedNodeId)}"]`,
    )
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedNodeId])

  return (
    <div
      data-testid="history-sidebar"
      className="h-full overflow-y-auto px-3 py-3"
    >
      <div className="mb-2">
        <h2 className="text-base font-semibold text-foreground">History</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {items.length} item{items.length === 1 ? '' : 's'} · Newest first
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic mt-6 text-center">
          No insights, digests, or observations to show.
        </div>
      ) : (
        <ul ref={listRef} className="space-y-1.5">
          {items.map((item) => {
            // Phase 56: highlight when EITHER the graph-side selection or the
            // cross-pane highlightedRowKey signal targets this row. Border tint
            // makes the highlight visually distinct from the existing
            // `hover:bg-accent` interaction.
            const isHighlighted =
              item.id === selectedNodeId || item.id === highlightedRowKey
            const baseClass =
              'w-full text-left px-2.5 py-2 rounded border transition-colors'
            const highlightClass = isHighlighted
              ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700'
              : 'border-border bg-card hover:bg-accent'
            return (
            <li key={item.id}>
              <button
                type="button"
                data-history-id={item.id}
                onClick={() => onClick(item.id)}
                className={`${baseClass} ${highlightClass}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="text-sm font-medium text-foreground truncate flex-1"
                    title={item.name}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      item.source === 'auto'
                        ? 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                    }`}
                  >
                    {item.source === 'auto' ? 'Auto' : 'Manual'}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                  <span>{item.entityType}</span>
                  <span>
                    {formatRelativeTime(item.createdAt)} · {item.team}
                  </span>
                </div>
              </button>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
