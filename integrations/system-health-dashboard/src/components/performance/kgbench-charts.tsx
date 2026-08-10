import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
  ResponsiveContainer, Cell,
} from 'recharts'
import { useIsDark } from '@/lib/colors'
import type { KgbenchReport, KgbenchStats } from '@/store/slices/kgbenchSlice'

// The benchmark's two headline figures, rendered live from report.json.
//
// They are the on-screen counterparts of the two SVGs the published report embeds
// (kgbench-correctness-*.svg, kgbench-cost-*.svg), redrawn here rather than embedded because
// those files exist only for runs somebody has already published — and the point of this view
// is to see a matrix BEFORE that.
//
// COLOR IS COMPUTED, NOT CHOSEN. Both palettes were run through the dataviz validator
// (lightness band, chroma floor, adjacent-pair CVD separation, normal-vision floor, contrast)
// against the light and dark chart surfaces, and each is the nearest passing set to the
// dashboard's existing chart hues. The light palette carries a contrast WARN on three slots,
// which obliges either visible labels or a table view: the cost panels are directly labelled,
// and every figure on this page sits directly above the table of the same numbers.
//
// Do not "simplify" these into one shared list. The dark steps are SELECTED for the dark
// surface, not an automatic lightening of the light ones — an auto-flip fails the band check.
const ARM_COLORS_LIGHT = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#84cc16']
const ARM_COLORS_DARK = ['#4a8fe0', '#c2870f', '#159c72', '#8b6ae6', '#d4468a', '#5f8f14']

// Fixed order matching the report's tables and the difficulty gradient. Object key order
// would be arbitrary, and a chart whose x-axis reorders between runs cannot be compared.
const CLASS_ORDER = ['lookup', 'structural', 'blast', 'arch', 'abstain']

/**
 * Arm → color slot, assigned ONCE from the report's own arm list.
 *
 * Color follows the ENTITY, never its rank: `grep` is the same hue whether it wins or loses,
 * and stays that hue in every figure on the page. A palette indexed by sort position would
 * repaint the survivors whenever the data moved, which silently invalidates any comparison a
 * reader makes between two screenshots.
 */
function useArmColors(arms: string[]): Record<string, string> {
  const isDark = useIsDark()
  return useMemo(() => {
    const ramp = isDark ? ARM_COLORS_DARK : ARM_COLORS_LIGHT
    const map: Record<string, string> = {}
    arms.forEach((arm, i) => {
      // A 7th arm would be an unnamed generated hue, which the palette cannot vouch for.
      // Fold it to a neutral instead of inventing a color that has not been validated.
      map[arm] = i < ramp.length ? ramp[i] : (isDark ? '#8a8a86' : '#9ca3af')
    })
    return map
  }, [arms, isDark])
}

function useAxisTheme() {
  const isDark = useIsDark()
  return {
    grid: isDark ? '#2f2f2c' : '#e7e7e4',
    tick: isDark ? '#9c9c96' : '#6b6b66',
    // Marks sit on a 2px surface-colored ring so adjacent bars never fuse into one shape.
    surface: isDark ? '#1a1a19' : '#ffffff',
    isDark,
  }
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(Math.round(n))
}

function median(s: KgbenchStats | undefined | null): number | null {
  return s && Number.isFinite(s.median as number) ? (s.median as number) : null
}

function mean(s: KgbenchStats | undefined | null): number | null {
  return s && Number.isFinite(s.mean as number) ? (s.mean as number) : null
}

/**
 * The arm legend, rendered as plain HTML instead of recharts' `<Legend>`.
 *
 * Two things recharts got wrong that are not configurable away cleanly:
 *
 *   ORDER. Its legend lists series alphabetically (codegraph, graphify, grep, hybrid) while
 *   the bars sit in the report's arm order (grep, graphify, codegraph, hybrid). A legend whose
 *   sequence disagrees with the marks it labels is worse than none — the eye pairs the first
 *   swatch with the first bar and gets the wrong arm.
 *
 *   TEXT COLOR. It paints each label in its series color. Text wears text tokens; the swatch
 *   beside it already carries identity, and 11px type at a bar's contrast ratio is not legible
 *   the way a 40px block of the same color is.
 */
function ArmLegend({ arms, colors, tint }: { arms: string[]; colors: Record<string, string>; tint: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {arms.map((arm) => (
        <span key={arm} className="inline-flex items-center gap-1.5 text-xs" style={{ color: tint }}>
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[arm] }} />
          {arm}
        </span>
      ))}
    </div>
  )
}

/** Shared tooltip — text wears text tokens; the colored swatch carries identity. */
function ChartTooltip({
  active, payload, label, unit,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>
  label?: string
  unit: (v: number) => string
}) {
  const theme = useAxisTheme()
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-md border px-2.5 py-2 text-xs shadow-md"
      style={{ background: theme.surface, borderColor: theme.grid }}
    >
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.filter((p) => p.value != null).map((p, i) => {
        const med = p.payload?.[`med_${p.name}`]
        const n = p.payload?.[`n_${p.name}`]
        return (
          <div key={i} className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="text-foreground">{p.name}</span>
            <span className="ml-auto tabular-nums text-foreground">{unit(p.value as number)}</span>
            {/* The median travels with the mean so a reader can see the saturation the chart
                works around, instead of being left to trust that it exists. */}
            {typeof med === 'number' && <span className="tabular-nums">med {med.toFixed(2)}</span>}
            {typeof n === 'number' && <span className="tabular-nums">n={n}</span>}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Figure 1 — how correct each arm is, per question class.
 *
 * Grouped bars: the reader's question is "which arm is better, and does that depend on the
 * kind of question" — a comparison across two categorical dimensions at one measure. Scores
 * share one 0–1 scale, so one y-axis serves every group. No second axis, ever.
 *
 * IT PLOTS THE MEAN, AND THE TABLES BELOW LEAD WITH THE MEDIAN. That is a deliberate
 * disagreement, not an oversight. On the published x2 run every median is exactly 1.00 — all
 * four arms, all five classes, twenty out of twenty — because a clear majority of cells score
 * a perfect 1.0 and the median simply saturates. A median chart is therefore a flat wall at
 * the top of the axis: it is structurally incapable of showing the differences it exists to
 * show. The mean spans 0.67–1.00 over the same cells and carries the real finding (codegraph
 * answers lookup questions at 0.67 while everything else is at 1.00).
 *
 * The median is not discarded — it is in the hover, beside n, so the saturation is visible
 * rather than hidden. The tables keep leading with the median because for a headline number a
 * statistic that one bad cell cannot drag is the right one; for a CHART whose whole job is
 * comparison, a statistic that never moves is the wrong one.
 *
 * Values are NOT printed on all twenty bars — that is a wall of near-identical numbers. The
 * exact figures are one table down and the hover gives any single bar on demand.
 */
export function CorrectnessChart({ report }: { report: KgbenchReport }) {
  const theme = useAxisTheme()
  const arms = useMemo(() => Object.keys(report.byArm ?? {}), [report])
  const colors = useArmColors(arms)

  const data = useMemo(() => {
    const byClass = report.byClass ?? {}
    const present = Object.keys(byClass)
    const classes = [...CLASS_ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !CLASS_ORDER.includes(c))]
    const rows = classes.map((cls) => {
      const row: Record<string, string | number | null> = { group: cls }
      for (const arm of arms) {
        const s = byClass[cls]?.scores?.[arm]
        row[arm] = mean(s)
        row[`med_${arm}`] = median(s)
        row[`n_${arm}`] = s?.n ?? 0
      }
      return row
    })
    // "overall" last, so the per-class detail reads first and the pooled number lands as a
    // summary rather than as another class.
    const overall: Record<string, string | number | null> = { group: 'overall' }
    for (const arm of arms) {
      const s = report.byArm?.[arm]?.metrics?.score
      overall[arm] = mean(s)
      overall[`med_${arm}`] = median(s)
      overall[`n_${arm}`] = s?.n ?? 0
    }
    rows.push(overall)
    return rows
  }, [report, arms])

  // Is the median saturated? If so, say so under the title rather than leaving a reader to
  // wonder why the chart and the table lead with different statistics.
  const medianSaturated = useMemo(
    () => data.length > 0 && data.every((row) => arms.every((a) => row[`med_${a}`] == null || row[`med_${a}`] === 1)),
    [data, arms]
  )

  if (!arms.length) return null

  return (
    <div>
      <p className="text-sm font-medium">How correct each arm is</p>
      <p className="mb-2 text-xs text-muted-foreground">
        mean score per question class · higher is better · 1.00 = every required fact present
        {medianSaturated && ' · median is 1.00 for every arm and class here, so the mean is what shows the difference (hover for both)'}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 4 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="group" tick={{ fill: theme.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: theme.grid }} />
          <YAxis
            domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]}
            tick={{ fill: theme.tick, fontSize: 11 }} tickLine={false} axisLine={false}
          />
          <Tooltip
            cursor={{ fill: theme.isDark ? '#ffffff0a' : '#0000000a' }}
            content={<ChartTooltip unit={(v) => v.toFixed(2)} />}
          />
          {/* Legend rendered below, not by recharts — see ArmLegend. */}
          {arms.map((arm) => (
            <Bar key={arm} dataKey={arm} name={arm} fill={colors[arm]} radius={[4, 4, 0, 0]}
              stroke={theme.surface} strokeWidth={2} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ArmLegend arms={arms} colors={colors} tint={theme.tick} />
    </div>
  )
}

/**
 * Figure 2 — what one query costs.
 *
 * TWO PANELS, NOT TWO AXES. Tokens and seconds are different measures on wildly different
 * scales; putting them on one plot with a second y-axis is the single most misleading thing a
 * chart can do — the crossover point where one line passes another becomes an artifact of the
 * two scales rather than a fact about the data. Small multiples, one scale each.
 *
 * Four bars per panel, so every bar IS directly labelled here. That also discharges the
 * contrast warning the light palette carries.
 */
export function CostChart({ report }: { report: KgbenchReport }) {
  const theme = useAxisTheme()
  const arms = useMemo(() => Object.keys(report.byArm ?? {}), [report])
  const colors = useArmColors(arms)

  const panels = useMemo(() => ([
    {
      key: 'content_tokens',
      title: 'Content tokens per query',
      sub: 'median, excluding each arm\'s fixed baseline',
      fmt: fmtTokens,
      data: arms.map((arm) => ({ arm, value: median(report.byArm?.[arm]?.metrics?.content_tokens) })),
    },
    {
      key: 'wall_s',
      title: 'Latency per query',
      sub: 'median wall-clock seconds',
      fmt: (v: number) => `${v.toFixed(1)}s`,
      data: arms.map((arm) => ({ arm, value: median(report.byArm?.[arm]?.metrics?.wall_s) })),
    },
  ]), [report, arms])

  if (!arms.length) return null

  return (
    <div>
      <p className="text-sm font-medium">What one query costs</p>
      <p className="mb-2 text-xs text-muted-foreground">
        one bar per arm · lower is better · medians across every question and rep
      </p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {panels.map((p) => (
          <div key={p.key}>
            <p className="text-xs font-medium text-foreground">{p.title}</p>
            <p className="mb-1 text-xs text-muted-foreground">{p.sub}</p>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={p.data} margin={{ top: 18, right: 8, left: -18, bottom: 0 }} barCategoryGap="26%">
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="arm" tick={{ fill: theme.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: theme.grid }} />
                <YAxis tick={{ fill: theme.tick, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => p.fmt(v)} width={54} />
                <Tooltip cursor={{ fill: theme.isDark ? '#ffffff0a' : '#0000000a' }} content={<ChartTooltip unit={p.fmt} />} />
                <Bar dataKey="value" name={p.title} radius={[4, 4, 0, 0]} stroke={theme.surface} strokeWidth={2}>
                  {p.data.map((d) => <Cell key={d.arm} fill={colors[d.arm]} />)}
                  {/* Direct labels: four bars, so every one is named without crowding. Text
                      wears a text token — never the series color. */}
                  <LabelList
                    dataKey="value" position="top" offset={6}
                    style={{ fill: theme.tick, fontSize: 10 }}
                    // recharts types the formatter's argument as ReactNode, so narrow to a
                    // number here rather than asserting the prop type away.
                    formatter={(v: unknown) => (typeof v === 'number' ? p.fmt(v) : '')}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
      {/* NO LEGEND. Every bar is named directly beneath it on the x-axis, so a legend would
          repeat the axis — and the arm hues are the same ones the correctness figure above
          already labels. A legend earns its space when marks cannot be labelled in place;
          these can. */}
    </div>
  )
}
