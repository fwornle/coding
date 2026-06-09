// PORT-SPEC: VOKB NodeDetails.tsx:243-296 (and IssueTriage.tsx:21-53 duplicate —
// extracted to shared module per UI-SPEC §7 row 10).
//
// Single source-of-truth for the evidence-link type system. Consumed by:
//   - EntityDetailPanel (55-09)  — Sources & Evidence section
//   - IssueTriageView   (55-10)  — replaces the verbatim VOKB duplicate
//
// D-55-02a (verbatim VOKB port rule): icons, labels, and date-math
// thresholds are LITERAL copies. The snapshot tests in
// `evidence-types.test.ts` guard against drift in either direction.

/**
 * Evidence link type for grouping/icons — mirrors the server
 * `EvidenceLinkType` (verbatim from VOKB NodeDetails.tsx:59-73).
 *
 * Each link annotates an entity's `metadata.sourceRefs[]` entry with the
 * upstream system it originated from (Argo workflow, RaaS job, GitHub,
 * etc.) so the UI can render an iconographic chip without a lookup.
 */
export type EvidenceLinkType =
  | 'argo_workflow'
  | 'argo_logs'
  | 'raas_job'
  | 'cloudwatch'
  | 'grafana'
  | 's3'
  | 'github'
  | 'session'
  | 'confluence'
  | 'jira'
  | 'codebeamer'
  | 'mkdocs'
  | 'adr'
  | 'other'

/**
 * Unicode icons for each evidence link type — no icon library needed.
 * Verbatim from VOKB NodeDetails.tsx:244-258 (and IssueTriage.tsx:21-37
 * duplicate which this module replaces).
 *
 * Sticking to Unicode glyphs (rather than a font-icon package) keeps the
 * payload small and avoids loading a webfont for what is essentially a
 * 14-entry lookup table.
 */
export const EVIDENCE_TYPE_ICONS: Record<EvidenceLinkType, string> = {
  argo_workflow: '⚙',          // ⚙
  argo_logs:     '⚙',          // ⚙
  raas_job:      '📋',    // 📋
  cloudwatch:    '☁',          // ☁
  grafana:       '📊',    // 📊
  s3:            '📦',    // 📦
  github:        '⟨⟩',    // ⟨⟩
  session:       '🔗',    // 🔗
  mkdocs:        '📖',    // 📖
  confluence:    '📄',    // 📄
  jira:          '🎯',    // 🎯
  codebeamer:    '📝',    // 📝
  adr:           '⚖',          // ⚖
  other:         '🔹',    // 🔹
}

/**
 * Human-readable labels for evidence link types — verbatim from VOKB
 * NodeDetails.tsx:262-277 (and IssueTriage.tsx:39-53).
 *
 * These are display strings (NOT translation keys); they are tracked in
 * the snapshot test so any change to a label is reviewed at port-spec
 * granularity.
 */
export const EVIDENCE_TYPE_LABELS: Record<EvidenceLinkType, string> = {
  argo_workflow: 'Argo Workflows',
  argo_logs:     'Argo Logs',
  raas_job:      'RaaS Jobs',
  cloudwatch:    'CloudWatch',
  grafana:       'Grafana',
  s3:            'S3 Objects',
  github:        'GitHub',
  session:       'Sessions',
  mkdocs:        'Documentation',
  confluence:    'Confluence',
  jira:          'Jira',
  codebeamer:    'CodeBeamer',
  adr:           'Architecture Decisions',
  other:         'Other',
}

/**
 * Compute the staleness band for a `metadata.sourceRefs[].addedAt` ISO
 * timestamp — verbatim from VOKB NodeDetails.tsx:280-296.
 *
 * Bands:
 *   - fresh      (≤ 90 days)   → null (no badge rendered)
 *   - stale      (> 90, ≤ 180) → amber chip with floor(d) label
 *   - very stale (> 180)       → red chip with floor(d) label
 *
 * Boundaries use STRICT inequality (`> 180`, `> 90`) to match the VOKB
 * source. The label is `${Math.floor(ageDays)}d` (NOT `Math.round`) so the
 * chip never claims an extra day.
 */
export function evidenceAgeBadge(addedAt: string): { label: string; className: string } | null {
  const ageMs = Date.now() - new Date(addedAt).getTime()
  const ageDays = ageMs / 86_400_000
  if (ageDays > 180) {
    return {
      label: `${Math.floor(ageDays)}d`,
      className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    }
  }
  if (ageDays > 90) {
    return {
      label: `${Math.floor(ageDays)}d`,
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    }
  }
  return null // fresh — no badge needed
}
