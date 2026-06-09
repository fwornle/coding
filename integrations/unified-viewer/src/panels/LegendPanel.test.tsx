// PATTERN SOURCE: 55-07-PLAN.md Task 1 <behavior>
//   + 55-PATTERNS.md § LegendPanel.tsx
//
// Behavior:
//   Test 1: renders inside a <details> element (collapsed by default); 4 sections
//           — Domains, Layers, Source, Relationships.
//   Test 2: swatch colors come from vokb-palette.ts exports — assert at least 3
//           Tailwind classes from LAYER_BADGE_CLASS/EDGE_STYLES appear in DOM.
//   Test 3: shape swatches rendered as inline SVG (per 55-05 v1 note in
//           summary — renderer ships circles for all 5 shapes; LegendPanel must
//           render true SVG shapes so users see the encoded distinction).

import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LegendPanel } from './LegendPanel'
import { LAYER_BADGE_CLASS, EDGE_STYLES } from '@/graph/vokb-palette'

afterEach(() => cleanup())

describe('LegendPanel', () => {
  test('Test 1: renders inside a <details> element (collapsed by default) with 4 sections', () => {
    const { container } = render(<LegendPanel />)
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    // <details> is collapsed by default — open attribute absent unless author sets it
    expect(details?.hasAttribute('open')).toBe(false)
    // Summary text
    expect(screen.getByText(/^Legend$/i)).toBeInTheDocument()
    // 4 section headings
    expect(screen.getByText(/^Domains$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Layers$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Source$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Relationships$/i)).toBeInTheDocument()
  })

  test('Test 2: swatches use vokb-palette tokens — ≥3 LAYER_BADGE_CLASS/EDGE_STYLES tokens appear in markup', () => {
    const { container } = render(<LegendPanel />)
    const html = container.innerHTML
    // Layer badge classes — these are the Tailwind className strings
    let layerHits = 0
    for (const cls of Object.values(LAYER_BADGE_CLASS)) {
      // Take the first token of each compound class string for the assertion;
      // e.g. "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      // → "bg-blue-100" must appear somewhere in the legend.
      const firstToken = cls.split(' ')[0]
      if (html.includes(firstToken)) layerHits += 1
    }
    // Edge colors — the EDGE_STYLES values are raw hex (#xxxxxx) used inside SVG
    let edgeHits = 0
    for (const { color } of Object.values(EDGE_STYLES)) {
      if (html.includes(color)) edgeHits += 1
    }
    // Combined evidence of palette usage. Plan's <done> grep gate requires ≥3
    // Tailwind classes from LAYER_BADGE_CLASS/EDGE_STYLES.
    expect(layerHits + edgeHits).toBeGreaterThanOrEqual(3)
  })

  test('Test 3: shape swatches rendered as inline SVG (55-05 renderer stub workaround)', () => {
    const { container } = render(<LegendPanel />)
    // Open the <details> so children become visible in the DOM (jsdom still
    // renders inner content regardless of open state, but assertion is more
    // explicit when we walk the SVGs.)
    const svgs = container.querySelectorAll('svg')
    // At minimum we expect: shape swatches (>=5), source-authority stroke
    // samples (>=3), relationship line samples (>=10). Tally ≥10 SVGs total.
    expect(svgs.length).toBeGreaterThanOrEqual(10)
  })
})

describe('LegendPanel — Logger discipline', () => {
  test('ZERO raw console.* in LegendPanel.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const filePath = fileURLToPath(new URL('./LegendPanel.tsx', import.meta.url))
    const src = readFileSync(filePath, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })
})
