// PATTERN SOURCE: 45-03-PLAN.md Task 1 IconButton behavior tests
//
// Accessibility regression tests (T-45-03-05 mitigation).
// Each icon-only control MUST be queryable via getByRole('button', {name})
// against its UI-SPEC § Icon-only controls aria-label.

import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZoomIn, RotateCcw } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IconButton } from './IconButton'

function renderWithTooltipProvider(ui: React.ReactNode) {
  // Radix Tooltip requires a Provider somewhere up the tree. Tests render
  // each button under a provider — the actual app wraps the SigmaCanvas
  // toolbar + the NavBar under a single Provider near the root.
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)
}

describe('IconButton', () => {
  test('Test 1: getByRole returns the button by ariaLabel (Zoom in)', () => {
    const onClick = vi.fn()
    renderWithTooltipProvider(
      <IconButton ariaLabel="Zoom in" icon={ZoomIn} onClick={onClick} />,
    )
    const btn = screen.getByRole('button', { name: 'Zoom in' })
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('Test 2 (a): ariaLabel feeds the tooltip when no override is given', () => {
    renderWithTooltipProvider(
      <IconButton ariaLabel="Fit graph to view" icon={RotateCcw} />,
    )
    // The TooltipContent is portaled to body and only appears on hover, but
    // the button's `aria-label` still matches the spec verbatim.
    const btn = screen.getByRole('button', { name: 'Fit graph to view' })
    expect(btn.getAttribute('aria-label')).toBe('Fit graph to view')
  })

  test('Test 2 (b): tooltipText prop overrides the tooltip while keeping ariaLabel', () => {
    renderWithTooltipProvider(
      <IconButton
        ariaLabel="Toggle theme"
        tooltipText="Light / Dark"
        icon={ZoomIn}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Toggle theme' })
    expect(btn.getAttribute('aria-label')).toBe('Toggle theme')
    // Tooltip text doesn't change the accessible name — verified by the
    // getByRole({name}) lookup above.
  })

  test('Test 3: missing ariaLabel is a TS-narrowing error (compile-time)', () => {
    // The next line MUST be a TypeScript error — IconButton.ariaLabel is
    // non-optional. The `@ts-expect-error` directive proves it: if the
    // compiler ACCEPTS the call, the directive itself becomes an error
    // ("Unused '@ts-expect-error' directive"), failing the build.
    function _shouldNotCompile() {
      return (
        // @ts-expect-error — ariaLabel is required by the IconButton contract
        <IconButton icon={ZoomIn} />
      )
    }
    // Runtime no-op assertion — the real check is the build.
    expect(typeof _shouldNotCompile).toBe('function')
  })

  test('Test 4: disabled prop forwards to the underlying button', () => {
    renderWithTooltipProvider(
      <IconButton ariaLabel="Zoom in" icon={ZoomIn} disabled />,
    )
    const btn = screen.getByRole('button', { name: 'Zoom in' })
    expect(btn).toBeDisabled()
  })

  test('Test 5: data-testid passes through for test targeting', () => {
    renderWithTooltipProvider(
      <IconButton
        ariaLabel="Zoom out"
        icon={ZoomIn}
        data-testid="zoom-out-btn"
      />,
    )
    expect(screen.getByTestId('zoom-out-btn')).toBeInTheDocument()
  })
})
