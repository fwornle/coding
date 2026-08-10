import { ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Shared pieces for the Benchmarks launcher.
//
// They exist because the launcher has five multi-select groups (arms, agents, models,
// question classes, questions) that must behave identically. Five hand-written copies of
// "toggle, select all, select none, show how many are on" is five places for them to drift —
// and the one that drifts silently is the worst kind: an operator ticks a box, the count does
// not move, and the matrix they get is not the one they chose.

/**
 * A label with a `?` that explains what a control does.
 *
 * NOTE THE `<span>` AROUND THE ICON. shadcn's Button and Badge do not forward refs, and Radix
 * `TooltipTrigger asChild` needs a ref on its child — an un-wrapped component child silently
 * renders a tooltip that never opens. A plain element (or this span) is the reliable trigger.
 */
export function Hint({ children, text }: { children: ReactNode; text: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help text-muted-foreground/70 hover:text-muted-foreground">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </span>
  )
}

/** Wrap any element so hovering it explains itself. */
export function Explain({ children, text }: { children: ReactNode; text: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  )
}

/**
 * `all` / `none` for one group.
 *
 * Each is disabled when it would be a no-op, so the pair also reads as a state indicator: two
 * greyed links mean the group is empty AND full, which is impossible — i.e. it tells you at a
 * glance whether you are looking at everything or nothing.
 */
export function AllNone({
  onAll, onNone, allDisabled, noneDisabled, label = 'items',
}: {
  onAll: () => void
  onNone: () => void
  allDisabled?: boolean
  noneDisabled?: boolean
  label?: string
}) {
  const cls = 'text-xs underline-offset-2 hover:underline disabled:no-underline disabled:opacity-40 disabled:cursor-default'
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={cls} onClick={onAll} disabled={allDisabled}
        title={`Select every one of the ${label}`}>all</button>
      <span className="text-xs text-muted-foreground/50">/</span>
      <button type="button" className={cls} onClick={onNone} disabled={noneDisabled}
        title={`Clear every one of the ${label}`}>none</button>
    </span>
  )
}

export interface PickOption {
  value: string
  label: string
  /** Rendered after the label — a badge, a count, an enforcement marker. */
  suffix?: ReactNode
  disabled?: boolean
  /** Hover text explaining this specific option. */
  hint?: ReactNode
}

/**
 * One labelled multi-select group with its own all/none and a live "n of m" count.
 *
 * COLUMNS ARE AUTO-FILLED, NOT FIXED. A fixed `sm:grid-cols-2` reads fine in a narrow card and
 * badly in a wide one: at 1500px it puts "claude" and "copilot" 700px apart with nothing
 * between them, so the card is mostly whitespace and the eye has to travel to associate a
 * checkbox with its label. `auto-fill` with a minimum track width packs as many columns as
 * actually fit and collapses to one on a phone — dense where there is room, stacked where
 * there is not, with no breakpoint list to maintain.
 *
 * `minColWidth` is per-group because the content differs: agent names are one word, a question
 * is a short sentence.
 */
export function PickGroup({
  title, hint, options, selected, onChange, minColWidth = '16rem', footer,
}: {
  title: string
  hint?: ReactNode
  options: PickOption[]
  selected: string[]
  onChange: (next: string[]) => void
  minColWidth?: string
  footer?: ReactNode
}) {
  const selectable = options.filter((o) => !o.disabled).map((o) => o.value)
  const onCount = selected.filter((v) => selectable.includes(v)).length

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {hint ? <Hint text={hint}>{title}</Hint> : title}
          <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
            {onCount} of {selectable.length}
          </span>
        </p>
        <AllNone
          label={title.toLowerCase()}
          onAll={() => onChange([...new Set([...selected, ...selectable])])}
          onNone={() => onChange(selected.filter((v) => !selectable.includes(v)))}
          allDisabled={onCount === selectable.length}
          noneDisabled={onCount === 0}
        />
      </div>
      <div
        className="grid gap-x-6 gap-y-1"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}, 1fr))` }}
      >
        {options.map((o) => {
          const row = (
            <label
              className={`flex items-center gap-1.5 text-sm ${o.disabled ? 'text-muted-foreground' : 'cursor-pointer'}`}
            >
              <Checkbox
                checked={selected.includes(o.value)}
                disabled={o.disabled}
                onCheckedChange={() => toggle(o.value)}
              />
              <span className="truncate">{o.label}</span>
              {o.suffix}
            </label>
          )
          return (
            <div key={o.value} className="min-w-0">
              {o.hint ? <Explain text={o.hint}>{row}</Explain> : row}
            </div>
          )
        })}
      </div>
      {footer}
    </div>
  )
}
