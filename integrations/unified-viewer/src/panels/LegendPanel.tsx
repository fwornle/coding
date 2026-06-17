// PATTERN SOURCE: 60-02-PLAN.md Task 1 <action>
//   + 60-CONTEXT.md § D-05..D-08
//   + 55-UI-SPEC.md § 7 row 12 (Legend, collapsed by default at bottom of FilterRail)
//   + 55-UI-SPEC.md § 14 (Encoding mapping reference)
//
// Plan 60-02 (D-05): LegendPanel is now fully prop-driven. Every section is
// derived from the currently-rendered (post-filter) `entities` + `relations`.
// Color/shape lookups still source from `@/graph/vokb-palette` (EDGE_STYLES +
// LAYER_BADGE_CLASS) and `@/graph/color-fallback` (SHAPE_PALETTE/shapeFallback)
// — palette stays the source of truth for visual encoding; the Legend just
// selects from it.
//
// The previous (pre-60-02) revision shipped static seed arrays for shape
// swatches, source-authority samples, and relationship samples. Those were
// the OKB-only seeds that bled labels like the static run-diagnostic /
// doc-authority / RCA samples into the VKB tab regardless of what was
// actually on screen — fully removed in this rewrite.

import { useMemo } from 'react'
import { EDGE_STYLES, LAYER_BADGE_CLASS } from '@/graph/vokb-palette'
import { SHAPE_PALETTE, shapeFallback, classColor, type ShapeKind } from '@/graph/color-fallback'
import { deriveLayer, type Layer, type OntologyRegistryClass } from '@/graph/layer'
import type { Entity, Relation } from '@/api/ApiClient'

// Detect "is this class registered with a shape in SHAPE_PALETTE?" so the
// DOMAINS row can carry a tooltip when a class is unknown to the palette.
// Reads the palette directly so adding a new class to color-fallback.ts
// auto-extends the legend's known set — no second list to keep in sync.
function isRegisteredClass(cls: string): boolean {
  return Object.prototype.hasOwnProperty.call(SHAPE_PALETTE, cls)
}

interface DomainRow {
  className: string
  shape: ShapeKind
  color: string
  isFallback: boolean
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

interface ShapeIconProps {
  shape: ShapeKind
  color: string
}

function ShapeIcon({ shape, color }: ShapeIconProps) {
  // 14x14 viewBox so each shape sits visually balanced at 14px swatch size.
  const stroke = '#000'
  const strokeOpacity = 0.15
  switch (shape) {
    case 'circle':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="7" r="5.5" fill={color} stroke={stroke} strokeOpacity={strokeOpacity} />
        </svg>
      )
    case 'square':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <rect x="1.5" y="1.5" width="11" height="11" rx="1" fill={color} stroke={stroke} strokeOpacity={strokeOpacity} />
        </svg>
      )
    case 'diamond':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <polygon points="7,1 13,7 7,13 1,7" fill={color} stroke={stroke} strokeOpacity={strokeOpacity} />
        </svg>
      )
    case 'triangle':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <polygon points="7,1 13,12 1,12" fill={color} stroke={stroke} strokeOpacity={strokeOpacity} />
        </svg>
      )
    case 'hexagon':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <polygon points="3.5,1.5 10.5,1.5 13.5,7 10.5,12.5 3.5,12.5 0.5,7" fill={color} stroke={stroke} strokeOpacity={strokeOpacity} />
        </svg>
      )
  }
}

export interface LegendPanelProps {
  /** Rendered entities — the SAME post-filter set the canvas paints. D-05 contract. */
  entities: readonly Entity[]
  /** Rendered relations — the SAME post-filter set the canvas paints. D-05 contract. */
  relations: readonly Relation[]
  /** Optional ontology registry — when supplied, deriveLayer walks the extends-chain.
   *  When omitted, deriveLayer falls back to a direct-class match (Pattern/Insight). */
  ontologyRegistry?: readonly OntologyRegistryClass[]
  /** Optional className passthrough so the parent (FilterRail bottomSlot) can tweak margins. */
  className?: string
}

export function LegendPanel({
  entities,
  relations,
  ontologyRegistry,
  className,
}: LegendPanelProps) {
  // DOMAINS: distinct entity.ontologyClass values in render order.
  const domains = useMemo<readonly DomainRow[]>(() => {
    const seen = new Set<string>()
    const out: DomainRow[] = []
    for (const e of entities) {
      const cls = typeof e.ontologyClass === 'string' ? e.ontologyClass : ''
      if (!cls || seen.has(cls)) continue
      seen.add(cls)
      const isFallback = !isRegisteredClass(cls)
      const shape: ShapeKind = isFallback ? 'circle' : shapeFallback(cls)
      // Color resolution: registered classes use classColor (theme-independent
      // hex from color-fallback's hierarchy palette); fallback rows use neutral gray.
      const color = isFallback ? '#9ca3af' : classColor(cls, 'light')
      out.push({ className: cls, shape, color, isFallback })
    }
    return out
  }, [entities])

  // LAYERS: distinct deriveLayer() values across entities, preserved in
  // insertion order so a (evidence-first) set keeps evidence on top.
  const layers = useMemo<readonly Layer[]>(() => {
    const seen = new Set<Layer>()
    const out: Layer[] = []
    for (const e of entities) {
      const l = deriveLayer(
        e as { ontologyClass?: string; metadata?: { layer?: string }; layer?: string },
        ontologyRegistry,
      )
      if (!seen.has(l)) {
        seen.add(l)
        out.push(l)
      }
    }
    return out
  }, [entities, ontologyRegistry])

  // SOURCE: distinct truthy entity.metadata?.source values.
  const sources = useMemo<readonly string[]>(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const e of entities) {
      const meta = (e as { metadata?: { source?: unknown } }).metadata
      const src = meta?.source
      if (typeof src === 'string' && src.length > 0 && !seen.has(src)) {
        seen.add(src)
        out.push(src)
      }
    }
    return out
  }, [entities])

  // RELATIONSHIPS: distinct truthy relation.type values.
  const relTypes = useMemo<readonly string[]>(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of relations) {
      const t = typeof r.type === 'string' ? r.type : ''
      if (t && !seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
    return out
  }, [relations])

  return (
    <details
      data-testid="viewer-legend-panel"
      className={'group ' + (className ?? '')}
    >
      <summary className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none">
        Legend
      </summary>
      <div className="mt-1.5 space-y-3">
        {/* D-08 ordering: DOMAINS → LAYERS → SOURCE → RELATIONSHIPS.
            D-07: skip rendering a Section when its derived array is empty. */}

        {domains.length > 0 && (
          <Section title="Domains">
            {domains.map((d) => {
              const row = (
                <div
                  key={d.className}
                  className="flex items-center gap-2 text-[11px] text-foreground/80"
                  data-testid={`legend-domain-${d.className}`}
                  title={d.isFallback ? 'class without registered shape' : undefined}
                >
                  <ShapeIcon shape={d.shape} color={d.color} />
                  <span>{d.className}</span>
                  <span className="text-muted-foreground">({d.shape})</span>
                </div>
              )
              return row
            })}
          </Section>
        )}

        {layers.length > 0 && (
          <Section title="Layers">
            {layers.map((layer) => {
              const badgeClass = LAYER_BADGE_CLASS[layer]
              return (
                <div
                  key={layer}
                  className="flex items-center gap-2 text-[11px] text-foreground/80"
                  data-testid={`legend-layer-${layer}`}
                >
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeClass}`}>
                    {layer}
                  </span>
                </div>
              )
            })}
          </Section>
        )}

        {sources.length > 0 && (
          <Section title="Source">
            {sources.map((src) => (
              <div
                key={src}
                className="flex items-center gap-2 text-[11px] text-foreground/80"
                data-testid={`legend-source-${src}`}
              >
                <span>{src}</span>
              </div>
            ))}
          </Section>
        )}

        {relTypes.length > 0 && (
          <Section title="Relationships">
            {relTypes.map((type) => {
              const style = EDGE_STYLES[type]
              // Defensive: unknown relation types fall back to gray so the
              // legend stays clean instead of throwing.
              const color = style?.color ?? '#d1d5db'
              const dasharray = style?.dasharray ?? ''
              return (
                <div
                  key={type}
                  className="flex items-center gap-2 text-[11px] text-foreground/80"
                  data-testid={`legend-rel-${type}`}
                >
                  <svg width="32" height="10" viewBox="0 0 32 10" aria-hidden>
                    <line
                      x1="1"
                      y1="5"
                      x2="31"
                      y2="5"
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray={dasharray || undefined}
                    />
                  </svg>
                  <span>{type}</span>
                </div>
              )
            })}
          </Section>
        )}
      </div>
    </details>
  )
}

export default LegendPanel
