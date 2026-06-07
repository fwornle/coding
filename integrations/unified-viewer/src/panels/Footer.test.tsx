// PATTERN SOURCE: 45-03-PLAN.md Task 2 Footer behavior Test 1

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from './Footer'

describe('Footer', () => {
  test('Test 1: renders verbatim Showing X of Y nodes · Z edges with tabular-nums', () => {
    render(<Footer total={500} visible={250} edges={120} />)
    const status = screen.getByTestId('footer-status')
    // Strip whitespace differences between text nodes
    const normalized = status.textContent?.replace(/\s+/g, ' ').trim()
    expect(normalized).toBe('Showing 250 of 500 nodes · 120 edges')
    // tabular-nums applied to numeric spans
    const tabular = status.querySelectorAll('.tabular-nums')
    expect(tabular.length).toBe(3)
  })

  test('Test 2: zero counts still render the verbatim copy', () => {
    render(<Footer total={0} visible={0} edges={0} />)
    const status = screen.getByTestId('footer-status')
    expect(status.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Showing 0 of 0 nodes · 0 edges',
    )
  })
})
