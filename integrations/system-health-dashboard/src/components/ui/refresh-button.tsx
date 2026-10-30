import * as React from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A Refresh button that always shows the click was taken.
 *
 * A local fetch often answers in a few milliseconds, so a spinner bound to the
 * request alone never becomes visible and the button looks dead. Here the icon
 * spins for at least MIN_SPIN_MS, then turns into a check for DONE_MS — even
 * when the data did not change. The label follows ("Refreshing…", "Updated"),
 * so the feedback does not depend on motion (prefers-reduced-motion drops the
 * spin, not the words).
 *
 * `onRefresh` may return a promise; the spin lasts until it settles. A
 * rejection skips the check: the caller shows its own error. `busy` spins the
 * icon for work the caller started itself, such as the first load.
 */

const MIN_SPIN_MS = 600
const DONE_MS = 1200

type Phase = 'idle' | 'spinning' | 'done'

type ButtonProps = React.ComponentProps<typeof Button>

export interface RefreshButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'asChild'> {
  onRefresh: () => unknown
  /** Work in progress the button did not start. */
  busy?: boolean
  label?: string
  /** Shown while it spins. */
  busyLabel?: string
  /** Icon only; `label` becomes the accessible name. */
  iconOnly?: boolean
  iconClassName?: string
}

export function RefreshButton({
  onRefresh,
  busy = false,
  label = 'Refresh',
  busyLabel = 'Refreshing…',
  iconOnly = false,
  iconClassName = 'h-4 w-4',
  variant = 'outline',
  size = 'sm',
  disabled,
  className,
  ...rest
}: RefreshButtonProps) {
  const [phase, setPhase] = React.useState<Phase>('idle')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set in the effect, not only at creation: StrictMode unmounts and remounts
  // once, and a flag left false would leave the button spinning for good.
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const click = async () => {
    if (phase === 'spinning') return
    if (timer.current) clearTimeout(timer.current)
    setPhase('spinning')
    const started = Date.now()
    let ok = true
    try {
      await onRefresh()
    } catch {
      ok = false
    }
    const left = MIN_SPIN_MS - (Date.now() - started)
    if (left > 0) await new Promise(r => setTimeout(r, left))
    if (!mounted.current) return
    if (!ok) { setPhase('idle'); return }
    setPhase('done')
    timer.current = setTimeout(() => { if (mounted.current) setPhase('idle') }, DONE_MS)
  }

  const spinning = phase === 'spinning' || (busy && phase !== 'done')
  const text = spinning ? busyLabel :phase === 'done' ? 'Updated' : label
  const Icon = phase === 'done' ? Check : RefreshCw

  return (
    <Button
      {...rest}
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || spinning}
      aria-busy={spinning}
      aria-label={iconOnly ? text : undefined}
      title={iconOnly ? text : rest.title}
      onClick={() => void click()}
      className={cn('disabled:opacity-100', phase === 'done' && 'text-green-600 dark:text-green-400', className)}
    >
      <Icon
        aria-hidden
        className={cn(
          !iconOnly && 'mr-1',
          iconClassName,
          spinning && 'motion-safe:animate-spin',
          phase === 'done' && 'animate-completion-glow',
        )}
      />
      {!iconOnly && <span aria-live="polite">{text}</span>}
    </Button>
  )
}
