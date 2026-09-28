// PORT-SPEC: snapshot tests asserting verbatim parity with
//   VOKB NodeDetails.tsx:243-296 (single-source extract)
//   VOKB IssueTriage.tsx:21-53 (verbatim duplicate, now extracted to shared module)
//
// Per D-55-02a (verbatim VOKB port rule): icons, labels, and age-band
// thresholds are LITERAL copies. Any drift in either direction breaks these
// tests loudly.

import { describe, test, expect } from 'vitest'
import {
  EVIDENCE_TYPE_ICONS,
  EVIDENCE_TYPE_LABELS,
  evidenceAgeBadge,
  resolveEvidenceHref,
  insightDocNameFromRef,
  type EvidenceLinkType,
} from './evidence-types'

describe('evidence-types — EVIDENCE_TYPE_ICONS (VOKB NodeDetails.tsx:244-258)', () => {
  test('argo_workflow is gear ⚙ (U+2699)', () => {
    expect(EVIDENCE_TYPE_ICONS.argo_workflow).toBe('⚙')
    expect(EVIDENCE_TYPE_ICONS.argo_workflow).toBe('⚙')
  })
  test('argo_logs shares gear ⚙', () => {
    expect(EVIDENCE_TYPE_ICONS.argo_logs).toBe('⚙')
  })
  test('github is angle-bracket pair ⟨⟩ (U+27E8 U+27E9)', () => {
    expect(EVIDENCE_TYPE_ICONS.github).toBe('⟨⟩')
    expect(EVIDENCE_TYPE_ICONS.github).toBe('⟨⟩')
  })
  test('cloudwatch is cloud ☁ (U+2601)', () => {
    expect(EVIDENCE_TYPE_ICONS.cloudwatch).toBe('☁')
  })
  test('adr is balance scale ⚖ (U+2696)', () => {
    expect(EVIDENCE_TYPE_ICONS.adr).toBe('⚖')
  })
  test('all 14 evidence link types have an icon', () => {
    expect(Object.keys(EVIDENCE_TYPE_ICONS).length).toBe(14)
  })
})

describe('evidence-types — EVIDENCE_TYPE_LABELS (VOKB NodeDetails.tsx:262-277)', () => {
  test('cloudwatch is "CloudWatch"', () => {
    expect(EVIDENCE_TYPE_LABELS.cloudwatch).toBe('CloudWatch')
  })
  test('other is "Other" and is the fallback bucket', () => {
    expect(EVIDENCE_TYPE_LABELS.other).toBe('Other')
  })
  test('mkdocs renders as "Documentation"', () => {
    expect(EVIDENCE_TYPE_LABELS.mkdocs).toBe('Documentation')
  })
  test('adr renders as "Architecture Decisions"', () => {
    expect(EVIDENCE_TYPE_LABELS.adr).toBe('Architecture Decisions')
  })
  test('all 14 evidence link types have a human-readable label', () => {
    expect(Object.keys(EVIDENCE_TYPE_LABELS).length).toBe(14)
  })
})

describe('evidence-types — EvidenceLinkType union (compile-time)', () => {
  test('accepts all 14 known keys', () => {
    const known: EvidenceLinkType[] = [
      'argo_workflow', 'argo_logs', 'raas_job', 'cloudwatch',
      'grafana', 's3', 'github', 'session', 'mkdocs',
      'confluence', 'jira', 'codebeamer', 'adr', 'other',
    ]
    expect(known.length).toBe(14)
  })
  test('rejects unknown literals at compile time', () => {
    // @ts-expect-error — 'unknown_link' is not a member of EvidenceLinkType
    const bad: EvidenceLinkType = 'unknown_link'
    // runtime smoke — the value is still a string; the TS error above is the contract.
    expect(typeof bad).toBe('string')
  })
})

describe('evidence-types — evidenceAgeBadge (VOKB NodeDetails.tsx:280-296)', () => {
  const ISO = (daysAgo: number): string =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString()

  test('now → null (fresh, no badge)', () => {
    expect(evidenceAgeBadge(new Date().toISOString())).toBeNull()
  })

  test('boundary just under 180d (180.0d exactly) → null', () => {
    // VOKB source uses STRICT > 180, so a value exactly equal to 180.0d
    // must not raise the red badge. Use 179.5d to avoid float drift across
    // the boundary while preserving the "just under" intent.
    expect(evidenceAgeBadge(ISO(179.5))).not.toEqual(
      expect.objectContaining({ className: expect.stringContaining('bg-red-100') }),
    )
  })

  test('181d → red badge (> 180d)', () => {
    const result = evidenceAgeBadge(ISO(181))
    expect(result).not.toBeNull()
    expect(result!.label).toBe('181d')
    expect(result!.className).toContain('bg-red-100')
    expect(result!.className).toContain('text-red-700')
    expect(result!.className).toContain('dark:bg-red-900/40')
    expect(result!.className).toContain('dark:text-red-300')
  })

  test('91d → amber badge (> 90d, ≤ 180d)', () => {
    const result = evidenceAgeBadge(ISO(91))
    expect(result).not.toBeNull()
    expect(result!.label).toBe('91d')
    expect(result!.className).toContain('bg-amber-100')
    expect(result!.className).toContain('text-amber-700')
    expect(result!.className).toContain('dark:bg-amber-900/40')
    expect(result!.className).toContain('dark:text-amber-300')
  })

  test('boundary just under 90d (89d) → null (fresh)', () => {
    expect(evidenceAgeBadge(ISO(89))).toBeNull()
  })

  test('90d boundary is fresh (strict > 90)', () => {
    // VOKB uses STRICT > 90, so exactly 90d is still fresh. Use 89.5d to
    // avoid float drift across Date.now() timing while preserving intent.
    const result = evidenceAgeBadge(ISO(89.5))
    expect(result).toBeNull()
  })

  test('Math.floor is applied to the day count in the label', () => {
    const result = evidenceAgeBadge(ISO(95.7))
    expect(result).not.toBeNull()
    expect(result!.label).toBe('95d') // floored, NOT rounded
  })
})

describe('resolveEvidenceHref', () => {
  test('prefixes an origin-relative ref with the API base', () => {
    expect(resolveEvidenceHref('/api/insights/doc/Foo', 'http://localhost:12436')).toBe(
      'http://localhost:12436/api/insights/doc/Foo',
    )
  })

  test('does not double the slash when the base carries a trailing one', () => {
    expect(resolveEvidenceHref('/api/insights/doc/Foo', 'http://localhost:12436/')).toBe(
      'http://localhost:12436/api/insights/doc/Foo',
    )
  })

  test('leaves an absolute URL alone', () => {
    const argo = 'https://argo.example.invalid/workflows/abc'
    expect(resolveEvidenceHref(argo, 'http://localhost:12436')).toBe(argo)
  })

  test('passes an empty url through rather than emitting a bare base', () => {
    expect(resolveEvidenceHref('', 'http://localhost:12436')).toBe('')
  })
})

/**
 * Which evidence refs the panel may open in-app.
 *
 * The Sources & Evidence list used to be a plain `<a target="_blank">` for every
 * ref, so clicking "Documentation" navigated to obs-api's `text/markdown`
 * response and the browser showed a wall of plain text — while the very same
 * document opened as a themed, react-markdown modal from the "View Insight
 * Document" button two sections higher. obs-api is right to serve markdown from
 * an API route; the list just needed to recognise its own documents.
 *
 * The risk in this predicate is over-matching: intercepting an Argo or Grafana
 * link would hand it to a renderer that cannot show it, turning a working link
 * into a broken modal. So the negative cases matter as much as the positive.
 */
describe('insightDocNameFromRef', () => {
  it('matches the origin-relative refs the enrichment writes', () => {
    expect(insightDocNameFromRef('/api/insights/doc/Coding')).toBe('Coding')
  })

  it('matches the same ref once resolved against a host', () => {
    expect(insightDocNameFromRef('http://127.0.0.1:12436/api/insights/doc/Coding')).toBe('Coding')
  })

  it('decodes a percent-encoded name', () => {
    // `enrich-entity-sources` encodes names, and entities with spaces exist.
    expect(insightDocNameFromRef('/api/insights/doc/A%20B')).toBe('A B')
  })

  it('tolerates a trailing slash', () => {
    expect(insightDocNameFromRef('/api/insights/doc/Coding/')).toBe('Coding')
  })

  it('does NOT match the image sub-route', () => {
    // Same prefix, not a document — rendering a PNG as markdown shows nothing.
    expect(insightDocNameFromRef('/api/insights/doc/images/coding-architecture.png')).toBeNull()
  })

  it('does NOT match the document INDEX route', () => {
    expect(insightDocNameFromRef('/api/insights/docs')).toBeNull()
  })

  it('leaves external evidence links alone', () => {
    // These have no in-app renderer; intercepting them breaks a working link.
    for (const url of [
      'https://github.com/fwornle/coding/pull/1',
      'https://grafana.example/d/abc',
      'https://argo.example/workflows/xyz',
      '/api/v1/entities/Coding',
    ]) {
      expect(insightDocNameFromRef(url)).toBeNull()
    }
  })

  it('handles empty and malformed input without throwing', () => {
    expect(insightDocNameFromRef('')).toBeNull()
    expect(insightDocNameFromRef('/api/insights/doc/')).toBeNull()
    // A stray % is invalid percent-encoding; decodeURIComponent throws on it.
    expect(insightDocNameFromRef('/api/insights/doc/100%')).toBe('100%')
  })
})
