// PATTERN SOURCE: 55-PATTERNS.md § EntityIdentityHeader.tsx
// CONTRACT: 55-09-PLAN.md Task 1 (Identity behaviors) + UI-SPEC §11 width harmonization
//
// Shared identity-header chip block consumed by BOTH:
//   - EntityDetailPanel (Default sub-tab + every sub-tab carries this header)
//   - MarkdownViewerPanel (mounted above the markdown body)
//
// Renders:
//   - <h2 entity.name> in text-xl font-semibold
//   - Class chip (border = classColor(className, theme))
//   - Meta row in text-xs text-muted-foreground tabular-nums:
//     L{level} · parent · created · last confirmed
// Missing fields render `—` (never blank) per UI-SPEC §16 row "Missing value placeholder".

import { Badge } from '@/components/ui/badge'
import { classColor } from '@/graph/color-fallback'
import type { Entity } from '@/graph/types'

export interface EntityIdentityHeaderProps {
  entity: Entity
  theme: 'light' | 'dark'
}

/** Shared chip block — see file header for contract. */
export function EntityIdentityHeader({ entity, theme }: EntityIdentityHeaderProps) {
  const className = entity.ontologyClass ?? 'Unclassified'
  const borderColor = classColor(className, theme)
  const level = entity.level !== undefined ? `L${entity.level}` : 'L—'
  const parent = (entity.parent as string | undefined) ?? '—'
  // 2026-06-12: render timestamps in the viewer's local timezone. Raw
  // UTC ISO strings (`2026-06-12T05:28:07.593Z`) were confusing on a
  // CEST host where the wall clock showed 07:28.
  const fmtLocal = (iso: string | undefined): string => {
    if (!iso) return '—'
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return iso
    const d = new Date(t)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
      + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  const createdAt = fmtLocal(entity.createdAt as string | undefined)
  const lastConfirmedAt = fmtLocal(entity.lastConfirmedAt as string | undefined)

  return (
    <header className="space-y-2" data-testid="entity-identity-header">
      <h2
        data-testid="identity-name"
        className="text-xl font-semibold text-foreground"
      >
        {entity.name}
      </h2>
      <Badge
        variant="outline"
        style={{ borderColor }}
        data-testid="identity-class-badge"
      >
        {className}
      </Badge>
      <div
        data-testid="identity-meta"
        className="text-xs text-muted-foreground tabular-nums flex flex-wrap gap-3"
      >
        <span>{level}</span>
        <span>parent: {parent}</span>
        <span>created {createdAt}</span>
        <span>last confirmed {lastConfirmedAt}</span>
      </div>
    </header>
  )
}
