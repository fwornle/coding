// PATTERN SOURCE: 55-08-PLAN.md Task 1 + 55-PATTERNS.md § LayerFilter
// PORT-SPEC: _work/.../viewer/src/components/Filters/LayerFilter.tsx
//
// VOKB uses Redux dispatch → translated to Zustand selectors per Phase 45 convention.
// Empty selectedLayers = "all visible" semantic (UI-SPEC §10).
// Tailwind micro-type exception: count badges use text-[10px] (UI-SPEC §3).

import { useState, useMemo } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'
import { deriveLayer } from '@/graph/layer'
import type { Entity } from '@/api/ApiClient'

const LAYERS = [
  { value: 'evidence', label: 'Evidence', colorClass: 'text-blue-600' },
  { value: 'pattern', label: 'Pattern', colorClass: 'text-amber-600' },
] as const

export interface LayerFilterProps {
  entities: readonly Entity[]
  /**
   * Phase 60 Plan 01 (G1): ontology registry threaded into `deriveLayer` so
   * count badges match the visibility-predicate's Layer rule (single source
   * of truth — closes VKBUI-01 asymmetry). Optional: when undefined,
   * `deriveLayer` falls back to direct-class match (Pattern/Insight →
   * pattern), preserving today's L1 behaviour while the call sites are
   * updated to pass the registry.
   */
  ontologyRegistry?: readonly { name: string; parent?: string | null }[]
}

export function LayerFilter({ entities, ontologyRegistry }: LayerFilterProps) {
  const selectedLayers = useViewerStore((s) => s.selectedLayers)
  const toggleLayer = useViewerStore((s) => s.toggleLayer)
  const [collapsed, setCollapsed] = useState(false)

  // Per-layer counts derived from the entities prop. Uses the shared
  // `deriveLayer` helper so badges agree with the visibility-predicate's
  // Layer rule (Phase 60 Plan 01 G1 — VKBUI-01 fix).
  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of entities) {
      const layer = deriveLayer(
        e as unknown as { ontologyClass?: string; metadata?: { layer?: string }; layer?: string },
        ontologyRegistry,
      )
      map[layer] = (map[layer] || 0) + 1
    }
    return map
  }, [entities, ontologyRegistry])

  // Empty selection = "all visible" (UI-SPEC §10 filter composition rules)
  const isSelected = (layer: string) =>
    selectedLayers.length === 0 || selectedLayers.includes(layer)

  return (
    <div className="space-y-1" data-testid="filter-layer-section">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
      >
        <span>Layer</span>
        <span
          className={`transform transition-transform text-[8px] ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        >
          ▶
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-1">
          {LAYERS.map(({ value, label, colorClass }) => (
            <label
              key={value}
              className="flex items-center gap-2 cursor-pointer hover:bg-accent p-1 rounded"
              data-testid={`filter-layer-${value}`}
            >
              <Checkbox
                checked={isSelected(value)}
                onCheckedChange={() => {
                  toggleLayer(value)
                  Logger.info(
                    Logger.Categories.FILTERS,
                    `LayerFilter toggle: ${value}`,
                  )
                }}
                aria-label={label}
              />
              <span className={`text-xs flex-1 ${colorClass}`}>{label}</span>
              <span
                className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded tabular-nums"
                data-testid={`filter-layer-count-${value}`}
              >
                {counts[value] || 0}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
