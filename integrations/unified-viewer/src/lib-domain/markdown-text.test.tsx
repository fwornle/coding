// PATTERN SOURCE: 45-03-PLAN.md Task 1 markdown-text behavior tests
// + T-45-03-01 mitigation (XSS escape verification)
//
// The ported renderer is byte-for-byte identical to the dashboard's
// markdown-text.tsx (verified by diff at port time). These tests lock
// in the contract the port relies on:
//
//   1. **bold** parses to a <strong> tag (not a literal asterisk pair).
//   2. <script>alert(1)</script> renders as ESCAPED TEXT, never as a
//      DOM script tag (XSS — Plan 45-03 threat T-45-03-01).

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownText } from './markdown-text'

describe('MarkdownText (ported lightweight renderer)', () => {
  test('Test 1: **bold** renders as a <strong> tag (port parity with dashboard)', () => {
    const { container } = render(<MarkdownText text="hello **world**" />)
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong!.textContent).toBe('world')
  })

  test('Test 2 (T-45-03-01): <script> renders as escaped text, NOT a DOM script', () => {
    const { container } = render(
      <MarkdownText text="<script>alert(1)</script>" />,
    )
    // No DOM <script> element should ever exist in the rendered tree.
    expect(container.querySelector('script')).toBeNull()
    // The text content should be present verbatim (escaped by React's text-node insertion).
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  test('Test 3: header (## H2) renders a heading element of level 3 (h2 = ##+1)', () => {
    // Per the verbatim port: header level N renders as h(N+1) with a min of h6.
    // So `## Header` (level 2) becomes <h3>.
    const { container } = render(<MarkdownText text="## Section heading" />)
    expect(container.querySelector('h3')).not.toBeNull()
  })

  test('Test 4: inline `code` wraps the slice in a <code> tag', () => {
    const { container } = render(<MarkdownText text="run `npm test` now" />)
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toBe('npm test')
  })

  test('Test 5: redaction tokens render in a styled span (not stripped)', () => {
    const { container } = render(
      <MarkdownText text="hit by <USER_ID_REDACTED> at 12:34" />,
    )
    const span = container.querySelector('span.text-sky-400\\/80')
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('<USER_ID_REDACTED>')
  })

  test('Test 6: bullet list collects consecutive `- item` lines into a single <ul>', () => {
    const text = '- one\n- two\n- three'
    const { container } = render(<MarkdownText text={text} />)
    const ul = container.querySelector('ul')
    expect(ul).not.toBeNull()
    expect(ul!.querySelectorAll('li').length).toBe(3)
  })

  test('Test 7: paragraph (no markdown) renders as a <p> with text content', () => {
    render(<MarkdownText text="plain paragraph" />)
    expect(screen.getByText('plain paragraph').tagName).toBe('P')
  })
})
