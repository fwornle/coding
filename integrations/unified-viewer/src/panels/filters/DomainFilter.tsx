// PATTERN SOURCE: 55-08-PLAN.md Task 1 + 55-PATTERNS.md § DomainFilter
// PORT-SPEC: _work/.../viewer/src/components/Filters/DomainFilter.tsx
//
// VOKB uses Redux dispatch → translated to Zustand selectors per Phase 45 convention.
// Coding-tab graceful degradation: if no entity in the visible set has a
// `.domain` field, render an italic muted "Domain filter not applicable
// for this system" message (UI-SPEC §7 row 3 — NOT a hard error).
// Empty selectedDomains = "all visible" semantic (UI-SPEC §10).

import { useState, useMemo } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'
import type { Entity } from '@/api/ApiClient'

const DOMAINS = [
  { value: 'raas', label: 'RaaS' },
  { value: 'kpifw', label: 'KPI-FW' },
  { value: 'general', label: 'General' },
] as const

export interface DomainFilterProps {
  entities: readonly Entity[]
}

export function DomainFilter({ entities }: DomainFilterProps) {
  const selectedDomains = useViewerStore((s) => s.selectedDomains)
  const toggleDomain = useViewerStore((s) => s.toggleDomain)
  const [collapsed, setCollapsed] = useState(false)

  // Detect whether the visible entity set has ANY `.domain` field.
  // If none, fall back to the graceful-degradation message (UI-SPEC §7 row 3).
  const hasAnyDomainField = useMemo(() => {
    for (const e of entities) {
      const d = (e as { domain?: unknown }).domain
      if (typeof d === 'string' && d.length > 0) return true
    }
    return false
  }, [entities])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of entities) {
      const domain = (e as { domain?: string }).domain || 'general'
      map[domain] = (map[domain] || 0) + 1
    }
    return map
  }, [entities])

  const isSelected = (domain: string) =>
    selectedDomains.length === 0 || selectedDomains.includes(domain)

  return (
    <div className="space-y-1" data-testid="filter-domain-section">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
      >
        <span>Domain</span>
        <span
          className={`transform transition-transform text-[8px] ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        >
          ▶
        </span>
      </button>
      {!collapsed && !hasAnyDomainField && (
        <p
          className="text-xs italic text-muted-foreground px-1 py-1 leading-tight"
          data-testid="filter-domain-not-applicable"
        >
          Domain filter not applicable for this system
        </p>
      )}
      {!collapsed && hasAnyDomainField && (
        <div className="space-y-1">
          {DOMAINS.map(({ value, label }) => (
            <label
              key={value}
              className="flex items-center gap-2 cursor-pointer hover:bg-accent p-1 rounded"
              data-testid={`filter-domain-${value}`}
            >
              <Checkbox
                checked={isSelected(value)}
                onCheckedChange={() => {
                  toggleDomain(value)
                  Logger.info(
                    Logger.Categories.FILTERS,
                    `DomainFilter toggle: ${value}`,
                  )
                }}
                aria-label={label}
              />
              <span className="text-xs flex-1 text-foreground">{label}</span>
              <span
                className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded tabular-nums"
                data-testid={`filter-domain-count-${value}`}
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
