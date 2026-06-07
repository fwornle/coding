// PATTERN SOURCE: 45-04-PLAN.md Task 2 Sanitizer tests 1-5
//
// 6 documented edge cases per PLAN:
//   1. <a><img></a> → [![alt](src)](href)
//   2. Standalone <img> → ![alt](src)
//   3. <br/> → '  \n'
//   4. <script> survives sanitizer text-level (not an inline HTML edge case
//      in the documented allowlist), but the FULL pipeline (sanitizer +
//      react-markdown) emits NO <script> element — react-markdown escapes
//      raw HTML by default. T-45-04-01 mitigation envelope.
//   5. <a href="javascript:...">x</a> → after the full pipeline the rendered
//      <a> does NOT carry an href starting with javascript:.
// Plus the leading-whitespace + excessive-blank-lines step 6 checks.

import { describe, test, expect } from 'vitest'
import { render } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { sanitizeMarkdownHtml } from './sanitize-markdown'

describe('sanitizeMarkdownHtml (Plan 45-04 Task 2)', () => {
  test('Sanitizer Test 1: <a href="x"><img src="i.png" alt="a"/></a> → [![a](i.png)](x)', () => {
    const input = '<a href="x"><img src="i.png" alt="a"/></a>'
    expect(sanitizeMarkdownHtml(input)).toBe('[![a](i.png)](x)')
  })

  test('Sanitizer Test 1b: <a><img alt-first/></a> attribute-order variant', () => {
    const input = '<a href="x"><img alt="a" src="i.png"/></a>'
    expect(sanitizeMarkdownHtml(input)).toBe('[![a](i.png)](x)')
  })

  test('Sanitizer Test 2: Standalone <img src="x" alt="y"/> → ![y](x)', () => {
    expect(sanitizeMarkdownHtml('<img src="x" alt="y"/>')).toBe('![y](x)')
    expect(sanitizeMarkdownHtml('<img alt="y" src="x"/>')).toBe('![y](x)')
  })

  test('Sanitizer Test 3: <br/> → two-space + newline', () => {
    expect(sanitizeMarkdownHtml('<br/>')).toBe('  \n')
    expect(sanitizeMarkdownHtml('<br>')).toBe('  \n')
    expect(sanitizeMarkdownHtml('<BR />')).toBe('  \n')
  })

  test('Sanitizer Test 3b: simple <a href>text</a> → [text](href)', () => {
    expect(sanitizeMarkdownHtml('<a href="https://example.com">x</a>')).toBe(
      '[x](https://example.com)',
    )
  })

  test('Sanitizer Test 3c: block tags stripped but content kept', () => {
    const input = '<div>Hello <p>World</p></div>'
    const out = sanitizeMarkdownHtml(input)
    expect(out).not.toContain('<div>')
    expect(out).not.toContain('<p>')
    expect(out).toContain('Hello')
    expect(out).toContain('World')
  })

  test('Sanitizer Test 3d: leading-whitespace image lines reset to column 0 (step 6)', () => {
    const input = '    ![alt](img.png)'
    expect(sanitizeMarkdownHtml(input)).toBe('![alt](img.png)')
  })

  test('Sanitizer Test 3e: 3+ blank lines collapse to 2', () => {
    const input = 'a\n\n\n\nb'
    expect(sanitizeMarkdownHtml(input)).toBe('a\n\nb')
  })

  test('Sanitizer Test 4 (XSS — T-45-04-01): full pipeline emits NO <script> element', () => {
    const sanitized = sanitizeMarkdownHtml('<script>alert(1)</script>')
    // Sanitizer text-level: <script> is NOT in the allowlist (step 5) — it
    // passes through verbatim. The defense layer is react-markdown's
    // default escape-raw-HTML behavior.
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {sanitized}
      </ReactMarkdown>,
    )
    // T-45-04-01: NO <script> element in the rendered DOM.
    expect(container.querySelectorAll('script').length).toBe(0)
    // No global side effect either — render did not execute JS (jsdom would
    // throw if it tried to evaluate alert in test context).
  })

  test('Sanitizer Test 4b: <img onerror=...> survives sanitizer but produces NO onerror attribute in DOM', () => {
    const malicious = '<img src="x" alt="y" onerror="alert(1)"/>'
    const sanitized = sanitizeMarkdownHtml(malicious)
    // Sanitizer rewrites the <img ... src+alt ...> to Markdown ![y](x) —
    // onerror is dropped along with all other img attributes per step 2.
    expect(sanitized).toBe('![y](x)')
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {sanitized}
      </ReactMarkdown>,
    )
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(1)
    expect(imgs[0]?.getAttribute('onerror')).toBeNull()
  })

  test('Sanitizer Test 5 (T-45-04-02): <a href="javascript:..."> — rendered <a> does NOT carry javascript: href', () => {
    // Sanitizer step 3 rewrites simple anchors; the URL goes into the
    // Markdown [text](href) form. react-markdown's default URL transform
    // strips `javascript:` schemes when rendering to <a href=...>.
    const sanitized = sanitizeMarkdownHtml('<a href="javascript:alert(1)">x</a>')
    expect(sanitized).toBe('[x](javascript:alert(1))')
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {sanitized}
      </ReactMarkdown>,
    )
    const anchors = Array.from(container.querySelectorAll('a'))
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? ''
      expect(href.toLowerCase().startsWith('javascript:')).toBe(false)
    }
  })
})
