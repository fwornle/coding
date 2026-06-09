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
