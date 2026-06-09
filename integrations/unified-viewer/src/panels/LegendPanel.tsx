// PATTERN SOURCE: 55-PATTERNS.md § LegendPanel.tsx
//   + 55-07-PLAN.md Task 1
//   + 55-UI-SPEC.md § 7 row 12 (Legend, collapsed by default at bottom of FilterRail)
//   + 55-UI-SPEC.md § 14 (Encoding mapping reference)
//
// All swatch colors source from `@/graph/vokb-palette` (Plan 55-03). All
// shape data sources from the SHAPE_PALETTE in `@/graph/color-fallback`
// (Plan 55-05).
//
// IMPORTANT — 55-05 renderer v1 stub note:
//   The Sigma renderer ships v1 with all 5 shape keys mapped to
//   NodeCircleProgram (see 55-05-SUMMARY.md "Known Stubs"). That means
//   the canvas itself renders every node as a circle today; the shape
//   attribute IS stamped on every node and the program map IS registered,
//   awaiting a follow-up GLSL plan. Until then the LegendPanel renders
//   shape swatches as inline SVG so users see the encoded distinction
//   even when the canvas falls back to circles.

import { EDGE_STYLES, LAYER_BADGE_CLASS } from '@/graph/vokb-palette'

// Shape swatch metadata — picks 5 representative ontology classes covering
// every shape primitive. Color is the canvas fill from UI-SPEC §14 table.
interface ShapeSwatch {
  className: string
  shape: 'circle' | 'diamond' | 'square' | 'triangle' | 'hexagon'
  color: string
}

const SHAPE_SWATCHES: ReadonlyArray<ShapeSwatch> = [
  { className: 'Project',            shape: 'hexagon',  color: '#0ea5e9' }, // sky-500
  { className: 'Component',          shape: 'square',   color: '#3b82f6' }, // blue-500
  { className: 'Detail',             shape: 'circle',   color: '#93c5fd' }, // blue-300
  { className: 'Digest',             shape: 'diamond',  color: '#f59e0b' }, // amber-500
  { className: 'RuntimeDiagnostics', shape: 'triangle', color: '#ef4444' }, // red-500
]

// Source-authority stroke samples — verbatim VOKB encoding from
// vokb-palette nodeStroke + nodeStrokeWidth + nodeStrokeDasharray.
interface SourceSample {
  label: string
  stroke: string
  strokeWidth: number
  dasharray: string
}

const SOURCE_SAMPLES: ReadonlyArray<SourceSample> = [
  { label: 'Official doc',   stroke: '#10b981', strokeWidth: 3,   dasharray: '' },     // emerald-500 width 3
  { label: 'Team knowledge', stroke: '#14b8a6', strokeWidth: 2.5, dasharray: '' },     // teal-500 width 2.5
  { label: 'User input',     stroke: '#a78bfa', strokeWidth: 2.5, dasharray: '4,2' },  // violet-400 dashed
  { label: 'Automated RCA',  stroke: '#4b5563', strokeWidth: 2,   dasharray: '' },     // gray-600 (default)
]

// Pick a subset of EDGE_STYLES to keep the relationship section legible
// (28+ edge types would overflow the panel). One sample per semantic group
// per the vokb-palette §VOKB Edge style table.
const RELATIONSHIP_SAMPLES: ReadonlyArray<{ type: string; label: string }> = [
  { type: 'PART_OF',         label: 'Structural (PART_OF)' },
  { type: 'CAUSED_BY',       label: 'Causal (CAUSED_BY)' },
  { type: 'INDICATES',       label: 'Causal dashed (INDICATES)' },
  { type: 'OBSERVED_IN',     label: 'Operational (OBSERVED_IN)' },
  { type: 'MANAGED_BY',      label: 'Operational dashed (MANAGED_BY)' },
  { type: 'READS',           label: 'Data flow (READS)' },
  { type: 'USES',            label: 'Data flow dashed (USES)' },
  { type: 'RESOLVES',        label: 'Resolution (RESOLVES)' },
  { type: 'MATCHES',         label: 'Resolution dashed (MATCHES)' },
  { type: 'CORRELATED_WITH', label: 'Association (CORRELATED_WITH)' },
  { type: 'RELATES_TO',      label: 'Default (RELATES_TO)' },
]

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
  shape: ShapeSwatch['shape']
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
  /** Optional className passthrough so the parent (FilterRail) can tweak margins. */
  className?: string
}

export function LegendPanel({ className }: LegendPanelProps = {}) {
  return (
    <details
      data-testid="viewer-legend-panel"
      className={'group ' + (className ?? '')}
    >
      <summary className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none">
        Legend
      </summary>
      <div className="mt-1.5 space-y-3">
        <Section title="Domains">
          {/* 5 representative classes covering every shape primitive. v1 note:
              Sigma renderer falls back to circle for non-circle shapes; this
              SVG legend is the source of truth for the encoded shape mapping
              until the custom GLSL programs ship. */}
          {SHAPE_SWATCHES.map((sw) => (
            <div
              key={sw.className}
              className="flex items-center gap-2 text-[11px] text-foreground/80"
              data-testid={`legend-domain-${sw.className}`}
            >
              <ShapeIcon shape={sw.shape} color={sw.color} />
              <span>{sw.className}</span>
              <span className="text-muted-foreground">({sw.shape})</span>
            </div>
          ))}
        </Section>

        <Section title="Layers">
          {/* Layer color chips sourced from LAYER_BADGE_CLASS (vokb-palette). */}
          {Object.entries(LAYER_BADGE_CLASS).map(([layer, badgeClass]) => (
            <div
              key={layer}
              className="flex items-center gap-2 text-[11px] text-foreground/80"
              data-testid={`legend-layer-${layer}`}
            >
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeClass}`}>
                {layer}
              </span>
            </div>
          ))}
        </Section>

        <Section title="Source">
          {SOURCE_SAMPLES.map((sample) => (
            <div
              key={sample.label}
              className="flex items-center gap-2 text-[11px] text-foreground/80"
              data-testid={`legend-source-${sample.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden>
                <circle
                  cx="12"
                  cy="7"
                  r="5"
                  fill="#fff"
                  stroke={sample.stroke}
                  strokeWidth={sample.strokeWidth}
                  strokeDasharray={sample.dasharray || undefined}
                />
              </svg>
              <span>{sample.label}</span>
            </div>
          ))}
        </Section>

        <Section title="Relationships">
          {RELATIONSHIP_SAMPLES.map(({ type, label }) => {
            const style = EDGE_STYLES[type]
            // Defensive: if a planner-picked edge type leaves EDGE_STYLES,
            // fall back to a gray line so the legend still renders cleanly.
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
                <span>{label}</span>
              </div>
            )
          })}
        </Section>
      </div>
    </details>
  )
}

export default LegendPanel
