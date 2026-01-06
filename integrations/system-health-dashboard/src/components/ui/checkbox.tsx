'use client'

import * as React from 'react'
import { Check } from 'lucide-react'

interface CheckboxProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
  id?: string
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked = false, onCheckedChange, disabled = false, className = '', id }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        id={id}
        onClick={() => onCheckedChange?.(!checked)}
        className={`
          peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-50
          ${checked ? 'bg-primary text-primary-foreground' : 'bg-background'}
          ${className}
        `.trim().replace(/\s+/g, ' ')}
      >
        {checked && (
          <Check className="h-3 w-3 mx-auto" />
        )}
      </button>
    )
  }
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
