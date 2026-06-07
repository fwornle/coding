// PATTERN SOURCE: 45-PATTERNS.md § IconButton.tsx
// CONTRACT: 45-UI-SPEC.md § Icon-only controls — every icon-only button
//   MUST carry aria-label and render a <Tooltip>.
//
// Composition primitive — shadcn Button (variant=ghost, size=icon)
// wrapped in a Radix Tooltip. The TS narrowing on `ariaLabel: string`
// (non-optional) means omitting it produces a build error — the
// `// @ts-expect-error` test below verifies this contract.

import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface IconButtonProps {
  /** Lucide icon component. */
  icon: LucideIcon
  /**
   * Accessible name. Required — screen readers announce this in lieu of
   * visible text. Per UI-SPEC § Icon-only controls table, the exact copy
   * is part of the design contract (no executor discretion).
   */
  ariaLabel: string
  /** Tooltip text shown on hover/focus. Falls back to `ariaLabel` when omitted. */
  tooltipText?: string
  /** Click handler. */
  onClick?: () => void
  /** Shadcn Button variant — defaults to `ghost`. */
  variant?: 'ghost' | 'outline' | 'default'
  /** Shadcn Button size — defaults to `icon`. */
  size?: 'icon' | 'icon-sm' | 'icon-lg' | 'sm'
  /** Disabled flag forwarded to the underlying <button>. */
  disabled?: boolean
  /** Optional `data-testid` for test targeting. */
  'data-testid'?: string
}

/**
 * Icon-only button with accessible name + tooltip. Single source of truth for
 * every icon-only control in the unified-viewer (per UI-SPEC § Icon-only
 * controls table). Ref-forwarding so parents can position floating menus
 * relative to the button.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    ariaLabel,
    tooltipText,
    onClick,
    variant = 'ghost',
    size = 'icon',
    disabled,
    'data-testid': dataTestid,
  },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant={variant}
          size={size}
          aria-label={ariaLabel}
          onClick={onClick}
          disabled={disabled}
          data-testid={dataTestid}
          type="button"
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText ?? ariaLabel}</TooltipContent>
    </Tooltip>
  )
})
