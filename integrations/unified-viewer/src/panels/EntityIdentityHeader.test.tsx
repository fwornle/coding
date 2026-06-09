// PATTERN SOURCE: 55-09-PLAN.md Task 1 <behavior> (Identity)
// CONTRACT: 55-PATTERNS.md § EntityIdentityHeader.tsx
//
// Tests:
//   1. Renders entity.name in text-xl font-semibold
//   2. Class chip uses border color from classColor(className, theme)
//   3. Renders L{level} / parent / created / last-confirmed in
//      text-xs text-muted-foreground tabular-nums
//   4. Missing fields render `—` placeholder, never blank
//   5. Theme prop drives classColor (dark vs light still produces a non-empty borderColor)

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntityIdentityHeader } from './EntityIdentityHeader'
import type { Entity } from '@/graph/types'

const baseEntity: Entity = {
  id: 'e1',
  name: 'Selected Entity',
  ontologyClass: 'Observation',
  level: 2,
  parent: 'parent-1',
  createdAt: '2026-01-02',
  lastConfirmedAt: '2026-02-03',
}

describe('EntityIdentityHeader (Plan 55-09 Task 1)', () => {
  test('Test 1: renders entity.name in text-xl font-semibold', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="light" />)
    const name = screen.getByTestId('identity-name')
    expect(name.textContent).toBe('Selected Entity')
    expect(name.className).toMatch(/\btext-xl\b/)
    expect(name.className).toMatch(/\bfont-semibold\b/)
  })

  test('Test 2: class chip uses border color from classColor(className, theme)', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="light" />)
    const badge = screen.getByTestId('identity-class-badge')
    expect(badge.textContent).toBe('Observation')
    // Inline borderColor is set per classColor() output — assert non-empty.
    const style = badge.getAttribute('style') ?? ''
    expect(style).toMatch(/border-color/i)
  })

  test('Test 3: renders L{level} / parent / created / last confirmed in text-xs text-muted-foreground tabular-nums', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="light" />)
    const meta = screen.getByTestId('identity-meta')
    expect(meta.className).toMatch(/\btext-xs\b/)
    expect(meta.className).toMatch(/\btext-muted-foreground\b/)
    expect(meta.className).toMatch(/\btabular-nums\b/)
    expect(meta.textContent).toContain('L2')
    expect(meta.textContent).toContain('parent-1')
    expect(meta.textContent).toContain('2026-01-02')
    expect(meta.textContent).toContain('2026-02-03')
  })

  test('Test 4: missing fields render `—` placeholder, never blank', () => {
    const sparse: Entity = {
      id: 'sparse',
      name: 'Sparse',
      ontologyClass: 'Observation',
    }
    render(<EntityIdentityHeader entity={sparse} theme="light" />)
    const meta = screen.getByTestId('identity-meta')
    // 4 placeholder slots: level / parent / created / last confirmed
    const dashes = meta.textContent?.match(/—/g) ?? []
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })

  test('Test 5: dark theme still produces a non-empty borderColor', () => {
    render(<EntityIdentityHeader entity={baseEntity} theme="dark" />)
    const badge = screen.getByTestId('identity-class-badge')
    const style = badge.getAttribute('style') ?? ''
    expect(style).toMatch(/border-color/i)
  })
})
