/** Recharts colours each tooltip line in its series colour — pale pinks and
 *  greens on white were unreadable, and the default box has no z-order over
 *  the Legend, which drew through it. A popover card: swatch, name, value,
 *  largest first, zeros dropped, total at the foot. A chart grouped by process
 *  has ~70 series, so past `maxRows` the rest fold into one "+N more" line
 *  instead of a box taller than the chart. Pass `wrapperStyle={{ zIndex: 10 }}`
 *  on the <Tooltip> so it sits above the Legend. */
export function SeriesTooltip({ active, payload, label, format, maxRows = 12 }: {
  active?: boolean
  payload?: Array<{ name?: string | number; value?: number | string | null; color?: string }>
  label?: string | number
  format: (v: number) => string
  maxRows?: number
}) {
  if (!active || !payload?.length) return null
  const items = payload
    .map(p => ({ name: String(p.name ?? ''), value: Number(p.value) || 0, color: p.color || '#888' }))
    .filter(p => p.value > 0)
    .sort((a, b) => b.value - a.value)
  if (!items.length) return null
  const total = items.reduce((a, p) => a + p.value, 0)
  const shown = items.slice(0, maxRows)
  const rest = items.slice(maxRows)
  return (
    <div className="rounded-md border bg-popover text-popover-foreground shadow-md px-3 py-2 text-xs min-w-[200px] max-w-[360px]">
      <div className="font-medium mb-1">{label}</div>
      {shown.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
            <span className="truncate">{p.name}</span>
          </span>
          <span className="tabular-nums">{format(p.value)}</span>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="flex justify-between gap-4 py-0.5 text-muted-foreground">
          <span>+{rest.length} more</span>
          <span className="tabular-nums">{format(rest.reduce((a, p) => a + p.value, 0))}</span>
        </div>
      )}
      {items.length > 1 && (
        <div className="flex justify-between gap-4 border-t mt-1 pt-1 font-medium">
          <span>Total</span><span className="tabular-nums">{format(total)}</span>
        </div>
      )}
    </div>
  )
}
