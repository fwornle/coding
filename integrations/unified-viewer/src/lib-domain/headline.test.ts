// headline() — one line in front of the reference article.

import { describe, test, expect } from 'vitest'
import { headline, hasArticle } from './headline'

const ARTICLE = `## Purpose
\`copilot-events-tail.mjs\` tails an events file and exposes stats (e.g. \`watching_sessions\`) so tests can confirm the tail is armed. Second sentence should not appear.

## Architecture
- \`tailEventsFile\` increments the counter.

## Key Files
- \`copilot-events-tail.mjs\``

describe('headline', () => {
  test('takes the first sentence of ## Purpose, not the whole article', () => {
    const h = headline({ description: ARTICLE })
    expect(h).toBe(
      'copilot-events-tail.mjs tails an events file and exposes stats (e.g. watching_sessions) so tests can confirm the tail is armed.',
    )
    expect(h).not.toContain('Second sentence')
    expect(h).not.toContain('##')
  })

  test('an explicit metadata.headline wins over parsing', () => {
    // Parsing is the fallback; the writer stamps this going forward.
    expect(headline({ description: ARTICLE, metadata: { headline: 'Stamped by the writer.' } }))
      .toBe('Stamped by the writer.')
  })

  test('unwraps inline code rather than dropping it', () => {
    // `copilot-events-tail.mjs` is exactly what makes a headline worth reading.
    expect(headline({ description: '## Purpose\n`foo.mjs` does a thing.' })).toBe('foo.mjs does a thing.')
  })

  test('a filename full stop does not end the sentence', () => {
    // A naive split on "." would cut at ".mjs".
    expect(headline({ description: '## Purpose\nThe file foo.mjs is read at boot.' }))
      .toBe('The file foo.mjs is read at boot.')
  })

  test('strips a writer-tag prefix', () => {
    expect(headline({ description: '[LLM] The system validates config.' }))
      .toBe('The system validates config.')
  })

  test('falls back to the description when there is no Purpose section', () => {
    expect(headline({ description: 'Just a plain description here.' }))
      .toBe('Just a plain description here.')
  })

  test('skips a bullet-only Purpose in favour of the surrounding prose', () => {
    const h = headline({ description: '## Purpose\n- a bullet\n\n## Architecture\nProse here.' })
    expect(h.startsWith('-')).toBe(false)
  })

  test('clamps long text on a word boundary', () => {
    const long = 'word '.repeat(80) + 'end.'
    const h = headline({ description: long })
    expect(h.length).toBeLessThanOrEqual(161)
    expect(h.endsWith('…')).toBe(true)
    expect(h).not.toMatch(/wor…$/) // not cut mid-token
  })

  test('falls back to the name, then to empty', () => {
    expect(headline({ name: 'OnlyAName' })).toBe('OnlyAName')
    expect(headline({})).toBe('')
    expect(headline(null)).toBe('')
  })
})

describe('hasArticle', () => {
  test('true when the description carries more than the headline shows', () => {
    expect(hasArticle({ description: ARTICLE })).toBe(true)
  })

  test('false for a description the headline already covers', () => {
    expect(hasArticle({ description: 'Short and done.' })).toBe(false)
    expect(hasArticle({})).toBe(false)
  })
})
